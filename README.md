# Glyphs Bot

Discord guessing game with rune choices and timed "blocks". Players pick a rune each block; the bot reveals its rune when the block flips and awards GLYPHS based on closeness.

Setup

1. Create a Discord application and bot, enable Privileged Gateway Intents as needed (Guilds only required here).
2. Copy `.env.example` to `.env` and fill values.
3. Install packages and build:
   - `npm i`
   - `npm run build`
4. Register slash commands:
   - Guild scoped: set `DISCORD_GUILD_ID` in `.env`, then `npm run register`
5. Start the bot:
   - Dev: `npm run dev`
   - Prod: `npm start`

Env

```
DISCORD_TOKEN=
DISCORD_CLIENT_ID=
# Optional: if set, register commands to a single guild for fast propagation
DISCORD_GUILD_ID=
```

## Commands

### Game Commands
- **`/post`** - Post the Glyphs game panel in the current channel

### Admin Configuration Commands
- **`/setblock number:<int>`** - Set current block number
- **`/setrewards amount:<int>`** - Set total rewards per block (legacy, now uses fixed 1000 base)
- **`/setbasereward amount:<int>`** - Set the base reward per block (admin only; requires Administrator permission)
- **`/setduration seconds:<int>`** - Set seconds per block timer

### Admin Reset Commands
- **`/resetbalances`** - Reset all user balances to zero
- **`/resetrecords`** - Clear all historical reward records
- **`/resetall`** - Reset everything: blocks, balances, and records (complete reset)

### Bot Management Commands
- **`/restart`** - Soft restart: disables and immediately re-enables the bot (admin only)
- **`/stop`** - Soft stop: disables all commands except `/start` (admin only)
- **`/start`** - Re-enables the bot after a soft stop (admin only)
- **`/shutdown`** - Fully shut down the bot process (admin only)

> **Note:** `/restart` now performs a soft stop and start (does not restart the process). `/stop` puts the bot in a "soft stopped" state. Use `/start` to reactivate the bot from Discord. If you need to fully restart the process, do so from your server or use a process manager.

## UI Features

### Main Panel Buttons
- **Mine** - Opens rune selection grid (22 runes in 5x5 layout)
- **Balance** - Shows your current GLYPHS balance
- **Last Block Reward** - Shows all members' results from previous block
- **Reward Records** - Shows your personal historical data (private)

### Rune Selection
- **Grid Layout** - All 22 runes visible at once (no scrolling)
- **Visual Feedback** - Selected rune highlighted in green
- **Changeable** - Can modify choice until block timer expires

## Game Logic

### Reward System
- **Base Reward:** 1,000 GLYPHS per block
- **Exact Match:** 1,000 × 100% = 1,000 GLYPHS
- **Distance 1-3:** 1,000 × 70% = 700 GLYPHS
- **Distance 4-7:** 1,000 × 40% = 400 GLYPHS
- **Distance 8+:** 1,000 × 15% = 150 GLYPHS

### Block System
- **Automatic Advancement** - Blocks advance based on timer
- **Bot Choice Reveal** - Bot's rune revealed when block ends
- **Reward Distribution** - GLYPHS awarded based on choice accuracy
- **Historical Tracking** - All member choices and rewards stored

### Data Persistence
- **State Data:** `data/state.json` (blocks, timers, bot choices, history)
- **Balances:** `data/balances.json` (user GLYPHS balances)
- **History:** Last 10 blocks of member data stored




