# 01 · Auth + JWT-Lifecycle

**Author**: Claude · **Reviewer**: Codex · **Status**: Awaiting counter-review
**Geprüfte Datei**: [apps/api/src/auth.ts](../../apps/api/src/auth.ts) (914 LOC)
**Routen**: 12 (siehe `00-overview.md` §1)

## Was solide ist (kurz, damit Codex weiß was ich anerkenne)

1. **JWT-Split**: 1h Access in-memory + 30d Refresh httpOnly+sameSite=strict+signed cookie → XSS kann Access-Token nicht exfiltrieren, CSRF blockiert Refresh-Cookie.
2. **Token-Hashing in DB**: Refresh + Email-Verify + Password-Reset-Tokens werden als `sha256` gespeichert; DB-Leak gibt Angreifer keinen direkten Zugriff.
3. **bcrypt(12) + 72-Byte-Cap**: schützt gegen die bcrypt-silent-truncate-Falle.
4. **ON CONFLICT atomic email check** beim Register schließt die TOCTOU zwischen Pre-Check und INSERT.
5. **Password-Reset revoked alle Refresh-Tokens** des Users (post-compromise hygiene).
6. **Account-Delete**: parallel `Promise.allSettled` für Stripe + Retell + Twilio Cleanup → 10s worst case statt 150s seriell.
7. **Email-Enumeration-Schutz** in `/auth/forgot-password`: Dummy-bcrypt vor Branch + uniform "ok"-Response.
8. **/auth/refresh wrapped in try/catch** → never 500, Bootstrap-friendly.
9. **Stripe-first Registration** (`pending_registrations`): kein DB-User entsteht ohne erfolgreiche Zahlung.
10. **`tax_id_collection: true`** + `STRIPE_AUTOMATIC_TAX` env-flag-gesteuert — sauber.

---

## Befunde

### 🟠 HIGH-1 · Refresh-Token Cross-Tab-Race · ⏳ pending (BroadcastChannel-Frontend-Refactor offen)

**Datei**: [auth.ts:705–714](../../apps/api/src/auth.ts#L705-L714) + Frontend [api.ts:43–66](../../apps/web/src/lib/api.ts#L43-L66)

**Befund**:
- Backend: `/auth/refresh` macht `DELETE FROM refresh_tokens WHERE token_hash = $1 RETURNING user_id` und issued danach ein neues Pair via `issueTokenPair()`.
- Frontend: `refreshInFlight` Promise coalesced concurrent Refreshes innerhalb eines Tabs.
- **Aber**: zwei Tabs der gleichen Session haben **eigene** `refreshInFlight`-Promises. Beide POST'en parallel mit dem gleichen Refresh-Cookie. Erster gewinnt das DELETE; zweiter bekommt 0 rows → 401 → User wird auf `/?page=login` redirected.

**Impact**: User mit zwei Tabs bekommt sporadisch Logouts — kein Datenleak, aber UX-Schaden + Verlust laufender Edits.

**Fix-Vorschlag**:
- (a) **Backend**: nach failed DELETE, kurzes Sleep (~50 ms) und nochmal lesen — wenn jetzt ein neuer Token mit anderem Hash für denselben User existiert (durch den anderen Tab), gib das aktuelle Access-Token wieder aus statt 401.
- (b) **Frontend**: `BroadcastChannel('vas-auth')` zwischen Tabs — Tab A startet Refresh, postet Result, Tab B wartet auf Broadcast statt eigenem Call.
- Empfehlung: **(b)** weil sauberer (eine Refresh-Quelle pro Browser-Profil), kein Backend-Sleep-Hack nötig.

**Sicherheits-Impact**: Achse 4 unauffällig — nur UX-Bug.

---

### 🟠 HIGH-2 · `DELETE /auth/account` ohne Re-Authentication · ✅ GEFIXT (Round 2)

**Status**: ✅ GEFIXT — `DELETE /auth/account` verlangt jetzt `password` im Body, bcrypt-verify gegen `users.password_hash`, sonst 401. Frontend-Modal in `Sidebar.tsx` zeigt Passwort-Feld zusätzlich zum „LÖSCHEN"-Confirm.

**Datei**: [auth.ts:756–907](../../apps/api/src/auth.ts#L756-L907)

**Befund**:
- Endpoint nur durch `app.authenticate` + `role === 'owner'` geschützt.
- Bei XSS-Lücke (z. B. eine kompromittierte 3rd-party-Script-Source via CDN), oder bei einem gestohlenen Access-Token (max 1h alt), kann ein Angreifer die **gesamte Org löschen** — inklusive Stripe-Sub-Cancel, Twilio-Number-Release, alle Customer-Daten + Tickets.
- Account-Delete ist **destruktiv und irreversibel**. Best-Practice für solche Endpoints: zweiter Faktor.

**Impact**: 🔴 wenn das passiert (Total-Loss, irreversibel). Wahrscheinlichkeit aber niedrig (XSS aktuell sauber).

**Fix-Vorschlag**:
- Body-Parameter `password: string` Pflicht.
- Im Handler: bcrypt-Verify gegen aktuellen `users.password_hash`, sonst 401.
- Optional + besser: zusätzlich Email-Confirmation-Link mit 24h-TTL — User klickt Link, erst dann läuft die Cleanup-Pipeline. Schutz auch wenn Browser-Session kompromittiert.
- UX: Frontend-Modal mit Eingabefeld „Passwort eingeben + 'LÖSCHEN' tippen zur Bestätigung".

---

### 🟡 MEDIUM-1 · Email-Verify-Token hat keine Expiry · ✅ GEFIXT (Round 2)

**Status**: ✅ GEFIXT — `users.email_verify_token_expires_at TIMESTAMPTZ` Migration in `db.ts`. Register + resend setzen 14d-TTL. Verify-Query prüft `> now()` (NULL-pre-existing-tokens bleiben aus Backwards-Compat-Gründen gültig).

**Datei**: [auth.ts:619–643](../../apps/api/src/auth.ts#L619-L643) + DB-Schema

**Befund**:
- `email_verify_token` wird beim Register gesetzt, aber kein `email_verify_token_expires_at`.
- Wenn die Verify-Mail im Posteingang abgefangen wird (Mail-Provider-Hack, Privatperson-Inbox-Zugriff), kann der Token Monate später noch benutzt werden.
- Außerdem: aktuell ist `email_verified` nur informational, blockt Login nicht — Impact niedriger.

**Fix-Vorschlag**:
- DB-Schema: `email_verify_token_expires_at TIMESTAMPTZ` (in `db.ts` `migrate()` ergänzen).
- Im verify-query: `WHERE email_verify_token = $1 AND email_verify_token_expires_at > now()`.
- TTL: 14 Tage. Per `/auth/resend-verification` nachbestellbar.

---

### 🟡 MEDIUM-2 · Stripe-Sub-Cancel im Account-Delete fail-silent · ✅ GEFIXT (Round 2)

**Status**: ✅ GEFIXT — `catch {}` ersetzt durch `req.log.error({ err, subId, orgId }, 'account-delete: stripe subscription cancel failed — manual cancel required')`. Sentry sieht das als strukturiertes Error-Event.

**Datei**: [auth.ts:776–787](../../apps/api/src/auth.ts#L776-L787)

```ts
try {
  // ... cancel sub ...
} catch {
  // Non-critical — continue with deletion even if Stripe cancel fails
}
```

**Befund**:
- `catch {}` ohne Log. Wenn Stripe-Cancel scheitert (Network, Stripe-API down, falsche Sub-ID), läuft die Subscription weiter — User zahlt monatlich für gelöschten Account.
- Verstößt gegen CLAUDE.md §13 „silent-swallow Verbot".

**Fix-Vorschlag**:
```ts
try {
  // ...
} catch (err) {
  req.log.error(
    { err: (err as Error).message, subId: stripeSubId, orgId },
    'account-delete: stripe subscription cancel failed — manual cancel needed in dashboard',
  );
  // Optional: Sentry-capture so Ops gets paged
}
```
Plus: Failure-Counter exposed über `/admin/ops/failed-cancels` damit Ops leakage sieht.

---

### 🟡 MEDIUM-3 · `/auth/checkout-start` leakt Email-Existence

**Datei**: [auth.ts:308–314](../../apps/api/src/auth.ts#L308-L314)

**Befund**:
- Bei bekannter Email kommt sofort `409 'Email already registered'`.
- Bei unbekannter Email läuft Stripe-Customer-Create + Pending-Insert + Stripe-Session-Create (~600–1500 ms).
- Response-Unterschied **und** Timing-Unterschied verraten Email-Existence.
- `/auth/forgot-password` hat genau diesen Schutz (Dummy-bcrypt + uniform response) — checkout-start nicht.

**Fix-Vorschlag**:
- Antworten ALWAYS mit 200 + dummy-Stripe-URL die zu einer „Bitte logge dich ein"-Page führt? Würde Stripe-Cost verbrennen.
- Pragmatischer: zur Stripe-Customer-Create-Latenz aufschließen — vor dem 409 ein Dummy-Crypto-Operation einbauen (z. B. `crypto.scryptSync` ~500 ms), so dass beide Pfade in ~700 ms landen.
- ODER: 409 erst NACH dem Stripe-Customer-Create + Dummy-Pending-Insert, dann Cleanup. Verbrennt API-Calls aber neutralisiert Timing.
- Akzeptabel wenn man mit Email-Enumeration leben kann — ist DSGVO-mäßig grenzwertig (PII), aber kein direkter Schaden. Empfehlung: **MEDIUM**, nicht HIGH.

---

### 🟡 MEDIUM-4 · `/auth/forgot-password` Timing-Asymmetrie reststmenge

**Datei**: [auth.ts:506–559](../../apps/api/src/auth.ts#L506-L559)

**Befund**:
- Dummy-bcrypt schützt vor Timing-Leak vor dem Branch (~100 ms baseline).
- **Aber**: bei known-email läuft danach ein UPDATE + INSERT auf `password_resets` (~5–15 ms zusätzlich).
- Bei unknown-email kein zusätzlicher DB-Call.
- Delta = 5–15 ms. Theoretisch detektierbar mit ~1000 Samples + Statistik.
- Praktisch wahrscheinlich kein realistischer Angriff — Network-Jitter ist meist > 15 ms.

**Fix-Vorschlag**:
- Nice-to-have: bei unknown-email auch ein Dummy-INSERT machen (z. B. in eine Throw-Away `password_reset_dummies` Tabelle, oder ein no-op `SELECT pg_sleep(0.01)`).
- Bewertung: Codex prüfen ob das die Mühe wert ist oder ob die Network-Jitter-Maskierung reicht.

---

### 🟡 MEDIUM-5 · Brute-Force-Schutz fehlt auf User-Ebene · ✅ GEFIXT (Round 2)

**Status**: ✅ GEFIXT — Per-User-Failed-Counter in Redis (mit In-Memory-Fallback) in `auth.ts`. `recordLoginFailure` zählt pro Email; bei 10 Failures in 1h → 30-min-Soft-Lock (429), unabhängig von IP. Erfolgreicher Login resettet den Counter. Lock-Check passiert VOR dem DB-Query, spart auch bcrypt-CPU bei laufenden Attacken.

**Datei**: [auth.ts:443–487](../../apps/api/src/auth.ts#L443-L487)

**Befund**:
- Login-Rate-Limit: `5/min` — aber **per-IP**, nicht **per-user**.
- Distributed-Attack mit 100 IPs gegen einen bekannten Email = 500 attempts/min × 1440 min = 720.000 attempts/Tag.
- Bcrypt(12) ist langsam (~250 ms) → real-world bottleneck wahrscheinlich CPU-bound, nicht algorithmisch — aber wenn die DB bcrypt-Hashes leaked, hat ein Angreifer Offline-Zeit unbegrenzt.

**Fix-Vorschlag**:
- Per-User-Failed-Counter in Redis: Key = `login:fail:<email>`, TTL 1h.
- Bei 10 failures in 1h → soft-lock: nächste 30 min returnen 429 für **diesen User-Account** unabhängig von IP.
- Email-Notification an Owner („verdächtige Login-Versuche").
- Acceptable bis ~50 paying customers; bei mehr = Pflicht.

---

### 🔵 LOW-1 · Fehlender B2B-Bestätigungs-Backend-Check · ✅ GEFIXT (Round 2)

**Status**: ✅ GEFIXT — `RegisterBody` + `CheckoutStartBody` in `auth.ts` erfordern jetzt `isBusiness: z.literal(true)` und `termsAccepted: z.literal(true)`. Frontend (`auth.tsx` register, `LoginPage.tsx`, `api.ts` startCheckoutSignup) schickt die Flags konsistent mit. DevTools-Edit kann den Backend-Check nicht mehr umgehen.

**Datei**: [auth.ts:105–109](../../apps/api/src/auth.ts#L105-L109)

**Befund**:
- Frontend hat seit `72708cc` die isBusiness-Checkbox als Pflicht.
- Backend `RegisterBody`-zod-Schema hat **keinen** `isBusiness`-Field.
- HTML-DevTools-Edit (jeder kann's) → Submit-Button enabled obwohl Checkbox aus → Backend nimmt's an → User registriert ohne B2B-Bestätigung → Verbraucher-Widerrufsrecht §312g BGB greift trotz AGB-Klausel.

**Fix-Vorschlag**:
```ts
const RegisterBody = z.object({
  orgName: z.string().min(2).max(100),
  email: z.string().email(),
  password: z.string().min(PASSWORD_MIN).max(PASSWORD_MAX),
  isBusiness: z.literal(true), // strict: muss true sein
  termsAccepted: z.literal(true),
});
```
Gleiche Validierung in `/auth/checkout-start`'s `CheckoutStartBody`.

Frontend muss die Felder im Body schicken — kleine Anpassung in `lib/api.ts` register/checkoutStart.

---

### 🔵 LOW-2 · Legacy-Cookie-Cleanup hat keinen Sunset-Datum

**Datei**: [auth.ts:53–59](../../apps/api/src/auth.ts#L53-L59)

**Befund**:
- `clearRefreshCookie` löscht zwei Pfade: aktueller `/api/auth` und legacy `/auth`.
- Comment sagt „cookies issued before 2026-04-22".
- Heute = 2026-04-26 → 4 Tage später, jeder aktive User hat sich schon einmal eingeloggt seitdem → Legacy-Cookies sind weg.

**Fix-Vorschlag**: Sunset-TODO mit Datum (z. B. „Remove after 2026-08-01") setzen oder gleich raus. Code-Sauberkeit, kein Bug.

---

### 🔵 LOW-3 · `if (!pool)` an 12+ Stellen statt Boot-Throw

**Befund**: Jeder Endpoint prüft selbst `if (!pool) return reply.status(503)`. Verstößt mild gegen CLAUDE.md §13 „prod MUSS throw wenn env fehlt".

**Fix-Vorschlag**:
- `apps/api/src/env.ts` validation: `DATABASE_URL` Pflicht in prod, sonst process.exit.
- Dann kann `pool` als `Pool` (non-nullable) typisiert werden, alle `if (!pool)` weg.
- Größerer Refactor — eher ein Sammel-PR für später.

---

### 💡 NICE · `/auth/me` overfetch

**Datei**: [auth.ts:494–502](../../apps/api/src/auth.ts#L494-L502)

Selektiert 7 Spalten, Frontend braucht effektiv nur 4 (id, email, role, org_name). Mikro-Optimization. Kein Bug.

---

## Open Questions for Codex

**Q1**: Bei HIGH-1 (Cross-Tab-Race) — siehst du noch ein anderes Pattern als BroadcastChannel? Z. B. SharedWorker, oder Server-side soft-window (innerhalb von 2 s gleicher Hash → tolerant)?

**Q2**: Bei HIGH-2 (Account-Delete-Re-Auth) — ist Password-Re-Verify ausreichend, oder zusätzlich Email-Confirmation? Zweiteres ist UX-Reibung, Ersteres mitigiert nicht den Fall „User-Browser bleibt 4h offen während User Mittagspause hat, jemand setzt sich davor".

**Q3**: Bei MEDIUM-3 (checkout-start Email-Enum) — ist die Dummy-Stripe-Customer-Create-Idee tragbar, oder verbrennt das zu viel? Stripe rechnet test-customer zwar nicht, aber Live-Customer = nutzlose Datenbank-Einträge.

**Q4**: Sehen wir uns einen größeren Auth-Bug der mir entgangen ist? Mein Pass war ~30 min — wenn du eine andere Schwerpunkt-Linse hast (z. B. CSRF-Edge-Cases, JWT-Algorithm-Confusion, Cookie-Signing-Key-Rotation), prüfe gezielt.

---

## Codex Counter-Review

<!-- Codex schreibt hier rein -->

_Pending._
