"""JSON bridge between the Next.js web application and the RetrainWise engine.

Usage
  python bridge.py serve            long-lived: one JSON request per stdin line,
                                    one JSON response per stdout line
  python bridge.py call <command>   one-shot: JSON arguments on stdin, one JSON
                                    response on stdout

Only the commands in ``COMMANDS`` can be called. Arguments are validated here
(types, ranges, enums, identifier formats) before they reach the engine, which
validates again. stdout is reserved for protocol messages; anything else the
engine prints goes to stderr. All state changes happen inside the engine's
SQLite transactions (``pipeline.Lifecycle``, ``jobs``, ``agent``).
"""
from __future__ import annotations

import json
import re
import sys
import traceback

sys.dont_write_bytecode = True

import numpy as np  # noqa: E402
import pandas as pd  # noqa: E402

import jobs  # noqa: E402
from agent import explain, ollama_status  # noqa: E402
from config import REGIMES, ROOT, SAMPLE_SIZES, Settings  # noqa: E402
from database import dumps, loads  # noqa: E402
from datasets import (DATASETS, SOURCES, download, is_cached, load, read_provenance,  # noqa: E402
                      schema_preview, synthetic_metadata)
from economics import ACTION_LABELS, pricing, rank_actions  # noqa: E402
from experiments import POLICIES, POLICY_LABELS  # noqa: E402
from pipeline import Lifecycle, LifecycleError  # noqa: E402

PROTOCOL_VERSION = 1
_LIFE: Lifecycle | None = None
_ID = re.compile(r"^[A-Za-z0-9]{1,32}$")
_PREFIX = re.compile(r"^[A-Za-z0-9_]{1,80}$")
_MODEL_TAG = re.compile(r"^[A-Za-z0-9._:/-]{1,80}$")


class BadRequest(ValueError):
    """Arguments rejected by the bridge before reaching the engine."""


def life() -> Lifecycle:
    global _LIFE
    if _LIFE is None:
        _LIFE = Lifecycle()
    return _LIFE


# ------------------------------------------------------------------ validation
def _int(args: dict, key: str, lo: int, hi: int, default=None) -> int:
    value = args.get(key, default)
    if value is None:
        raise BadRequest(f"{key} is required")
    if isinstance(value, bool) or not isinstance(value, (int, float)) or int(value) != value:
        raise BadRequest(f"{key} must be an integer")
    value = int(value)
    if not lo <= value <= hi:
        raise BadRequest(f"{key} must be between {lo} and {hi}")
    return value


def _float(args: dict, key: str, lo: float, hi: float, default=None) -> float:
    value = args.get(key, default)
    if isinstance(value, bool) or not isinstance(value, (int, float)) or not np.isfinite(value):
        raise BadRequest(f"{key} must be a finite number")
    if not lo <= float(value) <= hi:
        raise BadRequest(f"{key} must be between {lo} and {hi}")
    return float(value)


def _choice(args: dict, key: str, options, default=None) -> str:
    value = args.get(key, default)
    if value not in options:
        raise BadRequest(f"{key} must be one of {list(options)}")
    return value


def _ident(args: dict, key: str) -> str:
    value = args.get(key)
    if not isinstance(value, str) or not _ID.match(value):
        raise BadRequest(f"{key} must be an alphanumeric identifier")
    return value


def _text(args: dict, key: str, max_len: int, required: bool = True) -> str:
    value = args.get(key, "")
    if not isinstance(value, str):
        raise BadRequest(f"{key} must be text")
    value = value.strip()
    if required and not value:
        raise BadRequest(f"{key} is required")
    if len(value) > max_len:
        raise BadRequest(f"{key} must be at most {max_len} characters")
    return value


def _records(frame: pd.DataFrame) -> list[dict]:
    """DataFrame -> JSON-safe records (NaN -> None)."""
    if frame is None or frame.empty:
        return []
    return loads(dumps(frame.astype(object).where(pd.notna(frame), None).to_dict(orient="records")))


# --------------------------------------------------------------------- commands
def cmd_ping(args: dict) -> dict:
    lc = life()
    if lc.db.get_setting("active") is None:     # persist defaults so readers see real values
        lc.db.put_setting("active", Settings().to_dict())
    recovered = lc.recover() if args.get("recover") else None
    import sklearn
    return {"engine": "retrainwise", "protocol": PROTOCOL_VERSION, "python": sys.version.split()[0],
            "executable": sys.executable, "db_path": lc.db.path, "root": str(ROOT),
            "recovered": recovered, "jobs_interrupted": jobs.recover(lc.db),
            "packages": {"numpy": np.__version__, "pandas": pd.__version__, "scikit-learn": sklearn.__version__}}


def cmd_start_run(args: dict) -> dict:
    dataset = _choice(args, "dataset", DATASETS)
    size = _choice(args, "size", SAMPLE_SIZES)
    seed = _int(args, "seed", 0, 2**31 - 1)
    if not is_cached(dataset):
        raise BadRequest(f"{dataset} is not cached. Download it first; synthetic data is never substituted.")
    run = life().start_run(dataset, size, seed, actor=_text(args, "actor", 80, False) or "user")
    return {"id": run["id"], "dataset": run["dataset"], "size": run["size_label"], "rows": run["n_rows"],
            "seed": run["seed"], "active_version": run["active_version"]}


def cmd_process_batches(args: dict) -> dict:
    run_id = _ident(args, "run_id")
    position = _int(args, "expected_position", 0, 10**9)
    count = _int(args, "count", 1, 50, 1)
    lc = life()
    processed, autonomy, error = [], [], None
    for i in range(count):
        run = lc.run(run_id)
        if run is None:
            raise LifecycleError("Unknown run")
        if run["position"] >= run["n_rows"]:
            if i == 0:
                raise LifecycleError("End of stream reached; start a new run")
            break
        try:
            out = lc.process_batch(run_id, position)
        except Exception as exc:  # keep batches already committed, report the failure
            if i == 0:
                raise
            error = f"{type(exc).__name__}: {exc}"
            break
        if out.get("noop"):
            if i == 0:
                return {"noop": True, "position": out["position"], "processed": [],
                        "message": "The stream already advanced past this position (duplicate request ignored)."}
            break
        position = out["end_row"]
        processed.append({k: out.get(k) for k in ("batch_index", "start_row", "end_row", "version", "status",
                                                  "batch_error", "rolling_error", "labels_revealed",
                                                  "evaluation_suggested", "trigger_reasons", "max_psi")})
        if out.get("autonomy"):
            autonomy.append({"batch_index": out["batch_index"], **out["autonomy"]})
    return {"noop": False, "processed": processed, "autonomy": autonomy, "position": position, "error": error}


def cmd_evaluate(args: dict) -> dict:
    d = life().evaluate(_ident(args, "run_id"), actor=_text(args, "actor", 80, False) or "user")
    return {"id": d["id"], "recommended": d["recommended"], "label": ACTION_LABELS[d["recommended"]],
            "charged": d["evaluation"]["charged"], "note": d["evaluation"]["note"]}


def cmd_execute(args: dict) -> dict:
    if args.get("approved") is not True:
        raise PermissionError("Explicit approval is required before execution")
    request_id = args.get("request_id")
    if request_id is not None:
        request_id = _int(args, "request_id", 1, 10**9)
    return life().execute(_ident(args, "decision_id"), _choice(args, "action", ("defer", "partial", "full")),
                          _text(args, "approver", 80), approved=True, mode="manual", request_id=request_id)


def cmd_rollback(args: dict) -> dict:
    if args.get("approved") is not True:
        raise PermissionError("Rollback requires explicit approval")
    return life().rollback(_int(args, "version", 1, 10**9), _text(args, "approver", 80), approved=True,
                           reason=_text(args, "reason", 500, False))


def cmd_dismiss_request(args: dict) -> dict:
    life().dismiss_request(_int(args, "request_id", 1, 10**9), _text(args, "actor", 80, False) or "user")
    return {"dismissed": True}


def cmd_save_settings(args: dict) -> dict:
    data = args.get("settings")
    if not isinstance(data, dict):
        raise BadRequest("settings must be an object")
    settings = Settings.from_dict(data)
    life().save_settings(settings, actor=_text(args, "actor", 80, False) or "user")
    return {"settings": settings.to_dict()}


def cmd_reset_settings(args: dict) -> dict:
    lc = life()
    settings = Settings(seed=lc.settings().seed)
    lc.save_settings(settings, actor=_text(args, "actor", 80, False) or "user")
    return {"settings": settings.to_dict()}


def cmd_settings(args: dict) -> dict:
    return {"settings": life().settings().to_dict(), "defaults": Settings().to_dict()}


def cmd_datasets(args: dict) -> dict:
    out = []
    for name in DATASETS:
        cached = is_cached(name)
        prov = read_provenance(name) if cached else None
        src = SOURCES.get(name, {})
        out.append({
            "name": name, "cached": cached, "synthetic": name == "synthetic",
            "title": src.get("title") or "Synthetic drift stream (generated locally)",
            "page": src.get("page"), "order": src.get("order") or (prov or {}).get("order"),
            "drop_reason": src.get("drop_reason") or None, "citation": src.get("citation"),
            "licence": src.get("licence") or (prov or {}).get("licence"),
            "provenance": {k: v for k, v in (prov or {}).items() if k not in ("dtypes", "columns", "description")}
            if prov else None,
        })
    return {"datasets": out, "sizes": SAMPLE_SIZES}


def cmd_dataset_preview(args: dict) -> dict:
    name = _choice(args, "name", DATASETS)
    size = _choice(args, "size", SAMPLE_SIZES, "standard")
    seed = _int(args, "seed", 0, 2**31 - 1, 42)
    if not is_cached(name):
        raise FileNotFoundError(f"{name} is not cached. Download it first; synthetic data is never substituted.")
    # Synthetic: head of the exact stream a run would replay. Real data: first 1,000 cached rows.
    frame = load(name, size, seed).head(1_000) if name == "synthetic" else load(name, 1_000, seed)
    meta = synthetic_metadata(SAMPLE_SIZES[size] or 50_000, seed) if name == "synthetic" else None
    counts = frame["target"].astype(str).value_counts().head(20)
    return {"name": name, "schema": _records(schema_preview(frame)), "rows": _records(frame.head(10)),
            "columns": list(frame.columns), "preview_rows": len(frame),
            "class_balance": [{"label": k, "count": int(v)} for k, v in counts.items()],
            "synthetic": meta}


def cmd_download_dataset(args: dict) -> dict:
    name = _choice(args, "name", tuple(SOURCES))
    info = download(name)
    return {k: info.get(k) for k in ("dataset", "rows", "target_column", "cache_file", "cache_sha256",
                                     "retrieved_utc", "source_url")}


def cmd_what_if(args: dict) -> dict:
    lc = life()
    d = lc.decision(_ident(args, "decision_id"))
    if d is None:
        raise LifecycleError("Unknown decision")
    cfg = lc.settings()
    ev_mult = _float(args, "error_value_multiplier", 0.05, 20, 1.0)
    hz_mult = _float(args, "horizon_multiplier", 0.05, 20, 1.0)
    regime = _choice(args, "regime", REGIMES, cfg.regime)
    alt = cfg.replace(error_value=cfg.error_value * ev_mult, regime=regime,
                      horizon_predictions=max(1, int(cfg.horizon_predictions * hz_mult)))
    evidence = {r["action"]: r["evidence"] for r in d["ranked"] if r["action"] != "defer"}
    ranking = rank_actions(evidence, dict(d["context"], horizon=alt.horizon_predictions), alt)
    return {"recommended": ranking["recommended"], "label": ACTION_LABELS[ranking["recommended"]],
            "assumptions": {"error_value": alt.error_value, "horizon_predictions": alt.horizon_predictions,
                            "regime": regime},
            "ranked": [{k: r[k] for k in ("action", "label", "feasible", "total_cost", "benefit", "net_value",
                                          "prob_positive")} | {"failed": [g["name"] for g in r["guardrails"]
                                                                          if not g["passed"]]}
                       for r in ranking["ranked"]]}


def cmd_reference_window(args: dict) -> dict:
    lc = life()
    version = _int(args, "version", 1, 10**9)
    model = lc.model(version)                  # verifies the registered SHA-256
    return {"version": version, "train_start": model.train_start, "train_end": model.train_end,
            "trained_until": model.trained_until, "n_train": model.n_train, "seed": model.seed,
            "describe": model.describe(), "psi_reference": model.psi_reference}


def cmd_explain(args: dict) -> dict:
    lc = life()
    d = lc.decision(_ident(args, "decision_id"))
    if d is None:
        raise LifecycleError("Unknown decision")
    mode = _choice(args, "mode", ("deterministic", "ollama"))
    model = args.get("model") or lc.settings().ollama_model
    if not isinstance(model, str) or not _MODEL_TAG.match(model):
        raise BadRequest("model must be a short Ollama model tag such as llama3.1")
    result = explain(lc, d, mode=mode, model=model)
    return {k: result[k] for k in ("report_id", "mode", "status", "iterations", "duration_seconds", "error",
                                   "requests_prepared")}


def cmd_ollama_status(args: dict) -> dict:
    return ollama_status()


def cmd_submit_job(args: dict) -> dict:
    lc = life()
    payload = {"datasets": args.get("datasets"), "policies": args.get("policies"), "regimes": args.get("regimes"),
               "seeds": args.get("seeds"), "size": args.get("size"), "settings": lc.settings().to_dict()}
    for key in ("datasets", "policies", "regimes", "seeds"):
        if not isinstance(payload[key], list):
            raise BadRequest(f"{key} must be a list")
    job_id, created = jobs.submit(lc.db, payload, actor=_text(args, "actor", 80, False) or "user")
    return {"job_id": job_id, "created": created}


def cmd_cancel_job(args: dict) -> dict:
    return {"cancelled": jobs.cancel(life().db, _ident(args, "job_id"),
                                     actor=_text(args, "actor", 80, False) or "user")}


def cmd_recover_jobs(args: dict) -> dict:
    return {"interrupted": jobs.recover(life().db)}


def _result_prefix(args: dict) -> str:
    prefix = args.get("prefix")
    if not isinstance(prefix, str) or not _PREFIX.match(prefix) or not (ROOT / f"{prefix}_summary.csv").exists():
        raise FileNotFoundError("Unknown result set")
    return prefix


def cmd_experiment_sets(args: dict) -> dict:
    out = []
    for path in sorted(ROOT.glob("*_summary.csv"), key=lambda p: p.stat().st_mtime, reverse=True):
        prefix = path.name[:-len("_summary.csv")]
        if not _PREFIX.match(prefix):
            continue
        try:
            summary = pd.read_csv(path, usecols=["dataset", "policy", "regime", "seed", "size"])
        except (ValueError, OSError):
            continue
        out.append({"prefix": prefix, "runs": len(summary), "datasets": sorted(summary.dataset.unique().tolist()),
                    "regimes": sorted(summary.regime.unique().tolist()),
                    "seeds": sorted(int(s) for s in summary.seed.unique()),
                    "size": str(summary["size"].iloc[0]) if len(summary) else None,
                    "modified": path.stat().st_mtime})
    return {"sets": out}


def cmd_experiment_results(args: dict) -> dict:
    from reporting import aggregate
    prefix = _result_prefix(args)
    summary = pd.read_csv(ROOT / f"{prefix}_summary.csv")
    agg = aggregate(summary)
    details = ROOT / f"{prefix}_details.json"
    meta = None
    if details.exists():
        data = json.loads(details.read_text(encoding="utf-8"))
        meta = {"configuration": data.get("configuration"), "wall_seconds": data.get("wall_seconds"),
                "notes": data.get("notes")}
    charts = sorted(p.name for p in ROOT.glob(f"{prefix}_chart_*.png"))
    return {"prefix": prefix, "summary": _records(summary), "aggregate": _records(agg), "meta": meta,
            "charts": charts, "has_details": details.exists(), "policy_labels": POLICY_LABELS}


def cmd_experiment_traces(args: dict) -> dict:
    prefix = _result_prefix(args)
    details = ROOT / f"{prefix}_details.json"
    if not details.exists():
        raise FileNotFoundError("This result set has no per-batch details")
    dataset, regime = args.get("dataset"), args.get("regime")
    seed = args.get("seed")
    data = json.loads(details.read_text(encoding="utf-8"))
    runs = data.get("runs") or []
    options = sorted({(r["summary"]["dataset"], r["summary"]["regime"], int(r["summary"]["seed"])) for r in runs})
    if not options:
        return {"options": [], "traces": []}
    if (dataset, regime, seed) not in options:
        dataset, regime, seed = options[0]
    traces = [{"policy": r["summary"]["policy"], "label": r["summary"].get("policy_label"),
               "points": [{k: t.get(k) for k in ("batch", "end", "error", "rolling_error", "action", "spent")}
                          for t in r.get("trace") or []]}
              for r in runs if (r["summary"]["dataset"], r["summary"]["regime"], int(r["summary"]["seed"]))
              == (dataset, regime, seed)]
    return {"options": [{"dataset": d, "regime": g, "seed": s} for d, g, s in options],
            "selected": {"dataset": dataset, "regime": regime, "seed": seed}, "traces": traces}


def cmd_pricing(args: dict) -> dict:
    return pricing()


def cmd_catalog(args: dict) -> dict:
    return {"datasets": list(DATASETS), "sizes": SAMPLE_SIZES, "regimes": list(REGIMES), "policies": list(POLICIES),
            "policy_labels": POLICY_LABELS, "action_labels": ACTION_LABELS}


COMMANDS = {
    "ping": cmd_ping, "start_run": cmd_start_run, "process_batches": cmd_process_batches,
    "evaluate": cmd_evaluate, "execute": cmd_execute, "rollback": cmd_rollback,
    "dismiss_request": cmd_dismiss_request, "save_settings": cmd_save_settings,
    "reset_settings": cmd_reset_settings, "settings": cmd_settings, "datasets": cmd_datasets,
    "dataset_preview": cmd_dataset_preview, "download_dataset": cmd_download_dataset, "what_if": cmd_what_if,
    "reference_window": cmd_reference_window, "explain": cmd_explain, "ollama_status": cmd_ollama_status,
    "submit_job": cmd_submit_job, "cancel_job": cmd_cancel_job, "recover_jobs": cmd_recover_jobs,
    "experiment_sets": cmd_experiment_sets, "experiment_results": cmd_experiment_results,
    "experiment_traces": cmd_experiment_traces, "pricing": cmd_pricing, "catalog": cmd_catalog,
}


def handle(command, args) -> dict:
    """Run one command; never raises. Error kinds map to HTTP statuses in the web app."""
    try:
        if command not in COMMANDS:
            raise BadRequest(f"Unknown command {command!r}")
        if not isinstance(args, dict):
            raise BadRequest("args must be an object")
        return {"ok": True, "result": COMMANDS[command](args)}
    except PermissionError as exc:
        return {"ok": False, "kind": "forbidden", "error": str(exc)}
    except LifecycleError as exc:
        return {"ok": False, "kind": "conflict", "error": str(exc)}
    except FileNotFoundError as exc:
        return {"ok": False, "kind": "not_found", "error": str(exc)}
    except (BadRequest, ValueError, TypeError) as exc:
        return {"ok": False, "kind": "invalid", "error": str(exc)}
    except Exception as exc:  # noqa: BLE001 - every failure is reported, and audited
        detail = f"{type(exc).__name__}: {exc}"
        try:
            life().db.event("bridge_error", {"command": str(command)[:40], "error": detail[:500],
                                             "trace": traceback.format_exc()[-1500:]}, actor="web")
        except Exception:  # noqa: BLE001
            pass
        return {"ok": False, "kind": "internal", "error": detail[:1000]}


def _encode(response: dict) -> str:
    try:
        return dumps(response)
    except (TypeError, ValueError) as exc:
        return json.dumps({"ok": False, "kind": "internal", "error": f"Unserialisable result: {exc}"})


def serve() -> None:
    protocol = sys.stdout
    sys.stdout = sys.stderr                  # stray prints must not corrupt the protocol stream
    protocol.write(json.dumps({"ready": True, "protocol": PROTOCOL_VERSION}) + "\n")
    protocol.flush()
    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        try:
            request = json.loads(line)
            rid = request.get("id")
            response = handle(request.get("command"), request.get("args", {}))
        except (json.JSONDecodeError, AttributeError) as exc:
            rid, response = None, {"ok": False, "kind": "invalid", "error": f"Malformed request: {exc}"}
        response["id"] = rid
        protocol.write(_encode(response) + "\n")
        protocol.flush()


def main(argv: list[str]) -> int:
    for stream in (sys.stdin, sys.stdout, sys.stderr):
        try:
            stream.reconfigure(encoding="utf-8")
        except (AttributeError, ValueError):
            pass
    if len(argv) == 2 and argv[1] == "serve":
        serve()
        return 0
    if len(argv) == 3 and argv[1] == "call":
        raw = sys.stdin.read().strip()
        try:
            args = json.loads(raw) if raw else {}
        except json.JSONDecodeError as exc:
            print(json.dumps({"ok": False, "kind": "invalid", "error": f"Malformed arguments: {exc}"}))
            return 2
        protocol = sys.stdout
        sys.stdout = sys.stderr
        response = handle(argv[2], args)
        protocol.write(_encode(response) + "\n")
        protocol.flush()
        return 0 if response["ok"] else 1
    print("usage: python bridge.py serve | python bridge.py call <command>", file=sys.stderr)
    return 2


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))
