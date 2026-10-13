import { describeEvent } from "@/lib/events";
import { ago, when } from "@/lib/format";
import type { EventRow } from "@/lib/types";
import { Badge, cn } from "./ui";

const DOT: Record<string, string> = {
  good: "bg-emerald-400",
  warn: "bg-amber-400",
  bad: "bg-rose-400",
  info: "bg-sky-400",
  neutral: "bg-slate-500",
  accent: "bg-teal-400",
};

export function ActivityList({ events, now }: { events: EventRow[]; now: number }) {
  return (
    <ol className="relative space-y-0">
      {events.map((e) => {
        const { text, tone } = describeEvent(e);
        return (
          <li key={e.id} className="relative flex gap-3 border-l border-slate-800 py-2.5 pl-5">
            <span aria-hidden className={cn("absolute -left-[5px] top-4 h-2.5 w-2.5 rounded-full ring-4 ring-navy-900", DOT[tone])} />
            <div className="min-w-0 flex-1">
              <p className="text-sm leading-snug text-slate-200">{text}</p>
              <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-slate-500">
                <time dateTime={e.created} title={when(e.created)}>
                  {ago(e.created, now)}
                </time>
                <span>·</span>
                <span>{e.actor}</span>
                <Badge tone="neutral" className="font-mono text-[10px]">
                  {e.kind}
                </Badge>
              </div>
            </div>
          </li>
        );
      })}
    </ol>
  );
}
