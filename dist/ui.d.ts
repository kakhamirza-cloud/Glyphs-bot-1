import { ActionRowBuilder, ButtonBuilder, EmbedBuilder } from 'discord.js';
import { GameRuntime, SymbolRune } from './game';
export declare function buildPanel(runtime: GameRuntime): {
    embed: EmbedBuilder;
    rows: ActionRowBuilder<ButtonBuilder>[];
};
export declare function buildChoiceMenu(selected?: SymbolRune): ActionRowBuilder<ButtonBuilder>[];
export declare function buildGrumblePanel(prizePool: number, joined: boolean, runtime?: GameRuntime): {
    embed: EmbedBuilder;
    rows: ActionRowBuilder<ButtonBuilder>[];
};
export declare function buildGrumbleRuneSelection(): {
    embed: EmbedBuilder;
    rows: ActionRowBuilder<ButtonBuilder>[];
};
export declare function buildGrumbleAmountInput(selectedRune: string, userBalance: number): {
    embed: EmbedBuilder;
    rows: ActionRowBuilder<ButtonBuilder>[];
};
//# sourceMappingURL=ui.d.ts.map