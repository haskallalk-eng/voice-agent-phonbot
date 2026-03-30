# Phone demo (Twilio inbound) – OpenAI-only stack

## What you get
- Inbound phone call hits `/twilio/voice`.
- Twilio connects a Media Stream to `wss://.../twilio/media`.
- ✅ Audio ⇄ OpenAI Realtime bridge (mu-law ↔ pcm16) is now implemented.

## Prereqs
- Twilio account + a phone number.
- OpenAI API key (Realtime enabled).
- A public HTTPS URL that can reach your dev machine:
  - **ngrok** (fastest)
  - Cloudflare Tunnel (more stable)
  - Tailscale Funnel (if enabled)

## 1) Start local dev
From repo root:
- API: `npx -y pnpm@9.15.3 --filter @vas/api dev`
- Web: `npx -y pnpm@9.15.3 --filter @vas/web dev`

API listens on :3001, web on :3000.

## 2) Expose API publicly (ngrok example)
Expose only the API port:
- `ngrok http 3001`

Set in `.env`:
- `TWILIO_WEBHOOK_BASE_URL=<your ngrok https url>`
- `OPENAI_API_KEY=...`
- (optional) `OPENAI_REALTIME_MODEL=gpt-4o-realtime-preview`
- (optional) `OPENAI_REALTIME_VOICE=alloy`

## 3) Configure Twilio webhook
In Twilio Console → Phone Numbers → (your number) → Voice Configuration:
- A call comes in: `POST https://<ngrok>/twilio/voice`

## 4) Test
Call your Twilio number.

You should hear the agent answer (server logs `twilio start`, then `agent_audio` deltas).

## Next steps (polish)
- Tune barge‑in thresholds (`BARGE_IN_RMS`, `BARGE_IN_WINDOW_MS`)
- Latency tuning (chunk sizes, buffering)
- Better VAD settings per language
