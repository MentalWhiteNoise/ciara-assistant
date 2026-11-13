# Ciara Assistant — Security Design

## Threat Model

| Threat | Mitigation |
|--------|-----------|
| Physical machine compromise | SQLCipher encrypts the database at rest |
| LAN interception | Self-signed TLS cert (mkcert) — all traffic is HTTPS |
| Credential theft | Secrets vault — tokens never stored in plaintext |
| Unauthorized API access | JWT auth with session expiry |
| Backup exposure | age encryption before any cloud upload |
| Accidental secret logging | Vault values never passed to logger; server-side only |

---

## Authentication Flow

```
User enters master password
    │
    ▼
Argon2id key derivation
(slow, memory-hard — resistant to brute force)
    │
    ▼
AES-256-GCM decryption of secrets.vault file
    │
    ▼
OAuth tokens, API keys decrypted into memory only
    │
    ▼
Server issues JWT (15 min expiry) + refresh token (7 days)
    │
    ▼
Browser stores JWT in memory (not localStorage)
Refresh token stored in httpOnly cookie
(httpOnly = JavaScript cannot read it — XSS protection)
```

---

## Secrets Vault

The vault is a single encrypted file: `data/secrets.vault` (gitignored).
Implementation: `apps/api/src/vault/vault.ts`. Routes: `apps/api/src/routes/vault.ts`.

```
Structure (after decryption):
{
  "paypal": {
    "clientId": "...",
    "clientSecret": "...",
    "accessToken": "...",
    "refreshToken": "...",
    "expiresAt": 1234567890
  },
  "google": {
    "clientId": "...",
    "clientSecret": "...",
    "accessToken": "...",
    "refreshToken": "..."
  },
  "amazon_kdp": {
    "cookies": "..."          ← session cookies if using scraper approach
  }
}

Encryption:
  Key:       Argon2id(masterPassword, salt) → 32 bytes
  Cipher:    AES-256-GCM
  Output:    salt (16 bytes) + IV (12 bytes) + ciphertext + auth tag (16 bytes)
  Encoding:  Base64, stored as JSON file
```

Actual on-disk format (v1): JSON `{ version, kdf: { algorithm, memoryCost, timeCost, parallelism, salt }, iv, ciphertext, tag }`.
KDF parameters live in the file so they can be raised later without breaking old vaults.
Each entry is `{ credentials, updatedAt }`, keyed by integration id (see `apps/api/src/connectors/definitions.ts`).

**Lifecycle:**
- Created empty on first successful login
- Unlocked automatically on login (the password is in hand at that moment)
- After a server restart it is **locked** until you log in again or unlock it from Settings → Integrations; scheduled syncs that need credentials skip while locked
- Logging out does **not** lock it (so background syncs keep running); use "Lock vault" to lock explicitly
- The unlock route checks the password against the login hash first, so a vault can never be created with a mistyped password

**Rules:**
- The key is derived only from the master password and held in memory only
- Decrypted values live in memory, never written back to disk in plaintext
- Frontend never receives raw credentials — only success/failure status
- OAuth tokens are refreshed server-side automatically
- If master password changes, vault is re-encrypted with new key

---

## Database Encryption

SQLite database is encrypted using **SQLCipher** (industry standard).
- Transparent encryption — Drizzle ORM doesn't need to know
- Encryption key derived from master password (same Argon2id derivation)
- Without the key, the `.db` file is unreadable binary data

---

## Network Security

### Local TLS with mkcert

```bash
# One-time setup
mkcert -install
mkcert localhost ciara.local 127.0.0.1 ::1

# Generates:
#   localhost+3-key.pem  (private key)
#   localhost+3.pem      (certificate)
```

- mkcert adds itself as a trusted Certificate Authority on your machine
- The generated cert is trusted by Chrome, Safari, Firefox on the same machine
- For tablet/phone: install mkcert's root CA cert on that device once

### CORS Policy
- API only accepts requests from `https://localhost:*` and `https://ciara.local:*`
- No wildcard origins
- Credentials required in requests

---

## JWT Design

```
Access Token:
  - Expiry: 15 minutes
  - Payload: { userId, sessionId, iat, exp }
  - Stored: JavaScript memory only (lost on page refresh → uses refresh token)

Refresh Token:
  - Expiry: 7 days
  - Stored: httpOnly, Secure, SameSite=Strict cookie
  - Rotated on each use (refresh token rotation)
  - Invalidated on logout
```

---

## Backup Security

### Local Backups
```
nightly:
  1. SQLite → snapshot → ciara-YYYYMMDD.db
  2. age encrypt with user's public key → ciara-YYYYMMDD.db.age
  3. Store in /data/backups/ (keep 30 days)
  4. Original snapshot deleted after encryption
```

### Cloud Backups (Optional)
```
  1. Same encrypted .age files uploaded to Backblaze B2 or S3
  2. Bucket is private
  3. Rclone handles upload — credentials stored in vault
  4. Attachments folder encrypted separately before upload

Restore:
  1. Download .age file
  2. age decrypt with private key
  3. Replace ciara.db
  4. Re-authenticate OAuth integrations (tokens are not backed up by design)
```

### age Encryption
`age` (actual good encryption) is a modern file encryption tool.
- Simpler and safer than GPG
- Public key encryption: encrypt to your public key, only your private key decrypts
- Private key lives on your machine (or a hardware key like YubiKey)

---

## API Credential Setup Process

When setting up an integration (e.g., PayPal):
1. User opens Settings → Integrations → PayPal
2. User is redirected to PayPal OAuth consent screen
3. PayPal returns auth code to local callback: `https://localhost:3001/auth/callback/paypal`
4. Backend exchanges code for tokens
5. Tokens encrypted and stored in vault
6. Frontend only sees: `{ status: "connected", connectedAt: "..." }`

The frontend **never** sees the actual tokens.

---

## What We Deliberately Avoid

| Practice | Why We Avoid It |
|----------|----------------|
| Storing credentials in `.env` files | .env can be accidentally committed to git |
| Storing tokens in localStorage | Vulnerable to XSS attacks |
| Logging request bodies | Could accidentally log credentials |
| Sending tokens to frontend | No need — all API calls happen server-side |
| Cloud-based secret storage (Vault, AWS Secrets Manager) | Unnecessary for local-first app; adds cloud dependency |
