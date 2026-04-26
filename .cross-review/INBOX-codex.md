# Inbox · Codex

Items die **Codex** noch reviewen muss. Eine Zeile pro Commit.

Format:
```
- <kurz-sha> · <ein-Satz-was-und-warum> · author: <claude|codex>
```

Beim Review: Datei `reviews/<sha>-codex.md` aus Template anlegen, Verdict setzen, **diesen Inbox-Eintrag entfernen**.

---

<!-- Items unten anhängen, älteste zuerst -->

- audit · `audit-2026-04-26/00-overview.md` — Architektur-Map + Trust-Boundaries (whole-system view). 5 Open Questions am Ende. · author: claude
- audit · `audit-2026-04-26/01-auth-jwt.md` — auth.ts (914 LOC) Befund-Liste mit 2× HIGH, 5× MEDIUM, 3× LOW. 4 Open Questions am Ende. · author: claude
