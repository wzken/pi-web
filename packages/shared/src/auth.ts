import {
  randomBytes,
  scrypt as scryptCallback,
  timingSafeEqual
} from "node:crypto";
import { promisify } from "node:util";

const scrypt = promisify(scryptCallback);
const KEY_BYTES = 32;
const DERIVED_BYTES = 64;

export interface StoredKeyHash {
  algorithm: "scrypt";
  salt: string;
  hash: string;
}

export function generateAccessKey(): string {
  return randomBytes(KEY_BYTES).toString("base64url");
}

export async function hashAccessKey(
  key: string,
  salt = randomBytes(16)
): Promise<StoredKeyHash> {
  const derived = (await scrypt(key, salt, DERIVED_BYTES)) as Buffer;
  return {
    algorithm: "scrypt",
    salt: salt.toString("base64url"),
    hash: derived.toString("base64url")
  };
}

export async function verifyAccessKey(
  key: string,
  stored: StoredKeyHash
): Promise<boolean> {
  if (stored.algorithm !== "scrypt") return false;
  const salt = Buffer.from(stored.salt, "base64url");
  const expected = Buffer.from(stored.hash, "base64url");
  const actual = (await scrypt(key, salt, expected.length)) as Buffer;
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

export function generateSessionToken(): string {
  return randomBytes(32).toString("base64url");
}
