// Drag and Drop Logic for AppBuilder
// Handles dropping APIs and data into the page editor

// Basic HTML escape for mirror content
function escapeHtml(s){
  if(s === null || s === undefined) return '';
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
}

// Helper function to get caret position from coordinates
// Helper: compute caret index from client coordinates for a textarea using a mirror div.
function getCaretIndexFromCoords(textarea, clientX, clientY) {
  try {
    const rect = textarea.getBoundingClientRect();
    const x = clientX - rect.left;
    const y = clientY - rect.top;

    const value = textarea.value || '';
    const len = value.length;

    // Create a mirror div with same styles (cached per textarea by dataset)
    let mirror = document.getElementById('textarea-caret-mirror');
    if (!mirror) {
      mirror = document.createElement('div');
      mirror.id = 'textarea-caret-mirror';
      document.body.appendChild(mirror);
    }
    const style = getComputedStyle(textarea);
    const props = ['font-size','font-family','font-weight','line-height','padding','padding-top','padding-left','padding-right','padding-bottom','border-left-width','border-top-width','border-right-width','border-bottom-width','box-sizing','white-space','word-wrap','width','letter-spacing','text-transform'];
    mirror.style.position = 'absolute';
    mirror.style.visibility = 'hidden';
    mirror.style.whiteSpace = 'pre-wrap';
    mirror.style.wordWrap = 'break-word';
    mirror.style.boxSizing = style.boxSizing;
    mirror.style.width = rect.width + 'px';
    mirror.style.padding = style.padding;
    mirror.style.left = '-9999px';
    mirror.style.top = '-9999px';
    mirror.style.fontFamily = style.fontFamily;
    mirror.style.fontSize = style.fontSize;
    mirror.style.lineHeight = style.lineHeight;
    mirror.style.letterSpacing = style.letterSpacing;

    // Binary search for the index whose caret position is closest to x,y
    let lo = 0, hi = len, best = 0;
    while (lo <= hi) {
      const mid = Math.floor((lo + hi) / 2);
      const before = escapeHtml(value.slice(0, mid));
      const after = escapeHtml(value.slice(mid));
      mirror.innerHTML = before + '<span id="__caret_marker__">|</span>' + after;
      const marker = mirror.querySelector('#__caret_marker__');
      if (!marker) break;
      const mrect = marker.getBoundingClientRect();
      // marker positions are relative to body; compute relative to textarea rect
      const mx = mrect.left - rect.left;
      const my = mrect.top - rect.top;
      // If marker is above target y, move right; if below, move left
      if (my < y || (Math.abs(my - y) < 3 && mx < x)) {
        best = mid;
        lo = mid + 1;
      } else {
        hi = mid - 1;
      }
    }
    // cleanup marker content
    mirror.innerHTML = '';
    return best;
  } catch (e) {
    try { return textarea.selectionStart || 0; } catch (er) { return 0; }
  }
}

document.addEventListener('DOMContentLoaded', function() {
// DragDrop module loaded

  // Store last request/response from REST client for drag-and-drop
  window.lastRestClientData = {};
  window.addEventListener('message', function(event) {
    if (event.data && event.data.type === 'rest-client-result') {
      window.lastRestClientData = event.data;
    }
  });

  // Drag-and-drop logic for page editor
  const editorEl = qs('#pageEditor');
  if(editorEl){
    // debug: capture dragstart types for troubleshooting
    document.addEventListener('dragstart', function(ev){
      try { console.debug('dragstart', { types: ev.dataTransfer && ev.dataTransfer.types ? Array.from(ev.dataTransfer.types) : null }); } catch(e){}
    });

    // compute drop index on dragover so the caret feels responsive
    // preserve scroll position while measuring to avoid jumps
    let _lastDropIndex = null;
    editorEl.addEventListener('dragover', e=>{
      e.preventDefault();
      try{
        const prevScrollTop = editorEl.scrollTop;
        const prevScrollLeft = editorEl.scrollLeft;
        _lastDropIndex = getCaretIndexFromCoords(editorEl, e.clientX, e.clientY);
        // restore scroll to avoid browser repositioning
        editorEl.scrollTop = prevScrollTop;
        editorEl.scrollLeft = prevScrollLeft;
      }catch(err){ _lastDropIndex = editorEl.selectionStart || 0; }
    });

    editorEl.addEventListener('drop', (e)=>{
      e.preventDefault();

      // Get drop data
      var types = null;
      try { types = e.dataTransfer && e.dataTransfer.types ? Array.from(e.dataTransfer.types) : null; } catch(e) { types = null; }
      const jsonData = e.dataTransfer.getData('application/json');
      const textData = e.dataTransfer.getData('text/plain');

      let payload = null;
      if(jsonData){
        try {
          payload = JSON.parse(jsonData);
        } catch(err) {
          payload = null;
        }
      }

      // Debug what was received
      try { console.debug('drop received', { types: types, jsonDataSample: jsonData && jsonData.slice ? jsonData.slice(0,200) : jsonData, textDataSample: textData && textData.slice ? textData.slice(0,200) : textData, parsedPayload: payload }); } catch(e) {}

      // Compute drop position (use last computed index as fallback)
      let dropIndex = _lastDropIndex;
      try{ dropIndex = getCaretIndexFromCoords(editorEl, e.clientX, e.clientY); }catch(err){ dropIndex = dropIndex || editorEl.selectionStart || 0; }
      const start = dropIndex;
      const end = editorEl.selectionEnd || start;
      const val = editorEl.value;

      // Handle API drops
      if(payload?.apiName){
        const method = (payload.method||'GET').toUpperCase();
        const apiName = payload.apiName;

        // Use stored sample data from API definition
        if(!payload.sample){
          try {
            if(selectedSite?.apis){
              const apiDef = selectedSite.apis.find(a=>a.name===apiName);
              if(apiDef?.bodyTemplate){
                payload.sample = typeof apiDef.bodyTemplate === 'string' ? JSON.parse(apiDef.bodyTemplate) : apiDef.bodyTemplate;
              }
            }
          } catch(err) {
            // Sample not available or invalid, continue without it
          }
        }

        let componentHtml = '';

        if(method === 'GET'){
          try {
            componentHtml = window.TemplateGenerators.generateGetComponent(payload);
          } catch(genErr) {
            console.error('generateGetComponent error', genErr);
            componentHtml = `<div>GET ${apiName} component</div>`;
          }
          try { console.debug('Generated GET componentHtml (preview)', componentHtml && componentHtml.slice ? componentHtml.slice(0,300) : componentHtml); } catch(e){}
          showMessage(`Inserted loop for ${apiName}. Edit the content inside the loop-item div to display data.`, 'Loop inserted');

        } else if(method === 'POST' || method === 'PUT' || method === 'PATCH'){
          // Always use simple form generation - let users use Form Builder button for complex forms
          componentHtml = window.TemplateGenerators.generatePostComponent(payload);
          showMessage(`Inserted form for ${apiName}`, 'Form inserted');

        } else if(method === 'DELETE'){
          componentHtml = window.TemplateGenerators.generateDeleteComponent(payload);
          showMessage(`Inserted DELETE button for ${apiName} with confirmation.`, 'Button inserted');

        } else {
          componentHtml = window.TemplateGenerators.generateOtherComponent(payload);
          showMessage(`Inserted ${method} button for ${apiName}.`, 'Button inserted');
        }

        try { console.debug('Inserting generated HTML at', start, 'length', componentHtml && componentHtml.length); } catch(e){}
        // Insert the generated component HTML
        const newVal = val.slice(0,start) + componentHtml + val.slice(end);
        // preserve scroll, insert, then restore scroll and set caret
        const prevScrollTop = editorEl.scrollTop;
        const prevScrollLeft = editorEl.scrollLeft;
        editorEl.value = newVal;
        const pos = start + componentHtml.length;
        try { editorEl.selectionStart = editorEl.selectionEnd = pos; } catch(e) {}
        editorEl.scrollTop = prevScrollTop;
        editorEl.scrollLeft = prevScrollLeft;
        try { console.debug('Editor content after insert (preview)', editorEl.value && editorEl.value.slice ? editorEl.value.slice(Math.max(0,start-80), start+Math.min(300, componentHtml.length)) : null); } catch(e){}

        // Save page mapping for API usage tracking
        if (selectedSite && qs('#pageSelect')) {
          const currentPage = qs('#pageSelect').value;
          if (currentPage) {
            savePageMapping(currentPage, apiName, method, componentHtml);
          }
        }

        return;
      }

      // Handle field/value drops
      if(payload?.type){
        const fullPath = payload.apiPath;
        const before = val.slice(0, start);
        const lastOpen = before.lastIndexOf('{{#each');
        const lastClose = before.lastIndexOf('{{/each}}');
        const insideLoop = lastOpen > lastClose;
        let insertText = '';
        if(insideLoop){
          const parts = fullPath.split('.');
          const field = parts[parts.length-1];
          insertText = `{{this.${field}}}`;
        } else {
          insertText = `{{${fullPath}}}`;
        }
        try { console.debug('Inserting field/value snippet', insertText); } catch(e){}
        const newVal = val.slice(0,start) + insertText + val.slice(end);
        const prevScrollTop = editorEl.scrollTop;
        const prevScrollLeft = editorEl.scrollLeft;
        editorEl.value = newVal;
        const pos = start + insertText.length;
        try { editorEl.selectionStart = editorEl.selectionEnd = pos; } catch(e) {}
        editorEl.scrollTop = prevScrollTop;
        editorEl.scrollLeft = prevScrollLeft;
        return;
      }

      // Fallback: insert plain text
      const fallback = jsonData || textData || '';
      try { console.debug('Fallback inserting plain text (preview)', fallback && fallback.slice ? fallback.slice(0,200) : fallback); } catch(e){}
      const prevScrollTop = editorEl.scrollTop;
      const prevScrollLeft = editorEl.scrollLeft;
      editorEl.value = val.slice(0,start) + fallback + val.slice(end);
      const pos = start + fallback.length;
      try { editorEl.selectionStart = editorEl.selectionEnd = pos; } catch(e) {}
      editorEl.scrollTop = prevScrollTop;
      editorEl.scrollLeft = prevScrollLeft;
    });
  }
});

// Save page mapping when API is used in a page
function savePageMapping(page, apiName, method, componentHtml) {
  // Extract basic field mappings from the component HTML
  const fieldMappings = {};
  let submitSelector = null;

  // Parse the HTML to find form inputs and submit button
  const parser = new DOMParser();
  const doc = parser.parseFromString(componentHtml, 'text/html');
  
  // Find input fields
  const inputs = doc.querySelectorAll('input[name], textarea[name], select[name]');
  inputs.forEach(input => {
    const name = input.getAttribute('name');
    if (name) {
      fieldMappings[name] = `[name="${name}"]`;
    }
  });

  // Find submit button
  const submitBtn = doc.querySelector('input[type="submit"], button[type="submit"], button:not([type])');
  if (submitBtn) {
    if (submitBtn.id) {
      submitSelector = `#${submitBtn.id}`;
    } else if (submitBtn.className) {
      submitSelector = `.${submitBtn.className.split(' ')[0]}`;
    } else {
      submitSelector = submitBtn.tagName.toLowerCase();
      if (submitBtn.type) submitSelector += `[type="${submitBtn.type}"]`;
    }
  }

  // Save the mapping
  fetch(`/api/sites/${encodeURIComponent(selectedSite.name)}/page-mappings`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      page,
      apiName,
      method,
      fieldMappings,
      submitSelector
    })
  })
  .then(response => response.json())
  .then(data => {
    console.log('Page mapping saved:', data);
  })
  .catch(error => {
    console.error('Error saving page mapping:', error);
  });
}