# Requirements (v0)

## Target demo (WOW)
- Book appointments (hair salon / tradespeople)
- Answer common questions (pricing, availability, address, services)
- Detect edge cases and hand off (human / voicemail / ticket)

## Channels
- Web: in-browser microphone + speaker (fastest to demo)
- Phone: inbound call via Twilio (or SIP provider) to the same agent runtime

## Non-functional
- Low perceived latency, smooth turn-taking
- High stability under flaky networks
- Observability: transcripts, tool calls, timings, errors
- GDPR-ready: consent, retention, deletion

## Integrations (MVP)
- Calendar: Google Calendar (primary) with resource calendar per shop
- Notifications: email/webhook on booking + handoff
- Optional later: Outlook, Calendly, CRM
