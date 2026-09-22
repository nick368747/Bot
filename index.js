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

// ===============================
// EINSTELLUNGEN
// ===============================

const MINECRAFT_CHAT_CHANNEL_ID = "1552068948676059146";

const MC_HOST = "blockbande.de";
const MC_PORT = 25565;
const MC_USERNAME = "FrozenRun";

// ===============================
// WEB SERVER FÜR RENDER
// ===============================

http.createServer((req, res) => {
  res.writeHead(200);
  res.end("FrozenRun läuft!");
}).listen(PORT, () => {
  console.log(`Webserver läuft auf Port ${PORT}`);
});

// ===============================
// DISCORD
// ===============================

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds
  ]
});

let mcBot = null;
let botAktiv = false;
let verbindetSich = false;

// ===============================
// /panel
// ===============================

const command = new SlashCommandBuilder()
  .setName("panel")
  .setDescription("Öffnet das FrozenRun Steuerungspanel.");

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

// ===============================
// DISCORD-KANAL
// ===============================

function getChatChannel() {
  return client.channels.cache.get(
    MINECRAFT_CHAT_CHANNEL_ID
  );
}

// ===============================
// STATUS
// ===============================

function getStatusText() {

  if (verbindetSich) {
    return "🟡 **Verbindet sich...**";
  }

  if (mcBot && botAktiv) {
    return "🟢 **Online**";
  }

  return "🔴 **Offline**";
}

// ===============================
// PANEL
// ===============================

function createPanel() {

  const botButton = new ButtonBuilder()
    .setCustomId("toggle_bot")
    .setLabel(
      botAktiv
        ? "🔴 Bot ausschalten"
        : "🟢 Bot einschalten"
    )
    .setStyle(
      botAktiv
        ? ButtonStyle.Danger
        : ButtonStyle.Success
    );

  const statusButton = new ButtonBuilder()
    .setCustomId("status")
    .setLabel("📊 Status")
    .setStyle(ButtonStyle.Primary);

  const chatButton = new ButtonBuilder()
    .setCustomId("chat")
    .setLabel("💬 Chat")
    .setStyle(ButtonStyle.Secondary);

  const reconnectButton = new ButtonBuilder()
    .setCustomId("reconnect")
    .setLabel("🔄 Neu verbinden")
    .setStyle(ButtonStyle.Secondary);

  const stopButton = new ButtonBuilder()
    .setCustomId("stop_bot")
    .setLabel("🛑 Stoppen")
    .setStyle(ButtonStyle.Danger);

  const row1 = new ActionRowBuilder()
    .addComponents(
      botButton,
      statusButton,
      chatButton
    );

  const row2 = new ActionRowBuilder()
    .addComponents(
      reconnectButton,
      stopButton
    );

  return [row1, row2];
}

function getPanelText() {

  return (
    "🎮 **FrozenRun – Steuerung**\n\n" +
    `**Status:** ${getStatusText()}\n` +
    `**Server:** \`${MC_HOST}\`\n` +
    `**Minecraft:** \`${MC_USERNAME}\`\n\n` +
    "💬 **Chat:** Minecraft → Discord\n" +
    "🔄 **Neu verbinden:** Minecraft-Verbindung neu starten"
  );
}

// ===============================
// MINECRAFT STARTEN
// ===============================

function minecraftStarten() {

  if (mcBot || verbindetSich) {
    return;
  }

  verbindetSich = true;

  console.log(
    "FrozenRun verbindet sich mit BlockBande..."
  );

  mcBot = mineflayer.createBot({
    host: MC_HOST,
    port: MC_PORT,
    username: MC_USERNAME,
    auth: "microsoft"
  });

  // =============================
  // Minecraft ist online
  // =============================

  mcBot.once("spawn", () => {

    verbindetSich = false;
    botAktiv = true;

    console.log(
      "✅ FrozenRun ist jetzt online auf BlockBande!"
    );

    const channel = getChatChannel();

    if (channel) {
      channel.send(
        "🟢 **FrozenRun ist jetzt auf BlockBande online!**"
      );
    }
  });

  // =============================
  // Minecraft Chat → Discord
  // =============================

  mcBot.on("chat", (username, message) => {

    if (!mcBot) return;

    // Eigene Nachrichten nicht zurückschicken
    if (username === mcBot.username) return;

    const channel = getChatChannel();

    if (channel) {

      channel.send(
        `💬 **${username}:** ${message}`
      );
    }

    console.log(
      `[Minecraft] ${username}: ${message}`
    );
  });

  // =============================
  // Fehler
  // =============================

  mcBot.on("error", (err) => {

    console.log(
      "Minecraft-Fehler:",
      err.message
    );

    const channel = getChatChannel();

    if (channel) {

      channel.send(
        `⚠️ **Minecraft-Fehler:** ${err.message}`
      );
    }
  });

  // =============================
  // Verbindung beendet
  // =============================

  mcBot.on("end", () => {

    console.log(
      "FrozenRun wurde von Minecraft getrennt."
    );

    const channel = getChatChannel();

    if (channel) {

      channel.send(
        "🔴 **FrozenRun wurde von Minecraft getrennt.**"
      );
    }

    mcBot = null;
    verbindetSich = false;
    botAktiv = false;
  });
}

// ===============================
// MINECRAFT STOPPEN
// ===============================

function minecraftStoppen() {

  if (mcBot) {

    console.log(
      "FrozenRun wird getrennt..."
    );

    mcBot.quit(
      "Bot ausgeschaltet"
    );

    mcBot = null;
  }

  verbindetSich = false;
  botAktiv = false;
}

// ===============================
// MINECRAFT NEU VERBINDEN
// ===============================

function minecraftNeuVerbinden() {

  console.log(
    "FrozenRun wird neu verbunden..."
  );

  minecraftStoppen();

  setTimeout(() => {

    botAktiv = true;
    minecraftStarten();

  }, 2000);
}

// ===============================
// DISCORD INTERAKTIONEN
// ===============================

client.on(
  Events.InteractionCreate,
  async (interaction) => {

    // =============================
    // /panel
    // =============================

    if (interaction.isChatInputCommand()) {

      if (interaction.commandName === "panel") {

        await interaction.reply({
          content: getPanelText(),
          components: createPanel()
        });

        return;
      }
    }

    // =============================
    // BUTTONS
    // =============================

    if (interaction.isButton()) {

      // -----------------------------
      // BOT AN / AUS
      // -----------------------------

      if (
        interaction.customId === "toggle_bot"
      ) {

        if (!botAktiv) {

          botAktiv = true;

          minecraftStarten();

        } else {

          minecraftStoppen();
        }

        await interaction.update({
          content: getPanelText(),
          components: createPanel()
        });

        return;
      }

      // -----------------------------
      // STATUS
      // -----------------------------

      if (
        interaction.customId === "status"
      ) {

        let status = getStatusText();

        if (mcBot) {

          status +=
            `\n\n👤 **Minecraft:** ${MC_USERNAME}`;

        }

        await interaction.reply({
          content:
            `📊 **FrozenRun Status**\n\n${status}`,
          ephemeral: true
        });

        return;
      }

      // -----------------------------
      // CHAT
      // -----------------------------

      if (
        interaction.customId === "chat"
      ) {

        await interaction.reply({
          content:
            "💬 **Minecraft-Chat → Discord**\n\n" +
            `Zielkanal: <#${MINECRAFT_CHAT_CHANNEL_ID}>\n\n` +
            "Sobald FrozenRun auf Minecraft online ist, " +
            "werden normale Minecraft-Chatnachrichten " +
            "dort angezeigt.",
          ephemeral: true
        });

        return;
      }

      // -----------------------------
      // NEU VERBINDEN
      // -----------------------------

      if (
        interaction.customId === "reconnect"
      ) {

        if (!botAktiv && !mcBot) {

          await interaction.reply({
            content:
              "🔴 FrozenRun ist aktuell ausgeschaltet.",
            ephemeral: true
          });

          return;
        }

        minecraftNeuVerbinden();

        await interaction.update({
          content: getPanelText(),
          components: createPanel()
        });

        return;
      }

      // -----------------------------
      // STOPPEN
      // -----------------------------

      if (
        interaction.customId === "stop_bot"
      ) {

        minecraftStoppen();

        await interaction.update({
          content: getPanelText(),
          components: createPanel()
        });

        return;
      }
    }
  }
);

// ===============================
// DISCORD LOGIN
// ===============================

client.login(
  process.env.DISCORD_TOKEN
);
