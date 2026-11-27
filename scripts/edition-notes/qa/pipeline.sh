#!/bin/bash
# usage: pipeline.sh WORKDIR [nontal_drop.json nontal_fix.json]
set -e; cd "$1"; Q=/home/claude/qa
for s in quotes fix_quotes amud fix_amud drop_unrelated; do echo "== $s"; PYTHONPATH=$Q python3 $Q/$s.py | tail -1; done
if [ -n "$2" ]; then echo "== review drops"; PYTHONPATH=$Q python3 $Q/nontal_apply.py $2 $3 | tail -1; fi
for s in polish shemos linkify rprorder moves quotes fix_quotes; do echo "== $s"; PYTHONPATH=$Q python3 $Q/$s.py | tail -1; done
