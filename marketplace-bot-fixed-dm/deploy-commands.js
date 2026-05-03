require("dotenv").config();
const { REST, Routes, SlashCommandBuilder, PermissionFlagsBits } = require("discord.js");

const commands = [
  new SlashCommandBuilder()
    .setName("marketsetup")
    .setDescription("Post or reset the Marketplace noticeboard button in this channel.")
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages),
  new SlashCommandBuilder()
    .setName("marketlogs")
    .setDescription("Show recent marketplace do-business logs.")
    .addIntegerOption((option) =>
      option
        .setName("amount")
        .setDescription("How many logs to show, max 20.")
        .setMinValue(1)
        .setMaxValue(20)
        .setRequired(false),
    )
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages),
].map((command) => command.toJSON());

const { TOKEN, CLIENT_ID, GUILD_ID } = process.env;

if (!TOKEN || !CLIENT_ID || !GUILD_ID) {
  console.error("Missing TOKEN, CLIENT_ID or GUILD_ID in .env");
  process.exit(1);
}

const rest = new REST({ version: "10" }).setToken(TOKEN);

(async () => {
  try {
    console.log("Deploying slash commands...");
    await rest.put(Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID), { body: commands });
    console.log("Slash commands deployed.");
  } catch (error) {
    console.error(error);
    process.exit(1);
  }
})();
