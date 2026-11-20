import { StyleSheet, Text, View } from "react-native";
import { colors, gradientChart, type } from "../theme";
import type { DayStat } from "../data";

interface BarChartProps {
  data: DayStat[];
}

const BAR_COLORS = [
  "#A78BFA",
  "#C9B8FF",
  "#E3B8FF",
  "#FFB3D9",
  "#FF9EC7",
  "#FFC4A8",
  "#FFD9A8",
];

export function BarChart({ data }: BarChartProps) {
  const max = Math.max(1, ...data.map((d) => d.stamps));
  return (
    <View>
      <View style={styles.bars}>
        {data.map((d, i) => (
          <View key={d.day} style={styles.column}>
            <View style={styles.barWrap}>
              <View
                style={[
                  styles.bar,
                  {
                    backgroundColor: BAR_COLORS[i % BAR_COLORS.length],
                    height: Math.max(6, (d.stamps / max) * 120),
                  },
                ]}
              />
            </View>
            <Text style={styles.day}>{d.day}</Text>
            <Text style={styles.value}>{d.stamps}</Text>
          </View>
        ))}
      </View>
      <Text style={styles.note}>
        Lavender to peach, left to right, shows the week at a glance.
      </Text>
    </View>
  );
}

export function ChartLegend() {
  return (
    <View style={styles.legend}>
      {gradientChart.map((c) => (
        <View key={c} style={[styles.swatch, { backgroundColor: c }]} />
      ))}
      <Text style={styles.legendText}>Stamps per day</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    borderRadius: 8,
    width: "100%",
  },
  barWrap: {
    alignItems: "flex-end",
    flex: 1,
    justifyContent: "flex-end",
  },
  bars: {
    flexDirection: "row",
    gap: 8,
    height: 168,
  },
  column: {
    alignItems: "center",
    flex: 1,
  },
  day: {
    color: colors.muted,
    marginTop: 8,
    ...type.caption,
  },
  legend: {
    alignItems: "center",
    flexDirection: "row",
    gap: 6,
    marginTop: 12,
  },
  legendText: {
    color: colors.muted,
    ...type.caption,
  },
  note: {
    color: colors.faint,
    marginTop: 12,
    ...type.caption,
  },
  swatch: {
    borderRadius: 999,
    height: 10,
    width: 10,
  },
  value: {
    color: colors.text,
    fontSize: 13,
    fontWeight: "700",
    marginTop: 2,
  },
});
