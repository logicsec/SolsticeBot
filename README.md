# SolsticeBot

SolsticeBot reads World of Warcraft messages in the Discord guild-chat-linked channel and posts Wowhead Forever links in the same Discord channel using an incoming webhook. Discord marks native WoW messages with a game-origin flag and application ID. Ordinary Discord messages are ignored.

## Discord and Komodo setup

1. Install the bot in the Discord server and enable **Message Content Intent** in the Discord Developer Portal. Give it **View Channel** and **Read Message History** for the linked channel.
2. In the same channel, open **Edit Channel → Integrations → Webhooks** and create an incoming webhook.
3. Store the token and webhook URL as secret variables in Komodo. Set the stack environment as follows.

```dotenv
SOLSTICE_BOT_TOKEN=[[SOLSTICE_BOT_TOKEN]]
SOLSTICE_CHAT_CHANNEL_ID=<linked channel ID>
SOLSTICE_DISCORD_WEBHOOK_URL=[[SOLSTICE_DISCORD_WEBHOOK_URL]]
```

4. Deploy the stack using `compose.yaml` and the existing `main-router` network. The bot logs whether Discord confirmed the webhook belongs to the configured channel.
5. Send an item link from WoW guild chat. A successful webhook post logs the number of links posted. The webhook output is for Discord readers.

The bot uses native link IDs when available and tries exact Wowhead Forever matches for names. Unresolved names get a Wowhead search link.
