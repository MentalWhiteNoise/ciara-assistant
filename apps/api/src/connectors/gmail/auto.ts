// Automatic pickup from the reports inbox: for each email-based importer,
// read new mail (READ-ONLY) and import what's complete.
//
// Runs from a timer in index.ts. The Gmail app password lives in the vault,
// which is only unlocked while someone is logged in, so a check is simply
// skipped while it's locked (and happens on the next tick after login).

import { getSecret, isUnlocked } from "../../vault/vault.js";
import { lastSuccessfulGmailRun } from "./collect.js";
import { INGRAM_CONNECTOR, syncIngramFromGmail } from "../ingramspark/sync.js";
import { runIngramImport } from "../ingramspark/import.js";
import { FORTY_EIGHT_CONNECTOR, sync48HrFromGmail } from "../48hr/sync.js";
import { run48HrImport } from "../48hr/import.js";

const MIN_GAP_MS = 6 * 60 * 60 * 1000; // each importer at most every 6 hours

const IMPORTERS = {
  [INGRAM_CONNECTOR]: { sync: syncIngramFromGmail, run: runIngramImport },
  [FORTY_EIGHT_CONNECTOR]: { sync: sync48HrFromGmail, run: run48HrImport },
} as const;
export type InboxConnector = keyof typeof IMPORTERS;

const running = new Set<string>();

export function isInboxCheckRunning(connector: InboxConnector) {
  return running.has(connector);
}

/** Read the inbox + import for one service, now. Throws if Gmail is unavailable or a check is running. */
export async function checkInboxNow<C extends InboxConnector>(connector: C, { full = false } = {}) {
  if (running.has(connector)) throw new Error("A check is already running");
  running.add(connector);
  try {
    const importer = IMPORTERS[connector];
    const sync = await importer.sync({ full });
    const imported = importer.run();
    return { sync, imported } as {
      sync: Awaited<ReturnType<(typeof IMPORTERS)[C]["sync"]>>;
      imported: ReturnType<(typeof IMPORTERS)[C]["run"]>;
    };
  } finally {
    running.delete(connector);
  }
}

/** Timer tick: run every importer whose last Gmail check is old enough. */
export async function autoCheckInbox(log: { info: (o: object, m: string) => void; error: (e: unknown, m: string) => void }) {
  if (!isUnlocked() || !getSecret("gmail")) return;
  for (const connector of Object.keys(IMPORTERS) as InboxConnector[]) {
    if (running.has(connector)) continue;
    const last = lastSuccessfulGmailRun(connector);
    if (last && Date.now() - last.getTime() < MIN_GAP_MS) continue;
    try {
      const { imported } = await checkInboxNow(connector);
      log.info({ connector, totals: imported.totals }, "Reports inbox check done");
    } catch (err) {
      log.error(err, `Reports inbox check failed (${connector})`);
    }
  }
}
