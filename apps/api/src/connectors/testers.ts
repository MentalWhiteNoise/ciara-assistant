// "Test connection" implementations, one per integration that supports it.
// Each returns a plain result object — expected failures (wrong secret,
// missing permission) are reported as ok:false, not thrown.

import { PayPalError, getPayPalGrant, searchTransactions } from "./paypal/client.js";

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

export const CONNECTION_TESTERS: Record<string, () => Promise<ConnectionTestResult>> = {
  paypal: testPayPal,
};
