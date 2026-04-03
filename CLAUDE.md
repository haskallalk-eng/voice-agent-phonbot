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
│   └── voice-core/   # Voice engine (@vas/voice-core)
├── .env              # Root env (fallback, meist leer oder minimal)
├── apps/api/.env     # ECHTE API-Konfiguration (alle Keys hier!)
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
- Die ECHTE Konfiguration liegt in `apps/api/.env`
- Die Root `.env` ist nur ein Fallback
- Ändere API-Keys NUR in `apps/api/.env`
- `dotenv` lädt `apps/api/.env` zuerst mit `override: true`
- Es gibt auch System-Umgebungsvariablen die ggf. gesetzt sind

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
- Auth Token aus `localStorage.getItem('vas_token')`
- Dark Theme: `bg-[#0a0a12]` als Basis, Glass-Effekte mit `bg-white/5 backdrop-blur-xl border border-white/10`
- Brand-Farbe: Orange (`#F97316`, `#FB923C`) — NICHT Indigo/Lila für Hauptelemente
- Chippy (Maskottchen) ist ein goldener Hamster → `FoxLogo.tsx`
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
- ❌ Root `.env` editieren statt `apps/api/.env`
- ❌ Ganze Dateien überschreiben statt gezielter Edits

### 14. VOR JEDEM COMMIT
```bash
cd apps/api && pnpm typecheck
cd apps/web && pnpm typecheck
```
Wenn beides ohne Fehler durchläuft → OK.
Wenn nicht → Fix die Fehler BEVOR du weitermachst.

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
- **Maskottchen:** Chippy (Hamster) → `FoxLogo.tsx`
