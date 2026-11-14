// Wise email parsing — pure functions, no database, no network.
//
// Wise sends from noreply@wise.com (transactional), noreply@info.wise.com and
// info@wise.com (marketing). Kinds found by the 2026-11-14 inbox scan:
//   • transfer_sent — "Transfer sent (#<number>)". Body: "<amount> <CUR> is
//     now in <Recipient>'s account." plus "Amount: … Wise fee: … Transfer
//     Number: #…". Older emails put each value on its own line; newer ones
//     shout the first sentence in capitals (so the recipient's name may be
//     ALL CAPS).
//   • transfer_problem — "There's a problem with your transfer (#<number>)":
//     Wise paused it (e.g. a personal transfer paid from a business bank
//     account). It may later be sent, cancelled or redone under a new number.
//   • everything else (tips, marketing, bank reconnect notices) — ignored.
//
// When the Wise API is connected later, transfers will be matched by the same
// transfer number, so nothing is imported twice.

export type WiseEmailKind = "transfer_sent" | "transfer_problem" | "other";

export function isWiseSender(from: string) {
  return /@([\w-]+\.)*(wise|transferwise)\.com\b/i.test(from);
}

export function transferNumberFrom(subject: string): string | null {
  return /\(#\s*(\d{6,})\)/.exec(subject)?.[1] ?? null;
}

export function classifyWiseEmail(from: string, subject: string): WiseEmailKind {
  if (!isWiseSender(from) || !transferNumberFrom(subject)) return "other";
  if (/^transfer sent\b/i.test(subject.trim())) return "transfer_sent";
  if (/problem with your transfer/i.test(subject)) return "transfer_problem";
  return "other";
}

export interface WiseTransferSent {
  transferNumber: string;
  recipient: string;
  amount: number;
  currency: string;
  fee: number;
  feeCurrency: string;
}

const num = (s: string) => {
  const n = parseFloat(s.replace(/,/g, ""));
  return Number.isFinite(n) ? n : 0;
};

/** "AKURISTAXX" → "Akuristaxx"; mixed-case names are left alone. */
function tidyName(name: string): string {
  const n = name.trim().replace(/\s+/g, " ");
  if (n !== n.toUpperCase()) return n;
  return n.toLowerCase().replace(/(^|[\s\-'])(\p{L})/gu, (_m, sep: string, c: string) => sep + c.toUpperCase());
}

export function parseTransferSent(subject: string, text: string): WiseTransferSent | null {
  const transferNumber = transferNumberFrom(subject);
  if (!transferNumber) return null;
  const flat = text.replace(/\s+/g, " ");

  // "212.50 USD is now in Syeda Tayyba Ali's account."
  const head = /([\d,]+(?:\.\d+)?)\s+([A-Z]{3})\s+is now in\s+(.+?)['’]s account/i.exec(flat);
  if (!head) return null;
  const amountLine = /Amount:\s*([\d,]+(?:\.\d+)?)\s+([A-Z]{3})/i.exec(flat);
  const feeLine = /Wise fee:\s*([\d,]+(?:\.\d+)?)\s+([A-Z]{3})/i.exec(flat);

  return {
    transferNumber,
    recipient: tidyName(head[3]),
    amount: num(amountLine?.[1] ?? head[1]),
    currency: (amountLine?.[2] ?? head[2]).toUpperCase(),
    fee: feeLine ? num(feeLine[1]) : 0,
    feeCurrency: (feeLine?.[2] ?? amountLine?.[2] ?? head[2]).toUpperCase(),
  };
}
