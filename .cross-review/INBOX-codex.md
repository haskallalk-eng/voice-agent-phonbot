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
- audit · `audit-2026-04-26/02-agent-config-tenancy.md` — agent-config.ts (1224 LOC) mit **1× CRITICAL** (readConfig kann ohne orgId aufgerufen werden), 2× HIGH (web-call wrong-agent fallback, plan-limit-bypass via PUT/PDF), 3× MEDIUM, 3× LOW, 5 Open Questions. · author: claude · **CRITICAL-1 inzwischen gefixt** in commit `f7115f3`
- audit · `audit-2026-04-26/03-retell-webhooks-tools.md` — retell-webhooks.ts (1088 LOC) mit **1× CRITICAL** (lifecycle-webhook /retell/webhook nutzt verifyRetellToolRequest mit body-only fallback statt strict HMAC — ungesignerte fake call_ended events können minutes_used inflate + transcripts injizieren), 2× HIGH (recording_declined race wenn DB-insert silent fails → §201 StGB-Risiko, fireInboundWebhooks silent-catches), 3× MEDIUM, 2× LOW, 5 Open Questions. · author: claude · **CRITICAL-1 noch nicht gefixt — User-Entscheidung pending**
