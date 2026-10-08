const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const bedrock = require("bedrock-protocol");
const { Authflow, Titles } = require("prismarine-auth");
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
scale=1"><title>FrozenRun Login</title>
<style>
*{box-sizing:border-box}body{margin:0;min-height:100vh;background:#0b1020;color:#eef2ff;font-family:system-ui,-apple-system,
Segoe UI,Roboto,sans-serif;display:grid;place-items:center;padding:20px}.card{width:min(420px,100%);background:#121a2d;
border:1px solid #263250;border-radius:22px;padding:28px;box-shadow:0 20px 60px #0006}.logo{font-size:30px;font-weight:800;
margin-bottom:8px}.muted{color:#9aa8c7;margin-bottom:22px}input,button{width:100%;min-height:48px;border-radius:12px;border:
1px solid #34415f;font-size:16px}input{background:#0d1425;color:#fff;padding:0 14px;margin-bottom:12px}button{background:
#6d5dfc;color:#fff;font-weight:700;border:0;cursor:pointer}button:active{transform:translateY(1px)}#msg{margin-top:14px;
color:#ff9b9b;min-height:22px}.small{font-size:13px;color:#7f8dab;margin-top:18px}
</style></head><body><main class="card"><div class="logo">❄ FrozenRun</div><div class="muted">Web-Steuerung für
LiveSinger9275</div><form id="form"><input id="password" type="password" autocomplete="current-password" placeholder="Web-
Passwort" required><button>Anmelden</button></form><div id="msg"></div><div class="small">Kein Discord nötig.</div></
main><script>
document.getElementById('form').addEventListener('submit',async e=>{e.preventDefault();const msg=document.getElementById(
'msg');msg.textContent='';try{const r=await fetch('/api/login',{method:'POST',headers:{'Content-Type':'application/json'},
body:JSON.stringify({password:document.getElementById('password').value})});const d=await r.json();if(!r.ok)throw new Error(
d.error||'Login fehlgeschlagen');location.href='/';}catch(err){msg.textContent=err.message;}});
</script></body></html>`;
const DASHBOARD_HTML = `<!doctype html>
<html lang="de"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-
scale=1"><title>FrozenRun</title>
<style>
*{box-sizing:border-box}body{margin:0;background:#0a0f1d;color:#edf2ff;font-family:system-ui,-apple-system,Segoe UI,Roboto,
sans-serif}.wrap{width:min(1100px,100%);margin:auto;padding:18px}.top{display:flex;justify-content:space-between;gap:12px;
align-items:center;margin-bottom:18px}.title{font-size:28px;font-weight:850}.sub{color:#8e9ab5;font-size:14px}.btn{border:
1px solid #2c3957;background:#151e33;color:#fff;border-radius:12px;padding:12px 15px;font-weight:700;cursor:pointer}.btn.
primary{background:#6d5dfc;border-color:#6d5dfc}.btn.danger{background:#8e3040;border-color:#8e3040}.grid{display:grid;grid-
template-columns:repeat(4,1fr);gap:12px}.card{background:#111a2d;border:1px solid #263451;border-radius:18px;padding:16px}.
label{font-size:12px;color:#8290ad;text-transform:uppercase;letter-spacing:.06em}.value{font-size:22px;font-weight:800;
margin-top:6px;word-break:break-word}.online{color:#5ce58c}.offline{color:#ff707d}.auth{margin-top:14px;border-color:#7d6dff;
background:#171d38}.auth a{color:#bdb5ff}.actions{display:grid;grid-template-columns:repeat(3,1fr);gap:10px;margin-top:14px}.
section{margin-top:16px}.section h2{font-size:17px;margin:0 0 10px}.chat{height:360px;overflow:auto;background:#0d1424;
border:1px solid #263451;border-radius:14px;padding:10px}.line{padding:8px 4px;border-bottom:1px solid #1b263e;white-space:
pre-wrap;overflow-wrap:anywhere}.time{color:#687795;font-size:12px}.name{font-weight:800;color:#bdb5ff}.forms{display:grid;
grid-template-columns:1fr auto;gap:10px}.forms input,.forms textarea{width:100%;background:#0d1424;color:#fff;border:1px
solid #2c3957;border-radius:12px;padding:12px;font:inherit}.events{max-height:220px;overflow:auto}.event{padding:7px 0;
border-bottom:1px solid #1b263e;font-size:13px}.event.error{color:#ff858f}.event.success{color:#6ee7a0}.event.auth{color:
#f7d774}.logout{margin-top:12px}.toast{position:fixed;left:50%;bottom:20px;transform:translateX(-50%);background:#171f33;
border:1px solid #33415f;border-radius:12px;padding:12px 16px;display:none;max-width:90%;z-index:10}.hidden{display:
none!important}@media(max-width:800px){.grid{grid-template-columns:repeat(2,1fr)}.actions{grid-template-columns:repeat(2,
1fr)}}@media(max-width:520px){.wrap{padding:12px}.grid{grid-template-columns:1fr 1fr}.actions{grid-template-columns:1fr}.top{
align-items:flex-start}.title{font-size:23px}.forms{grid-template-columns:1fr}.chat{height:300px}}
</style></head><body><main class="wrap">
<div class="top"><div><div class="title">❄ FrozenRun</div><div class="sub">Minecraft-Websteuerung · LiveSinger9275</div></
div><button class="btn" id="logout">Abmelden</button></div>
<div class="grid">
<div class="card"><div class="label">Status</div><div id="status" class="value offline">Offline</div></div>
<div class="card"><div class="label">Uptime</div><div id="uptime" class="value">00:00:00</div></div>
<div class="card"><div class="label">Kontostand</div><div id="money" class="value">0 $</div></div>
<div class="card"><div class="label">Koordinaten</div><div id="coords" class="value">0, 0, 0</div></div>
</div>
<div id="auth" class="card auth hidden"><b>Microsoft-Anmeldung erforderlich</b><p>Öffne die angezeigte Microsoft-Seite und
gib den Code ein.</p><p><a id="authLink" href="#" target="_blank" rel="noopener">Microsoft-Anmeldeseite öffnen</a></p><div
id="authCode" class="value"></div></div>
<div class="card section"><h2>Steuerung</h2><div class="actions">
<button class="btn primary" data-action="start"> Ein</button><button class="btn danger" data-action="stop"> Aus</
button><button class="btn" data-action="reconnect"> Neu verbinden</button><button class="btn" data-action="home"> Home
AFK</button><button class="btn" data-action="run"> Laufen</button><button class="btn danger" data-action="stoprun"> Laufen
stoppen</button>
</div></div>
<div class="card section"><h2>Minecraft-Chat</h2><div id="chat" class="chat"></div><div class="forms" style="margin-top:
10px"><input id="chatInput" maxlength="256" placeholder="Nachricht an den Minecraft-Chat"><button class="btn primary"
id="chatSend">Senden</button></div></div>
<div class="card section"><h2>Geld senden</h2><div class="forms"><input id="moneyInput" inputmode="decimal"
placeholder="Betrag, z. B. 500"><button class="btn primary" id="moneySend">Senden</button></div><div class="sub"
style="margin-top:8px">Ziel: !FrozenBoar16433 · Über 4.999 $ wird automatisch bestätigt.</div></div>
<div class="card section"><h2>Minecraft-Befehl</h2><div class="forms"><input id="commandInput" maxlength="256"
placeholder="z. B. /spawn oder /money"><button class="btn" id="commandSend">Ausführen</button></div></div>
<div class="card section"><h2>Ereignisse</h2><div id="events" class="events"></div></div>
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
$('logout').addEventListener('click',async()=>{await api('/api/logout');location.href='/login'});
$('chatInput').addEventListener('keydown',e=>{if(e.key==='Enter')$('chatSend').click()});$('moneyInput').addEventListener(
'keydown',e=>{if(e.key==='Enter')$('moneySend').click()});$('commandInput').addEventListener('keydown',e=>{if(e.
key==='Enter')$('commandSend').click()});
refresh();setInterval(refresh,2000);
</script>
<style>
/* FrozenRun: Live-Bildschirm */
.fr-screen{width:100%}
.fr-viewer{position:relative;overflow:hidden;border:1px solid #263451;border-radius:18px;background:#070b14;min-height:560px}
.fr-viewer canvas{display:block;width:100%;height:100%;min-height:560px;touch-action:none}
.fr-view-overlay{position:absolute;inset:0;pointer-events:none}
.fr-view-top{position:absolute;left:14px;right:14px;top:12px;display:flex;justify-content:space-between;gap:10px;font-size:12px}
.fr-view-badge{background:rgba(7,11,20,.78);border:1px solid #33415f;border-radius:10px;padding:8px 10px;backdrop-filter:blur(6px)}
.fr-crosshair{position:absolute;left:50%;top:50%;width:18px;height:18px;transform:translate(-50%,-50%)}
.fr-crosshair:before,.fr-crosshair:after{content:"";position:absolute;background:rgba(255,255,255,.8)}
.fr-crosshair:before{width:18px;height:1px;left:0;top:9px}.fr-crosshair:after{height:18px;width:1px;left:9px;top:0}
@media(max-width:560px){.fr-viewer,.fr-viewer canvas{min-height:360px}}

/* FrozenRun: Tabs + Steuerungs-Layout */
.fr-tabs{display:flex;gap:8px;margin:0 0 14px;border-bottom:1px solid #24314b;padding-bottom:8px}
.fr-tab{background:transparent;border:1px solid transparent;color:#8e9ab5;border-radius:10px;padding:11px 18px;font-weight:800;cursor:pointer}
.fr-tab.active{background:#171f35;color:#fff;border-color:#33415f}
.fr-panel{display:none}
.fr-panel.active{display:block}
.fr-control-layout{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:14px;align-items:start}
.fr-command .forms{grid-template-columns:1fr auto}
.fr-note{font-size:13px;color:#8290ad;line-height:1.45;margin-top:8px}
@media(max-width:950px){.fr-control-layout{grid-template-columns:1fr 1fr}.fr-command{grid-column:1/-1}}
@media(max-width:700px){.fr-control-layout{grid-template-columns:1fr}.fr-command{grid-column:auto}}
</style>
<script>
(function(){
  const wrap=document.querySelector('.wrap');
  if(!wrap || wrap.dataset.frLayoutReady==='1') return;
  wrap.dataset.frLayoutReady='1';

  const top=wrap.querySelector('.top');
  const stats=wrap.querySelector('.grid');
  const sections=Array.from(wrap.querySelectorAll('.card.section'));
  const byTitle=function(title){
    return sections.find(function(card){
      const h=card.querySelector('h2');
      return h && h.textContent.trim().toLowerCase()===title.toLowerCase();
    });
  };

  const chatCard=byTitle('Minecraft-Chat');
  const controlCard=byTitle('Steuerung');
  const moneyCard=byTitle('Geld senden');
  const commandCard=byTitle('Minecraft-Befehl');
  const eventsCard=byTitle('Ereignisse');

  if(!top || !stats || !chatCard || !controlCard || !moneyCard || !commandCard || !eventsCard) return;

  const screenTab=document.createElement('button');
  screenTab.type='button';
  screenTab.className='fr-tab';
  screenTab.textContent='Bildschirm';
  screenTab.dataset.frTab='screen';

  const screenPanel=document.createElement('section');
  screenPanel.className='fr-panel';
  screenPanel.id='fr-panel-screen';
  screenPanel.innerHTML = "<div class=\"fr-screen\"><div class=\"fr-viewer\"><canvas id=\"fr-viewCanvas\" aria-label=\"3D-Ansicht des Minecraft-Bots\"></canvas><div class=\"fr-view-overlay\"><div class=\"fr-view-top\"><div class=\"fr-view-badge\" id=\"fr-viewStatus\">Warte auf Bot…</div><div class=\"fr-view-badge\">3D · Live</div></div><div class=\"fr-crosshair\"></div></div></div></div>";
  const tabs=document.createElement('nav');
  tabs.className='fr-tabs';
  tabs.setAttribute('aria-label','FrozenRun Bereiche');

  const chatTab=document.createElement('button');
  chatTab.type='button';
  chatTab.className='fr-tab active';
  chatTab.textContent='Chat';
  chatTab.dataset.frTab='chat';

  const controlTab=document.createElement('button');
  controlTab.type='button';
  controlTab.className='fr-tab';
  controlTab.textContent='Steuerung';
  controlTab.dataset.frTab='control';

  tabs.append(chatTab,screenTab,controlTab);
  top.insertAdjacentElement('afterend',tabs);

  const chatPanel=document.createElement('section');
  chatPanel.className='fr-panel active';
  chatPanel.id='fr-panel-chat';

  const controlPanel=document.createElement('section');
  controlPanel.className='fr-panel';
  controlPanel.id='fr-panel-control';

  const controlLayout=document.createElement('div');
  controlLayout.className='fr-control-layout';

  const dataCard=document.createElement('div');
  dataCard.className='card';
  const dataTitle=document.createElement('h2');
  dataTitle.textContent='Daten';
  dataTitle.style.marginTop='0';
  dataCard.appendChild(dataTitle);
  dataCard.appendChild(stats);

  const commandTitle=commandCard.querySelector('h2');
  if(commandTitle) commandTitle.textContent='Befehlszeile';
  const commandInput=commandCard.querySelector('#commandInput');
  if(commandInput) commandInput.placeholder='/spawn oder /money';

  const note=document.createElement('div');
  note.className='fr-note';
  note.textContent='Befehle können mit oder ohne führendes / eingegeben werden.';
  commandCard.classList.add('fr-command');
  const commandForms=commandCard.querySelector('.forms');
  if(commandForms) commandForms.insertAdjacentElement('afterend',note);

  chatPanel.appendChild(chatCard);
  controlLayout.appendChild(dataCard);
  controlLayout.appendChild(controlCard);
  controlLayout.appendChild(commandCard);
  controlPanel.appendChild(controlLayout);
  controlPanel.appendChild(moneyCard);
  controlPanel.appendChild(eventsCard);

  const auth=wrap.querySelector('#auth');
  if(auth){
    auth.insertAdjacentElement('afterend',chatPanel);
    chatPanel.insertAdjacentElement('afterend',controlPanel);
    controlPanel.insertAdjacentElement('afterend',screenPanel);
  }else{
    tabs.insertAdjacentElement('afterend',chatPanel);
    chatPanel.insertAdjacentElement('afterend',controlPanel);
  }

  function activate(name){
    const chat=name==='chat';
    const control=name==='control';
    const screen=name==='screen';
    chatTab.classList.toggle('active',chat);
    controlTab.classList.toggle('active',control);
    screenTab.classList.toggle('active',screen);
    chatPanel.classList.toggle('active',chat);
    controlPanel.classList.toggle('active',control);
    screenPanel.classList.toggle('active',screen);
    if(screen) window.dispatchEvent(new Event('resize'));
  }

  chatTab.addEventListener('click',function(){activate('chat');});
  controlTab.addEventListener('click',function(){activate('control');});
  screenTab.addEventListener('click',function(){activate('screen');});
const viewCanvas=document.getElementById('fr-viewCanvas');
  const viewStatus=document.getElementById('fr-viewStatus');
  let viewState={position:{x:0,y:0,z:0},rotation:{yaw:0,pitch:0,headYaw:0},online:false};
  let three=null,scene=null,camera=null,renderer=null,worldGroup=null,botMarker=null,raf=0;

  function dispose3D(){
    if(raf) cancelAnimationFrame(raf);
    raf=0;
    if(renderer){renderer.dispose();renderer=null;}
    three=null;scene=null;camera=null;worldGroup=null;botMarker=null;
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

      const grassMat=new three.MeshLambertMaterial({color:0x5f8d4e});
      const dirtMat=new three.MeshLambertMaterial({color:0x765638});
      const stoneMat=new three.MeshLambertMaterial({color:0x777b82});
      const leafMat=new three.MeshLambertMaterial({color:0x3e7438});
      const woodMat=new three.MeshLambertMaterial({color:0x7d5736});

      const cubeGeo=new three.BoxGeometry(1,1,1);
      const floor= new three.Mesh(new three.BoxGeometry(80,0.25,80),grassMat);
      floor.position.y=-0.15;
      worldGroup.add(floor);

      for(let x=-18;x<=18;x++){
        for(let z=-18;z<=18;z++){
          if((Math.abs(x)+Math.abs(z))%7===0){
            const block=new three.Mesh(cubeGeo,Math.random()>.55?stoneMat:dirtMat);
            block.position.set(x+0.5,0.5,z+0.5);
            worldGroup.add(block);
          }
        }
      }

      for(let i=0;i<28;i++){
        const x=((i*17)%34)-17, z=((i*29)%34)-17;
        if(Math.abs(x)<3&&Math.abs(z)<3) continue;
        const trunk=new three.Mesh(cubeGeo,woodMat);
        trunk.position.set(x,1,z);
        worldGroup.add(trunk);
        const leaves=new three.Mesh(new three.BoxGeometry(3,2.5,3),leafMat);
        leaves.position.set(x,2.7,z);
        worldGroup.add(leaves);
      }

      botMarker=new three.Group();
      const body=new three.Mesh(new three.BoxGeometry(.65,1.25,.38),new three.MeshLambertMaterial({color:0x6d5dfc}));
      body.position.y=.7;
      botMarker.add(body);
      const head=new three.Mesh(new three.BoxGeometry(.55,.55,.55),new three.MeshLambertMaterial({color:0xd7b38a}));
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
      const p=d.position||{x:0,y:0,z:0};
      const ro=d.rotation||{yaw:0,pitch:0};
      viewStatus.textContent=d.online?'3D-Ansicht · Live':'3D-Ansicht · Bot offline';
    }catch(e){
      viewStatus.textContent='Ansicht nicht erreichbar';
    }
  }

  window.addEventListener('resize',resize3D);
  init3D();
  refreshView();
  setInterval(refreshView,500);
})();
</script>
</body></html>`;
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