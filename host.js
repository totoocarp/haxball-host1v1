const fs = require('fs');
const path = require('path');
const HaxballJS = require('haxball.js');
const { loadConfig } = require('./src/config');
const { DataStore } = require('./src/storage/dataStore');
const { LinkService } = require('./src/services/linkService');
const { DiscordBotService } = require('./src/services/discordBot');
const { eloChange, streakBonus } = require('./src/services/eloService');

const TEAM_SPEC = 0;
const TEAM_RED = 1;
const TEAM_BLUE = 2;

const config = loadConfig();
config.game.baseElo ||= 1000;

const store = new DataStore(config);
store.load();
const linkService = new LinkService(store, config.game.loginCodeTtlMs);
const discord = new DiscordBotService(config, store, linkService);

const runtime = {
  afk: new Set(),
  room: null,
  touchLog: [],
  currentMatch: null
};

function adminByPlayer(player) {
  return Boolean(player.admin);
}

function prefixFor(playerEntity) {
  const all = store.getTopBy('elo', 200);
  const idx = all.findIndex((p) => p.id === playerEntity.id);
  const rankTag = idx === -1 ? '#--' : `#${idx + 1}`;
  const afkTag = runtime.afk.has(playerEntity.id) ? '[AFK] ' : '';
  return `${afkTag}${rankTag}`;
}

function announce(room, msg, targetId = null, color = config.style.defaultColor, style = 'normal') {
  room.sendAnnouncement(msg, targetId, color, style);
  discord.sendBridge(msg).catch(() => null);
}

function ensurePlayerEntity(player) {
  return store.ensureByAuth(player.auth || `guest:${player.name}`, player.name);
}

function activePlayers(room) {
  return room.getPlayerList().filter((p) => p.id !== 0 && p.team !== TEAM_SPEC);
}

function spectators(room) {
  return room.getPlayerList().filter((p) => p.id !== 0 && p.team === TEAM_SPEC);
}

function assignTeams(room) {
  const players = room.getPlayerList().filter((p) => p.id !== 0);
  const red = players.filter((p) => p.team === TEAM_RED);
  const blue = players.filter((p) => p.team === TEAM_BLUE);

  for (const p of players.filter((x) => x.team === TEAM_SPEC)) {
    const rc = room.getPlayerList().filter((x) => x.team === TEAM_RED).length;
    const bc = room.getPlayerList().filter((x) => x.team === TEAM_BLUE).length;
    if (rc < 1 || bc < 1) room.setPlayerTeam(p.id, rc <= bc ? TEAM_RED : TEAM_BLUE);
  }

  if (red.length > 1) room.setPlayerTeam(red[1].id, TEAM_SPEC);
  if (blue.length > 1) room.setPlayerTeam(blue[1].id, TEAM_SPEC);
}

function syncMatchMode(room) {
  const actives = activePlayers(room);
  if (actives.length <= 1) {
    room.setScoreLimit(0);
    room.setTimeLimit(0);
    if (!room.getScores()) room.startGame();
    runtime.currentMatch = null;
    return;
  }

  room.setScoreLimit(config.game.scoreLimit);
  room.setTimeLimit(config.game.timeLimit);
  if (!room.getScores()) setTimeout(() => room.startGame(), config.game.autoStartDelayMs);
}

function registerGoal(team) {
  if (!runtime.currentMatch) return;
  const scorer = runtime.touchLog[runtime.touchLog.length - 1];
  const assister = runtime.touchLog[runtime.touchLog.length - 2];
  if (!scorer) return;

  runtime.currentMatch.goals[scorer.pid] = (runtime.currentMatch.goals[scorer.pid] || 0) + 1;
  if (assister && assister.pid !== scorer.pid) {
    runtime.currentMatch.assists[assister.pid] = (runtime.currentMatch.assists[assister.pid] || 0) + 1;
  }
  runtime.currentMatch.lastGoalTeam = team;
}

function rankByElo(playerId) {
  const list = store.getTopBy('elo', 9999);
  const idx = list.findIndex((p) => p.id === playerId);
  return idx === -1 ? 9999 : idx + 1;
}

function applyMatchResult(winnerPid, loserPid, options = { disconnect: false }) {
  const winner = store.getPlayer(winnerPid);
  const loser = store.getPlayer(loserPid);
  if (!winner || !loser) return;

  winner.stats.matches += 1;
  loser.stats.matches += 1;
  winner.stats.wins += 1;
  loser.stats.losses += 1;

  winner.stats.winStreak += 1;
  winner.stats.bestWinStreak = Math.max(winner.stats.bestWinStreak, winner.stats.winStreak);
  loser.stats.winStreak = 0;

  const deltas = eloChange({ winnerRank: rankByElo(winner.id), loserRank: rankByElo(loser.id) });
  const bonus = streakBonus(winner.stats.winStreak);
  winner.stats.elo += deltas.winner + bonus;
  loser.stats.elo += deltas.loser;

  if (!options.disconnect && runtime.currentMatch) {
    for (const [pid, g] of Object.entries(runtime.currentMatch.goals)) {
      const p = store.getPlayer(pid);
      if (p) p.stats.goals += g;
    }
    for (const [pid, a] of Object.entries(runtime.currentMatch.assists)) {
      const p = store.getPlayer(pid);
      if (p) p.stats.assists += a;
    }
  }

  store.save();
}

function rotate(room, winnerTeam) {
  const players = room.getPlayerList().filter((p) => p.id !== 0);
  const winner = players.find((p) => p.team === winnerTeam);
  const loser = players.find((p) => p.team !== TEAM_SPEC && p.team !== winnerTeam);
  const wait = players.filter((p) => p.team === TEAM_SPEC);
  if (!winner) return;
  room.setPlayerTeam(winner.id, TEAM_RED);

  const challenger = wait[0] || loser;
  if (challenger) room.setPlayerTeam(challenger.id, TEAM_BLUE);
  if (loser && challenger && loser.id !== challenger.id) room.setPlayerTeam(loser.id, TEAM_SPEC);
}

function sendHelp(room, player) {
  announce(
    room,
    'Comandos: !help !afk !me !stats !top !wins !winstreak !discord/!ds !register !login <código>',
    player.id,
    config.style.botColor,
    'bold'
  );
}

function sendPlayerStats(room, requester, target) {
  if (!target.linked) {
    announce(room, 'Tus stats existen pero son privadas hasta vincular tu cuenta.', requester.id, config.style.warningColor, 'bold');
    return;
  }
  const s = target.stats;
  announce(room, `${target.displayName} | ELO ${s.elo} | PJ ${s.matches} | W ${s.wins} | L ${s.losses} | G ${s.goals} | A ${s.assists} | WS ${s.winStreak}`, requester.id, config.style.botColor, 'bold');
}

function handleCommand(room, player, raw) {
  const [cmd, ...args] = raw.trim().split(/\s+/);
  const lc = cmd.toLowerCase();
  const entity = ensurePlayerEntity(player);

  if (lc === '!help') return sendHelp(room, player);

  if (lc === '!afk') {
    if (runtime.afk.has(entity.id)) {
      runtime.afk.delete(entity.id);
      announce(room, `🟢 ${player.name} ya no está AFK.`, null, config.style.botColor, 'bold');
    } else {
      runtime.afk.add(entity.id);
      announce(room, `🟡 ${player.name} está AFK.`, null, config.style.afkColor, 'bold');
    }
    return;
  }

  if (lc === '!me' || lc === '!stats') return sendPlayerStats(room, player, entity);

  if (lc === '!top') {
    const top = store.getTopBy('elo', 10).map((p, i) => `${i + 1}. ${p.displayName} (${p.stats.elo})`).join(' | ') || 'Sin datos';
    announce(room, `🏆 TOP ELO: ${top}`, player.id, config.style.botColor, 'bold');
    return;
  }

  if (lc === '!wins') {
    const top = store.getTopBy('wins', 10).map((p, i) => `${i + 1}. ${p.displayName} (${p.stats.wins})`).join(' | ') || 'Sin datos';
    announce(room, `🥇 TOP WINS: ${top}`, player.id, config.style.botColor, 'bold');
    return;
  }

  if (lc === '!winstreak') {
    const top = store.getTopBy('bestWinStreak', 10).map((p, i) => `${i + 1}. ${p.displayName} (${p.stats.bestWinStreak})`).join(' | ') || 'Sin datos';
    announce(room, `🔥 TOP WS: ${top}`, player.id, config.style.botColor, 'bold');
    return;
  }

  if (lc === '!discord' || lc === '!ds') {
    announce(room, config.discord.inviteUrl || 'Discord no configurado.', player.id, config.style.botColor, 'bold');
    return;
  }

  if (lc === '!register') {
    const c = linkService.createFromHax(player.auth || `guest:${player.name}`, player.name);
    announce(room, `Código generado. Ejecuta en Discord: /login ${c}`, player.id, config.style.botColor, 'bold');
    return;
  }

  if (lc === '!login') {
    const c = (args[0] || '').toUpperCase();
    if (!c) {
      announce(room, 'Uso: !login ABCD1234', player.id, config.style.warningColor, 'bold');
      return;
    }
    const res = linkService.consumeInHax(c, player.auth || `guest:${player.name}`, player.name);
    announce(room, res.ok ? '✅ Cuenta vinculada correctamente.' : `❌ ${res.reason}`, player.id, res.ok ? config.style.botColor : config.style.warningColor, 'bold');
  }
}

HaxballJS.then(async (HBInit) => {
  const room = HBInit({
    roomName: config.room.name,
    maxPlayers: config.room.maxPlayers,
    public: config.room.public,
    noPlayer: true,
    token: process.env.HAXBALL_TOKEN || config.room.token,
    geo: config.room.geo
  });

  runtime.room = room;
  const stadium = fs.readFileSync(path.join(__dirname, 'stadium.hbs'), 'utf8');
  room.setCustomStadium(stadium);
  room.setScoreLimit(config.game.scoreLimit);
  room.setTimeLimit(config.game.timeLimit);

  room.onRoomLink = (link) => console.log('[ROOM LINK]', link);

  discord.setBridgeHandler((text) => announce(room, text, null, config.style.adminColor, 'bold'));
  await discord.start();

  room.onPlayerJoin = (player) => {
    const entity = ensurePlayerEntity(player);
    assignTeams(room);
    syncMatchMode(room);
    announce(room, `+ ${player.name} entró.`, null, config.style.botColor, 'bold');
    const message = entity.linked ? 'Cuenta vinculada detectada ✅' : 'Tu cuenta no está vinculada. Usa !register';
    announce(room, message, player.id, config.style.botColor, 'normal');
  };

  room.onPlayerLeave = (player) => {
    const leavingEntity = ensurePlayerEntity(player);
    if (runtime.currentMatch && runtime.currentMatch.counted) {
      const pids = runtime.currentMatch.pids;
      if (pids.includes(leavingEntity.id)) {
        const winnerPid = pids.find((id) => id !== leavingEntity.id);
        applyMatchResult(winnerPid, leavingEntity.id, { disconnect: true });
        announce(room, `⚠️ ${player.name} se desconectó: cuenta como derrota.`, null, config.style.warningColor, 'bold');
      }
    }
    runtime.afk.delete(leavingEntity.id);
    assignTeams(room);
    syncMatchMode(room);
  };

  room.onPlayerBallKick = (player) => {
    const entity = ensurePlayerEntity(player);
    runtime.touchLog.push({ pid: entity.id, at: Date.now() });
    if (runtime.touchLog.length > 8) runtime.touchLog.shift();
  };

  room.onTeamGoal = (team) => registerGoal(team);

  room.onGameStart = () => {
    const actives = activePlayers(room);
    runtime.touchLog = [];

    if (actives.length === 2) {
      const a = ensurePlayerEntity(actives[0]);
      const b = ensurePlayerEntity(actives[1]);
      runtime.currentMatch = {
        counted: true,
        pids: [a.id, b.id],
        goals: {},
        assists: {}
      };
    } else {
      runtime.currentMatch = null;
    }
  };

  room.onGameStop = () => {
    const scores = room.getScores();
    if (runtime.currentMatch && scores) {
      const players = activePlayers(room);
      if (players.length === 2) {
        const red = ensurePlayerEntity(players.find((p) => p.team === TEAM_RED));
        const blue = ensurePlayerEntity(players.find((p) => p.team === TEAM_BLUE));
        if (red && blue) {
          const winnerPid = scores.red > scores.blue ? red.id : blue.id;
          const loserPid = winnerPid === red.id ? blue.id : red.id;
          applyMatchResult(winnerPid, loserPid, { disconnect: false });
          rotate(room, scores.red > scores.blue ? TEAM_RED : TEAM_BLUE);
        }
      }
    }
    runtime.currentMatch = null;
    assignTeams(room);
    syncMatchMode(room);
  };

  room.onPlayerChat = (player, message) => {
    const entity = ensurePlayerEntity(player);
    if (message.startsWith('!')) {
      handleCommand(room, player, message);
      return false;
    }

    const prefix = prefixFor(entity);
    const color = adminByPlayer(player) ? config.style.adminColor : config.style.defaultColor;
    announce(room, `${prefix} ${player.name}: ${message}`, null, color, 'normal');
    return false;
  };

  setInterval(() => {
    store.save();
  }, config.storage.autosaveMs);

  console.log('Host 1v1 + Discord iniciado.');
}).catch((error) => {
  console.error('No se pudo iniciar HaxBall:', error);
});
