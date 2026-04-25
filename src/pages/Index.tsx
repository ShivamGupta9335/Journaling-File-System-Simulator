import { useCallback, useMemo, useState } from "react";
import {
  JOURNAL_CAPACITY,
  JournalMode,
  SimState,
  completeTx,
  crash,
  createInitialState,
  opCreateFile,
  opDeleteFile,
  opUpdateFile,
  recover,
  reset,
  setMode,
  stepTx,
} from "@/sim/journalEngine";
import { DiskGrid } from "@/components/sim/DiskGrid";
import { JournalView } from "@/components/sim/JournalView";
import { LogConsole } from "@/components/sim/LogConsole";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

const modeInfo: Record<JournalMode, { title: string; blurb: string }> = {
  writeback: {
    title: "Writeback",
    blurb: "Only metadata is journaled. Data may hit disk after commit. Fastest, but stale data possible after crash.",
  },
  ordered: {
    title: "Ordered",
    blurb: "Data is flushed BEFORE the metadata commit. Default in ext3/ext4 — strong guarantees with low overhead.",
  },
  data: {
    title: "Data",
    blurb: "Both metadata AND data go through the journal. Strongest consistency, highest write cost.",
  },
};

const Index = () => {
  const [state, setState] = useState<SimState>(() => createInitialState("ordered"));
  const [fileName, setFileName] = useState("notes.txt");
  const [content, setContent] = useState("hello, journal!");

  const apply = useCallback((fn: (s: SimState) => SimState) => {
    setState((s) => fn(s));
  }, []);

  const onCreate = () => apply((s) => opCreateFile(s, fileName.trim() || "untitled", content));
  const onUpdate = () => apply((s) => opUpdateFile(s, fileName.trim(), content));
  const onDelete = () => apply((s) => opDeleteFile(s, fileName.trim()));
  const onCrash = () => apply(crash);
  const onRecover = () => apply(recover);
  const onReset = () => apply((s) => reset(s.mode));
  const onSetMode = (m: JournalMode) => apply((s) => setMode(s, m));
  const onStep = (id: number) => apply((s) => stepTx(s, id));
  const onComplete = (id: number) => apply((s) => completeTx(s, id));

  const onAutoFlush = () =>
    apply((s) => {
      let next = s;
      for (const tx of [...next.transactions]) {
        if (tx.state !== "checkpointed" && tx.state !== "lost") {
          next = completeTx(next, tx.id);
        }
      }
      return next;
    });

  const stats = useMemo(() => {
    const used = state.blocks.filter((b) => b.kind !== "free").length;
    const corrupted = state.blocks.filter((b) => b.state === "corrupted").length;
    const open = state.transactions.filter((t) => t.state === "open").length;
    const committed = state.transactions.filter((t) => t.state === "committed").length;
    return { used, corrupted, open, committed };
  }, [state]);

  return (
    <div className="min-h-screen px-4 py-6 md:px-8 lg:px-12 crt-flicker">
      {/* Header */}
      <header className="mb-6 flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
        <div>
          <div className="flex items-center gap-2 text-xs uppercase tracking-[0.3em] text-muted-foreground">
            <span className="inline-block h-2 w-2 rounded-full bg-primary animate-pulse" />
            v1.0 / educational simulator
          </div>
          <h1 className="font-display text-3xl md:text-4xl font-bold text-primary text-glow">
            Journal<span className="text-secondary text-glow-amber">FS</span>
            <span className="text-muted-foreground"> :: </span>
            <span className="text-foreground">file system journaling simulator</span>
          </h1>
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
            Visualize how a journaling file system protects data integrity across crashes.
            Perform file ops, trigger a power loss, then watch recovery replay the journal.
          </p>
        </div>
        <div className={cn(
          "panel rounded-md px-4 py-2 text-xs font-mono",
          state.crashed ? "border-destructive/60 text-destructive" : state.recovered ? "border-primary/60 text-primary" : "text-muted-foreground"
        )}>
          status: <span className="font-bold">
            {state.crashed ? "✘ CRASHED — run recovery" : state.recovered ? "✓ RECOVERED" : "● ONLINE"}
          </span>
          <span className="mx-2 opacity-40">|</span>
          mode: <span className="text-secondary font-bold">{state.mode.toUpperCase()}</span>
        </div>
      </header>

      <main className="grid grid-cols-1 gap-4 lg:grid-cols-12">
        {/* Left column: controls */}
        <aside className="lg:col-span-3 space-y-4">
          {/* Mode selector */}
          <div className="panel rounded-md p-4">
            <h3 className="font-display text-sm font-bold text-primary text-glow mb-3">
              ⚙ JOURNALING MODE
            </h3>
            <div className="space-y-1.5">
              {(Object.keys(modeInfo) as JournalMode[]).map((m) => (
                <button
                  key={m}
                  onClick={() => onSetMode(m)}
                  className={cn(
                    "w-full text-left rounded border px-2.5 py-1.5 text-xs transition-all font-mono",
                    state.mode === m
                      ? "border-primary bg-primary/15 text-primary shadow-[0_0_12px_hsl(var(--primary)/0.4)]"
                      : "border-border bg-muted/30 text-foreground/80 hover:border-primary/40"
                  )}
                >
                  <div className="font-bold uppercase tracking-wider">{modeInfo[m].title}</div>
                </button>
              ))}
            </div>
            <p className="mt-3 text-[11px] leading-relaxed text-muted-foreground border-l-2 border-secondary/60 pl-2">
              {modeInfo[state.mode].blurb}
            </p>
          </div>

          {/* File ops */}
          <div className="panel rounded-md p-4">
            <h3 className="font-display text-sm font-bold text-primary text-glow mb-3">
              ▤ FILE OPERATIONS
            </h3>
            <div className="space-y-2">
              <div>
                <Label className="text-[10px] uppercase tracking-wider text-muted-foreground">filename</Label>
                <Input
                  value={fileName}
                  onChange={(e) => setFileName(e.target.value)}
                  className="font-mono bg-input border-border text-sm h-8 mt-0.5"
                  placeholder="notes.txt"
                />
              </div>
              <div>
                <Label className="text-[10px] uppercase tracking-wider text-muted-foreground">content</Label>
                <Input
                  value={content}
                  onChange={(e) => setContent(e.target.value)}
                  className="font-mono bg-input border-border text-sm h-8 mt-0.5"
                  placeholder="hello, journal!"
                />
              </div>
              <div className="grid grid-cols-3 gap-1.5 pt-1">
                <Button size="sm" variant="terminal" onClick={onCreate} disabled={state.crashed}>
                  + create
                </Button>
                <Button size="sm" variant="terminalAccent" onClick={onUpdate} disabled={state.crashed}>
                  ✎ update
                </Button>
                <Button size="sm" variant="terminalDanger" onClick={onDelete} disabled={state.crashed}>
                  ✕ delete
                </Button>
              </div>
            </div>
          </div>

          {/* Crash controls */}
          <div className="panel rounded-md p-4 border-destructive/40">
            <h3 className="font-display text-sm font-bold text-destructive mb-3">
              ⚡ POWER & RECOVERY
            </h3>
            <div className="space-y-2">
              <Button
                variant="terminalAmber"
                className="w-full"
                onClick={onAutoFlush}
                disabled={state.crashed || state.transactions.every((t) => t.state === "checkpointed" || t.state === "lost")}
              >
                ⏩ flush all pending
              </Button>
              <Button
                variant="terminalDanger"
                className="w-full"
                onClick={onCrash}
                disabled={state.crashed}
              >
                ⚡ simulate crash
              </Button>
              <Button
                variant="terminal"
                className="w-full"
                onClick={onRecover}
                disabled={!state.crashed}
              >
                ⟳ run recovery
              </Button>
              <Button variant="outline" className="w-full" onClick={onReset}>
                ⟲ reset disk
              </Button>
            </div>
            <div className="mt-3 grid grid-cols-2 gap-1.5 text-[10px] font-mono text-muted-foreground">
              <Stat label="blocks used" value={`${stats.used}/${state.blocks.length}`} />
              <Stat label="corrupted" value={String(stats.corrupted)} danger={stats.corrupted > 0} />
              <Stat label="tx open" value={String(stats.open)} />
              <Stat label="tx commit" value={String(stats.committed)} />
            </div>
          </div>

          {/* Files listing */}
          <div className="panel rounded-md p-4">
            <h3 className="font-display text-sm font-bold text-primary text-glow mb-3">
              ⌹ FILES ON DISK
            </h3>
            {state.files.length === 0 ? (
              <div className="text-xs text-muted-foreground italic">empty filesystem</div>
            ) : (
              <ul className="space-y-1 text-xs font-mono">
                {state.files.map((f) => {
                  const data = state.blocks[f.dataBlockId];
                  return (
                    <li key={f.name} className="flex items-center justify-between gap-2 border-b border-border/40 pb-1">
                      <span className="text-primary">{f.name}</span>
                      <span className="text-muted-foreground truncate max-w-[60%] text-right">
                        "{data.content ?? ""}"
                      </span>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </aside>

        {/* Middle column: disk + journal */}
        <section className="lg:col-span-6 space-y-4">
          <DiskGrid blocks={state.blocks} title="◈ DISK (home location)" />
          <JournalView
            transactions={state.transactions}
            onStep={onStep}
            onComplete={onComplete}
            capacity={JOURNAL_CAPACITY}
          />
          <HowItWorks mode={state.mode} />
        </section>

        {/* Right column: log */}
        <section className="lg:col-span-3">
          <LogConsole log={state.log} />
        </section>
      </main>

      <footer className="mt-8 mb-24 lg:mb-0 text-center text-[11px] text-muted-foreground/70">
        JournalFS simulator · educational model of write-ahead logging (ext3/ext4-style JBD).
        Each file op is an atomic transaction · journal preserves committed work across crashes.
      </footer>

      {/* Mobile sticky action bar — always-visible crash/recover controls */}
      <div className="lg:hidden fixed bottom-0 left-0 right-0 z-50 panel border-t border-destructive/40 bg-background/95 backdrop-blur px-2 py-2">
        <div className="text-[9px] uppercase tracking-widest text-destructive font-bold mb-1.5 text-center">
          ⚡ power & recovery
        </div>
        <div className="grid grid-cols-4 gap-1.5">
          <Button
            size="sm"
            variant="terminalAmber"
            onClick={onAutoFlush}
            disabled={state.crashed || state.transactions.every((t) => t.state === "checkpointed" || t.state === "lost")}
            className="text-[10px] px-1"
          >
            ⏩ flush
          </Button>
          <Button
            size="sm"
            variant="terminalDanger"
            onClick={onCrash}
            disabled={state.crashed}
            className="text-[10px] px-1"
          >
            ⚡ crash
          </Button>
          <Button
            size="sm"
            variant="terminal"
            onClick={onRecover}
            disabled={!state.crashed}
            className="text-[10px] px-1"
          >
            ⟳ recover
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={onReset}
            className="text-[10px] px-1"
          >
            ⟲ reset
          </Button>
        </div>
      </div>
    </div>
  );
};

function Stat({ label, value, danger }: { label: string; value: string; danger?: boolean }) {
  return (
    <div className={cn("rounded border px-2 py-1", danger ? "border-destructive/60 text-destructive" : "border-border")}>
      <div className="opacity-60 text-[9px] uppercase tracking-wider">{label}</div>
      <div className="font-bold text-sm">{value}</div>
    </div>
  );
}

function HowItWorks({ mode }: { mode: JournalMode }) {
  const steps =
    mode === "ordered"
      ? ["1. write data blocks → home", "2. write metadata → JOURNAL", "3. write COMMIT record", "4. checkpoint metadata → home"]
      : mode === "writeback"
      ? ["1. write metadata → JOURNAL", "2. write COMMIT record", "3. data blocks flushed (any time)", "4. checkpoint metadata → home"]
      : ["1. write metadata + data → JOURNAL", "2. write COMMIT record", "3. checkpoint everything → home"];

  return (
    <div className="panel rounded-md p-4">
      <h3 className="font-display text-sm font-bold text-accent mb-3">
        ▤ TRANSACTION LIFECYCLE — {mode.toUpperCase()} MODE
      </h3>
      <div className="grid grid-cols-1 md:grid-cols-4 gap-2">
        {steps.map((s, i) => (
          <div key={i} className="rounded border border-border bg-muted/30 p-2 text-[11px] font-mono text-foreground/90">
            <div className="text-accent text-[9px] uppercase tracking-widest mb-0.5">phase {i + 1}</div>
            {s}
          </div>
        ))}
      </div>
      <p className="mt-3 text-[11px] text-muted-foreground leading-relaxed">
        💡 Try this: create a file, run ONE step (so the tx is mid-flight), then{" "}
        <span className="text-destructive font-bold">simulate crash</span>. Observe corrupted blocks,
        then click <span className="text-primary font-bold">run recovery</span> — the journal
        replays committed work and discards incomplete txs, restoring consistency.
      </p>
    </div>
  );
}

export default Index;
