/**
 * Persistent store for the offline stamp queue.
 * Pure logic around one async key-value backend, normally AsyncStorage.
 * No React Native imports at the top of this file, so the app tests can run
 * it in Node with a fake backend. The real AsyncStorage backend is loaded
 * lazily by createAsyncStorageQueueStore, only when the app asks for it.
 *
 * The queue calls load and save synchronously, but AsyncStorage is async.
 * This store keeps an in-memory mirror as the source of truth: load returns
 * the mirror, save updates the mirror at once and schedules an async write
 * behind it. A failed write never drops a stamp: the mirror still holds the
 * queue, lastError names the failure, and the next save or flush retries
 * with the latest mirror. Writes are serialized, so a slow write can never
 * overwrite a newer one.
 *
 * App startup order: create the store, await hydrate, then create the
 * OfflineStampQueue with the store. Hydrate loads the saved queue into the
 * mirror. Call flush when the app backgrounds, best effort, to push the
 * latest write out before the process is suspended.
 */
import type { OfflineQueueStore, QueuedStamp } from "./offlineQueue";
import type { AsyncStorageStatic } from "@react-native-async-storage/async-storage";

export const OFFLINE_QUEUE_STORAGE_KEY = "stampies:offline-stamps:v1";

/** Minimal AsyncStorage shape. The real AsyncStorage object satisfies this. */
export interface OfflineQueueBackend {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem?(key: string): Promise<void>;
}

export interface PersistentOfflineQueueStore extends OfflineQueueStore {
  /** Load the saved queue into the mirror. Never throws; check lastError. */
  hydrate(): Promise<void>;
  /** Wait until the latest scheduled write has landed, retrying once. Never throws; check lastError. */
  flush(): Promise<void>;
  /** The latest storage failure, or null when the last write landed. */
  readonly lastError: Error | null;
  /** True once hydrate has run, even when the saved queue was empty. */
  readonly hydrated: boolean;
}

function toError(error: unknown): Error {
  return error instanceof Error ? error : new Error("Offline queue storage failed.");
}

function isQueuedStamp(item: unknown): item is QueuedStamp {
  if (typeof item !== "object" || item === null) {
    return false;
  }
  const stamp = item as Partial<QueuedStamp>;
  return (
    typeof stamp.id === "string" &&
    stamp.id.length > 0 &&
    typeof stamp.passId === "string" &&
    stamp.passId.length > 0 &&
    typeof stamp.businessId === "string" &&
    stamp.businessId.length > 0 &&
    typeof stamp.createdAtMs === "number" &&
    Number.isFinite(stamp.createdAtMs) &&
    typeof stamp.attempts === "number" &&
    Number.isInteger(stamp.attempts) &&
    stamp.attempts >= 0
  );
}

export class MirroredOfflineQueueStore implements PersistentOfflineQueueStore {
  private mirror: QueuedStamp[] = [];
  private writing = false;
  private dirty = false;
  private pendingWrite: Promise<void> = Promise.resolve();
  private error: Error | null = null;
  private loaded = false;

  constructor(
    private readonly backend: OfflineQueueBackend,
    private readonly key: string = OFFLINE_QUEUE_STORAGE_KEY,
  ) {}

  get lastError(): Error | null {
    return this.error;
  }

  get hydrated(): boolean {
    return this.loaded;
  }

  /** Pending stamps in queue order, from the mirror. A copy. */
  load(): QueuedStamp[] {
    return this.mirror.map((item) => ({ ...item }));
  }

  /**
   * Replace the mirror at once and schedule the async write. Never throws:
   * a storage failure is recorded in lastError and retried later, and the
   * mirror keeps every stamp.
   */
  save(items: QueuedStamp[]): void {
    this.mirror = items.map((item) => ({ ...item }));
    this.scheduleWrite();
  }

  async hydrate(): Promise<void> {
    let raw: string | null;
    try {
      raw = await this.backend.getItem(this.key);
    } catch (error) {
      this.error = toError(error);
      return;
    }
    if (raw === null) {
      this.mirror = [];
      this.loaded = true;
      this.error = null;
      return;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch (error) {
      this.error = toError(error);
      this.mirror = [];
      this.loaded = true;
      return;
    }
    if (!Array.isArray(parsed)) {
      this.error = new Error("Saved offline queue is not a list.");
      this.mirror = [];
      this.loaded = true;
      return;
    }
    this.mirror = parsed.filter(isQueuedStamp).map((item) => ({ ...item }));
    this.loaded = true;
    this.error = null;
  }

  async flush(): Promise<void> {
    for (let attempt = 0; attempt < 3; attempt++) {
      await this.pendingWrite;
      if (this.writing) {
        continue;
      }
      if (this.dirty) {
        this.scheduleWrite();
        continue;
      }
      break;
    }
  }

  private scheduleWrite(): void {
    if (this.writing) {
      this.dirty = true;
      return;
    }
    this.writing = true;
    this.dirty = false;
    const payload = JSON.stringify(this.mirror);
    this.pendingWrite = this.backend.setItem(this.key, payload).then(
      () => {
        this.writing = false;
        this.error = null;
        if (this.dirty) {
          this.scheduleWrite();
        }
      },
      (error) => {
        this.writing = false;
        this.error = toError(error);
        this.dirty = true;
      },
    );
  }
}

export function createPersistentOfflineQueueStore(
  backend: OfflineQueueBackend,
  key: string = OFFLINE_QUEUE_STORAGE_KEY,
): PersistentOfflineQueueStore {
  return new MirroredOfflineQueueStore(backend, key);
}

/**
 * The real app backend. Loads AsyncStorage lazily so this module stays
 * usable in Node tests, where the native module cannot load. Call it once
 * at app startup, then await hydrate before creating the queue.
 */
export async function createAsyncStorageQueueStore(
  key: string = OFFLINE_QUEUE_STORAGE_KEY,
): Promise<PersistentOfflineQueueStore> {
  const loaded = await import("@react-native-async-storage/async-storage");
  // The package types resolve differently under bundler and nodenext, so
  // read the default export through an explicit cast. At runtime it is the
  // AsyncStorage object; the Node test run never calls this function.
  const storage = (loaded as unknown as { default: AsyncStorageStatic }).default;
  return createPersistentOfflineQueueStore(storage, key);
}
