#!/usr/bin/env bash
# Print the per-package and total unit test counts.
#
# These numbers used to live in STATUS.md. Every branch bumped the same two lines, so every
# pair of open PRs conflicted there and one merge silently landed a wrong total. Generate
# them instead of writing them down.
set -uo pipefail

cd "$(dirname "$0")/.."

log=$(mktemp)
trap 'rm -f "$log"' EXIT

pnpm -r test >"$log" 2>&1
status=$?

python3 - "$log" "$status" <<'PY'
import re, sys

text = open(sys.argv[1], errors='replace').read()
status = sys.argv[2]

counts = {}
for line in text.splitlines():
    passed = re.search(r'Tests\s+(\d+)\s+passed', line)
    if not passed:
        continue
    fields = line.split()
    if fields:
        counts[fields[0]] = counts.get(fields[0], 0) + int(passed.group(1))

width = max((len(p) for p in counts), default=5)
for pkg in sorted(counts):
    print(f'{pkg:<{width}}  {counts[pkg]}')
print(f'{"TOTAL":<{width}}  {sum(counts.values())}')

failed = re.findall(r'Tests\s+\d+\s+failed', text)
print(f'failing blocks: {len(failed)}')
sys.exit(1 if failed or status != '0' else 0)
PY
