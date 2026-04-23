const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

function uid(prefix = 'p') {
  return `${prefix}_${crypto.randomBytes(6).toString('hex')}`;
}

function code() {
  return crypto.randomBytes(4).toString('hex').toUpperCase();
}

function defaultStats(baseElo) {
  return {
    matches: 0,
    wins: 0,
    losses: 0,
    goals: 0,
    assists: 0,
    elo: baseElo,
    winStreak: 0,
    bestWinStreak: 0
  };
}

class DataStore {
  constructor(config) {
    this.baseElo = config.game?.baseElo || 1000;
    this.file = path.join(__dirname, '..', '..', config.storage.file || 'data.json');
    this.data = {
      players: {},
      index: { authToPlayer: {}, discordToPlayer: {} },
      pendingCodes: {}
    };
  }

  load() {
    if (!fs.existsSync(this.file)) {
      this.save();
      return;
    }
    try {
      this.data = { ...this.data, ...JSON.parse(fs.readFileSync(this.file, 'utf8')) };
      this.data.players ||= {};
      this.data.index ||= { authToPlayer: {}, discordToPlayer: {} };
      this.data.pendingCodes ||= {};
    } catch (error) {
      console.error('[STORE] Failed to load data file. Recreating...', error);
      this.save();
    }
  }

  save() {
    const tmp = `${this.file}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(this.data, null, 2));
    fs.renameSync(tmp, this.file);
  }

  getPlayer(playerId) {
    return this.data.players[playerId] || null;
  }

  createPlayer({ name = 'Jugador', auth = null, discordId = null }) {
    const id = uid('player');
    this.data.players[id] = {
      id,
      displayName: name,
      createdAt: Date.now(),
      lastSeenAt: Date.now(),
      auths: auth ? [auth] : [],
      discordId: discordId || null,
      linked: Boolean(auth && discordId),
      stats: defaultStats(this.baseElo)
    };
    if (auth) this.data.index.authToPlayer[auth] = id;
    if (discordId) this.data.index.discordToPlayer[discordId] = id;
    return this.data.players[id];
  }

  ensureByAuth(auth, name = 'Jugador') {
    const current = this.data.index.authToPlayer[auth];
    if (current) {
      const p = this.data.players[current];
      p.displayName = name || p.displayName;
      p.lastSeenAt = Date.now();
      if (!p.auths.includes(auth)) p.auths.push(auth);
      return p;
    }
    return this.createPlayer({ name, auth });
  }

  ensureByDiscord(discordId, name = 'DiscordUser') {
    const current = this.data.index.discordToPlayer[discordId];
    if (current) {
      const p = this.data.players[current];
      p.lastSeenAt = Date.now();
      return p;
    }
    return this.createPlayer({ name, discordId });
  }

  mergePlayers(targetId, sourceId) {
    if (!targetId || !sourceId || targetId === sourceId) return this.getPlayer(targetId || sourceId);
    const target = this.getPlayer(targetId);
    const source = this.getPlayer(sourceId);
    if (!target || !source) return target || source || null;

    for (const auth of source.auths) {
      if (!target.auths.includes(auth)) target.auths.push(auth);
      this.data.index.authToPlayer[auth] = target.id;
    }

    if (!target.discordId && source.discordId) target.discordId = source.discordId;
    if (target.discordId) this.data.index.discordToPlayer[target.discordId] = target.id;

    for (const key of ['matches', 'wins', 'losses', 'goals', 'assists']) {
      target.stats[key] += source.stats[key] || 0;
    }
    target.stats.elo = Math.max(target.stats.elo, source.stats.elo);
    target.stats.winStreak = Math.max(target.stats.winStreak, source.stats.winStreak);
    target.stats.bestWinStreak = Math.max(target.stats.bestWinStreak, source.stats.bestWinStreak);
    target.linked = Boolean(target.discordId && target.auths.length > 0);

    delete this.data.players[source.id];
    return target;
  }

  linkAuthToPlayer(playerId, auth) {
    const player = this.getPlayer(playerId);
    if (!player) return null;
    if (!player.auths.includes(auth)) player.auths.push(auth);
    this.data.index.authToPlayer[auth] = player.id;
    player.linked = Boolean(player.discordId && player.auths.length > 0);
    return player;
  }

  linkDiscordToPlayer(playerId, discordId) {
    const player = this.getPlayer(playerId);
    if (!player) return null;
    player.discordId = discordId;
    this.data.index.discordToPlayer[discordId] = player.id;
    player.linked = Boolean(player.discordId && player.auths.length > 0);
    return player;
  }

  createCode(playerId, source, ttlMs) {
    const c = code();
    this.data.pendingCodes[c] = {
      code: c,
      playerId,
      source,
      expiresAt: Date.now() + ttlMs
    };
    return c;
  }

  consumeCode(c, expectedSource) {
    const entry = this.data.pendingCodes[c];
    if (!entry) return null;
    if (entry.expiresAt < Date.now()) {
      delete this.data.pendingCodes[c];
      return null;
    }
    if (expectedSource && entry.source !== expectedSource) return null;
    delete this.data.pendingCodes[c];
    return entry;
  }

  getTopBy(metric = 'elo', limit = 10) {
    const linked = Object.values(this.data.players).filter((p) => p.linked);
    return linked
      .sort((a, b) => (b.stats[metric] || 0) - (a.stats[metric] || 0))
      .slice(0, limit);
  }
}

module.exports = { DataStore };
