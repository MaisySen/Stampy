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
