// Password hashing using Argon2id — the memory-hard variant recommended for passwords.
//
// Why Argon2id over bcrypt?
//   - Argon2id is resistant to both GPU brute-force (time-hardness) AND
//     side-channel attacks (memory-hardness)
//   - bcrypt is still fine, but Argon2 is the modern standard
//   - The OWASP password storage cheat sheet recommends Argon2id

import { hash, verify, Algorithm } from "@node-rs/argon2";

const ARGON2_OPTIONS = {
  algorithm: Algorithm.Argon2id,
  memoryCost: 65536,   // 64 MB of RAM — makes GPU attacks expensive
  timeCost: 3,         // 3 iterations
  parallelism: 1,
};

export async function hashPassword(password: string): Promise<string> {
  return hash(password, ARGON2_OPTIONS);
}

export async function verifyPassword(
  hash: string,
  password: string
): Promise<boolean> {
  try {
    return await verify(hash, password, ARGON2_OPTIONS);
  } catch {
    // verify() throws if the hash format is invalid — treat as mismatch
    return false;
  }
}
