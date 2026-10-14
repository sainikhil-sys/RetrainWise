"""RetrainWise - Streamlit application. Start with:  streamlit run app.py

Streamlit is the only application framework. SQLite (retrainwise.db) is the
source of truth; long benchmark jobs run in worker.py processes.
"""
from __future__ import annotations

import sys

sys.dont_write_bytecode = True

import json  # noqa: E402

import numpy as np  # noqa: E402
import pandas as pd  # noqa: E402
import plotly.graph_objects as go  # noqa: E402
import streamlit as st  # noqa: E402

import jobs  # noqa: E402
from agent import explain, ollama_status  # noqa: E402
from auth import Auth  # noqa: E402
from auth_ui import account_sidebar, require_login  # noqa: E402
from config import REGIMES, ROOT, SAMPLE_SIZES, Settings  # noqa: E402
from database import loads  # noqa: E402
from datasets import (DATASETS, SOURCES, download, is_cached, load, read_provenance,  # noqa: E402
                      schema_preview, synthetic_metadata)
from economics import ACTION_LABELS, pricing, rank_actions  # noqa: E402
from experiments import POLICIES, POLICY_LABELS  # noqa: E402
from pipeline import Lifecycle, LifecycleError  # noqa: E402

st.set_page_config(page_title="RetrainWise", page_icon="♻️", layout="wide", initial_sidebar_state="expanded")

# ----------------------------------------------------------------- styling
SERIES = {"blue": "#2a78d6", "orange": "#eb6834", "aqua": "#1baf7a", "yellow": "#eda100", "magenta": "#e87ba4",
          "green": "#008300", "violet": "#4a3aa7", "red": "#e34948"}
POLICY_COLORS = {"retrainwise": SERIES["blue"], "calendar": SERIES["orange"], "drift_triggered": SERIES["aqua"],
                 "cara_ct_inspired": SERIES["yellow"], "never": SERIES["magenta"], "hindsight_oracle": SERIES["green"]}
st.markdown("""
<style>
:root { --rw-ink:#0b1f33; --rw-ink-2:#4a5568; --rw-line:#d9e0e8; --rw-card:#ffffff; --rw-accent:#1c5cab;
        --rw-good:#116329; --rw-good-bg:#dafbe1; --rw-warn:#7d4e00; --rw-warn-bg:#fff4d6;
        --rw-bad:#a40e26; --rw-bad-bg:#ffe1e4; --rw-info:#0b4a8b; --rw-info-bg:#ddf0ff; }
@media (prefers-color-scheme: dark) {
  :root { --rw-ink:#eef2f7; --rw-ink-2:#b4bfcc; --rw-line:#334155; --rw-card:#111827; --rw-accent:#6da7ec;
          --rw-good:#7ee2a8; --rw-good-bg:#0f2e1c; --rw-warn:#f5c86b; --rw-warn-bg:#33270b;
          --rw-bad:#ff9aa5; --rw-bad-bg:#3a1218; --rw-info:#9ecbff; --rw-info-bg:#0c2540; }
}
.block-container { padding-top: 1.6rem; max-width: 1400px; }
h1, h2, h3 { letter-spacing: -0.01em; }
.rw-hero { border:1px solid var(--rw-line); border-radius:14px; padding:18px 22px; margin-bottom:14px;
           background: linear-gradient(135deg, rgba(42,120,214,.10), rgba(27,175,122,.06)); }
.rw-hero h2 { margin:0 0 4px 0; font-size:1.35rem; }
.rw-hero p { margin:0; color: var(--rw-ink-2); }
.rw-card { border:1px solid var(--rw-line); border-radius:12px; padding:14px 16px; background:var(--rw-card); }
.rw-badge { display:inline-flex; gap:6px; align-items:center; padding:2px 10px; border-radius:999px;
            font-size:.82rem; font-weight:600; border:1px solid transparent; }
.rw-good { color:var(--rw-good); background:var(--rw-good-bg); }
.rw-warn { color:var(--rw-warn); background:var(--rw-warn-bg); }
.rw-bad  { color:var(--rw-bad);  background:var(--rw-bad-bg); }
.rw-info { color:var(--rw-info); background:var(--rw-info-bg); }
.rw-muted { color: var(--rw-ink-2); font-size: .88rem; }
[data-testid="stMetric"] { border:1px solid var(--rw-line); border-radius:12px; padding:12px 14px; }
[data-testid="stMetricLabel"] p { font-size: .82rem; }
.stTabs [data-baseweb="tab-list"] { gap: 4px; }
</style>
""", unsafe_allow_html=True)


def badge(text: str, kind: str = "info", icon: str = "") -> str:
    icons = {"good": "✔", "warn": "▲", "bad": "✖", "info": "ℹ"}
    return f'<span class="rw-badge rw-{kind}">{icon or icons[kind]} {text}</span>'


def money(v) -> str:
    return "—" if v is None or (isinstance(v, float) and np.isnan(v)) else f"${v:,.2f}"


def md(text: str) -> str:
    """Escape dollar signs so Streamlit markdown does not render them as LaTeX."""
    return str(text).replace("$", "\\$")


def pct(v, digits=1) -> str:
    return "—" if v is None or (isinstance(v, float) and np.isnan(v)) else f"{100 * v:.{digits}f}%"


def status_kind(status: str | None) -> str:
    if not status:
        return "info"
    if "predictive" in status:
        return "bad"
    if "covariate" in status or "insufficient" in status:
        return "warn"
    return "good"


def figure(fig: go.Figure, height: int = 330) -> go.Figure:
    fig.update_layout(height=height, margin=dict(l=10, r=10, t=40, b=10), legend=dict(orientation="h", y=-0.2),
                      hovermode="x unified", font=dict(size=12),
                      title=dict(font=dict(size=14)))
    fig.update_xaxes(showgrid=False)
    fig.update_yaxes(gridcolor="rgba(128,128,128,0.25)")
    return fig


@st.cache_resource
def lifecycle() -> Lifecycle:
    life = Lifecycle()
    life.recover()            # executions in flight when the process stopped -> interrupted
    jobs.recover(life.db)     # workers that stopped heart-beating -> interrupted
    return life


@st.cache_resource
def authenticator() -> Auth:
    return Auth(lifecycle().db)


life = lifecycle()
db = life.db
user = require_login(authenticator())   # renders sign in / sign up and stops until signed in
ACTOR = user["email"]   # approvals and rollbacks are recorded against the signed-in account
cfg = life.settings()
run = life.active_run()

# ----------------------------------------------------------------- sidebar
PAGES = ["Overview", "Data and simulation", "Monitoring", "Decision analysis", "Model lifecycle",
         "Experiments", "Agent and audit", "Settings"]
ICONS = ["🏠", "🗂️", "📈", "⚖️", "🧬", "🧪", "🤖", "⚙️"]
with st.sidebar:
    st.markdown("## ♻️ RetrainWise")
    st.caption("Lifecycle-aware cost-benefit training decisions")
    page = st.radio("Navigate", PAGES, format_func=lambda p: f"{ICONS[PAGES.index(p)]}  {p}",
                    label_visibility="collapsed", key="nav")
    st.divider()
    if run:
        st.markdown(f"**Active run** `{run['id']}`  \n{run['dataset']} · {run['size_label']} · seed {run['seed']}")
        st.progress(min(1.0, run["position"] / run["n_rows"]), text=f"row {run['position']:,} / {run['n_rows']:,}")
        st.markdown(md(f"Model **v{run['active_version']:03d}** · spent {money(run['spent'])} of {money(cfg.budget)}"))
    else:
        st.info("No active run. Start one in *Data and simulation*.")
    mode = badge("Bounded autonomy ON", "warn") if cfg.autonomy else badge("Recommendation-only", "good")
    st.markdown(mode, unsafe_allow_html=True)
    st.divider()
    account_sidebar(authenticator(), user)
    st.caption("Model training, predictions and metrics are real. Prices, engineer hours and deployment risk "
               "are **simulated assumptions**; deployment is a local registry swap (simulated).")


def header(title: str, subtitle: str):
    st.markdown(f"# {title}")
    st.markdown(f'<p class="rw-muted">{subtitle}</p>', unsafe_allow_html=True)


def need_run() -> bool:
    if run is None:
        st.info("Start a run in **Data and simulation** first. The synthetic stream works fully offline.")
        return False
    return True


def telemetry_frame() -> pd.DataFrame:
    return life.telemetry(run["id"]) if run else pd.DataFrame()


def process_controls(key: str):
    remaining = run["n_rows"] - run["position"]
    if remaining <= 0:
        st.success("End of stream reached. Start a new run to continue.")
        return
    c1, c2 = st.columns([1, 2])
    n = c1.number_input("Batches to process", 1, 40, 1, key=f"nb_{key}")
    c2.write("")
    c2.write("")
    if c2.button(f"▶ Process {n} batch{'es' if n > 1 else ''}", type="primary", key=f"pb_{key}"):
        bar = st.progress(0.0, text="Predicting, revealing labels, updating monitors…")
        done = 0
        for i in range(int(n)):
            current = life.run(run["id"])
            if current["position"] >= current["n_rows"]:
                break
            out = life.process_batch(run["id"], current["position"])
            done += 0 if out.get("noop") else 1
            if out.get("autonomy", {}).get("acted"):
                st.toast(f"Bounded autonomy executed {out['autonomy'].get('status')} ({out['autonomy'].get('outcome')})")
            bar.progress((i + 1) / n, text=f"Processed batch {out.get('batch_index', '?')}")
        st.session_state["flash"] = f"Processed {done} batch(es)."
        st.rerun()


def flash():
    message = st.session_state.pop("flash", None)
    if message:
        st.success(message)


# ================================================================== pages
def page_overview():
    header("Overview", "Model health, spending and the latest recommendation for the active stream.")
    flash()
    if run is None:
        st.markdown('<div class="rw-hero"><h2>Update only when the evidence pays for it</h2>'
                    '<p>RetrainWise monitors a deployed model, estimates how much accuracy an update would '
                    'recover, prices the action, and recommends full retraining, a partial update or deferring '
                    '- with approval, validation and an audit trail.</p></div>', unsafe_allow_html=True)
        if st.button("🚀 Start offline demo (synthetic drift stream)", type="primary"):
            with st.spinner("Generating the synthetic stream and training the initial model…"):
                life.start_run("synthetic", "standard", cfg.seed)
            st.session_state["flash"] = "Demo run started. Process a few batches next."
            st.rerun()
        return
    tel = telemetry_frame()
    last = tel.iloc[-1].to_dict() if not tel.empty else {}
    cols = st.columns(6)
    cols[0].metric("Active model", f"v{run['active_version']:03d}",
                   f"age {last.get('model_age_batches', 0)} batches" if last else None, delta_color="off")
    cols[1].metric("Rolling error", pct(last.get("rolling_error")),
                   f"{100 * last['degradation']:+.1f} pts vs reference" if last.get("degradation") is not None else None,
                   delta_color="inverse")
    cols[2].metric("Learning debt", money(last.get("learning_debt_cost")),
                   f"{last.get('learning_debt', 0):.0f} excess errors" if last else None, delta_color="off")
    cols[3].metric("Modeled spend", money(run["spent"]), f"of {money(cfg.budget)} budget", delta_color="off")
    cols[4].metric("Max PSI", f"{last['max_psi']:.3f}" if last.get("max_psi") is not None else "—",
                   last.get("max_psi_feature"), delta_color="off")
    labels = life.label_summary(run["id"])
    cols[5].metric("Labels revealed", f"{labels['revealed']:,}", f"{labels['available'] - labels['revealed']:,} pending",
                   delta_color="off")
    left, right = st.columns([3, 2])
    with left:
        if tel.empty:
            st.info("Process a batch to start collecting monitoring evidence.")
        else:
            fig = go.Figure()
            fig.add_scatter(x=tel["end_row"], y=tel["batch_error"], name="Batch error (revealed labels)",
                            mode="lines+markers", line=dict(color=SERIES["blue"], width=2), marker=dict(size=6))
            fig.add_scatter(x=tel["end_row"], y=tel["rolling_error"], name="Rolling error",
                            line=dict(color=SERIES["orange"], width=2))
            fig.add_scatter(x=tel["end_row"], y=tel["reference_error"], name="Reference error",
                            line=dict(color="#8a8984", dash="dot", width=1.5))
            changes = tel[tel["version"].diff().fillna(0) != 0]
            for _, r in changes.iterrows():
                fig.add_vline(x=r["start_row"], line=dict(color=SERIES["green"], width=1, dash="dash"))
            fig.update_layout(title="Observed error (dashed green = model version change)")
            st.plotly_chart(figure(fig), use_container_width=True)
    with right:
        st.markdown("##### Monitoring status")
        if last:
            st.markdown(badge(last["status"], status_kind(last["status"])), unsafe_allow_html=True)
            reasons = last.get("trigger_reasons") or []
            if last.get("evaluation_suggested"):
                st.markdown("**Evaluation suggested:** " + "; ".join(reasons))
            else:
                st.caption("No evaluation trigger: " + ("; ".join(reasons) if reasons else "signals below thresholds"))
        d = life.latest_decision(run["id"])
        st.markdown("##### Latest recommendation")
        if d:
            top = d["ranked"][0]
            kind = {"pending": "info", "promoted": "good", "rejected": "bad", "deferred": "good"}.get(d["status"], "warn")
            st.markdown(md(f"**{top['label']}** · net {money(top['net_value'])} ") + badge(d["status"], kind),
                        unsafe_allow_html=True)
            st.caption(f"Decision `{d['id']}` at row {d['position']:,} · {d.get('outcome') or ''}")
        else:
            st.caption("No decision yet - evaluate options in Decision analysis.")
    st.markdown("##### Recent activity")
    events = db.query("SELECT created, kind, actor, payload FROM events ORDER BY id DESC LIMIT 10")
    st.dataframe(pd.DataFrame(events), use_container_width=True, hide_index=True)


def page_data():
    header("Data and simulation", "Choose a stream, inspect provenance and schema, and replay it batch by batch.")
    flash()
    c1, c2, c3 = st.columns(3)
    name = c1.selectbox("Dataset", DATASETS, format_func=lambda d: "synthetic (offline)" if d == "synthetic" else d)
    size = c2.selectbox("Sample configuration", list(SAMPLE_SIZES),
                        index=1, format_func=lambda s: f"{s} ({SAMPLE_SIZES[s]:,} rows)" if SAMPLE_SIZES[s] else f"{s} (all rows)")
    seed = c3.number_input("Seed", 0, 2**31 - 1, int(cfg.seed), help="Controls SGD randomness, label sampling, "
                                                                    "cost traces and the synthetic generator.")
    prov = read_provenance(name) if name == "synthetic" or is_cached(name) else None
    if name != "synthetic":
        src = SOURCES[name]
        st.markdown(f"**{src['title']}** · [{src['page']}]({src['page']})  \n{src['order']}")
        if src.get("drop_reason"):
            st.caption("Preprocessing note: " + src["drop_reason"])
        if not is_cached(name):
            st.warning("Not cached locally. Downloading is explicit; synthetic data is never substituted.")
        if st.button(f"⬇ {'Re-download' if is_cached(name) else 'Download'} and cache {name}"):
            try:
                with st.spinner(f"Downloading {name} and recording provenance…"):
                    info = download(name)
                st.session_state["flash"] = f"Cached {info['rows']:,} rows (sha256 {info['cache_sha256'][:12]}…)."
                st.rerun()
            except Exception as exc:  # network or parse failure is shown, not hidden
                st.error(f"Download failed: {exc}")
    else:
        meta = synthetic_metadata(SAMPLE_SIZES[size] or 50_000, int(seed))
        st.markdown("**Synthetic drift stream** - generated locally, deterministic for a given seed.")
        st.caption(" · ".join(f"{k.replace('_', ' ')} @ row {v:,}" for k, v in meta["drift_points"].items()))
    if prov:
        with st.expander("Provenance record"):
            st.json({k: v for k, v in prov.items() if k not in ("dtypes", "columns")})
    if name == "synthetic" or is_cached(name):
        try:
            # Synthetic: head of the exact stream that a run would replay; real data: first 1,000 cached rows.
            preview = load(name, size, int(seed)).head(1_000) if name == "synthetic" else load(name, 1_000, int(seed))
            t1, t2 = st.tabs(["Schema", "First rows"])
            t1.dataframe(schema_preview(preview), use_container_width=True, hide_index=True)
            t2.dataframe(preview.head(10), use_container_width=True)
        except Exception as exc:
            st.error(f"Could not read dataset: {exc}")
        replace = run is not None
        confirm = st.checkbox("Close the current run and start a new one", value=False) if replace else True
        if st.button("Start new run", type="primary", disabled=not confirm):
            with st.spinner("Loading data in source order and training the initial model…"):
                new = life.start_run(name, size, int(seed))
            st.session_state["flash"] = f"Run {new['id']} started on {name} ({new['n_rows']:,} rows)."
            st.rerun()
    if run:
        st.divider()
        st.markdown(f"#### Replay · run `{run['id']}` ({run['dataset']})")
        st.progress(min(1.0, run["position"] / run["n_rows"]),
                    text=f"Stream position {run['position']:,} of {run['n_rows']:,} · batch {run['batch_index']} · "
                         f"batch size {cfg.batch_size} · label delay {cfg.label_delay_batches} batch(es) · "
                         f"label availability {pct(cfg.label_fraction, 0)}")
        process_controls("data")
        st.caption("Each batch: predict first, then reveal labels that are due, then update monitors. "
                   "Models change only through approved (or bounded-autonomy) actions.")


def page_monitoring():
    header("Monitoring", "Prequential performance, label-based detectors, covariate drift and label availability.")
    if not need_run():
        return
    tel = telemetry_frame()
    if tel.empty:
        st.info("No batches processed yet.")
        process_controls("mon")
        return
    last = tel.iloc[-1]
    st.markdown(badge(last["status"], status_kind(last["status"])) + "&nbsp;&nbsp;" +
                (badge("covariate signal", "warn") if last["covariate_signal"] else badge("no covariate signal", "good"))
                + "&nbsp;&nbsp;" + (badge("predictive signal", "bad") if last["predictive_signal"]
                                    else badge("no predictive signal", "good")), unsafe_allow_html=True)
    st.caption("PSI shows that P(X) moved; it is not proof of concept drift. Predictive degradation needs label "
               "evidence: ADWIN/DDM on prediction errors or a rolling error whose 95% CI sits above the reference.")
    tab1, tab2, tab3, tab4 = st.tabs(["Performance", "Detectors & staleness", "Feature drift (PSI)", "Labels & reference"])
    with tab1:
        fig = go.Figure()
        for col, color, label in (("batch_accuracy", SERIES["blue"], "Accuracy"), ("batch_f1", SERIES["aqua"], "Macro F1"),
                                  ("batch_precision", SERIES["violet"], "Macro precision"),
                                  ("batch_recall", SERIES["orange"], "Macro recall")):
            fig.add_scatter(x=tel["end_row"], y=tel[col], name=label, line=dict(color=color, width=2))
        fig.update_layout(title="Metrics on labels revealed in each batch")
        st.plotly_chart(figure(fig), use_container_width=True)
        ci = pd.DataFrame(tel["rolling_error_ci"].dropna().tolist(), columns=["lo", "hi"], index=tel["rolling_error_ci"].dropna().index)
        fig = go.Figure()
        if not ci.empty:
            x = tel.loc[ci.index, "end_row"]
            fig.add_scatter(x=list(x) + list(x[::-1]), y=list(ci["hi"]) + list(ci["lo"][::-1]), fill="toself", mode="lines",
                            fillcolor="rgba(235,104,52,0.15)", line=dict(width=0), name="95% CI", hoverinfo="skip")
        fig.add_scatter(x=tel["end_row"], y=tel["rolling_error"], name="Rolling error", line=dict(color=SERIES["orange"], width=2))
        fig.add_scatter(x=tel["end_row"], y=tel["reference_error"], name="Reference error", line=dict(color="#8a8984", dash="dot"))
        fig.update_layout(title=f"Rolling error (window {cfg.rolling_window}) with Wilson 95% interval")
        st.plotly_chart(figure(fig), use_container_width=True)
    with tab2:
        fig = go.Figure()
        fig.add_bar(x=tel["end_row"], y=tel["learning_debt_cost"], name="Learning debt ($)", marker_color=SERIES["blue"])
        adwin = tel[tel["adwin_error_increase"].astype(bool)]
        ddm = tel[tel["ddm_status"] == "drift"]
        warn = tel[tel["ddm_status"] == "warning"]
        top = float(tel["learning_debt_cost"].max() or 1)
        fig.add_scatter(x=adwin["end_row"], y=[top * 1.08] * len(adwin), mode="markers", name="ADWIN error increase",
                        marker=dict(symbol="triangle-down", size=12, color=SERIES["red"]))
        fig.add_scatter(x=ddm["end_row"], y=[top * 1.16] * len(ddm), mode="markers", name="DDM drift",
                        marker=dict(symbol="x", size=11, color=SERIES["violet"]))
        fig.add_scatter(x=warn["end_row"], y=[top * 1.16] * len(warn), mode="markers", name="DDM warning",
                        marker=dict(symbol="circle-open", size=10, color=SERIES["violet"]))
        fig.update_layout(title="Accumulated staleness (excess errors x error value) and detector alarms")
        st.plotly_chart(figure(fig), use_container_width=True)
        show = tel[["batch_index", "end_row", "version", "model_age_batches", "predictions_since_update",
                    "labels_since_update", "adwin_error_increase", "ddm_status", "change_row", "degradation",
                    "learning_debt", "evaluation_suggested"]]
        st.dataframe(show.iloc[::-1], use_container_width=True, hide_index=True)
    with tab3:
        psi_frame = pd.DataFrame(tel["psi"].tolist(), index=tel["end_row"]).T
        fig = go.Figure(go.Heatmap(z=psi_frame.values, x=psi_frame.columns, y=psi_frame.index, zmin=0,
                                   zmax=max(0.5, float(np.nanmax(psi_frame.values))),
                                   colorscale=[[0, "#f0f6fe"], [0.4, "#86b6ef"], [0.7, "#2a78d6"], [1, "#0d366b"]],
                                   colorbar=dict(title="PSI"), hovertemplate="row %{x}<br>%{y}: PSI %{z:.3f}<extra></extra>"))
        fig.update_layout(title=f"PSI per feature vs the active model's fixed training bins (threshold {cfg.psi_threshold})")
        st.plotly_chart(figure(fig, 360), use_container_width=True)
        st.caption("Shifted features are flagged only when PSI exceeds the threshold *and* three times the "
                   "sampling-noise floor (k-1)(1/n+1/m), so small batches do not raise false alarms.")
        st.write("Unseen categories in the latest batch:", pct(last.get("unseen_category_rate")),
                 "· Schema issues:", last.get("schema_issues"))
    with tab4:
        fig = go.Figure()
        fig.add_bar(x=tel["end_row"], y=tel["labels_revealed"], name="Labels revealed", marker_color=SERIES["aqua"])
        fig.add_bar(x=tel["end_row"], y=tel["labels_pending"], name="Labels pending", marker_color=SERIES["yellow"])
        fig.update_layout(title="Label availability", barmode="group")
        st.plotly_chart(figure(fig, 280), use_container_width=True)
        model = life.model(run["active_version"])
        st.markdown(f"**Reference window** - active model v{run['active_version']:03d} trained on rows "
                    f"{model.train_start:,}-{model.train_end:,} (learned up to row {model.trained_until:,}; "
                    f"{model.n_train:,} rows). PSI bins are fixed from that window.")
        feature = st.selectbox("Inspect reference bins", list(model.psi_reference))
        spec = model.psi_reference[feature]
        if spec["kind"] == "numeric":
            labels = [f"≤ {spec['edges'][0]:.4g}"] + [f"({a:.4g}, {b:.4g}]" for a, b in zip(spec["edges"][:-1], spec["edges"][1:])] \
                     + [f"> {spec['edges'][-1]:.4g}", "missing"]
        else:
            labels = spec["values"] + ["other/unseen", "missing"]
        st.dataframe(pd.DataFrame({"bin": labels, "reference count": spec["counts"]}), use_container_width=True,
                     hide_index=True)
    process_controls("mon")


def decision_tables(d: dict):
    rows = []
    for r in d["ranked"]:
        rows.append({"rank": r["rank"], "action": r["label"], "feasible": "✔" if r["feasible"] else "✖",
                     "total cost": r["total_cost"], "expected error reduction": r["expected_reduction"],
                     "expected benefit": r["benefit"], "benefit 95% low": r["benefit_ci"][0],
                     "benefit 95% high": r["benefit_ci"][1], "net expected value": r["net_value"],
                     "P(net > 0)": r["prob_positive"]})
    st.dataframe(pd.DataFrame(rows), use_container_width=True, hide_index=True,
                 column_config={c: st.column_config.NumberColumn(format="$%.2f") for c in
                                ("total cost", "expected benefit", "benefit 95% low", "benefit 95% high", "net expected value")}
                 | {"expected error reduction": st.column_config.NumberColumn(format="%.4f"),
                    "P(net > 0)": st.column_config.NumberColumn(format="%.2f")})


def page_decision():
    header("Decision analysis", "Shadow-evaluate update candidates, price them, and rank defer / partial / full.")
    if not need_run():
        return
    flash()
    tel = telemetry_frame()
    last = tel.iloc[-1].to_dict() if not tel.empty else {}
    if last.get("evaluation_suggested"):
        st.info("Monitoring suggests an evaluation: " + "; ".join(last["trigger_reasons"]))
    c1, c2 = st.columns([1, 3])
    if c1.button("⚖ Evaluate update options", type="primary", disabled=tel.empty):
        with st.spinner("Training full and partial candidates and scoring them on a chronological hold-out…"):
            d = life.evaluate(run["id"])
        st.session_state["flash"] = f"Decision {d['id']}: recommend {ACTION_LABELS[d['recommended']]}."
        st.rerun()
    c2.caption("Evaluation is charged once per (stream position, model, settings); repeated clicks reuse the stored "
               "decision. Candidates are trained only on rows before the hold-out.")
    d = life.latest_decision(run["id"])
    if not d:
        st.info("No decision for this run yet.")
        return
    top = d["ranked"][0]
    kind = {"pending": "info", "promoted": "good", "rejected": "bad", "deferred": "good", "stale": "warn"}.get(d["status"], "warn")
    st.markdown(f"### Recommendation: {top['label']} " + badge(d["status"], kind), unsafe_allow_html=True)
    st.caption(f"Decision `{d['id']}` · row {d['position']:,} · model v{d['version']:03d} · triggers: "
               f"{'; '.join(d['trigger_reasons'])}")
    if d["evaluation"]["charged"]:
        st.caption(f"Shadow evaluation overhead charged: {money(d['evaluation']['cost']['total'])} · plan: "
                   f"{d['evaluation']['plan'].get('window_basis')}, hold-out rows {d['evaluation']['plan'].get('holdout_interval')}")
    else:
        st.warning(f"No candidates evaluated: {d['evaluation']['note']}. Conservative default is to defer.")
    st.code(d["justification"], language=None)
    decision_tables(d)
    a, b = st.columns(2)
    with a:
        fig = go.Figure()
        acts = [r for r in d["ranked"] if r["action"] != "defer"]
        for key, color in zip(("compute", "engineering", "validation", "deployment_risk"),
                              (SERIES["blue"], SERIES["orange"], SERIES["aqua"], SERIES["yellow"])):
            fig.add_bar(x=[r["label"] for r in acts], y=[r["costs"][key] for r in acts], name=key.replace("_", " "),
                        marker_color=color)
        fig.update_layout(barmode="stack", title="Itemised simulated cost per action")
        st.plotly_chart(figure(fig), use_container_width=True)
    with b:
        fig = go.Figure()
        fig.add_bar(x=[r["label"] for r in acts], y=[r["benefit"] for r in acts], name="Expected benefit",
                    marker_color=SERIES["green"],
                    error_y=dict(type="data", symmetric=False,
                                 array=[r["benefit_ci"][1] - r["benefit"] for r in acts],
                                 arrayminus=[r["benefit"] - r["benefit_ci"][0] for r in acts]))
        fig.add_bar(x=[r["label"] for r in acts], y=[r["total_cost"] for r in acts], name="Total cost",
                    marker_color=SERIES["red"])
        fig.update_layout(barmode="group", title="Benefit (95% interval) vs cost")
        st.plotly_chart(figure(fig), use_container_width=True)
    st.markdown("#### Guardrails")
    grows = [{"action": r["label"], "guardrail": g["name"], "result": "✔ pass" if g["passed"] else "✖ fail",
              "detail": g["detail"]} for r in d["ranked"] for g in r["guardrails"]]
    st.dataframe(pd.DataFrame(grows), use_container_width=True, hide_index=True)
    st.markdown("#### Evidence")
    ev = pd.DataFrame([{"action": r["label"], **{k: v for k, v in r["evidence"].items() if not isinstance(v, (dict,))}}
                       for r in d["ranked"] if r["action"] != "defer"])
    st.dataframe(ev, use_container_width=True, hide_index=True)
    st.markdown("#### Sensitivity to assumptions")
    st.dataframe(pd.DataFrame(d["sensitivity"]), use_container_width=True, hide_index=True,
                 column_config={"net_partial": st.column_config.NumberColumn(format="$%.2f"),
                                "net_full": st.column_config.NumberColumn(format="$%.2f")})
    with st.expander("What-if explorer (informational - does not change stored decisions)"):
        w1, w2, w3 = st.columns(3)
        ev_mult = w1.slider("Error value multiplier", 0.1, 5.0, 1.0, 0.1)
        hz_mult = w2.slider("Horizon multiplier", 0.1, 5.0, 1.0, 0.1)
        regime = w3.selectbox("Cost regime", REGIMES, index=REGIMES.index(cfg.regime))
        evidence = {r["action"]: r["evidence"] for r in d["ranked"] if r["action"] != "defer"}
        alt = cfg.replace(error_value=cfg.error_value * ev_mult, regime=regime,
                          horizon_predictions=max(1, int(cfg.horizon_predictions * hz_mult)))
        ctx = dict(d["context"], horizon=alt.horizon_predictions)
        what = rank_actions(evidence, ctx, alt)
        st.write(f"Recommended under these assumptions: **{ACTION_LABELS[what['recommended']]}**")
        st.dataframe(pd.DataFrame([{"action": r["label"], "net": r["net_value"], "feasible": r["feasible"]}
                                   for r in what["ranked"]]), hide_index=True)
    with st.expander("Assumptions"):
        for item in d["assumptions"]:
            st.markdown(f"- {item}")
    with st.expander("Full decision record (JSON)"):
        st.json(d)


def page_lifecycle():
    header("Model lifecycle", "Approve updates, see validation outcomes, inspect the registry, promote or roll back.")
    if not need_run():
        return
    flash()
    d = life.latest_decision(run["id"])
    st.markdown("#### Approve an action")
    if d and d["status"] == "pending":
        options = [r["action"] for r in d["ranked"]]
        labels = {r["action"]: f"{r['label']} · net {money(r['net_value'])} · {'feasible' if r['feasible'] else 'blocked by guardrails'}"
                  for r in d["ranked"]}
        with st.form("approve"):
            action = st.radio("Action", options, format_func=lambda a: md(labels[a]), index=0)
            st.caption(f"Approving as **{ACTOR}**")
            ok = st.checkbox("I approve this action. Guardrails and the validation gate are still enforced.")
            submitted = st.form_submit_button("Execute approved action", type="primary")
        if submitted:
            if not ok:
                st.error("Tick the approval box to confirm.")
            else:
                try:
                    with st.spinner("Re-checking guardrails, verifying the artifact, validating on the hold-out…"):
                        result = life.execute(d["id"], action, ACTOR, approved=True)
                    st.session_state["flash"] = f"Outcome: {result['status']} - {result['outcome']}"
                    st.rerun()
                except (LifecycleError, PermissionError) as exc:
                    st.error(str(exc))
    elif d:
        st.info(f"Latest decision `{d['id']}` is **{d['status']}** ({d.get('outcome') or ''}). "
                "Evaluate options again in Decision analysis to get a fresh decision.")
    else:
        st.info("No decision yet. Evaluate options in Decision analysis.")
    requests = db.query("SELECT * FROM execution_requests WHERE status='awaiting_approval' ORDER BY id DESC")
    if requests:
        st.markdown("#### Agent-prepared requests (not executed)")
        for req in requests:
            c1, c2, c3 = st.columns([4, 1, 1])
            c1.markdown(md(f"Request #{req['id']}: **{ACTION_LABELS[req['action']]}** for decision `{req['decision_id']}`  \n"
                           f"*Rationale:* {req['rationale']}"))
            if c2.button("Approve", key=f"ar{req['id']}"):
                try:
                    result = life.execute(req["decision_id"], req["action"], ACTOR, approved=True, request_id=req["id"])
                    st.session_state["flash"] = f"Request #{req['id']}: {result['status']} - {result['outcome']}"
                except (LifecycleError, PermissionError) as exc:
                    st.session_state["flash"] = f"Request #{req['id']} not executed: {exc}"
                st.rerun()
            if c3.button("Dismiss", key=f"dr{req['id']}"):
                life.dismiss_request(req["id"], ACTOR)
                st.rerun()
    st.markdown("#### Registry")
    reg = life.registry(run["id"])
    if not reg.empty:
        meta = reg["metadata"].map(loads)
        reg = reg.assign(reference_error=meta.map(lambda m: m.get("reference_error")),
                         validation=meta.map(lambda m: (m.get("validation") or {}).get("passed")),
                         approved_by=meta.map(lambda m: m.get("approved_by")),
                         sha256=reg["sha256"].fillna("").str[:12]).drop(columns=["metadata"])
        st.dataframe(reg, use_container_width=True, hide_index=True)
    st.markdown("#### Decisions and outcomes")
    dec = db.query("SELECT id, created, position, version, recommended, status, outcome, resolved FROM decisions "
                   "WHERE run_id=? ORDER BY created DESC", (run["id"],))
    st.dataframe(pd.DataFrame(dec), use_container_width=True, hide_index=True)
    outcomes = run["monitor_state"].get("outcomes") or []
    post = run["monitor_state"].get("post_update")
    st.markdown("#### Post-update monitoring")
    if post:
        st.info(f"Tracking v{run['active_version']:03d} against retired v{post['old_version']:03d} on new labels: "
                f"{post['n']} / {cfg.post_update_window} labels, errors new {post['new_errors']} vs old {post['old_errors']}.")
    if outcomes:
        st.dataframe(pd.DataFrame(outcomes), use_container_width=True, hide_index=True)
        st.caption("Realised reduction = (retired model errors - new model errors) / labels on the same new rows. "
                   "These outcomes calibrate the realisation factor used in future benefit estimates.")
    elif not post:
        st.caption("No completed post-update measurements yet.")
    st.markdown("#### Rollback")
    candidates = reg[reg["status"].isin(["archived", "rolled_back"])]["version"].tolist() if not reg.empty else []
    if candidates:
        with st.form("rollback"):
            version = st.selectbox("Restore version", candidates, format_func=lambda v: f"v{v:03d}")
            st.caption(f"Approving as **{ACTOR}**")
            why = st.text_input("Reason")
            ok = st.checkbox("I approve rolling back the active model")
            go_rb = st.form_submit_button("Roll back")
        if go_rb:
            try:
                life.rollback(int(version), ACTOR, approved=ok, reason=why)
                st.session_state["flash"] = f"Rolled back to v{int(version):03d}."
                st.rerun()
            except (LifecycleError, PermissionError) as exc:
                st.error(str(exc))
    else:
        st.caption("No archived versions to roll back to.")


def page_experiments():
    header("Experiments", "Compare six policies on identical streams and cost traces. Jobs run in a worker process.")
    flash()
    cached = [d for d in DATASETS if is_cached(d)]
    missing = [d for d in DATASETS if d not in cached]
    with st.form("experiment"):
        c1, c2 = st.columns(2)
        names = c1.multiselect("Datasets", cached, default=["synthetic"])
        policies = c2.multiselect("Policies", POLICIES, default=list(POLICIES), format_func=POLICY_LABELS.get)
        c3, c4, c5 = st.columns(3)
        regimes = c3.multiselect("Cost regimes", REGIMES, default=["balanced"])
        size = c4.selectbox("Sample configuration", list(SAMPLE_SIZES), index=0,
                            format_func=lambda s: f"{s} ({SAMPLE_SIZES[s]:,} rows)" if SAMPLE_SIZES[s] else f"{s} (all rows)")
        seeds_text = c5.text_input("Seeds (comma-separated)", "1,2")
        start = st.form_submit_button("Start benchmark job", type="primary")
    if missing:
        st.caption(f"Not cached (download in Data and simulation): {', '.join(missing)}")
    if start:
        try:
            seeds = [int(s) for s in seeds_text.replace(" ", "").split(",") if s]
            job_id, created = jobs.submit(db, {"datasets": names, "policies": policies, "regimes": regimes,
                                               "seeds": seeds, "size": size, "settings": cfg.to_dict()})
            st.session_state["flash"] = f"Job {job_id} {'started' if created else 'already running with the same settings'}."
            st.rerun()
        except ValueError as exc:
            st.error(str(exc))
    job_panel()
    st.markdown("#### Saved comparisons")
    files = sorted({p.name[:-len("_summary.csv")] for p in ROOT.glob("*_summary.csv")})
    if files:
        prefix = st.selectbox("Result set", files, index=files.index("results") if "results" in files else 0)
        summary = pd.read_csv(ROOT / f"{prefix}_summary.csv")
        show_results(summary, prefix)
    else:
        st.caption("No exported results yet.")


@st.fragment(run_every="2s")
def job_panel():
    jobs.recover(db)
    rows = jobs.jobs(db, 6)
    if not rows:
        st.caption("No jobs yet.")
        return
    st.markdown("#### Jobs")
    for j in rows:
        kind = {"completed": "good", "running": "info", "queued": "info", "failed": "bad", "cancelled": "warn",
                "interrupted": "warn"}.get(j["status"], "info")
        p = j["payload"] or {}
        c1, c2 = st.columns([5, 1])
        c1.markdown(f"`{j['id']}` " + badge(j["status"], kind) +
                    f" &nbsp;<span class='rw-muted'>{', '.join(p.get('datasets', []))} · {p.get('size')} · "
                    f"seeds {p.get('seeds')} · {', '.join(p.get('regimes', []))} · {len(p.get('policies', []))} policies</span>",
                    unsafe_allow_html=True)
        if j["status"] in ("queued", "running"):
            c1.progress(float(j["progress"] or 0), text=j["message"] or "")
            if c2.button("Cancel", key=f"cancel_{j['id']}"):
                jobs.cancel(db, j["id"])
        elif j["status"] == "completed" and j["result"]:
            c1.caption(f"{j['result']['runs']} runs in {j['result']['wall_seconds']:.0f}s → " + ", ".join(j["result"]["files"][:3]))
        elif j["error"]:
            c1.caption(j["error"].splitlines()[0][:300])


def show_results(summary: pd.DataFrame, prefix: str):
    from reporting import aggregate
    agg = aggregate(summary)
    st.caption(f"{len(summary)} runs · datasets {', '.join(sorted(summary.dataset.unique()))} · "
               f"seeds {sorted(int(s) for s in summary.seed.unique())} "
               f"· size {summary['size'].iloc[0]} · costs are simulated USD")
    fig = go.Figure()
    for p in [p for p in POLICIES if p in set(agg.policy)]:
        part = agg[agg.policy == p]
        fig.add_bar(x=[f"{a} · {b}" for a, b in zip(part.dataset, part.regime)], y=part.total_cost_mean,
                    error_y=dict(type="data", array=part.total_cost_std.fillna(0)), name=POLICY_LABELS[p],
                    marker_color=POLICY_COLORS[p])
    fig.update_layout(barmode="group", title="Mean total cost of ownership (± std over seeds)")
    st.plotly_chart(figure(fig, 380), use_container_width=True)
    cols = ["dataset", "regime", "policy", "seeds", "accuracy_mean", "accuracy_std", "macro_f1_mean", "full_updates_mean",
            "partial_updates_mean", "evaluations_mean", "rejected_actions_mean", "blocked_actions_mean",
            "budget_violations_mean", "operational_cost_mean", "error_cost_mean", "total_cost_mean", "total_cost_std",
            "tco_vs_best_online_pct", "runtime_seconds_mean", "decision_seconds_mean"]
    st.dataframe(agg[cols].round(4), use_container_width=True, hide_index=True)
    d1, d2, d3 = st.columns(3)
    d1.download_button("Export summary CSV", summary.to_csv(index=False), f"{prefix}_summary.csv", "text/csv")
    d2.download_button("Export aggregate CSV", agg.to_csv(index=False), f"{prefix}_aggregate.csv", "text/csv")
    details = ROOT / f"{prefix}_details.json"
    if details.exists():
        d3.download_button("Export details JSON", details.read_bytes(), details.name, "application/json")
    pngs = sorted(ROOT.glob(f"{prefix}_chart_*.png"))
    if pngs:
        with st.expander("Exported charts"):
            for png in pngs:
                st.image(str(png), caption=png.name)


def page_agent():
    header("Agent and audit", "Explanations with tool evidence, approvals, execution outcomes and the full audit log.")
    flash()
    status = ollama_status()
    c1, c2, c3 = st.columns([1.2, 1.2, 2])
    mode = c1.selectbox("Explanation mode", ["deterministic", "ollama"], index=["deterministic", "ollama"].index(cfg.agent_mode),
                        format_func=lambda m: "Deterministic (no LLM)" if m == "deterministic" else "Local Ollama (optional)")
    models = status["models"] or [cfg.ollama_model]
    preferred = next((i for i, m in enumerate(models) if m == cfg.ollama_model or m.startswith(cfg.ollama_model + ":")), 0)
    model = c2.selectbox("Ollama model", models, index=preferred, disabled=mode != "ollama")
    c3.markdown(badge(f"Ollama reachable · {len(status['models'])} model(s)", "good") if status["available"] else
                badge("Ollama not reachable - deterministic fallback will be used", "warn"), unsafe_allow_html=True)
    d = life.latest_decision(run["id"]) if run else None
    if st.button("🤖 Generate explanation for the latest decision", type="primary", disabled=d is None):
        spinner = "Querying the local model with bounded tools…" if mode == "ollama" else "Gathering tool evidence…"
        with st.spinner(spinner):
            result = explain(life, d, mode=mode, model=model)
        st.session_state["flash"] = f"Report #{result['report_id']} ({result['status']}, {result['duration_seconds']:.1f}s)."
        st.rerun()
    if d is None:
        st.caption("Create a decision in Decision analysis first.")
    reports = db.query("SELECT * FROM agent_reports ORDER BY id DESC LIMIT 8")
    for r in reports:
        label = f"Report #{r['id']} · {r['mode']}{' (' + r['model'] + ')' if r['model'] else ''} · {r['status']} · " \
                f"{r['created']} · {r['iterations']} iteration(s) · {r['duration_seconds']:.1f}s"
        with st.expander(label, expanded=r is reports[0]):
            st.markdown(md(r["report"]), unsafe_allow_html=True)
            if r["error"]:
                st.caption(f"Error: {r['error']}")
            calls = db.query("SELECT created, tool, arguments, status, result FROM agent_tool_calls WHERE report_id=? "
                             "ORDER BY id", (r["id"],))
            if calls:
                st.markdown("**Tool evidence**")
                st.dataframe(pd.DataFrame(calls), use_container_width=True, hide_index=True)
    st.markdown("#### Approvals and execution outcomes")
    st.dataframe(pd.DataFrame(db.query("SELECT * FROM approvals ORDER BY id DESC LIMIT 50")), use_container_width=True,
                 hide_index=True)
    st.markdown("#### Audit log")
    kinds = [r["kind"] for r in db.query("SELECT DISTINCT kind FROM events ORDER BY kind")]
    chosen = st.multiselect("Filter event kinds", kinds)
    sql = "SELECT id, created, kind, run_id, actor, payload FROM events"
    args: tuple = ()
    if chosen:
        sql += f" WHERE kind IN ({','.join('?' * len(chosen))})"
        args = tuple(chosen)
    events = db.query(sql + " ORDER BY id DESC LIMIT 500", args)
    st.dataframe(pd.DataFrame(events), use_container_width=True, hide_index=True)
    st.download_button("Export audit log (JSON)", json.dumps(events, indent=2), "retrainwise_audit.json", "application/json")


def page_settings():
    header("Settings", "Economic assumptions, guardrails, monitoring windows, model parameters, agent and autonomy.")
    flash()
    s = cfg.to_dict()
    with st.form("settings"):
        st.markdown("##### Economics (assumed USD)")
        e = st.columns(4)
        s["regime"] = e[0].selectbox("Cost regime", REGIMES, index=REGIMES.index(cfg.regime))
        s["error_value"] = e[1].number_input("Value of avoiding one error ($)", 0.0, 1e6, float(cfg.error_value), 0.1)
        s["horizon_predictions"] = int(e[2].number_input("Decision horizon (predictions)", 1, 10_000_000, cfg.horizon_predictions, 500))
        s["cost_trace_kind"] = e[3].selectbox("Compute price trace", ["flat", "diurnal", "spot", "custom"],
                                              index=["flat", "diurnal", "spot", "custom"].index(cfg.cost_trace_kind))
        e = st.columns(4)
        s["engineer_hourly_rate"] = e[0].number_input("Engineer hourly rate ($)", 0.0, 10_000.0, float(cfg.engineer_hourly_rate))
        s["incident_cost"] = e[1].number_input("Incident cost ($)", 0.0, 1e7, float(cfg.incident_cost))
        trace = e[2].text_input("Custom trace multipliers", ",".join(str(v) for v in cfg.cost_trace_custom))
        s["realization_prior"] = e[3].number_input("Realisation prior", 0.0, 1.5, float(cfg.realization_prior), 0.05)
        st.markdown("##### Guardrails")
        g = st.columns(4)
        s["budget"] = g[0].number_input("Cumulative budget ($)", 0.0, 1e9, float(cfg.budget), 100.0)
        s["action_limit"] = g[1].number_input("Per-action spending limit ($)", 0.0, 1e9, float(cfg.action_limit), 50.0)
        s["min_benefit"] = g[2].number_input("Minimum expected benefit ($)", 0.0, 1e9, float(cfg.min_benefit), 5.0)
        s["min_confidence"] = g[3].slider("Required P(net > 0)", 0.5, 0.99, float(cfg.min_confidence), 0.01)
        g = st.columns(4)
        s["min_evidence"] = int(g[0].number_input("Minimum hold-out labels", 1, 100_000, cfg.min_evidence))
        s["cooldown_batches"] = int(g[1].number_input("Cooldown (batches)", 0, 1000, cfg.cooldown_batches))
        s["max_batches_between_evaluations"] = int(g[2].number_input("Max batches between evaluations", 1, 1000,
                                                                     cfg.max_batches_between_evaluations))
        s["f1_tolerance"] = g[3].number_input("Validation macro-F1 tolerance", 0.0, 0.5, float(cfg.f1_tolerance), 0.01)
        st.markdown("##### Monitoring")
        m = st.columns(5)
        s["rolling_window"] = int(m[0].number_input("Rolling window (labels)", 10, 100_000, cfg.rolling_window))
        s["psi_threshold"] = m[1].number_input("PSI threshold", 0.01, 5.0, float(cfg.psi_threshold), 0.05)
        s["psi_bins"] = int(m[2].number_input("PSI bins", 2, 50, cfg.psi_bins))
        s["adwin_delta"] = m[3].number_input("ADWIN delta", 1e-6, 0.5, float(cfg.adwin_delta), format="%.4f")
        s["degradation_margin"] = m[4].number_input("Degradation margin", 0.0, 1.0, float(cfg.degradation_margin), 0.01)
        st.markdown("##### Stream and model (apply to new runs; batch size and labels apply immediately)")
        r = st.columns(5)
        s["batch_size"] = int(r[0].number_input("Batch size", 10, 100_000, cfg.batch_size, 50))
        s["initial_size"] = int(r[1].number_input("Initial training rows", 50, 1_000_000, cfg.initial_size, 100))
        s["train_window"] = int(r[2].number_input("Full-retrain window (rows)", 100, 1_000_000, cfg.train_window, 100))
        s["label_delay_batches"] = int(r[3].number_input("Label delay (batches)", 0, 100, cfg.label_delay_batches))
        s["label_fraction"] = r[4].number_input("Label availability", 0.01, 1.0, float(cfg.label_fraction), 0.05)
        r = st.columns(4)
        s["validation_fraction"] = r[0].number_input("Hold-out fraction", 0.05, 0.6, float(cfg.validation_fraction), 0.05)
        s["sgd_alpha"] = r[1].number_input("SGD alpha", 1e-7, 1.0, float(cfg.sgd_alpha), format="%.6f")
        s["sgd_epochs"] = int(r[2].number_input("SGD epochs", 1, 200, cfg.sgd_epochs))
        s["post_update_window"] = int(r[3].number_input("Post-update window (labels)", 10, 100_000, cfg.post_update_window))
        st.markdown("##### Agent and autonomy")
        a = st.columns(4)
        s["agent_mode"] = a[0].selectbox("Default explanation mode", ["deterministic", "ollama"],
                                         index=["deterministic", "ollama"].index(cfg.agent_mode))
        s["ollama_model"] = a[1].text_input("Ollama model tag", cfg.ollama_model)
        s["agent_max_iterations"] = int(a[2].number_input("Agent max iterations", 1, 12, cfg.agent_max_iterations))
        s["agent_timeout_seconds"] = int(a[3].number_input("Agent time budget (s)", 5, 600, cfg.agent_timeout_seconds))
        a = st.columns(3)
        s["autonomy"] = a[0].toggle("Bounded autonomy (opt-in)", cfg.autonomy,
                                    help="When on, a batch that triggers evaluation may execute the top action "
                                         "automatically if every guardrail and the limits below pass.")
        s["autonomy_max_actions"] = int(a[1].number_input("Max autonomous actions per run", 0, 100, cfg.autonomy_max_actions))
        s["autonomy_max_cost"] = a[2].number_input("Max autonomous action cost ($)", 0.0, 1e6, float(cfg.autonomy_max_cost))
        saved = st.form_submit_button("Save settings", type="primary")
    if saved:
        try:
            s["cost_trace_custom"] = [float(v) for v in trace.replace(" ", "").split(",") if v]
            life.save_settings(Settings.from_dict(s))
            st.session_state["flash"] = "Settings saved. Pending decisions were marked stale."
            st.rerun()
        except ValueError as exc:
            st.error(f"Not saved: {exc}")
    c1, c2 = st.columns(2)
    if c1.button("Reset to defaults"):
        life.save_settings(Settings(seed=cfg.seed))
        st.session_state["flash"] = "Defaults restored."
        st.rerun()
    c2.download_button("Export settings JSON", json.dumps(cfg.to_dict(), indent=2), "retrainwise_settings.json")
    with st.expander("Pricing snapshot (assumed reference prices)"):
        st.json(pricing())


ROUTES = dict(zip(PAGES, [page_overview, page_data, page_monitoring, page_decision, page_lifecycle,
                          page_experiments, page_agent, page_settings]))
try:
    ROUTES[page]()
except Exception as exc:  # show a clear error state and keep an audit record
    st.error(f"{type(exc).__name__}: {exc}")
    db.event("ui_error", {"page": page, "error": f"{type(exc).__name__}: {exc}"[:500]}, actor="ui")
