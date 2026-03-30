# ADR 0001: Recordings storage

## Status
Proposed

## Context
We need call/session recordings for debugging, quality review, and a strong demo. We must remain GDPR-friendly and support retention + deletion.

## Decision
- Store recordings as objects (S3-compatible) with encryption at rest.
- Store metadata in Postgres (`recordings` table) linked to `sessions`.
- Provide per-tenant recording toggle and retention policy.

## Consequences
- Requires object storage in infra.
- Requires consent handling in phone + web channels.
- Adds audit-log requirements for playback.
