import assert from "node:assert/strict";
import test from "node:test";
import {
  collectorIntervalMs,
  enqueueCollectorTask,
} from "./collector-scheduler.ts";

test("collector intervals use defaults and reject unsafe values", () => {
  const name = "TEST_COLLECTOR_INTERVAL_MS";
  const previous = process.env[name];

  try {
    delete process.env[name];
    assert.equal(collectorIntervalMs(name, 300_000), 300_000);

    process.env[name] = "900000";
    assert.equal(collectorIntervalMs(name, 300_000), 900_000);

    process.env[name] = "999";
    assert.throws(() => collectorIntervalMs(name, 300_000), /greater than or equal/);
  } finally {
    if (previous === undefined) {
      delete process.env[name];
    } else {
      process.env[name] = previous;
    }
  }
});

test("collector tasks run one at a time and queued tasks can be cancelled", async () => {
  const events: string[] = [];
  let releaseFirst!: () => void;
  const firstGate = new Promise<void>((resolve) => {
    releaseFirst = resolve;
  });

  const first = enqueueCollectorTask(async () => {
    events.push("first:start");
    await firstGate;
    events.push("first:end");
    return "first";
  });
  const second = enqueueCollectorTask(async () => {
    events.push("second:start");
    return "second";
  });
  const cancelled = enqueueCollectorTask(async () => {
    events.push("cancelled:start");
    return "cancelled";
  });

  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.deepEqual(events, ["first:start"]);
  assert.equal(first.started, true);
  assert.equal(second.started, false);
  assert.equal(cancelled.cancel(), true);

  releaseFirst();
  assert.deepEqual(await first.result, { status: "completed", value: "first" });
  assert.deepEqual(await second.result, { status: "completed", value: "second" });
  assert.deepEqual(await cancelled.result, { status: "cancelled" });
  assert.deepEqual(events, ["first:start", "first:end", "second:start"]);
});
