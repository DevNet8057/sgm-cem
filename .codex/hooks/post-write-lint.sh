#!/bin/sh
# Hook PostToolUse (Write|Edit) — ESLint sur les fichiers du frontend modifiés.
# exit 2 = feedback bloquant renvoyé à Claude.

FILE=$(node -e "let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>{try{console.log(JSON.parse(d).tool_input.file_path||'')}catch(e){console.log('')}})")

FN=$(printf '%s' "$FILE" | tr '\\' '/')

# Uniquement le code source du web (l'api n'a pas de config ESLint dédiée)
case "$FN" in
  */apps/web/src/*.ts|*/apps/web/src/*.tsx) ;;
  *) exit 0 ;;
esac

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT/sgm-cem/apps/web" 2>/dev/null || exit 0

pnpm exec eslint --no-warn-ignored "$FILE" >/tmp/eslint-hook.log 2>&1 || {
  echo "❌ [hook] ESLint en échec sur $FN :" >&2
  head -25 /tmp/eslint-hook.log >&2
  exit 2
}

exit 0
