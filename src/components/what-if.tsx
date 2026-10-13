"use client";

import { FlaskConical } from "lucide-react";
import { useEffect, useState } from "react";

import { ACTION_LABELS } from "@/lib/catalog";
import { money } from "@/lib/format";
import type { Action, Regime } from "@/lib/types";
import { Field, api, inputClass } from "./client";
import { Alert, Badge, Table, Td, Th, cn } from "./ui";

type Result = {
  recommended: Action;
  assumptions: { error_value: number; horizon_predictions: number; regime: Regime };
  ranked: { action: Action; label: string; feasible: boolean; total_cost: number; benefit: number; net_value: number; prob_positive: number | null; failed: string[] }[];
};

/** Re-ranks the stored evidence under other assumptions. Read-only: nothing is saved. */
export function WhatIf({ decisionId, regime, recommended }: { decisionId: string; regime: Regime; recommended: Action }) {
  const [ev, setEv] = useState(1);
  const [hz, setHz] = useState(1);
  const [rg, setRg] = useState<Regime>(regime);
  const [result, setResult] = useState<Result | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const ctrl = new AbortController();
    const t = setTimeout(() => {
      setLoading(true);
      api<Result>(`/api/decisions/${decisionId}/what-if`, { body: { errorValueMultiplier: ev, horizonMultiplier: hz, regime: rg }, signal: ctrl.signal })
        .then((r) => {
          setResult(r);
          setError(null);
        })
        .catch((e: Error) => e.name !== "AbortError" && setError(e.message))
        .finally(() => setLoading(false));
    }, 300);
    return () => {
      clearTimeout(t);
      ctrl.abort();
    };
  }, [decisionId, ev, hz, rg]);

  return (
    <div className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-3">
        <Field label={`Error value × ${ev.toFixed(2)}`} htmlFor="wi-ev" help="Scale the assumed value of avoiding one error.">
          <input id="wi-ev" type="range" min={0.1} max={5} step={0.05} value={ev} onChange={(e) => setEv(Number(e.target.value))} className="w-full accent-teal-400" />
        </Field>
        <Field label={`Horizon × ${hz.toFixed(2)}`} htmlFor="wi-hz" help="Scale how long the gain is assumed to last.">
          <input id="wi-hz" type="range" min={0.1} max={5} step={0.05} value={hz} onChange={(e) => setHz(Number(e.target.value))} className="w-full accent-teal-400" />
        </Field>
        <Field label="Cost regime" htmlFor="wi-rg">
          <select id="wi-rg" className={inputClass} value={rg} onChange={(e) => setRg(e.target.value as Regime)}>
            <option value="cheap">Cheap</option>
            <option value="balanced">Balanced</option>
            <option value="expensive">Expensive</option>
          </select>
        </Field>
      </div>
      {error && <Alert tone="bad">{error}</Alert>}
      {result && (
        <div className={cn("space-y-3 transition-opacity", loading && "opacity-60")} aria-busy={loading}>
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <FlaskConical className="h-4 w-4 text-teal-300" aria-hidden />
            Under these assumptions:
            <span className="font-semibold text-slate-50">{ACTION_LABELS[result.recommended]}</span>
            {result.recommended !== recommended ? <Badge tone="warn">differs from the stored recommendation</Badge> : <Badge tone="good">same as stored</Badge>}
          </div>
          <Table caption="What-if ranking">
            <thead>
              <tr>
                <Th>Action</Th>
                <Th align="right">Benefit</Th>
                <Th align="right">Cost</Th>
                <Th align="right">Net value</Th>
                <Th align="right">P(net &gt; 0)</Th>
                <Th>Blocked by</Th>
              </tr>
            </thead>
            <tbody>
              {result.ranked.map((r) => (
                <tr key={r.action}>
                  <Td>{ACTION_LABELS[r.action]}</Td>
                  <Td align="right">{money(r.benefit)}</Td>
                  <Td align="right">{money(r.total_cost)}</Td>
                  <Td align="right" className={r.net_value > 0 ? "text-emerald-300" : r.net_value < 0 ? "text-rose-300" : undefined}>
                    {money(r.net_value)}
                  </Td>
                  <Td align="right">{r.prob_positive == null ? "—" : r.prob_positive.toFixed(2)}</Td>
                  <Td className="whitespace-normal text-xs text-slate-400">{r.failed.length ? r.failed.join(", ") : r.action === "defer" ? "—" : <span className="text-emerald-300">feasible</span>}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
          <p className="text-xs text-slate-500">
            Error value {money(result.assumptions.error_value)}, horizon {result.assumptions.horizon_predictions.toLocaleString()} predictions, {result.assumptions.regime} regime. Informational only — the stored decision and settings are unchanged.
          </p>
        </div>
      )}
    </div>
  );
}
