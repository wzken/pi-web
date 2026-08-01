import { mkdtemp, readFile, unlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  acquireSessiondOwnerLease,
  sessiondOwnerLeasePath,
  type OwnerLeaseDependencies
} from "./owner-lease.js";

describe("Sessiond owner lease", () => {
  it("publishes only one owner when two processes race", async () => {
    const paths = await fixture();
    const attempts = await Promise.allSettled([
      acquireSessiondOwnerLease(
        paths,
        dependencies(101, "first", () => true)
      ),
      acquireSessiondOwnerLease(
        paths,
        dependencies(202, "second", () => true)
      )
    ]);
    const acquired = attempts.filter(
      (attempt): attempt is PromiseFulfilledResult<
        Awaited<ReturnType<typeof acquireSessiondOwnerLease>>
      > => attempt.status === "fulfilled"
    );
    const refused = attempts.filter(
      (attempt) => attempt.status === "rejected"
    );

    expect(acquired).toHaveLength(1);
    expect(refused).toHaveLength(1);
    expect(refused[0]).toMatchObject({
      reason: { code: "SESSIOND_OWNER_BUSY" }
    });
    await acquired[0]!.value.release();
  });

  it("prevents a second live owner and releases normally", async () => {
    const paths = await fixture();
    const first = await acquireSessiondOwnerLease(
      paths,
      dependencies(101, "first", (pid) => pid === 101)
    );

    await expect(
      acquireSessiondOwnerLease(
        paths,
        dependencies(202, "second", (pid) => pid === 101)
      )
    ).rejects.toMatchObject({ code: "SESSIOND_OWNER_BUSY" });

    await first.release();
    const second = await acquireSessiondOwnerLease(
      paths,
      dependencies(202, "second", () => false)
    );
    await second.release();
    await expect(readFile(sessiondOwnerLeasePath(paths), "utf8")).rejects.toMatchObject({
      code: "ENOENT"
    });
  });

  it("reclaims a stale owner record", async () => {
    const paths = await fixture();
    await acquireSessiondOwnerLease(
      paths,
      dependencies(101, "stale", () => false)
    );

    const lease = await acquireSessiondOwnerLease(
      paths,
      dependencies(202, "fresh", () => false)
    );

    expect(JSON.parse(await readFile(lease.path, "utf8"))).toMatchObject({
      pid: 202,
      nonce: "fresh"
    });
    await lease.release();
  });

  it("does not let an old release delete a replacement owner", async () => {
    const paths = await fixture();
    const first = await acquireSessiondOwnerLease(
      paths,
      dependencies(101, "first", () => false)
    );
    await unlink(first.path);
    const second = await acquireSessiondOwnerLease(
      paths,
      dependencies(202, "second", () => false)
    );

    await first.release();

    expect(JSON.parse(await readFile(second.path, "utf8"))).toMatchObject({
      pid: 202,
      nonce: "second"
    });
    await second.release();
  });
});

async function fixture(): Promise<{ runtimeDir: string }> {
  return {
    runtimeDir: await mkdtemp(join(tmpdir(), "pi-web-owner-lease-"))
  };
}

function dependencies(
  pid: number,
  nonce: string,
  alive: (pid: number) => boolean
): OwnerLeaseDependencies {
  return {
    pid,
    createNonce: vi.fn(() => nonce),
    isProcessAlive: vi.fn(alive),
    now: () => new Date("2026-01-01T00:00:00.000Z")
  };
}
