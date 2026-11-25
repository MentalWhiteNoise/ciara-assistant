// Trial run of the Chase import against a COPY of the database.
//   DATA_DIR=<folder with a copied ciara.db> tsx src/scripts/chase-dryrun.ts <folder of Chase CSVs>
// Refuses to run against the real data/ folder.
import fs from "node:fs";
import path from "node:path";
const real = path.resolve(process.cwd(), "../../data");
if (!process.env.DATA_DIR || path.resolve(process.env.DATA_DIR) === real) {
  console.error("Set DATA_DIR to a folder holding a COPY of ciara.db."); process.exit(1);
}
const { storeChaseCsv, runChaseImport, previewChaseImport } = await import("../connectors/chase/import.js");
const { db } = await import("../db/client.js");
const { transactions } = await import("../db/schema/index.js");
const { eq } = await import("drizzle-orm");
const dir = process.argv[2];
for (const f of fs.readdirSync(dir).filter((f) => /\.csv$/i.test(f)).sort()) {
  const r = storeChaseCsv(f, fs.readFileSync(path.join(dir, f), "utf8"));
  console.log(`upload ${f}: ${r.rows} rows, ${r.newRows} new (${r.firstDate} → ${r.lastDate})`);
}
const s = runChaseImport();
console.log(JSON.stringify(s.totals, null, 1));
console.log("links:"); for (const l of s.links) console.log(" ", l.date, l.amount.toFixed(2).padStart(9), l.linkedTo, "dated", l.orderDate);
console.log("unmatched vendor charges:"); for (const u of s.unmatchedVendorCharges) console.log(" ", u.date, u.amount.toFixed(2).padStart(9), u.merchant);
console.log("fees without charge:", s.feesWithoutCharge);
const again = previewChaseImport();
console.log("re-run would import:", again.totals.rows, "rows; already imported:", again.alreadyImported);
const fees = db.select().from(transactions).where(eq(transactions.description, "Chase foreign transaction fee — AMAZON PRIME")).all();
console.log("sample fee:", fees[0]?.amount, fees[0]?.relatedTransactionId ? "linked" : "UNLINKED", fees[0]?.reviewStatus);
