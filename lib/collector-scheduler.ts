const minimumCollectorIntervalMs = 60_000;

export function collectorIntervalMs(
  envName: string,
  fallbackMs: number
): number {
  const value = process.env[envName]?.trim();

  if (!value) {
    return fallbackMs;
  }

  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < minimumCollectorIntervalMs) {
    throw new Error(
      `${envName} must be an integer greater than or equal to ${minimumCollectorIntervalMs}.`
    );
  }

  return parsed;
}

export type QueuedCollectorTask<T> = {
  readonly started: boolean;
  cancel: () => boolean;
  result: Promise<
    | { status: "completed"; value: T }
    | { status: "cancelled" }
  >;
};

let collectorQueueTail = Promise.resolve();

export function enqueueCollectorTask<T>(
  task: () => Promise<T>
): QueuedCollectorTask<T> {
  let cancelled = false;
  let started = false;

  const result = collectorQueueTail.then(async () => {
    if (cancelled) {
      return { status: "cancelled" } as const;
    }

    started = true;
    return { status: "completed", value: await task() } as const;
  });

  collectorQueueTail = result.then(
    () => undefined,
    () => undefined
  );

  return {
    get started() {
      return started;
    },
    cancel() {
      if (started) {
        return false;
      }

      cancelled = true;
      return true;
    },
    result,
  };
}
