import { useState } from "react";
import {
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { colors, shared, spacing, type } from "../theme";
import type { StampMethod } from "../data";
import { blockMessage, canStamp, checkStaffPin, dayString } from "../lib/fraud";
import type { StampCheck } from "../lib/fraud";
import { QrCode } from "../components/QrCode";

type Method = StampMethod;
type FlowState = "idle" | "done" | "blocked";
type IconName = React.ComponentProps<typeof Ionicons>["name"];

interface StampScreenProps {
  stamps: number;
  paidVisits: number;
  /** When set, stamping is off and this says why (for example saved progress unreadable). */
  unavailableReason?: string | null;
  staffCode: string;
  lastStampAtMs: number | null;
  lastStampDay: string | null;
  onStamp: (method: StampMethod) => void;
}

const METHODS: Array<{ key: Method; label: string; hint: string; icon: IconName }> = [
  { key: "NFC", label: "Tap", hint: "Hold your phone to the counter tag", icon: "wifi-outline" },
  { key: "QR", label: "Scan", hint: "Scan the code at the counter", icon: "qr-code-outline" },
  { key: "Staff", label: "Staff", hint: "Staff add the stamp for you", icon: "person-outline" },
];

export function StampScreen({
  stamps,
  paidVisits,
  unavailableReason = null,
  staffCode,
  lastStampAtMs,
  lastStampDay,
  onStamp,
}: StampScreenProps) {
  const [method, setMethod] = useState<Method>("NFC");
  const [flow, setFlow] = useState<FlowState>("idle");
  const [pin, setPin] = useState("");
  const [pinError, setPinError] = useState("");
  const [blocked, setBlocked] = useState<StampCheck | null>(null);
  const rewardReady = stamps >= paidVisits;
  const unavailable = unavailableReason !== null;
  const cardFull = rewardReady || unavailable;

  function checkFraud(): StampCheck | null {
    const check = canStamp(lastStampAtMs, lastStampDay, Date.now(), dayString(new Date()));
    if (!check.allowed) {
      setBlocked(check);
      setFlow("blocked");
      return check;
    }
    return null;
  }

  function handleStamp() {
    if (cardFull || unavailable) {
      return;
    }
    if (checkFraud() !== null) {
      return;
    }
    if (method === "Staff") {
      if (!checkStaffPin(pin, staffCode)) {
        setPinError("Wrong staff code. Ask staff to try again.");
        return;
      }
      setPinError("");
      setPin("");
    }
    onStamp(method);
    setBlocked(null);
    setFlow("done");
  }

  function recheck() {
    const check = canStamp(lastStampAtMs, lastStampDay, Date.now(), dayString(new Date()));
    if (check.allowed) {
      setBlocked(null);
      setFlow("idle");
    } else {
      setBlocked(check);
    }
  }

  function pick(next: Method) {
    setMethod(next);
    setFlow("idle");
    setPinError("");
    setBlocked(null);
  }

  return (
    <View>
      <Text style={styles.title}>Get a stamp</Text>
      <Text style={styles.sub}>
        {Math.min(stamps, paidVisits)} of {paidVisits} paid visits. After the
        last paid visit, the next visit is the free reward visit. One stamp per
        visit, one visit per day.
      </Text>
      {unavailable && (
        <View style={[shared.card, styles.blockedCard]}>
          <Text style={shared.cardTitle}>Stamping is off</Text>
          <Text style={shared.cardMuted}>{unavailableReason}</Text>
        </View>
      )}

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
            disabled={cardFull}
            onPress={handleStamp}
            style={[styles.primaryButton, cardFull && styles.buttonDisabled]}
          >
            <Text style={styles.primaryButtonText}>
              {rewardReady ? "Reward visit ready" : "Simulate tap"}
            </Text>
          </TouchableOpacity>
        </View>
      )}

      {method === "QR" && (
        <View style={[shared.card, styles.flow]}>
          <QrCode size={126} />
          <Text style={shared.cardTitle}>Scan at the counter</Text>
          <Text style={[shared.cardMuted, styles.flowSub]}>
            This is a placeholder code, not a real QR scan. This demo has no camera scan.
          </Text>
          <TouchableOpacity
            accessibilityRole="button"
            activeOpacity={0.85}
            disabled={cardFull}
            onPress={handleStamp}
            style={[styles.primaryButton, cardFull && styles.buttonDisabled]}
          >
            <Text style={styles.primaryButtonText}>
              {rewardReady ? "Reward visit ready" : "Demo only: add a stamp without scanning"}
            </Text>
          </TouchableOpacity>
        </View>
      )}

      {method === "Staff" && (
        <View style={[shared.card, styles.flow]}>
          <Text style={shared.cardTitle}>Staff stamp</Text>
          <Text style={[shared.cardMuted, styles.flowSub]}>
            Staff enter the 4 digit staff code to add the stamp. The code is
            set in Program settings.
          </Text>
          <TextInput
            accessibilityLabel="Staff PIN"
            keyboardType="number-pad"
            maxLength={4}
            onChangeText={(v) => {
              setPin(v.replace(/[^0-9]/g, "").slice(0, 4));
              setPinError("");
            }}
            placeholder="0000"
            placeholderTextColor={colors.faint}
            secureTextEntry
            style={[styles.pinInput, pinError.length > 0 && styles.pinInputError]}
            value={pin}
          />
          {pinError.length > 0 && (
            <Text style={styles.errorText}>{pinError}</Text>
          )}
          <TouchableOpacity
            accessibilityRole="button"
            activeOpacity={0.85}
            disabled={cardFull || pin.length !== 4}
            onPress={handleStamp}
            style={[
              styles.primaryButton,
              (cardFull || pin.length !== 4) && styles.buttonDisabled,
            ]}
          >
            <Text style={styles.primaryButtonText}>
              {rewardReady ? "Reward visit ready" : "Add the stamp"}
            </Text>
          </TouchableOpacity>
          <Text style={styles.pinHint}>
            Enter all 4 digits. The button stays off until the code is full.
          </Text>
        </View>
      )}

      {flow === "done" && (
        <View style={[shared.card, styles.done]}>
          <Ionicons name="checkmark-circle" size={28} color={colors.green} />
          <View style={styles.doneText}>
            <Text style={shared.cardTitle}>
              {rewardReady ? "Reward visit ready" : "Paid visit added"}
            </Text>
            <Text style={shared.cardMuted}>
              {rewardReady
                ? "All paid visits are done. The next visit is the free reward visit. Redeem it on the Wallet tab (recorded on this device only)."
                : `You now have ${stamps} of ${paidVisits} paid visits.`}
            </Text>
          </View>
        </View>
      )}

      {flow === "blocked" && blocked !== null && (
        <View style={[shared.card, styles.blockedCard]}>
          <Ionicons name="alert-circle" size={28} color={colors.red} />
          <View style={styles.doneText}>
            <Text style={shared.cardTitle}>Stamp blocked</Text>
            <Text style={shared.cardMuted}>{blockMessage(blocked)}</Text>
            <Text style={[shared.cardMuted, styles.blockedSub]}>
              Demo checks on this device: one stamp per day, and 60 seconds between stamps. Not enforced by a server.
            </Text>
          </View>
          <TouchableOpacity
            accessibilityRole="button"
            activeOpacity={0.85}
            onPress={recheck}
            style={styles.recheckButton}
          >
            <Text style={styles.recheckButtonText}>Check again</Text>
          </TouchableOpacity>
        </View>
      )}

      {rewardReady && (
        <View style={[shared.card, styles.fullCard]}>
          <Text style={shared.cardTitle}>All paid visits are done</Text>
          <Text style={[shared.cardMuted, styles.flowSub]}>
            The next visit is the free reward visit. Redeem it on the Wallet tab, then start a new card.
          </Text>
        </View>
      )}

      <Text style={styles.note}>
        Demo checks run on this device only: the staff code for Staff stamps, a
        60 second cooldown, and one stamp per day. A server does not enforce
        them yet. No login is needed.
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  blockedCard: {
    alignItems: "flex-start",
    borderColor: colors.red,
    gap: 12,
    marginTop: spacing.gap,
  },
  blockedSub: {
    marginTop: 6,
  },
  buttonDisabled: {
    opacity: 0.45,
  },
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
  errorText: {
    color: colors.red,
    marginTop: 8,
    textAlign: "center",
    ...type.body,
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
  fullCard: {
    gap: 6,
    marginTop: spacing.gap,
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
  pinHint: {
    color: colors.faint,
    marginTop: 10,
    textAlign: "center",
    ...type.caption,
  },
  pinInput: {
    backgroundColor: colors.surface2,
    borderRadius: spacing.radiusInner,
    color: colors.text,
    fontSize: 28,
    fontWeight: "700",
    letterSpacing: 10,
    marginTop: 16,
    minHeight: 56,
    paddingHorizontal: 16,
    textAlign: "center",
    width: 180,
  },
  pinInputError: {
    borderColor: colors.red,
    borderWidth: 1.5,
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
  recheckButton: {
    alignItems: "center",
    backgroundColor: colors.surface2,
    borderRadius: spacing.radiusPill,
    justifyContent: "center",
    minHeight: spacing.touchMin,
    paddingHorizontal: 20,
  },
  recheckButtonText: {
    color: colors.text,
    fontSize: 14,
    fontWeight: "600",
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
