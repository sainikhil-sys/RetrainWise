"""Presentation helpers for app.py: theme-safe styling, cards, step tracker and
plain-language explanations. No business logic lives here."""
from __future__ import annotations

import html
from datetime import datetime, timezone

import streamlit as st

# Colours are expressed as translucent tints with inherited text colour so the
# same CSS reads well in Streamlit's light and dark themes.
CSS = """
<style>
.block-container { padding-top: 1.4rem; max-width: 1280px; }
h1 { font-size: 1.9rem !important; letter-spacing: -0.02em; margin-bottom: .1rem !important; }
.rw-purpose { opacity: .78; font-size: 1.02rem; margin: 0 0 .9rem 0; }
.rw-chip { display:inline-flex; align-items:center; gap:.35rem; padding:.12rem .6rem; border-radius:999px;
           font-size:.82rem; font-weight:600; border:1px solid; line-height:1.5; white-space:nowrap; }
.rw-good { background: rgba(26,127,55,.14); border-color: rgba(26,127,55,.55); }
.rw-warn { background: rgba(191,135,0,.16); border-color: rgba(191,135,0,.6); }
.rw-bad  { background: rgba(207,34,46,.14); border-color: rgba(207,34,46,.55); }
.rw-info { background: rgba(42,120,214,.14); border-color: rgba(42,120,214,.55); }
.rw-muted{ background: rgba(128,128,128,.12); border-color: rgba(128,128,128,.4); }
.rw-steps { display:flex; flex-wrap:wrap; gap:.4rem; margin:.2rem 0 1rem 0; }
.rw-step { display:flex; align-items:center; gap:.45rem; padding:.35rem .75rem; border-radius:10px;
           border:1px solid rgba(128,128,128,.35); font-size:.86rem; }
.rw-step b { display:inline-flex; width:1.35rem; height:1.35rem; border-radius:50%; align-items:center;
             justify-content:center; font-size:.75rem; border:1px solid rgba(128,128,128,.6); }
.rw-step.done b { background: rgba(26,127,55,.85); color:#fff; border-color: transparent; }
.rw-step.current { border:2px solid rgba(42,120,214,.9); background: rgba(42,120,214,.10); font-weight:600; }
.rw-big { font-size:1.7rem; font-weight:700; line-height:1.15; }
.rw-label { font-size:.82rem; opacity:.72; text-transform:uppercase; letter-spacing:.04em; }
.rw-story p { margin:.25rem 0; font-size:1.02rem; }
.rw-feed { display:flex; gap:.6rem; padding:.42rem 0; border-bottom:1px solid rgba(128,128,128,.18); }
.rw-feed .when { margin-left:auto; opacity:.6; font-size:.8rem; white-space:nowrap; }
.rw-flow { display:flex; flex-wrap:wrap; gap:.5rem; align-items:stretch; margin:.6rem 0 1rem 0; }
.rw-flow div { flex:1 1 150px; border:1px solid rgba(128,128,128,.35); border-radius:12px; padding:.7rem .8rem; }
.rw-flow div span { display:block; font-size:1.4rem; }
.rw-flow div strong { display:block; margin:.15rem 0; }
.rw-flow div small { opacity:.75; }
[data-testid="stMetric"] { border:1px solid rgba(128,128,128,.28); border-radius:12px; padding:.7rem .9rem; }
[data-testid="stMetricValue"] { font-size:1.55rem; }
</style>
"""

TONE_ICON = {"good": "✔", "warn": "▲", "bad": "✖", "info": "ℹ", "muted": "•"}


def inject_css() -> None:
    st.markdown(CSS, unsafe_allow_html=True)


def esc(text) -> str:
    """HTML-escape text for raw-HTML snippets; '$' is encoded so it never starts LaTeX."""
    return html.escape(str(text)).replace("$", "&#36;")


def chip(text: str, tone: str = "info", icon: str | None = None) -> str:
    """Status chip. Colour is never the only signal: an icon and words are included."""
    return f'<span class="rw-chip rw-{tone}">{icon or TONE_ICON[tone]} {esc(text)}</span>'


def md(text) -> str:
    """Escape '$' so Streamlit markdown does not treat amounts as LaTeX."""
    return str(text).replace("$", "\\$")


def money(v, signed: bool = False) -> str:
    if v is None:
        return "—"
    try:
        v = float(v)
    except (TypeError, ValueError):
        return "—"
    if v != v:
        return "—"
    sign = ("+" if v > 0 else "−" if v < 0 else "") if signed else ("−" if v < 0 else "")
    return f"{sign}${abs(v):,.2f}"


def pct(v, digits: int = 1) -> str:
    try:
        return "—" if v is None or float(v) != float(v) else f"{100 * float(v):.{digits}f}%"
    except (TypeError, ValueError):
        return "—"


def relative_time(iso: str | None) -> str:
    if not iso:
        return ""
    try:
        seconds = (datetime.now(timezone.utc) - datetime.fromisoformat(iso)).total_seconds()
    except ValueError:
        return iso
    for unit, size in (("d", 86400), ("h", 3600), ("min", 60)):
        if seconds >= size:
            return f"{int(seconds // size)} {unit} ago"
    return "just now"


def page_header(title: str, purpose: str, how: str | None = None) -> None:
    left, right = st.columns([4, 1.1], vertical_alignment="bottom")
    left.markdown(f"# {title}")
    left.markdown(f'<p class="rw-purpose">{esc(purpose)}</p>', unsafe_allow_html=True)
    if how:
        with right.popover("ℹ️ How it works", use_container_width=True):
            st.markdown(md(how))


# ------------------------------------------------------------------ glossary
GLOSSARY = {
    "Error rate": "Share of predictions that turned out wrong once the true answer (label) arrived.",
    "Reference error": "The error rate the current model was expected to have when it was deployed, measured on data it never saw.",
    "Label": "The true outcome for a past prediction. Labels can arrive late or not at all.",
    "Covariate shift (PSI)": "The incoming data looks different from the training data. PSI (Population Stability Index) measures how much. "
                             "Above about 0.2 is a notable shift. It does **not** prove the model got worse.",
    "Predictive degradation": "The model is actually making more mistakes, shown by labels. Detected by ADWIN, DDM or a rolling error "
                              "clearly above the reference.",
    "ADWIN / DDM": "Two standard statistical alarms that watch the stream of right/wrong predictions and fire when the error rate changes.",
    "Learning debt": "Extra mistakes made since the last update compared with what was expected; in dollars it is the cost of staying stale.",
    "Shadow evaluation": "Candidate models are trained on older data and tested on the newest labelled data, which nobody trained on, "
                         "to estimate how much an update would really help.",
    "Net expected value": "Expected savings from fewer mistakes minus the cost of the action. Waiting (defer) is the zero reference.",
    "Confidence P(net > 0)": "How likely the action is to pay for itself, given the uncertainty of the test.",
    "Realisation factor": "How much of the tested improvement past updates actually delivered afterwards (starts at 70%).",
    "Guardrails": "Safety rules every update must pass: enough evidence, not too soon after the last update, worth it, confident, "
                  "within the per-action limit and the budget.",
    "TCO": "Total cost of ownership = money spent on updates and evaluations + the cost of the mistakes the model made.",
}


def glossary() -> None:
    with st.popover("📖 Glossary", use_container_width=True):
        for term, meaning in GLOSSARY.items():
            st.markdown(f"**{term}**: {md(meaning)}")


# ---------------------------------------------------------- plain language
ACTION_PLAIN = {
    "defer": ("Wait", "⏸️", "Keep the current model and keep watching. Costs nothing now."),
    "partial": ("Quick update", "🩹", "Teach the current model the newest labelled data. Cheaper, smaller gain."),
    "full": ("Full retrain", "🔁", "Train a fresh model on recent data. Costlier, usually the largest gain."),
}

GUARD_PLAIN = {
    "candidate available / incremental compatibility": "no candidate model could be built",
    "minimum evidence": "not enough new labelled data to judge",
    "cooldown": "the model was updated too recently",
    "minimum expected benefit": "the expected gain is too small",
    "positive net expected value": "it would cost more than it saves",
    "confidence P(net > 0)": "not confident enough that it pays off",
    "action spending limit": "too expensive for a single action",
    "cumulative budget": "it would exceed the budget",
}


def blockers(row: dict) -> list[str]:
    return [GUARD_PLAIN.get(g["name"], g["name"]) for g in row.get("guardrails", []) if not g["passed"]]


STATUS_PLAIN = {
    "stable": ("Healthy", "good", "Predictions are as accurate as expected and the input data looks familiar."),
    "covariate shift only": ("Inputs changed, accuracy holding", "warn",
                             "The incoming data looks different from the training data, but labels show accuracy has not dropped. "
                             "That alone is not a reason to retrain."),
    "covariate shift (labels pending)": ("Inputs changed, waiting for labels", "warn",
                                         "The incoming data looks different; there are not enough labels yet to tell whether accuracy suffered."),
    "predictive degradation": ("Accuracy dropping", "bad",
                               "Labels show the model is making clearly more mistakes than expected; the relationship it learned has likely changed."),
    "covariate shift + predictive degradation": ("Inputs changed and accuracy dropping", "bad",
                                                 "The data looks different and the model is making clearly more mistakes."),
    "insufficient labels": ("Waiting for labels", "muted", "Not enough labelled outcomes yet to judge accuracy."),
}


def status_plain(status: str | None) -> tuple[str, str, str]:
    return STATUS_PLAIN.get(status or "", ("No data yet", "muted", "Process a batch to start monitoring."))


# ------------------------------------------------------------- step tracker
STEPS = ["Choose data", "Replay stream", "Check health", "Get recommendation", "Approve & validate", "Review & audit"]


def step_tracker(done: list[bool], current: int) -> None:
    parts = []
    for i, (name, ok) in enumerate(zip(STEPS, done)):
        cls = "rw-step" + (" done" if ok else "") + (" current" if i == current else "")
        parts.append(f'<div class="{cls}"><b>{"✓" if ok else i + 1}</b>{esc(name)}</div>')
    st.markdown(f'<div class="rw-steps">{"".join(parts)}</div>', unsafe_allow_html=True)


def how_it_works() -> None:
    steps = [("📥", "Watch", "Predict each batch, collect true outcomes as they arrive."),
             ("🩺", "Diagnose", "Separate 'data looks different' from 'model is wrong'."),
             ("🧪", "Test fixes", "Train candidate updates and test them on unseen recent data."),
             ("💰", "Weigh cost", "Compare savings from fewer mistakes with compute, people and risk costs."),
             ("✅", "Approve", "You approve; safety checks and a final validation decide promotion."),
             ("🔍", "Verify", "After an update, measure whether the gain was real.")]
    cells = "".join(f"<div><span>{i}</span><strong>{esc(t)}</strong><small>{esc(d)}</small></div>" for i, t, d in steps)
    st.markdown(f'<div class="rw-flow">{cells}</div>', unsafe_allow_html=True)


# ------------------------------------------------------------- activity feed
EVENT_TEXT = {
    "run_started": ("🚀", lambda p: f"Started a run on **{p.get('dataset')}** ({p.get('rows', 0):,} rows), model v{p.get('version', 0):03d}"),
    "batch_processed": ("📦", lambda p: f"Processed batch {p.get('batch')}: {status_plain(p.get('status'))[0].lower()}"),
    "decision_created": ("⚖️", lambda p: f"Evaluated options → recommended **{ACTION_PLAIN.get(p.get('recommended'), ('?',))[0]}**"),
    "approval": ("🖊️", lambda p: f"Approved **{ACTION_PLAIN.get(p.get('action'), ('?',))[0]}** ({p.get('mode')})"),
    "decision_promoted": ("✅", lambda p: f"Validation passed: {p.get('outcome')}"),
    "decision_rejected": ("⛔", lambda p: f"Update rejected: {p.get('outcome')}"),
    "decision_deferred": ("⏸️", lambda p: "Decided to wait and keep the current model"),
    "decision_failed": ("⚠️", lambda p: f"Execution failed: {p.get('outcome')}"),
    "rollback": ("↩️", lambda p: f"Rolled back from v{p.get('from_version', 0):03d} to v{p.get('to_version', 0):03d}"),
    "post_update_outcome": ("🔍", lambda p: f"Measured real gain of an update: {100 * (p.get('realized_reduction') or 0):+.1f} pts error"),
    "settings_saved": ("⚙️", lambda p: f"Settings changed: {', '.join(list(p.get('changed', {}))[:4]) or 'no values'}"),
    "agent_report": ("🤖", lambda p: f"Assistant report #{p.get('report')} ({p.get('mode')}, {p.get('status')})"),
    "execution_request_prepared": ("📝", lambda p: f"Assistant prepared a **{p.get('action')}** request (awaiting approval)"),
    "job_submitted": ("🧪", lambda p: f"Benchmark job {p.get('job')} submitted"),
    "job_completed": ("🏁", lambda p: f"Benchmark job {p.get('job')} finished"),
    "job_cancelled": ("✋", lambda p: f"Benchmark job {p.get('job')} cancelled"),
    "job_failed": ("⚠️", lambda p: f"Benchmark job {p.get('job')} failed"),
    "job_interrupted": ("⚠️", lambda p: f"Benchmark job {p.get('job')} was interrupted"),
}


def event_line(kind: str, payload: dict) -> tuple[str, str]:
    icon, fn = EVENT_TEXT.get(kind, ("•", lambda p: kind.replace("_", " ")))
    try:
        return icon, fn(payload or {})
    except Exception:  # unexpected payload shape: fall back to the event name
        return icon, kind.replace("_", " ")


def feed(events: list[dict]) -> None:
    rows = []
    for e in events:
        icon, text = event_line(e["kind"], e.get("payload_obj") or {})
        actor = "" if e["actor"] in ("system", "user") else f" · {esc(e['actor'])}"
        rows.append(f'<div class="rw-feed"><span>{icon}</span><span>{_md_bold(esc(text))}{actor}</span>'
                    f'<span class="when">{esc(relative_time(e["created"]))}</span></div>')
    st.markdown("".join(rows) or "<p>No activity yet.</p>", unsafe_allow_html=True)


def _md_bold(text: str) -> str:
    """Convert **bold** inside already-escaped HTML text; '$' becomes an entity (no LaTeX)."""
    parts = text.replace("$", "&#36;").split("**")
    return "".join(p if i % 2 == 0 else f"<b>{p}</b>" for i, p in enumerate(parts))
