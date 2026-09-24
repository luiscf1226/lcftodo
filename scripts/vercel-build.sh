#!/usr/bin/env bash
# Vercel build entry point (see vercel.ts and docs/DEPLOY.md).
# Production: push Convex functions/schema with CONVEX_DEPLOY_KEY, then build Next.js
#   against the prod deployment (convex deploy sets NEXT_PUBLIC_CONVEX_URL for the build).
# Preview: build only, against the dev deployment set in the Preview env
#   (NEXT_PUBLIC_CONVEX_URL), so preview code never touches production.
set -euo pipefail

if [ "${VERCEL_ENV:-}" = "production" ]; then
  if [ -z "${CONVEX_DEPLOY_KEY:-}" ]; then
    echo "CONVEX_DEPLOY_KEY is not set for Production. See docs/DEPLOY.md." >&2
    exit 1
  fi
  exec npx convex deploy --cmd 'npm run build'
fi

exec npm run build
