const { Client, Intents, MessageEmbed } = require('discord.js');

class DiscordBotService {
  constructor(config, store, linkService) {
    this.config = config;
    this.store = store;
    this.linkService = linkService;
    this.client = null;
    this.bridgeChannelId = config.discord.adminBridgeChannelId;
    this.bridgeHandler = null;
  }

  setBridgeHandler(handler) {
    this.bridgeHandler = handler;
  }

  async start() {
    if (!this.config.discord.token) {
      console.log('[DISCORD] Token vacío: bot desactivado.');
      return;
    }

    this.client = new Client({
      intents: [Intents.FLAGS.GUILDS, Intents.FLAGS.GUILD_MESSAGES]
    });

    this.client.once('ready', () => {
      console.log(`[DISCORD] Conectado como ${this.client.user.tag}`);
    });

    this.client.on('interactionCreate', async (interaction) => {
      if (!interaction.isCommand()) return;
      try {
        await this.handleSlash(interaction);
      } catch (error) {
        console.error('[DISCORD] Slash error', error);
        if (!interaction.replied) {
          await interaction.reply({ content: 'Error interno.', ephemeral: true });
        }
      }
    });

    this.client.on('messageCreate', async (message) => {
      if (!this.bridgeChannelId) return;
      if (message.author.bot || message.channelId !== this.bridgeChannelId) return;
      if (!this.bridgeHandler) return;
      this.bridgeHandler(`[Discord] ${message.author.username}: ${message.content}`);
    });

    await this.client.login(this.config.discord.token);
  }

  async sendBridge(text) {
    if (!this.client || !this.bridgeChannelId) return;
    const channel = await this.client.channels.fetch(this.bridgeChannelId).catch(() => null);
    if (!channel) return;
    await channel.send(text).catch(() => null);
  }

  getPlayerByDiscord(interaction) {
    const pid = this.store.data.index.discordToPlayer[interaction.user.id];
    return pid ? this.store.getPlayer(pid) : null;
  }

  statText(player) {
    if (!player || !player.linked) return 'No estás vinculado todavía.';
    const s = player.stats;
    return `ELO ${s.elo} | PJ ${s.matches} | W ${s.wins} | L ${s.losses} | G ${s.goals} | A ${s.assists} | WS ${s.winStreak}`;
  }

  async handleSlash(interaction) {
    const name = interaction.commandName;

    if (name === 'register') {
      const c = this.linkService.createFromDiscord(interaction.user.id, interaction.user.username);
      await interaction.reply({ content: `Código generado: \`!login ${c}\` (úsalo en HaxBall).`, ephemeral: true });
      return;
    }

    if (name === 'login') {
      const code = interaction.options.getString('code', true).toUpperCase();
      const result = this.linkService.consumeInDiscord(code, interaction.user.id);
      await interaction.reply({ content: result.ok ? '✅ Cuenta vinculada correctamente.' : `❌ ${result.reason}`, ephemeral: true });
      return;
    }

    const player = this.getPlayerByDiscord(interaction);
    if (['me', 'stats'].includes(name)) {
      await interaction.reply({ content: this.statText(player), ephemeral: true });
      return;
    }

    if (name === 'top') {
      const top = this.store.getTopBy('elo', 10);
      const lines = top.map((p, i) => `${i + 1}. ${p.displayName} - ${p.stats.elo}`).join('\n') || 'Sin datos.';
      await interaction.reply({ content: `🏆 TOP ELO\n${lines}`, ephemeral: true });
      return;
    }

    if (name === 'wins') {
      const top = this.store.getTopBy('wins', 10);
      const lines = top.map((p, i) => `${i + 1}. ${p.displayName} - ${p.stats.wins}`).join('\n') || 'Sin datos.';
      await interaction.reply({ content: `🥇 TOP WINS\n${lines}`, ephemeral: true });
      return;
    }

    if (name === 'winstreak') {
      const top = this.store.getTopBy('bestWinStreak', 10);
      const lines = top.map((p, i) => `${i + 1}. ${p.displayName} - ${p.stats.bestWinStreak}`).join('\n') || 'Sin datos.';
      await interaction.reply({ content: `🔥 TOP WINSTREAK\n${lines}`, ephemeral: true });
      return;
    }

    if (['ban', 'unban', 'banip'].includes(name)) {
      await interaction.reply({ content: 'Comando admin recibido (placeholder para integración con host).', ephemeral: true });
    }
  }
}

module.exports = { DiscordBotService };
