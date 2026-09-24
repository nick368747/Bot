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
// KONFIGURATION
// ==================================================

const DISCORD_TOKEN = process.env.DISCORD_TOKEN;

const MC_HOST = "blockbande.de";
const MC_PORT = 19132;
const MC_USERNAME = "FrozenRun";

const MONEY_TARGET = "!FrozenBoar16433";

const MC_CHANNEL_ID = "1552068948676059146";

// ==================================================
// DISCORD
// ==================================================

const discord = new Client({
  intents: [
    GatewayIntentBits.Guilds
  ]
});

// ==================================================
// CONTROLLER
// ==================================================

// Benutzer, die den Bot steuern dürfen
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
// HILFSFUNKTIONEN
// ==================================================

function formatGeld(betrag) {
  return Number(betrag || 0).toLocaleString("de-DE");
}

function formatKoordinaten() {
  return `${Math.round(aktuelleKoordinaten.x)}, ${Math.round(
    aktuelleKoordinaten.y
  )}, ${Math.round(aktuelleKoordinaten.z)}`;
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
// DARF DEN BOT STEUERN?
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
// GELD AUS /money LESEN
// ==================================================

function geldAusOutputLesen(text) {

  if (!text) return null;

  const clean =
    String(text)
      .replace(/\u00a0/g, " ");

  // Beispiel:
  // Dein Kontostand: 12.345

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

  let zahl = match[1];

  zahl =
    zahl.replace(/\./g, "");

  zahl =
    zahl.replace(",", ".");

  const wert =
    Number(zahl);

  if (!Number.isFinite(wert)) {
    return null;
  }

  return Math.floor(wert);
}

// ==================================================
// MINECRAFT COMMAND
// ==================================================

function minecraftCommand(command) {

  return new Promise(
    (resolve, reject) => {

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

      const timeout =
        setTimeout(() => {

          if (erledigt) return;

          erledigt = true;

          mcBot.removeListener(
            "command_output",
            listener
          );

          resolve(null);

        }, 8000);

      function listener(packet) {

        try {

          if (!packet) return;

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

          if (erledigt) return;

          erledigt = true;

          clearTimeout(timeout);

          mcBot.removeListener(
            "command_output",
            listener
          );

          let output = "";

          if (
            Array.isArray(
              packet.output
            )
          ) {

            output =
              packet.output
                .map(item => {

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
                      JSON.stringify(item)
                    );
                  }

                  return String(item);

                })
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

          resolve(output);

        } catch (err) {

          if (erledigt) return;

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
                BigInt(
                  playerEntityId || 0
                )
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
    }
  );
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

    if (geld === null) {

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
      err.message
    );

    return null;
  }
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

        username:
          MC_USERNAME,

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
    // START GAME
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
            /tpa(here)?/i.test(
              message
            )
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
    // KOORDINATEN
    // ==================================================

    mcBot.on(
      "move_player",
      packet => {

        try {

          if (packet.position) {

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
          }

        } catch {}
      }
    );

    // ==================================================
    // FEHLER
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
    // CLOSE
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
        name: "🌐 Server",

        value:
          `${MC_HOST}:${MC_PORT}`,

        inline: true
      },

      {
        name: "👤 Account",

        value:
          MC_USERNAME,

        inline: true
      },

      {
        name: "📍 Koordinaten",

        value:
          formatKoordinaten(),

        inline: true
      },

      {
        name: "💰 Geld",

        value:
          formatGeld(
            aktuellesGeld
          ),

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
            ButtonStyle.Secondary
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
            ButtonStyle.Success
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

        .setName(
          "dashboard"
        )

        .setDescription(
          "Zeigt das FrozenRun Dashboard."
        );

    // ==================================================
    // /panel
    // ==================================================

    const panelCommand =
      new SlashCommandBuilder()

        .setName(
          "panel"
        )

        .setDescription(
          "Öffnet das FrozenRun Control Panel."
        );

    // ==================================================
    // /mc
    // ==================================================

    const mcCommand =
      new SlashCommandBuilder()

        .setName(
          "mc"
        )

        .setDescription(
          "Führt einen Minecraft-Befehl aus."
        )

        .addStringOption(
          option =>
            option

              .setName(
                "befehl"
              )

              .setDescription(
                "Minecraft-Befehl"
              )

              .setRequired(
                true
              )
        );

    // ==================================================
    // /controller
    // ==================================================

    const controllerCommand =
      new SlashCommandBuilder()

        .setName(
          "controller"
        )

        .setDescription(
          "Verwaltet, wer FrozenRun steuern darf."
        )

        .addSubcommand(
          subcommand =>
            subcommand

              .setName(
                "hinzufügen"
              )

              .setDescription(
                "Gibt einem Benutzer Zugriff auf FrozenRun."
              )

              .addUserOption(
                option =>
                  option

                    .setName(
                      "benutzer"
                    )

                    .setDescription(
                      "Discord-Benutzer"
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
                "Entfernt den Zugriff eines Benutzers."
              )

              .addUserOption(
                option =>
                  option

                    .setName(
                      "benutzer"
                    )

                    .setDescription(
                      "Discord-Benutzer"
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
        );

    // ==================================================
    // REGISTRIEREN
    // ==================================================

    try {

      await discord.application.commands.set(
        [
          dashboardCommand,
          panelCommand,
          mcCommand,
          controllerCommand
        ]
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
        "Minecraft startet NICHT automatisch."
      );

    } catch (err) {

      console.log(
        "Slash Command Fehler:",
        err.message
      );
    }

    // WICHTIG:
    // Kein minecraftVerbinden() hier!
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
      // SLASH COMMANDS
      // ==================================================

      if (
        interaction.isChatInputCommand()
      ) {

        // ==================================================
        // /dashboard
        // ==================================================

        if (
          interaction.commandName ===
          "dashboard"
        ) {

          await interaction.reply({

            embeds: [
              dashboardEmbed()
            ]

          });

          return;
        }

        // ==================================================
        // /controller
        // ==================================================

        if (
          interaction.commandName ===
          "controller"
        ) {

          // Nur Serverbesitzer
          if (
            !istServerOwner(
              interaction
            )
          ) {

            await interaction.reply({

              content:
                "❌ Nur der Serverbesitzer darf die Controller verwalten.",

              ephemeral: true

            });

            return;
          }

          const subcommand =
            interaction.options.getSubcommand();

          // ------------------------------------------
          // HINZUFÜGEN
          // ------------------------------------------

          if (
            subcommand ===
            "hinzufügen"
          ) {

            const user =
              interaction.options.getUser(
                "benutzer"
              );

            if (
              user.id ===
              interaction.user.id
            ) {

              await interaction.reply({

                content:
                  "👑 Du bist bereits der Serverbesitzer und hast automatisch Zugriff.",

                ephemeral: true

              });

              return;
            }

            erlaubteController.add(
              user.id
            );

            await interaction.reply({

              content:
                `✅ ${user} darf jetzt FrozenRun steuern.`,

              ephemeral: true

            });

            return;
          }

          // ------------------------------------------
          // ENTFERNEN
          // ------------------------------------------

          if (
            subcommand ===
            "entfernen"
          ) {

            const user =
              interaction.options.getUser(
                "benutzer"
              );

            if (
              !erlaubteController.has(
                user.id
              )
            ) {

              await interaction.reply({

                content:
                  `ℹ️ ${user} ist kein Controller.`,

                ephemeral: true

              });

              return;
            }

            erlaubteController.delete(
              user.id
            );

            await interaction.reply({

              content:
                `🚫 ${user} darf FrozenRun jetzt nicht mehr steuern.`,

              ephemeral: true

            });

            return;
          }

          // ------------------------------------------
          // LISTE
          // ------------------------------------------

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
                  "📋 Es sind momentan keine zusätzlichen Controller eingetragen.\n\n👑 Der Serverbesitzer hat immer Zugriff.",

                ephemeral: true

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
                `📋 **FrozenRun Controller**\n\n` +
                `${liste}\n\n` +
                `👑 Der Serverbesitzer hat immer Zugriff.`,

              ephemeral: true

            });

            return;
          }
        }

        // ==================================================
        // /panel
        // ==================================================

        if (
          interaction.commandName ===
          "panel"
        ) {

          if (
            !darfSteuern(
              interaction
            )
          ) {

            await interaction.reply({

              content:
                "❌ Du hast keinen Zugriff auf das FrozenRun Panel.",

              ephemeral: true

            });

            return;
          }

          await interaction.reply({

            embeds: [
              panelEmbed()
            ],

            components:
              panelButtons()

          });

          return;
        }

        // ==================================================
        // /mc
        // ==================================================

        if (
          interaction.commandName ===
          "mc"
        ) {

          if (
            !darfSteuern(
              interaction
            )
          ) {

            await interaction.reply({

              content:
                "❌ Du darfst FrozenRun nicht steuern.",

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
                "❌ FrozenRun ist momentan offline.",

              ephemeral: true

            });

            return;
          }

          await interaction.deferReply({
            ephemeral: true
          });

          try {

            const command =
              befehl.startsWith("/")
                ? befehl
                : "/" + befehl;

            const output =
              await minecraftCommand(
                command
              );

            if (output) {

              await interaction.editReply(

                `✅ Befehl ausgeführt.\n` +
                `\`\`\`\n` +
                `${output.slice(
                  0,
                  1800
                )}\n` +
                `\`\`\``

              );

            } else {

              await interaction.editReply(
                "✅ Befehl wurde gesendet."
              );
            }

          } catch (err) {

            await interaction.editReply(
              `❌ Fehler: ${err.message}`
            );
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
          !darfSteuern(
            interaction
          )
        ) {

          await interaction.reply({

            content:
              "❌ Du hast keinen Zugriff auf FrozenRun.",

            ephemeral: true

          });

          return;
        }

        // ==================================================
        // EIN / AUS
        // ==================================================

        if (
          interaction.customId ===
          "toggle_bot"
        ) {

          if (mcOnline) {

            manuellGestoppt =
              true;

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

            mcOnline =
              false;

            await interaction.reply({

              content:
                "⛔ FrozenRun wurde ausgeschaltet.",

              ephemeral: true

            });

            return;
          }

          manuellGestoppt =
            false;

          await interaction.reply({

            content:
              "▶️ FrozenRun wird gestartet. Falls nötig, erscheint der Microsoft-Login-Code.",

            ephemeral: true

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

          await interaction.reply({

            content:
              mcOnline
                ? "🟢 FrozenRun ist online."
                : "🔴 FrozenRun ist offline.",

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

            await interaction.editReply(
              "❌ `/money` konnte nicht ausgelesen werden."
            );

            return;
          }

          await interaction.editReply(

            `💰 **Dein Kontostand:** ` +
            `${formatGeld(geld)}`

          );

          return;
        }

        // ==================================================
        // GELD SENDEN
        // ==================================================

        if (
          interaction.customId ===
          "pay"
        ) {

          if (!mcOnline) {

            await interaction.reply({

              content:
                "❌ FrozenRun ist offline.",

              ephemeral: true

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
                "z.B. 7500"
              )

              .setStyle(
                TextInputStyle.Short
              )

              .setRequired(
                true
              )

              .setMinLength(
                1
              )

              .setMaxLength(
                12
              );

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

          await minecraftCommand(
            "/home afk"
          );

          await interaction.editReply(
            "🏠 `/home afk` wurde ausgeführt."
          );

          return;
        }

        // ==================================================
        // RECONNECT
        // ==================================================

        if (
          interaction.customId ===
          "reconnect"
        ) {

          await interaction.deferReply({
            ephemeral: true
          });

          manuellGestoppt =
            false;

          if (
            reconnectTimer
          ) {

            clearTimeout(
              reconnectTimer
            );

            reconnectTimer =
              null;
          }

          minecraftVerbinden();

          await interaction.editReply(
            "🔄 FrozenRun wird neu verbunden."
          );

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

          mcOnline =
            false;

          await interaction.reply({

            content:
              "⛔ FrozenRun wurde gestoppt. Kein automatischer Reconnect.",

            ephemeral: true

          });

          return;
        }
      }

      // ==================================================
      // GELD MODAL
      // ==================================================

      if (
        interaction.isModalSubmit() &&
        interaction.customId ===
          "pay_modal"
      ) {

        if (
          !darfSteuern(
            interaction
          )
        ) {

          await interaction.reply({

            content:
              "❌ Du darfst FrozenRun nicht steuern.",

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

        const input =
          interaction.fields.getTextInputValue(
            "pay_amount"
          );

        const normalisiert =
          input
            .replace(/\./g, "")
            .replace(/,/g, "");

        const betrag =
          Number(
            normalisiert
          );

        if (
          !Number.isFinite(
            betrag
          ) ||
          !Number.isInteger(
            betrag
          ) ||
          betrag <= 0
        ) {

          await interaction.reply({

            content:
              "❌ Bitte gib einen gültigen ganzen Betrag ein.",

            ephemeral: true

          });

          return;
        }

        await interaction.deferReply({
          ephemeral: true
        });

        // ==================================================
        // ERST /money
        // ==================================================

        const kontostand =
          await geldAktualisieren();

        if (
          kontostand === null
        ) {

          await interaction.editReply(
            "❌ Der Kontostand konnte mit `/money` nicht ermittelt werden."
          );

          return;
        }

        // ==================================================
        // NICHT GENUG GELD
        // ==================================================

        if (
          betrag >
          kontostand
        ) {

          await interaction.editReply(

            `❌ **Nicht genug Geld.**\n\n` +

            `💰 Kontostand: **${formatGeld(
              kontostand
            )}**\n` +

            `💸 Gewünscht: **${formatGeld(
              betrag
            )}**`

          );

          return;
        }

        // ==================================================
        // PAY
        // ==================================================

        const payCommand =
          `/pay ${MONEY_TARGET} ${betrag}`;

        console.log(
          "Sende:",
          payCommand
        );

        await minecraftCommand(
          payCommand
        );

        // ==================================================
        // ÜBER 4999 CONFIRM
        // ==================================================

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

          await minecraftCommand(
            `${payCommand} confirm`
          );
        }

        // ==================================================
        // GELD AKTUALISIEREN
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
