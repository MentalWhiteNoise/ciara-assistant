// Minimal .xlsx reader — just enough to read KDP's report workbooks.
//
// An .xlsx file is a ZIP archive of XML files:
//   xl/workbook.xml            — the list of sheets (names + internal ids)
//   xl/_rels/workbook.xml.rels — maps those ids to sheet file paths
//   xl/sharedStrings.xml       — text values, stored once and referenced by index
//   xl/worksheets/sheetN.xml   — the cells
//
// `fflate` unzips (zero dependencies) and `fast-xml-parser` turns XML into
// plain objects. We return every sheet as a 2-D array of strings (or null for
// empty cells), positioned by column letter so blank cells keep their place.

import { unzipSync, strFromU8 } from "fflate";
import { XMLParser } from "fast-xml-parser";

export type Row = (string | null)[];
export type Workbook = Map<string, Row[]>;

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@",
  // Keep every value as a string — we parse numbers ourselves, so long payment
  // numbers and ISBNs are never mangled.
  parseTagValue: false,
  parseAttributeValue: false,
  trimValues: false,
  // These elements can repeat; always give us arrays so the code is uniform.
  isArray: (name) => ["sheet", "Relationship", "si", "r", "row", "c"].includes(name),
});

const MAX_UNZIPPED_BYTES = 100 * 1024 * 1024; // guard against zip bombs

function asArray<T>(v: T | T[] | undefined): T[] {
  return v === undefined ? [] : Array.isArray(v) ? v : [v];
}

// <t> can be a plain string or { "#text": "...", "@xml:space": "preserve" }
function textOf(node: unknown): string {
  if (node === undefined || node === null) return "";
  if (typeof node === "string") return node;
  if (typeof node === "object" && "#text" in (node as object)) {
    return String((node as Record<string, unknown>)["#text"]);
  }
  return "";
}

// Shared string: either <si><t>..</t></si> or rich text <si><r><t>..</t></r>...</si>
function sharedStringText(si: Record<string, unknown>): string {
  if (si.t !== undefined) return textOf(si.t);
  return asArray(si.r as Record<string, unknown>[]).map((r) => textOf(r.t)).join("");
}

// "AB12" → 27 (zero-based column index)
function columnIndex(ref: string): number {
  let n = 0;
  for (const ch of ref) {
    const code = ch.charCodeAt(0);
    if (code < 65 || code > 90) break;
    n = n * 26 + (code - 64);
  }
  return n - 1;
}

export function readWorkbook(buffer: Uint8Array): Workbook {
  let files: Record<string, Uint8Array>;
  try {
    let total = 0;
    files = unzipSync(buffer, {
      filter: (f) => {
        total += f.originalSize;
        if (total > MAX_UNZIPPED_BYTES) throw new Error("File is too large once unzipped");
        return f.name.startsWith("xl/");
      },
    });
  } catch (err) {
    throw new Error(
      `Not a readable Excel (.xlsx) file: ${(err as Error).message}`
    );
  }

  const read = (p: string) => (files[p] ? parser.parse(strFromU8(files[p])) : null);

  const workbookXml = read("xl/workbook.xml");
  const relsXml = read("xl/_rels/workbook.xml.rels");
  if (!workbookXml || !relsXml) throw new Error("Not a readable Excel (.xlsx) file");

  const shared: string[] = asArray(read("xl/sharedStrings.xml")?.sst?.si).map(
    (si) => sharedStringText(si as Record<string, unknown>)
  );

  const relTargets = new Map<string, string>();
  for (const rel of asArray(relsXml.Relationships?.Relationship)) {
    relTargets.set(rel["@Id"], rel["@Target"]);
  }

  const book: Workbook = new Map();
  for (const sheet of asArray(workbookXml.workbook?.sheets?.sheet)) {
    const target = relTargets.get(sheet["@r:id"]);
    if (!target) continue;
    const sheetPath = target.startsWith("/") ? target.slice(1) : `xl/${target}`;
    const xml = read(sheetPath);
    const rows: Row[] = [];

    for (const row of asArray(xml?.worksheet?.sheetData?.row)) {
      const cells: Row = [];
      for (const c of asArray(row.c as Record<string, unknown>[])) {
        const col = columnIndex(String(c["@r"] ?? ""));
        const type = c["@t"];
        let value: string | null;
        if (type === "s") value = shared[Number(textOf(c.v))] ?? null;
        else if (type === "inlineStr") value = textOf((c.is as Record<string, unknown>)?.t);
        else value = c.v === undefined ? null : textOf(c.v);
        if (value === "") value = null;
        while (cells.length < col) cells.push(null);
        cells[col] = value;
      }
      rows.push(cells);
    }
    book.set(String(sheet["@name"]), rows);
  }
  return book;
}
