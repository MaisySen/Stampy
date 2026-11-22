/**
 * The business program for the local/demo journey: name, reward and the
 * number of paid visits. After the paid visits the next visit is the free
 * reward visit, so a card is paidVisits + 1 visits long.
 *
 * Default is 8 paid visits, then the 9th visit is the reward. The allowed
 * range is 3 to 11 paid visits, which is the existing 4 to 12 card length
 * in src/lib/stamps.ts.
 *
 * Pure logic. Settings are saved on this device only, as a versioned
 * envelope. Nothing here talks to a server.
 */
import { STAMP_TARGET_MAX, STAMP_TARGET_MIN, suggestedReward } from "./stamps";
import { readJson, writeJson } from "./storage";
import type { KeyValueBackend } from "./storage";

export const PROGRAM_STORAGE_KEY = "stampies:demo-program:v1";
export const DEFAULT_PAID_VISITS = 8;
export const MIN_PAID_VISITS = STAMP_TARGET_MIN - 1;
export const MAX_PAID_VISITS = STAMP_TARGET_MAX - 1;
export const MAX_NAME_LENGTH = 60;
export const MAX_REWARD_LENGTH = 120;

export interface ProgramSettings {
  name: string;
  reward: string;
  paidVisits: number;
}

/** Visits on one card: the paid visits plus the free reward visit. */
export function cardLength(paidVisits: number): number {
  return paidVisits + 1;
}

export function defaultReward(paidVisits: number): string {
  return suggestedReward(cardLength(paidVisits));
}

export const DEFAULT_PROGRAM: ProgramSettings = {
  name: "Corner Cafe",
  reward: defaultReward(DEFAULT_PAID_VISITS),
  paidVisits: DEFAULT_PAID_VISITS,
};

export function paidVisitsRangeText(): string {
  return `${MIN_PAID_VISITS} to ${MAX_PAID_VISITS} paid visits`;
}

export type ProgramValidation =
  | { ok: true; settings: ProgramSettings }
  | { ok: false; errors: string[] };

export function validateProgram(input: {
  name: unknown;
  reward: unknown;
  paidVisits: unknown;
}): ProgramValidation {
  const errors: string[] = [];
  const name = typeof input.name === "string" ? input.name.trim() : "";
  const reward = typeof input.reward === "string" ? input.reward.trim() : "";
  if (name.length === 0) {
    errors.push("Business name is required.");
  } else if (name.length > MAX_NAME_LENGTH) {
    errors.push(`Business name must be ${MAX_NAME_LENGTH} characters or fewer.`);
  }
  if (reward.length === 0) {
    errors.push("Reward text is required.");
  } else if (reward.length > MAX_REWARD_LENGTH) {
    errors.push(`Reward text must be ${MAX_REWARD_LENGTH} characters or fewer.`);
  }
  const paid = input.paidVisits;
  if (
    typeof paid !== "number" ||
    !Number.isInteger(paid) ||
    paid < MIN_PAID_VISITS ||
    paid > MAX_PAID_VISITS
  ) {
    errors.push(
      `Paid visits must be a whole number, ${paidVisitsRangeText()}.`,
    );
  }
  if (errors.length > 0) {
    return { ok: false, errors };
  }
  return {
    ok: true,
    settings: { name, reward, paidVisits: paid as number },
  };
}

export type ProgramLoad =
  | { status: "ok"; settings: ProgramSettings }
  | { status: "missing"; settings: ProgramSettings }
  | { status: "invalid"; settings: ProgramSettings; message: string }
  | { status: "error"; settings: ProgramSettings; message: string };

/**
 * Load the saved program. Anything but "ok" returns the default settings
 * plus a status the screen shows. Saved settings that fail validation are
 * reported as invalid, never silently replaced or repaired.
 */
export async function loadProgram(backend: KeyValueBackend): Promise<ProgramLoad> {
  const read = await readJson(backend, PROGRAM_STORAGE_KEY);
  if (read.status === "missing") {
    return { status: "missing", settings: DEFAULT_PROGRAM };
  }
  if (read.status === "error") {
    return { status: "error", settings: DEFAULT_PROGRAM, message: read.message };
  }
  if (read.status === "corrupt") {
    return { status: "invalid", settings: DEFAULT_PROGRAM, message: read.message };
  }
  const envelope = read.value as { v?: unknown; settings?: unknown } | null;
  if (
    typeof envelope !== "object" ||
    envelope === null ||
    envelope.v !== 1 ||
    typeof envelope.settings !== "object" ||
    envelope.settings === null
  ) {
    return {
      status: "invalid",
      settings: DEFAULT_PROGRAM,
      message: "Saved program has an unknown format.",
    };
  }
  const checked = validateProgram(
    envelope.settings as { name: unknown; reward: unknown; paidVisits: unknown },
  );
  if (!checked.ok) {
    return {
      status: "invalid",
      settings: DEFAULT_PROGRAM,
      message: `Saved program is not valid: ${checked.errors.join(" ")}`,
    };
  }
  return { status: "ok", settings: checked.settings };
}

export type ProgramSave =
  | { ok: true; settings: ProgramSettings }
  | { ok: false; errors: string[]; storage: boolean };

/** Validate, then save. A storage failure comes back as ok false with storage true. */
export async function saveProgram(
  backend: KeyValueBackend,
  input: { name: unknown; reward: unknown; paidVisits: unknown },
): Promise<ProgramSave> {
  const checked = validateProgram(input);
  if (!checked.ok) {
    return { ok: false, errors: checked.errors, storage: false };
  }
  const written = await writeJson(backend, PROGRAM_STORAGE_KEY, {
    v: 1,
    settings: checked.settings,
  });
  if (!written.ok) {
    return {
      ok: false,
      errors: [`Could not save on this device: ${written.message}`],
      storage: true,
    };
  }
  return { ok: true, settings: checked.settings };
}
