# CLAUDE.md — Regelwerk für Claude Code

## Projekt: Phonbot Voice Agent SaaS
Monorepo mit pnpm workspaces.

## Architektur
```
voice-agent-saas/
├── apps/
│   ├── api/          # Fastify + TypeScript Backend (Port 3002 dev)
│   └── web/          # React + Tailwind + Vite Frontend (Port 3000 dev)
├── packages/
│   ├── shared/       # Shared types & utils (@vas/shared)
│   ├── ui/           # Shared UI components (@vas/ui)
│   └── voice-core/   # Voice types + OpenAI Realtime provider (reference, not imported at runtime)
├── apps/api/.env     # ALLE API-Keys hier (Single Source — keine Root .env)
├── apps/web/.env     # Vite-spezifische Frontend-Vars (VITE_*)
└── CLAUDE.md         # Diese Datei
```

## Tech Stack
- **API:** Fastify 5, TypeScript, pg (PostgreSQL/Supabase), Redis, Zod, bcrypt, Stripe, Retell AI, OpenAI, Resend, Twilio
- **Web:** React 19, Tailwind CSS 4, Vite 6, retell-client-js-sdk
- **Runtime:** Node.js 24, pnpm, ESM (`"type": "module"`)
- **TypeScript:** Strict mode, `noUncheckedIndexedAccess: true`

## KRITISCHE REGELN

### 1. KEINE DOPPELTEN DEKLARATIONEN
**Das ist das häufigste Problem.** Bevor du eine Variable, Type, Konstante oder Funktion deklarierst:
- Suche IMMER zuerst ob sie bereits in der Datei existiert
- `type IconComp`, `const [state, setState]`, Interface-Namen — alles prüfen
- Wenn sie existiert: WIEDERVERWENDE sie, deklariere sie NICHT nochmal
- Bei useState: NIEMALS die gleiche useState-Zeile doppelt einfügen

### 2. IMPORTS PRÜFEN
Bevor du einen Import hinzufügst:
- Prüfe ob der Import bereits am Anfang der Datei steht
- Doppelte Imports crashen die App
- Wenn du eine Funktion aus einer Datei brauchst, prüfe ob sie exportiert ist

### 3. IMMER TYPECHECK NACH ÄNDERUNGEN
Nach jeder Änderung an .ts/.tsx Dateien:
```bash
cd apps/api && pnpm typecheck    # Backend prüfen
cd apps/web && pnpm typecheck    # Frontend prüfen
```
Committe NICHTS was nicht typecheckt.

### 4. VITE DEV SERVER NICHT KILLEN
- Der Vite Dev Server auf Port 3000 und die API auf Port 3002 laufen parallel
- Starte sie NICHT neu wenn du Frontend-Dateien editierst (Vite hat Hot Reload)
- Starte die API nur neu wenn du Backend-Dateien änderst

### 5. .ENV DATEIEN
- **Single source of truth: `apps/api/.env`** — kein Root `.env` mehr
- Docker prod (`docker-compose.yml`) liest direkt `apps/api/.env`
- Dev (`apps/api/src/env.ts`) lädt nur `apps/api/.env` (kein Fallback — fail loud bei fehlenden Keys)
- Web hat ein eigenes `apps/web/.env` für Vite-spezifische Vars (`VITE_*`)
- Templates liegen unter `apps/api/.env.example` und `apps/web/.env.example`
- System-Umgebungsvariablen können `.env`-Werte überschreiben (Standard-dotenv-Verhalten ohne `override`)

### 6. DATEIGRÖSSE BEACHTEN
Einige Dateien sind SEHR groß (AgentBuilder.tsx ~2000+ Zeilen). Wenn du Änderungen machst:
- Mache GEZIELTE Edits, nicht komplette Rewrites
- Lies nur die relevanten Zeilen, nicht die ganze Datei
- Achte auf den Kontext um deine Änderung herum

### 7. ESM / IMPORTS
- Alle Imports müssen `.js` Extension haben (ESM): `import { x } from './file.js'`
- NICHT: `import { x } from './file'` (wird in ESM nicht aufgelöst)

### 8. DATENBANK
- PostgreSQL via Supabase
- Alle Tabellen werden via Auto-Migration in `db.ts` → `migrate()` erstellt
- `CREATE TABLE IF NOT EXISTS` + `ALTER TABLE ADD COLUMN IF NOT EXISTS` Pattern
- Neue Tabellen: in `migrate()` in `db.ts` hinzufügen ODER als separate `migrateXxx()` Funktion
- Pool ist ein Proxy — wird lazy initialisiert, immer `if (!pool)` prüfen

### 9. AUTH PATTERN
```typescript
// Route mit Auth:
app.get('/my-route', { onRequest: [app.authenticate] }, async (req, reply) => {
  const { userId, orgId, role } = req.user as JwtPayload;
  // ...
});
```
- JWT Token im `Authorization: Bearer xxx` Header
- `JwtPayload` importieren aus `./auth.js`
- Org-basierte Multi-Tenancy: fast alle Queries filtern nach `org_id`

### 10. FRONTEND PATTERNS
- Alle API-Calls über `apps/web/src/lib/api.ts` → `request<T>()` Helper
- Access JWT in **memory only** (module-scope `_accessToken` in `api.ts`, synced via `setAccessToken()` from AuthProvider). NEVER in localStorage — XSS can't exfiltrate.
- Refresh token as **httpOnly cookie** (`vas_refresh`, path=/auth, sameSite=strict). Bootstrap: `POST /auth/refresh` → fresh access JWT.
- Dark Theme: `bg-[#0a0a12]` als Basis, Glass-Effekte mit `bg-white/5 backdrop-blur-xl border border-white/10`
- Brand-Farbe: Orange (`#F97316`, `#FB923C`) — NICHT Indigo/Lila für Hauptelemente
- Chipy (Maskottchen) ist ein goldener Hamster → `FoxLogo.tsx`
- Navigation über Page-State in `App.tsx`, KEIN React Router

### 11. RATE LIMITING
```typescript
app.post('/my-route', {
  config: { rateLimit: { max: 10, timeWindow: '1 minute' } },
}, handler);
```

### 12. NEUE ROUTES REGISTRIEREN
Wenn du eine neue Route-Datei erstellst:
1. Exportiere eine `registerXxx(app: FastifyInstance)` Funktion
2. Importiere sie in `apps/api/src/index.ts`
3. Rufe `await registerXxx(app)` auf

### 13. FEHLER DIE DU VERMEIDEN MUSST
- ❌ `const [x, setX] = useState(...)` doppelt in einer Komponente
- ❌ `type Foo = ...` doppelt in einer Datei
- ❌ Import vergessen → Runtime Error
- ❌ `.js` Extension vergessen bei ESM Imports
- ❌ `pool.query()` ohne `if (!pool)` Guard
- ❌ Hardcoded API URLs statt den `request()` Helper zu nutzen
- ❌ Indigo/Lila als Hauptfarbe (ist Orange!)
- ❌ Eine neue Root `.env` anlegen — alles gehört in `apps/api/.env`
- ❌ Ganze Dateien überschreiben statt gezielter Edits
- ❌ `.catch(() => {})` silent-swallow — IMMER `app.log.warn/error` mit Kontext
- ❌ `tenantId`/`orgId` aus Body/Query/Header vertrauen — NUR aus JWT
- ❌ `fetch()` ohne `AbortSignal.timeout()` — jeder externe Call braucht ein Timeout
- ❌ Secrets mit hardcoded default in prod — prod MUSS `throw` wenn env fehlt
- ❌ PII (email, phone, name) in Pino-Logs — `redactPII()` oder Pino-redact-paths nutzen
- ❌ JWT/token in `localStorage` — nur in-memory (F-01/F-02)
- ❌ Secrets im Code committen — Connection-Strings mit Passwort, API-Keys, JWTs, Private-Keys. Siehe §17.

### 14. VOR JEDEM COMMIT
```bash
cd apps/api && pnpm typecheck
cd apps/web && pnpm typecheck
```
Wenn beides ohne Fehler durchläuft → OK.
Wenn nicht → Fix die Fehler BEVOR du weitermachst.

### 15. SECURITY POSTURE
- **Multi-Tenant:** Jede DB-Query mit `WHERE org_id = $1` (aus JWT). `agent_configs` hat SQL-Level `ON CONFLICT WHERE org_id` Guard.
- **Webhooks:** Retell (HMAC-SHA256 + timingSafeEqual), Stripe (constructEvent + rawBody), Twilio (signature). Alle mit `rawBody` capture.
- **Encryption at rest:** AES-256-GCM (`crypto.ts`) für OAuth-Tokens + Cal.com-Keys. Prod: boot-throw wenn `ENCRYPTION_KEY` fehlt.
- **Auth:** 1h access JWT (in-memory) + 30d refresh (httpOnly cookie, DB-rotated). Password-reset revokes all refresh tokens.
- **DSGVO:** PII-redaction (Pino-paths + `pii.redactPII()`), Sentry `beforeSend` strips bodies/user/cookies. Account-deletion cascades via FK. Google Fonts self-hosted (no IP transfer).
- **Anti-Toll-Fraud:** `ALLOWED_PHONE_PREFIXES` (DACH default) auf allen Twilio-dial-Pfaden. `isPlausiblePhone()` mit DE + intl premium-Blocklist.
- **Rate-Limits:** Global 100/min per-IP + route-specific overrides. Public endpoints (demo, contact) + outbound-call-triggers mit hourly caps + Redis global counter.
- **CAPTCHA:** Cloudflare Turnstile auf `/demo/*` + `/outbound/website-callback`. Prod fail-closed.
- **Idempotency:** Stripe webhooks via `processed_stripe_events` ON CONFLICT. Minute-reservation via atomic `tryReserveMinutes()`.

### 17. SECRET-HYGIENE (DARF NIE IN GIT)
Hintergrund: 2026-04-21 wurden drei Scripts mit hardcodetem Supabase-DB-Passwort in der Initial-Commit-History entdeckt (`scripts/test-db.mjs`, `apps/api/test-db.mjs`, `apps/api/test-migrate.mjs`). Entfernt + DB-Passwort rotiert. Nie wieder.

**Absolute Verbote** (egal in welchem Kontext — Test, Debug, One-Off, Doku-Beispiel):
- ❌ Connection-Strings mit Inline-Passwort — alles wo bei Postgres / Redis / MongoDB / MySQL ein `benutzer + doppelpunkt + passwort + @` vor dem Host steht
- ❌ Provider-Tokens (Prefix-Matches): Stripe `sk_live`, `sk_test`, `rk_live`, `whsec`; GitHub `ghp`, `github_pat`, `gho`; AWS `AKIA…`; Google `AIza…`; Slack `xoxb/xoxp/…`; Resend `re_`; Retell `key_`
- ❌ Signierte JWTs (drei Base64-Teile mit Punkten)
- ❌ Private-Key-PEM-Blöcke (BEGIN RSA/EC/OPENSSH/DSA/PGP PRIVATE KEY)
- ❌ `.env`-Dateien außerhalb von `.env.example` (Platzhalter ok)

**So geht's richtig:**
1. Echte Werte NUR in `apps/api/.env` (Single-Source) oder `apps/web/.env`
2. Im Code via `process.env.X` lesen; prod-Bootstrap wirft wenn Var fehlt (`env.ts:47-57`)
3. Templates als `.env.example` mit Dummy-Werten (`sk_live_...`, `PASSWORD`) sind erlaubt

**Automatische Absicherung:**
- Pre-Commit-Hook `.githooks/pre-commit` scannt jeden `git commit` auf obige Muster und bricht bei Treffern ab.
- Aktivierung: `pnpm install` ruft `prepare`-Script, das `git config core.hooksPath .githooks` setzt. Nach frischem Clone einmal `pnpm install` ausführen.
- `.gitignore` hat belt-and-suspenders-Patterns: `*.pem`, `*.key`, `secrets/`, `test-db.mjs`, `test-migrate.mjs`, `**/scratch/`, `**/tmp-*.{mjs,ts}`.
- Escape-Hatch nur für verifizierte False-Positives: `git commit --no-verify` (begründen im Commit-Msg).

**Wenn trotzdem was durchrutscht:**
1. Secret SOFORT im Provider-Dashboard rotieren (Supabase/Stripe/GitHub/etc.) — History-Rewrite allein genügt nicht, weil GitHub-Clones/Forks das alte bereits haben
2. Datei aus Working-Tree entfernen, ersetzen durch `process.env.X`
3. Für die paranoide Säuberung optional `git filter-repo --path <file> --invert-paths` + force-push (koordinieren mit Termi + Prod-Deploy!)

### 18. PRODUCTION DEPLOY / SSH
- Production server: `root@87.106.111.213`
- SSH key: `~/.ssh/id_ed25519`
- Repo path on server: `/opt/phonbot`
- Safe deploy command:
  ```bash
  ssh -i ~/.ssh/id_ed25519 root@87.106.111.213 "cd /opt/phonbot && bash scripts/check-prod-env.sh && bash scripts/deploy.sh"
  ```
- Before deploy: push the commit first, then verify server is clean with `cd /opt/phonbot && git status -sb`.
- After deploy: verify `docker compose ps` on the server and `https://phonbot.de/health` from outside.
- IMPORTANT: do NOT use `docker compose build --no-cache` / `BUILD_CLEAN=1` on the VPS unless the user explicitly asks. It previously OOM-crashed the server; cached `docker compose build` is the normal deploy path.

### 16. COORDINATION (Termi + Vaso)
- **`.coordination/`** im Repo-Root (gitignored) enthält die Agent-Koordination.
- Nicht committen. Nicht löschen. Bei Session-Start: `README.md → identity.md → RULES.md → inbox → findings.md` lesen.
- Details: `.coordination/memory/RULES.md` (35 Regeln).

## Design System Kurzreferenz
- **Background:** `#0a0a12` (fast schwarz)
- **Cards:** `bg-white/5 backdrop-blur-xl border border-white/10 rounded-2xl`
- **Primary:** Orange Gradient `linear-gradient(135deg, #F97316, #EA580C)`
- **Text:** `text-white`, `text-white/60` (muted), `text-white/30` (disabled)
- **Inputs:** `bg-white/5 border border-white/10 rounded-xl focus:border-orange-500/50`
- **Buttons Primary:** Orange Gradient, `rounded-xl`, `hover:scale-105`
- **Buttons Secondary:** `bg-white/5 border border-white/10 hover:bg-white/10`
- **Font:** System font stack (kein Custom Font)
- **Icons:** Custom SVG Icons in `PhonbotIcons.tsx`
- **Maskottchen:** Chipy (Hamster) → `FoxLogo.tsx`
