import { StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import { colors, gradientHero, shared, spacing, type } from "../theme";
import type { InstallPlatform } from "../lib/passInstall";
import { passRewardState, passStateLabel } from "../lib/pass";

interface PassInstallScreenProps {
  businessName: string;
  reward: string;
  stamps: number;
  target: number;
  platform: InstallPlatform;
  onClose: () => void;
}

export function PassInstallScreen({
  businessName,
  reward,
  stamps,
  target,
  platform,
  onClose,
}: PassInstallScreenProps) {
  const hasPass = businessName.trim().length > 0;
  const safeTarget = Math.max(1, Math.floor(target));
  const safeStamps = Math.min(Math.max(0, Math.floor(stamps)), safeTarget);
  const state = passRewardState(stamps, target);
  const dots = Array.from({ length: safeTarget }, (_, i) => i < safeStamps);
  const walletName = platform === "apple" ? "Apple Wallet" : "Google Wallet";

  if (!hasPass) {
    return (
      <View>
        <View style={[shared.card, styles.emptyCard]}>
          <Text style={shared.cardTitle}>No pass to install</Text>
          <Text style={[shared.cardMuted, styles.emptySub]}>
            There is no business pass to preview yet. Build one first, then come back here.
          </Text>
          <TouchableOpacity
            accessibilityRole="button"
            activeOpacity={0.85}
            onPress={onClose}
            style={styles.secondaryButton}
          >
            <Text style={styles.secondaryButtonText}>Go back</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  return (
    <View>
      <LinearGradient
        colors={gradientHero}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={styles.hero}
      >
        <View style={styles.heroIcon}>
          <Ionicons name="wallet-outline" size={24} color={colors.darkText} />
        </View>
        <Text style={styles.heroBusiness}>{businessName.trim()}</Text>
        <Text style={styles.heroCount}>
          {safeStamps}
          <Text style={styles.heroCountTotal}>/{safeTarget}</Text>
        </Text>
        <Text style={styles.heroLabel}>stamps</Text>
        <View style={styles.dots}>
          {dots.map((on, i) => (
            <View
              key={`install-dot-${i}`}
              style={[styles.dot, on && styles.dotOn]}
            />
          ))}
        </View>
        <Text style={styles.heroReward}>{reward.trim()}</Text>
        <Text style={styles.heroState}>{passStateLabel(state)}</Text>
      </LinearGradient>

      <View style={[shared.card, styles.statusCard]}>
        <Text style={shared.cardTitle}>{walletName} preview</Text>
        <Text style={[shared.cardMuted, styles.statusSub]}>
          This is a preview only. Adding it to {walletName} needs a real signed pass.
        </Text>
        <TouchableOpacity
          accessibilityRole="button"
          activeOpacity={0.85}
          onPress={onClose}
          style={styles.secondaryButton}
        >
          <Text style={styles.secondaryButtonText}>Done</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  dot: {
    borderColor: colors.darkText,
    borderRadius: 999,
    borderWidth: 1.5,
    height: 12,
    width: 12,
  },
  dotOn: {
    backgroundColor: colors.darkText,
  },
  dots: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 6,
    justifyContent: "center",
    marginTop: 12,
    maxWidth: 220,
  },
  emptyCard: {
    alignItems: "center",
    gap: 8,
    paddingVertical: 24,
  },
  emptySub: {
    textAlign: "center",
  },
  hero: {
    alignItems: "center",
    borderRadius: spacing.radiusCard,
    paddingHorizontal: 20,
    paddingVertical: 24,
  },
  heroBusiness: {
    color: colors.darkText,
    marginTop: 12,
    textAlign: "center",
    ...type.section,
  },
  heroCount: {
    color: colors.darkText,
    marginTop: 8,
    ...type.hero,
  },
  heroCountTotal: {
    fontSize: 28,
    fontWeight: "600",
    letterSpacing: -0.5,
  },
  heroIcon: {
    alignItems: "center",
    backgroundColor: colors.white,
    borderRadius: 999,
    height: 48,
    justifyContent: "center",
    width: 48,
  },
  heroLabel: {
    color: colors.darkText,
    ...type.label,
  },
  heroReward: {
    color: colors.darkText,
    marginTop: 10,
    textAlign: "center",
    ...type.bodyStrong,
  },
  heroState: {
    color: colors.darkText,
    marginTop: 6,
    opacity: 0.75,
    ...type.caption,
  },
  secondaryButton: {
    alignItems: "center",
    backgroundColor: colors.surface2,
    borderRadius: spacing.radiusPill,
    justifyContent: "center",
    minHeight: spacing.touchMin,
    paddingHorizontal: 20,
    width: "100%",
  },
  secondaryButtonText: {
    color: colors.text,
    fontSize: 15,
    fontWeight: "700",
  },
  statusCard: {
    alignItems: "center",
    gap: 10,
    marginTop: spacing.gap,
  },
  statusSub: {
    textAlign: "center",
  },
});
