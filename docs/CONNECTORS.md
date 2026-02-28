# Ciara Assistant — Connector / Integration Design

## What Is a Connector?

A connector is a self-contained module that:
1. Authenticates with an external service
2. Fetches raw data (transactions, sales reports, calendar events)
3. Transforms that raw data into our canonical schema
4. Deduplicates against previously imported records
5. Inserts new records into our database

Each connector is independent. Adding a new one doesn't touch any other connector.

---

## Connector Interface

Every connector implements this interface:

```typescript
interface ConnectorInterface {
  readonly name: string;          // "paypal", "amazon_kdp", etc.
  readonly displayName: string;   // "PayPal", "Amazon KDP", etc.
  readonly authType: 'oauth2' | 'api_key' | 'csv_import' | 'session_cookie';

  // Authentication
  authenticate(): Promise<void>;            // initiate OAuth flow or validate key
  refreshCredentials(): Promise<void>;      // refresh expired tokens
  isAuthenticated(): Promise<boolean>;      // check if credentials are valid

  // Data ingestion
  fetchTransactions(opts: FetchOptions): Promise<RawTransaction[]>;
  fetchInventory?(opts: FetchOptions): Promise<RawInventory[]>;

  // Normalization — raw API data → our Transaction schema
  normalize(raw: RawTransaction[]): NormalizedTransaction[];

  // Deduplication — filters out already-imported records
  dedup(records: NormalizedTransaction[]): Promise<NormalizedTransaction[]>;
}

interface FetchOptions {
  from: Date;
  to: Date;
  accountId?: string;
}
```

---

## Planned Connectors

### PayPal
- **Auth:** OAuth 2.0 (standard flow, callback to `localhost:3001/auth/callback/paypal`)
- **API:** PayPal Transactions API v1
- **What it imports:** All PayPal transactions (sales, fees, refunds, expenses)
- **Dedup key:** PayPal transaction ID
- **Notes:** PayPal fees are imported as separate expense transactions

### Amazon KDP
- **Auth:** CSV upload (no public API available)
- **What it imports:** KDP Sales & Royalties Reports (uploaded by user monthly)
- **Dedup key:** Row hash (date + title + units + royalty)
- **Future option:** Playwright-based automated report download
- **Notes:** KDP reports show royalties (net), not gross sales

### Ingram Spark
- **Auth:** CSV upload
- **What it imports:** Ingram sales reports
- **Dedup key:** Report date + ISBN + units

### Squarespace
- **Auth:** API key (Squarespace Commerce API)
- **What it imports:** Orders, products, refunds
- **Dedup key:** Order ID

### Pirate Ship
- **Auth:** CSV export / API key (if available)
- **What it imports:** Shipping label purchases (expenses)
- **Dedup key:** Shipment ID / label ID

### Google Calendar
- **Auth:** OAuth 2.0 (Google Calendar API v3)
- **What it imports:** Calendar events (two-way sync)
- **Dedup key:** Google event ID
- **Notes:** Creates events in our DB with `external_id` pointing to Google event

### Draft to Digital (Phase 3)
- **Auth:** API key
- **What it imports:** Sales reports
- **Dedup key:** D2D transaction ID

### Beventi / Pre-sales (Phase 3)
- **Auth:** TBD based on what they offer
- **What it imports:** Pre-sale orders and deposits

---

## Connector File Structure

```
apps/api/src/connectors/
├── base/
│   ├── connector.interface.ts      ← shared interface (above)
│   ├── base.connector.ts           ← shared retry, rate limiting, error handling
│   └── dedup.service.ts            ← checks import_dedup_log
├── paypal/
│   ├── paypal.connector.ts
│   ├── paypal.transformer.ts       ← PayPal format → our Transaction schema
│   └── paypal.auth.ts              ← OAuth2 flow
├── amazon-kdp/
│   ├── amazon-kdp.connector.ts
│   └── amazon-kdp.transformer.ts  ← CSV columns → our Transaction schema
├── ingram-spark/
│   ├── ingram.connector.ts
│   └── ingram.transformer.ts
├── squarespace/
│   ├── squarespace.connector.ts
│   └── squarespace.transformer.ts
├── google-calendar/
│   ├── google-calendar.connector.ts
│   └── gcal.transformer.ts
├── pirate-ship/
│   ├── pirate-ship.connector.ts
│   └── pirate-ship.transformer.ts
└── registry.ts                     ← maps connector names to instances
```

---

## Sync Job Flow

```
1. Scheduler triggers (e.g., daily at 2am)
2. For each active connector:
   a. Load credentials from vault
   b. Check if token needs refresh
   c. Fetch new records since last successful sync
   d. Transform raw data to normalized schema
   e. Run dedup check (query import_dedup_log)
   f. Insert new transactions (mark as imported, pending review)
   g. Update import_dedup_log
   h. Log sync_job record (success/fail/count)
3. Notify user of import summary (in-app notification)
```

---

## Manual Import (CSV)

For any source not yet connected:
1. User uploads CSV file
2. User maps columns to our fields (visual column mapper UI)
3. System validates rows (Zod schema)
4. User reviews parsed preview
5. User confirms import
6. Transactions inserted, marked as `source: "csv_import"`
7. Mapping configuration saved (user won't have to re-map next time)

---

## Notes on Amazon KDP

Amazon does not provide a public API for KDP sales data as of 2025.
Options:
1. **Manual CSV upload** (Phase 1/2): User downloads report from KDP dashboard monthly, uploads to Ciara
2. **Playwright scraper** (Phase 3, optional): Automated browser that logs into KDP, downloads the report, and hands the file to the transformer
   - Requires storing KDP credentials in vault
   - Fragile (breaks if KDP changes their HTML)
   - User must decide if they want this

The transformer is the same either way — it just processes the CSV file.
