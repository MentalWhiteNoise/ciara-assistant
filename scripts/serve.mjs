// Runs the API and the web app as one unattended process, for the boot task
// created by install-autostart.ps1. For development, use `pnpm dev` instead.
//
//   node scripts/serve.mjs
//
// Differences from `pnpm dev`:
//   - Output goes to data/logs/server.log (previous run: server.prev.log).
//   - The API does not restart when its source changes. A restart locks the
//     vault, so after changing or pulling API code, restart the task yourself.
//   - If either part stops, both stop and this exits with an error. The task
//     then starts everything again within a minute.

import { spawn, spawnSync } from "node:child_process";
import { createWriteStream, existsSync, mkdirSync, renameSync, rmSync } from "node:fs";
import net from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const API_PORT = Number(process.env.PORT ?? 3001);
const WEB_PORT = 5174; // must match apps/web/vite.config.ts

function portInUse(port) {
  return new Promise((resolve) => {
    const socket = net.connect({ port, host: "127.0.0.1" });
    socket.setTimeout(2000);
    const done = (inUse) => { socket.destroy(); resolve(inUse); };
    socket.once("connect", () => done(true));
    socket.once("timeout", () => done(false));
    socket.once("error", () => done(false));
  });
}

// Check BEFORE starting the API. While starting, it marks running sync jobs as
// interrupted and creates reminders, so a second copy must never get that far
// when `pnpm dev` is already running. Also leaves the running copy's log alone.
for (const port of [API_PORT, WEB_PORT]) {
  if (await portInUse(port)) {
    console.error(`Port ${port} is already in use. Not starting.`);
    process.exit(1);
  }
}

// ── Log file ─────────────────────────────────────────────────────────────────
const logDir = path.join(root, "data", "logs");
const logFile = path.join(logDir, "server.log");
const prevLog = path.join(logDir, "server.prev.log");
mkdirSync(logDir, { recursive: true });
if (existsSync(logFile)) {
  rmSync(prevLog, { force: true });
  renameSync(logFile, prevLog);
}
const log = createWriteStream(logFile);
const say = (msg) => log.write(`[serve] ${new Date().toISOString()} ${msg}\n`);

// ── Child processes ──────────────────────────────────────────────────────────
const children = [];
let stopping = false;

function stopAll(code) {
  if (stopping) return;
  stopping = true;
  for (const child of children) {
    if (child.exitCode !== null || !child.pid) continue;
    if (process.platform === "win32") {
      // Vite starts helpers (esbuild); /T ends the whole tree.
      spawnSync("taskkill", ["/PID", String(child.pid), "/T", "/F"], { windowsHide: true });
    } else {
      child.kill();
    }
  }
  log.end(() => process.exit(code));
}

function run(name, cwd, args) {
  const child = spawn(process.execPath, args, {
    cwd: path.join(root, cwd),
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
    env: { ...process.env, NO_COLOR: "1" },
  });
  children.push(child);
  child.stdout.pipe(log, { end: false });
  child.stderr.pipe(log, { end: false });
  child.once("error", (err) => { say(`${name} failed to start: ${err.message}`); stopAll(1); });
  child.once("exit", (code, signal) => {
    if (stopping) return;
    say(`${name} stopped (${signal ?? `code ${code}`}); shutting down`);
    stopAll(1);
  });
}

for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => stopAll(0));

say(`starting (node ${process.version})`);
run("api", "apps/api", ["--import", "tsx/esm", "src/index.ts"]);
run("web", "apps/web", ["node_modules/vite/bin/vite.js"]);
