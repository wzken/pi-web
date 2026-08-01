import { describe, expect, it, vi } from "vitest";
import type { SessiondDoctorResult } from "@pi-web/protocol";
import {
  doctorWithAuthority,
  rotateAccessKeyWithAuthority,
  withOfflineSessiondLease,
  type SessiondAuthorityClient,
  type SessiondAuthorityDependencies
} from "./sessiond-authority.js";

const paths = {
  socketPath: "sessiond.sock",
  ipcTokenFile: "sessiond.token",
  runtimeDir: "runtime"
};

const rotation = {
  hash: {
    algorithm: "scrypt" as const,
    salt: "salt",
    hash: "hash"
  },
  auditType: "access_key.reset" as const,
  actor: "cli" as const
};

const doctorResult: SessiondDoctorResult = {
  database: true,
  socket: paths.socketPath,
  scheduler: true,
  activeWorkers: 2,
  pi: {
    available: true,
    version: "1.0.0",
    rpcStartable: true,
    packageCommands: true,
    errors: []
  }
};

describe("CLI Sessiond authority routing", () => {
  it("rotates through Sessiond without opening the offline store", async () => {
    const client = fakeClient();
    const writeOffline = vi.fn();

    await expect(
      rotateAccessKeyWithAuthority(
        paths,
        rotation,
        writeOffline,
        dependencies(true, client)
      )
    ).resolves.toBe("sessiond");

    expect(client.rotateAccessKey).toHaveBeenCalledWith(rotation);
    expect(writeOffline).not.toHaveBeenCalled();
    expect(client.stop).toHaveBeenCalledOnce();
  });

  it("does not fall back to SQLite after an online rotation failure", async () => {
    const failure = new Error("IPC write failed");
    const client = fakeClient({
      rotateAccessKey: vi.fn().mockRejectedValue(failure)
    });
    const writeOffline = vi.fn();

    const authorityDependencies = dependencies(true, client);
    await expect(
      rotateAccessKeyWithAuthority(
        paths,
        rotation,
        writeOffline,
        authorityDependencies
      )
    ).rejects.toBe(failure);

    expect(writeOffline).not.toHaveBeenCalled();
    expect(authorityDependencies.acquireOfflineLease).not.toHaveBeenCalled();
    expect(client.stop).toHaveBeenCalledOnce();
  });

  it("does not fall back when Sessiond disappears between detection and connect", async () => {
    const failure = new Error("Sessiond stopped");
    const client = fakeClient({
      start: vi.fn().mockRejectedValue(failure)
    });
    const writeOffline = vi.fn();

    await expect(
      rotateAccessKeyWithAuthority(
        paths,
        rotation,
        writeOffline,
        dependencies(true, client)
      )
    ).rejects.toBe(failure);

    expect(writeOffline).not.toHaveBeenCalled();
    expect(client.stop).toHaveBeenCalledOnce();
  });

  it("uses the daemon doctor result without creating an offline PiManager", async () => {
    const client = fakeClient();
    const probeOffline = vi.fn(async () => doctorResult);

    await expect(
      doctorWithAuthority(
        paths,
        probeOffline,
        dependencies(true, client)
      )
    ).resolves.toEqual({ source: "sessiond", result: doctorResult });

    expect(client.doctor).toHaveBeenCalledOnce();
    expect(probeOffline).not.toHaveBeenCalled();
  });

  it("does not create an offline PiManager after an online doctor failure", async () => {
    const failure = new Error("doctor IPC failed");
    const client = fakeClient({
      doctor: vi.fn().mockRejectedValue(failure)
    });
    const probeOffline = vi.fn(async () => doctorResult);

    const authorityDependencies = dependencies(true, client);
    await expect(
      doctorWithAuthority(
        paths,
        probeOffline,
        authorityDependencies
      )
    ).rejects.toBe(failure);

    expect(probeOffline).not.toHaveBeenCalled();
    expect(authorityDependencies.acquireOfflineLease).not.toHaveBeenCalled();
    expect(client.stop).toHaveBeenCalledOnce();
  });

  it("keeps the compatible offline paths when Sessiond is not running", async () => {
    const client = fakeClient();
    const writeOffline = vi.fn();
    const probeOffline = vi.fn(async () => doctorResult);
    const offlineDependencies = dependencies(false, client);

    await expect(
      rotateAccessKeyWithAuthority(
        paths,
        rotation,
        writeOffline,
        offlineDependencies
      )
    ).resolves.toBe("offline");
    await expect(
      doctorWithAuthority(paths, probeOffline, offlineDependencies)
    ).resolves.toEqual({ source: "offline", result: doctorResult });

    expect(writeOffline).toHaveBeenCalledOnce();
    expect(probeOffline).toHaveBeenCalledOnce();
    expect(offlineDependencies.acquireOfflineLease).toHaveBeenCalledTimes(2);
    expect(offlineDependencies.acquireOfflineLease).toHaveBeenNthCalledWith(
      1,
      paths
    );
    expect(offlineDependencies.releaseOfflineLease).toHaveBeenCalledTimes(2);
    expect(offlineDependencies.createClient).not.toHaveBeenCalled();
  });

  it("refuses offline writes during the Sessiond startup window", async () => {
    const client = fakeClient();
    const writeOffline = vi.fn();
    const startupDependencies = dependencies(false, client);
    vi.mocked(startupDependencies.acquireOfflineLease).mockRejectedValue(
      Object.assign(new Error("Session daemon owns the database"), {
        code: "SESSIOND_OWNER_BUSY"
      })
    );

    await expect(
      rotateAccessKeyWithAuthority(
        paths,
        rotation,
        writeOffline,
        startupDependencies
      )
    ).rejects.toMatchObject({ code: "SESSIOND_OWNER_BUSY" });

    expect(writeOffline).not.toHaveBeenCalled();
    expect(startupDependencies.createClient).not.toHaveBeenCalled();
  });

  it("refuses an offline doctor probe during the Sessiond startup window", async () => {
    const client = fakeClient();
    const probeOffline = vi.fn(async () => doctorResult);
    const startupDependencies = dependencies(false, client);
    vi.mocked(startupDependencies.acquireOfflineLease).mockRejectedValue(
      Object.assign(new Error("Session daemon owns the database"), {
        code: "SESSIOND_OWNER_BUSY"
      })
    );

    await expect(
      doctorWithAuthority(paths, probeOffline, startupDependencies)
    ).rejects.toMatchObject({ code: "SESSIOND_OWNER_BUSY" });

    expect(probeOffline).not.toHaveBeenCalled();
    expect(startupDependencies.createClient).not.toHaveBeenCalled();
  });

  it("releases the offline lease when an offline operation fails", async () => {
    const failure = new Error("offline write failed");
    const authorityDependencies = dependencies(false, fakeClient());

    await expect(
      withOfflineSessiondLease(
        paths,
        () => {
          throw failure;
        },
        authorityDependencies.acquireOfflineLease
      )
    ).rejects.toBe(failure);

    expect(authorityDependencies.releaseOfflineLease).toHaveBeenCalledOnce();
  });
});

function fakeClient(
  overrides: Partial<SessiondAuthorityClient> = {}
): SessiondAuthorityClient {
  return {
    start: vi.fn().mockResolvedValue(undefined),
    rotateAccessKey: vi.fn().mockResolvedValue({ updated: true }),
    doctor: vi.fn().mockResolvedValue(doctorResult),
    stop: vi.fn(),
    ...overrides
  };
}

function dependencies(
  running: boolean,
  client: SessiondAuthorityClient
): SessiondAuthorityDependencies & {
  releaseOfflineLease: ReturnType<typeof vi.fn>;
} {
  const releaseOfflineLease = vi.fn().mockResolvedValue(undefined);
  return {
    canConnect: vi.fn().mockResolvedValue(running),
    createClient: vi.fn(() => client),
    acquireOfflineLease: vi.fn(async () => ({
      path: "runtime/sessiond-owner.json",
      pid: 123,
      nonce: "offline",
      release: releaseOfflineLease
    })),
    releaseOfflineLease
  };
}
