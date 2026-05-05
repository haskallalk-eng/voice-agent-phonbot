// Nav helpers (CSP-safe)
(function(){
  'use strict';
  function setExpanded(el, expanded){
    if(el)el.setAttribute('aria-expanded',expanded?'true':'false');
  }
  function closeMenu(){
    document.body.classList.remove('mopen');
    setExpanded(document.getElementById('ph-burg'),false);
  }
  function closeDropdown(){
    var dd=document.getElementById('ph-dd');
    if(dd)dd.classList.remove('open');
    setExpanded(document.getElementById('ph-dd-btn'),false);
  }
  document.addEventListener('click',function(e){
    if(e.target.closest('#ph-burg')){
      var open=!document.body.classList.contains('mopen');
      document.body.classList.toggle('mopen',open);
      setExpanded(document.getElementById('ph-burg'),open);
      return
    }
    var ddBtn=e.target.closest('#ph-dd-btn');
    if(ddBtn){
      var dd=document.getElementById('ph-dd');
      var ddOpen=!!dd&&!dd.classList.contains('open');
      if(dd)dd.classList.toggle('open',ddOpen);
      setExpanded(ddBtn,ddOpen);
      return
    }
    var dd2=document.getElementById('ph-dd');
    if(dd2&&dd2.classList.contains('open')&&!dd2.contains(e.target))closeDropdown();
  });
  document.addEventListener('keydown',function(e){
    if(e.key==='Escape'){closeDropdown();closeMenu()}
  });
  document.querySelectorAll('.ph-mob a').forEach(function(a){
    a.addEventListener('click',closeMenu);
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
