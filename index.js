import { Client, Events, GatewayIntentBits, MessageFlags, escapeMarkdown } from 'discord.js';
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

client.once(Events.ClientReady, ready => console.log('Solstice bot connected as ' + ready.user.username));
client.on(Events.Error, error => console.error('Discord connection error:', error.code ?? error.name));
client.on(Events.MessageCreate, message => {
  if (message.channelId !== SOLSTICE_CHAT_CHANNEL_ID || message.author.id === client.user?.id) return;
  const relayId = message.webhookId ?? message.author.id;
  if (SOLSTICE_RELAY_ID && relayId !== SOLSTICE_RELAY_ID) return;
  const links = parseWowLinks(message.content);
  if (!SOLSTICE_RELAY_ID) {
    if (links.length && (message.webhookId || message.author.bot)) {
      console.log('Relay candidate ID:', relayId);
    }
    return;
  }
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
        const resolved = await Promise.all(links.map(resolveWowLink));
        const content = resolved.map(({ name, url, search }) =>
          '[' + escapeMarkdown(name) + (search ? ' (Wowhead search)' : '') + '](' + url + ')'
        ).join(' · ');
        await message.reply({
          content,
          flags: MessageFlags.SuppressEmbeds,
          allowedMentions: { parse: [], repliedUser: false },
          failIfNotExists: false,
        });
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
