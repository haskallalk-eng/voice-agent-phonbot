// Nav helpers (CSP-safe)
(function(){
  'use strict';
  document.addEventListener('click',function(e){
    if(e.target.closest('#ph-burg')){document.body.classList.toggle('mopen');return}
    var ddBtn=e.target.closest('#ph-dd-btn');
    if(ddBtn){var dd=document.getElementById('ph-dd');if(dd)dd.classList.toggle('open');return}
    var dd2=document.getElementById('ph-dd');
    if(dd2&&dd2.classList.contains('open')&&!dd2.contains(e.target))dd2.classList.remove('open');
  });
  document.querySelectorAll('.ph-mob a').forEach(function(a){
    a.addEventListener('click',function(){document.body.classList.remove('mopen')});
  });
  function decloakMails(){
    var nodes=document.querySelectorAll('a.obf-mail[data-u][data-d]');
    for(var i=0;i<nodes.length;i++){var a=nodes[i],u=a.getAttribute('data-u'),d=a.getAttribute('data-d');if(!u||!d)continue;a.href='mailto:'+u+'@'+d;a.textContent=u+'@'+d}
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',decloakMails);else decloakMails();

  // The 'So klingt Phonbot' dialogue stagger is driven purely by CSS
  // animation-delay now (see gen-landing-pages.mjs). Previous IntersectionObserver
  // wiring was removed 2026-04-22 — threshold mismatches on mobile made
  // messages stay at opacity:0 and the section read as empty.
})();
