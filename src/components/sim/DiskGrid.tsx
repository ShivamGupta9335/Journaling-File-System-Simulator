import { DiskBlock } from "@/sim/journalEngine";
import { cn } from "@/lib/utils";

interface Props {
  blocks: DiskBlock[];
  title: string;
}

const stateClasses: Record<DiskBlock["state"], string> = {
  idle: "border-border bg-muted/40 text-muted-foreground",
  writing: "border-secondary bg-secondary/20 text-secondary animate-pulse-glow",
  written: "border-primary/60 bg-primary/10 text-primary",
  stale: "border-border bg-muted/30 text-muted-foreground/60 line-through",
  corrupted: "border-destructive bg-destructive/20 text-destructive animate-pulse",
};

const kindLabel: Record<DiskBlock["kind"], string> = {
  free: "·",
  metadata: "M",
  data: "D",
};

export function DiskGrid({ blocks, title }: Props) {
  return (
    <div className="panel rounded-md p-4">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="font-display text-sm font-bold text-primary text-glow">{title}</h3>
        <span className="text-[10px] uppercase tracking-widest text-muted-foreground">
          {blocks.length} blocks
        </span>
      </div>
      <div className="grid grid-cols-8 gap-1.5">
        {blocks.map((b) => (
          <div
            key={b.id}
            className={cn(
              "relative aspect-square rounded border text-center transition-all duration-300",
              "flex flex-col items-center justify-center text-[10px] font-mono",
              stateClasses[b.state]
            )}
            title={tooltip(b)}
          >
            <div className="text-[9px] opacity-60">#{b.id}</div>
            <div className="text-sm font-bold leading-none">{kindLabel[b.kind]}</div>
            {b.fileName && <div className="absolute -bottom-0.5 truncate text-[8px] opacity-80 px-0.5 max-w-full">{b.fileName}</div>}
          </div>
        ))}
      </div>
      <Legend />
    </div>
  );
}

function tooltip(b: DiskBlock) {
  const parts = [`block #${b.id}`, `kind=${b.kind}`, `state=${b.state}`];
  if (b.fileName) parts.push(`file=${b.fileName}`);
  if (b.content) parts.push(`content="${b.content}"`);
  return parts.join("  ");
}

function Legend() {
  const items = [
    { label: "free", cls: "border-border bg-muted/40" },
    { label: "writing", cls: "border-secondary bg-secondary/30" },
    { label: "written", cls: "border-primary/60 bg-primary/10" },
    { label: "corrupted", cls: "border-destructive bg-destructive/30" },
  ];
  return (
    <div className="mt-3 flex flex-wrap gap-3 text-[10px] text-muted-foreground">
      {items.map((i) => (
        <div key={i.label} className="flex items-center gap-1.5">
          <div className={cn("h-3 w-3 rounded-sm border", i.cls)} />
          <span>{i.label}</span>
        </div>
      ))}
    </div>
  );
}
