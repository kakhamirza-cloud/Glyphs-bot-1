# Railway Deployment Guide for Glyphs Bot 1

## Prerequisites
- Railway account
- Discord bot token and permissions
- Git repository (GitHub recommended)

## Environment Variables Required

Set these in Railway dashboard under Variables:

```
DISCORD_TOKEN=your_discord_bot_token_here
DISCORD_CLIENT_ID=your_discord_client_id_here
DISCORD_GUILD_ID=your_discord_guild_id_here
DISCORD_NOTIFY_ROLE_ID=your_notification_role_id_here
DISCORD_NOTIFY_CHANNEL_ID=your_notification_channel_id_here
NODE_ENV=production
KEEP_ALIVE=1
PORT=3000
```

## Deployment Steps

1. **Connect Repository**
   - Go to Railway dashboard
   - Click "New Project"
   - Select "Deploy from GitHub repo"
   - Choose your Glyphs Bot 1 repository

2. **Set Environment Variables**
   - Go to your project settings
   - Navigate to "Variables" tab
   - Add all required environment variables listed above

3. **Deploy**
   - Railway will automatically build and deploy
   - Check logs for any errors
   - Bot should be online once deployment completes

## Data Persistence

- Bot uses local JSON files for data storage
- Data is stored in `/app/data/` directory on Railway
- Files: `state.json`, `balances.json`
- Data persists between deployments

## Monitoring

- Check Railway logs for bot status
- Monitor Discord for bot responses
- Use Railway metrics for performance monitoring

## Troubleshooting

- Ensure all environment variables are set correctly
- Check Discord bot permissions
- Verify guild ID and channel IDs are correct
- Check Railway logs for specific error messages

## Commands

The bot supports these slash commands:
- `/start` - Start the game
- `/stop` - Stop the game
- `/leaderboard` - View leaderboard
- `/finalleaderboard` - View final leaderboard
- `/balance` - Check your balance
- `/mine` - Place a mining choice
- `/grumble` - Start grumble game
- `/bet` - Place a bet in grumble
- `/endgrumble` - End grumble game
