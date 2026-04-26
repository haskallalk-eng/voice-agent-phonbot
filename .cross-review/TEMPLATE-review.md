# Review · `<commit-sha>` by `<reviewer>`

**Author**: <claude|codex>
**Datum**: <YYYY-MM-DD>
**Titel** (aus Commit-Message): `<commit-subject>`
**Geprüfte Files**: `<file1>`, `<file2>`, …

---

## 1. Sinnhaftigkeit
<Löst der Change ein echtes Problem? Richtige Abstraktionsebene? Gibt es eine einfachere Lösung die das gleiche erreicht?>

## 2. Funktionalität
<Tut der Code was er soll? Edge-Cases (leere Listen, null-Inputs, Race-Conditions, Auth-Pfade, externe API-Fehler)? Tests vorhanden / nötig?>

## 3. Sauberkeit
<Lesbar, idiomatisch (TypeScript / React-Konventionen aus Phonbot CLAUDE.md), gute Naming, keine toten Konstrukte, keine Magic-Numbers, keine commented-out Code-Reste?>

## 4. Sicherheit
<Injection-Risk (SQL/Command/HTML)? PII-Leak? Auth-Bypass? Secret im Code? Silent `catch {}` (CLAUDE.md §13 Verbot)? Phonbot CLAUDE.md §15 Posture eingehalten?>

---

## Verdict
**`<approve | needs-changes | discuss | escalate>`**

### Falls `needs-changes`:
- [ ] <konkrete Änderung 1 mit Datei:Zeile>
- [ ] <konkrete Änderung 2>

### Falls `discuss`:
Diskussion eröffnet in: `discussions/<topic-slug>.md`

### Falls `escalate`:
> 🚨 An User: <kurzer Pitch was zu entscheiden ist>

---

## Anregungen (optional, nicht blockierend)
- <kleinere Verbesserungs-Ideen>
