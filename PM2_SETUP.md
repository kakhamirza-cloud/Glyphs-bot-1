# PM2 Setup for Glyphs Bot

This document explains how to manage the Glyphs Bot using PM2 process manager.

## 🚀 Quick Start

### Start the Bot
```bash
# Option 1: Using npm script
npm run pm2:start

# Option 2: Using batch file (Windows)
start.bat

# Option 3: Direct PM2 command
pm2 start ecosystem.config.js
```

### Stop the Bot
```bash
# Option 1: Using npm script
npm run pm2:stop

# Option 2: Using batch file (Windows)
stop.bat

# Option 3: Direct PM2 command
pm2 stop glyphs-bot
```

## 📋 Available Commands

| Command | Description |
|---------|-------------|
| `npm run pm2:start` | Start the bot |
| `npm run pm2:stop` | Stop the bot |
| `npm run pm2:restart` | Restart the bot |
| `npm run pm2:delete` | Remove from PM2 |
| `npm run pm2:logs` | View logs |
| `npm run pm2:status` | Check status |
| `npm run pm2:monit` | Open dashboard |

## 🔧 Configuration

The bot uses `ecosystem.config.js` for PM2 configuration:

- **Name**: `glyphs-bot`
- **Script**: `dist/index.js`
- **Working Directory**: `D:/Cursor Project/Glyphs Bot 1`
- **Memory Limit**: 1GB
- **Auto-restart**: Enabled
- **Logs**: Stored in `./logs/` directory

## 📊 Monitoring

### View Logs
```bash
# Real-time logs
npm run pm2:logs

# Or use PM2 directly
pm2 logs glyphs-bot
```

### Check Status
```bash
# View all PM2 processes
npm run pm2:status

# Or use PM2 directly
pm2 list
```

### Open Dashboard
```bash
# Open PM2 monitoring dashboard
npm run pm2:monit
```

## 🛠️ Troubleshooting

### Bot Not Starting
1. Check if the bot is built: `npm run build`
2. Verify environment variables in `.env`
3. Check logs: `npm run pm2:logs`

### Bot Crashes
1. Check logs for error messages
2. Verify Discord token is valid
3. Check memory usage (limit is 1GB)

### Restart Bot
```bash
npm run pm2:restart
```

## 📁 File Structure

```
Glyphs Bot 1/
├── ecosystem.config.js    # PM2 configuration
├── start.bat             # Windows start script
├── stop.bat              # Windows stop script
├── logs/                 # PM2 log files
│   ├── combined.log
│   ├── out.log
│   └── error.log
└── dist/                 # Compiled JavaScript
    └── index.js
```

## 🔄 Separate from E9 Trainer Bot

This bot is now completely separate from the E9 Trainer Bot:

- **Glyphs Bot**: ID 1, Name: `glyphs-bot`
- **E9 Trainer Bot**: ID 3, Name: `e9-trainer-bot`

Each bot has its own:
- PM2 process
- Configuration file
- Log files
- Start/stop scripts
- Working directory

## 🎯 Benefits

- **Independent Management**: Start/stop each bot separately
- **Isolated Logs**: Each bot has its own log files
- **Resource Control**: Individual memory limits and monitoring
- **Easy Deployment**: Simple scripts for common operations
- **Production Ready**: Auto-restart, logging, and monitoring
