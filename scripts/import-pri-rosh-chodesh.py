"""Import reviewed, pointed Word phrases without OCR or length-based alignment.

The distributed DOCX files are the editorial source. This importer retains
their true footnote IDs and rich text, including hyperlinks, and copies each
Hebrew/English phrase verbatim. Run from the repository root after editing
the two downloads, then run build-library.mjs.
"""
import json
from pathlib import Path
from zipfile import ZipFile
from lxml import etree

W = "http://schemas.openxmlformats.org/wordprocessingml/2006/main"
R = "http://schemas.openxmlformats.org/officeDocument/2006/relationships"
NS = {"w": W, "r": R}
EDITION = Path("sources/akiva/editions/Peri_Tzadik_Bereshit_Cheshvan_Noach_Study_Edition.json")
BOOKS = [
    ("manuscript", "Rosh Chodesh (manuscript)", "Manuscript", [172], 33),
    ("marcheshvan", "Rosh Chodesh Cheshvan", "Marcheshvan", [83, 111, 85, 48], 48),
]


def text(element):
    return "".join(element.xpath(".//w:t/text()", namespaces=NS))


def extract_word(path):
    with ZipFile(path) as package:
        document = etree.fromstring(package.read("word/document.xml"))
        footnotes = etree.fromstring(package.read("word/footnotes.xml"))
        relationships = etree.fromstring(package.read("word/_rels/footnotes.xml.rels"))
    hrefs = {rel.get("Id"): rel.get("Target") for rel in relationships}
    pairs, anchors = [], {}
    for paragraph in document.findall("w:body/w:p", NS):
        pending = None
        for run in paragraph.findall("w:r", NS):
            size = run.find("w:rPr/w:sz", NS)
            direction = run.find("w:rPr/w:rtl", NS)
            content = text(run).strip()
            if size is not None and size.get(f"{{{W}}}val") == "19" and direction is not None and content:
                if direction.get(f"{{{W}}}val", "1") not in ("0", "false"):
                    assert pending is None, "Two Hebrew phrases without English"
                    pending = content
                else:
                    assert pending is not None, "English phrase without Hebrew"
                    pairs.append([pending, content])
                    pending = None
            for anchor in run.findall("w:footnoteReference", NS):
                number = int(anchor.get(f"{{{W}}}id"))
                assert number not in anchors and pairs and pending is None
                anchors[number] = len(pairs) - 1
        assert pending is None, "Untranslated paragraph ending"
    notes = {}
    for note in footnotes.findall("w:footnote", NS):
        number = int(note.get(f"{{{W}}}id"))
        if number <= 0:
            continue
        paragraphs = []
        for paragraph in note.findall("w:p", NS):
            rich, links = [], []
            for run in paragraph.findall(".//w:r", NS):
                content = text(run)
                if not content:
                    continue
                hyperlink = run.getparent()
                href = hrefs.get(hyperlink.get(f"{{{R}}}id")) if hyperlink.tag == f"{{{W}}}hyperlink" else None
                if href:
                    rich.append({"text": content, "href": href})
                    links.append({"label": content, "url": href})
                else:
                    def enabled(name):
                        prop = run.find("w:rPr/w:" + name, NS)
                        return prop is not None and prop.get(f"{{{W}}}val", "1") not in ("0", "false")
                    rich.append({"text": content, "bold": enabled("b"), "italic": enabled("i")})
            if rich:
                paragraphs.append({"text": "".join(run["text"] for run in rich), "rich": rich, "links": links})
        notes[number] = paragraphs
    assert set(notes) == set(anchors), "Unanchored Word footnotes"
    return pairs, anchors, notes


def main():
    edition = json.loads(EDITION.read_text())
    for short, node, annotation_name, counts, note_count in BOOKS:
        name = f"pri-tzaddik-rosh-chodesh-{short}-annotated.docx"
        pairs, anchors, notes = extract_word(Path("dist/library/downloads") / name)
        assert len(pairs) == sum(counts) and len(notes) == note_count
        section = next(s for s in edition["sections"] if s["node"] == node)
        assert len(section["topics"]) == len(counts)
        section["useVerifiedHebrew"] = True
        section["sourceDocument"] = name
        section["sourceChapters"] = list(range(1, len(counts) + 1))
        section["sourceUrl"] = "https://www.sefaria.org/Peri_Tzadik,_" + node.replace(" ", "_")
        start = 0
        for topic, count in zip(section["topics"], counts):
            topic["pairs"] = pairs[start:start + count]
            start += count
        annotation_path = Path(f"sources/akiva/annotations/Peri_Tzadik_Rosh_Chodesh_{annotation_name}.json")
        annotation = json.loads(annotation_path.read_text())
        for note in annotation["notes"]:
            number = note["number"]
            position = anchors[number]
            start = 0
            for topic_index, count in enumerate(counts):
                if position < start + count:
                    note["topicIndex"] = topic_index
                    note["phraseIndex"] = position - start
                    break
                start += count
            note["anchor"] = pairs[position][1]
            note["before"] = [pair[1] for pair in pairs[max(0, position - 4):position + 1]]
            note["after"] = [pair[1] for pair in pairs[position + 1:position + 4]]
            note["paragraphs"] = notes[number]
        annotation_path.write_text(json.dumps(annotation, ensure_ascii=False, separators=(",", ":")))
        print(node, len(pairs), "exact Word phrase pairs;", len(notes), "true Word footnotes")
    EDITION.write_text(json.dumps(edition, ensure_ascii=False, separators=(",", ":")))


if __name__ == "__main__":
    main()
