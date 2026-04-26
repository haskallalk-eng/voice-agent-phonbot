# RULES — verbindlich für Claude und Codex

Hard rules — kein Workaround, kein „ausnahmsweise". Bei Unklarheit: User fragen.

## R1 — Jeder Commit braucht ein Cross-Review

Sobald du committest und pushst (lokal oder remote), trägst du den Commit in den Inbox des **anderen** Modells ein:

```
# In INBOX-<andere>.md unten anhängen:
- <kurz-sha> · <ein-Satz-was-und-warum> · author: <claude|codex>
```

Beispiel:
```
- 7d0419f · revert services-block feature; AdaptiveTextarea reicht im Ergänzungs-Feld · author: claude
```

**Ausnahme**: rein generierte Files (regenerated branch HTMLs, lock-files, gitignored content). Diese überspringen das Review, müssen aber im Commit-Message-Body als „auto-generated" gekennzeichnet sein.

## R2 — Review-Antwort innerhalb der nächsten Session

Beim **nächsten** Session-Start liest du dein `INBOX-<dein-name>.md`. Pro Eintrag erstellst du `reviews/<sha>-<dein-name>.md` aus `TEMPLATE-review.md`. Sobald die Datei steht, **entfernst du den Eintrag aus dem Inbox**.

Time-Budget pro Review: **5–15 Minuten**. Bei größeren Diffs (>500 LOC): nur die Kernpfade reviewen + Hinweis im Verdict, dass Vollabdeckung Eskalation an User braucht.

## R3 — Vier Achsen, immer alle vier

Jedes Review prüft:

1. **Sinnhaftigkeit** — löst der Change ein echtes Problem? Liegt die Logik auf der richtigen Abstraktionsebene? Gibt es eine einfachere Lösung?
2. **Funktionalität** — tut der Code was er soll, inklusive Edge-Cases (leere Listen, Race-Conditions, Auth-Pfade, Concurrency, Fehler-Handling)?
3. **Sauberkeit** — lesbar, idiomatisch, keine toten Konstrukte, gute Naming, keine Dead-Branches, kein commented-out Code, keine Magic-Numbers ohne Kommentar?
4. **Sicherheit** — kein Injection-Risk (SQL/Command/HTML), kein PII-Leak, keine Auth-Bypässe, kein Secret im Code, keine `// TODO: encrypt later`-Schulden, keine `catch {}` die Errors verschlucken (siehe Phonbot CLAUDE.md §13)?

Auch wenn drei Achsen perfekt sind: die vierte trotzdem explizit ankreuzen („nichts auffällig" zählt). Sonst weiß man nicht ob du nicht geprüft oder okay-befunden hast.

## R4 — Verdict-Werte sind eng

Genau einer von vier:

- **`approve`** — Change kann so bleiben. Optional: kleine Nice-to-Haves als „Anregung" notieren.
- **`needs-changes`** — konkrete Liste was nachzubessern ist. Author iteriert, committet erneut, neuer Inbox-Eintrag.
- **`discuss`** — du siehst eine bessere Alternative. Eröffne `discussions/<topic-slug>.md` (siehe R5).
- **`escalate`** — Sicherheits-/Compliance-/Architektur-Punkt der über das Code-Niveau hinausgeht. User muss entscheiden.

## R5 — Diskussionen haben Struktur

Bei `discuss`: erstelle `discussions/<topic-slug>.md` aus `TEMPLATE-discussion.md`. Topic-Slug = kurze kebab-case-Bezeichnung, z. B. `voice-fallback-strategy` oder `cookie-banner-pre-consent`.

Workflow:

1. **Position A** (Reviewer-Sicht): These + Begründung
2. **Position B** (Author-Antwort): Antithese + Begründung
3. **Iteration 2** falls keine Einigung: gemeinsam an Synthese arbeiten
4. **Synthese**: konkrete Code-Lösung, die beide Seiten respektiert. Verlinkung des Folge-Commits.
5. **Eskalation an User** wenn Iteration 2 ohne Synthese endet — klare A/B-Optionen-Liste in einem Post.

Sobald Synthese implementiert: Datei nach `done/YYYY-MM-DD-<topic>.md` verschieben.

## R6 — Code im Repo, Reviews im Repo

Beide Modelle pullen vor dem Schreiben. Force-pushes sind verboten (wie in Phonbot CLAUDE.md §14). Reviews + Discussions werden ganz normal committet wie Code.

Commit-Message-Konvention für Review-Files:
```
review: <sha> by <reviewer> — <verdict>
```

Für Discussions:
```
discuss(<topic-slug>): open / iterate / synthesise / done
```

## R7 — Synthese > Sieg

Wenn ihr unterschiedliche Meinungen habt: die kombinierte Lösung ist meistens besser als jede einzelne. Nicht „mein Vorschlag gewinnt", sondern „was nimmt die Stärken beider Vorschläge mit".

## R8 — Persönlichkeitsneutral

Keine Sätze wie „dein Modell halluziniert offensichtlich" oder „typisch GPT/Claude". Kritisch zum Code, höflich zum Author. Es geht nie ums Recht-Haben, immer ums beste Endergebnis für Phonbot.

## R9 — Eskalation an User wenn

- Zwei Diskussions-Iterationen ohne Synthese
- Ein Sicherheits- oder Compliance-Punkt aufgedeckt, dessen Fix Kosten hat (Geld, Aufwand, Architektur-Bruch)
- Konflikt mit Phonbot CLAUDE.md oder dem User's Memory
- Unklarheit über Produkt-Intent

User-Ping-Format (am Ende deiner Antwort an den User):
> 🚨 Cross-Review-Eskalation: `<topic>` — Optionen A: …, B: …, meine Tendenz: …

## R10 — Ehrlichkeit über die eigenen Grenzen

Wenn du etwas nicht zuverlässig beurteilen kannst (z. B. eine externe API deren Verhalten nicht dokumentiert ist, oder ein Race-Condition-Pfad den du nicht durchdenken kannst), schreibe das **explizit** ins Review:

> Achse 2 (Funktionalität): Ich kann den retell-webhook-Race nicht zuverlässig durchdenken — empfehle Logging + Live-Test bevor production.

Lieber ehrlich „weiß nicht" als false-confident „approve".
