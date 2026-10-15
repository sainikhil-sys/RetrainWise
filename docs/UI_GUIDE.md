# RetrainWise UI guide

How the web app is built. Read this before adding or changing a page.

## Visual system (black-and-white editorial)

* White canvas, near-black ink (`text-foreground`), thin borders (`border-border`), soft gray surfaces (`bg-subtle`, `bg-muted`).
* **Color only carries operational meaning**: `ok` (green, healthy), `warn` (amber, attention or uncertainty), `bad` (red, failure or high risk). Never decorative. No gradients, no glassmorphism, no rainbow palettes.
* Type: `font-serif` (Instrument Serif) for page titles, section titles, dialog titles and the wordmark; `font-sans` (Geist) for interface text; `font-mono` (Geist Mono) for identifiers, versions, event kinds; `tabular` for numbers.
* Hierarchy comes from type, spacing and hairlines, not from stacks of identical cards. Prefer one restrained `MetricStrip` (3–5 figures) over many metric cards.
* Page title: `PageHeader` (serif, ~44px) plus one plain-language sentence describing the current state.
* Content width is capped by the shell (`max-w-[1200px]`). Use two-column split views (`lg:grid-cols-[1.25fr_1fr]`) for data-heavy pages and right-side panels (`RightPanel`) for details, approvals and help.

## Copy

Concise developer-tool language. Examples: "No action recommended", "Partial update is the lowest-cost viable option", "Validation is required before promotion", "This model has been running for 6 batches", "Feature distribution changed, but predictive degradation is not confirmed", "Process the next batch to refresh evidence". Never: "unlock insights", "revolutionary", "seamless", "next-generation".

Always label simulated money (`<SimLabel />`), assumed prices, synthetic data and limitations. Never invent numbers: every figure on an app page comes from the engine database or an API response.

## Building blocks

| File | What |
|---|---|
| `src/components/rw.tsx` (server-safe) | `PageHeader`, `MetricStrip`, `Section`, `Status`/`StatusDot`, `Tag`, `Kbd`, `SimLabel`, `InfoTip`, `EmptyState`, `NextStep`, `Timeline`, `KV`, `DataTable` (table on desktop, detail list on mobile), `Explainer`, `Callout` |
| `src/components/rw-client.tsx` (client) | `api()`, `useAction()` (single-flight mutation + toast + refresh), `useAutoRefresh`, `ConfirmDialog` (promotion, rollback, risky updates), `RightPanel`, `PanelButton`, `TipCallout` (dismissible onboarding hints), `Spinner` |
| `src/components/actions.tsx` | `ProcessBatchButton`, `EvaluateButton`, `StartDemoButton`, `LinkButton` |
| `src/components/charts.tsx` | `LineChartMono` (annotations, bands, horizontal limit lines), `BarChartMono`, `ScatterMono`, `PsiHeatmap`, `ConfusionMatrix`, `ChartLegend` |
| `src/components/motion.tsx` | `Reveal` (staggered entry; marks `[data-reveal]`), `AnimatedNumber`, `ChartReveal`, `PageTransition`. All respect `prefers-reduced-motion`. |
| `src/components/ui/*` | shadcn/ui (Radix) restyled: Button variants `default` (near-black), `outline`/`secondary` (white + border), `destructive` (red outline), `destructive-solid`, `ghost`, `link`; Tabs default to an underline style |
| Icons | Phosphor only: `@phosphor-icons/react` in client components, `@phosphor-icons/react/dist/ssr` in server components |

## Data and permissions

* Pages are server components: `const ctx = await requirePage("/path")` (from `@/lib/authz`) gives `ctx.user`, `ctx.workspace`, `ctx.role`. Read engine data with the functions in `@/lib/queries` (all take `ctx.workspace.id` first).
* Check capabilities with `can(ctx.role, "permission")` from `@/lib/permissions` to hide or disable controls. The API enforces the same permissions; the UI only mirrors them.
* Mutations go through API routes in `src/app/api/**` via `useAction().run(url, body, opts)`; they return JSON or `{ error }` with a status code.
* Shared helpers: `@/lib/format` (money, pct, num, signed, when, ago), `@/lib/narrative` (state sentence, risk level, next step, chart annotations), `@/lib/series` (telemetry → chart series), `@/lib/catalog`, `@/lib/types`.

## Motion

GSAP only, subtle: 150–250 ms page transitions (built into the shell), staggered section reveals (`Reveal` around the page with `data-reveal` on sections — `PageHeader`, `MetricStrip`, `Section`, `NextStep` already set it), number count-ups (`AnimatedNumber`) and chart wipes (`ChartReveal`, built into the charts). Animate interface state only; never fake progress.

## Keyboard

The shell provides ⌘K (command palette), `b` (process next batch), `e` (evaluate), `r` (recommendation), `g` + letter navigation and `?` (shortcut help).
