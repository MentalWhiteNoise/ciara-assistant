// Unpacks an email into itself plus every email attached to it (.eml /
// message/rfc822), recursively. Used for the backlog that was forwarded as
// .eml attachments: each attached email is handled exactly like one that
// arrived directly.

import { simpleParser, type ParsedMail } from "mailparser";

const MAX_DEPTH = 4;

export interface UnpackedEmail {
  raw: Buffer;
  parsed: ParsedMail;
  /** "direct" = the email itself; "attached" = found inside an attachment */
  source: "direct" | "attached";
}

export const isEmlAttachment = (a: { contentType: string; filename?: string }) =>
  a.contentType === "message/rfc822" || /\.eml$/i.test(a.filename ?? "");

export function fromText(mail: ParsedMail): string {
  const from = mail.from;
  if (!from) return "";
  return Array.isArray(from) ? from.map((f) => f.text).join(", ") : from.text;
}

export async function unpackEmail(raw: Buffer): Promise<UnpackedEmail[]> {
  const out: UnpackedEmail[] = [];
  const walk = async (buf: Buffer, source: UnpackedEmail["source"], depth: number) => {
    const parsed = await simpleParser(buf);
    out.push({ raw: buf, parsed, source });
    if (depth >= MAX_DEPTH) return;
    for (const a of parsed.attachments.filter(isEmlAttachment)) await walk(a.content, "attached", depth + 1);
  };
  await walk(raw, "direct", 0);
  return out;
}
