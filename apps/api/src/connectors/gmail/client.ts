// Shared Gmail inbox client — IMAP, READ-ONLY by construction.
//
// Why IMAP + an app password (not the Gmail API): several services (IngramSpark,
// and later others) have no API but send their reports by email. Those emails
// are auto-forwarded (Gmail filter) into a dedicated inbox that Ciara reads.
// An app password needs no Google Cloud project and doesn't expire after 7
// days the way an unpublished OAuth app's tokens do.
//
// The trade-off: an app password is not scoped — Google would allow full
// mailbox access with it. This code is what makes it read-only:
//   • every mailbox is opened with `readOnly: true` (IMAP EXAMINE, not SELECT),
//     so the server itself refuses flag changes, moves and deletes, and reading
//     a message doesn't mark it as read;
//   • the only exported operations are "open read-only and look"; nothing here
//     sends mail (no SMTP at all), moves, labels or deletes.
//
// The password is read from the vault at call time and never stored anywhere
// else, never logged, never returned to the browser.
//
// Gmail IMAP: imap.gmail.com, port 993, TLS. IMAP must be enabled for the account
// (Gmail → Settings → Forwarding and POP/IMAP; it is on by default for new accounts).

import { ImapFlow } from "imapflow";
import { getSecret } from "../../vault/vault.js";

const HOST = "imap.gmail.com";
const PORT = 993;

export class GmailError extends Error {
  constructor(
    message: string,
    /** not_configured | auth_failed | connection_failed */
    public code: string
  ) {
    super(message);
    this.name = "GmailError";
  }
}

function loadCredentials(): { email: string; appPassword: string } {
  const creds = getSecret("gmail")?.credentials; // throws VaultLockedError if locked
  const email = typeof creds?.email === "string" ? creds.email.trim() : "";
  // Google shows app passwords in groups of four ("abcd efgh ijkl mnop"); the spaces aren't part of it.
  const appPassword = typeof creds?.appPassword === "string" ? creds.appPassword.replace(/\s+/g, "") : "";
  if (!email || !appPassword) throw new GmailError("Gmail account is not saved", "not_configured");
  return { email, appPassword };
}

/**
 * Connect, open `mailbox` READ-ONLY, run `fn`, and always log out afterwards.
 * `fn` gets the connected client; callers must only search/fetch with it.
 * Pass "ALL_MAIL" for Gmail's All Mail folder (includes archived mail),
 * falling back to INBOX if it can't be found.
 */
export async function withMailbox<T>(
  mailbox: string,
  fn: (client: ImapFlow, info: { exists: number; path: string }) => Promise<T>
): Promise<T> {
  const { email, appPassword } = loadCredentials();
  const client = new ImapFlow({
    host: HOST,
    port: PORT,
    secure: true,
    auth: { user: email, pass: appPassword },
    // imapflow's own logging would print protocol traffic (incl. the LOGIN
    // exchange) — keep it off so nothing sensitive reaches the logs.
    logger: false,
    disableAutoIdle: true,
  });
  // Network errors after connect are emitted as events; without a listener
  // Node would treat them as an uncaught exception and crash the server.
  client.on("error", () => {});

  try {
    await client.connect();
  } catch (err) {
    if ((err as { authenticationFailed?: boolean }).authenticationFailed) {
      throw new GmailError("Gmail rejected the email address / app password", "auth_failed");
    }
    throw new GmailError(`Could not reach Gmail: ${(err as Error).message}`, "connection_failed");
  }

  try {
    const path = mailbox === "ALL_MAIL" ? (await findAllMailPath(client)) ?? "INBOX" : mailbox;
    const box = await client.mailboxOpen(path, { readOnly: true });
    return await fn(client, { exists: box.exists, path });
  } finally {
    await client.logout().catch(() => client.close());
  }
}

/** Gmail's "All Mail" folder (holds archived mail too), found by its special-use flag. */
export async function findAllMailPath(client: ImapFlow): Promise<string | undefined> {
  const boxes = await client.list();
  return boxes.find((b) => b.specialUse === "\\All")?.path;
}
