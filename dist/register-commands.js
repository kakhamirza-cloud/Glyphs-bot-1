"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
require("dotenv/config");
const commands_1 = require("./commands");
async function main() {
    const token = process.env.DISCORD_TOKEN;
    const clientId = process.env.DISCORD_CLIENT_ID;
    const guildId = process.env.DISCORD_GUILD_ID; // optional for global
    await (0, commands_1.registerCommands)(token, clientId, guildId);
    console.log('Slash commands registered', { scope: guildId ? 'guild' : 'global' });
}
main().catch((e) => {
    console.error(e);
    process.exit(1);
});
//# sourceMappingURL=register-commands.js.map