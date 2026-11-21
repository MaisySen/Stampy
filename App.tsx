import { useState } from "react";
import { Platform, ScrollView, StyleSheet, View } from "react-native";
import { StatusBar } from "expo-status-bar";
import { colors, shared } from "./src/theme";
import {
  DEMO_STAFF_CODE,
  STAMPS_TO_REWARD,
  demoBusiness,
  demoCustomers,
  emptyBusiness,
  emptyCustomers,
} from "./src/data";
import type { BusinessState, Customer, StampMethod } from "./src/data";
import { dayString } from "./src/lib/fraud";
import { passShareLink } from "./src/lib/pass";
import { BottomNav } from "./src/components/BottomNav";
import type { TabKey } from "./src/components/BottomNav";
import { WalletScreen } from "./src/screens/WalletScreen";
import { StampScreen } from "./src/screens/StampScreen";
import { AnalyticsScreen } from "./src/screens/AnalyticsScreen";
import { ProgramScreen } from "./src/screens/ProgramScreen";
import { PassBuilderScreen } from "./src/screens/PassBuilderScreen";
import { PassInstallScreen } from "./src/screens/PassInstallScreen";
import { LegalScreen } from "./src/screens/LegalScreen";
import type { LegalPage } from "./src/screens/LegalScreen";

export default function App() {
  const [tab, setTab] = useState<TabKey>("wallet");
  const [builderOpen, setBuilderOpen] = useState(false);
  const [installOpen, setInstallOpen] = useState(false);
  const [legalPage, setLegalPage] = useState<LegalPage | null>(null);
  const [stamps, setStamps] = useState(5);
  const [business, setBusiness] = useState<BusinessState>(demoBusiness);
  const [customers, setCustomers] = useState<Customer[]>(demoCustomers);
  const [lastStampAtMs, setLastStampAtMs] = useState<number | null>(null);
  const [lastStampDay, setLastStampDay] = useState<string | null>(null);
  const [birthdayOn, setBirthdayOn] = useState(true);
  const [nearbyOn, setNearbyOn] = useState(true);
  const [nfcOn, setNfcOn] = useState(false);
  const [staffCode, setStaffCode] = useState(DEMO_STAFF_CODE);

  function addStamp(method: StampMethod) {
    if (stamps >= STAMPS_TO_REWARD) {
      return;
    }
    const next = stamps + 1;
    setStamps(next);
    const now = new Date();
    setLastStampAtMs(now.getTime());
    setLastStampDay(dayString(now));
    setBusiness((prev) => ({
      ...prev,
      recent: [
        {
          id: `r-${Date.now()}`,
          customer: "You",
          method,
          time: "Just now",
        },
        ...prev.recent,
      ].slice(0, 5),
      split: { ...prev.split, [method]: prev.split[method] + 1 },
      stampsGiven: prev.stampsGiven + 1,
      visitors: prev.visitors,
    }));
  }

  function redeemReward() {
    setStamps(0);
    setTab("wallet");
  }

  function clearDemoData() {
    setBusiness(emptyBusiness);
    setCustomers(emptyCustomers);
    setLastStampAtMs(null);
    setLastStampDay(null);
  }

  function restoreDemoData() {
    setBusiness(demoBusiness);
    setCustomers(demoCustomers);
  }

  function changeStaffCode(value: string) {
    const digits = value.replace(/[^0-9]/g, "").slice(0, 4);
    setStaffCode(digits);
  }

  return (
    <View style={styles.root}>
      <StatusBar style="light" />
      {installOpen ? (
        <ScrollView
          contentContainerStyle={shared.scroll}
          showsVerticalScrollIndicator={false}
          style={shared.screen}
        >
          <PassInstallScreen
            businessName={business.name}
            reward={business.reward}
            stamps={stamps}
            target={STAMPS_TO_REWARD}
            platform={Platform.OS === "ios" ? "apple" : "google"}
            shareLink={passShareLink(business.name)}
            onClose={() => setInstallOpen(false)}
          />
        </ScrollView>
      ) : builderOpen ? (
        <PassBuilderScreen
          initialName={business.name}
          initialReward={business.reward}
          onClose={() => setBuilderOpen(false)}
        />
      ) : legalPage !== null ? (
        <LegalScreen page={legalPage} onClose={() => setLegalPage(null)} />
      ) : (
        <>
          <ScrollView
            contentContainerStyle={shared.scroll}
            showsVerticalScrollIndicator={false}
            style={shared.screen}
          >
        {tab === "wallet" && (
          <WalletScreen
            businessName={business.name}
            reward={business.reward}
            stamps={stamps}
            onRedeem={redeemReward}
            onGoToStamp={() => setTab("stamp")}
            onAddToWallet={() => setInstallOpen(true)}
          />
        )}
        {tab === "stamp" && (
          <StampScreen
            stamps={stamps}
            staffCode={staffCode}
            lastStampAtMs={lastStampAtMs}
            lastStampDay={lastStampDay}
            onStamp={addStamp}
          />
        )}
        {tab === "analytics" && (
          <AnalyticsScreen
            business={business}
            customers={customers}
            onClear={clearDemoData}
            onRestore={restoreDemoData}
          />
        )}
        {tab === "program" && (
          <ProgramScreen
            businessName={business.name}
            reward={business.reward}
            birthdayOn={birthdayOn}
            nearbyOn={nearbyOn}
            nfcOn={nfcOn}
            staffCode={staffCode}
            onToggleBirthday={setBirthdayOn}
            onToggleNearby={setNearbyOn}
            onToggleNfc={setNfcOn}
            onStaffCodeChange={changeStaffCode}
            onBuildPass={() => setBuilderOpen(true)}
            onOpenLegal={setLegalPage}
          />
        )}
          </ScrollView>
          <BottomNav active={tab} onSelect={setTab} />
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    backgroundColor: colors.background,
    flex: 1,
    paddingTop: 56,
  },
});
