// Makes a complete, consistent backup of the runtime data folder.
//   pnpm backup                 → data/backups/ciara-backup-YYYYMMDD-HHMMSS/
//   pnpm backup <target folder> → <target folder>/ciara-backup-YYYYMMDD-HHMMSS/
//
// Why not just copy data/ciara.db?
//   The database runs in WAL (write-ahead log) mode: recent writes live in
//   ciara.db-wal until SQLite folds them into the main file. A plain file copy
//   can miss them, or catch the file mid-write. SQLite's online backup API
//   (better-sqlite3's .backup()) produces a single self-contained ciara.db that
//   includes everything, and it is safe to run while the app is running.
//
// What's included:
//   ciara.db       — all business data (consistent snapshot)
//   secrets.vault  — encrypted API keys/tokens (unlocks with the login password)
//   jwt.secret     — token signing key (optional; without it you just log in again)
//   attachments/   — receipts, invoices, stored emails
//   imports/       — uploaded CSV/report files kept for re-import
//
// Deliberately NOT included:
//   *.pem          — TLS certs are tied to this machine's hostname; regenerate them
//   *.bak-*        — old ad-hoc database copies
//   backups/       — earlier backups
import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";

const DATA_DIR = process.env.DATA_DIR ?? path.resolve(process.cwd(), "../../data");
const dbPath = path.join(DATA_DIR, "ciara.db");
if (!fs.existsSync(dbPath)) {
  console.error(`No database found at ${dbPath}`);
  process.exit(1);
}

const stamp = new Date().toISOString().replace(/[-:]/g, "").replace("T", "-").slice(0, 15);
const targetRoot = process.argv[2] ? path.resolve(process.argv[2]) : path.join(DATA_DIR, "backups");
const out = path.join(targetRoot, `ciara-backup-${stamp}`);
fs.mkdirSync(out, { recursive: true });

// 1. Database: online backup into a fresh single file.
const src = new Database(dbPath, { readonly: true, fileMustExist: true });
await src.backup(path.join(out, "ciara.db"));
src.close();

// Sanity check the copy before declaring success.
const check = new Database(path.join(out, "ciara.db"), { readonly: true });
const integrity = check.pragma("integrity_check", { simple: true });
const txCount = (check.prepare("SELECT COUNT(*) AS n FROM transactions").get() as { n: number }).n;
check.close();
if (integrity !== "ok") {
  console.error(`Backup integrity check FAILED: ${integrity}`);
  process.exit(1);
}

// 2. Loose files and folders.
const copied: string[] = ["ciara.db"];
for (const name of ["secrets.vault", "jwt.secret"]) {
  const p = path.join(DATA_DIR, name);
  if (fs.existsSync(p)) {
    fs.copyFileSync(p, path.join(out, name));
    copied.push(name);
  }
}
for (const dir of ["attachments", "imports"]) {
  const p = path.join(DATA_DIR, dir);
  if (fs.existsSync(p)) {
    fs.cpSync(p, path.join(out, dir), { recursive: true });
    copied.push(`${dir}/`);
  }
}

console.log(`✓ Backup written to ${out}`);
console.log(`  Contents: ${copied.join(", ")}`);
console.log(`  Integrity: ok · ${txCount} transactions`);
console.log(`  This folder holds private data and the encrypted vault. Move it securely and delete stray copies.`);
