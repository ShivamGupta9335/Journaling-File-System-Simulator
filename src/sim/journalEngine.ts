// Journaling File System Simulator — pure-TS engine
// Models a tiny FS with disk blocks + a journal area.
// Supports Writeback, Ordered (default, ext3-like), and Data journaling.

export type JournalMode = "writeback" | "ordered" | "data";

export type BlockKind = "free" | "metadata" | "data";

export interface DiskBlock {
  id: number;
  kind: BlockKind;
  // For metadata blocks: file name + pointer to data block id
  fileName?: string;
  dataBlockId?: number;
  // For data blocks: textual content
  content?: string;
  // Visual state
  state: "idle" | "writing" | "written" | "stale" | "corrupted";
}

export type TxState = "open" | "committed" | "checkpointed" | "lost";

export interface JournalRecord {
  type: "metadata" | "data";
  blockId: number;
  // Snapshot of intended block state
  snapshot: Partial<DiskBlock>;
}

export interface Transaction {
  id: number;
  op: string; // human description
  mode: JournalMode;
  records: JournalRecord[];
  state: TxState;
  // Tracks whether each phase has happened
  phases: {
    journalWritten: boolean; // records flushed to journal area
    committed: boolean; // commit record written
    dataWritten: boolean; // for ordered: data blocks flushed before commit
    checkpointed: boolean; // final blocks written to home location
  };
}

export interface FsFile {
  name: string;
  metadataBlockId: number;
  dataBlockId: number;
}

export interface LogEntry {
  t: number;
  level: "info" | "warn" | "error" | "ok" | "step";
  text: string;
}

export interface SimState {
  mode: JournalMode;
  blocks: DiskBlock[];
  files: FsFile[];
  transactions: Transaction[];
  log: LogEntry[];
  nextTxId: number;
  crashed: boolean;
  recovered: boolean;
  stepCounter: number;
}

export const DISK_SIZE = 16; // 16 blocks home area
export const JOURNAL_CAPACITY = 8; // visual capacity

export function createInitialState(mode: JournalMode = "ordered"): SimState {
  const blocks: DiskBlock[] = Array.from({ length: DISK_SIZE }, (_, i) => ({
    id: i,
    kind: "free",
    state: "idle",
  }));
  return {
    mode,
    blocks,
    files: [],
    transactions: [],
    log: [
      { t: Date.now(), level: "info", text: `[boot] Journal FS online — mode = ${mode.toUpperCase()}` },
      { t: Date.now(), level: "info", text: `[boot] disk: ${DISK_SIZE} blocks, journal: ${JOURNAL_CAPACITY} slots` },
    ],
    nextTxId: 1,
    crashed: false,
    recovered: false,
    stepCounter: 0,
  };
}

function pushLog(s: SimState, level: LogEntry["level"], text: string) {
  s.log = [...s.log, { t: Date.now() + s.stepCounter++, level, text }].slice(-200);
}

function findFreeBlock(s: SimState, kind: BlockKind): number {
  const idx = s.blocks.findIndex((b) => b.kind === "free");
  if (idx === -1) throw new Error("disk full");
  return idx;
}

// ---------- File operations (each is a transaction) ----------

export function opCreateFile(s: SimState, name: string, content: string): SimState {
  if (s.crashed) {
    pushLog(s, "error", `[fs] cannot write — system crashed. Run recovery.`);
    return { ...s };
  }
  if (s.files.some((f) => f.name === name)) {
    pushLog(s, "warn", `[fs] file '${name}' already exists`);
    return { ...s };
  }
  const next = structuredClone(s) as SimState;
  const metaId = findFreeBlock(next, "metadata");
  next.blocks[metaId] = { ...next.blocks[metaId], state: "writing" };
  const dataId = (() => {
    // pick a different free block
    const idx = next.blocks.findIndex((b, i) => b.kind === "free" && i !== metaId);
    if (idx === -1) throw new Error("disk full");
    return idx;
  })();
  next.blocks[dataId] = { ...next.blocks[dataId], state: "writing" };

  const tx: Transaction = {
    id: next.nextTxId++,
    op: `create '${name}'`,
    mode: next.mode,
    records: [
      {
        type: "metadata",
        blockId: metaId,
        snapshot: { kind: "metadata", fileName: name, dataBlockId: dataId },
      },
      {
        type: "data",
        blockId: dataId,
        snapshot: { kind: "data", content },
      },
    ],
    state: "open",
    phases: {
      journalWritten: false,
      committed: false,
      dataWritten: false,
      checkpointed: false,
    },
  };
  next.transactions = [...next.transactions, tx];
  pushLog(next, "step", `[tx#${tx.id}] BEGIN ${tx.op}`);
  return next;
}

export function opUpdateFile(s: SimState, name: string, content: string): SimState {
  if (s.crashed) {
    pushLog(s, "error", `[fs] cannot write — system crashed. Run recovery.`);
    return { ...s };
  }
  const f = s.files.find((x) => x.name === name);
  if (!f) {
    pushLog(s, "warn", `[fs] no such file '${name}'`);
    return { ...s };
  }
  const next = structuredClone(s) as SimState;
  next.blocks[f.dataBlockId] = { ...next.blocks[f.dataBlockId], state: "writing" };
  const tx: Transaction = {
    id: next.nextTxId++,
    op: `update '${name}'`,
    mode: next.mode,
    records: [
      {
        type: "data",
        blockId: f.dataBlockId,
        snapshot: { kind: "data", content },
      },
    ],
    state: "open",
    phases: {
      journalWritten: false,
      committed: false,
      dataWritten: false,
      checkpointed: false,
    },
  };
  next.transactions = [...next.transactions, tx];
  pushLog(next, "step", `[tx#${tx.id}] BEGIN ${tx.op}`);
  return next;
}

export function opDeleteFile(s: SimState, name: string): SimState {
  if (s.crashed) {
    pushLog(s, "error", `[fs] cannot write — system crashed. Run recovery.`);
    return { ...s };
  }
  const f = s.files.find((x) => x.name === name);
  if (!f) {
    pushLog(s, "warn", `[fs] no such file '${name}'`);
    return { ...s };
  }
  const next = structuredClone(s) as SimState;
  const tx: Transaction = {
    id: next.nextTxId++,
    op: `delete '${name}'`,
    mode: next.mode,
    records: [
      { type: "metadata", blockId: f.metadataBlockId, snapshot: { kind: "free", fileName: undefined, dataBlockId: undefined } },
      { type: "data", blockId: f.dataBlockId, snapshot: { kind: "free", content: undefined } },
    ],
    state: "open",
    phases: {
      journalWritten: false,
      committed: false,
      dataWritten: false,
      checkpointed: false,
    },
  };
  next.transactions = [...next.transactions, tx];
  pushLog(next, "step", `[tx#${tx.id}] BEGIN ${tx.op}`);
  return next;
}

// ---------- Transaction lifecycle (step-by-step) ----------

export function stepTx(s: SimState, txId: number): SimState {
  const next = structuredClone(s) as SimState;
  const tx = next.transactions.find((t) => t.id === txId);
  if (!tx) return next;
  if (tx.state === "checkpointed" || tx.state === "lost") return next;

  // Order depends on mode
  // - writeback: journal metadata -> commit -> (data may go anytime) -> checkpoint
  // - ordered:   write data first -> journal metadata -> commit -> checkpoint metadata
  // - data:      journal metadata + data -> commit -> checkpoint
  if (tx.mode === "writeback") {
    if (!tx.phases.journalWritten) {
      tx.phases.journalWritten = true;
      pushLog(next, "step", `[tx#${tx.id}] journal: wrote metadata records → JBD`);
      return next;
    }
    if (!tx.phases.committed) {
      tx.phases.committed = true;
      tx.state = "committed";
      pushLog(next, "ok", `[tx#${tx.id}] COMMIT (writeback) — data may not be on disk yet ⚠`);
      return next;
    }
    if (!tx.phases.dataWritten) {
      // Apply data blocks now
      for (const r of tx.records.filter((r) => r.type === "data")) {
        next.blocks[r.blockId] = { ...next.blocks[r.blockId], ...r.snapshot, state: "written" } as DiskBlock;
      }
      tx.phases.dataWritten = true;
      pushLog(next, "info", `[tx#${tx.id}] data blocks flushed (post-commit)`);
      return next;
    }
    if (!tx.phases.checkpointed) {
      for (const r of tx.records.filter((r) => r.type === "metadata")) {
        next.blocks[r.blockId] = { ...next.blocks[r.blockId], ...r.snapshot, state: "written" } as DiskBlock;
      }
      tx.phases.checkpointed = true;
      tx.state = "checkpointed";
      finalizeFiles(next, tx);
      pushLog(next, "ok", `[tx#${tx.id}] CHECKPOINT done — journal slot freed`);
      return next;
    }
  }

  if (tx.mode === "ordered") {
    if (!tx.phases.dataWritten) {
      for (const r of tx.records.filter((r) => r.type === "data")) {
        next.blocks[r.blockId] = { ...next.blocks[r.blockId], ...r.snapshot, state: "written" } as DiskBlock;
      }
      tx.phases.dataWritten = true;
      pushLog(next, "info", `[tx#${tx.id}] data blocks flushed BEFORE commit (ordered)`);
      return next;
    }
    if (!tx.phases.journalWritten) {
      tx.phases.journalWritten = true;
      pushLog(next, "step", `[tx#${tx.id}] journal: wrote metadata records → JBD`);
      return next;
    }
    if (!tx.phases.committed) {
      tx.phases.committed = true;
      tx.state = "committed";
      pushLog(next, "ok", `[tx#${tx.id}] COMMIT (ordered) — data is safe ✓`);
      return next;
    }
    if (!tx.phases.checkpointed) {
      for (const r of tx.records.filter((r) => r.type === "metadata")) {
        next.blocks[r.blockId] = { ...next.blocks[r.blockId], ...r.snapshot, state: "written" } as DiskBlock;
      }
      tx.phases.checkpointed = true;
      tx.state = "checkpointed";
      finalizeFiles(next, tx);
      pushLog(next, "ok", `[tx#${tx.id}] CHECKPOINT done`);
      return next;
    }
  }

  if (tx.mode === "data") {
    if (!tx.phases.journalWritten) {
      tx.phases.journalWritten = true;
      pushLog(next, "step", `[tx#${tx.id}] journal: wrote BOTH metadata + data → JBD`);
      return next;
    }
    if (!tx.phases.committed) {
      tx.phases.committed = true;
      tx.state = "committed";
      pushLog(next, "ok", `[tx#${tx.id}] COMMIT (data) — full atomicity ✓`);
      return next;
    }
    if (!tx.phases.checkpointed) {
      for (const r of tx.records) {
        next.blocks[r.blockId] = { ...next.blocks[r.blockId], ...r.snapshot, state: "written" } as DiskBlock;
      }
      tx.phases.dataWritten = true;
      tx.phases.checkpointed = true;
      tx.state = "checkpointed";
      finalizeFiles(next, tx);
      pushLog(next, "ok", `[tx#${tx.id}] CHECKPOINT done — journal slot freed`);
      return next;
    }
  }

  return next;
}

function finalizeFiles(s: SimState, tx: Transaction) {
  for (const r of tx.records.filter((r) => r.type === "metadata")) {
    const snap = r.snapshot;
    if (snap.kind === "metadata" && snap.fileName && snap.dataBlockId !== undefined) {
      // create or update
      const existing = s.files.find((f) => f.name === snap.fileName);
      if (!existing) {
        s.files.push({
          name: snap.fileName,
          metadataBlockId: r.blockId,
          dataBlockId: snap.dataBlockId,
        });
      }
    } else if (snap.kind === "free") {
      s.files = s.files.filter((f) => f.metadataBlockId !== r.blockId);
    }
  }
}

export function completeTx(s: SimState, txId: number): SimState {
  let next = s;
  for (let i = 0; i < 8; i++) {
    next = stepTx(next, txId);
    const tx = next.transactions.find((t) => t.id === txId);
    if (!tx || tx.state === "checkpointed" || tx.state === "lost") break;
  }
  return next;
}

// ---------- Crash + Recovery ----------

export function crash(s: SimState): SimState {
  const next = structuredClone(s) as SimState;
  next.crashed = true;
  next.recovered = false;
  pushLog(next, "error", `=== ✘ POWER LOSS — system crashed ===`);

  // Any "writing" block becomes corrupted (torn write)
  next.blocks = next.blocks.map((b) =>
    b.state === "writing" ? { ...b, state: "corrupted" } : b
  );

  // Open transactions are lost. Committed-but-not-checkpointed remain pending recovery.
  for (const tx of next.transactions) {
    if (tx.state === "open") {
      tx.state = "lost";
      pushLog(next, "warn", `[recover] tx#${tx.id} (${tx.op}) was OPEN — will be discarded`);
    } else if (tx.state === "committed") {
      pushLog(next, "info", `[recover] tx#${tx.id} (${tx.op}) was COMMITTED — replay candidate`);
    }
  }
  return next;
}

export function recover(s: SimState): SimState {
  if (!s.crashed) return s;
  const next = structuredClone(s) as SimState;
  pushLog(next, "step", `=== ⟳ RECOVERY: scanning journal ===`);

  // Heal corrupted blocks back to free for blocks belonging to lost txs
  next.blocks = next.blocks.map((b) => (b.state === "corrupted" ? { ...b, state: "idle", kind: "free", content: undefined, fileName: undefined, dataBlockId: undefined } : b));

  let replayed = 0;
  let discarded = 0;
  for (const tx of next.transactions) {
    if (tx.state === "lost") {
      discarded++;
      continue;
    }
    if (tx.state === "committed") {
      // Replay all journal records
      for (const r of tx.records) {
        next.blocks[r.blockId] = { ...next.blocks[r.blockId], ...r.snapshot, state: "written" } as DiskBlock;
      }
      finalizeFiles(next, tx);
      tx.phases.dataWritten = true;
      tx.phases.checkpointed = true;
      tx.state = "checkpointed";
      replayed++;
      pushLog(next, "ok", `[recover] replayed tx#${tx.id} from journal ✓`);
    }
  }

  next.crashed = false;
  next.recovered = true;
  pushLog(next, "ok", `=== ✓ RECOVERY done — replayed ${replayed}, discarded ${discarded} ===`);
  pushLog(next, "info", `[fs] file system consistent. journal cleared.`);
  return next;
}

export function reset(mode: JournalMode): SimState {
  return createInitialState(mode);
}

export function setMode(s: SimState, mode: JournalMode): SimState {
  const next = createInitialState(mode);
  pushLog(next, "info", `[fs] mode switched → ${mode.toUpperCase()} (disk reformatted)`);
  return next;
}
