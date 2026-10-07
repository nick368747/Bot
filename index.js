 const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
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
MessageFlags,
} = require('discord.js');
const bedrock = require('bedrock-protocol');
const { Authflow, Titles } = require('prismarine-auth');
// ============================================================
// ENV / KONFIGURATION
// ============================================================
const PORT = Number(process.env.PORT || 10000);
const DISCORD_TOKEN = process.env.DISCORD_TOKEN;
const MC_HOST = process.env.MC_HOST || 'blockbande.de';
const MC_PORT = Number(process.env.MC_PORT || 19132);
const MC_USERNAME = process.env.MC_USERNAME || 'LiveSinger9275';
const MONEY_TARGET = process.env.MONEY_TARGET || '!FrozenBoar16433';
const MC_CHANNEL_ID = process.env.MC_CHANNEL_ID || '1552068948676059146';
const MC_AUTH_FLOW = process.env.MC_AUTH_FLOW || 'live';
const MC_AUTH_TITLE = Titles.MinecraftNintendoSwitch;
const MC_AUTH_DEVICE = process.env.MC_AUTH_DEVICE || 'Nintendo';
// Auf Render sollte dieser Ordner unter einem Persistent Disk Mount liegen,
// z. B. /var/data/.minecraft. Ohne Persistent Disk geht der Login-Cache
// bei einem Neustart/Deploy verloren.
const minecraftProfilOrdner =
process.env.MC_PROFILES_FOLDER ||
path.join(process.cwd(), '.minecraft');
const RESET_MINECRAFT_LOGIN =
String(process.env.RESET_MINECRAFT_LOGIN || 'false').toLowerCase() === 'true';
const RECONNECT_DELAY_MS = Math.max(
5000,
Number(process.env.RECONNECT_DELAY_MS || 30000)
);
const MONEY_REFRESH_MS = Math.max(
15000,
Number(process.env.MONEY_REFRESH_MS || 30000)
);
const DASHBOARD_REFRESH_MS = Math.max(
5000,
Number(process.env.DASHBOARD_REFRESH_MS || 10000)
);
const WALK_INTERVAL_MS = Math.max(
750,
Number(process.env.WALK_INTERVAL_MS || 1200)
);
const WALK_DIRECTION_MS = Math.max(
2500,
Number(process.env.WALK_DIRECTION_MS || 4500)
);
const WALK_DISTANCE = Math.max(
0.15,
Number(process.env.WALK_DISTANCE || 0.8)
);
const COMMAND_TIMEOUT_MS = Math.max(
3000,
Number(process.env.COMMAND_TIMEOUT_MS || 10000)
);
const CONTROLLER_IDS = new Set(
String(process.env.CONTROLLER_IDS || '')
.split(',')
.map((id) => id.trim())
.filter(Boolean)
);
// ============================================================
// LOGIN-ORDNER VORBEREITEN
// ============================================================
try {
fs.mkdirSync(minecraftProfilOrdner, { recursive: true });
} catch (err) {
console.error('[AUTH] Profilordner konnte nicht erstellt werden:', err?.message || err);
}
if (RESET_MINECRAFT_LOGIN) {
try {
fs.rmSync(minecraftProfilOrdner, { recursive: true, force: true });
fs.mkdirSync(minecraftProfilOrdner, { recursive: true });
console.log('[AUTH] Minecraft-Login wurde zurückgesetzt.');
} catch (err) {
console.error('[AUTH] Reset fehlgeschlagen:', err?.message || err);
}
}
// ============================================================
// RENDER HEALTH SERVER
// ============================================================
const webServer = http.createServer((req, res) => {
const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
if (url.pathname === '/health' || url.pathname === '/') {
const body = JSON.stringify({
ok: true,
service: 'FrozenRun',
discord: discordReady,
minecraft: mcOnline,
uptime: process.uptime(),
timestamp: new Date().toISOString(),
});
res.writeHead(200, {
'Content-Type': 'application/json; charset=utf-8',
'Cache-Control': 'no-store',
});
res.end(body);
return;
}
res.writeHead(404, {
'Content-Type': 'text/plain; charset=utf-8',
});
res.end('Not Found');
});
webServer.listen(PORT, '0.0.0.0', () => {
console.log(`[WEB] Health-Server läuft auf Port ${PORT}`);
});
webServer.on('error', (err) => {
console.error('[WEB] Serverfehler:', err?.message || err);
});
// ============================================================
// DISCORD
// ============================================================
const discord = new Client({
intents: [GatewayIntentBits.Guilds],
});
let discordReady = false;
let dashboardMessage = null;
// ============================================================
// CONTROLLER
// ============================================================
const erlaubteController = CONTROLLER_IDS;
// ============================================================
// MINECRAFT STATUS
// ============================================================
let mcBot = null;
let mcOnline = false;
let manuellGestoppt = true;
let reconnectTimer = null;
let minecraftStartzeit = null;
let minecraftUuid = null;
let playerEntityId = 0;
let aktuelleKoordinaten = { x: 0, y: 0, z: 0 };
let aktuellesGeld = 0;
// ============================================================
// LAUFEN
// ============================================================
let laufenAktiv = false;
let laufenTimer = null;
let laufenRichtungsTimer = null;
let laufenRichtung = 0;
// ============================================================
// TIMER
// ============================================================
let dashboardRefreshTimer = null;
let moneyRefreshTimer = null;
// Alle Minecraft-Befehle werden seriell abgearbeitet.
// Das verhindert, dass /money, /pay, /home usw. gleichzeitig
// mehrere command_output-Listener erzeugen.
let minecraftCommandQueue = Promise.resolve();
// ============================================================
// HILFSFUNKTIONEN
// ============================================================
function sleep(ms) {
return new Promise((resolve) => setTimeout(resolve, ms));
}
function formatLiveUptime() {
if (!minecraftStartzeit) return '00:00:00';
const vergangen = Math.max(
0,
Math.floor((Date.now() - minecraftStartzeit) / 1000)
);
const stunden = Math.floor(vergangen / 3600);
const minuten = Math.floor((vergangen % 3600) / 60);
const sekunden = vergangen % 60;
return [stunden, minuten, sekunden]
.map((wert) => String(wert).padStart(2, '0'))
.join(':');
}
function formatGeld(betrag) {
const wert = Number(betrag);
if (!Number.isFinite(wert)) return '0 $';
return `${Math.floor(wert).toLocaleString('de-DE')} $`;
}
function formatKoordinaten() {
const x = Number(aktuelleKoordinaten.x);
const y = Number(aktuelleKoordinaten.y);
const z = Number(aktuelleKoordinaten.z);
return [x, y, z]
.map((wert) => (Number.isFinite(wert) ? Math.round(wert) : 0))
.join(', ');
}
function normalizePlayerName(name) {
return String(name || '').trim().replace(/^!/, '').toLowerCase();
}
function istFrozenBoar(name) {
return normalizePlayerName(name) === 'frozenboar16433';
}
function istServerOwner(interaction) {
return Boolean(
interaction.guild &&
interaction.guild.ownerId === interaction.user.id
);
}
function darfSteuern(interaction) {
return istServerOwner(interaction) || erlaubteController.has(interaction.user.id);
}
function safeError(err) {
return err?.message || String(err || 'Unbekannter Fehler');
}
function kuerzeDiscordText(text, max = 1800) {
const value = String(text ?? '');
return value.length <= max ? value : `${value.slice(0, max)}...`;
}
function parseEntityId(value) {
if (value === undefined || value === null) return 0;
try {
return Number(value);
} catch {
return 0;
}
}
// ============================================================
// GELD AUS /money AUSLESEN
// ============================================================
function geldAusOutputLesen(text) {
if (!text) return null;
const clean = String(text)
.replace(/\u00a0/g, ' ')
.replace(/\r/g, ' ')
.replace(/\n/g, ' ')
.trim();
// Unterstützt u. a.:
// "Dein Kontostand: 12.345,67"
// "Kontostand: $12,345.67"
// "Balance: 12345"
const match = clean.match(
/(?:Dein\s+Kontostand|Kontostand|Balance)\s*:\s*[$€]?\s*([\d.,]+)/i
);
if (!match) {
console.log('[MONEY] Kontostand nicht erkannt:', clean);
return null;
}
let zahl = match[1].replace(/\s/g, '').replace(/[^\d.,-]/g, '');
if (!zahl) return null;
if (zahl.includes('.') && zahl.includes(',')) {
const letzterPunkt = zahl.lastIndexOf('.');
const letztesKomma = zahl.lastIndexOf(',');
if (letztesKomma > letzterPunkt) {
zahl = zahl.replace(/\./g, '').replace(',', '.');
} else {
zahl = zahl.replace(/,/g, '');
}
} else if (zahl.includes(',')) {
const nachKomma = zahl.split(',').pop();
if (nachKomma.length <= 2) {
zahl = zahl.replace(/\./g, '').replace(',', '.');
} else {
zahl = zahl.replace(/,/g, '');
}
} else if (zahl.includes('.')) {
const nachPunkt = zahl.split('.').pop();
if (nachPunkt.length > 2) {
zahl = zahl.replace(/\./g, '');
}
}
const wert = Number(zahl);
return Number.isFinite(wert) ? Math.floor(wert) : null;
}
// ============================================================
// MINECRAFT COMMAND – LOW LEVEL
// ============================================================
function minecraftCommandRaw(command) {
return new Promise((resolve, reject) => {
if (!mcBot || !mcOnline) {
reject(new Error('LiveSinger9275 ist nicht online.'));
return;
}
if (!minecraftUuid) {
reject(new Error('Minecraft-UUID ist noch nicht verfügbar.'));
return;
}
const requestId = crypto.randomUUID();
let erledigt = false;
let timeout = null;
const cleanup = () => {
if (timeout) clearTimeout(timeout);
timeout = null;
if (mcBot) mcBot.removeListener('command_output', listener);
};
const finish = (callback) => {
if (erledigt) return;
erledigt = true;
cleanup();
callback();
};
const listener = (packet) => {
if (!packet || erledigt) return;
const origin = packet.origin || {};
if (
) {
origin.uuid &&
String(origin.uuid) !== String(minecraftUuid)
return;
}
if (
) {
origin.request_id &&
String(origin.request_id) !== String(requestId)
return;
}
let output = '';
if (Array.isArray(packet.output)) {
output = packet.output
.map((item) => {
if (typeof item === 'string') return item;
if (item && typeof item === 'object') {
return item.message || item.text || JSON.stringify(item);
}
return String(item);
})
.join('\n');
} else if (typeof packet.output === 'string') {
output = packet.output;
} else if (packet.output !== undefined) {
output = JSON.stringify(packet.output);
}
finish(() => resolve(output));
};
timeout = setTimeout(() => {
finish(() => resolve(null));
}, COMMAND_TIMEOUT_MS);
mcBot.on('command_output', listener);
try {
mcBot.queue('command_request', {
command,
origin: {
type: 'player',
uuid: minecraftUuid,
request_id: requestId,
player_entity_id: BigInt(playerEntityId || 0),
},
internal: false,
version: 'latest',
});
} catch (err) {
finish(() => reject(err));
}
});
}
function minecraftCommand(command) {
const task = minecraftCommandQueue.then(() => minecraftCommandRaw(command));
minecraftCommandQueue = task.catch(() => undefined);
return task;
}
// ============================================================
// GELD AKTUALISIEREN
// ============================================================
async function geldAktualisieren() {
if (!mcBot || !mcOnline) return null;
try {
const output = await minecraftCommand('/money');
if (!output) return null;
const geld = geldAusOutputLesen(output);
if (geld === null) return null;
aktuellesGeld = geld;
return geld;
} catch (err) {
console.error('[MONEY] Fehler:', safeError(err));
return null;
}
}
// ============================================================
// LAUFEN
// ============================================================
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
async function laufenSchritt() {
if (!laufenAktiv || !mcOnline) return;
const dx = Math.cos(laufenRichtung) * WALK_DISTANCE;
const dz = Math.sin(laufenRichtung) * WALK_DISTANCE;
try {
// Relativer Teleport statt absolute Koordinaten.
// Dadurch ist das Laufen robust, auch wenn sich die Koordinaten
// zwischen zwei Befehlen ändern.
await minecraftCommand(
`/tp @s ~${dx.toFixed(2)} ~0 ~${dz.toFixed(2)}`
);
} catch (err) {
console.error('[LAUFEN] Fehler:', safeError(err));
}
}
function laufenStarten() {
if (!mcOnline) {
throw new Error('LiveSinger9275 ist offline.');
}
laufenStoppen();
laufenAktiv = true;
laufenRichtung = Math.random() * Math.PI * 2;
laufenRichtungsTimer = setInterval(() => {
if (!laufenAktiv || !mcOnline) return;
laufenRichtung += (Math.random() - 0.5) * Math.PI;
}, WALK_DIRECTION_MS);
laufenTimer = setInterval(() => {
void laufenSchritt();
}, WALK_INTERVAL_MS);
}
// ============================================================
// MINECRAFT CONNECTION
// ============================================================
function resetMinecraftState() {
mcOnline = false;
minecraftStartzeit = null;
minecraftUuid = null;
playerEntityId = 0;
laufenStoppen();
}
function clearReconnectTimer() {
if (!reconnectTimer) return;
clearTimeout(reconnectTimer);
reconnectTimer = null;
}
function scheduleReconnect() {
clearReconnectTimer();
if (manuellGestoppt) return;
console.log(`[MC] Automatischer Reconnect in ${Math.round(RECONNECT_DELAY_MS / 1000)} Sekunden...`);
reconnectTimer = setTimeout(() => {
reconnectTimer = null;
if (!manuellGestoppt) minecraftVerbinden();
}, RECONNECT_DELAY_MS);
}
function minecraftVerbinden() {
clearReconnectTimer();
if (mcBot) {
try {
mcBot.disconnect();
} catch {}
}
mcBot = null;
resetMinecraftState();
console.log(`[MC] Verbinde ${MC_USERNAME} mit ${MC_HOST}:${MC_PORT}...`);
try {
const minecraftAuthflow = new Authflow(
MC_USERNAME,
minecraftProfilOrdner,
{
flow: MC_AUTH_FLOW,
authTitle: MC_AUTH_TITLE,
deviceType: MC_AUTH_DEVICE,
forceRefresh: RESET_MINECRAFT_LOGIN,
},
(data) => {
console.log('');
console.log('====================================');
console.log('MICROSOFT LOGIN');
console.log('====================================');
console.log('Code:', data.user_code);
console.log('Link:', data.verification_uri);
console.log('Gültig für ca.:', data.expires_in, 'Sekunden');
console.log('====================================');
console.log('');
}
);
const bot = bedrock.createClient({
host: MC_HOST,
port: MC_PORT,
username: MC_USERNAME,
profilesFolder: minecraftProfilOrdner,
authflow: minecraftAuthflow,
});
mcBot = bot;
// --------------------------------------------------------
// START GAME
// --------------------------------------------------------
bot.on('start_game', async (packet) => {
if (bot !== mcBot) return;
mcOnline = true;
minecraftStartzeit = Date.now();
if (packet.runtime_entity_id !== undefined) {
playerEntityId = parseEntityId(packet.runtime_entity_id);
} else if (packet.player_entity_id !== undefined) {
playerEntityId = parseEntityId(packet.player_entity_id);
} else if (packet.entity_id !== undefined) {
playerEntityId = parseEntityId(packet.entity_id);
}
if (packet.uuid) minecraftUuid = packet.uuid;
console.log('[MC] LiveSinger9275 ist online.');
setTimeout(async () => {
if (bot !== mcBot || !mcOnline) return;
await geldAktualisieren();
await dashboardAktualisieren();
}, 3000);
});
// --------------------------------------------------------
// MINECRAFT CHAT
// --------------------------------------------------------
bot.on('text', async (packet) => {
if (bot !== mcBot) return;
try {
const username = packet.source_name || '';
let message = packet.message || '';
if (!message && Array.isArray(packet.parameters)) {
message = packet.parameters.join(' ');
}
const channel = discord.channels.cache.get(MC_CHANNEL_ID);
if (channel && message) {
await channel
.send(`**${username || 'Minecraft'}:** ${message}`)
.catch(() => undefined);
}
// TPA von !FrozenBoar16433 oder FrozenBoar16433 automatisch annehmen.
if (istFrozenBoar(username) && /\btpa(?:here)?\b/i.test(message)) {
console.log('[MC] TPA von FrozenBoar16433 erkannt.');
try {
await minecraftCommand('/tpaccept');
console.log('[MC] TPA automatisch angenommen.');
} catch (err) {
console.error('[MC] TPA-Fehler:', safeError(err));
}
setTimeout(async () => {
if (bot !== mcBot || !mcOnline) return;
try {
await minecraftCommand('/sethome afk');
console.log('[MC] AFK-Home gesetzt.');
} catch (err) {
console.error('[MC] AFK-Home Fehler:', safeError(err));
}
}, 10000);
}
} catch (err) {
console.error('[MC] Chat-Fehler:', safeError(err));
}
});
// --------------------------------------------------------
// KOORDINATEN
// --------------------------------------------------------
bot.on('move_player', (packet) => {
if (bot !== mcBot) return;
if (!packet.position) return;
// Wenn das Paket eine Entity-ID enthält, nur den Bot übernehmen.
if (
) {
packet.runtime_entity_id !== undefined &&
playerEntityId &&
parseEntityId(packet.runtime_entity_id) !== playerEntityId
return;
}
const x = Number(packet.position.x);
const y = Number(packet.position.y);
const z = Number(packet.position.z);
if (Number.isFinite(x)) aktuelleKoordinaten.x = x;
if (Number.isFinite(y)) aktuelleKoordinaten.y = y;
if (Number.isFinite(z)) aktuelleKoordinaten.z = z;
});
// --------------------------------------------------------
// FEHLER
// --------------------------------------------------------
bot.on('error', (err) => {
if (bot !== mcBot) return;
console.error('[MC] Fehler:', safeError(err));
});
// --------------------------------------------------------
// CLOSE
// --------------------------------------------------------
bot.on('close', () => {
if (bot !== mcBot) return;
console.log('[MC] Verbindung geschlossen.');
resetMinecraftState();
if (manuellGestoppt) {
console.log('[MC] Manuell gestoppt – kein Reconnect.');
void dashboardAktualisieren();
return;
}
void dashboardAktualisieren();
scheduleReconnect();
});
} catch (err) {
console.error('[MC] Verbindungsfehler:', safeError(err));
resetMinecraftState();
scheduleReconnect();
}
}
function minecraftStarten() {
manuellGestoppt = false;
if (mcOnline) return;
minecraftVerbinden();
}
function minecraftStoppen() {
manuellGestoppt = true;
clearReconnectTimer();
laufenStoppen();
const bot = mcBot;
mcBot = null;
resetMinecraftState();
if (bot) {
try {
bot.disconnect();
} catch {}
}
console.log('[MC] LiveSinger9275 wurde gestoppt.');
}
function minecraftNeuVerbinden() {
manuellGestoppt = false;
clearReconnectTimer();
laufenStoppen();
const bot = mcBot;
mcBot = null;
resetMinecraftState();
if (bot) {
try {
bot.disconnect();
} catch {}
}
console.log('[MC] LiveSinger9275 wird neu verbunden...');
setTimeout(() => {
if (!manuellGestoppt && !mcOnline) minecraftVerbinden();
}, 1000);
}
// ============================================================
// HOME AFK
// ============================================================
async function homeAfkAusfuehren() {
if (!mcOnline) throw new Error('LiveSinger9275 ist offline.');
await minecraftCommand('/home afk');
}
// ============================================================
// GELD SENDEN
// ============================================================
function geldBetragNormalisieren(eingabe) {
if (eingabe === null || eingabe === undefined) return null;
let text = String(eingabe).trim().replace(/\s/g, '');
if (!text) return null;
// Deutsche Eingabe 1.234,56 und einfache Eingabe 1234.56.
if (text.includes('.') && text.includes(',')) {
const letzterPunkt = text.lastIndexOf('.');
const letztesKomma = text.lastIndexOf(',');
if (letztesKomma > letzterPunkt) {
text = text.replace(/\./g, '').replace(',', '.');
} else {
text = text.replace(/,/g, '');
}
} else if (text.includes(',')) {
const nachKomma = text.split(',').pop();
if (nachKomma.length <= 2) {
text = text.replace(',', '.');
} else {
text = text.replace(/,/g, '');
}
}
const betrag = Number(text);
if (!Number.isFinite(betrag) || betrag <= 0) return null;
if (betrag > 1000000000) return null;
return betrag;
}
async function geldSenden(betragEingabe) {
if (!mcOnline) throw new Error('LiveSinger9275 ist offline.');
const betrag = geldBetragNormalisieren(betragEingabe);
if (betrag === null) throw new Error('Ungültiger Geldbetrag.');
const kontostand = await geldAktualisieren();
if (kontostand === null) {
throw new Error('Kontostand konnte nicht abgerufen werden.');
}
if (betrag > kontostand) {
throw new Error(`Nicht genug Geld. Kontostand: ${formatGeld(kontostand)}`);
}
const betragText = Number.isInteger(betrag)
? String(betrag)
: String(betrag);
const payCommand = `/pay ${MONEY_TARGET} ${betragText}`;
console.log('[MONEY] Sende:', payCommand);
const output = await minecraftCommand(payCommand);
// Viele Server verlangen bei größeren Zahlungen eine Bestätigung.
if (betrag > 4999) {
await sleep(1000);
await minecraftCommand(`${payCommand} confirm`);
}
await sleep(1000);
await geldAktualisieren();
return { betrag, output };
}
// ============================================================
// DASHBOARD
// ============================================================
function dashboardEmbed() {
return new EmbedBuilder()
.setTitle('  LiveSinger9275 Dashboard')
.setDescription('Steuerung für deinen Minecraft-Bot.')
.addFields(
{
name: '  Status',
value: mcOnline ? '  Online' : '  Offline',
inline: true,
},
{
name: '  Geld',
value: formatGeld(aktuellesGeld),
inline: true,
},
{
name: '  Koordinaten',
value: formatKoordinaten(),
inline: true,
},
{
name: '   Uptime',
value: formatLiveUptime(),
inline: true,
},
{
name: '  Laufen',
value: laufenAktiv ? '  Aktiv' : '  Aus',
inline: true,
},
{
name: '  TPA',
value: '  FrozenBoar16433 automatisch annehmen → danach /sethome afk',
inline: false,
},
{
name: '  Geldziel',
value: MONEY_TARGET,
inline: true,
},
{
name: '  Zugriff',
value: 'Serverbesitzer + freigeschaltete Controller.',
inline: true,
}
)
.setFooter({ text: 'LiveSinger9275 • BlockBande' });
}
function panelButtons() {
const row1 = new ActionRowBuilder().addComponents(
new ButtonBuilder()
.setCustomId('toggle_bot')
.setLabel('Ein / Aus')
.setEmoji('  ')
.setStyle(ButtonStyle.Primary),
new ButtonBuilder()
.setCustomId('pay')
.setLabel('Geld senden')
.setEmoji(' ')
.setStyle(ButtonStyle.Primary),
new ButtonBuilder()
.setCustomId('home_afk')
.setLabel('Home AFK')
.setEmoji(' ')
.setStyle(ButtonStyle.Secondary),
new ButtonBuilder()
.setCustomId('reconnect')
.setLabel('Neu verbinden')
.setEmoji(' ')
.setStyle(ButtonStyle.Primary),
new ButtonBuilder()
.setCustomId('stop')
.setLabel('Stoppen')
.setEmoji(' ')
.setStyle(ButtonStyle.Danger)
);
const row2 = new ActionRowBuilder().addComponents(
new ButtonBuilder()
.setCustomId('toggle_laufen')
.setLabel('Laufen')
.setEmoji(' ')
.setStyle(ButtonStyle.Success)
);
return [row1, row2];
}
async function dashboardAktualisieren() {
if (!dashboardMessage) return;
try {
await dashboardMessage.edit({
embeds: [dashboardEmbed()],
components: panelButtons(),
});
} catch (err) {
console.error('[DASHBOARD] Update-Fehler:', safeError(err));
}
}
async function dashboardNachNeustartLaden() {
const messageId = String(process.env.DASHBOARD_MESSAGE_ID || '').trim();
if (!messageId) return;
try {
const channel = await discord.channels.fetch(MC_CHANNEL_ID);
if (!channel || !channel.isTextBased()) return;
dashboardMessage = await channel.messages.fetch(messageId);
await dashboardAktualisieren();
console.log('[DASHBOARD] Bestehendes Dashboard wiederhergestellt.');
} catch (err) {
console.log('[DASHBOARD] Dashboard konnte nicht wiederhergestellt werden:', safeError(err));
}
}
// ============================================================
// DASHBOARD TIMER
// ============================================================
function dashboardTimerStarten() {
if (dashboardRefreshTimer) clearInterval(dashboardRefreshTimer);
if (moneyRefreshTimer) clearInterval(moneyRefreshTimer);
dashboardRefreshTimer = setInterval(() => {
void dashboardAktualisieren();
}, DASHBOARD_REFRESH_MS);
moneyRefreshTimer = setInterval(() => {
if (mcOnline) {
void (async () => {
await geldAktualisieren();
await dashboardAktualisieren();
})();
}
}, MONEY_REFRESH_MS);
}
// ============================================================
// SLASH COMMANDS
// ============================================================
const slashCommands = [
new SlashCommandBuilder()
.setName('dashboard')
.setDescription('Zeigt das LiveSinger9275 Dashboard.'),
new SlashCommandBuilder()
.setName('mc')
.setDescription('Sendet einen Minecraft-Befehl.')
.addStringOption((option) =>
option
.setName('befehl')
.setDescription('Minecraft-Befehl ohne führenden Slash.')
.setRequired(true)
),
new SlashCommandBuilder()
.setName('controller')
.setDescription('Verwaltet die LiveSinger9275 Controller.')
.addSubcommand((subcommand) =>
subcommand
.setName('hinzufuegen')
.setDescription('Fügt einen Controller hinzu.')
.addUserOption((option) =>
option
.setName('user')
.setDescription('Discord-Benutzer.')
.setRequired(true)
)
)
.addSubcommand((subcommand) =>
subcommand
.setName('entfernen')
.setDescription('Entfernt einen Controller.')
.addUserOption((option) =>
option
.setName('user')
.setDescription('Discord-Benutzer.')
.setRequired(true)
)
)
.addSubcommand((subcommand) =>
subcommand
.setName('liste')
.setDescription('Zeigt alle Controller.')
),
].map((command) => command.toJSON());
// ============================================================
// DISCORD READY
// ============================================================
discord.once('ready', async () => {
discordReady = true;
console.log(`[DISCORD] Verbunden als ${discord.user.tag}`);
try {
await discord.application.commands.set(slashCommands);
console.log('[DISCORD] Slash Commands registriert.');
} catch (err) {
console.error('[DISCORD] Slash-Registrierung fehlgeschlagen:', safeError(err));
}
dashboardTimerStarten();
await dashboardNachNeustartLaden();
});
// ============================================================
// INTERACTIONS
// ============================================================
discord.on('interactionCreate', async (interaction) => {
try {
// --------------------------------------------------------
// SLASH COMMANDS
// --------------------------------------------------------
if (interaction.isChatInputCommand()) {
const command = interaction.commandName;
if (!darfSteuern(interaction)) {
await interaction.reply({
content: '  Du hast keinen Zugriff auf LiveSinger9275.',
flags: MessageFlags.Ephemeral,
});
return;
}
if (command === 'dashboard') {
const message = await interaction.reply({
embeds: [dashboardEmbed()],
components: panelButtons(),
fetchReply: true,
});
dashboardMessage = message;
return;
}
if (command === 'mc') {
if (!mcOnline) {
await interaction.reply({
content: '  LiveSinger9275 ist offline.',
flags: MessageFlags.Ephemeral,
});
return;
}
let minecraftBefehl = interaction.options.getString('befehl', true).trim();
if (!minecraftBefehl.startsWith('/')) minecraftBefehl = `/${minecraftBefehl}`;
await interaction.deferReply({ flags: MessageFlags.Ephemeral });
try {
const output = await minecraftCommand(minecraftBefehl);
const antwort = kuerzeDiscordText(output || 'Befehl wurde gesendet.');
await interaction.editReply({
content: `  **Minecraft:**\n\`\`\`\n${antwort}\n\`\`\``,
});
} catch (err) {
await interaction.editReply({
content: `  Minecraft-Fehler: ${safeError(err)}`,
});
}
return;
}
if (command === 'controller') {
if (!istServerOwner(interaction)) {
await interaction.reply({
content: '  Nur der Serverbesitzer kann Controller verwalten.',
flags: MessageFlags.Ephemeral,
});
return;
}
const subcommand = interaction.options.getSubcommand();
if (subcommand === 'hinzufuegen') {
const user = interaction.options.getUser('user', true);
erlaubteController.add(user.id);
await interaction.reply({
content: `  ${user} wurde als LiveSinger9275-Controller hinzugefügt.`,
flags: MessageFlags.Ephemeral,
});
return;
}
if (subcommand === 'entfernen') {
const user = interaction.options.getUser('user', true);
erlaubteController.delete(user.id);
await interaction.reply({
content: `  ${user} wurde als LiveSinger9275-Controller entfernt.`,
flags: MessageFlags.Ephemeral,
});
return;
}
if (subcommand === 'liste') {
if (erlaubteController.size === 0) {
await interaction.reply({
content: '  Es sind keine zusätzlichen Controller eingetragen.',
flags: MessageFlags.Ephemeral,
});
return;
}
const liste = Array.from(erlaubteController)
.map((id) => `<@${id}>`)
.join('\n');
await interaction.reply({
content: `  **LiveSinger9275 Controller:**\n${liste}`,
flags: MessageFlags.Ephemeral,
});
return;
}
return;
}
return;
}
// --------------------------------------------------------
// BUTTONS
// --------------------------------------------------------
if (interaction.isButton()) {
if (!darfSteuern(interaction)) {
await interaction.reply({
content: '  Du hast keinen Zugriff auf LiveSinger9275.',
flags: MessageFlags.Ephemeral,
});
return;
}
if (interaction.customId === 'toggle_bot') {
if (mcOnline) {
minecraftStoppen();
await dashboardAktualisieren();
await interaction.reply({
content: '  LiveSinger9275 wurde ausgeschaltet.',
flags: MessageFlags.Ephemeral,
});
} else {
minecraftStarten();
await interaction.reply({
content: '  LiveSinger9275 wird gestartet.',
flags: MessageFlags.Ephemeral,
});
}
return;
}
if (interaction.customId === 'pay') {
const modal = new ModalBuilder()
.setCustomId('pay_modal')
.setTitle('Geld senden');
const input = new TextInputBuilder()
.setCustomId('amount')
.setLabel('Betrag')
.setPlaceholder('z. B. 5000')
.setStyle(TextInputStyle.Short)
.setRequired(true)
.setMaxLength(20);
modal.addComponents(
new ActionRowBuilder().addComponents(input)
);
await interaction.showModal(modal);
return;
}
if (interaction.customId === 'home_afk') {
await interaction.deferReply({ flags: MessageFlags.Ephemeral });
try {
await homeAfkAusfuehren();
await interaction.editReply({
content: '  `/home afk` wurde ausgeführt.',
});
} catch (err) {
await interaction.editReply({
content: `  Home-AFK-Fehler: ${safeError(err)}`,
});
}
return;
}
if (interaction.customId === 'reconnect') {
minecraftNeuVerbinden();
await interaction.reply({
content: '  LiveSinger9275 wird neu verbunden.',
flags: MessageFlags.Ephemeral,
});
return;
}
if (interaction.customId === 'stop') {
minecraftStoppen();
await dashboardAktualisieren();
await interaction.reply({
content: '  LiveSinger9275 wurde gestoppt.',
flags: MessageFlags.Ephemeral,
});
return;
}
if (interaction.customId === 'toggle_laufen') {
if (laufenAktiv) {
laufenStoppen();
await dashboardAktualisieren();
await interaction.reply({
content: '  Laufen wurde gestoppt.',
flags: MessageFlags.Ephemeral,
});
return;
}
if (!mcOnline) {
await interaction.reply({
content: '  LiveSinger9275 ist offline.',
flags: MessageFlags.Ephemeral,
});
return;
}
try {
laufenStarten();
await dashboardAktualisieren();
await interaction.reply({
content: '  LiveSinger9275 läuft jetzt.',
flags: MessageFlags.Ephemeral,
});
} catch (err) {
await interaction.reply({
content: `  Laufen-Fehler: ${safeError(err)}`,
flags: MessageFlags.Ephemeral,
});
}
return;
}
return;
}
// --------------------------------------------------------
// PAY MODAL
// --------------------------------------------------------
if (interaction.isModalSubmit()) {
if (interaction.customId !== 'pay_modal') return;
if (!darfSteuern(interaction)) {
await interaction.reply({
content: '  Du hast keinen Zugriff auf LiveSinger9275.',
flags: MessageFlags.Ephemeral,
});
return;
}
const amount = interaction.fields.getTextInputValue('amount');
await interaction.deferReply({ flags: MessageFlags.Ephemeral });
try {
const ergebnis = await geldSenden(amount);
await dashboardAktualisieren();
await interaction.editReply({
content: `  **${formatGeld(ergebnis.betrag)}** wurde an **${MONEY_TARGET}** gesendet.`,
});
} catch (err) {
await interaction.editReply({
content: `  Geld senden fehlgeschlagen: ${safeError(err)}`,
});
}
}
} catch (err) {
console.error('[DISCORD] Interaction-Fehler:', safeError(err));
try {
if (interaction.replied || interaction.deferred) {
await interaction.editReply({
content: '  Ein unerwarteter Fehler ist aufgetreten.',
});
} else {
await interaction.reply({
content: '  Ein unerwarteter Fehler ist aufgetreten.',
flags: MessageFlags.Ephemeral,
});
}
} catch {}
}
});
// ============================================================
// PROZESS / GRACEFUL SHUTDOWN
// ============================================================
let shuttingDown = false;
async function shutdown(signal) {
if (shuttingDown) return;
shuttingDown = true;
console.log(`[SYSTEM] ${signal} – fahre sauber herunter...`);
try {
clearReconnectTimer();
laufenStoppen();
if (dashboardRefreshTimer) clearInterval(dashboardRefreshTimer);
if (moneyRefreshTimer) clearInterval(moneyRefreshTimer);
const bot = mcBot;
mcBot = null;
resetMinecraftState();
if (bot) {
try {
bot.disconnect();
} catch {}
}
discordReady = false;
try {
discord.destroy();
} catch {}
await new Promise((resolve) => webServer.close(() => resolve()));
} finally {
process.exit(0);
}
}
process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('unhandledRejection', (err) => {
console.error('[SYSTEM] Unhandled Rejection:', safeError(err));
});
process.on('uncaughtException', (err) => {
console.error('[SYSTEM] Uncaught Exception:', safeError(err));
});
// ============================================================
// START
// ============================================================
if (!DISCORD_TOKEN) {
console.error('[DISCORD] FEHLER: DISCORD_TOKEN fehlt.');
process.exit(1);
}
console.log('====================================');
console.log('FrozenRun / LiveSinger9275 startet...');
console.log('Minecraft:', `${MC_HOST}:${MC_PORT}`);
console.log('Minecraft Benutzer:', MC_USERNAME);
console.log('Geldziel:', MONEY_TARGET);
console.log('Discord Minecraft Channel:', MC_CHANNEL_ID);
console.log('Minecraft Auth-Ordner:', minecraftProfilOrdner);
console.log('====================================');
discord.login(DISCORD_TOKEN).catch((err) => {
console.error('[DISCORD] Login fehlgeschlagen:', safeError(err));
process.exit(1);
});
