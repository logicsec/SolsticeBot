import { Client, Events, GatewayIntentBits, PermissionFlagsBits, escapeMarkdown } from 'discord.js';
import { parseWowLinks, resolveWowLink } from './wowhead.js';

const { SOLSTICE_BOT_TOKEN, SOLSTICE_CHAT_CHANNEL_ID, SOLSTICE_DISCORD_WEBHOOK_URL } = process.env;
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
// Verified against Discord's World of Warcraft badge on the linked channel.
const gameOriginFlag = 1 << 16;
const wowApplicationId = '1384671873593512078';
const snowflake = /^\d{17,20}$/;
if (!snowflake.test(SOLSTICE_CHAT_CHANNEL_ID)) {
  console.error('Set SOLSTICE_CHAT_CHANNEL_ID to a Discord channel ID.');
  process.exit(1);
}

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent],
});
const queue = [];
let processing = false;
let webhookVerification;

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
    if (!SOLSTICE_DISCORD_WEBHOOK_URL) {
      console.log('Waiting for a Discord webhook URL to post Wowhead links.');
      return;
    }
    await verifyWebhook();
    console.log('Discord webhook verified for the WoW-linked channel.');
  } catch (error) {
    console.error('Discord channel check failed:', error.code ?? error.name);
  }
});
client.on(Events.Error, error => console.error('Discord connection error:', error.code ?? error.name));
client.on(Events.MessageCreate, message => {
  if (!SOLSTICE_DISCORD_WEBHOOK_URL || message.channelId !== SOLSTICE_CHAT_CHANNEL_ID || message.author.id === client.user?.id) return;
  if (message.applicationId !== wowApplicationId || !message.flags.has(gameOriginFlag)) return;
  const links = parseWowLinks(message.content);
  if (!links.length || queue.length >= 30) return;
  queue.push(links);
  void processQueue();
});

function webhookUrl() {
  let url;
  try { url = new URL(SOLSTICE_DISCORD_WEBHOOK_URL); } catch {}
  if (url?.origin !== 'https://discord.com' || url.username || url.password || url.search || url.hash ||
      !/^\/api(?:\/v10)?\/webhooks\/\d{17,20}\/[\w.-]+$/.test(url.pathname)) {
    throw new Error('InvalidDiscordWebhookUrl');
  }
  return url;
}

async function requestWebhook(url, options = {}) {
  const response = await fetch(url, { ...options, redirect: 'error', signal: AbortSignal.timeout(10000) });
  if (!response.ok) {
    const result = await response.json().catch(() => ({}));
    const error = new Error('DiscordWebhookRequestFailed');
    error.code = Number.isInteger(result.code) ? result.code : response.status;
    throw error;
  }
  return response.json();
}

function verifyWebhook() {
  webhookVerification ??= (async () => {
    const url = webhookUrl();
    const webhook = await requestWebhook(url);
    if (webhook.type !== 1 || webhook.channel_id !== SOLSTICE_CHAT_CHANNEL_ID) {
      throw new Error('WebhookIsNotInConfiguredChannel');
    }
    return url;
  })().catch(error => {
    webhookVerification = undefined;
    throw error;
  });
  return webhookVerification;
}

async function processQueue() {
  if (processing) return;
  processing = true;
  try {
    while (queue.length) {
      const links = queue.shift();
      try {
        const resolved = await Promise.all(links.map(resolveWowLink));
        if (!resolved.length) continue;
        const embeds = resolved.map(({ name, url, search }) => {
          const type = /\/(item|spell|talent|achievement|quest)=/.exec(new URL(url).pathname)?.[1];
          const category = search ? 'Search result' : type ? type[0].toUpperCase() + type.slice(1) : 'Game link';
          return {
            title: escapeMarkdown(name),
            url,
            color: 0xd7ac63,
            footer: { text: 'Wowhead Forever · ' + category },
          };
        });
        const url = new URL(await verifyWebhook());
        url.searchParams.set('wait', 'true');
        const posted = await requestWebhook(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            embeds,
            allowed_mentions: { parse: [] },
          }),
        });
        if (!posted.id || posted.channel_id !== SOLSTICE_CHAT_CHANNEL_ID) throw new Error('WebhookPostUnverified');
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
