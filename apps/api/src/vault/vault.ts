// Secrets vault — an encrypted file holding integration credentials
// (API keys, OAuth tokens, session cookies). See docs/SECURITY.md.
//
// How it works:
//   1. Your master password + a random salt go through Argon2id → 32-byte key.
//      Argon2id is deliberately slow and memory-hungry, so guessing passwords
//      against a stolen vault file is very expensive.
//   2. The secrets (a JSON object) are encrypted with AES-256-GCM using that key.
//      GCM is "authenticated" encryption: it also produces a tag that detects
//      any tampering, and decryption fails outright with the wrong key.
//   3. The derived key is kept in server memory only while unlocked. It is
//      never written to disk. A server restart = vault locked until you log in.
//
// File format (data/secrets.vault), all binary values base64:
//   { version, kdf: { algorithm, memoryCost, timeCost, parallelism, salt },
//     iv, ciphertext, tag }
// The KDF parameters are stored in the file so they can be strengthened later
// without breaking existing vaults.
//
// Rules: never log values from here, never return them from an HTTP route.

import { createCipheriv, createDecipheriv, randomBytes } from "crypto";
import { existsSync, readFileSync, renameSync, writeFileSync, mkdirSync } from "fs";
import path from "path";
import { hashRaw, Algorithm } from "@node-rs/argon2";

const DATA_DIR = process.env.DATA_DIR ?? path.resolve(process.cwd(), "../../data");
const VAULT_PATH = path.join(DATA_DIR, "secrets.vault");

// Extra data bound into the encryption. If someone edits the version field
// in the file, decryption fails rather than silently misreading it.
const AAD = Buffer.from("ciara-vault-v1");

const KDF_DEFAULTS = {
  algorithm: "argon2id" as const,
  memoryCost: 65536, // 64 MB
  timeCost: 3,
  parallelism: 1,
};

// ── Types ─────────────────────────────────────────────────────────────────────

/** One integration's stored secrets, plus when they were saved. */
export interface VaultEntry {
  credentials: Record<string, unknown>;
  updatedAt: string; // ISO timestamp
}

/** Decrypted vault contents: integration id → entry. */
export type VaultData = Record<string, VaultEntry>;

interface VaultFile {
  version: 1;
  kdf: typeof KDF_DEFAULTS & { salt: string };
  iv: string;
  ciphertext: string;
  tag: string;
}

export class VaultLockedError extends Error {
  constructor() {
    super("Vault is locked");
    this.name = "VaultLockedError";
  }
}

// ── In-memory state ───────────────────────────────────────────────────────────
// These are module-level variables: they live as long as the server process.

let key: Buffer | null = null;      // derived AES key while unlocked
let salt: Buffer | null = null;     // salt the key was derived with
let data: VaultData | null = null;  // decrypted contents while unlocked

// ── Crypto helpers ────────────────────────────────────────────────────────────

async function deriveKey(password: string, saltBytes: Buffer, kdf = KDF_DEFAULTS) {
  return hashRaw(password, {
    algorithm: Algorithm.Argon2id,
    memoryCost: kdf.memoryCost,
    timeCost: kdf.timeCost,
    parallelism: kdf.parallelism,
    salt: saltBytes,
    outputLen: 32, // 256 bits for AES-256
  });
}

function encrypt(plain: VaultData, k: Buffer, s: Buffer): VaultFile {
  const iv = randomBytes(12); // fresh IV every write — never reuse with GCM
  const cipher = createCipheriv("aes-256-gcm", k, iv);
  cipher.setAAD(AAD);
  const ciphertext = Buffer.concat([
    cipher.update(JSON.stringify(plain), "utf8"),
    cipher.final(),
  ]);
  return {
    version: 1,
    kdf: { ...KDF_DEFAULTS, salt: s.toString("base64") },
    iv: iv.toString("base64"),
    ciphertext: ciphertext.toString("base64"),
    tag: cipher.getAuthTag().toString("base64"),
  };
}

function decrypt(file: VaultFile, k: Buffer): VaultData {
  const decipher = createDecipheriv("aes-256-gcm", k, Buffer.from(file.iv, "base64"));
  decipher.setAAD(AAD);
  decipher.setAuthTag(Buffer.from(file.tag, "base64"));
  const plain = Buffer.concat([
    decipher.update(Buffer.from(file.ciphertext, "base64")),
    decipher.final(), // throws if the key is wrong or the file was modified
  ]);
  return JSON.parse(plain.toString("utf8")) as VaultData;
}

/** Write atomically: write a temp file, then rename over the real one.
 *  A crash mid-write can't leave a half-written (unreadable) vault. */
function writeVaultFile(file: VaultFile) {
  mkdirSync(DATA_DIR, { recursive: true });
  const tmp = `${VAULT_PATH}.tmp`;
  writeFileSync(tmp, JSON.stringify(file), { mode: 0o600 });
  renameSync(tmp, VAULT_PATH);
}

function persist() {
  if (!key || !salt || !data) throw new VaultLockedError();
  writeVaultFile(encrypt(data, key, salt));
}

// ── Public API ────────────────────────────────────────────────────────────────

export function vaultExists(): boolean {
  return existsSync(VAULT_PATH);
}

export function isUnlocked(): boolean {
  return key !== null;
}

/**
 * Unlock with the master password. Creates an empty vault on first use.
 * The caller must already have verified the password against the user's
 * login hash — otherwise a typo on first run would create a vault with
 * the wrong password.
 * Returns false if the password does not decrypt the existing vault.
 */
export async function unlock(password: string): Promise<boolean> {
  if (!vaultExists()) {
    const s = randomBytes(16);
    const k = await deriveKey(password, s);
    key = k;
    salt = s;
    data = {};
    persist();
    return true;
  }

  const file = JSON.parse(readFileSync(VAULT_PATH, "utf8")) as VaultFile;
  if (file.version !== 1) throw new Error(`Unsupported vault version: ${file.version}`);

  const s = Buffer.from(file.kdf.salt, "base64");
  const k = await deriveKey(password, s, file.kdf);
  try {
    data = decrypt(file, k);
  } catch {
    return false;
  }
  key = k;
  salt = s;
  return true;
}

/** Forget the key and decrypted data. */
export function lock() {
  key?.fill(0); // overwrite the key bytes before dropping the reference
  key = null;
  salt = null;
  data = null;
}

/**
 * Re-encrypt under a new master password (use when the password changes).
 * Generates a new salt too.
 */
export async function rekey(newPassword: string) {
  if (!data) throw new VaultLockedError();
  const s = randomBytes(16);
  const k = await deriveKey(newPassword, s);
  key?.fill(0);
  key = k;
  salt = s;
  persist();
}

/** Read one integration's credentials. Server-side use only. */
export function getSecret(integrationId: string): VaultEntry | undefined {
  if (!data) throw new VaultLockedError();
  return data[integrationId];
}

/** Store (replace) one integration's credentials and save to disk. */
export function setSecret(integrationId: string, credentials: Record<string, unknown>) {
  if (!data) throw new VaultLockedError();
  data[integrationId] = { credentials, updatedAt: new Date().toISOString() };
  persist();
}

/** Remove one integration's credentials and save to disk. */
export function deleteSecret(integrationId: string) {
  if (!data) throw new VaultLockedError();
  delete data[integrationId];
  persist();
}

/** Which integrations have something stored, and when. No secret values. */
export function listStored(): Record<string, { updatedAt: string }> {
  if (!data) throw new VaultLockedError();
  return Object.fromEntries(
    Object.entries(data).map(([id, entry]) => [id, { updatedAt: entry.updatedAt }])
  );
}
