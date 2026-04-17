// Static-landing nav helpers (no inline event handlers — CSP-safe).
(function () {
  'use strict';

  // Mobile menu toggle
  document.addEventListener('click', function (e) {
    var hamburger = e.target.closest('#hamburger-btn');
    if (hamburger) {
      var menu = document.getElementById('mobile-menu');
      var hb1 = document.getElementById('hb1');
      var hb2 = document.getElementById('hb2');
      var hb3 = document.getElementById('hb3');
      if (!menu) return;
      var isOpen = menu.style.display !== 'none';
      menu.style.display = isOpen ? 'none' : '';
      if (hb1) hb1.style.transform = isOpen ? '' : 'rotate(45deg) translateY(8px)';
      if (hb2) hb2.style.opacity = isOpen ? '' : '0';
      if (hb3) hb3.style.transform = isOpen ? '' : 'rotate(-45deg) translateY(-8px)';
      return;
    }

    // Desktop Branchen dropdown toggle
    var branchenBtn = e.target.closest('#branchen-toggle');
    if (branchenBtn) {
      var dd = document.getElementById('branchen-dropdown');
      var chevron = document.getElementById('branchen-chevron');
      if (!dd) return;
      var open = dd.style.display !== 'none';
      dd.style.display = open ? 'none' : '';
      if (chevron) chevron.style.transform = open ? '' : 'rotate(180deg)';
      branchenBtn.setAttribute('aria-expanded', open ? 'false' : 'true');
      return;
    }

    // Close desktop dropdown when clicking outside
    var branchenDesktop = document.getElementById('branchen-desktop');
    var dd2 = document.getElementById('branchen-dropdown');
    if (dd2 && dd2.style.display !== 'none' && branchenDesktop && !branchenDesktop.contains(e.target)) {
      dd2.style.display = 'none';
      var chevron2 = document.getElementById('branchen-chevron');
      if (chevron2) chevron2.style.transform = '';
      var btn2 = document.getElementById('branchen-toggle');
      if (btn2) btn2.setAttribute('aria-expanded', 'false');
    }
  });

  // Email obfuscation
  function decloakMails() {
    var nodes = document.querySelectorAll('a.obf-mail[data-u][data-d]');
    for (var i = 0; i < nodes.length; i++) {
      var a = nodes[i];
      var u = a.getAttribute('data-u');
      var d = a.getAttribute('data-d');
      if (!u || !d) continue;
      var addr = u + '@' + d;
      a.setAttribute('href', 'mailto:' + addr);
      a.textContent = addr;
    }
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', decloakMails);
  } else {
    decloakMails();
  }
})();
