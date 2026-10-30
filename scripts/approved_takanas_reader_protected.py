"""Strict bridge for the independently approved Takanas HaShavin Reader revision.

The older source-quotation release is immutable, including its original
protected-files inventory. This bridge authorizes exactly the ten Reader
files changed by the October 29 revision, before quotation publication.
All other protected book files retain their original expected SHA-256.
"""
from __future__ import annotations

import hashlib
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
SOURCE = REPO / "sources/akiva/Takanat_HaShavin.json"
SOURCE_SHA256 = "bea64136f6cdfbcce4d41098ea92715be6f1f42554872f02d59401d6c68d5958"

APPROVED_READER_FILES = {
    "data/takanat-hashavin/1.json": "d3aee9a228bbb66820da6785fe36b2cbeac3632e05e6c5f9a30c09f4477dceac",
    "data/takanat-hashavin/2.json": "b4e3b68aea5fa5f3de259ba32a3640c44e79a3a41492b05fe858288e664bcc6d",
    "data/takanat-hashavin/3.json": "ecae700bed777d66b35a73876500cf4665e45c9687c5f1f89ed592368de4cef9",
    "data/takanat-hashavin/4.json": "6ba0164bc44459ae44a9505b95d85943ec6159047eab1996852a6cd011534707",
    "data/takanat-hashavin/5.json": "bac6ca357ca507ced0a61b224e1142f130e1889df8e414fc4c2992822838ec1c",
    "data/takanat-hashavin/6.json": "3ab1ffbbc436351b780c283c47144fbf73b5b27206c5077d5cd9028b4aed4455",
    "data/takanat-hashavin/7.json": "ca8194ad1d1f17e6bec8e33ee63cb9034a34aa701bb6073c7df1f578ebc58993",
    "data/takanat-hashavin/8.json": "bdc27b73002916622cb4a5d0d591b7ebf17f2f14cc37c5bb67fd19173d1df163",
    "data/takanat-hashavin/9.json": "dd6b7f2cd7026ce545da09d214b19d79078e507ef08d44d1e1d8c70801322325",
    "data/takanat-hashavin/links.json": "92a4654ace10fae1ed10dd797f97327bceef842d02098e4a1515217a57a79cc7",
}


def approved_protected_files(original_records):
    """Adapt only the audited Reader descendants; fail on missing/wrong source."""
    source = SOURCE.read_bytes()
    assert hashlib.sha256(source).hexdigest() == SOURCE_SHA256, (
        "Revised Takanas HaShavin canonical source does not match the signed-off audit"
    )
    found = set()
    adapted = []
    for entry in original_records:
        path = entry["path"]
        if path in APPROVED_READER_FILES:
            assert path not in found, "Duplicated protected Reader file: " + path
            assert entry["sha256"] != APPROVED_READER_FILES[path], (
                "Original source-quotation protected snapshot unexpectedly changed: " + path
            )
            found.add(path)
            adapted.append({**entry, "sha256": APPROVED_READER_FILES[path]})
        else:
            adapted.append(entry)
    assert found == set(APPROVED_READER_FILES), (
        "Source-quotation payload does not protect every revised Takanas Reader file"
    )
    return adapted
