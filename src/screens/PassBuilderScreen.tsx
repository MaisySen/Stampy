import { useState } from "react";
import {
  ScrollView,
  Share,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { colors, shared, spacing, type } from "../theme";
import { BRAND_COLORS, COVERS, PassPreview, passSlug } from "../components/PassPreview";
import type { PassDraft } from "../components/PassPreview";

const STEPS = ["Details", "Design", "Links", "Preview"];
const MIN_TARGET = 4;
const MAX_TARGET = 12;

const DIFFERENTIATORS = [
  "Wallet pass",
  "NFC tap",
  "QR code",
  "Staff stamp",
  "Nearby nudge",
  "Birthday reward",
  "Analytics",
];

interface PassBuilderScreenProps {
  initialName: string;
  initialReward: string;
  onClose: () => void;
}

export function PassBuilderScreen({
  initialName,
  initialReward,
  onClose,
}: PassBuilderScreenProps) {
  const [step, setStep] = useState(0);
  const [published, setPublished] = useState(false);
  const [draft, setDraft] = useState<PassDraft>({
    businessName: initialName,
    reward: initialReward,
    target: 9,
    brandColor: BRAND_COLORS[0].value,
    cover: COVERS[0].name,
    photoUrl: "",
  });
  const [menuUrl, setMenuUrl] = useState("");
  const [wifiName, setWifiName] = useState("");
  const [wifiPassword, setWifiPassword] = useState("");
  const [feedbackUrl, setFeedbackUrl] = useState("");
  const [externalLabel, setExternalLabel] = useState("");
  const [externalUrl, setExternalUrl] = useState("");

  const slug = passSlug(draft.businessName);
  const shareLink = `https://stampy.app/p/${slug}`;

  function set<K extends keyof PassDraft>(key: K, value: PassDraft[K]) {
    setDraft((prev) => ({ ...prev, [key]: value }));
  }

  function clearAll() {
    setDraft({
      businessName: "",
      reward: "",
      target: 9,
      brandColor: BRAND_COLORS[0].value,
      cover: COVERS[0].name,
      photoUrl: "",
    });
    setMenuUrl("");
    setWifiName("");
    setWifiPassword("");
    setFeedbackUrl("");
    setExternalLabel("");
    setExternalUrl("");
    setStep(0);
    setPublished(false);
  }

  async function sharePass() {
    await Share.share({
      message: `Add my Stampy pass: ${shareLink}`,
    });
  }

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
        <Text style={styles.headerTitle}>Building your pass</Text>
        <TouchableOpacity
          accessibilityRole="button"
          activeOpacity={0.85}
          onPress={clearAll}
          style={styles.clearButton}
        >
          <Text style={styles.clearButtonText}>Clear</Text>
        </TouchableOpacity>
      </View>

      <View style={styles.steps}>
        {STEPS.map((label, i) => (
          <TouchableOpacity
            key={label}
            accessibilityRole="button"
            accessibilityState={{ selected: step === i }}
            activeOpacity={0.85}
            onPress={() => setStep(i)}
            style={styles.step}
          >
            <View
              style={[
                styles.stepDot,
                step === i && styles.stepDotActive,
                i < step && styles.stepDotDone,
              ]}
            >
              <Text style={[styles.stepDotText, step === i && styles.stepDotTextActive]}>
                {i + 1}
              </Text>
            </View>
            <Text style={[styles.stepLabel, step === i && styles.stepLabelActive]}>
              {label}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      <ScrollView
        contentContainerStyle={shared.scroll}
        showsVerticalScrollIndicator={false}
        style={shared.screen}
      >
        {step === 0 && (
          <View>
            <Text style={styles.title}>Business details</Text>
            <Text style={styles.sub}>
              Everything here is made by the business, and it can all be
              cleared or changed later.
            </Text>
            <Text style={styles.fieldLabel}>Business name</Text>
            <TextInput
              accessibilityLabel="Business name"
              onChangeText={(v) => set("businessName", v)}
              placeholder="Corner Cafe"
              placeholderTextColor={colors.faint}
              style={styles.input}
              value={draft.businessName}
            />
            <Text style={styles.fieldLabel}>Reward text</Text>
            <TextInput
              accessibilityLabel="Reward text"
              onChangeText={(v) => set("reward", v)}
              placeholder="Buy 8, get the 9th free"
              placeholderTextColor={colors.faint}
              style={styles.input}
              value={draft.reward}
            />
            <Text style={styles.fieldLabel}>Stamp target</Text>
            <View style={styles.stepper}>
              <TouchableOpacity
                accessibilityLabel="Fewer stamps"
                accessibilityRole="button"
                activeOpacity={0.85}
                disabled={draft.target <= MIN_TARGET}
                onPress={() => set("target", draft.target - 1)}
                style={[styles.stepperButton, draft.target <= MIN_TARGET && styles.stepperButtonDisabled]}
              >
                <Text style={styles.stepperButtonText}>-</Text>
              </TouchableOpacity>
              <Text style={styles.targetNumber}>{draft.target}</Text>
              <TouchableOpacity
                accessibilityLabel="More stamps"
                accessibilityRole="button"
                activeOpacity={0.85}
                disabled={draft.target >= MAX_TARGET}
                onPress={() => set("target", draft.target + 1)}
                style={[styles.stepperButton, draft.target >= MAX_TARGET && styles.stepperButtonDisabled]}
              >
                <Text style={styles.stepperButtonText}>+</Text>
              </TouchableOpacity>
            </View>
            <Text style={styles.hint}>
              9 is the default. Most cafes use 8 to 10.
            </Text>
          </View>
        )}

        {step === 1 && (
          <View>
            <Text style={styles.title}>Design</Text>
            <Text style={styles.sub}>
              Pick a brand colour and a cover. The preview updates as you go.
            </Text>
            <Text style={styles.fieldLabel}>Brand colour</Text>
            <View style={styles.swatches}>
              {BRAND_COLORS.map((c) => (
                <TouchableOpacity
                  key={c.name}
                  accessibilityLabel={c.name}
                  accessibilityRole="button"
                  accessibilityState={{ selected: draft.brandColor === c.value }}
                  activeOpacity={0.85}
                  onPress={() => set("brandColor", c.value)}
                  style={[
                    styles.swatch,
                    { backgroundColor: c.value },
                    draft.brandColor === c.value && styles.swatchActive,
                  ]}
                />
              ))}
            </View>
            <Text style={styles.fieldLabel}>Cover style</Text>
            {COVERS.map((c) => (
              <TouchableOpacity
                key={c.name}
                accessibilityRole="button"
                accessibilityState={{ selected: draft.cover === c.name }}
                activeOpacity={0.85}
                onPress={() => set("cover", c.name)}
                style={[styles.coverRow, draft.cover === c.name && styles.coverRowActive]}
              >
                <View style={styles.coverDots}>
                  {c.colors.map((col) => (
                    <View key={col} style={[styles.coverDot, { backgroundColor: col }]} />
                  ))}
                </View>
                <Text style={styles.coverName}>{c.name}</Text>
                {draft.cover === c.name && (
                  <Ionicons name="checkmark-circle" size={20} color={colors.green} />
                )}
              </TouchableOpacity>
            ))}
            <Text style={styles.fieldLabel}>Business photo URL, optional</Text>
            <TextInput
              accessibilityLabel="Business photo URL"
              autoCapitalize="none"
              onChangeText={(v) => set("photoUrl", v)}
              placeholder="https://example.com/photo.jpg"
              placeholderTextColor={colors.faint}
              style={styles.input}
              value={draft.photoUrl}
            />
            <Text style={styles.hint}>
              Leave it blank to use the cover style. The photo shows front
              and centre on the pass.
            </Text>
          </View>
        )}

        {step === 2 && (
          <View>
            <Text style={styles.title}>Links</Text>
            <Text style={styles.sub}>
              All optional. Leave a field blank and it stays off the pass.
            </Text>
            <Text style={styles.fieldLabel}>Menu link</Text>
            <TextInput
              accessibilityLabel="Menu link"
              autoCapitalize="none"
              onChangeText={setMenuUrl}
              placeholder="https://example.com/menu"
              placeholderTextColor={colors.faint}
              style={styles.input}
              value={menuUrl}
            />
            <Text style={styles.fieldLabel}>Wi-Fi network name</Text>
            <TextInput
              accessibilityLabel="Wi-Fi network name"
              autoCapitalize="none"
              onChangeText={setWifiName}
              placeholder="Corner Cafe Wi-Fi"
              placeholderTextColor={colors.faint}
              style={styles.input}
              value={wifiName}
            />
            <Text style={styles.fieldLabel}>Wi-Fi password</Text>
            <TextInput
              accessibilityLabel="Wi-Fi password"
              autoCapitalize="none"
              onChangeText={setWifiPassword}
              placeholder="Only if the network needs one"
              placeholderTextColor={colors.faint}
              secureTextEntry
              style={styles.input}
              value={wifiPassword}
            />
            <Text style={styles.fieldLabel}>Feedback link</Text>
            <TextInput
              accessibilityLabel="Feedback link"
              autoCapitalize="none"
              onChangeText={setFeedbackUrl}
              placeholder="https://example.com/feedback"
              placeholderTextColor={colors.faint}
              style={styles.input}
              value={feedbackUrl}
            />
            <Text style={styles.fieldLabel}>External link label</Text>
            <TextInput
              accessibilityLabel="External link label"
              onChangeText={setExternalLabel}
              placeholder="Book a table"
              placeholderTextColor={colors.faint}
              style={styles.input}
              value={externalLabel}
            />
            <Text style={styles.fieldLabel}>External link URL</Text>
            <TextInput
              accessibilityLabel="External link URL"
              autoCapitalize="none"
              onChangeText={setExternalUrl}
              placeholder="https://example.com/book"
              placeholderTextColor={colors.faint}
              style={styles.input}
              value={externalUrl}
            />
          </View>
        )}

        {step === 3 && (
          <View>
            <Text style={styles.title}>Preview and publish</Text>
            <Text style={styles.sub}>
              This is what the customer sees. Check it, edit it, then publish.
            </Text>
            <PassPreview draft={draft} stamps={0} />
            <View style={styles.chips}>
              {DIFFERENTIATORS.map((d) => (
                <View key={d} style={styles.chip}>
                  <Text style={styles.chipText}>{d}</Text>
                </View>
              ))}
            </View>
            <Text style={styles.hint}>
              Every pass includes these. No app download is needed to add it
              to Wallet.
            </Text>
            {published ? (
              <View style={[shared.card, styles.publishedCard]}>
                <View style={styles.publishedRow}>
                  <Ionicons name="checkmark-circle" size={28} color={colors.green} />
                  <View style={styles.publishedText}>
                    <Text style={shared.cardTitle}>Published</Text>
                    <Text style={shared.cardMuted}>{shareLink}</Text>
                  </View>
                </View>
                <TouchableOpacity
                  accessibilityRole="button"
                  activeOpacity={0.85}
                  onPress={sharePass}
                  style={styles.primaryButton}
                >
                  <Text style={styles.primaryButtonText}>Share the pass</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  accessibilityRole="button"
                  activeOpacity={0.85}
                  onPress={() => setStep(0)}
                  style={styles.secondaryButton}
                >
                  <Text style={styles.secondaryButtonText}>Edit pass</Text>
                </TouchableOpacity>
              </View>
            ) : (
              <TouchableOpacity
                accessibilityRole="button"
                activeOpacity={0.85}
                onPress={() => setPublished(true)}
                style={styles.primaryButton}
              >
                <Text style={styles.primaryButtonText}>Publish pass</Text>
              </TouchableOpacity>
            )}
          </View>
        )}

        {step < 3 && (
          <TouchableOpacity
            accessibilityRole="button"
            activeOpacity={0.85}
            onPress={() => setStep(step + 1)}
            style={styles.primaryButton}
          >
            <Text style={styles.primaryButtonText}>
              {step === 0 ? "Continue to Design" : step === 1 ? "Continue to Links" : "Continue to Preview"}
            </Text>
          </TouchableOpacity>
        )}
        {step > 0 && step < 3 && (
          <TouchableOpacity
            accessibilityRole="button"
            activeOpacity={0.85}
            onPress={() => setStep(step - 1)}
            style={styles.secondaryButton}
          >
            <Text style={styles.secondaryButtonText}>Back</Text>
          </TouchableOpacity>
        )}
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
  chip: {
    backgroundColor: colors.surface2,
    borderRadius: spacing.radiusPill,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  chipText: {
    color: colors.text,
    fontSize: 13,
    fontWeight: "600",
  },
  chips: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
    marginTop: 18,
  },
  clearButton: {
    alignItems: "center",
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: spacing.radiusPill,
    borderWidth: 1,
    justifyContent: "center",
    minHeight: 48,
    paddingHorizontal: 16,
  },
  clearButtonText: {
    color: colors.muted,
    fontSize: 14,
    fontWeight: "600",
  },
  coverDot: {
    borderRadius: 999,
    height: 14,
    width: 14,
  },
  coverDots: {
    flexDirection: "row",
    gap: 4,
  },
  coverName: {
    color: colors.text,
    flex: 1,
    fontSize: 15,
    fontWeight: "600",
  },
  coverRow: {
    alignItems: "center",
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: spacing.radiusInner,
    borderWidth: 1,
    flexDirection: "row",
    gap: 12,
    marginTop: 10,
    minHeight: 56,
    paddingHorizontal: 16,
  },
  coverRowActive: {
    borderColor: colors.lavender,
    borderWidth: 2,
  },
  fieldLabel: {
    color: colors.text,
    fontSize: 14,
    fontWeight: "600",
    marginTop: 18,
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
  hint: {
    color: colors.faint,
    marginTop: 10,
    ...type.caption,
    lineHeight: 18,
  },
  input: {
    backgroundColor: colors.surface2,
    borderRadius: spacing.radiusInner,
    color: colors.text,
    fontSize: 16,
    marginTop: 8,
    minHeight: 56,
    paddingHorizontal: 16,
  },
  primaryButton: {
    alignItems: "center",
    backgroundColor: colors.lavender,
    borderRadius: spacing.radiusPill,
    justifyContent: "center",
    marginTop: 18,
    minHeight: 56,
    paddingHorizontal: 24,
  },
  primaryButtonText: {
    color: colors.darkText,
    fontSize: 15,
    fontWeight: "700",
  },
  publishedCard: {
    marginTop: 18,
  },
  publishedRow: {
    alignItems: "center",
    flexDirection: "row",
    gap: 12,
  },
  publishedText: {
    flex: 1,
    gap: 4,
  },
  root: {
    backgroundColor: colors.background,
    flex: 1,
    paddingTop: 56,
  },
  secondaryButton: {
    alignItems: "center",
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: spacing.radiusPill,
    borderWidth: 1,
    justifyContent: "center",
    marginTop: 10,
    minHeight: 56,
    paddingHorizontal: 24,
  },
  secondaryButtonText: {
    color: colors.text,
    fontSize: 15,
    fontWeight: "600",
  },
  step: {
    alignItems: "center",
    flex: 1,
    gap: 6,
    justifyContent: "center",
    minHeight: spacing.touchMin,
  },
  stepDot: {
    alignItems: "center",
    backgroundColor: colors.surface2,
    borderRadius: 999,
    height: 32,
    justifyContent: "center",
    width: 32,
  },
  stepDotActive: {
    backgroundColor: colors.lavender,
  },
  stepDotDone: {
    backgroundColor: colors.surface,
    borderColor: colors.green,
    borderWidth: 1.5,
  },
  stepDotText: {
    color: colors.muted,
    fontSize: 13,
    fontWeight: "700",
  },
  stepDotTextActive: {
    color: colors.darkText,
  },
  stepLabel: {
    color: colors.faint,
    fontSize: 11,
    fontWeight: "600",
  },
  stepLabelActive: {
    color: colors.text,
  },
  stepper: {
    alignItems: "center",
    flexDirection: "row",
    gap: 20,
    marginTop: 12,
  },
  stepperButton: {
    alignItems: "center",
    backgroundColor: colors.surface2,
    borderRadius: 999,
    height: 56,
    justifyContent: "center",
    width: 56,
  },
  stepperButtonDisabled: {
    opacity: 0.4,
  },
  stepperButtonText: {
    color: colors.text,
    fontSize: 24,
    fontWeight: "600",
  },
  steps: {
    flexDirection: "row",
    paddingHorizontal: spacing.screen,
    paddingVertical: 18,
  },
  sub: {
    color: colors.muted,
    marginTop: 6,
    ...type.body,
  },
  swatch: {
    borderRadius: 999,
    height: 48,
    width: 48,
  },
  swatchActive: {
    borderColor: colors.white,
    borderWidth: 3,
  },
  swatches: {
    flexDirection: "row",
    gap: 12,
    marginTop: 12,
  },
  targetNumber: {
    color: colors.text,
    minWidth: 40,
    textAlign: "center",
    ...type.heroSmall,
  },
  title: {
    color: colors.text,
    ...type.title,
  },
});
