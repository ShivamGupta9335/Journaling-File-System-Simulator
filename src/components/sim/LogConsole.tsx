import { LogEntry } from "@/sim/journalEngine";
import { cn } from "@/lib/utils";
import { useEffect, useRef } from "react";

const levelColor: Record<LogEntry["level"], string> = {
  info: "text-foreground/80",
  step: "text-accent",
  ok: "text-primary",
  warn: "text-secondary",
  error: "text-destructive",
};

export function LogConsole({ log }: { log: LogEntry[] }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    ref.current?.scrollTo({ top: ref.current.scrollHeight });
  }, [log]);

  return (
    <div className="panel rounded-md p-4 h-full flex flex-col">
      <div className="mb-2 flex items-center justify-between">
        <h3 className="font-display text-sm font-bold text-accent">▾ SYSTEM LOG</h3>
        <span className="text-[10px] uppercase tracking-widest text-muted-foreground">
          /var/log/journalfs
        </span>
      </div>
      <div
        ref={ref}
        className="flex-1 min-h-[180px] overflow-y-auto rounded bg-background/60 border border-border/60 p-2 text-[11px] leading-relaxed font-mono"
      >
        {log.map((e, i) => (
          <div key={i} className={cn("animate-slide-in whitespace-pre-wrap", levelColor[e.level])}>
            <span className="text-muted-foreground/60">{fmtTime(e.t)} </span>
            {e.text}
          </div>
        ))}
        <div className="blink-caret text-primary" />
      </div>
    </div>
  );
}

function fmtTime(t: number) {
  const d = new Date(t);
  const pad = (n: number) => n.toString().padStart(2, "0");
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}
