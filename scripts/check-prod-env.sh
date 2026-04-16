#!/usr/bin/env bash
#
# Pre-deployment sanity check: validates that all required environment
# variables are set in apps/api/.env before you `docker compose up`.
#
# Usage:
#   bash scripts/check-prod-env.sh [path-to-env]
#
# Defaults to apps/api/.env if no arg given. Exits 0 if all required
# vars are set, 1 if any are missing. Green/red per line.

set -euo pipefail

ENV_FILE="${1:-apps/api/.env}"

if [[ ! -f "$ENV_FILE" ]]; then
  echo "❌ File not found: $ENV_FILE"
  echo "   Copy apps/api/.env.example → apps/api/.env and fill in the values."
  exit 1
fi

# Required in production. Each line: VAR_NAME | human-readable hint
REQUIRED_VARS=(
  "DATABASE_URL|Supabase PostgreSQL connection string"
  "JWT_SECRET|Min 32 chars, random string (openssl rand -base64 32)"
  "RETELL_API_KEY|Retell Dashboard → API Keys"
  "STRIPE_SECRET_KEY|Stripe Dashboard → Developers → API Keys"
  "STRIPE_WEBHOOK_SECRET|Stripe Dashboard → Webhooks → Signing secret"
  "RESEND_API_KEY|Resend Dashboard → API Keys"
  "APP_URL|e.g. https://phonbot.de"
  "WEBHOOK_BASE_URL|Same as APP_URL for Caddy setups"
  "OPENAI_API_KEY|platform.openai.com → API Keys"
  "ENCRYPTION_KEY|AES-256-GCM for OAuth tokens (openssl rand -hex 32)"
  "OAUTH_STATE_SECRET|HMAC key for calendar OAuth state (openssl rand -hex 32)"
  "ADMIN_PASSWORD_HASH|bcrypt hash: node -e \"console.log(require('bcrypt').hashSync('pw', 12))\""
  "TURNSTILE_SECRET_KEY|Cloudflare Turnstile → Site → Secret Key"
)

# Recommended (warn, don't fail)
RECOMMENDED_VARS=(
  "REDIS_URL|Redis connection (rediss:// in prod). Fallback: in-memory"
  "SENTRY_DSN|Sentry error tracking DSN"
  "TWILIO_ACCOUNT_SID|Twilio Console → Account Info"
  "TWILIO_AUTH_TOKEN|Twilio Console → Account Info"
  "SIP_TRUNK_USERNAME|Twilio SIP trunk credentials"
  "SIP_TRUNK_PASSWORD|Twilio SIP trunk credentials"
  "SIP_TERMINATION_URI|Twilio SIP termination URI"
  "TWILIO_BUNDLE_SID|Twilio regulatory bundle for DE numbers"
  "TWILIO_ADDRESS_SID|Twilio address SID for DE numbers"
)

MISSING=0
WARNED=0

echo ""
echo "🔍 Checking production env vars in: $ENV_FILE"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

for entry in "${REQUIRED_VARS[@]}"; do
  VAR="${entry%%|*}"
  HINT="${entry#*|}"
  VALUE=$(grep "^${VAR}=" "$ENV_FILE" 2>/dev/null | head -1 | cut -d= -f2-)
  if [[ -z "$VALUE" || "$VALUE" == "sk_live_..." || "$VALUE" == "key_..." || "$VALUE" == "re_..." || "$VALUE" == "whsec_..." || "$VALUE" == "price_..." ]]; then
    echo "  ❌ $VAR — MISSING or placeholder"
    echo "     → $HINT"
    MISSING=$((MISSING + 1))
  else
    echo "  ✅ $VAR"
  fi
done

echo ""
echo "━━━ Recommended (optional but important) ━━━"

for entry in "${RECOMMENDED_VARS[@]}"; do
  VAR="${entry%%|*}"
  HINT="${entry#*|}"
  VALUE=$(grep "^${VAR}=" "$ENV_FILE" 2>/dev/null | head -1 | cut -d= -f2-)
  if [[ -z "$VALUE" ]]; then
    echo "  ⚠️  $VAR — not set"
    echo "     → $HINT"
    WARNED=$((WARNED + 1))
  else
    echo "  ✅ $VAR"
  fi
done

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
if [[ $MISSING -gt 0 ]]; then
  echo "❌ $MISSING required var(s) missing. Fix before deploying."
  exit 1
else
  echo "✅ All required vars set."
  if [[ $WARNED -gt 0 ]]; then
    echo "⚠️  $WARNED recommended var(s) unset — features may be limited."
  fi
  exit 0
fi
