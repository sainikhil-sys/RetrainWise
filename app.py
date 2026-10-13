"""RetrainWise - Streamlit application. Start with:  streamlit run app.py

Streamlit is the only application framework. SQLite (retrainwise.db) is the
source of truth; long benchmark jobs run in worker.py processes. Presentation
helpers live in ui.py; all decisions are made by pipeline/economics code.
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
import ui  # noqa: E402
from agent import explain, ollama_status  # noqa: E402
from config import REGIMES, ROOT, SAMPLE_SIZES, Settings  # noqa: E402
from database import loads  # noqa: E402
from datasets import (DATASETS, SOURCES, download, is_cached, load, read_provenance,  # noqa: E402
                      schema_preview, synthetic_metadata)
from economics import pricing, rank_actions  # noqa: E402
from experiments import POLICIES, POLICY_LABELS  # noqa: E402
from pipeline import Lifecycle, LifecycleError  # noqa: E402
from ui import ACTION_PLAIN, chip, md, money, pct  # noqa: E402

st.set_page_config(page_title="RetrainWise", page_icon="♻️", layout="wide", initial_sidebar_state="expanded")
ui.inject_css()

SERIES = {"blue": "#2a78d6", "orange": "#eb6834", "aqua": "#1baf7a", "yellow": "#eda100", "magenta": "#e87ba4",
          "green": "#008300", "violet": "#4a3aa7", "red": "#e34948", "grey": "#8a8984"}
POLICY_COLORS = {"retrainwise": SERIES["blue"], "calendar": SERIES["orange"], "drift_triggered": SERIES["aqua"],
                 "cara_ct_inspired": SERIES["yellow"], "never": SERIES["magenta"], "hindsight_oracle": SERIES["green"]}
POLICY_PLAIN = {
    "never": "Never update the model.",
    "calendar": "Fully retrain on a fixed schedule (every 10 batches), whatever is happening.",
    "drift_triggered": "Fully retrain whenever a drift alarm (ADWIN or DDM) fires, ignoring cost.",
    "cara_ct_inspired": "Retrain when accumulated extra mistakes cost more than a retrain (inspired by CARA-CT).",
    "retrainwise": "Test candidate updates, weigh savings against costs, apply guardrails and validation.",
    "hindsight_oracle": "Best possible full-retrain schedule chosen with knowledge of the future (a benchmark, not a real policy).",
}
DATASET_PLAIN = {
    "synthetic": "Generated locally with known drift points. Works offline; best for the demo.",
    "electricity": "Australian electricity price direction (up/down), real 30-minute history.",
    "airlines": "Flight delay prediction, half a million flights replayed in file order.",
    "covertype": "Forest cover type from map data, 7 classes, replayed in file order.",
}


def figure(fig: go.Figure, height: int = 320, percent: bool = False) -> go.Figure:
    fig.update_layout(height=height, margin=dict(l=8, r=8, t=44, b=8), hovermode="x unified",
                      legend=dict(orientation="h", y=-0.22), title=dict(font=dict(size=14)))
    fig.update_xaxes(showgrid=False)
    fig.update_yaxes(gridcolor="rgba(128,128,128,0.22)", tickformat=".0%" if percent else None)
    return fig


@st.cache_resource
def lifecycle() -> Lifecycle:
    life = Lifecycle()
    life.recover()            # executions in flight when the process stopped -> interrupted
    jobs.recover(life.db)     # workers that stopped heart-beating -> interrupted
    return life


life = lifecycle()
db = life.db
cfg = life.settings()
run = life.active_run()


# ------------------------------------------------------------ shared state
def telemetry() -> pd.DataFrame:
    if "_tel" not in st.session_state or st.session_state.get("_tel_key") != (run and (run["id"], run["position"])):
        st.session_state["_tel"] = life.telemetry(run["id"]) if run else pd.DataFrame()
        st.session_state["_tel_key"] = run and (run["id"], run["position"])
    return st.session_state["_tel"]


def last_batch() -> dict:
    tel = telemetry()
    return tel.iloc[-1].to_dict() if not tel.empty else {}


def latest_decision() -> dict | None:
    return life.latest_decision(run["id"]) if run else None


def flash(message: str, kind: str = "success") -> None:
    st.session_state["_flash"] = (message, kind)


def show_flash() -> None:
    item = st.session_state.pop("_flash", None)
    if item:
        getattr(st, item[1])(md(item[0]))


def progress_state() -> tuple[list[bool], dict]:
    """Which workflow steps are done, and the single most useful next step."""
    tel, d = telemetry(), latest_decision()
    has_run, has_batches = run is not None, not telemetry().empty if run else False
    # Steps describe the *current* cycle: a decision only counts if it was made at the current stream position.
    fresh = d is not None and d["position"] == (run or {}).get("position")
    resolved = fresh and d["status"] in ("promoted", "rejected", "deferred")
    done = [has_run, has_batches, has_batches, fresh, resolved, resolved]
    last = last_batch()
    if not has_run:
        nxt = {"label": "Start the offline demo", "page": "data", "why": "Pick a data stream to watch."}
    elif not has_batches:
        nxt = {"label": "Replay the first batches", "page": "data", "why": "The model needs to make predictions before anything can be measured."}
    elif d and d["status"] == "pending" and d["recommended"] != "defer":
        nxt = {"label": "Review and approve the recommendation", "page": "lifecycle",
               "why": f"RetrainWise recommends **{ACTION_PLAIN[d['recommended']][0]}**; nothing changes until you approve."}
    elif last.get("evaluation_suggested") and not fresh:
        nxt = {"label": "Check whether an update is worth it", "page": "decision",
               "why": "Monitoring found a reason to look: " + "; ".join(last.get("trigger_reasons") or []) + "."}
    else:
        nxt = {"label": "Replay more batches", "page": "data", "why": "Nothing needs attention right now; keep the stream moving."}
    return done, nxt


def next_step_card(current: int) -> None:
    done, nxt = progress_state()
    ui.step_tracker(done, current)
    if nxt["page"] == CURRENT_KEY.get("key"):
        return                      # the page itself is the next step; its own call-to-action is shown below
    with st.container(border=True):
        c1, c2 = st.columns([4, 1.4], vertical_alignment="center")
        c1.markdown(f"**Next step:** {nxt['label']}  \n{md(nxt['why'])}")
        if c2.button(f"Go → {PAGES[nxt['page']].title}", type="primary", use_container_width=True, key=f"next_{current}"):
            st.switch_page(PAGES[nxt["page"]])


def replay_buttons(key: str) -> None:
    """Process 1, 5 or 20 batches. Each call carries the expected position, so a rerun
    or double click can never process the same batch twice."""
    remaining = run["n_rows"] - run["position"]
    if remaining <= 0:
        st.success("End of stream reached. Start a new run to continue.")
        return
    batches_left = int(np.ceil(remaining / cfg.batch_size))
    cols = st.columns([1, 1, 1, 2.2], vertical_alignment="center")
    choice = None
    for col, n in zip(cols[:3], (1, 5, 20)):
        if col.button(f"▶ {'Next batch' if n == 1 else f'Next {n}'}", key=f"rp_{key}_{n}", use_container_width=True,
                      type="primary" if n == 1 else "secondary", disabled=n > 1 and batches_left < 2):
            choice = min(n, batches_left)
    cols[3].caption(f"{batches_left} batch(es) of {cfg.batch_size} rows left · each batch: predict → receive labels → update monitors")
    if choice:
        bar = st.progress(0.0, text="Predicting, collecting labels, updating monitors…")
        statuses = []
        for i in range(choice):
            current = life.run(run["id"])
            if current["position"] >= current["n_rows"]:
                break
            out = life.process_batch(run["id"], current["position"])
            if not out.get("noop"):
                statuses.append(out)
                if out.get("autonomy", {}).get("acted"):
                    st.toast(f"Bounded autonomy executed an update: {out['autonomy'].get('outcome')}")
            bar.progress((i + 1) / choice, text=f"Processed batch {out.get('batch_index', '?')}")
        if statuses:
            last = statuses[-1]
            title, tone, _ = ui.status_plain(last["status"])
            hint = " An update check is suggested." if last.get("evaluation_suggested") else ""
            flash(f"Processed {len(statuses)} batch(es). Latest: **{title}** "
                  f"(error {pct(last.get('batch_error'))}).{hint}", "warning" if tone == "bad" else "success")
        st.rerun()


def error_chart(tel: pd.DataFrame, height: int = 320) -> go.Figure:
    fig = go.Figure()
    fig.add_scatter(x=tel["end_row"], y=tel["batch_error"], name="Mistakes in each batch", mode="lines+markers",
                    line=dict(color=SERIES["blue"], width=2), marker=dict(size=6))
    fig.add_scatter(x=tel["end_row"], y=tel["rolling_error"], name="Recent average", line=dict(color=SERIES["orange"], width=2.5))
    fig.add_scatter(x=tel["end_row"], y=tel["reference_error"], name="Expected for this model",
                    line=dict(color=SERIES["grey"], dash="dot", width=1.5))
    for _, r in tel[tel["version"].diff().fillna(0) != 0].iterrows():
        fig.add_vline(x=r["start_row"], line=dict(color=SERIES["green"], width=1.5, dash="dash"))
        fig.add_annotation(x=r["start_row"], y=1, yref="paper", text=f"v{int(r['version']):03d}", showarrow=False,
                           font=dict(size=11), xanchor="left")
    fig.update_layout(title="Error rate over the stream (green lines = new model version)")
    fig.update_xaxes(title="Rows processed")
    return figure(fig, height, percent=True)


# ================================================================== pages
def page_overview():
    ui.page_header("Overview", "Is the model healthy, what has it cost, and what should happen next?",
                   "The **health story** is written from the latest monitoring numbers. The **step tracker** shows "
                   "where you are in the watch → test → approve cycle, and **Next step** always points to the most "
                   "useful action.")
    show_flash()
    if run is None:
        with st.container(border=True):
            st.markdown("### Update a model only when it pays off")
            st.markdown("RetrainWise watches a deployed machine-learning model. When its predictions get worse, it tests "
                        "possible fixes, compares the **money saved from fewer mistakes** with the **cost of the fix**, "
                        "and asks you to approve. Here is the cycle:")
            ui.how_it_works()
            c1, c2 = st.columns(2)
            if c1.button("🚀 Start the offline demo", type="primary", use_container_width=True):
                with st.spinner("Generating a stream with known drift and training the first model…"):
                    life.start_run("synthetic", "standard", cfg.seed)
                flash("Demo started: 20,000 rows of synthetic data with drift at rows 4,000, 8,000–12,000, 14,000 and 17,000. "
                      "Replay a few batches next.")
                st.rerun()
            c2.page_link(PAGES["data"], label="Or choose a real dataset", icon=":material/dataset:")
        return
    next_step_card(-1)
    last, d = last_batch(), latest_decision()
    left, right = st.columns([3, 2])
    with left, st.container(border=True):
        title, tone, explanation = ui.status_plain(last.get("status"))
        st.markdown(f'<div class="rw-label">Model health</div>{chip(title, tone)}', unsafe_allow_html=True)
        story = [explanation]
        if last:
            story.append(f"Model **v{run['active_version']:03d}** has made {last['predictions_since_update']:,} predictions "
                         f"since its last update. On recent outcomes it is wrong **{pct(last['rolling_error'])}** of the time, "
                         f"against **{pct(last['reference_error'])}** expected.")
            if last.get("shifted_features"):
                story.append(f"Biggest change in the input data: **{last['max_psi_feature']}** (PSI {last['max_psi']:.2f}).")
            story.append(f"Staying on this model has cost about **{money(last['learning_debt_cost'])}** in extra mistakes "
                         "since the last update (learning debt).")
        else:
            story.append("No batches processed yet.")
        st.markdown("\n\n".join(md(s) for s in story))
    with right, st.container(border=True):
        st.markdown('<div class="rw-label">Latest recommendation</div>', unsafe_allow_html=True)
        if d:
            top = d["ranked"][0]
            name, icon, _ = ACTION_PLAIN[top["action"]]
            kind = {"pending": "info", "promoted": "good", "rejected": "bad", "deferred": "good"}.get(d["status"], "warn")
            st.markdown(f'<div class="rw-big">{icon} {ui.esc(name)}</div>{chip(d["status"], kind)}', unsafe_allow_html=True)
            if top["action"] == "defer":
                st.markdown("No update paid for itself under the safety rules at that point.")
            else:
                st.markdown(md(f"Expected saving **{money(top['benefit'])}** for **{money(top['total_cost'])}** "
                               f"→ net **{money(top['net_value'], True)}**, {pct(top['prob_positive'], 0)} confident."))
            st.caption(f"Made at row {d['position']:,} · {d.get('outcome') or 'awaiting your decision'}")
            if d["position"] != run["position"]:
                st.markdown(chip(f"Earlier decision - the stream has moved {run['position'] - d['position']:,} rows since", "muted"),
                            unsafe_allow_html=True)
        else:
            st.markdown("No recommendation yet.")
            st.page_link(PAGES["decision"], label="Check whether an update is worth it", icon=":material/balance:")
    m = st.columns(3)
    labels = life.label_summary(run["id"])
    age = int(last.get("model_age_batches", 0) or 0)
    m[0].metric("Active model", f"v{run['active_version']:03d}", f"in use for {age} batch{'es' if age != 1 else ''}" if last else None,
                delta_color="off", help="Each promoted or rolled-back model gets a version number.")
    m[1].metric("Recent error rate", pct(last.get("rolling_error")),
                f"{100 * last['degradation']:+.1f} pts vs expected" if last.get("degradation") is not None else None,
                delta_color="inverse", help="Average share of wrong predictions over the latest labelled outcomes.")
    m[2].metric("Spent so far", money(run["spent"]), f"{pct(run['spent'] / cfg.budget if cfg.budget else 0, 0)} of {money(cfg.budget)}",
                delta_color="off", help="Simulated cost of evaluations and updates in this run, against the budget.")
    m = st.columns(3)
    m[0].metric("Cost of staleness", money(last.get("learning_debt_cost")), help=ui.GLOSSARY["Learning debt"])
    m[1].metric("Input drift (max PSI)", f"{last['max_psi']:.2f}" if last.get("max_psi") is not None else "—",
                last.get("max_psi_feature"), delta_color="off", help=ui.GLOSSARY["Covariate shift (PSI)"])
    m[2].metric("Outcomes received", f"{labels['revealed']:,}", f"{labels['available'] - labels['revealed']:,} still pending",
                delta_color="off", help=ui.GLOSSARY["Label"])
    tel = telemetry()
    c1, c2 = st.columns([3, 2])
    with c1:
        if tel.empty:
            st.info("Replay a batch to start the chart.")
        else:
            st.plotly_chart(error_chart(tel), use_container_width=True)
    with c2, st.container(border=True):
        st.markdown("**Recent activity**")
        events = db.query("SELECT created, kind, actor, payload FROM events WHERE run_id=? OR run_id IS NULL "
                          "ORDER BY id DESC LIMIT 8", (run["id"],))
        for e in events:
            e["payload_obj"] = loads(e["payload"])
        ui.feed(events)
        st.page_link(PAGES["audit"], label="Full audit log", icon=":material/history:")


def page_data():
    ui.page_header("Data and simulation", "Choose which stream the model sees, then replay it batch by batch.",
                   "Real datasets are downloaded only when you click **Download**. The app never swaps in synthetic data "
                   "for a missing real dataset. Rows are replayed in their original order; the provenance record shows "
                   "where each file came from and its checksums.")
    show_flash()
    if run:
        next_step_card(1)
        with st.container(border=True):
            st.markdown(f"#### Replaying **{run['dataset']}** · run `{run['id']}`")
            st.progress(min(1.0, run["position"] / run["n_rows"]),
                        text=f"Row {run['position']:,} of {run['n_rows']:,} · batch {run['batch_index']} · "
                             f"outcomes arrive after {cfg.label_delay_batches} batch(es) · "
                             f"{pct(cfg.label_fraction, 0)} of outcomes are ever revealed")
            if run["dataset"] == "synthetic":
                points = synthetic_metadata(run["n_rows"], run["seed"])["drift_points"]
                upcoming = [f"{k.replace('_', ' ')} at row {v:,}" for k, v in points.items() if v > run["position"]]
                st.caption("Known changes ahead: " + (", ".join(upcoming) if upcoming else "none - all drift points passed."))
            replay_buttons("data")
    st.markdown("#### Choose a data stream")
    c1, c2 = st.columns([1.2, 1])
    with c1:
        name = st.radio("Dataset", DATASETS, horizontal=False,
                        format_func=lambda d: f"{d.capitalize()}{'' if is_cached(d) else '  (not downloaded)'}",
                        captions=[DATASET_PLAIN[d] for d in DATASETS])
        s1, s2 = st.columns(2)
        size = s1.selectbox("How much of it", list(SAMPLE_SIZES), index=1,
                            format_func=lambda s: f"{s} · {SAMPLE_SIZES[s]:,} rows" if SAMPLE_SIZES[s] else f"{s} · all rows")
        seed = s2.number_input("Seed", 0, 2**31 - 1, int(cfg.seed),
                               help="Same seed = same run: controls model randomness, which outcomes arrive, price traces "
                                    "and the synthetic generator.")
    with c2, st.container(border=True):
        if name == "synthetic":
            meta = synthetic_metadata(SAMPLE_SIZES[size] or 50_000, int(seed))
            st.markdown("**Synthetic drift stream** · generated on this machine")
            for k, v in meta["drift_points"].items():
                st.markdown(f"- **{k.replace('_', ' ').capitalize()}** at row {v:,}: {meta['description'].get(k, '')}")
        else:
            src = SOURCES[name]
            prov = read_provenance(name)
            st.markdown(f"**{src['title']}** · [source page]({src['page']})")
            st.markdown(src["order"])
            if src.get("drop_reason"):
                st.caption("Note: " + src["drop_reason"])
            if prov:
                st.markdown(f"Cached **{prov['rows']:,} rows** · downloaded {prov['retrieved_utc'][:10]} · licence "
                            f"*{prov.get('licence', 'see source')}* · target `{prov['target_column']}`")
                with st.expander("Full provenance record"):
                    st.json({k: v for k, v in prov.items() if k not in ("dtypes", "columns")})
            else:
                st.warning("Not downloaded yet. Downloading is always explicit.")
            if st.button(f"⬇ {'Re-download' if prov else 'Download'} {name}", use_container_width=True):
                try:
                    with st.spinner(f"Downloading {name} and recording provenance…"):
                        info = download(name)
                    flash(f"Cached {info['rows']:,} rows of {name}.")
                    st.rerun()
                except Exception as exc:  # network or parse failure is shown, not hidden
                    st.error(f"Download failed: {exc}")
    if is_cached(name):
        try:
            preview = load(name, size, int(seed)).head(1_000) if name == "synthetic" else load(name, 1_000, int(seed))
            with st.expander("Preview columns and first rows"):
                t1, t2 = st.tabs(["Columns", "First rows"])
                t1.dataframe(schema_preview(preview), use_container_width=True, hide_index=True)
                t2.dataframe(preview.head(10), use_container_width=True)
        except Exception as exc:
            st.error(f"Could not read dataset: {exc}")
        confirm = st.checkbox("Close the current run and start this one instead", value=False) if run else True
        if st.button(f"Start a new run on {name}", type="primary", disabled=not confirm):
            with st.spinner("Loading data in its original order and training the first model…"):
                new = life.start_run(name, size, int(seed))
            flash(f"Run {new['id']} started on {name} ({new['n_rows']:,} rows). Replay a few batches next.")
            st.rerun()


def page_monitoring():
    ui.page_header("Monitoring", "Is the model getting worse, or is only the input data changing?",
                   "Two different things can happen. **Input drift**: the data looks different (measured by PSI), which "
                   "may or may not matter. **Accuracy drop**: outcomes show the model is wrong more often (measured "
                   "with labels by ADWIN, DDM and the rolling error). Only the second proves the model needs help.")
    if run is None:
        st.info("Start a run in **Data and simulation** first.")
        return
    tel = telemetry()
    if tel.empty:
        st.info("No batches yet.")
        replay_buttons("mon")
        return
    next_step_card(2)
    last = last_batch()
    c = st.columns(3)
    with c[0], st.container(border=True):
        tone = "bad" if last["predictive_signal"] else "good"
        st.markdown(f'<div class="rw-label">Prediction quality</div>'
                    f'{chip("Accuracy dropping" if last["predictive_signal"] else "Holding up", tone)}', unsafe_allow_html=True)
        st.markdown(md(f"Recent error **{pct(last['rolling_error'])}** vs **{pct(last['reference_error'])}** expected. "
                       f"ADWIN alarm: {'yes' if last['adwin_error_increase'] else 'no'} · DDM: {last['ddm_status']}."))
    with c[1], st.container(border=True):
        tone = "warn" if last["covariate_signal"] else "good"
        shifted = ", ".join(last.get("shifted_features") or []) or "none"
        st.markdown(f'<div class="rw-label">Input data</div>'
                    f'{chip("Looks different" if last["covariate_signal"] else "Looks familiar", tone)}', unsafe_allow_html=True)
        st.markdown(md(f"Shifted features: **{shifted}**. Largest PSI {last['max_psi']:.2f} on `{last['max_psi_feature']}`. "
                       f"Unseen categories: {pct(last['unseen_category_rate'])}."))
    with c[2], st.container(border=True):
        labels = life.label_summary(run["id"])
        coverage = labels["revealed"] / max(labels["predicted"], 1)
        st.markdown(f'<div class="rw-label">Outcomes (labels)</div>'
                    f'{chip(f"{pct(coverage, 0)} received", "info")}', unsafe_allow_html=True)
        st.markdown(md(f"{labels['revealed']:,} outcomes received, {labels['available'] - labels['revealed']:,} pending. "
                       f"{last['labels_since_update']:,} arrived since the last update."))
    tab1, tab2, tab3, tab4 = st.tabs(["📉 Accuracy over time", "🚨 Alarms & staleness", "🧭 Input drift", "🏷️ Outcomes & reference"])
    with tab1:
        st.plotly_chart(error_chart(tel), use_container_width=True)
        st.caption("When the orange line rises clearly above the dotted line, the model is wrong more often than expected.")
        fig = go.Figure()
        for col, color, label in (("batch_accuracy", SERIES["blue"], "Accuracy"), ("batch_f1", SERIES["aqua"], "F1 (balanced across classes)"),
                                  ("batch_precision", SERIES["violet"], "Precision"), ("batch_recall", SERIES["orange"], "Recall")):
            fig.add_scatter(x=tel["end_row"], y=tel[col], name=label, line=dict(color=color, width=2))
        fig.update_layout(title="Quality scores per batch (higher is better)")
        st.plotly_chart(figure(fig, 300, percent=True), use_container_width=True)
    with tab2:
        fig = go.Figure()
        fig.add_bar(x=tel["end_row"], y=tel["learning_debt_cost"], name="Cost of staleness ($)", marker_color=SERIES["blue"])
        top = float(tel["learning_debt_cost"].max() or 1) or 1
        for mask, y, name, symbol, color in ((tel["adwin_error_increase"].astype(bool), 1.08, "ADWIN alarm", "triangle-down", SERIES["red"]),
                                             (tel["ddm_status"] == "drift", 1.18, "DDM drift", "x", SERIES["violet"]),
                                             (tel["ddm_status"] == "warning", 1.18, "DDM warning", "circle-open", SERIES["violet"])):
            hits = tel[mask]
            fig.add_scatter(x=hits["end_row"], y=[top * y] * len(hits), mode="markers", name=name,
                            marker=dict(symbol=symbol, size=12, color=color))
        fig.update_layout(title="Extra mistakes since the last update (in $) and statistical alarms")
        st.plotly_chart(figure(fig, 320), use_container_width=True)
        st.caption("Bars grow while the model under-performs and reset when a new model is deployed. Markers show "
                   "when the error-rate alarms fired.")
        with st.expander("Show the numbers"):
            show = tel[["batch_index", "end_row", "version", "model_age_batches", "labels_since_update", "adwin_error_increase",
                        "ddm_status", "change_row", "degradation", "learning_debt", "evaluation_suggested"]]
            st.dataframe(show.iloc[::-1], use_container_width=True, hide_index=True)
    with tab3:
        psi_frame = pd.DataFrame(tel["psi"].tolist(), index=tel["end_row"]).T
        fig = go.Figure(go.Heatmap(z=psi_frame.values, x=psi_frame.columns, y=psi_frame.index, zmin=0,
                                   zmax=max(0.5, float(np.nanmax(psi_frame.values))),
                                   colorscale=[[0, "rgba(42,120,214,0.05)"], [0.4, "#86b6ef"], [0.7, "#2a78d6"], [1, "#0d366b"]],
                                   colorbar=dict(title="PSI"), hovertemplate="row %{x}<br>%{y}: PSI %{z:.3f}<extra></extra>"))
        fig.update_layout(title="How different each input looks from the training data (darker = more different)")
        st.plotly_chart(figure(fig, 360), use_container_width=True)
        st.caption(f"A feature is flagged when PSI ≥ {cfg.psi_threshold} and well above what random sampling alone "
                   "would produce. A flag says the data moved; it does not say the model got worse.")
    with tab4:
        fig = go.Figure()
        fig.add_bar(x=tel["end_row"], y=tel["labels_revealed"], name="Outcomes received", marker_color=SERIES["aqua"])
        fig.add_bar(x=tel["end_row"], y=tel["labels_pending"], name="Still waiting", marker_color=SERIES["yellow"])
        fig.update_layout(title="Outcomes arriving per batch", barmode="group")
        st.plotly_chart(figure(fig, 260), use_container_width=True)
        model = life.model(run["active_version"])
        st.markdown(f"The active model **v{run['active_version']:03d}** learned from rows {model.train_start:,}–"
                    f"{model.trained_until:,} ({model.n_train:,} rows). Drift is measured against that window.")
        with st.expander("Reference bins for a feature"):
            feature = st.selectbox("Feature", list(model.psi_reference))
            spec = model.psi_reference[feature]
            if spec["kind"] == "numeric":
                labels_ = [f"≤ {spec['edges'][0]:.4g}"] + [f"({a:.4g}, {b:.4g}]" for a, b in zip(spec["edges"][:-1], spec["edges"][1:])] \
                          + [f"> {spec['edges'][-1]:.4g}", "missing"]
            else:
                labels_ = spec["values"] + ["other / unseen", "missing"]
            st.dataframe(pd.DataFrame({"bin": labels_, "training count": spec["counts"]}), use_container_width=True, hide_index=True)
    with st.container(border=True):
        replay_buttons("mon")


def option_card(r: dict, recommended: str) -> None:
    name, icon, description = ACTION_PLAIN[r["action"]]
    with st.container(border=True):
        st.markdown(f'<div class="rw-big">{icon} {ui.esc(name)}</div>', unsafe_allow_html=True)
        if r["action"] == recommended:
            st.markdown(chip("Recommended", "good", "★"), unsafe_allow_html=True)
        elif r["feasible"]:
            st.markdown(chip("Allowed", "info"), unsafe_allow_html=True)
        else:
            st.markdown(chip("Blocked", "bad"), unsafe_allow_html=True)
        st.caption(description)
        if r["action"] == "defer":
            st.markdown(md("Cost **$0.00** · saving **$0.00** · net **$0.00**  \nThe reference every other option is compared with."))
            return
        ev = r["evidence"]
        if not ev.get("compatible"):
            st.markdown(md(f"Not possible right now: {ev.get('reason', 'no candidate')}."))
            return
        st.markdown(md(f"Cost **{money(r['total_cost'])}**  \nExpected saving **{money(r['benefit'])}** "
                       f"(range {money(r['benefit_ci'][0])} to {money(r['benefit_ci'][1])})  \n"
                       f"Net **{money(r['net_value'], True)}**"))
        st.progress(min(1.0, max(0.0, r["prob_positive"] or 0)), text=f"{pct(r['prob_positive'], 0)} confident it pays off")
        st.caption(md(f"Tested on {ev['n']} recent outcomes: wrong {pct(ev['incumbent_error'])} now → "
                      f"{pct(ev['candidate_error'])} with this update."))
        reasons = ui.blockers(r)
        if reasons:
            st.markdown("**Blocked because** " + "; ".join(reasons) + ".")


def page_decision():
    ui.page_header("Decision analysis", "Would updating the model pay for itself right now, and which kind of update?",
                   "RetrainWise trains candidate updates on older labelled data and tests them on the **newest** "
                   "labelled data, which no model has seen. The improvement it finds is turned into money "
                   "(mistakes avoided × value per mistake), reduced by how much past updates actually delivered, and compared "
                   "with the cost of the update. Safety rules (guardrails) can block an option even if it looks profitable.")
    if run is None:
        st.info("Start a run in **Data and simulation** first.")
        return
    show_flash()
    tel, last = telemetry(), last_batch()
    next_step_card(3)
    current = latest_decision()
    with st.container(border=True):
        c1, c2 = st.columns([3, 1.3], vertical_alignment="center")
        if current and current["position"] == run["position"]:
            c1.markdown("✔ Options were already evaluated at this point in the stream. Evaluating again returns the same "
                        "result at no extra cost; replay more batches to get new evidence.")
        elif last.get("evaluation_suggested"):
            c1.markdown("**Monitoring suggests checking now** because " + md("; ".join(last["trigger_reasons"])) + ".")
        else:
            c1.markdown("Monitoring sees no strong reason to check, but you can evaluate at any time. "
                        "An evaluation has a small simulated cost.")
        if c2.button("⚖ Evaluate options now", type="primary", disabled=tel.empty, use_container_width=True):
            with st.spinner("Training candidate updates and testing them on the newest outcomes…"):
                d = life.evaluate(run["id"])
            flash(f"Evaluation done: recommend **{ACTION_PLAIN[d['recommended']][0]}**.")
            st.rerun()
    d = latest_decision()
    if not d:
        st.info("No evaluation yet for this run.")
        return
    top = d["ranked"][0]
    name, icon, _ = ACTION_PLAIN[top["action"]]
    stale = d["status"] != "pending"
    old = d["position"] != run["position"]
    st.markdown(f"### {icon} {'Last recommendation' if old else 'Recommendation'}: {name}")
    if old:
        st.info(f"This was decided at row {d['position']:,}; the stream is now at row {run['position']:,}. "
                "Press **Evaluate options now** for a current answer.")
    pending_label = ("no action needed", "good") if d["recommended"] == "defer" else ("awaiting your approval", "info")
    status_line = {"pending": pending_label, "promoted": ("carried out", "good"),
                   "rejected": ("rejected at execution", "bad"), "deferred": ("approved to wait", "good"),
                   "stale": ("out of date - the stream moved on", "warn")}.get(d["status"], (d["status"], "warn"))
    st.markdown(chip(status_line[0], status_line[1]) + f" &nbsp;<span style='opacity:.7'>made at row {d['position']:,} "
                f"for model v{d['version']:03d}</span>", unsafe_allow_html=True)
    if top["action"] == "defer":
        reasons = sorted({b for r in d["ranked"] if r["action"] != "defer" for b in ui.blockers(r)})
        st.markdown(md("No update clears every safety rule with a positive return, so the safe choice is to wait"
                       + (": " + "; ".join(reasons) + "." if reasons else ".")))
    else:
        st.markdown(md(f"Expected to avoid mistakes worth **{money(top['benefit'])}** over the next "
                       f"{cfg.horizon_predictions:,} predictions, for a cost of **{money(top['total_cost'])}** "
                       f"→ net **{money(top['net_value'], True)}**, {pct(top['prob_positive'], 0)} confident."))
    if not d["evaluation"]["charged"]:
        st.warning(md(f"No candidates were tested: {d['evaluation']['note']}."))
    cols = st.columns(3)
    order = {"full": 0, "partial": 1, "defer": 2}
    for col, r in zip(cols, sorted(d["ranked"], key=lambda r: order[r["action"]])):
        with col:
            option_card(r, d["recommended"])
    if d["status"] == "pending" and d["recommended"] != "defer":
        st.page_link(PAGES["lifecycle"], label="Review and approve this recommendation →", icon=":material/task_alt:")
    elif stale:
        st.caption("This decision is no longer pending. Evaluate again to get a fresh one.")
    acts = [r for r in d["ranked"] if r["action"] != "defer"]
    with st.expander("Where the costs come from", expanded=False):
        a, b = st.columns(2)
        fig = go.Figure()
        for key, color in zip(("compute", "engineering", "validation", "deployment_risk"),
                              (SERIES["blue"], SERIES["orange"], SERIES["aqua"], SERIES["yellow"])):
            fig.add_bar(x=[ACTION_PLAIN[r["action"]][0] for r in acts], y=[r["costs"][key] for r in acts],
                        name=key.replace("_", " "), marker_color=color)
        fig.update_layout(barmode="stack", title="Cost per option (simulated $)")
        a.plotly_chart(figure(fig, 300), use_container_width=True)
        fig = go.Figure()
        fig.add_bar(x=[ACTION_PLAIN[r["action"]][0] for r in acts], y=[r["benefit"] for r in acts], name="Expected saving",
                    marker_color=SERIES["green"],
                    error_y=dict(type="data", symmetric=False, array=[r["benefit_ci"][1] - r["benefit"] for r in acts],
                                 arrayminus=[r["benefit"] - r["benefit_ci"][0] for r in acts]))
        fig.add_bar(x=[ACTION_PLAIN[r["action"]][0] for r in acts], y=[r["total_cost"] for r in acts], name="Cost",
                    marker_color=SERIES["red"])
        fig.update_layout(barmode="group", title="Saving (with uncertainty) vs cost")
        b.plotly_chart(figure(fig, 300), use_container_width=True)
        st.caption("Compute uses an assumed cloud price; engineering and validation are assumed engineer hours; "
                   "deployment risk = chance of a bad release × its cost. All simulated.")
    with st.expander("Would the answer change under different assumptions?"):
        sens = pd.DataFrame(d["sensitivity"])
        sens["recommended"] = sens["recommended"].map(lambda a: ACTION_PLAIN[a][0])
        st.dataframe(sens.rename(columns={"scenario": "if…", "recommended": "then recommend",
                                          "net_partial": "net: quick update", "net_full": "net: full retrain"}),
                     use_container_width=True, hide_index=True,
                     column_config={c: st.column_config.NumberColumn(format="$%.2f") for c in ("net: quick update", "net: full retrain")})
        st.markdown("**Try your own** (does not change the stored decision)")
        w1, w2, w3 = st.columns(3)
        ev_mult = w1.slider("Value of avoiding a mistake ×", 0.1, 5.0, 1.0, 0.1)
        hz_mult = w2.slider("Prediction horizon ×", 0.1, 5.0, 1.0, 0.1)
        regime = w3.selectbox("Cost level", REGIMES, index=REGIMES.index(cfg.regime))
        evidence = {r["action"]: r["evidence"] for r in acts}
        alt = cfg.replace(error_value=cfg.error_value * ev_mult, regime=regime,
                          horizon_predictions=max(1, int(cfg.horizon_predictions * hz_mult)))
        what = rank_actions(evidence, dict(d["context"], horizon=alt.horizon_predictions), alt)
        st.markdown(md(f"→ would recommend **{ACTION_PLAIN[what['recommended']][0]}** "
                       f"({', '.join(f'{ACTION_PLAIN[r['action']][0]}: {money(r['net_value'], True)}' for r in what['ranked'])})"))
    with st.expander("Technical details: guardrails, evidence, assumptions"):
        st.markdown("**Guardrails**")
        st.dataframe(pd.DataFrame([{"option": ACTION_PLAIN[r["action"]][0], "rule": g["name"],
                                    "result": "✔ pass" if g["passed"] else "✖ fail", "detail": g["detail"]}
                                   for r in d["ranked"] for g in r["guardrails"]]), use_container_width=True, hide_index=True)
        st.markdown("**Evidence from the hold-out test**")
        st.dataframe(pd.DataFrame([{"option": ACTION_PLAIN[r["action"]][0],
                                    **{k: v for k, v in r["evidence"].items() if not isinstance(v, dict)}} for r in acts]),
                     use_container_width=True, hide_index=True)
        st.markdown("**Assumptions**")
        for item in d["assumptions"]:
            st.markdown(f"- {md(item)}")
        st.code(d["justification"], language=None)
        st.json(d, expanded=False)


def page_lifecycle():
    ui.page_header("Model lifecycle", "Approve updates, see what each model version is, and roll back if needed.",
                   "Nothing changes the model without approval (or the opt-in bounded autonomy). After you approve, "
                   "RetrainWise re-checks the safety rules, verifies the model file has not been tampered with, and re-tests the "
                   "candidate on held-out data. If any check fails, the current model stays and the reason is recorded.")
    if run is None:
        st.info("Start a run in **Data and simulation** first.")
        return
    show_flash()
    next_step_card(4)
    d = latest_decision()
    reg = life.registry(run["id"])
    meta = {int(r["version"]): loads(r["metadata"]) or {} for _, r in reg.iterrows()} if not reg.empty else {}
    active_meta = meta.get(run["active_version"], {})
    left, right = st.columns([3, 2])
    with left, st.container(border=True):
        st.markdown("#### Approve an action")
        if d and d["status"] == "pending":
            options = [r["action"] for r in d["ranked"]]
            by = {r["action"]: r for r in d["ranked"]}

            def label(a: str) -> str:
                r = by[a]
                tag = "★ recommended" if a == d["recommended"] else ("allowed" if r["feasible"] else "blocked by safety rules")
                return md(f"{ACTION_PLAIN[a][1]} {ACTION_PLAIN[a][0]} · net {money(r['net_value'], True)} · {tag}")
            with st.form("approve"):
                action = st.radio("Option", options, format_func=label, index=0)
                approver = st.text_input("Your name (recorded in the audit log)", value=st.session_state.get("approver", ""))
                ok = st.checkbox("I approve this action")
                submitted = st.form_submit_button("Approve and run checks", type="primary")
            st.caption("Then: ① safety rules re-checked → ② model file checksum verified → ③ re-tested on held-out data → "
                       "④ promoted, or rejected with the reason.")
            if submitted:
                if not ok or not approver.strip():
                    st.error("Tick the approval box and enter your name.")
                else:
                    st.session_state["approver"] = approver
                    try:
                        with st.spinner("Running the checks…"):
                            result = life.execute(d["id"], action, approver, approved=True)
                        verdict = {"promoted": "✅ Promoted", "rejected": "⛔ Not promoted", "deferred": "⏸️ Keeping the current model"}
                        flash(f"{verdict.get(result['status'], result['status'])}: {result['outcome']}",
                              "success" if result["status"] != "rejected" else "warning")
                        st.rerun()
                    except (LifecycleError, PermissionError) as exc:
                        st.error(str(exc))
        elif d:
            st.markdown(md(f"The latest recommendation is **{d['status']}** ({d.get('outcome') or ''}). "
                           "There is nothing to approve right now."))
            st.page_link(PAGES["decision"], label="Evaluate options again", icon=":material/balance:")
        else:
            st.markdown("No recommendation yet.")
            st.page_link(PAGES["decision"], label="Check whether an update is worth it", icon=":material/balance:")
    with right, st.container(border=True):
        st.markdown("#### Model in use")
        st.markdown(f'<div class="rw-big">v{run["active_version"]:03d}</div>', unsafe_allow_html=True)
        row = reg[reg["version"] == run["active_version"]].iloc[0] if not reg.empty else None
        if row is not None:
            how = {"initial": "first model", "full": "full retrain", "partial": "quick update"}.get(row["action"], row["action"])
            st.markdown(md(f"Created by a **{how}**{', approved by ' + active_meta['approved_by'] if active_meta.get('approved_by') else ''}. "
                           f"Learned from rows {int(row['train_start']):,}–{int(row['train_end']):,}. "
                           f"Expected error **{pct(active_meta.get('reference_error'))}**."))
        post = run["monitor_state"].get("post_update")
        outcomes = run["monitor_state"].get("outcomes") or []
        if post:
            st.progress(min(1.0, post["n"] / cfg.post_update_window),
                        text=f"Checking the real gain vs v{post['old_version']:03d}: {post['n']}/{cfg.post_update_window} outcomes")
        if outcomes:
            o = outcomes[-1]
            st.markdown(md(f"Last measured update: predicted **{100 * o['predicted_reduction']:+.1f}** pts, "
                           f"really **{100 * o['realized_reduction']:+.1f}** pts fewer errors."))
    pending = db.query("SELECT * FROM execution_requests WHERE status='awaiting_approval' ORDER BY id DESC")
    if pending:
        with st.container(border=True):
            st.markdown("#### Requests prepared by the assistant (not executed)")
            for req in pending:
                c1, c2, c3 = st.columns([4, 1, 1])
                c1.markdown(md(f"**{ACTION_PLAIN[req['action']][0]}** for decision `{req['decision_id']}`  \n*{req['rationale']}*"))
                name = st.session_state.get("approver", "")
                if c2.button("Approve", key=f"ar{req['id']}", disabled=not name):
                    try:
                        result = life.execute(req["decision_id"], req["action"], name, approved=True, request_id=req["id"])
                        flash(f"Request #{req['id']}: {result['status']} - {result['outcome']}")
                    except (LifecycleError, PermissionError) as exc:
                        flash(f"Request #{req['id']} not executed: {exc}", "warning")
                    st.rerun()
                if c3.button("Dismiss", key=f"dr{req['id']}"):
                    life.dismiss_request(req["id"], name or "user")
                    st.rerun()
            if not st.session_state.get("approver"):
                st.caption("Approve once with your name in the form above to enable these buttons.")
    st.markdown("#### Version history")
    tones = {"active": "good", "archived": "muted", "rolled_back": "warn", "rejected": "bad"}
    how_made = {"initial": "first model", "full": "full retrain", "partial": "quick update"}
    for _, r in reg.iterrows():
        m = meta.get(int(r["version"]), {})
        who = f" · approved by {m['approved_by']}" if m.get("approved_by") else ""
        detail = (f"validation failed: {', '.join(c['check'] for c in (m.get('validation') or {}).get('checks', []) if not c['passed'])}"
                  if r["status"] == "rejected" else f"expected error {pct(m.get('reference_error'))}")
        st.markdown(f'{chip(r["status"].replace("_", " "), tones.get(r["status"], "muted"))} &nbsp;'
                    f'<b>v{int(r["version"]):03d}</b> · {ui.esc(how_made.get(r["action"], r["action"]))}{ui.esc(who)} · '
                    f'{ui.esc(detail)} · <span style="opacity:.65">{ui.esc(ui.relative_time(r["created"]))}</span>',
                    unsafe_allow_html=True)
    rollable = reg[reg["status"].isin(["archived", "rolled_back"])]["version"].tolist() if not reg.empty else []
    with st.expander("↩ Roll back to an earlier version", expanded=False):
        if rollable:
            with st.form("rollback"):
                version = st.selectbox("Version to restore", rollable, format_func=lambda v: f"v{v:03d}")
                who = st.text_input("Your name", value=st.session_state.get("approver", ""))
                why = st.text_input("Reason")
                ok = st.checkbox("I approve rolling back the model in use")
                go_rb = st.form_submit_button("Roll back")
            if go_rb:
                try:
                    life.rollback(int(version), who, approved=ok, reason=why)
                    flash(f"Rolled back to v{int(version):03d}. Monitoring restarted for that model.")
                    st.rerun()
                except (LifecycleError, PermissionError) as exc:
                    st.error(str(exc))
        else:
            st.caption("No earlier versions to restore yet.")
    with st.expander("Technical records: registry and decisions"):
        if not reg.empty:
            st.dataframe(reg.assign(sha256=reg["sha256"].fillna("").str[:12]).drop(columns=["metadata"]),
                         use_container_width=True, hide_index=True)
        st.dataframe(pd.DataFrame(db.query("SELECT id, created, position, version, recommended, status, outcome FROM decisions "
                                           "WHERE run_id=? ORDER BY created DESC", (run["id"],))),
                     use_container_width=True, hide_index=True)
        if outcomes:
            st.markdown("**Measured gains of past updates** (these calibrate future estimates)")
            st.dataframe(pd.DataFrame(outcomes), use_container_width=True, hide_index=True)


def page_experiments():
    ui.page_header("Experiments", "How would different update strategies have done on the same data and costs?",
                   "Each strategy replays exactly the same stream, outcomes and price changes. **Total cost of ownership** "
                   "= money spent on updates + the cost of the mistakes the model made. Lower is better. The hindsight "
                   "oracle cheats by knowing the future, so it shows how much room is left.")
    show_flash()
    with st.expander("What strategies are compared?"):
        for p in POLICIES:
            st.markdown(f"- **{POLICY_LABELS[p]}**: {POLICY_PLAIN[p]}")
    cached = [d for d in DATASETS if is_cached(d)]
    with st.container(border=True):
        st.markdown("#### Run a new comparison")
        with st.form("experiment"):
            c1, c2 = st.columns(2)
            names = c1.multiselect("Datasets", cached, default=["synthetic"])
            policies = c2.multiselect("Strategies", POLICIES, default=list(POLICIES), format_func=POLICY_LABELS.get)
            c3, c4, c5 = st.columns(3)
            regimes = c3.multiselect("Cost levels", REGIMES, default=["balanced"])
            size = c4.selectbox("Data size", list(SAMPLE_SIZES), index=0,
                                format_func=lambda s: f"{s} · {SAMPLE_SIZES[s]:,} rows" if SAMPLE_SIZES[s] else f"{s} · all rows")
            seeds_text = c5.text_input("Seeds (repeat runs)", "1,2", help="Comma-separated; more seeds show how much results vary.")
            start = st.form_submit_button("Start comparison", type="primary")
        st.caption("Runs in a separate background process; you can keep using the app or cancel it. "
                   "Small synthetic comparisons take about 20 seconds.")
        missing = [d for d in DATASETS if d not in cached]
        if missing:
            st.caption(f"Not downloaded yet (see Data and simulation): {', '.join(missing)}")
    if start:
        try:
            seeds = [int(s) for s in seeds_text.replace(" ", "").split(",") if s]
            job_id, created = jobs.submit(db, {"datasets": names, "policies": policies, "regimes": regimes,
                                               "seeds": seeds, "size": size, "settings": cfg.to_dict()})
            flash(f"Comparison {job_id} {'started' if created else 'is already running with these settings'}.")
            st.rerun()
        except ValueError as exc:
            st.error(str(exc))
    job_panel()
    st.markdown("#### Results")
    files = sorted({p.name[:-len("_summary.csv")] for p in ROOT.glob("*_summary.csv")})
    if not files:
        st.caption("No results yet.")
        return
    labels = {f: ("Main benchmark (216 runs)" if f == "results" else "Complete datasets" if f == "results_full"
                  else f"Comparison {f.replace('experiment_', '')}") for f in files}
    prefix = st.selectbox("Result set", files, index=files.index("results") if "results" in files else 0,
                          format_func=labels.get)
    show_results(pd.read_csv(ROOT / f"{prefix}_summary.csv"), prefix)


@st.fragment(run_every="2s")
def job_panel():
    jobs.recover(db)
    rows = jobs.jobs(db, 5)
    if not rows:
        return
    with st.container(border=True):
        st.markdown("#### Background jobs")
        for j in rows:
            tone = {"completed": "good", "running": "info", "queued": "info", "failed": "bad", "cancelled": "warn",
                    "interrupted": "warn"}.get(j["status"], "muted")
            p = j["payload"] or {}
            c1, c2 = st.columns([5, 1], vertical_alignment="center")
            c1.markdown(chip(j["status"], tone) + f" &nbsp;<b>{ui.esc(j['id'])}</b> · {ui.esc(', '.join(p.get('datasets', [])))} · "
                        f"{ui.esc(p.get('size'))} · seeds {ui.esc(p.get('seeds'))} · {ui.esc(', '.join(p.get('regimes', [])))}",
                        unsafe_allow_html=True)
            if j["status"] in ("queued", "running"):
                c1.progress(float(j["progress"] or 0), text=j["message"] or "")
                if c2.button("Cancel", key=f"cancel_{j['id']}", use_container_width=True):
                    jobs.cancel(db, j["id"])
            elif j["status"] == "completed" and j["result"]:
                c1.caption(f"{j['result']['runs']} runs in {j['result']['wall_seconds']:.0f}s · saved as experiment_{j['id']}")
            elif j["error"]:
                c1.caption(j["error"].splitlines()[0][:300])


def show_results(summary: pd.DataFrame, prefix: str):
    from reporting import aggregate
    agg = aggregate(summary)
    online = agg[agg.policy != "hindsight_oracle"]
    st.caption(f"{len(summary)} runs · {', '.join(sorted(summary.dataset.unique()))} · seeds "
               f"{sorted(int(s) for s in summary.seed.unique())} · size {summary['size'].iloc[0]} · simulated costs")
    if not online.empty:
        winners = online.loc[online.groupby(["dataset", "regime"])["total_cost_mean"].idxmin()]
        rw = agg[agg.policy == "retrainwise"]
        k = st.columns(3)
        k[0].metric("Cases where RetrainWise was cheapest", f"{int((winners.policy == 'retrainwise').sum())} of {len(winners)}",
                    help="Among strategies that cannot see the future (the oracle is excluded).")
        if not rw.empty:
            k[1].metric("Typical gap to the cheapest strategy", f"{rw['tco_vs_best_online_pct'].median():+.1f}%",
                        help="Median over dataset × cost level. 0% means RetrainWise was the cheapest.")
            ranks = online.pivot_table(index=["dataset", "regime"], columns="policy", values="total_cost_mean").rank(axis=1).mean()
            k[2].metric("Average rank of RetrainWise", f"{ranks.get('retrainwise', float('nan')):.2f}",
                        f"out of {online.policy.nunique()}", delta_color="off")
        table = winners.assign(cheapest=winners.policy.map(POLICY_LABELS)).pivot(index="dataset", columns="regime", values="cheapest")
        st.markdown("**Cheapest realistic strategy per dataset and cost level**")
        st.dataframe(table[[r for r in REGIMES if r in table.columns]], use_container_width=True)
    fig = go.Figure()
    for p in [p for p in POLICIES if p in set(agg.policy)]:
        part = agg[agg.policy == p]
        fig.add_bar(x=[f"{a} · {b}" for a, b in zip(part.dataset, part.regime)], y=part.total_cost_mean,
                    error_y=dict(type="data", array=part.total_cost_std.fillna(0)), name=POLICY_LABELS[p],
                    marker_color=POLICY_COLORS[p])
    fig.update_layout(barmode="group", title="Total cost of ownership (mean ± spread over seeds; lower is better)")
    st.plotly_chart(figure(fig, 400), use_container_width=True)
    with st.expander("Full results table and downloads"):
        cols = ["dataset", "regime", "policy", "seeds", "accuracy_mean", "macro_f1_mean", "full_updates_mean",
                "partial_updates_mean", "evaluations_mean", "rejected_actions_mean", "blocked_actions_mean",
                "budget_violations_mean", "operational_cost_mean", "error_cost_mean", "total_cost_mean", "total_cost_std",
                "tco_vs_best_online_pct", "runtime_seconds_mean"]
        st.dataframe(agg[cols].round(4), use_container_width=True, hide_index=True)
        d1, d2, d3 = st.columns(3)
        d1.download_button("Summary CSV", summary.to_csv(index=False), f"{prefix}_summary.csv", "text/csv")
        d2.download_button("Aggregate CSV", agg.to_csv(index=False), f"{prefix}_aggregate.csv", "text/csv")
        details = ROOT / f"{prefix}_details.json"
        if details.exists():
            d3.download_button("Details JSON", details.read_bytes(), details.name, "application/json")
    pngs = sorted(ROOT.glob(f"{prefix}_chart_*.png"))
    if pngs:
        with st.expander("Report charts"):
            for png in pngs:
                st.image(str(png), caption=png.name)


def page_agent():
    ui.page_header("Agent and audit", "Plain-language explanations of decisions, and a record of everything that happened.",
                   "The assistant reads the same evidence through a few read-only tools and writes an explanation. It "
                   "cannot change anything; at most it can prepare a request that you approve. Without a local Ollama "
                   "model, a template-based explanation (no AI) is used. An automatic check warns if an AI explanation "
                   "recommends something different from the decision engine.")
    show_flash()
    status = ollama_status()
    d = latest_decision()
    with st.container(border=True):
        c1, c2, c3 = st.columns([1.3, 1.3, 2], vertical_alignment="bottom")
        mode = c1.selectbox("Explanation style", ["deterministic", "ollama"], index=["deterministic", "ollama"].index(cfg.agent_mode),
                            format_func=lambda m: "Template (no AI, instant)" if m == "deterministic" else "Local AI via Ollama (slow on CPU)")
        models = status["models"] or [cfg.ollama_model]
        preferred = next((i for i, m in enumerate(models) if m == cfg.ollama_model or m.startswith(cfg.ollama_model + ":")), 0)
        model = c2.selectbox("Ollama model", models, index=preferred, disabled=mode != "ollama")
        c3.markdown(chip(f"Ollama ready · {len(status['models'])} model(s)", "good") if status["available"] else
                    chip("Ollama not running - template mode will be used", "warn"), unsafe_allow_html=True)
        if st.button("🤖 Explain the latest decision", type="primary", disabled=d is None):
            with st.spinner("Gathering evidence…" if mode == "deterministic" else "Asking the local model (can take a few minutes)…"):
                result = explain(life, d, mode=mode, model=model)
            flash(f"Explanation ready ({result['status']}, {result['duration_seconds']:.0f}s).",
                  "warning" if result["status"] != "completed" else "success")
            st.rerun()
        if d is None:
            st.caption("Create a recommendation in Decision analysis first.")
    reports = db.query("SELECT * FROM agent_reports ORDER BY id DESC LIMIT 6")
    if reports:
        latest = reports[0]
        tone = {"completed": "good", "completed_with_warning": "warn", "fallback": "warn"}.get(latest["status"], "muted")
        with st.container(border=True):
            st.markdown(chip(latest["status"].replace("_", " "), tone) +
                        f" &nbsp;<b>Explanation #{latest['id']}</b> · {ui.esc(latest['mode'])}"
                        f"{' · ' + ui.esc(latest['model']) if latest['model'] else ''} · "
                        f"{ui.esc(ui.relative_time(latest['created']))}", unsafe_allow_html=True)
            st.markdown(md(latest["report"]), unsafe_allow_html=True)
            calls = db.query("SELECT created, tool, arguments, status, result FROM agent_tool_calls WHERE report_id=? ORDER BY id",
                             (latest["id"],))
            if calls:
                with st.expander(f"Evidence the assistant looked at ({len(calls)} tool calls)"):
                    st.dataframe(pd.DataFrame(calls), use_container_width=True, hide_index=True)
        if len(reports) > 1:
            with st.expander("Earlier explanations"):
                for r in reports[1:]:
                    st.markdown(f"**#{r['id']}** · {r['mode']}{' (' + r['model'] + ')' if r['model'] else ''} · {r['status']} · "
                                f"{ui.relative_time(r['created'])}")
                    st.markdown(md(r["report"][:1500] + ("…" if len(r["report"]) > 1500 else "")), unsafe_allow_html=True)
                    st.divider()
    st.markdown("#### Activity log")
    kinds = [r["kind"] for r in db.query("SELECT DISTINCT kind FROM events ORDER BY kind")]
    chosen = st.multiselect("Show only", kinds, format_func=lambda k: k.replace("_", " "),
                            help="Individual assistant tool calls are hidden unless selected here; they are listed "
                                 "under each explanation.")
    sql = "SELECT id, created, kind, run_id, actor, payload FROM events"
    args: tuple = ()
    if chosen:
        sql += f" WHERE kind IN ({','.join('?' * len(chosen))})"
        args = tuple(chosen)
    else:
        sql += " WHERE kind NOT IN ('agent_tool_call')"
    events = db.query(sql + " ORDER BY id DESC LIMIT 300", args)
    for e in events:
        e["payload_obj"] = loads(e["payload"])
    with st.container(border=True, height=420):
        ui.feed(events[:120])
    c1, c2 = st.columns(2)
    with c1.expander("Approval record"):
        st.dataframe(pd.DataFrame(db.query("SELECT created, decision_id, action, actor, mode, outcome FROM approvals ORDER BY id DESC")),
                     use_container_width=True, hide_index=True)
    with c2.expander("Raw event table"):
        st.dataframe(pd.DataFrame([{k: v for k, v in e.items() if k != "payload_obj"} for e in events]),
                     use_container_width=True, hide_index=True)
    st.download_button("Export activity log (JSON)", json.dumps([{k: v for k, v in e.items() if k != "payload_obj"} for e in events],
                                                               indent=2), "retrainwise_audit.json", "application/json")


def page_settings():
    ui.page_header("Settings", "The assumptions and safety limits RetrainWise decides with.",
                   "Money values are **assumptions** used by the simulated cost model, not real bills. Saving settings "
                   "marks any pending recommendation as out of date, because it was computed with the old values.")
    show_flash()
    s = cfg.to_dict()
    with st.form("settings"):
        t1, t2, t3, t4, t5 = st.tabs(["💰 Money", "🛡️ Safety limits", "📈 Monitoring", "🧠 Data & model", "🤖 Assistant & autonomy"])
        with t1:
            e = st.columns(3)
            s["regime"] = e[0].selectbox("Cost level", REGIMES, index=REGIMES.index(cfg.regime),
                                         help="cheap = small server, little review; expensive = GPU, sign-offs, higher risk.")
            s["error_value"] = e[1].number_input("Value of avoiding one mistake ($)", 0.0, 1e6, float(cfg.error_value), 0.1)
            s["horizon_predictions"] = int(e[2].number_input("Predictions an update will serve", 1, 10_000_000,
                                                              cfg.horizon_predictions, 500,
                                                              help="How many future predictions benefit from an update."))
            e = st.columns(3)
            s["engineer_hourly_rate"] = e[0].number_input("Engineer cost per hour ($)", 0.0, 10_000.0, float(cfg.engineer_hourly_rate))
            s["incident_cost"] = e[1].number_input("Cost of a bad release ($)", 0.0, 1e7, float(cfg.incident_cost))
            s["cost_trace_kind"] = e[2].selectbox("How compute prices vary", ["flat", "diurnal", "spot", "custom"],
                                                  index=["flat", "diurnal", "spot", "custom"].index(cfg.cost_trace_kind),
                                                  help="flat = constant; diurnal = daily cycle; spot = volatile with spikes.")
            trace = st.text_input("Custom price multipliers (used when 'custom' is selected)",
                                  ",".join(str(v) for v in cfg.cost_trace_custom))
            s["realization_prior"] = st.slider("Share of tested gains assumed to really happen (before any evidence)", 0.0, 1.5,
                                               float(cfg.realization_prior), 0.05)
        with t2:
            g = st.columns(2)
            s["budget"] = g[0].number_input("Total budget per run ($)", 0.0, 1e9, float(cfg.budget), 100.0)
            s["action_limit"] = g[1].number_input("Maximum cost of one action ($)", 0.0, 1e9, float(cfg.action_limit), 50.0)
            g = st.columns(2)
            s["min_benefit"] = g[0].number_input("Minimum expected saving ($)", 0.0, 1e9, float(cfg.min_benefit), 5.0)
            s["min_confidence"] = g[1].slider("Required confidence that an update pays off", 0.5, 0.99, float(cfg.min_confidence), 0.01)
            g = st.columns(3)
            s["min_evidence"] = int(g[0].number_input("Minimum test outcomes", 1, 100_000, cfg.min_evidence))
            s["cooldown_batches"] = int(g[1].number_input("Batches to wait after an update", 0, 1000, cfg.cooldown_batches))
            s["f1_tolerance"] = g[2].number_input("Allowed F1 drop in validation", 0.0, 0.5, float(cfg.f1_tolerance), 0.01)
        with t3:
            m = st.columns(3)
            s["rolling_window"] = int(m[0].number_input("Outcomes in the recent average", 10, 100_000, cfg.rolling_window))
            s["psi_threshold"] = m[1].number_input("Input-drift threshold (PSI)", 0.01, 5.0, float(cfg.psi_threshold), 0.05)
            s["psi_bins"] = int(m[2].number_input("PSI bins", 2, 50, cfg.psi_bins))
            m = st.columns(3)
            s["adwin_delta"] = m[0].number_input("ADWIN sensitivity (delta)", 1e-6, 0.5, float(cfg.adwin_delta), format="%.4f",
                                                 help="Smaller = fewer false alarms but slower detection.")
            s["degradation_margin"] = m[1].number_input("Error increase that counts as real", 0.0, 1.0, float(cfg.degradation_margin), 0.01)
            s["max_batches_between_evaluations"] = int(m[2].number_input("Check at least every N batches", 1, 1000,
                                                                         cfg.max_batches_between_evaluations))
        with t4:
            r = st.columns(3)
            s["batch_size"] = int(r[0].number_input("Rows per batch", 10, 100_000, cfg.batch_size, 50))
            s["initial_size"] = int(r[1].number_input("Rows for the first model", 50, 1_000_000, cfg.initial_size, 100))
            s["train_window"] = int(r[2].number_input("Rows used by a full retrain", 100, 1_000_000, cfg.train_window, 100))
            r = st.columns(3)
            s["label_delay_batches"] = int(r[0].number_input("Outcome delay (batches)", 0, 100, cfg.label_delay_batches))
            s["label_fraction"] = r[1].number_input("Share of outcomes ever received", 0.01, 1.0, float(cfg.label_fraction), 0.05)
            s["validation_fraction"] = r[2].number_input("Share held back for testing", 0.05, 0.6, float(cfg.validation_fraction), 0.05)
            r = st.columns(3)
            s["sgd_alpha"] = r[0].number_input("Regularisation (alpha)", 1e-7, 1.0, float(cfg.sgd_alpha), format="%.6f")
            s["sgd_epochs"] = int(r[1].number_input("Training passes", 1, 200, cfg.sgd_epochs))
            s["post_update_window"] = int(r[2].number_input("Outcomes used to verify an update", 10, 100_000, cfg.post_update_window))
            st.caption("Batch size and outcome settings apply immediately; the others apply to new runs and new candidates.")
        with t5:
            a = st.columns(2)
            s["agent_mode"] = a[0].selectbox("Default explanation style", ["deterministic", "ollama"],
                                             index=["deterministic", "ollama"].index(cfg.agent_mode),
                                             format_func=lambda m: "Template (no AI)" if m == "deterministic" else "Local AI via Ollama")
            s["ollama_model"] = a[1].text_input("Ollama model tag", cfg.ollama_model)
            a = st.columns(2)
            s["agent_max_iterations"] = int(a[0].number_input("Assistant max steps", 1, 12, cfg.agent_max_iterations))
            s["agent_timeout_seconds"] = int(a[1].number_input("Assistant time limit (s)", 5, 600, cfg.agent_timeout_seconds))
            st.divider()
            s["autonomy"] = st.toggle("Allow automatic updates within limits (bounded autonomy)", cfg.autonomy,
                                      help="Off = every update needs your approval. On = when monitoring asks for a check and an "
                                           "update passes every safety rule and the limits below, it is executed automatically.")
            a = st.columns(2)
            s["autonomy_max_actions"] = int(a[0].number_input("Max automatic updates per run", 0, 100, cfg.autonomy_max_actions))
            s["autonomy_max_cost"] = a[1].number_input("Max cost of an automatic update ($)", 0.0, 1e6, float(cfg.autonomy_max_cost))
        saved = st.form_submit_button("Save settings", type="primary")
    if saved:
        try:
            s["cost_trace_custom"] = [float(v) for v in trace.replace(" ", "").split(",") if v]
            life.save_settings(Settings.from_dict(s))
            flash("Settings saved. Any pending recommendation was marked out of date.")
            st.rerun()
        except ValueError as exc:
            st.error(f"Not saved: {exc}")
    c1, c2 = st.columns(2)
    if c1.button("Restore defaults"):
        life.save_settings(Settings(seed=cfg.seed))
        flash("Default settings restored.")
        st.rerun()
    c2.download_button("Export settings (JSON)", json.dumps(cfg.to_dict(), indent=2), "retrainwise_settings.json")
    with st.expander("Assumed price list (pricing_snapshot.json)"):
        st.json(pricing())


# ============================================================== navigation
PAGES = {
    "overview": st.Page(page_overview, title="Overview", icon=":material/dashboard:", default=True),
    "data": st.Page(page_data, title="Data and simulation", icon=":material/dataset:", url_path="data"),
    "monitoring": st.Page(page_monitoring, title="Monitoring", icon=":material/monitor_heart:", url_path="monitoring"),
    "decision": st.Page(page_decision, title="Decision analysis", icon=":material/balance:", url_path="decision"),
    "lifecycle": st.Page(page_lifecycle, title="Model lifecycle", icon=":material/task_alt:", url_path="lifecycle"),
    "experiments": st.Page(page_experiments, title="Experiments", icon=":material/science:", url_path="experiments"),
    "audit": st.Page(page_agent, title="Agent and audit", icon=":material/smart_toy:", url_path="audit"),
    "settings": st.Page(page_settings, title="Settings", icon=":material/tune:", url_path="settings"),
}
CURRENT_KEY: dict = {}
nav = st.navigation({"Operate": [PAGES["overview"], PAGES["data"], PAGES["monitoring"]],
                     "Decide": [PAGES["decision"], PAGES["lifecycle"]],
                     "Analyse": [PAGES["experiments"], PAGES["audit"]],
                     "Configure": [PAGES["settings"]]})
CURRENT_KEY["key"] = next((k for k, p in PAGES.items() if p.title == nav.title), None)

with st.sidebar:
    if run:
        with st.container(border=True):
            last = last_batch()
            title, tone, _ = ui.status_plain(last.get("status"))
            st.markdown(f"**{run['dataset'].capitalize()}** · model v{run['active_version']:03d}<br>{chip(title, tone)}",
                        unsafe_allow_html=True)
            st.progress(min(1.0, run["position"] / run["n_rows"]), text=f"row {run['position']:,} of {run['n_rows']:,}")
            st.caption(md(f"Spent {money(run['spent'])} of {money(cfg.budget)}"))
    else:
        st.info("No run yet - start one from Overview.")
    st.markdown(chip("Automatic updates ON (bounded)", "warn") if cfg.autonomy else
                chip("Approval required for every update", "good"), unsafe_allow_html=True)
    ui.glossary()
    st.caption("Training, predictions and metrics are real. Prices, engineer hours and release risk are **simulated** "
               "assumptions; deployment is a local model swap.")

try:
    nav.run()
except Exception as exc:  # show a clear error state and keep an audit record
    st.error(f"Something went wrong: {type(exc).__name__}: {exc}")
    db.event("ui_error", {"page": CURRENT_KEY.get("key"), "error": f"{type(exc).__name__}: {exc}"[:500]}, actor="ui")
