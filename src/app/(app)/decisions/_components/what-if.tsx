"use client";

import { useEffect, useState } from "react";

import { Callout, Status } from "@/components/rw";
import { api } from "@/components/rw-client";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Slider } from "@/components/ui/slider";
import { ACTION_LABELS, REGIMES } from "@/lib/catalog";
import { money } from "@/lib/format";
import type { Action } from "@/lib/types";
import { cn } from "@/lib/utils";

type Result = {
  recommended: Action;
  assumptions: { error_value: number; horizon_predictions: number; regime: string };
  ranked: { action: Action; feasible: boolean; total_cost: number; benefit: number; net_value: number; prob_positive: number | null; failed: string[] }[];
};

/** Re-ranks the stored evidence under other assumptions. Read-only: nothing is saved. */
export function WhatIf({ decisionId, regime, recommended }: { decisionId: string; regime: string; recommended: Action }) {
  const [ev, setEv] = useState(1);
  const [hz, setHz] = useState(1);
  const [rg, setRg] = useState(regime);
  const [result, setResult] = useState<Result | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const ctrl = new AbortController();
    const t = setTimeout(() => {
      setLoading(true);
      api<Result>(`/api/decisions/${decisionId}/what-if`, { method: "POST", body: { errorValueMultiplier: ev, horizonMultiplier: hz, regime: rg }, signal: ctrl.signal })
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
    <div className="space-y-5">
      <div className="grid gap-5 sm:grid-cols-3">
        <div className="space-y-2">
          <Label className="text-[13px]">Error value × {ev.toFixed(2)}</Label>
          <Slider min={0.1} max={5} step={0.05} value={[ev]} onValueChange={([x]) => setEv(x)} aria-label="Error value multiplier" />
        </div>
        <div className="space-y-2">
          <Label className="text-[13px]">Horizon × {hz.toFixed(2)}</Label>
          <Slider min={0.1} max={5} step={0.05} value={[hz]} onValueChange={([x]) => setHz(x)} aria-label="Horizon multiplier" />
        </div>
        <div className="space-y-2">
          <Label htmlFor="wi-rg" className="text-[13px]">
            Cost regime
          </Label>
          <Select value={rg} onValueChange={setRg}>
            <SelectTrigger id="wi-rg" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {REGIMES.map((r) => (
                <SelectItem key={r} value={r}>
                  {r[0].toUpperCase() + r.slice(1)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>
      {error && <Callout tone="bad">{error}</Callout>}
      {result && (
        <div className={cn("space-y-3 transition-opacity", loading && "opacity-60")} aria-busy={loading}>
          <p className="flex flex-wrap items-center gap-2 text-[13.5px]">
            Under these assumptions: <span className="font-medium">{ACTION_LABELS[result.recommended]}</span>
            {result.recommended !== recommended ? <Status tone="warn">differs from the stored recommendation</Status> : <Status tone="ok">same as stored</Status>}
          </p>
          <div className="overflow-x-auto">
            <table className="w-full text-[13px]">
              <caption className="sr-only">What-if ranking</caption>
              <thead>
                <tr className="border-b border-border text-left text-[12px] text-muted-foreground">
                  <th className="py-2 pr-3 font-medium">Action</th>
                  <th className="py-2 pr-3 text-right font-medium">Benefit</th>
                  <th className="py-2 pr-3 text-right font-medium">Cost</th>
                  <th className="py-2 pr-3 text-right font-medium">Net</th>
                  <th className="py-2 font-medium">Blocked by</th>
                </tr>
              </thead>
              <tbody>
                {result.ranked.map((r) => (
                  <tr key={r.action} className="border-b border-border/60">
                    <td className="py-1.5 pr-3">{ACTION_LABELS[r.action]}</td>
                    <td className="tabular py-1.5 pr-3 text-right">{money(r.benefit)}</td>
                    <td className="tabular py-1.5 pr-3 text-right">{money(r.total_cost)}</td>
                    <td className={cn("tabular py-1.5 pr-3 text-right font-medium", r.net_value < 0 && "text-bad")}>{money(r.net_value)}</td>
                    <td className="py-1.5 text-[12px] text-ink-2">{r.failed.length ? r.failed.join(", ") : r.action === "defer" ? "—" : "feasible"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="text-[12px] text-muted-foreground">
            Error value {money(result.assumptions.error_value)}, horizon {result.assumptions.horizon_predictions.toLocaleString()} predictions, {result.assumptions.regime} regime. Informational only: the stored decision and settings are unchanged.
          </p>
        </div>
      )}
    </div>
  );
}
