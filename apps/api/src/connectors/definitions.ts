// Integration definitions — which accounts exist and what credentials each takes.
//
// This is metadata only (no secrets). The frontend fetches it to build the
// Settings → Integrations screen, and the vault routes use it to validate input.
//
// authType:
//   api_key     — paste one or more keys/tokens from the service's settings
//   import_only — no usable API; data comes in via file import / email
//
// Field `secret: true` means the value is masked in the form. Either way,
// stored values are never sent back to the browser.

export interface CredentialField {
  key: string;
  label: string;
  secret: boolean;
  optional?: boolean;
  /** If set, the field is a dropdown limited to these values (not free text).
   *  Its saved value is not sensitive and IS reported back to the browser. */
  options?: { value: string; label: string }[];
  /** Pre-selected value for a dropdown. */
  default?: string;
}

export interface IntegrationDefinition {
  id: string;
  displayName: string;
  description: string;
  authType: "api_key" | "import_only";
  fields: CredentialField[];
  /** Where to find the credentials, shown under the form. */
  help?: string;
  /** For import_only services that have an import screen: its route in the web app. */
  importPath?: string;
}

export const INTEGRATIONS: IntegrationDefinition[] = [
  {
    id: "gmail",
    displayName: "Reports inbox (Gmail)",
    description: "Shared inbox that receives forwarded reports — IngramSpark and other email-only services",
    authType: "api_key",
    fields: [
      { key: "email", label: "Gmail address", secret: false },
      { key: "appPassword", label: "App password", secret: true },
    ],
    help: "Sign in to the shared Gmail account → myaccount.google.com → Security → turn on 2-Step Verification (required), then go to myaccount.google.com/apppasswords, name it \"Ciara\" and create. Paste the 16-letter password here (spaces are fine). Ciara opens the mailbox read-only: it never sends, deletes, moves or marks mail as read. To cut access at any time, delete the app password in Google.",
  },
  {
    id: "squarespace",
    displayName: "Squarespace",
    description: "Website and direct sales — orders, products, refunds",
    authType: "api_key",
    fields: [{ key: "apiKey", label: "API key", secret: true }],
    help: "Squarespace → Settings → Advanced → Developer API Keys → Generate Key. Under Commerce APIs give Orders, Transactions and Products \"Read Only\" (never Read and Write). The key is shown only once — paste it here. Ciara only ever reads; its Squarespace code refuses anything but GET requests.",
  },
  {
    id: "paypal",
    displayName: "PayPal",
    description: "Invoicing, POS, and publishing-service payments",
    authType: "api_key",
    fields: [
      {
        key: "environment",
        label: "Environment",
        secret: false,
        options: [
          { value: "sandbox", label: "Sandbox (test data)" },
          { value: "live", label: "Live (real account)" },
        ],
        default: "sandbox",
      },
      { key: "clientId", label: "Client ID", secret: false },
      { key: "clientSecret", label: "Client secret", secret: true },
    ],
    help: "developer.paypal.com → Apps & Credentials → pick Sandbox or Live (must match Environment above) → Create App. Turn on the Transaction Search feature for the app. Ciara only ever READS transaction history — it never calls any payment endpoint.",
  },
  {
    id: "mailerlite",
    displayName: "MailerLite",
    description: "Newsletter subscribers and campaign stats",
    authType: "api_key",
    fields: [{ key: "apiToken", label: "API token", secret: true }],
    help: "MailerLite → Integrations → MailerLite API → Generate new token (name it \"Ciara\"). MailerLite tokens can't be made read-only, so the limits are in Ciara's code: it only reads subscriber COUNTS (never names or email addresses) and campaign/automation stats, and refuses every request that could send, edit or delete. To cut access at any time, delete the token in MailerLite.",
  },
  {
    id: "patreon",
    displayName: "Patreon",
    description: "Paid members and pledges",
    authType: "api_key",
    fields: [
      { key: "creatorAccessToken", label: "Creator access token", secret: true },
      { key: "creatorRefreshToken", label: "Creator refresh token", secret: true, optional: true },
    ],
    help: "patreon.com/portal → My Clients → Create Client. Copy the Creator's Access Token (and Refresh Token).",
  },
  {
    id: "amazon_kdp",
    displayName: "Amazon KDP",
    description: "Main publishing portal — royalties and sales",
    authType: "import_only",
    fields: [],
    importPath: "/kdp",
  },
  {
    id: "ingramspark",
    displayName: "IngramSpark",
    description: "Secondary publishing portal — sales and book orders",
    authType: "import_only",
    fields: [],
    importPath: "/ingram",
  },
  {
    id: "48hr_books",
    displayName: "48HR Books",
    description: "Print orders",
    authType: "import_only",
    fields: [],
    importPath: "/48hr",
  },
  {
    id: "pirateship",
    displayName: "Pirate Ship",
    description: "Shipping label purchases",
    authType: "import_only",
    fields: [],
  },
  {
    id: "wise",
    displayName: "Wise",
    description: "Payments to artists (commissioned and marketing art) — emails for now",
    authType: "import_only",
    fields: [],
    importPath: "/wise",
  },
  {
    id: "beventi",
    displayName: "Beventi",
    description: "Event preorders and wholesale orders",
    authType: "import_only",
    fields: [],
  },
  {
    id: "chase",
    displayName: "Chase credit card",
    description: "Mixed personal/business card — statement transactions",
    authType: "import_only",
    fields: [],
  },
];

export function getIntegration(id: string) {
  return INTEGRATIONS.find((i) => i.id === id);
}
