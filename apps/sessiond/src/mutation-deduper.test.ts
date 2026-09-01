import { describe, expect, it, vi } from "vitest";
import { TransientMutationDeduper } from "./mutation-deduper.js";

describe("TransientMutationDeduper", () => {
  it("shares concurrent work and remembers accepted mutations", async () => {
    const deduper = new TransientMutationDeduper();
    let resolveOperation!: (value: string) => void;
    const operation = vi.fn(
      () =>
        new Promise<string>((resolve) => {
          resolveOperation = resolve;
        })
    );

    const first = deduper.run("prompt:mutation-1", "payload-1", operation);
    const concurrent = deduper.run(
      "prompt:mutation-1",
      "payload-1",
      operation
    );
    expect(operation).toHaveBeenCalledOnce();
    resolveOperation("accepted");

    await expect(Promise.all([first, concurrent])).resolves.toEqual([
      "accepted",
      "accepted"
    ]);
    await expect(
      deduper.run("prompt:mutation-1", "payload-1", operation)
    ).resolves.toBe("accepted");
    expect(operation).toHaveBeenCalledOnce();
  });

  it("allows retry after a failed mutation", async () => {
    const deduper = new TransientMutationDeduper();
    const operation = vi
      .fn<() => Promise<string>>()
      .mockRejectedValueOnce(new Error("worker unavailable"))
      .mockResolvedValueOnce("accepted");

    await expect(
      deduper.run("resume:mutation-1", "payload-1", operation)
    ).rejects.toThrow("worker unavailable");
    await expect(
      deduper.run("resume:mutation-1", "payload-1", operation)
    ).resolves.toBe("accepted");
    expect(operation).toHaveBeenCalledTimes(2);
  });

  it("executes different mutation IDs independently", async () => {
    const deduper = new TransientMutationDeduper();
    const operation = vi.fn(async (value: string) => value);

    await expect(
      Promise.all([
        deduper.run(
          "prompt:mutation-1",
          "payload-1",
          () => operation("first")
        ),
        deduper.run(
          "prompt:mutation-2",
          "payload-2",
          () => operation("second")
        )
      ])
    ).resolves.toEqual(["first", "second"]);
    expect(operation).toHaveBeenCalledTimes(2);
  });

  it("rejects reuse of an ID with a different payload", async () => {
    const deduper = new TransientMutationDeduper();
    const operation = vi.fn(async () => "accepted");

    await deduper.run("prompt:mutation-1", "payload-1", operation);
    await expect(
      deduper.run("prompt:mutation-1", "payload-2", operation)
    ).rejects.toMatchObject({
      code: "MUTATION_ID_REUSED",
      statusCode: 409
    });
    expect(operation).toHaveBeenCalledOnce();
  });

  it("bounds pending and accepted mutation memory", async () => {
    const deduper = new TransientMutationDeduper(1, 1);
    let resolvePending!: () => void;
    const pending = deduper.run(
      "prompt:pending-1",
      "payload-1",
      () =>
        new Promise<void>((resolve) => {
          resolvePending = resolve;
        })
    );
    await expect(
      deduper.run(
        "prompt:pending-2",
        "payload-2",
        async () => undefined
      )
    ).rejects.toMatchObject({
      code: "MUTATION_LIMIT",
      statusCode: 429
    });
    resolvePending();
    await pending;

    const operation = vi.fn(async () => undefined);
    await deduper.run("prompt:accepted-2", "payload-2", operation);
    await deduper.run("prompt:pending-1", "payload-1", operation);
    expect(operation).toHaveBeenCalledTimes(2);
  });
});
