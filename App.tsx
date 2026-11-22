import { useCallback, useEffect, useRef, useState } from "react";
import { Platform, ScrollView, StyleSheet, View } from "react-native";
import { StatusBar } from "expo-status-bar";
import { colors, shared } from "./src/theme";
import {
  DEMO_STAFF_CODE,
  demoBusiness,
  demoCustomers,
  emptyBusiness,
  emptyCustomers,
} from "./src/data";
import type { BusinessState, Customer, StampMethod } from "./src/data";
import { dayString } from "./src/lib/fraud";
import { passShareLink } from "./src/lib/pass";
import { createAsyncStorageQueueStore } from "./src/lib/offlineQueueStore";
import { StampQueueController, handOutboxByDestination } from "./src/lib/offlineQueueStartup";
import type { OfflineQueueStoreFactory, QueueState } from "./src/lib/offlineQueueStartup";
import { DEFAULT_PROGRAM, loadProgram, saveProgram } from "./src/lib/program";
import type { ProgramSettings } from "./src/lib/program";
import {
  LedgerPersister,
  applyStamp,
  cardStatus,
  emptyLedger,
  loadLedger,
  newEpoch,
  markHandedToQueue,
  redeem,
} from "./src/lib/ledger";
import type { LedgerState } from "./src/lib/ledger";
import { loadAsyncStorageBackend } from "./src/lib/storage";
import type { KeyValueBackend } from "./src/lib/storage";
import { createOfflineSyncDrain } from "./src/lib/offlineSync";
import { createStampSenderForOrigin } from "./src/lib/stampSender";
import { walletOrigin } from "./src/lib/walletConfig";
import type { OfflineSyncDrain, StampSender } from "./src/lib/offlineSync";
import { DemoBanner } from "./src/components/DemoBanner";
import type { DemoNotice } from "./src/components/DemoBanner";
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

export interface AppProps {
  /** Storage for program and progress. Defaults to AsyncStorage. Tests pass a synthetic one. */
  backend?: KeyValueBackend;
  /** Store for the offline stamp queue. Defaults to AsyncStorage. */
  queueStoreFactory?: OfflineQueueStoreFactory;
  /** Sender for queued stamps. Defaults to the configured Wallet origin, or a stub that keeps stamps queued. */
  createSender?: () => StampSender;
}

export default function App({ backend: backendProp, queueStoreFactory, createSender }: AppProps = {}) {
  const [tab, setTab] = useState<TabKey>("wallet");
  const [builderOpen, setBuilderOpen] = useState(false);
  const [installOpen, setInstallOpen] = useState(false);
  const [legalPage, setLegalPage] = useState<LegalPage | null>(null);
  const [program, setProgram] = useState<ProgramSettings>(DEFAULT_PROGRAM);
  const [ledger, setLedger] = useState<LedgerState>(emptyLedger);
  const [loaded, setLoaded] = useState(false);
  const [programProblem, setProgramProblem] = useState<string | null>(null);
  const [ledgerProblem, setLedgerProblem] = useState<string | null>(null);
  const [saveProblem, setSaveProblem] = useState<string | null>(null);
  const [handoffProblem, setHandoffProblem] = useState<string | null>(null);
  const [queueConflicts, setQueueConflicts] = useState(0);
  const [queueUnrouted, setQueueUnrouted] = useState(0);
  const [notice, setNotice] = useState<string | null>(null);
  const [queueState, setQueueState] = useState<QueueState>({ phase: "starting" });
  const [business, setBusiness] = useState<BusinessState>(demoBusiness);
  const [customers, setCustomers] = useState<Customer[]>(demoCustomers);
  const [birthdayOn, setBirthdayOn] = useState(true);
  const [nearbyOn, setNearbyOn] = useState(true);
  const [nfcOn, setNfcOn] = useState(false);
  const [staffCode, setStaffCode] = useState(DEMO_STAFF_CODE);

  // Program and progress load from storage at startup and are saved on
  // every change, so they survive a restart. A saved copy that cannot be
  // read is never overwritten: stamping is off until a good read or an
  // explicit reset, and the problem is shown on screen.
  //
  // The offline stamp queue starts through a controller. A stamp taken
  // before the queue is ready (or while it is memory-only) stays in the
  // ledger outbox, which is saved with the progress. Once the queue is
  // durable the outbox is handed over by id, and an outbox entry is
  // removed only after the queue write landed. The sync drain restarts
  // whenever the queue changes. Its sender comes from the Wallet origin
  // in app.json extra; unset, the stub keeps stamps queued and burns no
  // retry.
  const ledgerRef = useRef<LedgerState>(ledger);
  const programRef = useRef<ProgramSettings>(program);
  const backendRef = useRef<KeyValueBackend | null>(backendProp ?? null);
  const persisterRef = useRef<LedgerPersister | null>(null);
  const controllerRef = useRef<StampQueueController | null>(null);
  const syncRef = useRef<OfflineSyncDrain | null>(null);
  const drainedQueueRef = useRef<unknown>(null);
  if (controllerRef.current === null) {
    controllerRef.current = new StampQueueController(
      queueStoreFactory ?? createAsyncStorageQueueStore,
    );
  }

  const commitLedger = useCallback((next: LedgerState) => {
    ledgerRef.current = next;
    setLedger(next);
    const persister = persisterRef.current;
    if (persister !== null) {
      void persister.save(next).then(() => setSaveProblem(persister.lastError));
    }
  }, []);

  const handingRef = useRef(false);
  const rehandRef = useRef(false);

  const handOff = useCallback(async (): Promise<void> => {
    const controller = controllerRef.current;
    if (controller === null) {
      return;
    }
    if (handingRef.current) {
      // A handoff is running. Run once more when it ends, so a stamp that
      // arrived meanwhile is not left behind.
      rehandRef.current = true;
      return;
    }
    handingRef.current = true;
    try {
      do {
        rehandRef.current = false;
        const state = controller.state;
        if (state.phase !== "durable") {
          break;
        }
        const outbox = ledgerRef.current.outbox;
        if (outbox.length === 0) {
          setHandoffProblem(null);
          break;
        }
        const { handed, conflicts, unrouted } = handOutboxByDestination(state.queue, outbox);
        setQueueConflicts(conflicts.length);
        setQueueUnrouted(unrouted.length);
        if (handed.length === 0) {
          continue;
        }
        const flushed = await controller.flush();
        const stillActive =
          controller.state.phase === "durable" && controller.state.queue === state.queue;
        if (flushed && stillActive) {
          commitLedger(markHandedToQueue(ledgerRef.current, handed));
          setHandoffProblem(null);
        } else if (!stillActive) {
          // The queue changed while writing. Try again with the new one.
          rehandRef.current = true;
        } else {
          setHandoffProblem(
            "Could not write to the sync queue.",
          );
        }
      } while (rehandRef.current);
    } finally {
      handingRef.current = false;
    }
  }, [commitLedger]);

  const ensureBackend = useCallback(async (): Promise<KeyValueBackend | null> => {
    if (backendRef.current !== null) {
      return backendRef.current;
    }
    try {
      backendRef.current = await loadAsyncStorageBackend();
      return backendRef.current;
    } catch (error) {
      const message = error instanceof Error ? error.message : "Storage is not available.";
      setProgramProblem(`Saved program could not be read: ${message}`);
      setLedgerProblem(`Saved stamp progress could not be read: ${message}`);
      return null;
    }
  }, []);

  const loadProgramState = useCallback(async (backend: KeyValueBackend) => {
    const programLoad = await loadProgram(backend);
    programRef.current = programLoad.settings;
    setProgram(programLoad.settings);
    setProgramProblem(
      programLoad.status === "invalid" || programLoad.status === "error"
        ? `${programLoad.message} Showing the default program.`
        : null,
    );
  }, []);

  const loadLedgerState = useCallback(
    async (backend: KeyValueBackend) => {
      if (persisterRef.current === null) {
        persisterRef.current = new LedgerPersister(backend);
      }
      const persister = persisterRef.current;
      const ledgerLoad = await loadLedger(backend);
      if (ledgerLoad.status === "invalid" || ledgerLoad.status === "error") {
        persister.blockWrites(true);
        setLedgerProblem(
          `${ledgerLoad.message} Stamping is off so the saved copy is not overwritten.`,
        );
      } else {
        persister.blockWrites(false);
        setLedgerProblem(null);
      }
      ledgerRef.current = ledgerLoad.state;
      setLedger(ledgerLoad.state);
    },
    [],
  );

  const loadSaved = useCallback(async () => {
    const backend = await ensureBackend();
    if (backend === null) {
      setLoaded(true);
      return;
    }
    await Promise.all([loadProgramState(backend), loadLedgerState(backend)]);
    setLoaded(true);
    void handOff();
  }, [ensureBackend, loadProgramState, loadLedgerState, handOff]);

  // Retry for a program problem reads only the program. It never touches
  // stamp progress.
  const retryProgramLoad = useCallback(async () => {
    const backend = await ensureBackend();
    if (backend !== null) {
      await loadProgramState(backend);
    }
  }, [ensureBackend, loadProgramState]);

  // Retry for a progress problem. The progress notice only shows while
  // stamping is off (nothing unsaved in memory), so replacing memory with
  // the saved copy cannot discard a visit. Guarded anyway.
  const retryLedgerLoad = useCallback(async () => {
    if (ledgerRef.current.outbox.length > 0 || ledgerRef.current.progress > 0) {
      return;
    }
    const backend = await ensureBackend();
    if (backend !== null) {
      await loadLedgerState(backend);
      void handOff();
    }
  }, [ensureBackend, loadLedgerState, handOff]);

  useEffect(() => {
    void loadSaved();
  }, [loadSaved]);

  useEffect(() => {
    const controller = controllerRef.current;
    if (controller === null) {
      return;
    }
    let cancelled = false;
    const onState = (state: QueueState) => {
      if (cancelled) {
        return;
      }
      setQueueState(state);
      if (state.phase === "durable" && drainedQueueRef.current !== state.queue) {
        drainedQueueRef.current = state.queue;
        syncRef.current?.stop();
        const sender = createSender !== undefined
          ? createSender()
          : createStampSenderForOrigin(walletOrigin());
        const drain = createOfflineSyncDrain(state.queue, sender);
        syncRef.current = drain;
        drain.start();
      }
      if (state.phase === "durable") {
        void handOff();
      }
    };
    const unsubscribe = controller.subscribe(onState);
    void controller.start().then(() => onState(controller.state));
    return () => {
      cancelled = true;
      unsubscribe();
      syncRef.current?.stop();
      syncRef.current = null;
      drainedQueueRef.current = null;
    };
  }, [handOff, createSender]);

  const status = cardStatus(ledger, program);
  const stampingOff = !loaded || ledgerProblem !== null;
  const unavailableReason = !loaded
    ? "Loading saved stamp progress."
    : ledgerProblem;

  function addStamp(method: StampMethod) {
    if (stampingOff) {
      return;
    }
    const nowMs = Date.now();
    const result = applyStamp(ledgerRef.current, programRef.current, nowMs);
    if (result.outcome !== "stamped") {
      return;
    }
    commitLedger(result.state);
    setNotice(null);
    setBusiness((prev) => ({
      ...prev,
      recent: [
        {
          id: result.stampId,
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
    void handOff();
  }

  function redeemReward() {
    if (stampingOff) {
      return;
    }
    const result = redeem(ledgerRef.current, programRef.current, Date.now());
    if (result.outcome !== "redeemed") {
      return;
    }
    commitLedger(result.state);
    setNotice(
      `Free reward visit redeemed on this device (${result.redemptionId}). Local record only, not confirmed by any server.`,
    );
    setTab("wallet");
  }

  async function saveProgramSettings(
    input: ProgramSettings,
  ): Promise<{ ok: true } | { ok: false; errors: string[] }> {
    const backend = backendRef.current;
    if (backend === null) {
      return { ok: false, errors: ["Storage is not ready. Try again in a moment."] };
    }
    const result = await saveProgram(backend, input);
    if (!result.ok) {
      return { ok: false, errors: result.errors };
    }
    programRef.current = result.settings;
    setProgram(result.settings);
    setProgramProblem(null);
    return { ok: true };
  }

  function resetSavedProgress() {
    const persister = persisterRef.current;
    if (persister === null) {
      return;
    }
    persister.blockWrites(false);
    setLedgerProblem(null);
    commitLedger(emptyLedger(newEpoch()));
  }

  const notices: DemoNotice[] = [];
  if (programProblem !== null) {
    notices.push({
      id: "program",
      tone: "error",
      text: programProblem,
      actionLabel: "Retry load",
      onAction: () => void retryProgramLoad(),
    });
  }
  if (ledgerProblem !== null) {
    notices.push({
      id: "ledger",
      tone: "error",
      text: ledgerProblem,
      actionLabel: "Retry load",
      onAction: () => void retryLedgerLoad(),
    });
    notices.push({
      id: "ledger-reset",
      tone: "error",
      text: "Or start a new card. This replaces the saved progress on this device.",
      actionLabel: "Start new card",
      onAction: resetSavedProgress,
    });
  }
  const keptHere =
    saveProblem === null
      ? "Stamps stay saved in the progress record on this device."
      : "Progress is also not saved, so stamps are kept in this session only and would be lost on restart until Retry save works.";
  if (saveProblem !== null) {
    notices.push({
      id: "save",
      tone: "error",
      text: `Progress is not saved: ${saveProblem}`,
      actionLabel: "Retry save",
      onAction: () => {
        const persister = persisterRef.current;
        if (persister !== null) {
          void persister.retry().then(() => setSaveProblem(persister.lastError));
        }
      },
    });
  }
  if (queueState.phase === "memory-only") {
    notices.push({
      id: "queue",
      tone: "error",
      text: `Sync queue is memory-only this session (${queueState.reason}). ${keptHere}`,
      actionLabel: "Retry queue",
      onAction: () => void controllerRef.current?.retry(),
    });
  } else if (queueState.phase === "starting") {
    notices.push({
      id: "queue",
      tone: "info",
      text: `Sync queue is starting. ${keptHere}`,
    });
  }
  if (handoffProblem !== null) {
    notices.push({
      id: "handoff",
      tone: "error",
      text: `${handoffProblem} ${keptHere}`,
      actionLabel: "Retry handoff",
      onAction: () => void handOff(),
    });
  }
  if (queueConflicts > 0) {
    notices.push({
      id: "queue-conflict",
      tone: "error",
      text: `${queueConflicts} stamp(s) were not handed to the sync queue because the queue already holds a different stamp with the same id. ${keptHere} Nothing was removed from the outbox.`,
    });
  }
  if (queueUnrouted > 0) {
    notices.push({
      id: "queue-unrouted",
      tone: "error",
      text: `${queueUnrouted} stamp(s) saved by an older version have no recorded program, so they were not handed to the sync queue. ${keptHere} Nothing was removed from the outbox. They are not synced.`,
    });
  }
  if (ledger.outbox.length > 0 && queueState.phase === "durable") {
    notices.push({
      id: "outbox",
      tone: "info",
      text: `${ledger.outbox.length} stamp(s) waiting to move to the sync queue.`,
    });
  }
  if (notice !== null) {
    notices.push({ id: "notice", tone: "info", text: notice });
  }

  const lastStampAtMs = ledger.lastStampAtMs;
  const lastStampDay = lastStampAtMs === null ? null : dayString(new Date(lastStampAtMs));
  const view = { ...business, name: program.name, reward: program.reward };

  function clearDemoData() {
    setBusiness(emptyBusiness);
    setCustomers(emptyCustomers);
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
      <DemoBanner notices={notices} />
      {installOpen ? (
        <ScrollView
          contentContainerStyle={shared.scroll}
          showsVerticalScrollIndicator={false}
          style={shared.screen}
        >
          <PassInstallScreen
            businessName={view.name}
            reward={view.reward}
            stamps={status.shown}
            target={program.paidVisits}
            platform={Platform.OS === "ios" ? "apple" : "google"}
            shareLink={passShareLink(view.name)}
            onClose={() => setInstallOpen(false)}
          />
        </ScrollView>
      ) : builderOpen ? (
        <PassBuilderScreen
          initialName={program.name}
          initialReward={program.reward}
          initialPaidVisits={program.paidVisits}
          onSave={saveProgramSettings}
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
            businessName={view.name}
            reward={view.reward}
            stamps={status.progress}
            paidVisits={program.paidVisits}
            unavailableReason={unavailableReason}
            onRedeem={redeemReward}
            onGoToStamp={() => setTab("stamp")}
            onAddToWallet={() => setInstallOpen(true)}
          />
        )}
        {tab === "stamp" && (
          <StampScreen
            stamps={status.progress}
            paidVisits={program.paidVisits}
            unavailableReason={unavailableReason}
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
            businessName={view.name}
            reward={view.reward}
            paidVisits={program.paidVisits}
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
