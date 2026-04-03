# Phonbot Learning System — Design Document

## Vision
Jeder Anruf (inbound + outbound) macht das System besser — für den einzelnen Kunden UND für alle zukünftigen Kunden.

## Bestehend (Was wir haben)

### Inbound (`insights.ts`)
- ✅ Call-Analyse (Score 1-10, bad_moments, feedback)
- ✅ Issue-Erkennung + Prompt-Suggestions
- ✅ Auto-Apply wenn Score niedrig (dynamischer Threshold)
- ✅ A/B-Tests bei hohem Score (>7)
- ✅ Prompt-Versioning + Rollback
- ✅ Consolidation (Prompt aufräumen nach N Fixes)
- ✅ Holistic Review (alle N Calls Gesamtanalyse)
- ✅ Fix-Effectiveness Tracking
- ✅ Outlier Detection (einzelne schlechte Calls ignorieren)
- ✅ Embedding-basiertes Issue-Matching

### Outbound (`outbound-insights.ts`)
- ✅ Conversion-Score (rapport, pain, value, objection, close)
- ✅ Pattern-Erkennung + Suggestions
- ✅ Auto-Apply bei niedrigem Score
- ✅ Prompt-Versioning

## Fehlend (Was wir brauchen)

### 1. GLOBALER DATEN-LAKE (`call_transcripts`)
**Problem:** Transkripte werden nur in Retell gespeichert, nicht bei uns.
**Lösung:** Jedes Transkript + Metadata persistent speichern.

```sql
CREATE TABLE call_transcripts (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id          UUID NOT NULL,
  call_id         TEXT NOT NULL UNIQUE,
  direction       TEXT NOT NULL, -- 'inbound' | 'outbound'
  transcript      TEXT NOT NULL,
  duration_sec    INT,
  from_number     TEXT,
  to_number       TEXT,
  template_id     TEXT,          -- welches Branchentemplate
  industry        TEXT,          -- 'hairdresser','tradesperson','medical'...
  agent_prompt    TEXT,          -- der Prompt der aktiv war
  score           NUMERIC(4,2),
  conv_score      NUMERIC(4,2), -- outbound only
  outcome         TEXT,          -- 'resolved','ticket','callback','converted'...
  bad_moments     JSONB,
  metadata        JSONB,         -- flexible extra data
  embedding       VECTOR(1536),  -- für semantische Suche (pgvector)
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_transcripts_org ON call_transcripts(org_id);
CREATE INDEX idx_transcripts_industry ON call_transcripts(industry);
CREATE INDEX idx_transcripts_score ON call_transcripts(score);
CREATE INDEX idx_transcripts_created ON call_transcripts(created_at);
```

### 2. CROSS-ORG TEMPLATE LEARNING
**Problem:** Branchentemplates sind statisch. Learnings eines Friseur-Kunden helfen anderen Friseuren nicht.
**Lösung:** Aggregierte Insights über alle Orgs einer Branche.

```sql
CREATE TABLE template_learnings (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  template_id     TEXT NOT NULL,       -- 'hairdresser','medical'...
  learning_type   TEXT NOT NULL,       -- 'prompt_rule','faq','objection','best_practice'
  content         TEXT NOT NULL,       -- die konkrete Regel/Erkenntnis
  source_count    INT NOT NULL DEFAULT 1,  -- wie viele Orgs bestätigen das
  avg_impact      NUMERIC(4,2),        -- Ø Score-Verbesserung
  confidence      NUMERIC(3,2),        -- 0-1 wie sicher
  embedding       VECTOR(1536),
  status          TEXT NOT NULL DEFAULT 'pending', -- pending/applied/rejected
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  applied_at      TIMESTAMPTZ
);
CREATE INDEX idx_tl_template ON template_learnings(template_id, status);
```

**Prozess:**
1. Nach jedem `analyzeCall`: Extract universelle Learnings (nicht kundenspezifisch)
2. Gruppiere nach Branche
3. Wenn ≥3 verschiedene Orgs dasselbe Problem haben → `template_learnings` Entry
4. Periodisch: Top-Learnings in die Default-Templates einfließen lassen

### 3. OUTBOUND LEARNING PARITY
**Problem:** Outbound-Insights sind weniger ausgereift als Inbound.
**Lösung:** Feature-Parity herstellen.

Fehlend bei Outbound:
- [ ] Embedding-basiertes Issue-Matching (hat nur string-match)
- [ ] A/B-Tests
- [ ] Consolidation Quality Check
- [ ] Holistic Review
- [ ] Outlier Detection
- [ ] Fix-Effectiveness Tracking
- [ ] Score Rollback

### 4. CONVERSATION PATTERN LIBRARY
**Problem:** Wir erkennen Fehler, aber sammeln keine Best Practices.
**Lösung:** Erfolgreiche Gesprächsmuster extrahieren und speichern.

```sql
CREATE TABLE conversation_patterns (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  direction       TEXT NOT NULL,       -- 'inbound' | 'outbound'
  industry        TEXT,
  pattern_type    TEXT NOT NULL,       -- 'opener','objection_handle','close','booking','escalation'
  situation       TEXT NOT NULL,       -- wann das Pattern passt
  agent_response  TEXT NOT NULL,       -- was der Agent sagen soll
  effectiveness   NUMERIC(4,2),        -- Ø Score wenn dieses Pattern genutzt wird
  usage_count     INT NOT NULL DEFAULT 0,
  source_calls    INT NOT NULL DEFAULT 0, -- aus wie vielen Calls extrahiert
  embedding       VECTOR(1536),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

**Prozess:**
1. Calls mit Score ≥8 analysieren → erfolgreiche Patterns extrahieren
2. Patterns clustern (Embedding-Similarity)
3. Top-Patterns als Beispiele in System-Prompts einfließen lassen

### 5. TRAINING DATA EXPORT
**Problem:** Wir sammeln Daten, können sie aber nicht für Modell-Training nutzen.
**Lösung:** Strukturierter Export in Standard-Formaten.

```sql
CREATE TABLE training_examples (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  example_type    TEXT NOT NULL,       -- 'chat_completion','preference','dpo_pair'
  direction       TEXT NOT NULL,
  industry        TEXT,
  system_prompt   TEXT,
  messages        JSONB NOT NULL,      -- [{role,content}...]
  score           NUMERIC(4,2),
  quality_label   TEXT,                -- 'good','bad','excellent'
  metadata        JSONB,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

**Export-Formate:**
- OpenAI fine-tuning JSONL
- DPO pairs (good vs bad response für RLHF)
- Preference ranking data

### 6. REAL-TIME LEARNING DASHBOARD
Erweiterung der bestehenden Insights-Seite:
- Cross-Org Score-Trend (anonymisiert)
- Template Health: welche Branchen performen am besten
- Pattern Library Browser
- Training Data Stats

## Implementierungs-Reihenfolge

### Phase 1: Daten-Fundament (JETZT)
1. `call_transcripts` Tabelle + Transkript-Speicherung bei jedem Call
2. Outbound-Transkripte auch speichern (aktuell werden sie nicht persistiert)
3. Industry/Template-Tagging bei jedem Call

### Phase 2: Cross-Org Learning
4. `template_learnings` Tabelle + Extraction-Pipeline
5. Aggregation-Job: Learnings aus allen Orgs einer Branche
6. Template-Update-Mechanismus

### Phase 3: Pattern Library
7. `conversation_patterns` Tabelle
8. Best-Practice Extraction aus High-Score Calls
9. Pattern-Injection in System-Prompts

### Phase 4: Outbound Parity
10. A/B-Tests für Outbound
11. Alle fehlenden Inbound-Features portieren

### Phase 5: Training Export
12. `training_examples` Tabelle
13. Automatische Example-Generation aus Call-Daten
14. Export-API (JSONL, DPO pairs)
