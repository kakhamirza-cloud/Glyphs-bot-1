import { ActionRowBuilder, ButtonBuilder, EmbedBuilder } from 'discord.js';
import { GameRuntime, SymbolRune } from './game';
export declare function buildPanel(runtime: GameRuntime): {
    embed: EmbedBuilder;
    rows: ActionRowBuilder<ButtonBuilder>[];
};
export declare function buildChoiceMenu(selected?: SymbolRune): ActionRowBuilder<ButtonBuilder>[];
//# sourceMappingURL=ui.d.ts.map