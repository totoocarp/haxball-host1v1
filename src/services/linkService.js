class LinkService {
  constructor(store, ttlMs) {
    this.store = store;
    this.ttlMs = ttlMs;
  }

  createFromDiscord(discordId, name = 'DiscordUser') {
    const p = this.store.ensureByDiscord(discordId, name);
    const code = this.store.createCode(p.id, 'discord', this.ttlMs);
    this.store.save();
    return code;
  }

  createFromHax(auth, name = 'Jugador') {
    const p = this.store.ensureByAuth(auth, name);
    const code = this.store.createCode(p.id, 'hax', this.ttlMs);
    this.store.save();
    return code;
  }

  consumeInHax(code, auth, name) {
    const entry = this.store.consumeCode(code, 'discord');
    if (!entry) return { ok: false, reason: 'Código inválido o expirado.' };

    const fromCode = this.store.getPlayer(entry.playerId);
    const fromAuth = this.store.ensureByAuth(auth, name);
    let finalPlayer = fromCode;

    if (fromAuth && fromCode && fromAuth.id !== fromCode.id) {
      finalPlayer = this.store.mergePlayers(fromCode.id, fromAuth.id);
    }

    finalPlayer = this.store.linkAuthToPlayer(finalPlayer.id, auth);
    finalPlayer.linked = Boolean(finalPlayer.discordId && finalPlayer.auths.length > 0);
    this.store.save();
    return { ok: true, player: finalPlayer };
  }

  consumeInDiscord(code, discordId) {
    const entry = this.store.consumeCode(code, 'hax');
    if (!entry) return { ok: false, reason: 'Código inválido o expirado.' };

    const fromCode = this.store.getPlayer(entry.playerId);
    const fromDiscord = this.store.ensureByDiscord(discordId);

    let finalPlayer = fromCode;
    if (fromCode && fromDiscord && fromCode.id !== fromDiscord.id) {
      finalPlayer = this.store.mergePlayers(fromCode.id, fromDiscord.id);
    }

    finalPlayer = this.store.linkDiscordToPlayer(finalPlayer.id, discordId);
    finalPlayer.linked = Boolean(finalPlayer.discordId && finalPlayer.auths.length > 0);
    this.store.save();
    return { ok: true, player: finalPlayer };
  }
}

module.exports = { LinkService };
