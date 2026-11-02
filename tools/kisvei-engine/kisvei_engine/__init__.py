"""Kisvei Rav Tzadok footnote, hyperlink and parallel engine (Akiva Publishing).

Modules
-------
corpus      load the Akiva reader library (interlinear and Hebrew-only works) into paragraphs
hebrew      Hebrew normalisation: nikkud stripping, prefix handling, abbreviation expansion, n-grams
citations   detect explicit citations in Rav Tzadok's Hebrew (ברכות מח., שמות יב יא, זוהר ח"ג רלב.) and
            resolve them to Sefaria references
sefaria     canonical Sefaria references, URLs, Zohar daf resolution, API client with cache
parallels   index the library and rank parallel passages (shared sources + shared rare phrases),
            with weights learned from reviewed editorial parallels
learn       fit ranking weights from gold parallels (the editorial master notes, reviewed library notes)
footnotes   render footnotes in the Akiva editorial format (Sefaria quotation notes, parallel notes)
interlinear phrase segmentation and translation memory for new interlinear editions
topics      topic index: Sefaria topics of cited sources + editorial headlines + key terms
"""
__version__ = '0.1.0'
