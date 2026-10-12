# Datasets: provenance, ordering and preprocessing

All three real datasets were downloaded by `python datasets.py electricity covertype airlines` on
**2026-10-12** (UTC). Each `data_<name>_provenance.json` file records the exact values below plus column types,
class counts and missing-value counts. The cached CSVs are excluded from the submission ZIP; regenerate them with:

```bash
python datasets.py electricity airlines covertype
```

A re-download may produce different checksums if the source files change. The provenance file records what was
actually used.

| | Electricity | Airlines | Covertype |
|---|---|---|---|
| Source | OpenML **151** (v1) <https://www.openml.org/d/151> | OpenML **1169** (v1) <https://www.openml.org/d/1169> | UCI **31** <https://archive.ics.uci.edu/dataset/31/covertype> |
| File downloaded | `https://openml.org/data/v1/download/2419/electricity.arff` | `https://openml.org/data/v1/download/66526/airlines.arff` | `https://archive.ics.uci.edu/static/public/31/covertype.zip` (member `covtype.data.gz`) |
| Retrieved (UTC) | 2026-10-12T12:21:34 | 2026-10-12T12:22:31 | 2026-10-12T12:22:01 |
| Raw SHA-256 | `2d86fbc7…cf024d7f2` | `c7683a90…13516c14` | `89a975c2…055105f6d` |
| Cache SHA-256 | `d6a50fce…365860b66` | `1d01c649…302ba874` | `26f0c7c5…d8288207` |
| Rows | 45,312 | 539,383 | 581,012 |
| Target | `class` (UP/DOWN) | `Delay` (0/1) | `Cover_Type` (1–7, multiclass) |
| Licence (as stated by source) | "Public" (OpenML metadata) | "Public" (OpenML metadata) | CC BY 4.0, DOI 10.24432/C50K5N |
| Order | **Chronological**: 30-minute NSW market observations, May 1996 – Dec 1998 | **Ordered replay**: source order, used as a drift stream in the literature, not verified to be strictly time-sorted | **Ordered replay**: cartographic cells, not time-stamped; UCI file order |
| Preprocessing notes | `date` (monotone normalised timestamp) is kept in the cache but **excluded from features**, so the model cannot key on position and PSI is not triggered by time alone. `day` is nominal → categorical. | `Airline`, `AirportFrom`, `AirportTo`, `DayOfWeek` are nominal → categorical; `Flight` stays numeric, as in the source ARFF. | 10 numeric and 44 binary indicator columns, named per the UCI documentation |

Full SHA-256 values are in the provenance JSON files. Licences were taken from source metadata at download time;
re-check them before redistributing the data.

## Synthetic drift stream (offline demo)

`datasets.synthetic(n, seed)` is deterministic per seed and chronological by construction. The segments, as
fractions of n (row numbers for n = 20,000), are:

| Segment | Start | What happens | Expected monitoring signature |
|---|---|---|---|
| Concept A | 0 | y = 1[x0 + 0.5·x1 + noise > 0] | stable |
| **Abrupt** | 0.20 (4,000) | Concept B: sign of x0 inverted | predictive degradation, **no** PSI signal |
| **Gradual** | 0.40–0.60 (8,000–12,000) | Mixture probability ramps from B to C (y driven by x2 − 0.5·x1); new category `west` appears | predictive degradation plus a categorical PSI shift |
| **Recurring** | 0.70 (14,000) | Concept A returns | predictive degradation |
| **Covariate only** | 0.85 (17,000) | x3 shifted by +1.5 and x4 scaled ×2; neither affects y | **PSI alarm without degradation** |

About 2% of `x5` values are missing throughout. Labels are text (`positive`/`negative`).

## Handling rules (all datasets)

* **Never substituted.** If a real cache is missing, `datasets.load` raises `FileNotFoundError` with the download command.
* **Source order preserved.** `load(name, size)` returns the first `size` rows (`small` 5,000; `standard` 20,000; `full` all).
* **Missing values:** numeric median and categorical `__missing__`, fitted per training window.
* **Categorical variables:** one-hot encoding (up to 200 levels, then grouped as infrequent). Unseen categories at
  prediction time map to zeros and are reported as `unseen_category_rate`.
* **Inconsistent schemas:** a batch is aligned to the training schema. Missing columns become missing values,
  unexpected columns are dropped, and non-numeric values in numeric columns are coerced to missing. Every issue is
  reported in telemetry. Incremental updates refuse batches that lost columns.
* **Multiclass labels:** string labels, with macro-averaged precision, recall and F1. A label class not seen by a
  model makes incremental updating incompatible, so full retraining is required.
* **Missing targets** in a source abort the download rather than being dropped silently.
