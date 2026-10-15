"""Validated, serializable settings for RetrainWise.

All monetary values are *assumed* USD used by the simulated cost model. Nothing
in this file talks to a billing account. Settings are persisted in SQLite by
``pipeline.Lifecycle`` and an example copy lives in ``settings.example.json``.
"""
from __future__ import annotations

import json
import math
from dataclasses import asdict, dataclass, field, fields
from pathlib import Path

ROOT = Path(__file__).resolve().parent
DATA_ROOT = ROOT                        # shared dataset caches (data_<name>.csv.gz + provenance)
WORKSPACES_ROOT = ROOT / "workspaces"   # one engine database + artifacts per workspace
DB_PATH = ROOT / "retrainwise.db"
LOG_PATH = ROOT / "retrainwise.log"
PRICING_PATH = ROOT / "pricing_snapshot.json"

REGIMES = ("cheap", "balanced", "expensive")
COST_TRACE_KINDS = ("flat", "diurnal", "spot", "custom")
PROBE_MODES = ("adaptive", "fixed")
BENEFIT_BASES = ("probe", "holdout")
AGENT_MODES = ("deterministic", "ollama", "openai")
ESTIMATORS = ("sgd_logistic",)

# Experiment sample-size configurations (rows taken from the start of the
# source-ordered stream; ``None`` means the complete dataset).
SAMPLE_SIZES = {"small": 5_000, "standard": 20_000, "full": None}


@dataclass
class Settings:
    # Stream and reproducibility
    seed: int = 42
    batch_size: int = 500
    initial_size: int = 1_000
    label_delay_batches: int = 0
    label_fraction: float = 1.0

    # Model
    estimator: str = "sgd_logistic"
    sgd_alpha: float = 1e-4
    sgd_epochs: int = 15
    train_window: int = 3_000          # recent labelled rows used by full retraining
    validation_fraction: float = 0.3   # chronological hold-out share of the window
    f1_tolerance: float = 0.02         # validation gate: candidate macro-F1 may not drop more

    # Monitoring
    rolling_window: int = 1_000
    psi_bins: int = 10
    psi_threshold: float = 0.2
    adwin_delta: float = 0.002
    ddm_min_instances: int = 30
    degradation_margin: float = 0.02
    max_batches_between_evaluations: int = 10
    post_update_window: int = 500

    # Probe model and difference-in-differences staleness (staleness.py)
    probe_mode: str = "adaptive"       # adaptive = value-of-information scheduling; fixed = every probe_every batches
    probe_every: int = 2               # fixed schedule interval (batches)
    probe_min_interval: int = 1        # adaptive: never probe more often than this (batches)
    probe_max_interval: int = 6        # adaptive: always probe at least this often (batches)
    probe_window: int = 500            # most recent labelled rows the cheap probe model is trained on
    probe_folds: int = 5               # cross-fitting folds over the newly labelled rows
    probe_epochs: int = 3              # SGD epochs for the probe (cheaper than a full retrain)
    probe_min_labels: int = 50         # minimum newly labelled rows to score a probe on
    probe_baseline_probes: int = 2     # probes pooled into the post-deployment baseline gap
    probe_drift_sd: float = 0.01       # belief drift of avoidable error per batch without a probe
    monitoring_budget: float = 300.0   # cumulative simulated spend allowed for probes per run
    partial_recovery_prior: float = 0.5   # prior share of avoidable error a partial update recovers
    full_recovery_prior: float = 0.9      # prior share of avoidable error a full retrain recovers
    recovery_prior_weight: float = 2.0
    # Which estimate drives expected benefit: the probe difference-in-differences
    # avoidable error (research approach, default) or the chronological hold-out
    # reduction (v1 rule). See RESEARCH_REPORT.md for how they compare.
    benefit_basis: str = "probe"

    # Economics
    regime: str = "balanced"
    cost_trace_kind: str = "diurnal"
    cost_trace_custom: tuple = (1.0,)
    horizon_predictions: int = 5_000
    error_value: float = 1.0           # assumed USD value of avoiding one error
    engineer_hourly_rate: float = 80.0
    incident_cost: float = 1_000.0     # assumed USD cost of a bad deployment
    realization_prior: float = 0.7     # prior share of shadow-estimated gain that is realised
    realization_prior_weight: float = 2.0

    # Guardrails
    min_evidence: int = 150            # minimum chronological validation labels
    cooldown_batches: int = 2
    min_benefit: float = 10.0
    min_confidence: float = 0.8        # required P(net value > 0)
    action_limit: float = 1_000.0      # maximum simulated spend for one action
    budget: float = 3_000.0            # cumulative simulated spend per run

    # Baselines (benchmark only)
    calendar_every_batches: int = 10
    oracle_max_checkpoints: int = 60

    # Agent and autonomy
    agent_mode: str = "deterministic"
    ollama_model: str = "llama3.1"
    # Open-source models served by any OpenAI-compatible endpoint (Groq, OpenRouter,
    # Together, Hugging Face, LM Studio, vLLM, Ollama's /v1). The API key is read
    # from the LLM_API_KEY environment variable and is never stored in settings.
    llm_base_url: str = "https://api.groq.com/openai/v1"
    llm_model: str = "llama-3.3-70b-versatile"
    agent_timeout_seconds: int = 240
    agent_max_iterations: int = 6
    autonomy: bool = False
    autonomy_max_actions: int = 3
    autonomy_max_cost: float = 200.0

    INTEGER_FIELDS = (
        "seed", "batch_size", "initial_size", "label_delay_batches", "sgd_epochs",
        "train_window", "rolling_window", "psi_bins", "ddm_min_instances",
        "max_batches_between_evaluations", "post_update_window", "horizon_predictions",
        "min_evidence", "cooldown_batches", "calendar_every_batches",
        "oracle_max_checkpoints", "agent_timeout_seconds", "agent_max_iterations",
        "autonomy_max_actions", "probe_every", "probe_min_interval", "probe_max_interval", "probe_window",
        "probe_epochs", "probe_min_labels", "probe_baseline_probes", "probe_folds",
    )

    def validate(self) -> "Settings":
        for f in fields(self):
            value = getattr(self, f.name)
            if isinstance(value, bool):
                continue
            if isinstance(value, (int, float)):
                if not math.isfinite(value) or value < 0:
                    raise ValueError(f"{f.name} must be finite and non-negative (got {value!r})")
        for name in self.INTEGER_FIELDS:
            value = getattr(self, name)
            if isinstance(value, bool) or not isinstance(value, int):
                raise ValueError(f"{name} must be an integer")
        if self.batch_size < 10 or self.batch_size > 100_000:
            raise ValueError("batch_size must be between 10 and 100000")
        if self.initial_size < 50:
            raise ValueError("initial_size must be at least 50")
        if self.train_window < 100:
            raise ValueError("train_window must be at least 100")
        if not 0.05 <= self.validation_fraction <= 0.6:
            raise ValueError("validation_fraction must be between 0.05 and 0.6")
        if not 0 < self.label_fraction <= 1:
            raise ValueError("label_fraction must be in (0, 1]")
        if not 0 < self.adwin_delta < 1:
            raise ValueError("adwin_delta must be in (0, 1)")
        if not 0 < self.min_confidence < 1:
            raise ValueError("min_confidence must be in (0, 1)")
        if not 0 <= self.realization_prior <= 1.5:
            raise ValueError("realization_prior must be in [0, 1.5]")
        if self.sgd_alpha <= 0 or self.sgd_epochs < 1:
            raise ValueError("sgd_alpha must be positive and sgd_epochs at least 1")
        if self.psi_bins < 2 or self.psi_bins > 50:
            raise ValueError("psi_bins must be between 2 and 50")
        if min(self.rolling_window, self.horizon_predictions, self.min_evidence,
               self.calendar_every_batches, self.oracle_max_checkpoints,
               self.agent_max_iterations, self.agent_timeout_seconds) < 1:
            raise ValueError("windows, horizon, evidence and limits must be at least 1")
        if self.agent_max_iterations > 12 or self.agent_timeout_seconds > 600:
            raise ValueError("agent limits too large (max 12 iterations, 600 seconds)")
        if self.benefit_basis not in BENEFIT_BASES:
            raise ValueError(f"benefit_basis must be one of {BENEFIT_BASES}")
        if self.probe_mode not in PROBE_MODES:
            raise ValueError(f"probe_mode must be one of {PROBE_MODES}")
        if min(self.probe_every, self.probe_min_interval, self.probe_max_interval, self.probe_epochs,
               self.probe_baseline_probes) < 1:
            raise ValueError("probe intervals, epochs and baseline probes must be at least 1")
        if self.probe_min_interval > self.probe_max_interval:
            raise ValueError("probe_min_interval cannot exceed probe_max_interval")
        if not 2 <= self.probe_folds <= 20:
            raise ValueError("probe_folds must be between 2 and 20")
        if self.probe_window < 100 or self.probe_min_labels < 10:
            raise ValueError("probe_window must be at least 100 and probe_min_labels at least 10")
        if not 0 <= self.partial_recovery_prior <= 1.5 or not 0 <= self.full_recovery_prior <= 1.5:
            raise ValueError("recovery priors must be in [0, 1.5]")
        if self.regime not in REGIMES:
            raise ValueError(f"regime must be one of {REGIMES}")
        if self.cost_trace_kind not in COST_TRACE_KINDS:
            raise ValueError(f"cost_trace_kind must be one of {COST_TRACE_KINDS}")
        if self.agent_mode not in AGENT_MODES:
            raise ValueError(f"agent_mode must be one of {AGENT_MODES}")
        if self.estimator not in ESTIMATORS:
            raise ValueError(f"estimator must be one of {ESTIMATORS}")
        trace = tuple(self.cost_trace_custom)
        if not trace or len(trace) > 1_000 or any(
                isinstance(v, bool) or not isinstance(v, (int, float)) or not math.isfinite(v) or v <= 0
                for v in trace):
            raise ValueError("cost_trace_custom needs 1-1000 positive finite multipliers")
        self.cost_trace_custom = tuple(float(v) for v in trace)
        name = self.ollama_model
        if not isinstance(name, str) or not 0 < len(name) <= 80 or not all(
                ch.isalnum() or ch in "._:-/" for ch in name):
            raise ValueError("ollama_model must be a short model tag such as llama3.1")
        url = self.llm_base_url
        if not isinstance(url, str) or not url.startswith(("http://", "https://")) or len(url) > 200 or any(
                ch.isspace() for ch in url):
            raise ValueError("llm_base_url must be an http(s) URL such as https://api.groq.com/openai/v1")
        self.llm_base_url = url.rstrip("/")
        name = self.llm_model
        if not isinstance(name, str) or not 0 < len(name) <= 120 or not all(
                ch.isalnum() or ch in "._:-/@" for ch in name):
            raise ValueError("llm_model must be a model id such as llama-3.3-70b-versatile")
        return self

    def to_dict(self) -> dict:
        data = asdict(self)
        data["cost_trace_custom"] = list(self.cost_trace_custom)
        return data

    @classmethod
    def from_dict(cls, data: dict | None) -> "Settings":
        data = dict(data or {})
        known = {f.name for f in fields(cls)}
        unknown = set(data) - known
        if unknown:
            raise ValueError(f"Unknown settings: {sorted(unknown)}")
        if "cost_trace_custom" in data:
            data["cost_trace_custom"] = tuple(data["cost_trace_custom"])
        return cls(**data).validate()

    def replace(self, **changes) -> "Settings":
        data = self.to_dict()
        data.update(changes)
        return Settings.from_dict(data)


def load_example(path: Path | None = None) -> Settings:
    path = Path(path or ROOT / "settings.example.json")
    return Settings.from_dict(json.loads(path.read_text(encoding="utf-8")))


def write_example(path: Path | None = None) -> Path:
    path = Path(path or ROOT / "settings.example.json")
    path.write_text(json.dumps(Settings().to_dict(), indent=2) + "\n", encoding="utf-8")
    return path


def safe_child(name: str, root: Path = ROOT) -> Path:
    """Resolve a bare file name inside the project folder; reject traversal."""
    if not isinstance(name, str) or not name or Path(name).name != name or name.startswith("."):
        raise ValueError(f"Unsafe file name: {name!r}")
    path = (root / name).resolve()
    if path.parent != Path(root).resolve():
        raise ValueError(f"Unsafe file name: {name!r}")
    return path
