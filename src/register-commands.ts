import 'dotenv/config';
import { commands, registerCommands } from './commands';

async function main() {
    const token = process.env.DISCORD_TOKEN!;
    const clientId = process.env.DISCORD_CLIENT_ID!;
    const guildId = process.env.DISCORD_GUILD_ID; // optional for global
    await registerCommands(token, clientId, guildId);
    console.log('Slash commands registered', { scope: guildId ? 'guild' : 'global' });
}

main().catch((e)=>{
    console.error(e);
    process.exit(1);
});







