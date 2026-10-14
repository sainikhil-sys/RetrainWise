"use client";

import { useState, useTransition } from "react";
import { whatIfAction, type WhatIfResult } from "@/app/(app)/actions";
import { money } from "@/lib/format";

const REGIMES = ["cheap", "balanced", "expensive"] as const;

/** Informational re-ranking under different assumptions; does not change stored decisions. */
export function WhatIf({ decisionId, regime }: { decisionId: string; regime: (typeof REGIMES)[number] }) {
  const [errorMult, setErrorMult] = useState(1);
  const [horizonMult, setHorizonMult] = useState(1);
  const [reg, setReg] = useState(regime);
  const [result, setResult] = useState<WhatIfResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const run = (e: number, h: number, r: (typeof REGIMES)[number]) => start(async () => {
    try {
      setResult(await whatIfAction(decisionId, e, h, r));
      setError(null);
    } catch (exc) {
      setError((exc as Error).message);
    }
  });
  return (
    <div className="stack">
      <div className="form-grid">
        <label>Error value multiplier: {errorMult.toFixed(1)}×
          <input type="range" min={0.1} max={5} step={0.1} value={errorMult} onChange={(e) => setErrorMult(Number(e.target.value))}
            onMouseUp={() => run(errorMult, horizonMult, reg)} onKeyUp={() => run(errorMult, horizonMult, reg)}
            onTouchEnd={() => run(errorMult, horizonMult, reg)} />
        </label>
        <label>Horizon multiplier: {horizonMult.toFixed(1)}×
          <input type="range" min={0.1} max={5} step={0.1} value={horizonMult} onChange={(e) => setHorizonMult(Number(e.target.value))}
            onMouseUp={() => run(errorMult, horizonMult, reg)} onKeyUp={() => run(errorMult, horizonMult, reg)}
            onTouchEnd={() => run(errorMult, horizonMult, reg)} />
        </label>
        <label>Cost regime
          <select value={reg} onChange={(e) => {
            const r = e.target.value as (typeof REGIMES)[number];
            setReg(r);
            run(errorMult, horizonMult, r);
          }}>
            {REGIMES.map((r) => <option key={r} value={r}>{r}</option>)}
          </select>
        </label>
      </div>
      {!result && !pending ? <div><button type="button" onClick={() => run(errorMult, horizonMult, reg)}>Re-rank</button></div> : null}
      {pending ? <p className="muted">Re-ranking…</p> : null}
      {error ? <div className="alert bad">{error}</div> : null}
      {result ? (
        <>
          <p>Recommended under these assumptions: <strong>{result.recommended}</strong></p>
          <div className="table-wrap">
            <table>
              <thead><tr><th>Action</th><th className="num">Net</th><th>Feasible</th></tr></thead>
              <tbody>
                {result.rows.map((r) => (
                  <tr key={r.action}><td>{r.action}</td><td className="num">{money(r.net)}</td><td>{r.feasible ? "✔" : "✖"}</td></tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      ) : null}
    </div>
  );
}
