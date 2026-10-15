"""Dataset acquisition, caching, provenance and the reproducible synthetic stream.

* Real datasets are only obtained through the explicit ``download`` function
  (Next.js "Data and simulation" page or ``python datasets.py electricity airlines covertype``).
* ``load`` never substitutes synthetic data for a missing real dataset; it
  raises ``FileNotFoundError`` with the command needed to fetch it.
* Rows are kept in source order. Each source documents whether that order is a
  genuine time order or a stream replay.
"""
from __future__ import annotations

import argparse
import gzip
import hashlib
import io
import json
import urllib.request
import zipfile
from pathlib import Path

import numpy as np
import pandas as pd
from scipy.io import arff

from config import DATA_ROOT as ROOT, SAMPLE_SIZES  # dataset caches live in DATA_ROOT (configurable)
from database import now

USER_AGENT = "RetrainWise/1.0 (research prototype; contact: local user)"

COVERTYPE_COLUMNS = (
    ["Elevation", "Aspect", "Slope", "Horizontal_Distance_To_Hydrology",
     "Vertical_Distance_To_Hydrology", "Horizontal_Distance_To_Roadways", "Hillshade_9am",
     "Hillshade_Noon", "Hillshade_3pm", "Horizontal_Distance_To_Fire_Points"]
    + [f"Wilderness_Area{i}" for i in range(1, 5)]
    + [f"Soil_Type{i}" for i in range(1, 41)]
)

SOURCES = {
    "electricity": {
        "title": "Electricity (Elec2, elecNormNew)",
        "openml_id": 151,
        "page": "https://www.openml.org/d/151",
        "metadata_url": "https://www.openml.org/api/v1/json/data/151",
        "expected_target": "class",
        "drop_features": ["date"],
        "categorical_features": ["day"],
        "order": ("Chronological. Rows are 30-minute observations of the Australian New South "
                  "Wales electricity market (May 1996 - Dec 1998) in source order."),
        "drop_reason": ("'date' is a monotonically increasing normalised timestamp. It is kept in "
                        "the cache but excluded from model features so the deployed model cannot "
                        "key on stream position and so PSI is not trivially triggered by time."),
        "citation": "Harries, M. (1999). SPLICE-2 comparative evaluation: Electricity pricing. "
                    "Tech. report, UNSW. Normalised version distributed via MOA/OpenML.",
    },
    "airlines": {
        "title": "Airlines (flight delay)",
        "openml_id": 1169,
        "page": "https://www.openml.org/d/1169",
        "metadata_url": "https://www.openml.org/api/v1/json/data/1169",
        "expected_target": "Delay",
        "drop_features": [],
        "categorical_features": ["Airline", "AirportFrom", "AirportTo", "DayOfWeek"],
        "order": ("Stream replay in source order. The data set is commonly used as a drift stream "
                  "(MOA/Ikonomovska version); rows are not guaranteed to be strictly time-sorted, "
                  "so RetrainWise treats it as an ordered replay, not a verified chronology."),
        "drop_reason": "",
        "citation": "Ikonomovska, E. Airline dataset (derived from the 2009 Data Expo / US BTS "
                    "data), distributed via MOA and OpenML.",
    },
    "covertype": {
        "title": "Covertype (forest cover type)",
        "uci_id": 31,
        "page": "https://archive.ics.uci.edu/dataset/31/covertype",
        "download_url": "https://archive.ics.uci.edu/static/public/31/covertype.zip",
        "expected_target": "Cover_Type",
        "drop_features": [],
        "categorical_features": [],
        "order": ("Stream replay in source order. Observations are 30x30 m cartographic cells, "
                  "not time-stamped events; ordering follows the UCI file, as in the stream-"
                  "learning literature that replays it as a stream."),
        "drop_reason": "",
        "licence": "CC BY 4.0",
        "citation": "Blackard, J. (1998). Covertype [Dataset]. UCI Machine Learning Repository. "
                    "https://doi.org/10.24432/C50K5N",
    },
}
DATASETS = ("synthetic",) + tuple(SOURCES)


def cache_path(name: str, root: Path = ROOT) -> Path:
    return Path(root) / f"data_{name}.csv.gz"


def provenance_path(name: str, root: Path = ROOT) -> Path:
    return Path(root) / f"data_{name}_provenance.json"


def is_cached(name: str, root: Path = ROOT) -> bool:
    return name == "synthetic" or cache_path(name, root).exists()


def fetch(url: str, timeout: int = 180) -> bytes:
    if not url.startswith("https://"):
        raise ValueError("Only HTTPS downloads are allowed")
    request = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    with urllib.request.urlopen(request, timeout=timeout) as response:
        return response.read()


def parse_arff(raw: bytes, target: str) -> pd.DataFrame:
    data, _meta = arff.loadarff(io.StringIO(raw.decode("utf-8", errors="replace")))
    frame = pd.DataFrame(data)
    for col in frame.columns:
        if frame[col].dtype == object:
            frame[col] = frame[col].map(lambda v: v.decode("utf-8") if isinstance(v, bytes) else v)
            frame[col] = frame[col].replace({"?": np.nan})
    if target not in frame.columns:
        raise ValueError(f"Target column {target!r} not found in ARFF")
    return frame.rename(columns={target: "target"})


def _sha256(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def download(name: str, root: Path = ROOT) -> dict:
    """Download one real dataset, cache it as ``data_<name>.csv.gz`` and
    write ``data_<name>_provenance.json``. Raises on any failure."""
    if name not in SOURCES:
        raise ValueError(f"Unknown real dataset {name!r}; choose from {list(SOURCES)}")
    root = Path(root)
    source = dict(SOURCES[name])
    if "openml_id" in source:
        meta = json.loads(fetch(source["metadata_url"]))["data_set_description"]
        url = meta["url"]
        raw = fetch(url)
        target = meta.get("default_target_attribute") or source["expected_target"]
        frame = parse_arff(raw, target)
        source.update(
            download_url=url, openml_name=meta.get("name"), openml_version=meta.get("version"),
            licence=meta.get("licence", "not stated by OpenML"),
            openml_md5_checksum=meta.get("md5_checksum"), file_format=meta.get("format", "ARFF"))
    else:
        url = source["download_url"]
        raw = fetch(url)
        archive = zipfile.ZipFile(io.BytesIO(raw))
        member = next((m for m in archive.namelist() if m.endswith("covtype.data.gz")), None)
        if member is None:
            raise ValueError("covtype.data.gz not found in the UCI archive")
        frame = pd.read_csv(io.BytesIO(gzip.decompress(archive.read(member))), header=None)
        if frame.shape[1] != 55:
            raise ValueError(f"Unexpected Covertype width {frame.shape[1]}")
        frame.columns = COVERTYPE_COLUMNS + ["target"]
        target = "Cover_Type"
        source.update(archive_member=member, file_format="CSV (gzip) inside ZIP")
    if frame["target"].isna().any():
        raise ValueError("Source contains missing targets; refusing to cache silently")
    frame["target"] = frame["target"].map(_label_text)
    path = cache_path(name, root)
    tmp = path.with_name(path.name + ".tmp")
    frame.to_csv(tmp, index=False, compression="gzip")
    tmp.replace(path)
    source.update(
        dataset=name, retrieved_utc=now(), raw_sha256=_sha256(raw), raw_bytes=len(raw),
        cache_file=path.name, cache_sha256=_sha256(path.read_bytes()), target_column=target,
        rows=int(len(frame)), columns=[c for c in frame.columns],
        dtypes={c: str(t) for c, t in frame.dtypes.items()},
        class_counts={str(k): int(v) for k, v in frame["target"].value_counts().sort_index().items()},
        missing_values=int(frame.drop(columns="target").isna().sum().sum()),
        preprocessing=("Cached as-is in source order with the target renamed to 'target' and "
                       "labels stored as text. Imputation, scaling and one-hot encoding are "
                       "fitted only on each model's own training window (see preprocessing.py)."),
        usage_note="Research/educational use; re-check the licence on the source page before redistribution.",
        regenerate=f"python datasets.py {name}",
    )
    provenance_path(name, root).write_text(json.dumps(source, indent=2), encoding="utf-8")
    return source


def _label_text(value) -> str:
    if isinstance(value, float) and value.is_integer():
        return str(int(value))
    return str(value)


def read_provenance(name: str, root: Path = ROOT) -> dict | None:
    if name == "synthetic":
        return synthetic_metadata()
    path = provenance_path(name, root)
    return json.loads(path.read_text(encoding="utf-8")) if path.exists() else None


# --------------------------------------------------------------------- synthetic
def synthetic_metadata(n: int = 20_000, seed: int = 42) -> dict:
    points = {k: int(v * n) for k, v in SYNTHETIC_SEGMENTS.items()}
    return {
        "dataset": "synthetic", "title": "Synthetic drift stream (generated locally)",
        "generator": "datasets.synthetic(n, seed)", "rows": n, "seed": seed,
        "order": "Chronological by construction; row i is time step i.",
        "drift_points": points,
        "description": {
            "abrupt": "Concept A -> B at 'abrupt' (sign of x0 inverted).",
            "gradual": "B -> C between 'gradual_start' and 'gradual_end' (mixture probability ramps linearly).",
            "recurring": "C -> A at 'recurring' (original concept returns).",
            "covariate_only": "From 'covariate_only', x3 and x4 shift in distribution but do not affect y "
                              "(PSI should rise without predictive degradation).",
            "unseen_category": "Category 'west' first appears at 'gradual_start'.",
            "missing": "About 2% of x5 values are missing throughout.",
        },
        "licence": "Generated by this project; no external data.",
        "target_column": "target",
    }


SYNTHETIC_SEGMENTS = {"abrupt": 0.20, "gradual_start": 0.40, "gradual_end": 0.60,
                      "recurring": 0.70, "covariate_only": 0.85}


def synthetic(n: int = 20_000, seed: int = 42) -> pd.DataFrame:
    if n < 200:
        raise ValueError("Synthetic stream needs at least 200 rows")
    rng = np.random.default_rng(seed)
    t = np.arange(n) / n
    x = rng.normal(size=(n, 6))
    s = SYNTHETIC_SEGMENTS
    cov = t >= s["covariate_only"]
    x[cov, 3] = x[cov, 3] * 1.0 + 1.5
    x[cov, 4] = x[cov, 4] * 2.0
    concept_a = x[:, 0] + 0.5 * x[:, 1]
    concept_b = -x[:, 0] + 0.5 * x[:, 1]
    concept_c = x[:, 2] - 0.5 * x[:, 1]
    ramp = np.clip((t - s["gradual_start"]) / (s["gradual_end"] - s["gradual_start"]), 0, 1)
    use_c = rng.random(n) < ramp
    score = np.where(t < s["abrupt"], concept_a,
            np.where(t < s["gradual_start"], concept_b,
            np.where(t < s["recurring"], np.where(use_c, concept_c, concept_b), concept_a)))
    y = (score + rng.normal(0, 0.35, n) > 0).astype(int)
    region = rng.choice(["north", "south", "east"], size=n, p=[0.4, 0.35, 0.25]).astype(object)
    late = t >= s["gradual_start"]
    region[late & (rng.random(n) < 0.2)] = "west"
    frame = pd.DataFrame(x, columns=[f"x{i}" for i in range(6)])
    frame.loc[rng.random(n) < 0.02, "x5"] = np.nan
    frame["region"] = region
    frame["target"] = np.where(y == 1, "positive", "negative")
    return frame


# ------------------------------------------------------------------------- load
def resolve_size(size: str | int | None) -> int | None:
    if size is None or isinstance(size, (int, np.integer)):
        if size is not None and int(size) < 200:
            raise ValueError("Sample size must be at least 200 rows")
        return None if size is None else int(size)
    if size not in SAMPLE_SIZES:
        raise ValueError(f"Unknown size {size!r}; choose from {list(SAMPLE_SIZES)}")
    return SAMPLE_SIZES[size]


def load(name: str, size: str | int | None = "standard", seed: int = 42,
         root: Path = ROOT) -> pd.DataFrame:
    """Return the first ``size`` rows in source order with a ``target`` column.

    The seed only affects the synthetic generator; real data order is fixed.
    """
    n = resolve_size(size)
    if name == "synthetic":
        return synthetic(n or 50_000, seed)
    if name not in SOURCES:
        raise ValueError(f"Unknown dataset {name!r}; choose from {list(DATASETS)}")
    path = cache_path(name, root)
    if not path.exists():
        raise FileNotFoundError(
            f"{name} is not cached. Download it explicitly (Data and simulation tab, or "
            f"`python datasets.py {name}`). Synthetic data is never substituted.")
    frame = pd.read_csv(path, nrows=n, dtype={"target": str}, low_memory=False)
    drop = [c for c in SOURCES[name]["drop_features"] if c in frame.columns]
    frame = frame.drop(columns=drop).reset_index(drop=True)
    # Nominal ARFF attributes are restored as text after the CSV round trip.
    for col in SOURCES[name]["categorical_features"]:
        if col in frame.columns:
            frame[col] = frame[col].map(lambda v: np.nan if pd.isna(v) else _label_text(v)).astype(object)
    if "target" not in frame.columns:
        raise ValueError(f"Cached {name} file has no target column")
    return frame


def frame_sha256(frame: pd.DataFrame) -> str:
    hashed = pd.util.hash_pandas_object(frame, index=True).to_numpy()
    return hashlib.sha256(hashed.tobytes()).hexdigest()


def schema_preview(frame: pd.DataFrame) -> pd.DataFrame:
    rows = []
    for col in frame.columns:
        s = frame[col]
        rows.append({"column": col, "dtype": str(s.dtype), "missing": int(s.isna().sum()),
                     "unique": int(s.nunique(dropna=True)),
                     "role": "target" if col == "target" else
                     ("numeric" if pd.api.types.is_numeric_dtype(s) else "categorical")})
    return pd.DataFrame(rows)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Explicitly download and cache real datasets.")
    parser.add_argument("names", nargs="+", choices=list(SOURCES))
    args = parser.parse_args()
    for dataset_name in args.names:
        info = download(dataset_name)
        print(json.dumps({k: info[k] for k in ("dataset", "rows", "target_column", "cache_file",
                                               "cache_sha256", "retrieved_utc")}, indent=2))
