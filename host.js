const HaxballJS = require("haxball.js");
const fs = require("fs");
const path = require("path");

const DATA_FILE = path.join(__dirname, "data.json");
const STADIUM_FILE = path.join(__dirname, "stadium.hbs");
const MAX_TEAM_SIZE = 1; // 1v1
const DISCORD_LINK = "no tengo el link todavia xD (att.: toto.)";

let data = {
  players: {},
  admins: [],
  secret: null
};

function loadData() {
  if (fs.existsSync(DATA_FILE)) {
    data = JSON.parse(fs.readFileSync(DATA_FILE));
  } else {
    saveData();
  }
}

function saveData() {
  fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
}

function getPlayerKey(player) {
  return player.auth || player.name; 
}

loadData();

if (!data.secret) {
  data.secret = "!iam_" + Math.random().toString(36).slice(2, 12);
  saveData();
  console.log("Comando secreto admin:", data.secret);
}

HaxballJS.then(HBInit => {

  const room = HBInit({
    roomName: "🐔 1v1 Gana Sigue | !stats, !help, !goles 🐔",
    maxPlayers: 15,
    public: true,
    noPlayer: true,
    token: "thr1.AAAAAGmeEShZcFkGwlp23A.JyPkMTJAkNc" // Tu token
  });

  const stadium = fs.readFileSync(STADIUM_FILE, "utf8");
  room.setCustomStadium(stadium);

  room.setScoreLimit(5);
  room.setTimeLimit(0);

  room.onRoomLink = link => {
    console.log("\nSALA ONLINE:");
    console.log(link);
  };

  function ensurePlayer(player) {
    const key = getPlayerKey(player);
    if (!key) return;

    if (!data.players[key]) {
      data.players[key] = {
        name: player.name,
        goles: 0,
        asistencias: 0,
        wins: 0,
        matches: 0
      };
      saveData();
    }
  }

  function isAdmin(player) {
    return data.admins.includes(getPlayerKey(player));
  }

  function addAdmin(player) {
    const key = getPlayerKey(player);
    if (!data.admins.includes(key)) {
      data.admins.push(key);
      saveData();
    }
  }

  function balanceTeams() {
    const players = room.getPlayerList().filter(p => p.id !== 0);
    const specs = players.filter(p => p.team === 0);
    const scores = room.getScores();

    if (specs.length > 0) {
      specs.forEach(p => {
        const currentRed = room.getPlayerList().filter(x => x.team === 1).length;
        const currentBlue = room.getPlayerList().filter(x => x.team === 2).length;

        if (currentRed < MAX_TEAM_SIZE || currentBlue < MAX_TEAM_SIZE) {
          if (currentRed <= currentBlue && currentRed < MAX_TEAM_SIZE) {
            room.setPlayerTeam(p.id, 1);
          } else if (currentBlue < MAX_TEAM_SIZE) {
            room.setPlayerTeam(p.id, 2);
          }
        }
      });
    }

    const updatedRed = room.getPlayerList().filter(p => p.team === 1);
    const updatedBlue = room.getPlayerList().filter(p => p.team === 2);
    const updatedSpecs = room.getPlayerList().filter(p => p.team === 0);

    // CORRECCIÓN: Agregado un setTimeout para asegurar que el server registre el cambio de equipo antes de arrancar
    if (!scores && updatedRed.length >= 1 && updatedBlue.length >= 1) {
      setTimeout(() => {
        if (!room.getScores()) room.startGame();
      }, 500);
      return; 
    }

    if (scores && (updatedRed.length + updatedBlue.length <= 1)) {
      room.stopGame();
      room.sendAnnouncement("El partido se frenó porque no hay suficientes jugadores.", null, 0xFF4444, "bold");
      return;
    }

    if (updatedSpecs.length === 0) {
      if (updatedRed.length - updatedBlue.length > 1) {
        const playerToMove = updatedRed[updatedRed.length - 1]; 
        room.setPlayerTeam(playerToMove.id, 2);
        room.sendAnnouncement(`♻️ ${playerToMove.name} fue pasado al Azul para balancear los equipos.`, null, 0x00FFFF, "bold");
      } else if (updatedBlue.length - updatedRed.length > 1) {
        const playerToMove = updatedBlue[updatedBlue.length - 1];
        room.setPlayerTeam(playerToMove.id, 1);
        room.sendAnnouncement(`♻️ ${playerToMove.name} fue pasado al Rojo para balancear los equipos.`, null, 0x00FFFF, "bold");
      }
    }
  }

  function autoTeams(winnerTeam) {
    const players = room.getPlayerList().filter(p => p.id !== 0);
    const red = players.filter(p => p.team === 1);
    const blue = players.filter(p => p.team === 2);
    const specs = players.filter(p => p.team === 0);

    if (!winnerTeam) {
      balanceTeams();
      return;
    }

    let winners = winnerTeam === 1 ? red : blue;
    let losers = winnerTeam === 1 ? blue : red;

    winners.forEach(p => { if (p.team !== 1) room.setPlayerTeam(p.id, 1); });

    let queue = [...specs, ...losers];
    let newBlue = queue.slice(0, MAX_TEAM_SIZE);
    let newSpecs = queue.slice(MAX_TEAM_SIZE);

    newBlue.forEach(p => { if (p.team !== 2) room.setPlayerTeam(p.id, 2); });
    newSpecs.forEach(p => { if (p.team !== 0) room.setPlayerTeam(p.id, 0); });

    setTimeout(() => {
      if (!room.getScores()) {
        const currentRed = room.getPlayerList().filter(p => p.team === 1);
        const currentBlue = room.getPlayerList().filter(p => p.team === 2);
        if (currentRed.length >= 1 && currentBlue.length >= 1) {
          room.startGame();
        }
      }
    }, 1000);
  }

  let lastKicker = null;
  let secondKicker = null;
  let afkData = {};

  room.onPlayerJoin = player => {
    if (!getPlayerKey(player)) {
      room.kickPlayer(player.id, "Error de conexión.", false);
      return;
    }

    ensurePlayer(player);

    if (isAdmin(player)) {
      room.setPlayerAdmin(player.id, true);
    }

    afkData[player.id] = {
      lastMove: Date.now(),
      warned: false
    };

    // MARCA DE AGUA OFUSCADA
    const _0x12a = String.fromCharCode(83, 99, 114, 105, 112, 116, 32, 100, 101, 32, 104, 111, 115, 116, 32, 104, 101, 99, 104, 111, 32, 112, 111, 114, 58, 32, 64, 116, 111, 116, 111, 111, 99, 97, 114, 112, 32, 40, 68, 105, 115, 99, 111, 114, 100, 41, 44, 32, 116, 111, 116, 111, 32, 40, 104, 97, 120, 41);
    room.sendAnnouncement(_0x12a, player.id, 0x00FF00, "italic", 2);

    balanceTeams(); 
  };

  room.onPlayerLeave = player => {
    delete afkData[player.id];
    balanceTeams();
  };

  room.onPlayerActivity = player => {
    if (!afkData[player.id]) return;
    afkData[player.id].lastMove = Date.now();
    afkData[player.id].warned = false;
  };

  room.onGameStart = () => {
    const now = Date.now();
    room.getPlayerList().forEach(p => {
      if (afkData[p.id]) {
        afkData[p.id].lastMove = now;
        afkData[p.id].warned = false;
      }
    });
  };

  room.onPlayerAdminChange = player => {
    if (player.admin) addAdmin(player);
  };

  room.onPlayerBallKick = player => {
    secondKicker = lastKicker;
    lastKicker = player;
  };

  room.onTeamGoal = () => {
    if (!lastKicker) return;

    const key = getPlayerKey(lastKicker);
    if (!key || !data.players[key]) return;

    data.players[key].goles++;

    if (secondKicker) {
      const assistKey = getPlayerKey(secondKicker);
      if (assistKey && assistKey !== key && data.players[assistKey]) {
        data.players[assistKey].asistencias++;
      }
    }

    saveData();
    lastKicker = null; 
    secondKicker = null;
  };

  room.onTeamVictory = scores => {
    const winner = scores.red > scores.blue ? 1 : 2;

    room.getPlayerList().forEach(p => {
      const key = getPlayerKey(p);
      if (!key || !data.players[key]) return;

      if (p.team === 1 || p.team === 2) {
        data.players[key].matches++;
        if (p.team === winner) {
          data.players[key].wins++;
        }
      }
    });

    saveData();
    autoTeams(winner); 
  };

  function showTop(player, stat, emoji, color) {
    const sorted = Object.values(data.players)
      .filter(p => p[stat] > 0)
      .sort((a, b) => b[stat] - a[stat])
      .slice(0, 10);

    if (sorted.length === 0) {
      room.sendAnnouncement(`${emoji} No hay datos todavía.`, player.id, color, "bold");
      return;
    }

    let text = sorted.map((pl, i) => `${i + 1}. ${pl.name} - ${pl[stat]}`).join("\n");

    room.sendAnnouncement(`${emoji} TOP 10 ${stat.toUpperCase()} ${emoji}\n\n${text}`, player.id, color, "bold");
  }

  room.onPlayerChat = (player, msg) => {
    ensurePlayer(player);

    if (msg === data.secret) {
      room.setPlayerAdmin(player.id, true);
      addAdmin(player);
      room.sendAnnouncement("ADMIN OTORGADO", player.id, 0x00FF00, "bold");
      return false;
    }

    if (!msg.startsWith("!")) return true;

    const cmd = msg.slice(1).toLowerCase();

    if (cmd === "help") {
      room.sendAnnouncement(`📋 COMANDOS DISPONIBLES:\n!stats o !me - Muestra tus estadísticas\n!top o !wins - Top 10 jugadores con más victorias\n!goles - Top 10 goleadores\n!asistencias - Top 10 asistidores\n!discord - Link a nuestro server\n!bb - Salir de la sala`, player.id, 0xFFFFFF, "bold");
      return false;
    }

    if (cmd === "discord") {
      room.sendAnnouncement(`Discord: ${DISCORD_LINK}`, player.id, 0x7289DA, "bold");
      return false;
    }

    if (cmd === "bb") {
      room.kickPlayer(player.id, "¡Chau!", false);
      return false;
    }

    if (cmd === "top" || cmd === "wins") { showTop(player, "wins", "🏆", 0xFFD700); return false; }
    if (cmd === "goles") { showTop(player, "goles", "⚽", 0xFF4500); return false; }
    if (cmd === "asistencias") { showTop(player, "asistencias", "🎯", 0x32CD32); return false; }

    if (cmd === "stats" || cmd === "me") {
      const key = getPlayerKey(player);
      if (!key || !data.players[key]) {
        room.sendAnnouncement(`TUS ESTADISTICAS\n\nPartidos: 0\nWins: 0\nGoles: 0\nAsistencias: 0\nPromedio gol/partido: 0.00`, player.id, 0x00D9FF, "bold");
        return false;
      }

      const p = data.players[key];
      const avg = p.matches > 0 ? (p.goles / p.matches).toFixed(2) : 0;
      room.sendAnnouncement(`TUS ESTADISTICAS\n\nPartidos: ${p.matches}\nWins: ${p.wins}\nGoles: ${p.goles}\nAsistencias: ${p.asistencias}\nPromedio gol/partido: ${avg}`, player.id, 0x00D9FF, "bold");
      return false;
    }
    return false;
  };

  setInterval(() => {
    if (!room.getScores()) return; 

    const now = Date.now();
    room.getPlayerList().forEach(player => {
      if (player.id === 0 || player.team === 0) return; 
      if (!afkData[player.id]) return;

      const diff = (now - afkData[player.id].lastMove) / 1000;

      if (diff >= 20 && diff < 30 && !afkData[player.id].warned) {
        room.sendAnnouncement(`⚠️ ${player.name} estás AFK. Movete o vas a ser kickeado.`, player.id, 0xFF9900, "bold");
        afkData[player.id].warned = true;
      }

      if (diff >= 30) {
        room.kickPlayer(player.id, "AFK durante 30 segundos", false);
        delete afkData[player.id];
      }
    });
  }, 1000);

});