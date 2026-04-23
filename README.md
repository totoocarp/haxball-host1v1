# HaxBall Host 1v1 + Discord Bot

Sistema modular para Headless Host 1v1 con:

- Autoasignación de equipos
- Modo **gana y sigue** + rotación automática
- Elo con brackets Top Alto / Top Bajo + bonus por win streak
- Persistencia por identificador estable (`auth` de HaxBall y `discordId`)
- Vinculación cruzada HaxBall ↔ Discord con códigos temporales
- Chat limpio (todos los mensajes se eliminan y se reenvían por `sendAnnouncement`)
- Puente de chat HaxBall → canal admin de Discord y viceversa

## Estructura modular

- `host.js`: orquestación principal del host y reglas de juego.
- `src/config.js`: configuración y defaults.
- `src/storage/dataStore.js`: persistencia JSON e índices de identidad.
- `src/services/eloService.js`: reglas de ELO.
- `src/services/linkService.js`: registro/vinculación por código.
- `src/services/discordBot.js`: bot de Discord + slash commands + chat bridge.

## Requisitos

- Node.js 18+
- Token de HaxBall Headless (`HAXBALL_TOKEN`)
- Token de bot Discord

## Configuración

Crear/editar `config.json` (se autogenera con defaults):

- `room.*`: sala HaxBall
- `game.scoreLimit = 3`, `game.timeLimit = 3`
- `discord.token`, `discord.clientId`, `discord.guildId`, `discord.adminBridgeChannelId`
- `discord.inviteUrl` para `!discord`

El archivo `stadium.hbs` debe estar junto a `host.js`.

## Comandos HaxBall

- `!help`
- `!afk`
- `!me`
- `!stats`
- `!top`
- `!wins`
- `!winstreak`
- `!discord` / `!ds`
- `!register`
- `!login <CODIGO>`

## Comandos Discord (slash)

Públicos:

- `/me`
- `/stats`
- `/register`
- `/login code:<CODIGO>`
- `/top`
- `/wins`
- `/winstreak`

Admin (placeholder para integración de moderación en host):

- `/ban user`
- `/unban user`
- `/banip user`

## Flujo de vinculación

### Método Discord → HaxBall

1. Usuario ejecuta `/register` en Discord.
2. Recibe `!login ABCD1234`.
3. Lo ejecuta en HaxBall.
4. Cuenta vinculada.

### Método HaxBall → Discord

1. Usuario ejecuta `!register` en HaxBall.
2. Recibe `/login ABCD1234`.
3. Lo ejecuta en Discord.
4. Cuenta vinculada.

## Ejecutar

```bash
npm install
HAXBALL_TOKEN=tu_token node host.js
```
