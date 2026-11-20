import { useState } from "react";
import { StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { colors, shared, spacing, type } from "../theme";
import { DEMO_STAFF_CODE, STAMPS_TO_REWARD } from "../data";
import type { StampMethod } from "../data";
import { QrCode } from "../components/QrCode";

type Method = StampMethod;
type FlowState = "idle" | "done";
type IconName = React.ComponentProps<typeof Ionicons>["name"];

interface StampScreenProps {
  stamps: number;
  staffCode: string;
  onStamp: (method: StampMethod) => void;
}

const METHODS: Array<{ key: Method; label: string; hint: string; icon: IconName }> = [
  { key: "NFC", label: "Tap", hint: "Hold your phone to the counter tag", icon: "wifi-outline" },
  { key: "QR", label: "Scan", hint: "Scan the code at the counter", icon: "qr-code-outline" },
  { key: "Staff", label: "Staff", hint: "Staff add the stamp for you", icon: "person-outline" },
];

export function StampScreen({ stamps, staffCode, onStamp }: StampScreenProps) {
  const [method, setMethod] = useState<Method>("NFC");
  const [flow, setFlow] = useState<FlowState>("idle");
  const rewardReady = stamps >= STAMPS_TO_REWARD;

  function handleStamp() {
    onStamp(method);
    setFlow("done");
  }

  function pick(next: Method) {
    setMethod(next);
    setFlow("idle");
  }

  return (
    <View>
      <Text style={styles.title}>Get a stamp</Text>
      <Text style={styles.sub}>
        {stamps} of {STAMPS_TO_REWARD} stamps. One stamp per visit, one visit
        per day.
      </Text>

      <View style={styles.methods}>
        {METHODS.map((m) => {
          const active = method === m.key;
          return (
            <TouchableOpacity
              key={m.key}
              accessibilityRole="button"
              accessibilityState={{ selected: active }}
              activeOpacity={0.85}
              onPress={() => pick(m.key)}
              style={[styles.method, active && styles.methodActive]}
            >
              <Ionicons
                name={m.icon}
                size={22}
                color={active ? colors.darkText : colors.text}
              />
              <Text style={[styles.methodLabel, active && styles.methodLabelActive]}>
                {m.label}
              </Text>
              <Text style={[styles.methodHint, active && styles.methodHintActive]}>
                {m.hint}
              </Text>
            </TouchableOpacity>
          );
        })}
      </View>

      {method === "NFC" && (
        <View style={[shared.card, styles.flow]}>
          <View style={styles.tapCircle}>
            <Ionicons name="wifi" size={40} color={colors.darkText} />
          </View>
          <Text style={shared.cardTitle}>Hold your phone to the tag</Text>
          <Text style={[shared.cardMuted, styles.flowSub]}>
            The tag sits on the counter. No app to open, no code to type.
          </Text>
          <TouchableOpacity
            accessibilityRole="button"
            activeOpacity={0.85}
            onPress={handleStamp}
            style={styles.primaryButton}
          >
            <Text style={styles.primaryButtonText}>Simulate tap</Text>
          </TouchableOpacity>
        </View>
      )}

      {method === "QR" && (
        <View style={[shared.card, styles.flow]}>
          <QrCode size={126} />
          <Text style={shared.cardTitle}>Scan at the counter</Text>
          <Text style={[shared.cardMuted, styles.flowSub]}>
            Code STAMPY-4821. The code changes each day at the counter.
          </Text>
          <TouchableOpacity
            accessibilityRole="button"
            activeOpacity={0.85}
            onPress={handleStamp}
            style={styles.primaryButton}
          >
            <Text style={styles.primaryButtonText}>I scanned the code</Text>
          </TouchableOpacity>
        </View>
      )}

      {method === "Staff" && (
        <View style={[shared.card, styles.flow]}>
          <Text style={styles.staffCode}>{staffCode}</Text>
          <Text style={shared.cardTitle}>Staff code</Text>
          <Text style={[shared.cardMuted, styles.flowSub]}>
            Show this screen to staff. They confirm the code, then add the
            stamp. The code is set in Program settings.
          </Text>
          <TouchableOpacity
            accessibilityRole="button"
            activeOpacity={0.85}
            onPress={handleStamp}
            style={styles.primaryButton}
          >
            <Text style={styles.primaryButtonText}>Staff added the stamp</Text>
          </TouchableOpacity>
        </View>
      )}

      {flow === "done" && (
        <View style={[shared.card, styles.done]}>
          <Ionicons name="checkmark-circle" size={28} color={colors.green} />
          <View style={styles.doneText}>
            <Text style={shared.cardTitle}>
              {rewardReady ? "Reward ready" : "Stamp added"}
            </Text>
            <Text style={shared.cardMuted}>
              {rewardReady
                ? "Your card is full. Claim the free coffee on the Wallet tab."
                : `You now have ${stamps} of ${STAMPS_TO_REWARD} stamps.`}
            </Text>
          </View>
        </View>
      )}

      <Text style={styles.note}>
        Demo staff code is {DEMO_STAFF_CODE} until the business sets its own
        code. Fraud controls apply: one stamp per day, per business.
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  done: {
    alignItems: "center",
    flexDirection: "row",
    gap: 12,
    marginTop: spacing.gap,
  },
  doneText: {
    flex: 1,
    gap: 4,
  },
  flow: {
    alignItems: "center",
    marginTop: spacing.gap,
    paddingVertical: 24,
  },
  flowSub: {
    marginTop: 6,
    textAlign: "center",
  },
  method: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: spacing.radiusInner,
    borderWidth: 1,
    flex: 1,
    gap: 6,
    minHeight: 108,
    padding: 14,
  },
  methodActive: {
    backgroundColor: colors.lavender,
    borderColor: colors.lavender,
  },
  methodHint: {
    color: colors.muted,
    ...type.caption,
  },
  methodHintActive: {
    color: colors.darkText,
    opacity: 0.75,
  },
  methodLabel: {
    color: colors.text,
    fontSize: 15,
    fontWeight: "700",
  },
  methodLabelActive: {
    color: colors.darkText,
  },
  methods: {
    flexDirection: "row",
    gap: 10,
    marginTop: 18,
  },
  note: {
    color: colors.faint,
    marginTop: 16,
    paddingHorizontal: 4,
    ...type.caption,
    lineHeight: 18,
  },
  primaryButton: {
    alignItems: "center",
    backgroundColor: colors.lavender,
    borderRadius: spacing.radiusPill,
    justifyContent: "center",
    marginTop: 18,
    minHeight: spacing.touchMin,
    paddingHorizontal: 24,
  },
  primaryButtonText: {
    color: colors.darkText,
    fontSize: 15,
    fontWeight: "700",
  },
  staffCode: {
    color: colors.text,
    fontSize: 44,
    fontWeight: "700",
    letterSpacing: 8,
  },
  sub: {
    color: colors.muted,
    marginTop: 6,
    ...type.body,
  },
  tapCircle: {
    alignItems: "center",
    backgroundColor: colors.lavender,
    borderRadius: 999,
    height: 96,
    justifyContent: "center",
    width: 96,
  },
  title: {
    color: colors.text,
    ...type.title,
  },
});
