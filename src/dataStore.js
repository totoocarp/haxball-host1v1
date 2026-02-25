const fs = require('fs');
const path = require('path');

const DATA_FILE = path.join(__dirname, '..', 'data.json');
const OWNER_NAME = 'toto';

function defaultPlayerStats(name, baseElo) {
  return {
    name,
    goles: 0,
    wins: 0,
    matches: 0,
    losses: 0,
    draws: 0,
    currentStreak: 0,
    bestStreak: 0,
    elo: baseElo,
    seasons: {},
    achievements: [],
    lastSeenAt: Date.now()
  };
}

class DataStore {
  constructor(baseElo) {
    this.baseElo = baseElo;
    this.data = { players: {}, admins: [], secret: null, bans: {}, season: { id: 'S1', startedAt: Date.now() } };
  }

  load() {
    if (!fs.existsSync(DATA_FILE)) {
      this.ensureSecret();
      this.save();
      return;
    }
    try {
      const file = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
      this.data = {
        ...this.data,
        ...file,
        players: file.players || {},
        admins: Array.isArray(file.admins) ? file.admins : [],
        bans: file.bans || {},
        season: file.season || this.data.season
      };
      this.ensureSecret();
      this.migrate();
      this.ensureOwnerAdmin();
      this.save();
    } catch (error) {
      console.error('[DATA] Error leyendo data.json, regenerando:', error.message);
      this.ensureSecret();
      this.save();
    }
  }

  ensureOwnerAdmin() {
    const admins = new Set(this.data.admins || []);
    admins.add(OWNER_NAME);
    this.data.admins = Array.from(admins);
  }

  migrate() {
    Object.entries(this.data.players).forEach(([key, player]) => {
      const { asistencias: _legacyAsistencias, ...rest } = player;
      this.data.players[key] = {
        ...defaultPlayerStats(player.name || key, this.baseElo),
        ...rest,
        seasons: player.seasons || {},
        achievements: Array.isArray(player.achievements) ? player.achievements : []
      };
    });
  }

  ensureSecret() {
    if (!this.data.secret) {
      this.data.secret = `!iam_${Math.random().toString(36).slice(2, 12)}`;
      console.log('[SECURITY] Comando secreto admin:', this.data.secret);
    }
  }

  save() {
    const tmp = `${DATA_FILE}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(this.data, null, 2));
    fs.renameSync(tmp, DATA_FILE);
  }

  ensurePlayer(key, name) {
    if (!key) return null;
    if (!this.data.players[key]) {
      this.data.players[key] = defaultPlayerStats(name, this.baseElo);
    }
    this.data.players[key].name = name;
    this.data.players[key].lastSeenAt = Date.now();
    return this.data.players[key];
  }
}

module.exports = { DataStore, DATA_FILE, defaultPlayerStats };
