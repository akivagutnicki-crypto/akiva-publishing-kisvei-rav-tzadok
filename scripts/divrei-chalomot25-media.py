"""Add the supplied recording and PDF using the existing Noach 6 media card."""
import hashlib, json, re, sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
MANIFEST = json.loads((ROOT/'sources/akiva/divrei-chalomot25/media.json').read_text())
REV = '20261113-dc25-media'
PDF = 'downloads/divrei-chalomot-ois-25-interlinear-commentary.pdf'
AUDIO = 'audio/divrei-chalomot-ois-25-chanukah.m4a'
def sha(data): return hashlib.sha256(data).hexdigest()
def inventory(site): return {p.relative_to(site).as_posix():sha(p.read_bytes()) for p in site.rglob('*') if p.is_file()}

def apply(site):
    before = inventory(site)
    audio = b''.join((ROOT/p['path']).read_bytes() for p in MANIFEST['parts'])
    assert len(audio) == MANIFEST['bytes'] and sha(audio) == MANIFEST['sha256']
    pdf = (ROOT/MANIFEST['pdf']['path']).read_bytes()
    assert len(pdf) == MANIFEST['pdf']['bytes'] and sha(pdf) == MANIFEST['pdf']['sha256'] and pdf.startswith(b'%PDF-')
    for rel,data in [(AUDIO,audio),(PDF,pdf)]:
        path=site/'library'/rel; path.parent.mkdir(parents=True,exist_ok=True);path.write_bytes(data)
    track = """    'Divrei Chalomot 25': {
      key: 'divrei-chalomot-25-chanukah',
      label: 'Divrei Chalomos · Ois 25 · Chanukah',
      collection: 'Divrei Chalomos, Zeh Leumas Zeh',
      speaker: 'Shiur on Rav Tzadok HaKohen',
      src: 'audio/divrei-chalomot-ois-25-chanukah.m4a',
      format: 'M4A',
      duration: '66:23', bytes: '25.0 MB'
    },
"""
    player=site/'library/shiur-player.js';text=player.read_text()
    if "'Divrei Chalomot 25':" not in text:
        assert text.count('const TRACKS = {') == 1
        text=text.replace('const TRACKS = {','const TRACKS = {\n'+track,1);player.write_text(text)
    card = """  } else if (d.sectionRef === 'Divrei Chalomot 25') {
    html += `<div class="noach6-media divrei25-media">${shiurMarkup}
      <details class="noach6-pdf divrei25-pdf">
        <summary>📄 Preview the interlinear translation and commentary · 16-page PDF</summary>
        <iframe title="Preview Divrei Chalomos Ois 25 interlinear translation and commentary, 16 pages" loading="lazy"
          src="downloads/divrei-chalomot-ois-25-interlinear-commentary.pdf#toolbar=0&navpanes=0"></iframe>
        <a class="btn" target="_blank" rel="noopener noreferrer"
          href="downloads/divrei-chalomot-ois-25-interlinear-commentary.pdf">Open or download PDF ↗</a>
      </details>
    </div>`;
"""
    changed_readers=[]
    for rel in ['library/index.html','library/open/index.html']:
        p=site/rel;text=p.read_text()
        if 'const shiurMarkup =' not in text:
            assert rel.endswith('open/index.html') and 'Android' in text
            continue
        if 'class="noach6-media divrei25-media"' not in text:
            anchor="  } else if (d.sectionRef === 'Divrei Soferim 16') {"
            assert text.count(anchor)==1 and "d.sectionRef === 'Peri Tzadik, Noach 6'" in text
            text=text.replace(anchor,card+anchor,1)
        text,n=re.subn(r'shiur-player\.js\?v=[^"\s]+','shiur-player.js?v='+REV,text)
        assert n==1
        p.write_text(text);changed_readers.append(rel)
    sw=site/'library/sw.js';text=sw.read_text()
    match=re.search(r'const SHELL = `([^`]*)`;',text);assert match
    if REV not in match[1]:text=text.replace(match[0],'const SHELL = `'+match[1]+'-'+REV+'`;');sw.write_text(text)
    after=inventory(site);changed=sorted(p for p in after if before.get(p)!=after[p])
    allowed={*changed_readers,'library/shiur-player.js','library/sw.js','library/'+PDF,'library/'+AUDIO}
    assert not(set(before)-set(after)), 'A published file was removed'
    assert set(changed)<=allowed, 'Unrelated files changed: '+str(set(changed)-allowed)
    report={'revision':REV,'audioBytes':len(audio),'audioSha256':sha(audio),'pdfBytes':len(pdf),'pdfSha256':sha(pdf),'layout':'Pri Tzaddik Noach 6','changedFiles':changed,'preservedFiles':sum(after.get(p)==h for p,h in before.items()),'hashes':{p:after[p] for p in allowed if p in after}}
    (site/'library/divrei-chalomot25-media-publication.json').write_text(json.dumps(report,indent=2))
    verify(site);print(json.dumps(report))

def verify(site):
    html=(site/'library/index.html').read_text()
    assert html.count('class="noach6-media divrei25-media"')==1
    branch=html.split("d.sectionRef === 'Divrei Chalomot 25'",1)[1].split("d.sectionRef === 'Divrei Soferim 16'",1)[0]
    assert '${shiurMarkup}' in branch and '<details class="noach6-pdf divrei25-pdf">' in branch and '<details open' not in branch
    assert PDF in branch and '16-page PDF' in branch
    assert 'class="noach6-media"' in html and 'class="noach6-media divrei16-media"' in html
    assert html.index('class="noach6-media divrei25-media"') < html.index('const lechDownloads =')
    player=(site/'library/shiur-player.js').read_text()
    for ref in ["'Divrei Chalomot 25':","'Peri Tzadik, Noach 6':","'Divrei Soferim 16':"]:assert ref in player
    assert sha((site/'library'/AUDIO).read_bytes())==MANIFEST['sha256']
    assert sha((site/'library'/PDF).read_bytes())==MANIFEST['pdf']['sha256']
    print('PASS: original audio/PDF checksums; Noach 6 combined media layout; collapsed PDF; existing media retained')

if __name__=='__main__':
    mode=sys.argv[1];site=Path(sys.argv[2]);globals()[mode](site)
