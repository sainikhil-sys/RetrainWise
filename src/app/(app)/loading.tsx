import { Skeleton } from "@/components/ui/skeleton";

/** Layout-matching skeleton: heading, metric strip, primary chart, two columns. */
export default function Loading() {
  return (
    <div aria-busy="true" aria-live="polite">
      <span className="sr-only">Loading…</span>
      <Skeleton className="h-11 w-72" />
      <Skeleton className="mt-3 h-4 w-[28rem] max-w-full" />
      <div className="mt-8 grid grid-cols-2 border-y border-border md:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="space-y-2 py-5 md:px-6 md:first:pl-0">
            <Skeleton className="h-3 w-20" />
            <Skeleton className="h-7 w-24" />
            <Skeleton className="h-3 w-32" />
          </div>
        ))}
      </div>
      <Skeleton className="mt-10 h-72 w-full" />
      <div className="mt-10 grid gap-10 lg:grid-cols-[1.4fr_1fr]">
        <Skeleton className="h-48" />
        <Skeleton className="h-48" />
      </div>
    </div>
  );
}
