import { Image, StyleSheet, Text, View } from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { colors, spacing, type } from "../theme";
import { QrCode } from "./QrCode";

export interface CoverStyle {
  name: string;
  colors: readonly [string, string, string];
}

export const COVERS: CoverStyle[] = [
  { name: "Lavender dusk", colors: ["#C9B8FF", "#FFB3D9", "#FFD9A8"] },
  { name: "Pink morning", colors: ["#FFB3D9", "#FFC4E0", "#FFE3C2"] },
  { name: "Peach sunset", colors: ["#FFD9A8", "#FFB3A8", "#FF9EC7"] },
  { name: "Forest night", colors: ["#3DDC97", "#7AD9C0", "#C9B8FF"] },
];

export const BRAND_COLORS: Array<{ name: string; value: string }> = [
  { name: "Lavender", value: "#C9B8FF" },
  { name: "Pink", value: "#FFB3D9" },
  { name: "Peach", value: "#FFD9A8" },
  { name: "Mint", value: "#A8E6CF" },
  { name: "Sky", value: "#A8D8FF" },
];

export interface PassDraft {
  businessName: string;
  reward: string;
  target: number;
  brandColor: string;
  cover: string;
  photoUrl: string;
}

export function passSlug(name: string): string {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug.length > 0 ? slug : "my-business";
}

interface PassPreviewProps {
  draft: PassDraft;
  stamps?: number;
}

export function PassPreview({ draft, stamps = 0 }: PassPreviewProps) {
  const cover = COVERS.find((c) => c.name === draft.cover) ?? COVERS[0];
  const target = Math.max(1, draft.target);
  const filled = Math.min(stamps, target);
  const dots = Array.from({ length: target }, (_, i) => i < filled);
  const initial = draft.businessName.trim().charAt(0).toUpperCase() || "S";
  const hasPhoto = draft.photoUrl.trim().startsWith("http");
  return (
    <View style={styles.phone}>
      <View style={styles.notch} />
      {hasPhoto ? (
        <Image
          source={{ uri: draft.photoUrl.trim() }}
          style={styles.coverPhoto}
          resizeMode="cover"
        />
      ) : (
        <LinearGradient
          colors={cover.colors}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={styles.cover}
        >
          <Text style={styles.coverInitial}>{initial}</Text>
          <Text style={styles.coverName}>{cover.name}</Text>
        </LinearGradient>
      )}
      <View style={styles.body}>
        <Text style={styles.business}>
          {draft.businessName.trim() || "Your business"}
        </Text>
        <Text style={styles.count}>
          {filled}
          <Text style={styles.countTotal}>/{target}</Text>
        </Text>
        <Text style={styles.stampsLabel}>stamps</Text>
        <View style={styles.dots}>
          {dots.map((on, i) => (
            <View
              key={`preview-dot-${i}`}
              style={[
                styles.dot,
                on ? { backgroundColor: draft.brandColor } : styles.dotOff,
              ]}
            />
          ))}
        </View>
        <Text style={styles.reward}>{draft.reward.trim() || "Your reward"}</Text>
        <View style={styles.qrWrap}>
          <QrCode size={110} />
        </View>
        <Text style={styles.scanHint}>Scan to add the pass to Wallet</Text>
        <Text style={styles.powered}>Powered by Stampy</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  body: {
    alignItems: "center",
    paddingHorizontal: 18,
    paddingTop: 16,
  },
  business: {
    color: colors.text,
    textAlign: "center",
    ...type.section,
  },
  count: {
    color: colors.text,
    marginTop: 10,
    ...type.hero,
  },
  countTotal: {
    fontSize: 28,
    fontWeight: "600",
    letterSpacing: -0.5,
  },
  cover: {
    alignItems: "center",
    height: 168,
    justifyContent: "center",
  },
  coverInitial: {
    color: colors.darkText,
    fontSize: 56,
    fontWeight: "700",
  },
  coverName: {
    color: colors.darkText,
    marginTop: 4,
    opacity: 0.75,
    ...type.caption,
  },
  coverPhoto: {
    height: 168,
    width: "100%",
  },
  dot: {
    borderRadius: 999,
    height: 12,
    width: 12,
  },
  dotOff: {
    borderColor: colors.border,
    borderWidth: 1.5,
  },
  dots: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 6,
    justifyContent: "center",
    marginTop: 14,
    maxWidth: 220,
  },
  notch: {
    alignSelf: "center",
    backgroundColor: colors.surface2,
    borderRadius: 999,
    height: 6,
    marginTop: 10,
    width: 64,
  },
  phone: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: 32,
    borderWidth: 1,
    overflow: "hidden",
    paddingBottom: 18,
  },
  powered: {
    color: colors.faint,
    marginTop: 14,
    ...type.caption,
  },
  qrWrap: {
    marginTop: 18,
  },
  reward: {
    color: colors.muted,
    marginTop: 10,
    textAlign: "center",
    ...type.bodyStrong,
  },
  scanHint: {
    color: colors.muted,
    marginTop: 10,
    ...type.caption,
  },
  stampsLabel: {
    color: colors.muted,
    ...type.label,
  },
});
