import {
  generateAccessKey,
  hashAccessKey,
  type StoredKeyHash
} from "@pi-web/shared";

interface AccessKeySettings {
  getSetting(key: "access_key_hash"): StoredKeyHash | null;
  setSetting(key: "access_key_hash", value: StoredKeyHash): void;
}

export async function prepareInstalledAccessKey(
  settings: AccessKeySettings,
  environmentKey: string | undefined
): Promise<{ generatedKey: string | null }> {
  if (environmentKey) {
    settings.setSetting("access_key_hash", await hashAccessKey(environmentKey));
    return { generatedKey: null };
  }
  if (settings.getSetting("access_key_hash")) {
    return { generatedKey: null };
  }
  const generatedKey = generateAccessKey();
  settings.setSetting("access_key_hash", await hashAccessKey(generatedKey));
  return { generatedKey };
}
