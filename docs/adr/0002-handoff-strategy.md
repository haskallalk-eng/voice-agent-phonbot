# ADR 0002: Handoff strategy (phone + ticket)

## Status
Accepted

## Decision
We support two handoff paths in MVP:
1) **Phone transfer**: agent can route the live call to a configured business number.
2) **Ticket/callback**: if transfer fails or caller prefers not to wait, the agent collects details and creates a ticket for callback.

## Rationale
- Maximizes demo impact (realistic escalation).
- Provides resilience when staff is unavailable.

## Notes
- Transfer availability depends on the SIP provider (Twilio supports call forwarding/transfer patterns).
- Ticket creation will be implemented as an internal API + optional webhook/email.
