// JWT signing secret management.
//
// The JWT secret is a random 64-byte value generated once on first run
// and stored in data/jwt.secret (outside the database, gitignored).
//
// Why not hardcode it or put it in .env?
//   - Hardcoded = anyone who reads the code can forge tokens
//   - .env files get accidentally committed to git
//   - A random file that lives only on this machine is the right approach

import { randomBytes } from "crypto";
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs";
import path from "path";

const DATA_DIR = process.env.DATA_DIR ?? path.resolve(process.cwd(), "../../data");
const SECRET_PATH = path.join(DATA_DIR, "jwt.secret");

let _secret: string | null = null;

export function getJwtSecret(): string {
  if (_secret) return _secret;

  if (existsSync(SECRET_PATH)) {
    // Load existing secret from disk
    _secret = readFileSync(SECRET_PATH, "utf-8").trim();
  } else {
    // First run — generate a random secret and persist it
    mkdirSync(DATA_DIR, { recursive: true });
    const secret = randomBytes(64).toString("hex"); // 128 hex chars = 512 bits
    writeFileSync(SECRET_PATH, secret, { mode: 0o600 }); // owner-read-only
    _secret = secret;
    console.log("Generated new JWT secret at:", SECRET_PATH);
  }

  return _secret;
}
