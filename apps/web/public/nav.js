// Static-landing nav (CSP-safe, no inline handlers)
(function(){
  'use strict';
  document.addEventListener('click',function(e){
    // Hamburger toggle
    if(e.target.closest('#burger-btn')){
      document.body.classList.toggle('menu-open');
      return;
    }
    // Desktop Branchen dropdown
    var brBtn=e.target.closest('#branchen-btn');
    if(brBtn){
      var dd=document.getElementById('branchen-dd');
      if(dd)dd.classList.toggle('open');
      return;
    }
    // Close dropdown on outside click
    var dd2=document.getElementById('branchen-dd');
    if(dd2&&dd2.classList.contains('open')&&!dd2.contains(e.target)){
      dd2.classList.remove('open');
    }
  });
  // Close mobile menu when a link is clicked
  document.querySelectorAll('.ph-mobile a,.mob-link').forEach(function(a){
    a.addEventListener('click',function(){document.body.classList.remove('menu-open')});
  });
  // Email obfuscation
  function decloakMails(){
    var nodes=document.querySelectorAll('a.obf-mail[data-u][data-d]');
    for(var i=0;i<nodes.length;i++){
      var a=nodes[i],u=a.getAttribute('data-u'),d=a.getAttribute('data-d');
      if(!u||!d)continue;
      var addr=u+'@'+d;
      a.setAttribute('href','mailto:'+addr);
      a.textContent=addr;
    }
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',decloakMails);
  else decloakMails();
})();
