/**
 * Shared JS for static industry landing pages.
 * Handles: Demo call (Retell SDK), FAQ accordion, Savings calculator.
 * Loaded via <script type="module" src="/industry.js"> — CSP-safe.
 */

// ── Demo call ────────────────────────────────────────────────────────────────

let retellClient = null;
let callState = 'idle'; // idle | connecting | active | ended | error

function $(sel, ctx) { return (ctx || document).querySelector(sel); }

function updateDemoUI() {
  const w = $('#demo-widget');
  if (!w) return;
  const idle = $('#demo-idle', w);
  const connecting = $('#demo-connecting', w);
  const active = $('#demo-active', w);
  const ended = $('#demo-ended', w);
  const errEl = $('#demo-error', w);

  [idle, connecting, active, ended, errEl].forEach(el => { if (el) el.style.display = 'none'; });

  if (callState === 'idle' && idle) idle.style.display = '';
  if (callState === 'connecting' && connecting) connecting.style.display = '';
  if (callState === 'active' && active) active.style.display = '';
  if (callState === 'ended' && ended) ended.style.display = '';
  if (callState === 'error' && errEl) errEl.style.display = '';
}

async function startDemo(templateId) {
  if (callState === 'connecting' || callState === 'active') return;
  callState = 'connecting';
  updateDemoUI();

  // Show the demo section
  const sec = $('#demo-section');
  if (sec) {
    sec.style.display = '';
    sec.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }

  try {
    // Request mic permission early (iOS Safari user-gesture requirement)
    if (navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        stream.getTracks().forEach(t => t.stop());
      } catch (micErr) {
        const name = micErr.name || '';
        if (name === 'NotAllowedError' || name === 'PermissionDeniedError') {
          throw new Error('Mikrofon-Zugriff wurde abgelehnt. Bitte erlaube den Zugriff in den Browser-Einstellungen.');
        }
        if (name === 'NotFoundError') {
          throw new Error('Kein Mikrofon gefunden. Bitte verbinde ein Mikrofon.');
        }
        throw new Error('Mikrofon nicht verfügbar.');
      }
    }

    // Call demo API
    const res = await fetch('/api/demo/call', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ templateId }),
      signal: AbortSignal.timeout(15000),
    });

    if (!res.ok) {
      if (res.status === 429) throw new Error('rate_limit');
      throw new Error('API Fehler: ' + res.status);
    }

    const data = await res.json();
    if (!data.access_token) throw new Error('Kein Zugriffstoken erhalten');

    // Dynamically import Retell SDK
    const { RetellWebClient } = await import('https://esm.sh/retell-client-js-sdk@2');
    const client = new RetellWebClient();
    retellClient = client;

    const chipyEl = $('#demo-chipy');
    const statusEl = $('#demo-status');

    client.on('call_started', () => {
      callState = 'active';
      updateDemoUI();
    });
    client.on('call_ended', () => {
      callState = 'ended';
      if (chipyEl) chipyEl.classList.remove('chipy-talking');
      updateDemoUI();
    });
    client.on('agent_start_talking', () => {
      if (chipyEl) chipyEl.classList.add('chipy-talking');
      if (statusEl) { statusEl.textContent = 'Agent spricht\u2026'; statusEl.style.color = '#67E8F9'; }
    });
    client.on('agent_stop_talking', () => {
      if (chipyEl) chipyEl.classList.remove('chipy-talking');
      if (statusEl) { statusEl.textContent = 'Warte auf dich\u2026'; statusEl.style.color = '#FDBA74'; }
    });
    client.on('error', (err) => {
      callState = 'error';
      const errMsg = $('#demo-error-msg');
      if (errMsg) errMsg.textContent = String(err);
      updateDemoUI();
    });

    await client.startCall({ accessToken: data.access_token });
  } catch (e) {
    callState = 'error';
    const errMsg = $('#demo-error-msg');
    if (errMsg) {
      if (e.message === 'rate_limit') {
        errMsg.textContent = 'Demo-Limit erreicht \u2014 probier es in einer Stunde nochmal oder registriere dich kostenlos.';
      } else {
        errMsg.textContent = e.message;
      }
    }
    updateDemoUI();
  }
}

function stopDemo() {
  if (retellClient) { retellClient.stopCall(); retellClient = null; }
  callState = 'ended';
  updateDemoUI();
}

function resetDemo() {
  callState = 'idle';
  retellClient = null;
  updateDemoUI();
  const sec = $('#demo-section');
  if (sec) sec.style.display = 'none';
}

// ── Demo toggle (hero button) ────────────────────────────────────────────────

function toggleDemo(templateId) {
  const sec = $('#demo-section');
  if (!sec) return;
  if (sec.style.display === 'none' || !sec.style.display) {
    sec.style.display = '';
    sec.scrollIntoView({ behavior: 'smooth', block: 'center' });
    callState = 'idle';
    updateDemoUI();
  } else {
    if (callState === 'active' || callState === 'connecting') stopDemo();
    sec.style.display = 'none';
  }
}

// ── FAQ accordion ────────────────────────────────────────────────────────────

function initFaqAccordion() {
  const items = document.querySelectorAll('.faq-accordion .faq-item');
  items.forEach((item, i) => {
    const btn = item.querySelector('.faq-q');
    const answer = item.querySelector('.faq-a');
    const icon = item.querySelector('.faq-icon');
    if (!btn || !answer) return;

    btn.addEventListener('click', () => {
      const isOpen = answer.style.display !== 'none';
      // Close all
      items.forEach(other => {
        const a = other.querySelector('.faq-a');
        const ic = other.querySelector('.faq-icon');
        if (a) a.style.display = 'none';
        if (ic) ic.style.transform = 'none';
        other.style.background = '';
        other.style.borderColor = '';
      });
      // Toggle current
      if (!isOpen) {
        answer.style.display = '';
        if (icon) icon.style.transform = 'rotate(45deg)';
        item.style.background = 'rgba(249,115,22,0.05)';
        item.style.borderColor = 'rgba(249,115,22,0.2)';
      }
    });
  });
}

// ── Calculator ───────────────────────────────────────────────────────────────

function initCalculator() {
  const calc = $('#savings-calc');
  if (!calc) return;

  const sliders = calc.querySelectorAll('input[type=range]');
  const update = () => {
    const anrufe = Number($('#calc-anrufe', calc).value);
    const dauer = Number($('#calc-dauer', calc).value);
    const lohn = Number($('#calc-lohn', calc).value);
    const nacharbeit = Number($('#calc-nacharbeit', calc).value);
    const quote = Number($('#calc-quote', calc).value);

    // Update displayed values
    $('#val-anrufe', calc).textContent = anrufe;
    $('#val-dauer', calc).textContent = dauer + ' min';
    $('#val-lohn', calc).textContent = lohn + ' \u20AC';
    $('#val-nacharbeit', calc).textContent = nacharbeit + ' min';
    $('#val-quote', calc).textContent = quote + ' %';

    // Update slider fill
    sliders.forEach(sl => {
      const pct = ((sl.value - sl.min) / (sl.max - sl.min)) * 100;
      sl.style.setProperty('--pct', pct + '%');
    });

    // Calculate
    const botMin = anrufe * (dauer + nacharbeit) * (quote / 100) * 22;
    const stunden = Math.round(botMin / 60);
    const personal = Math.round((botMin / 60) * lohn);
    const plan = anrufe <= 5 ? 0 : anrufe <= 20 ? 79 : anrufe <= 50 ? 179 : 349;
    const planName = plan === 0 ? 'Free' : plan === 79 ? 'Starter' : plan === 179 ? 'Professional' : 'Agency';
    const netto = personal - plan;

    // Update results
    const nettoEl = $('#calc-netto', calc);
    if (nettoEl) {
      nettoEl.textContent = netto.toLocaleString('de-DE') + ' \u20AC';
      if (netto > 0) {
        nettoEl.style.backgroundImage = 'linear-gradient(135deg, #F97316, #06B6D4)';
        nettoEl.style.webkitBackgroundClip = 'text';
        nettoEl.style.webkitTextFillColor = 'transparent';
        nettoEl.style.backgroundClip = 'text';
        nettoEl.style.color = 'transparent';
      } else {
        nettoEl.style.backgroundImage = '';
        nettoEl.style.webkitBackgroundClip = '';
        nettoEl.style.webkitTextFillColor = '';
        nettoEl.style.backgroundClip = '';
        nettoEl.style.color = netto < 0 ? '#F87171' : 'rgba(255,255,255,.3)';
      }
    }
    const planEl = $('#calc-plan', calc);
    if (planEl) planEl.textContent = planName + ' (' + plan + ' \u20AC/Mo)';

    $('#calc-stunden', calc).textContent = stunden + ' h / Monat';
    $('#calc-personal', calc).textContent = personal.toLocaleString('de-DE') + ' \u20AC';
    $('#calc-plankosten', calc).textContent = '\u2013' + plan + ' \u20AC';

    const vorteilEl = $('#calc-vorteil', calc);
    if (vorteilEl) {
      vorteilEl.textContent = (netto >= 0 ? '+' : '') + netto.toLocaleString('de-DE') + ' \u20AC';
      vorteilEl.style.color = netto >= 0 ? '#4ADE80' : '#F87171';
    }

    const hintEl = $('#calc-hint', calc);
    if (hintEl) {
      if (netto > 200) hintEl.textContent = 'Entspricht ca. ' + Math.round(netto / lohn) + ' Stunden die dein Team f\u00FCr wichtigere Aufgaben nutzen kann.';
      else if (netto > 0) hintEl.textContent = 'Schon ab wenigen Anrufen pro Tag rechnet sich Chipy f\u00FCr dein Business.';
      else hintEl.textContent = 'Starte kostenlos und teste ob die Bot-Quote f\u00FCr dein Business passt.';
    }
  };

  sliders.forEach(sl => sl.addEventListener('input', update));
  update();
}

// ── Init ─────────────────────────────────────────────────────────────────────

// Clean up active call if user navigates away
window.addEventListener('beforeunload', () => {
  if (retellClient && (callState === 'active' || callState === 'connecting')) {
    retellClient.stopCall();
  }
});

document.addEventListener('DOMContentLoaded', () => {
  initFaqAccordion();
  initCalculator();

  // Bind demo buttons via data attributes
  document.addEventListener('click', e => {
    const el = e.target.closest('[data-demo-start]');
    if (el) { e.preventDefault(); startDemo(el.dataset.demoStart); return; }

    const toggle = e.target.closest('[data-demo-toggle]');
    if (toggle) { e.preventDefault(); toggleDemo(); return; }

    if (e.target.closest('[data-demo-stop]')) { e.preventDefault(); stopDemo(); return; }
    if (e.target.closest('[data-demo-reset]')) { e.preventDefault(); resetDemo(); return; }
  });
});
