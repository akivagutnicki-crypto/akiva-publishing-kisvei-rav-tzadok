"""Resolve the uploaded reader manuscripts' citation candidates with Sefaria.

The result is a committed, reviewable source registry. Publication does not
depend on live network requests or turn an unresolved citation into a link.
"""
import argparse
import datetime
import gzip
import json
import re
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path
from urllib.parse import quote
from urllib.request import Request, urlopen


def source_url(ref):
    match = re.match(r"^(.*?) (\d[\dab:.\-–]*)$", ref)
    path = (match[1].replace(" ", "_") + "." + match[2].replace(":", ".")) if match else ref.replace(" ", "_")
    return "https://www.sefaria.org/" + quote(path, safe="_,.:-")


def flatten(value):
    if isinstance(value, str):
        return value
    if isinstance(value, list):
        return " ".join(flatten(item) for item in value)
    return ""


def verify(ref):
    api = "https://www.sefaria.org/api/v3/texts/" + quote(ref, safe="") + "?version=source&fill_in_missing_segments=0"
    for attempt in range(3):
        try:
            with urlopen(Request(api, headers={"User-Agent": "AkivaPublishing manuscript source verification"}), timeout=22) as response:
                data = json.load(response)
            source = " ".join(flatten(version.get("text")) for version in data.get("versions", []))
            if data.get("ref") and not data.get("error") and re.search(r"[א-תA-Za-z]", source):
                return ref, {"ref": data["ref"], "url": source_url(data["ref"]), "verified": True,
                             "api": api, "sourceCharacters": len(source), "checkedAt": datetime.datetime.now(datetime.timezone.utc).isoformat()}
            return ref, {"verified": False, "error": data.get("error", "No source text returned"), "api": api}
        except Exception as error:
            if attempt == 2:
                return ref, {"verified": False, "error": str(error), "api": api}
            time.sleep(0.3 * (attempt + 1))


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--candidates", required=True)
    parser.add_argument("--output", default="sources/verified/docx-import-links-20261022.json")
    args = parser.parse_args()
    value = json.loads(Path(args.candidates).read_text())
    refs = set(value if isinstance(value, list) else value.keys())
    output = Path(args.output)
    previous = json.loads(output.read_text()).get("references", {}) if output.exists() else {}
    reused = {}
    for source in [Path("sources/verified/beit-toldos-links.json"), Path("sources/verified/dover/kdp-sefaria-links-20261020.json.gz")]:
        if not source.exists():
            continue
        data = json.loads(gzip.decompress(source.read_bytes()) if source.suffix == ".gz" else source.read_bytes())
        for ref, proof in data.get("references", {}).items():
            if ref not in refs or not (proof.get("verified") or proof.get("isRef")):
                continue
            url = proof.get("url", "")
            if not url.startswith("https://"):
                url = "https://www.sefaria.org/" + url
            reused[ref] = {"ref": proof["ref"], "url": url, "verified": True, "evidenceFile": source.as_posix()}
    results = {ref: proof for ref, proof in reused.items() if ref in refs}
    results.update({ref: proof for ref, proof in previous.items() if ref in refs and proof.get("verified")})
    pending = sorted(refs - results.keys())
    print(f"Checking {len(refs)} citation candidates; {len(results)} existing primary-source checks, {len(pending)} new.", flush=True)

    def save():
        output.parent.mkdir(parents=True, exist_ok=True)
        output.write_text(json.dumps({"schemaVersion": 1, "method": "Sefaria v3 text API and recorded canonical-reference checks",
                                      "references": dict(sorted(results.items()))}, ensure_ascii=False, indent=2) + "\n")

    with ThreadPoolExecutor(max_workers=8) as pool:
        for future in as_completed([pool.submit(verify, ref) for ref in pending]):
            ref, proof = future.result()
            results[ref] = proof
            if len(results) % 40 == 0:
                save()
                print(f"Checked {len(results)}/{len(refs)}", flush=True)
    save()
    rejected = {ref: proof["error"] for ref, proof in results.items() if not proof.get("verified")}
    print(json.dumps({"verified": len(results) - len(rejected), "unresolved": rejected}, ensure_ascii=False), flush=True)


if __name__ == "__main__":
    main()
