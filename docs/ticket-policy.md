# Ticket policy (MVP)

## Goal
Tickets represent a **callback request** when live transfer is unavailable or the caller prefers not to wait.

## Rule: phone is required
- `customerPhone` is **mandatory** to create a ticket.
- Rationale: prevents anonymous spam that could annoy the business owner and enables actual callbacks.

## Caller-ID behavior
- If phone channel provides caller id, we prefill it.
- If caller id is missing/blocked/unreliable, the agent must ask:
  - "Which phone number should we call you back on?"
  - Confirm by repeating digits.

## Validation
- Server validates phone with **very tolerant** rules (digits >= 6, <= 20) after stripping punctuation.
- Server stores a **light normalized** version (digits only, keeps leading + if present).
- DB enforces non-null.
- UI enforces it as required field.
