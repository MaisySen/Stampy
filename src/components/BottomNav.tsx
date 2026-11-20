import { StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { colors, spacing } from "../theme";

export type TabKey = "wallet" | "stamp" | "analytics" | "program";

type IconName = React.ComponentProps<typeof Ionicons>["name"];

const TABS: Array<{ key: TabKey; label: string; icon: IconName; activeIcon: IconName }> = [
  { key: "wallet", label: "Wallet", icon: "wallet-outline", activeIcon: "wallet" },
  { key: "stamp", label: "Stamp", icon: "qr-code-outline", activeIcon: "qr-code" },
  { key: "analytics", label: "Stats", icon: "bar-chart-outline", activeIcon: "bar-chart" },
  { key: "program", label: "Program", icon: "settings-outline", activeIcon: "settings" },
];

interface BottomNavProps {
  active: TabKey;
  onSelect: (tab: TabKey) => void;
}

export function BottomNav({ active, onSelect }: BottomNavProps) {
  return (
    <View style={styles.wrap} pointerEvents="box-none">
      <View style={styles.pill}>
        {TABS.map((tab) => {
          const isActive = tab.key === active;
          return (
            <TouchableOpacity
              key={tab.key}
              accessibilityLabel={tab.label}
              accessibilityRole="button"
              accessibilityState={{ selected: isActive }}
              activeOpacity={0.85}
              onPress={() => onSelect(tab.key)}
              style={[styles.item, isActive && styles.itemActive]}
            >
              <Ionicons
                name={isActive ? tab.activeIcon : tab.icon}
                size={20}
                color={isActive ? colors.darkText : colors.faint}
              />
              <Text style={[styles.label, isActive && styles.labelActive]}>
                {tab.label}
              </Text>
            </TouchableOpacity>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  item: {
    alignItems: "center",
    borderRadius: spacing.radiusPill,
    flex: 1,
    flexDirection: "row",
    gap: 6,
    justifyContent: "center",
    minHeight: spacing.touchMin,
    paddingHorizontal: 10,
  },
  itemActive: {
    backgroundColor: colors.lavender,
  },
  label: {
    color: colors.faint,
    fontSize: 13,
    fontWeight: "600",
  },
  labelActive: {
    color: colors.darkText,
  },
  pill: {
    backgroundColor: colors.pill,
    borderRadius: spacing.radiusPill,
    flexDirection: "row",
    padding: 6,
    shadowColor: "#000000",
    shadowOffset: { height: 8, width: 0 },
    shadowOpacity: 0.3,
    shadowRadius: 20,
  },
  wrap: {
    bottom: 28,
    left: 20,
    position: "absolute",
    right: 20,
  },
});
