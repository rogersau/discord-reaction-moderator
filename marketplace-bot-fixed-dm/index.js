require("dotenv").config();

const fs = require("fs");
const path = require("path");
const {
  Client,
  GatewayIntentBits,
  Partials,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  PermissionFlagsBits,
  Events,
} = require("discord.js");

const DATA_DIR = path.join(__dirname, "data");
const POSTS_FILE = path.join(DATA_DIR, "marketPosts.json");
const CONFIG_FILE = path.join(DATA_DIR, "marketConfig.json");
const LOGS_FILE = path.join(DATA_DIR, "tradeLogs.json");

function ensureDataFiles() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(POSTS_FILE)) fs.writeFileSync(POSTS_FILE, "[]");
  if (!fs.existsSync(CONFIG_FILE))
    fs.writeFileSync(
      CONFIG_FILE,
      JSON.stringify({ noticeChannelId: null, noticeMessageId: null }, null, 2),
    );
  if (!fs.existsSync(LOGS_FILE)) fs.writeFileSync(LOGS_FILE, "[]");
}

function readJson(file, fallback) {
  try {
    ensureDataFiles();
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch (err) {
    console.error(`Failed reading ${file}:`, err);
    return fallback;
  }
}

function writeJson(file, data) {
  ensureDataFiles();
  fs.writeFileSync(file, JSON.stringify(data, null, 2));
}

function getPosts() {
  return readJson(POSTS_FILE, []);
}
function savePosts(posts) {
  writeJson(POSTS_FILE, posts);
}
function getConfig() {
  return readJson(CONFIG_FILE, { noticeChannelId: null, noticeMessageId: null });
}
function saveConfig(config) {
  writeJson(CONFIG_FILE, config);
}
function getLogs() {
  return readJson(LOGS_FILE, []);
}
function saveLogs(logs) {
  writeJson(LOGS_FILE, logs);
}

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.DirectMessages,
  ],
  partials: [Partials.Channel],
});

const drafts = new Map();

function createNoticeRow() {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId("market_create")
      .setLabel("Create Marketplace Post")
      .setEmoji("💼")
      .setStyle(ButtonStyle.Primary),
  );
}

function createTypeRow() {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId("market_type_have")
      .setLabel("I have an item to trade")
      .setEmoji("📦")
      .setStyle(ButtonStyle.Success),
    new ButtonBuilder()
      .setCustomId("market_type_want")
      .setLabel("I am looking for an item")
      .setEmoji("🔎")
      .setStyle(ButtonStyle.Primary),
  );
}

function createServerRow() {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId("market_server_namalsk")
      .setLabel("Namalsk")
      .setEmoji("🧊")
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId("market_server_chernarus")
      .setLabel("Chernarus")
      .setEmoji("🌲")
      .setStyle(ButtonStyle.Secondary),
  );
}

function createPostRow(postId, closed = false) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`market_do_business_${postId}`)
      .setLabel("Do Business")
      .setEmoji("💼")
      .setStyle(ButtonStyle.Success)
      .setDisabled(closed),
    new ButtonBuilder()
      .setCustomId(`market_close_${postId}`)
      .setLabel("Close Post")
      .setEmoji("🔒")
      .setStyle(ButtonStyle.Danger)
      .setDisabled(closed),
  );
}

function createWarningRow(postId) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`market_confirm_business_${postId}`)
      .setLabel("Confirm & Do Business")
      .setEmoji("💼")
      .setStyle(ButtonStyle.Danger),
  );
}

function buildPostEmbed(post, closed = false) {
  const typeText = post.tradeType === "have" ? "Have item to trade" : "Looking for item";
  return new EmbedBuilder()
    .setTitle(closed ? "🔒 Marketplace Listing Closed" : "💼 Marketplace Listing")
    .setColor(closed ? 0x777777 : 0x2ecc71)
    .addFields(
      { name: "Type", value: typeText, inline: true },
      { name: "Server", value: post.server, inline: true },
      { name: "What do you have for trade?", value: post.have || "Not specified" },
      { name: "Is there something you are looking for?", value: post.want || "Not specified" },
      { name: "Extra info", value: post.extra || "None" },
      { name: "Posted by", value: `<@${post.ownerId}>` },
    )
    .setFooter({ text: `Post ID: ${post.id}` })
    .setTimestamp(new Date(post.createdAt));
}

function buildNoticeEmbed() {
  return new EmbedBuilder()
    .setTitle("💼 Marketplace Noticeboard")
    .setDescription(
      "Create a marketplace post for Namalsk or Chernarus. Click the button below to start.",
    )
    .setColor(0x3498db);
}

async function moveNoticeToBottom(channel) {
  const config = getConfig();

  if (config.noticeChannelId && config.noticeMessageId) {
    try {
      const oldChannel = await client.channels.fetch(config.noticeChannelId);
      const oldMessage = await oldChannel.messages.fetch(config.noticeMessageId);
      await oldMessage.delete().catch(() => null);
    } catch (_) {
      // Old notice missing is fine; we will create a new one.
    }
  }

  const noticeMessage = await channel.send({
    embeds: [buildNoticeEmbed()],
    components: [createNoticeRow()],
  });
  saveConfig({ noticeChannelId: channel.id, noticeMessageId: noticeMessage.id });
}

function userHasActivePost(userId) {
  return getPosts().some((post) => post.ownerId === userId && post.active);
}

function findPost(postId) {
  return getPosts().find((post) => post.id === postId);
}

async function logBusiness(interaction, post, dmSent = true, dmError = null) {
  const logs = getLogs();
  const entry = {
    id: `${Date.now()}-${interaction.user.id}`,
    timestamp: new Date().toISOString(),
    buyerId: interaction.user.id,
    buyerTag: interaction.user.tag,
    sellerId: post.ownerId,
    server: post.server,
    postId: post.id,
    channelId: post.channelId,
    messageId: post.messageId,
    tradeType: post.tradeType,
    dmSent,
    dmError,
    have: post.have,
    want: post.want,
  };

  logs.push(entry);
  saveLogs(logs.slice(-1000));

  const logChannelId = process.env.MARKET_LOG_CHANNEL_ID;
  if (logChannelId) {
    try {
      const logChannel = await client.channels.fetch(logChannelId);
      const embed = new EmbedBuilder()
        .setTitle("💼 Marketplace Business Logged")
        .setColor(0xf1c40f)
        .addFields(
          { name: "Interested user", value: `<@${entry.buyerId}> (${entry.buyerTag})` },
          { name: "Post owner", value: `<@${entry.sellerId}>` },
          { name: "Server", value: entry.server, inline: true },
          { name: "Post ID", value: entry.postId, inline: true },
          { name: "DM sent", value: entry.dmSent ? "Yes" : "No", inline: true },
          { name: "Have", value: entry.have || "Not specified" },
          { name: "Looking for", value: entry.want || "Not specified" },
        )
        .setTimestamp(new Date(entry.timestamp));
      await logChannel.send({ embeds: [embed] });
    } catch (err) {
      console.error("Failed to send marketplace log channel message:", err.message);
    }
  }
}

client.once(Events.ClientReady, () => {
  ensureDataFiles();
  console.log(`Marketplace bot online as ${client.user.tag}`);
});

client.on(Events.InteractionCreate, async (interaction) => {
  try {
    if (interaction.isChatInputCommand()) {
      if (interaction.commandName === "marketsetup") {
        await moveNoticeToBottom(interaction.channel);
        return interaction.reply({
          content: "Marketplace noticeboard button has been created/reset in this channel.",
          ephemeral: true,
        });
      }

      if (interaction.commandName === "marketlogs") {
        const amount = interaction.options.getInteger("amount") || 10;
        const logs = getLogs().slice(-amount).reverse();

        if (!logs.length) {
          return interaction.reply({
            content: "No marketplace business logs found yet.",
            ephemeral: true,
          });
        }

        const description = logs
          .map((log, index) => {
            const time = Math.floor(new Date(log.timestamp).getTime() / 1000);
            return `**${index + 1}.** <@${log.buyerId}> clicked Do Business with <@${log.sellerId}>\nServer: **${log.server}** | Post: \`${log.postId}\` | <t:${time}:R>`;
          })
          .join("\n\n");

        const embed = new EmbedBuilder()
          .setTitle("💼 Recent Marketplace Business Logs")
          .setDescription(description)
          .setColor(0xf1c40f)
          .setTimestamp();

        return interaction.reply({ embeds: [embed], ephemeral: true });
      }
    }

    if (interaction.isButton()) {
      if (interaction.customId === "market_create") {
        if (userHasActivePost(interaction.user.id)) {
          return interaction.reply({
            content:
              "You already have an active marketplace post. Please close it before creating another.",
            ephemeral: true,
          });
        }

        return interaction.reply({
          content: "What type of marketplace post do you want to create?",
          components: [createTypeRow()],
          ephemeral: true,
        });
      }

      if (
        interaction.customId === "market_type_have" ||
        interaction.customId === "market_type_want"
      ) {
        drafts.set(interaction.user.id, {
          tradeType: interaction.customId === "market_type_have" ? "have" : "want",
        });

        return interaction.update({
          content: "Which server is this for?",
          components: [createServerRow()],
        });
      }

      if (
        interaction.customId === "market_server_namalsk" ||
        interaction.customId === "market_server_chernarus"
      ) {
        const draft = drafts.get(interaction.user.id) || {};
        draft.server = interaction.customId === "market_server_namalsk" ? "Namalsk" : "Chernarus";
        drafts.set(interaction.user.id, draft);

        const modal = new ModalBuilder()
          .setCustomId("market_create_modal")
          .setTitle("Create Marketplace Post");

        const haveInput = new TextInputBuilder()
          .setCustomId("have")
          .setLabel("What do you have for trade?")
          .setStyle(TextInputStyle.Paragraph)
          .setRequired(draft.tradeType === "have")
          .setMaxLength(900)
          .setPlaceholder("Example: M4A1, plate carrier, NVGs, nails, tools");

        const wantInput = new TextInputBuilder()
          .setCustomId("want")
          .setLabel("Is there something you are looking for?")
          .setStyle(TextInputStyle.Paragraph)
          .setRequired(draft.tradeType === "want")
          .setMaxLength(900)
          .setPlaceholder("Example: Looking for NVGs, ammo, base building supplies");

        const extraInput = new TextInputBuilder()
          .setCustomId("extra")
          .setLabel("Extra info")
          .setStyle(TextInputStyle.Paragraph)
          .setRequired(false)
          .setMaxLength(700)
          .setPlaceholder("Example: Safe zone trade only, evenings AU time, serious offers only");

        modal.addComponents(
          new ActionRowBuilder().addComponents(haveInput),
          new ActionRowBuilder().addComponents(wantInput),
          new ActionRowBuilder().addComponents(extraInput),
        );

        return interaction.showModal(modal);
      }

      if (interaction.customId.startsWith("market_do_business_")) {
        const postId = interaction.customId.replace("market_do_business_", "");
        const post = findPost(postId);

        if (!post || !post.active) {
          return interaction.reply({
            content: "This marketplace post is no longer active.",
            ephemeral: true,
          });
        }

        if (interaction.user.id === post.ownerId) {
          return interaction.reply({
            content: "You cannot do business with your own post.",
            ephemeral: true,
          });
        }

        const warning = [
          "⚠️ **Marketplace Notice**",
          "",
          "All trades arranged through this Discord marketplace must follow server rules.",
          "",
          "**Scamming, misleading, betraying, or setting players up through marketplace deals may result in a ban.**",
          "",
          "Only continue if you agree to do business fairly.",
        ].join("\n");

        return interaction.reply({
          content: warning,
          components: [createWarningRow(postId)],
          ephemeral: true,
        });
      }

      if (interaction.customId.startsWith("market_confirm_business_")) {
        const postId = interaction.customId.replace("market_confirm_business_", "");
        const post = findPost(postId);

        if (!post || !post.active) {
          return interaction.update({
            content: "This marketplace post is no longer active.",
            components: [],
          });
        }

        if (interaction.user.id === post.ownerId) {
          return interaction.update({
            content: "You cannot do business with your own post.",
            components: [],
          });
        }

        // Acknowledge the button immediately so Discord does not time out while the bot sends DMs/logs.
        await interaction.deferUpdate();

        let dmSent = false;
        let dmError = null;

        try {
          const owner = await client.users.fetch(post.ownerId);
          await owner.send({
            content: [
              "💼 **Someone wants to do business with you!**",
              "",
              `User: <@${interaction.user.id}> (${interaction.user.tag})`,
              `Server: **${post.server}**`,
              "",
              "**Marketplace post:**",
              `Have: ${post.have || "Not specified"}`,
              `Looking for: ${post.want || "Not specified"}`,
              "",
              "You can DM them directly or add them as a Discord friend.",
              "",
              "**Reminder:** Trades arranged through the Discord marketplace must follow server rules.",
            ].join("\n"),
          });
          dmSent = true;
          console.log(
            `Marketplace DM sent: ${interaction.user.tag} -> ${post.ownerTag || post.ownerId} | Post ${post.id}`,
          );
        } catch (err) {
          dmError = err;
          console.error("Failed sending marketplace DM:", err);
        }

        try {
          await logBusiness(interaction, post, dmSent, dmError ? dmError.message : null);
        } catch (err) {
          console.error("Failed writing marketplace business log:", err);
        }

        if (dmSent) {
          return interaction.editReply({
            content:
              "✅ The poster has been notified by DM. This action has been logged for admins.",
            components: [],
          });
        }

        return interaction.editReply({
          content:
            "⚠️ I logged your interest, but I could not DM the poster. They may have DMs disabled. Please contact an admin if needed.",
          components: [],
        });
      }

      if (interaction.customId.startsWith("market_close_")) {
        const postId = interaction.customId.replace("market_close_", "");
        const posts = getPosts();
        const post = posts.find((p) => p.id === postId);

        if (!post || !post.active) {
          return interaction.reply({
            content: "This post is already closed or could not be found.",
            ephemeral: true,
          });
        }

        const isOwner = interaction.user.id === post.ownerId;
        const isAdmin = interaction.member.permissions.has(PermissionFlagsBits.ManageMessages);

        if (!isOwner && !isAdmin) {
          return interaction.reply({
            content: "You cannot close this post. Only the original poster or admins can close it.",
            ephemeral: true,
          });
        }

        post.active = false;
        post.closedAt = new Date().toISOString();
        post.closedBy = interaction.user.id;
        savePosts(posts);

        await interaction.message.edit({
          embeds: [buildPostEmbed(post, true)],
          components: [createPostRow(post.id, true)],
        });
        return interaction.reply({ content: "Marketplace post closed.", ephemeral: true });
      }
    }

    if (interaction.isModalSubmit()) {
      if (interaction.customId === "market_create_modal") {
        if (userHasActivePost(interaction.user.id)) {
          drafts.delete(interaction.user.id);
          return interaction.reply({
            content:
              "You already have an active marketplace post. Please close it before creating another.",
            ephemeral: true,
          });
        }

        const draft = drafts.get(interaction.user.id);
        if (!draft || !draft.server || !draft.tradeType) {
          return interaction.reply({
            content: "Your marketplace draft expired. Please click Create Marketplace Post again.",
            ephemeral: true,
          });
        }

        const post = {
          id: Date.now().toString(),
          ownerId: interaction.user.id,
          ownerTag: interaction.user.tag,
          tradeType: draft.tradeType,
          server: draft.server,
          have: interaction.fields.getTextInputValue("have") || "",
          want: interaction.fields.getTextInputValue("want") || "",
          extra: interaction.fields.getTextInputValue("extra") || "",
          channelId: interaction.channel.id,
          messageId: null,
          active: true,
          createdAt: new Date().toISOString(),
        };

        const message = await interaction.channel.send({
          embeds: [buildPostEmbed(post)],
          components: [createPostRow(post.id)],
        });
        post.messageId = message.id;

        const posts = getPosts();
        posts.push(post);
        savePosts(posts);
        drafts.delete(interaction.user.id);

        await moveNoticeToBottom(interaction.channel);
        return interaction.reply({ content: "Marketplace post created.", ephemeral: true });
      }
    }
  } catch (err) {
    console.error("Interaction error:", err);
    if (!interaction.replied && !interaction.deferred) {
      await interaction
        .reply({ content: "Something went wrong. Please contact an admin.", ephemeral: true })
        .catch(() => null);
    }
  }
});

const { TOKEN } = process.env;
if (!TOKEN) {
  console.error("Missing TOKEN in .env");
  process.exit(1);
}

client.login(TOKEN);
