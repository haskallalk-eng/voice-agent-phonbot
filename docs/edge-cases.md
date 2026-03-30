# Edge cases to handle

## Scheduling
- Caller wants *today* / urgent → offer nearest slots, waitlist, callback
- Business closed / outside hours → propose next opening, leave message
- Multiple services (cut + color) → duration calculation, buffers
- Specific employee preference → staff calendars
- Overlapping appointments / double booking → atomic booking + retries
- No availability in requested window → offer alternatives
- Reschedule / cancel existing booking → identify by phone/name + confirmation
- Party booking (2 people) → consecutive or parallel slots

## Customer identity
- Unknown caller → collect name + phone + optional email
- Returning caller with multiple matches → disambiguate

## Policy & payments
- Price depends on complexity → give range + note, propose consultation
- Deposit required / no-show policy → explain and confirm

## Language & speech
- Noisy line, accents → confirm key details (date/time/name)
- Spelled names/addresses → spell-back confirmation

## Safety & handoff
- Complaints / angry caller → escalate
- Medical/legal topics (for other verticals) → refuse/redirect
- Data requests (invoices, personal data) → verify identity or handoff

## Failure modes
- STT/TTS provider degraded → fallback provider or switch to text flow
- Calendar API down → take request, create ticket, promise callback
