// Static-landing nav helpers (no inline event handlers — CSP-safe).
// Loaded via <script defer src="/nav.js"> in each branch-landing index.html.
(function () {
  'use strict';

  // Nav-toggle (mobile menu) — triggered by data-nav-toggle elements.
  document.addEventListener('click', function (e) {
    var el = e.target;
    while (el && el !== document) {
      // Hamburger toggle
      if (el.hasAttribute && el.hasAttribute('data-nav-toggle')) {
        document.body.classList.toggle('nav-open');
        var btn = el;
        var expanded = document.body.classList.contains('nav-open');
        btn.setAttribute('aria-expanded', expanded ? 'true' : 'false');
        // Close all dropdowns when menu closes
        if (!expanded) {
          var openDropdowns = document.querySelectorAll('.has-dropdown.open');
          for (var i = 0; i < openDropdowns.length; i++) openDropdowns[i].classList.remove('open');
        }
        return;
      }
      // Mobile dropdown toggle — Branchen dropdown opens/closes on click
      if (el.classList && el.classList.contains('dropdown-toggle')) {
        var parent = el.closest('.has-dropdown');
        if (parent && document.body.classList.contains('nav-open')) {
          e.preventDefault();
          parent.classList.toggle('open');
          el.setAttribute('aria-expanded', parent.classList.contains('open') ? 'true' : 'false');
          return;
        }
      }
      el = el.parentNode;
    }
  });

  // Email-obfuscation: links carrying data-u + data-d get a real mailto: + text
  // set client-side. Server-rendered HTML shows "info (at) phonbot.de" which
  // doesn't match the typical email-harvester regex, so spam-bots miss it.
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
