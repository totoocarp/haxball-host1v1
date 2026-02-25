const fs = require('fs');
const path = require('path');
const HaxballJS = require('haxball.js');
const { loadConfig, CONFIG_FILE } = require('./src/config');
const { DataStore } = require('./src/dataStore');

const STADIUM_FILE = path.join(__dirname, 'stadium.hbs');

const config = loadConfig();
const store = new DataStore(config.features.baseElo);
store.load();

const runtime = {
  queue: [],
  afk: new Map(),
  reconnectMap: new Map(),
  commandCooldown: new Map(),
  muteSet: new Set(),
  pingInfo: new Map(),
  nameChangeLog: new Map(),
  touchWindow: { active: false, team: null, at: 0, playerId: null },
  ball: { lastPos: null, lastMoveAt: Date.now() },
  maintenanceReason: '',
  lastKickerId: null,
  secondKickerId: null,
  autoSaveTimer: null,
  watchdogTimer: null
};

const TEAM_SPEC = 0;
const TEAM_RED = 1;
const TEAM_BLUE = 2;
const OWNER_NAME = 'toto';

const now = () => Date.now();
const playerKey = (player) => player?.auth || player?.conn || player?.name;
const isAdmin = (player) => store.data.admins.includes(playerKey(player));
const topColor = (index) => (index === 0 ? 0xff00ff : index < 10 ? 0x00ffd0 : 0xffffff);

function safeRoomAction(room, fn, label = 'room action') {
  try {
    return fn();
  } catch (error) {
    console.error(`[SAFE] ${label} failed:`, error.message);
    room.sendAnnouncement(`⚠️ Error interno en ${label}.`, null, 0xff3333, 'bold');
    return null;
  }
}

function getSeasonStats(playerStats) {
  const seasonId = store.data.season?.id || 'S1';
  if (!playerStats.seasons[seasonId]) {
    playerStats.seasons[seasonId] = { wins: 0, matches: 0, losses: 0, streak: 0, bestStreak: 0 };
  }
  return playerStats.seasons[seasonId];
}

function eloDelta(a, b, resultA) {
  const expectedA = 1 / (1 + 10 ** ((b - a) / 400));
  return Math.round(config.game.eloK * (resultA - expectedA));
}

function cosmeticPrefix(key) {
  if (store.data.admins.includes(key)) return '👑ADMIN';
  const winsRanking = Object.entries(store.data.players)
    .sort(([, a], [, b]) => (b.wins || 0) - (a.wins || 0))
    .map(([k]) => k);
  const idx = winsRanking.indexOf(key);
  if (idx === 0) return '🥇TOP1';
  if (idx > -1 && idx < 10) return '🏅TOP10';
  return '🎮';
}

function sendProfile(room, player, targetStats) {
  const wr = targetStats.matches > 0 ? ((targetStats.wins / targetStats.matches) * 100).toFixed(1) : '0.0';
  room.sendAnnouncement(
    `${targetStats.name} | ELO ${targetStats.elo} | WR ${wr}% | Wins ${targetStats.wins} | Racha ${targetStats.currentStreak} | Mejor racha ${targetStats.bestStreak}`,
    player.id,
    0x7bdff2,
    'bold'
  );
}

function parseTarget(room, argument) {
  if (!argument) return null;
  const byId = Number(argument);
  const players = room.getPlayerList().filter((p) => p.id !== 0);
  if (!Number.isNaN(byId)) return players.find((p) => p.id === byId) || null;
  return players.find((p) => p.name.toLowerCase() === argument.toLowerCase()) || null;
}

function robustBalance(room) {
  const players = room.getPlayerList().filter((p) => p.id !== 0);
  const reds = players.filter((p) => p.team === TEAM_RED);
  const blues = players.filter((p) => p.team === TEAM_BLUE);
  const specs = players.filter((p) => p.team === TEAM_SPEC);

  for (const player of specs) {
    const redCount = room.getPlayerList().filter((p) => p.team === TEAM_RED).length;
    const blueCount = room.getPlayerList().filter((p) => p.team === TEAM_BLUE).length;
    if (redCount < config.game.maxTeamSize || blueCount < config.game.maxTeamSize) {
      const team = redCount <= blueCount ? TEAM_RED : TEAM_BLUE;
      room.setPlayerTeam(player.id, team);
      runtime.queue = runtime.queue.filter((id) => id !== player.id);
    }
  }

  const updated = room.getPlayerList();
  if (updated.filter((p) => p.team === TEAM_RED).length > config.game.maxTeamSize) {
    room.setPlayerTeam(updated.find((p) => p.team === TEAM_RED).id, TEAM_SPEC);
  }
  if (updated.filter((p) => p.team === TEAM_BLUE).length > config.game.maxTeamSize) {
    room.setPlayerTeam(updated.find((p) => p.team === TEAM_BLUE).id, TEAM_SPEC);
  }

  const scores = room.getScores();
  const enoughPlayers =
    room.getPlayerList().filter((p) => p.team === TEAM_RED).length === config.game.maxTeamSize &&
    room.getPlayerList().filter((p) => p.team === TEAM_BLUE).length === config.game.maxTeamSize;

  if (!scores && enoughPlayers) {
    setTimeout(() => {
      if (!room.getScores()) room.startGame();
    }, 400);
  }

  if (scores && !enoughPlayers) {
    room.stopGame();
    room.sendAnnouncement('⏹ Partido pausado por falta de jugadores.', null, 0xff4444, 'bold');
  }
}

function rotateAfterVictory(room, winnerTeam) {
  const players = room.getPlayerList().filter((p) => p.id !== 0);
  const winner = players.find((p) => p.team === winnerTeam);
  const loser = players.find((p) => p.team !== winnerTeam && p.team !== TEAM_SPEC);
  const waiting = players.filter((p) => p.team === TEAM_SPEC);
  if (!winner) return robustBalance(room);

  room.setPlayerTeam(winner.id, TEAM_RED);
  const nextPlayer = waiting[0] || loser;
  if (nextPlayer) room.setPlayerTeam(nextPlayer.id, TEAM_BLUE);
  if (loser && nextPlayer && loser.id !== nextPlayer.id) room.setPlayerTeam(loser.id, TEAM_SPEC);

  for (const spec of waiting.slice(1)) {
    room.setPlayerTeam(spec.id, TEAM_SPEC);
  }

  setTimeout(() => {
    if (!room.getScores()) robustBalance(room);
  }, 500);
}

HaxballJS.then((HBInit) => {
  const room = HBInit({
    roomName: config.room.name,
    maxPlayers: config.room.maxPlayers,
    public: config.room.public,
    noPlayer: true,
    token: process.env.HAXBALL_TOKEN || config.room.token,
    geo: config.room.geo
  });

  const stadium = fs.readFileSync(STADIUM_FILE, 'utf8');
  room.setCustomStadium(stadium);
  room.setScoreLimit(config.game.scoreLimit);
  room.setTimeLimit(config.game.timeLimit);

  room.onRoomLink = (link) => console.log('[ROOM]', link);

  const commandHandlers = {
    help: ({ player }) => {
      room.sendAnnouncement(
        '📘 Públicos: !stats !rank !elo !top !racha !afk !ping !historial !perfil !wins !goles !asistencias !discord\n🔒 Admin: !forcestart !forceend !setwins !resetstats !mute !unmute !clearchat !setelo !reloadconfig !restart !ban !unban !modo !season',
        player.id,
        0xffffff,
        'bold'
      );
    },
    stats: ({ player }) => sendProfile(room, player, store.data.players[playerKey(player)]),
    perfil: ({ player, args }) => {
      const target = parseTarget(room, args[0]) || player;
      sendProfile(room, player, store.data.players[playerKey(target)]);
    },
    wins: ({ player }) => commandHandlers.top({ player }),
    top: ({ player }) => {
      const rows = Object.values(store.data.players)
        .filter((p) => (p.wins || 0) > 0)
        .sort((a, b) => b.wins - a.wins)
        .slice(0, 10)
        .map((p, i) => `${i + 1}. ${p.name}: ${p.wins}`)
        .join('\n');
      room.sendAnnouncement(`🏆 Top Wins\n${rows || 'Sin datos'}`, player.id, 0xffd700, 'bold');
    },
    goles: ({ player }) => {
      const rows = Object.values(store.data.players)
        .filter((p) => (p.goles || 0) > 0)
        .sort((a, b) => b.goles - a.goles)
        .slice(0, 10)
        .map((p, i) => `${i + 1}. ${p.name}: ${p.goles}`)
        .join('\n');
      room.sendAnnouncement(`⚽ Top Goles\n${rows || 'Sin datos'}`, player.id, 0xff763d, 'bold');
    },
    asistencias: ({ player }) => {
      const rows = Object.values(store.data.players)
        .filter((p) => (p.asistencias || 0) > 0)
        .sort((a, b) => b.asistencias - a.asistencias)
        .slice(0, 10)
        .map((p, i) => `${i + 1}. ${p.name}: ${p.asistencias}`)
        .join('\n');
      room.sendAnnouncement(`🎯 Top Asistencias\n${rows || 'Sin datos'}`, player.id, 0x9cff9c, 'bold');
    },
    rank: ({ player }) => {
      const key = playerKey(player);
      const ranking = Object.entries(store.data.players)
        .sort(([, a], [, b]) => b.elo - a.elo)
        .map(([k]) => k);
      room.sendAnnouncement(`📊 Tu rank ELO: #${ranking.indexOf(key) + 1}`, player.id, 0x7bdff2, 'bold');
    },
    elo: ({ player }) => room.sendAnnouncement(`⭐ ELO actual: ${store.data.players[playerKey(player)].elo}`, player.id, 0x7bdff2, 'bold'),
    racha: ({ player }) => {
      const p = store.data.players[playerKey(player)];
      room.sendAnnouncement(`🔥 Racha actual: ${p.currentStreak} | Mejor racha: ${p.bestStreak}`, player.id, 0xff6b6b, 'bold');
    },
    afk: ({ player }) => {
      if (!room.getScores() || player.team === TEAM_SPEC) {
        room.sendAnnouncement('🕒 AFK se mide solo durante un partido activo.', player.id, 0xd3d3d3, 'bold');
        return;
      }
      const info = runtime.afk.get(player.id);
      const secs = info ? Math.max(0, Math.floor((now() - info.lastMoveAt) / 1000)) : 0;
      room.sendAnnouncement(`🕒 AFK: ${secs}s`, player.id, 0xd3d3d3, 'bold');
    },
    ping: ({ player }) => {
      const ping = room.getPlayer(player.id)?.ping || 0;
      room.sendAnnouncement(`📡 Ping: ${ping}ms`, player.id, ping > config.game.lagPingThreshold ? 0xff9f1c : 0x2ec4b6, 'bold');
    },
    historial: ({ player }) => {
      const p = store.data.players[playerKey(player)];
      const season = getSeasonStats(p);
      room.sendAnnouncement(`📚 Temp ${store.data.season.id}: ${season.wins}W/${season.losses}L (${season.matches} PJ)`, player.id, 0xbde0fe, 'bold');
    },
    discord: ({ player }) => room.sendAnnouncement(`Discord: ${config.links.discord}`, player.id, 0x7289da, 'bold'),
    forcestart: ({ player }) => {
      if (!isAdmin(player)) return room.sendAnnouncement('Solo admin.', player.id, 0xff3333, 'bold');
      robustBalance(room);
      if (!room.getScores()) room.startGame();
    },
    forceend: ({ player }) => {
      if (!isAdmin(player)) return room.sendAnnouncement('Solo admin.', player.id, 0xff3333, 'bold');
      if (room.getScores()) room.stopGame();
    },
    setwins: ({ player, args }) => {
      if (!isAdmin(player)) return;
      const target = parseTarget(room, args[0]);
      const value = Number(args[1]);
      if (!target || Number.isNaN(value) || value < 0) return room.sendAnnouncement('Uso: !setwins <id|name> <n>', player.id, 0xff3333, 'bold');
      store.data.players[playerKey(target)].wins = value;
      store.save();
    },
    resetstats: ({ player, args }) => {
      if (!isAdmin(player)) return;
      const target = parseTarget(room, args[0]);
      if (!target) return;
      const p = store.data.players[playerKey(target)];
      Object.assign(p, { goles: 0, asistencias: 0, wins: 0, matches: 0, losses: 0, draws: 0, currentStreak: 0, bestStreak: 0, elo: config.features.baseElo });
      store.save();
    },
    mute: ({ player, args }) => {
      if (!isAdmin(player)) return;
      const target = parseTarget(room, args[0]);
      if (!target) return;
      runtime.muteSet.add(playerKey(target));
      room.sendAnnouncement(`🔇 ${target.name} silenciado`, null, 0xffcc00, 'bold');
    },
    unmute: ({ player, args }) => {
      if (!isAdmin(player)) return;
      const target = parseTarget(room, args[0]);
      if (!target) return;
      runtime.muteSet.delete(playerKey(target));
      room.sendAnnouncement(`🔊 ${target.name} habilitado`, null, 0x44dd88, 'bold');
    },
    clearchat: ({ player }) => {
      if (!isAdmin(player)) return;
      for (let i = 0; i < 18; i += 1) room.sendAnnouncement(' ', null, 0xffffff, 'normal');
    },
    setelo: ({ player, args }) => {
      if (!isAdmin(player)) return;
      const target = parseTarget(room, args[0]);
      const value = Number(args[1]);
      if (!target || Number.isNaN(value)) return;
      store.data.players[playerKey(target)].elo = value;
      store.save();
    },
    reloadconfig: ({ player }) => {
      if (!isAdmin(player)) return;
      Object.assign(config, loadConfig());
      room.sendAnnouncement('♻️ Config recargada.', null, 0x9bf6ff, 'bold');
    },
    restart: ({ player }) => {
      if (!isAdmin(player)) return;
      if (room.getScores()) room.stopGame();
      robustBalance(room);
      room.sendAnnouncement('🔁 Reinicio operativo completado.', null, 0x9bf6ff, 'bold');
    },
    ban: ({ player, args }) => {
      if (!isAdmin(player)) return;
      const target = parseTarget(room, args[0]);
      if (!target) return;
      const key = playerKey(target);
      store.data.bans[key] = { reason: args.slice(1).join(' ') || 'Sin razón', by: player.name, at: now() };
      store.save();
      room.kickPlayer(target.id, `Baneado: ${store.data.bans[key].reason}`, true);
    },
    unban: ({ player, args }) => {
      if (!isAdmin(player)) return;
      const targetKey = args.join(' ');
      if (!targetKey || !store.data.bans[targetKey]) return;
      delete store.data.bans[targetKey];
      store.save();
      room.sendAnnouncement(`✅ Unban: ${targetKey}`, player.id, 0x66ff99, 'bold');
    },
    modo: ({ player, args }) => {
      if (!isAdmin(player)) return;
      const mode = (args[0] || '').toLowerCase();
      if (mode === 'mantenimiento') {
        config.features.maintenanceMode = true;
        runtime.maintenanceReason = args.slice(1).join(' ') || 'Mantenimiento';
      } else if (mode === 'normal') {
        config.features.maintenanceMode = false;
        runtime.maintenanceReason = '';
      }
      room.sendAnnouncement(`🛠 Modo: ${config.features.maintenanceMode ? 'mantenimiento' : 'normal'}`, null, 0xffafcc, 'bold');
    },
    season: ({ player, args }) => {
      if (!isAdmin(player)) return;
      const nextId = args[0] || `S${Number((store.data.season?.id || 'S1').slice(1)) + 1}`;
      store.data.season = { id: nextId, startedAt: now() };
      store.save();
      room.sendAnnouncement(`📅 Nueva temporada: ${nextId}`, null, 0xcaffbf, 'bold');
    }
  };

  room.onPlayerJoin = (player) => safeRoomAction(room, () => {
    const key = playerKey(player);
    if (!key) return room.kickPlayer(player.id, 'No se pudo validar identidad.', false);
    if (config.features.maintenanceMode && !isAdmin(player)) {
      room.kickPlayer(player.id, `Sala en mantenimiento: ${runtime.maintenanceReason || 'intenta luego'}`, false);
      return;
    }
    if (store.data.bans[key]) {
      room.kickPlayer(player.id, `Baneado: ${store.data.bans[key].reason}`, false);
      return;
    }

    store.ensurePlayer(key, player.name);
    if (player.name.toLowerCase() === OWNER_NAME) {
      if (!store.data.admins.includes(key)) store.data.admins.push(key);
      if (!store.data.admins.includes(OWNER_NAME)) store.data.admins.push(OWNER_NAME);
      store.save();
    }
    if (isAdmin(player)) room.setPlayerAdmin(player.id, true);

    runtime.afk.set(player.id, { lastMoveAt: now(), warned: false });
    runtime.pingInfo.set(player.id, { warnCount: 0, kickCount: 0 });
    runtime.reconnectMap.set(key, { joinedAt: now(), id: player.id });

    const prefix = cosmeticPrefix(key);
    const rankColor = topColor(Object.entries(store.data.players).sort(([, a], [, b]) => b.wins - a.wins).findIndex(([k]) => k === key));
    room.sendAnnouncement(`${prefix} ${player.name} entró a la sala.`, null, rankColor, 'bold');

    robustBalance(room);
  }, 'onPlayerJoin');

  room.onPlayerLeave = (player) => safeRoomAction(room, () => {
    runtime.afk.delete(player.id);
    runtime.pingInfo.delete(player.id);
    runtime.commandCooldown.delete(player.id);
    runtime.queue = runtime.queue.filter((id) => id !== player.id);
    robustBalance(room);
  }, 'onPlayerLeave');

  room.onPlayerAdminChange = (player) => {
    if (!player.admin) return;
    const key = playerKey(player);
    if (!store.data.admins.includes(key)) {
      store.data.admins.push(key);
      store.save();
    }
  };

  room.onPlayerActivity = (player) => {
    const info = runtime.afk.get(player.id);
    if (!info) return;
    info.lastMoveAt = now();
    info.warned = false;
  };

  room.onPlayerBallKick = (player) => {
    const scores = room.getScores();
    if (runtime.touchWindow.active && now() - runtime.touchWindow.at < config.game.doubleTouchWindowMs) {
      if (runtime.touchWindow.team === player.team && runtime.touchWindow.playerId !== player.id) {
        room.sendAnnouncement(`🚫 Doble toque inicial no permitido (${player.name}).`, null, 0xff4d6d, 'bold');
      }
    }
    runtime.secondKickerId = runtime.lastKickerId;
    runtime.lastKickerId = player.id;
    if (scores && scores.time <= 2) {
      runtime.touchWindow = { active: true, team: player.team, at: now(), playerId: player.id };
    }
  };

  room.onTeamGoal = () => {
    const scorer = room.getPlayer(runtime.lastKickerId);
    if (!scorer) return;
    const scorerStats = store.data.players[playerKey(scorer)];
    scorerStats.goles += 1;

    const assister = room.getPlayer(runtime.secondKickerId);
    if (assister && assister.team === scorer.team && assister.id !== scorer.id) {
      store.data.players[playerKey(assister)].asistencias += 1;
    }

    runtime.touchWindow.active = false;
    store.save();
  };

  room.onTeamVictory = (scores) => safeRoomAction(room, () => {
    const winner = scores.red > scores.blue ? TEAM_RED : TEAM_BLUE;
    const red = room.getPlayerList().find((p) => p.team === TEAM_RED);
    const blue = room.getPlayerList().find((p) => p.team === TEAM_BLUE);

    [red, blue].filter(Boolean).forEach((p) => {
      const stats = store.data.players[playerKey(p)];
      stats.matches += 1;
      const season = getSeasonStats(stats);
      season.matches += 1;

      if (p.team === winner) {
        stats.wins += 1;
        stats.currentStreak += 1;
        stats.bestStreak = Math.max(stats.bestStreak, stats.currentStreak);
        season.wins += 1;
        season.streak += 1;
        season.bestStreak = Math.max(season.bestStreak, season.streak);
      } else {
        stats.losses += 1;
        stats.currentStreak = 0;
        season.losses += 1;
        season.streak = 0;
      }
    });

    if (config.features.enableElo && red && blue) {
      const redStats = store.data.players[playerKey(red)];
      const blueStats = store.data.players[playerKey(blue)];
      const redRes = winner === TEAM_RED ? 1 : 0;
      const delta = eloDelta(redStats.elo, blueStats.elo, redRes);
      redStats.elo += delta;
      blueStats.elo -= delta;
    }

    store.save();
    rotateAfterVictory(room, winner);
  }, 'onTeamVictory');

  room.onGameStart = () => {
    runtime.touchWindow.active = false;
    runtime.ball.lastPos = null;
    runtime.ball.lastMoveAt = now();
    room.getPlayerList().forEach((p) => {
      const afk = runtime.afk.get(p.id);
      if (afk) {
        afk.lastMoveAt = now();
        afk.warned = false;
      }
    });
  };

  room.onPlayerChat = (player, message) => {
    if (typeof message !== 'string') return false;
    if (message.length > config.security.maxChatLength) {
      room.sendAnnouncement('⚠️ Mensaje demasiado largo.', player.id, 0xff6b6b, 'bold');
      return false;
    }

    const key = playerKey(player);
    store.ensurePlayer(key, player.name);

    if (message === store.data.secret) {
      if (!store.data.admins.includes(key)) {
        store.data.admins.push(key);
        store.save();
      }
      room.setPlayerAdmin(player.id, true);
      room.sendAnnouncement('👑 Admin otorgado.', player.id, 0x98f5e1, 'bold');
      return false;
    }

    if (runtime.muteSet.has(key) && !isAdmin(player)) {
      room.sendAnnouncement('🔇 Estás muteado.', player.id, 0xffcc00, 'bold');
      return false;
    }

    if (!message.startsWith('!')) return true;

    const cooldown = runtime.commandCooldown.get(player.id) || 0;
    if (now() - cooldown < config.game.commandCooldownMs) return false;
    runtime.commandCooldown.set(player.id, now());

    const [commandRaw, ...args] = message.slice(1).trim().split(/\s+/);
    const command = commandRaw?.toLowerCase();
    const handler = commandHandlers[command];
    if (!handler) {
      room.sendAnnouncement('Comando no reconocido. Usa !help', player.id, 0xffadad, 'bold');
      return false;
    }

    safeRoomAction(room, () => handler({ player, args }), `command:${command}`);
    return false;
  };

  runtime.autoSaveTimer = setInterval(() => {
    safeRoomAction(room, () => store.save(), 'autosave');
  }, config.game.autoSaveIntervalMs);

  runtime.watchdogTimer = setInterval(() => {
    const scores = room.getScores();
    const players = room.getPlayerList().filter((p) => p.id !== 0);

    if (players.length === 0 && scores) {
      room.stopGame();
      return;
    }

    robustBalance(room);

    if (scores) {
      for (const player of players.filter((p) => p.team !== TEAM_SPEC)) {
        const afk = runtime.afk.get(player.id);
        if (!afk) continue;
        const idle = Math.floor((now() - afk.lastMoveAt) / 1000);
        if (idle >= config.game.afkWarnSeconds && !afk.warned) {
          room.sendAnnouncement(`⚠️ ${player.name} AFK (${idle}s).`, player.id, 0xff9f1c, 'bold');
          afk.warned = true;
        }
        if (idle >= config.game.afkKickSeconds) {
          room.kickPlayer(player.id, `AFK > ${config.game.afkKickSeconds}s`, false);
        }
      }
    }

    for (const player of players) {
      const ping = room.getPlayer(player.id)?.ping || 0;
      const pingState = runtime.pingInfo.get(player.id);
      if (!pingState) continue;
      if (ping >= config.game.lagPingThreshold) pingState.warnCount += 1;
      if (ping >= config.game.lagKickThreshold) pingState.kickCount += 1;

      if (pingState.warnCount === config.game.lagWarnCount) {
        room.sendAnnouncement(`📶 ${player.name}, tu ping es alto (${ping}ms).`, player.id, 0xffbe0b, 'bold');
      }
      if (pingState.kickCount >= config.game.lagKickCount) {
        room.kickPlayer(player.id, `Lag extremo (${ping}ms)`, false);
      }
    }

    if (!scores) return;
    const ballPos = room.getBallPosition?.();
    if (!ballPos) return;

    if (!runtime.ball.lastPos) {
      runtime.ball.lastPos = ballPos;
      runtime.ball.lastMoveAt = now();
      return;
    }

    const moved = Math.hypot(ballPos.x - runtime.ball.lastPos.x, ballPos.y - runtime.ball.lastPos.y) > 0.6;
    if (moved) {
      runtime.ball.lastMoveAt = now();
      runtime.ball.lastPos = ballPos;
      return;
    }

    const stillFor = Math.floor((now() - runtime.ball.lastMoveAt) / 1000);
    if (stillFor >= config.game.freezeSeconds) {
      room.sendAnnouncement('🛡 Watchdog: pelota freezeada, reiniciando partido.', null, 0xff595e, 'bold');
      room.stopGame();
      setTimeout(() => robustBalance(room), 500);
      runtime.ball.lastMoveAt = now();
    }

    if (scores.time >= config.game.inactivityRestartSeconds && stillFor >= 10) {
      room.sendAnnouncement('🛡 Watchdog: inactividad detectada, reinicio de round.', null, 0xff595e, 'bold');
      room.stopGame();
      setTimeout(() => robustBalance(room), 500);
      runtime.ball.lastMoveAt = now();
    }
  }, config.game.watchdogIntervalMs);

  process.on('uncaughtException', (error) => {
    console.error('[FATAL] uncaughtException:', error);
    safeRoomAction(room, () => room.sendAnnouncement('⚠️ Error crítico capturado, host sigue activo.', null, 0xff3333, 'bold'), 'uncaughtException announce');
  });

  process.on('unhandledRejection', (error) => {
    console.error('[FATAL] unhandledRejection:', error);
  });

  process.on('SIGINT', () => {
    clearInterval(runtime.autoSaveTimer);
    clearInterval(runtime.watchdogTimer);
    store.save();
    process.exit(0);
  });

  console.log(`[BOOT] Config cargada desde ${CONFIG_FILE}`);
  console.log(`[BOOT] Data cargada. Temporada actual: ${store.data.season.id}`);
}).catch((error) => {
  console.error('[BOOT] No se pudo iniciar Haxball:', error);
  process.exit(1);
});
