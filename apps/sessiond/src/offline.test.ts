import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { verifyAccessKey, type StoredKeyHash } from "@pi-web/shared";
import { SessionDatabase } from "./database.js";
import { prepareOfflineAccessKey } from "./offline.js";

describe("offline Sessiond operations", () => {
  it("stores an environment access key without returning it", async () => {
    const file = await databaseFile();

    await expect(
      prepareOfflineAccessKey(file, "environment-secret")
    ).resolves.toEqual({ generatedKey: null });

    const database = new SessionDatabase(file);
    const hash = database.settings.get<StoredKeyHash>("access_key_hash");
    database.close();
    expect(hash).not.toBeNull();
    await expect(verifyAccessKey("environment-secret", hash!)).resolves.toBe(
      true
    );
  });

  it("generates a key only when none is stored", async () => {
    const file = await databaseFile();
    const first = await prepareOfflineAccessKey(file, undefined);
    const second = await prepareOfflineAccessKey(file, undefined);

    expect(first.generatedKey).toBeTruthy();
    expect(second.generatedKey).toBeNull();
  });
});

async function databaseFile(): Promise<string> {
  return join(
    await mkdtemp(join(tmpdir(), "pi-web-offline-")),
    "pi-web.sqlite"
  );
}
