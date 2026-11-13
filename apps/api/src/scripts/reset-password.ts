// Reset the master (login) password from the command line.
//
// Use this when you've forgotten the password and can't log in.
// Run from apps/api:   pnpm reset-password
//
// What it does:
//   1. Asks for a new password (typed twice, hidden).
//   2. Replaces the Argon2id hash in the `users` table.
//   3. Deletes all refresh tokens, so every existing session is logged out.
//   4. If a secrets vault exists, it was encrypted with the OLD password and
//      can't be opened any more. It is renamed (not deleted) to
//      secrets.vault.orphaned-<timestamp> so a fresh, empty vault is created on
//      next login. You'll need to re-enter integration credentials.
//
// Why this is "safe enough": anyone who can run this script already has
// access to the data/ folder on this machine, which means they could read
// ciara.db directly anyway. The vault is the part that stays protected —
// which is exactly why it can't be recovered without the old password.
//
// Stop the API server (pnpm dev) before running this.

import { existsSync, renameSync } from "fs";
import path from "path";
import { hashPassword } from "../auth/password.js";
import { rawDb } from "../db/client.js";

const DATA_DIR = process.env.DATA_DIR ?? path.resolve(process.cwd(), "../../data");
const VAULT_PATH = path.join(DATA_DIR, "secrets.vault");
const MIN_LENGTH = 8; // matches the rule in POST /auth/setup

/**
 * Read one line from the terminal without echoing it.
 * Falls back to visible input when stdin isn't an interactive terminal
 * (some Windows shells, or when input is piped in).
 */
function promptHidden(question: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const stdin = process.stdin;
    process.stdout.write(question);

    if (!stdin.isTTY) {
      process.stdout.write("(input will be visible) ");
      let buf = "";
      const onData = (chunk: Buffer) => {
        buf += chunk.toString("utf8");
        const nl = buf.indexOf("\n");
        if (nl !== -1) {
          stdin.off("data", onData);
          stdin.pause();
          resolve(buf.slice(0, nl).replace(/\r$/, ""));
        }
      };
      stdin.on("data", onData);
      stdin.resume();
      return;
    }

    let input = "";
    stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding("utf8");

    const onData = (ch: string) => {
      for (const c of ch) {
        if (c === "\r" || c === "\n") {
          finish();
          resolve(input);
          return;
        } else if (c === "\u0003") {
          // Ctrl+C
          finish();
          reject(new Error("Cancelled"));
          return;
        } else if (c === "\u0008" || c === "\u007f") {
          // Backspace
          if (input.length > 0) {
            input = input.slice(0, -1);
            process.stdout.write("\b \b");
          }
        } else {
          input += c;
          process.stdout.write("*");
        }
      }
    };

    const finish = () => {
      stdin.setRawMode(false);
      stdin.pause();
      stdin.off("data", onData);
      process.stdout.write("\n");
    };

    stdin.on("data", onData);
  });
}

async function main() {
  const user = rawDb
    .prepare("SELECT id, display_name FROM users LIMIT 1")
    .get() as { id: string; display_name: string } | undefined;

  if (!user) {
    console.log("No user exists yet — just open the app and use the setup page.");
    return;
  }

  console.log(`\nResetting master password for "${user.display_name}".`);
  if (existsSync(VAULT_PATH)) {
    console.log(
      "\n⚠  A secrets vault exists. It is encrypted with the old password and\n" +
        "   cannot be recovered. It will be set aside and a new empty vault\n" +
        "   created on next login — you'll need to re-enter integration keys.\n"
    );
  }

  const pw1 = await promptHidden("New password: ");
  if (pw1.length < MIN_LENGTH) {
    console.error(`Password must be at least ${MIN_LENGTH} characters. Nothing changed.`);
    process.exitCode = 1;
    return;
  }
  const pw2 = await promptHidden("Confirm new password: ");
  if (pw1 !== pw2) {
    console.error("Passwords don't match. Nothing changed.");
    process.exitCode = 1;
    return;
  }

  const passwordHash = await hashPassword(pw1);

  // One transaction: either both changes happen or neither does.
  const reset = rawDb.transaction(() => {
    rawDb
      .prepare("UPDATE users SET password_hash = ?, updated_at = datetime('now') WHERE id = ?")
      .run(passwordHash, user.id);
    const { changes } = rawDb.prepare("DELETE FROM refresh_tokens").run();
    return changes;
  });
  const sessionsCleared = reset();

  let vaultNote = "";
  if (existsSync(VAULT_PATH)) {
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const orphan = `${VAULT_PATH}.orphaned-${stamp}`;
    renameSync(VAULT_PATH, orphan);
    vaultNote = `\n  Old vault moved to: ${orphan}`;
  }

  console.log(
    `\n✓ Password updated.` +
      `\n  Sessions logged out: ${sessionsCleared}` +
      vaultNote +
      `\n\nStart the app and log in with the new password.`
  );
}

main()
  .catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exitCode = 1;
  })
  .finally(() => rawDb.close());
