/**
 * Server sync drain for the offline stamp queue.
 * Pure logic. No React Native imports, no network code, no secrets.
 *
 * The app stamps locally first and queues each stamp in the
 * OfflineStampQueue. This drain sends queued stamps to the Wallet
 * backend in FIFO order, oldest first. A stamp leaves the queue only
 * when the backend accepts it. A failed send is recorded with
 * markFailed, so the queue's own rules apply: retry on the next drain
 * and drop after 3 failed retries, keeping the stamp in the dropped
 * list for staff to check.
 *
 * The backend call itself is an injected sender function, so tests
 * can fake it and the real sender can be wired later without changing
 * the drain. A sender resolves when the backend accepted the stamp
 * and rejects on any failure. The drain never sends the same stamp
 * twice: the queue dedupes by stamp id, one drain runs at a time,
 * and a stamp already being sent is skipped.
 *
 * A failed send stops the current drain pass. The usual failure is
 * an unreachable backend, and hammering the next stamps would only
 * burn their retries. The next scheduled drain retries from the
 * oldest stamp again.
 *
 * Until the backend endpoint exists, App.tsx starts the drain with
 * the unconfigured stub sender below. The stub logs once per drain
 * pass that server sync is not configured yet and throws
 * SyncNotConfiguredError, which the drain treats as "leave the stamp
 * queued, count no failure, stop this pass". Stamps keep
 * accumulating safely and the app stamps normally.
 */
import { OfflineStampQueue } from "./offlineQueue";
import type { QueuedStamp } from "./offlineQueue";

/** Drain every 30 seconds by default, the same cadence as the Wallet push workers. */
export const DEFAULT_SYNC_INTERVAL_MS = 30_000;

/** Send one queued stamp to the backend. Resolve when accepted, reject on failure. */
export type StampSender = (stamp: QueuedStamp) => Promise<void>;

/** Thrown by the unconfigured stub sender. The drain never burns a retry on it. */
export class SyncNotConfiguredError extends Error {
  constructor() {
    super("Server sync is not configured.");
    this.name = "SyncNotConfiguredError";
  }
}

export interface DrainResult {
  /** Stamps the backend accepted on this pass. */
  sent: number;
  /** Stamps that failed to send on this pass. */
  failed: number;
  /** Stamps dropped on this pass after 3 failed retries. */
  dropped: number;
  /** True when the pass stopped because sync is not configured yet. */
  notConfigured: boolean;
}

function emptyResult(): DrainResult {
  return { sent: 0, failed: 0, dropped: 0, notConfigured: false };
}

/**
 * Stub sender for App.tsx until the backend stamp endpoint exists.
 * Logs that server sync is not configured yet, then throws
 * SyncNotConfiguredError. The drain leaves the stamp queued and
 * records no failure. Replace this with the real sender that posts
 * each stamp to the Wallet backend; the drain does not change.
 */
export function createUnconfiguredStampSender(
  log: (message: string) => void = console.log,
): StampSender {
  return async () => {
    log("Server sync is not configured yet.");
    throw new SyncNotConfiguredError();
  };
}

/**
 * Drains an OfflineStampQueue to the backend.
 * One drain runs at a time: a drain call landing mid-drain shares the
 * same in-flight pass. start() drains once immediately, then on a
 * bounded cadence. stop() clears the timer and blocks later drains;
 * a drain already in flight finishes.
 */
export class OfflineSyncDrain {
  private timer: ReturnType<typeof setInterval> | null = null;
  private flight: Promise<DrainResult> | null = null;
  private inFlightIds = new Set<string>();
  private stopped = false;

  constructor(
    private readonly queue: OfflineStampQueue,
    private readonly send: StampSender,
    private readonly intervalMs: number = DEFAULT_SYNC_INTERVAL_MS,
  ) {}

  /** Drain the queue once. Call this when the app comes back online. */
  drain(): Promise<DrainResult> {
    if (this.stopped) {
      return Promise.resolve(emptyResult());
    }
    if (this.flight !== null) {
      return this.flight;
    }
    this.flight = this.runDrain().finally(() => {
      this.flight = null;
    });
    return this.flight;
  }

  /** Start the drain loop. Drains once immediately, then every interval. */
  start(): void {
    if (this.stopped || this.timer !== null) {
      return;
    }
    this.timer = setInterval(() => {
      void this.drain();
    }, this.intervalMs);
    void this.drain();
  }

  /** Stop the drain loop. A drain already in flight finishes. */
  stop(): void {
    this.stopped = true;
    if (this.timer !== null) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  private async runDrain(): Promise<DrainResult> {
    const result = emptyResult();
    for (;;) {
      const stamp = this.queue.next();
      if (stamp === null) {
        break;
      }
      if (this.inFlightIds.has(stamp.id)) {
        break;
      }
      this.inFlightIds.add(stamp.id);
      try {
        await this.send(stamp);
        this.queue.markSent(stamp.id);
        result.sent += 1;
      } catch (error) {
        if (error instanceof SyncNotConfiguredError) {
          result.notConfigured = true;
          break;
        }
        const outcome = this.queue.markFailed(stamp.id);
        result.failed += 1;
        if (outcome === "dropped") {
          result.dropped += 1;
        }
        break;
      } finally {
        this.inFlightIds.delete(stamp.id);
      }
    }
    return result;
  }
}

export function createOfflineSyncDrain(
  queue: OfflineStampQueue,
  send: StampSender,
  intervalMs: number = DEFAULT_SYNC_INTERVAL_MS,
): OfflineSyncDrain {
  return new OfflineSyncDrain(queue, send, intervalMs);
}
