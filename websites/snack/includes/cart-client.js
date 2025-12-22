;(function(){
  'use strict';
  var STORAGE_KEY = 'spicykik_cart_v1';

  function centsFromString(text){
    if(!text) return 0;
    // normalize digits and dot
    var cleaned = String(text).replace(/[^\n0-9.,]/g,'').replace(/,/g,'');
    var f = parseFloat(cleaned);
    if(isNaN(f)) return 0;
    return Math.round(f * 100);
  }

  function formatCurrency(cents){
    var v = (cents/100).toFixed(2);
    return 'Rs. ' + v;
  }

  function loadCart(){
    try{ var raw = localStorage.getItem(STORAGE_KEY); if(!raw) return {items:[]}; return JSON.parse(raw); }catch(e){return {items:[]};}
  }

  function saveCart(cart){ localStorage.setItem(STORAGE_KEY, JSON.stringify(cart)); updateCartBadge(); }

  function findItemKey(item){ return (item.id?('v:'+item.id):('p:'+item.handle)) }

  function addItem(item){
    var cart = loadCart();
    var key = findItemKey(item);
    var existing = cart.items.find(function(i){ return findItemKey(i) === key; });
    if(existing){ existing.quantity = (existing.quantity||0) + (item.quantity||1); }
    else { item.quantity = item.quantity||1; cart.items.push(item); }
    saveCart(cart);
  }

  function updateQuantity(key, qty){
    var cart = loadCart(); qty = Math.max(0, Math.floor(qty));
    cart.items = cart.items.map(function(i){ if(findItemKey(i)===key) i.quantity = qty; return i; }).filter(function(i){ return i.quantity>0; });
    saveCart(cart);
    return cart;
  }

  function removeItem(key){
    var cart = loadCart(); cart.items = cart.items.filter(function(i){ return findItemKey(i)!==key; }); saveCart(cart); return cart;
  }

  function cartTotals(cart){
    var subtotal = 0; cart = cart || loadCart(); cart.items.forEach(function(i){ subtotal += (i.price_cents||0) * (i.quantity||0); });
    return { subtotal: subtotal };
  }

  function updateCartBadge(){
    try{
      var cart = loadCart(); var count = cart.items.reduce(function(s,i){ return s + (i.quantity||0); },0);
      var nodes = document.querySelectorAll('.cart-count-bubble');
      nodes.forEach(function(n){ var visible = n.querySelector('span[aria-hidden]'); var vis = n.querySelector('.visually-hidden'); if(visible) visible.textContent = count; if(vis) vis.textContent = count + (count===1? ' item' : ' items'); n.style.display = count? 'inline-flex':'none'; });
    }catch(e){}
  }

  function renderCartPage(){
    var cart = loadCart(); var container = document.querySelector('#main-cart-items .js-contents');
    if(!container) return;
    container.innerHTML = '';
    if(!cart.items || cart.items.length===0){
      document.querySelector('.cart__warnings .cart__empty-text') && (document.querySelector('.cart__warnings .cart__empty-text').style.display='block');
      document.querySelector('.cart__contents') && (document.querySelector('.cart__contents').classList.add('critical-hidden'));
      var totalsEl = document.querySelector('.totals__total-value'); if(totalsEl) totalsEl.textContent = formatCurrency(0);
      var checkoutBtn = document.getElementById('checkout'); if(checkoutBtn) checkoutBtn.disabled = true;
      return;
    }
    // hide empty warning
    var warn = document.querySelector('.cart__warnings .cart__empty-text'); if(warn) warn.style.display='none';
    var contentsWrapper = document.querySelector('.cart__contents'); if(contentsWrapper) contentsWrapper.classList.remove('critical-hidden');

    cart.items.forEach(function(item){
      var key = findItemKey(item);
      var row = document.createElement('div'); row.className = 'cart-item'; row.style.display='flex'; row.style.gap='12px'; row.style.alignItems='center'; row.style.padding='12px 0';
      var img = document.createElement('img'); img.src = item.image||''; img.alt = item.title||''; img.style.width='64px'; img.style.height='64px'; img.style.objectFit='cover';
      var meta = document.createElement('div'); meta.style.flex='1'; meta.innerHTML = '<div class="cart-item__title">'+(item.title||'Untitled')+'</div>' + (item.variant?('<div class="cart-item__variant">'+item.variant+'</div>'):'');
      var price = document.createElement('div'); price.style.minWidth='100px'; price.innerHTML = '<div class="cart-item__price">'+formatCurrency(item.price_cents||0)+'</div>';
      var qty = document.createElement('div'); qty.innerHTML = '<button class="qty-minus">-</button> <input class="qty-input" value="'+(item.quantity||1)+'" size="3" style="width:48px;text-align:center"/> <button class="qty-plus">+</button> <button class="remove-item" style="margin-left:8px;color:#a00">Remove</button>';
      row.appendChild(img); row.appendChild(meta); row.appendChild(price); row.appendChild(qty);
      container.appendChild(row);

      var input = qty.querySelector('.qty-input'); var plus = qty.querySelector('.qty-plus'); var minus = qty.querySelector('.qty-minus'); var rem = qty.querySelector('.remove-item');
      plus.addEventListener('click', function(){ input.value = (parseInt(input.value||'0')||0)+1; updateQuantity(key, parseInt(input.value)); renderCartPage(); });
      minus.addEventListener('click', function(){ input.value = Math.max(0,(parseInt(input.value||'0')||0)-1); updateQuantity(key, parseInt(input.value)); renderCartPage(); });
      input.addEventListener('change', function(){ var v = Math.max(0, parseInt(input.value)||0); updateQuantity(key, v); renderCartPage(); });
      rem.addEventListener('click', function(){ removeItem(key); renderCartPage(); });
    });

    var totals = cartTotals(cart);
    var totalsEl = document.querySelector('.totals__total-value'); if(totalsEl) totalsEl.textContent = formatCurrency(totals.subtotal||0);
    var checkoutBtn = document.getElementById('checkout'); if(checkoutBtn) {
      checkoutBtn.disabled = cart.items.length===0;
      checkoutBtn.addEventListener('click', function(){
        if(cart.items.length===0) return;
        // build exact total in cents and redirect to pay.html with query param
        var totals = cartTotals(cart);
        var totalCents = totals.subtotal || 0;
        // pass cents for precise server-side usage
        var url = './pay.html?amount_cents=' + encodeURIComponent(totalCents);
        window.location.href = url;
      });
    }
  }

  function extractPriceFromElement(el){ if(!el) return 0; var txt = el.textContent || el.innerText || ''; return centsFromString(txt); }

  function handleAddToCartForm(e){
    try{
      var form = e.target; if(!(form instanceof HTMLFormElement)) return;
      var action = form.getAttribute('action')||''; if(action.indexOf('/cart/add')===-1) return;
      e.preventDefault();
      // variant id
      var idInput = form.querySelector('input[name="id"]'); var variantId = idInput && idInput.value;
      var qtyInput = form.querySelector('input[name="quantity"]') || form.querySelector('input[type="number"]'); var qty = qtyInput ? Math.max(0, parseInt(qtyInput.value||'1')||1) : 1;
      // find title and price by searching up the DOM
      var card = form.closest('.card') || form.closest('.product') || form.closest('li') || form;
      var titleEl = card && (card.querySelector('.card__heading') || card.querySelector('.h3') || card.querySelector('h3') || card.querySelector('.card__title'));
      var title = titleEl ? (titleEl.textContent||titleEl.innerText).trim() : (form.getAttribute('data-product-title')||'Product');
      var priceEl = card && (card.querySelector('.price-item--regular') || card.querySelector('.price-item'));
      var priceCents = extractPriceFromElement(priceEl);
      var imgEl = card && card.querySelector('img'); var image = imgEl ? imgEl.src : '';
      var variantTextEl = form.querySelector('select') || card && card.querySelector('.variant-item'); var variantText = variantTextEl ? (variantTextEl.value || variantTextEl.getAttribute('data-variant')) : '';
      addItem({ id: variantId, handle: form.getAttribute('data-product-handle')||'', title: title, variant: variantText, price_cents: priceCents, quantity: qty, image: image });
      // small UX: flash cart notification if present
      try{ var notif = document.getElementById('cart-notification'); if(notif){ notif.style.display='block'; setTimeout(function(){ notif.style.display='none'; },1200); } }catch(e){}
      updateCartBadge();
    }catch(err){ console.error('add-to-cart error',err); }
  }

  // attach global listener for add-to-cart
  document.addEventListener('submit', handleAddToCartForm, true);
  // init badge and cart page render
  document.addEventListener('DOMContentLoaded', function(){ updateCartBadge(); renderCartPage(); });

  // expose for debugging
  window.SiteCart = { load: loadCart, save: saveCart, addItem: addItem, updateQuantity: updateQuantity, removeItem: removeItem, totals: cartTotals };

})();
