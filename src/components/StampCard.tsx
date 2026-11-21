import { StyleSheet, Text, View } from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { colors, gradientHero, spacing, type } from "../theme";
import { STAMPS_TO_REWARD } from "../data";
import type { PassState } from "../lib/pass";
import { passStateLabel } from "../lib/pass";

interface StampCardProps {
  businessName: string;
  stamps: number;
  reward: string;
  passState?: PassState;
}

const BAR_WIDTHS = [3, 1, 4, 2, 1, 3, 2, 4, 1, 2, 3, 1, 4, 2, 1, 3, 2, 4, 1, 2];

export function StampCard({
  businessName,
  stamps,
  reward,
  passState = "active",
}: StampCardProps) {
  const filled = Math.min(stamps, STAMPS_TO_REWARD);
  const dots = Array.from({ length: STAMPS_TO_REWARD }, (_, i) => i < filled);
  // The pill names the pass state. A full card says Reward ready, a
  // claimed card says Reward claimed, an expired card says Pass
  // expired. An active card keeps the plain Stamps label. The count
  // check stays as a fallback, so a full card still reads as ready
  // even when no state is passed in.
  const pillText =
    passState === "redeemed" || passState === "expired"
      ? passStateLabel(passState)
      : filled >= STAMPS_TO_REWARD
        ? "Reward ready"
        : "Stamps";
  return (
    <LinearGradient
      colors={gradientHero}
      start={{ x: 0, y: 0 }}
      end={{ x: 1, y: 1 }}
      style={styles.hero}
    >
      <Text style={styles.business}>{businessName}</Text>
      <View style={styles.countRow}>
        <Text style={styles.count}>
          {filled}
          <Text style={styles.countTotal}> / {STAMPS_TO_REWARD}</Text>
        </Text>
        <View style={styles.rewardPill}>
          <Text style={styles.rewardPillText}>{pillText}</Text>
        </View>
      </View>
      <Text style={styles.reward}>{reward}</Text>
      <View style={styles.dots}>
        {dots.map((on, i) => (
          <View
            key={`dot-${i}`}
            style={[styles.dot, on ? styles.dotOn : styles.dotOff]}
          />
        ))}
      </View>
      <View style={styles.barcodeRow}>
        {BAR_WIDTHS.map((w, i) => (
          <View key={`bar-${i}`} style={[styles.bar, { width: w }]} />
        ))}
      </View>
      <Text style={styles.barcodeLabel}>Show this card at the counter</Text>
    </LinearGradient>
  );
}

const styles = StyleSheet.create({
  bar: {
    backgroundColor: colors.darkText,
    borderRadius: 1,
    height: 34,
    marginRight: 3,
  },
  barcodeLabel: {
    color: colors.darkText,
    marginTop: 8,
    opacity: 0.7,
    ...type.caption,
  },
  barcodeRow: {
    alignItems: "flex-end",
    flexDirection: "row",
    marginTop: 20,
  },
  business: {
    color: colors.darkText,
    ...type.label,
  },
  count: {
    color: colors.darkText,
    ...type.hero,
  },
  countRow: {
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "space-between",
    marginTop: 8,
  },
  countTotal: {
    fontSize: 28,
    fontWeight: "600",
    letterSpacing: -0.5,
  },
  dot: {
    borderRadius: 999,
    height: 22,
    width: 22,
  },
  dotOff: {
    borderColor: colors.darkText,
    borderWidth: 1.5,
    opacity: 0.45,
  },
  dotOn: {
    backgroundColor: colors.darkText,
  },
  dots: {
    flexDirection: "row",
    gap: 8,
    marginTop: 18,
  },
  hero: {
    borderRadius: spacing.radiusCard,
    padding: 22,
    shadowColor: "#000000",
    shadowOffset: { height: 12, width: 0 },
    shadowOpacity: 0.25,
    shadowRadius: 24,
  },
  reward: {
    color: colors.darkText,
    marginTop: 4,
    opacity: 0.8,
    ...type.bodyStrong,
  },
  rewardPill: {
    backgroundColor: colors.darkText,
    borderRadius: spacing.radiusPill,
    paddingHorizontal: 14,
    paddingVertical: 8,
  },
  rewardPillText: {
    color: colors.white,
    fontSize: 12,
    fontWeight: "700",
    lineHeight: 16,
  },
});
