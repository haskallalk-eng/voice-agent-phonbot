# Privacy & Recording (MVP)

Recording is allowed for the demo/MVP.

## What we store
- Audio recording (per session/call), encrypted at rest
- Transcript (partial + final)
- Tool-call trace (inputs/outputs, redacted where needed)
- Timing metrics (latency breakdown)

## Tenant controls
- Per-tenant toggle: recording on/off (default: on for demo tenants)
- Retention policy per tenant (default proposal: 30 days)
- Delete-on-request (GDPR) by session id / phone number (with verification)

## Consent
- Phone: opening disclaimer ("This call may be recorded for quality") + opt-out path
- Web: explicit checkbox before starting mic (consent log)

## Security
- PII redaction in logs by default (names/phones/emails masked in app logs)
- Least-privilege access to recordings
- Audit log for playback/download
