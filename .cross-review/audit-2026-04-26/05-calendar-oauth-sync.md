# 05 · Calendar (OAuth + Booking + Sync)

**Author**: Claude · **Reviewer**: Codex · **Status**: Awaiting counter-review
**Geprüfte Dateien**: [apps/api/src/calendar.ts](../../apps/api/src/calendar.ts) (2338 LOC) + [apps/api/src/calendar-sync.ts](../../apps/api/src/calendar-sync.ts) (569 LOC)
**Routen**: 13 (`/calendar/google/connect|callback`, `/calendar/microsoft/connect|callback`, `/calendar/calcom/connect|disconnect`, `/calendar/list`, `/calendar/disconnect/:provider`, `/calendar/chipy` GET/PUT, `/calendar/chipy/block` POST/DELETE, `/calendar/external-events`, `/calendar/chipy/bookings` GET/POST/DELETE)
**Externe Funktionen**: `getValidToken`, `getValidMsToken`, `findFreeSlots`, `bookSlot`, `migrateCalendar`, `getAllConnectionsForSync`, `calFetchForSync`

## Was solide ist

1. **OAUTH_STATE_KEY separat von JWT_SECRET** — defense-in-depth, prod boot-throw wenn `OAUTH_STATE_SECRET` fehlt (nicht stillschweigend zurückfallen).
2. **OAuth-State HMAC + Nonce + Redis-Replay-Protection**: `verifyOAuthState` claimed nonce atomar via `SET NX EX`, replay zurückgewiesen. Timing-safe MAC-Vergleich.
3. **AES-256-GCM via `crypto.ts`** für `access_token` + `refresh_token` — niemals plaintext in DB.
4. **`calFetch` AbortSignal.timeout(10s)** auf ALLEN upstream-Calls (Google, Microsoft, cal.com) — ein hängender Provider kann keinen Worker pinnen. Caller-supplied signal überschreibt.
5. **CAL-02 Redis-Lock auf Token-Refresh** per (org, provider) — verhindert Race wo zwei parallele `getValidToken`-Calls beide Google hitten und um den `refresh_token`-Rotation racen. Fail-open wenn Redis down (dev-friendly).
6. **CAL-11 Invalid-Date busy-period fail-closed** in `generateFreeSlots`: wenn Google/MS einen unparseable Busy-Eintrag schickt, wird der Slot als belegt markiert (nie fälschlich frei).
7. **CAL-06 Query-Param-Size-Cap** im OAuth-Callback (1000 chars für `code`, 500 für `state`) — DoS-Schutz.
8. **`canCheckConnection`-Safety-Net**: Broken/stale Integration macht Agent nicht unbenutzbar — wird übersprungen, Agent fällt auf Chipy zurück. Plus log.warn mit Fehler.
9. **Chipy als Source-of-Truth + externe als best-effort Mirrors**: `external_refs` JSON je Buchung mit reuse-on-retry — eine fehlgeschlagene externe Buchung verhindert keine Customer-Buchung.
10. **`claimChipyBooking` mit Lock**: idempotenter Booking-Pfad, retry-safe.
11. **HTML-Auto-Close-Page** nach OAuth-Success: User landet wieder im Dashboard via `postMessage`, statt Stale-Tab.

---

## Befunde

### 🟠 HIGH-1 · Token-Refresh-Failures sind silent (`catch { return null; }`) · ✅ GEFIXT (Round 3)

**Status**: ✅ GEFIXT — Beide `catch {}` (Google + Microsoft) ersetzt durch `log.warn({ err, orgId, provider }, 'calendar: token refresh failed — connection likely needs reconnect')`. Sentry sieht jetzt revoked-refresh / scope-change-Spikes statt 5 Monate Stille.

**Dateien**: [calendar.ts:622–624](../../apps/api/src/calendar.ts#L622-L624) (Google) + [calendar.ts:461–463](../../apps/api/src/calendar.ts#L461-L463) (Microsoft)

```ts
} catch {
  return null;
}
```

**Befund**:
- Wenn der Token-Refresh-Call zu Google/Microsoft scheitert (revoked refresh_token, network blip, expired credentials, OAuth-Scope-Änderung), wird `null` zurückgegeben — **ohne Log**.
- Caller (`bookSlot`, `findSlots`, alle agent-tools) bekommen `null` und behandeln es als „kein Token verfügbar" → Customer sieht keinen Booking-Fehler, sondern still gar keine Slots im Google-Kalender → Symptom: „Chipy bucht nichts in mein Google".
- CLAUDE.md §13 violation: `catch {}` ohne `app.log.warn`.
- Verschärft: dies war GENAU das Symptom in der Phonbot-Geschichte (Modul 0, Architektur-Note über Google API never enabled) — wir hatten 5 Monate stille 403er weil das catch sie geschluckt hat.

**Fix-Vorschlag**:
```ts
} catch (err) {
  log.warn(
    { err: (err as Error).message, orgId, provider: 'google' },
    'calendar: token refresh failed — connection likely needs reconnect',
  );
  return null;
}
```
Analog für Microsoft. Zusätzlich (Nice-to-Have): bei N consecutive Refresh-Failures → DB-Spalte `last_refresh_error` setzen + Frontend-Banner „Verbindung neu authorisieren".

---

### 🟠 HIGH-2 · OAuth-Callback-HTML interpoliert `appUrl` ohne Escape — XSS-Vektor wenn ENV-Var ändert · ✅ GEFIXT (Round 3)

**Status**: ✅ GEFIXT — Beide OAuth-Callback-HTML-Templates (Google + Microsoft) nutzen jetzt `${JSON.stringify(appUrl)}` statt `'${appUrl}'`. JSON.stringify produziert ein korrekt-escaptes String-Literal — JS-Injection via APP_URL ist nicht mehr möglich.

**Datei**: [calendar.ts:1867–1876](../../apps/api/src/calendar.ts#L1867-L1876)

```ts
return reply
  .header('Content-Type', 'text/html; charset=utf-8')
  .send(`<!DOCTYPE html><html>...
<script>
if(window.opener){try{window.opener.postMessage({type:'calendarConnected',provider:'google'},'${appUrl}')}catch(e){}}
setTimeout(function(){window.location.href='${appUrl}?calendarConnected=true'},3000);
</script></body></html>`);
```

**Befund**:
- `appUrl` kommt aus `process.env.APP_URL ?? 'http://localhost:5173'`.
- Wenn ein Angreifer (Insider, kompromittierter ENV-Provider, fehlerhafter Deploy-Script) `APP_URL` auf einen String mit `'` und JS-Code setzt, wird der Code ausgeführt im Browser des OAuth-Callback-Empfängers.
- Risiko aktuell: niedrig, weil ENV-Vars nicht user-controlled sind. ABER: defense-in-depth verlangt hier Escape — die Cost ist 0, das Risiko nicht-null.

**Fix-Vorschlag**:
```ts
const safeAppUrl = JSON.stringify(appUrl); // produces "https://..." with proper escapes
return reply.send(`...
window.opener.postMessage({type:'calendarConnected',provider:'google'}, ${safeAppUrl})
...
window.location.href = ${safeAppUrl} + '?calendarConnected=true';
...`);
```
Selbe Stelle für Microsoft-Callback.

---

### 🟡 MEDIUM-1 · `bookSlot` Race zwischen `isChipySlotAvailable` und `claimChipyBooking`

**Datei**: [calendar.ts:1521–1535](../../apps/api/src/calendar.ts#L1521-L1535)

**Befund**:
- Sequenz: `getCheckableConnections` → `parseSlotTime` → `isChipySlotAvailable` → `claimChipyBooking`. Letzte 3 Calls passieren OHNE äußeren Lock; erst `withChipyBookingLock` startet AB Schritt 4 (External-Mirror-Schreibungen).
- Race-Möglichkeit: Zwei parallele `bookSlot`-Calls für denselben Slot kommen beide an `isChipySlotAvailable === true` vorbei → beide `claimChipyBooking` racen.
- Aktuelle Mitigation: `claimChipyBooking` sollte intern atomar sein (z. B. INSERT mit UNIQUE constraint) — wenn ja, Race ist gefangen, einer kriegt 409. Wenn nein, Doppel-Buchung möglich.

**Fix-Vorschlag**: Code-Audit von `claimChipyBooking` — falls nicht UNIQUE-INSERT-basiert, Migration auf `INSERT ... ON CONFLICT (org_id, slot_time) DO NOTHING` mit detection auf 0 RETURNING rows.

---

### 🟡 MEDIUM-2 · `getCheckableConnections` Silent-Mask wenn alle connections broken

**Datei**: [calendar.ts:381–398](../../apps/api/src/calendar.ts#L381-L398)

**Befund**:
- Wenn alle externen Connections via `canCheckConnection` durchfallen (z. B. alle Tokens revoked), returnt `getCheckableConnections` ein leeres Array.
- `bookSlot` sieht `connections.length === 0` → bucht nur in Chipy, kein Mirror.
- Customer hat Calendar verbunden, sieht aber im Google-Kalender keine Buchungen — und das einzige Signal sind ein paar `log.warn` Einträge im Server-Log.

**Fix-Vorschlag**: separate `last_connection_check_at` + `last_check_error` Spalten in `calendar_connections`, Frontend zeigt Banner „Verbindung X funktioniert nicht — neu autorisieren".

---

### 🟡 MEDIUM-3 · ENCRYPTION_KEY-Rotation würde ALLE Calendar-Verbindungen stillschweigend killen · ✅ GEFIXT (Round 3)

**Status**: ✅ GEFIXT — `decryptConn` loggt Decryption-Failures jetzt als `log.error({ orgId, provider, field }, 'calendar: token decrypt failed (key rotated?)')` statt `process.stderr.write`. Sentry sieht den Spike sofort, Ops kann reagieren.

**Datei**: `decryptConn` (Helper, mehrfach aufgerufen)

**Befund**:
- `decryptConn` returnt `null` bei Decryption-Fail.
- Wenn `ENCRYPTION_KEY` rotiert wird ohne Re-Encryption aller Rows, returnt jeder Decrypt `null` → alle Connections verschwinden aus der UI → Customer sieht „nicht verbunden", weiß aber nicht warum.

**Fix-Vorschlag**:
- `decryptConn` loggt log.error bei Decryption-Fail mit `connectionId` (nicht plaintext) — Ops sieht den Spike sofort.
- Migration-Pfad dokumentieren: bei Key-Rotation muss ein Re-Encrypt-Script über calendar_connections + alle anderen `enc:v1:*`-Felder.

---

### 🟡 MEDIUM-4 · `bookSlot.allExternalSucceeded` returnt eventId vom „ersten" Provider — willkürlich

**Datei**: [calendar.ts:1586–1597](../../apps/api/src/calendar.ts#L1586-L1597)

**Befund**:
- Bei mehreren verbundenen Kalendern (Google + Outlook + cal.com) returnt der bookSlot eine eventId vom „first success" via `results.find((r) => r.ok)` → willkürlich nach Reihenfolge der DB-Query.
- Customer/Frontend kann aus dieser eventId nichts ableiten (welcher Provider war's?).

**Fix-Vorschlag**: `eventId` bleibt für backward compat als first-success, aber Response-Schema bekommt `externalResults: ExternalBookingResult[]` mit pro-Provider eventId — was ohnehin schon da ist. UI-Fix: zeige nicht „Termin gebucht (Event ID X)", sondern „Termin gebucht in Chipy + Google + Outlook" mit per-Provider-Status.

---

### 🔵 LOW-1 · `OAUTH_STATE_KEY` IIFE throws beim Modul-Import

**Datei**: [calendar.ts:34–40](../../apps/api/src/calendar.ts#L34-L40)

**Befund**:
- IIFE throw bei fehlendem `OAUTH_STATE_SECRET` in prod → Crash beim Container-Startup.
- Pro: fail-loud, kein silent default.
- Contra: ist nicht in den structured Logs sichtbar — nur stderr beim Boot, leichter zu übersehen wenn CI nicht alle outputs sammelt.

**Fix-Vorschlag**: aus dem IIFE in `env.ts` Validation-Block schieben, dann zentral mit anderen mandatory-Env-Vars validiert + structured log.

---

### 🔵 LOW-2 · `generateFreeSlots` hardcoded 8-18, 30 min, 7 Tage

**Datei**: [calendar.ts:644–679](../../apps/api/src/calendar.ts#L644-L679)

**Befund**:
- Slot-Generation ignoriert `agent_config.openingHours` und `agent_config.appointmentDuration` (falls existent).
- Alle Customers bekommen die gleichen Standard-Slots (Mo-So 8:00-18:00 in 30min), unabhängig von Branche.
- Friseur (60min Schnitt) und Restaurant-Reservierung (15min) sehen das gleiche Schema.

**Fix-Vorschlag**: Slot-Generation per agent_config-Read parametrisiert. Nice-to-Have, nicht akut.

---

### 🔵 LOW-3 · `external_refs: unknown` JSON-Typ verloren

**Datei**: [calendar.ts:120, 125](../../apps/api/src/calendar.ts#L120-L125)

**Befund**: `external_refs` ist `unknown` (JSONB-Spalte), wird per Hand mit `as ExternalBookingRefs` gecastet. Type-System verloren.

**Fix-Vorschlag**: Zod-Schema für `ExternalBookingRefs` einführen, Parse statt Cast.

---

### 💡 NICE · 7-Tage-Slot-Horizont statisch

**Datei**: [calendar.ts:644](../../apps/api/src/calendar.ts#L644)

`for (let d = 0; d < 7; d++)` — fester Horizont. Bei „lange im Voraus"-Branchen (Friseur 4-Wochen-Termine) zu kurz.

**Fix-Vorschlag**: aus Plan / Agent-Config konfigurierbar.

---

## Open Questions for Codex

**Q1**: HIGH-1 (silent token refresh) — siehst du ein zusätzliches Defense-Pattern? Z. B. eine Background-Task die proaktiv Tokens 1h vor Ablauf refresht statt erst beim API-Call?

**Q2**: HIGH-2 (XSS via appUrl) — ist der `JSON.stringify(appUrl)`-Approach ausreichend für deinen Geschmack, oder würdest du den HTML-Block in eine separate Template-Datei mit Mustache/Eta auslagern?

**Q3**: MEDIUM-1 (`claimChipyBooking` race) — kannst du den Code lesen + bestätigen ob die internal Atomicity passt? Mein Audit hat das als Black-Box behandelt.

**Q4**: Allgemein — `findFreeSlotsByContract` (Z. 1355–1421) hab ich übersprungen. Wenn da Edge-Cases sind (Schnittmenge mehrerer Kalender = leer obwohl Chipy frei wäre, etc.), bring sie bitte ein.

---

## Codex Counter-Review

<!-- Codex schreibt hier rein -->

_Pending — Plugin in User's Claude Code aktuell nicht aktiv._
