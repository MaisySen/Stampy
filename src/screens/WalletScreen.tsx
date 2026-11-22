import { useState } from "react";
import { StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { colors, shared, spacing, type } from "../theme";
import { DEMO_BIRTHDAY } from "../data";
import { daysUntilBirthday, isBirthdayMonth, isBirthdayToday } from "../lib/loyalty";
import { ProgramStampCard } from "../components/ProgramStampCard";

interface WalletScreenProps {
  businessName: string;
  reward: string;
  /** Paid visits counted on the card. */
  stamps: number;
  paidVisits: number;
  /** Set when saved progress could not be read, so redeeming is off. */
  unavailableReason?: string | null;
  onRedeem: () => void;
  onGoToStamp: () => void;
  /** Opens the local Wallet preview. It does not issue a pass. */
  onAddToWallet?: () => void;
}

export function WalletScreen({
  businessName,
  reward,
  stamps,
  paidVisits,
  unavailableReason = null,
  onRedeem,
  onGoToStamp,
  onAddToWallet,
}: WalletScreenProps) {
  const [alertsOpen, setAlertsOpen] = useState(false);
  const rewardReady = stamps >= paidVisits && unavailableReason === null;
  const stampsLeft = Math.max(0, paidVisits - stamps);
  const today = new Date();
  const birthdayToday = isBirthdayToday(DEMO_BIRTHDAY.month, DEMO_BIRTHDAY.day, today);
  const birthdayThisMonth = isBirthdayMonth(DEMO_BIRTHDAY.month, today);
  const birthdayInDays = daysUntilBirthday(DEMO_BIRTHDAY.month, DEMO_BIRTHDAY.day, today);
  const nudgeText = rewardReady
    ? "Your reward is ready. Show this card at the counter."
    : stampsLeft === 1
      ? "Come in for a treat. Your card is one paid visit from the free reward visit."
      : `Come in for a treat. Your card is ${stampsLeft} paid visits from the free reward visit.`;
  return (
    <View>
      <View style={styles.greeting}>
        <View>
          <Text style={styles.hello}>Good morning</Text>
          <Text style={styles.name}>{businessName} regular</Text>
        </View>
        <TouchableOpacity
          accessibilityLabel="Alerts"
          accessibilityRole="button"
          activeOpacity={0.85}
          onPress={() => setAlertsOpen((prev) => !prev)}
          style={styles.bell}
        >
          <Ionicons name="notifications-outline" size={20} color={colors.text} />
          <View style={styles.dot} />
        </TouchableOpacity>
      </View>

      {alertsOpen && (
        <View style={[shared.card, styles.alertsCard]}>
          <Text style={shared.cardTitle}>No new alerts</Text>
          <Text style={[shared.cardMuted, styles.alertsSub]}>
            Nearby nudges and birthday treats will show here when they arrive.
          </Text>
        </View>
      )}

      <ProgramStampCard
        businessName={businessName}
        paidVisitsDone={stamps}
        paidVisits={paidVisits}
        reward={reward}
      />

      <View style={[shared.card, styles.actionCard]}>
        <View>
          <Text style={shared.cardTitle}>
            {rewardReady
              ? "Your free reward visit is ready"
              : `${stampsLeft} more paid ${stampsLeft === 1 ? "visit" : "visits"} to go`}
          </Text>
          <Text style={[shared.cardMuted, styles.actionSub]}>
            {rewardReady
              ? "Redeeming here is recorded on this device only."
              : "One paid visit per stamp. One stamp per day."}
          </Text>
        </View>
        <TouchableOpacity
          accessibilityRole="button"
          activeOpacity={0.85}
          onPress={rewardReady ? onRedeem : onGoToStamp}
          style={[styles.actionButton, rewardReady && styles.actionButtonReady]}
        >
          <Text style={styles.actionButtonText}>
            {rewardReady ? "Redeem locally" : "Get a stamp"}
          </Text>
        </TouchableOpacity>
      </View>

      {unavailableReason !== null && (
        <Text style={styles.privacy}>{unavailableReason}</Text>
      )}

      {onAddToWallet !== undefined && (
        <TouchableOpacity
          accessibilityRole="button"
          activeOpacity={0.85}
          onPress={onAddToWallet}
          style={[styles.actionButton, styles.previewButton]}
        >
          <Text style={styles.actionButtonText}>Preview Wallet pass (not issued)</Text>
        </TouchableOpacity>
      )}

      <View style={[shared.card, styles.nudgeCard]}>
        <View style={styles.nudgeIcon}>
          <Ionicons name="location-outline" size={20} color={colors.darkText} />
        </View>
        <View style={styles.nudgeText}>
          <Text style={shared.cardTitle}>You are near {businessName}</Text>
          <Text style={shared.cardMuted}>{nudgeText}</Text>
        </View>
      </View>

      {birthdayToday ? (
        <View style={[shared.card, styles.birthdayCard]}>
          <View style={styles.nudgeIcon}>
            <Ionicons name="gift-outline" size={20} color={colors.darkText} />
          </View>
          <View style={styles.nudgeText}>
            <Text style={shared.cardTitle}>Happy birthday</Text>
            <Text style={shared.cardMuted}>
              Demo birthday treat. Show this card at the counter.
            </Text>
          </View>
        </View>
      ) : birthdayThisMonth ? (
        <View style={[shared.card, styles.birthdayCard]}>
          <View style={styles.nudgeIcon}>
            <Ionicons name="gift-outline" size={20} color={colors.darkText} />
          </View>
          <View style={styles.nudgeText}>
            <Text style={shared.cardTitle}>Birthday this month</Text>
            <Text style={shared.cardMuted}>
              A free slice is waiting. It lands on your card in {birthdayInDays}{" "}
              {birthdayInDays === 1 ? "day" : "days"}.
            </Text>
          </View>
        </View>
      ) : (
        <View style={[shared.card, styles.birthdayCard]}>
          <View style={styles.nudgeIcon}>
            <Ionicons name="gift-outline" size={20} color={colors.darkText} />
          </View>
          <View style={styles.nudgeText}>
            <Text style={shared.cardTitle}>Birthday in {birthdayInDays} days</Text>
            <Text style={shared.cardMuted}>
              A free slice is waiting. It will appear on your card on the day.
            </Text>
          </View>
        </View>
      )}

      <Text style={styles.privacy}>
        Your card only knows where the business is. Your phone works out when
        you are nearby, on the device. Stampies does not track you live.
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  actionButton: {
    alignItems: "center",
    backgroundColor: colors.surface2,
    borderRadius: spacing.radiusPill,
    justifyContent: "center",
    minHeight: spacing.touchMin,
    paddingHorizontal: 20,
  },
  previewButton: {
    marginTop: spacing.gap,
  },
  actionButtonReady: {
    backgroundColor: colors.lavender,
  },
  actionButtonText: {
    color: colors.text,
    fontSize: 14,
    fontWeight: "700",
  },
  actionCard: {
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "space-between",
    marginTop: spacing.gap,
  },
  actionSub: {
    marginTop: 4,
    maxWidth: 190,
  },
  alertsCard: {
    gap: 4,
    marginBottom: spacing.gap,
  },
  alertsSub: {
    marginTop: 4,
  },
  bell: {
    alignItems: "center",
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: 999,
    borderWidth: 1,
    height: 48,
    justifyContent: "center",
    width: 48,
  },
  birthdayCard: {
    alignItems: "center",
    flexDirection: "row",
    gap: 12,
    marginTop: spacing.gap,
  },
  dot: {
    backgroundColor: colors.pink,
    borderRadius: 999,
    height: 8,
    position: "absolute",
    right: 12,
    top: 12,
    width: 8,
  },
  greeting: {
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "space-between",
    marginBottom: 16,
    marginTop: 4,
  },
  hello: {
    color: colors.muted,
    ...type.body,
  },
  name: {
    color: colors.text,
    marginTop: 2,
    ...type.title,
  },
  nudgeCard: {
    alignItems: "center",
    flexDirection: "row",
    gap: 12,
    marginTop: spacing.gap,
  },
  nudgeIcon: {
    alignItems: "center",
    backgroundColor: colors.lavender,
    borderRadius: 999,
    height: 44,
    justifyContent: "center",
    width: 44,
  },
  nudgeText: {
    flex: 1,
    gap: 4,
  },
  privacy: {
    color: colors.faint,
    fontSize: 12,
    fontWeight: "500",
    lineHeight: 18,
    marginTop: 16,
    paddingHorizontal: 4,
  },
});
