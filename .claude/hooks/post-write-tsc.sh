#!/bin/sh
# Hook PostToolUse (Write|Edit) — type-check du workspace touché.
# Reçoit le JSON de l'événement sur stdin ; exit 2 = feedback bloquant renvoyé à Claude.
# Référence : type-check api et web à ZÉRO erreur depuis le 2026-07-16 — toute erreur est nouvelle.

FILE=$(node -e "let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>{try{console.log(JSON.parse(d).tool_input.file_path||'')}catch(e){console.log('')}})")

# Uniquement les fichiers TypeScript
case "$FILE" in
  *.ts|*.tsx) ;;
  *) exit 0 ;;
esac

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT/sgm-cem" 2>/dev/null || exit 0

# Normaliser les antislashs Windows pour le match
FN=$(printf '%s' "$FILE" | tr '\\' '/')

case "$FN" in
  */apps/api/*)
    pnpm --filter api type-check >/tmp/tsc-hook.log 2>&1 || {
      echo "❌ [hook] type-check api en échec après modification de $FN :" >&2
      grep -E "error TS" /tmp/tsc-hook.log | head -15 >&2
      exit 2
    } ;;
  */apps/web/*)
    pnpm --filter web type-check >/tmp/tsc-hook.log 2>&1 || {
      echo "❌ [hook] type-check web en échec après modification de $FN :" >&2
      grep -E "error TS" /tmp/tsc-hook.log | head -15 >&2
      exit 2
    } ;;
  */packages/shared/*)
    pnpm --filter @sgm-cem/shared type-check >/tmp/tsc-hook.log 2>&1 || {
      echo "❌ [hook] type-check shared en échec :" >&2
      grep -E "error TS" /tmp/tsc-hook.log | head -15 >&2
      exit 2
    } ;;
esac

exit 0
