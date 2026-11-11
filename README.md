# Solstice guild chat bot

The bot listens in one Discord channel and replies to a configured WoW relay with Wowhead Forever links. It handles adjacent bracketed names, raw WoW hyperlink IDs, items, and spells. Exact matches become direct links. Names without a unique match become labeled Wowhead searches.

1. Open the [Discord Developer Portal](https://discord.com/developers/applications) and create a separate application named Solstice Guild Bot. Open **Bot**, enable **Message Content Intent**, and generate a bot token. Store it as a secret. Discord sign-in for the Solstice website uses a separate credential.
2. Open **Installation**, enable **Guild Install**, and use the `bot` scope with **View Channel**, **Read Message History**, and **Send Messages**. Install the app in the Solstice server. Check that those permissions are allowed in the linked WoW chat channel.
3. In Discord settings, turn on **Advanced → Developer Mode**. Right-click the linked guild-chat channel and copy its channel ID. Set `SOLSTICE_CHAT_CHANNEL_ID` to that ID and `SOLSTICE_BOT_TOKEN` to the bot token in your local environment or deployment secrets.
4. Start the bot. If you don't know the relay's ID, leave `SOLSTICE_RELAY_ID` unset. This enables discovery mode. Link an item from WoW and look for **Relay candidate ID** in the bot logs. Set `SOLSTICE_RELAY_ID` to the printed ID and restart. The bot accepts only that sender or webhook in the configured channel.
5. In WoW guild chat, link Reverence and Holy Conduit. Discord should get one reply with two links.

From the repository root:

```sh
npm ci
npm start
```

For a Docker deployment, build with the repository root as the context and inject the three variables at runtime. For example, from the repository root:

```sh
docker build -t solstice-chat-bot .
docker run -d --name solstice-chat-bot --restart unless-stopped \
  --env-file /path/to/solstice-bot.env solstice-chat-bot
```

The bot resolves name-only messages through Wowhead Forever search. The two example links are verified and built in. If the relay sends only chat, its messages can support a recent WoW activity view. Confirmed online presence would require login/logout or roster data.

## Komodo

Create a Git-backed stack for `logicsec/SolsticeBot` using branch `main` and `compose.yaml`. Deploy with image rebuilds enabled. The service needs no published ports. It waits for configuration if the token or channel ID is absent. Put the bot token in a Komodo secret and reference it from the stack environment. Add the channel ID, redeploy, and use discovery mode to identify the relay before enabling replies.
