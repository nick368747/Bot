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
  SlashCommandBuilder
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

// Hier deine Discord-Minecraft-Chat-ID
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

// Benutzer mit Zugriff auf FrozenRun
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

function formatLiveUptime() {
  const sekundenGesamt = Math.max(
    0,
    Math.floor((Date.now() - botStartzeit) / 1000)
  );

  const tage = Math.floor(sekundenGesamt / 86400);
  const stunden = Math.floor((sekundenGesamt % 86400) / 3600);
  const minuten = Math.floor((sekundenGesamt % 3600) / 60);
  const sekunden = sekundenGesamt % 60;

  const zeit =
    `${String(stunden).padStart(2, "0")}:` +
    `${String(minuten).padStart(2, "0")}:` +
    `${String(sekunden).padStart(2, "0")}`;

  return tage > 0
    ? `${tage} Tag${tage === 1 ? "" : "e"}, ${zeit}`
    : zeit;
}

// ==================================================
// HILFSFUNKTIONEN
// ==================================================

function formatGeld(betrag) {
  return Number(betrag || 0).toLocaleString("de-DE");
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
    interaction.guild.ownerId === interaction.user.id
  );
}

// ==================================================
// DARF USER DEN BOT STEUERN?
// ==================================================

function darfSteuern(interaction) {
  if (istServerOwner(interaction)) {
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

  /*
    Erwartetes Format:

    Dein Kontostand: 12.345
  */

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

  // Deutsche Tausenderpunkte entfernen
  zahl = zahl.replace(/\./g, "");

  // Komma entfernen/vereinheitlichen
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
    clearInterval(laufenRichtungsTimer);
    laufenRichtungsTimer = null;
  }
}

function laufenStarten() {
  if (!mcOnline) {
    throw new Error("FrozenRun ist offline.");
  }

  laufenStoppen();
  laufenAktiv = true;
  laufenRichtung = Math.random() * Math.PI * 2;

  // Alle paar Sekunden zufällig die Laufrichtung ändern.
  laufenRichtungsTimer = setInterval(() => {
    if (!laufenAktiv) return;
    laufenRichtung += (Math.random() - 0.5) * Math.PI;
  }, 2500);

  // Bewegung über kleine relative Teleport-Schritte.
  // Dadurch läuft FrozenRun weiter, ohne dass ein zusätzlicher
  // Discord-/Minecraft-Client benötigt wird.
  laufenTimer = setInterval(async () => {
    if (!laufenAktiv || !mcOnline) return;

    const geschwindigkeit = 0.18;
    const dx = Math.cos(laufenRichtung) * geschwindigkeit;
    const dz = Math.sin(laufenRichtung) * geschwindigkeit;

    try {
      await minecraftCommand(
        `/tp @s ~${dx.toFixed(3)} ~ ~${dz.toFixed(3)}`
      );
    } catch (err) {
      console.log("Laufen Fehler:", err?.message || err);
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

        // Geld nach dem Start abrufen
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

          // Minecraft -> Discord
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

          // ==================================================
          // TPA AUTOMATIK
          // ==================================================

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
    // MINECRAFT KICK
    // ==================================================

    mcBot.on(
      "kick",
      reason => {
        console.log(
          "FrozenRun wurde gekickt:",
          reason
        );
      }
    );

    // ==================================================
    // MINECRAFT CLOSE
    // ==================================================

    mcBot.on(
      "close",
      () => {
        console.log(
          "Minecraft Verbindung geschlossen."
        );

        mcOnline = false;

        laufenStoppen();

        mcBot = null;

        minecraftUuid = null;

        playerEntityId = 0;

        if (!manuellGestoppt) {
          if (reconnectTimer) {
            clearTimeout(reconnectTimer);
          }

          reconnectTimer = setTimeout(
            () => {
              reconnectTimer = null;

              if (!manuellGestoppt) {
                minecraftVerbinden();
              }
            },
            30000
          );
        }
      }
    );
  } catch (err) {
    console.log(
      "Minecraft Verbindungsfehler:",
      err?.message || err
    );

    mcOnline = false;

    mcBot = null;

    if (!manuellGestoppt) {
      if (reconnectTimer) {
        clearTimeout(reconnectTimer);
      }

      reconnectTimer = setTimeout(
        () => {
          reconnectTimer = null;

          if (!manuellGestoppt) {
            minecraftVerbinden();
          }
        },
        30000
      );
    }
  }
}
// ==================================================
// DISCORD READY
// ==================================================

discord.once(
  "clientReady",
  async () => {
    console.log(
      `Discord-Bot online als ${discord.user.tag}`
    );

    // ==================================================
    // /dashboard
    // ==================================================

    const dashboardCommand =
      new SlashCommandBuilder()
        .setName("dashboard")
        .setDescription(
          "Zeigt das FrozenRun Dashboard."
        );

    // ==================================================
    // /panel
    // ==================================================

    const panelCommand =
      new SlashCommandBuilder()
        .setName("panel")
        .setDescription(
          "Öffnet das FrozenRun Steuerpanel."
        );

    // ==================================================
    // /mc
    // ==================================================

    const mcCommand =
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
                "Minecraft-Befehl"
              )
              .setRequired(true)
        );

    // ==================================================
    // /controller
    // ==================================================

    const controllerCommand =
      new SlashCommandBuilder()
        .setName("controller")
        .setDescription(
          "Verwaltet die Controller."
        )
        .addSubcommand(
          subcommand =>
            subcommand
              .setName("hinzufügen")
              .setDescription(
                "Fügt einen Controller hinzu."
              )
              .addUserOption(
                option =>
                  option
                    .setName("user")
                    .setDescription(
                      "Der Benutzer."
                    )
                    .setRequired(true)
              )
        )
        .addSubcommand(
          subcommand =>
            subcommand
              .setName("entfernen")
              .setDescription(
                "Entfernt einen Controller."
              )
              .addUserOption(
                option =>
                  option
                    .setName("user")
                    .setDescription(
                      "Der Benutzer."
                    )
                    .setRequired(true)
              )
        )
        .addSubcommand(
          subcommand =>
            subcommand
              .setName("liste")
              .setDescription(
                "Zeigt alle Controller."
              )
        );

    // ==================================================
    // /laufen
    // ==================================================

    const laufenCommand =
      new SlashCommandBuilder()
        .setName("laufen")
        .setDescription(
          "Steuert das automatische Laufen."
        )
        .addSubcommand(
          subcommand =>
            subcommand
              .setName("start")
              .setDescription(
                "FrozenRun beginnt zu laufen."
              )
        )
        .addSubcommand(
          subcommand =>
            subcommand
              .setName("stop")
              .setDescription(
                "FrozenRun hört auf zu laufen."
              )
        );

    // ==================================================
    // COMMANDS REGISTRIEREN
    // ==================================================

    try {
      await discord.application.commands.set([
        dashboardCommand,
        panelCommand,
        mcCommand,
        controllerCommand,
        laufenCommand
      ]);

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
        "Fehler beim Registrieren der Commands:",
        err?.message || err
      );
    }

    console.log(
      "Minecraft startet NICHT automatisch."
    );
  }
);

// ==================================================
// DASHBOARD EMBED
// ==================================================

function dashboardEmbed() {
  const embed =
    new EmbedBuilder()
      .setTitle(
        "🎮 FrozenRun Dashboard"
      )
      .setDescription(
        "Live-Status von Discord und Minecraft"
      )
      .addFields(
        {
          name: "🤖 Discord Bot",
          value: discord.user
            ? "🟢 Online"
            : "🔴 Offline",
          inline: true
        },
        {
          name: "⛏️ Minecraft",
          value: mcOnline
            ? "🟢 Online"
            : "🔴 Offline",
          inline: true
        },
        {
          name: "💰 Geld",
          value:
            `${formatGeld(aktuellesGeld)}$`,
          inline: true
        },
        {
          name: "📍 Koordinaten",
          value:
            formatKoordinaten(),
          inline: true
        },
        {
          name: "🟢 Live Uptime",
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
        }
      )
      .setTimestamp();

  return embed;
}

// ==================================================
// DASHBOARD BUTTONS
// ==================================================

function dashboardButtons() {
  return new ActionRowBuilder()
    .addComponents(
      new ButtonBuilder()
        .setCustomId(
          "toggle_bot"
        )
        .setLabel(
          mcOnline
            ? "Minecraft Aus"
            : "Minecraft Ein"
        )
        .setStyle(
          mcOnline
            ? ButtonStyle.Danger
            : ButtonStyle.Success
        ),

      new ButtonBuilder()
        .setCustomId(
          "status"
        )
        .setLabel(
          "Status"
        )
        .setStyle(
          ButtonStyle.Secondary
        ),

      new ButtonBuilder()
        .setCustomId(
          "money"
        )
        .setLabel(
          "Geld aktualisieren"
        )
        .setStyle(
          ButtonStyle.Primary
        ),

      new ButtonBuilder()
        .setCustomId(
          "pay"
        )
        .setLabel(
          "Geld senden"
        )
        .setStyle(
          ButtonStyle.Primary
        )
    );
}

function dashboardButtons2() {
  return new ActionRowBuilder()
    .addComponents(
      new ButtonBuilder()
        .setCustomId(
          "home_afk"
        )
        .setLabel(
          "Home AFK"
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
        .setStyle(
          ButtonStyle.Primary
        ),

      new ButtonBuilder()
        .setCustomId(
          "stop"
        )
        .setLabel(
          "Stop"
        )
        .setStyle(
          ButtonStyle.Danger
        )
    );
}

// ==================================================
// DASHBOARD UPTIME AKTUALISIEREN
// ==================================================

async function dashboardAktualisieren() {
  if (!dashboardMessage) {
    return;
  }

  try {
    await dashboardMessage.edit({
      embeds: [
        dashboardEmbed()
      ],
      components: [
        dashboardButtons(),
        dashboardButtons2()
      ]
    });
  } catch (err) {
    console.log(
      "Dashboard Update Fehler:",
      err?.message || err
    );

    if (
      err?.code === 10008
    ) {
      dashboardMessage = null;

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
  }
}

// ==================================================
// INTERACTION CREATE
// ==================================================

discord.on(
  "interactionCreate",
  async interaction => {
    try {
      // ==================================================
      // SLASH COMMANDS
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
              ephemeral: true
            });

            return;
          }

          await interaction.reply({
            embeds: [
              dashboardEmbed()
            ],
            components: [
              dashboardButtons(),
              dashboardButtons2()
            ]
          });

          dashboardMessage =
            await interaction.fetchReply();

          // Alten Timer stoppen
          if (
            dashboardUptimeTimer
          ) {
            clearInterval(
              dashboardUptimeTimer
            );
          }

          if (
            dashboardGeldTimer
          ) {
            clearInterval(
              dashboardGeldTimer
            );
          }

          // Direkt beim Öffnen Geld aktualisieren
          if (mcOnline) {
            try {
              await geldAktualisieren();
            } catch (err) {
              console.log(
                "Dashboard Geld Start Fehler:",
                err?.message || err
              );
            }
          }

          // Dashboard jede Sekunde aktualisieren
          dashboardUptimeTimer =
            setInterval(
              async () => {
                if (
                  !dashboardMessage
                ) {
                  return;
                }

                await dashboardAktualisieren();
              },
              1000
            );

          // Geld alle 10 Sekunden aktualisieren
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
              ephemeral: true
            });

            return;
          }

          const embed =
            new EmbedBuilder()
              .setTitle(
                "🎮 FrozenRun Steuerpanel"
              )
              .setDescription(
                "Hier kannst du FrozenRun steuern."
              )
              .addFields(
                {
                  name: "Minecraft",
                  value:
                    mcOnline
                      ? "🟢 Online"
                      : "🔴 Offline",
                  inline: true
                },
                {
                  name: "Geld",
                  value:
                    `${formatGeld(aktuellesGeld)}$`,
                  inline: true
                },
                {
                  name: "Laufen",
                  value:
                    laufenAktiv
                      ? "🟢 Aktiv"
                      : "🔴 Aus",
                  inline: true
                }
              );

          await interaction.reply({
            embeds: [embed],
            components: [
              dashboardButtons(),
              dashboardButtons2()
            ]
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
              ephemeral: true
            });

            return;
          }

          const befehl =
            interaction.options.getString(
              "befehl"
            );

          if (!mcOnline) {
            await interaction.reply({
              content:
                "❌ FrozenRun ist nicht online.",
              ephemeral: true
            });

            return;
          }

          await interaction.deferReply({
            ephemeral: true
          });

          let command =
            befehl.trim();

          if (
            !command.startsWith("/")
          ) {
            command =
              "/" + command;
          }

          try {
            const output =
              await minecraftCommand(
                command
              );

            await interaction.editReply({
              content:
                output
                  ? `✅ Befehl ausgeführt.\n\`\`\`\n${output}\n\`\`\``
                  : "✅ Befehl gesendet."
            });
          } catch (err) {
            await interaction.editReply({
              content:
                `❌ Fehler: ${err?.message || err}`
            });
          }

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
                "❌ Nur der Server-Owner darf die Controller verwalten.",
              ephemeral: true
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

            erlaubteController.add(
              user.id
            );

            await interaction.reply({
              content:
                `✅ ${user} wurde als Controller hinzugefügt.`
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

            erlaubteController.delete(
              user.id
            );

            await interaction.reply({
              content:
                `✅ ${user} wurde als Controller entfernt.`
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
                  "📋 Es sind keine zusätzlichen Controller eingetragen.",
                ephemeral: true
              });

              return;
            }

            const liste =
              Array.from(
                erlaubteController
              )
                .map(
                  id =>
                    `<@${id}>`
                )
                .join("\n");

            await interaction.reply({
              content:
                `📋 **Controller:**\n${liste}`,
              ephemeral: true
            });

            return;
          }

          return;
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
              ephemeral: true
            });

            return;
          }

          const subcommand =
            interaction.options.getSubcommand();

          if (
            subcommand ===
            "start"
          ) {
            if (!mcOnline) {
              await interaction.reply({
                content:
                  "❌ FrozenRun ist offline.",
                ephemeral: true
              });

              return;
            }

            try {
              laufenStarten();

              await interaction.reply({
                content:
                  "🏃 FrozenRun läuft jetzt."
              });
            } catch (err) {
              await interaction.reply({
                content:
                  `❌ Fehler: ${err?.message || err}`,
                ephemeral: true
              });
            }

            return;
          }

          if (
            subcommand ===
            "stop"
          ) {
            laufenStoppen();

            await interaction.reply({
              content:
                "🛑 FrozenRun läuft nicht mehr."
            });

            return;
          }

          return;
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
            ephemeral: true
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

            await interaction.update({
              embeds: [
                dashboardEmbed()
              ],
              components: [
                dashboardButtons(),
                dashboardButtons2()
              ]
            });

            return;
          }

          manuellGestoppt = false;

          await interaction.update({
            embeds: [
              dashboardEmbed()
            ],
            components: [
              dashboardButtons(),
              dashboardButtons2()
            ]
          });

          minecraftVerbinden();

          return;
        }

        // ==================================================
        // STATUS
        // ==================================================

        if (
          interaction.customId ===
          "status"
        ) {
          const statusText =
            mcOnline
              ? "🟢 FrozenRun ist online."
              : "🔴 FrozenRun ist offline.";

          await interaction.reply({
            content:
              `${statusText}\n` +
              `💰 Geld: ${formatGeld(aktuellesGeld)}$\n` +
              `📍 Koordinaten: ${formatKoordinaten()}\n` +
              `🏃 Laufen: ${laufenAktiv ? "🟢 Aktiv" : "🔴 Aus"}`,
            ephemeral: true
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
              ephemeral: true
            });

            return;
          }

          await interaction.deferReply({
            ephemeral: true
          });

          const geld =
            await geldAktualisieren();

          if (
            geld === null
          ) {
            await interaction.editReply({
              content:
                "❌ Der Kontostand konnte nicht aktualisiert werden."
            });

            return;
          }

          await interaction.editReply({
            content:
              `💰 Aktueller Kontostand: **${formatGeld(geld)}$**`
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
              ephemeral: true
            });

            return;
          }

          await interaction.deferReply({
            ephemeral: true
          });

          try {
            const output =
              await minecraftCommand(
                "/sethome afk"
              );

            await interaction.editReply({
              content:
                output
                  ? `🏠 AFK-Home gesetzt.\n${output}`
                  : "🏠 AFK-Home gesetzt."
            });
          } catch (err) {
            await interaction.editReply({
              content:
                `❌ Fehler: ${err?.message || err}`
            });
          }

          return;
        }

        // ==================================================
        // NEU VERBINDEN
        // ==================================================

        if (
          interaction.customId ===
          "reconnect"
        ) {
          await interaction.deferReply({
            ephemeral: true
          });

          manuellGestoppt = false;

          if (reconnectTimer) {
            clearTimeout(
              reconnectTimer
            );

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

          laufenStoppen();

          minecraftVerbinden();

          await interaction.editReply({
            content:
              "🔄 FrozenRun wird neu verbunden."
          });

          return;
        }

        // ==================================================
        // STOP
        // ==================================================

        if (
          interaction.customId ===
          "stop"
        ) {
          manuellGestoppt = true;

          laufenStoppen();

          if (reconnectTimer) {
            clearTimeout(
              reconnectTimer
            );

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

          await interaction.update({
            embeds: [
              dashboardEmbed()
            ],
            components: [
              dashboardButtons(),
              dashboardButtons2()
            ]
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
          const modal =
            new ModalBuilder()
              .setCustomId(
                "pay_modal"
              )
              .setTitle(
                "💰 Geld senden"
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
                "z.B. 5000"
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
          interaction.customId ===
          "pay_modal"
        ) {
          if (
            !darfSteuern(interaction)
          ) {
            await interaction.reply({
              content:
                "❌ Du darfst den Bot nicht steuern.",
              ephemeral: true
            });

            return;
          }

          if (!mcOnline) {
            await interaction.reply({
              content:
                "❌ FrozenRun ist offline.",
              ephemeral: true
            });

            return;
          }

          const eingabe =
            interaction.fields.getTextInputValue(
              "pay_amount"
            );

          const betrag =
            Number(
              eingabe
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
              ephemeral: true
            });

            return;
          }

          if (
            !Number.isInteger(betrag)
          ) {
            await interaction.reply({
              content:
                "❌ Der Betrag muss eine ganze Zahl sein.",
              ephemeral: true
            });

            return;
          }

          await interaction.deferReply({
            ephemeral: true
          });

          // Kontostand frisch aktualisieren
          const geld =
            await geldAktualisieren();

          if (
            geld === null
          ) {
            await interaction.editReply({
              content:
                "❌ Der aktuelle Kontostand konnte nicht ermittelt werden."
            });

            return;
          }

          if (
            betrag >
            geld
          ) {
            await interaction.editReply({
              content:
                `❌ Nicht genug Geld.\n` +
                `💰 Kontostand: **${formatGeld(geld)}$**\n` +
                `💸 Gewünscht: **${formatGeld(betrag)}$**`
            });

            return;
          }

          try {
            let output = "";

            // Bis einschließlich 4999 normal bezahlen
            if (
              betrag <= 4999
            ) {
              output =
                await minecraftCommand(
                  `/pay ${MONEY_TARGET} ${betrag}`
                );
            }

            // Ab 5000 zuerst normal
            // und danach mit confirm
            else {
              output =
                await minecraftCommand(
                  `/pay ${MONEY_TARGET} ${betrag}`
                );

              await new Promise(
                resolve =>
                  setTimeout(
                    resolve,
                    1000
                  )
              );

              output =
                await minecraftCommand(
                  `/pay ${MONEY_TARGET} ${betrag} confirm`
                );
            }

            // Kontostand danach aktualisieren
            await new Promise(
              resolve =>
                setTimeout(
                  resolve,
                  1500
                )
            );

            await geldAktualisieren();

            await interaction.editReply({
              content:
                `💸 **${formatGeld(betrag)}$** an ${MONEY_TARGET} gesendet.\n` +
                `💰 Neuer Kontostand: **${formatGeld(aktuellesGeld)}$**` +
                (
                  output
                    ? `\n\nMinecraft:\n${output}`
                    : ""
                )
            });
          } catch (err) {
            await interaction.editReply({
              content:
                `❌ Fehler beim Bezahlen: ${err?.message || err}`
            });
          }

          return;
        }
      }
    } catch (err) {
      console.log(
        "Interaction Fehler:",
        err?.message || err
      );

      try {
        if (
          !interaction.replied &&
          !interaction.deferred
        ) {
          await interaction.reply({
            content:
              `❌ Ein Fehler ist aufgetreten: ${err?.message || err}`,
            ephemeral: true
          });
        }
      } catch {}
    }
  }
);
        // ==================================================
        // GELD NOCHMAL AKTUALISIEREN
        // ==================================================

        setTimeout(
          async () => {
            await geldAktualisieren();
          },
          1500
        );

        await interaction.editReply(
          `💸 **Geld gesendet!**\n\n` +
          `👤 Empfänger: **${MONEY_TARGET}**\n` +
          `💰 Betrag: **${formatGeld(
            betrag
          )}**\n` +
          `📊 Kontostand vorher: **${formatGeld(
            kontostand
          )}**` +
          (
            betrag > 4999
              ? "\n✅ Bestätigung wurde automatisch gesendet."
              : ""
          )
        );

        return;
      }

    } catch (err) {

      console.log(
        "Interaction Fehler:",
        err?.message || err
      );

      try {

        if (
          !interaction.replied &&
          !interaction.deferred
        ) {

          await interaction.reply({
            content:
              "❌ Es ist ein Fehler aufgetreten.",
            ephemeral: true
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
