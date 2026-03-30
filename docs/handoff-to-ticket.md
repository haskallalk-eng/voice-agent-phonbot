# Handoff → Ticket (MVP contract)

When the agent cannot transfer the call (or caller declines), it creates a callback ticket.

## Create ticket payload
`POST /tickets`
- `tenantId` (string, default `demo`)
- `source` (optional: `phone|web|system`)
- `sessionId` (optional)
- `reason` (optional)
- `customerPhone` (required)
- `customerName` (optional)
- `preferredTime` (optional)
- `service` (optional)
- `notes` (optional)

## Rules
- Ticket creation MUST fail without `customerPhone`.
- Agent should confirm phone number by repeating digits when caller-id is unavailable.
