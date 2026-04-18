# Secrets Rotation Runbook

Wenn `apps/api/.env` mal eingesehen oder geleakt wurde, **alle** Keys bei den Providern rotieren. `.env` ist lokal/auf dem Server und gitignored — nie in Git.

## Reihenfolge (höchstes Risiko zuerst)

### 1. Stripe — **sofort**
- Dashboard → Developers → API keys → "Roll secret key"
- Neuen `STRIPE_SECRET_KEY` in `apps/api/.env` auf Server setzen
- Webhook-Secret: Dashboard → Developers → Webhooks → Endpoint → "Roll signing secret" → `STRIPE_WEBHOOK_SECRET`

### 2. Twilio — **sofort**
- Console → Account → API keys & tokens → Auth Token → "Change" (generiert neuen `TWILIO_AUTH_TOKEN`)
- Ggf. zusätzlich: Account SID rotieren ist NICHT möglich, nur Auth Token

### 3. OpenAI
- Platform → API keys → alten Key revoken, neuen erstellen → `OPENAI_API_KEY`

### 4. Retell
- Dashboard → API Keys → Revoke + Create → `RETELL_API_KEY`
- Webhook-Secret: `RETELL_WEBHOOK_SECRET` (falls separat vergeben)

### 5. Supabase / Postgres
- Dashboard → Settings → Database → Reset Database Password → `DATABASE_URL` anpassen
- Alle aktiven Sessions werden gekickt, API braucht Neustart

### 6. Resend
- Dashboard → API Keys → Revoke + Create → `RESEND_API_KEY`

### 7. Google OAuth (Calendar/Gmail)
- Cloud Console → Credentials → Client-Secret rotieren → `GOOGLE_CLIENT_SECRET`
- Alle bestehenden Refresh-Tokens der User werden ungültig → User müssen neu verbinden

### 8. Microsoft OAuth
- Entra ID → App registrations → Certificates & secrets → neuen Client Secret → alten löschen → `MS_CLIENT_SECRET`

### 9. LiveKit / Deepgram / ElevenLabs
- Jeweiliges Dashboard → API Keys → rotieren
- `LIVEKIT_API_SECRET`, `DEEPGRAM_API_KEY`, `ELEVENLABS_API_KEY`

### 10. Redis
- Läuft aktuell ohne Passwort im Docker-Netz (nur intern erreichbar). Wenn extern exponiert würde: `REDIS_PASSWORD` setzen + `requirepass` in Redis-Config.

### 11. ENCRYPTION_KEY (OAuth-Token-AES-GCM)
- **NICHT einfach rotieren!** Verschlüsselt OAuth-Tokens in der DB (`google_tokens`, `ms_tokens`, `cal_com_keys`). Rotation würde alle bestehenden Tokens unlesbar machen.
- Nur bei echter Kompromittierung: neue Key setzen UND alle User-Integrationen invalidieren → User müssen Google/MS/Cal neu verbinden.

### 12. JWT_SECRET
- Neuer Key → alle aktiven Access-JWTs ungültig → alle User werden ausgeloggt. Refresh-Tokens in DB bleiben gültig (anderer Mechanismus).

## Deploy nach Rotation

```bash
ssh root@87.106.111.213
cd /opt/phonbot
# apps/api/.env mit neuen Keys editieren
nano apps/api/.env
docker compose restart api web
docker compose logs -f api  # prüfen dass kein "ENV missing" Error kommt
```

## Prevention
- `.env` ist in `.gitignore` — nie committen
- `.env.example` enthält nur Placeholder
- Secrets niemals in Logs, Error-Messages oder Sentry
- Audit: `git log --all -p | grep -iE "password|secret|key=|token="` regelmäßig checken
