// Chase credit card "Download account activity" CSV → rows.
//
// The file looks like:
//   Transaction Date,Post Date,Description,Category,Type,Amount,Memo
//   12/29/2025,12/30/2025,DD *DOORDASH LEOSITALI,Food & Drink,Sale,-81.45,
//
//   • Amount is negative for charges (Type "Sale", "Fee") and positive for
//     money back ("Return") and card payments ("Payment").
//   • Category is Chase's own guess (Shopping, Gas, …), kept as a hint only.
//   • Descriptions contain HTML entities ("BLACK CAT BOOKS &amp; ODD").
//   • No transaction ID. The same charge can appear twice in one file (two
//     identical coffees on one day), so a row's identity is its content PLUS
//     which occurrence it is within the file: the 2nd identical row is "#2".
//     Downloads that overlap then agree on every ID, and a file with a real
//     duplicate still keeps both copies.
//
// Chase downloads only reach back about two years; older months come from the
// PDF statements (parsed separately) and use the same row IDs where they can.

export interface ChaseRow {
  /** Stable identity, e.g. "row:2025-12-29|2025-12-30|DD *DOORDASH LEOSITALI|-81.45#1". */
  externalId: string;
  /** ISO date the purchase was made. */
  transactionDate: string;
  /** ISO date Chase posted it (null when the source doesn't say, e.g. some PDFs). */
  postDate: string | null;
  /** Description with HTML entities decoded. */
  description: string;
  chaseCategory: string | null;
  type: "Sale" | "Return" | "Payment" | "Fee" | "Adjustment" | string;
  /** Signed, as Chase shows it: negative = money out. */
  amount: number;
  memo: string | null;
}

export interface ParsedChaseFile {
  /** Last four of the card, from the file name "Chase9762_Activity_…" (null if not in the name). */
  account: string | null;
  rows: ChaseRow[];
  firstDate: string | null;
  lastDate: string | null;
}

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", "#39": "'" };

export function decodeEntities(s: string): string {
  return s.replace(/&(amp|lt|gt|quot|apos|#39);/g, (_, e: string) => ENTITIES[e]);
}

/** "12/29/2025" → "2025-12-29" */
function isoDate(us: string): string {
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(us.trim());
  if (!m) throw new Error(`Unexpected date "${us}"`);
  return `${m[3]}-${m[1].padStart(2, "0")}-${m[2].padStart(2, "0")}`;
}

/** Minimal CSV line splitter (Chase doesn't quote today, but a merchant with a comma would be). */
function splitCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (quoted) {
      if (c === '"' && line[i + 1] === '"') { cur += '"'; i++; }
      else if (c === '"') quoted = false;
      else cur += c;
    } else if (c === '"') quoted = true;
    else if (c === ",") { out.push(cur); cur = ""; }
    else cur += c;
  }
  out.push(cur);
  return out;
}

const HEADER = ["Transaction Date", "Post Date", "Description", "Category", "Type", "Amount", "Memo"];

/** Builds the stable row ID; `seen` counts occurrences of identical rows within one file. */
export function rowIdentity(
  r: Pick<ChaseRow, "transactionDate" | "postDate" | "description" | "amount">,
  seen: Map<string, number>,
): string {
  const key = `${r.transactionDate}|${r.postDate ?? ""}|${r.description}|${r.amount.toFixed(2)}`;
  const n = (seen.get(key) ?? 0) + 1;
  seen.set(key, n);
  return `row:${key}#${n}`;
}

export function parseChaseCsv(text: string, fileName = ""): ParsedChaseFile {
  const lines = text.replace(/^﻿/, "").split(/\r?\n/).filter((l) => l.trim() !== "");
  if (lines.length === 0) throw new Error("The file is empty.");
  const header = splitCsvLine(lines[0]).map((h) => h.trim());
  const col = (name: string) => header.indexOf(name);
  const missing = HEADER.slice(0, 6).filter((h) => col(h) < 0);
  if (missing.length) {
    throw new Error(`This doesn't look like a Chase credit card activity download (missing column${missing.length > 1 ? "s" : ""}: ${missing.join(", ")}).`);
  }

  const seen = new Map<string, number>();
  const rows: ChaseRow[] = [];
  for (let i = 1; i < lines.length; i++) {
    const f = splitCsvLine(lines[i]);
    const amount = Number(f[col("Amount")]);
    if (!Number.isFinite(amount)) throw new Error(`Line ${i + 1}: amount "${f[col("Amount")]}" isn't a number.`);
    const postRaw = f[col("Post Date")]?.trim();
    const memoIdx = col("Memo");
    const base = {
      transactionDate: isoDate(f[col("Transaction Date")]),
      postDate: postRaw ? isoDate(postRaw) : null,
      description: decodeEntities(f[col("Description")].trim()),
      chaseCategory: f[col("Category")]?.trim() || null,
      type: f[col("Type")].trim(),
      amount,
      memo: memoIdx >= 0 ? f[memoIdx]?.trim() || null : null,
    };
    rows.push({ externalId: rowIdentity(base, seen), ...base });
  }

  const dates = rows.map((r) => r.transactionDate).sort();
  return {
    account: /Chase(\d{4})_Activity/i.exec(fileName)?.[1] ?? null,
    rows,
    firstDate: dates[0] ?? null,
    lastDate: dates[dates.length - 1] ?? null,
  };
}

// ── Merchant names ──────────────────────────────────────────────────────────
// Payee rules need the SAME key every time a merchant charges the card, but
// Chase descriptions carry order codes and store numbers:
//   "AMAZON MKTPL*WX4JU99J3"  → "AMAZON MKTPL"
//   "SQSP* INV171129666"      → "SQSP"
//   "SHELL OIL 57545151706"   → "SHELL OIL"
//   "PETSMART # 0529"         → "PETSMART"
//   "DD *DOORDASH LEOSITALI"  → "DD *DOORDASH LEOSITALI"  (the part after * IS the merchant)

/** True for codes like "WX4JU99J3", "INV171129666", "#948", "57545151706". */
/** Short tokens like "3M" or "7-ELEVEN" are real names and kept. */
const looksLikeCode = (tok: string) =>
  /\d/.test(tok) &&
  (tok.replace(/[^0-9]/g, "").length >= 3 || /^#/.test(tok) || (tok.length >= 6 && /[A-Z]\d|\d[A-Z]/i.test(tok)));

export function merchantName(description: string): string {
  let s = decodeEntities(description).toUpperCase().replace(/\s+/g, " ").trim();

  // "PREFIX*REST": drop REST when it starts with an order/invoice code.
  const star = s.indexOf("*");
  if (star > 0) {
    const prefix = s.slice(0, star).trim();
    const rest = s.slice(star + 1).replace(/#\s*\d+/g, " ").trim(); // "GODADDY#3919971389" → "GODADDY"
    const first = rest.split(" ")[0] ?? "";
    if (!rest || looksLikeCode(first)) s = prefix;
    else s = `${prefix} *${rest}`;
  }

  s = s
    .replace(/#\s*\d+/g, " ")                 // store numbers "# 0529", "#948"
    .split(" ")
    .filter((t) => t && !looksLikeCode(t))    // "57545151706", "3285"
    .join(" ")
    .replace(/[\s\-/.,]+$/, "")
    .trim();

  return s || decodeEntities(description).toUpperCase().trim();
}
