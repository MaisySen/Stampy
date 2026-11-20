import { useState } from "react";
import { StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { colors, shared, spacing, type } from "../theme";
import { DEMO_BIRTHDAY, STAMPS_TO_REWARD } from "../data";
import { daysUntilBirthday, isBirthdayMonth, isBirthdayToday } from "../lib/loyalty";
import { StampCard } from "../components/StampCard";

interface WalletScreenProps {
  businessName: string;
  reward: string;
  stamps: number;
  onRedeem: () => void;
  onGoToStamp: () => void;
}

export function WalletScreen({
  businessName,
  reward,
  stamps,
  onRedeem,
  onGoToStamp,
}: WalletScreenProps) {
  const [alertsOpen, setAlertsOpen] = useState(false);
  const rewardReady = stamps >= STAMPS_TO_REWARD;
  const stampsLeft = Math.max(0, STAMPS_TO_REWARD - stamps);
  const today = new Date();
  const birthdayToday = isBirthdayToday(DEMO_BIRTHDAY.month, DEMO_BIRTHDAY.day, today);
  const birthdayThisMonth = isBirthdayMonth(DEMO_BIRTHDAY.month, today);
  const birthdayInDays = daysUntilBirthday(DEMO_BIRTHDAY.month, DEMO_BIRTHDAY.day, today);
  const nudgeText = rewardReady
    ? "Your reward is ready. Show this card at the counter."
    : stampsLeft === 1
      ? "Come in for a treat. Your card is one stamp from a free coffee."
      : `Come in for a treat. Your card is ${stampsLeft} stamps from a free coffee.`;
  return (
    <View>
      <View style={styles.greeting}>
        <View>
          <Text style={styles.hello}>Good morning</Text>
          <Text style={styles.name}>Corner Cafe regular</Text>
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

      <StampCard businessName={businessName} stamps={stamps} reward={reward} />

      <View style={[shared.card, styles.actionCard]}>
        <View>
          <Text style={shared.cardTitle}>
            {rewardReady ? "Your reward is ready" : `${stampsLeft} more stamps to go`}
          </Text>
          <Text style={[shared.cardMuted, styles.actionSub]}>
            {rewardReady
              ? "Show this card at the counter to claim it."
              : "One stamp per visit. One visit per day."}
          </Text>
        </View>
        <TouchableOpacity
          accessibilityRole="button"
          activeOpacity={0.85}
          onPress={rewardReady ? onRedeem : onGoToStamp}
          style={[styles.actionButton, rewardReady && styles.actionButtonReady]}
        >
          <Text style={styles.actionButtonText}>
            {rewardReady ? "Redeem" : "Get a stamp"}
          </Text>
        </TouchableOpacity>
      </View>

      <View style={[shared.card, styles.nudgeCard]}>
        <View style={styles.nudgeIcon}>
          <Ionicons name="location-outline" size={20} color={colors.darkText} />
        </View>
        <View style={styles.nudgeText}>
          <Text style={shared.cardTitle}>You are near Corner Cafe</Text>
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
              Your free treat is ready today. Show this card at the counter.
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
        you are nearby, on the device. Stampy does not track you live.
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
