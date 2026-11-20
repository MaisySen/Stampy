import { StyleSheet, View } from "react-native";
import { colors } from "../theme";

interface QrCodeProps {
  size?: number;
}

const PATTERN = [
  [1, 1, 1, 0, 1, 1, 1],
  [1, 0, 1, 0, 1, 0, 1],
  [1, 1, 1, 0, 1, 1, 1],
  [0, 0, 0, 1, 0, 0, 0],
  [1, 0, 1, 1, 0, 1, 0],
  [0, 1, 0, 0, 1, 0, 1],
  [1, 1, 0, 1, 0, 1, 1],
];

export function QrCode({ size = 126 }: QrCodeProps) {
  const cell = size / 7;
  return (
    <View style={[styles.qr, { padding: size * 0.11 }]}>
      {PATTERN.map((row, r) => (
        <View key={`qr-row-${r}`} style={styles.qrRow}>
          {row.map((on, c) => (
            <View
              key={`qr-${r}-${c}`}
              style={[
                styles.qrCell,
                { height: cell, width: cell },
                on === 1 && styles.qrCellOn,
              ]}
            />
          ))}
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  qr: {
    backgroundColor: colors.white,
    borderRadius: 18,
  },
  qrCell: {},
  qrCellOn: {
    backgroundColor: colors.darkText,
  },
  qrRow: {
    flexDirection: "row",
  },
});
