const http = require("http");

const fs = require("fs");
const path = require("path");

// ==================================================
// MICROSOFT LOGIN RESET
// ==================================================

const minecraftProfilOrdner = path.join(
  process.cwd(),
  ".minecraft"
);

if (process.env.RESET_MINECRAFT_LOGIN === "true") {
  try {
    fs.rmSync(
      minecraftProfilOrdner,
      {
        recursive: true,
        force: true
      }
    );

    console.log(
      "Minecraft-Login wurde zurückgesetzt."
    );
  } catch (err) {
    console.log(
      "Fehler beim Zurücksetzen des Minecraft-Logins:",
      err?.message || err
    );
  }
}

const {
  Client,
  GatewayIntentBits,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  SlashCommandBuilder,
  MessageFlags
} = require("discord.js");

const bedrock = require("bedrock-protocol");

// ==================================================
// RENDER WEB SERVER
// ==================================================

const PORT = process.env.PORT || 10000;

const webServer = http.createServer((req, res) => {
  res.writeHead(200, {
    "Content-Type": "text/plain; charset=utf-8"
  });

  res.end("FrozenRun Discord/Minecraft Bot läuft.");
});

webServer.listen(PORT, "0.0.0.0", () => {
  console.log(`Webserver läuft auf Port ${PORT}`);
});

// ==================================================
// KONFIGURATION
// ==================================================

const DISCORD_TOKEN = process.env.DISCORD_TOKEN;

const MC_HOST = "blockbande.de";
const MC_PORT = 19132;
const MC_USERNAME = "FrozenRun";

const MONEY_TARGET = "!FrozenBoar16433";

const MC_CHANNEL_ID = "1552068948676059146";

// ==================================================
// DISCORD CLIENT
// ==================================================

const discord = new Client({
  intents: [
    GatewayIntentBits.Guilds
  ]
});

// ==================================================
// CONTROLLER
// ==================================================

const erlaubteController = new Set();

// ==================================================
// MINECRAFT STATUS
// ==================================================

let mcBot = null;

let mcOnline = false;

let manuellGestoppt = true;

let reconnectTimer = null;

let minecraftUuid = null;

let playerEntityId = 0;

let aktuelleKoordinaten = {
  x: 0,
  y: 0,
  z: 0
};

let aktuellesGeld = 0;

// ==================================================
// LAUFEN
// ==================================================

let laufenAktiv = false;
let laufenTimer = null;
let laufenRichtung = 0;
let laufenRichtungsTimer = null;

// ==================================================
// LIVE DASHBOARD UPTIME
// ==================================================

const botStartzeit = Date.now();

let dashboardMessage = null;

let dashboardUptimeTimer = null;

let dashboardGeldTimer = null;

// ==================================================
// GESPEICHERTES DASHBOARD
// ==================================================

const dashboardDatei = path.join(
  process.cwd(),
  ".dashboard.json"
);

let gespeichertesDashboard = null;

// ==================================================
// DASHBOARD-DATEN LADEN
// ==================================================

function dashboardDatenLaden() {
  try {
    if (!fs.existsSync(dashboardDatei)) {
      return null;
    }

    const daten = fs.readFileSync(
      dashboardDatei,
      "utf8"
    );

    if (!daten.trim()) {
      return null;
    }

    const parsed = JSON.parse(daten);

    if (
      !parsed ||
      !parsed.guildId ||
      !parsed.channelId ||
      !parsed.messageId
    ) {
      return null;
    }

    return parsed;

  } catch (err) {
    console.log(
      "Dashboard-Daten konnten nicht geladen werden:",
      err?.message || err
    );

    return null;
  }
}

// ==================================================
// DASHBOARD-DATEN SPEICHERN
// ==================================================

function dashboardDatenSpeichern(
  guildId,
  channelId,
  messageId
) {
  try {
    gespeichertesDashboard = {
      guildId,
      channelId,
      messageId
    };

    fs.writeFileSync(
      dashboardDatei,
      JSON.stringify(
        gespeichertesDashboard,
        null,
        2
      )
    );

    console.log(
      "Dashboard-Daten gespeichert."
    );

  } catch (err) {
    console.log(
      "Dashboard-Daten konnten nicht gespeichert werden:",
      err?.message || err
    );
  }
}

// ==================================================
// DASHBOARD-DATEN LÖSCHEN
// ==================================================

function dashboardDatenLöschen() {
  gespeichertesDashboard = null;

  try {
    if (fs.existsSync(dashboardDatei)) {
      fs.rmSync(
        dashboardDatei,
        {
          force: true
        }
      );
    }
  } catch (err) {
    console.log(
      "Dashboard-Datei konnte nicht gelöscht werden:",
      err?.message || err
    );
  }
}

// ==================================================
// HILFSFUNKTIONEN
// ==================================================

function formatLiveUptime() {
  const sekundenGesamt = Math.max(
    0,
    Math.floor((Date.now() - botStartzeit) / 1000)
  );

  const tage = Math.floor(
    sekundenGesamt / 86400
  );

  const stunden = Math.floor(
    (sekundenGesamt % 86400) / 3600
  );

  const minuten = Math.floor(
    (sekundenGesamt % 3600) / 60
  );

  const sekunden =
    sekundenGesamt % 60;

  const zeit =
    `${String(stunden).padStart(2, "0")}:` +
    `${String(minuten).padStart(2, "0")}:` +
    `${String(sekunden).padStart(2, "0")}`;

  return tage > 0
    ? `${tage} Tag${tage === 1 ? "" : "e"}, ${zeit}`
    : zeit;
}

function formatGeld(betrag) {
  return Number(
    betrag || 0
  ).toLocaleString("de-DE");
}

function formatKoordinaten() {
  return (
    `${Math.round(aktuelleKoordinaten.x)}, ` +
    `${Math.round(aktuelleKoordinaten.y)}, ` +
    `${Math.round(aktuelleKoordinaten.z)}`
  );
}

// ==================================================
// SERVER OWNER
// ==================================================

function istServerOwner(interaction) {
  return (
    interaction.guild &&
    interaction.guild.ownerId ===
      interaction.user.id
  );
}

// ==================================================
// DARF USER DEN BOT STEUERN?
// ==================================================

function darfSteuern(interaction) {
  if (
    istServerOwner(interaction)
  ) {
    return true;
  }

  return erlaubteController.has(
    interaction.user.id
  );
}

// ==================================================
// GELD AUS /money AUSLESEN
// ==================================================

function geldAusOutputLesen(text) {
  if (!text) {
    return null;
  }

  const clean = String(text)
    .replace(/\u00a0/g, " ");

  const match = clean.match(
    /Dein\s+Kontostand\s*:\s*([\d.,]+)/i
  );

  if (!match) {
    console.log(
      "Kontostand nicht gefunden:",
      clean
    );

    return null;
  }

  let zahl = match[1];

  zahl = zahl.replace(/\./g, "");

  zahl = zahl.replace(",", ".");

  const wert = Number(zahl);

  if (!Number.isFinite(wert)) {
    return null;
  }

  return Math.floor(wert);
}

// ==================================================
// MINECRAFT COMMAND
// ==================================================

function minecraftCommand(command) {
  return new Promise((resolve, reject) => {
    if (!mcBot || !mcOnline) {
      reject(
        new Error(
          "FrozenRun ist nicht online."
        )
      );

      return;
    }

    if (!minecraftUuid) {
      reject(
        new Error(
          "Minecraft-UUID ist noch nicht verfügbar."
        )
      );

      return;
    }

    const requestId =
      Math.random()
        .toString(36)
        .slice(2);

    let erledigt = false;

    const timeout = setTimeout(() => {
      if (erledigt) {
        return;
      }

      erledigt = true;

      mcBot.removeListener(
        "command_output",
        listener
      );

      resolve(null);
    }, 8000);

    function listener(packet) {
      try {
        if (!packet) {
          return;
        }

        if (
          packet.origin &&
          packet.origin.uuid &&
          String(packet.origin.uuid) !==
            String(minecraftUuid)
        ) {
          return;
        }

        if (erledigt) {
          return;
        }

        erledigt = true;

        clearTimeout(timeout);

        mcBot.removeListener(
          "command_output",
          listener
        );

        let output = "";

        if (Array.isArray(packet.output)) {
          output = packet.output
            .map(item => {
              if (typeof item === "string") {
                return item;
              }

              if (
                item &&
                typeof item === "object"
              ) {
                return (
                  item.message ||
                  item.text ||
                  JSON.stringify(item)
                );
              }

              return String(item);
            })
            .join("\n");
        } else if (
          typeof packet.output === "string"
        ) {
          output = packet.output;
        } else {
          output = JSON.stringify(packet);
        }

        resolve(output);

      } catch (err) {
        if (erledigt) {
          return;
        }

        erledigt = true;

        clearTimeout(timeout);

        mcBot.removeListener(
          "command_output",
          listener
        );

        resolve(null);
      }
    }

    mcBot.on(
      "command_output",
      listener
    );

    try {
      mcBot.queue(
        "command_request",
        {
          command,

          origin: {
            type: "player",
            uuid: minecraftUuid,
            request_id: requestId,
            player_entity_id:
              BigInt(playerEntityId || 0)
          },

          internal: false,
          version: "latest"
        }
      );

    } catch (err) {
      clearTimeout(timeout);

      mcBot.removeListener(
        "command_output",
        listener
      );

      reject(err);
    }
  });
}

// ==================================================
// GELD AKTUALISIEREN
// ==================================================

async function geldAktualisieren() {
  if (!mcBot || !mcOnline) {
    return null;
  }

  try {
    const output =
      await minecraftCommand("/money");

    if (!output) {
      console.log(
        "Keine /money Antwort."
      );

      return null;
    }

    console.log(
      "MONEY OUTPUT:",
      output
    );

    const geld =
      geldAusOutputLesen(output);

    if (geld === null) {
      console.log(
        "Kontostand konnte nicht erkannt werden."
      );

      return null;
    }

    aktuellesGeld = geld;

    console.log(
      "Aktueller Kontostand:",
      aktuellesGeld
    );

    return geld;

  } catch (err) {
    console.log(
      "Geld Fehler:",
      err.message
    );

    return null;
  }
}

// ==================================================
// LAUFEN STEUERUNG
// ==================================================

function laufenStoppen() {
  laufenAktiv = false;

  if (laufenTimer) {
    clearInterval(laufenTimer);
    laufenTimer = null;
  }

  if (laufenRichtungsTimer) {
    clearInterval(
      laufenRichtungsTimer
    );

    laufenRichtungsTimer = null;
  }
}

function laufenStarten() {
  if (!mcOnline) {
    throw new Error(
      "FrozenRun ist offline."
    );
  }

  laufenStoppen();

  laufenAktiv = true;

  laufenRichtung =
    Math.random() *
    Math.PI *
    2;

  laufenRichtungsTimer =
    setInterval(() => {
      if (!laufenAktiv) {
        return;
      }

      laufenRichtung +=
        (Math.random() - 0.5) *
        Math.PI;

    }, 2500);

  laufenTimer =
    setInterval(async () => {
      if (
        !laufenAktiv ||
        !mcOnline
      ) {
        return;
      }

      const geschwindigkeit =
        0.18;

      const dx =
        Math.cos(laufenRichtung) *
        geschwindigkeit;

      const dz =
        Math.sin(laufenRichtung) *
        geschwindigkeit;

      try {
        await minecraftCommand(
          `/tp @s ~${dx.toFixed(3)} ~ ~${dz.toFixed(3)}`
        );
      } catch (err) {
        console.log(
          "Laufen Fehler:",
          err?.message || err
        );
      }

    }, 250);
}

// ==================================================
// MINECRAFT VERBINDEN
// ==================================================

function minecraftVerbinden() {
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }

  if (mcBot) {
    try {
      mcBot.disconnect();
    } catch {}
  }

  mcBot = null;

  mcOnline = false;

  minecraftUuid = null;

  playerEntityId = 0;

  console.log(
    "Verbinde FrozenRun mit Minecraft..."
  );

  try {
    mcBot =
      bedrock.createClient({
        host: MC_HOST,

        port: MC_PORT,

        username: MC_USERNAME,

        profilesFolder:
          "./.minecraft",

        onMsaCode: data => {
          console.log("");
          console.log(
            "===================================="
          );
          console.log(
            "MICROSOFT LOGIN"
          );
          console.log(
            "===================================="
          );

          console.log(
            "Code:",
            data.user_code
          );

          console.log(
            "Link:",
            data.verification_uri
          );

          console.log(
            "Code gültig für ca.:",
            data.expires_in,
            "Sekunden"
          );

          console.log(
            "===================================="
          );
        }
      });

    // ==================================================
    // MINECRAFT START_GAME
    // ==================================================

    mcBot.on(
      "start_game",
      async packet => {
        mcOnline = true;

        if (
          packet.runtime_entity_id !==
          undefined
        ) {
          playerEntityId =
            Number(
              packet.runtime_entity_id
            );
        }

        if (
          packet.player_entity_id !==
          undefined
        ) {
          playerEntityId =
            Number(
              packet.player_entity_id
            );
        }

        if (
          packet.entity_id !==
          undefined
        ) {
          playerEntityId =
            Number(
              packet.entity_id
            );
        }

        if (packet.uuid) {
          minecraftUuid =
            packet.uuid;
        }

        console.log(
          "FrozenRun ist online!"
        );

        setTimeout(
          async () => {
            await geldAktualisieren();
          },
          3000
        );
      }
    );

    // ==================================================
    // MINECRAFT CHAT
    // ==================================================

    mcBot.on(
      "text",
      async packet => {
        try {
          console.log(
            "Minecraft:",
            packet
          );

          const username =
            packet.source_name || "";

          let message =
            packet.message || "";

          if (
            !message &&
            packet.parameters
          ) {
            message =
              packet.parameters.join(" ");
          }

          const channel =
            discord.channels.cache.get(
              MC_CHANNEL_ID
            );

          if (
            channel &&
            message
          ) {
            await channel.send(
              `**${username || "Minecraft"}:** ${message}`
            ).catch(() => {});
          }

          if (
            username ===
              "FrozenBoar16433" &&
            /tpa(here)?/i.test(message)
          ) {
            console.log(
              "TPA von FrozenBoar16433 erkannt."
            );

            await minecraftCommand(
              "/tpaccept"
            );

            setTimeout(
              async () => {
                await minecraftCommand(
                  "/sethome afk"
                );

                console.log(
                  "AFK-Home gesetzt."
                );
              },
              10000
            );
          }

        } catch (err) {
          console.log(
            "Chat Fehler:",
            err.message
          );
        }
      }
    );

    // ==================================================
    // KOORDINATEN INTERN AKTUALISIEREN
    // ==================================================

    mcBot.on(
      "move_player",
      packet => {
        try {
          if (packet.position) {
            aktuelleKoordinaten.x =
              Number(
                packet.position.x || 0
              );

            aktuelleKoordinaten.y =
              Number(
                packet.position.y || 0
              );

            aktuelleKoordinaten.z =
              Number(
                packet.position.z || 0
              );
          }
        } catch {}
      }
    );

    // ==================================================
    // MINECRAFT FEHLER
    // ==================================================

    mcBot.on(
      "error",
      err => {
        console.log(
          "Minecraft Fehler:",
          err?.message || err
        );
      }
    );

    // ==================================================
    // VERBINDUNG GESCHLOSSEN
    // ==================================================

    mcBot.on(
      "close",
      () => {
        console.log(
          "Minecraft Verbindung geschlossen."
        );

        mcOnline = false;

        minecraftUuid = null;

        playerEntityId = 0;

        if (manuellGestoppt) {
          console.log(
            "Manuell gestoppt – kein Reconnect."
          );

          return;
        }

        if (reconnectTimer) {
          clearTimeout(
            reconnectTimer
          );
        }

        console.log(
          "Automatischer Reconnect in 30 Sekunden..."
        );

        reconnectTimer =
          setTimeout(
            () => {
              reconnectTimer = null;

              if (!manuellGestoppt) {
                minecraftVerbinden();
              }
            },
            30000
          );
      }
    );

  } catch (err) {
    console.log(
      "Minecraft Verbindungsfehler:",
      err.message
    );
  }
}

// ==================================================
// DASHBOARD
// ==================================================

function dashboardEmbed() {
  return new EmbedBuilder()
    .setTitle(
      "🎮 FrozenRun Dashboard"
    )

    .setDescription(
      "Aktuelle Informationen zu FrozenRun."
    )

    .addFields(
      {
        name: "📡 Status",

        value:
          mcOnline
            ? "🟢 Online"
            : "🔴 Offline",

        inline: true
      },

      {
        name: "💰 Geld",

        value:
          `${formatGeld(
            aktuellesGeld
          )}`,

        inline: true
      },

      {
        name: "📍 Koordinaten",

        value:
          formatKoordinaten(),

        inline: true
      },

      {
        name: "⏱️ Uptime",

        value:
          formatLiveUptime(),

        inline: true
      },

      {
        name: "🏃 Laufen",

        value:
          laufenAktiv
            ? "🟢 Aktiv"
            : "🔴 Aus",

        inline: true
      },

      {
        name: "🤝 TPA",

        value:
          "FrozenBoar16433 → automatisch annehmen\n" +
          "Danach `/sethome afk`",

        inline: false
      },

      {
        name: "🔐 Zugriff",

        value:
          "Serverbesitzer + freigeschaltete Controller.",

        inline: false
      }
    )

    .setFooter({
      text:
        "FrozenRun • BlockBande"
    });
}

// ==================================================
// PANEL
// ==================================================

function panelEmbed() {
  return new EmbedBuilder()
    .setTitle(
      "🎛️ FrozenRun Panel"
    )

    .setDescription(
      "Steuerung von FrozenRun."
    )

    .addFields(
      {
        name: "📡 Status",

        value:
          mcOnline
            ? "🟢 Online"
            : "🔴 Offline",

        inline: true
      },

      {
        name: "👤 Account",

        value:
          MC_USERNAME,

        inline: true
      },

      {
        name: "🔐 Zugriff",

        value:
          "Serverbesitzer + freigeschaltete Controller.",

        inline: false
      }
    )

    .setFooter({
      text:
        "FrozenRun Control Panel"
    });
}

// ==================================================
// PANEL BUTTONS
// KOORDINATEN-BUTTON ENTFERNT
// ==================================================

function panelButtons() {
  const row1 =
    new ActionRowBuilder()
      .addComponents(

        new ButtonBuilder()
          .setCustomId(
            "toggle_bot"
          )
          .setLabel(
            "Ein / Aus"
          )
          .setEmoji(
            "⏯️"
          )
          .setStyle(
            ButtonStyle.Primary
          ),

        new ButtonBuilder()
          .setCustomId(
            "status"
          )
          .setLabel(
            "Status"
          )
          .setEmoji(
            "📡"
          )
          .setStyle(
            ButtonStyle.Secondary
          ),

        new ButtonBuilder()
          .setCustomId(
            "money"
          )
          .setLabel(
            "Geld"
          )
          .setEmoji(
            "💰"
          )
          .setStyle(
            ButtonStyle.Success
          ),

        new ButtonBuilder()
          .setCustomId(
            "pay"
          )
          .setLabel(
            "Geld senden"
          )
          .setEmoji(
            "💸"
          )
          .setStyle(
            ButtonStyle.Primary
          )
      );

  const row2 =
    new ActionRowBuilder()
      .addComponents(

        new ButtonBuilder()
          .setCustomId(
            "home_afk"
          )
          .setLabel(
            "Home AFK"
          )
          .setEmoji(
            "🏠"
          )
          .setStyle(
            ButtonStyle.Secondary
          ),

        new ButtonBuilder()
          .setCustomId(
            "reconnect"
          )
          .setLabel(
            "Neu verbinden"
          )
          .setEmoji(
            "🔄"
          )
          .setStyle(
            ButtonStyle.Primary
          ),

        new ButtonBuilder()
          .setCustomId(
            "stop"
          )
          .setLabel(
            "Stoppen"
          )
          .setEmoji(
            "⛔"
          )
          .setStyle(
            ButtonStyle.Danger
          )
      );

  return [
    row1,
    row2
  ];
}
// ==================================================
// DASHBOARD AUTOMATISCH FINDEN
// ==================================================

async function dashboardAutomatischFinden() {
  try {
    if (!discord.user) {
      return null;
    }

    let gefunden = null;

    for (
      const guild of discord.guilds.cache.values()
    ) {
      const channels =
        guild.channels.cache.filter(
          channel =>
            channel.isTextBased() &&
            typeof channel.messages?.fetch ===
              "function"
        );

      for (
        const channel of channels.values()
      ) {
        try {
          const messages =
            await channel.messages.fetch({
              limit: 100
            });

          for (
            const message of messages.values()
          ) {
            if (
              message.author?.id !==
                discord.user.id ||
              !message.embeds?.some(
                embed =>
                  embed.title ===
                  "🎮 FrozenRun Dashboard"
              )
            ) {
              continue;
            }

            if (
              !gefunden ||
              message.createdTimestamp >
                gefunden.createdTimestamp
            ) {
              gefunden = message;
            }
          }
        } catch (err) {
          // Fehlende Rechte in einem Kanal
          // dürfen den Start nicht stoppen.
        }
      }
    }

    if (gefunden) {
      dashboardMessage =
        gefunden;

      console.log(
        `Vorhandenes FrozenRun Dashboard gefunden: ${gefunden.id}`
      );
    } else {
      console.log(
        "Kein vorhandenes FrozenRun Dashboard gefunden."
      );
    }

    return gefunden;

  } catch (err) {
    console.log(
      "Dashboard Suche Fehler:",
      err?.message || err
    );

    return null;
  }
}

// ==================================================
// DASHBOARD TIMER STOPPEN
// ==================================================

function dashboardTimerStoppen() {
  if (dashboardUptimeTimer) {
    clearInterval(
      dashboardUptimeTimer
    );

    dashboardUptimeTimer = null;
  }

  if (dashboardGeldTimer) {
    clearInterval(
      dashboardGeldTimer
    );

    dashboardGeldTimer = null;
  }
}

// ==================================================
// DASHBOARD TIMER STARTEN
// ==================================================

function dashboardTimerStarten() {
  dashboardTimerStoppen();

  if (!dashboardMessage) {
    return;
  }

  dashboardUptimeTimer =
    setInterval(
      async () => {
        if (!dashboardMessage) {
          return;
        }

        try {
          await dashboardMessage.edit({
            embeds: [
              dashboardEmbed()
            ],

            components:
              panelButtons()
          });

        } catch (err) {
          console.log(
            "Dashboard Update Fehler:",
            err?.message || err
          );

          if (
            err?.code === 10008
          ) {
            dashboardMessage =
              null;

            dashboardTimerStoppen();

            dashboardDatenLöschen();
          }
        }
      },
      1000
    );

  dashboardGeldTimer =
    setInterval(
      async () => {
        if (
          !dashboardMessage ||
          !mcOnline
        ) {
          return;
        }

        try {
          await geldAktualisieren();

        } catch (err) {
          console.log(
            "Automatische Geldaktualisierung Fehler:",
            err?.message || err
          );
        }
      },
      10000
    );
}

// ==================================================
// SLASH COMMANDS
// ==================================================

const commands = [

  // ==================================================
  // /dashboard
  // ==================================================

  new SlashCommandBuilder()
    .setName("dashboard")
    .setDescription(
      "Zeigt das FrozenRun Dashboard."
    ),

  // ==================================================
  // /panel
  // ==================================================

  new SlashCommandBuilder()
    .setName("panel")
    .setDescription(
      "Zeigt das FrozenRun Control Panel."
    ),

  // ==================================================
  // /mc
  // ==================================================

  new SlashCommandBuilder()
    .setName("mc")
    .setDescription(
      "Sendet einen Minecraft-Befehl."
    )
    .addStringOption(
      option =>
        option
          .setName("befehl")
          .setDescription(
            "Minecraft-Befehl ohne /"
          )
          .setRequired(true)
    ),

  // ==================================================
  // /controller
  // ==================================================

  new SlashCommandBuilder()
    .setName("controller")
    .setDescription(
      "Verwaltet die Controller."
    )
    .addSubcommand(
      sub =>
        sub
          .setName("hinzufügen")
          .setDescription(
            "Fügt einen Controller hinzu."
          )
          .addUserOption(
            option =>
              option
                .setName("user")
                .setDescription(
                  "Discord User"
                )
                .setRequired(true)
          )
    )
    .addSubcommand(
      sub =>
        sub
          .setName("entfernen")
          .setDescription(
            "Entfernt einen Controller."
          )
          .addUserOption(
            option =>
              option
                .setName("user")
                .setDescription(
                  "Discord User"
                )
                .setRequired(true)
          )
    )
    .addSubcommand(
      sub =>
        sub
          .setName("liste")
          .setDescription(
            "Zeigt alle Controller."
          )
    ),

  // ==================================================
  // /laufen
  // ==================================================

  new SlashCommandBuilder()
    .setName("laufen")
    .setDescription(
      "Startet oder stoppt das automatische Laufen."
    )
    .addStringOption(
      option =>
        option
          .setName("aktion")
          .setDescription(
            "Start oder Stop"
          )
          .setRequired(true)
          .addChoices(
            {
              name: "Start",
              value: "start"
            },
            {
              name: "Stop",
              value: "stop"
            }
          )
    )
];

// ==================================================
// DISCORD READY
// ==================================================

discord.once(
  "ready",
  async () => {
    console.log(
      `Discord-Bot online als ${discord.user.tag}`
    );

    try {
      await discord.application.commands.set(
        commands.map(
          command =>
            command.toJSON()
        )
      );

      console.log(
        "/dashboard registriert."
      );

      console.log(
        "/panel registriert."
      );

      console.log(
        "/mc registriert."
      );

      console.log(
        "/controller registriert."
      );

      console.log(
        "/laufen registriert."
      );

    } catch (err) {
      console.log(
        "Slash-Command Fehler:",
        err?.message || err
      );
    }

    // ==================================================
    // DASHBOARD NACH NEUSTART SUCHEN
    // ==================================================

    const vorhandenesDashboard =
      await dashboardAutomatischFinden();

    if (vorhandenesDashboard) {
      dashboardTimerStarten();
    }

    console.log(
      "Minecraft startet NICHT automatisch."
    );
  }
);

// ==================================================
// INTERACTIONS
// ==================================================

discord.on(
  "interactionCreate",
  async interaction => {

    try {

      // ==================================================
      // SLASH COMMAND
      // ==================================================

      if (
        interaction.isChatInputCommand()
      ) {

        // ==================================================
        // /DASHBOARD
        // ==================================================

        if (
          interaction.commandName ===
          "dashboard"
        ) {

          if (
            !darfSteuern(interaction)
          ) {
            await interaction.reply({
              content:
                "❌ Du darfst den Bot nicht steuern.",
              flags:
                MessageFlags.Ephemeral
            });

            return;
          }

          if (dashboardMessage) {
            try {
              await dashboardMessage.delete();
            } catch {}
          }

          dashboardTimerStoppen();

          if (mcOnline) {
            await geldAktualisieren();
          }

          await interaction.reply({
            embeds: [
              dashboardEmbed()
            ],

            components:
              panelButtons()
          });

          dashboardMessage =
            await interaction.fetchReply();

          dashboardDatenSpeichern(
            interaction.guildId,
            interaction.channelId,
            dashboardMessage.id
          );

          dashboardTimerStarten();

          return;
        }

        // ==================================================
        // /PANEL
        // ==================================================

        if (
          interaction.commandName ===
          "panel"
        ) {

          if (
            !darfSteuern(interaction)
          ) {
            await interaction.reply({
              content:
                "❌ Du darfst den Bot nicht steuern.",
              flags:
                MessageFlags.Ephemeral
            });

            return;
          }

          await interaction.reply({
            embeds: [
              panelEmbed()
            ],

            components:
              panelButtons(),

            flags:
              MessageFlags.Ephemeral
          });

          return;
        }

        // ==================================================
        // /MC
        // ==================================================

        if (
          interaction.commandName ===
          "mc"
        ) {

          if (
            !darfSteuern(interaction)
          ) {
            await interaction.reply({
              content:
                "❌ Du darfst den Bot nicht steuern.",
              flags:
                MessageFlags.Ephemeral
            });

            return;
          }

          if (!mcOnline) {
            await interaction.reply({
              content:
                "❌ FrozenRun ist nicht online.",
              flags:
                MessageFlags.Ephemeral
            });

            return;
          }

          let command =
            interaction.options.getString(
              "befehl"
            );

          command =
            command.trim();

          if (!command) {
            await interaction.reply({
              content:
                "❌ Kein Minecraft-Befehl angegeben.",
              flags:
                MessageFlags.Ephemeral
            });

            return;
          }

          if (!command.startsWith("/")) {
            command =
              "/" + command;
          }

          const output =
            await minecraftCommand(
              command
            );

          await interaction.reply({
            content:
              output
                ? `\`\`\`\n${output}\n\`\`\``
                : "Minecraft-Befehl gesendet.",
            flags:
              MessageFlags.Ephemeral
          });

          return;
        }

        // ==================================================
        // /CONTROLLER
        // ==================================================

        if (
          interaction.commandName ===
          "controller"
        ) {

          if (
            !istServerOwner(interaction)
          ) {
            await interaction.reply({
              content:
                "❌ Nur der Serverbesitzer darf Controller verwalten.",
              flags:
                MessageFlags.Ephemeral
            });

            return;
          }

          const subcommand =
            interaction.options.getSubcommand();

          // ==================================================
          // CONTROLLER HINZUFÜGEN
          // ==================================================

          if (
            subcommand ===
            "hinzufügen"
          ) {

            const user =
              interaction.options.getUser(
                "user"
              );

            if (!user) {
              await interaction.reply({
                content:
                  "❌ User nicht gefunden.",
                flags:
                  MessageFlags.Ephemeral
              });

              return;
            }

            erlaubteController.add(
              user.id
            );

            await interaction.reply({
              content:
                `✅ ${user} darf den Bot jetzt steuern.`,
              flags:
                MessageFlags.Ephemeral
            });

            return;
          }

          // ==================================================
          // CONTROLLER ENTFERNEN
          // ==================================================

          if (
            subcommand ===
            "entfernen"
          ) {

            const user =
              interaction.options.getUser(
                "user"
              );

            if (!user) {
              await interaction.reply({
                content:
                  "❌ User nicht gefunden.",
                flags:
                  MessageFlags.Ephemeral
              });

              return;
            }

            erlaubteController.delete(
              user.id
            );

            await interaction.reply({
              content:
                `✅ ${user} wurde als Controller entfernt.`,
              flags:
                MessageFlags.Ephemeral
            });

            return;
          }

          // ==================================================
          // CONTROLLER LISTE
          // ==================================================

          if (
            subcommand ===
            "liste"
          ) {

            if (
              erlaubteController.size ===
              0
            ) {

              await interaction.reply({
                content:
                  "📋 Es sind aktuell keine zusätzlichen Controller eingetragen.",
                flags:
                  MessageFlags.Ephemeral
              });

              return;
            }

            const liste =
              [...erlaubteController]
                .map(
                  id =>
                    `<@${id}>`
                )
                .join("\n");

            await interaction.reply({
              content:
                `📋 Controller:\n${liste}`,
              flags:
                MessageFlags.Ephemeral
            });

            return;
          }
        }

        // ==================================================
        // /LAUFEN
        // ==================================================

        if (
          interaction.commandName ===
          "laufen"
        ) {

          if (
            !darfSteuern(interaction)
          ) {
            await interaction.reply({
              content:
                "❌ Du darfst den Bot nicht steuern.",
              flags:
                MessageFlags.Ephemeral
            });

            return;
          }

          const aktion =
            interaction.options.getString(
              "aktion"
            );

          if (
            aktion ===
            "start"
          ) {

            if (!mcOnline) {
              await interaction.reply({
                content:
                  "❌ FrozenRun ist offline.",
                flags:
                  MessageFlags.Ephemeral
              });

              return;
            }

            try {
              laufenStarten();

              await interaction.reply({
                content:
                  "🏃 FrozenRun läuft jetzt.",
                flags:
                  MessageFlags.Ephemeral
              });

            } catch (err) {

              await interaction.reply({
                content:
                  `❌ ${err.message}`,
                flags:
                  MessageFlags.Ephemeral
              });
            }

            return;
          }

          if (
            aktion ===
            "stop"
          ) {

            laufenStoppen();

            await interaction.reply({
              content:
                "🛑 FrozenRun läuft nicht mehr.",
              flags:
                MessageFlags.Ephemeral
            });

            return;
          }
        }
      }

      // ==================================================
      // BUTTONS
      // ==================================================

      if (
        interaction.isButton()
      ) {

        if (
          !darfSteuern(interaction)
        ) {
          await interaction.reply({
            content:
              "❌ Du darfst den Bot nicht steuern.",
            flags:
              MessageFlags.Ephemeral
          });

          return;
        }

        // ==================================================
        // BOT EIN / AUS
        // ==================================================

        if (
          interaction.customId ===
          "toggle_bot"
        ) {

          if (mcOnline) {

            manuellGestoppt = true;

            laufenStoppen();

            if (reconnectTimer) {
              clearTimeout(
                reconnectTimer
              );

              reconnectTimer =
                null;
            }

            if (mcBot) {
              try {
                mcBot.disconnect();
              } catch {}
            }

            mcBot = null;

            mcOnline = false;

            minecraftUuid = null;

            playerEntityId = 0;

            await interaction.update({
              embeds: [
                panelEmbed()
              ],

              components:
                panelButtons()
            });

          } else {

            manuellGestoppt = false;

            await interaction.update({
              embeds: [
                panelEmbed()
              ],

              components:
                panelButtons()
            });

            minecraftVerbinden();
          }

          return;
        }

        // ==================================================
        // STATUS
        // ==================================================

        if (
          interaction.customId ===
          "status"
        ) {

          const status =
            mcOnline
              ? "🟢 FrozenRun ist online."
              : "🔴 FrozenRun ist offline.";

          await interaction.reply({
            content:
              `${status}\n📍 Koordinaten: ${formatKoordinaten()}\n⏱️ Uptime: ${formatLiveUptime()}`,
            flags:
              MessageFlags.Ephemeral
          });

          return;
        }

        // ==================================================
        // GELD
        // ==================================================

        if (
          interaction.customId ===
          "money"
        ) {

          if (!mcOnline) {
            await interaction.reply({
              content:
                "❌ FrozenRun ist offline.",
              flags:
                MessageFlags.Ephemeral
            });

            return;
          }

          await geldAktualisieren();

          await interaction.reply({
            content:
              `💰 Kontostand: **${formatGeld(aktuellesGeld)}**`,
            flags:
              MessageFlags.Ephemeral
          });

          return;
        }

        // ==================================================
        // HOME AFK
        // ==================================================

        if (
          interaction.customId ===
          "home_afk"
        ) {

          if (!mcOnline) {
            await interaction.reply({
              content:
                "❌ FrozenRun ist offline.",
              flags:
                MessageFlags.Ephemeral
            });

            return;
          }

          const output =
            await minecraftCommand(
              "/sethome afk"
            );

          await interaction.reply({
            content:
              output
                ? `🏠 Home AFK gesetzt.\n${output}`
                : "🏠 Home AFK gesetzt.",
            flags:
              MessageFlags.Ephemeral
          });

          return;
        }

        // ==================================================
        // RECONNECT
        // ==================================================

        if (
          interaction.customId ===
          "reconnect"
        ) {

          laufenStoppen();

          manuellGestoppt =
            false;

          if (reconnectTimer) {
            clearTimeout(
              reconnectTimer
            );

            reconnectTimer =
              null;
          }

          if (mcBot) {
            try {
              mcBot.disconnect();
            } catch {}
          }

          mcBot = null;

          mcOnline = false;

          minecraftUuid = null;

          playerEntityId = 0;

          await interaction.reply({
            content:
              "🔄 FrozenRun wird neu verbunden.",
            flags:
              MessageFlags.Ephemeral
          });

          minecraftVerbinden();

          return;
        }

        // ==================================================
        // STOP
        // ==================================================

        if (
          interaction.customId ===
          "stop"
        ) {

          manuellGestoppt =
            true;

          laufenStoppen();

          if (reconnectTimer) {
            clearTimeout(
              reconnectTimer
            );

            reconnectTimer =
              null;
          }

          if (mcBot) {
            try {
              mcBot.disconnect();
            } catch {}
          }

          mcBot = null;

          mcOnline = false;

          minecraftUuid = null;

          playerEntityId = 0;

          await interaction.update({
            embeds: [
              panelEmbed()
            ],

            components:
              panelButtons()
          });

          return;
        }

        // ==================================================
        // PAY
        // ==================================================

        if (
          interaction.customId ===
          "pay"
        ) {

          if (!mcOnline) {
            await interaction.reply({
              content:
                "❌ FrozenRun ist offline.",
              flags:
                MessageFlags.Ephemeral
            });

            return;
          }

          const modal =
            new ModalBuilder()
              .setCustomId(
                "pay_modal"
              )
              .setTitle(
                "💸 Geld senden"
              );

          const amountInput =
            new TextInputBuilder()
              .setCustomId(
                "pay_amount"
              )
              .setLabel(
                "Betrag"
              )
              .setPlaceholder(
                "z. B. 5000"
              )
              .setStyle(
                TextInputStyle.Short
              )
              .setRequired(true);

          const row =
            new ActionRowBuilder()
              .addComponents(
                amountInput
              );

          modal.addComponents(
            row
          );

          await interaction.showModal(
            modal
          );

          return;
        }
      }

      // ==================================================
      // MODAL
      // ==================================================

      if (
        interaction.isModalSubmit()
      ) {

        if (
          interaction.customId !==
          "pay_modal"
        ) {
          return;
        }

        if (
          !darfSteuern(interaction)
        ) {
          await interaction.reply({
            content:
              "❌ Du darfst den Bot nicht steuern.",
            flags:
              MessageFlags.Ephemeral
          });

          return;
        }

        if (!mcOnline) {
          await interaction.reply({
            content:
              "❌ FrozenRun ist offline.",
            flags:
              MessageFlags.Ephemeral
          });

          return;
        }

        const eingabe =
          interaction.fields.getTextInputValue(
            "pay_amount"
          );

        let betrag =
          Number(
            String(eingabe)
              .replace(/\./g, "")
              .replace(",", ".")
              .trim()
          );

        if (
          !Number.isFinite(betrag) ||
          betrag <= 0
        ) {
          await interaction.reply({
            content:
              "❌ Ungültiger Betrag.",
            flags:
              MessageFlags.Ephemeral
          });

          return;
        }

        betrag =
          Math.floor(betrag);

        await geldAktualisieren();

        if (
          betrag >
          aktuellesGeld
        ) {
          await interaction.reply({
            content:
              `❌ Nicht genug Geld.\nKontostand: **${formatGeld(aktuellesGeld)}**`,
            flags:
              MessageFlags.Ephemeral
          });

          return;
        }

        const ersterBefehl =
          `/pay ${MONEY_TARGET} ${betrag}`;

        const ersteAntwort =
          await minecraftCommand(
            ersterBefehl
          );

        if (
          betrag > 4999
        ) {

          const bestaetigung =
            `/pay ${MONEY_TARGET} ${betrag} confirm`;

          const zweiteAntwort =
            await minecraftCommand(
              bestaetigung
            );

          await geldAktualisieren();

          await interaction.reply({
            content:
              `💸 **${formatGeld(betrag)}** an **${MONEY_TARGET}** gesendet.\n\n` +
              "Bestätigung für Beträge über 4999 wurde ausgeführt." +
              (
                zweiteAntwort
                  ? `\n\nMinecraft:\n${zweiteAntwort}`
                  : ""
              ),
            flags:
              MessageFlags.Ephemeral
          });

          return;
        }

        await geldAktualisieren();

        await interaction.reply({
          content:
            `💸 **${formatGeld(betrag)}** an **${MONEY_TARGET}** gesendet.` +
            (
              ersteAntwort
                ? `\n\nMinecraft:\n${ersteAntwort}`
                : ""
            ),
          flags:
            MessageFlags.Ephemeral
        });

        return;
      }

    } catch (err) {

      console.log(
        "Interaction Fehler:",
        err?.message || err
      );

      try {

        if (
          interaction.replied ||
          interaction.deferred
        ) {

          await interaction.followUp({
            content:
              "❌ Es ist ein Fehler aufgetreten.",
            flags:
              MessageFlags.Ephemeral
          });

        } else {

          await interaction.reply({
            content:
              "❌ Es ist ein Fehler aufgetreten.",
            flags:
              MessageFlags.Ephemeral
          });
        }

      } catch {}
    }
  }
);
// ==================================================
// DISCORD LOGIN
// ==================================================

discord.login(
  DISCORD_TOKEN
);
