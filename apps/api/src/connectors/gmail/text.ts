// Readable text from an email: its plain-text part, or its HTML with the tags
// stripped (some senders, e.g. 48HR Books, send HTML only).

import type { ParsedMail } from "mailparser";

/** HTML email body → plain lines (no tags, entities decoded, blanks dropped). */
export function htmlToLines(html: string): string[] {
  const text = html
    .replace(/<(style|script)[\s\S]*?<\/\1>/gi, "")
    .replace(/<br\s*\/?>|<\/(p|div|tr|li|h\d|table|td|th)>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;|&#160;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&#36;/g, "$")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&rsquo;|&#8217;/g, "'");
  return text.split(/\n/).map((l) => l.replace(/\s+/g, " ").trim()).filter(Boolean);
}

/** The email's text as trimmed, non-empty lines (HTML part used when there's no text part). */
export function emailLines(mail: ParsedMail): string[] {
  if (mail.html) return htmlToLines(String(mail.html));
  return (mail.text ?? "").split(/\n/).map((l) => l.trim()).filter(Boolean);
}
