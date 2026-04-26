#!/usr/bin/env bash
# Quick status of the Claude × Codex cross-review workflow.
# Run from repo root:  bash scripts/review-status.sh

set -e
ROOT="$(git rev-parse --show-toplevel)"
DIR="$ROOT/.cross-review"

if [ ! -d "$DIR" ]; then
  echo "No .cross-review/ directory found at $DIR"
  exit 1
fi

count_inbox() {
  local file="$1"
  if [ ! -f "$file" ]; then echo 0; return; fi
  grep -c '^- ' "$file" 2>/dev/null || echo 0
}

claude_inbox=$(count_inbox "$DIR/INBOX-claude.md")
codex_inbox=$(count_inbox "$DIR/INBOX-codex.md")
open_discussions=$(find "$DIR/discussions" -type f -name '*.md' ! -name '.gitkeep' 2>/dev/null | wc -l | tr -d ' ')
total_reviews=$(find "$DIR/reviews" -type f -name '*.md' ! -name '.gitkeep' 2>/dev/null | wc -l | tr -d ' ')
done_count=$(find "$DIR/done" -type f -name '*.md' ! -name '.gitkeep' 2>/dev/null | wc -l | tr -d ' ')

printf '\n  CROSS-REVIEW STATUS  (%s)\n' "$(date '+%Y-%m-%d %H:%M')"
printf '  ─────────────────────────────────\n'
printf '  Inbox  Claude   : %s open\n' "$claude_inbox"
printf '  Inbox  Codex    : %s open\n' "$codex_inbox"
printf '  Discussions     : %s open\n' "$open_discussions"
printf '  Reviews total   : %s\n'      "$total_reviews"
printf '  Done            : %s archived\n' "$done_count"
printf '\n'

if [ "$claude_inbox" -gt 0 ]; then
  printf '  >>> Claude needs to review:\n'
  grep '^- ' "$DIR/INBOX-claude.md" | sed 's/^/    /'
  printf '\n'
fi
if [ "$codex_inbox" -gt 0 ]; then
  printf '  >>> Codex needs to review:\n'
  grep '^- ' "$DIR/INBOX-codex.md" | sed 's/^/    /'
  printf '\n'
fi
if [ "$open_discussions" -gt 0 ]; then
  printf '  >>> Open discussions:\n'
  find "$DIR/discussions" -type f -name '*.md' ! -name '.gitkeep' -printf '    %f\n' 2>/dev/null \
    || ls "$DIR/discussions"/*.md 2>/dev/null | sed 's|.*/|    |'
  printf '\n'
fi
