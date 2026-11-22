/**
 * UI journey tests for the local/demo build. They render the real App with
 * synthetic in-memory storage and a stubbed react-native, so they run in plain
 * Node. They check behaviour and visible text. They are not a device test and
 * are not a visual check of layout.
 */
import test from "node:test";
import assert from "node:assert/strict";
import Module from "node:module";
import * as React from "react";

// Stub the native-only modules before the app loads.
function host(name: string) {
  return function Host(props: Record<string, unknown>) {
    return React.createElement(name, props, props.children as React.ReactNode);
  };
}
const rnStub: Record<string, unknown> = {
  StyleSheet: { create: (s: unknown) => s, flatten: (s: unknown) => s, hairlineWidth: 1 },
  Platform: { OS: "ios", select: (o: Record<string, unknown>) => o.ios ?? o.default },
  Share: { share: async () => ({ action: "sharedAction" }) },
  Alert: { alert: () => undefined },
  Linking: { openURL: async () => undefined },
};
for (const name of ["View", "Text", "TouchableOpacity", "ScrollView", "TextInput", "Image", "Switch", "Pressable"]) {
  rnStub[name] = host(name);
}
const stubs: Record<string, unknown> = {
  "react-native": rnStub,
  "@expo/vector-icons": { Ionicons: () => null },
  "expo-linear-gradient": { LinearGradient: host("LinearGradient") },
  "expo-status-bar": { StatusBar: () => null },
};
const mod = Module as unknown as {
  _load: (request: string, parent: unknown, isMain: boolean) => unknown;
};
const realLoad = mod._load;
mod._load = (request, parent, isMain) =>
  request in stubs ? stubs[request] : realLoad(request, parent, isMain);

// eslint-disable-next-line @typescript-eslint/no-require-imports
const TestRenderer = require("react-test-renderer") as typeof import("react-test-renderer");
// eslint-disable-next-line @typescript-eslint/no-require-imports
const App = (require("../App") as typeof import("../App")).default;
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { MemoryBackend } = require("../src/lib/storage") as typeof import("../src/lib/storage");
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { createPersistentOfflineQueueStore, OFFLINE_QUEUE_STORAGE_KEY } =
  require("../src/lib/offlineQueueStore") as typeof import("../src/lib/offlineQueueStore");
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { PROGRAM_STORAGE_KEY } = require("../src/lib/program") as typeof import("../src/lib/program");
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { LEDGER_STORAGE_KEY, destinationForCard, emptyLedger } = require("../src/lib/ledger") as typeof import("../src/lib/ledger");

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const { act } = TestRenderer;

type Renderer = ReturnType<typeof TestRenderer.create>;
type Instance = ReturnType<Renderer["root"]["findAll"]>[number];

async function settle() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 15));
  });
}

function textOf(node: unknown): string {
  if (typeof node === "string") return node;
  if (typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(textOf).join("");
  if (node !== null && typeof node === "object") {
    return textOf((node as { children?: unknown }).children);
  }
  return "";
}

function screenText(r: Renderer): string {
  return textOf(r.toJSON());
}

function pressables(r: Renderer): Instance[] {
  return r.root.findAll(
    (n) => typeof n.type === "string" && typeof n.props.onPress === "function" && n.props.disabled !== true,
  );
}

function instanceText(n: Instance): string {
  return n.children.map((c) => (typeof c === "string" ? c : instanceText(c as Instance))).join("");
}

async function press(r: Renderer, label: string) {
  const match = pressables(r).find(
    (n) => instanceText(n).includes(label) || n.props.accessibilityLabel === label,
  );
  assert.ok(match, `no enabled button containing "${label}" in: ${screenText(r)}`);
  await act(async () => {
    (match.props.onPress as () => void)();
    await new Promise((resolve) => setTimeout(resolve, 15));
  });
}

function hasButton(r: Renderer, label: string): boolean {
  return pressables(r).some(
    (n) => instanceText(n).includes(label) || n.props.accessibilityLabel === label,
  );
}

const noSend = () => async () => {
  throw new Error("not configured");
};

interface Harness {
  backend: InstanceType<typeof MemoryBackend>;
  queueBackend: InstanceType<typeof MemoryBackend>;
  mount(options?: { queueStore?: () => Promise<ReturnType<typeof createPersistentOfflineQueueStore>> }): Promise<Renderer>;
}

function harness(): Harness {
  const backend = new MemoryBackend();
  const queueBackend = new MemoryBackend();
  return {
    backend,
    queueBackend,
    async mount(options) {
      let renderer!: Renderer;
      await act(async () => {
        renderer = TestRenderer.create(
          React.createElement(App, {
            backend,
            queueStoreFactory:
              options?.queueStore ?? (async () => createPersistentOfflineQueueStore(queueBackend)),
            createSender: noSend,
          }),
        );
      });
      await settle();
      return renderer;
    },
  };
}

function seedProgram(backend: InstanceType<typeof MemoryBackend>, paidVisits: number) {
  backend.data.set(
    PROGRAM_STORAGE_KEY,
    JSON.stringify({ v: 1, settings: { name: "Synthetic Tea House", reward: "Free pot of tea", paidVisits } }),
  );
}

function seedProgress(backend: InstanceType<typeof MemoryBackend>, progress: number) {
  backend.data.set(LEDGER_STORAGE_KEY, JSON.stringify({ ...emptyLedger(), progress, nextSeq: progress + 1 }));
}

function savedLedger(backend: InstanceType<typeof MemoryBackend>) {
  return JSON.parse(backend.data.get(LEDGER_STORAGE_KEY) ?? "null");
}

function firstStampId(h: { backend: InstanceType<typeof MemoryBackend> }): string {
  return `stamp-${savedLedger(h.backend).epoch}-1`;
}

function queuedIds(queueBackend: InstanceType<typeof MemoryBackend>): string[] {
  const raw = queueBackend.data.get(OFFLINE_QUEUE_STORAGE_KEY);
  return raw === undefined ? [] : (JSON.parse(raw) as Array<{ id: string }>).map((s) => s.id);
}

test("first start is labelled local demo and uses the default 8 paid visits", async () => {
  const h = harness();
  const r = await h.mount();
  try {
    const text = screenText(r);
    assert.match(text, /LOCAL DEMO/);
    assert.match(text, /0 \/ 8 paid visits/);
    assert.match(text, /visit 9/);
    assert.match(text, /Local demo card, not a Wallet pass/);
  } finally {
    r.unmount();
  }
});

test("saved non-default program shows on Wallet, Stamp and Program screens", async () => {
  const h = harness();
  seedProgram(h.backend, 3);
  seedProgress(h.backend, 1);
  const r = await h.mount();
  try {
    assert.match(screenText(r), /Synthetic Tea House/);
    assert.match(screenText(r), /1 \/ 3 paid visits/);
    assert.match(screenText(r), /Free pot of tea/);
    await press(r, "Stamp");
    assert.match(screenText(r), /3 paid visits/);
    await press(r, "Program");
    assert.match(screenText(r), /3 paid visits, then visit 4/);
  } finally {
    r.unmount();
  }
});

test("reach threshold, redeem only when eligible, and keep it after restart", async () => {
  const h = harness();
  seedProgram(h.backend, 3);
  seedProgress(h.backend, 2);
  let r = await h.mount();
  try {
    assert.equal(hasButton(r, "Redeem locally"), false);
    await press(r, "Stamp");
    await press(r, "Scan");
    await press(r, "Demo only: add a stamp without scanning");
    assert.equal(savedLedger(h.backend).progress, 3);
    await press(r, "Wallet");
    assert.match(screenText(r), /free reward visit is ready/);
    assert.equal(hasButton(r, "Redeem locally"), true);
  } finally {
    r.unmount();
  }
  // Restart: a new App over the same storage.
  r = await h.mount();
  try {
    assert.match(screenText(r), /3 \/ 3 paid visits/);
    assert.equal(hasButton(r, "Redeem locally"), true);
    await press(r, "Redeem locally");
    assert.match(screenText(r), /local record only|Local record only/);
    assert.equal(savedLedger(h.backend).progress, 0);
    assert.equal(savedLedger(h.backend).redemptions.length, 1);
    assert.equal(hasButton(r, "Redeem locally"), false);
  } finally {
    r.unmount();
  }
  r = await h.mount();
  try {
    assert.match(screenText(r), /0 \/ 3 paid visits/);
    assert.equal(savedLedger(h.backend).redemptions.length, 1);
  } finally {
    r.unmount();
  }
});

test("program edit is saved and reopened, and bad input shows errors without saving", async () => {
  const h = harness();
  let r = await h.mount();
  try {
    await press(r, "Program");
    await press(r, "Start building");
    const inputs = r.root.findAll((n) => n.type === "TextInput");
    assert.ok(inputs.length >= 2);
    await act(async () => {
      (inputs[0].props.onChangeText as (v: string) => void)("Synthetic Bakery");
      (inputs[1].props.onChangeText as (v: string) => void)("Free croissant");
    });
    for (let i = 0; i < 3; i++) {
      await press(r, "Fewer paid visits");
    }
    assert.match(screenText(r), /Not saved yet/);
    await press(r, "Save program");
    const saved = JSON.parse(h.backend.data.get(PROGRAM_STORAGE_KEY) ?? "null");
    assert.deepEqual(saved.settings, { name: "Synthetic Bakery", reward: "Free croissant", paidVisits: 5 });
    assert.match(screenText(r), /Saved on this device/);
    // Empty name is refused and the saved copy stays.
    await act(async () => {
      (inputs[0].props.onChangeText as (v: string) => void)("   ");
    });
    await press(r, "Save program");
    assert.match(screenText(r), /name/i);
    const after = JSON.parse(h.backend.data.get(PROGRAM_STORAGE_KEY) ?? "null");
    assert.equal(after.settings.name, "Synthetic Bakery");
  } finally {
    r.unmount();
  }
  r = await h.mount();
  try {
    assert.match(screenText(r), /Synthetic Bakery/);
    assert.match(screenText(r), /0 \/ 5 paid visits/);
  } finally {
    r.unmount();
  }
});

test("invalid saved program is shown and defaults are used", async () => {
  const h = harness();
  h.backend.data.set(
    PROGRAM_STORAGE_KEY,
    JSON.stringify({ v: 1, settings: { name: "X", reward: "Y", paidVisits: 40 } }),
  );
  const r = await h.mount();
  try {
    assert.match(screenText(r), /Saved program is not valid/);
    assert.match(screenText(r), /0 \/ 8 paid visits/);
  } finally {
    r.unmount();
  }
});

test("unreadable saved progress turns stamping off and is never overwritten", async () => {
  const h = harness();
  const corrupt = "{not json";
  h.backend.data.set(LEDGER_STORAGE_KEY, corrupt);
  const r = await h.mount();
  try {
    assert.match(screenText(r), /Stamping is off/);
    await press(r, "Stamp");
    assert.match(screenText(r), /Stamping is off/);
    assert.equal(hasButton(r, "Demo only: add a stamp without scanning"), false);
    assert.equal(h.backend.data.get(LEDGER_STORAGE_KEY), corrupt);
    // Explicit reset is the only way forward.
    await press(r, "Start new card");
    assert.equal(savedLedger(h.backend).progress, 0);
  } finally {
    r.unmount();
  }
});

test("storage read failure is shown", async () => {
  const h = harness();
  h.backend.failReads = true;
  const r = await h.mount();
  try {
    assert.match(screenText(r), /Storage read failed/);
    assert.match(screenText(r), /Stamping is off/);
  } finally {
    r.unmount();
  }
});

test("storage write failure is shown, stamp stays on screen, retry saves it", async () => {
  const h = harness();
  seedProgress(h.backend, 0);
  const r = await h.mount();
  try {
    h.backend.failWrites = true;
    await press(r, "Stamp");
    await press(r, "Scan");
    await press(r, "Demo only: add a stamp without scanning");
    assert.match(screenText(r), /Progress is not saved/);
    assert.equal(savedLedger(h.backend).progress, 0);
    h.backend.failWrites = false;
    await press(r, "Retry save");
    assert.doesNotMatch(screenText(r), /Progress is not saved/);
    assert.equal(savedLedger(h.backend).progress, 1);
  } finally {
    r.unmount();
  }
});

test("a stamp taken before the queue is ready reaches the queue once", async () => {
  const h = harness();
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const r = await h.mount({
    queueStore: async () => {
      await gate;
      return createPersistentOfflineQueueStore(h.queueBackend);
    },
  });
  try {
    assert.match(screenText(r), /Sync queue is starting/);
    await press(r, "Stamp");
    await press(r, "Scan");
    await press(r, "Demo only: add a stamp without scanning");
    assert.equal(savedLedger(h.backend).progress, 1);
    assert.equal(savedLedger(h.backend).outbox.length, 1);
    assert.deepEqual(queuedIds(h.queueBackend), []);
    await act(async () => {
      release();
      await new Promise((resolve) => setTimeout(resolve, 30));
    });
    await settle();
    assert.deepEqual(queuedIds(h.queueBackend), [firstStampId(h)]);
    assert.equal(savedLedger(h.backend).outbox.length, 0);
    assert.equal(savedLedger(h.backend).progress, 1);
  } finally {
    r.unmount();
  }
});

test("queue start failure falls back, retry hands stamps over once, restart does not duplicate", async () => {
  const h = harness();
  let fail = true;
  const factory = async () => {
    if (fail) throw new Error("Queue storage unavailable.");
    return createPersistentOfflineQueueStore(h.queueBackend);
  };
  let r = await h.mount({ queueStore: factory });
  try {
    assert.match(screenText(r), /memory-only/);
    await press(r, "Stamp");
    await press(r, "Scan");
    await press(r, "Demo only: add a stamp without scanning");
    assert.equal(savedLedger(h.backend).outbox.length, 1);
    fail = false;
    await press(r, "Retry queue");
    await settle();
    assert.deepEqual(queuedIds(h.queueBackend), [firstStampId(h)]);
    assert.doesNotMatch(screenText(r), /memory-only/);
    assert.equal(savedLedger(h.backend).outbox.length, 0);
  } finally {
    r.unmount();
  }
  r = await h.mount({ queueStore: factory });
  try {
    await settle();
    assert.deepEqual(queuedIds(h.queueBackend), [firstStampId(h)]);
    assert.equal(savedLedger(h.backend).progress, 1);
  } finally {
    r.unmount();
  }
});

test("Wallet preview and local redemption are not presented as issued or confirmed", async () => {
  const h = harness();
  seedProgram(h.backend, 3);
  seedProgress(h.backend, 3);
  const r = await h.mount();
  try {
    assert.match(screenText(r), /Preview Wallet pass \(not issued\)/);
    await press(r, "Preview Wallet pass");
    assert.match(screenText(r), /No pass was issued/);
    await press(r, "Preview Apple Wallet pass");
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 1300));
    });
    const text = screenText(r);
    assert.match(text, /Preview ready\. Not added to/);
    assert.match(text, /not published/i);
    assert.doesNotMatch(text, /Added to (Apple|Google) Wallet\b/);
  } finally {
    r.unmount();
  }
});

test("stamp cooldown and one-per-day are enforced on this device and survive a restart", async () => {
  const h = harness();
  seedProgram(h.backend, 5);
  let r = await h.mount();
  try {
    await press(r, "Stamp");
    await press(r, "Scan");
    await press(r, "Demo only: add a stamp without scanning");
    assert.equal(savedLedger(h.backend).progress, 1);
  } finally {
    r.unmount();
  }
  // Restart, then try again at once: blocked, progress unchanged.
  r = await h.mount();
  try {
    await press(r, "Stamp");
    await press(r, "Scan");
    await press(r, "Demo only: add a stamp without scanning");
    assert.match(screenText(r), /Stamp blocked/);
    assert.match(screenText(r), /Not enforced by a server/);
    assert.equal(savedLedger(h.backend).progress, 1);
  } finally {
    r.unmount();
  }
});

test("unsupported claims are qualified: no location use, demo-only checks", async () => {
  const h = harness();
  const r = await h.mount();
  try {
    const wallet = screenText(r);
    assert.match(wallet, /does not use your location/);
    assert.match(wallet, /Nearby nudge preview \(not active\)/);
    assert.doesNotMatch(wallet, /does not track you live/);
    await press(r, "Stamp");
    assert.match(screenText(r), /Demo checks run on this device only/);
  } finally {
    r.unmount();
  }
});

async function stampOnce(r: Renderer) {
  await press(r, "Stamp");
  await press(r, "Scan");
  await press(r, "Demo only: add a stamp without scanning");
}

test("a failed queue write keeps the outbox, shows a retry, and recovers with no new stamp", async () => {
  const h = harness();
  const r = await h.mount();
  try {
    h.queueBackend.failWrites = true;
    await stampOnce(r);
    assert.match(screenText(r), /Could not write to the sync queue/);
    assert.equal(savedLedger(h.backend).outbox.length, 1);
    h.queueBackend.failWrites = false;
    await press(r, "Retry handoff");
    await settle();
    assert.deepEqual(queuedIds(h.queueBackend), [firstStampId(h)]);
    assert.equal(savedLedger(h.backend).outbox.length, 0);
    assert.doesNotMatch(screenText(r), /Could not write to the sync queue/);
  } finally {
    r.unmount();
  }
});

test("retrying a program load never discards an unsaved visit", async () => {
  const h = harness();
  h.backend.data.set(
    PROGRAM_STORAGE_KEY,
    JSON.stringify({ v: 1, settings: { name: "X", reward: "Y", paidVisits: 40 } }),
  );
  const r = await h.mount();
  try {
    h.backend.failWrites = true;
    await stampOnce(r);
    assert.match(screenText(r), /Progress is not saved/);
    await press(r, "Retry load");
    assert.match(screenText(r), /Progress is not saved/);
    assert.match(screenText(r), /1 of 8 paid visits/);
    h.backend.failWrites = false;
    await press(r, "Retry save");
    assert.equal(savedLedger(h.backend).progress, 1);
  } finally {
    r.unmount();
  }
});

test("starting a new card after unreadable progress cannot collide with a queued older stamp", async () => {
  const h = harness();
  h.backend.data.set(LEDGER_STORAGE_KEY, "{not json");
  h.queueBackend.data.set(
    OFFLINE_QUEUE_STORAGE_KEY,
    JSON.stringify([{ id: "stamp-e0-1", passId: "old", businessId: "old", createdAtMs: 1, attempts: 0 }]),
  );
  const r = await h.mount();
  try {
    await press(r, "Start new card");
    await stampOnce(r);
    const epoch = savedLedger(h.backend).epoch as string;
    assert.notEqual(epoch, "e0");
    await settle();
    assert.deepEqual(queuedIds(h.queueBackend), ["stamp-e0-1", `stamp-${epoch}-1`]);
    assert.equal(savedLedger(h.backend).outbox.length, 0);
  } finally {
    r.unmount();
  }
});

test("legal pages no longer state live Wallet, location or 9 stamp claims", async () => {
  const h = harness();
  const r = await h.mount();
  try {
    await press(r, "Program");
    await press(r, "Privacy policy");
    let text = screenText(r);
    assert.match(text, /does not use your location/);
    assert.match(text, /Planned design, not active/);
    assert.doesNotMatch(text, /does not track a customer live/);
    await press(r, "Back");
    await press(r, "Terms of use");
    text = screenText(r);
    assert.match(text, /not enforced by a server/);
    assert.match(text, /planned and not live/);
    await press(r, "Back");
    await press(r, "Support");
    text = screenText(r);
    assert.match(text, /8 paid visits, then the next visit is the free reward visit/);
    assert.doesNotMatch(text, /9 stamps/);
  } finally {
    r.unmount();
  }
});

function queuedRecords(queueBackend: InstanceType<typeof MemoryBackend>) {
  const raw = queueBackend.data.get(OFFLINE_QUEUE_STORAGE_KEY);
  return raw === undefined
    ? []
    : (JSON.parse(raw) as Array<{ id: string; passId: string; businessId: string }>);
}

async function stampWhileQueueNotReady(h: Harness) {
  const r = await h.mount({
    queueStore: async () => {
      throw new Error("Queue storage unavailable.");
    },
  });
  try {
    await stampOnce(r);
  } finally {
    r.unmount();
  }
}

function renameProgram(h: Harness, name: string) {
  const saved = JSON.parse(h.backend.data.get(PROGRAM_STORAGE_KEY) ?? "null");
  h.backend.data.set(
    PROGRAM_STORAGE_KEY,
    JSON.stringify({ v: 1, settings: { ...saved.settings, name } }),
  );
}

test("a visit stamped while the queue was not ready keeps its program after a rename and restart", async () => {
  const h = harness();
  seedProgram(h.backend, 8);
  await stampWhileQueueNotReady(h);
  const before = savedLedger(h.backend);
  assert.equal(before.outbox.length, 1);
  renameProgram(h, "Synthetic Renamed Cafe");
  const r = await h.mount();
  try {
    await settle();
    assert.match(screenText(r), /Synthetic Renamed Cafe/);
    const records = queuedRecords(h.queueBackend);
    assert.equal(records.length, 1);
    const want = destinationForCard(before.epoch);
    assert.equal(records[0].businessId, want.businessId);
    assert.equal(records[0].passId, want.passId);
    assert.doesNotMatch(records[0].businessId, /renamed|tea/i);
    assert.equal(savedLedger(h.backend).outbox.length, 0);
  } finally {
    r.unmount();
  }
});

test("a valid non-Latin program name queues a readable record that survives restart", async () => {
  const h = harness();
  h.backend.data.set(
    PROGRAM_STORAGE_KEY,
    JSON.stringify({ v: 1, settings: { name: "\u8336\u5C4B \u2615", reward: "Free tea", paidVisits: 8 } }),
  );
  const r = await h.mount();
  try {
    await stampOnce(r);
    await settle();
  } finally {
    r.unmount();
  }
  const records = queuedRecords(h.queueBackend);
  assert.equal(records.length, 1);
  assert.ok(records[0].businessId.length > 0 && records[0].passId.length > 0);
  const r2 = await h.mount();
  try {
    assert.doesNotMatch(screenText(r2), /cannot read/);
    assert.equal(queuedRecords(h.queueBackend).length, 1);
    await stampOnce(r2);
    await settle();
    assert.equal(queuedRecords(h.queueBackend).length, 1, "cooldown still applies, queue unchanged");
  } finally {
    r2.unmount();
  }
});

test("a stamp saved by an older version without a program is kept, shown, and never given a guessed one", async () => {
  const h = harness();
  seedProgram(h.backend, 8);
  h.backend.data.set(
    LEDGER_STORAGE_KEY,
    JSON.stringify({
      ...emptyLedger(),
      progress: 1,
      nextSeq: 2,
      outbox: [{ id: "stamp-e0-1", createdAtMs: 1 }],
      appliedIds: ["stamp-e0-1"],
    }),
  );
  const r = await h.mount();
  try {
    await settle();
    assert.match(screenText(r), /no recorded program/);
    assert.deepEqual(queuedIds(h.queueBackend), []);
    assert.equal(savedLedger(h.backend).outbox.length, 1);
    assert.equal(savedLedger(h.backend).outbox[0].destination, undefined);
  } finally {
    r.unmount();
  }
});

test("when the ledger write and the queue write both fail, no notice promises the stamp is saved or survives restart", async () => {
  const h = harness();
  const r = await h.mount();
  try {
    h.queueBackend.failWrites = true;
    h.backend.failWrites = true;
    await stampOnce(r);
    await settle();
    const text = screenText(r);
    assert.match(text, /Could not write to the sync queue/);
    assert.match(text, /Progress is not saved/);
    assert.match(text, /this session only/);
    assert.doesNotMatch(text, /nothing is lost/i);
    assert.doesNotMatch(text, /does not confirm/);
    assert.ok(hasButton(r, "Retry handoff"));
    assert.ok(hasButton(r, "Retry save"));
    h.backend.failWrites = false;
    await press(r, "Retry save");
    await settle();
    assert.equal(savedLedger(h.backend).progress, 1);
    assert.equal(savedLedger(h.backend).outbox.length, 1);
    assert.doesNotMatch(screenText(r), /this session only/);
    assert.doesNotMatch(screenText(r), /Progress is not saved/);
    h.queueBackend.failWrites = false;
    await press(r, "Retry handoff");
    await settle();
    assert.deepEqual(queuedIds(h.queueBackend), [firstStampId(h)]);
    assert.equal(savedLedger(h.backend).outbox.length, 0);
  } finally {
    r.unmount();
  }
});

test("while the progress write is still pending, no notice claims the stamp is saved", async () => {
  const h = harness();
  const r = await h.mount();
  try {
    const original = h.backend.setItem.bind(h.backend);
    h.backend.setItem = (key: string, value: string) =>
      key === LEDGER_STORAGE_KEY ? new Promise<void>(() => {}) : original(key, value);
    h.queueBackend.failWrites = true;
    await stampOnce(r);
    await settle();
    const text = screenText(r);
    assert.match(text, /Could not write to the sync queue/);
    assert.match(text, /does not confirm/);
    assert.doesNotMatch(text, /nothing is lost/i);
    assert.doesNotMatch(text, /stay saved/i);
    assert.doesNotMatch(text, /survive/i);
    assert.equal(savedLedger(h.backend), null);
  } finally {
    r.unmount();
  }
});
