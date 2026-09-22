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

const mineflayer = require("mineflayer");
const http = require("http");

const PORT = process.env.PORT || 10000;

// Discord-Kanal für Minecraft-Chat
const MINECRAFT_CHAT_CHANNEL_ID = "1552068948676059146";

http.createServer((req, res) => {
  res.writeHead(200);
  res.end("Bot läuft!");
}).listen(PORT, () => {
  console.log(`Webserver läuft auf Port ${PORT}`);
});

const client = new Client({
  intents: [GatewayIntentBits.Guilds]
});

let mcBot = null;
let botAktiv = false;
let verbindetSich = false;

const command = new SlashCommandBuilder()
  .setName("panel")
  .setDescription("Zeigt das Bot-Steuerungsfeld an.");

client.once(Events.ClientReady, async () => {
  console.log(`Discord-Bot online als ${client.user.tag}`);

  const rest = new REST({ version: "10" })
    .setToken(process.env.DISCORD_TOKEN);

  await rest.put(
    Routes.applicationCommands(client.user.id),
    {
      body: [command.toJSON()]
    }
  );

  console.log("/panel registriert.");
});

function minecraftStarten() {
  if (mcBot || verbindetSich) return;

  verbindetSich = true;

  console.log("FrozenRun verbindet sich mit BlockBande...");

  mcBot = mineflayer.createBot({
    host: "blockbande.de",
    port: 25565,
    username: "FrozenRun",
    auth: "microsoft"
  });

  mcBot.once("spawn", () => {
    verbindetSich = false;
    console.log("✅ FrozenRun ist jetzt online auf BlockBande!");

    const channel = client.channels.cache.get(MINECRAFT_CHAT_CHANNEL_ID);

    if (channel) {
      channel.send("🟢 **FrozenRun ist jetzt auf Minecraft online!**");
    }
  });

  // Minecraft-Chat → Discord
  mcBot.on("chat", (username, message) => {
    if (username === mcBot.username) return;

    const channel = client.channels.cache.get(MINECRAFT_CHAT_CHANNEL_ID);

    if (channel) {
      channel.send(`💬 **${username}:** ${message}`);
    }
  });

  mcBot.on("error", (err) => {
    console.log("Minecraft-Fehler:", err.message);
  });

  mcBot.on("end", () => {
    console.log("FrozenRun wurde getrennt.");

    const channel = client.channels.cache.get(MINECRAFT_CHAT_CHANNEL_ID);

    if (channel) {
      channel.send("🔴 **FrozenRun wurde von Minecraft getrennt.**");
    }

    mcBot = null;
    verbindetSich = false;
    botAktiv = false;
  });
}

function minecraftStoppen() {
  if (mcBot) {
    console.log("FrozenRun wird getrennt...");
    mcBot.quit("Bot ausgeschaltet");
    mcBot = null;
  }

  verbindetSich = false;
  botAktiv = false;
}

client.on(Events.InteractionCreate, async (interaction) => {

  if (interaction.isChatInputCommand()) {
    if (interaction.commandName === "panel") {

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

      await interaction.reply({
        content:
          "🎮 **FrozenRun Steuerung**\n" +
          (botAktiv
            ? "🟢 FrozenRun ist **AN**."
            : "🔴 FrozenRun ist **AUS**."),
        components: [row]
      });
    }
  }

  if (interaction.isButton()) {
    if (interaction.customId === "toggle_bot") {

      if (!botAktiv) {
        botAktiv = true;
        minecraftStarten();
      } else {
        minecraftStoppen();
      }

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
        content:
          "🎮 **FrozenRun Steuerung**\n" +
          (botAktiv
            ? "🟢 FrozenRun verbindet sich mit **BlockBande.de**."
            : "🔴 FrozenRun ist **AUS**."),
        components: [row]
      });
    }
  }
});

client.login(process.env.DISCORD_TOKEN);

