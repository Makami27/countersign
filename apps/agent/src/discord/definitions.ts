import { DISCORD_COMMANDS } from "./words.ts";

const SLASH_COMMAND = 1;
const STRING_OPTION = 3;
const GUILD_INSTALL = 0;
const USER_INSTALL = 1;
const IN_SERVERS = 0;
const IN_BOT_DM = 1;
const IN_PRIVATE_CHANNELS = 2;

type StringOption = { readonly type: typeof STRING_OPTION; readonly name: string; readonly description: string; readonly required: true; readonly max_length: number; readonly autocomplete?: true };

const OPTIONS: Readonly<Record<string, readonly StringOption[]>> = {
  pay: [
    { type: STRING_OPTION, name: "payee", description: "The payee's name", required: true, max_length: 64, autocomplete: true },
    { type: STRING_OPTION, name: "amount", description: "Amount in USDC, for example 0.10", required: true, max_length: 24 },
  ],
  check: [{ type: STRING_OPTION, name: "message", description: "The text of the email or chat to check", required: true, max_length: 4000 }],
  link: [{ type: STRING_OPTION, name: "code", description: "The code from Settings in the owner app", required: true, max_length: 24 }],
};

export const COMMAND_DEFINITIONS = DISCORD_COMMANDS.map((c) => ({
  type: SLASH_COMMAND,
  name: c.command,
  description: c.description,
  integration_types: [GUILD_INSTALL, USER_INSTALL],
  contexts: [IN_SERVERS, IN_BOT_DM, IN_PRIVATE_CHANNELS],
  options: OPTIONS[c.command] ?? [],
}));
