# Ciara Assistant

Personal business management for a self-published author / freelance artist:
sales, expenses, inventory, imports from publishing and payment platforms,
tasks, calendar and reports.

Local-first and single-user. The app runs as a small web server on one machine
and is used from a browser on that machine or on any phone/tablet on the same
network. All data lives in one folder (`data/`) on that machine.

Planning and design docs are in [`docs/`](docs/). Start with
[`docs/ROADMAP.md`](docs/ROADMAP.md).

---

## Requirements

| Tool | Version | Notes |
|------|---------|-------|
| Node.js | 22 or newer (24 works) | <https://nodejs.org> (LTS installer) |
| pnpm | 10.x | Enable with `corepack enable` (ships with Node) |
| Git | any recent | |
| mkcert | any | Optional, for HTTPS. <https://github.com/FiloSottile/mkcert> |

`better-sqlite3` and `@node-rs/argon2` ship prebuilt binaries for Windows,
macOS and Linux (x64/arm64), so no compiler is normally needed. If
`pnpm install` reports a failed native build, install build tools
(Windows: "Desktop development with C++" from Visual Studio Build Tools;
Debian/Ubuntu: `sudo apt install build-essential python3`) and re-run it.

---

## Installation

```bash
git clone https://github.com/MentalWhiteNoise/ciara-assistant.git
cd ciara-assistant
corepack enable          # makes the pnpm version pinned in package.json available
pnpm install
```

Then choose one of the two options below.

### Option A: Fresh install (empty database)

```bash
cd apps/api
pnpm db:migrate          # creates data/ciara.db with the full schema
pnpm db:seed             # tax categories, sales channels, event types
cd ../..
```

The first time you open the app it shows a **Setup** page where you create the
login password.

### Option B: Restore from a backup (moving to a new machine)

See [Moving to a new server](#moving-to-a-new-server) below.

### HTTPS (recommended)

The app runs over plain HTTP if no certificate is present. HTTPS is needed for
installing it as an app (PWA) on a phone/tablet and for secure cookies over the
LAN. The certificates are tied to the machine's name and IP, so generate new
ones on every machine. Do not copy them from the old one.

```bash
mkcert -install          # one time: trust mkcert's local CA on this machine
mkcert -cert-file data/ciara.pem -key-file data/ciara-key.pem \
  localhost 127.0.0.1 ciara.local <this-machine's-hostname> <this-machine's-LAN-IP>
```

To use HTTPS from a phone/tablet without warnings, install mkcert's root CA on
that device too. `mkcert -CAROOT` prints where `rootCA.pem` lives.

Both servers pick up the certs automatically from `data/` on the next start.

---

## Running

```bash
pnpm dev
```

This starts both parts together:

| Part | Address | |
|------|---------|---|
| Web app | `https://<machine>:5173` | Open this in the browser |
| API | `https://<machine>:3001` | Used by the web app; no need to open it |

(`http://` instead if no certificates are installed. If port 5173 is busy, Vite
uses 5174 and prints the address.)

Both bind to all network interfaces, so other devices on the LAN can reach the
app at the machine's IP. Allow ports 5173 and 3001 through the machine's
firewall for LAN access.

Environment overrides (all optional): `PORT` (API port, default 3001), `HOST`
(default `0.0.0.0`), `DATA_DIR` (default `<repo>/data`).

### Useful commands

```bash
pnpm typecheck                     # type-check all packages
cd apps/api && pnpm test           # unit tests (parsers etc.)
cd apps/api && pnpm db:migrate     # apply new migrations after pulling updates
cd apps/api && pnpm db:studio      # browse the database in Drizzle Studio
cd apps/api && pnpm backup         # back up all runtime data (see below)
cd apps/api && pnpm reset-password # reset a forgotten login password
```

### After pulling updates

```bash
git pull
pnpm install
cd apps/api && pnpm backup && pnpm db:migrate
```

---

## The `data/` folder

Everything private lives in `data/` at the repo root. It is gitignored and is
**never** committed.

| Path | What it is | Needed on a new machine? |
|------|-----------|-----------|
| `ciara.db` (+ `-wal`, `-shm`) | The SQLite database: all business data | **Yes** |
| `secrets.vault` | Encrypted API keys and tokens for integrations. Unlocked with the login password. | **Yes** (otherwise re-enter every integration credential) |
| `attachments/` | Receipts, invoices, stored emails | **Yes** |
| `imports/` | Uploaded report files (KDP, Chase, ...) kept for re-import | Yes |
| `jwt.secret` | Login-session signing key | Optional (a new one is generated; you just log in again) |
| `ciara.pem`, `ciara-key.pem` | TLS certificate | **No**: regenerate per machine |
| `backups/` | Output of `pnpm backup` | No |

---

## Backups

```bash
cd apps/api
pnpm backup                      # → data/backups/ciara-backup-YYYYMMDD-HHMMSS/
pnpm backup "D:/Some/Other/Dir"  # → that folder instead
```

The database runs in SQLite's WAL mode, where recent changes sit in
`ciara.db-wal` until they are merged into the main file. **Copying `ciara.db`
by hand can silently lose those changes.** `pnpm backup` uses SQLite's online
backup API instead. It writes one complete `ciara.db` (safe while the app is
running), checks its integrity, and copies the vault, `jwt.secret`,
`attachments/` and `imports/` next to it.

A backup folder contains all business data plus the encrypted vault. Store it
somewhere private. If you put it in cloud storage, encrypt it first (for
example a password-protected 7-Zip archive with AES-256).

---

## Moving to a new server

**On the old machine**

1. Commit and push any code changes: `git push`.
2. Stop the app (Ctrl+C in the `pnpm dev` window), so nothing changes after the backup.
3. Make a backup: `cd apps/api && pnpm backup`.
4. Zip the printed `ciara-backup-...` folder and move it to the new machine
   (USB drive, or a direct network copy). Avoid email or public cloud links.

**On the new machine**

1. Follow [Installation](#installation) up to and including `pnpm install`.
   **Skip** `db:migrate` / `db:seed` for now.
2. Create `data/` at the repo root and copy the **contents** of the backup
   folder into it, giving `data/ciara.db`, `data/secrets.vault`,
   `data/attachments/` and so on.
3. Apply any migrations newer than the backup (safe if there are none):
   `cd apps/api && pnpm db:migrate`
4. Generate new TLS certificates for this machine (see [HTTPS](#https-recommended)).
5. `pnpm dev`, open the web app, and log in with the **same password** as
   before. Logging in also unlocks the vault, so the integrations should show as
   connected under Settings → Integrations.
6. Once everything checks out, delete the zip and any stray copies of the backup.

If the login password is lost, `pnpm reset-password` sets a new one, but the
vault is encrypted with the old password and can't be recovered. You would
need to re-enter the integration credentials.
