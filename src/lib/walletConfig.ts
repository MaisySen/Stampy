/**
 * Wallet backend origin for the app.
 * Reads app.json extra. The deployer sets walletOrigin to the
 * Wallet backend origin (https) when the backend is live. An empty
 * string is the placeholder default and means server sync is not
 * configured yet: App.tsx then keeps the unconfigured stub sender
 * and the app stamps normally. Never put a real backend URL or a
 * credential here; the origin is set at deploy time.
 */
import appConfig from "../../app.json";

export function walletOrigin(): string | null {
  const value = (appConfig as { expo?: { extra?: { walletOrigin?: unknown } } })
    .expo?.extra?.walletOrigin;
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed;
}
