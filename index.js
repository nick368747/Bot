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

const bedrock = require("bedrock-protocol");
const { randomUUID } = require("crypto");
const http = require("http");

// =====================================
// EINSTELLUNGEN
// =====================================

const PORT = process.env.PORT || 10000;

const DISCORD_CHAT_CHANNEL_ID = "1552712351344496741";

const MC_HOST = "blockbande.de";
const MC_PORT = 19132;
const MC_USERNAME = "FrozenRun";

// =====================================
// RENDER WEB SERVER
// =====================================

http.createServer((req, res) => {
  res.writeHead(200);
  res.end("FrozenRun läuft!");
}).listen(PORT, () => {
  console.log(`Webserver läuft auf Port ${PORT}`);
});

// =====================================
// DISCORD
// =====================================

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds
  ]
});

let mcBot = null;
let botAktiv = false;
let verbindetSich = false;
let playerEntityId = null;

// =====================================
// DISCORD SLASH-BEFEHLE
// =====================================

const panelCommand = new SlashCommandBuilder()
  .setName("panel")
  .setDescription("Öffnet das FrozenRun Steuerungspanel.");

const mcCommand = new SlashCommandBuilder()
  .setName("mc")
  .setDescription("Führt einen Minecraft-Befehl mit FrozenRun aus.")
  .addStringOption(option =>
    option
      .setName("befehl")
      .setDescription("Minecraft-Befehl, z.B. /spawn oder /home")
      .setRequired(true)
      .setMaxLength(256)
  );

// =====================================
// DISCORD READY
// =====================================

client.once(Events.ClientReady, async () => {

  console.log(`Discord-Bot online als ${client.user.tag}`);

  const rest = new REST({ version: "10" })
    .setToken(process.env.DISCORD_TOKEN);

  await rest.put(
    Routes.applicationCommands(client.user.id),
    {
      body: [
        panelCommand.toJSON(),
        mcCommand.toJSON()
      ]
    }
  );

  console.log("/panel registriert.");
  console.log("/mc registriert.");
});

// =====================================
// DISCORD KANAL
// =====================================

function getDiscordChannel() {
  return client.channels.cache.get(
    DISCORD_CHAT_CHANNEL_ID
  );
}

// =====================================
// STATUS
// =====================================

function getStatus() {

  if (verbindetSich) {
    return "🟡 Verbindet sich...";
  }

  if (mcBot && botAktiv) {
    return "🟢 Online";
  }

  return "🔴 Offline";
}

// =====================================
// PANEL
// =====================================

function createPanel() {

  const toggleButton = new ButtonBuilder()
    .setCustomId("toggle_bot")
    .setLabel(
      botAktiv
        ? "🔴 FrozenRun ausschalten"
        : "🟢 FrozenRun einschalten"
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
    .setLabel("💬 Minecraft-Chat")
    .setStyle(ButtonStyle.Secondary);

  const reconnectButton = new ButtonBuilder()
    .setCustomId("reconnect")
    .setLabel("🔄 Neu verbinden")
    .setStyle(ButtonStyle.Secondary);

  const stopButton = new ButtonBuilder()
    .setCustomId("stop")
    .setLabel("🛑 Stoppen")
    .setStyle(ButtonStyle.Danger);

  const row1 = new ActionRowBuilder()
    .addComponents(
      toggleButton,
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

// =====================================
// PANEL TEXT
// =====================================

function getPanelText() {

  return (
    "🎮 **FrozenRun – Bedrock Steuerung**\n\n" +
    `**Status:** ${getStatus()}\n` +
    `**Server:** \`${MC_HOST}\`\n` +
    `**Account:** \`${MC_USERNAME}\`\n\n` +
    "💬 Minecraft-Chat → Discord\n" +
    "⚡ Minecraft-Befehle → `/mc befehl:`"
  );
}

// =====================================
// MINECRAFT-BEFEHL AUSFÜHREN
// =====================================

function minecraftBefehlAusführen(command) {

  if (!mcBot || !botAktiv) {
    return {
      ok: false,
      message: "🔴 FrozenRun ist nicht online."
    };
  }

  if (playerEntityId === null) {
    return {
      ok: false,
      message: "🟡 FrozenRun ist noch nicht vollständig geladen."
    };
  }

  // Nur Befehle erlauben
  if (!command.startsWith("/")) {
    return {
      ok: false,
      message:
        "❌ Es werden nur Minecraft-Befehle akzeptiert, die mit `/` beginnen."
    };
  }

  // Keine Zeilenumbrüche
  if (command.includes("\n") || command.includes("\r")) {
    return {
      ok: false,
      message: "❌ Der Befehl darf keine Zeilenumbrüche enthalten."
    };
  }

  const uuid = randomUUID();

  try {

    mcBot.queue("command_request", {
      command: command,

      origin: {
        type: "player",
        uuid: uuid,
        request_id: "",
        player_entity_id: BigInt(playerEntityId)
      },

      internal: false,

      // Aktuelle Bedrock-Versionen
      version: "latest"
    });

    console.log(
      `[Minecraft-Befehl] ${command}`
    );

    return {
      ok: true,
      message: `✅ Befehl ausgeführt: \`${command}\``
    };

  } catch (error) {

    console.log(
      "Fehler beim Minecraft-Befehl:",
      error.message
    );

    return {
      ok: false,
      message:
        `❌ Fehler beim Ausführen: ${error.message}`
    };
  }
}

// =====================================
// BEDROCK BOT STARTEN
// =====================================

function minecraftStarten() {

  if (mcBot || verbindetSich) {
    return;
  }

  verbindetSich = true;
  playerEntityId = null;

  console.log(
    "FrozenRun verbindet sich mit BlockBande Bedrock..."
  );

  mcBot = bedrock.createClient({

    host: MC_HOST,

    port: MC_PORT,

    username: MC_USERNAME,

    offline: false,

    profilesFolder: "./.minecraft",

    onMsaCode: (data) => {

      console.log("");
      console.log("======================================");
      console.log("MICROSOFT ANMELDUNG");
      console.log("======================================");

      console.log(
        "Öffne:",
        data.verification_uri
      );

      console.log(
        "Code:",
        data.user_code
      );

      console.log("======================================");
      console.log("");
    }

  });

  // ===================================
  // START_GAME
  // ===================================

  mcBot.on("start_game", (packet) => {

    if (packet.runtime_entity_id !== undefined) {

      playerEntityId = BigInt(
        packet.runtime_entity_id
      );

      console.log(
        "Player Entity ID:",
        playerEntityId.toString()
      );
    }
  });

  // ===================================
  // VERBINDUNG
  // ===================================

  mcBot.on("connect", () => {

    console.log(
      "🔗 Verbindung zu BlockBande hergestellt."
    );
  });

  // ===================================
  // JOIN
  // ===================================

  mcBot.on("join", () => {

    console.log(
      "✅ FrozenRun hat sich authentifiziert."
    );
  });

  // ===================================
  // SPAWN
  // ===================================

  mcBot.on("spawn", () => {

    verbindetSich = false;
    botAktiv = true;

    console.log(
      "🟢 FrozenRun ist jetzt online!"
    );

    const channel = getDiscordChannel();

    if (channel) {

      channel.send(
        "🟢 **FrozenRun ist jetzt auf BlockBande online!**"
      );
    }
  });

  // ===================================
  // MINECRAFT CHAT → DISCORD
  // ===================================

  mcBot.on("text", (packet) => {

    if (!packet) return;

    const username =
      packet.source_name || "Minecraft";

    const message =
      packet.message || "";

    if (!message) return;

    if (
      mcBot &&
      username === mcBot.username
    ) {
      return;
    }

    console.log(
      `[Minecraft] ${username}: ${message}`
    );

    const channel = getDiscordChannel();

    if (channel) {

      channel.send(
        `💬 **${username}:** ${message}`
      );
    }
  });

  // ===================================
  // COMMAND OUTPUT
  // ===================================

  mcBot.on("command_output", (packet) => {

    if (!packet) return;

    if (packet.output) {

      console.log(
        "[Minecraft Command Output]",
        packet.output
      );
    }
  });

  // ===================================
  // KICK
  // ===================================

  mcBot.on("kick", (reason) => {

    console.log(
      "⚠️ FrozenRun wurde gekickt:",
      reason
    );

    const channel = getDiscordChannel();

    if (channel) {

      channel.send(
        `⚠️ **FrozenRun wurde gekickt:** ${reason}`
      );
    }
  });

  // ===================================
  // FEHLER
  // ===================================

  mcBot.on("error", (err) => {

    console.log(
      "Minecraft-Fehler:",
      err.message
    );
  });

  // ===================================
  // VERBINDUNG ENDE
  // ===================================

  mcBot.on("close", () => {

    console.log(
      "🔴 Minecraft-Verbindung beendet."
    );

    mcBot = null;
    verbindetSich = false;
    botAktiv = false;
    playerEntityId = null;
  });
}

// =====================================
// STOPPEN
// =====================================

function minecraftStoppen() {

  if (mcBot) {

    console.log(
      "FrozenRun wird getrennt..."
    );

    mcBot.close();

    mcBot = null;
  }

  verbindetSich = false;
  botAktiv = false;
  playerEntityId = null;
}

// =====================================
// NEU VERBINDEN
// =====================================

function minecraftNeuVerbinden() {

  minecraftStoppen();

  setTimeout(() => {

    botAktiv = true;

    minecraftStarten();

  }, 2000);
}

// =====================================
// DISCORD INTERAKTIONEN
// =====================================

client.on(
  Events.InteractionCreate,
  async (interaction) => {

    // =================================
    // /panel
    // =================================

    if (interaction.isChatInputCommand()) {

      // -------------------------------
      // /panel
      // -------------------------------

      if (interaction.commandName === "panel") {

        await interaction.reply({
          content: getPanelText(),
          components: createPanel()
        });

        return;
      }

      // -------------------------------
      // /mc
      // -------------------------------

      if (interaction.commandName === "mc") {

        const command =
          interaction.options.getString("befehl");

        if (!command) {

          await interaction.reply({
            content:
              "❌ Bitte einen Minecraft-Befehl angeben.",
            ephemeral: true
          });

          return;
        }

        const result =
          minecraftBefehlAusführen(command);

        await interaction.reply({
          content: result.message,
          ephemeral: true
        });

        return;
      }
    }

    // =================================
    // BUTTONS
    // =================================

    if (interaction.isButton()) {

      // -------------------------------
      // AN / AUS
      // -------------------------------

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

      // -------------------------------
      // STATUS
      // -------------------------------

      if (
        interaction.customId === "status"
      ) {

        await interaction.reply({
          content:
            "📊 **FrozenRun Status**\n\n" +
            `Status: ${getStatus()}\n` +
            `Server: ${MC_HOST}\n` +
            `Account: ${MC_USERNAME}`,
          ephemeral: true
        });

        return;
      }

      // -------------------------------
      // CHAT
      // -------------------------------

      if (
        interaction.customId === "chat"
      ) {

        await interaction.reply({
          content:
            "💬 **Minecraft-Chat → Discord**\n\n" +
            `Ziel: <#${DISCORD_CHAT_CHANNEL_ID}>\n\n` +
            "Minecraft-Nachrichten werden dort angezeigt.\n" +
            "Normale Discord-Nachrichten werden NICHT an Minecraft gesendet.",
          ephemeral: true
        });

        return;
      }

      // -------------------------------
      // NEU VERBINDEN
      // -------------------------------

      if (
        interaction.customId === "reconnect"
      ) {

        if (!botAktiv && !mcBot) {

          await interaction.reply({
            content:
              "🔴 FrozenRun ist ausgeschaltet.",
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

      // -------------------------------
      // STOPPEN
      // -------------------------------

      if (
        interaction.customId === "stop"
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

// =====================================
// DISCORD LOGIN
// =====================================

client.login(
  process.env.DISCORD_TOKEN
);
