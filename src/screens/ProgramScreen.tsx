import { StyleSheet, Switch, Text, TextInput, TouchableOpacity, View } from "react-native";
import { colors, shared, spacing, type } from "../theme";

interface ProgramScreenProps {
  businessName: string;
  reward: string;
  birthdayOn: boolean;
  nearbyOn: boolean;
  nfcOn: boolean;
  staffCode: string;
  onToggleBirthday: (value: boolean) => void;
  onToggleNearby: (value: boolean) => void;
  onToggleNfc: (value: boolean) => void;
  onStaffCodeChange: (value: string) => void;
}

interface ToggleRowProps {
  title: string;
  sub: string;
  value: boolean;
  onChange: (value: boolean) => void;
}

function ToggleRow({ title, sub, value, onChange }: ToggleRowProps) {
  return (
    <View style={styles.toggleRow}>
      <View style={styles.toggleText}>
        <Text style={styles.toggleTitle}>{title}</Text>
        <Text style={styles.toggleSub}>{sub}</Text>
      </View>
      <Switch
        value={value}
        onValueChange={onChange}
        trackColor={{ false: colors.surface2, true: colors.lavender }}
        thumbColor={value ? colors.darkText : colors.muted}
      />
    </View>
  );
}

export function ProgramScreen({
  businessName,
  reward,
  birthdayOn,
  nearbyOn,
  nfcOn,
  staffCode,
  onToggleBirthday,
  onToggleNearby,
  onToggleNfc,
  onStaffCodeChange,
}: ProgramScreenProps) {
  return (
    <View>
      <Text style={styles.title}>Program</Text>
      <Text style={styles.sub}>How {businessName} rewards regulars.</Text>

      <View style={[shared.card, styles.rewardCard]}>
        <Text style={styles.rewardLabel}>Reward rule</Text>
        <Text style={styles.rewardValue}>{reward}</Text>
        <Text style={[shared.cardMuted, styles.rewardSub]}>
          One rule, easy to explain at the counter. Change it in the next
          version of this screen.
        </Text>
      </View>

      <View style={[shared.card, styles.settingsCard]}>
        <ToggleRow
          title="Birthday reward"
          sub="A free treat lands on the card on their birthday."
          value={birthdayOn}
          onChange={onToggleBirthday}
        />
        <View style={styles.divider} />
        <ToggleRow
          title="Nearby nudge"
          sub="One nudge a day, only with a real offer."
          value={nearbyOn}
          onChange={onToggleNearby}
        />
        <View style={styles.divider} />
        <ToggleRow
          title="NFC tap"
          sub="Tap the counter tag to earn a stamp. Ships in V2."
          value={nfcOn}
          onChange={onToggleNfc}
        />
      </View>

      <View style={[shared.card, styles.staffCard]}>
        <Text style={shared.cardTitle}>Staff code</Text>
        <Text style={[shared.cardMuted, styles.staffSub]}>
          Staff use this 4 digit code to add stamps. Change it any time.
        </Text>
        <TextInput
          accessibilityLabel="Staff code"
          keyboardType="number-pad"
          maxLength={4}
          onChangeText={onStaffCodeChange}
          style={styles.codeInput}
          value={staffCode}
        />
      </View>

      <View style={[shared.card, styles.aboutCard]}>
        <Text style={shared.cardTitle}>About Stampy</Text>
        <Text style={styles.aboutText}>
          Stampy is provided by Fintex Australia Pty Ltd (ABN 60 688 406
          108), New South Wales, Australia. Contact: contact@fintex.au.
        </Text>
        <Text style={styles.aboutText}>
          Version 1.0.0 (1). Data is stored on this device for now. Server
          sync ships with the Wallet pass work.
        </Text>
        <TouchableOpacity accessibilityRole="button" activeOpacity={0.85} style={styles.linkButton}>
          <Text style={styles.linkButtonText}>Privacy policy</Text>
        </TouchableOpacity>
        <TouchableOpacity accessibilityRole="button" activeOpacity={0.85} style={styles.linkButton}>
          <Text style={styles.linkButtonText}>Support</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  aboutCard: {
    gap: 8,
    marginTop: spacing.gap,
  },
  aboutText: {
    color: colors.muted,
    fontSize: 15,
    fontWeight: "400",
    lineHeight: 22,
  },
  divider: {
    backgroundColor: colors.border,
    height: 1,
    marginVertical: 4,
  },
  linkButton: {
    alignItems: "center",
    backgroundColor: colors.surface2,
    borderRadius: spacing.radiusPill,
    justifyContent: "center",
    marginTop: 6,
    minHeight: spacing.touchMin,
  },
  linkButtonText: {
    color: colors.text,
    fontSize: 14,
    fontWeight: "600",
  },
  rewardCard: {
    marginTop: 18,
  },
  rewardLabel: {
    color: colors.muted,
    ...type.label,
  },
  rewardSub: {
    marginTop: 8,
  },
  rewardValue: {
    color: colors.text,
    fontSize: 24,
    fontWeight: "700",
    marginTop: 8,
  },
  settingsCard: {
    marginTop: spacing.gap,
  },
  staffCard: {
    marginTop: spacing.gap,
  },
  staffSub: {
    marginTop: 4,
  },
  codeInput: {
    backgroundColor: colors.surface2,
    borderRadius: spacing.radiusInner,
    color: colors.text,
    fontSize: 24,
    fontWeight: "700",
    letterSpacing: 8,
    marginTop: 12,
    minHeight: 56,
    paddingHorizontal: 16,
    textAlign: "center",
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
  toggleRow: {
    alignItems: "center",
    flexDirection: "row",
    gap: 12,
    paddingVertical: 10,
  },
  toggleSub: {
    color: colors.muted,
    fontSize: 12,
    fontWeight: "500",
    lineHeight: 18,
    marginTop: 2,
  },
  toggleText: {
    flex: 1,
  },
  toggleTitle: {
    color: colors.text,
    fontSize: 15,
    fontWeight: "600",
  },
});
