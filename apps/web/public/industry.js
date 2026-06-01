/**
 * Shared JS for legacy static industry landing pages.
 * Public demos are telephone-first: demo buttons open the real demo number.
 */

const DEMO_PHONE_HREF = 'tel:+493075937286';

function $(sel, ctx) {
  return (ctx || document).querySelector(sel);
}

function startDemo() {
  window.location.href = DEMO_PHONE_HREF;
}

function initFaqAccordion() {
  const items = document.querySelectorAll('.faq-accordion .faq-item');
  items.forEach((item) => {
    const btn = item.querySelector('.faq-q');
    const answer = item.querySelector('.faq-a');
    const icon = item.querySelector('.faq-icon');
    if (!btn || !answer) return;

    btn.setAttribute('aria-expanded', 'false');
    answer.setAttribute('role', 'region');

    btn.addEventListener('click', () => {
      const isOpen = answer.style.display !== 'none';
      items.forEach((other) => {
        const otherAnswer = other.querySelector('.faq-a');
        const otherIcon = other.querySelector('.faq-icon');
        const otherBtn = other.querySelector('.faq-q');
        if (otherAnswer) otherAnswer.style.display = 'none';
        if (otherIcon) otherIcon.style.transform = 'none';
        if (otherBtn) otherBtn.setAttribute('aria-expanded', 'false');
        other.style.background = '';
        other.style.borderColor = '';
      });
      if (!isOpen) {
        answer.style.display = '';
        if (icon) icon.style.transform = 'rotate(45deg)';
        btn.setAttribute('aria-expanded', 'true');
        item.style.background = 'rgba(249,115,22,0.05)';
        item.style.borderColor = 'rgba(249,115,22,0.2)';
      }
    });
  });
}

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

    $('#val-anrufe', calc).textContent = anrufe;
    $('#val-dauer', calc).textContent = dauer + ' min';
    $('#val-lohn', calc).textContent = lohn + ' EUR';
    $('#val-nacharbeit', calc).textContent = nacharbeit + ' min';
    $('#val-quote', calc).textContent = quote + ' %';

    sliders.forEach((slider) => {
      const pct = ((slider.value - slider.min) / (slider.max - slider.min)) * 100;
      slider.style.setProperty('--pct', pct + '%');
    });

    const botMin = anrufe * (dauer + nacharbeit) * (quote / 100) * 22;
    const stunden = Math.round(botMin / 60);
    const personal = Math.round((botMin / 60) * lohn);
    const plan = anrufe <= 5 ? 0 : anrufe <= 20 ? 89 : anrufe <= 50 ? 179 : 349;
    const planName = plan === 0 ? 'Free' : plan === 89 ? 'Starter' : plan === 179 ? 'Professional' : 'Agency';
    const netto = personal - plan;

    const nettoEl = $('#calc-netto', calc);
    if (nettoEl) {
      nettoEl.textContent = netto.toLocaleString('de-DE') + ' EUR';
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
        nettoEl.style.color = netto < 0 ? '#FDBA74' : 'rgba(255,255,255,.3)';
      }
    }

    const planEl = $('#calc-plan', calc);
    if (planEl) planEl.textContent = planName + ' (' + plan + ' EUR/Monat)';

    $('#calc-stunden', calc).textContent = stunden + ' h / Monat';
    $('#calc-personal', calc).textContent = personal.toLocaleString('de-DE') + ' EUR';
    $('#calc-plankosten', calc).textContent = '-' + plan + ' EUR';

    const vorteilEl = $('#calc-vorteil', calc);
    if (vorteilEl) {
      vorteilEl.textContent = (netto >= 0 ? '+' : '') + netto.toLocaleString('de-DE') + ' EUR';
      if (netto >= 0) {
        vorteilEl.style.backgroundImage = 'linear-gradient(135deg, #F97316, #06B6D4)';
        vorteilEl.style.webkitBackgroundClip = 'text';
        vorteilEl.style.webkitTextFillColor = 'transparent';
        vorteilEl.style.backgroundClip = 'text';
        vorteilEl.style.color = 'transparent';
      } else {
        vorteilEl.style.backgroundImage = '';
        vorteilEl.style.webkitBackgroundClip = '';
        vorteilEl.style.webkitTextFillColor = '';
        vorteilEl.style.backgroundClip = '';
        vorteilEl.style.color = '#FDBA74';
      }
    }

    const hintEl = $('#calc-hint', calc);
    if (hintEl) {
      if (netto > 200) hintEl.textContent = 'Entspricht ca. ' + Math.round(netto / lohn) + ' Stunden, die dein Team fuer wichtigere Aufgaben nutzen kann.';
      else if (netto > 0) hintEl.textContent = 'Schon ab wenigen Anrufen pro Tag rechnet sich Phonbot fuer dein Business.';
      else hintEl.textContent = 'Starte kostenlos und teste, ob die Bot-Quote fuer dein Business passt.';
    }
  };

  sliders.forEach((slider) => slider.addEventListener('input', update));
  update();
}

document.addEventListener('DOMContentLoaded', () => {
  initFaqAccordion();
  initCalculator();

  document.addEventListener('click', (e) => {
    const demoStart = e.target.closest('[data-demo-start], [data-demo-toggle]');
    if (demoStart) {
      e.preventDefault();
      startDemo();
    }
  });
});
