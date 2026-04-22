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
  // closing note. Matches the chipy-design §5 motion budget rule —
  // animation only kicks in once the user has scrolled the section into
  // view, not when the page loads.
  function armDialogueReveal(){
    if(!('IntersectionObserver' in window)) {
      // Feature-detect fallback: reveal everything immediately.
      document.querySelectorAll('.dialogue').forEach(function(el){el.classList.add('in-view')});
      document.querySelectorAll('.dialogue-note').forEach(function(el){el.classList.add('in-view-note')});
      return;
    }
    var obs=new IntersectionObserver(function(entries){
      entries.forEach(function(entry){
        if(!entry.isIntersecting) return;
        entry.target.classList.add('in-view');
        // Promote the sibling dialogue-note so its delayed fade-in runs too.
        var note=entry.target.parentNode && entry.target.parentNode.querySelector('.dialogue-note');
        if(note) note.classList.add('in-view-note');
        obs.unobserve(entry.target);
      });
    },{threshold:.18,rootMargin:'0px 0px -10% 0px'});
    document.querySelectorAll('.dialogue').forEach(function(el){obs.observe(el)});
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',armDialogueReveal);else armDialogueReveal();
})();
