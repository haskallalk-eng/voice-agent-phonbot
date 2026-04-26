# Cross-Review Protokoll — Claude × Codex

Zwei AI-Agents bauen gemeinsam an Phonbot:

- **Claude** (Anthropic Claude Opus, via Claude Code)
- **Codex** (OpenAI Codex, via `openai/codex-plugin-cc` als Slash-Command in Claude Code)

Jeder Code-Change wird vom **jeweils anderen** Modell auf vier Achsen geprüft:

1. **Sinnhaftigkeit** — löst der Change ein echtes Problem? Richtige Abstraktionsebene?
2. **Funktionalität** — tut der Code was er soll? Edge-Cases, Race-Conditions, Auth-Pfade?
3. **Sauberkeit** — lesbar, idiomatisch, keine toten Konstrukte, Naming?
4. **Sicherheit** — kein Injection-Risk, kein PII-Leak, keine Auth-Bypässe, kein Secret im Code?

Ziel: **kein Code geht in `master` ohne Zweit-Augenpaar.** Entweder Approval, oder dokumentierte Diskussion mit Synthese.

## Wo lebt was

```
.cross-review/
├── README.md             # Diese Datei
├── RULES.md              # Verbindliche Spielregeln (Pflicht-Lektüre für beide)
├── INBOX-claude.md       # Items die Claude reviewen muss
├── INBOX-codex.md        # Items die Codex reviewen muss
├── TEMPLATE-review.md    # Template für ein Review-File
├── TEMPLATE-discussion.md # Template für eine Diskussion
├── reviews/              # <commit-sha>-<reviewer>.md — pro Review eine Datei
├── discussions/          # <topic-slug>.md — wenn Meinungen auseinandergehen
└── done/                 # YYYY-MM-DD-<topic>.md — abgeschlossene Diskussionen
```

## Quickstart pro Session

1. **Beim Session-Start**: Lies `INBOX-<dein-name>.md` — was muss ich reviewen?
2. **Nach jedem Commit**: Append eine Zeile in `INBOX-<andere-name>.md`: `<sha> · <ein-Satz-was-und-warum>`
3. **Beim Review**: erstelle `reviews/<sha>-<dein-name>.md` aus `TEMPLATE-review.md`, fülle die 4 Achsen aus, setze ein Verdict.
4. **Bei Disagreement**: erstelle `discussions/<topic-slug>.md` aus `TEMPLATE-discussion.md`, dokumentiere These + Antithese, ziele auf Synthese binnen 2 Iterationen — sonst eskaliere zum User.

## Quick-Status

```
# Wieviele Items im eigenen Inbox?
grep -c '^- ' .cross-review/INBOX-claude.md
grep -c '^- ' .cross-review/INBOX-codex.md

# Welche Diskussionen sind offen?
ls .cross-review/discussions/
```

## Wichtig

- **Reviews sind Pflicht, nicht optional**. Auch trivial wirkende Changes können stille Bugs einführen.
- **Synthese > Sieg**. Wenn ihr unterschiedliche Meinungen habt, ist die kombinierte Lösung meist besser als jede einzeln.
- **Fokus auf Code, nicht Modell-Persönlichkeit**. Keine „dein Modell hat halluziniert"-Sätze. Prüfe das konkrete Stück.
- **User entscheidet bei Stillstand**. Nach 2 Diskussionsrunden ohne Synthese: ping User mit klarer Optionen-Liste A/B.
