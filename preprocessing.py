"""Schema alignment and preprocessing fitted on a training window only.

``fit_preprocessor`` is only ever called with the rows of the window a model is
trained on, so imputation medians, scaling statistics and category vocabularies
never see later observations. Incremental updates reuse the frozen transformer.
"""
from __future__ import annotations

import numpy as np
import pandas as pd
from sklearn.compose import ColumnTransformer
from sklearn.impute import SimpleImputer
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import OneHotEncoder, StandardScaler

MAX_CATEGORIES = 200  # rarest categories beyond this are grouped as infrequent


def infer_schema(x: pd.DataFrame) -> dict:
    """Feature order and kind (numeric/categorical) from a training window."""
    if x.columns.duplicated().any():
        raise ValueError("Duplicate feature columns")
    if "target" in x.columns:
        raise ValueError("Schema must not include the target column")
    numeric = [c for c in x.columns if pd.api.types.is_numeric_dtype(x[c])
               and not pd.api.types.is_bool_dtype(x[c])]
    categorical = [c for c in x.columns if c not in numeric]
    return {"features": list(x.columns), "numeric": numeric, "categorical": categorical}


def align(x: pd.DataFrame, schema: dict) -> tuple[pd.DataFrame, dict]:
    """Coerce a batch to the training schema.

    Missing columns are added as missing values (then imputed), unexpected
    columns are dropped, numeric columns are coerced (bad values -> NaN) and
    infinities become missing. Every issue is reported, never hidden.
    """
    if x.columns.duplicated().any():
        raise ValueError("Duplicate feature columns in batch")
    issues = {"missing_columns": [c for c in schema["features"] if c not in x.columns],
              "unexpected_columns": [c for c in x.columns if c not in schema["features"] and c != "target"],
              "coerced_values": 0}
    out = x.reindex(columns=schema["features"]).copy()
    for col in schema["numeric"]:
        before = out[col].notna().sum()
        out[col] = pd.to_numeric(out[col], errors="coerce").replace([np.inf, -np.inf], np.nan)
        issues["coerced_values"] += int(before - out[col].notna().sum())
    for col in schema["categorical"]:
        out[col] = out[col].map(lambda v: np.nan if pd.isna(v) else str(v)).astype(object)
    return out, issues


def fit_preprocessor(x: pd.DataFrame, schema: dict) -> ColumnTransformer:
    """Fit imputation/scaling/encoding on the training window only."""
    aligned, _ = align(x, schema)
    transformers = []
    if schema["numeric"]:
        transformers.append(("numeric", Pipeline([
            ("impute", SimpleImputer(strategy="median", keep_empty_features=True)),
            ("scale", StandardScaler())]), schema["numeric"]))
    if schema["categorical"]:
        transformers.append(("categorical", Pipeline([
            ("impute", SimpleImputer(strategy="constant", fill_value="__missing__",
                                     keep_empty_features=True)),
            ("encode", OneHotEncoder(handle_unknown="infrequent_if_exist",
                                     max_categories=MAX_CATEGORIES, sparse_output=True))]),
            schema["categorical"]))
    if not transformers:
        raise ValueError("No usable features")
    transformer = ColumnTransformer(transformers, sparse_threshold=1.0)
    return transformer.fit(aligned)


def unseen_category_rate(x: pd.DataFrame, schema: dict, vocab: dict) -> float:
    """Share of categorical cells whose value was absent from the training window."""
    cells = unseen = 0
    for col in schema["categorical"]:
        if col not in x.columns:
            continue
        values = x[col].dropna().astype(str)
        cells += len(values)
        unseen += int((~values.isin(vocab.get(col, []))).sum())
    return float(unseen / cells) if cells else 0.0


def category_vocabulary(x: pd.DataFrame, schema: dict) -> dict:
    return {col: sorted(x[col].dropna().astype(str).unique().tolist())[:5_000]
            for col in schema["categorical"]}
