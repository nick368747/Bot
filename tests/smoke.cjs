"use strict";
const assert = require("node:assert/strict");
const { spawn } = require("node:child_process");
const os = require("node:os");
const path = require("node:path");
const fs = require("node:fs");
const port = 18000 + (process.pid % 1000);
const temp = fs.mkdtempSync(path.join(os.tmpdir(), "frozenrun-smoke-"));
const password = "ci-smoke-password";
const base = `http://127.0.0.1:${port}`;
const child = spawn(process.execPath, ["index.js"], {
  cwd: process.cwd(),
  env: { ...process.env, PORT: String(port), HOST: "127.0.0.1", WEB_PASSWORD: password,
    DATA_DIR: temp, MC_PROFILES_FOLDER: path.join(temp, "minecraft"),
    DISCORD_TOKEN: "", DISCORD_CLIENT_ID: "", DISCORD_GUILD_ID: "" },
  stdio: ["ignore", "pipe", "pipe"]
});
let logs = "";
child.stdout.on("data", chunk => { logs += chunk.toString(); });
child.stderr.on("data", chunk => { logs += chunk.toString(); });
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
async function request(url, options) { return fetch(base + url, options); }
async function run() {
  try {
    let ready = false;
    for (let i = 0; i < 80; i++) {
      if (child.exitCode !== null) throw new Error("Server exited early: " + logs);
      try { const r = await request("/login"); if (r.status < 500) { ready = true; break; } } catch {}
      await sleep(250);
    }
    assert.equal(ready, true, "HTTP server starts and serves login");
    const unauth = await request("/api/status");
    assert.equal(unauth.status, 401, "dashboard API rejects unauthenticated access");
    const login = await request("/api/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ password }) });
    assert.equal(login.status, 200, "valid login succeeds");
    const cookie = (login.headers.get("set-cookie") || "").split(";")[0];
    assert.match(cookie, /^frozenrun_session=/, "login creates session cookie");
    const authHeaders = { cookie };
    const status = await request("/api/status", { headers: authHeaders });
    assert.equal(status.status, 200, "authenticated status endpoint works");
    const statusData = await status.json();
    assert.equal(typeof statusData.online, "boolean", "status contains online flag");
    const view = await request("/api/view", { headers: authHeaders });
    assert.equal(view.status, 200, "3D status endpoint works");
    assert.equal((await view.json()).enabled, false, "3D is disabled by default");
    const toggleOn = await request("/api/world3d", { method: "POST", headers: { ...authHeaders, origin: base, "content-type": "application/json" }, body: JSON.stringify({ enabled: true }) });
    assert.equal(toggleOn.status, 200, "3D can be enabled");
    assert.equal((await toggleOn.json()).enabled, true);
    const worldPage = await request("/world", { headers: authHeaders, redirect: "manual" });
    assert.ok([200, 302].includes(worldPage.status), "world route responds while enabled");
    const toggleOff = await request("/api/world3d", { method: "POST", headers: { ...authHeaders, origin: base, "content-type": "application/json" }, body: JSON.stringify({ enabled: false }) });
    assert.equal(toggleOff.status, 200, "3D can be disabled");
    assert.equal((await toggleOff.json()).enabled, false);
    const discord = await request("/api/discord/status", { headers: authHeaders });
    assert.equal(discord.status, 200, "Discord status endpoint responds without configured Discord");
    assert.equal((await discord.json()).connected, false, "Discord reports disconnected when no token is configured");
    const dashboard = await request("/", { headers: authHeaders });
    assert.equal(dashboard.status, 200, "dashboard HTML serves");
    const html = await dashboard.text();
    assert.ok(html.includes("System-Ereignisse"), "dashboard retains system events");
    assert.ok(!html.includes("Letzte Discord-/Systemmeldungen"), "duplicate Discord feed is removed");
    assert.ok(!html.includes('id="discordFeed"'), "obsolete duplicate feed element is removed");
    console.log("FrozenRun smoke tests passed: startup, login/session, protected API, status, 3D toggle on/off, Discord status, dashboard HTML.");
  } finally {
    child.kill("SIGTERM");
    await sleep(300);
    fs.rmSync(temp, { recursive: true, force: true });
  }
}
run().catch(error => { console.error(error); process.exitCode = 1; });
