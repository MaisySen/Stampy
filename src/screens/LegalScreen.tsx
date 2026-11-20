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
      body: "As little as possible. A card holds the business name, the reward, and the stamp count. A dashboard holds stamp counts and visit counts. No login is needed, and no account is created.",
    },
    {
      title: "Location",
      body: "A Wallet card only knows where the business is. The phone works out when the customer is nearby, on the device. Stampies does not track a customer live.",
    },
    {
      title: "Data on the device",
      body: "For now, data is stored on the device. A business can clear its demo data from the Analytics screen.",
    },
    {
      title: "Ads",
      body: "No ads are shown in Stampies.",
    },
  ],
  terms: [
    {
      title: "What Stampies is",
      body: "A digital loyalty card for small businesses. Add a card to Wallet, earn stamps at the counter, and redeem a reward when the card is full.",
    },
    {
      title: "Rules for customers",
      body: "One stamp per visit, one visit per day per business. Stamps cannot be sold or transferred. A reward is claimed at the counter.",
    },
    {
      title: "Rules for businesses",
      body: "A business sets its own reward, stamp target, and links. A business must not mislead customers about a reward, or add stamps for visits that did not happen.",
    },
    {
      title: "Fraud controls",
      body: "Staff stamps need a 4 digit staff code. A stamp is blocked during the 60 second cooldown, and after one stamp per day.",
    },
  ],
  support: [
    {
      title: "Contact",
      body: "Email contact@fintex.au. Include the business name, the phone model, and what happened.",
    },
    {
      title: "Stamp did not land",
      body: "One stamp per day per business, and 60 seconds between stamps. Wait, then try again. For a staff stamp, staff must enter the correct 4 digit staff code.",
    },
    {
      title: "Reward is not ready",
      body: "The card needs 9 stamps by default. The count shows on the Wallet card. A business can change the target when it builds its pass.",
    },
    {
      title: "Birthday treat did not arrive",
      body: "The treat lands on the birthday itself. It needs a birthday on the card.",
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
