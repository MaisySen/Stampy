import { useEffect, useRef, useState } from "react";
import { StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import { colors, gradientHero, shared, spacing, type } from "../theme";
import { QrCode } from "../components/QrCode";
import {
  canRetry,
  initialInstallStatus,
  installErrorMessage,
  installFailed,
  LOCAL_PREVIEW_NOTICE,
  previewStateLabel,
  installSucceeded,
  retryInstall,
  startInstall,
} from "../lib/passInstall";
import type { InstallPlatform, PassInstallStatus } from "../lib/passInstall";
import { passRewardState, passStateLabel } from "../lib/pass";

interface PassInstallScreenProps {
  businessName: string;
  reward: string;
  stamps: number;
  target: number;
  platform: InstallPlatform;
  shareLink: string;
  onClose: () => void;
  onInstalled?: () => void;
}

export function PassInstallScreen({
  businessName,
  reward,
  stamps,
  target,
  platform,
  shareLink,
  onClose,
  onInstalled,
}: PassInstallScreenProps) {
  const [status, setStatus] = useState<PassInstallStatus>(() =>
    initialInstallStatus(platform),
  );
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (timer.current !== null) {
        clearTimeout(timer.current);
      }
    };
  }, []);

  const hasPass = businessName.trim().length > 0;
  const safeTarget = Math.max(1, Math.floor(target));
  const safeStamps = Math.min(Math.max(0, Math.floor(stamps)), safeTarget);
  const state = passRewardState(stamps, target);
  const dots = Array.from({ length: safeTarget }, (_, i) => i < safeStamps);
  const walletName = platform === "apple" ? "Apple Wallet" : "Google Wallet";

  function finishInstall(started: PassInstallStatus) {
    timer.current = setTimeout(() => {
      setStatus(installSucceeded(started));
      onInstalled?.();
    }, 1200);
  }

  function handleInstall() {
    const started = startInstall(status);
    if (started === status) {
      return;
    }
    setStatus(started);
    if (shareLink.trim().length === 0) {
      setStatus(installFailed(started, installErrorMessage("missing")));
      return;
    }
    finishInstall(started);
  }

  function handleRetry() {
    if (!canRetry(status)) {
      return;
    }
    const retried = retryInstall(status);
    setStatus(retried);
    if (shareLink.trim().length === 0) {
      setStatus(installFailed(retried, installErrorMessage("missing")));
      return;
    }
    finishInstall(retried);
  }

  if (!hasPass) {
    return (
      <View>
        <View style={[shared.card, styles.emptyCard]}>
          <Text style={shared.cardTitle}>No pass to install</Text>
          <Text style={[shared.cardMuted, styles.emptySub]}>
            There is no business pass on this screen yet. Build a pass first,
            then come back here to add it.
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
        <Text style={styles.heroLabel}>paid visits</Text>
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

      {status.state === "installed" ? (
        <View style={[shared.card, styles.statusCard]}>
          <View style={styles.statusIcon}>
            <Ionicons name="checkmark" size={22} color={colors.darkText} />
          </View>
          <Text style={shared.cardTitle}>Preview ready. Not added to {walletName}</Text>
          <Text style={[shared.cardMuted, styles.statusSub]}>
            {LOCAL_PREVIEW_NOTICE}
          </Text>
          <TouchableOpacity
            accessibilityRole="button"
            activeOpacity={0.85}
            onPress={onClose}
            style={styles.primaryButton}
          >
            <Text style={styles.primaryButtonText}>Done</Text>
          </TouchableOpacity>
        </View>
      ) : status.state === "failed" ? (
        <View style={[shared.card, styles.statusCard]}>
          <View style={[styles.statusIcon, styles.statusIconError]}>
            <Ionicons name="alert-outline" size={22} color={colors.darkText} />
          </View>
          <Text style={shared.cardTitle}>Preview not shown</Text>
          <Text style={[shared.cardMuted, styles.statusSub]}>
            {status.error ?? installErrorMessage("unknown")}
          </Text>
          <TouchableOpacity
            accessibilityRole="button"
            activeOpacity={0.85}
            onPress={handleRetry}
            style={styles.primaryButton}
          >
            <Text style={styles.primaryButtonText}>Try again</Text>
          </TouchableOpacity>
          <TouchableOpacity
            accessibilityRole="button"
            activeOpacity={0.85}
            onPress={onClose}
            style={styles.secondaryButton}
          >
            <Text style={styles.secondaryButtonText}>Not now</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <View style={[shared.card, styles.statusCard]}>
          <Text style={shared.cardTitle}>Preview the {walletName} pass</Text>
          <Text style={[shared.cardMuted, styles.statusSub]}>
            {LOCAL_PREVIEW_NOTICE}
          </Text>
          <TouchableOpacity
            accessibilityRole="button"
            accessibilityState={{ disabled: status.state === "installing" }}
            activeOpacity={0.85}
            disabled={status.state === "installing"}
            onPress={handleInstall}
            style={[
              styles.primaryButton,
              status.state === "installing" && styles.primaryButtonBusy,
            ]}
          >
            <Text style={styles.primaryButtonText}>
              {status.state === "installing"
                ? previewStateLabel("installing")
                : `Preview ${walletName} pass`}
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            accessibilityRole="button"
            activeOpacity={0.85}
            onPress={onClose}
            style={styles.secondaryButton}
          >
            <Text style={styles.secondaryButtonText}>Not now</Text>
          </TouchableOpacity>
        </View>
      )}

      <View style={[shared.card, styles.qrCard]}>
        <QrCode size={126} />
        <Text style={[shared.cardMuted, styles.qrHint]}>
          Placeholder code. It is not a real pass link and cannot be scanned to add a pass.
        </Text>
        <Text style={styles.qrLink}>{shareLink.trim() ? `Local preview link, not published: ${shareLink.trim()}` : "No pass link yet"}</Text>
      </View>

      <Text style={styles.privacy}>
        The pass only knows where the business is. Stampies does not track you
        live.
      </Text>
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
  primaryButton: {
    alignItems: "center",
    backgroundColor: colors.lavender,
    borderRadius: spacing.radiusPill,
    justifyContent: "center",
    minHeight: spacing.touchMin,
    paddingHorizontal: 20,
    width: "100%",
  },
  primaryButtonBusy: {
    opacity: 0.6,
  },
  primaryButtonText: {
    color: colors.darkText,
    fontSize: 15,
    fontWeight: "700",
  },
  privacy: {
    color: colors.faint,
    fontSize: 12,
    fontWeight: "500",
    lineHeight: 18,
    marginTop: 16,
    paddingHorizontal: 4,
  },
  qrCard: {
    alignItems: "center",
    gap: 10,
    marginTop: spacing.gap,
  },
  qrHint: {
    textAlign: "center",
  },
  qrLink: {
    color: colors.faint,
    fontSize: 12,
    fontWeight: "500",
    textAlign: "center",
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
  statusIcon: {
    alignItems: "center",
    backgroundColor: colors.green,
    borderRadius: 999,
    height: 48,
    justifyContent: "center",
    width: 48,
  },
  statusIconError: {
    backgroundColor: colors.pink,
  },
  statusSub: {
    textAlign: "center",
  },
});
