import { StyleSheet, Text, View } from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { colors, gradientHero, spacing, type } from "../theme";

interface ProgramStampCardProps {
  businessName: string;
  /** Paid visits counted so far. */
  paidVisitsDone: number;
  /** Paid visits needed before the free reward visit. */
  paidVisits: number;
  reward: string;
}

/**
 * Stamp card for the saved program. Shows the saved paid-visit count and
 * a separate slot for the free reward visit. Local demo card, not a pass.
 */
export function ProgramStampCard({
  businessName,
  paidVisitsDone,
  paidVisits,
  reward,
}: ProgramStampCardProps) {
  const filled = Math.min(paidVisitsDone, paidVisits);
  const eligible = paidVisitsDone >= paidVisits;
  const dots = Array.from({ length: paidVisits }, (_, i) => i < filled);
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
          <Text style={styles.countTotal}> / {paidVisits} paid visits</Text>
        </Text>
        <View style={styles.rewardPill}>
          <Text style={styles.rewardPillText}>
            {eligible ? "Free visit ready" : "Paid visits"}
          </Text>
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
        <View
          style={[styles.rewardSlot, eligible ? styles.dotOn : styles.dotOff]}
        />
      </View>
      <Text style={styles.barcodeLabel}>
        Dots are paid visits. The square is the free reward visit, visit{" "}
        {paidVisits + 1}.
      </Text>
      <Text style={[styles.barcodeLabel, styles.demoLine]}>
        Local demo card, not a Wallet pass.
      </Text>
    </LinearGradient>
  );
}

const styles = StyleSheet.create({
  demoLine: {
    marginTop: 2,
  },
  rewardSlot: {
    borderColor: colors.darkText,
    borderRadius: 6,
    borderWidth: 1.5,
    height: 22,
    width: 22,
  },
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
    flexWrap: "wrap",
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
