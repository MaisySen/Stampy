import { StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { colors, spacing } from "../theme";

export interface DemoNotice {
  id: string;
  tone: "info" | "error";
  text: string;
  actionLabel?: string;
  onAction?: () => void;
}

interface DemoBannerProps {
  notices: DemoNotice[];
}

/**
 * Always-visible label for the local/demo build, plus any storage or queue
 * notice. Errors stay on screen until the cause is fixed.
 */
export function DemoBanner({ notices }: DemoBannerProps) {
  return (
    <View>
      <View accessibilityRole="header" style={styles.demo}>
        <Text style={styles.demoText}>
          LOCAL DEMO. Synthetic data on this device only. No server, no real
          Wallet pass, no published program.
        </Text>
      </View>
      {notices.map((notice) => (
        <View
          key={notice.id}
          style={[styles.notice, notice.tone === "error" && styles.noticeError]}
        >
          <Text style={styles.noticeText}>{notice.text}</Text>
          {notice.actionLabel !== undefined && notice.onAction !== undefined && (
            <TouchableOpacity
              accessibilityRole="button"
              activeOpacity={0.85}
              onPress={notice.onAction}
              style={styles.action}
            >
              <Text style={styles.actionText}>{notice.actionLabel}</Text>
            </TouchableOpacity>
          )}
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  action: {
    alignSelf: "flex-start",
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: 999,
    borderWidth: 1,
    justifyContent: "center",
    marginTop: 6,
    minHeight: spacing.touchMin,
    paddingHorizontal: 16,
  },
  actionText: {
    color: colors.text,
    fontSize: 13,
    fontWeight: "600",
  },
  demo: {
    backgroundColor: colors.surface,
    borderBottomColor: colors.border,
    borderBottomWidth: 1,
    paddingHorizontal: 16,
    paddingVertical: 6,
  },
  demoText: {
    color: colors.muted,
    fontSize: 12,
    fontWeight: "600",
  },
  notice: {
    backgroundColor: colors.surface,
    borderBottomColor: colors.border,
    borderBottomWidth: 1,
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  noticeError: {
    borderLeftColor: colors.red,
    borderLeftWidth: 4,
  },
  noticeText: {
    color: colors.text,
    fontSize: 13,
  },
});
