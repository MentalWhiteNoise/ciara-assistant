// Read-only inventory of one service's emails in the shared reports inbox.
//
// Purpose: before writing an importer, see exactly what a service sends (senders,
// subject patterns, attachment names/types, date range) — both the emails that
// arrive by auto-forwarding and the backlog that was forwarded as .eml files
// attached to one email.
//
// What it finds:
//   • direct emails         — From matches the service (Gmail auto-forwarding
//                             keeps the original sender)
//   • wrapper emails        — any email with an attached .eml; each attached email
//                             is opened (recursively — an .eml can contain .eml)
//
// Nothing in Gmail is changed: the mailbox is opened read-only (see client.ts).
// By default nothing is written to disk either. With `save: true` ONLY that
// service's emails (not the wrapper, not anything else in the inbox) are copied
// to data/imports/<service>/inbox/ so a parser can be designed against real files.

import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { simpleParser, type ParsedMail } from "mailparser";
import { withMailbox } from "./client.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dataDir = process.env.DATA_DIR ?? path.resolve(__dirname, "../../../../../data");

/**
 * Services that can be scanned. `query` is a Gmail search (anything carrying an
 * attached email is always included, for forwarded backlogs); `sender` decides
 * which emails — direct or attached — belong to the service.
 */
export const SCAN_SERVICES = {
  ingramspark: { label: "IngramSpark", query: "from:ingram", sender: /ingram/i, dir: "ingram" },
  "48hr_books": { label: "48HR Books", query: "from:48hrbooks OR from:48hr OR 48hrbooks", sender: /48\s*h(ou)?r/i, dir: "48hr" },
} as const;
export type ScanService = keyof typeof SCAN_SERVICES;
const MAX_MESSAGES = 500;
const MAX_DEPTH = 4;

export interface ScannedAttachment {
  filename: string;
  contentType: string;
  size: number;
  sha256: string;
}

export interface ScannedEmail {
  /** "direct" = found in the mailbox; "attached" = found inside an .eml attachment */
  source: "direct" | "attached";
  /** Subject of the wrapper email it was found in (attached only). */
  wrapperSubject: string | null;
  messageId: string | null;
  date: string | null;
  from: string;
  subject: string;
  /** Subject with digits replaced by # — groups the same kind of report together. */
  subjectPattern: string;
  attachments: ScannedAttachment[];
  matches: boolean;
  savedTo: string | null;
}

export interface ScanResult {
  mailbox: string;
  mailboxMessages: number;
  matchedMessages: number;
  truncated: boolean;
  service: string;
  /** The service's emails, de-duplicated by Message-ID, oldest first. */
  emails: ScannedEmail[];
  /** Same email seen more than once (e.g. forwarded twice) — skipped. */
  duplicates: number;
  /** Other emails found inside wrappers — listed so nothing is silently missed. */
  otherAttachedEmails: Pick<ScannedEmail, "date" | "from" | "subject" | "wrapperSubject">[];
  patterns: { subjectPattern: string; from: string; count: number; first: string | null; last: string | null; attachmentTypes: string[] }[];
  saved: number;
  saveDir: string | null;
}

const sha256 = (buf: Buffer) => createHash("sha256").update(buf).digest("hex");
const isEmlAttachment = (a: { contentType: string; filename?: string }) =>
  a.contentType === "message/rfc822" || /\.eml$/i.test(a.filename ?? "");

function fromText(mail: ParsedMail): string {
  const from = mail.from;
  if (!from) return "";
  return Array.isArray(from) ? from.map((f) => f.text).join(", ") : from.text;
}

/** Walk one parsed email: record it, then open any attached emails inside it. */
async function walk(
  matchSender: RegExp,
  mail: ParsedMail,
  raw: Buffer,
  source: "direct" | "attached",
  wrapperSubject: string | null,
  depth: number,
  out: { email: ScannedEmail; raw: Buffer; parsed: ParsedMail }[]
) {
  const from = fromText(mail);
  const subject = mail.subject ?? "";
  const nonEml = mail.attachments.filter((a) => !isEmlAttachment(a));
  out.push({
    email: {
      source,
      wrapperSubject,
      messageId: mail.messageId ?? null,
      date: mail.date ? mail.date.toISOString() : null,
      from,
      subject,
      subjectPattern: subject.replace(/\d+/g, "#"),
      attachments: nonEml.map((a) => ({
        filename: a.filename ?? "(no name)",
        contentType: a.contentType,
        size: a.size,
        sha256: sha256(a.content),
      })),
      matches: matchSender.test(from),
      savedTo: null,
    },
    raw,
    parsed: mail,
  });

  if (depth >= MAX_DEPTH) return;
  for (const a of mail.attachments.filter(isEmlAttachment)) {
    const inner = await simpleParser(a.content);
    // Attached emails are reported against the outermost email that holds them.
    await walk(matchSender, inner, a.content, "attached", wrapperSubject ?? subject, depth + 1, out);
  }
}

function safeName(s: string) {
  return s.replace(/[^\w.-]+/g, "_").replace(/_+/g, "_").slice(0, 80) || "file";
}

function saveEmail(saveDir: string, email: ScannedEmail, raw: Buffer, parsed: ParsedMail): string {
  const day = email.date?.slice(0, 10) ?? "undated";
  const dir = path.join(saveDir, `${day}_${safeName(email.subject)}_${sha256(raw).slice(0, 8)}`);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "message.eml"), raw);
  for (const a of parsed.attachments.filter((x) => !isEmlAttachment(x))) {
    fs.writeFileSync(path.join(dir, safeName(a.filename ?? "attachment")), a.content);
  }
  return path.relative(dataDir, dir);
}

export async function scanInbox(service: ScanService, { save = false } = {}): Promise<ScanResult> {
  const cfg = SCAN_SERVICES[service];
  const saveDir = path.join(dataDir, "imports", cfg.dir, "inbox");
  return withMailbox("ALL_MAIL", async (client, { exists, path: mailbox }) => {
    const found = await client.search({ gmraw: `${cfg.query} OR filename:eml` }, { uid: true });
    const uids = Array.isArray(found) ? found : [];
    const truncated = uids.length > MAX_MESSAGES;
    const take = uids.slice(-MAX_MESSAGES); // newest MAX_MESSAGES

    const collected: { email: ScannedEmail; raw: Buffer; parsed: ParsedMail }[] = [];
    if (take.length > 0) {
      // Fetching the full message in a read-only mailbox doesn't mark it as read.
      for await (const msg of client.fetch(take, { uid: true, source: true }, { uid: true })) {
        if (!msg.source) continue;
        const parsed = await simpleParser(msg.source);
        await walk(cfg.sender, parsed, msg.source, "direct", null, 0, collected);
      }
    }

    // De-duplicate by Message-ID (fallback: hash of the raw email).
    const seen = new Set<string>();
    const ingram: typeof collected = [];
    let duplicates = 0;
    for (const c of collected.filter((x) => x.email.matches)) {
      const key = c.email.messageId ?? sha256(c.raw);
      if (seen.has(key)) {
        duplicates++;
        continue;
      }
      seen.add(key);
      ingram.push(c);
    }
    ingram.sort((a, b) => (a.email.date ?? "").localeCompare(b.email.date ?? ""));

    let saved = 0;
    if (save) {
      for (const c of ingram) {
        c.email.savedTo = saveEmail(saveDir, c.email, c.raw, c.parsed);
        saved++;
      }
    }

    // Group by sender + subject pattern — this is what the filter/parser design needs.
    const groups = new Map<string, ScanResult["patterns"][number]>();
    for (const { email } of ingram) {
      const key = `${email.from}|${email.subjectPattern}`;
      const g = groups.get(key) ?? {
        subjectPattern: email.subjectPattern,
        from: email.from,
        count: 0,
        first: email.date,
        last: email.date,
        attachmentTypes: [],
      };
      g.count++;
      g.last = email.date;
      for (const a of email.attachments) {
        const ext = path.extname(a.filename).toLowerCase() || a.contentType;
        if (!g.attachmentTypes.includes(ext)) g.attachmentTypes.push(ext);
      }
      groups.set(key, g);
    }

    const otherAttachedEmails = collected
      .filter((c) => c.email.source === "attached" && !c.email.matches)
      .map(({ email }) => ({ date: email.date, from: email.from, subject: email.subject, wrapperSubject: email.wrapperSubject }));

    return {
      mailbox,
      mailboxMessages: exists,
      matchedMessages: uids.length,
      truncated,
      service: cfg.label,
      emails: ingram.map((c) => c.email),
      duplicates,
      otherAttachedEmails,
      patterns: [...groups.values()].sort((a, b) => b.count - a.count),
      saved,
      saveDir: save ? path.relative(dataDir, saveDir) : null,
    };
  });
}
