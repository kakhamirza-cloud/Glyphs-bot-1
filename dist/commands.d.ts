import { ChatInputCommandInteraction } from 'discord.js';
import { GameRuntime } from './game';
export declare const commands: import("discord.js").RESTPostAPIChatInputApplicationCommandsJSONBody[];
export declare function handleSlash(interaction: ChatInputCommandInteraction, runtime: GameRuntime): Promise<import("discord.js").InteractionResponse<boolean> | undefined>;
export declare function registerCommands(token: string, clientId: string, guildId?: string): Promise<void>;
//# sourceMappingURL=commands.d.ts.map