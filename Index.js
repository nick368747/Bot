const {
  Client,
  GatewayIntentBits,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  Events
} = require("discord.js");

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds
  ]
});

let botAktiv = false;

client.once(Events.ClientReady, () => {
  console.log(`Bot ist online als ${client.user.tag}`);
});

client.on(Events.InteractionCreate, async (interaction) => {
  if (!interaction.isButton()) return;

  if (interaction.customId === "toggle_bot") {
    botAktiv = !botAktiv;

    const button = new ButtonBuilder()
      .setCustomId("toggle_bot")
      .setLabel(botAktiv ? "🟢 BOT AUSSCHALTEN" : "🔴 BOT EINSCHALTEN")
      .setStyle(botAktiv ? ButtonStyle.Danger : ButtonStyle.Success);

    const row = new ActionRowBuilder().addComponents(button);

    await interaction.update({
      content: botAktiv
        ? "🟢 Der Minecraft-Bot ist **AN**."
        : "🔴 Der Minecraft-Bot ist **AUS**.",
      components: [row]
    });

    console.log(`Bot ${botAktiv ? "AN" : "AUS"}`);
  }
});

client.login(process.env.DISCORD_TOKEN);
