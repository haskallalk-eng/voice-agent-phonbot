# Remote control / access from phone

## Option 1 (same Wi‑Fi / LAN) – fastest
1. Start API (binds 0.0.0.0 already): `npx -y pnpm@9.15.3 --filter @vas/api dev`
2. Start web with Vite (configured to listen on LAN): `npx -y pnpm@9.15.3 --filter @vas/web dev`
3. Find your PC LAN IP (example): `192.168.178.88`
4. On the phone (same Wi‑Fi), open:
   - Web UI: `http://<PC_IP>:3000`
   - API health: `http://<PC_IP>:3001/health`

If it doesn't open, you must allow Windows Firewall for Node/Vite on private networks.

## Option 2 (outside your network) – recommended secure way
Use a tunnel/VPN; do NOT expose ports publicly without auth.

Recommended:
- Tailscale (VPN) – easiest and secure
  - iOS App: https://apps.apple.com/us/app/tailscale/id1470499037?ls=1
- Cloudflare Tunnel – secure, public URL, no port forwarding
- ngrok – quick demo tunnels

We will pick one depending on whether you want:
- access only for you (VPN), or
- a public demo link for prospects (tunnel + auth).
