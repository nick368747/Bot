const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const bedrock = require("bedrock-protocol");
const { Authflow, Titles } = require("prismarine-auth");
const prismarineChunk = require("prismarine-chunk");
const prismarineRegistry = require("prismarine-registry");
const { Vec3 } = require("vec3");
const { Client: DiscordClient, GatewayIntentBits, Events, REST, Routes, SlashCommandBuilder, PermissionFlagsBits, ActivityType, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require("discord.js");
// ============================================================
// FrozenRun – Web-Version mit optionaler Discord-Anbindung
// ============================================================
const APP_VERSION = String(process.env.APP_VERSION || "2.0.10").trim().slice(0, 32);
const PORT = Number(process.env.PORT || 10000);
const HOST = "0.0.0.0";
const WEB_PASSWORD = process.env.WEB_PASSWORD || "";
const SESSION_TTL_MS = 12 * 60 * 60 * 1000;
const MC_PROFILES_FOLDER =
process.env.MC_PROFILES_FOLDER || path.join(process.cwd(), ".minecraft");
const RESET_MINECRAFT_LOGIN = process.env.RESET_MINECRAFT_LOGIN === "true";
const MC_HOST = process.env.MC_HOST || "blockbande.de";
const MC_PORT = Number(process.env.MC_PORT || 19132);
const MC_USERNAME = process.env.MC_USERNAME || "LiveSinger9275";
const MONEY_TARGET = process.env.MONEY_TARGET || "!FrozenBoar16433";
const TPA_PLAYER_NAME = process.env.TPA_PLAYER_NAME || "!FrozenBoar16433";
const MC_AUTH_FLOW = process.env.MC_AUTH_FLOW || "live";
const MC_AUTH_TITLE = Titles.MinecraftNintendoSwitch;
const MC_AUTH_DEVICE = process.env.MC_AUTH_DEVICE || "Nintendo";
if (!WEB_PASSWORD) {
console.error("FEHLER: WEB_PASSWORD ist nicht gesetzt.");
console.error("Setze in Render eine geheime Variable WEB_PASSWORD.");
process.exit(1);
}
// ============================================================
// Microsoft-Login-Reset
// ============================================================
if (RESET_MINECRAFT_LOGIN) {
try {
fs.rmSync(MC_PROFILES_FOLDER, { recursive: true, force: true });
console.log("Minecraft-Login wurde zurückgesetzt.");
} catch (err) {
console.error("Fehler beim Zurücksetzen des Minecraft-Logins:", err.message);
}
}
try {
fs.mkdirSync(MC_PROFILES_FOLDER, { recursive: true });
} catch (err) {
console.error("Minecraft-Profilordner konnte nicht erstellt werden:", err.message);
process.exit(1);
}
// ============================================================
// Status
// ============================================================
let mcBot = null;
let mcOnline = false;
let manuellGestoppt = true;
let minecraftStartzeit = null;
let minecraftUuid = null;
let playerEntityId = 0;
let reconnectTimer = null;
let connecting = false;
let connectionGeneration = 0;
let aktuelleKoordinaten = { x: 0, y: 0, z: 0 };
let aktuelleRotation = { yaw: 0, pitch: 0, headYaw: 0 };
let aktuellesGeld = 0;
let laufenAktiv = false;
let laufenTimer = null;
let laufenRichtungsTimer = null;
let laufenRichtung = 0;
let authInfo = null;
let letzterFehler = null;
const chatLog = [];
const eventLog = [];
// Discord bleibt optional: Ohne DISCORD_TOKEN läuft die Webseite unverändert weiter.
const DISCORD_TOKEN = String(process.env.DISCORD_TOKEN || "").trim();
const DISCORD_CLIENT_ID = String(process.env.DISCORD_CLIENT_ID || "").trim();
const DISCORD_GUILD_ID = String(process.env.DISCORD_GUILD_ID || "").trim();
const DISCORD_CHAT_CHANNEL_ID = String(process.env.DISCORD_CHAT_CHANNEL_ID || "").trim();
const DISCORD_LOG_CHANNEL_ID = String(process.env.DISCORD_LOG_CHANNEL_ID || "").trim();
const DISCORD_ALLOWED_USER_IDS = new Set(String(process.env.DISCORD_ALLOWED_USER_IDS || "").split(",").map(v => v.trim()).filter(Boolean));
const DISCORD_ALLOWED_ROLE_IDS = new Set(String(process.env.DISCORD_ALLOWED_ROLE_IDS || "").split(",").map(v => v.trim()).filter(Boolean));
let discordClient = null;
let discordReady = false;
let discordLastStatus = "";
let discordStatusTimer = null;
let discordChatRelayLastAt = 0;
// Tatsächliche Bedrock-Welt für die Bildschirm-Ansicht.
// Die Browser-Ansicht verwendet daraus die echten Blockpositionen statt einer Demo-Welt.
const worldChunks = new Map();
const worldSurfaces = new Map();
let worldChunkClass = null;
let worldRegistry = null;
let worldParserVersion = null;
let worldParserError = null;
function worldChunkKey(x, z) { return `${x},${z}`; }
function worldParserVersionFor(clientVersion) {
  const forced = String(process.env.BEDROCK_WORLD_VERSION || "").trim();
  if (forced) return forced.startsWith("bedrock_") ? forced : `bedrock_${forced}`;
  const v = String(clientVersion || "");
  if (/^1\.21\./.test(v)) return `bedrock_${v}`;
  return "bedrock_1.21.130";
}
function ensureWorldParser(clientVersion) {
  if (worldChunkClass && worldRegistry) return true;
  const version = worldParserVersionFor(clientVersion);
  try {
    worldRegistry = prismarineRegistry(version);
    worldChunkClass = prismarineChunk(worldRegistry);
    worldParserVersion = version;
    worldParserError = null;
    addEvent(`3D-Weltparser aktiv: ${version}.`, "info");
    return true;
  } catch (err) {
    worldParserError = err?.message || String(err);
    addEvent(`3D-Weltparser konnte nicht geladen werden: ${worldParserError}`, "error");
    return false;
  }
}
function resetWorldState() {
  worldChunks.clear();
  worldSurfaces.clear();
}
function isAirBlock(block) {
  const name = String(block?.name || "").toLowerCase();
  return !name || name === "air" || name === "cave_air" || name === "void_air";
}
function blockColor(name) {
  const n = String(name || "").toLowerCase();
  if (n.includes("grass")) return "#6fa34f";
  if (n.includes("dirt") || n.includes("mud")) return "#795548";
  if (n.includes("stone") || n.includes("deepslate") || n.includes("cobble")) return "#777b82";
  if (n.includes("sand")) return "#d8c17a";
  if (n.includes("gravel")) return "#8b8a82";
  if (n.includes("water")) return "#3f7fc1";
  if (n.includes("lava")) return "#d46a25";
  if (n.includes("wood") || n.includes("log") || n.includes("planks")) return "#8b633f";
  if (n.includes("leaves")) return "#4f8f45";
  if (n.includes("snow") || n.includes("ice")) return "#d9edf7";
  if (n.includes("glass")) return "#9fc7d9";
  if (n.includes("brick")) return "#a55a4d";
  return "#8a8f98";
}
function rebuildWorldSurface(chunk) {
  const x0 = Number(chunk.x) * 16;
  const z0 = Number(chunk.z) * 16;
  const blocks = [];
  const minY = Number(chunk.minY ?? -64);
  const maxY = minY + Number(chunk.worldHeight ?? 384) - 1;
  for (let lx = 0; lx < 16; lx++) {
    for (let lz = 0; lz < 16; lz++) {
      for (let y = maxY; y >= minY; y--) {
        let block;
        try { block = chunk.getBlock(new Vec3(lx, y, lz)); } catch { block = null; }
        if (!isAirBlock(block)) {
          blocks.push({
            x: x0 + lx,
            y,
            z: z0 + lz,
            name: String(block.name || "unknown"),
            color: blockColor(block.name)
          });
          break;
        }
      }
    }
  }
  worldSurfaces.set(worldChunkKey(chunk.x, chunk.z), blocks);
}
async function decodeLevelChunk(packet) {
  if (!mcBot || !ensureWorldParser(mcBot.version)) return;
  if (packet?.cache_enabled) {
    // Caching braucht zusätzlich den Client-Blob-Store. Für die erste robuste Ansicht
    // werden nur ungekachte LevelChunk-Pakete verarbeitet.
    return;
  }
  const x = Number(packet?.x);
  const z = Number(packet?.z);
  if (!Number.isFinite(x) || !Number.isFinite(z)) return;
  try {
    let chunk = worldChunks.get(worldChunkKey(x, z));
    if (!chunk) {
      chunk = new worldChunkClass({ x, z, minY: -64, worldHeight: 384 });
      worldChunks.set(worldChunkKey(x, z), chunk);
    }
    const count = Number(packet.sub_chunk_count);
    await chunk.networkDecodeNoCache(packet.payload || Buffer.alloc(0), Number.isFinite(count) ? count : -1);
    rebuildWorldSurface(chunk);
  } catch (err) {
    worldParserError = err?.message || String(err);
    addEvent(`3D-LevelChunk konnte nicht gelesen werden: ${worldParserError}`, "error");
  }
}
async function decodeSubChunk(packet) {
  if (!mcBot || !ensureWorldParser(mcBot.version) || !packet?.entries) return;
  const origin = packet.origin || {};
  if (packet.cache_enabled) return;
  for (const entry of packet.entries) {
    const result = String(entry?.result ?? "").toLowerCase();
    if (!(result === "success" || Number(entry?.result) === 1)) continue;
    const x = Number(origin.x) + Number(entry.dx || 0);
    const y = Number(origin.y) + Number(entry.dy || 0);
    const z = Number(origin.z) + Number(entry.dz || 0);
    if (![x, y, z].every(Number.isFinite) || !entry.payload) continue;
    try {
      let chunk = worldChunks.get(worldChunkKey(x, z));
      if (!chunk) {
        chunk = new worldChunkClass({ x, z, minY: -64, worldHeight: 384 });
        worldChunks.set(worldChunkKey(x, z), chunk);
      }
      await chunk.networkDecodeSubChunkNoCache(y, entry.payload);
      rebuildWorldSurface(chunk);
    } catch (err) {
      worldParserError = err?.message || String(err);
      addEvent(`3D-SubChunk konnte nicht gelesen werden: ${worldParserError}`, "error");
    }
  }
}
function getWorldView() {
  const p = aktuelleKoordinaten;
  const centerX = Math.floor(Number(p.x) / 16);
  const centerZ = Math.floor(Number(p.z) / 16);
  const blocks = [];
  const radius = 2;
  for (let cx = centerX - radius; cx <= centerX + radius; cx++) {
    for (let cz = centerZ - radius; cz <= centerZ + radius; cz++) {
      const part = worldSurfaces.get(worldChunkKey(cx, cz));
      if (part) blocks.push(...part);
    }
  }
  return {
    parser: worldParserVersion,
    parserError: worldParserError,
    chunks: worldSurfaces.size,
    blocks
  };
}
const sessions = new Map();
const loginAttempts = new Map();
// ============================================================
// Hilfsfunktionen
// ============================================================
function nowIso() {
return new Date().toISOString();
}
function addEvent(message, type = "info") {
const entry = { time: nowIso(), message: String(message), type };
eventLog.push(entry);
while (eventLog.length > 150) eventLog.shift();
console.log(`[${type.toUpperCase()}] ${message}`);
if (type === "error" || type === "warning" || type === "success") void sendDiscordLog(message, type);
}
function addChat(source, message, type = "chat") {
const entry = {
time: nowIso(),
source: String(source || "Minecraft"),
message: String(message || ""),
type
};
chatLog.push(entry);
while (chatLog.length > 200) chatLog.shift();
if (type === "chat" && source !== "Discord") void sendDiscordChat(`${source}: ${message}`);
}
function formatLiveUptime() {
if (!minecraftStartzeit) return "00:00:00";
const seconds = Math.max(0, Math.floor((Date.now() - minecraftStartzeit) / 1000));
const h = Math.floor(seconds / 3600);
const m = Math.floor((seconds % 3600) / 60);
const s = seconds % 60;
return [h, m, s].map(v => String(v).padStart(2, "0")).join(":");
}
function formatGeld(value) {
const number = Number(value);
if (!Number.isFinite(number)) return "0 $";
return `${Math.floor(number).toLocaleString("de-DE")} $`;
}
function formatKoordinaten() {
const { x, y, z } = aktuelleKoordinaten;
return `${Math.round(Number(x) || 0)}, ${Math.round(Number(y) || 0)}, ${Math.round(Number(z) || 0)}`;
}
function sanitizeChatMessage(value) {
return String(value || "").replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "").trim();
}
function json(res, status, data) {
const body = JSON.stringify(data);
res.writeHead(status, {
"Content-Type": "application/json; charset=utf-8",
"Cache-Control": "no-store",
"X-Content-Type-Options": "nosniff",
"Referrer-Policy": "same-origin",
"X-Frame-Options": "DENY",
"Permissions-Policy": "camera=(), microphone=(), geolocation=()"
});
res.end(body);
}
function html(res, status, body) {
res.writeHead(status, {
"Content-Type": "text/html; charset=utf-8",
"Cache-Control": "no-store",
"X-Content-Type-Options": "nosniff",
"Referrer-Policy": "same-origin",
"X-Frame-Options": "DENY",
"Permissions-Policy": "camera=(), microphone=(), geolocation=()"
});
res.end(body);
}
function isSecureRequest(req) {
  const forwardedProto = String(req.headers["x-forwarded-proto"] || "").split(",")[0].trim().toLowerCase();
  return forwardedProto === "https" || Boolean(req.socket && req.socket.encrypted);
}

function getCookies(req) {
const result = {};
const raw = req.headers.cookie || "";
for (const part of raw.split(";")) {
const index = part.indexOf("=");
if (index === -1) continue;
const key = part.slice(0, index).trim();
const value = part.slice(index + 1).trim();
try { result[key] = decodeURIComponent(value); } catch { result[key] = value; }
}
return result;
}
function getSession(req) {
const token = getCookies(req).frozenrun_session;
if (!token) return null;
const session = sessions.get(token);
if (!session) return null;
if (Date.now() - session.createdAt > SESSION_TTL_MS) {
sessions.delete(token);
return null;
}
return session;
}
function requireSession(req, res) {
const session = getSession(req);
if (!session) {
json(res, 401, { ok: false, error: "Nicht angemeldet." });
return null;
}
return session;
}
function clientIp(req) {
return String(req.headers["x-forwarded-for"] || req.socket.remoteAddress || "unknown").split(",")[0].trim();
}
function loginRateLimited(req) {
const ip = clientIp(req);
const current = loginAttempts.get(ip) || { count: 0, since: Date.now() };
if (Date.now() - current.since > 60_000) {
current.count = 0;
current.since = Date.now();
}
current.count += 1;
loginAttempts.set(ip, current);
return current.count > 8;
}
async function readJson(req) {
return new Promise((resolve, reject) => {
let data = "";
let size = 0;
req.on("data", chunk => {
size += chunk.length;
if (size > 64 * 1024) {
reject(new Error("Request zu groß."));
req.destroy();
return;
}
data += chunk;
});
req.on("end", () => {
if (!data) return resolve({});
try {
resolve(JSON.parse(data));
} catch {
reject(new Error("Ungültiges JSON."));
}
});
req.on("error", reject);
});
}
function constantTimeEqual(a, b) {
const left = Buffer.from(String(a));
const right = Buffer.from(String(b));
if (left.length !== right.length) return false;
return crypto.timingSafeEqual(left, right);
}
function publicStatus() {
return {
ok: true,
online: mcOnline,
starting: connecting,
stopped: manuellGestoppt,
username: MC_USERNAME,
host: MC_HOST,
port: MC_PORT,
uptime: formatLiveUptime(),
money: aktuellesGeld,
moneyFormatted: formatGeld(aktuellesGeld),
coordinates: { ...aktuelleKoordinaten },
coordinatesFormatted: formatKoordinaten(),
rotation: { ...aktuelleRotation },
running: laufenAktiv,
auth: authInfo,
error: letzterFehler,
chat: chatLog.slice(-100),
events: eventLog.slice(-60)
};
}
// ============================================================
// Geld
// ============================================================
function geldAusOutputLesen(text) {
if (!text) return null;
const clean = String(text).replace(/\u00a0/g, " ");
const match = clean.match(/Dein\s+Kontostand\s*:\s*([\d.,]+)/i);
if (!match) return null;
let value = match[1].replace(/\s/g, "").replace(/[^\d.,-]/g, "");
if (!value) return null;
if (value.includes(".") && value.includes(",")) {
const dot = value.lastIndexOf(".");
const comma = value.lastIndexOf(",");
value = comma > dot ? value.replace(/\./g, "").replace(",", ".") : value.replace(/,/g, "");
} else if (value.includes(",")) {
const after = value.split(",").pop();
value = after.length <= 2 ? value.replace(/\./g, "").replace(",", ".") : value.replace(/,/g, "");
} else if (value.includes(".")) {
const after = value.split(".").pop();
if (after.length > 2) value = value.replace(/\./g, "");
}
const number = Number(value);
return Number.isFinite(number) ? Math.floor(number) : null;
}
function normalizeMoney(value) {
let text = String(value ?? "").trim().replace(/\s/g, "");
if (!text) return null;
text = text.replace(/\./g, "").replace(",", ".");
const number = Number(text);
if (!Number.isFinite(number) || number <= 0 || number > 1_000_000_000) return null;
return number;
}
// ============================================================
// Minecraft-Kommandos – serialisiert, damit Antworten nicht vermischt werden
// ============================================================
const commandQueue = [];
let commandQueueRunning = false;
function minecraftCommandDirect(command) {
return new Promise((resolve, reject) => {
if (!mcBot || !mcOnline) return reject(new Error("Minecraft ist offline."));
if (!minecraftUuid) return reject(new Error("Minecraft-UUID ist noch nicht verfügbar."));
const requestId = crypto.randomUUID();
let done = false;
const finish = (fn, value) => {
if (done) return;
done = true;
clearTimeout(timeout);
mcBot.removeListener("command_output", listener);
fn(value);
};
function listener(packet) {
if (!packet || done) return;
if (packet.origin?.uuid && String(packet.origin.uuid) !== String(minecraftUuid)) return;
let output = "";
if (Array.isArray(packet.output)) {
output = packet.output.map(item => {
if (typeof item === "string") return item;
if (item && typeof item === "object") return item.message || item.text || JSON.stringify(item);
return String(item);
}).join("\n");
} else if (typeof packet.output === "string") {
output = packet.output;
}
finish(resolve, output);
}
const timeout = setTimeout(() => finish(resolve, null), 8000);
mcBot.on("command_output", listener);
try {
mcBot.queue("command_request", {
command,
origin: {
type: "player",
uuid: minecraftUuid,
request_id: requestId,
player_entity_id: BigInt(playerEntityId || 0)
},
internal: false,
version: "latest"
});
} catch (err) {
finish(reject, err);
}
});
}
function minecraftCommand(command) {
return new Promise((resolve, reject) => {
commandQueue.push({ command, resolve, reject });
void processCommandQueue();
});
}
async function processCommandQueue() {
if (commandQueueRunning) return;
commandQueueRunning = true;
try {
while (commandQueue.length) {
const job = commandQueue.shift();
if (!job) continue;
try {
job.resolve(await minecraftCommandDirect(job.command));
} catch (err) {
job.reject(err);
}
}
} finally {
commandQueueRunning = false;
}
}
async function geldAktualisieren() {
if (!mcOnline) return null;
try {
const output = await minecraftCommand("/money");
const money = geldAusOutputLesen(output);
if (money === null) return null;
aktuellesGeld = money;
return money;
} catch (err) {
addEvent(`Geld-Abfrage fehlgeschlagen: ${err.message}`, "error");
return null;
}
}
// ============================================================
// Laufen
// ============================================================
function laufenStoppen() {
laufenAktiv = false;
if (laufenTimer) clearInterval(laufenTimer);
if (laufenRichtungsTimer) clearInterval(laufenRichtungsTimer);
laufenTimer = null;
laufenRichtungsTimer = null;
}
function laufenStarten() {
if (!mcOnline) throw new Error("Minecraft ist offline.");
laufenStoppen();
laufenAktiv = true;
laufenRichtung = Math.random() * Math.PI * 2;
laufenRichtungsTimer = setInterval(() => {
if (laufenAktiv && mcOnline) laufenRichtung += (Math.random() - 0.5) * Math.PI;
}, 2500);
// Bewusst 3 Sekunden statt extrem häufiger /tp-Befehle, um den Server nicht mit Commands zu fluten.
laufenTimer = setInterval(async () => {
if (!laufenAktiv || !mcOnline) return;
const speed = 0.18;
aktuelleKoordinaten.x += Math.cos(laufenRichtung) * speed;
aktuelleKoordinaten.z += Math.sin(laufenRichtung) * speed;
try {
await minecraftCommand(`/tp @s ${aktuelleKoordinaten.x.toFixed(2)} ${aktuelleKoordinaten.y.toFixed(2)} ${
aktuelleKoordinaten.z.toFixed(2)}`);
} catch (err) {
addEvent(`Laufen: ${err.message}`, "error");
}
}, 3000);
}
// ============================================================
// Minecraft verbinden
// ============================================================
function resetMinecraftState() {
mcOnline = false;
minecraftStartzeit = null;
minecraftUuid = null;
playerEntityId = 0;
aktuelleRotation = { yaw: 0, pitch: 0, headYaw: 0 };
laufenStoppen();
}
function scheduleReconnect() {
if (manuellGestoppt || reconnectTimer) return;
reconnectTimer = setTimeout(() => {
reconnectTimer = null;
if (!manuellGestoppt) minecraftVerbinden();
}, 30_000);
addEvent("Automatischer Reconnect in 30 Sekunden geplant.", "info");
}
function minecraftVerbinden() {
if (connecting || mcOnline || manuellGestoppt) return;
connecting = true;
letzterFehler = null;
authInfo = null;
const generation = ++connectionGeneration;
if (reconnectTimer) {
clearTimeout(reconnectTimer);
reconnectTimer = null;
}
addEvent(`Verbinde ${MC_USERNAME} mit ${MC_HOST}:${MC_PORT} ...`, "info");
let authflow;
try {
authflow = new Authflow(MC_USERNAME, MC_PROFILES_FOLDER, {
flow: MC_AUTH_FLOW,
authTitle: MC_AUTH_TITLE,
deviceType: MC_AUTH_DEVICE,
forceRefresh: RESET_MINECRAFT_LOGIN
}, data => {
authInfo = {
verificationUri: data.verification_uri || null,
userCode: data.user_code || null,
expiresIn: Number(data.expires_in || 0),
receivedAt: Date.now()
};
addEvent(`Microsoft-Anmeldung benötigt: ${data.user_code || "Code nicht vorhanden"}`, "auth");
});
const client = bedrock.createClient({
host: MC_HOST,
port: MC_PORT,
username: MC_USERNAME,
profilesFolder: MC_PROFILES_FOLDER,
authflow
});
mcBot = client;
connecting = false;
client.on("level_chunk", packet => {
void decodeLevelChunk(packet);
});
client.on("subchunk", packet => {
void decodeSubChunk(packet);
});
client.on("start_game", async packet => {
if (generation !== connectionGeneration) return;
mcOnline = true;
connecting = false;
minecraftStartzeit = Date.now();
letzterFehler = null;
authInfo = null;
if (packet.runtime_entity_id !== undefined) playerEntityId = Number(packet.runtime_entity_id);
if (packet.player_entity_id !== undefined) playerEntityId = Number(packet.player_entity_id);
if (packet.entity_id !== undefined) playerEntityId = Number(packet.entity_id);
if (packet.uuid) minecraftUuid = packet.uuid;
addEvent(`${MC_USERNAME} ist online.`, "success");
setTimeout(() => void geldAktualisieren(), 3000);
});
client.on("text", packet => {
const username = packet.source_name || "Minecraft";
const message = packet.message || (Array.isArray(packet.parameters) ? packet.parameters.join(" ") : "");
if (message) addChat(username, message, "chat");
const normalizedUser = String(username).trim().replace(/^!/, "").toLowerCase();
const normalizedTpa = String(TPA_PLAYER_NAME).trim().replace(/^!/, "").toLowerCase();
if (normalizedUser === normalizedTpa && /\/tpa(?:here)?\b/i.test(String(message))) {
void (async () => {
try {
await minecraftCommand("/tpaccept");
addChat("FrozenRun", "TPA automatisch angenommen.", "system");
setTimeout(async () => {
if (!mcOnline) return;
try {
await minecraftCommand("/sethome afk");
addChat("FrozenRun", "/sethome afk ausgeführt.", "system");
} catch (err) {
addEvent(`AFK-Home: ${err.message}`, "error");
}
}, 10_000);
} catch (err) {
addEvent(`TPA-Annahme: ${err.message}`, "error");
}
})();
}
});
client.on("move_player", packet => {
if (packet?.position) {
aktuelleKoordinaten = {
x: Number(packet.position.x) || 0,
y: Number(packet.position.y) || 0,
z: Number(packet.position.z) || 0
};
}
if (packet) {
aktuelleRotation = {
yaw: Number(packet.yaw ?? packet.rotation?.yaw) || 0,
pitch: Number(packet.pitch ?? packet.rotation?.pitch) || 0,
headYaw: Number(packet.head_yaw ?? packet.rotation?.head_yaw ?? packet.yaw) || 0
};
}
});
client.on("error", err => {
letzterFehler = err?.message || String(err);
addEvent(`Minecraft-Fehler: ${letzterFehler}`, "error");
});
client.on("close", () => {
if (generation !== connectionGeneration) return;
resetMinecraftState();
resetWorldState();
connecting = false;
mcBot = null;
addEvent("Minecraft-Verbindung geschlossen.", "warning");
if (!manuellGestoppt) scheduleReconnect();
});
} catch (err) {
connecting = false;
mcBot = null;
letzterFehler = err?.message || String(err);
addEvent(`Verbindungsaufbau fehlgeschlagen: ${letzterFehler}`, "error");
if (!manuellGestoppt) scheduleReconnect();
}
}
function minecraftStarten() {
manuellGestoppt = false;
if (!mcOnline && !connecting) minecraftVerbinden();
}
function minecraftStoppen() {
manuellGestoppt = true;
connectionGeneration += 1;
if (reconnectTimer) clearTimeout(reconnectTimer);
reconnectTimer = null;
connecting = false;
laufenStoppen();
if (mcBot) {
try { mcBot.disconnect("FrozenRun gestoppt"); } catch {}
}
mcBot = null;
resetMinecraftState();
addEvent("Minecraft-Bot wurde gestoppt.", "warning");
}
function minecraftNeuVerbinden() {
minecraftStoppen();
manuellGestoppt = false;
setTimeout(() => minecraftVerbinden(), 1000);
}
// ============================================================
// Web-Aktionen
// ============================================================
async function sendChatMessage(message) {
if (!mcOnline || !mcBot) throw new Error("Minecraft ist offline.");
const text = sanitizeChatMessage(message);
if (!text) throw new Error("Nachricht ist leer.");
if (text.length > 256) throw new Error("Nachricht ist zu lang (max. 256 Zeichen).");
if (text.startsWith("/")) throw new Error("Für Befehle bitte das Befehlsfeld verwenden.");
mcBot.queue("text", {
needs_translation: false,
category: "authored",
chat: "chat",
whisper: "whisper",
announcement: "announcement",
type: "chat",
source_name: mcBot.username || MC_USERNAME,
message: text,
xuid: "0",
platform_chat_id: "",
has_filtered_message: false,
filtered_message: ""
});
addChat(MC_USERNAME, text, "self");
}
async function sendCommand(command) {
if (!mcOnline) throw new Error("Minecraft ist offline.");
let value = String(command || "").trim();
if (!value) throw new Error("Befehl ist leer.");
if (!value.startsWith("/")) value = `/${value}`;
if (value.length > 256) throw new Error("Befehl ist zu lang.");
const output = await minecraftCommand(value);
if (output) addChat("Befehl", `${value}\n${output}`, "command");
else addChat("Befehl", value, "command");
return output;
}
async function geldSenden(betragInput) {
if (!mcOnline) throw new Error("Minecraft ist offline.");
const amount = normalizeMoney(betragInput);
if (amount === null) throw new Error("Ungültiger Geldbetrag.");
const balance = await geldAktualisieren();
if (balance === null) throw new Error("Kontostand konnte nicht abgerufen werden.");
if (amount > balance) throw new Error(`Nicht genug Geld. Kontostand: ${formatGeld(balance)}`);
const text = Number.isInteger(amount) ? String(amount) : String(amount);
const command = `/pay ${MONEY_TARGET} ${text}`;
const firstOutput = await minecraftCommand(command);
if (amount > 4999) {
await new Promise(resolve => setTimeout(resolve, 1000));
await minecraftCommand(`${command} confirm`);
}
await new Promise(resolve => setTimeout(resolve, 1000));
await geldAktualisieren();
return { amount, output: firstOutput };
}
// ============================================================
// Web-Oberfläche
// ============================================================
const LOGIN_HTML = `<!doctype html>
<html lang="de"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><link rel="manifest" href="/manifest.webmanifest"><meta name="theme-color" content="#4267d5"><meta name="mobile-web-app-capable" content="yes"><meta name="apple-mobile-web-app-capable" content="yes"><meta name="apple-mobile-web-app-title" content="Block Bande"><link rel="icon" href="/app-icon.svg" type="image/svg+xml"><link rel="apple-touch-icon" href="/app-icon.svg"><title>Block Bande – Botportal</title>
<style>*{box-sizing:border-box}html,body{width:100%;height:100%;min-height:0;margin:0;overflow:hidden}html{background:#d9d5ff}body{height:100vh;height:100dvh;min-height:0;background:linear-gradient(125deg,#bfd7ff 0%,#d9d5ff 48%,#ffc4d4 100%);color:#171717;font-family:"Comic Sans MS","Segoe Print",system-ui,sans-serif;display:flex;flex-direction:column;align-items:center;justify-content:center;overflow:hidden;padding:max(10px,env(safe-area-inset-top)) max(12px,env(safe-area-inset-right)) max(10px,env(safe-area-inset-bottom)) max(12px,env(safe-area-inset-left))}.card{width:min(620px,100%);flex:0 0 auto;overflow:visible;background:transparent;border:0;border-radius:0;padding:clamp(12px,4vw,34px) clamp(8px,3vw,28px);box-shadow:none;position:relative;margin:auto}.logo{width:100%;font-size:clamp(40px,8vw,76px);font-weight:1000;line-height:1.05;text-align:center;margin:0 0 18px;letter-spacing:-2px;overflow-wrap:anywhere}.brand-blue{color:#4779c7}.brand-red{color:#f04444}.portal{text-align:center;font-size:clamp(25px,5vw,40px);font-weight:900;margin:0 0 clamp(20px,6vh,46px)}input,button{width:100%;min-height:50px;border-radius:6px;border:4px solid #202020;font-size:22px;font-family:inherit}input{display:block;max-width:270px;margin:0 auto 12px;background:#d5d5d5;color:#171717;padding:0 14px}input::placeholder{color:#171717;opacity:1}button{display:block;max-width:270px;margin:auto;background:#d5d5d5;color:#171717;font-weight:900;cursor:pointer}button:disabled{opacity:.7;cursor:wait}button:active{transform:translateY(1px)}#msg{margin-top:14px;text-align:center;color:#a51d1d;min-height:22px;overflow-wrap:anywhere}.small{position:fixed;right:max(12px,env(safe-area-inset-right));bottom:max(8px,env(safe-area-inset-bottom));font-size:13px;color:#333;margin:0;z-index:5;pointer-events:none}.login-scene{display:block;width:min(100%,560px);height:auto;max-height:clamp(76px,18vh,150px);margin:0 auto 10px}.login-brand-image{display:block;width:min(100%,660px);height:auto;max-height:clamp(44px,12vh,120px);margin:0 auto 12px;overflow:visible}.login-brand-wordmark{display:flex;justify-content:center;align-items:center;gap:.14em;width:100%;font-size:clamp(40px,8vw,76px);font-weight:1000;line-height:1.05;letter-spacing:-2px;white-space:nowrap}.login-brand-wordmark .brand-blue,.login-brand-wordmark .brand-red{display:inline-block}.dashboard-brand-logo{width:clamp(190px,24vw,330px);max-height:70px}.top .title{display:flex;align-items:center;gap:8px;min-width:0}.dashboard-title-suffix{font-size:.48em;white-space:nowrap}@media(max-width:700px){.login-brand-image{width:min(100%,520px)}.dashboard-brand-logo{width:clamp(130px,27vw,210px);max-height:54px}.dashboard-title-suffix{display:none}.top{gap:6px}.card{padding-left:8px;padding-right:8px}.login-brand-wordmark{font-size:clamp(34px,9vw,58px);letter-spacing:-1.5px}}@media(max-height:520px){body{justify-content:center}.card{margin:0 auto;padding:4px 8px}.login-scene{max-height:68px;margin-bottom:4px}.login-brand-image{max-height:48px;margin-bottom:4px}.portal{margin-bottom:8px;font-size:24px}input,button{min-height:42px;font-size:18px}#msg{margin-top:5px}}</style></head><body><main class="card"><div class="logo login-brand-wordmark" role="img" aria-label="Block Bande"><span class="brand-blue">Block</span><span class="brand-red">Bande</span></div><div class="portal">Botportal</div><form id="form"><input id="password" type="password" autocomplete="current-password" placeholder="Passwort" required><button id="loginSubmit" type="submit" style="position:static;width:min(270px,100%);min-height:50px;margin:10px auto 0;padding:8px 14px;border:4px solid #202020;border-radius:6px;background:#d5d5d5;color:#171717;font-size:22px;font-weight:900;cursor:pointer">Anmelden</button></form><div id="msg"></div><div class="small" aria-label="Anwendungsversion">Version: 2.0.9</div></
main><script>
(function(){
 var form=document.getElementById('form'),input=document.getElementById('password'),button=document.getElementById('loginSubmit'),msg=document.getElementById('msg'),busy=false;
 if(!form||!input||!button||!msg)return;
 async function login(event){
  if(event){event.preventDefault();event.stopPropagation();}
  if(busy)return;
  if(!input.value){msg.textContent='Bitte Passwort eingeben.';input.focus();return;}
  busy=true;button.disabled=true;button.textContent='Anmeldung läuft…';msg.textContent='Verbinde…';
  try{
   var response=await fetch('/api/login',{method:'POST',credentials:'same-origin',cache:'no-store',headers:{'Content-Type':'application/json','Accept':'application/json'},body:JSON.stringify({password:input.value})});
   var data={};try{data=await response.json();}catch(ignore){}
   if(!response.ok)throw new Error(data.error||('Anmeldung fehlgeschlagen (HTTP '+response.status+').'));
   msg.style.color='#26713c';msg.textContent='Erfolgreich angemeldet – öffne das Dashboard…';window.location.replace('/');
  }catch(error){msg.style.color='#a51d1d';msg.textContent=(error&&error.message)||'Verbindung fehlgeschlagen. Bitte erneut versuchen.';busy=false;button.disabled=false;button.textContent='Anmelden';}
 }
 form.addEventListener('submit',login);
 input.addEventListener('keydown',function(event){if(event.key==='Enter'){event.preventDefault();login(event);}});
})();
</script><script>if("serviceWorker" in navigator){window.addEventListener("load",()=>{navigator.serviceWorker.register("/sw.js",{updateViaCache:"none"}).then(reg=>{reg.update();reg.addEventListener("updatefound",()=>{const worker=reg.installing;if(!worker)return;worker.addEventListener("statechange",()=>{if(worker.state==="installed"&&navigator.serviceWorker.controller){worker.postMessage("SKIP_WAITING");}});});}).catch(()=>{});});}</script></body></html>`;
const DASHBOARD_HTML = `<!doctype html>
<html lang="de"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-
scale=1"><link rel="manifest" href="/manifest.webmanifest"><meta name="theme-color" content="#4267d5"><meta name="mobile-web-app-capable" content="yes"><meta name="apple-mobile-web-app-capable" content="yes"><meta name="apple-mobile-web-app-title" content="Block Bande"><link rel="icon" href="/app-icon.svg" type="image/svg+xml"><link rel="apple-touch-icon" href="/app-icon.svg"><title>Block Bande – Botportal</title>
<style>*{box-sizing:border-box}body{margin:0;background:#fff;color:#171717;font-family:"Comic Sans MS","Segoe Print",system-ui,sans-serif}.wrap{width:min(1440px,100%);margin:auto;padding:20px}.brand-wrap{min-width:0}.logout-button{margin-left:auto}.top .title{font-size:clamp(28px,3vw,40px)}.top{display:flex;align-items:center;gap:18px;margin-bottom:12px;padding:0 0 10px;border-bottom:3px solid #202020}.title{font-size:clamp(25px,4vw,38px);font-weight:900;white-space:nowrap}.sub{color:#444;font-size:13px}.btn{border:3px solid #202020;background:#d5d5d5;color:#171717;border-radius:6px;padding:10px 12px;font-weight:800;cursor:pointer;font-family:inherit}.btn.primary,.btn.danger{background:#d5d5d5;border-color:#202020;color:#171717}.grid{display:grid;grid-template-columns:1fr;gap:14px}.card{background:#e8e8e8;border:3px solid #202020;border-radius:6px;padding:12px;box-shadow:none}.label{font-size:13px;color:#333;text-transform:none;letter-spacing:0}.value{font-size:20px;font-weight:800;margin-top:4px;word-break:break-word}.online{color:#26713c}.offline{color:#a51d1d}.auth{margin-top:14px;border-color:#202020;background:#e8e8e8}.auth a{color:#315ca0}.actions{display:grid;grid-template-columns:1fr;gap:10px;margin-top:10px}section{margin-top:12px}.section h2{font-size:18px;margin:0 0 10px}.chat{height:360px;overflow:auto;background:#d5d5d5;border:3px solid #202020;border-radius:6px;padding:10px}.line{padding:8px 4px;border-bottom:1px solid #aaa;white-space:pre-wrap;overflow-wrap:anywhere}.time{color:#555;font-size:12px}.name{font-weight:800;color:#315ca0}.forms{display:grid;grid-template-columns:1fr auto;gap:8px}.forms input,.forms textarea{width:100%;background:#d5d5d5;color:#171717;border:3px solid #202020;border-radius:6px;padding:10px;font:inherit}.forms input::placeholder{color:#333;opacity:1}.events{max-height:220px;overflow:auto}.event{padding:7px 0;border-bottom:1px solid #bbb;font-size:13px}.event.error{color:#a51d1d}.event.success{color:#26713c}.event.auth{color:#775b00}.logout{margin-left:auto}.toast{position:fixed;left:50%;bottom:20px;transform:translateX(-50%);background:#e8e8e8;border:3px solid #202020;border-radius:6px;padding:12px 16px;display:none;max-width:90%;z-index:10}.hidden{display:none!important}
.dashboard-tabs{display:flex;gap:8px;flex-wrap:wrap;margin:0 0 16px;padding:0 0 12px;border-bottom:3px solid #202020}
.dashboard-tabs a{display:block;padding:9px 13px;border:3px solid #202020;border-radius:6px;background:#d5d5d5;color:#171717;text-decoration:none;font-weight:900}
.dashboard-tabs a:active{background:#c4c4c4}
.wrap{display:grid;grid-template-columns:minmax(190px,230px) minmax(210px,.85fr) minmax(300px,1.35fr);grid-template-areas:"head head head" "tabs tabs tabs" "stats control chat" "stats money chat" "stats command events" "foot foot foot";align-items:start;gap:14px;max-width:1440px}
.wrap>.top{grid-area:head;margin:0}
.wrap>.dashboard-tabs{grid-area:tabs}
.wrap>.grid{grid-area:stats;grid-template-columns:1fr;gap:12px;margin:0}
.wrap>#auth{grid-column:1/-1}
.wrap>#control{grid-area:control;margin:0}
.wrap>#chatPanel{grid-area:chat;margin:0}
.wrap>#moneyPanel{grid-area:money;margin:0}
.wrap>#commandPanel{grid-area:command;margin:0}
.wrap>#eventsPanel{grid-area:events;margin:0}
.wrap>.logout{grid-area:foot}
#control .actions{grid-template-columns:1fr}
#chatPanel .chat{height:390px}
#moneyPanel .forms,#commandPanel .forms{grid-template-columns:minmax(0,1fr) auto}
.dashboard-tabs a:focus-visible{outline:3px solid #4779c7;outline-offset:2px}
@media(max-width:900px){.wrap{grid-template-columns:minmax(150px,.7fr) minmax(0,1.3fr);grid-template-areas:"head head" "tabs tabs" "stats control" "chat chat" "money command" "events events" "foot foot"}#chatPanel .chat{height:300px}}
@media(max-width:560px){.wrap{display:grid;grid-template-columns:minmax(0,1fr);grid-template-areas:"head" "tabs" "stats" "control" "chat" "money" "command" "events" "foot";padding:10px}.top{align-items:flex-start}.logout-button{margin-left:auto}.dashboard-tabs{gap:6px}.dashboard-tabs a{padding:8px 10px;font-size:14px}.wrap>.grid{grid-template-columns:repeat(2,minmax(0,1fr))}.wrap>.grid>.card{min-width:0}.value{font-size:18px}#control .actions{grid-template-columns:repeat(2,minmax(0,1fr))}#chatPanel .chat{height:260px}.forms{grid-template-columns:minmax(0,1fr) auto!important}.forms input,.forms button{min-width:0;font-size:15px;padding:9px 7px}}
@media(max-width:800px){.actions{grid-template-columns:repeat(2,1fr)}}@media(max-width:520px){.wrap{padding:10px}.top{gap:8px;flex-wrap:wrap}.title{font-size:25px}.forms{grid-template-columns:1fr}.chat{height:300px}}

/* Stabile, responsive Kartenansicht: keine JavaScript-Umordnung erforderlich. */
html,body{min-height:100%;height:auto;overflow-x:hidden;overflow-y:auto}
body{position:static;background:linear-gradient(125deg,rgba(48,120,255,.18),rgba(255,55,105,.18));}
.wrap{display:grid;position:static;width:min(1440px,100%);max-width:1440px;height:auto;min-height:100vh;max-height:none;margin:0 auto;padding:12px;overflow:visible;grid-template-columns:minmax(160px,220px) minmax(0,1fr) minmax(0,1.25fr);grid-template-areas:"head head head" "tabs tabs tabs" "stats control chat" "stats money chat" "stats command events" "foot foot foot";align-items:start;gap:12px}
.wrap>.top{grid-area:head;display:flex;flex-wrap:wrap;align-items:center;gap:12px;min-width:0}
.wrap>.dashboard-tabs{grid-area:tabs;display:flex;flex-wrap:wrap;gap:8px}
.wrap>.grid{grid-area:stats;display:grid;grid-template-columns:1fr;min-width:0}
.wrap>#control{grid-area:control;display:block!important}
.wrap>#chatPanel{grid-area:chat;display:block!important}
.wrap>#moneyPanel{grid-area:money;display:block!important}
.wrap>#commandPanel{grid-area:command;display:block!important}
.wrap>#eventsPanel{grid-area:events;display:block!important}
.wrap>.logout{grid-area:foot}
#control .actions{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px}
#control .actions .btn{min-width:0;min-height:44px;white-space:normal;overflow-wrap:anywhere}
#chatPanel .chat{height:clamp(240px,48vh,420px);max-height:none}
.forms{grid-template-columns:minmax(0,1fr) auto}
#logoutForm{display:flex;align-items:center;margin-left:auto;position:relative;z-index:5}
#logoutForm button{min-height:44px;touch-action:manipulation;cursor:pointer}
.fr-app-layout,.fr-tabs,.fr-panel,.fr-main-panels,.fr-sidebar{display:none!important}
@media(max-width:1000px){.wrap{grid-template-columns:minmax(130px,.7fr) minmax(0,1.3fr);grid-template-areas:"head head" "tabs tabs" "stats control" "chat chat" "money command" "events events" "foot foot"}}
@media(max-width:620px){.wrap{display:grid;grid-template-columns:minmax(0,1fr);grid-template-areas:"head" "tabs" "stats" "control" "chat" "money" "command" "events" "foot";padding:8px;gap:8px}.wrap>.top{align-items:center}.wrap>.grid{grid-template-columns:repeat(2,minmax(0,1fr))}#control .actions{grid-template-columns:repeat(2,minmax(0,1fr))}.forms{grid-template-columns:minmax(0,1fr) auto!important}.forms input,.forms button{min-width:0;font-size:15px;padding:9px 7px}}
</style>
// ============================================================
// HTTP API
// ============================================================
async function handleRequest(req, res) {
// Sicherheitsheader für alle Antworten; Login und Dashboard sollen nicht in fremde Frames eingebettet werden.
res.setHeader("X-Content-Type-Options", "nosniff");
res.setHeader("X-Frame-Options", "DENY");
res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
res.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
res.setHeader("X-Permitted-Cross-Domain-Policies", "none");
res.setHeader("Cross-Origin-Opener-Policy", "same-origin");
res.setHeader("Origin-Agent-Cluster", "?1");
if (isSecureRequest(req)) res.setHeader("Strict-Transport-Security", "max-age=31536000");
res.setHeader("Cache-Control", "no-store");
const url = String(req.url || "/").split("?")[0];
if (req.method === "GET" && (url === "/manifest.webmanifest" || url === "/app-icon.svg" || url === "/brand-logo.svg" || url === "/sw.js")) {
  const assets = {
    "/manifest.webmanifest": { file: "manifest.webmanifest", type: "application/manifest+json; charset=utf-8", cache: "no-cache" },
    "/app-icon.svg": { file: "app-icon.svg", type: "image/svg+xml; charset=utf-8", cache: "public, max-age=3600" },
    "/brand-logo.svg": { file: "brand-logo.svg", type: "image/svg+xml; charset=utf-8", cache: "no-cache" },
    "/sw.js": { file: "sw.js", type: "application/javascript; charset=utf-8", cache: "no-cache" }
  };
  const asset = assets[url];
  try {
    const body = fs.readFileSync(path.join(__dirname, asset.file));
    res.writeHead(200, { "Content-Type": asset.type, "Cache-Control": asset.cache, "X-Content-Type-Options": "nosniff", "Service-Worker-Allowed": "/" });
    return res.end(body);
  } catch (err) {
    return json(res, 404, { ok: false, error: "App-Datei fehlt." });
  }
}
if (req.method === "GET" && url === "/health") {
return json(res, 200, { ok: true, minecraftOnline: mcOnline });
}
if (req.method === "GET" && (url === "/login" || url === "/login/")) {
if (getSession(req)) {
res.writeHead(302, { Location: "/" });
return res.end();
}
return html(res, 200, LOGIN_HTML);
}
if (req.method === "GET" && (url === "/dashboard" || url === "/dashboard/")) {
if (!getSession(req)) {
res.writeHead(302, { Location: "/login?next=%2Fdashboard" });
return res.end();
}
return html(res, 200, DASHBOARD_HTML);
}
if (req.method === "GET" && url === "/") {
if (!getSession(req)) {
res.writeHead(302, { Location: "/login" });
return res.end();
}
return html(res, 200, DASHBOARD_HTML);
}
if (req.method === "POST" && url === "/api/login") {
if (loginRateLimited(req)) return json(res, 429, { ok: false, error: "Zu viele Login-Versuche. Warte eine Minute." });
try {
const body = await readJson(req);
if (!constantTimeEqual(body.password || "", WEB_PASSWORD)) return json(res, 401, { ok: false, error: "Falsches Passwort." });
const token = crypto.randomBytes(32).toString("hex");
sessions.set(token, { createdAt: Date.now() });
res.writeHead(200, {
"Content-Type": "application/json; charset=utf-8",
"Cache-Control": "no-store",
"Set-Cookie": `frozenrun_session=${encodeURIComponent(token)}; HttpOnly${isSecureRequest(req) ? "; Secure" : ""}; SameSite=Strict; Path=/; Max-Age=${
Math.floor(SESSION_TTL_MS / 1000)}`
});
return res.end(JSON.stringify({ ok: true }));
} catch (err) {
return json(res, 400, { ok: false, error: err.message });
}
}
if (req.method === "GET" && url === "/api/status") {
if (!requireSession(req, res)) return;
return json(res, 200, publicStatus());
}
if (req.method === "GET" && url === "/api/view") {
if (!requireSession(req, res)) return;
return json(res, 200, {
ok: true,
online: mcOnline,
position: { ...aktuelleKoordinaten },
rotation: { ...aktuelleRotation },
username: MC_USERNAME,
world: getWorldView(),
timestamp: Date.now()
});
}
if ((req.method === "GET" && url.split("?")[0] === "/logout") || (req.method === "POST" && ["/api/logout", "/logout"].includes(url.split("?")[0]))) {
const token = getCookies(req).frozenrun_session;
if (token) sessions.delete(token);
const secureCookie = isSecureRequest(req) ? "; Secure" : "";
res.writeHead(303, {
"Location": "/login?loggedout=1",
"Set-Cookie": `frozenrun_session=; HttpOnly${secureCookie}; SameSite=Strict; Path=/; Max-Age=0`,
"Cache-Control": "no-store, max-age=0",
"Pragma": "no-cache",
"Content-Length": "0"
});
return res.end();
}
if (req.method !== "POST") return json(res, 405, { ok: false, error: "Methode nicht erlaubt." });
// CSRF-Schutz: Browser-Steuerungsanfragen muessen dieselbe Origin verwenden.
if (url.startsWith("/api/minecraft/") && req.headers.origin) {
  try { if (new URL(req.headers.origin).host !== String(req.headers.host || "")) return json(res, 403, { ok: false, error: "Ungueltige Anfragequelle." }); }
  catch { return json(res, 403, { ok: false, error: "Ungueltige Anfragequelle." }); }
}
if (!requireSession(req, res)) return;
try {
if (url === "/api/minecraft/start") {
minecraftStarten();
return json(res, 200, publicStatus());
}
if (url === "/api/minecraft/stop") {
minecraftStoppen();
return json(res, 200, publicStatus());
}
if (url === "/api/minecraft/reconnect") {
minecraftNeuVerbinden();
return json(res, 200, publicStatus());
}
if (url === "/api/minecraft/home") {
await homeAfk();
return json(res, 200, publicStatus());
}
if (url === "/api/minecraft/run") {
laufenStarten();
return json(res, 200, publicStatus());
}
if (url === "/api/minecraft/stoprun") {
laufenStoppen();
return json(res, 200, publicStatus());
}
if (url === "/api/minecraft/chat") {
const body = await readJson(req);
await sendChatMessage(body.message);
return json(res, 200, publicStatus());
}
if (url === "/api/minecraft/command") {
const body = await readJson(req);
await sendCommand(body.command);
return json(res, 200, publicStatus());
}
if (url === "/api/minecraft/pay") {
const body = await readJson(req);
await geldSenden(body.amount);
return json(res, 200, publicStatus());
}
return json(res, 404, { ok: false, error: "Nicht gefunden." });
} catch (err) {
const message = err?.message || String(err);
letzterFehler = message;
addEvent(message, "error");
return json(res, 400, { ok: false, error: message });
}
}
const webServer = http.createServer((req, res) => {
handleRequest(req, res).catch(err => {
console.error("HTTP-Fehler:", err);
if (!res.headersSent) json(res, 500, { ok: false, error: "Interner Serverfehler." });
else res.end();
});
});
webServer.listen(PORT, HOST, () => {
addEvent(`Webserver läuft auf http://${HOST}:${PORT}`, "success");
addEvent("FrozenRun-Webserver gestartet.", "info");
});
// ============================================================
// Discord-Integration (alle Geheimnisse ausschließlich über Render-Env)
// ============================================================
function discordCanControl(interaction) {
  if (!interaction.inGuild()) return false;
  const member = interaction.member;
  const roles = member?.roles?.cache;
  const allowedRole = roles && [...DISCORD_ALLOWED_ROLE_IDS].some(id => roles.has(id));
  if (DISCORD_ALLOWED_USER_IDS.size || DISCORD_ALLOWED_ROLE_IDS.size) {
    return DISCORD_ALLOWED_USER_IDS.has(interaction.user.id) || Boolean(allowedRole);
  }
  return Boolean(interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild));
}
function discordStatusText() {
  return [
    `Minecraft: **${mcOnline ? "Online" : connecting ? "Verbindet…" : "Offline"}**`,
    `Spieler: ${MC_USERNAME}`,
    `Server: ${MC_HOST}:${MC_PORT}`,
    `Koordinaten: ${formatKoordinaten()}`,
    `Uptime: ${formatLiveUptime()}`,
    `Laufen: ${laufenAktiv ? "aktiv" : "aus"}`,
    letzterFehler ? `Letzter Fehler: ${String(letzterFehler).slice(0, 300)}` : ""
  ].filter(Boolean).join("\n");
}
async function discordGetChannel(channelId) {
  if (!discordClient || !discordReady || !channelId) return null;
  try {
    const channel = await discordClient.channels.fetch(channelId);
    return channel && channel.isTextBased() && typeof channel.send === "function" ? channel : null;
  } catch (err) {
    console.error("Discord-Kanal nicht erreichbar:", err?.message || err);
    return null;
  }
}
async function sendDiscordLog(message, type = "info") {
  if (!DISCORD_LOG_CHANNEL_ID || !discordReady) return;
  const channel = await discordGetChannel(DISCORD_LOG_CHANNEL_ID);
  if (!channel) return;
  const prefix = type === "error" ? "❌" : type === "warning" ? "⚠️" : type === "success" ? "✅" : "ℹ️";
  try { await channel.send({ content: `${prefix} ${String(message).slice(0, 1800)}`, allowedMentions: { parse: [] } }); }
  catch (err) { console.error("Discord-Log konnte nicht gesendet werden:", err?.message || err); }
}
async function sendDiscordChat(message) {
  if (!DISCORD_CHAT_CHANNEL_ID || !discordReady) return;
  const channel = await discordGetChannel(DISCORD_CHAT_CHANNEL_ID);
  if (!channel) return;
  try { await channel.send({ content: String(message).slice(0, 1900), allowedMentions: { parse: [] } }); }
  catch (err) { console.error("Minecraft-Chat konnte nicht an Discord gesendet werden:", err?.message || err); }
}
function buildDiscordCommands() {
  return [
    new SlashCommandBuilder().setName("dashboard").setDescription("Zeigt alle Bot- und Minecraft-Statuswerte in Discord"),
    new SlashCommandBuilder().setName("bot-status").setDescription("Zeigt Minecraft-Status und Koordinaten"),
    new SlashCommandBuilder().setName("bot-start").setDescription("Startet den Minecraft-Bot"),
    new SlashCommandBuilder().setName("bot-stop").setDescription("Stoppt den Minecraft-Bot"),
    new SlashCommandBuilder().setName("bot-reconnect").setDescription("Verbindet den Minecraft-Bot neu"),
    new SlashCommandBuilder().setName("bot-home").setDescription("Führt /home afk aus"),
    new SlashCommandBuilder().setName("bot-run").setDescription("Startet die Lauf-Funktion"),
    new SlashCommandBuilder().setName("bot-stoprun").setDescription("Stoppt die Lauf-Funktion"),
    new SlashCommandBuilder().setName("mc-chat").setDescription("Sendet eine Nachricht in den Minecraft-Chat")
      .addStringOption(o => o.setName("nachricht").setDescription("Nachricht für Minecraft").setRequired(true).setMaxLength(256)),
    new SlashCommandBuilder().setName("mc-command").setDescription("Führt einen Minecraft-Befehl aus")
      .addStringOption(o => o.setName("befehl").setDescription("Befehl, mit oder ohne führenden Schrägstrich").setRequired(true).setMaxLength(256))
  ].map(command => command.toJSON());
}
function buildDiscordDashboardComponents() {
  const button = (customId, label, style, emoji) =>
    new ButtonBuilder().setCustomId(customId).setLabel(label).setStyle(style).setEmoji(emoji);
  return [
    new ActionRowBuilder().addComponents(
      button("fr_dashboard_start", "Ein", ButtonStyle.Success, "▶️"),
      button("fr_dashboard_stop", "Aus", ButtonStyle.Danger, "⏹️"),
      button("fr_dashboard_reconnect", "Neu verbinden", ButtonStyle.Secondary, "🔄"),
      button("fr_dashboard_home", "Home AFK", ButtonStyle.Primary, "🏠"),
      button("fr_dashboard_run", "Laufen", ButtonStyle.Success, "🏃")
    ),
    new ActionRowBuilder().addComponents(
      button("fr_dashboard_stoprun", "Laufen stoppen", ButtonStyle.Danger, "🛑")
    )
  ];
}
function buildDiscordDashboardText() {
  return [
    "📊 **FrozenRun – Status-Dashboard**",
    "",
    `🤖 **Minecraft:** ${mcOnline ? "🟢 Online" : connecting ? "🟡 Verbindet…" : "🔴 Offline"}`,
    `👤 **Spielername:** ${MC_USERNAME}`,
    `🌐 **Server:** ${MC_HOST}:${MC_PORT}`,
    `📍 **Koordinaten:** ${formatKoordinaten()}`,
    `⏱️ **Uptime:** ${formatLiveUptime()}`,
    `🏃 **Laufen:** ${laufenAktiv ? "🟢 Aktiv" : "⚪ Aus"}`,
    `🌍 **Webportal:** Version ${APP_VERSION}`,
    `💬 **Discord-Anbindung:** ${discordReady ? "🟢 Verbunden" : "🔴 Nicht verbunden"}`,
    letzterFehler ? `⚠️ **Letzter Fehler:** ${String(letzterFehler).slice(0, 400)}` : "✅ **Letzter Fehler:** keiner bekannt",
    "",
    `Aktualisiert: <t:${Math.floor(Date.now() / 1000)}:R>`,
    "",
    "**Steuerung** · Nutze die Knöpfe unter dieser Nachricht."
  ].join("\n");
}
async function handleDiscordInteraction(interaction) {
  if (interaction.isButton()) {
    if (!discordCanControl(interaction)) {
      await interaction.reply({ content: "Du darfst den Minecraft-Bot nicht über Discord steuern.", ephemeral: true });
      return;
    }
    try {
      switch (interaction.customId) {
        case "fr_dashboard_start": minecraftStarten(); break;
        case "fr_dashboard_stop": minecraftStoppen(); break;
        case "fr_dashboard_reconnect": minecraftNeuVerbinden(); break;
        case "fr_dashboard_home": await homeAfk(); break;
        case "fr_dashboard_run": laufenStarten(); break;
        case "fr_dashboard_stoprun": laufenStoppen(); break;
        default: return;
      }
      await interaction.update({ content: buildDiscordDashboardText(), components: buildDiscordDashboardComponents(), allowedMentions: { parse: [] } });
    } catch (err) {
      const message = String(err?.message || err).slice(0, 1000);
      if (interaction.deferred || interaction.replied) await interaction.followUp({ content: "Aktion fehlgeschlagen: " + message, ephemeral: true }).catch(() => {});
      else await interaction.reply({ content: "Aktion fehlgeschlagen: " + message, ephemeral: true }).catch(() => {});
      await sendDiscordLog("Dashboard-Schaltfläche: " + message, "error");
    }
    return;
  }
  if (!interaction.isChatInputCommand()) return;
  if (!discordCanControl(interaction)) {
    await interaction.reply({ content: "Du darfst den Minecraft-Bot nicht über Discord steuern. Bitte konfiguriere DISCORD_ALLOWED_USER_IDS / DISCORD_ALLOWED_ROLE_IDS oder gib Manage Server.", ephemeral: true });
    return;
  }
  const command = interaction.commandName;
  try {
    if (command === "dashboard") {
      await interaction.reply({
        content: buildDiscordDashboardText(),
        components: buildDiscordDashboardComponents(),
        ephemeral: true,
        allowedMentions: { parse: [] }
      });
    } else if (command === "bot-status") {
      await interaction.reply({ content: discordStatusText(), ephemeral: true });
    } else if (command === "bot-start") {
      minecraftStarten();
      await interaction.reply({ content: "Minecraft-Bot wird gestartet.\n" + discordStatusText(), ephemeral: true });
    } else if (command === "bot-stop") {
      minecraftStoppen();
      await interaction.reply({ content: "Minecraft-Bot wurde gestoppt.", ephemeral: true });
    } else if (command === "bot-reconnect") {
      minecraftNeuVerbinden();
      await interaction.reply({ content: "Neuverbindung wurde gestartet.", ephemeral: true });
    } else if (command === "bot-home") {
      await homeAfk();
      await interaction.reply({ content: "/home afk wurde ausgeführt.", ephemeral: true });
    } else if (command === "bot-run") {
      laufenStarten();
      await interaction.reply({ content: "Laufen wurde gestartet.", ephemeral: true });
    } else if (command === "bot-stoprun") {
      laufenStoppen();
      await interaction.reply({ content: "Laufen wurde gestoppt.", ephemeral: true });
    } else if (command === "mc-chat") {
      const text = interaction.options.getString("nachricht", true);
      await sendChatMessage(text);
      await interaction.reply({ content: "Nachricht an Minecraft gesendet.", ephemeral: true });
    } else if (command === "mc-command") {
      const text = interaction.options.getString("befehl", true);
      const output = await sendCommand(text);
      await interaction.reply({ content: `Befehl ausgeführt.${output ? "\n" + String(output).slice(0, 1200) : ""}`, ephemeral: true });
    }
  } catch (err) {
    const message = err?.message || String(err);
    await sendDiscordLog(`Discord-Befehl /${command}: ${message}`, "error");
    const response = { content: `Fehler: ${message.slice(0, 1500)}`, ephemeral: true };
    if (interaction.replied || interaction.deferred) await interaction.followUp(response).catch(() => {});
    else await interaction.reply(response).catch(() => {});
  }
}
async function startDiscordIntegration() {
  if (!DISCORD_TOKEN) {
    addEvent("Discord ist nicht aktiviert (DISCORD_TOKEN fehlt); die Webseite läuft normal weiter.", "info");
    return;
  }
  if (!DISCORD_CLIENT_ID) {
    addEvent("Discord nicht gestartet: DISCORD_CLIENT_ID fehlt.", "error");
    return;
  }
  try {
    discordClient = new DiscordClient({
      intents: [
        GatewayIntentBits.Guilds,
        ...(DISCORD_CHAT_CHANNEL_ID ? [GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent] : [])
      ]
    });
    discordClient.once(Events.ClientReady, async client => {
      discordReady = true;
      addEvent(`Discord verbunden als ${client.user.tag}.`, "success");
      try {
        const rest = new REST({ version: "10" }).setToken(DISCORD_TOKEN);
        const commands = buildDiscordCommands();
        const route = DISCORD_GUILD_ID
          ? Routes.applicationGuildCommands(DISCORD_CLIENT_ID, DISCORD_GUILD_ID)
          : Routes.applicationCommands(DISCORD_CLIENT_ID);
        await rest.put(route, { body: commands });
        addEvent(`Discord-Slash-Befehle registriert (${commands.length}).`, "success");
      } catch (err) {
        addEvent(`Discord-Slash-Befehle konnten nicht registriert werden: ${err?.message || err}`, "error");
      }
      if (DISCORD_CHAT_CHANNEL_ID) {
        discordClient.on(Events.MessageCreate, async message => {
          if (message.author.bot || message.channelId !== DISCORD_CHAT_CHANNEL_ID) return;
          const text = sanitizeChatMessage(message.content);
          if (!text || text.startsWith("/") || text.length > 256) return;
          const now = Date.now();
          if (now - discordChatRelayLastAt < 700) return;
          discordChatRelayLastAt = now;
          try {
            await sendChatMessage(`[Discord] ${message.member?.displayName || message.author.username}: ${text}`.slice(0, 256));
          } catch (err) {
            await message.reply({ content: `Minecraft-Chat nicht gesendet: ${String(err?.message || err).slice(0, 500)}`, allowedMentions: { parse: [] } }).catch(() => {});
          }
        });
      }
      if (discordClient.user) {
        discordClient.user.setActivity("Minecraft-Status", { type: ActivityType.Watching });
      }
      discordStatusTimer = setInterval(() => {
        const status = `${mcOnline}|${connecting}|${formatKoordinaten()}|${laufenAktiv}`;
        if (status === discordLastStatus) return;
        discordLastStatus = status;
        if (discordClient?.user) {
          discordClient.user.setPresence({
            activities: [{ name: `MC: ${mcOnline ? "Online" : connecting ? "Startet" : "Offline"} · ${formatKoordinaten()}`, type: ActivityType.Watching }],
            status: mcOnline ? "online" : "idle"
          });
        }
      }, 15000);
      discordStatusTimer.unref?.();
    });
    discordClient.on(Events.InteractionCreate, interaction => {
      void handleDiscordInteraction(interaction).catch(err => console.error("Discord-Interaction-Fehler:", err));
    });
    discordClient.on(Events.Error, err => {
      console.error("Discord-Client-Fehler:", err?.message || err);
    });
    await discordClient.login(DISCORD_TOKEN);
  } catch (err) {
    discordReady = false;
    addEvent(`Discord-Start fehlgeschlagen: ${err?.message || err}`, "error");
  }
}
void startDiscordIntegration();

// ============================================================
// Graceful shutdown
// ============================================================
function shutdown(signal) {
addEvent(`${signal}: FrozenRun wird beendet.`, "warning");
minecraftStoppen();
webServer.close(() => process.exit(0));
setTimeout(() => process.exit(0), 5000).unref();
}
process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
process.on("uncaughtException", err => {
letzterFehler = err?.message || String(err);
console.error("UNCAUGHT EXCEPTION:", err);
});
process.on("unhandledRejection", err => {
letzterFehler = err?.message || String(err);
console.error("UNHANDLED REJECTION:", err);
});
// Uptime und Sessions werden regelmäßig aufgeräumt.
setInterval(() => {
for (const [token, session] of sessions) {
if (Date.now() - session.createdAt > SESSION_TTL_MS) sessions.delete(token);
}
for (const [ip, item] of loginAttempts) {
if (Date.now() - item.since > 10 * 60_000) loginAttempts.delete(ip);
}
}, 60_000).unref();
async function homeAfk() {
if (!mcOnline) throw new Error("Minecraft ist offline.");
await minecraftCommand("/home afk");
addChat("FrozenRun", "/home afk ausgeführt.", "system");

}