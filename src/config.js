const fs = require('fs');
const path = require('path');

const CONFIG_FILE = path.join(__dirname, '..', 'config.json');

const defaultConfig = {
  room: {
    name: 'HaxBall 1v1 Win & Stay',
    maxPlayers: 16,
    public: false,
    token: '',
    geo: { code: 'US', lat: 37.7749, lon: -122.4194 }
  },
  game: {
    scoreLimit: 3,
    timeLimit: 3,
    maxTeamSize: 1,
    autoStartDelayMs: 400,
    loginCodeTtlMs: 10 * 60 * 1000
  },
  storage: {
    file: 'data.json',
    autosaveMs: 30_000
  },
  discord: {
    token: '',
    clientId: '',
    guildId: '',
    adminBridgeChannelId: '',
    inviteUrl: ''
  },
  style: {
    defaultColor: 0xEAEAEA,
    adminColor: 0xFFB347,
    afkColor: 0xB0B0B0,
    botColor: 0x71D5FF,
    warningColor: 0xFF6B6B
  }
};

function mergeDeep(target, source) {
  const out = { ...target };
  for (const [key, value] of Object.entries(source || {})) {
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      out[key] = mergeDeep(target[key] || {}, value);
    } else {
      out[key] = value;
    }
  }
  return out;
}

function loadConfig() {
  if (!fs.existsSync(CONFIG_FILE)) {
    fs.writeFileSync(CONFIG_FILE, JSON.stringify(defaultConfig, null, 2));
    return defaultConfig;
  }
  try {
    const parsed = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
    return mergeDeep(defaultConfig, parsed);
  } catch (error) {
    console.error('[CONFIG] Error parsing config.json. Using defaults.', error);
    return defaultConfig;
  }
}

module.exports = { CONFIG_FILE, defaultConfig, loadConfig };
