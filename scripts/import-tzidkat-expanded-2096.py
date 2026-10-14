#!/usr/bin/env python3
"""Publish supplied Akiva Publishing Tzidkat HaTzadik 2,096-footnote CSV.

Run after the existing Har Bracha source import, before build-library.mjs.
Only annotations are replaced; the Hebrew and English reading text is preserved.
"""
import csv
import hashlib
import io
import json
import re
from pathlib import Path
from urllib.parse import quote

ROOT = Path("sources/akiva")
PARTS = ROOT / "overlays/tzidkat-2096-csv"
BOOK = ROOT / "Tzidkat_HaTzadik.json"
EXPECTED_SHA256 = "17a4d14f7af8d877d857128ef91eee07dadeb435ee8f39fbd3b7b0de9ece7354"
files = sorted(PARTS.glob("part-*.txt"))
if len(files) != 24:
    raise RuntimeError(f"Expected 24 CSV parts; found {len(files)}")
csv_content = "".join(f.read_text(encoding="utf-8") for f in files)
digest = hashlib.sha256(csv_content.encode("utf-8")).hexdigest()
if digest != EXPECTED_SHA256:
    raise RuntimeError(f"Supplied 2,096-footnote CSV checksum mismatch: {digest}")
rows = list(csv.DictReader(io.StringIO(csv_content, newline="")))
if len(rows) != 2096:
    raise RuntimeError(f"Expected 2,096 imported footnotes; found {len(rows)}")

book = json.loads(BOOK.read_text(encoding="utf-8"))
if len(book.get("sections", [])) != 264:
    raise RuntimeError("Expected 264 Tzidkat HaTzadik simanim")
section_map = {s["n"]: s for s in book["sections"]}
items = {(s["n"], item["n"]): item for s in book["sections"] for item in s["items"] if "n" in item}
text_snapshot = json.dumps(
    [(s["n"], [(i.get("n"), i.get("p")) for i in s["items"]]) for s in book["sections"]],
    ensure_ascii=False, separators=(",", ":"),
)
for item in items.values():
    item.pop("footnotes", None)

def plaintext(value):
    return (re.sub(r"<[^>]+>", "", value)
            .replace("&amp;", "&").replace("&quot;", '"')
            .replace("&#39;", "'").replace("&nbsp;", " ")
            .replace("&lt;", "<").replace("&gt;", ">"))

def parallel_link(ref):
    # Prefer an exact passage link where the Sefaria work has a stable structure.
    raw = re.sub(r"\s*\(§[^)]*\)\s*$", "", ref).strip()
    work = raw.split(",", 1)[0]
    if work in ("Sod Yesharim", "Likkutei Maamarim", "Tiferet Yosef"):
        return ("https://www.sefaria.org/topics/tzadok-hakohen-of-lublin"
                if work == "Likkutei Maamarim" else
                "https://www.sefaria.org/" + quote(work.replace(" ", "_"), safe="'"))
    return "https://www.sefaria.org/" + quote(raw.replace(" ", "_"), safe=",:.'")

def rich_paragraph(text, linked_title, link):
    if not text.startswith(linked_title):
        raise RuntimeError(f"Bad source title in translated note: {linked_title}")
    return {
        "text": text,
        "rich": [
            {"text": linked_title, "bold": True, "href": link},
            {"text": text[len(linked_title):]},
        ],
    }

seen_ref_per_siman = {}
seen_placement = set()
section_note_counts = {}
for expected_num, row in enumerate(rows, 1):
    number = int(row["number"])
    if number != expected_num or row["id"] != f"TZ-{number:04d}":
        raise RuntimeError(f"Nonsequential book-wide footnote at row {expected_num}")
    siman = int(row["reader_reference"].rsplit(" ", 1)[-1])
    item_num = int(row["reader_item_number"])
    idx = int(row["reader_pair_index_0_based"])
    key = (siman, item_num)
    if siman not in section_map or key not in items:
        raise RuntimeError(f"Missing siman/paragraph for footnote {number}: {key}")
    item = items[key]
    pair = item.get("p", [])[idx]
    he_text, en_text = map(plaintext, pair)
    he_anchor, en_anchor = row["heAnchorPrefix"], row["enAnchorPrefix"]
    if not he_text.startswith(he_anchor) or not en_text.startswith(en_anchor):
        raise RuntimeError(f"Footnote {number} has an incorrect Hebrew or English anchor")
    # Offset counts are serialized in UTF-16 code units for the JavaScript reader.
    he_off = len(he_anchor.encode("utf-16-le")) // 2
    en_off = len(en_anchor.encode("utf-16-le")) // 2
    if he_off != int(row["heCharOffset"]) or en_off != int(row["enCharOffset"]):
        raise RuntimeError(f"Footnote {number} offset differs from its supplied anchor")
    primary_ref = row["source_reference"]
    seen = seen_ref_per_siman.setdefault(siman, set())
    if primary_ref in seen:
        raise RuntimeError(f"Duplicate primary source in siman {siman}: {primary_ref}")
    seen.add(primary_ref)
    placement = f"TZ-{number:04d}-1"
    if placement in seen_placement:
        raise RuntimeError("Repeated placement " + placement)
    seen_placement.add(placement)

    paragraphs = row["english_footnote_full"].split("\n\n")
    if len(paragraphs) != 3:
        raise RuntimeError(f"Expected three complete English quotations for note {number}")
    rav_ref = row["rav_tzadok_parallel_ref"]
    ish_ref = row["ishbitz_radzin_parallel_ref"]
    rav_title = "Kisvei Rav Tzadok Parallel — " + rav_ref
    ish_title = "Kisvei Beis Ishbitz–Radzin Parallel — " + ish_ref
    primary_title = row["display_reference"]
    source_url = row["sefaria_url"]
    rav_url, ish_url = parallel_link(rav_ref), parallel_link(ish_ref)
    rich_paras = [
        rich_paragraph(paragraphs[0], primary_title, source_url),
        rich_paragraph(paragraphs[1], rav_title, rav_url),
        rich_paragraph(paragraphs[2], ish_title, ish_url),
    ]
    summary = f"Sources: {primary_title} | Parallels: {rav_ref}; {ish_ref}."
    rich_paras.append({
        "text": summary, "rich": [
            {"text": "Sources: ", "bold": True},
            {"text": primary_title, "bold": True, "href": source_url},
            {"text": " | Parallels: ", "bold": True},
            {"text": rav_ref, "bold": True, "href": rav_url},
            {"text": "; "},
            {"text": ish_ref, "bold": True, "href": ish_url},
            {"text": "."},
        ],
    })
    for para in rich_paras:
        if "".join(x["text"] for x in para["rich"]) != para["text"]:
            raise RuntimeError(f"Truncated English footnote {number}")

    note = {
        "number": number,
        "sourceId": f"TZ-{number:04d}",
        "placementId": placement,
        "phraseIndex": idx,
        "heCharOffset": he_off,
        "enCharOffset": en_off,
        "heAnchorPrefix": he_anchor,
        "enAnchorPrefix": en_anchor,
        "heWord": int(row["heWord"]),
        "paragraphs": rich_paras,
        "sources": [{
            "ref": primary_ref,
            "url": source_url,
            "connectionsUrl": "https://www.sefaria.org/api/links/"
                              + quote(primary_ref, safe="") + "?with=all",
            "role": "source",
        }],
        "nativeConnections": [rav_ref, ish_ref],
        "verificationStatus": "verified",
        "verificationNote": "Supplied primary-source English text and two distinct Chassidic parallels",
        "provenance": {
            "edition": "Har Bracha + Akiva Publishing Source & Chassidic Parallel Expansion",
            "siman": siman,
            "printedNumber": number,
        },
    }
    item.setdefault("footnotes", []).append(note)
    section_note_counts[siman] = section_note_counts.get(siman, 0) + 1

if len(section_note_counts) != 263:
    raise RuntimeError(f"Expected notes in 263 simanim; found {len(section_note_counts)}")
after = json.dumps(
    [(s["n"], [(i.get("n"), i.get("p")) for i in s["items"]]) for s in book["sections"]],
    ensure_ascii=False, separators=(",", ":"),
)
if after != text_snapshot:
    raise RuntimeError("Hebrew/English reading text changed during footnote import")
book["footnoteImportInfo"] = {
    "edition": "Har Bracha + Akiva Publishing Source Expansion + Kisvei Rav Tzadok & Beis Ishbitz-Radzin Parallels",
    "notes": 2096, "placements": 2096, "sectionsWithNotes": 263,
    "sourceLinks": 2096, "ravTzadokParallels": 2096, "ishbitzRadzinParallels": 2096,
    "exactEditionChecksPending": [],
    "reviewedCsvSha256": "c6344af5fc2af48483243fd724a22bc795c11af7cfbc46bd90f070ca441b1163",
    "reviewed": "2026-10-14",
    "anchorConvention": "Exact UTF-16 offset in rendered, HTML-decoded Hebrew phrase text; source refs deduplicated per siman.",
    "numbering": "Continuous 1-2096 across the entire sefer.",
}
book.pop("footnoteParallelInfo", None)
BOOK.write_text(json.dumps(book, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
print(f"IMPORTED TZIDKAT: {len(rows)} full English source notes, exact Hebrew anchors, "
      f"263 simanim, two Sefaria-linked parallels per note, continuous numbering.")
