import { createHash, type Hash } from "node:crypto";

export function fingerprintMutationPayload(payload: unknown): string {
  const hash = createHash("sha256");
  writeCanonical(hash, payload);
  return hash.digest("hex");
}

function writeCanonical(hash: Hash, value: unknown): void {
  if (value === null) {
    hash.update("null;");
    return;
  }
  if (Array.isArray(value)) {
    hash.update("[");
    for (const item of value) writeCanonical(hash, item);
    hash.update("];");
    return;
  }
  switch (typeof value) {
    case "boolean":
      hash.update(value ? "true;" : "false;");
      return;
    case "number":
      hash.update(`number:${JSON.stringify(value)};`);
      return;
    case "string":
      hash.update(`string:${JSON.stringify(value)};`);
      return;
    case "object": {
      hash.update("{");
      const record = value as Record<string, unknown>;
      for (const key of Object.keys(record).sort()) {
        if (record[key] === undefined) continue;
        hash.update(`key:${JSON.stringify(key)};`);
        writeCanonical(hash, record[key]);
      }
      hash.update("};");
      return;
    }
    default:
      hash.update(`${typeof value};`);
  }
}
