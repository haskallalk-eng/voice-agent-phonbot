// Static-landing nav helpers (no inline event handlers — CSP-safe).
// Loaded via <script defer src="/nav.js"> in each branch-landing index.html.
(function () {
  'use strict';
  document.addEventListener('click', function (e) {
    var el = e.target;
    while (el && el !== document) {
      if (el.hasAttribute && el.hasAttribute('data-nav-toggle')) {
        document.body.classList.toggle('nav-open');
        var btn = el;
        var expanded = document.body.classList.contains('nav-open');
        btn.setAttribute('aria-expanded', expanded ? 'true' : 'false');
        return;
      }
      el = el.parentNode;
    }
  });
})();
