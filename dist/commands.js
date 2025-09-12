"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.commands = void 0;
exports.handleSlash = handleSlash;
exports.registerCommands = registerCommands;
const discord_js_1 = require("discord.js");
const game_1 = require("./game");
exports.commands = [
    new discord_js_1.SlashCommandBuilder().setName('start').setDescription('Post the Glyphs game panel in this channel'),
    new discord_js_1.SlashCommandBuilder().setName('setblock').setDescription('Set current block number').addIntegerOption(o => o.setName('number').setDescription('Block number').setRequired(true)),
    new discord_js_1.SlashCommandBuilder().setName('setrewards').setDescription('Set total rewards per block').addIntegerOption(o => o.setName('amount').setDescription('Amount of glyphs').setRequired(true)),
    new discord_js_1.SlashCommandBuilder().setName('setduration').setDescription('Set seconds per block').addIntegerOption(o => o.setName('seconds').setDescription('Seconds').setRequired(true)),
    new discord_js_1.SlashCommandBuilder().setName('resetbalances').setDescription('Reset all balances to zero'),
    new discord_js_1.SlashCommandBuilder().setName('resetrecords').setDescription('Reset all reward records (admin only)'),
    new discord_js_1.SlashCommandBuilder().setName('resetall').setDescription('Reset everything: blocks, balances, records (admin only)'),
    new discord_js_1.SlashCommandBuilder().setName('restart').setDescription('Restart the bot (admin only)'),
    new discord_js_1.SlashCommandBuilder().setName('stop').setDescription('Stop the bot (admin only)'),
].map(c => c.toJSON());
async function handleSlash(interaction, runtime) {
    if (interaction.commandName === 'setblock') {
        const n = interaction.options.getInteger('number', true);
        await (0, game_1.setCurrentBlock)(runtime, n);
        return interaction.reply({ content: `Block set to ${n}.`, flags: 64 });
    }
    if (interaction.commandName === 'setrewards') {
        const amt = interaction.options.getInteger('amount', true);
        await (0, game_1.setTotalRewards)(runtime, amt);
        return interaction.reply({ content: `Total rewards per block set to ${amt}.`, flags: 64 });
    }
    if (interaction.commandName === 'setduration') {
        const sec = interaction.options.getInteger('seconds', true);
        await (0, game_1.setBlockDuration)(runtime, sec);
        return interaction.reply({ content: `Block duration set to ${sec}s.`, flags: 64 });
    }
    if (interaction.commandName === 'resetbalances') {
        runtime.balances.data = {};
        await runtime.balances.write();
        return interaction.reply({ content: 'All balances reset.', flags: 64 });
    }
    if (interaction.commandName === 'resetrecords') {
        runtime.state.data.blockHistory = [];
        await runtime.state.write();
        return interaction.reply({ content: 'All reward records reset.', flags: 64 });
    }
    if (interaction.commandName === 'resetall') {
        runtime.balances.data = {};
        runtime.state.data.blockHistory = [];
        runtime.state.data.currentBlock = 1;
        runtime.state.data.nextBlockAt = Date.now() + runtime.state.data.blockDurationSec * 1000;
        runtime.state.data.lastBotChoice = undefined;
        await runtime.balances.write();
        await runtime.state.write();
        return interaction.reply({ content: 'Everything reset: blocks, balances, and records.', flags: 64 });
    }
    if (interaction.commandName === 'restart') {
        await interaction.reply({ content: 'Restarting bot...', flags: 64 });
        console.log('Bot restart requested by admin');
        process.exit(0); // nodemon will restart it
        return;
    }
    if (interaction.commandName === 'stop') {
        await interaction.reply({ content: 'Stopping bot...', flags: 64 });
        console.log('Bot stop requested by admin');
        process.exit(1); // Exit with error code to prevent nodemon restart
        return;
    }
}
async function registerCommands(token, clientId, guildId) {
    const rest = new discord_js_1.REST({ version: '10' }).setToken(token);
    if (guildId) {
        await rest.put(discord_js_1.Routes.applicationGuildCommands(clientId, guildId), { body: exports.commands });
    }
    else {
        await rest.put(discord_js_1.Routes.applicationCommands(clientId), { body: exports.commands });
    }
}
//# sourceMappingURL=commands.js.map