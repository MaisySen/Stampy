import { useState } from "react";
import { ScrollView, StyleSheet, View } from "react-native";
import { StatusBar } from "expo-status-bar";
import { colors, shared } from "./src/theme";
import {
  DEMO_STAFF_CODE,
  STAMPS_TO_REWARD,
  demoBusiness,
  emptyBusiness,
} from "./src/data";
import type { BusinessState, StampMethod } from "./src/data";
import { BottomNav } from "./src/components/BottomNav";
import type { TabKey } from "./src/components/BottomNav";
import { WalletScreen } from "./src/screens/WalletScreen";
import { StampScreen } from "./src/screens/StampScreen";
import { AnalyticsScreen } from "./src/screens/AnalyticsScreen";
import { ProgramScreen } from "./src/screens/ProgramScreen";
import { PassBuilderScreen } from "./src/screens/PassBuilderScreen";

export default function App() {
  const [tab, setTab] = useState<TabKey>("wallet");
  const [builderOpen, setBuilderOpen] = useState(false);
  const [stamps, setStamps] = useState(5);
  const [business, setBusiness] = useState<BusinessState>(demoBusiness);
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
  }

  function restoreDemoData() {
    setBusiness(demoBusiness);
  }

  function changeStaffCode(value: string) {
    const digits = value.replace(/[^0-9]/g, "").slice(0, 4);
    setStaffCode(digits);
  }

  return (
    <View style={styles.root}>
      <StatusBar style="light" />
      {builderOpen ? (
        <PassBuilderScreen
          initialName={business.name}
          initialReward={business.reward}
          onClose={() => setBuilderOpen(false)}
        />
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
          />
        )}
        {tab === "stamp" && (
          <StampScreen stamps={stamps} staffCode={staffCode} onStamp={addStamp} />
        )}
        {tab === "analytics" && (
          <AnalyticsScreen
            business={business}
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
