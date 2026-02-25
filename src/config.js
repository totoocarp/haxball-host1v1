const fs = require('fs');
const path = require('path');

const CONFIG_FILE = path.join(__dirname, '..', 'config.json');

const defaultConfig = {
  room: { name: '1v1 Gana Sigue', maxPlayers: 15, public: true, token: '' },
  game: {
    scoreLimit: 5,
    timeLimit: 0,
    maxTeamSize: 1,
    afkWarnSeconds: 20,
    afkKickSeconds: 35,
    watchdogIntervalMs: 2000,
    freezeSeconds: 14,
    inactivityRestartSeconds: 45,
    doubleTouchWindowMs: 1200,
    commandCooldownMs: 900,
    autoSaveIntervalMs: 120000,
    lagPingThreshold: 220,
    lagKickThreshold: 500,
    lagWarnCount: 3,
    lagKickCount: 6
  },
  features: {
    enableElo: true,
    baseElo: 1000,
    eloK: 26,
    maintenanceMode: false,
    spectatorPriority: 'queue'
  },
  links: { discord: '' },
  security: { maxNameChangesPerMinute: 5, reconnectGraceSeconds: 45, maxChatLength: 160 }
};

function mergeDeep(target, source) {
  const output = { ...target };
  Object.keys(source || {}).forEach((key) => {
    if (source[key] && typeof source[key] === 'object' && !Array.isArray(source[key])) {
      output[key] = mergeDeep(target[key] || {}, source[key]);
    } else {
      output[key] = source[key];
    }
  });
  return output;
}

function loadConfig() {
  try {
    if (!fs.existsSync(CONFIG_FILE)) {
      fs.writeFileSync(CONFIG_FILE, JSON.stringify(defaultConfig, null, 2));
      return defaultConfig;
    }
    const parsed = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
    return mergeDeep(defaultConfig, parsed);
  } catch (error) {
    console.error('[CONFIG] Error cargando config, usando defaults:', error.message);
    return defaultConfig;
  }
}

module.exports = { loadConfig, CONFIG_FILE };
