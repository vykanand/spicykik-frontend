(function(){
  'use strict';
  const LOG_PREFIX = '[CartClient]';
  const STORAGE_KEY = 'spicy_cart_items_v1';

  function getUser(){
    try{ const raw = localStorage.getItem('user'); return raw ? JSON.parse(raw) : null; }catch(e){ return null; }
  }

  function requireLoginRedirect(target){
    const user = getUser();
    if(!user){
      const returnUrl = target || (window.location.pathname + window.location.search);
      window.location.href = './login.html?returnUrl=' + encodeURIComponent(returnUrl);
      return true;
    }
    return false;
  }

  function log(level, payload){
    const fn = console[level] || console.log;
    fn.call(console, LOG_PREFIX, payload);
  }

  function loadCart(){
    try{
      const raw = localStorage.getItem(STORAGE_KEY);
      const data = raw ? JSON.parse(raw) : [];
      if(!Array.isArray(data)) return [];
      return data;
    }catch(err){
      log('debug', { action:'load_error', error: String(err)});
      return [];
    }
  }

  function saveCart(items){
    try{
      localStorage.setItem(STORAGE_KEY, JSON.stringify(items));
      log('debug', { action:'saved', count: items.length });
    }catch(err){
      log('debug', { action:'save_error', error: String(err)});
    }
  }

  function addToCart(item){
    const cart = loadCart();
    const idx = cart.findIndex(x => x.id === item.id);
    if(idx >= 0){
      cart[idx].qty = Number(cart[idx].qty || 0) + Number(item.qty || 0);
    } else {
      cart.push({ id: String(item.id), title: item.title || '', price: Number(item.price) || 0, image: item.image || '', qty: Number(item.qty) || 0 });
    }
    saveCart(cart);
    updateCartBadge();
    showMiniNotification(item);
  }

  function removeFromCart(id){
    const cart = loadCart().filter(x => x.id !== id);
    saveCart(cart);
    updateCartBadge();
    renderCartPage();
  }

  function updateQty(id, qty){
    const cart = loadCart();
    const idx = cart.findIndex(x => x.id === id);
    if(idx >= 0){
      cart[idx].qty = Math.max(1, qty|0);
      saveCart(cart);
      updateCartBadge();
      renderCartPage();
    }
  }

  function cartCount(){
    return loadCart().reduce((s,i)=> s + (i.qty||0), 0);
  }

  function totalCents(){
    return loadCart().reduce((s,i)=> {
      const price = Number(i.price||0);
      const cents = Math.round(price * 100);
      const qty = Number(i.qty||0) || 0;
      return s + cents * qty;
    }, 0);
  }

  function cartTotal(){
    return totalCents() / 100;
  }

  function formatCurrency(n){
    try{
      return new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 2 }).format(n);
    }catch{ return 'Rs. ' + Number(n).toFixed(2); }
  }

  function updateCartBadge(){
    const bubble = document.querySelector('#cart-icon-bubble .cart-count-bubble span[aria-hidden="true"]');
    if (bubble) {
      bubble.textContent = String(cartCount());
    }
  }

  function showMiniNotification(item){
    const notif = document.getElementById('cart-notification');
    if(!notif) return;
    const container = document.getElementById('cart-notification-product');
    if(container){
      container.innerHTML = '';
      const div = document.createElement('div');
      div.className = 'cart-notification-product__item';
      div.innerHTML = `<div class="cart-notification-product__image" style="width:64px;height:64px;overflow:hidden">${item.image?`<img src="${item.image}" style="max-width:100%;max-height:100%"/>`:''}</div>
        <div class="cart-notification-product__info">
          <div class="cart-notification-product__name">${item.title||'Added to cart'}</div>
          <div class="cart-notification-product__qty">Qty: ${item.qty}</div>
        </div>`;
      container.appendChild(div);
    }
    notif.style.display = 'block';
    setTimeout(()=>{ notif.style.display = 'none'; }, 2000);
  }

  function bindAddToCartButtons(){
    // Buttons should have data attributes or relate to a form with hidden variant id
    const buttons = document.querySelectorAll('[data-add-to-cart], .quick-add__submit, button[name="add"], button[data-action="add-to-cart"]');
    buttons.forEach(btn => {
      if(btn.__cartBound) return;
      btn.__cartBound = true;
      btn.addEventListener('click', (e)=>{
        e.preventDefault();
        try{
          const root = btn.closest('li, .grid__item, .card-wrapper, .product-card-wrapper, .card, [data-product-root]') || document;
          // Try to find a product id and details around the button
          let id = btn.getAttribute('data-variant-id') || btn.getAttribute('data-product-id');
          if(!id){
            const hiddenId = root.querySelector('input[name="id"], input.product-variant-id');
            if(hiddenId) id = hiddenId.value;
          }
          // Fallback: use product link href as a unique id for client-side cart when variant id is absent
          if(!id){
            const linkEl = root.querySelector('.card__heading a, a.full-unstyled-link[href*="/products/"], a[href*="/products/"]');
            if(linkEl) {
              id = linkEl.getAttribute('href') || linkEl.href || '';
            }
          }
          if(!id){
            log('debug', { action:'missing_id', btn });
            return;
          }
          const titleEl = root.querySelector('.card__heading a, .product__title, h1,h2,h3');
          let title = titleEl ? titleEl.textContent.trim() : 'Product';
          // Try price from data attributes on the button first, then nearby price element
          let price = 0;
          const btnPriceAttr = btn.getAttribute && (btn.getAttribute('data-price') || btn.dataset && btn.dataset.price);
          if(btnPriceAttr){
            const n = String(btnPriceAttr).replace(/[^0-9\.]/g,'');
            price = Number(n) || 0;
          } else {
            const priceEl = root.querySelector('[data-price], .price-item--regular, .price-item, .price-item--last');
            if(priceEl){
              const raw = priceEl.getAttribute('data-price') || priceEl.textContent || '';
              const n = String(raw).replace(/[^0-9\.]/g,'');
              price = Number(n) || 0;
            }
          }
          const imgEl = root.querySelector('img');
          let image = imgEl ? imgEl.getAttribute('src') : '';
          // allow button to provide explicit title/image overrides
          const btnTitle = btn.getAttribute && (btn.getAttribute('data-title') || btn.dataset && btn.dataset.title);
          if(btnTitle) title = btnTitle;
          const btnImage = btn.getAttribute && (btn.getAttribute('data-image') || btn.dataset && btn.dataset.image);
          if(btnImage) image = btnImage;

          addToCart({ id, title, price, image, qty: 1 });
          // if the control is an anchor linking to cart, or explicitly requests redirect,
          // follow the link so users land on the cart page after adding
          try{
            const href = btn.getAttribute && btn.getAttribute('href');
            const wantsRedirect = (btn.getAttribute && (btn.getAttribute('data-redirect') === 'cart' || btn.getAttribute('data-redirect-to-cart') === 'true')) || btn.dataset && (btn.dataset.redirect === 'cart' || btn.dataset.redirectToCart === 'true');
            if(href && href.toLowerCase().includes('cart')){
              // small delay to ensure localStorage is written and UI updates
              setTimeout(()=> {
                if(!getUser()){ window.location.href = './login.html?returnUrl=' + encodeURIComponent(href); }
                else { window.location.href = href; }
              }, 150);
            } else if (wantsRedirect) {
              setTimeout(()=> {
                if(!getUser()){ window.location.href = './login.html?returnUrl=' + encodeURIComponent('./cart.html'); }
                else { window.location.href = './cart.html'; }
              }, 150);
            }
          }catch(e){ /* ignore redirect errors */ }
        }catch(err){
          log('debug', { action:'add_error', error: String(err)});
        }
      });
    });
    log('debug', { action:'bound_buttons', count: buttons.length });
  }

  function renderCartPage(){
    const container = document.querySelector('#main-cart-items .js-contents');
    const totalsWrap = document.querySelector('#main-cart-footer .js-contents .totals__total-value');
    const checkoutBtn = document.getElementById('checkout');
    const isEmptyBlocks = document.querySelectorAll('#main-cart-footer, cart-items');
    const items = loadCart();

    if(!container) return;

    container.innerHTML = '';
    if(items.length === 0){
      const empty = document.querySelector('.cart__warnings');
      if(empty) empty.style.display = '';
      const placeholder = document.getElementById('cart-empty-placeholder');
      if(placeholder) placeholder.style.display = '';
      if(checkoutBtn) checkoutBtn.setAttribute('disabled','');
      isEmptyBlocks.forEach(el => el && el.classList.add('is-empty'));
    } else {
      const empty = document.querySelector('.cart__warnings');
      if(empty) empty.style.display = 'none';
      const placeholder = document.getElementById('cart-empty-placeholder');
      if(placeholder) placeholder.style.display = 'none';
      if(checkoutBtn) checkoutBtn.removeAttribute('disabled');
      isEmptyBlocks.forEach(el => el && el.classList.remove('is-empty'));

      const ul = document.createElement('ul');
      ul.className = 'cart-items-list';
      // Inject minimal responsive styles once
      if(!document.getElementById('cart-items-enhanced-styles')){
        const style = document.createElement('style');
        style.id = 'cart-items-enhanced-styles';
        style.textContent = `
          .cart-items-list{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:12px}
          .cart-item{display:flex;align-items:center;gap:12px;padding:12px;border:1px solid rgba(0,0,0,.08);border-radius:10px;background:#fff}
          .cart-item__media{flex:0 0 72px;width:72px;height:72px;border-radius:8px;overflow:hidden;background:#f7f7f7;display:flex;align-items:center;justify-content:center}
          .cart-item__media img{width:100%;height:100%;object-fit:cover}
          .cart-item__details{display:flex;flex-direction:column;gap:6px;flex:1 1 auto;min-width:0}
          .cart-item__name{font-weight:600;color:#111;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
          .cart-item__meta{display:flex;align-items:center;gap:10px;flex-wrap:wrap;color:#444}
          .cart-item__price{font-weight:600;color:#111}
          .cart-item__qty{display:flex;align-items:center;gap:8px;margin-left:auto}
          .cart-item__qty .qty-dec,.cart-item__qty .qty-inc{width:32px;height:32px;border:1px solid #ddd;border-radius:6px;background:#fff;cursor:pointer}
          .cart-item__qty .qty-input{width:56px;height:32px;padding:0 6px;border:1px solid #ddd;border-radius:6px;text-align:center}
          .cart-item__remove{margin-left:8px;background:transparent;border:0;color:#c0392b;cursor:pointer}
          @media (max-width: 599px){
            .cart-item{flex-wrap:wrap}
            .cart-item__qty{width:100%;justify-content:flex-end;margin-left:0}
          }
        `;
        document.head.appendChild(style);
      }

      items.forEach(item => {
        const li = document.createElement('li');
        li.className = 'cart-item';
        li.innerHTML = `
          <div class="cart-item__media">${item.image?`<img src="${item.image}" alt="${(item.title||'Item').replace(/"/g,'')}">`:''}</div>
          <div class="cart-item__details">
            <div class="cart-item__name">${item.title}</div>
            <div class="cart-item__meta">
              <span class="cart-item__price">${formatCurrency(item.price)}</span>
            </div>
            <div class="cart-item__qty">
              <button type="button" class="qty-dec" data-id="${item.id}" aria-label="Decrease quantity">-</button>
              <input type="number" min="1" value="${item.qty}" data-id="${item.id}" class="qty-input" aria-label="Quantity"/>
              <button type="button" class="qty-inc" data-id="${item.id}" aria-label="Increase quantity">+</button>
              <button type="button" class="cart-item__remove remove" data-id="${item.id}" aria-label="Remove item">Remove</button>
            </div>
          </div>`;
        ul.appendChild(li);
      });
      container.appendChild(ul);

      container.querySelectorAll('.qty-dec').forEach(b=> b.addEventListener('click',()=>{
        const id = b.getAttribute('data-id');
        const item = loadCart().find(x=>x.id===id);
        if(!item) return;
        updateQty(id, Math.max(1, (item.qty||1)-1));
      }));
      container.querySelectorAll('.qty-inc').forEach(b=> b.addEventListener('click',()=>{
        const id = b.getAttribute('data-id');
        const item = loadCart().find(x=>x.id===id);
        if(!item) return;
        updateQty(id, (item.qty||1)+1);
      }));
      container.querySelectorAll('.qty-input').forEach(inp=> inp.addEventListener('change',()=>{
        const id = inp.getAttribute('data-id');
        const val = Number(inp.value)||1;
        updateQty(id, Math.max(1, val));
      }));
      container.querySelectorAll('.remove').forEach(b=> b.addEventListener('click',()=>{
        const id = b.getAttribute('data-id');
        removeFromCart(id);
      }));
    }

    if(totalsWrap){
      totalsWrap.textContent = formatCurrency(cartTotal());
      // expose exact cents on totals element for external scripts/tests
      try{ totalsWrap.setAttribute('data-amount-cents', String(totalCents())); }catch(e){}
    }

    // Bind checkout button to redirect to pay.html with precise amount and payload
    try{
      const checkoutBtn = document.getElementById('checkout');
      if(checkoutBtn && !checkoutBtn.__checkoutBound){
        checkoutBtn.__checkoutBound = true;
        checkoutBtn.addEventListener('click', (ev)=>{
          ev.preventDefault();
          if(!getUser()){ window.location.href = './login.html?returnUrl=' + encodeURIComponent(window.location.pathname + window.location.search); return; }
          const cents = totalCents();
          const items = loadCart().map(i => ({ id: i.id, title: i.title, qty: Number(i.qty||0), price_cents: Math.round(Number(i.price||0)*100) }));
          const params = new URLSearchParams();
          params.set('amount_cents', String(cents));
          params.set('amount', (cents/100).toFixed(2));
          params.set('currency', 'INR');
          try{ params.set('items', JSON.stringify(items)); }catch(e){}
          // allow optional redirect hooks via data attributes on the button
          const success = checkoutBtn.getAttribute('data-success-url') || checkoutBtn.dataset.successUrl;
          const cancel = checkoutBtn.getAttribute('data-cancel-url') || checkoutBtn.dataset.cancelUrl;
          if(success) params.set('success_url', success);
          if(cancel) params.set('cancel_url', cancel);

          // navigate to pay page relative to current location
          const target = './pay.html?' + params.toString();
          window.location.href = target;
        });
      }
    }catch(e){ log('debug', { action:'bind_checkout_error', error: String(e) }); }

    updateCartBadge();
    log('debug', { action:'render_cart', items: items.length, total: cartTotal() });
  }

  function init(){
    updateCartBadge();
    bindAddToCartButtons();
    renderCartPage();

    // Make header cart icon clickable and navigate to cart page
    try{
      const headerCart = document.getElementById('cart-icon-bubble');
      if(headerCart && !headerCart.__cartClickBound){
        headerCart.__cartClickBound = true;
        headerCart.style.cursor = 'pointer';
        headerCart.addEventListener('click', ()=> {
          if(!getUser()){ window.location.href = './login.html?returnUrl=' + encodeURIComponent('./cart.html'); }
          else { window.location.href = './cart.html'; }
        });
      }
    }catch(e){ /* ignore */ }

    // Observe DOM changes to bind buttons dynamically
    if('MutationObserver' in window){
      const obs = new MutationObserver(()=> bindAddToCartButtons());
      obs.observe(document.documentElement, { childList: true, subtree: true });
      log('debug', { action:'observer_attached' });
    }
  }

  if(document.readyState === 'loading'){
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  // expose minimal API for future integration if needed
  window.SpicyCart = { loadCart, addToCart, removeFromCart, updateQty, renderCartPage };
})();
