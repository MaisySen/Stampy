/**
 * Small key-value storage layer for the local/demo journey.
 * Pure logic. No React Native imports at the top of this file, so tests
 * run in plain Node with MemoryBackend. The real AsyncStorage backend is
 * loaded lazily by loadAsyncStorageBackend.
 *
 * Reads and writes never throw. A read says whether the key is missing,
 * unreadable (storage failed) or corrupt (saved text is not valid JSON),
 * so callers can show the problem instead of silently starting over.
 */

export interface KeyValueBackend {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
}

/** In-memory backend with failure switches, for tests and synthetic demos. */
export class MemoryBackend implements KeyValueBackend {
  data = new Map<string, string>();
  failReads = false;
  failWrites = false;

  async getItem(key: string): Promise<string | null> {
    if (this.failReads) {
      throw new Error("Storage read failed.");
    }
    return this.data.get(key) ?? null;
  }

  async setItem(key: string, value: string): Promise<void> {
    if (this.failWrites) {
      throw new Error("Storage write failed.");
    }
    this.data.set(key, value);
  }
}

export type ReadResult =
  | { status: "ok"; value: unknown }
  | { status: "missing" }
  | { status: "error"; message: string }
  | { status: "corrupt"; message: string };

export type WriteResult = { ok: true } | { ok: false; message: string };

function messageOf(error: unknown, fallback: string): string {
  return error instanceof Error && error.message.length > 0
    ? error.message
    : fallback;
}

export async function readJson(
  backend: KeyValueBackend,
  key: string,
): Promise<ReadResult> {
  let raw: string | null;
  try {
    raw = await backend.getItem(key);
  } catch (error) {
    return { status: "error", message: messageOf(error, "Storage read failed.") };
  }
  if (raw === null) {
    return { status: "missing" };
  }
  try {
    return { status: "ok", value: JSON.parse(raw) as unknown };
  } catch {
    return { status: "corrupt", message: "Saved data could not be read." };
  }
}

export async function writeJson(
  backend: KeyValueBackend,
  key: string,
  value: unknown,
): Promise<WriteResult> {
  try {
    await backend.setItem(key, JSON.stringify(value));
    return { ok: true };
  } catch (error) {
    return { ok: false, message: messageOf(error, "Storage write failed.") };
  }
}

/**
 * The real app backend. Loads AsyncStorage lazily so this module stays
 * usable in Node tests, where the native module cannot load.
 */
export async function loadAsyncStorageBackend(): Promise<KeyValueBackend> {
  const loaded = await import("@react-native-async-storage/async-storage");
  return (loaded as unknown as { default: KeyValueBackend }).default;
}
