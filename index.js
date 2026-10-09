const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const bedrock = require("bedrock-protocol");
const { Authflow, Titles } = require("prismarine-auth");
const prismarineChunk = require("prismarine-chunk");
const prismarineRegistry = require("prismarine-registry");
const { Vec3 } = require("vec3");
// ============================================================
// FrozenRun – Web-Version ohne Discord
// ============================================================
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
"X-Content-Type-Options": "nosniff"
});
res.end(body);
}
function html(res, status, body) {
res.writeHead(status, {
"Content-Type": "text/html; charset=utf-8",
"Cache-Control": "no-store",
"X-Content-Type-Options": "nosniff"
});
res.end(body);
}
function getCookies(req) {
const result = {};
const raw = req.headers.cookie || "";
for (const part of raw.split(";")) {
const index = part.indexOf("=");
if (index === -1) continue;
const key = part.slice(0, index).trim();
const value = part.slice(index + 1).trim();
result[key] = decodeURIComponent(value);
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
<html lang="de"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-
scale=1"><title>Block Bande – Botportal</title>
<style>*{box-sizing:border-box}body{margin:0;min-height:100vh;background:#fff;color:#171717;font-family:"Comic Sans MS","Segoe Print",system-ui,sans-serif;display:grid;place-items:center;padding:20px}.card{width:min(620px,100%);min-height:340px;background:#e8e8e8;border:4px solid #202020;border-radius:7px;padding:34px 28px;box-shadow:none;position:relative}.logo{font-size:clamp(32px,7vw,54px);font-weight:900;line-height:1.05;text-align:center;margin:0}.brand-blue{color:#4779c7}.brand-red{color:#f04444}.portal{text-align:center;font-size:clamp(25px,5vw,40px);font-weight:900;margin:0 0 46px}.muted{color:#333;text-align:center;margin-bottom:22px}input,button{width:100%;min-height:50px;border-radius:6px;border:4px solid #202020;font-size:22px;font-family:inherit}input{display:block;max-width:270px;margin:0 auto 12px;background:#d5d5d5;color:#171717;padding:0 14px}input::placeholder{color:#171717;opacity:1}button{display:block;max-width:270px;margin:auto;background:#d5d5d5;color:#171717;font-weight:900;cursor:pointer}button:active{transform:translateY(1px)}#msg{margin-top:14px;text-align:center;color:#a51d1d;min-height:22px}.small{position:absolute;right:12px;bottom:8px;font-size:13px;color:#333;margin:0}
/* Korrektur: Kopfzeile oben, Seitenleiste und Inhalt darunter */
body{overflow:auto!important}
.wrap{display:flex!important;flex-direction:column!important;width:100%!important;max-width:1240px!important;height:auto!important;min-height:0!important;margin:0 auto!important;padding:8px!important;overflow:visible!important;box-sizing:border-box!important;gap:0!important}
.wrap>.top{order:0!important;display:flex!important;flex-direction:row!important;flex-wrap:nowrap!important;align-items:center!important;justify-content:space-between!important;width:100%!important;min-height:76px!important;box-sizing:border-box!important;border:3px solid #202020!important;border-radius:0!important;padding:4px 8px!important;background:#d3d3d3!important}
.top .title{flex:0 1 auto!important;white-space:nowrap!important;font-size:clamp(24px,3vw,38px)!important;padding:8px!important}
.top .sub{display:none!important}
.top #logout{order:3!important;grid-column:auto!important;flex:0 0 auto!important;margin:0 0 0 8px!important;white-space:nowrap!important}
.fr-tabs{order:2!important;display:flex!important;flex:1 1 auto!important;min-width:0!important;width:auto!important;justify-content:center!important;align-self:stretch!important}
.fr-tab{flex:1 1 0!important;min-width:0!important;white-space:normal!important;overflow-wrap:normal!important;padding:10px 8px!important;font-size:clamp(14px,1.7vw,22px)!important;border-radius:0!important}
.fr-app-layout{order:1!important;display:grid!important;grid-template-columns:minmax(200px,26%) minmax(0,1fr)!important;width:100%!important;height:auto!important;min-height:440px!important;margin-top:0!important;overflow:visible!important;box-sizing:border-box!important;border:3px solid #202020!important;border-top:0!important;border-radius:0!important;background:#d3d3d3!important}
.fr-sidebar,.fr-main-panels{min-width:0!important;min-height:440px!important;box-sizing:border-box!important}
.fr-sidebar{padding:12px!important}
.fr-sidebar .grid{display:flex!important;flex-direction:column!important;gap:0!important}
.fr-sidebar .grid>div{min-width:0!important;padding:7px 0!important;border:0!important;border-radius:0!important;background:transparent!important}
.fr-main-panels{height:auto!important;overflow:visible!important;padding:12px!important}
.fr-panel{display:none!important;height:auto!important;min-height:410px!important;overflow:visible!important}
.fr-panel.active{display:block!important}
.fr-control-area{height:auto!important;min-height:330px!important;padding:16px!important;align-items:flex-start!important}
.fr-control-card{height:auto!important;min-height:0!important;align-items:flex-start!important}
.fr-control-card .actions{display:grid!important;grid-template-columns:repeat(2,minmax(120px,180px))!important;justify-content:center!important;align-items:stretch!important;width:100%!important;max-width:420px!important;gap:12px!important;margin:8px auto!important}
.fr-control-card .btn{display:block!important;width:100%!important;max-width:none!important;min-width:0!important;min-height:48px!important;padding:8px!important;font-size:16px!important;line-height:1.25!important;white-space:normal!important;word-break:normal!important;overflow-wrap:anywhere!important;box-sizing:border-box!important}
.fr-command{margin-top:10px!important}
#fr-panel-chat .chat{height:340px!important;min-height:260px!important}
#fr-panel-screen .fr-viewer{height:340px!important;min-height:260px!important}
@media(max-width:720px){
 .wrap{padding:4px!important}
 .wrap>.top{flex-wrap:wrap!important;gap:4px!important;min-height:0!important}
 .top .title{width:100%!important;white-space:normal!important}
 .fr-tabs{order:2!important;flex:1 1 100%!important;width:100%!important;min-height:44px!important}
 .top #logout{order:3!important;margin:4px 8px 4px auto!important}
 .fr-app-layout{grid-template-columns:minmax(115px,30%) minmax(0,1fr)!important;min-height:400px!important}
 .fr-sidebar,.fr-main-panels{min-height:400px!important}
 .fr-main-panels{padding:6px!important}
 .fr-control-area{padding:4px!important}
 .fr-control-card .actions{grid-template-columns:minmax(0,1fr)!important;max-width:220px!important;gap:8px!important}
 .fr-control-card .btn{min-height:42px!important;font-size:14px!important}
 #fr-panel-chat .chat,#fr-panel-screen .fr-viewer{height:300px!important;min-height:220px!important}
}

</style></head><body><main class="card"><div class="logo"><span class="brand-blue">Block</span> <span class="brand-red">Bande</span></div><div class="portal">Botportal</div><form id="form"><input id="password" type="password" autocomplete="current-password" placeholder="Passwort" required><button style="position:absolute;left:-9999px;width:1px;height:1px;min-height:1px;padding:0;border:0" tabindex="-1" aria-hidden="true">Anmelden</button></form><div id="msg"></div><div class="small">Version 2.0</div></
main><script>
document.getElementById('form').addEventListener('submit',async e=>{e.preventDefault();const msg=document.getElementById(
'msg');msg.textContent='';try{const r=await fetch('/api/login',{method:'POST',headers:{'Content-Type':'application/json'},
body:JSON.stringify({password:document.getElementById('password').value})});const d=await r.json();if(!r.ok)throw new Error(
d.error||'Login fehlgeschlagen');location.href='/';}catch(err){msg.textContent=err.message;}});
</script></body></html>`;
const DASHBOARD_HTML = `<!doctype html>
<html lang="de"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-
scale=1"><title>Block Bande – Botportal</title>
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
/* Layout exakt nach der Zeichnung */
body{background:#fff;color:#171717}
.wrap{width:min(100%,1240px);padding:6px;margin:0 auto}
.top{display:grid;grid-template-columns:minmax(210px,1fr) auto;gap:0;align-items:stretch;margin:0;padding:0;border:3px solid #202020;border-radius:6px;background:#e8e8e8}
.top .title{font-size:clamp(25px,3.2vw,38px);padding:8px 12px;align-self:center}
.top #logout{grid-column:1/-1;justify-self:end;margin:4px;border:0;background:transparent;min-height:0;padding:4px 8px;font-size:13px}
.fr-tabs{grid-column:2;grid-row:1;display:flex;align-items:stretch;gap:0;margin:0;padding:0;border:0;min-width:0}
.fr-tab{font:inherit;font-size:clamp(16px,2.4vw,25px);padding:8px 12px;border:0;border-left:2px solid #202020;border-radius:0;background:#e8e8e8;color:#171717;white-space:nowrap;cursor:pointer}
.fr-tab.active{background:#858585}
.fr-app-layout{display:grid;grid-template-columns:minmax(185px,30%) minmax(0,1fr);gap:0;margin-top:0;border:3px solid #202020;border-top:0;border-radius:0 0 6px 6px;min-height:460px;background:#e8e8e8}
.fr-sidebar{border-right:2px solid #202020;padding:12px 14px;display:flex;flex-direction:column;min-width:0}
.fr-side-brand{font-size:clamp(23px,3vw,34px);font-weight:900;border-bottom:2px solid #202020;padding:0 0 12px;white-space:nowrap}
.fr-sidebar .grid{display:flex;flex-direction:column;gap:0;margin-top:8px}
.fr-sidebar .grid>div{background:transparent;border:0;border-radius:0;padding:7px 0;border-bottom:0}
.fr-sidebar .label{font-size:clamp(17px,2vw,24px);color:#171717}
.fr-sidebar .value{font-size:clamp(16px,2vw,22px);font-weight:500}
.fr-version{margin-top:auto;padding-top:18px;font-size:18px;font-weight:700}
.fr-main-panels{min-width:0;min-height:455px;padding:12px}
.fr-panel{display:none;min-height:425px;margin:0!important}
.fr-panel.active{display:block}
.fr-control-area{height:calc(100% - 62px);min-height:340px;display:flex;align-items:flex-start;justify-content:center;padding:20px}
.fr-control-card{width:100%;min-height:300px;border:0;background:transparent;display:flex;align-items:flex-start;justify-content:center}
.fr-control-card h2{display:none}
.fr-control-card .actions{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:14px;width:min(100%,520px);margin:8px auto}
.fr-control-card .btn{min-height:54px;font-size:18px}
.fr-command{margin:0!important;background:#d5d5d5;border:3px solid #202020;padding:0;border-radius:6px}
.fr-command .forms{grid-template-columns:minmax(0,1fr) 48px;gap:0}
.fr-command .forms input{min-height:44px;border:0;border-radius:0;background:transparent;font-size:21px;padding:5px 12px}
.fr-command .forms input::placeholder{color:#171717;opacity:1}
.fr-command .forms .btn{border:0;border-left:3px solid #202020;border-radius:0;background:transparent;min-height:44px;font-size:20px}
.fr-command .sub,.fr-note{display:none}
#fr-panel-chat .card.section{margin:0;border:0;padding:0;background:transparent}
#fr-panel-chat h2{display:none}
#fr-panel-chat .chat{height:420px;min-height:300px;background:#d5d5d5;border:3px solid #202020;border-radius:4px}
#fr-panel-chat .forms{grid-template-columns:minmax(0,1fr) auto}
#fr-panel-screen .fr-viewer{height:420px;min-height:300px;width:100%;border:3px solid #202020;border-radius:4px;background:#d5d5d5;overflow:hidden}
#fr-viewCanvas{display:block;width:100%;height:100%}
#moneyPanel,#eventsPanel{display:none!important}
@media(max-width:720px){
 .wrap{padding:4px}
 .top{grid-template-columns:1fr}
 .top .title{grid-column:1;grid-row:1;padding:7px 9px}
 .fr-tabs{grid-column:1;grid-row:2;border-top:2px solid #202020}
 .fr-tab{flex:1;padding:8px 4px;font-size:clamp(14px,3.6vw,20px)}
 .top #logout{grid-column:1;grid-row:3}
 .fr-app-layout{grid-template-columns:30% minmax(0,1fr);min-height:420px}
 .fr-sidebar{padding:8px 7px}
 .fr-side-brand{font-size:clamp(16px,4vw,25px);white-space:normal;line-height:1.1}
 .fr-sidebar .label{font-size:clamp(14px,3.4vw,18px)}
 .fr-sidebar .value{font-size:clamp(13px,3.2vw,17px)}
 .fr-version{font-size:14px}
 .fr-main-panels{padding:8px;min-height:415px}
 .fr-panel{min-height:390px}
 .fr-control-area{min-height:310px;padding:5px}
 .fr-control-card .actions{grid-template-columns:1fr;gap:8px}
 .fr-control-card .btn{min-height:42px;font-size:15px;padding:5px}
 #fr-panel-chat .chat,#fr-panel-screen .fr-viewer{height:380px;min-height:250px}
}

/* Feinschliff nach dem Foto: eine Marke, kompakt, eckig, ohne leeren Scrollbereich */
body{background:#d3d3d3!important;overflow:hidden!important}
.wrap{width:100%!important;max-width:none!important;height:100vh;height:100dvh;min-height:0!important;margin:0!important;padding:6px!important;box-sizing:border-box;display:grid!important;grid-template-columns:minmax(0,1fr)!important;grid-template-rows:auto minmax(0,1fr)!important;grid-template-areas:none!important;gap:0!important;overflow:hidden!important}
.wrap>.top{grid-area:auto!important;min-width:0;border-radius:0!important;background:#d3d3d3!important;display:flex!important;flex-wrap:nowrap!important;align-items:center!important;justify-content:space-between!important}
.top .title{padding:7px 10px!important;white-space:nowrap}
.top #logout{grid-column:auto!important;margin-left:8px!important}
.fr-tabs{flex:1;min-width:0;justify-content:flex-end}
.fr-tab{border-radius:0!important;padding:7px 10px!important}
.fr-app-layout{height:100%;min-height:0!important;grid-template-columns:minmax(145px,25%) minmax(0,1fr)!important;border-radius:0!important;background:#d3d3d3!important;overflow:hidden!important}
.fr-sidebar,.fr-main-panels,.fr-panel{min-height:0!important;min-width:0!important}
.fr-sidebar{background:#d3d3d3!important}
.fr-sidebar .grid>div,.fr-sidebar .card,.card,.btn,.forms input,.forms textarea,.chat,.fr-command,.fr-viewer{border-radius:0!important}
.fr-main-panels{height:100%;padding:8px!important;overflow:hidden!important}
.fr-panel.active{height:100%;overflow:hidden!important}
.fr-control-panel,.fr-control-area{min-height:0!important}
.fr-control-area{height:calc(100% - 52px)!important;min-height:0!important;padding:10px!important;align-items:center!important}
.fr-control-card{min-height:0!important;height:100%;align-items:center!important}
.fr-control-card .actions{width:100%!important;max-width:380px!important;grid-template-columns:repeat(2,minmax(0,150px))!important;justify-content:center!important;gap:10px!important}
.fr-control-card .btn{width:100%!important;max-width:150px!important;min-height:42px!important;padding:6px 8px!important;font-size:16px!important;white-space:normal}
.fr-command{flex-shrink:0}
#fr-panel-chat .chat{height:calc(100% - 52px)!important;min-height:0!important}
#fr-panel-screen .fr-viewer{height:100%!important;min-height:0!important}
#fr-viewCanvas{height:100%!important}
.fr-version{padding-top:8px!important}
@media(max-width:720px){
 .wrap{padding:4px!important;grid-template-rows:auto minmax(0,1fr)!important}
 .top{flex-wrap:wrap!important}
 .top .title{font-size:23px!important}
 .fr-tabs{flex-basis:100%;width:100%;order:2;border-top:2px solid #202020}
 .top #logout{margin-left:auto!important}
 .fr-app-layout{grid-template-columns:minmax(105px,29%) minmax(0,1fr)!important}
 .fr-sidebar{padding:7px 6px!important}
 .fr-sidebar .label{font-size:14px!important}
 .fr-sidebar .value{font-size:13px!important}
 .fr-version{font-size:12px!important}
 .fr-main-panels{padding:6px!important}
 .fr-control-area{padding:3px!important}
 .fr-control-card .actions{grid-template-columns:minmax(0,135px)!important;gap:8px!important}
 .fr-control-card .btn{max-width:135px!important;min-height:38px!important;font-size:14px!important}
 #fr-panel-chat .chat{height:calc(100% - 52px)!important}
}
/* Stabiler Header und iPad-Layout: feste Bereiche statt konkurrierender alter Regeln */
.wrap{display:flex!important;flex-direction:column!important;width:100%!important;max-width:none!important;height:auto!important;min-height:100dvh!important;margin:0!important;padding:0!important;gap:0!important;overflow:visible!important;box-sizing:border-box!important}
.wrap>.top{display:grid!important;grid-template-columns:max-content minmax(0,1fr) max-content!important;grid-template-rows:auto!important;align-items:stretch!important;gap:0!important;flex:0 0 auto!important;width:100%!important;min-width:0!important;overflow:visible!important;border:3px solid #202020!important;border-radius:0!important;box-sizing:border-box!important}
.wrap>.top>div:first-child{display:flex!important;align-items:center!important;min-width:0!important}
.wrap>.top .title{font-size:clamp(22px,3vw,36px)!important;white-space:nowrap!important;padding:8px 12px!important}
.wrap>.top .fr-tabs{grid-column:2!important;grid-row:1!important;display:flex!important;flex:initial!important;flex-basis:auto!important;width:auto!important;min-width:0!important;min-height:0!important;align-self:stretch!important;justify-content:stretch!important;border:0!important;border-left:2px solid #202020!important;overflow:visible!important}
.wrap>.top .fr-tab{flex:1 1 0!important;min-width:0!important;padding:10px 6px!important;font-size:clamp(14px,1.8vw,22px)!important;white-space:normal!important;border-left:1px solid #202020!important;border-right:0!important}
.wrap>.top #logout{grid-column:3!important;grid-row:1!important;align-self:center!important;justify-self:end!important;margin:4px!important;padding:8px 10px!important;white-space:nowrap!important}
.fr-app-layout{order:1!important;display:grid!important;grid-template-columns:minmax(170px,25%) minmax(0,1fr)!important;flex:1 0 auto!important;width:100%!important;height:auto!important;min-height:calc(100dvh - 64px)!important;margin:0!important;gap:0!important;border:3px solid #202020!important;border-top:0!important;overflow:visible!important;box-sizing:border-box!important}
.fr-sidebar{min-width:0!important;overflow-wrap:anywhere!important}
.fr-sidebar .grid{display:flex!important;flex-direction:column!important;grid-template-columns:none!important}
.fr-sidebar .grid>div{min-width:0!important;border:0!important;padding:9px 0!important}
.fr-main-panels{min-width:0!important;min-height:0!important;height:auto!important;overflow:visible!important;padding:12px!important}
.fr-panel{min-height:0!important}
.fr-panel.active{height:auto!important;min-height:0!important;overflow:visible!important}
.fr-control-area{height:auto!important;min-height:300px!important;padding:12px!important;align-items:center!important}
.fr-control-card{width:100%!important;height:auto!important;min-height:280px!important;align-items:center!important}
.fr-control-card .actions{display:grid!important;grid-template-columns:repeat(2,minmax(0,180px))!important;justify-content:center!important;align-content:center!important;gap:12px!important;width:100%!important;max-width:400px!important;margin:auto!important}
.fr-control-card .btn{width:100%!important;max-width:none!important;min-width:0!important;min-height:48px!important;padding:8px!important;font-size:clamp(14px,1.6vw,18px)!important;white-space:normal!important;overflow-wrap:anywhere!important;line-height:1.25!important}
.fr-command{width:100%!important;box-sizing:border-box!important}
#fr-panel-chat .chat{height: min(58dvh,520px)!important;min-height:280px!important}
#fr-panel-screen .fr-viewer{height:min(65dvh,620px)!important;min-height:320px!important}
@media(max-width:900px){
 .wrap>.top{grid-template-columns:minmax(0,1fr) max-content!important;grid-template-rows:auto auto!important}
 .wrap>.top>div:first-child{grid-column:1!important;grid-row:1!important}
 .wrap>.top #logout{grid-column:2!important;grid-row:1!important}
 .wrap>.top .fr-tabs{grid-column:1/-1!important;grid-row:2!important;min-height:46px!important;border-top:2px solid #202020!important;border-left:0!important}
 .wrap>.top .fr-tab{font-size:clamp(14px,2.5vw,19px)!important}
 .fr-app-layout{grid-template-columns:minmax(145px,30%) minmax(0,1fr)!important;min-height:calc(100dvh - 112px)!important}
 .fr-sidebar{padding:10px!important}
 .fr-sidebar .label{font-size:clamp(13px,2.2vw,17px)!important}
 .fr-sidebar .value{font-size:clamp(13px,2.1vw,17px)!important}
 .fr-main-panels{padding:8px!important}
}
@media(max-width:560px){
 .fr-app-layout{grid-template-columns:minmax(108px,30%) minmax(0,1fr)!important}
 .fr-sidebar{padding:7px 5px!important}
 .fr-sidebar .label{font-size:12px!important}
 .fr-sidebar .value{font-size:12px!important}
 .fr-version{font-size:12px!important}
 .fr-control-area{padding:4px!important}
 .fr-control-card .actions{grid-template-columns:minmax(0,1fr)!important;max-width:180px!important;gap:8px!important}
 .fr-control-card .btn{font-size:13px!important;min-height:40px!important}
 .fr-main-panels{padding:5px!important}
 #fr-panel-chat .chat{height:55dvh!important;min-height:230px!important}
}
/* Bildschirm-Tab: feste Viewer-Höhe verhindert Wachstum bei wiederholtem Öffnen */
.fr-app-layout{flex:1 0 auto!important;min-height:0!important}
.fr-main-panels{min-height:0!important;align-self:stretch!important}
.fr-panel.active{height:auto!important;min-height:0!important;overflow:visible!important}
#fr-panel-screen.fr-panel.active{display:block!important;height:auto!important;min-height:0!important}
#fr-panel-screen .fr-viewer{display:block!important;position:relative!important;width:100%!important;height:clamp(280px,62dvh,560px)!important;min-height:0!important;max-height:560px!important;box-sizing:border-box!important;overflow:hidden!important;flex:none!important}
#fr-panel-screen #fr-viewCanvas{display:block!important;width:100%!important;height:100%!important;max-height:100%!important}
.wrap>.top .fr-tabs{overflow:hidden!important}
.wrap>.top .fr-tab{flex:1 1 0!important;overflow:hidden!important;text-overflow:ellipsis!important;white-space:nowrap!important}
@media(max-width:900px){
 .wrap>.top{grid-template-columns:minmax(0,1fr) max-content!important}
 .wrap>.top .fr-tabs{grid-column:1/-1!important;grid-row:2!important;width:100%!important;min-width:0!important}
 .wrap>.top .fr-tab{font-size:clamp(13px,2.2vw,18px)!important;padding:9px 5px!important}
 .fr-app-layout{min-height:0!important}
 #fr-panel-screen .fr-viewer{height:clamp(240px,58dvh,480px)!important;max-height:480px!important}
}


/* FINAL FIX: Vollbild-Layout ohne kumulierendes Wachstum */
html,body{width:100%!important;height:100%!important;min-height:100%!important;margin:0!important}
body{background:linear-gradient(125deg,rgba(48,120,255,.30) 0%,rgba(100,95,245,.22) 48%,rgba(255,55,105,.30) 100%)!important;background-color:transparent!important;background-attachment:fixed!important;overflow:hidden!important}
.wrap{display:flex!important;flex-direction:column!important;width:100%!important;max-width:none!important;height:100dvh!important;min-height:0!important;margin:0!important;padding:0!important;gap:0!important;overflow:hidden!important;background:transparent!important}
.wrap>.top{flex:0 0 auto!important;min-height:0!important;background:rgba(70,110,235,.14)!important;backdrop-filter:blur(12px);-webkit-backdrop-filter:blur(12px)}
.fr-app-layout{display:grid!important;grid-template-columns:minmax(145px,25%) minmax(0,1fr)!important;flex:1 1 0px!important;width:100%!important;height:0!important;min-height:0!important;margin:0!important;overflow:hidden!important;background:rgba(100,130,245,.13)!important;border-color:rgba(35,45,90,.72)!important}
.fr-sidebar{min-height:0!important;height:100%!important;overflow:auto!important;background:rgba(65,120,255,.13)!important;backdrop-filter:blur(10px);-webkit-backdrop-filter:blur(10px)}
.fr-main-panels{height:100%!important;min-height:0!important;min-width:0!important;padding:10px!important;overflow:hidden!important;background:rgba(255,70,115,.10)!important;backdrop-filter:blur(10px);-webkit-backdrop-filter:blur(10px)}
.fr-panel{display:none!important;height:100%!important;min-height:0!important;margin:0!important;overflow:hidden!important}
.fr-panel.active{display:flex!important;flex-direction:column!important;height:100%!important;min-height:0!important;overflow:hidden!important}
#fr-panel-control.fr-panel.active{display:flex!important}
#fr-panel-chat.fr-panel.active{display:flex!important}
#fr-panel-screen.fr-panel.active{display:flex!important}
#fr-panel-screen .fr-viewer{display:block!important;flex:1 1 0px!important;width:100%!important;height:0!important;min-height:0!important;max-height:none!important;box-sizing:border-box!important;overflow:hidden!important;background:rgba(55,115,255,.24)!important;border-color:rgba(40,55,110,.8)!important}
#fr-panel-screen #fr-viewCanvas{display:block!important;width:100%!important;height:100%!important;max-height:100%!important}
#fr-panel-chat .chat{flex:1 1 0px!important;height:0!important;min-height:0!important;max-height:none!important;background:rgba(70,125,255,.17)!important}
#fr-panel-chat .card.section{display:flex!important;flex:1 1 0px!important;flex-direction:column!important;min-height:0!important}
#fr-panel-chat .forms{flex:0 0 auto!important}
.fr-control-area{flex:1 1 0px!important;height:auto!important;min-height:0!important}
.fr-control-card{min-height:0!important}
.fr-command{flex:0 0 auto!important}
.card{background:rgba(100,125,245,.13)!important;backdrop-filter:blur(8px);-webkit-backdrop-filter:blur(8px)}
.wrap>.top .fr-tab{min-width:0!important;flex:1 1 0px!important;white-space:nowrap!important;overflow:hidden!important;text-overflow:ellipsis!important}
@media(max-width:900px){
 .wrap>.top{flex:0 0 auto!important}
 .fr-app-layout{grid-template-columns:minmax(108px,29%) minmax(0,1fr)!important}
 .fr-main-panels{padding:6px!important}
 .wrap>.top .fr-tab{font-size:clamp(12px,2.2vw,18px)!important;padding:8px 4px!important}
}
@media(max-width:560px){
 .fr-app-layout{grid-template-columns:minmax(96px,29%) minmax(0,1fr)!important}
 .fr-sidebar{padding:6px 4px!important}
 .fr-main-panels{padding:4px!important}
}


/* Fix: Hauptbereich darf unter dem Header nicht auf 0px kollabieren */
.wrap>.fr-app-layout{display:grid!important;grid-template-columns:minmax(150px,25%) minmax(0,1fr)!important;flex:1 1 auto!important;width:100%!important;height:calc(100dvh - 82px)!important;min-height:420px!important;max-height:none!important;visibility:visible!important;opacity:1!important;overflow:hidden!important;position:relative!important;}
.wrap>.fr-app-layout>.fr-sidebar,.wrap>.fr-app-layout>.fr-main-panels{display:block!important;height:100%!important;min-height:0!important;max-height:none!important;visibility:visible!important;opacity:1!important;overflow:auto!important;}
.wrap>.fr-app-layout>.fr-main-panels{display:flex!important;flex-direction:column!important;min-width:0!important;}
.wrap>.fr-app-layout .fr-panel.active{display:flex!important;flex:1 1 auto!important;flex-direction:column!important;width:100%!important;height:100%!important;min-height:0!important;visibility:visible!important;opacity:1!important;overflow:auto!important;}
.wrap>.fr-app-layout .fr-control-area,.wrap>.fr-app-layout .fr-control-card,.wrap>.fr-app-layout .fr-command,#fr-panel-chat .card.section{visibility:visible!important;opacity:1!important;}
.wrap>.fr-app-layout .fr-control-card .actions,.wrap>.fr-app-layout .fr-control-card .actions>.btn{visibility:visible!important;opacity:1!important;}
@media(max-width:720px){.wrap>.fr-app-layout{grid-template-columns:minmax(105px,28%) minmax(0,1fr)!important;height:calc(100dvh - 82px)!important;min-height:360px!important;}}
/* Reparatur: Steuerungsbuttons, Dashboard-Kopf und stabiler Bildschirm */
.wrap>.top .title:after{content:" · Dashboard";font-size:.48em;font-weight:700;opacity:.8;vertical-align:middle}
.fr-control-card,.fr-control-card .actions{visibility:visible!important;opacity:1!important}
.fr-control-card .actions{display:grid!important;grid-template-columns:repeat(2,minmax(0,1fr))!important;align-content:start!important;justify-content:center!important;width:100%!important;max-width:440px!important;margin:12px auto!important;gap:10px!important}
.fr-control-card .actions>.btn{display:block!important;visibility:visible!important;opacity:1!important;position:relative!important;width:100%!important;min-width:0!important;max-width:none!important;height:auto!important;min-height:46px!important;color:#171717!important;background:rgba(235,240,255,.78)!important;border:2px solid #202020!important;z-index:1!important}
.fr-control-area{display:flex!important;flex:1 1 auto!important;height:auto!important;min-height:0!important;align-items:flex-start!important;justify-content:center!important;overflow:auto!important}
.fr-control-card{display:flex!important;flex:1 1 auto!important;width:100%!important;height:auto!important;min-height:0!important;align-items:flex-start!important;justify-content:center!important;overflow:visible!important}
.fr-command{display:block!important;flex:0 0 auto!important;width:100%!important;min-height:44px!important}
.fr-main-panels{display:flex!important;flex-direction:column!important}
.fr-panel{display:none!important;flex:1 1 auto!important;width:100%!important;min-height:0!important}
.fr-panel.active{display:flex!important;flex-direction:column!important;flex:1 1 auto!important;height:100%!important;min-height:0!important;overflow:hidden!important}
#fr-panel-control .fr-control-area{flex:1 1 auto!important}
#fr-panel-screen .fr-viewer{position:relative!important;display:block!important;flex:1 1 auto!important;width:100%!important;height:auto!important;min-height:0!important;max-height:none!important;overflow:hidden!important}
#fr-panel-screen #fr-viewCanvas{position:absolute!important;inset:0!important;display:block!important;width:100%!important;height:100%!important;min-height:0!important;max-height:none!important}
#fr-panel-chat .card.section{display:flex!important;flex:1 1 auto!important;flex-direction:column!important;min-height:0!important;overflow:hidden!important}
#fr-panel-chat .chat{flex:1 1 auto!important;height:auto!important;min-height:0!important;max-height:none!important}
@media(max-width:900px){
 .fr-control-card .actions{grid-template-columns:repeat(2,minmax(0,1fr))!important;max-width:100%!important}
 .fr-control-card .actions>.btn{min-height:42px!important;font-size:14px!important}
}
</style></head><body><main class="wrap">
<div class="top"><div><div class="title"><span style="color:#4779c7">Block</span> <span style="color:#f04444">Bande</span></div><div class="sub">Botportal · Minecraft-Steuerung</div></
div><button class="btn" id="logout">Abmelden</button></div>
<nav class="dashboard-tabs" aria-label="Dashboard-Bereiche"><a href="#status">Übersicht</a><a href="#control">Steuerung</a><a href="#chatPanel">Minecraft-Chat</a><a href="#moneyPanel">Geld senden</a><a href="#commandPanel">Befehl</a><a href="#eventsPanel">Ereignisse</a></nav>
<div class="grid" id="status">
<div class="card"><div class="label">Status</div><div id="status" class="value offline">Offline</div></div>
<div class="card"><div class="label">Uptime</div><div id="uptime" class="value">00:00:00</div></div>
<div class="card"><div class="label">Kontostand</div><div id="money" class="value">0 $</div></div>
<div class="card"><div class="label">Koordinaten</div><div id="coords" class="value">0, 0, 0</div></div>
</div>
<div id="auth" class="card auth hidden"><b>Microsoft-Anmeldung erforderlich</b><p>Öffne die angezeigte Microsoft-Seite und
gib den Code ein.</p><p><a id="authLink" href="#" target="_blank" rel="noopener">Microsoft-Anmeldeseite öffnen</a></p><div
id="authCode" class="value"></div></div>
<div class="card section" id="control"><h2>Steuerung</h2><div class="actions">
<button class="btn primary" data-action="start"> Ein</button><button class="btn danger" data-action="stop"> Aus</
button><button class="btn" data-action="reconnect"> Neu verbinden</button><button class="btn" data-action="home"> Home
AFK</button><button class="btn" data-action="run"> Laufen</button><button class="btn danger" data-action="stoprun"> Laufen
stoppen</button>
</div></div>
<div class="card section" id="chatPanel"><h2>Minecraft-Chat</h2><div id="chat" class="chat"></div><div class="forms" style="margin-top:
10px"><input id="chatInput" maxlength="256" placeholder="Nachricht an den Minecraft-Chat"><button class="btn primary"
id="chatSend">Senden</button></div></div>
<div class="card section" id="moneyPanel"><h2>Geld senden</h2><div class="forms"><input id="moneyInput" inputmode="decimal"
placeholder="Betrag, z. B. 500"><button class="btn primary" id="moneySend">Senden</button></div><div class="sub"
style="margin-top:8px">Ziel: !FrozenBoar16433 · Über 4.999 $ wird automatisch bestätigt.</div></div>
<div class="card section" id="commandPanel"><h2>Minecraft-Befehl</h2><div class="forms"><input id="commandInput" maxlength="256"
placeholder="z. B. /spawn oder /money"><button class="btn" id="commandSend">Ausführen</button></div></div>
<div class="card section" id="eventsPanel"><h2>Ereignisse</h2><div id="events" class="events"></div></div>
<div class="sub logout">Automatische Aktualisierung alle 2 Sekunden.</div>
</main><div id="toast" class="toast"></div>
<script>
const $=id=>document.getElementById(id);let lastChat=0,lastEvents=0;
function toast(text){const t=$('toast');t.textContent=text;t.style.display='block';clearTimeout(window.__toast);window.
__toast=setTimeout(()=>t.style.display='none',2800)}
function fmtTime(s){return new Date(s).toLocaleTimeString('de-DE',{hour:'2-digit',minute:'2-digit',second:'2-digit'})}
function render(d){$('status').textContent=d.starting?'Verbinde...':(d.online?'Online':'Offline');$('status').
className='value '+(d.online?'online':'offline');$('uptime').textContent=d.uptime;$('money').textContent=d.moneyFormatted;$(
'coords').textContent=d.coordinatesFormatted;
if(d.auth&&d.auth.userCode){$('auth').classList.remove('hidden');$('authCode').textContent=d.auth.userCode;if(d.auth.
verificationUri)$('authLink').href=d.auth.verificationUri;}else{$('auth').classList.add('hidden');}
if(d.chat.length!==lastChat){$('chat').innerHTML=d.chat.map(x=>'<div class="line"><span class="time">'+fmtTime(x.time)+'</
span> <span class="name">'+escapeHtml(x.source)+'</span>: '+escapeHtml(x.message)+'</div>').join('');$('chat').scrollTop=$(
'chat').scrollHeight;lastChat=d.chat.length;}
if(d.events.length!==lastEvents){$('events').innerHTML=d.events.slice().reverse().map(x=>'<div class="event '+escapeHtml(x.
type)+'"><span class="time">'+fmtTime(x.time)+'</span> '+escapeHtml(x.message)+'</div>').join('');lastEvents=d.events.length;
}
}
function escapeHtml(v){return String(v).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[
c]))}
async function api(path,body){const r=await fetch(path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.
stringify(body||{})});const d=await r.json().catch(()=>({error:'Ungültige Serverantwort'}));if(r.status===401){location.
href='/login';return null}if(!r.ok)throw new Error(d.error||'Aktion fehlgeschlagen');return d}
async function refresh(){try{const r=await fetch('/api/status',{cache:'no-store'});if(r.status===401){location.href='/login';
return}const d=await r.json();render(d);}catch(e){toast(e.message)}}
for(const b of document.querySelectorAll('[data-action]'))b.addEventListener('click',async()=>{try{const a=b.dataset.action;
if(a==='start')await api('/api/minecraft/start');if(a==='stop')await api('/api/minecraft/stop');if(a==='reconnect')await api(
'/api/minecraft/reconnect');if(a==='home')await api('/api/minecraft/home');if(a==='run')await api('/api/minecraft/run');if(
a==='stoprun')await api('/api/minecraft/stoprun');toast('Aktion ausgeführt');await refresh();}catch(e){toast(e.message)}});
$('chatSend').addEventListener('click',async()=>{try{const v=$('chatInput').value;await api('/api/minecraft/chat',{message:
v});$('chatInput').value='';toast('Nachricht gesendet');await refresh()}catch(e){toast(e.message)}});
$('moneySend').addEventListener('click',async()=>{try{const v=$('moneyInput').value;await api('/api/minecraft/pay',{amount:
v});$('moneyInput').value='';toast('Geld gesendet');await refresh()}catch(e){toast(e.message)}});
$('commandSend').addEventListener('click',async()=>{try{const v=$('commandInput').value;await api('/api/minecraft/command',{
command:v});$('commandInput').value='';toast('Befehl ausgeführt');await refresh()}catch(e){toast(e.message)}});
$('logout').addEventListener('click',async()=>{const b=$('logout');if(b){b.disabled=true;b.textContent='Abmelden…'}try{await fetch('/api/logout',{method:'POST',credentials:'same-origin',cache:'no-store',headers:{'Accept':'application/json'}})}catch(e){}location.replace('/login?loggedout='+Date.now())});
$('chatInput').addEventListener('keydown',e=>{if(e.key==='Enter')$('chatSend').click()});$('moneyInput').addEventListener(
'keydown',e=>{if(e.key==='Enter')$('moneySend').click()});$('commandInput').addEventListener('keydown',e=>{if(e.
key==='Enter')$('commandSend').click()});
refresh();setInterval(refresh,2000);
</script>
<style>
/* FrozenRun: Live-Bildschirm */
.fr-screen{display:grid;grid-template-columns:minmax(0,1fr) 260px;gap:14px}
.fr-viewer{position:relative;overflow:hidden;border:1px solid #263451;border-radius:18px;background:#070b14;min-height:430px}
.fr-viewer canvas{display:block;width:100%;height:100%;min-height:430px;touch-action:none}
.fr-view-overlay{position:absolute;inset:0;pointer-events:none}
.fr-view-top{position:absolute;left:14px;right:14px;top:12px;display:flex;justify-content:space-between;gap:10px;font-size:12px}
.fr-view-badge{background:rgba(7,11,20,.78);border:1px solid #33415f;border-radius:10px;padding:8px 10px;backdrop-filter:blur(6px)}
.fr-crosshair{position:absolute;left:50%;top:50%;width:18px;height:18px;transform:translate(-50%,-50%)}
.fr-crosshair:before,.fr-crosshair:after{content:"";position:absolute;background:rgba(255,255,255,.75)}
.fr-crosshair:before{width:18px;height:1px;left:0;top:9px}.fr-crosshair:after{height:18px;width:1px;left:9px;top:0}
.fr-view-side .value{font-size:18px}
.fr-view-note{font-size:13px;color:#8290ad;line-height:1.5}
.fr-compass{height:120px;display:grid;place-items:center;border:1px solid #263451;border-radius:14px;background:#0d1424;margin-top:10px;position:relative;overflow:hidden}
.fr-compass-ring{width:82px;height:82px;border:1px solid #455575;border-radius:50%;position:relative}
.fr-compass-ring span{position:absolute;font-size:11px;color:#aab5cc;font-weight:800}
.fr-compass-n{left:50%;top:5px;transform:translateX(-50%)}.fr-compass-s{left:50%;bottom:5px;transform:translateX(-50%)}
.fr-compass-w{left:7px;top:50%;transform:translateY(-50%)}.fr-compass-e{right:7px;top:50%;transform:translateY(-50%)}
.fr-compass-arrow{position:absolute;left:50%;top:50%;width:3px;height:34px;background:#ff707d;transform-origin:50% 100%;border-radius:3px 3px 0 0}
@media(max-width:850px){.fr-screen{grid-template-columns:1fr}.fr-view-side{display:grid;grid-template-columns:repeat(2,1fr);gap:10px}.fr-view-side .card{min-width:0}.fr-compass{margin-top:0}}
@media(max-width:560px){.fr-viewer,.fr-viewer canvas{min-height:320px}.fr-view-side{grid-template-columns:1fr}}

/* Block Bande: Tabs + responsives Steuerungs-Layout */
.fr-tabs{display:flex;gap:0;flex:1;min-width:220px;align-self:stretch;border:3px solid #202020;border-radius:6px;background:#d5d5d5;overflow:hidden}
.fr-tab{flex:1;background:#e8e8e8;border:0;border-right:2px solid #202020;color:#171717;border-radius:0;padding:10px 12px;font-weight:800;cursor:pointer;font-family:inherit;font-size:16px}.fr-tab:last-child{border-right:0}.fr-tab.active{background:#aaa;color:#171717;box-shadow:inset 0 0 0 2px #777}
.fr-panel{display:none}
.fr-panel.active{display:block}
.wrap{padding-bottom:16px}
.fr-control-layout{display:grid;grid-template-columns:1fr 1fr;gap:14px;align-items:start}
.fr-command textarea{width:100%;min-height:120px;resize:vertical;background:#0d1424;color:#fff;border:1px solid #2c3957;border-radius:12px;padding:12px;font:inherit}
.fr-command .forms{grid-template-columns:1fr}
.fr-note{font-size:13px;color:#333;line-height:1.45;margin-top:8px}.fr-app-layout{display:grid;grid-template-columns:minmax(180px,220px) minmax(0,1fr);gap:18px;align-items:start}.fr-sidebar{min-width:0}.fr-sidebar .card{height:100%}.fr-app-layout .card.section{margin-top:0}.fr-control-layout>.card{min-width:0}.fr-main-panels .card{margin-bottom:14px}.fr-main-panels .chat{height:min(48vh,440px);min-height:260px}.fr-tabs{order:0}.top{flex-wrap:wrap;align-items:center}.fr-tabs{flex-basis:100%;width:100%;min-height:48px}.fr-sidebar .card{padding:12px}.fr-sidebar .grid>div{padding:0;border:0;border-bottom:1px solid #aaa;border-radius:0;background:transparent}.fr-sidebar .grid>div:last-child{border-bottom:0}.fr-main-panels{min-width:0}.fr-main-panels>.fr-panel{margin-top:0}.fr-sidebar .label{font-size:15px}.fr-sidebar .value{font-size:18px}.top .title{flex-shrink:0}.top .sub{display:none}
@media(max-width:950px){.fr-control-layout{grid-template-columns:1fr 1fr}.fr-command{grid-column:1/-1}}
@media(max-width:850px){.fr-app-layout{grid-template-columns:1fr}.fr-sidebar .grid{grid-template-columns:repeat(4,minmax(0,1fr));gap:8px}.fr-sidebar .grid>div{border-bottom:0;border-right:1px solid #aaa;padding:4px}.fr-sidebar .grid>div:last-child{border-right:0}.fr-sidebar .card{height:auto}}
@media(max-width:700px){.wrap{padding:12px}.top{align-items:flex-start}.fr-control-layout{grid-template-columns:1fr}.fr-command{grid-column:auto}.fr-tabs{width:100%;min-width:0}.fr-tab{padding:9px 5px;font-size:14px}.fr-app-layout{grid-template-columns:1fr}.fr-sidebar .grid{grid-template-columns:repeat(2,minmax(0,1fr));gap:8px}.fr-sidebar .grid>div{border-bottom:0;border-right:1px solid #aaa;padding:4px}.fr-sidebar .grid>div:nth-child(even){border-right:0}.top .title{font-size:24px}}
</style>
<script>
(function(){
  const wrap=document.querySelector('.wrap');
  if(!wrap || wrap.dataset.frLayoutReady==='1') return;
  const top=wrap.querySelector('.top');
  const stats=wrap.querySelector('#status.grid, .grid');
  // Robuste Zuordnung über feste IDs statt über sichtbare Überschriften.
  const chatCard=wrap.querySelector('#chatPanel');
  const controlCard=wrap.querySelector('#control');
  const moneyCard=wrap.querySelector('#moneyPanel');
  const commandCard=wrap.querySelector('#commandPanel');
  const eventsCard=wrap.querySelector('#eventsPanel');
  if(!top||!stats||!chatCard||!controlCard||!moneyCard||!commandCard||!eventsCard)return;
  wrap.dataset.frLayoutReady='1';

  const oldNav=wrap.querySelector('.dashboard-tabs');
  if(oldNav)oldNav.remove();
  const screenTab=document.createElement('button');
  screenTab.type='button';screenTab.className='fr-tab';screenTab.textContent='Bildschirm';screenTab.dataset.frTab='screen';
  const chatTab=document.createElement('button');
  chatTab.type='button';chatTab.className='fr-tab';chatTab.textContent='Chat';chatTab.dataset.frTab='chat';
  const controlTab=document.createElement('button');
  controlTab.type='button';controlTab.className='fr-tab active';controlTab.textContent='Steuerung';controlTab.dataset.frTab='control';
  const tabs=document.createElement('nav');
  tabs.className='fr-tabs';tabs.setAttribute('aria-label','Bereiche');
  tabs.append(controlTab,chatTab,screenTab);

  const screenPanel=document.createElement('section');
  screenPanel.className='fr-panel';screenPanel.id='fr-panel-screen';
  screenPanel.innerHTML='<div class="fr-viewer"><canvas id="fr-viewCanvas" aria-label="Minecraft-Bildschirmansicht"></canvas></div>';

  const chatPanel=document.createElement('section');
  chatPanel.className='fr-panel';chatPanel.id='fr-panel-chat';chatPanel.appendChild(chatCard);
  const controlPanel=document.createElement('section');
  controlPanel.className='fr-panel active';controlPanel.id='fr-panel-control';
  const controls=document.createElement('div');controls.className='fr-control-area';
  controlCard.classList.add('fr-control-card');
  const commandTitle=commandCard.querySelector('h2');if(commandTitle)commandTitle.remove();
  commandCard.classList.add('fr-command');
  const commandInput=commandCard.querySelector('#commandInput');if(commandInput)commandInput.placeholder='/Befehl';
  const commandButton=commandCard.querySelector('#commandSend');if(commandButton)commandButton.textContent='↵';
  controls.appendChild(controlCard);
  controlPanel.append(controls,commandCard);

  const sidebar=document.createElement('aside');sidebar.className='fr-sidebar';
  const values=Array.from(stats.children);
  const money=values.find(el=>el.querySelector('#money'));
  const uptime=values.find(el=>el.querySelector('#uptime'));
  const coords=values.find(el=>el.querySelector('#coords'));
  const status=values.find(el=>el.querySelector('#status'));
  stats.id='fr-status-list';
  stats.replaceChildren(...[money,uptime,coords,status].filter(Boolean));
  sidebar.appendChild(stats);
  const version=document.createElement('div');version.className='fr-version';version.textContent='Version';sidebar.appendChild(version);

  const auth=wrap.querySelector('#auth');
  const appLayout=document.createElement('div');appLayout.className='fr-app-layout';
  const mainPanels=document.createElement('div');mainPanels.className='fr-main-panels';
  mainPanels.append(controlPanel,chatPanel,screenPanel);
  if(auth)auth.insertAdjacentElement('afterend',appLayout);else top.insertAdjacentElement('afterend',appLayout);
  appLayout.append(sidebar,mainPanels);
  const titleNode=top.querySelector('.title');if(titleNode)titleNode.innerHTML='<span style="color:#4779c7">Block</span> <span style="color:#f04444">Bande</span>';
  const subtitle=top.querySelector('.sub');if(subtitle)subtitle.remove();
  top.appendChild(tabs);
  const logoutButton=top.querySelector('#logout');if(logoutButton){logoutButton.textContent='Abmelden';top.appendChild(logoutButton);}

  function activate(name){
    const chat=name==='chat',control=name==='control',screen=name==='screen';
    const alreadyActive=(chat&&chatPanel.classList.contains('active'))||(control&&controlPanel.classList.contains('active'))||(screen&&screenPanel.classList.contains('active'));
    if(alreadyActive){ if(screen) requestAnimationFrame(()=>{ if(viewCanvas && renderer) resize3D(); }); return; }
    chatTab.classList.toggle('active',chat);controlTab.classList.toggle('active',control);screenTab.classList.toggle('active',screen);
    chatPanel.classList.toggle('active',chat);controlPanel.classList.toggle('active',control);screenPanel.classList.toggle('active',screen);
    if(screen) requestAnimationFrame(()=>{ if(viewCanvas && renderer) resize3D(); });
  }
  chatTab.addEventListener('click',()=>activate('chat'));
  controlTab.addEventListener('click',()=>activate('control'));
  screenTab.addEventListener('click',()=>activate('screen'));
const viewCanvas=document.getElementById('fr-viewCanvas');
  const viewStatus=document.getElementById('fr-viewStatus');
  const viewPos=document.getElementById('fr-viewPos');
  const viewRot=document.getElementById('fr-viewRot');
  const viewBot=document.getElementById('fr-viewBot');
  const compassArrow=document.getElementById('fr-compassArrow');
  let viewState={position:{x:0,y:0,z:0},rotation:{yaw:0,pitch:0,headYaw:0},online:false};
  let three=null,scene=null,camera=null,renderer=null,worldGroup=null,surfaceGroup=null,surfaceMesh=null,botMarker=null,raf=0;

  function dispose3D(){
    if(raf) cancelAnimationFrame(raf);
    raf=0;
    if(renderer){renderer.dispose();renderer=null;}
    three=null;scene=null;camera=null;renderer=null;worldGroup=null;surfaceGroup=null;surfaceMesh=null;botMarker=null;
  }

  async function init3D(){
    if(!viewCanvas || renderer) return;
    try{
      three=await import('https://cdn.jsdelivr.net/npm/three@0.180.0/build/three.module.js');
      scene=new three.Scene();
      scene.background=new three.Color(0x182b4a);
      scene.fog=new three.Fog(0x182b4a,28,110);

      camera=new three.PerspectiveCamera(70,1,0.05,160);
      camera.position.set(0,1.65,0);

      renderer=new three.WebGLRenderer({canvas:viewCanvas,antialias:true,preserveDrawingBuffer:false});
      renderer.setPixelRatio(Math.min(window.devicePixelRatio||1,2));
      renderer.outputColorSpace=three.SRGBColorSpace;

      const hemi=new three.HemisphereLight(0xbfdcff,0x38452f,2.2);
      scene.add(hemi);
      const sun=new three.DirectionalLight(0xffffff,2.4);
      sun.position.set(20,40,15);
      scene.add(sun);

      worldGroup=new three.Group();
      scene.add(worldGroup);
      surfaceGroup=new three.Group();
      worldGroup.add(surfaceGroup);

      const cubeGeo=new three.BoxGeometry(1,1,1);
      const botMaterial=new three.MeshLambertMaterial({color:0x6d5dfc});
      const headMaterial=new three.MeshLambertMaterial({color:0xd7b38a});

      botMarker=new three.Group();
      const body=new three.Mesh(new three.BoxGeometry(.65,1.25,.38),botMaterial);
      body.position.y=.7;
      botMarker.add(body);
      const head=new three.Mesh(new three.BoxGeometry(.55,.55,.55),headMaterial);
      head.position.y=1.6;
      botMarker.add(head);
      worldGroup.add(botMarker);

      resize3D();

      render3D();
      viewStatus.textContent='3D-Ansicht · Live';
    }catch(e){
      console.error('3D-Ansicht konnte nicht geladen werden:',e);
      viewStatus.textContent='3D-Ansicht konnte nicht geladen werden';
    }
  }

  function resize3D(){
    if(!renderer||!camera||!viewCanvas) return;
    const rect=viewCanvas.getBoundingClientRect();
    const w=Math.max(1,rect.width),h=Math.max(1,rect.height);
    renderer.setSize(w,h,false);
    camera.aspect=w/h;
    camera.updateProjectionMatrix();
  }

  function updateSurface(blocks){
    if(!surfaceGroup || !three) return;
    if(surfaceMesh){
      surfaceGroup.remove(surfaceMesh);
      surfaceMesh.geometry.dispose();
      surfaceMesh.material.dispose();
      surfaceMesh=null;
    }
    const list=Array.isArray(blocks)?blocks:[];
    if(!list.length) return;
    const geometry=new three.BoxGeometry(1,1,1);
    const material=new three.MeshLambertMaterial({color:0xffffff,vertexColors:true});
    surfaceMesh=new three.InstancedMesh(geometry,material,list.length);
    const dummy=new three.Object3D();
    const color=new three.Color();
    list.forEach((b,i)=>{
      dummy.position.set(Number(b.x)||0,(Number(b.y)||0)+0.5,Number(b.z)||0);
      dummy.rotation.set(0,0,0);
      dummy.scale.set(1,1,1);
      dummy.updateMatrix();
      surfaceMesh.setMatrixAt(i,dummy.matrix);
      color.set(b.color||'#8a8f98');
      surfaceMesh.setColorAt(i,color);
    });
    surfaceMesh.instanceMatrix.needsUpdate=true;
    if(surfaceMesh.instanceColor) surfaceMesh.instanceColor.needsUpdate=true;
    surfaceGroup.add(surfaceMesh);
  }

  function render3D(){
    if(!renderer||!scene||!camera) return;
    const p=viewState.position||{x:0,y:0,z:0};
    const r=viewState.rotation||{yaw:0,pitch:0};
    const x=Number(p.x)||0, y=Number(p.y)||0, z=Number(p.z)||0;
    const yaw=(Number(r.yaw)||0)*Math.PI/180;
    const pitch=(Number(r.pitch)||0)*Math.PI/180;

    // The browser camera follows the bot's live position and rotation.
    camera.position.set(x,y+1.62,z);
    camera.rotation.order='YXZ';
    camera.rotation.y=-yaw;
    camera.rotation.x=pitch;

    if(botMarker){
      botMarker.position.set(x, y, z);
      botMarker.rotation.y=-yaw;
    }
    renderer.render(scene,camera);
    raf=requestAnimationFrame(render3D);
  }

  async function refreshView(){
    try{
      const r=await fetch('/api/view',{cache:'no-store'});
      if(r.status===401){location.href='/login';return;}
      const d=await r.json();
      viewState=d;
      updateSurface(d.world&&d.world.blocks);
      const p=d.position||{x:0,y:0,z:0};
      const ro=d.rotation||{yaw:0,pitch:0};
      viewPos.textContent=[p.x,p.y,p.z].map(v=>Math.round(Number(v)||0)).join(', ');
      viewRot.textContent=Math.round(Number(ro.yaw)||0)+'° / '+Math.round(Number(ro.pitch)||0)+'°';
      viewBot.textContent=d.online?'Online':'Offline';
      viewStatus.textContent=d.online
        ? ((d.world&&d.world.blocks&&d.world.blocks.length)?'3D-Welt · Live':'3D-Welt · Warte auf Chunks')
        : '3D-Welt · Bot offline';
      const yaw=Number(ro.yaw)||0;
      compassArrow.style.transform='translate(-50%,-100%) rotate('+yaw+'deg)';
    }catch(e){
      viewStatus.textContent='Ansicht nicht erreichbar';
    }
  }

  window.addEventListener('resize',resize3D);
  if(typeof ResizeObserver!=='undefined' && viewCanvas){ const viewerObserver=new ResizeObserver(()=>resize3D()); viewerObserver.observe(viewCanvas.parentElement); }
  init3D();
  refreshView();
  setInterval(refreshView,500);
})();
</script>

<style>
/* Stabiler Fallback für iPad Safari und Desktop: der Hauptbereich darf nicht auf 0 px kollabieren. */
html,body{width:100%;min-height:100%;margin:0}
body{overflow:auto!important}
.wrap{display:flex!important;flex-direction:column!important;width:100%!important;max-width:none!important;height:auto!important;min-height:100dvh!important;margin:0!important;padding:0!important;gap:0!important;overflow:visible!important}
.wrap>.top{display:flex!important;flex-wrap:nowrap!important;align-items:stretch!important;flex:0 0 auto!important;min-height:68px!important;width:100%!important}
.wrap>.top>div:first-child{display:flex!important;align-items:center!important;flex:1 1 auto!important;min-width:0!important}
.wrap>.top .title{white-space:normal!important;line-height:1.1!important}
.wrap>.top #logout{display:block!important;visibility:visible!important;opacity:1!important;flex:0 0 auto!important;align-self:center!important;order:5!important;grid-column:auto!important;min-height:44px!important;padding:8px 12px!important;cursor:pointer!important}
.wrap>.top .fr-tabs{display:flex!important;flex:0 1 auto!important;min-width:0!important;max-width:100%!important}
.wrap>.top .fr-tab{display:block!important;visibility:visible!important;opacity:1!important;flex:1 1 0!important;min-width:0!important;padding:10px clamp(5px,1vw,16px)!important;white-space:normal!important;text-align:center!important}
.wrap>.fr-app-layout{display:grid!important;grid-template-columns:minmax(150px,25%) minmax(0,1fr)!important;flex:1 0 auto!important;width:100%!important;height:calc(100dvh - 80px)!important;min-height:480px!important;margin:0!important;overflow:visible!important}
.wrap>.fr-app-layout>.fr-sidebar{display:flex!important;visibility:visible!important;opacity:1!important;min-width:0!important}
.wrap>.fr-app-layout>.fr-sidebar #fr-status-list{display:flex!important;visibility:visible!important;opacity:1!important}
.wrap>.fr-app-layout>.fr-main-panels{display:flex!important;flex-direction:column!important;min-width:0!important;min-height:0!important;height:100%!important;overflow:visible!important}
.wrap>.fr-app-layout .fr-panel{display:none!important;width:100%!important;min-width:0!important;min-height:0!important;margin:0!important}
.wrap>.fr-app-layout .fr-panel.active{display:flex!important;flex:1 1 auto!important;flex-direction:column!important;height:100%!important;min-height:0!important;overflow:visible!important}
#fr-panel-control .fr-control-area{display:flex!important;flex:1 1 auto!important;min-height:250px!important;height:auto!important;overflow:visible!important}
#fr-panel-control #control{display:flex!important;flex:1 1 auto!important;flex-direction:column!important;min-height:250px!important;visibility:visible!important;opacity:1!important}
#fr-panel-control #control .actions{display:grid!important;grid-template-columns:repeat(2,minmax(0,1fr))!important;gap:12px!important;width:min(100%,560px)!important;margin:12px auto!important}
#fr-panel-control #control .actions button{display:block!important;visibility:visible!important;opacity:1!important;min-height:48px!important;width:100%!important;color:#171717!important;background:rgba(235,240,255,.9)!important;border:2px solid #202020!important;border-radius:6px!important;font-weight:800!important;cursor:pointer!important}
#fr-panel-control #commandPanel{display:block!important;visibility:visible!important;opacity:1!important;flex:0 0 auto!important;width:100%!important;margin-top:10px!important}
#fr-panel-chat #chatPanel{display:flex!important;flex:1 1 auto!important;flex-direction:column!important;min-height:0!important;visibility:visible!important;opacity:1!important}
#fr-panel-chat #chat{display:block!important;flex:1 1 auto!important;height:auto!important;min-height:220px!important;max-height:none!important}
#fr-panel-chat .forms,#fr-panel-control .forms{display:grid!important;grid-template-columns:minmax(0,1fr) auto!important;gap:8px!important}
#fr-panel-screen .fr-viewer{display:block!important;flex:1 1 auto!important;height:auto!important;min-height:300px!important}
#fr-panel-screen #fr-viewCanvas{display:block!important;width:100%!important;height:100%!important}
@media(max-width:900px){
 .wrap>.top{flex-wrap:wrap!important}
 .wrap>.top>div:first-child{flex:1 1 100%!important}
 .wrap>.top .fr-tabs{order:3!important;flex:1 1 100%!important}
 .wrap>.top #logout{position:absolute!important;right:8px!important;top:8px!important}
 .wrap>.fr-app-layout{grid-template-columns:minmax(100px,28%) minmax(0,1fr)!important;height:calc(100dvh - 125px)!important;min-height:420px!important}
 .wrap>.top .title{padding-right:95px!important}
 .fr-control-area{padding:8px!important}
}
@media(max-width:560px){
 .wrap>.fr-app-layout{grid-template-columns:minmax(88px,27%) minmax(0,1fr)!important;height:calc(100dvh - 135px)!important;min-height:400px!important}
 #fr-panel-control #control .actions{grid-template-columns:repeat(2,minmax(0,1fr))!important;gap:7px!important}
 #fr-panel-control #control .actions button{font-size:14px!important;min-height:44px!important;padding:6px 3px!important}
 .wrap>.top .fr-tab{font-size:14px!important}
}
</style></body></html>`;
// ============================================================
// HTTP API
// ============================================================
async function handleRequest(req, res) {
const url = String(req.url || "/").split("?")[0];
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
"Set-Cookie": `frozenrun_session=${encodeURIComponent(token)}; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=${
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
if (req.method === "POST" && url === "/api/logout") {
const token = getCookies(req).frozenrun_session;
if (token) sessions.delete(token);
res.writeHead(200, {
"Content-Type": "application/json; charset=utf-8",
"Set-Cookie": "frozenrun_session=; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=0",
"Cache-Control": "no-store"
});
return res.end(JSON.stringify({ ok: true }));
}
if (req.method !== "POST") return json(res, 405, { ok: false, error: "Methode nicht erlaubt." });
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
addEvent("FrozenRun startet ohne Discord-Steuerung.", "info");
});
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