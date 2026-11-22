import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { colors, shared, spacing, type } from "../theme";

export type LegalPage = "privacy" | "terms" | "support";

interface LegalScreenProps {
  page: LegalPage;
  onClose: () => void;
}

const TITLES: Record<LegalPage, string> = {
  privacy: "Privacy policy",
  terms: "Terms of use",
  support: "Support",
};

const SECTIONS: Record<LegalPage, Array<{ title: string; body: string }>> = {
  privacy: [
    {
      title: "What Stampies collects",
      body: "As little as possible. In this local demo, the business name, reward, paid visit count and stamp progress are saved on this device only, with synthetic sample data. No login is needed, and no account is created.",
    },
    {
      title: "Location",
      body: "This demo does not use your location. Planned design, not active: a Wallet card would only know where the business is, and the phone would work out on the device when the customer is nearby. Live tracking is not part of that design.",
    },
    {
      title: "Data on the device",
      body: "In this demo, data is stored on the device. Nothing is sent to a server. A business can clear its demo data from the Analytics screen.",
    },
    {
      title: "Ads",
      body: "No ads are shown in Stampies.",
    },
  ],
  terms: [
    {
      title: "What Stampies is",
      body: "A digital loyalty card for small businesses. This local demo previews the card, stamping and a local reward record. Adding a card to Wallet and server confirmed rewards are planned and not live.",
    },
    {
      title: "Rules for customers",
      body: "Planned rules: one stamp per paid visit, one stamp per day per business. Stamps cannot be sold or transferred. After the paid visits, the next visit is the free reward visit. In this demo, redemption is a local record on this device.",
    },
    {
      title: "Rules for businesses",
      body: "A business sets its own reward, paid visit count, and links. A business must not mislead customers about a reward, or add stamps for visits that did not happen.",
    },
    {
      title: "Fraud controls",
      body: "Demo checks on this device only, not enforced by a server: staff stamps need a 4 digit staff code, a stamp is blocked during the 60 second cooldown, and after one stamp per day.",
    },
  ],
  support: [
    {
      title: "Contact",
      body: "Email contact@fintex.au. Include the business name, the phone model, and what happened.",
    },
    {
      title: "Stamp did not land",
      body: "This demo allows one stamp per day and needs 60 seconds between stamps. Wait, then try again. For a staff stamp, staff must enter the correct 4 digit staff code.",
    },
    {
      title: "Reward is not ready",
      body: "The default is 8 paid visits, then the next visit is the free reward visit. The count shows on the Wallet card. A business can change the number of paid visits (3 to 11) in Build your pass.",
    },
    {
      title: "Birthday treat did not arrive",
      body: "Birthday treats are planned and not active in this demo.",
    },
  ],
};

export function LegalScreen({ page, onClose }: LegalScreenProps) {
  return (
    <View style={styles.root}>
      <View style={styles.header}>
        <TouchableOpacity
          accessibilityLabel="Back"
          accessibilityRole="button"
          activeOpacity={0.85}
          onPress={onClose}
          style={styles.backButton}
        >
          <Ionicons name="chevron-back" size={22} color={colors.text} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>{TITLES[page]}</Text>
        <View style={styles.backButtonSpacer} />
      </View>
      <ScrollView
        contentContainerStyle={shared.scroll}
        showsVerticalScrollIndicator={false}
        style={shared.screen}
      >
        <Text style={styles.updated}>Last updated: 2026-11-20.</Text>
        {SECTIONS[page].map((s) => (
          <View key={s.title} style={[shared.card, styles.sectionCard]}>
            <Text style={shared.cardTitle}>{s.title}</Text>
            <Text style={[shared.cardMuted, styles.sectionBody]}>{s.body}</Text>
          </View>
        ))}
        <View style={[shared.card, styles.legalCard]}>
          <Text style={shared.cardTitle}>Fintex Australia Pty Ltd</Text>
          <Text style={[shared.cardMuted, styles.sectionBody]}>
            Stampies is provided by Fintex Australia Pty Ltd (ABN 60 688 406
            108), New South Wales, Australia. Contact: contact@fintex.au.
            Website: https://fintex.au
          </Text>
          <Text style={[shared.cardMuted, styles.sectionBody]}>
            No login is needed, and no ads are shown. Support never asks for a
            password or a staff code by email.
          </Text>
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  backButton: {
    alignItems: "center",
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: 999,
    borderWidth: 1,
    height: 48,
    justifyContent: "center",
    width: 48,
  },
  backButtonSpacer: {
    height: 48,
    width: 48,
  },
  header: {
    alignItems: "center",
    flexDirection: "row",
    gap: 12,
    paddingHorizontal: spacing.screen,
    paddingTop: 8,
  },
  headerTitle: {
    color: colors.text,
    flex: 1,
    textAlign: "center",
    ...type.section,
  },
  legalCard: {
    gap: 8,
    marginTop: spacing.gap,
  },
  root: {
    backgroundColor: colors.background,
    flex: 1,
    paddingTop: 56,
  },
  sectionBody: {
    marginTop: 6,
  },
  sectionCard: {
    gap: 4,
    marginTop: spacing.gap,
  },
  updated: {
    color: colors.faint,
    ...type.caption,
  },
});
