import { ActionRowBuilder, ButtonBuilder, ButtonStyle, Client, DiscordAPIError, Events, MessageFlags, REST, RESTJSONErrorCodes, Routes, type ButtonInteraction, type ChatInputCommandInteraction, type Interaction } from "discord.js";
import { STORE_UNANSWERED_REPLY } from "../replies.ts";
import type { Reply, Say } from "../chat/conversation.ts";
import { COMMAND_DEFINITIONS } from "./definitions.ts";
import type { DiscordHandler } from "./handler.ts";
import { chunks, contentOf } from "./messages.ts";
import type { DmResult } from "./notices.ts";

const LOGIN_RETRY_MS = 30_000;
const NO_MENTIONS = { parse: [] };

export type DiscordGateway = { readonly ready: () => boolean; readonly sendDm: (userId: string, content: string) => Promise<DmResult>; readonly stop: () => Promise<void> };

function rowsOf(reply: Reply): ActionRowBuilder<ButtonBuilder>[] {
  return (reply.buttons ?? []).map((row) => new ActionRowBuilder<ButtonBuilder>().addComponents(row.map((b) => new ButtonBuilder().setCustomId(b.data).setLabel(b.label).setStyle(b.data.startsWith("pay:") ? ButtonStyle.Primary : ButtonStyle.Secondary))));
}

function ephemeralSay(interaction: ChatInputCommandInteraction | ButtonInteraction, firstEdits: boolean): Say {
  let editNext = firstEdits;
  return async (reply) => {
    const parts = chunks(contentOf(reply));
    for (const [i, content] of parts.entries()) {
      const components = i === parts.length - 1 ? rowsOf(reply) : [];
      if (editNext) {
        editNext = false;
        await interaction.editReply({ content, components, allowedMentions: NO_MENTIONS });
      } else {
        await interaction.followUp({ content, components, flags: MessageFlags.Ephemeral, allowedMentions: NO_MENTIONS });
      }
    }
  };
}

async function answer(interaction: Interaction, handler: DiscordHandler): Promise<void> {
  if (interaction.isAutocomplete()) {
    const choices = await handler.payeeChoices(interaction.user.id, String(interaction.options.getFocused()));
    return interaction.respond([...choices]);
  }
  if (interaction.isChatInputCommand()) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const options = Object.fromEntries(interaction.options.data.map((o) => [o.name, String(o.value ?? "")]));
    const say = ephemeralSay(interaction, true);
    return handler.command({ id: interaction.id, userId: interaction.user.id, name: interaction.commandName, options, at: interaction.createdAt.toISOString() }, say).catch(async (error: Error) => {
      console.error(`Discord command failed: ${error.message.slice(0, 200)}`);
      await say({ text: STORE_UNANSWERED_REPLY, rich: false }).catch(() => undefined);
    });
  }
  if (interaction.isButton()) {
    await interaction.update({ components: [] });
    const say = ephemeralSay(interaction, false);
    return handler.button({ userId: interaction.user.id, data: interaction.customId }, say).catch(async (error: Error) => {
      console.error(`Discord button failed: ${error.message.slice(0, 200)}`);
      await say({ text: STORE_UNANSWERED_REPLY, rich: false }).catch(() => undefined);
    });
  }
}

export function startDiscord(token: string, applicationId: string, handler: DiscordHandler): DiscordGateway {
  const client = new Client({ intents: [] });
  client.on(Events.InteractionCreate, (interaction) => void answer(interaction, handler).catch((error: Error) => console.error(`Discord interaction not answered: ${error.message.slice(0, 200)}`)));
  client.once(Events.ClientReady, () => {
    console.log("Discord: connected to the gateway.");
    new REST().setToken(token).put(Routes.applicationCommands(applicationId), { body: COMMAND_DEFINITIONS })
      .then(() => console.log(`Discord: ${COMMAND_DEFINITIONS.length} slash commands registered globally.`))
      .catch((error: Error) => console.error(`Discord commands not registered: ${error.message.slice(0, 200)}`));
  });
  const login = (): void => {
    client.login(token).catch((error: Error) => {
      console.error(`Discord login failed: ${error.message.slice(0, 200)}. Retrying in ${LOGIN_RETRY_MS / 1000} s.`);
      setTimeout(login, LOGIN_RETRY_MS).unref();
    });
  };
  login();
  return {
    ready: () => client.isReady(),
    sendDm: async (userId, content) => {
      try {
        const user = await client.users.fetch(userId);
        for (const part of chunks(content)) await user.send({ content: part, allowedMentions: NO_MENTIONS });
        return "SENT";
      } catch (error) {
        if (error instanceof DiscordAPIError && error.code === RESTJSONErrorCodes.CannotSendMessagesToThisUser) return "REFUSED";
        console.error(`Discord notice not sent: ${error instanceof Error ? error.message.slice(0, 120) : "unknown error"}`);
        return "FAILED";
      }
    },
    stop: () => client.destroy(),
  };
}
