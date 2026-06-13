import '../env.js';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { pathToFileURL } from 'node:url';
import { createWebCall, listAgents } from '../retell.js';
import { DRKALLA_CUSTOM_RUNTIME_CANARY_AGENT_NAME } from './sync-drkalla-custom-runtime-canary.js';

function html(): string {
  return `<!doctype html>
<html lang="de">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>DrKalla Custom Runtime Canary</title>
  <style>
    body { font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; margin: 32px; line-height: 1.45; background: #0b0f14; color: #f5f7fb; }
    main { max-width: 760px; }
    button { font: inherit; padding: 12px 16px; border: 0; border-radius: 8px; background: #67e8f9; color: #081018; cursor: pointer; margin-right: 8px; }
    button:disabled { opacity: .55; cursor: not-allowed; }
    .status { margin: 16px 0; color: #cbd5e1; }
    .log { white-space: pre-wrap; background: #111827; border: 1px solid #243244; border-radius: 8px; padding: 12px; min-height: 180px; }
  </style>
</head>
<body>
  <main>
    <h1>DrKalla Custom Runtime Canary</h1>
    <p>Lokaler Testcall ohne Telefonnummernumstellung. Der Token wird erst beim Start erzeugt.</p>
    <button id="start">Canary-Webcall starten</button>
    <button id="stop" disabled>Auflegen</button>
    <div class="status" id="status">Bereit.</div>
    <div class="log" id="log"></div>
  </main>
  <script type="module">
    import { RetellWebClient } from 'https://esm.sh/retell-client-js-sdk';

    const start = document.getElementById('start');
    const stop = document.getElementById('stop');
    const status = document.getElementById('status');
    const logBox = document.getElementById('log');
    let client = null;

    function log(line) {
      logBox.textContent += line + "\\n";
      logBox.scrollTop = logBox.scrollHeight;
    }

    start.onclick = async () => {
      start.disabled = true;
      status.textContent = 'Erzeuge frischen Webcall-Token...';
      try {
        const res = await fetch('/token', { method: 'POST' });
        const data = await res.json();
        if (!data.ok || !data.accessToken) throw new Error(data.message || 'Kein accessToken erhalten');

        client = new RetellWebClient();
        client.on('call_started', () => {
          status.textContent = 'Verbunden. Sprich jetzt.';
          stop.disabled = false;
          log('system: verbunden');
        });
        client.on('call_ended', () => {
          status.textContent = 'Call beendet.';
          start.disabled = false;
          stop.disabled = true;
          log('system: beendet');
        });
        client.on('agent_start_talking', () => log('agent: spricht'));
        client.on('agent_stop_talking', () => log('agent: fertig'));
        client.on('update', (update) => {
          if (!update?.transcript) return;
          logBox.textContent = update.transcript
            .filter((t) => t.content)
            .map((t) => t.role + ': ' + t.content)
            .join("\\n");
        });
        client.on('error', (err) => {
          status.textContent = 'Fehler: ' + String(err);
          log('error: ' + String(err));
          start.disabled = false;
          stop.disabled = true;
        });

        status.textContent = 'Starte Call...';
        await client.startCall({ accessToken: data.accessToken });
      } catch (error) {
        status.textContent = 'Fehler: ' + (error?.message || String(error));
        start.disabled = false;
        stop.disabled = true;
      }
    };

    stop.onclick = () => {
      client?.stopCall();
      client = null;
      start.disabled = false;
      stop.disabled = true;
    };
  </script>
</body>
</html>`;
}

function openBrowser(url: string): void {
  if (process.platform === 'win32') {
    spawn('cmd', ['/c', 'start', '', url], { detached: true, stdio: 'ignore' }).unref();
    return;
  }
  if (process.platform === 'darwin') {
    spawn('open', [url], { detached: true, stdio: 'ignore' }).unref();
    return;
  }
  spawn('xdg-open', [url], { detached: true, stdio: 'ignore' }).unref();
}

async function findCanaryAgentId(): Promise<string> {
  const agent = (await listAgents()).find((item) => item.agent_name === DRKALLA_CUSTOM_RUNTIME_CANARY_AGENT_NAME);
  if (!agent?.agent_id) throw new Error('DRKALLA_CUSTOM_RUNTIME_CANARY_AGENT_NOT_FOUND');
  return agent.agent_id;
}

export async function serveDrkallaCustomRuntimeWebcall(input: { port: number; open: boolean }): Promise<void> {
  const agentId = await findCanaryAgentId();
  const server = createServer(async (req, res) => {
    try {
      if (req.method === 'GET' && req.url === '/') {
        res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
        res.end(html());
        return;
      }
      if (req.method === 'POST' && req.url === '/token') {
        const call = await createWebCall(agentId, {
          dynamicVariables: { business_name: 'Dr.Kalla Cosmetics', custom_runtime_canary: 'true' },
          metadata: { template_id: 'drkalla-custom-runtime-canary-local' },
        });
        res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
        res.end(JSON.stringify({
          ok: true,
          accessToken: call.access_token,
          callIdMasked: call.call_id ? `${call.call_id.slice(0, 12)}...` : null,
        }));
        return;
      }
      res.writeHead(404, { 'content-type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ ok: false, message: 'not_found' }));
    } catch (error) {
      res.writeHead(500, { 'content-type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ ok: false, message: error instanceof Error ? error.message : String(error) }));
    }
  });

  await new Promise<void>((resolve) => {
    server.listen(input.port, '127.0.0.1', resolve);
  });
  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : input.port;
  const url = `http://127.0.0.1:${port}/`;
  console.log(JSON.stringify({ ok: true, url, agentName: DRKALLA_CUSTOM_RUNTIME_CANARY_AGENT_NAME }, null, 2));
  if (input.open) openBrowser(url);
}

const invokedDirectly = process.argv[1]
  ? import.meta.url === pathToFileURL(process.argv[1]).href
  : false;

if (invokedDirectly) {
  const portArg = process.argv.find((arg) => arg.startsWith('--port='));
  const port = portArg ? Number(portArg.split('=')[1]) : 8877;
  serveDrkallaCustomRuntimeWebcall({
    port: Number.isFinite(port) ? port : 8877,
    open: process.argv.includes('--open'),
  }).catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
