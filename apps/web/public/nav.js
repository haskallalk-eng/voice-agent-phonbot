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

  // Scroll-triggered stagger for the 'So klingt Phonbot' dialogue + its
  // closing note. Threshold 0 + rootMargin -80px — the card's first
  // pixel has to crest above ~80px from the viewport bottom before the
  // reveal fires. Previous threshold (.18 of a tall card) never fired
  // on mobile because the card was taller than the viewport.
  //
  // Belt-and-suspenders safety net: the same classes are added after
  // 4s no matter what, so a silently failing observer (iframe quirks,
  // resource-loading race, reduced-motion engine, etc.) never leaves
  // the user staring at invisible messages. Without this fallback the
  // section is pure opacity:0 — nothing to read.
  function reveal(){
    document.querySelectorAll('.dialogue').forEach(function(el){el.classList.add('in-view')});
    document.querySelectorAll('.dialogue-note').forEach(function(el){el.classList.add('in-view-note')});
  }
  function armDialogueReveal(){
    var cards=document.querySelectorAll('.dialogue');
    if(cards.length===0) return;
    if(!('IntersectionObserver' in window)) { reveal(); return; }
    var obs=new IntersectionObserver(function(entries){
      entries.forEach(function(entry){
        if(!entry.isIntersecting) return;
        entry.target.classList.add('in-view');
        // Flip the sibling dialogue-note so its delayed fade-in runs too.
        // .dialogue and .dialogue-note live as adjacent siblings inside the
        // same <div class="container">, so nextElementSibling is the note.
        var sib=entry.target.nextElementSibling;
        if(sib && sib.classList && sib.classList.contains('dialogue-note')) sib.classList.add('in-view-note');
        obs.unobserve(entry.target);
      });
    },{threshold:0,rootMargin:'0px 0px -80px 0px'});
    cards.forEach(function(el){obs.observe(el)});
    // Safety net: if the observer hasn't fired after 4 seconds on page
    // load (e.g. the card is below the fold and the user is paused),
    // still nothing — we only reveal here when a scroll actually enters
    // view. But for cards ALREADY on-screen at load the observer fires
    // microtasks-later; this window also catches that.
    setTimeout(function(){
      cards.forEach(function(el){
        var r=el.getBoundingClientRect();
        // Any part on-screen right now? Reveal.
        if(r.top < (window.innerHeight||document.documentElement.clientHeight) && r.bottom > 0) {
          el.classList.add('in-view');
          var sib=el.nextElementSibling;
          if(sib && sib.classList && sib.classList.contains('dialogue-note')) sib.classList.add('in-view-note');
        }
      });
    }, 500);
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',armDialogueReveal);else armDialogueReveal();
})();
