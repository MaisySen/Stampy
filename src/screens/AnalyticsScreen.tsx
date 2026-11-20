import { StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { colors, shared, spacing, type } from "../theme";
import type { BusinessState, StampMethod } from "../data";
import { BarChart } from "../components/BarChart";

interface AnalyticsScreenProps {
  business: BusinessState;
  onClear: () => void;
  onRestore: () => void;
}

const METHOD_COLORS: Record<StampMethod, string> = {
  NFC: colors.lavender,
  QR: colors.pink,
  Staff: colors.peach,
};

export function AnalyticsScreen({ business, onClear, onRestore }: AnalyticsScreenProps) {
  const empty = business.stampsGiven === 0;
  return (
    <View>
      <Text style={styles.title}>Analytics</Text>
      <Text style={styles.sub}>Last 7 days, {business.name}.</Text>

      <View style={[shared.card, styles.hero]}>
        <Text style={styles.heroLabel}>Stamps given</Text>
        <Text style={styles.heroNumber}>{business.stampsGiven}</Text>
        <View style={styles.heroRow}>
          <View style={styles.heroStat}>
            <Text style={styles.heroStatLabel}>Customers</Text>
            <Text style={styles.heroStatValue}>{business.visitors}</Text>
          </View>
          <View style={styles.heroStat}>
            <Text style={styles.heroStatLabel}>Repeat visits</Text>
            <Text style={styles.heroStatValue}>{business.repeatRate}%</Text>
          </View>
          <View style={styles.heroStat}>
            <Text style={styles.heroStatLabel}>Reward rate</Text>
            <Text style={styles.heroStatValue}>
              {business.visitors === 0 ? "0%" : "12%"}
            </Text>
          </View>
        </View>
      </View>

      <View style={[shared.card, styles.chartCard]}>
        <View style={shared.rowBetween}>
          <Text style={shared.cardTitle}>Stamps over time</Text>
          <Text style={styles.range}>7 days</Text>
        </View>
        {empty ? (
          <View style={styles.empty}>
            <Text style={shared.cardTitle}>No stamps yet</Text>
            <Text style={[shared.cardMuted, styles.emptySub]}>
              Your first stamp will show here. Hand a customer your card and
              the chart fills in.
            </Text>
            <TouchableOpacity
              accessibilityRole="button"
              activeOpacity={0.85}
              onPress={onRestore}
              style={styles.restoreButton}
            >
              <Text style={styles.restoreButtonText}>Restore demo data</Text>
            </TouchableOpacity>
          </View>
        ) : (
          <View style={styles.chart}>
            <BarChart data={business.week} />
          </View>
        )}
      </View>

      <View style={[shared.card, styles.splitCard]}>
        <Text style={shared.cardTitle}>How stamps were given</Text>
        {(Object.keys(business.split) as StampMethod[]).map((method) => {
          const count = business.split[method];
          const share =
            business.stampsGiven === 0
              ? 0
              : Math.round((count / business.stampsGiven) * 100);
          return (
            <View key={method} style={styles.splitRow}>
              <View style={[styles.splitDot, { backgroundColor: METHOD_COLORS[method] }]} />
              <Text style={styles.splitLabel}>
                {method === "NFC" ? "NFC tap" : method === "QR" ? "QR code" : "Staff"}
              </Text>
              <Text style={styles.splitValue}>
                {count} ({share}%)
              </Text>
            </View>
          );
        })}
      </View>

      <View style={[shared.card, styles.recentCard]}>
        <Text style={shared.cardTitle}>Recent stamps</Text>
        {business.recent.length === 0 ? (
          <Text style={[shared.cardMuted, styles.emptySub]}>
            No recent stamps. New stamps will list here with the method and
            time.
          </Text>
        ) : (
          business.recent.map((s) => (
            <View key={s.id} style={styles.recentRow}>
              <View style={styles.recentIcon}>
                <Ionicons name="person-outline" size={18} color={colors.text} />
              </View>
              <View style={styles.recentText}>
                <Text style={styles.recentName}>{s.customer}</Text>
                <Text style={styles.recentTime}>
                  {s.time} by {s.method === "NFC" ? "NFC tap" : s.method === "QR" ? "QR code" : "staff"}
                </Text>
              </View>
              <Ionicons name="checkmark-circle" size={20} color={colors.green} />
            </View>
          ))
        )}
      </View>

      {!empty && (
        <TouchableOpacity
          accessibilityRole="button"
          activeOpacity={0.85}
          onPress={onClear}
          style={styles.clearButton}
        >
          <Text style={styles.clearButtonText}>Clear demo data</Text>
        </TouchableOpacity>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  chart: {
    marginTop: 16,
  },
  chartCard: {
    marginTop: spacing.gap,
  },
  clearButton: {
    alignItems: "center",
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: spacing.radiusPill,
    borderWidth: 1,
    justifyContent: "center",
    marginTop: spacing.gap,
    minHeight: spacing.touchMin,
  },
  clearButtonText: {
    color: colors.muted,
    fontSize: 14,
    fontWeight: "600",
  },
  empty: {
    alignItems: "flex-start",
    gap: 6,
    paddingVertical: 20,
  },
  emptySub: {
    marginTop: 4,
  },
  hero: {
    backgroundColor: colors.surface2,
    marginTop: 18,
  },
  heroLabel: {
    color: colors.muted,
    ...type.label,
  },
  heroNumber: {
    color: colors.text,
    marginTop: 6,
    ...type.hero,
  },
  heroRow: {
    flexDirection: "row",
    gap: 12,
    marginTop: 18,
  },
  heroStat: {
    backgroundColor: colors.surface,
    borderRadius: spacing.radiusInner,
    flex: 1,
    padding: 12,
  },
  heroStatLabel: {
    color: colors.muted,
    ...type.caption,
  },
  heroStatValue: {
    color: colors.text,
    fontSize: 20,
    fontWeight: "700",
    marginTop: 4,
  },
  range: {
    backgroundColor: colors.surface2,
    borderRadius: spacing.radiusPill,
    color: colors.muted,
    overflow: "hidden",
    paddingHorizontal: 12,
    paddingVertical: 6,
    ...type.caption,
  },
  recentCard: {
    gap: 4,
    marginTop: spacing.gap,
  },
  recentIcon: {
    alignItems: "center",
    backgroundColor: colors.surface2,
    borderRadius: 999,
    height: 40,
    justifyContent: "center",
    width: 40,
  },
  recentName: {
    color: colors.text,
    fontSize: 15,
    fontWeight: "600",
  },
  recentRow: {
    alignItems: "center",
    flexDirection: "row",
    gap: 12,
    paddingVertical: 10,
  },
  recentText: {
    flex: 1,
    gap: 2,
  },
  recentTime: {
    color: colors.muted,
    ...type.caption,
  },
  restoreButton: {
    alignItems: "center",
    backgroundColor: colors.lavender,
    borderRadius: spacing.radiusPill,
    justifyContent: "center",
    marginTop: 12,
    minHeight: spacing.touchMin,
    paddingHorizontal: 20,
  },
  restoreButtonText: {
    color: colors.darkText,
    fontSize: 14,
    fontWeight: "700",
  },
  splitCard: {
    gap: 4,
    marginTop: spacing.gap,
  },
  splitDot: {
    borderRadius: 999,
    height: 10,
    width: 10,
  },
  splitLabel: {
    color: colors.text,
    flex: 1,
    fontSize: 15,
    fontWeight: "500",
  },
  splitRow: {
    alignItems: "center",
    flexDirection: "row",
    gap: 10,
    paddingVertical: 10,
  },
  splitValue: {
    color: colors.muted,
    fontSize: 14,
    fontWeight: "600",
  },
  sub: {
    color: colors.muted,
    marginTop: 6,
    ...type.body,
  },
  title: {
    color: colors.text,
    ...type.title,
  },
});
