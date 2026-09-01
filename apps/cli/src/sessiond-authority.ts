import { createConnection } from "node:net";
import type { PiWebPaths } from "@pi-web/config";
import type {
  AuthRotateInput,
  SessiondDoctorResult
} from "@pi-web/protocol";
import { SessiondClient } from "@pi-web/ipc";
import {
  acquireSessiondOwnerLease,
  type SessiondOwnerLease
} from "@pi-web/sessiond";

type AuthorityPaths = Pick<
  PiWebPaths,
  "socketPath" | "ipcTokenFile" | "runtimeDir"
>;

export interface SessiondAuthorityClient {
  start(): Promise<void>;
  rotateAccessKey(input: AuthRotateInput): Promise<{ updated: true }>;
  doctor(timeoutMs?: number): Promise<SessiondDoctorResult>;
  prepareServiceChange(
    action: "stop" | "restart" | "uninstall",
    force: boolean
  ): Promise<{ activeWorkers: number; forced: boolean }>;
  cancelServiceChange(): Promise<{ cancelled: true }>;
  stop(): void;
}

export interface SessiondAuthorityDependencies {
  canConnect(socketPath: string): Promise<boolean>;
  createClient(paths: AuthorityPaths): SessiondAuthorityClient;
  acquireOfflineLease(
    paths: Pick<PiWebPaths, "runtimeDir">
  ): Promise<SessiondOwnerLease>;
}

const defaultDependencies: SessiondAuthorityDependencies = {
  canConnect: canConnectSessiond,
  createClient: (paths) =>
    new SessiondClient(paths.socketPath, paths.ipcTokenFile),
  acquireOfflineLease: acquireSessiondOwnerLease
};

export async function rotateAccessKeyWithAuthority(
  paths: AuthorityPaths,
  input: AuthRotateInput,
  writeOffline: () => Promise<void> | void,
  dependencies: SessiondAuthorityDependencies = defaultDependencies
): Promise<"sessiond" | "offline"> {
  const client = await connectRunningSessiond(paths, dependencies);
  if (!client) {
    await withOfflineSessiondLease(
      paths,
      writeOffline,
      dependencies.acquireOfflineLease
    );
    return "offline";
  }
  try {
    await client.rotateAccessKey(input);
    return "sessiond";
  } finally {
    client.stop();
  }
}

export async function doctorWithAuthority(
  paths: AuthorityPaths,
  probeOffline: () => Promise<SessiondDoctorResult>,
  dependencies: SessiondAuthorityDependencies = defaultDependencies
): Promise<
  | { source: "sessiond"; result: SessiondDoctorResult }
  | { source: "offline"; result: SessiondDoctorResult }
> {
  const client = await connectRunningSessiond(paths, dependencies);
  if (!client) {
    return {
      source: "offline",
      result: await withOfflineSessiondLease(
        paths,
        probeOffline,
        dependencies.acquireOfflineLease
      )
    };
  }
  try {
    return { source: "sessiond", result: await client.doctor() };
  } finally {
    client.stop();
  }
}

export async function authorizeServiceChangeWithAuthority(
  paths: AuthorityPaths,
  action: "stop" | "restart" | "uninstall",
  force: boolean,
  dependencies: SessiondAuthorityDependencies = defaultDependencies
): Promise<{
  activeWorkers: number;
  forced: boolean;
  cancel: () => Promise<void>;
  release: () => void;
}> {
  const client = await connectRunningSessiond(paths, dependencies);
  if (!client) {
    return {
      activeWorkers: 0,
      forced: false,
      cancel: async () => undefined,
      release: () => undefined
    };
  }
  try {
    const result = await client.prepareServiceChange(action, force);
    return {
      ...result,
      cancel: async () => {
        try {
          await client.cancelServiceChange();
        } finally {
          client.stop();
        }
      },
      release: () => client.stop()
    };
  } catch (error) {
    client.stop();
    throw error;
  }
}

export async function canConnectSessiond(socketPath: string): Promise<boolean> {
  return await new Promise<boolean>((resolve) => {
    const socket = createConnection(socketPath);
    let settled = false;
    const done = (value: boolean) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve(value);
    };
    socket.setTimeout(700, () => done(false));
    socket.once("connect", () => done(true));
    socket.once("error", () => done(false));
  });
}

export async function withOfflineSessiondLease<T>(
  paths: Pick<PiWebPaths, "runtimeDir">,
  operation: () => Promise<T> | T,
  acquire: (
    paths: Pick<PiWebPaths, "runtimeDir">
  ) => Promise<SessiondOwnerLease> = acquireSessiondOwnerLease
): Promise<T> {
  const lease = await acquire(paths);
  try {
    return await operation();
  } finally {
    await lease.release();
  }
}

async function connectRunningSessiond(
  paths: AuthorityPaths,
  dependencies: SessiondAuthorityDependencies
): Promise<SessiondAuthorityClient | null> {
  if (!(await dependencies.canConnect(paths.socketPath))) return null;
  const client = dependencies.createClient(paths);
  try {
    await client.start();
    return client;
  } catch (error) {
    client.stop();
    throw error;
  }
}
