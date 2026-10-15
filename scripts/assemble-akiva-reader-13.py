#!/usr/bin/env python3
"""Reassemble byte-exact reader ZIP uploads from GitHub-safe binary chunks."""
import hashlib
import os
from pathlib import Path

ROOT=Path('incoming')
PARTS=ROOT/'chunks'
EXPECTED={
  1:('48d4cd4a52575036476a99d268583956a4dba4b9bbde1245ecf71561d775afc1',15828264,11),
  2:('e7a452f4a99219d9b8a020fe3c0588266ff5b862ce09d43f44caa908c770f07e',16639847,11)
}
def main():
  for number,(digest,size,count) in EXPECTED.items():
    name=f'akiva-reader-13-part-{number}'
    target=ROOT/(name+'.zip')
    if target.is_file():
      h=hashlib.sha256(target.read_bytes()).hexdigest()
      if h!=digest or target.stat().st_size!=size:
        raise ValueError(f'Existing {target} differs from the approved release')
      print('PASS existing source archive',target)
      continue
    folder=PARTS/name
    files=sorted(folder.glob('part-*.bin'))
    expected_names=[f'part-{i:02}.bin' for i in range(1,count+1)]
    if [f.name for f in files]!=expected_names:
      raise ValueError(f'Incomplete {name}: found {len(files)} of {count} binary chunks')
    hash_state=hashlib.sha256()
    dest=target.with_suffix('.zip.tmp')
    length=0
    with dest.open('wb') as out:
      for f in files:
        data=f.read_bytes()
        length+=len(data)
        hash_state.update(data)
        out.write(data)
    if length!=size or hash_state.hexdigest()!=digest:
      dest.unlink(missing_ok=True)
      raise ValueError('Checksum/length validation failed for '+name)
    os.replace(dest,target)
    print(f'PASS reassembled {target} ({length} bytes), SHA-256 {digest}')
  print('PASS both exact source ZIP archives reconstructed.')
if __name__=='__main__':main()
