# DayZ Marketplace Bot - Warning + Admin Logs

A Discord.js v14 marketplace noticeboard bot.

## Features

- `/marketsetup` posts/resets the marketplace noticeboard button
- Users choose post type first:
  - I have an item to trade
  - I am looking for an item
- Users choose server:
  - Namalsk
  - Chernarus
- No `Both` server option
- Marketplace form asks:
  - What do you have for trade?
  - Is there something you are looking for?
  - Extra info
- One active marketplace post per user
- `Do Business 💼` button
- Warning/confirmation before notifying the poster
- DM is sent to the original poster after confirmation
- Admin logs:
  - Saved to `data/tradeLogs.json`
  - Viewable with `/marketlogs`
  - Optional log channel using `MARKET_LOG_CHANNEL_ID`
- Only original poster or users with `Manage Messages` can close posts
- Noticeboard create button moves underneath the latest post

## Install

Upload this folder/zip to your VPS.

```bash
cd ~/marketplace-bot
npm install
cp .env.example .env
nano .env
```

Fill in:

```env
TOKEN=your_bot_token_here
CLIENT_ID=your_application_id_here
GUILD_ID=your_discord_server_id_here
MARKET_LOG_CHANNEL_ID=
```

`MARKET_LOG_CHANNEL_ID` is optional. If you create a private admin channel like `#marketplace-logs`, right-click the channel, copy its ID, and put it there.

## Deploy commands

```bash
node deploy-commands.js
```

## Start bot

```bash
node index.js
```

Or with PM2:

```bash
pm2 start index.js --name marketplace-bot
pm2 save
```

## Discord setup

Run this in the marketplace channel:

```text
/marketsetup
```

Admins can check logs with:

```text
/marketlogs
```

or:

```text
/marketlogs amount:20
```

## Required bot permissions

Invite the bot with:

- `bot`
- `applications.commands`

Bot permissions:

- Send Messages
- Embed Links
- Read Message History
- Use Slash Commands

## Important

The bot checks admin close/log permissions using `Manage Messages`.
