import { Client, Events, GatewayIntentBits, MessageFlags, Routes, PermissionFlagsBits, escapeMarkdown } from 'discord.js';
import { parseWowLinks, resolveWowLink } from './wowhead.js';

const { SOLSTICE_BOT_TOKEN, SOLSTICE_CHAT_CHANNEL_ID, SOLSTICE_RELAY_ID } = process.env;
if (!SOLSTICE_BOT_TOKEN || !SOLSTICE_CHAT_CHANNEL_ID) {
  console.log('Waiting for Discord bot token and channel ID. Add the settings and redeploy to connect.');
  await new Promise(resolve => {
    const keepAlive = setInterval(() => {}, 60_000);
    for (const signal of ['SIGTERM', 'SIGINT']) process.once(signal, () => {
      clearInterval(keepAlive);
      resolve();
    });
  });
  process.exit(0);
}
const snowflake = /^\d{17,20}$/;
if (!snowflake.test(SOLSTICE_CHAT_CHANNEL_ID) || (SOLSTICE_RELAY_ID && !snowflake.test(SOLSTICE_RELAY_ID))) {
  console.error('Set SOLSTICE_BOT_TOKEN and SOLSTICE_CHAT_CHANNEL_ID. If provided, SOLSTICE_RELAY_ID must be a Discord ID.');
  process.exit(1);
}

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent],
});
const queue = [];
let processing = false;

client.once(Events.ClientReady, async ready => {
  console.log('Solstice bot connected as ' + ready.user.username);
  try {
    const channel = await ready.channels.fetch(SOLSTICE_CHAT_CHANNEL_ID);
    if (!channel?.isTextBased() || !channel.guild) {
      console.error('Configured Discord channel is unavailable or is not a guild text channel.');
      return;
    }
    const permissions = channel.permissionsFor(ready.user);
    const view = Boolean(permissions?.has(PermissionFlagsBits.ViewChannel));
    const history = Boolean(permissions?.has(PermissionFlagsBits.ReadMessageHistory));
    const send = Boolean(permissions?.has(channel.isThread() ? PermissionFlagsBits.SendMessagesInThreads : PermissionFlagsBits.SendMessages));
    console.log('Discord channel access:', JSON.stringify({ view, history, send }));
    if (view && history) {
      const messages = await ready.rest.get(Routes.channelMessages(channel.id), { query: new URLSearchParams({ limit: '20' }) });
      for (const message of messages) {
        const badgeExample = message.content === "I still don't see it in the channel";
        const metadata = Object.fromEntries(Object.entries(message).filter(([key, value]) =>
          /lobby|game|application_id|source|additional_name|flags|^type$/.test(key) &&
          (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'string')
        ));
        console.log('Discord message origin:', JSON.stringify({ badgeExample, metadata, keys: Object.keys(message).sort() }));
      }
    }
  } catch (error) {
    console.error('Discord channel check failed:', error.code ?? error.name);
  }
});
client.on(Events.Error, error => console.error('Discord connection error:', error.code ?? error.name));
client.on(Events.MessageCreate, message => {
  if (message.channelId !== SOLSTICE_CHAT_CHANNEL_ID || message.author.id === client.user?.id) return;
  // Reply only after the native WoW origin marker has been verified.
  if (!SOLSTICE_RELAY_ID) return;
  const relayId = message.webhookId ?? message.author.id;
  if (SOLSTICE_RELAY_ID && relayId !== SOLSTICE_RELAY_ID) return;
  const links = parseWowLinks(message.content);
  if (!links.length || queue.length >= 30) return;
  queue.push({ message, links });
  void processQueue();
});

async function processQueue() {
  if (processing) return;
  processing = true;
  try {
    while (queue.length) {
      const { message, links } = queue.shift();
      try {
        const resolved = (await Promise.all(links.map(resolveWowLink)))
          .filter(link => SOLSTICE_RELAY_ID || !link.search);
        if (!resolved.length) continue;
        const content = resolved.map(({ name, url, search }) =>
          '[' + escapeMarkdown(name) + (search ? ' (Wowhead search)' : '') + '](' + url + ')'
        ).join(' · ');
        await message.reply({
          content,
          flags: MessageFlags.SuppressEmbeds,
          allowedMentions: { parse: [], repliedUser: false },
          failIfNotExists: false,
        });
        console.log('Posted Wowhead links:', resolved.length);
      } catch (error) {
        console.error('Could not post item links:', error.code ?? error.name);
      }
    }
  } finally {
    processing = false;
  }
}

for (const signal of ['SIGTERM', 'SIGINT']) process.once(signal, () => {
  client.destroy();
  process.exit(0);
});
await client.login(SOLSTICE_BOT_TOKEN).catch(error => {
  console.error('Discord login failed:', error.code ?? error.name);
  process.exit(1);
});
