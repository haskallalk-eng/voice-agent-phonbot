# SEO Insight Automation Report

Generated: 2026-08-25T00:36:31.301Z
Site: https://phonbot.de
Content baseline date in repo: 2026-05-11

## Existing System Check

- Call insight automation: exists in `apps/api/src/insights.ts` and `apps/api/src/outbound-insights.ts`.
- Cross-org learning foundation: exists through `call_transcripts`, `template_learnings`, `conversation_patterns`, and `learning-api.ts`.
- SEO automation: exists for generation/audit/indexing through `seo:generate`, `seo:audit`, and `seo:indexnow`.
- Missing before this report: a repeatable SEO opportunity scoring loop that ranks ideas by expected impact and risk.

## Inventory

- Core industry pages: 6
- Niche pages: 8
- Support pages: 2
- Blog posts: 7
- Sitemap present: yes
- Robots present: yes
- Built dist present for deep checks: yes

## Scoring Model

Score combines:
- Impact: search intent, conversion proximity, internal-link value.
- Confidence: fit to Phonbot product truth and current content patterns.
- Effort: estimated content/design/code effort.
- Risk: YMYL, duplicate/thin-page risk, compliance risk.

The automation favors pages that are crawlable, visibly useful, structured with matching JSON-LD, and connected to a clear conversion path.

## Top Opportunities

| # | Idea | Keyword | Type | Score | Impact/Confidence/Effort/Risk | Gates |
|---|---|---|---|---:|---|---|
| 1 | KI-Terminbuchung am Telefon | KI Terminbuchung Telefon | feature-page | 118 | 10/7/4/2 | new-page-opportunity, canonical-required, structured-data-required, faq-answer-block-required, conversion-path-required |
| 2 | KI-Anrufannahme 24/7 | KI Anrufannahme 24/7 | feature-page | 118 | 10/7/4/2 | new-page-opportunity, canonical-required, structured-data-required, faq-answer-block-required, conversion-path-required |
| 3 | KI-Telefonassistent vs Telefonservice | KI Telefonassistent vs Telefonservice | comparison-page | 108 | 9/7/4/2 | new-page-opportunity, canonical-required, structured-data-required, faq-answer-block-required, conversion-path-required |
| 4 | KI-Telefonassistent fuer Steuerberater | KI Telefonassistent Steuerberater | industry-page | 105 | 10/7/5/4 | new-page-opportunity, canonical-required, structured-data-required, faq-answer-block-required, conversion-path-required |
| 5 | KI-Telefonassistent Berlin | KI Telefonassistent Berlin | local-page | 103 | 10/6/4/4 | new-page-opportunity, canonical-required, structured-data-required, faq-answer-block-required, conversion-path-required |
| 6 | KI-Telefonassistent fuer Zahnarztpraxen | KI Telefonassistent Zahnarzt | industry-page | 95 | 10/6/5/5 | new-page-opportunity, canonical-required, structured-data-required, faq-answer-block-required, conversion-path-required |
| 7 | KI-Telefonassistent fuer Kanzleien | KI Telefonassistent Anwalt | industry-page | 95 | 10/6/5/5 | new-page-opportunity, canonical-required, structured-data-required, faq-answer-block-required, conversion-path-required |
| 8 | KI-Telefonassistent Kosten 2026 | KI Telefonassistent Kosten | blog-post | 94 | 7/7/3/2 | new-page-opportunity, canonical-required, structured-data-required, faq-answer-block-required, conversion-path-required |
| 9 | Anrufbeantworter Alternative fuer kleine Unternehmen | Anrufbeantworter Alternative Unternehmen | problem-page | 92 | 8/6/4/2 | new-page-opportunity, canonical-required, structured-data-required, faq-answer-block-required, conversion-path-required |
| 10 | Rufweiterleitung Telekom, Vodafone und O2 fuer KI-Telefonie | Rufweiterleitung Telekom KI Telefon | blog-post | 87 | 7/6/3/2 | new-page-opportunity, canonical-required, structured-data-required, faq-answer-block-required, conversion-path-required |

## Recommended Build Order

1. Build the top 2 feature/problem pages first because they are broad, low-risk, and directly support all existing industry pages.
2. Add one comparison page to catch buyer-intent searches before competitors do.
3. Add one trust page for DSGVO/AI objections, but keep all claims tied to visible legal/compliance pages.
4. Pilot local/programmatic SEO with a tiny hand-written set only after Search Console data confirms impressions.
5. Treat medical/legal/tax niches as intake-only pages with human-review gates.

## Opportunity Details

### 1. KI-Terminbuchung am Telefon
- Primary keyword: KI Terminbuchung Telefon
- Why it should work: Direkt kaufnah: Nutzer suchen nicht nur KI, sondern eine konkrete Terminbuchungsfunktion.
- Implementation: Static feature page with booking flow, calendar safety rules, visible FAQ answers, matching SoftwareApplication/Service JSON-LD, links to Friseur, Kosmetikstudio, Fitnessstudio, Kontakt.
- SEO gates: new-page-opportunity, canonical-required, structured-data-required, faq-answer-block-required, conversion-path-required
- Existing page: no

### 2. KI-Anrufannahme 24/7
- Primary keyword: KI Anrufannahme 24/7
- Why it should work: Sehr nah am Kernproblem von Phonbot und breit genug fuer interne Verlinkung aus allen Branchen.
- Implementation: Static feature page with use cases, after-hours routing, no-false-promise section, FAQ, links from hero/footer/blog.
- SEO gates: new-page-opportunity, canonical-required, structured-data-required, faq-answer-block-required, conversion-path-required
- Existing page: no

### 3. KI-Telefonassistent vs Telefonservice
- Primary keyword: KI Telefonassistent vs Telefonservice
- Why it should work: Comparison pages sind kaufnah und koennen Einwaende zu Vertrauen, Datenschutz, Kosten und Qualitaet sauber abholen.
- Implementation: Neutral comparison with cost bands, response-time table, privacy caveats, FAQ, strong internal links.
- SEO gates: new-page-opportunity, canonical-required, structured-data-required, faq-answer-block-required, conversion-path-required
- Existing page: no

### 4. KI-Telefonassistent fuer Steuerberater
- Primary keyword: KI Telefonassistent Steuerberater
- Why it should work: Professional-services niche with clear phone pain and lead value; risk manageable with no-tax-advice guardrails.
- Implementation: Industry page for appointment intake, document reminders, callback tickets, no tax advice, visible FAQ answers and matching service schema.
- SEO gates: new-page-opportunity, canonical-required, structured-data-required, faq-answer-block-required, conversion-path-required
- Existing page: no

### 5. KI-Telefonassistent Berlin
- Primary keyword: KI Telefonassistent Berlin
- Why it should work: Mindrails/Phonbot has Germany/Berlin context; local intent can be valuable if content stays genuinely local.
- Implementation: Local page only if it has real local proof: Berlin phone demo, German hosting context, local service area text, ContactPoint schema.
- SEO gates: new-page-opportunity, canonical-required, structured-data-required, faq-answer-block-required, conversion-path-required
- Existing page: no

### 6. KI-Telefonassistent fuer Zahnarztpraxen
- Primary keyword: KI Telefonassistent Zahnarzt
- Why it should work: High-value appointment niche, but higher compliance risk because medical-adjacent claims must be carefully limited.
- Implementation: Industry page focused on appointment intake, recall, emergencies-to-human, no medical advice, strong disclaimers.
- SEO gates: new-page-opportunity, canonical-required, structured-data-required, faq-answer-block-required, conversion-path-required
- Existing page: no

### 7. KI-Telefonassistent fuer Kanzleien
- Primary keyword: KI Telefonassistent Anwalt
- Why it should work: High lead value, but YMYL/legal risk means this must be intake-only and human-reviewed.
- Implementation: Only build with strict legal-disclaimer and intake positioning: no Rechtsberatung, conflict-check routing, urgent deadlines to human.
- SEO gates: new-page-opportunity, canonical-required, structured-data-required, faq-answer-block-required, conversion-path-required
- Existing page: no

### 8. KI-Telefonassistent Kosten 2026
- Primary keyword: KI Telefonassistent Kosten
- Why it should work: There is an ROI article, but a clearer cost guide can capture price-intent queries and support conversion.
- Implementation: Blog guide with transparent Phonbot plans, total cost factors, examples by call volume, links to pricing/register.
- SEO gates: new-page-opportunity, canonical-required, structured-data-required, faq-answer-block-required, conversion-path-required
- Existing page: no

### 9. Anrufbeantworter Alternative fuer kleine Unternehmen
- Primary keyword: Anrufbeantworter Alternative Unternehmen
- Why it should work: Guter SEO-Hebel, weil Nutzer ihr Problem bereits benennen, aber noch nicht zwingend nach KI suchen.
- Implementation: Comparison-style guide: Mailbox vs Sekretariat vs KI-Telefonassistent, honest limits, CTA to demo.
- SEO gates: new-page-opportunity, canonical-required, structured-data-required, faq-answer-block-required, conversion-path-required
- Existing page: no

### 10. Rufweiterleitung Telekom, Vodafone und O2 fuer KI-Telefonie
- Primary keyword: Rufweiterleitung Telekom KI Telefon
- Why it should work: Setup queries are practical, low-risk and likely to convert after technical success.
- Implementation: Provider-specific setup overview with caveat to verify current carrier UI, screenshots only if maintained.
- SEO gates: new-page-opportunity, canonical-required, structured-data-required, faq-answer-block-required, conversion-path-required
- Existing page: no

## Automation Cadence

- Weekly: run `pnpm seo:generate && pnpm --filter @vas/web build && pnpm seo:audit && pnpm seo:insights`.
- After publishing pages: run `pnpm seo:indexnow -- --execute` only when the generated sitemap and IndexNow key are valid.
- Monthly: compare this report with Google Search Console impressions/clicks and promote only ideas with real demand signals.

## Source Principles

- [Google SEO Starter Guide](https://developers.google.com/search/docs/fundamentals/seo-starter-guide) - Make content easy for search engines to understand and useful for users.
- [Google structured data guidelines](https://developers.google.com/search/docs/appearance/structured-data/sd-policies) - Structured data must match visible page content and is eligibility, not a guarantee.
- [Google AI features optimization guide](https://developers.google.com/search/docs/fundamentals/ai-optimization-guide) - AI search visibility follows the same people-first, crawlable, well-structured content rules.
