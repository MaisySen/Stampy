/**
 * Offline stamp queue.
 * Pure logic. No React Native imports, no network code, no secrets.
 *
 * A stamp queued while offline is retried in order when the app is
 * back online. Each stamp has a stable id, so a retry never double
 * stamps. After 3 failed retries a stamp is dropped and kept in the
 * dropped list for staff to check.
 *
 * Storage is in memory by default. Pass an OfflineQueueStore to
 * persist the queue later, for example with AsyncStorage. The store
 * interface is the only persistence contract, the queue never
 * touches storage itself.
 */

export const MAX_QUEUE_RETRIES = 3;

export interface QueuedStamp {
  id: string;
  passId: string;
  businessId: string;
  createdAtMs: number;
  attempts: number;
}

export type NewQueuedStamp = Omit<QueuedStamp, "attempts">;

export type FailedStampOutcome = "retry" | "dropped" | "not-found";

/**
 * Persistence contract for later storage. Load returns the saved
 * queue in order, save stores the whole queue in order. The queue
 * calls save after every change, so a crash loses at most the
 * change in progress.
 */
export interface OfflineQueueStore {
  load(): QueuedStamp[];
  save(items: QueuedStamp[]): void;
}

export class OfflineStampQueue {
  private items: QueuedStamp[] = [];
  private droppedItems: QueuedStamp[] = [];
  private store: OfflineQueueStore | null;

  constructor(store: OfflineQueueStore | null = null) {
    this.store = store;
    if (store !== null) {
      this.items = store.load().map((item) => ({ ...item }));
    }
  }

  /**
   * Queue a stamp. Returns false and changes nothing if a stamp
   * with the same id is already pending, so a retry never double
   * stamps. Attempts start at 0.
   */
  enqueue(stamp: NewQueuedStamp): boolean {
    if (this.items.some((item) => item.id === stamp.id)) {
      return false;
    }
    this.items.push({ ...stamp, attempts: 0 });
    this.persist();
    return true;
  }

  /** Number of stamps waiting to be sent. */
  get length(): number {
    return this.items.length;
  }

  /** Pending stamps in queue order, oldest first. A copy, so callers cannot reorder the queue. */
  pending(): QueuedStamp[] {
    return this.items.map((item) => ({ ...item }));
  }

  /** Next stamp to retry, oldest first, or null when the queue is empty. */
  next(): QueuedStamp | null {
    const first = this.items[0];
    return first === undefined ? null : { ...first };
  }

  /** Remove a stamp that was sent. Returns true if it was pending. */
  markSent(id: string): boolean {
    const index = this.items.findIndex((item) => item.id === id);
    if (index === -1) {
      return false;
    }
    this.items.splice(index, 1);
    this.persist();
    return true;
  }

  /**
   * Record a failed send for a stamp. Returns "retry" while more
   * retries are left, "dropped" once the stamp has failed
   * MAX_QUEUE_RETRIES times, and "not-found" if the id is not
   * pending. A dropped stamp is removed from the queue and kept
   * in the dropped list.
   */
  markFailed(id: string): FailedStampOutcome {
    const index = this.items.findIndex((item) => item.id === id);
    if (index === -1) {
      return "not-found";
    }
    const item = this.items[index];
    item.attempts += 1;
    if (item.attempts >= MAX_QUEUE_RETRIES) {
      this.items.splice(index, 1);
      this.droppedItems.push({ ...item });
      this.persist();
      return "dropped";
    }
    this.persist();
    return "retry";
  }

  /** Stamps dropped after 3 failed retries, in drop order. A copy. */
  dropped(): QueuedStamp[] {
    return this.droppedItems.map((item) => ({ ...item }));
  }

  /** Clear the pending queue and the dropped list. */
  clear(): void {
    this.items = [];
    this.droppedItems = [];
    this.persist();
  }

  /** Plain snapshot of the pending queue, for persistence or debugging. */
  snapshot(): QueuedStamp[] {
    return this.pending();
  }

  private persist(): void {
    if (this.store !== null) {
      this.store.save(this.pending());
    }
  }
}
