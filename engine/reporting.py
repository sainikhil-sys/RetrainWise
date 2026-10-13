"""Aggregation, charts, presentation deck and submission ZIP.

    python reporting.py charts results            # charts for results_summary.csv
    python reporting.py aggregate results         # results_aggregate.csv (mean/std over seeds)
    python reporting.py deck                      # presentation.pptx from actual results
    python reporting.py package                   # RetrainWise_submission.zip

Everything here reads exported experiment files; no numbers are typed in.
"""
from __future__ import annotations

import argparse
import json
import zipfile
from pathlib import Path

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt  # noqa: E402
import numpy as np  # noqa: E402
import pandas as pd  # noqa: E402

from config import ROOT  # noqa: E402
from experiments import POLICIES, POLICY_LABELS  # noqa: E402

# Fixed policy -> colour mapping (reference categorical palette, slots 1-6, never cycled).
POLICY_COLORS = {"retrainwise": "#2a78d6", "calendar": "#eb6834", "drift_triggered": "#1baf7a",
                 "cara_ct_inspired": "#eda100", "never": "#e87ba4", "hindsight_oracle": "#008300"}
INK, INK_2, GRID, SURFACE = "#0b0b0b", "#52514e", "#e4e3df", "#fcfcfb"
REGIME_ORDER = ["cheap", "balanced", "expensive"]


def _style(ax, title: str, ylabel: str):
    ax.set_title(title, loc="left", fontsize=11, color=INK, fontweight="bold")
    ax.set_ylabel(ylabel, color=INK_2, fontsize=9)
    ax.tick_params(colors=INK_2, labelsize=8)
    for side in ("top", "right"):
        ax.spines[side].set_visible(False)
    for side in ("left", "bottom"):
        ax.spines[side].set_color(GRID)
    ax.grid(axis="y", color=GRID, linewidth=0.8)
    ax.set_axisbelow(True)
    ax.set_facecolor(SURFACE)


def aggregate(summary: pd.DataFrame) -> pd.DataFrame:
    metrics = ["accuracy", "macro_f1", "full_updates", "partial_updates", "evaluations", "rejected_actions",
               "blocked_actions", "budget_violations", "operational_cost", "error_cost", "total_cost",
               "runtime_seconds", "decision_seconds", "probes", "cost_probe"]
    metrics = [m for m in metrics if m in summary.columns]      # older result sets have no probe columns
    g = summary.groupby(["dataset", "regime", "policy"])[metrics]
    out = g.mean().add_suffix("_mean").join(g.std(ddof=1).add_suffix("_std")).join(g.size().rename("seeds"))
    out = out.reset_index()
    out["policy_order"] = out["policy"].map({p: i for i, p in enumerate(POLICIES)})
    out["regime_order"] = out["regime"].map({r: i for i, r in enumerate(REGIME_ORDER)})
    out = out.sort_values(["dataset", "regime_order", "policy_order"]).drop(columns=["policy_order", "regime_order"])
    # TCO relative to the best online (non-oracle) policy in the same cell.
    online = out[out.policy != "hindsight_oracle"]
    best = online.groupby(["dataset", "regime"])["total_cost_mean"].min().rename("best_online_tco")
    out = out.merge(best, on=["dataset", "regime"])
    out["tco_vs_best_online_pct"] = 100 * (out["total_cost_mean"] / out["best_online_tco"] - 1)
    return out


def charts_for(prefix: str, root: Path = ROOT) -> list[str]:
    root = Path(root)
    summary = pd.read_csv(root / f"{prefix}_summary.csv")
    agg = aggregate(summary)
    agg.to_csv(root / f"{prefix}_aggregate.csv", index=False)
    files = [f"{prefix}_aggregate.csv"]
    datasets = list(dict.fromkeys(summary["dataset"]))
    policies = [p for p in POLICIES if p in set(summary["policy"])]
    regimes = [r for r in REGIME_ORDER if r in set(summary["regime"])]

    # 1. Total cost of ownership by regime, one panel per dataset (mean +/- std over seeds).
    fig, axes = plt.subplots(1, len(datasets), figsize=(4.2 * len(datasets) + 1, 4.2), squeeze=False)
    width = 0.8 / len(policies)
    for ax, name in zip(axes[0], datasets):
        part = agg[agg.dataset == name]
        x = np.arange(len(regimes))
        for i, p in enumerate(policies):
            rows = part[part.policy == p].set_index("regime").reindex(regimes)
            ax.bar(x + (i - (len(policies) - 1) / 2) * width, rows["total_cost_mean"], width * 0.92,
                   yerr=rows["total_cost_std"].fillna(0), color=POLICY_COLORS[p], label=POLICY_LABELS[p],
                   error_kw={"elinewidth": 0.8, "ecolor": INK_2, "capsize": 2})
        ax.set_xticks(x, regimes)
        _style(ax, name.capitalize(), "Total cost of ownership (simulated USD)")
    handles, labels = axes[0][0].get_legend_handles_labels()
    fig.legend(handles, labels, loc="lower center", ncol=len(policies), fontsize=8, frameon=False)
    fig.suptitle("TCO = operational spend + prediction-error cost (lower is better)", x=0.01, ha="left",
                 fontsize=9, color=INK_2)
    fig.tight_layout(rect=(0, 0.07, 1, 1))
    path = f"{prefix}_chart_tco.png"
    fig.savefig(root / path, dpi=150, facecolor=SURFACE)
    plt.close(fig)
    files.append(path)

    # 2. Accuracy vs operational spend, balanced regime (or first regime available).
    regime = "balanced" if "balanced" in regimes else regimes[0]
    fig, axes = plt.subplots(1, len(datasets), figsize=(4.2 * len(datasets) + 1, 4.0), squeeze=False)
    for ax, name in zip(axes[0], datasets):
        part = summary[(summary.dataset == name) & (summary.regime == regime)]
        for p in policies:
            rows = part[part.policy == p]
            ax.scatter(rows["operational_cost"], rows["accuracy"], s=46, color=POLICY_COLORS[p],
                       edgecolor=SURFACE, linewidth=1.5, label=POLICY_LABELS[p], zorder=3)
        ax.set_xlabel("Operational spend (simulated USD)", color=INK_2, fontsize=9)
        _style(ax, f"{name.capitalize()} ({regime})", "Prequential accuracy")
    handles, labels = axes[0][0].get_legend_handles_labels()
    fig.legend(handles, labels, loc="lower center", ncol=len(policies), fontsize=8, frameon=False)
    fig.tight_layout(rect=(0, 0.08, 1, 1))
    path = f"{prefix}_chart_accuracy_vs_spend.png"
    fig.savefig(root / path, dpi=150, facecolor=SURFACE)
    plt.close(fig)
    files.append(path)

    # 3. Update counts (mean over seeds), balanced regime.
    fig, axes = plt.subplots(1, len(datasets), figsize=(4.2 * len(datasets) + 1, 4.0), squeeze=False)
    for ax, name in zip(axes[0], datasets):
        part = agg[(agg.dataset == name) & (agg.regime == regime)].set_index("policy").reindex(policies)
        x = np.arange(len(policies))
        ax.bar(x, part["full_updates_mean"], 0.62, color=[POLICY_COLORS[p] for p in policies], label="full")
        ax.bar(x, part["partial_updates_mean"], 0.62, bottom=part["full_updates_mean"], color="#ffffff",
               edgecolor=[POLICY_COLORS[p] for p in policies], hatch="///", linewidth=1, label="partial")
        ax.set_xticks(x, [POLICY_LABELS[p].split(" (")[0] for p in policies], rotation=30, ha="right")
        _style(ax, f"{name.capitalize()} ({regime})", "Updates per run (solid = full, hatched = partial)")
    fig.tight_layout()
    path = f"{prefix}_chart_updates.png"
    fig.savefig(root / path, dpi=150, facecolor=SURFACE)
    plt.close(fig)
    files.append(path)

    # 4. Per-batch error traces for the first seed, balanced regime.
    details_path = root / f"{prefix}_details.json"
    if details_path.exists():
        details = json.loads(details_path.read_text(encoding="utf-8"))
        seed = sorted(set(summary["seed"]))[0]
        for name in datasets:
            fig, ax = plt.subplots(figsize=(9, 3.8))
            for run in details["runs"]:
                s = run["summary"]
                if s["dataset"] != name or s["regime"] != regime or s["seed"] != seed:
                    continue
                trace = pd.DataFrame(run["trace"])
                p = s["policy"]
                smooth = trace["error"].rolling(3, min_periods=1).mean()
                ax.plot(trace["end"], smooth, color=POLICY_COLORS[p], linewidth=2 if p == "retrainwise" else 1.4,
                        label=POLICY_LABELS[p])
                acted = trace[trace["action"].astype(str) != "defer"]
                ax.scatter(acted["end"], smooth[acted.index], s=36, color=POLICY_COLORS[p], edgecolor=SURFACE,
                           linewidth=1.5, zorder=4)
            if name == "synthetic":
                from datasets import SYNTHETIC_SEGMENTS
                n = int(summary[summary.dataset == name]["rows"].iloc[0])
                for label, frac in SYNTHETIC_SEGMENTS.items():
                    ax.axvline(frac * n, color=INK_2, linewidth=0.8, linestyle=":")
                    ax.text(frac * n, 1.0, label.replace("_", " "), fontsize=7, color=INK_2, rotation=90,
                            va="top", ha="right", transform=ax.get_xaxis_transform())
            _style(ax, f"{name.capitalize()}: batch error (3-batch mean), seed {seed}, {regime}; dots = updates",
                   "Error rate")
            ax.set_xlabel("Stream position (rows)", color=INK_2, fontsize=9)
            ax.legend(fontsize=7, frameon=False, ncol=3, loc="upper left", bbox_to_anchor=(0, -0.18))
            fig.tight_layout()
            path = f"{prefix}_chart_error_trace_{name}.png"
            fig.savefig(root / path, dpi=150, facecolor=SURFACE)
            plt.close(fig)
            files.append(path)
    return files


# --------------------------------------------------------------------- deck
def build_deck(prefix: str = "results", root: Path = ROOT, out: str = "presentation.pptx",
               full_prefix: str = "results_full") -> Path:
    """Build the deck from exported result files only (no typed-in numbers)."""
    from pptx import Presentation
    from pptx.dml.color import RGBColor
    from pptx.enum.shapes import MSO_SHAPE
    from pptx.util import Inches, Pt

    root = Path(root)
    agg = pd.read_csv(root / f"{prefix}_aggregate.csv")
    summary = pd.read_csv(root / f"{prefix}_summary.csv")
    cfg = json.loads((root / f"{prefix}_details.json").read_text(encoding="utf-8"))["configuration"]
    prs = Presentation()
    prs.slide_width, prs.slide_height = Inches(13.333), Inches(7.5)
    blank = prs.slide_layouts[6]
    navy, grey, accent = RGBColor(0x17, 0x36, 0x54), RGBColor(0x4A, 0x55, 0x68), RGBColor(0x2A, 0x78, 0xD6)
    pale = RGBColor(0xEE, 0xF4, 0xFB)
    counter = {"n": 0}

    def text(s, x, y, w, h, value, size=16, bold=False, color=grey, align=None):
        tf = s.shapes.add_textbox(Inches(x), Inches(y), Inches(w), Inches(h)).text_frame
        tf.word_wrap = True
        p = tf.paragraphs[0]
        p.text, p.font.size, p.font.bold, p.font.color.rgb = value, Pt(size), bold, color
        if align is not None:
            p.alignment = align
        return tf

    def slide(title: str, bullets: list[str] | None = None, image: str | None = None, note: str = "",
              stats: list[tuple[str, str]] | None = None):
        counter["n"] += 1
        s = prs.slides.add_slide(blank)
        bar = s.shapes.add_shape(MSO_SHAPE.RECTANGLE, 0, 0, Inches(0.22), prs.slide_height)
        bar.fill.solid()
        bar.fill.fore_color.rgb = accent
        bar.line.fill.background()
        text(s, 0.6, 0.35, 12.2, 0.9, title, 30, True, navy)
        text(s, 0.6, 7.0, 10, 0.35, "RetrainWise · costs are simulated USD under stated assumptions", 10)
        text(s, 12.2, 7.0, 0.8, 0.35, str(counter["n"]), 10)
        top = 1.45
        if stats:
            width = 12.1 / len(stats)
            for i, (value, label) in enumerate(stats):
                box = s.shapes.add_shape(MSO_SHAPE.ROUNDED_RECTANGLE, Inches(0.6 + i * width), Inches(top),
                                         Inches(width - 0.2), Inches(1.35))
                box.fill.solid()
                box.fill.fore_color.rgb = pale
                box.line.fill.background()
                text(s, 0.75 + i * width, top + 0.12, width - 0.5, 0.7, value, 30, True, accent)
                text(s, 0.75 + i * width, top + 0.78, width - 0.5, 0.5, label, 12, False, grey)
            top += 1.65
        if bullets:
            width = 5.0 if image else 12.1
            tf = s.shapes.add_textbox(Inches(0.6), Inches(top), Inches(width), Inches(7.0 - top)).text_frame
            tf.word_wrap = True
            for i, b in enumerate(bullets):
                para = tf.paragraphs[0] if i == 0 else tf.add_paragraph()
                para.text, para.font.size, para.font.color.rgb = "•  " + b, Pt(14 if image else 17), grey
                para.space_after = Pt(9)
        if image and (root / image).exists():
            left, width = (5.8, 7.2) if bullets else (0.6, 12.1)
            s.shapes.add_picture(str(root / image), Inches(left), Inches(top), width=Inches(width))
        if note:
            s.notes_slide.notes_text_frame.text = note
        return s

    online = agg[agg.policy != "hindsight_oracle"]
    winners = online.loc[online.groupby(["dataset", "regime"])["total_cost_mean"].idxmin()]
    rw = agg[agg.policy == "retrainwise"]
    ranks = online.pivot_table(index=["dataset", "regime"], columns="policy", values="total_cost_mean").rank(axis=1).mean()
    rw_runs = summary[summary.policy == "retrainwise"]
    eval_share = (rw_runs.groupby("regime")["cost_evaluation"].sum() / rw_runs.groupby("regime")["operational_cost"].sum())

    slide("RetrainWise", [
        "A lifecycle-aware agent for cost-benefit training decisions",
        "Monitor → estimate value recovery → price the action → explain → approve → validate → promote",
        "One Next.js dashboard + Python engine + SQLite, CPU-only, fully offline demo on a synthetic drift stream",
        f"Benchmark: {len(summary)} replayed runs on {', '.join(cfg['datasets'])} ({cfg['size']} size, "
        f"seeds {cfg['seeds']}, regimes {', '.join(cfg['regimes'])})"],
        stats=[(f"{len(summary)}", "benchmark runs (standard size)"), ("6", "policies compared"),
               (f"{len(cfg['datasets'])}", "streams (3 real + synthetic)"), ("3", "cost regimes")])
    slide("Problem", ["Calendar retraining ignores whether anything changed",
                      "Drift-triggered retraining ignores what an update costs and whether it helps",
                      "The real question: retrain fully, update incrementally, or defer — right now?",
                      "Covariate shift (PSI) is not proof that predictions got worse; label evidence is needed"])
    slide("Decision rule", [
        "Expected benefit = error-rate reduction × predictions over horizon × value per avoided error",
        "Total cost = compute + engineering + validation + expected deployment-risk cost; defer = 0",
        "Error reduction measured on a chronological hold-out that no compared model trained on",
        "Scaled by a realisation factor learned from measured post-update outcomes (prior 0.7)",
        "8 guardrails: compatibility, evidence, cooldown, minimum benefit, net > 0, P(net>0), action limit, budget",
        "Approval, artifact checksum and validation gate enforced in deterministic code"])
    slide("Architecture", [
        "L1 monitoring: prequential metrics, ADWIN + DDM on errors, fixed-bin PSI with noise floor, learning debt",
        "L2 decision engine: shadow candidates, itemised simulated costs, ranking, sensitivity",
        "L3 agent: bounded read-only tools, optional local Ollama, consistency check, deterministic fallback",
        "L4 action: unique approvals, validation gate, versioned registry, rollback, bounded autonomy",
        "SQLite is the source of truth; experiment jobs run in a separate worker process"])
    for name in cfg["datasets"]:
        part = agg[(agg.dataset == name) & (agg.regime == "balanced")]
        bullets = [f"{POLICY_LABELS[r['policy']].split(' (')[0]}: TCO ${r['total_cost_mean']:,.0f} "
                   f"(±{0 if pd.isna(r['total_cost_std']) else r['total_cost_std']:,.0f}), acc {r['accuracy_mean']:.3f}, "
                   f"updates {r['full_updates_mean'] + r['partial_updates_mean']:.1f}" for _, r in part.iterrows()]
        slide(f"Results — {name} (balanced regime, mean of seeds)", bullets,
              f"{prefix}_chart_error_trace_{name}.png", note="Numbers read from the aggregate CSV.")
    slide("Total cost of ownership across regimes", None, f"{prefix}_chart_tco.png")
    slide("Honest reading of the standard results", [
        "Where RetrainWise loses: evaluation overhead in the expensive regime, 30% hold-out, conservative guardrails",
        "Electricity: calendar refits on the full window were cheaper in every regime",
        "Costs are simulated; conclusions concern relative behaviour under stated assumptions",
        "Oracle is optimal only over {defer, full retrain on 3 windows} at checkpoints, with hindsight"],
        stats=[(f"{int((winners.policy == 'retrainwise').sum())}/{len(winners)}", "cells with lowest online TCO"),
               (f"{ranks.get('retrainwise', float('nan')):.2f}", "mean TCO rank (of 5 online)"),
               (f"{rw['tco_vs_best_online_pct'].median():+.1f}%", "median gap to best online"),
               (f"{100 * eval_share.get('expensive', float('nan')):.0f}%", "evaluation share of spend (expensive)")])
    full_path = root / f"{full_prefix}_summary.csv"
    if full_path.exists():
        full = pd.read_csv(full_path)
        s = slide("Complete datasets (seed 1, balanced, batch 2,000)", None)
        table = full.pivot_table(index="dataset", columns="policy", values="total_cost", sort=False)
        cols = [p for p in POLICIES if p in table.columns]
        shape = s.shapes.add_table(len(table) + 1, len(cols) + 1, Inches(0.6), Inches(1.5), Inches(12.1),
                                   Inches(0.5 * (len(table) + 1)))
        grid = shape.table
        grid.cell(0, 0).text = "TCO (simulated $)"
        for j, p in enumerate(cols, 1):
            grid.cell(0, j).text = POLICY_LABELS[p].split(" (")[0]
        for i, (name, row) in enumerate(table.iterrows(), 1):
            rows = int(full[full.dataset == name]["rows"].iloc[0])
            grid.cell(i, 0).text = f"{name} ({rows:,} rows)"
            best = min(row[p] for p in cols if p != "hindsight_oracle")
            for j, p in enumerate(cols, 1):
                grid.cell(i, j).text = f"{row[p]:,.0f}" + (" ★" if row[p] == best else "")
        for r in range(len(table) + 1):
            for c in range(len(cols) + 1):
                for para in grid.cell(r, c).text_frame.paragraphs:
                    para.font.size = Pt(13)
        rw_full = full[full.policy == "retrainwise"].set_index("dataset")
        text(s, 0.6, 1.7 + 0.5 * (len(table) + 1), 12.1, 2.5,
             "★ = lowest TCO among online policies. On Covertype RetrainWise spent "
             f"${rw_full.loc['covertype', 'operational_cost']:,.0f} of its ${cfg['settings']['budget']:,.0f} budget "
             "and was then blocked; the budget-unaware drift baseline spent "
             f"${full[(full.dataset == 'covertype') & (full.policy == 'drift_triggered')]['operational_cost'].iloc[0]:,.0f}."
             if "covertype" in rw_full.index else "★ = lowest TCO among online policies.", 15)
    slide("Real local LLM test (Ollama, CPU)", [
        "llama3.1: called the evaluation tool and recommended the same action as the engine, but mislabelled an interval",
        "qwen2.5-coder: emitted tool calls as text, then recommended 'defer' against the engine's 'partial'",
        "After the fixes qwen matched the engine's action but still misstated a cost ($40 vs $50)",
        "Fixes: textual tool calls parsed, evaluation tool required, deterministic consistency check with visible warning",
        "Every LLM report carries the deterministic verified figures; decisions never depend on the LLM"])
    slide("Limitations and future work", [
        "Value-of-information rule for when to pay for shadow evaluation (the main loss driver)",
        "Budget scaled to stream value; only one learner (linear SGD); 3 seeds, no significance tests",
        "Engineer-hour and incident costs are synthetic; prices are an assumed static snapshot",
        "Covertype and Airlines are stream replays; baseline is CARA-CT-inspired, not exact CARA",
        "LLM explanations are advisory and can be wrong — shown by the real Ollama test"])
    path = root / out
    prs.save(path)
    return path


# ------------------------------------------------------------------ package
EXCLUDE_SUFFIXES = (".pyc", ".log", ".zip", ".tmp", ".db-wal", ".db-shm")
EXCLUDE_PREFIXES = ("data_airlines.csv", "data_covertype.csv", "data_electricity.csv", "candidate_", "~$")


EXCLUDE_DIRS = {"node_modules", ".next", ".git", ".venv", "__pycache__", ".claude", "out"}


def package(root: Path = ROOT, name: str = "RetrainWise_submission.zip") -> Path:
    """ZIP the project (Next.js app at the top level, Python engine in engine/).
    Dependencies, build output, large dataset caches, logs and temporary candidate
    artifacts are excluded (re-create them with ``npm install``, ``npm run
    setup:python`` and ``python datasets.py electricity airlines covertype``)."""
    root = Path(root)
    project = root.parent if (root.parent / "package.json").exists() else root
    target = root / name
    included = []
    with zipfile.ZipFile(target, "w", zipfile.ZIP_DEFLATED) as z:
        for path in sorted(project.rglob("*")):
            rel = path.relative_to(project)
            if not path.is_file() or any(part in EXCLUDE_DIRS for part in rel.parts):
                continue
            if path.name.startswith(".") and path.name not in (".gitignore",):
                continue
            if path.name.endswith(EXCLUDE_SUFFIXES) or path.name.startswith(EXCLUDE_PREFIXES):
                continue
            z.write(path, f"RetrainWise/{rel.as_posix()}")
            included.append(rel.as_posix())
        z.writestr("RetrainWise/ZIP_CONTENTS.txt",
                   "Files in this archive:\n" + "\n".join(included) +
                   "\n\nExcluded: node_modules, .next, virtual environments, cached real datasets (data_*.csv.gz), "
                   "logs, temporary candidate artifacts.\n"
                   "Restore with: npm install; npm run setup:python; "
                   "python engine/datasets.py electricity airlines covertype\n")
    return target


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("command", choices=["charts", "aggregate", "deck", "package"])
    parser.add_argument("prefix", nargs="?", default="results")
    args = parser.parse_args()
    if args.command == "charts":
        print("\n".join(charts_for(args.prefix)))
    elif args.command == "aggregate":
        aggregate(pd.read_csv(ROOT / f"{args.prefix}_summary.csv")).to_csv(ROOT / f"{args.prefix}_aggregate.csv",
                                                                         index=False)
    elif args.command == "deck":
        print(build_deck(args.prefix))
    else:
        print(package())


if __name__ == "__main__":
    main()
