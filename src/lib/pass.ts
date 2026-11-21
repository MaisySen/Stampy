/**
 * Wallet pass payloads for Stampies, local only.
 * Pure logic. No React Native imports, so tests run with plain Node.
 *
 * This builds the pass data only. It does not sign anything.
 * Apple PassKit signing and Google Wallet signing need a server
 * with the real certificates and keys. Those keys never live here.
 * No server credentials, no secrets, no hard coded business names.
 */

export type PassRewardState = "active" | "full" | "redeemed" | "expired";

export interface PassProgram {
  businessName: string;
  reward: string;
  target: number;
  brandColor: string;
  cover: string;
  barcodeValue: string;
  latitude?: number;
  longitude?: number;
  expiryIso?: string;
}

export interface PassBuildOptions {
  redeemed?: boolean;
  todayIso?: string;
  expiryIso?: string;
}

export const PASS_ORGANIZATION = "Fintex Australia Pty Ltd";
export const PASS_TYPE_IDENTIFIER = "pass.au.fintex.stampies";
export const PASS_TARGET_MIN = 4;
export const PASS_TARGET_MAX = 12;

export function businessSlug(businessName: string): string {
  return businessName
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export function passShareLink(businessName: string): string {
  const slug = businessSlug(businessName);
  return `https://stampies.app/p/${slug.length > 0 ? slug : "stampies"}`;
}

function isValidDateIso(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return false;
  }
  const date = new Date(`${value}T00:00:00`);
  return !Number.isNaN(date.getTime());
}

function todayIsoString(): string {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function validatePassProgram(program: PassProgram): string[] {
  const errors: string[] = [];
  if (program.businessName.trim().length === 0) {
    errors.push("Business name is required.");
  }
  if (program.businessName.trim().length > 60) {
    errors.push("Business name must be 60 characters or fewer.");
  }
  if (program.reward.trim().length === 0) {
    errors.push("Reward text is required.");
  }
  if (
    !Number.isInteger(program.target) ||
    program.target < PASS_TARGET_MIN ||
    program.target > PASS_TARGET_MAX
  ) {
    errors.push(
      `Stamp target must be a whole number from ${PASS_TARGET_MIN} to ${PASS_TARGET_MAX}.`,
    );
  }
  if (!/^#[0-9A-Fa-f]{6}$/.test(program.brandColor.trim())) {
    errors.push("Brand colour must be a hex colour like #C9B8FF.");
  }
  if (program.cover.trim().length === 0) {
    errors.push("Cover style is required.");
  }
  if (program.barcodeValue.trim().length === 0) {
    errors.push("Barcode value is required.");
  }
  if (program.latitude !== undefined && (program.latitude < -90 || program.latitude > 90)) {
    errors.push("Latitude must be between -90 and 90.");
  }
  if (
    program.longitude !== undefined &&
    (program.longitude < -180 || program.longitude > 180)
  ) {
    errors.push("Longitude must be between -180 and 180.");
  }
  if (
    program.latitude !== undefined &&
    program.longitude === undefined
  ) {
    errors.push("A location needs both latitude and longitude.");
  }
  if (
    program.longitude !== undefined &&
    program.latitude === undefined
  ) {
    errors.push("A location needs both latitude and longitude.");
  }
  if (program.expiryIso !== undefined && !isValidDateIso(program.expiryIso)) {
    errors.push("Expiry date must be a date like 2027-06-30.");
  }
  return errors;
}

export function isPassExpired(expiryIso: string | undefined, todayIso?: string): boolean {
  if (expiryIso === undefined || !isValidDateIso(expiryIso)) {
    return false;
  }
  const today = todayIso ?? todayIsoString();
  return today > expiryIso;
}

export function passRewardState(
  stamps: number,
  target: number,
  options: PassBuildOptions = {},
): PassRewardState {
  const safeStamps = Math.max(0, Math.floor(stamps));
  const safeTarget = Math.max(1, Math.floor(target));
  if (options.redeemed === true) {
    return "redeemed";
  }
  if (isPassExpired(options.expiryIso, options.todayIso)) {
    return "expired";
  }
  if (safeStamps >= safeTarget) {
    return "full";
  }
  return "active";
}

export function passStateLabel(state: PassRewardState): string {
  if (state === "full") {
    return "Reward ready";
  }
  if (state === "redeemed") {
    return "Reward claimed";
  }
  if (state === "expired") {
    return "Pass expired";
  }
  return "Collecting stamps";
}

export interface ApplePassPayload {
  formatVersion: number;
  passTypeIdentifier: string;
  serialNumber: string;
  teamIdentifier: string;
  organizationName: string;
  description: string;
  logoText: string;
  foregroundColor: string;
  backgroundColor: string;
  labelColor: string;
  storeCard: {
    primaryFields: Array<{ key: string; label: string; value: string }>;
    secondaryFields: Array<{ key: string; label: string; value: string }>;
    auxiliaryFields: Array<{ key: string; label: string; value: string }>;
    backFields: Array<{ key: string; label: string; value: string }>;
  };
  barcode: {
    format: string;
    message: string;
    messageEncoding: string;
  };
  locations?: Array<{ latitude: number; longitude: number; relevantText: string }>;
  expirationDate?: string;
  voided: boolean;
}

export function buildApplePass(
  program: PassProgram,
  stamps: number,
  options: PassBuildOptions = {},
): ApplePassPayload {
  const safeStamps = Math.min(Math.max(0, Math.floor(stamps)), program.target);
  const safeTarget = Math.max(1, Math.floor(program.target));
  const stampsLeft = Math.max(0, safeTarget - safeStamps);
  const state = passRewardState(stamps, program.target, {
    redeemed: options.redeemed,
    expiryIso: program.expiryIso,
    todayIso: options.todayIso,
  });
  const payload: ApplePassPayload = {
    formatVersion: 1,
    passTypeIdentifier: PASS_TYPE_IDENTIFIER,
    serialNumber: program.barcodeValue.trim(),
    teamIdentifier: "PLACEHOLDER",
    organizationName: PASS_ORGANIZATION,
    description: `${program.businessName.trim()} stamp card`,
    logoText: program.businessName.trim(),
    foregroundColor: "rgb(255, 255, 255)",
    backgroundColor: program.brandColor.trim(),
    labelColor: "rgb(255, 255, 255)",
    storeCard: {
      primaryFields: [
        {
          key: "stamps",
          label: "STAMPS",
          value: `${safeStamps} of ${safeTarget}`,
        },
      ],
      secondaryFields: [
        { key: "reward", label: "REWARD", value: program.reward.trim() },
      ],
      auxiliaryFields: [
        {
          key: "stampsLeft",
          label: "TO GO",
          value: state === "full" ? "Reward ready" : `${stampsLeft} stamps to go`,
        },
      ],
      backFields: [
        { key: "state", label: "STATUS", value: passStateLabel(state) },
        { key: "cover", label: "COVER", value: program.cover.trim() },
        {
          key: "privacy",
          label: "PRIVACY",
          value: "This pass only knows where the business is. Your phone works out when you are nearby, on the device.",
        },
        {
          key: "publisher",
          label: "PUBLISHER",
          value: PASS_ORGANIZATION,
        },
      ],
    },
    barcode: {
      format: "PKBarcodeFormatQR",
      message: program.barcodeValue.trim(),
      messageEncoding: "iso-8859-1",
    },
    voided: state === "expired",
  };
  if (program.latitude !== undefined && program.longitude !== undefined) {
    payload.locations = [
      {
        latitude: program.latitude,
        longitude: program.longitude,
        relevantText: `You are near ${program.businessName.trim()}.`,
      },
    ];
  }
  if (program.expiryIso !== undefined) {
    payload.expirationDate = program.expiryIso;
  }
  return payload;
}

export interface GooglePassPayload {
  id: string;
  classId: string;
  state: string;
  barcode: { type: string; value: string };
  loyaltyPoints: { label: string; balance: { string: string } };
  textModulesData: Array<{ header: string; body: string; id: string }>;
  linksModuleData: { uris: Array<{ uri: string; description: string; id: string }> };
  locations?: Array<{ latitude: number; longitude: number }>;
  validTimeInterval?: { end: { date: string } };
}

export function buildGooglePass(
  program: PassProgram,
  stamps: number,
  options: PassBuildOptions = {},
): GooglePassPayload {
  const safeStamps = Math.min(Math.max(0, Math.floor(stamps)), program.target);
  const safeTarget = Math.max(1, Math.floor(program.target));
  const stampsLeft = Math.max(0, safeTarget - safeStamps);
  const state = passRewardState(stamps, program.target, {
    redeemed: options.redeemed,
    expiryIso: program.expiryIso,
    todayIso: options.todayIso,
  });
  const googleState =
    state === "expired" ? "EXPIRED" : state === "redeemed" ? "INACTIVE" : "ACTIVE";
  const slug = businessSlug(program.businessName);
  const payload: GooglePassPayload = {
    id: `stampies-${slug}-${program.barcodeValue.trim()}`,
    classId: "stampies-loyalty-class",
    state: googleState,
    barcode: { type: "QR_CODE", value: program.barcodeValue.trim() },
    loyaltyPoints: {
      label: "Stamps",
      balance: { string: `${safeStamps} of ${safeTarget}` },
    },
    textModulesData: [
      { header: "Reward", body: program.reward.trim(), id: "reward" },
      {
        header: "To go",
        body:
          state === "full"
            ? "Reward ready. Show this pass at the counter."
            : `${stampsLeft} stamps to go.`,
        id: "to-go",
      },
      { header: "Status", body: passStateLabel(state), id: "status" },
    ],
    linksModuleData: {
      uris: [
        {
          uri: passShareLink(program.businessName),
          description: "Open your Stampies pass page",
          id: "pass-page",
        },
      ],
    },
  };
  if (program.latitude !== undefined && program.longitude !== undefined) {
    payload.locations = [
      { latitude: program.latitude, longitude: program.longitude },
    ];
  }
  if (program.expiryIso !== undefined) {
    payload.validTimeInterval = { end: { date: program.expiryIso } };
  }
  return payload;
}

export interface PassPayloads {
  apple: ApplePassPayload;
  google: GooglePassPayload;
  state: PassRewardState;
  stamps: number;
  stampsLeft: number;
}

/**
 * Build both payloads for one pass, and work out the reward state.
 * Call this again after each stamp, with the new stamp count.
 * The server sends the new payload to the phone on each stamp.
 */
export function buildPassPayloads(
  program: PassProgram,
  stamps: number,
  options: PassBuildOptions = {},
): PassPayloads {
  const safeTarget = Math.max(1, Math.floor(program.target));
  const safeStamps = Math.min(Math.max(0, Math.floor(stamps)), safeTarget);
  const state = passRewardState(stamps, program.target, {
    redeemed: options.redeemed,
    expiryIso: program.expiryIso,
    todayIso: options.todayIso,
  });
  return {
    apple: buildApplePass(program, stamps, options),
    google: buildGooglePass(program, stamps, options),
    state,
    stamps: safeStamps,
    stampsLeft: Math.max(0, safeTarget - safeStamps),
  };
}

/**
 * Pass update after a stamp. Same as building again, with the new
 * count. Kept as its own function so the update path is explicit
 * and easy to test on its own.
 */
export function updatePassOnStamp(
  program: PassProgram,
  newStamps: number,
  options: PassBuildOptions = {},
): PassPayloads {
  return buildPassPayloads(program, newStamps, options);
}
