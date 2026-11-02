# Machine-learned parallels (Rav Tzadok and Ishbitz-Radzin)

These scripts produce `dist/library/ml-parallels/`, the "suggested by machine learning" parallels shown in the reader's Parallels panel.

## How the model works

1. **Units (`prep.py`).** One unit per teaching: each reader section, and each Mei HaShiloach paragraph. Each unit has normalized Hebrew text, the sources it cites, and the library engine's existing parallels. That makes 4,384 teachings.
2. **Training and evaluation (`train.py`).**
   - **Signals:** word TF-IDF, letter 4–5-grams (which handle Hebrew prefixes), LSA meaning vectors, citation TF-IDF (exact and chapter level), idf-weighted rare shared words, and the engine score. There are no book or school features, so the model judges content alone.
   - **Labels:** the HaMafteach HaShalem parallels (`mafteach_parallels.json`). Only pairs inside one Mafteach index are labeled, because Pri Tzaddik and the other sefarim are indexed separately.
   - **Model:** gradient-boosted trees, evaluated with 5-fold group cross-validation on held-out teachings.
3. **Export (`export.py`).** Up to 15 parallels per teaching (10 from the same school, 5 from the other):
   - **Tiers:** Strong, Likely and Possible, set by held-out precision.
   - **Evidence rules:** a tier needs supporting evidence, and links across the two schools need more of it.
   - **Size damping:** very long sections are scored down, and links into them point to the best-matching paragraph.
   - **Explanations:** each link lists the sources both teachings cite and the rare words they share.

## Held-out results (2026-11-02)

| Ranking by | AUC | Recall@20 | Precision@10 |
|---|---|---|---|
| **model** | **0.815** | **0.577** | **0.550** |
| library engine only | 0.602 | 0.394 | 0.374 |
| letter n-grams only | 0.741 | 0.505 | 0.472 |
| words only | 0.726 | 0.488 | 0.460 |
| LSA only | 0.674 | 0.397 | 0.373 |
| citations only | 0.562 | 0.302 | 0.251 |

Precision is measured against the Mafteach, which doesn't list every parallel, so true precision is higher.

A manual check of a random sample of Ishbitz ↔ Rav Tzadok links found about 3 in 5 genuinely related, before the stricter cross-school evidence rule was added. These links are leads to study, not verified citations.

## Re-running

You need a built site (`dist/mcp-data`) and `mafteach_parallels.json` from `scripts/build-mafteach-parallels.py`. Put both in a work directory, then run:

```
ML_WORK=<work dir> python3 scripts/ml-parallels/prep.py
ML_WORK=<work dir> python3 scripts/ml-parallels/add_mei.py
ML_WORK=<work dir> python3 scripts/ml-parallels/train.py
ML_WORK=<work dir> python3 scripts/ml-parallels/export.py dist/library/ml-parallels
```

Python needs scikit-learn and scipy.

The full Mei HaShiloach (1,305 teachings) comes from `sources/held/Mei_HaShiloach.json` via `add_mei.py`.
