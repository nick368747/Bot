const {
  Client,
  GatewayIntentBits,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  Events,
  REST,
  Routes,
  SlashCommandBuilder
} = require("discord.js");

const http = require("http");

// Render braucht einen offenen Port
const PORT = process.env.PORT || 10000;

http.createServer((req, res) => {
  res.writeHead(200);
  res.end("Discord Bot läuft!");
}).listen(PORT, () => {
  console.log(`Webserver läuft auf Port ${PORT}`);
});

// Discord-Bot
const client = new Client({
  intents: [GatewayIntentBits.Guilds]
});

let botAktiv = false;

// /panel Befehl
const command = new SlashCommandBuilder()
  .setName("panel")
  .setDescription("Zeigt das Bot-Steuerungsfeld an.");

client.once(Events.ClientReady, async () => {
  console.log(`Bot ist online als ${client.user.tag}`);

  const rest = new REST({ version: "10" })
    .setToken(process.env.DISCORD_TOKEN);

  await rest.put(
    Routes.applicationCommands(client.user.id),
    {
      body: [command.toJSON()]
    }
  );

  console.log("Slash-Befehl /panel registriert.");
});

client.on(Events.InteractionCreate, async (interaction) => {

  // /panel
  if (interaction.isChatInputCommand()) {

    if (interaction.commandName === "panel") {

      const button = new ButtonBuilder()
        .setCustomId("toggle_bot")
        .setLabel("🔴 BOT EINSCHALTEN")
        .setStyle(ButtonStyle.Success);

      const row = new ActionRowBuilder()
        .addComponents(button);

      await interaction.reply({
        content:
          "🎮 **Bot-Steuerung**\n" +
          "Der Minecraft-Bot ist momentan **AUS**.",
        components: [row]
      });
    }
  }

  // AN/AUS-Knopf
  if (interaction.isButton()) {

    if (interaction.customId === "toggle_bot") {

      botAktiv = !botAktiv;

      const button = new ButtonBuilder()
        .setCustomId("toggle_bot")
        .setLabel(
          botAktiv
            ? "🟢 BOT AUSSCHALTEN"
            : "🔴 BOT EINSCHALTEN"
        )
        .setStyle(
          botAktiv
            ? ButtonStyle.Danger
            : ButtonStyle.Success
        );

      const row = new ActionRowBuilder()
        .addComponents(button);

      await interaction.update({
        content: botAktiv
          ? "🎮 **Bot-Steuerung**\n🟢 Der Minecraft-Bot ist **AN**."
          : "🎮 **Bot-Steuerung**\n🔴 Der Minecraft-Bot ist **AUS**.",
        components: [row]
      });

      console.log(
        `Minecraft-Bot: ${botAktiv ? "AN" : "AUS"}`
      );
    }
  }
});

// Discord anmelden
client.login(process.env.DISCORD_TOKEN);
