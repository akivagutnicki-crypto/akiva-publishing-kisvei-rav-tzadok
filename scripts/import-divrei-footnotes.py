#!/usr/bin/env python3
"""Import 491 user-reviewed Divrei Soferim notes without changing the existing text.

The CSV carries 156 Har Bracha editorial notes and 335 Akiva Publishing
expanded source notes. All notes survive even when Sefaria cannot resolve
a linked reference. Exact displayed Hebrew/English offsets are validated.
"""
import csv
import hashlib
import html
import json
import re
from collections import Counter
from pathlib import Path

CSV_PATH = Path("sources/akiva/overlays/divrei-soferim/expanded_footnotes.csv")
SOURCE_PATH = Path("sources/akiva/Divrei_Soferim.json")
EXPECTED_SHA = "d0cf3f5237005fc4eb684078f21f4e22cc51dc6307e0f4ee83db29ba726fa90f"
raw = CSV_PATH.read_bytes()
sha = hashlib.sha256(raw).hexdigest()
if sha != EXPECTED_SHA:
    raise RuntimeError(f"Wrong reviewed Divrei Soferim CSV: {sha}")
with CSV_PATH.open(newline="", encoding="utf-8-sig") as source_file:
    rows = list(csv.DictReader(source_file))
book = json.loads(SOURCE_PATH.read_text(encoding="utf-8"))
assert book["title"] == "Divrei Soferim" and book["interlinear"]
assert len(book["sections"]) == 39 and len(rows) == 491

def visible(x):
    return html.unescape(re.sub(r"<[^>]*>", "", str(x)))

def english_rich(text, ref, url):
    # Link a real passage label within the actual supplied English note,
    # never rewrite or truncate the translated quotation.
    start = text.find(ref)
    if start < 0:
        # A scholarly note may have a longer display title or an en dash.
        title = text.split(":", 1)[0].strip()
        start = 0 if title and len(title) <= 120 else -1
        label = title if start == 0 else None
    else:
        label = ref
    if start < 0 or not label:
        return [{"text": text}]
    pieces = []
    if start:
        pieces.append({"text": text[:start]})
    link = {"text": label, "bold": True}
    if url.startswith("https://www.sefaria.org/"):
        link["href"] = url
    pieces.append(link)
    if text[start + len(label):]:
        pieces.append({"text": text[start + len(label):]})
    if "".join(part["text"] for part in pieces) != text:
        raise ValueError(f"Rich-text loss: {ref}")
    return pieces

chapter_map = {s.get("n", 0): s for s in book["sections"]}
assert set(chapter_map) == set(range(39))
for section in book["sections"]:
    # No pre-existing notes are deleted. Refuse a conflicting import.
    assert not any(item.get("footnotes") for item in section["items"]), "Original already annotated"

counts = Counter()
source_counts = Counter()
for expected_number, row in enumerate(rows, 1):
    n = int(row["number"])
    sid = row["id"]
    chapter = int(row["chapter"])
    if n != expected_number or sid != f"DS-{n:04d}" or not (1 <= chapter <= 38):
        raise ValueError(f"Out-of-sequence footnote {sid}")
    target = chapter_map[chapter]["items"][0]
    phrase_index = int(row["phraseIndex"])
    if phrase_index >= len(target.get("p", [])):
        raise ValueError(f"No phrase for note {sid}")
    pair = target["p"][phrase_index]
    he_offset, en_offset = int(row["heCharOffset"]), int(row["enCharOffset"])
    if visible(pair[0])[:he_offset] != row["heAnchorPrefix"]:
        raise ValueError(f"Misaligned Hebrew phrase in {sid}")
    if visible(pair[1])[:en_offset] != row["enAnchorPrefix"]:
        raise ValueError(f"Misaligned English phrase in {sid}")
    ref = row["source_reference"].strip()
    url = row["sefaria_url"].strip()
    en = row["english_footnote_full"]
    if not en.strip():
        raise ValueError(f"Empty English source note {sid}")
    source = {"ref": ref, "role": "source"}
    if url.startswith("https://www.sefaria.org/"):
        source["url"] = url
    else:
        source["verificationStatus"] = "Sefaria link unavailable"
    edition = ("Har Bracha Edition" if row["edition"] == "Har Bracha Editorial Note"
               else "Akiva Publishing Source Expansion")
    note = {
        "number": n, "sourceId": sid, "placementId": f"{sid}-1",
        "phraseIndex": phrase_index, "heCharOffset": he_offset,
        "enCharOffset": en_offset, "heAnchorPrefix": row["heAnchorPrefix"],
        "enAnchorPrefix": row["enAnchorPrefix"], "heWord": int(row["heWord"]),
        "paragraphs": [{"text": en, "rich": english_rich(en, ref, url)}],
        "sources": [source],
        "provenance": {
            "edition": edition, "siman": chapter, "printedNumber": n,
            **({"originalHarBrachaNumber": int(row["original_hb_number"])}
               if row["original_hb_number"] else {})
        }
    }
    target.setdefault("footnotes", []).append(note)
    counts[chapter] += 1
    source_counts[edition] += 1

if counts.keys() != set(range(1, 39)):
    raise RuntimeError("Missing annotated chapter(s)")
if dict(source_counts) != {
    "Har Bracha Edition": 156, "Akiva Publishing Source Expansion": 335
}:
    raise RuntimeError(f"Incorrect edition provenance counts {source_counts}")
book["footnoteImportInfo"] = {
    "edition": "Har Bracha Edition + Akiva Publishing Source Expansion",
    "notes": 491, "placements": 491, "harBrachaFootnotes": 156,
    "expandedSourceFootnotes": 335, "sectionsWithNotes": 38,
    "reviewedCsvSha256": sha,
    "numbering": "Continuous 1-491 across 38 chapters, markers in Hebrew only",
    "sourcePolicy": "Preserve every footnote even without a verified Sefaria match"
}
SOURCE_PATH.write_text(json.dumps(book, ensure_ascii=False, separators=(",", ":"))+"\n", encoding="utf-8")
print("PASS Divrei Soferim import: 491 exact bilingual anchors; 156 Har Bracha + 335 expanded notes; no source-dependent omissions")
