import { EventEmitter } from "node:events";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { resolve, join } from "node:path";
import type { Socket } from "node:net";
import { afterEach, describe, expect, it, vi } from "vitest";
import { encodeJsonl } from "@pi-web/pi-rpc";
import {
  SessiondClient,
  sessiondResponseError
} from "./sessiond-client.js";

const testRoots: string[] = [];

afterEach(async () => {
  await Promise.all(
    testRoots.splice(0).map(async (root) => {
      await rm(root, { recursive: true, force: true });
    })
  );
});

describe("SessiondClient", () => {
  it.each([404, 409, 429, 500])(
    "preserves an IPC HTTP %i status",
    (statusCode) => {
      expect(
        sessiondResponseError({
          code: "DOWNSTREAM_ERROR",
          message: "request failed",
          statusCode
        })
      ).toMatchObject({
        code: "DOWNSTREAM_ERROR",
        message: "request failed",
        statusCode
      });
    }
  );

  it("maps an out-of-range IPC status to HTTP 500", () => {
    expect(
      sessiondResponseError({
        code: "BROKEN_STATUS",
        message: "request failed",
        statusCode: 200
      })
    ).toMatchObject({ statusCode: 500 });
  });

  it("does not let a stale socket close reject a new connection request", async () => {
    const root = await temporaryRoot();
    const tokenFile = join(root, "ipc-token");
    await writeFile(tokenFile, "server-token\n", "utf8");
    const oldSocket = new FakeSocket();
    const newSocket = new FakeSocket();
    const sockets = [oldSocket, newSocket];
    const connect = vi.fn(() => sockets.shift() as unknown as Socket);
    const client = new SessiondClient(
      "test-sessiond.sock",
      tokenFile,
      connect as typeof import("node:net").createConnection
    );

    const started = client.start();
    await vi.waitFor(() => expect(connect).toHaveBeenCalledTimes(1));
    oldSocket.emit("connect");
    await started;

    oldSocket.writable = false;
    const request = client.request<{ ok: boolean }>("health");
    await vi.waitFor(() => expect(connect).toHaveBeenCalledTimes(2));
    newSocket.emit("connect");
    await vi.waitFor(() => expect(newSocket.writes).toHaveLength(1));
    const requestId = JSON.parse(newSocket.writes[0]!).id as string;

    oldSocket.emit("close");
    newSocket.emit(
      "data",
      Buffer.from(
        encodeJsonl({
          kind: "response",
          id: requestId,
          ok: true,
          result: { ok: true }
        })
      )
    );

    await expect(request).resolves.toEqual({ ok: true });
    client.stop();
  });

  it("does not let an in-flight connection revive a stopped client", async () => {
    const root = await temporaryRoot();
    const tokenFile = join(root, "ipc-token");
    await writeFile(tokenFile, "server-token\n", "utf8");
    const socket = new FakeSocket();
    const connect = vi.fn(() => socket as unknown as Socket);
    const client = new SessiondClient(
      "test-sessiond.sock",
      tokenFile,
      connect as typeof import("node:net").createConnection
    );

    const started = client.start();
    await vi.waitFor(() => expect(connect).toHaveBeenCalledOnce());
    client.stop();
    socket.emit("connect");

    await expect(started).rejects.toMatchObject({
      code: "SESSIOND_UNAVAILABLE",
      statusCode: 503
    });
    expect(socket.writable).toBe(false);
    await expect(client.request("health")).rejects.toMatchObject({
      code: "SESSIOND_UNAVAILABLE",
      statusCode: 503
    });
  });
});

class FakeSocket extends EventEmitter {
  writable = true;
  readonly writes: string[] = [];

  setNoDelay(): this {
    return this;
  }

  write(
    value: string,
    callback?: (error?: Error | null) => void
  ): boolean {
    this.writes.push(value);
    callback?.(null);
    return true;
  }

  destroy(): this {
    this.writable = false;
    return this;
  }
}

async function temporaryRoot(): Promise<string> {
  const parent = resolve(process.cwd(), ".runtime/tests");
  await mkdir(parent, { recursive: true });
  const root = await mkdtemp(join(parent, "sessiond-client-"));
  testRoots.push(root);
  return root;
}
