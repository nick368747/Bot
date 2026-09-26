const http = require("http");
const fs = require("fs");
const path = require("path");

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

const bedrock =
  require("bedrock-protocol");

const {
  Authflow,
  Titles
} = require("prismarine-auth");

// ==================================================
// MICROSOFT LOGIN RESET
// ==================================================

const minecraftProfilOrdner =
  path.join(
    process.cwd(),
    ".minecraft"
  );

if (
  process.env.RESET_MINECRAFT_LOGIN ===
  "true"
) {
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

// ==================================================
// KONFIGURATION
// ==================================================

const PORT =
  process.env.PORT || 10000;

const DISCORD_TOKEN =
  process.env.DISCORD_TOKEN;

const MC_HOST =
  "blockbande.de";

const MC_PORT =
  19132;

const MC_USERNAME =
  "FrozenRun";

const MONEY_TARGET =
  "!FrozenBoar16433";

const MC_CHANNEL_ID =
  "1552068948676059146";

// ==================================================
// MICROSOFT AUTHFLOW
// ==================================================

const MC_AUTH_FLOW =
  "sisu";

const MC_AUTH_TITLE =
  Titles.MinecraftAndroid;

const MC_AUTH_DEVICE =
  "Android";

// ==================================================
// RENDER WEB SERVER
// ==================================================

const webServer =
  http.createServer(
    (req, res) => {
      res.writeHead(
        200,
        {
          "Content-Type":
            "text/plain; charset=utf-8"
        }
      );

      res.end(
        "FrozenRun Discord/Minecraft Bot läuft."
      );
    }
  );

webServer.listen(
  PORT,
  "0.0.0.0",
  () => {
    console.log(
      `Webserver läuft auf Port ${PORT}`
    );
  }
);

// ==================================================
// DISCORD CLIENT
// ==================================================

const discord =
  new Client({
    intents: [
      GatewayIntentBits.Guilds
    ]
  });

// ==================================================
// CONTROLLER
// ==================================================

const erlaubteController =
  new Set();

// ==================================================
// MINECRAFT STATUS
// ==================================================

let mcBot =
  null;

let mcOnline =
  false;

let manuellGestoppt =
  true;

let reconnectTimer =
  null;

let minecraftUuid =
  null;

let playerEntityId =
  0;

let aktuelleKoordinaten = {
  x: 0,
  y: 0,
  z: 0
};

let aktuellesGeld =
  0;

// ==================================================
// LAUFEN
// ==================================================

let laufenAktiv =
  false;

let laufenTimer =
  null;

let laufenRichtung =
  0;

let laufenRichtungsTimer =
  null;

// ==================================================
// DASHBOARD
// ==================================================

const botStartzeit =
  Date.now();

let dashboardMessage =
  null;

let dashboardUptimeTimer =
  null;

let dashboardGeldTimer =
  null;

// ==================================================
// HILFSFUNKTIONEN
// ==================================================

function formatLiveUptime() {
  const startSekunden =
    Math.floor(
      botStartzeit / 1000
    );

  return `<t:${startSekunden}:R>`;
}

function formatGeld(
  betrag
) {
  return Number(
    betrag || 0
  ).toLocaleString(
    "de-DE"
  );
}

function formatKoordinaten() {
  return (
    `${Math.round(
      aktuelleKoordinaten.x
    )}, ` +
    `${Math.round(
      aktuelleKoordinaten.y
    )}, ` +
    `${Math.round(
      aktuelleKoordinaten.z
    )}`
  );
}

// ==================================================
// SERVER OWNER
// ==================================================

function istServerOwner(
  interaction
) {
  return Boolean(
    interaction.guild &&
    interaction.guild.ownerId ===
      interaction.user.id
  );
}

// ==================================================
// ZUGRIFFSPRÜFUNG
// ==================================================

function darfSteuern(
  interaction
) {
  if (
    istServerOwner(
      interaction
    )
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

function geldAusOutputLesen(
  text
) {
  if (!text) {
    return null;
  }

  const clean =
    String(text).replace(
      /\u00a0/g,
      " "
    );

  const match =
    clean.match(
      /Dein\s+Kontostand\s*:\s*([\d.,]+)/i
    );

  if (!match) {
    console.log(
      "Kontostand nicht gefunden:",
      clean
    );

    return null;
  }

  let zahl =
    match[1];

  zahl =
    zahl.replace(
      /\./g,
      ""
    );

  zahl =
    zahl.replace(
      ",",
      "."
    );

  const wert =
    Number(zahl);

  if (
    !Number.isFinite(
      wert
    )
  ) {
    return null;
  }

  return Math.floor(
    wert
  );
}

// ==================================================
// MINECRAFT COMMAND
// ==================================================

function minecraftCommand(
  command
) {
  return new Promise(
    (resolve, reject) => {
      if (
        !mcBot ||
        !mcOnline
      ) {
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

      let erledigt =
        false;

      function listener(
        packet
      ) {
        try {
          if (
            !packet ||
            erledigt
          ) {
            return;
          }

          if (
            packet.origin &&
            packet.origin.uuid &&
            String(
              packet.origin.uuid
            ) !==
              String(
                minecraftUuid
              )
          ) {
            return;
          }

          erledigt =
            true;

          clearTimeout(
            timeout
          );

          mcBot.removeListener(
            "command_output",
            listener
          );

          let output =
            "";

          if (
            Array.isArray(
              packet.output
            )
          ) {
            output =
              packet.output
                .map(
                  item => {
                    if (
                      typeof item ===
                      "string"
                    ) {
                      return item;
                    }

                    if (
                      item &&
                      typeof item ===
                        "object"
                    ) {
                      return (
                        item.message ||
                        item.text ||
                        JSON.stringify(
                          item
                        )
                      );
                    }

                    return String(
                      item
                    );
                  }
                )
                .join("\n");
          } else if (
            typeof packet.output ===
            "string"
          ) {
            output =
              packet.output;
          } else {
            output =
              JSON.stringify(
                packet
              );
          }

          resolve(
            output
          );
        } catch (err) {
          if (erledigt) {
            return;
          }

          erledigt =
            true;

          clearTimeout(
            timeout
          );

          mcBot.removeListener(
            "command_output",
            listener
          );

          resolve(null);
        }
      }

      const timeout =
        setTimeout(
          () => {
            if (
              erledigt
            ) {
              return;
            }

            erledigt =
              true;

            mcBot.removeListener(
              "command_output",
              listener
            );

            resolve(null);
          },
          8000
        );

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
              type:
                "player",

              uuid:
                minecraftUuid,

              request_id:
                requestId,

              player_entity_id:
                BigInt(
                  playerEntityId ||
                    0
                )
            },

            internal:
              false,

            version:
              "latest"
          }
        );
      } catch (err) {
        clearTimeout(
          timeout
        );

        mcBot.removeListener(
          "command_output",
          listener
        );

        reject(err);
      }
    }
  );
}

// ==================================================
// GELD AKTUALISIEREN
// ==================================================

async function geldAktualisieren() {
  if (
    !mcBot ||
    !mcOnline
  ) {
    return null;
  }

  try {
    const output =
      await minecraftCommand(
        "/money"
      );

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
      geldAusOutputLesen(
        output
      );

    if (
      geld === null
    ) {
      console.log(
        "Kontostand konnte nicht erkannt werden."
      );

      return null;
    }

    aktuellesGeld =
      geld;

    console.log(
      "Aktueller Kontostand:",
      aktuellesGeld
    );

    return geld;
  } catch (err) {
    console.log(
      "Geld Fehler:",
      err?.message || err
    );

    return null;
  }
}

// ==================================================
// LAUFEN STOPPEN
// ==================================================

function laufenStoppen() {
  laufenAktiv =
    false;

  if (
    laufenTimer
  ) {
    clearInterval(
      laufenTimer
    );

    laufenTimer =
      null;
  }

  if (
    laufenRichtungsTimer
  ) {
    clearInterval(
      laufenRichtungsTimer
    );

    laufenRichtungsTimer =
      null;
  }
}

// ==================================================
// LAUFEN STARTEN
// ==================================================

function laufenStarten() {
  if (!mcOnline) {
    throw new Error(
      "FrozenRun ist offline."
    );
  }

  laufenStoppen();

  laufenAktiv =
    true;

  laufenRichtung =
    Math.random() *
    Math.PI *
    2;

  laufenRichtungsTimer =
    setInterval(
      () => {
        if (
          !laufenAktiv ||
          !mcOnline
        ) {
          return;
        }

        laufenRichtung +=
          (Math.random() - 0.5) *
          Math.PI;
      },
      2500
    );

  laufenTimer =
    setInterval(
      async () => {
        if (
          !laufenAktiv ||
          !mcOnline
        ) {
          return;
        }

        const geschwindigkeit =
          0.18;

        const dx =
          Math.cos(
            laufenRichtung
          ) *
          geschwindigkeit;

        const dz =
          Math.sin(
            laufenRichtung
          ) *
          geschwindigkeit;

        aktuelleKoordinaten.x +=
          dx;

        aktuelleKoordinaten.z +=
          dz;

        try {
          await minecraftCommand(
            `/tp @s ${aktuelleKoordinaten.x.toFixed(
              2
            )} ${aktuelleKoordinaten.y.toFixed(
              2
            )} ${aktuelleKoordinaten.z.toFixed(
              2
            )}`
          );
        } catch (err) {
          console.log(
            "Laufen Fehler:",
            err?.message || err
          );
        }
      },
      250
    );
}
// ==================================================
// MINECRAFT VERBINDEN
// ==================================================

function minecraftVerbinden() {
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

  mcBot =
    null;

  mcOnline =
    false;

  minecraftUuid =
    null;

  playerEntityId =
    0;

  console.log(
    "Verbinde FrozenRun mit Minecraft..."
  );

  try {
    const minecraftAuthflow =
      new Authflow(
        MC_USERNAME,
        minecraftProfilOrdner,
        {
          flow:
            MC_AUTH_FLOW,

          authTitle:
            MC_AUTH_TITLE,

          deviceType:
            MC_AUTH_DEVICE,

          forceRefresh:
            process.env.RESET_MINECRAFT_LOGIN ===
            "true"
        },
        data => {
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
      );

    mcBot =
      bedrock.createClient({
        host:
          MC_HOST,

        port:
          MC_PORT,

        username:
          MC_USERNAME,

        profilesFolder:
          minecraftProfilOrdner,

        authflow:
          minecraftAuthflow
      });

    // ==================================================
    // START GAME
    // ==================================================

    mcBot.on(
      "start_game",
      async packet => {
        mcOnline =
          true;

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
            await dashboardAktualisieren();
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
            packet.source_name ||
            "";

          let message =
            packet.message ||
            "";

          if (
            !message &&
            packet.parameters
          ) {
            message =
              packet.parameters.join(
                " "
              );
          }

          // ==============================================
          // MINECRAFT -> DISCORD
          // ==============================================

          const channel =
            discord.channels.cache.get(
              MC_CHANNEL_ID
            );

          if (
            channel &&
            message
          ) {
            await channel
              .send(
                `**${
                  username ||
                  "Minecraft"
                }:** ${message}`
              )
              .catch(
                () => {}
              );
          }

          // ==============================================
          // TPA AUTOMATIK
          // ==============================================

          if (
            username ===
              "FrozenBoar16433" &&
            /tpa(here)?/i.test(
              message
            )
          ) {
            console.log(
              "TPA von FrozenBoar16433 erkannt."
            );

            try {
              await minecraftCommand(
                "/tpaccept"
              );

              console.log(
                "TPA automatisch angenommen."
              );
            } catch (err) {
              console.log(
                "TPA Fehler:",
                err?.message ||
                  err
              );
            }

            setTimeout(
              async () => {
                if (
                  !mcBot ||
                  !mcOnline
                ) {
                  return;
                }

                try {
                  await minecraftCommand(
                    "/sethome afk"
                  );

                  console.log(
                    "AFK-Home gesetzt."
                  );
                } catch (err) {
                  console.log(
                    "AFK-Home Fehler:",
                    err?.message ||
                      err
                  );
                }
              },
              10000
            );
          }
        } catch (err) {
          console.log(
            "Chat Fehler:",
            err?.message ||
              err
          );
        }
      }
    );

    // ==================================================
    // KOORDINATEN AKTUALISIEREN
    // ==================================================

    mcBot.on(
      "move_player",
      packet => {
        try {
          if (
            !packet.position
          ) {
            return;
          }

          aktuelleKoordinaten.x =
            Number(
              packet.position.x ||
                0
            );

          aktuelleKoordinaten.y =
            Number(
              packet.position.y ||
                0
            );

          aktuelleKoordinaten.z =
            Number(
              packet.position.z ||
                0
            );
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
          err?.message ||
            err
        );
      }
    );

    // ==================================================
    // MINECRAFT VERBINDUNG GESCHLOSSEN
    // ==================================================

    mcBot.on(
      "close",
      () => {
        console.log(
          "Minecraft Verbindung geschlossen."
        );

        mcOnline =
          false;

        minecraftUuid =
          null;

        playerEntityId =
          0;

        laufenStoppen();

        if (
          manuellGestoppt
        ) {
          console.log(
            "Manuell gestoppt – kein Reconnect."
          );

          dashboardAktualisieren();

          return;
        }

        if (
          reconnectTimer
        ) {
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
              reconnectTimer =
                null;

              if (
                !manuellGestoppt
              ) {
                minecraftVerbinden();
              }
            },
            30000
          );

        dashboardAktualisieren();
      }
    );
  } catch (err) {
    console.log(
      "Minecraft Verbindungsfehler:",
      err?.message ||
        err
    );
  }
}

// ==================================================
// MINECRAFT STARTEN
// ==================================================

function minecraftStarten() {
  manuellGestoppt =
    false;

  if (mcOnline) {
    return;
  }

  minecraftVerbinden();
}

// ==================================================
// MINECRAFT STOPPEN
// ==================================================

function minecraftStoppen() {
  manuellGestoppt =
    true;

  laufenStoppen();

  if (
    reconnectTimer
  ) {
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

  mcBot =
    null;

  mcOnline =
    false;

  minecraftUuid =
    null;

  playerEntityId =
    0;

  console.log(
    "FrozenRun wurde gestoppt."
  );
}

// ==================================================
// NEU VERBINDEN
// ==================================================

function minecraftNeuVerbinden() {
  manuellGestoppt =
    false;

  laufenStoppen();

  if (
    reconnectTimer
  ) {
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

  mcBot =
    null;

  mcOnline =
    false;

  minecraftUuid =
    null;

  playerEntityId =
    0;

  console.log(
    "FrozenRun wird neu verbunden..."
  );

  setTimeout(
    () => {
      if (
        !manuellGestoppt
      ) {
        minecraftVerbinden();
      }
    },
    1000
  );
}

// ==================================================
// HOME AFK
// ==================================================

async function homeAfkAusfuehren() {
  if (!mcOnline) {
    throw new Error(
      "FrozenRun ist offline."
    );
  }

  await minecraftCommand(
    "/home afk"
  );
}

// ==================================================
// GELDBETRAG NORMALISIEREN
// ==================================================

function geldBetragNormalisieren(
  eingabe
) {
  if (
    eingabe === null ||
    eingabe ===
      undefined
  ) {
    return null;
  }

  let text =
    String(eingabe)
      .trim()
      .replace(
        /\s/g,
        ""
      );

  if (!text) {
    return null;
  }

  text =
    text
      .replace(
        /\./g,
        ""
      )
      .replace(
        ",",
        "."
      );

  const betrag =
    Number(text);

  if (
    !Number.isFinite(
      betrag
    ) ||
    betrag <= 0
  ) {
    return null;
  }

  return betrag;
}

// ==================================================
// GELD SENDEN
// ==================================================

async function geldSenden(
  betragEingabe
) {
  if (!mcOnline) {
    throw new Error(
      "FrozenRun ist offline."
    );
  }

  const betrag =
    geldBetragNormalisieren(
      betragEingabe
    );

  if (
    betrag === null
  ) {
    throw new Error(
      "Ungültiger Geldbetrag."
    );
  }

  const kontostand =
    await geldAktualisieren();

  if (
    kontostand === null
  ) {
    throw new Error(
      "Kontostand konnte nicht abgerufen werden."
    );
  }

  if (
    betrag >
    kontostand
  ) {
    throw new Error(
      `Nicht genug Geld. Kontostand: ${formatGeld(
        kontostand
      )}`
    );
  }

  const betragText =
    Number.isInteger(
      betrag
    )
      ? String(betrag)
      : String(betrag);

  const payCommand =
    `/pay ${MONEY_TARGET} ${betragText}`;

  console.log(
    "Sende Geld:",
    payCommand
  );

  const output =
    await minecraftCommand(
      payCommand
    );

  console.log(
    "PAY OUTPUT:",
    output
  );

  if (
    betrag > 4999
  ) {
    await new Promise(
      resolve =>
        setTimeout(
          resolve,
          1000
        )
    );

    console.log(
      "Sende Pay-Bestätigung..."
    );

    const confirmOutput =
      await minecraftCommand(
        `${payCommand} confirm`
      );

    console.log(
      "PAY CONFIRM OUTPUT:",
      confirmOutput
    );
  }

  await new Promise(
    resolve =>
      setTimeout(
        resolve,
        1000
      )
  );

  await geldAktualisieren();

  return {
    betrag,
    output
  };
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
      "Steuerung für deinen Minecraft-Bot."
    )
    .addFields(
      {
        name:
          "📡 Status",
        value:
          mcOnline
            ? "🟢 Online"
            : "🔴 Offline",
        inline:
          true
      },
      {
        name:
          "💰 Geld",
        value:
          formatGeld(
            aktuellesGeld
          ),
        inline:
          true
      },
      {
        name:
          "📍 Koordinaten",
        value:
          formatKoordinaten(),
        inline:
          true
      },
      {
        name:
          "⏱️ Uptime",
        value:
          formatLiveUptime(),
        inline:
          true
      },
      {
        name:
          "🏃 Laufen",
        value:
          laufenAktiv
            ? "🟢 Aktiv"
            : "🔴 Aus",
        inline:
          true
      },
      {
        name:
          "🤝 TPA",
        value:
          "🟢 FrozenBoar16433 automatisch annehmen → danach /sethome afk",
        inline:
          true
      },
      {
        name:
          "🔐 Zugriff",
        value:
          "Serverbesitzer + freigeschaltete Controller.",
        inline:
          false
      }
    )
    .setFooter({
      text:
        "FrozenRun • BlockBande"
    });
}

// ==================================================
// PANEL BUTTONS
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
          ),

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

  const row2 =
    new ActionRowBuilder()
      .addComponents(
        new ButtonBuilder()
          .setCustomId(
            "toggle_laufen"
          )
          .setLabel(
            "Laufen"
          )
          .setEmoji(
            "🏃"
          )
          .setStyle(
            ButtonStyle.Success
          )
      );

  return [
    row1,
    row2
  ];
}

// ==================================================
// DASHBOARD AKTUALISIEREN
// ==================================================

async function dashboardAktualisieren() {
  if (
    !dashboardMessage
  ) {
    return;
  }

  try {
    await dashboardMessage.edit(
      {
        embeds: [
          dashboardEmbed()
        ],
        components:
          panelButtons()
      }
    );
  } catch (err) {
    console.log(
      "Dashboard Update Fehler:",
      err?.message ||
        err
    );
  }
}

// ==================================================
// DASHBOARD TIMER
// ==================================================

function dashboardTimerStarten() {
  if (
    dashboardUptimeTimer
  ) {
    clearInterval(
      dashboardUptimeTimer
    );
  }

  dashboardUptimeTimer =
    setInterval(
      async () => {
        await dashboardAktualisieren();
      },
      15000
    );

  if (
    dashboardGeldTimer
  ) {
    clearInterval(
      dashboardGeldTimer
    );
  }

  dashboardGeldTimer =
    setInterval(
      async () => {
        if (mcOnline) {
          await geldAktualisieren();
          await dashboardAktualisieren();
        }
      },
      10000
    );
}
// ==================================================
// SLASH COMMANDS
// ==================================================

const slashCommands = [
  new SlashCommandBuilder()
    .setName(
      "dashboard"
    )
    .setDescription(
      "Zeigt das FrozenRun Dashboard."
    ),

  new SlashCommandBuilder()
    .setName(
      "panel"
    )
    .setDescription(
      "Zeigt das FrozenRun Steuerpanel."
    ),

  new SlashCommandBuilder()
    .setName(
      "mc"
    )
    .setDescription(
      "Sendet einen Minecraft-Befehl."
    )
    .addStringOption(
      option =>
        option
          .setName(
            "befehl"
          )
          .setDescription(
            "Minecraft-Befehl ohne führenden Slash."
          )
          .setRequired(
            true
          )
    ),

  new SlashCommandBuilder()
    .setName(
      "controller"
    )
    .setDescription(
      "Verwaltet die FrozenRun Controller."
    )
    .addSubcommand(
      subcommand =>
        subcommand
          .setName(
            "hinzufuegen"
          )
          .setDescription(
            "Fügt einen Controller hinzu."
          )
          .addUserOption(
            option =>
              option
                .setName(
                  "user"
                )
                .setDescription(
                  "Discord-Benutzer."
                )
                .setRequired(
                  true
                )
          )
    )
    .addSubcommand(
      subcommand =>
        subcommand
          .setName(
            "entfernen"
          )
          .setDescription(
            "Entfernt einen Controller."
          )
          .addUserOption(
            option =>
              option
                .setName(
                  "user"
                )
                .setDescription(
                  "Discord-Benutzer."
                )
                .setRequired(
                  true
                )
          )
    )
    .addSubcommand(
      subcommand =>
        subcommand
          .setName(
            "liste"
          )
          .setDescription(
            "Zeigt alle Controller."
          )
    ),

  new SlashCommandBuilder()
    .setName(
      "laufen"
    )
    .setDescription(
      "Steuert den Laufmodus."
    )
    .addSubcommand(
      subcommand =>
        subcommand
          .setName(
            "start"
          )
          .setDescription(
            "Startet das Laufen."
          )
    )
    .addSubcommand(
      subcommand =>
        subcommand
          .setName(
            "stop"
          )
          .setDescription(
            "Stoppt das Laufen."
          )
    )
].map(
  command =>
    command.toJSON()
);

// ==================================================
// DISCORD READY
// ==================================================

discord.once(
  "ready",
  async () => {
    console.log(
      `Discord verbunden als ${discord.user.tag}`
    );

    try {
      await discord.application.commands.set(
        slashCommands
      );

      console.log(
        "Slash Commands registriert."
      );
    } catch (err) {
      console.log(
        "Fehler beim Registrieren der Slash Commands:",
        err?.message ||
          err
      );
    }

    dashboardTimerStarten();

    minecraftStarten();
  }
);

// ==================================================
// DISCORD INTERACTIONS
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
        const command =
          interaction.commandName;

        // ==============================================
        // /dashboard
        // ==============================================

        if (
          command ===
          "dashboard"
        ) {
          if (
            !darfSteuern(
              interaction
            )
          ) {
            await interaction.reply({
              content:
                "❌ Du hast keinen Zugriff auf FrozenRun.",
              flags:
                MessageFlags.Ephemeral
            });

            return;
          }

          const message =
            await interaction.reply({
              embeds: [
                dashboardEmbed()
              ],
              components:
                panelButtons(),
              fetchReply:
                true
            });

          dashboardMessage =
            message;

          return;
        }

        // ==============================================
        // /panel
        // ==============================================

        if (
          command ===
          "panel"
        ) {
          if (
            !darfSteuern(
              interaction
            )
          ) {
            await interaction.reply({
              content:
                "❌ Du hast keinen Zugriff auf FrozenRun.",
              flags:
                MessageFlags.Ephemeral
            });

            return;
          }

          await interaction.reply({
            content:
              "🎮 FrozenRun Steuerung",
            embeds: [
              dashboardEmbed()
            ],
            components:
              panelButtons()
          });

          return;
        }

        // ==============================================
        // /mc
        // ==============================================

        if (
          command ===
          "mc"
        ) {
          if (
            !darfSteuern(
              interaction
            )
          ) {
            await interaction.reply({
              content:
                "❌ Du hast keinen Zugriff auf FrozenRun.",
              flags:
                MessageFlags.Ephemeral
            });

            return;
          }

          const befehl =
            interaction.options.getString(
              "befehl",
              true
            );

          if (
            !mcOnline
          ) {
            await interaction.reply({
              content:
                "❌ FrozenRun ist offline.",
              flags:
                MessageFlags.Ephemeral
            });

            return;
          }

          await interaction.deferReply({
            flags:
              MessageFlags.Ephemeral
          });

          let minecraftBefehl =
            befehl.trim();

          if (
            !minecraftBefehl.startsWith(
              "/"
            )
          ) {
            minecraftBefehl =
              `/${minecraftBefehl}`;
          }

          try {
            const output =
              await minecraftCommand(
                minecraftBefehl
              );

            let antwort =
              output ||
              "Befehl wurde gesendet.";

            if (
              antwort.length >
              1900
            ) {
              antwort =
                antwort.slice(
                  0,
                  1900
                ) +
                "...";
            }

            await interaction.editReply({
              content:
                `✅ **Minecraft:**\n\`\`\`\n${antwort}\n\`\`\``
            });
          } catch (err) {
            await interaction.editReply({
              content:
                `❌ Minecraft-Fehler: ${
                  err?.message ||
                  err
                }`
            });
          }

          return;
        }

        // ==============================================
        // /controller
        // ==============================================

        if (
          command ===
          "controller"
        ) {
          if (
            !istServerOwner(
              interaction
            )
          ) {
            await interaction.reply({
              content:
                "❌ Nur der Serverbesitzer kann Controller verwalten.",
              flags:
                MessageFlags.Ephemeral
            });

            return;
          }

          const subcommand =
            interaction.options.getSubcommand();

          // ============================================
          // CONTROLLER HINZUFÜGEN
          // ============================================

          if (
            subcommand ===
            "hinzufuegen"
          ) {
            const user =
              interaction.options.getUser(
                "user",
                true
              );

            erlaubteController.add(
              user.id
            );

            await interaction.reply({
              content:
                `✅ ${user} wurde als FrozenRun-Controller hinzugefügt.`,
              flags:
                MessageFlags.Ephemeral
            });

            return;
          }

          // ============================================
          // CONTROLLER ENTFERNEN
          // ============================================

          if (
            subcommand ===
            "entfernen"
          ) {
            const user =
              interaction.options.getUser(
                "user",
                true
              );

            erlaubteController.delete(
              user.id
            );

            await interaction.reply({
              content:
                `✅ ${user} wurde als FrozenRun-Controller entfernt.`,
              flags:
                MessageFlags.Ephemeral
            });

            return;
          }

          // ============================================
          // CONTROLLER LISTE
          // ============================================

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
                flags:
                  MessageFlags.Ephemeral
              });

              return;
            }

            const controllerListe =
              Array.from(
                erlaubteController
              )
                .map(
                  id =>
                    `<@${id}>`
                )
                .join(
                  "\n"
                );

            await interaction.reply({
              content:
                `📋 **FrozenRun Controller:**\n${controllerListe}`,
              flags:
                MessageFlags.Ephemeral
            });

            return;
          }

          return;
        }

        // ==============================================
        // /laufen
        // ==============================================

        if (
          command ===
          "laufen"
        ) {
          if (
            !darfSteuern(
              interaction
            )
          ) {
            await interaction.reply({
              content:
                "❌ Du hast keinen Zugriff auf FrozenRun.",
              flags:
                MessageFlags.Ephemeral
            });

            return;
          }

          const subcommand =
            interaction.options.getSubcommand();

          // ============================================
          // LAUFEN START
          // ============================================

          if (
            subcommand ===
            "start"
          ) {
            if (
              !mcOnline
            ) {
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

              await dashboardAktualisieren();

              await interaction.reply({
                content:
                  "🏃 FrozenRun läuft jetzt.",
                flags:
                  MessageFlags.Ephemeral
              });
            } catch (err) {
              await interaction.reply({
                content:
                  `❌ Laufen konnte nicht gestartet werden: ${
                    err?.message ||
                    err
                  }`,
                flags:
                  MessageFlags.Ephemeral
              });
            }

            return;
          }

          // ============================================
          // LAUFEN STOP
          // ============================================

          if (
            subcommand ===
            "stop"
          ) {
            laufenStoppen();

            await dashboardAktualisieren();

            await interaction.reply({
              content:
                "🛑 FrozenRun läuft nicht mehr.",
              flags:
                MessageFlags.Ephemeral
            });

            return;
          }

          return;
        }

        return;
      }

      // ==================================================
      // BUTTONS
      // ==================================================

      if (
        interaction.isButton()
      ) {
        if (
          !darfSteuern(
            interaction
          )
        ) {
          await interaction.reply({
            content:
              "❌ Du hast keinen Zugriff auf FrozenRun.",
            flags:
              MessageFlags.Ephemeral
          });

          return;
        }

        // ================================================
        // EIN / AUS
        // ================================================

        if (
          interaction.customId ===
          "toggle_bot"
        ) {
          if (
            mcOnline
          ) {
            minecraftStoppen();

            await dashboardAktualisieren();

            await interaction.reply({
              content:
                "⛔ FrozenRun wurde ausgeschaltet.",
              flags:
                MessageFlags.Ephemeral
            });

            return;
          }

          minecraftStarten();

          await interaction.reply({
            content:
              "🟢 FrozenRun wird gestartet.",
            flags:
              MessageFlags.Ephemeral
          });

          return;
        }

        // ================================================
        // GELD SENDEN
        // ================================================

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
                "Geld senden"
              );

          const input =
            new TextInputBuilder()
              .setCustomId(
                "amount"
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
              .setRequired(
                true
              );

          modal.addComponents(
            new ActionRowBuilder().addComponents(
              input
            )
          );

          await interaction.showModal(
            modal
          );

          return;
        }

        // ================================================
        // HOME AFK
        // ================================================

        if (
          interaction.customId ===
          "home_afk"
        ) {
          await interaction.deferReply({
            flags:
              MessageFlags.Ephemeral
          });

          try {
            await homeAfkAusfuehren();

            await interaction.editReply({
              content:
                "🏠 `/home afk` wurde ausgeführt."
            });
          } catch (err) {
            await interaction.editReply({
              content:
                `❌ Home AFK Fehler: ${
                  err?.message ||
                  err
                }`
            });
          }

          return;
        }

        // ================================================
        // NEU VERBINDEN
        // ================================================

        if (
          interaction.customId ===
          "reconnect"
        ) {
          minecraftNeuVerbinden();

          await interaction.reply({
            content:
              "🔄 FrozenRun wird neu verbunden.",
            flags:
              MessageFlags.Ephemeral
          });

          return;
        }

        // ================================================
        // STOPPEN
        // ================================================

        if (
          interaction.customId ===
          "stop"
        ) {
          minecraftStoppen();

          await dashboardAktualisieren();

          await interaction.reply({
            content:
              "⛔ FrozenRun wurde gestoppt.",
            flags:
              MessageFlags.Ephemeral
          });

          return;
        }

        // ================================================
        // LAUFEN
        // ================================================

        if (
          interaction.customId ===
          "toggle_laufen"
        ) {
          if (
            laufenAktiv
          ) {
            laufenStoppen();

            await dashboardAktualisieren();

            await interaction.reply({
              content:
                "🛑 Laufen wurde gestoppt.",
              flags:
                MessageFlags.Ephemeral
            });

            return;
          }

          if (
            !mcOnline
          ) {
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

            await dashboardAktualisieren();

            await interaction.reply({
              content:
                "🏃 FrozenRun läuft jetzt.",
              flags:
                MessageFlags.Ephemeral
            });
          } catch (err) {
            await interaction.reply({
              content:
                `❌ Laufen Fehler: ${
                  err?.message ||
                  err
                }`,
              flags:
                MessageFlags.Ephemeral
            });
          }

          return;
        }

        return;
      }

      // ==================================================
      // PAY MODAL
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
          !darfSteuern(
            interaction
          )
        ) {
          await interaction.reply({
            content:
              "❌ Du hast keinen Zugriff auf FrozenRun.",
            flags:
              MessageFlags.Ephemeral
          });

          return;
        }

        const amount =
          interaction.fields.getTextInputValue(
            "amount"
          );

        await interaction.deferReply({
          flags:
            MessageFlags.Ephemeral
        });

        try {
          const ergebnis =
            await geldSenden(
              amount
            );

          await dashboardAktualisieren();

          await interaction.editReply({
            content:
              `💸 **${formatGeld(
                ergebnis.betrag
              )}** wurde an **${MONEY_TARGET}** gesendet.`
          });
        } catch (err) {
          await interaction.editReply({
            content:
              `❌ Geld senden fehlgeschlagen: ${
                err?.message ||
                err
              }`
          });
        }

        return;
      }
    } catch (err) {
      console.log(
        "Interaction Fehler:",
        err?.message ||
          err
      );

      try {
        if (
          interaction.replied ||
          interaction.deferred
        ) {
          await interaction.editReply({
            content:
              "❌ Ein unerwarteter Fehler ist aufgetreten."
          });
        } else {
          await interaction.reply({
            content:
              "❌ Ein unerwarteter Fehler ist aufgetreten.",
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

if (
  !DISCORD_TOKEN
) {
  console.log(
    "FEHLER: DISCORD_TOKEN fehlt."
  );
  process.exit(
    1
  );
}

discord.login(
  DISCORD_TOKEN
);
// ==================================================
// PROZESS FEHLER
// ==================================================

process.on(
  "unhandledRejection",
  err => {
    console.log(
      "Unhandled Rejection:",
      err?.message ||
        err
    );
  }
);

process.on(
  "uncaughtException",
  err => {
    console.log(
      "Uncaught Exception:",
      err?.message ||
        err
    );
  }
);

// ==================================================
// START
// ==================================================

console.log(
  "===================================="
);

console.log(
  "FrozenRun Bot startet..."
);

console.log(
  "Minecraft:",
  `${MC_HOST}:${MC_PORT}`
);

console.log(
  "Minecraft Benutzer:",
  MC_USERNAME
);

console.log(
  "Discord Minecraft Channel:",
  MC_CHANNEL_ID
);

console.log(
  "===================================="
);
