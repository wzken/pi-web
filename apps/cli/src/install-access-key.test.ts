import { describe, expect, it } from "vitest";
import {
  hashAccessKey,
  verifyAccessKey,
  type StoredKeyHash
} from "@pi-web/shared";
import { prepareInstalledAccessKey } from "./install-access-key.js";

class MemorySettings {
  hash: StoredKeyHash | null = null;

  getSetting(): StoredKeyHash | null {
    return this.hash;
  }

  setSetting(_key: "access_key_hash", value: StoredKeyHash): void {
    this.hash = value;
  }
}

describe("systemd install access key", () => {
  it("persists the environment key as a hash for the installed service", async () => {
    const settings = new MemorySettings();

    const result = await prepareInstalledAccessKey(
      settings,
      "environment-install-secret"
    );

    expect(result.generatedKey).toBeNull();
    expect(settings.hash).not.toBeNull();
    expect(
      await verifyAccessKey("environment-install-secret", settings.hash!)
    ).toBe(true);
  });

  it("replaces an older stored hash when the environment key has precedence", async () => {
    const settings = new MemorySettings();
    settings.hash = await hashAccessKey("old-secret");

    await prepareInstalledAccessKey(settings, "new-environment-secret");

    expect(await verifyAccessKey("old-secret", settings.hash!)).toBe(false);
    expect(
      await verifyAccessKey("new-environment-secret", settings.hash!)
    ).toBe(true);
  });

  it("keeps an existing stored key when no environment key is supplied", async () => {
    const settings = new MemorySettings();
    const existing = await hashAccessKey("existing-secret");
    settings.hash = existing;

    const result = await prepareInstalledAccessKey(settings, undefined);

    expect(result.generatedKey).toBeNull();
    expect(settings.hash).toBe(existing);
  });
});
