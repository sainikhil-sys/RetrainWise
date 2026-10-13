export default function Loading() {
  return (
    <div aria-busy="true" aria-live="polite" className="animate-pulse">
      <span className="sr-only">Loading…</span>
      <div className="mb-2 h-3 w-24 rounded bg-slate-800" />
      <div className="mb-3 h-7 w-72 rounded bg-slate-800" />
      <div className="mb-8 h-4 w-[32rem] max-w-full rounded bg-slate-800/70" />
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        {Array.from({ length: 8 }).map((_, i) => (
          <div key={i} className="h-28 rounded-2xl border border-slate-800 bg-navy-900/70" />
        ))}
      </div>
      <div className="mt-6 h-80 rounded-2xl border border-slate-800 bg-navy-900/70" />
    </div>
  );
}
