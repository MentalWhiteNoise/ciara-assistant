// "Test connection" implementations, one per integration that supports it.
// Each returns a plain result object — expected failures (wrong secret,
// missing permission) are reported as ok:false, not thrown.

import { GmailError, findAllMailPath, withMailbox } from "./gmail/client.js";
import { PayPalError, getPayPalGrant, searchTransactions } from "./paypal/client.js";
import {
  SquarespaceError,
  getWebsite,
  listOrders,
  listProducts,
  listTransactions,
} from "./squarespace/client.js";

export interface ConnectionTestResult {
  ok: boolean;
  message: string;
  details?: Record<string, unknown>;
}

// PayPal scope for the Transaction Search feature.
const PAYPAL_REPORTING_SCOPE = "https://uri.paypal.com/services/reporting/search/read";

async function testPayPal(): Promise<ConnectionTestResult> {
  // Step 1: can we log in at all?
  let grant: Awaited<ReturnType<typeof getPayPalGrant>>;
  try {
    grant = await getPayPalGrant();
  } catch (err) {
    if (err instanceof PayPalError && err.code === "invalid_client") {
      return {
        ok: false,
        message:
          "PayPal rejected the Client ID / secret. Check they were copied from the same app, and that Environment (Sandbox/Live) matches where the app was created.",
      };
    }
    return { ok: false, message: `Could not log in to PayPal: ${(err as Error).message}` };
  }

  const details = { environment: grant.environment, grantedScopes: grant.scopes };

  // Step 2: is Transaction Search actually usable? Ask for the last 24 hours.
  try {
    const end = new Date();
    const start = new Date(end.getTime() - 24 * 60 * 60 * 1000);
    const page = await searchTransactions({ start, end, pageSize: 1 });
    return {
      ok: true,
      message: `Connected to PayPal ${grant.environment}. Transaction Search works (${page.total_items} transaction(s) in the last 24 hours).`,
      details: { ...details, lastRefreshed: page.last_refreshed_datetime ?? null },
    };
  } catch (err) {
    if (err instanceof PayPalError && err.status === 403) {
      const hasScope = grant.scopes.includes(PAYPAL_REPORTING_SCOPE);
      return {
        ok: false,
        message: hasScope
          ? "Login works, but Transaction Search was refused. If you just enabled it, PayPal can take up to a few hours to activate it — try again later."
          : "Login works, but this app doesn't have the Transaction Search feature. Enable it on the app at developer.paypal.com, save, and try again (activation can take a few hours).",
        details,
      };
    }
    return { ok: false, message: `Login works, but Transaction Search failed: ${(err as Error).message}`, details };
  }
}

async function testSquarespace(): Promise<ConnectionTestResult> {
  // Step 1: is the key valid at all? (Any valid key can read basic site info.)
  let site: Awaited<ReturnType<typeof getWebsite>>;
  try {
    site = await getWebsite();
  } catch (err) {
    if (err instanceof SquarespaceError && err.status === 401) {
      return { ok: false, message: "Squarespace rejected the API key. Check it was copied in full (it's only shown once — if in doubt, generate a new one)." };
    }
    if (err instanceof SquarespaceError && err.status === 402) {
      return { ok: false, message: "Squarespace says the site's subscription has expired." };
    }
    return { ok: false, message: `Could not reach Squarespace: ${(err as Error).message}` };
  }

  // Step 2: probe each API Ciara reads, over a 1-day window so almost nothing
  // is downloaded. Nothing from these probes is stored.
  const before = new Date();
  const range = { after: new Date(before.getTime() - 24 * 60 * 60 * 1000), before };
  const probe = async (fn: () => Promise<unknown>) => {
    try {
      await fn();
      return "ok";
    } catch (err) {
      if (err instanceof SquarespaceError && err.status === 403) return "no permission";
      return `error: ${(err as Error).message}`;
    }
  };
  const permissions = {
    Orders: await probe(() => listOrders({ range })),
    Transactions: await probe(() => listTransactions({ range })),
    Products: await probe(() => listProducts({ range })),
  };

  const missing = Object.entries(permissions).filter(([, v]) => v !== "ok").map(([k]) => k);
  const details = { site: site.title, siteUrl: site.url, currency: site.currency, permissions };
  if (missing.length === 0) {
    return { ok: true, message: `Connected to "${site.title}" (${site.currency}). Orders, Transactions and Products are all readable.`, details };
  }
  return {
    ok: false,
    message: `Key works for "${site.title}", but these can't be read: ${missing.join(", ")}. Edit the key in Squarespace (Settings → Advanced → Developer API Keys) and give each one Read Only access.`,
    details,
  };
}

async function testGmail(): Promise<ConnectionTestResult> {
  // Logs in, opens the inbox read-only, and COUNTS messages (no message content
  // is downloaded or stored). The IngramSpark count confirms forwarding works.
  try {
    return await withMailbox("INBOX", async (client, { exists }) => {
      const ingram = await client.search({ from: "ingram" });
      const ingramCount = Array.isArray(ingram) ? ingram.length : 0;
      const allMail = await findAllMailPath(client);
      return {
        ok: true,
        message:
          `Connected to the inbox (opened read-only): ${exists} message(s), ` +
          `${ingramCount} from IngramSpark/Ingram.` +
          (ingramCount === 0 ? " If forwarding is set up, the first report arrives in the first week of the month." : ""),
        details: { inboxMessages: exists, ingramMessages: ingramCount, allMailFolder: allMail ?? null },
      };
    });
  } catch (err) {
    if (err instanceof GmailError && err.code === "auth_failed") {
      return {
        ok: false,
        message:
          "Gmail rejected the login. Use an app password (16 letters), not the account's normal password — and check the email address is the shared inbox's. If IMAP is turned off, enable it in Gmail → Settings → Forwarding and POP/IMAP.",
      };
    }
    return { ok: false, message: (err as Error).message };
  }
}

export const CONNECTION_TESTERS: Record<string, () => Promise<ConnectionTestResult>> = {
  gmail: testGmail,
  paypal: testPayPal,
  squarespace: testSquarespace,
};
