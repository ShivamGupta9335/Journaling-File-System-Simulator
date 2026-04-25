import { Transaction } from "@/sim/journalEngine";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";

interface Props {
  transactions: Transaction[];
  onStep: (id: number) => void;
  onComplete: (id: number) => void;
  capacity: number;
}

const stateColor: Record<Transaction["state"], string> = {
  open: "text-secondary",
  committed: "text-accent",
  checkpointed: "text-primary",
  lost: "text-destructive line-through",
};

export function JournalView({ transactions, onStep, onComplete, capacity }: Props) {
  // Show transactions that still occupy a journal slot
  const active = transactions.filter((t) => t.state !== "checkpointed");
  const used = active.length;

  return (
    <div className="panel rounded-md p-4">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="font-display text-sm font-bold text-secondary text-glow-amber">
          ◉ JOURNAL (write-ahead log)
        </h3>
        <span className="text-[10px] uppercase tracking-widest text-muted-foreground">
          {used} / {capacity} slots
        </span>
      </div>

      {/* Slot meter */}
      <div className="mb-3 grid grid-cols-8 gap-1">
        {Array.from({ length: capacity }).map((_, i) => (
          <div
            key={i}
            className={cn(
              "h-2 rounded-sm border",
              i < used ? "border-secondary bg-secondary/60" : "border-border bg-muted/40"
            )}
          />
        ))}
      </div>

      <div className="space-y-2 max-h-[280px] overflow-y-auto pr-1">
        {transactions.length === 0 && (
          <div className="text-xs text-muted-foreground italic">
            No transactions yet. Create or modify a file to begin.
          </div>
        )}
        {transactions.slice().reverse().map((tx) => (
          <div
            key={tx.id}
            className={cn(
              "rounded border border-border/60 bg-muted/30 p-2 text-xs animate-slide-in",
              tx.state === "lost" && "opacity-60"
            )}
          >
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2 min-w-0">
                <span className="text-primary font-bold">tx#{tx.id}</span>
                <span className="truncate text-foreground/90">{tx.op}</span>
              </div>
              <span className={cn("text-[10px] uppercase font-bold", stateColor[tx.state])}>
                {tx.state}
              </span>
            </div>
            <PhasePills tx={tx} />
            {tx.state !== "checkpointed" && tx.state !== "lost" && (
              <div className="mt-2 flex gap-1.5">
                <Button size="sm" variant="terminal" onClick={() => onStep(tx.id)}>
                  ▸ step
                </Button>
                <Button size="sm" variant="terminalAmber" onClick={() => onComplete(tx.id)}>
                  ⏩ complete
                </Button>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

function PhasePills({ tx }: { tx: Transaction }) {
  const phases =
    tx.mode === "ordered"
      ? [
          { k: "data→disk", v: tx.phases.dataWritten },
          { k: "journal", v: tx.phases.journalWritten },
          { k: "commit", v: tx.phases.committed },
          { k: "checkpoint", v: tx.phases.checkpointed },
        ]
      : tx.mode === "writeback"
      ? [
          { k: "journal", v: tx.phases.journalWritten },
          { k: "commit", v: tx.phases.committed },
          { k: "data→disk", v: tx.phases.dataWritten },
          { k: "checkpoint", v: tx.phases.checkpointed },
        ]
      : [
          { k: "journal(meta+data)", v: tx.phases.journalWritten },
          { k: "commit", v: tx.phases.committed },
          { k: "checkpoint", v: tx.phases.checkpointed },
        ];

  return (
    <div className="mt-1.5 flex flex-wrap gap-1">
      {phases.map((p) => (
        <span
          key={p.k}
          className={cn(
            "rounded-sm border px-1.5 py-0.5 text-[9px] uppercase tracking-wider",
            p.v
              ? "border-primary/60 bg-primary/15 text-primary"
              : "border-border bg-muted/40 text-muted-foreground"
          )}
        >
          {p.v ? "✓" : "○"} {p.k}
        </span>
      ))}
    </div>
  );
}
