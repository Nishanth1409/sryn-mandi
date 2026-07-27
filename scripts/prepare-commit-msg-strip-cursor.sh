#!/bin/sh
# Strip Cursor Agent attribution that GitHub counts as a second contributor.
MSG_FILE="$1"
if [ -z "$MSG_FILE" ] || [ ! -f "$MSG_FILE" ]; then
  exit 0
fi
tmp=$(mktemp 2>/dev/null || echo "$MSG_FILE.tmp")
grep -v -E '^Co-authored-by: Cursor|^Co-authored-by: cursoragent|^Made-with: Cursor|^Made-with: cursor' "$MSG_FILE" > "$tmp" 2>/dev/null || exit 0
mv "$tmp" "$MSG_FILE"
exit 0
