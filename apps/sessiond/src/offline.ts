import type { PiWebConfig } from "@pi-web/config";
import type {
  AuthRotateInput,
  SessiondDoctorResult
} from "@pi-web/protocol";
import {
  generateAccessKey,
  hashAccessKey,
  safeErrorMessage
} from "@pi-web/shared";
import { SessionDatabase } from "./database.js";
import { PiManager } from "./pi-manager.js";

export async function prepareOfflineAccessKey(
  databaseFile: string,
  environmentKey: string | undefined
): Promise<{ generatedKey: string | null }> {
  const database = new SessionDatabase(databaseFile);
  try {
    if (environmentKey) {
      database.settings.set(
        "access_key_hash",
        await hashAccessKey(environmentKey)
      );
      return { generatedKey: null };
    }
    if (database.settings.get("access_key_hash")) {
      return { generatedKey: null };
    }
    const generatedKey = generateAccessKey();
    database.settings.set(
      "access_key_hash",
      await hashAccessKey(generatedKey)
    );
    return { generatedKey };
  } finally {
    database.close();
  }
}

export function rotateOfflineAccessKey(
  databaseFile: string,
  input: AuthRotateInput
): void {
  const database = new SessionDatabase(databaseFile);
  try {
    database.auth.rotateAccessKey(input);
  } finally {
    database.close();
  }
}

export async function probeOfflineSessiond(
  databaseFile: string,
  socketPath: string,
  config: PiWebConfig
): Promise<SessiondDoctorResult> {
  let database: SessionDatabase | null = null;
  try {
    database = new SessionDatabase(databaseFile);
    return {
      database: true,
      socket: socketPath,
      scheduler: false,
      activeWorkers: 0,
      pi: await new PiManager(config, database.audit).doctorProbe()
    };
  } catch (error) {
    return {
      database: false,
      socket: socketPath,
      scheduler: false,
      activeWorkers: 0,
      pi: {
        available: false,
        version: null,
        minimumVersion: "0.84.1",
        compatible: false,
        rpcStartable: false,
        rpcCommands: [],
        packageCommands: false,
        errors: [safeErrorMessage(error)]
      }
    };
  } finally {
    database?.close();
  }
}
