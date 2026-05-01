# First-Time Deploy with the Cloudflare Button

This guide is for someone who has never used Cloudflare before and wants to use the **Deploy to Cloudflare** button instead of the command line. Follow it in order and you will end up with this project deployed on Cloudflare Workers, connected to Discord, and ready for ticket panels, transcripts, blocklists, and timed roles.

If you already use Cloudflare Workers regularly, you can go back to [README.md](./README.md) and use the shorter setup section there.

## Before you start

You need:

- A Cloudflare account
- A GitHub account
- A Discord account with permission to create an application and bot

You do **not** need Node.js, `git`, `pnpm`, or Wrangler for this guide.

## 1. Create your Cloudflare account

1. Go to [dash.cloudflare.com/sign-up/workers-and-pages](https://dash.cloudflare.com/sign-up/workers-and-pages).
2. Create your account and verify your email if Cloudflare asks you to.
3. Log in and make sure you can reach the Cloudflare dashboard.

> Screenshot placeholder: Cloudflare dashboard home after the first successful login.

## 2. Create your Discord bot first

Before you press the deploy button, create your Discord app so you have the values Cloudflare will ask for.

1. Open [discord.com/developers/applications](https://discord.com/developers/applications).
2. Create a new application.
3. Open the application and create a bot user.
4. Copy these values somewhere safe:
   - Bot token
   - Application ID
   - Public key
   - Bot user ID

Recommended bot permissions for the full feature set:

- View Channels
- Send Messages
- Embed Links
- Read Message History
- Manage Messages
- Manage Channels
- Attach Files
- Manage Roles

`Manage Messages` is used for reaction moderation. `Manage Roles` is used for timed roles. The ticket system needs the channel and message permissions so it can create channels, post messages, and upload transcripts.

> Screenshot placeholder: Discord Developer Portal page showing Application ID, Public Key, and Bot Token areas.

## 3. Open the Deploy to Cloudflare flow

Go to [README.md](./README.md) and click the **Deploy to Cloudflare** button near the top.

Cloudflare will ask you to authorize access and import the project into your account.

> Screenshot placeholder: Deploy to Cloudflare button on the GitHub README.

## 4. Review the project details in Cloudflare

Cloudflare will show you a project setup screen before deployment. Read through it carefully.

At this stage, you are usually confirming:

- the Worker name Cloudflare will create
- the GitHub repository being deployed
- the environment variables and secrets Cloudflare expects
- any bindings already defined by the project config

If Cloudflare offers a different Worker name than you want, change it here before continuing.

> Screenshot placeholder: Cloudflare import or project review screen before deployment.

## 5. Enter the Discord values Cloudflare asks for

Use the values you copied from Discord.

Public values you should set:

- `BOT_USER_ID`
- `DISCORD_PUBLIC_KEY`
- `DISCORD_APPLICATION_ID`

Secret values you should set:

- `DISCORD_BOT_TOKEN`
- `ADMIN_UI_PASSWORD`
- `ADMIN_SESSION_SECRET`

Optional secret:

- `ADMIN_AUTH_SECRET`

What these do:

- `DISCORD_BOT_TOKEN`: your bot's private token
- `ADMIN_UI_PASSWORD`: the password you will use on `/admin/login`
- `ADMIN_SESSION_SECRET`: a long random secret used to sign admin session cookies
- `ADMIN_AUTH_SECRET`: only needed if you still want the legacy bearer-auth admin routes

For `ADMIN_SESSION_SECRET`, use a long random string and keep it somewhere safe.

> Screenshot placeholder: Cloudflare environment variable and secret entry screen.

## 6. Create the transcript bucket if Cloudflare asks for it

This project stores HTML ticket transcripts in **Cloudflare R2** using the bucket name `discord-automation-workers-transcripts`.

If the deploy flow asks you to connect or select an existing R2 bucket, create or choose a bucket with that exact name.

If the deploy finishes without creating that bucket for you, go to **R2** in your Cloudflare dashboard right after deployment and create:

```text
discord-automation-workers-transcripts
```

This keeps the default project config working without extra edits.

> Screenshot placeholder: R2 bucket picker or R2 dashboard showing the transcript bucket.

## 7. Finish the deployment

Continue through the Cloudflare screens and start the deploy.

On the first deploy, Cloudflare should:

- create your Worker
- apply the Durable Object migrations
- attach the cron trigger
- give you a public Worker URL

Save the Worker URL. It will look similar to:

```text
https://your-worker-name.your-subdomain.workers.dev
```

> Screenshot placeholder: Cloudflare deployment success screen with the Worker URL.

## 8. Tell Discord where your interactions endpoint lives

In the Discord Developer Portal, set **Interactions Endpoint URL** to:

```text
https://your-worker-url.workers.dev/interactions
```

Discord validates the endpoint immediately. If validation fails, double-check:

- the Worker URL
- `DISCORD_PUBLIC_KEY`
- that the Worker finished deploying successfully

> Screenshot placeholder: Discord Interactions Endpoint URL field with the Worker URL filled in.

## 9. Open the admin dashboard

Visit:

```text
https://your-worker-url.workers.dev/admin/login
```

Sign in with the password you saved in `ADMIN_UI_PASSWORD`.

From there you can:

- verify the gateway is running
- trigger a manual bootstrap if you do not want to wait for the cron
- manage blocklists and timed roles
- configure one ticket panel per guild

> Screenshot placeholder: Admin login screen or dashboard landing page.

## 10. Set up ticket panels

Inside the admin dashboard, load the guild you want to configure and then:

1. Choose the panel channel.
2. Choose the ticket category.
3. Choose the transcript channel.
4. Add one or more ticket types.
5. Save and publish the panel.

When someone closes a ticket, the Worker uploads a plain-text transcript into the transcript channel and can also serve the HTML version from:

```text
https://your-worker-url.workers.dev/transcripts/<guildId>/<channelId>
```

> Screenshot placeholder: Admin dashboard ticket configuration page with panel, category, and transcript channel selected.

## 11. Quick checks if something is not working

Common first-time mistakes:

- pressing the deploy button before creating the Discord bot values
- pasting the wrong Discord public key
- forgetting to create or connect the transcript R2 bucket
- setting the wrong Worker URL in Discord
- forgetting to invite the bot to your server with the required permissions

## Optional: use the command line later

If you later want to edit or redeploy from your machine, then use the local setup in [README.md](./README.md). That path uses `pnpm` and Wrangler, but it is optional for getting started.
