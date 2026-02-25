# haxball-host1v1

Host avanzado de Haxball 1v1 "Gana y Sigue" en Node.js, con watchdog, anti-bug y sistema de estadísticas/ELO.

## Requisitos

- Node.js 18+
- Token de Headless Host de Haxball (`HAXBALL_TOKEN` o `config.json`)

## Configuración

Editar `config.json` para personalizar:

- Parámetros de sala (nombre, tamaño, geolocalización).
- Reglas de watchdog/AFK/lag.
- Activar/desactivar ELO.
- Links y modo mantenimiento.

## Ejecutar

```bash
npm install
HAXBALL_TOKEN=tu_token node host.js
```

## Comandos públicos

- `!help`
- `!stats`
- `!perfil [id|name]`
- `!rank`
- `!elo`
- `!top`
- `!wins`
- `!goles`
- `!asistencias`
- `!racha`
- `!afk`
- `!ping`
- `!historial`
- `!discord`

## Comandos admin

- `!forcestart`
- `!forceend`
- `!setwins <id|name> <wins>`
- `!resetstats <id|name>`
- `!mute <id|name>`
- `!unmute <id|name>`
- `!clearchat`
- `!setelo <id|name> <elo>`
- `!reloadconfig`
- `!restart`
- `!ban <id|name> [motivo]`
- `!unban <player_key>`
- `!modo mantenimiento [motivo]`
- `!modo normal`
- `!season [id]`

## Resiliencia implementada

- Auto-balance y auto-start robusto.
- Watchdog de pelota freezeada + inactividad.
- Anti-AFK y control de lag extremo.
- Guardado atómico y autosave.
- Captura de errores global (`uncaughtException`, `unhandledRejection`).
