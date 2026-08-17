import { randomBytes, scryptSync, timingSafeEqual } from "crypto";

/**
 * Download-passcode hashing (docs/05-authentication-security.md's
 * `hashed_download_passcode`, never stored plaintext). scrypt via Node's
 * built-in `crypto` -- no new dependency needed for a single tenant-wide
 * passcode, same hand-rolled-over-a-library precedent as this session's
 * RFC 6238 TOTP work. Node-only (`crypto`), so this must never be
 * imported from client-bundled code.
 */
const KEY_LENGTH = 64;

export function hashPasscode(passcode: string): string {
  const salt = randomBytes(16).toString("hex");
  const hash = scryptSync(passcode, salt, KEY_LENGTH).toString("hex");
  return `scrypt$${salt}$${hash}`;
}

export function verifyPasscodeHash(passcode: string, stored: string): boolean {
  const parts = stored.split("$");
  if (parts.length !== 3 || parts[0] !== "scrypt") {
    return false;
  }
  const [, salt, hashHex] = parts;
  const hash = scryptSync(passcode, salt, KEY_LENGTH);
  const storedHash = Buffer.from(hashHex, "hex");

  if (hash.length !== storedHash.length) {
    return false;
  }
  return timingSafeEqual(hash, storedHash);
}
