// Dry-run helper: process saved .eml files into whatever DB DATA_DIR points at.
// No network — reads local files only. Never point DATA_DIR at the real data/
// folder unless you mean to import for real.
//
// Usage: DATA_DIR=<copy dir> tsx src/scripts/inbox-dryrun.ts <ingramspark|48hr_books|wise> <folder-of-eml>
import { syncIngramFromFolder } from "../connectors/ingramspark/sync.js";
import { previewIngramImport, runIngramImport } from "../connectors/ingramspark/import.js";
import { sync48HrFromFolder } from "../connectors/48hr/sync.js";
import { preview48HrImport, run48HrImport } from "../connectors/48hr/import.js";
import { syncWiseFromFolder } from "../connectors/wise/sync.js";
import { previewWiseImport, runWiseImport } from "../connectors/wise/import.js";

const [service, folder] = process.argv.slice(2);
if (!process.env.DATA_DIR || !folder) throw new Error("Set DATA_DIR and pass <service> <folder>");
const svc = {
  ingramspark: { sync: syncIngramFromFolder, preview: previewIngramImport, run: runIngramImport },
  "48hr_books": { sync: sync48HrFromFolder, preview: preview48HrImport, run: run48HrImport },
  wise: { sync: syncWiseFromFolder, preview: previewWiseImport, run: runWiseImport },
}[service];
if (!svc) throw new Error(`Unknown service ${service}`);

const sync = await svc.sync(folder);
console.log("SYNC", JSON.stringify(sync));
console.log("PREVIEW", JSON.stringify(svc.preview(), null, 1));
console.log("RAN", JSON.stringify(svc.run().totals));
const again = svc.run();
console.log("SECOND RUN (should be 0)", JSON.stringify(again.totals), "alreadyImported", again.alreadyImported);
const resync = await svc.sync(folder);
console.log("RESYNC", JSON.stringify(resync));
