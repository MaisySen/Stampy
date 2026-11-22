/**
 * Offline stamp queue startup for the app.
 * Pure logic around the persistent store. No React Native imports
 * at the top of this file, so the app tests can run it in Node with
 * a fake store factory. The real AsyncStorage backend is loaded
 * lazily by createAsyncStorageQueueStore, only when the app asks
 * for it.
 *
 * App startup order: create the store, await hydrate, then create
 * the queue with the store. A queued stamp then survives an app
 * restart, because hydrate loads the saved queue before the queue
 * is created.
 *
 * Storage failure never stops the app: if the store cannot be
 * created, hydration fails, or the saved data is unreadable, this
 * returns an in-memory queue instead. The app still starts and
 * stamps, and the queue keeps working in memory for the session.
 * The store records the failure in lastError; a store with a
 * recorded error is not used, so a failed read can never wipe
 * stamps that were saved earlier.
 */
import { OfflineStampQueue } from "./offlineQueue";
import {
  createAsyncStorageQueueStore,
} from "./offlineQueueStore";
import type { PersistentOfflineQueueStore } from "./offlineQueueStore";

/** How the startup gets its store. The default is the real AsyncStorage store. */
export type OfflineQueueStoreFactory = () => Promise<PersistentOfflineQueueStore>;

export async function startOfflineStampQueue(
  createStore: OfflineQueueStoreFactory = createAsyncStorageQueueStore,
): Promise<OfflineStampQueue> {
  let store: PersistentOfflineQueueStore;
  try {
    store = await createStore();
    await store.hydrate();
  } catch {
    return new OfflineStampQueue(null);
  }
  if (store.lastError !== null) {
    return new OfflineStampQueue(null);
  }
  return new OfflineStampQueue(store);
}

/**
 * Queue lifecycle for the app, with a state the screen can show.
 *
 * - "starting": the store is still loading. No queue exists yet, so a
 *   stamp taken now is held in the ledger outbox, not lost. The app hands
 *   the outbox to the queue as soon as it is ready.
 * - "durable": the saved queue loaded and the queue writes to storage.
 * - "memory-only": storage could not be read or the saved queue was not
 *   readable. The queue works in memory for this session, a notice says
 *   so, and the saved data is left alone. retry() tries the store again
 *   and moves any in-memory stamps into the durable queue by id, so a
 *   retry cannot lose or duplicate a stamp.
 */
export type QueueState =
  | { phase: "starting" }
  | { phase: "durable"; queue: OfflineStampQueue }
  | { phase: "memory-only"; queue: OfflineStampQueue; reason: string };

export class StampQueueController {
  private current: QueueState = { phase: "starting" };
  private listeners = new Set<(state: QueueState) => void>();
  private starting: Promise<void> | null = null;
  private store: PersistentOfflineQueueStore | null = null;

  constructor(private readonly createStore: OfflineQueueStoreFactory) {}

  get state(): QueueState {
    return this.current;
  }

  subscribe(listener: (state: QueueState) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /** Start once. A second call returns the same promise. */
  start(): Promise<void> {
    if (this.starting === null) {
      this.starting = this.open(null);
    }
    return this.starting;
  }

  /** Try the store again after a memory-only start. Safe to call at any time. */
  async retry(): Promise<void> {
    await this.start();
    if (this.current.phase !== "memory-only") {
      return;
    }
    await this.open(this.current.queue);
  }

  /**
   * Wait for the queue's latest write. True only when the queue is durable
   * and the write landed, so a caller can safely forget a stamp it handed
   * over. Always false while starting or memory-only.
   */
  async flush(): Promise<boolean> {
    const store = this.store;
    if (this.current.phase !== "durable" || store === null) {
      return false;
    }
    await store.flush();
    return store.lastError === null;
  }

  private set(state: QueueState): void {
    this.current = state;
    for (const listener of [...this.listeners]) {
      listener(state);
    }
  }

  private async open(previous: OfflineStampQueue | null): Promise<void> {
    let store: PersistentOfflineQueueStore;
    try {
      store = await this.createStore();
      await store.hydrate();
    } catch (error) {
      this.fallback(previous, error instanceof Error ? error.message : "Storage is not available.");
      return;
    }
    if (store.lastError !== null) {
      this.fallback(previous, store.lastError.message);
      return;
    }
    const queue = new OfflineStampQueue(store);
    this.store = store;
    if (previous !== null) {
      for (const item of previous.pending()) {
        queue.enqueue({
          id: item.id,
          passId: item.passId,
          businessId: item.businessId,
          createdAtMs: item.createdAtMs,
        });
      }
    }
    this.set({ phase: "durable", queue });
  }

  private fallback(previous: OfflineStampQueue | null, reason: string): void {
    const queue = previous ?? new OfflineStampQueue(null);
    this.set({ phase: "memory-only", queue, reason });
  }
}

/**
 * Hand ledger outbox stamps to the queue. enqueue is idempotent by id, so
 * calling this again after a restart or a retry never duplicates a stamp.
 * Returns the ids the queue now holds, so the ledger can drop them from
 * its outbox.
 */
export function handOutboxToQueue(
  queue: OfflineStampQueue,
  outbox: ReadonlyArray<{ id: string; createdAtMs: number }>,
  passId: string,
  businessId: string,
): string[] {
  const handed: string[] = [];
  for (const stamp of outbox) {
    queue.enqueue({
      id: stamp.id,
      passId,
      businessId,
      createdAtMs: stamp.createdAtMs,
    });
    handed.push(stamp.id);
  }
  return handed;
}
