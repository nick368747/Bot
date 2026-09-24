const {
  Client,
  GatewayIntentBits,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
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

const DISCORD_CHAT_CHANNEL_ID = "1552068948676059146";

const MC_HOST = "blockbande.de";
const MC_PORT = 19132;
const MC_USERNAME = "FrozenRun";

// Spieler, dessen /tpahere automatisch angenommen wird
const TPA_SPIELER = "FrozenBoar16433";

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

// Verhindert mehrfaches Auslösen derselben TPA-Anfrage
let tpaWirdBearbeitet = false;

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
// FROZENRUN PANEL
// =====================================

function createPanel() {

  const toggleButton = new ButtonBuilder()
    .setCustomId("toggle_bot")
    .setLabel(
      botAktiv
        ? "Ausschalten"
        : "Einschalten"
    )
    .setEmoji(
      botAktiv
        ? "🔴"
        : "🟢"
    )
    .setStyle(
      botAktiv
        ? ButtonStyle.Danger
        : ButtonStyle.Success
    );

  const statusButton = new ButtonBuilder()
    .setCustomId("status")
    .setLabel("Status")
    .setEmoji("📊")
    .setStyle(ButtonStyle.Primary);

  const chatButton = new ButtonBuilder()
    .setCustomId("chat")
    .setLabel("Chat")
    .setEmoji("💬")
    .setStyle(ButtonStyle.Secondary);

  const homeButton = new ButtonBuilder()
    .setCustomId("home_afk")
    .setLabel("Home AFK")
    .setEmoji("🏠")
    .setStyle(ButtonStyle.Primary);

  const reconnectButton = new ButtonBuilder()
    .setCustomId("reconnect")
    .setLabel("Neu verbinden")
    .setEmoji("🔄")
    .setStyle(ButtonStyle.Secondary);

  const stopButton = new ButtonBuilder()
    .setCustomId("stop")
    .setLabel("Stoppen")
    .setEmoji("🛑")
    .setStyle(ButtonStyle.Danger);

  // Reihe 1
  const row1 = new ActionRowBuilder()
    .addComponents(
      toggleButton,
      statusButton,
      chatButton,
      homeButton
    );

  // Reihe 2
  const row2 = new ActionRowBuilder()
    .addComponents(
      reconnectButton,
      stopButton
    );

  return [
    row1,
    row2
  ];
}

// =====================================
// PANEL EMBED
// =====================================

function createPanelEmbed() {

  const embed = new EmbedBuilder()
    .setTitle("🎮 FrozenRun • Steuerung")
    .setDescription(

      "Steuere deinen Minecraft-Bot direkt über Discord.\n\n" +

      `**📊 Status**\n${getStatus()}\n\n` +

      `**🌐 Server**\n\`${MC_HOST}\`\n\n` +

      `**👤 Account**\n\`${MC_USERNAME}\`\n\n` +

      "━━━━━━━━━━━━━━━━━━━━\n\n" +

      "💬 **Minecraft-Chat → Discord**\n" +
      "Minecraft-Nachrichten werden automatisch in den Discord-Kanal übertragen.\n\n" +

      "🏠 **Home AFK**\n" +
      "Bringt FrozenRun mit `/home afk` zum AFK-Home.\n\n" +

      "⚡ **Minecraft-Befehle**\n" +
      "Benutze `/mc befehl:` für weitere Minecraft-Befehle.\n\n" +

      `🤝 **Automatische TPA**\n` +
      `\`${TPA_SPIELER}\` → /tpahere → automatisch /tpaccept → nach 10 Sekunden /sethome afk`

    )
    .setFooter({
      text: "FrozenRun • BlockBande"
    })
    .setTimestamp();

  return embed;
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
      message:
        "🟡 FrozenRun ist noch nicht vollständig geladen."
    };

  }

  if (!command.startsWith("/")) {

    return {
      ok: false,
      message:
        "❌ Es werden nur Minecraft-Befehle akzeptiert, die mit `/` beginnen."
    };

  }

  if (
    command.includes("\n") ||
    command.includes("\r")
  ) {

    return {
      ok: false,
      message:
        "❌ Der Befehl darf keine Zeilenumbrüche enthalten."
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

      version: "latest"

    });

    console.log(
      `[Minecraft-Befehl] ${command}`
    );

    return {
      ok: true,
      message:
        `✅ Befehl ausgeführt: \`${command}\``
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
// AUTOMATISCHE TPA
// =====================================

function tpaAutomatischAnnehmen() {

  if (!mcBot || !botAktiv) {

    console.log(
      "⚠️ TPA erkannt, aber FrozenRun ist nicht aktiv."
    );

    return;

  }

  if (playerEntityId === null) {

    console.log(
      "⚠️ TPA erkannt, aber FrozenRun ist noch nicht vollständig geladen."
    );

    return;

  }

  if (tpaWirdBearbeitet) {

    console.log(
      "ℹ️ Eine TPA wird bereits bearbeitet."
    );

    return;

  }

  tpaWirdBearbeitet = true;

  console.log(
    `🤝 /tpahere von ${TPA_SPIELER} erkannt.`
  );

  // -----------------------------------
  // TPA ANNEHMEN
  // -----------------------------------

  const acceptResult =
    minecraftBefehlAusführen("/tpaccept");

  if (!acceptResult.ok) {

    console.log(
      "❌ /tpaccept konnte nicht ausgeführt werden."
    );

    tpaWirdBearbeitet = false;

    return;

  }

  console.log(
    "✅ /tpaccept wurde ausgeführt."
  );

  // -----------------------------------
  // 10 SEKUNDEN WARTEN
  // -----------------------------------

  setTimeout(() => {

    if (!mcBot || !botAktiv) {

      console.log(
        "⚠️ FrozenRun ist nach der TPA nicht mehr online."
      );

      tpaWirdBearbeitet = false;

      return;

    }

    console.log(
      "🏠 10 Sekunden vorbei → /sethome afk"
    );

    const homeResult =
      minecraftBefehlAusführen("/sethome afk");

    if (homeResult.ok) {

      console.log(
        "✅ /sethome afk wurde ausgeführt."
      );

    } else {

      console.log(
        "❌ /sethome afk konnte nicht ausgeführt werden."
      );

    }

    tpaWirdBearbeitet = false;

  }, 10000);

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
  tpaWirdBearbeitet = false;

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
  // START GAME
  // ===================================

  mcBot.on("start_game", (packet) => {

    if (
      packet.runtime_entity_id !== undefined
    ) {

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
  // CONNECT
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
  // MINECRAFT CHAT
  // ===================================

  mcBot.on("text", (packet) => {

    if (!packet) {
      return;
    }

    const username =
      packet.source_name || "Minecraft";

    const message =
      packet.message || "";

    if (!message) {
      return;
    }

    console.log(
      `[Minecraft] ${username}: ${message}`
    );

    // ---------------------------------
    // AUTOMATISCHE TPA
    // ---------------------------------

    if (
      username === TPA_SPIELER &&
      message.toLowerCase().includes("/tpahere")
    ) {

      tpaAutomatischAnnehmen();

    }

    // ---------------------------------
    // EIGENE NACHRICHTEN NICHT SENDEN
    // ---------------------------------

    if (
      mcBot &&
      username === mcBot.username
    ) {

      return;

    }

    // ---------------------------------
    // MINECRAFT CHAT → DISCORD
    // ---------------------------------

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

    if (!packet) {
      return;
    }

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
  // ERROR
  // ===================================

  mcBot.on("error", (err) => {

    console.log(
      "Minecraft-Fehler:",
      err.message
    );

  });

  // ===================================
  // CLOSE
  // ===================================

  mcBot.on("close", () => {

    console.log(
      "🔴 Minecraft-Verbindung beendet."
    );

    mcBot = null;
    verbindetSich = false;
    botAktiv = false;
    playerEntityId = null;
    tpaWirdBearbeitet = false;

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
  tpaWirdBearbeitet = false;

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
    // SLASH COMMANDS
    // =================================

    if (interaction.isChatInputCommand()) {

      // ===============================
      // /panel
      // ===============================

      if (
        interaction.commandName === "panel"
      ) {

        await interaction.reply({

          embeds: [
            createPanelEmbed()
          ],

          components: createPanel()

        });

        return;

      }

      // ===============================
      // /mc
      // ===============================

      if (
        interaction.commandName === "mc"
      ) {

        const command =
          interaction.options.getString(
            "befehl"
          );

        if (!command) {

          await interaction.reply({

            content:
              "❌ Bitte einen Minecraft-Befehl angeben.",

            ephemeral: true

          });

          return;

        }

        const result =
          minecraftBefehlAusführen(
            command
          );

        await interaction.reply({

          content:
            result.message,

          ephemeral: true

        });

        return;

      }

    }

    // =================================
    // BUTTONS
    // =================================

    if (interaction.isButton()) {

      // ===============================
      // EIN / AUS
      // ===============================

      if (
        interaction.customId ===
        "toggle_bot"
      ) {

        if (!botAktiv) {

          botAktiv = true;

          minecraftStarten();

        } else {

          minecraftStoppen();

        }

        await interaction.update({

          embeds: [
            createPanelEmbed()
          ],

          components: createPanel()

        });

        return;

      }

      // ===============================
      // STATUS
      // ===============================

      if (
        interaction.customId ===
        "status"
      ) {

        await interaction.reply({

          content:
            "📊 **FrozenRun Status**\n\n" +

            `**Status:** ${getStatus()}\n` +

            `**Server:** ${MC_HOST}\n` +

            `**Account:** ${MC_USERNAME}`,

          ephemeral: true

        });

        return;

      }

      // ===============================
      // CHAT
      // ===============================

      if (
        interaction.customId ===
        "chat"
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

      // ===============================
      // HOME AFK
      // ===============================

      if (
        interaction.customId ===
        "home_afk"
      ) {

        const result =
          minecraftBefehlAusführen(
            "/home afk"
          );

        await interaction.reply({

          content:
            result.message,

          ephemeral: true

        });

        return;

      }

      // ===============================
      // NEU VERBINDEN
      // ===============================

      if (
        interaction.customId ===
        "reconnect"
      ) {

        if (
          !botAktiv &&
          !mcBot
        ) {

          await interaction.reply({

            content:
              "🔴 FrozenRun ist ausgeschaltet.",

            ephemeral: true

          });

          return;

        }

        minecraftNeuVerbinden();

        await interaction.update({

          embeds: [
            createPanelEmbed()
          ],

          components: createPanel()

        });

        return;

      }

      // ===============================
      // STOPPEN
      // ===============================

      if (
        interaction.customId ===
        "stop"
      ) {

        minecraftStoppen();

        await interaction.update({

          embeds: [
            createPanelEmbed()
          ],

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
