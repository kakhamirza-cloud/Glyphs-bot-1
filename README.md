# Glyphs Bot 1

A Discord bot for a glyphs guessing game where players predict the next block's symbol and earn rewards based on accuracy. Features a comprehensive leaderboard system, grumble betting mechanics, and real-time block updates.

## Features

- **Block Prediction Game**: Players guess the next block's symbol from a set of 22 runes
- **Distance-Based Rewards**: Rewards based on how close your guess is to the actual symbol
- **Exact Match Bonuses**: Special rewards for perfect predictions
- **Grumble Betting**: Risk your balance for higher rewards with betting mechanics
- **Comprehensive Leaderboards**: Track exact matches and overall performance
- **Real-Time Updates**: Automatic block generation and reward distribution
- **Persistent Data**: All game state and balances saved locally
- **Railway Deployment Ready**: Configured for cloud deployment with health monitoring

## Setup

### Local Development

1. Create a Discord application and bot, enable Privileged Gateway Intents (Guilds and Guild Messages required).
2. Copy `.env.example` to `.env` and fill in your Discord bot credentials.
3. Install packages and build:
   ```bash
   npm install
   npm run build
   ```
4. Register slash commands:
   ```bash
   npm run register
   ```
5. Start the bot:
   - Development: `npm run dev`
   - Production: `npm start`
   - PM2: `pm2 start ecosystem.config.js`

### Railway Deployment

The bot is fully configured for Railway deployment:

1. **Connect Repository**: Link your GitHub repository to Railway
2. **Set Environment Variables**: Add all required Discord credentials in Railway dashboard
3. **Deploy**: Railway will automatically build and deploy using the `railway.json` configuration
4. **Health Monitoring**: Built-in health check endpoint at `/health`

## Environment Variables

```env
# Discord Bot Configuration
DISCORD_TOKEN=your_discord_bot_token_here
DISCORD_CLIENT_ID=your_discord_client_id_here
DISCORD_GUILD_ID=your_discord_guild_id_here
DISCORD_NOTIFY_ROLE_ID=your_notification_role_id_here
DISCORD_NOTIFY_CHANNEL_ID=your_notification_channel_id_here

# Environment
NODE_ENV=production
KEEP_ALIVE=1
PORT=3000
```

## Commands

### Game Commands
- **`/start`** - Start playing the glyphs game
- **`/stop`** - Stop the current game session
- **`/balance`** - Check your current balance
- **`/leaderboard`** - View the current leaderboard
- **`/finalleaderboard`** - View the final leaderboard with all-time stats

### Grumble Commands
- **`/grumble`** - Start a grumble betting session
- **`/grumblestop`** - Stop the current grumble session

### Admin Commands
- **`/simulate`** - Simulate multiple users for testing (Admin only)

## Game Features

### Block Prediction System
- **22 Rune Symbols**: Players choose from a grid of 22 different rune symbols
- **Distance Calculation**: Rewards based on symbol distance (0 = exact match, 1-11 = partial match)
- **Automatic Blocks**: New blocks generated automatically with random symbols
- **Reward Distribution**: Automatic balance updates based on prediction accuracy

### Reward System
- **Exact Match**: Highest reward for perfect predictions (distance = 0)
- **Partial Match**: Decreasing rewards based on symbol distance
- **Base Rewards**: Configurable reward amounts for different distance levels
- **Balance Tracking**: Persistent balance storage across sessions

### Grumble Betting
- **Risk/Reward**: Bet your balance for higher potential rewards
- **Symbol Selection**: Choose specific symbols to bet on
- **Amount Control**: Set custom bet amounts
- **Session Management**: Start/stop grumble sessions as needed

### Leaderboard System
- **Exact Match Tracking**: Counts perfect predictions for each player
- **All-Time History**: Maintains complete block history (no 10-block limit)
- **Real-Time Updates**: Leaderboard updates after each block
- **Performance Metrics**: Tracks individual player statistics

## Game Logic

### Symbol Distance Calculation
- **Distance Formula**: Calculates numerical distance between symbols
- **Reward Scaling**: Rewards decrease as distance increases
- **Exact Match Bonus**: Special handling for distance = 0

### Block Generation
- **Random Selection**: Each block uses a random symbol from the 22 available
- **Automatic Timing**: Blocks generated on a configurable schedule
- **History Tracking**: Complete block history maintained for leaderboards

### Data Persistence
- **JSON Storage**: Uses `lowdb` with JSON files for data persistence
- **Balance Tracking**: `data/balances.json` stores all player balances
- **Game State**: `data/state.json` stores block history and game state
- **Automatic Saves**: Data saved after each significant game event

## Technical Details

### Architecture
- **TypeScript**: Full TypeScript implementation with proper type safety
- **Discord.js v14**: Modern Discord API integration
- **Express.js**: Health check server for Railway monitoring
- **LowDB**: Lightweight JSON database for data persistence

### Railway Deployment
- **Health Checks**: `/health` endpoint for Railway monitoring
- **Port Configuration**: Configurable port (default 3000)
- **Build Process**: Automatic TypeScript compilation
- **Environment Variables**: Secure credential management

### Performance
- **Efficient Storage**: JSON-based storage with minimal overhead
- **Memory Management**: Optimized data structures for game state
- **Error Handling**: Comprehensive error handling and logging
- **Process Management**: PM2 integration for production deployment

## File Structure

```
src/
├── index.ts          # Main bot entry point with Discord client
├── commands.ts       # Slash command handlers
├── game.ts          # Core game logic and state management
├── storage.ts       # Data persistence and database operations
├── ui.ts            # Discord UI components (buttons, menus)
└── register-commands.ts # Slash command registration

data/
├── balances.json    # Player balance data
└── state.json       # Game state and block history

dist/                # Compiled JavaScript files
logs/                # Application logs
```

## Recent Updates

- ✅ **Leaderboard Fix**: Removed 10-block history limit - now shows all-time stats
- ✅ **Railway Deployment**: Added Express health check server and Railway configuration
- ✅ **Repository Cleanup**: Removed accidentally tracked node_modules and dist files
- ✅ **Security**: Proper .env file handling and gitignore configuration
- ✅ **Documentation**: Complete deployment guides and checklists

## Support

For issues or questions:
1. Check the logs in the `logs/` directory
2. Verify environment variables are correctly set
3. Ensure Discord bot has proper permissions
4. Check Railway deployment status if using cloud deployment