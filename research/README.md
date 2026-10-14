# Research archive

These files were produced by the original Python/Streamlit research prototype of RetrainWise (scikit-learn,
River, matplotlib), which this repository replaced with the Next.js application. They are kept unchanged as the
record of that study; the prototype's source code is in the git history.

| Path | Content |
|---|---|
| `RESEARCH_REPORT.md` | The written study: questions, method, results and limitations |
| `results/results_*` | Main benchmark: 4 datasets × 3 seeds × 3 cost regimes × 6 policies (standard size, 216 runs) |
| `results/results_full_*` | Complete datasets, 1 seed, balanced regime, batch size 2,000 |
| `results/experiment_*` | A benchmark started from the prototype's Experiments tab |
| `results/*.png` | Charts referenced by the report |
| `presentation.pptx` | Slide deck |
| `datasets/` | Provenance records of the downloaded real datasets (2026-10-12) |
| `PYTHON_PROTOTYPE_ARCHITECTURE.md`, `DEMO_GUIDE.md`, `REQUIREMENTS_CHECKLIST.md` | The prototype's documentation |

The Next.js app shows these result sets on the **Experiments** page as "archived research run". Numbers from the
new implementation are close but not identical: the estimator, random number generator and synthetic stream were
re-implemented in TypeScript, so individual runs differ while the methodology is the same
(see [docs/METHODOLOGY.md](../docs/METHODOLOGY.md)).
