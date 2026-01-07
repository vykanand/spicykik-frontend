(function(){
  'use strict';

  function safeJsonParse(v){ try{ return v? JSON.parse(v): null; }catch(e){ return null; } }

  function getUser(){
    try{ return safeJsonParse(localStorage.getItem('user')) || safeJsonParse(sessionStorage.getItem('user')) || null; }
    catch(e){ return null; }
  }

  function setUser(u){ try{ localStorage.setItem('user', JSON.stringify(u)); }catch(e){} }

  function clearUser(){
    try{ const old = localStorage.getItem('user'); localStorage.removeItem('user'); try{ sessionStorage.removeItem('user'); }catch(e){}; try{ window.dispatchEvent(new StorageEvent('storage', { key: 'user', oldValue: old, newValue: null })); }catch(e){} }catch(e){}
  }

  function requireLogin(returnUrl){
    var u = getUser();
    if(!u){
      var ret = returnUrl || (window.location.pathname + window.location.search);
      window.location.href = './login.html?returnUrl=' + encodeURIComponent(ret);
      return false;
    }
    return true;
  }

  function logout(redirectToLogin){
    clearUser();
    if(redirectToLogin === false) return;
    window.location.href = './login.html';
  }

  function initHeaderAuth(){
    try{
      // account anchors often link to login.html - replace behavior to check session
      var anchors = document.querySelectorAll('a[href$="login.html"], a[href*="/account"]');
      anchors.forEach(function(a){
        if(a.__authAttached) return; a.__authAttached = true;
        a.addEventListener('click', function(e){
          e.preventDefault();
          var user = getUser();
          if(user){
            // go to dashboard/profile if logged in
            window.location.href = './dashboard.html';
          } else {
            // ensure returnUrl forwards back to current page or intended target
            var href = a.getAttribute('href') || './login.html';
            var returnUrl = href && href.indexOf('login.html') === -1 ? href : (window.location.pathname + window.location.search);
            window.location.href = './login.html?returnUrl=' + encodeURIComponent(returnUrl);
          }
        });
      });

      // account icon spans that are not anchors
      var icons = document.querySelectorAll('.header__icon--account');
      icons.forEach(function(ic){
        if(ic.__authIcon) return; ic.__authIcon = true;
        ic.addEventListener('click', function(e){
          e.preventDefault();
          var user = getUser();
          if(user) window.location.href = './dashboard.html';
          else window.location.href = './login.html?returnUrl=' + encodeURIComponent(window.location.pathname + window.location.search);
        });
      });
    }catch(e){ /* ignore init errors */ }
  }

  // auto-initialize on DOM ready
  if(document.readyState === 'loading') document.addEventListener('DOMContentLoaded', initHeaderAuth);
  else initHeaderAuth();

  // expose API
  window.SnackAuth = { getUser: getUser, requireLogin: requireLogin, logout: logout, setUser: setUser };
})();
