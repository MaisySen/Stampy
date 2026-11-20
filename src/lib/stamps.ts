/**
 * Stamp progress, pass builder validation, and share links.
 * Pure logic. No React Native imports, so tests run with plain Node.
 */

export const STAMP_TARGET_DEFAULT = 9;
export const STAMP_TARGET_MIN = 4;
export const STAMP_TARGET_MAX = 12;

/**
 * Default reward suggestion for a stamp target.
 * Targets only run 4 to 12, so every ordinal in that range is "th".
 * Each business sets its own buy count and reward. This is only the suggestion.
 */
export function suggestedReward(target: number): string {
  return `Buy ${target - 1}, get the ${target}th free`;
}

export interface StampProgress {
  stamps: number;
  target: number;
  stampsLeft: number;
  rewardReady: boolean;
  percent: number;
}

export function stampProgress(stamps: number, target: number): StampProgress {
  const safeTarget = Math.max(1, Math.floor(target));
  const safeStamps = Math.max(0, Math.floor(stamps));
  const stampsLeft = Math.max(0, safeTarget - safeStamps);
  return {
    stamps: safeStamps,
    target: safeTarget,
    stampsLeft,
    rewardReady: safeStamps >= safeTarget,
    percent:
      safeTarget === 0
        ? 0
        : Math.min(100, Math.round((safeStamps / safeTarget) * 100)),
  };
}

export interface PassBuilderDraft {
  name: string;
  reward: string;
  target: number;
  menuLink?: string;
  feedbackLink?: string;
  externalLink?: string;
  externalLabel?: string;
}

export function validatePassBuilder(draft: PassBuilderDraft): string[] {
  const errors: string[] = [];
  if (draft.name.trim().length === 0) {
    errors.push("Business name is required.");
  }
  if (draft.name.trim().length > 60) {
    errors.push("Business name must be 60 characters or fewer.");
  }
  if (draft.reward.trim().length === 0) {
    errors.push("Reward text is required.");
  }
  if (
    !Number.isInteger(draft.target) ||
    draft.target < STAMP_TARGET_MIN ||
    draft.target > STAMP_TARGET_MAX
  ) {
    errors.push(
      `Stamp target must be a whole number from ${STAMP_TARGET_MIN} to ${STAMP_TARGET_MAX}.`,
    );
  }
  const links: Array<[string, string | undefined]> = [
    ["Menu link", draft.menuLink],
    ["Feedback link", draft.feedbackLink],
    ["External link", draft.externalLink],
  ];
  for (const [label, value] of links) {
    if (value !== undefined && value.trim().length > 0) {
      let ok = false;
      try {
        const url = new URL(value.trim());
        ok = url.protocol === "https:" || url.protocol === "http:";
      } catch {
        ok = false;
      }
      if (!ok) {
        errors.push(`${label} must be a full web address starting with https://.`);
      }
    }
  }
  if (
    draft.externalLink !== undefined &&
    draft.externalLink.trim().length > 0 &&
    (draft.externalLabel === undefined || draft.externalLabel.trim().length === 0)
  ) {
    errors.push("An external link needs a label.");
  }
  return errors;
}

export function buildShareSlug(name: string): string {
  const slug = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug.length === 0 ? "stampies" : slug;
}

export function buildShareLink(name: string): string {
  return `https://stampies.app/p/${buildShareSlug(name)}`;
}
