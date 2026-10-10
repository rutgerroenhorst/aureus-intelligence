#!/usr/bin/env bash
# Put the code back to a restore point WITHOUT rewriting history: a new commit on main whose files equal the tag.
#   scripts/restore-baseline.sh [tag]          default tag: restore/2026-10-10-current
# See docs/RESTORE.md. Run it only when you want the older state back: it pushes to main, and Vercel then deploys it.
set -euo pipefail
TAG="${1:-restore/2026-10-10-current}"
cd "$(git rev-parse --show-toplevel)"
git fetch origin --tags --quiet
git rev-parse --verify --quiet "refs/tags/$TAG" >/dev/null || { echo "No such tag: $TAG (available: $(git tag -l 'restore/*' | tr '\n' ' '))"; exit 1; }
if ! git diff --quiet || ! git diff --cached --quiet; then echo "There are uncommitted changes. Commit or stash them first."; exit 1; fi
git checkout main
git pull --ff-only origin main
PREV="$(git rev-parse HEAD)"
git read-tree -u --reset "$TAG"          # index and working tree become exactly the tagged tree (files added since are removed)
# keep this script and its documentation, so the way forward again is still on main after a restore
git checkout "$PREV" -- docs/RESTORE.md scripts/restore-baseline.sh 2>/dev/null || true
if git diff --cached --quiet; then echo "main already matches $TAG"; exit 0; fi
FWD="pre-restore/$(date +%Y%m%d-%H%M%S)"
git tag "$FWD" "$PREV"                    # where main was before this restore: a way to go forward again
git commit -q -m "Restore the system to $TAG" -m "Files are exactly those of the tag (plus docs/RESTORE.md and this script); history is kept. The state before this restore is tagged $FWD. See docs/RESTORE.md." -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
git push origin main "$FWD"
echo "Restored to $TAG. Vercel is deploying it. Restart the laptop worker (pnpm worker:start) so it loads the same code."
echo "To go forward again to what main was before:  scripts/restore-baseline.sh $FWD"
