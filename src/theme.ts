import { StyleSheet } from "react-native";

/**
 * Orbix theme for Stampies.
 * Dark near-black background. Soft lavender, pink, peach gradient.
 * Huge numerals. Rounded 24 to 28px cards. Generous spacing.
 */

export const colors = {
  background: "#0A0A0F",
  surface: "#16161D",
  surface2: "#1E1E28",
  border: "#26262F",
  text: "#F5F5F7",
  muted: "#9C9CA8",
  faint: "#6E6E78",
  lavender: "#C9B8FF",
  lavenderDeep: "#A78BFA",
  pink: "#FFB3D9",
  peach: "#FFD9A8",
  green: "#3DDC97",
  red: "#FF7A7A",
  darkText: "#17171E",
  white: "#FFFFFF",
  pill: "#FFFFFF",
} as const;

export const gradientHero: readonly [string, string, string] = [
  colors.lavender,
  colors.pink,
  colors.peach,
];

export const gradientChart: readonly [string, string, string] = [
  colors.lavenderDeep,
  colors.pink,
  colors.peach,
];

export const type = {
  hero: { fontSize: 56, fontWeight: "700" as const, letterSpacing: -1.5 },
  heroSmall: { fontSize: 44, fontWeight: "700" as const, letterSpacing: -1 },
  title: { fontSize: 28, fontWeight: "700" as const, letterSpacing: -0.5 },
  section: { fontSize: 17, fontWeight: "700" as const, letterSpacing: -0.2 },
  body: { fontSize: 15, fontWeight: "400" as const, lineHeight: 22 },
  bodyStrong: { fontSize: 15, fontWeight: "600" as const, lineHeight: 22 },
  caption: { fontSize: 12, fontWeight: "500" as const, lineHeight: 16 },
  label: {
    fontSize: 11,
    fontWeight: "700" as const,
    letterSpacing: 1.2,
    textTransform: "uppercase" as const,
  },
} as const;

export const spacing = {
  screen: 20,
  card: 16,
  gap: 12,
  radiusCard: 26,
  radiusInner: 18,
  radiusPill: 999,
  touchMin: 48,
} as const;

export const shared = StyleSheet.create({
  screen: {
    backgroundColor: colors.background,
    flex: 1,
  },
  scroll: {
    paddingHorizontal: spacing.screen,
    paddingTop: 8,
    paddingBottom: 132,
  },
  card: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: spacing.radiusCard,
    borderWidth: 1,
    padding: spacing.card,
  },
  cardTitle: {
    color: colors.text,
    ...type.section,
  },
  cardMuted: {
    color: colors.muted,
    ...type.body,
  },
  pressed: {
    opacity: 0.85,
  },
  row: {
    alignItems: "center",
    flexDirection: "row",
  },
  rowBetween: {
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "space-between",
  },
});
