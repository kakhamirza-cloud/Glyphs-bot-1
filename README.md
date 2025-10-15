# E9 Trainer Bot

A Discord bot for the E9 creature collection and battle system. Players can catch E9 creatures, manage their collection, and battle other players in turn-based combat.

## Features

- **Creature Catching**: Catch random E9 creatures with different rarities (Common, Uncommon, Rare, Epic, Legendary)
- **Collection Management**: Store up to 3 creatures in your inventory
- **Smart Replacement**: When catching better tier creatures, get options to replace lower-tier ones
- **Challenge-Based Battles**: Challenge other players to battles with creature selection
- **Automatic Combat**: Turn-based battle system with damage calculations
- **Creature Progression**: Win battles to level up your creatures
- **Battle Restrictions**: Each player can only have one active battle at a time

## Setup

1. Create a Discord application and bot, enable Privileged Gateway Intents (Guilds and Guild Messages required).
2. Copy `.env.example` to `.env` and fill values.
3. Install packages and build:
   - `npm i`
   - `npm run build`
4. Register slash commands:
   - Guild scoped: set `DISCORD_GUILD_ID` in `.env`, then `npm run register`
5. Start the bot:
   - Dev: `npm run dev`
   - Prod: `npm start`
   - PM2: `npm run pm2:start`

## Environment Variables

```
DISCORD_TOKEN=your_bot_token
DISCORD_CLIENT_ID=your_bot_client_id
# Optional: if set, register commands to a single guild for fast propagation
DISCORD_GUILD_ID=your_guild_id
# Optional: comma-separated list of admin user IDs
ADMIN_USER_IDS=user_id1,user_id2
```

## Commands

### Creature Commands
- **`/catch`** - Attempt to catch a random E9 creature (50% base catch rate)
- **`/inventory`** - View your creature collection and stats
- **`/replace creature_number:<int>`** - Legacy command for creature replacement (use buttons instead)

### Battle Commands
- **`/battle opponent:<user>`** - Challenge another user to battle
- **`/accept`** - Accept a pending battle challenge
- **`/decline`** - Decline a pending battle challenge

### Admin Commands
- **`/resetinventory`** - Reset your inventory (removes all creatures and stats) - Admin only

## Game Features

### Creature System
- **Rarity Tiers**: Common (60% catch rate), Uncommon (40%), Rare (25%), Epic (15%), Legendary (5%)
- **Base Stats**: HP, Attack, Defense that vary by rarity
- **Collection Limit**: Maximum 3 creatures per player
- **Smart Replacement**: When catching better tier creatures, get button options to replace lower-tier ones

### Battle System
- **Challenge Flow**: 
  1. Player A uses `/battle @PlayerB`
  2. Player A selects their creature from buttons
  3. Player B receives notification and uses `/accept` or `/decline`
  4. If accepted, Player B selects their creature
  5. Battle runs automatically with turn-based combat
- **Battle Restrictions**: Each player can only have one active battle at a time
- **Combat Mechanics**: 
  - Turn-based attacks with damage calculations
  - Defense reduces incoming damage
  - Random damage variation for unpredictability
- **Battle Results**:
  - Winner's creature levels up (gains HP, Attack, Defense)
  - Loser's creature can die and be removed from inventory
  - Battle stats are tracked (total battles, wins)

### Creature Progression
- **Leveling**: Creatures gain levels by winning battles
- **Stat Growth**: Each level up increases HP, Attack, and Defense randomly
- **Experience Reset**: Experience resets to 0 after leveling up

## Game Logic

### Creature Catching
- **Base Catch Rate**: 50% chance to catch any creature
- **Rarity Modifiers**: Each creature has its own catch rate (Common: 60%, Uncommon: 40%, Rare: 25%, Epic: 15%, Legendary: 5%)
- **Final Catch Rate**: Minimum of 50% and creature's individual catch rate
- **Collection Management**: Players can hold up to 3 creatures maximum

### Battle Mechanics
- **Turn Order**: Challenger attacks first, then opponent
- **Damage Calculation**: `max(1, attack - defense/2 + random(-5 to +5))`
- **Battle Length**: Maximum 20 rounds to prevent infinite battles
- **Creature Death**: If a creature's HP reaches 0, it's removed from the player's inventory
- **Level Up Rewards**: 
  - HP increase: 5-14 points
  - Attack increase: 2-6 points  
  - Defense increase: 2-6 points

### Challenge System
- **One Battle Limit**: Each player can only have one active battle at a time
- **Challenge Timeout**: 60 seconds to select creatures, 5 minutes for pending challenges
- **Automatic Cleanup**: Expired challenges are automatically removed
- **State Persistence**: Challenge data is saved and survives bot restarts

### Data Storage
- **Database**: `data/database.json` (user inventories, pending creatures, active challenges)
- **User Data**: Creature collections, battle stats, total caught count
- **Challenge Data**: Active battles, creature selections, battle results
- **Automatic Migration**: System enforces 3-creature limit on existing data




