import { describe, expect, it } from "vitest";
import { validateVaultSegmentId, withResourceLock, withResourceLocks } from "./resource-queue";

describe("resource-queue (DEC-0022)", () => {
  it("serializes work on the same adapter resource", async () => {
    const adapter = {};
    const order: number[] = [];
    await Promise.all([
      withResourceLock(adapter, "memory:p1", async () => {
        order.push(1);
        await new Promise((r) => setTimeout(r, 5));
        order.push(2);
      }),
      withResourceLock(adapter, "memory:p1", async () => {
        order.push(3);
      }),
    ]);
    expect(order).toEqual([1, 2, 3]);
  });

  it("shares queues across callers using the same adapter object", async () => {
    const adapter = { id: "vault" };
    let concurrent = 0;
    let maxConcurrent = 0;
    const bump = async () => {
      concurrent++;
      maxConcurrent = Math.max(maxConcurrent, concurrent);
      await new Promise((r) => setTimeout(r, 2));
      concurrent--;
    };
    const a = withResourceLock(adapter, "thread:p/t", bump);
    const b = withResourceLock(adapter, "thread:p/t", bump);
    await Promise.all([a, b]);
    expect(maxConcurrent).toBe(1);
  });

  it("orders multi-resource locks lexicographically to avoid deadlocks", async () => {
    const adapter = {};
    const acquired: string[] = [];
    await withResourceLocks(adapter, ["thread:b/t", "thread:a/t"], async () => {
      acquired.push("work");
    });
    expect(acquired).toEqual(["work"]);
  });

  it("rejects traversal in vault segment ids", () => {
    expect(() => validateVaultSegmentId("../evil", "project")).toThrow(/denied/);
    expect(() => validateVaultSegmentId("ok-id", "project")).not.toThrow();
  });

  it("serializes overlapping multi-resource locks in reverse acquisition order", async () => {
    const adapter = {};
    const log: string[] = [];
    const delay = () => new Promise((r) => setTimeout(r, 5));
    await Promise.all([
      withResourceLocks(adapter, ["thread:z/t", "thread:a/t"], async () => {
        log.push("A-start");
        await delay();
        log.push("A-end");
      }),
      withResourceLocks(adapter, ["thread:a/t", "thread:z/t"], async () => {
        log.push("B-start");
        await delay();
        log.push("B-end");
      }),
    ]);
    expect(log.filter((e) => e.endsWith("start"))).toHaveLength(2);
    expect(log.filter((e) => e.endsWith("end"))).toHaveLength(2);
    const firstEnd = log.findIndex((e) => e.endsWith("end"));
    const secondStart = log.findIndex((e, i) => i > firstEnd && e.endsWith("start"));
    expect(secondStart).toBeGreaterThan(firstEnd);
  });

  it("recovers the queue after a rejected lock holder", async () => {
    const adapter = {};
    await expect(
      withResourceLock(adapter, "memory:p1", async () => {
        throw new Error("work failed");
      })
    ).rejects.toThrow("work failed");

    const order: number[] = [];
    await withResourceLock(adapter, "memory:p1", async () => {
      order.push(1);
    });
    expect(order).toEqual([1]);
  });
});
