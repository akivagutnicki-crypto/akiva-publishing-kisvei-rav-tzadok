#!/usr/bin/env python3
"""October 29 final source-collation follow-up; audit branch only, never main."""
import copy
import hashlib
import json
import re
import zipfile
from pathlib import Path

SOURCE = Path("sources/akiva/Takanat_HaShavin.json")
REPORT = Path("editorial/takanas-reader-final-applied-audit.json")
ZIP = Path("editorial/Takanas_HaShavin_Reader_1-13_GitHub_Source_UPLOAD_CANDIDATE.zip")
EXPECTED_BLOB_SHA = "c1d72d84f244fdb85ae8276891c55cba262cc048"
MARK = re.compile(r'<sup class="footnote-marker">([^<]+)</sup>')
NOTE = re.compile(r'<sup class="footnote-marker">([^<]+)</sup><i class="footnote">')
ITALIC = re.compile(r'</?i(?:\s[^>]*)?>')
DATA_REF = re.compile(r'data-ref="([^"]+)"')


def git_sha(data):
    return hashlib.sha1(b"blob " + str(len(data)).encode() + b"\0" + data).hexdigest()


def strip_notes(text):
    output = []
    pos = 0
    for m in NOTE.finditer(text):
        if m.start() < pos:
            continue
        output.append(text[pos:m.start()])
        dep = 1
        for tag in ITALIC.finditer(text, m.end()):
            dep += -1 if tag.group().startswith("</") else 1
            if dep == 0:
                pos = tag.end()
                break
        else:
            raise ValueError("Unclosed footnote")
    output.append(text[pos:])
    return "".join(output)


def find(doc, section, note):
    token = f'<sup class="footnote-marker">{note}</sup><i class="footnote">'
    matches = []
    for item in doc["sections"][section]["items"]:
        for index, pair in enumerate(item.get("p", [])):
            text = pair[1] or ""
            begin = text.find(token)
            if begin < 0:
                continue
            content_start = begin + len(token)
            dep = 1
            for tag in ITALIC.finditer(text, content_start):
                dep += -1 if tag.group().startswith("</") else 1
                if dep == 0:
                    matches.append((pair, content_start, tag.start(), text[content_start:tag.start()]))
                    break
            else:
                raise ValueError("Unclosed note " + str(note))
    if len(matches) != 1:
        raise ValueError(f"Expected one occurrence of {section}:{note}; found {len(matches)}")
    return matches[0]


def change(doc, section, note, newbody, reason):
    pair, start, end, before = find(doc, section, note)
    after = newbody(before)
    if after == before:
        raise ValueError(f"Empty edit {section}:{note}")
    pair[1] = pair[1][:start] + after + pair[1][end:]
    edits.append({"siman": section, "note": str(note), "reason": reason, "before_chars": len(before), "after_chars": len(after)})


def replace(doc, section, note, old, new, reason):
    def f(t):
        if t.count(old) != 1:
            raise ValueError(f"Missing or repeated text for {section}:{note}: {old[:75]}")
        return t.replace(old, new, 1)
    change(doc, section, note, f, reason)


def validate(before, after):
    count_pairs = 0
    inventory = {}
    for section in range(16):
        a, b = before["sections"][section], after["sections"][section]
        if len(a["items"]) != len(b["items"]):
            raise AssertionError("Changed structural item count")
        if (section == 0 or section >= 10) and a != b:
            raise AssertionError(f"Protected section {section} changed")
        old_ids, new_ids, old_he, new_he = [], [], [], []
        for original, revised in zip(a["items"], b["items"]):
            if ("p" in original) != ("p" in revised):
                raise AssertionError("Changed paragraph type")
            if not original.get("p"):
                if original != revised:
                    raise AssertionError("Changed heading or metadata")
                continue
            if len(original["p"]) != len(revised["p"]):
                raise AssertionError("Changed phrase count")
            for old, new in zip(original["p"], revised["p"]):
                count_pairs += 1
                if old[0] != new[0]:
                    raise AssertionError(f"Hebrew changed in {section}")
                if strip_notes(old[1] or "") != strip_notes(new[1] or ""):
                    raise AssertionError(f"English outside notes changed in {section}")
                if DATA_REF.findall(old[1] or "") != DATA_REF.findall(new[1] or ""):
                    raise AssertionError(f"Inline data-ref links changed in {section}")
                old_ids += MARK.findall(old[1] or "")
                new_ids += MARK.findall(new[1] or "")
                old_he += MARK.findall(old[0] or "")
                new_he += MARK.findall(new[0] or "")
        if sorted(old_ids) != sorted(new_ids) or sorted(old_he) != sorted(new_he):
            raise AssertionError(f"Note identity or Hebrew-side marker changed in {section}")
        if len(set(new_ids)) != len(new_ids):
            raise AssertionError(f"Duplicate marker in section {section}")
        inventory[str(section)] = {"markers": len(new_ids) + len(new_he), "hebrew_side": len(new_he)}
    if sum(inventory[str(s)]["markers"] for s in range(1, 14)) != 1891:
        raise AssertionError("Unexpected Simanim 1-13 marker count")
    if sum(inventory[str(s)]["hebrew_side"] for s in range(1, 14)) != 31:
        raise AssertionError("Hebrew-side marker count changed")
    return count_pairs, inventory


raw = SOURCE.read_bytes()
found = git_sha(raw)
if found != EXPECTED_BLOB_SHA:
    raise SystemExit(f"Stop: Reader source changed: {found} != {EXPECTED_BLOB_SHA}")
original = json.loads(raw)
reader = copy.deepcopy(original)
edits = []

replace(reader, 2, 108,
    'Koheles Rabbah (on Shlomo’s wisdom): among the things Shlomo “knew,” he knew “how to heal [<i>le-rapo’us</i>] the past” and “how one sweetens the lupine [<i>tormus</i>]” (a bitter legume made edible by repeated soaking). R’ Tzadok (noting he received the reading <i>le-rapo’us</i>, “to heal,” not <i>hekirum</i>)',
    'Koheles Rabbah 1:13, in the consulted standard text, describes how Shlomo knew to sweeten mustard and bitter lupines; it does not contain the words “to heal the past.” R’ Tzadok separately reports that he received a variant reading <i>le-rapo’us et ha-kodem</i>, “to heal the past.” He',
    "Distinguish the standard Koheles Rabbah wording from Rav Tzadok's reported textual variant")

def fix_menasheh(text):
    split = text.find("Pesachim 119a:")
    if split < 1:
        raise ValueError("Menasheh note lost Pesachim 119a source")
    return ('II Divrei HaYamim 33:13 reads “וַיֵּעָתֶר לוֹ” — “His supplication was received.” '
            'Sanhedrin 103a expounds the variant form “וַיֵּחָתֶר לוֹ” as indicating that the Holy One '
            'opened a tunnel in Heaven to receive Menasheh’s teshuvah despite the Attribute of Justice. '
            'The wording of the biblical verse is distinct from the Gemara’s homiletic exposition. '
            + text[split:])

change(reader, 3, 124, fix_menasheh,
       "Distinguish II Divrei HaYamim 33:13 from the Sanhedrin 103a derashah")

change(reader, 3, 128,
       lambda _: ('Yerushalmi Makkos 2:6:9, in the consulted standard text, asks Wisdom what punishment '
                  'the sinner deserves, then Prophecy, and then the Holy One, who answers that the sinner '
                  'should repent and receive atonement. It does not include a separate question addressed to Torah. '
                  'Yalkut Shimoni on Nach §358:1 includes an expanded sequence in which Torah replies '
                  '“יביא אשם ויתכפר לו” — “Let him bring a guilt offering and obtain atonement.” '
                  'R’ Tzadok mentions the Yefeh Mar’eh’s textual tradition; that fuller sequence should be '
                  'identified as a variant, not as the verbatim wording of the standard Yerushalmi.'),
       "Differentiate Yerushalmi Makkos standard text from Yalkut Shimoni variant")

replace(reader, 3, 134, 'Dover Tzedek, Likutim §1',
        'Dover Tzedek, Likutim I, §11 (Miscellany 1:11)',
        "Preserve authentic long original quote, now located precisely")

replace(reader, 3, 165, 'Ohr Zarua LaTzadik §7',
        'Ohr Zarua LaTzadik, Large Beis and Small Beis §2',
        "Correct precise original Rav Tzadok work/paragraph")

replace(reader, 3, 180, 'Poked Akarim §2',
        'Poked Akarim 2:7',
        "Precise verified source locator")

replace(reader, 3, 184, 'Dover Tzedek, Likutim §4',
        'Dover Tzedek, Likutim IV, §120 (Miscellany 4:120)',
        "Retain authentic original Rav Tzadok text, with exact location")

replace(reader, 3, 194, 'Peri Tzadik, Shemos §7',
        'Pri Tzaddik, Kedushas Shabbos 7:1',
        "Correct attribution of Moshe/Yeshayahu/Menasheh interpretation")

checked, counts = validate(original, reader)
if checked != 5510:
    raise AssertionError(f"Phrase count unexpectedly changed: {checked}")
encoded = json.dumps(reader, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
SOURCE.write_bytes(encoded)
report = json.loads(REPORT.read_text(encoding="utf-8"))
report["previous_verified_source_blob_sha"] = EXPECTED_BLOB_SHA
report["additional_source_collations"] = edits
report["source_collations_independently_checked_this_pass"] = [
    "Koheles Rabbah 1:13", "II Chronicles 33:13", "Sanhedrin 103a",
    "Yerushalmi Makkot 2:6:9", "Yalkut Shimoni Nach 358:1",
    "Dover Tzedek Miscellany 1:11", "Dover Tzedek Miscellany 4:120",
    "Ohr Zarua LaTzadik Large Beis and Small Beis 2",
    "Poked Akarim 2:7", "Pri Tzaddik Kedushas Shabbos 7:1"
]
report["total_operation_count"] = len(report.get("operations", [])) + len(edits)
report["edited_notes"] = 29
report["output_sha256"] = hashlib.sha256(encoded).hexdigest()
report["output_git_blob_sha"] = git_sha(encoded)
report["validated_english_hebrew_pairs"] = checked
report["counts"] = counts
report["main_branch_unchanged"] = True
report["all_notes_independently_source_certified"] = False
report["outstanding_cluster_locations_1_9"] = 186
REPORT.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
readme = (
    "Takanas HaShavin Reader source, Simanim 1-13. Final source-collated upload candidate.\n"
    "Upload Takanat_HaShavin.json to sources/akiva/Takanat_HaShavin.json after checking main has not changed.\n"
    "29 distinct corrected notes, 36 correction operations, including 10 precise relocations.\n"
    "All 1891 Simanim 1-13 footnote markers, 31 Hebrew-side markers, original Hebrew,\n"
    "all English text outside notes, data-ref links, and Simanim 10-15 preserved.\n"
    "Unresolved: not every note independently checked against source, and 186 note clusters still need review.\n"
    "This ZIP is a GitHub source replacement ZIP, not the separately generated offline Reader download ZIP.\n"
)
with zipfile.ZipFile(ZIP, "w", compression=zipfile.ZIP_DEFLATED, compresslevel=9) as z:
    z.writestr("Takanat_HaShavin.json", encoded)
    z.writestr("Reader_Change_and_Validation_Report.json", REPORT.read_bytes())
    z.writestr("README_UPLOAD_FIRST.txt", readme)
print(json.dumps({"changes": edits, "markers_1_13": 1891,
                  "pairs_checked": checked, "new_source_git_sha": git_sha(encoded),
                  "zip_bytes": ZIP.stat().st_size}, ensure_ascii=False))
