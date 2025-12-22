// Custom Builder Logic for AppBuilder
// Handles page editing, drag-and-drop, and related functionality

document.addEventListener('DOMContentLoaded', () => {
  const qs = (s, el=document) => el.querySelector(s);

  // Utility function to escape HTML
  function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  // Top-level state
  let sites = [];
  let selectedSite = null;

  function showMessage(text, title = 'Notice'){
    // Prefer top-bar notifications for non-blocking UX when available
    try{
      if(window.AppUtils && AppUtils.Notify){
        const titleType = (title||'').toLowerCase();
        if(titleType.includes('error') || titleType.includes('invalid')) {
          AppUtils.Notify.error(escapeHtml(text));
          return;
        }
        if(titleType.includes('saved') || titleType.includes('bound') || titleType.includes('success')) {
          AppUtils.Notify.success(escapeHtml(text));
          return;
        }
        AppUtils.Notify.info(escapeHtml(text));
        return;
      }
    }catch(e){ /* ignore and fallback */ }

    // fallback to modal if available, else alert
    if(window.AppUtils && AppUtils.Modal){
      AppUtils.Modal.show({ title, body: escapeHtml(text) });
    } else {
      // eslint-disable-next-line no-alert
      alert(text);
    }
  }

  // Load selected site from sessionStorage
  function loadSelectedSite() {
    try {
      const siteData = sessionStorage.getItem('selectedSite');
      if (siteData) {
        const site = JSON.parse(siteData);
        // Load all sites first, then select this one
        loadSites(true).then(() => {
          selectSite(site.name);
        });
      } else {
        // Load all sites and select first one
        loadSites();
      }
    } catch (e) {
      console.error(e);
      showMessage('Failed to load site data.', 'Error');
    }
  }

  async function api(path, options={}) {
    const res = await fetch(path, options);
    const ct = (res.headers.get('content-type')||'').toLowerCase();
    const result = { status: res.status, headers: res.headers };
    if(ct.includes('application/json')) {
      result.body = await res.json();
    } else {
      result.body = await res.text();
    }
    return result.body;
  }

  async function loadSites(skipAutoSelect){
    try{ sites = await api('/api/sites') || []; }catch(e){ console.error(e); sites = []; }
    await renderSiteList();
    // auto-select first site if none selected
    if(!skipAutoSelect) {
      if(!selectedSite && sites && sites.length>0){
        await selectSite(sites[0].name);
      }
    }
  }

  function renderSiteList(){
    const ul = qs('#siteList'); if(!ul) return;
    ul.innerHTML = '';
    sites.forEach(s => {
      const li = document.createElement('li');
      li.textContent = s.name;
      li.style.display = 'flex'; li.style.justifyContent = 'space-between'; li.style.alignItems = 'center';
      // clicking the list item opens the site
      li.addEventListener('click', ()=> selectSite(s.name));
      if(selectedSite && selectedSite.name === s.name) li.classList.add('active');
      ul.appendChild(li);
    });
  }

  async function selectSite(name){
    try {
      selectedSite = await api(`/api/sites/${name}`) || null;
      window.selectedSite = selectedSite;
      await renderSiteList();
      await renderSiteDetails();
      // After rendering site details, automatically open the first HTML page (if any)
      try {
        // Fetch site tree and find first .html file
        const tree = await api(`/api/sites/${name}/tree`);
        function findFirstHtml(nodeList) {
          if(!nodeList || !nodeList.length) return null;
          for(const n of nodeList) {
            if(n.type === 'file' && typeof n.name === 'string' && n.name.toLowerCase().endsWith('.html')) return n.path;
            if(n.type === 'dir' && Array.isArray(n.children)) {
              const found = findFirstHtml(n.children);
              if(found) return found;
            }
          }
          return null;
        }

        const firstPagePath = findFirstHtml(tree || []);
        if(firstPagePath) {
          // only load if editor isn't already showing a page
          const editor = document.querySelector('#pageEditor');
          if(editor && !editor.getAttribute('data-current-page')) {
            await loadPageIntoEditor(firstPagePath, name);
          }
        }
      } catch (e) {
        // ignore failures to auto-open page
      }
      showMessage(`Selected site: ${name}`, 'Success');
    } catch(e) {
      console.error('Failed to select site:', e);
      showMessage(`Failed to load site: ${name}. Some features may not work.`, 'Error');
      selectedSite = null;
      window.selectedSite = null;
      await renderSiteList();
      await renderSiteDetails();
    }
  }

  // Beautify and unminify HTML content for better readability in editor
  function getFormatOptions() {
    // Read user preference from control if present, otherwise defaults
    const sel = document.getElementById('formatIndentSelect');
    const val = sel ? sel.value : '2';
    if (val === 'tab') {
      return { indent_with_tabs: true, indent_size: 1, indent_char: '\t' };
    }
    const size = parseInt(val, 10) || 2;
    return { indent_with_tabs: false, indent_size: size, indent_char: ' ' };
  }

  function beautifyHtml(html, opts) {
    try {
      // First, unminify the HTML by adding strategic whitespace
      let unminified = html
        // Add newlines after closing tags
        .replace(/(<\/[^>]+>)([^\s<])/g, '$1\n$2')
        // Add newlines before opening tags (but not inline elements)
        .replace(/([^\s>])(<(?!\/)[a-z])/gi, '$1\n$2')
        // Add newlines around block-level elements
        .replace(/(<\/?(?:div|section|article|header|footer|nav|main|aside|ul|ol|li|table|thead|tbody|tr|td|th|form|fieldset|button|h[1-6]|p|blockquote|pre|dl|dt|dd)[^>]*>)/gi, '\n$1\n')
        // Clean up multiple newlines
        .replace(/\n{3,}/g, '\n\n')
        .trim();

      // Try js-beautify html_beautify for excellent HTML formatting
      if (typeof window.html_beautify === 'function') {
        const userOpts = getFormatOptions();
        const defaults = {
          indent_size: 2,
          indent_char: ' ',
          indent_with_tabs: false,
          eol: '\n',
          end_with_newline: true,
          indent_level: 0,
          preserve_newlines: false,
          max_preserve_newlines: 1,
          space_in_empty_paren: false,
          jslint_happy: false,
          space_after_anon_function: false,
          space_after_named_function: false,
          brace_style: 'collapse',
          unformatted: [],
          indent_inner_html: true,
          indent_scripts: 'keep',
          wrap_line_length: 0,
          wrap_attributes: 'auto',
          wrap_attributes_indent_size: 2,
          indent_handlebars: true,
          inline: [],
          void_elements: ['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'param', 'source', 'track', 'wbr'],
          content_unformatted: ['pre', 'textarea', 'script', 'style'],
          extra_liners: ['head', 'body', '/html'],
          templating: ['handlebars']
        };
        const finalOpts = Object.assign({}, defaults, userOpts, opts || {});
        return window.html_beautify(unminified, finalOpts);
      }
      
      // Fallback: enhanced formatting
      const formatted = unminified
        .replace(/>\s*</g, '>\n<') // Add newlines between tags
        .split('\n')
        .map(line => line.trim())
        .filter(line => line.length > 0)
        .join('\n');
      
      // Enhanced indentation with proper handling
      let level = 0;
      const lines = formatted.split('\n');
      const result = [];
      const selfClosing = /^<(?:area|base|br|col|embed|hr|img|input|link|meta|param|source|track|wbr)[^>]*\/?>/i;
      const inline = /^<\/?(?:a|abbr|acronym|b|bdo|big|cite|code|dfn|em|i|kbd|mark|q|s|samp|small|span|strike|strong|sub|sup|tt|u|var)/i;
      
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        const trimmed = line.trim();
        
        // Decrease indent for closing tags
        if (trimmed.startsWith('</') && !inline.test(trimmed)) {
          level = Math.max(0, level - 1);
        }
        
        // Add indented line
        result.push('  '.repeat(level) + trimmed);
        
        // Increase indent for opening tags (not self-closing, not inline)
        if (trimmed.startsWith('<') && 
            !trimmed.startsWith('</') && 
            !trimmed.endsWith('/>') &&
            !selfClosing.test(trimmed) &&
            !inline.test(trimmed) &&
            !trimmed.includes('</')) {
          level++;
        }
      }
      
      return result.join('\n');
      
    } catch (e) {
      console.warn('HTML beautification failed:', e);
      return html; // Return original content if beautification fails
    }
  }

  async function loadPageIntoEditor(path, siteName) {
    try {
      const content = await api(`/api/sites/${siteName}/pages/content?path=${encodeURIComponent(path)}`);
      const editor = qs('#pageEditor');
      if(editor) editor.setAttribute('data-current-page', path);
      // If it's a markdown file, set markdown mode and format with Prettier if available
      const isMd = typeof path === 'string' && path.toLowerCase().endsWith('.md');
      if (editor) {
        if (isMd) {
          if (editorCm) try { editorCm.setOption('mode', 'markdown'); } catch(e) {}
          try {
            if (window.prettier && window.prettierPlugins) {
              const indent = getFormatOptions();
              const useTabs = !!indent.indent_with_tabs;
              const tabWidth = (indent.indent_size && indent.indent_size > 0) ? indent.indent_size : 2;
              const formatted = window.prettier.format(content, { parser: 'markdown', plugins: window.prettierPlugins, tabWidth, useTabs });
              editor.value = formatted;
            } else {
              editor.value = content;
            }
          } catch (e) { editor.value = content; }
        } else {
          if (editorCm) try { editorCm.setOption('mode', 'htmlmixed'); } catch(e) {}
          try { editor.value = beautifyHtml(content); } catch(e) { editor.value = content; }
        }
      }
      const preview = qs('#previewLink');
      if(preview) preview.href = `/site/${siteName}/${encodePathForUrl(path)}`;
      const previewFrame = qs('#previewFrame');
      if(previewFrame) {
        try {
          // Prefer server-rendered HTML so preview matches production rendering
          try {
            // encode each path segment but preserve slashes so Express wildcard matching works
            const encodePathForUrl = (p) => p.split('/').map(encodeURIComponent).join('/');
            const resp = await fetch(`/site/${encodeURIComponent(siteName)}/${encodePathForUrl(path)}?t=${Date.now()}`);
            const rendered = await resp.text();
            previewFrame.srcdoc = sanitizeHtmlForPreview(rendered || '');
          } catch (e) {
              // fallback: try client-side render + sanitize
            try {
              const rendered = await renderTemplateForPreviewAsync(content || '', window.latestAggregatedData || {});
              previewFrame.srcdoc = sanitizeHtmlForPreview(rendered || '');
            } catch (e2) {
              previewFrame.srcdoc = sanitizeHtmlForPreview(content || '');
            }
          }
        } catch (e) {
            try { previewFrame.src = `/site/${siteName}/${encodePathForUrl(path)}`; } catch(_) {}
        }
      }
    } catch(e) {
      showMessage('Could not load page content', 'Error');
      console.error(e);
    }
  }

  // Render file tree node
  function renderFileTreeNode(node, parentEl) {
    const nodeEl = document.createElement('div');
    nodeEl.className = 'sf-node ' + (node.type === 'dir' ? 'fm-dir' : 'fm-file');
    nodeEl.style.padding = '4px 6px';
    nodeEl.style.cursor = 'pointer';
    nodeEl.title = node.path;

    // helper to set selection
    function setSelectedFile(el, nd) {
      try {
        if(window.__currentSelectedFileEl && window.__currentSelectedFileEl !== el) {
          window.__currentSelectedFileEl.classList.remove('selected');
        }
        el.classList.add('selected');
        window.__currentSelectedFileEl = el;
        // update siteActions area with selected info
        const info = qs('#siteActions');
        if(info) {
          const typeLabel = nd.type === 'dir' ? 'Folder' : 'File';
          const ext = (nd.name && nd.name.split('.').length>1) ? nd.name.split('.').pop().toLowerCase() : '';
          const kind = nd.type === 'dir' ? 'Folder' : (['png','jpg','jpeg','gif','svg','webp','avif','ico'].includes(ext) ? 'Image' : (ext || 'file'));
          info.textContent = `Selected: ${nd.path} — ${typeLabel} (${kind})`;
        }
      } catch(e) { /* ignore */ }
    }

    if(node.type === 'dir'){
      const label = document.createElement('div');
      label.className = 'sf-dir-label';
      label.style.fontWeight='600';
      label.style.display = 'flex';
      label.style.alignItems = 'center';
      label.style.gap = '8px';

      const caret = document.createElement('span'); caret.className = 'sf-caret'; caret.textContent = '▸'; caret.style.width='18px';
      const icon = document.createElement('span'); icon.className = 'file-icon file-icon-folder'; icon.innerHTML = '📁';
      const text = document.createElement('span'); text.textContent = node.name;

      label.appendChild(caret);
      label.appendChild(icon);
      label.appendChild(text);

      const childrenWrap = document.createElement('div'); childrenWrap.style.marginLeft='12px'; childrenWrap.style.display = 'none';
      label.onclick = (ev)=>{ ev.stopPropagation(); childrenWrap.style.display = childrenWrap.style.display === 'none' ? 'block' : 'none'; caret.textContent = childrenWrap.style.display === 'none' ? '▸' : '▾'; setSelectedFile(nodeEl, node); };
      nodeEl.appendChild(label);
      nodeEl.appendChild(childrenWrap);
      (node.children||[]).forEach(ch=> renderFileTreeNode(ch, childrenWrap));
    } else {
      const fileRow = document.createElement('div');
      fileRow.style.display = 'flex'; fileRow.style.alignItems = 'center'; fileRow.style.gap = '8px';
      const ext = (node.name && node.name.split('.').length>1) ? node.name.split('.').pop().toLowerCase() : '';
      const icon = document.createElement('span');
      icon.className = 'file-icon ' + (['png','jpg','jpeg','gif','svg','webp','avif','ico'].includes(ext) ? 'file-icon-image' : (ext === 'html' || ext === 'htm' ? 'file-icon-html' : 'file-icon-generic'));
      icon.innerHTML = ['png','jpg','jpeg','gif','svg','webp','avif','ico'].includes(ext) ? '🖼️' : (ext === 'html' || ext === 'htm' ? '📄' : '📄');
      const nameSpan = document.createElement('span'); nameSpan.textContent = node.name; nameSpan.style.flex = '1'; nameSpan.style.overflow='hidden'; nameSpan.style.textOverflow='ellipsis'; nameSpan.style.whiteSpace='nowrap';
      fileRow.appendChild(icon); fileRow.appendChild(nameSpan);
      nodeEl.appendChild(fileRow);

      nodeEl.addEventListener('click', async (ev)=>{ ev.stopPropagation(); setSelectedFile(nodeEl, node); await loadPageIntoEditor(node.path, selectedSite.name); });
    }
    parentEl.appendChild(nodeEl);
  }

  async function renderSiteDetails() {
    if(!selectedSite) return;
    qs('#siteActions').textContent = `Selected: ${selectedSite.name}`;
    const preview = qs('#previewFrame'); if(preview){ /* do not auto-navigate iframe to live site for safety */ }
    const pl = qs('#previewLink'); if(pl) pl.href = `/site/${selectedSite.name}/`;

    // render full folder/file tree inside siteFileTree
    try{
      const tree = await api(`/api/sites/${selectedSite.name}/tree`);
      const container = qs('#siteFileTree'); if(container){
        container.innerHTML = '';
        (tree||[]).forEach(n=> renderFileTreeNode(n, container));
      }
      // populate page selector (if present) with a flattened list of pages
      try { if (typeof window.populatePageSelector === 'function') window.populatePageSelector(tree || []); } catch(pErr) { /* ignore */ }
    }catch(err){ 
      console.warn('could not load site tree', err); 
      const container = qs('#siteFileTree'); 
      if(container){
        container.innerHTML = '<div style="padding:16px;text-align:center;color:#64748b;font-style:italic;">Could not load file tree.<br>Site may have issues.</div>';
      }
      showMessage('Could not load site file tree. Some features may not work.', 'Warning');
    }

    try{
      const data = await api(`/api/sites/${selectedSite.name}/data`);
      latestAggregatedData = data || {};
      renderDataPalette(data || {});
    }catch(e){ 
      console.warn('could not load data palette', e); 
      latestAggregatedData = {};
      renderDataPalette({}); // Render empty palette
      showMessage('Could not load API data for palette. Some features may not work.', 'Warning');
    }
  }

  // Render data palette
  function renderDataPalette(data) {
    const container = qs('#dataPalette');
    if(!container) return;
    container.innerHTML = '';
    const meta = data?.__meta__ || {};

    // Check if we have any APIs
    const apiKeys = Object.keys(data || {}).filter(k => k !== '__meta__');
    if(apiKeys.length === 0) {
      container.innerHTML = '<div style="padding:16px;text-align:center;color:#64748b;font-style:italic;">No APIs configured for this site.<br>Add APIs in the admin panel to enable drag-and-drop components.</div>';
      return;
    }

    const renderNode = (key, nodeData, parentEl, fullPath, isRoot=false) => {
      const row = document.createElement('div');
      row.className = 'tree-node';
      const label = document.createElement('div');
      label.className = 'node-label';
      if(Array.isArray(nodeData)) label.classList.add('type-array');
      else if(nodeData && typeof nodeData === 'object') label.classList.add('type-object');
      else label.classList.add('type-value');
      const toggle = document.createElement('span');
      toggle.className = 'node-toggle';
      toggle.textContent = nodeData && (Array.isArray(nodeData) ? '▸' : (nodeData && typeof nodeData === 'object' ? '▸' : ''));
      label.appendChild(toggle);
      const text = document.createElement('span');
      text.className = 'node-text';
      function displaySample(v) {
        try {
          if(v === null) return 'null';
          if(v === undefined) return '';
          if(typeof v === 'object') return JSON.stringify(v);
          return String(v);
        } catch(e) { return String(v); }
      }
      let sampleText = '';
      if(nodeData !== null && nodeData !== undefined && !Array.isArray(nodeData) && typeof nodeData !== 'object') {
        sampleText = displaySample(nodeData);
      } else if(Array.isArray(nodeData)) {
        if(nodeData.length > 0) sampleText = displaySample(nodeData[0]);
      } else if(nodeData && typeof nodeData === 'object') {
        const keys = Object.keys(nodeData).slice(0,3);
        if(keys.length) sampleText = `{${keys.map(k => `${k}: ${displaySample(nodeData[k])}`).join(', ')}${Object.keys(nodeData).length > 3 ? ', …' : ''}}`;
      }
      const isTopLevelApi = isRoot || parentEl?.classList?.contains('tree-root');
      const keySpan = document.createElement('span');
      if(isTopLevelApi) {
        const method = meta[key]?.method?.toUpperCase() || '';
        if(method) {
          const methodIndicator = document.createElement('span');
          methodIndicator.className = 'method-inline';
          methodIndicator.textContent = method;
          methodIndicator.style.marginRight = '8px';
          methodIndicator.style.fontWeight = '700';
          methodIndicator.style.padding = '4px 6px';
          methodIndicator.style.borderRadius = '6px';
          if(['POST','PUT','PATCH','DELETE'].includes(method)) {
            methodIndicator.style.background = 'linear-gradient(90deg,#fee2e2,#fecaca)';
            methodIndicator.style.color = '#4a0b0b';
          } else {
            methodIndicator.style.background = 'linear-gradient(90deg,#dcfce7,#bbf7d0)';
            methodIndicator.style.color = '#07340f';
          }
          label.appendChild(methodIndicator);
        }
      }
      keySpan.textContent = key + (Array.isArray(nodeData) ? ' (array)' : (nodeData && typeof nodeData === 'object' ? ' (object)' : ''));
      label.appendChild(keySpan);

      if(isTopLevelApi && meta[key]) {
        const apiMeta = meta[key];
        const detailsBtn = document.createElement('button');
        detailsBtn.className = 'btn-icon-mini';
        detailsBtn.innerHTML = 'ⓘ';
        detailsBtn.title = 'Show API details';
        detailsBtn.style.marginLeft = 'auto';
        detailsBtn.onclick = (ev) => {
          ev.stopPropagation();
          const apiDef = selectedSite.apis.find(a => a.name === key);
          const sample = apiDef?.bodyTemplate || nodeData;
          showApiDetails(key, apiMeta, apiDef, sample);
        };
        label.appendChild(detailsBtn);
      }
      if(parentEl?.classList?.contains('tree-root')) {
        const methodMeta = meta[key] || {};
        const badge = document.createElement('span');
        badge.className = 'node-value-badge node-method-badge';
        const method = (methodMeta.method || '').toUpperCase();
        const status = methodMeta.status || '';
        // Determine success/failure from status or explicit flags
        let ok = false;
        if(typeof methodMeta.status === 'number') ok = methodMeta.status >= 200 && methodMeta.status < 300;
        else if(typeof methodMeta.status === 'string' && /^\d+$/.test(methodMeta.status)) ok = (parseInt(methodMeta.status,10) >= 200 && parseInt(methodMeta.status,10) < 300);
        else if(methodMeta.ok === true || methodMeta.success === true) ok = true;
        badge.textContent = method ? `${method}${status ? ` • ${status}` : ''}` : status || '';
        if(ok) badge.classList.add('status-success'); else badge.classList.add('status-fail');
        if(['POST','PUT','PATCH','DELETE'].includes(method)) badge.classList.add('method-create');
        else badge.classList.add('method-fetch');
        label.appendChild(badge);
        // also add a small status dot near the key for quick scanning
        try{
          const statusDot = document.createElement('span');
          statusDot.className = 'api-status-dot ' + (ok ? 'status-success' : 'status-fail');
          statusDot.title = status ? `Status: ${status}` : (ok ? 'OK' : 'Fail');
          // insert before the key text so it's visible at start
          label.insertBefore(statusDot, label.firstChild);
        }catch(e){}
      }
      if(sampleText) {
        const sampleSpan = document.createElement('span');
        sampleSpan.className = 'node-sample';
        sampleSpan.textContent = ` — ${sampleText}`;
        label.appendChild(sampleSpan);
      }

      label.draggable = true;
      label.addEventListener('dragstart', (e) => {
        const isTop = parentEl?.classList?.contains('tree-root');
        let payload = { apiPath: fullPath, type: Array.isArray(nodeData) ? 'array' : (nodeData && typeof nodeData === 'object' ? 'object' : 'value') };
        if(isTop) {
          const methodMeta = meta[key] || {};
          let sample = nodeData;
          if(Array.isArray(nodeData)) sample = nodeData.length > 0 ? nodeData[0] : {};
          const fields = (sample && typeof sample === 'object') ? Object.keys(sample) : [];
          let mappingConfig = null;
          try {
            if(selectedSite?.apis) {
              const apiDefinition = selectedSite.apis.find(a => a.name === key);
              if(apiDefinition?.mappingConfig) mappingConfig = apiDefinition.mappingConfig;
            }
          } catch(mappingError) {
            // Ignore mapping config errors
          }
          if(mappingConfig && Array.isArray(mappingConfig.fieldMappings) && mappingConfig.fieldMappings.length) {
            const mappedFields = mappingConfig.fieldMappings.map(fm => fm.requestField);
            let includeSample = null;
            try {
              const apiDefinition = selectedSite.apis.find(a => a.name === key);
              if(apiDefinition?.bodyTemplate) includeSample = apiDefinition.bodyTemplate;
            } catch(sampleError1) {
              // Ignore sample inclusion errors
            }
            payload = Object.assign(payload, { apiName: key, method: (methodMeta.method || 'GET').toUpperCase(), url: (methodMeta.url || ''), fields: mappedFields, mappingConfig, sample: includeSample });
          } else {
            let includeSample = null;
            try {
              const apiDefinition = selectedSite.apis.find(a => a.name === key);
              if(apiDefinition?.bodyTemplate) includeSample = apiDefinition.bodyTemplate;
            } catch(sampleError2) {
              // Ignore sample inclusion errors
            }
            payload = Object.assign(payload, { apiName: key, method: (methodMeta.method || 'GET').toUpperCase(), url: (methodMeta.url || ''), fields, sample: includeSample });
          }
        }
        // Debug logging removed for production
        e.dataTransfer.setData('application/json', JSON.stringify(payload));
        if(payload.type === 'array') e.dataTransfer.setData('text/plain', `{{#each ${fullPath}}}`);
        else e.dataTransfer.setData('text/plain', `{{${fullPath}}}`);
      });

      row.appendChild(label);
      parentEl.appendChild(row);

      if(nodeData && typeof nodeData === 'object') {
        const childrenWrap = document.createElement('div');
        childrenWrap.className = 'node-children';
        childrenWrap.style.display = 'none';
        row.appendChild(childrenWrap);
        toggle.style.cursor = 'pointer';
        toggle.onclick = (ev) => {
          ev.stopPropagation();
          childrenWrap.style.display = childrenWrap.style.display === 'none' ? 'block' : 'none';
          toggle.textContent = childrenWrap.style.display === 'none' ? '▸' : '▾';
        };

        if(Array.isArray(nodeData)) {
          if(nodeData.length > 0 && typeof nodeData[0] === 'object') {
            for(const k of Object.keys(nodeData[0])) {
              renderNode(k, nodeData[0][k], childrenWrap, `${fullPath}.${k}`, false);
            }
          }
        } else {
          for(const k of Object.keys(nodeData)) {
            renderNode(k, nodeData[k], childrenWrap, fullPath ? `${fullPath}.${k}` : k, false);
          }
        }
      }
    };

    container.classList.add('data-tree');
    container.innerHTML = '';
    for(const apiName of Object.keys(data || {})) {
      if(apiName === '__meta__') continue;
      const rootWrap = document.createElement('div');
      rootWrap.className = 'tree-root';
      renderNode(apiName, data[apiName], rootWrap, apiName, true);
      container.appendChild(rootWrap);
    }
  }

  // Show API details modal
  function showApiDetails(apiName, apiMeta, apiDef, responseData) {
    const method = (apiMeta.method || 'GET').toUpperCase();
    const url = apiMeta.url || apiDef?.url || '';
    const status = apiMeta.status || '';

    let responseFields = [];
    if(responseData && typeof responseData === 'object') {
      if(Array.isArray(responseData) && responseData.length > 0) {
        responseFields = Object.keys(responseData[0]).map(k => ({ name: k, type: typeof responseData[0][k], sample: responseData[0][k] }));
      } else {
        responseFields = Object.keys(responseData).map(k => ({ name: k, type: typeof responseData[k], sample: responseData[k] }));
      }
    }

    let requestFields = [];
    if(apiDef?.bodyTemplate) {
      try {
        const bodyObj = typeof apiDef.bodyTemplate === 'string' ? JSON.parse(apiDef.bodyTemplate) : apiDef.bodyTemplate;
        if(bodyObj && typeof bodyObj === 'object') {
          requestFields = Object.keys(bodyObj).map(k => ({ name: k, type: typeof bodyObj[k], sample: bodyObj[k] }));
        }
      } catch(parseError) {
        // Ignore parsing errors
      }
    }

    let queryParams = [];
    if(apiDef?.params) {
      queryParams = Object.keys(apiDef.params).map(k => ({ name: k, value: apiDef.params[k] }));
    }

    const methodDesc = {
      'GET': 'Fetches data from the server. Use for reading/displaying information.',
      'POST': 'Creates new resources. Use for submitting forms and creating data.',
      'PUT': 'Updates existing resources (full replacement). Use for editing complete records.',
      'PATCH': 'Partially updates resources. Use for modifying specific fields.',
      'DELETE': 'Removes resources. Use for delete operations with confirmation.',
      'OPTIONS': 'Queries available methods. Use for CORS preflight.',
      'HEAD': 'Fetches headers only. Use for checking resource existence.'
    };

    let html = `
      <div class="api-details-panel">
        <div class="detail-section">
          <h4>Overview</h4>
          <div class="detail-row"><strong>Method:</strong> <span class="method-badge method-${['POST','PUT','PATCH','DELETE'].includes(method) ? 'create' : 'fetch'}">${method}</span></div>
          <div class="detail-row"><strong>URL:</strong> <code>${escapeHtml(url)}</code></div>
          <div class="detail-row"><strong>Status:</strong> ${status}</div>
          <div class="detail-row"><em>${methodDesc[method] || 'HTTP method'}</em></div>
        </div>
    `;

    if(queryParams.length > 0) {
      html += `
        <div class="detail-section">
          <h4>Query Parameters</h4>
          <table class="detail-table">
            <thead><tr><th>Parameter</th><th>Value</th></tr></thead>
            <tbody>
              ${queryParams.map(p => `<tr><td><code>${escapeHtml(p.name)}</code></td><td>${escapeHtml(String(p.value))}</td></tr>`).join('')}
            </tbody>
          </table>
        </div>
      `;
    }

    if(requestFields.length > 0) {
      html += `
        <div class="detail-section">
          <h4>Request Body Fields</h4>
          <table class="detail-table">
            <thead><tr><th>Field</th><th>Type</th><th>Sample</th></tr></thead>
            <tbody>
              ${requestFields.map(f => `<tr><td><code>${escapeHtml(f.name)}</code></td><td>${f.type}</td><td>${escapeHtml(JSON.stringify(f.sample))}</td></tr>`).join('')}
            </tbody>
          </table>
        </div>
      `;
    }

    if(responseFields.length > 0) {
      html += `
        <div class="detail-section">
          <h4>Response Fields</h4>
          <table class="detail-table">
            <thead><tr><th>Field</th><th>Type</th><th>Sample</th></tr></thead>
            <tbody>
              ${responseFields.map(f => `<tr><td><code>${escapeHtml(f.name)}</code></td><td>${f.type}</td><td>${escapeHtml(JSON.stringify(f.sample))}</td></tr>`).join('')}
            </tbody>
          </table>
        </div>
      `;
    }

    html += `
        <div class="detail-section">
          <h4>Drag & Drop Hints</h4>
          <ul class="hint-list">
            ${method === 'GET' ? '<li>Drag to editor to create a <strong>display component</strong> (table/list/cards)</li>' : ''}
            ${['POST','PUT','PATCH'].includes(method) ? '<li>Drag to editor to create a <strong>form</strong> with inputs for all fields</li>' : ''}
            ${method === 'DELETE' ? '<li>Drag to editor to create a <strong>delete button</strong> with confirmation</li>' : ''}
            <li>Drag child fields to insert <code>{{placeholders}}</code></li>
          </ul>
        </div>
      </div>
    `;

    AppUtils.Modal.show({ title: `API: ${apiName}`, body: html });
  }

  // Drag-and-drop logic for page editor
  const editorEl = qs('#pageEditor');
  if(editorEl) {
    let _lastDropIndex = null;
    editorEl.addEventListener('dragover', e => {
      e.preventDefault();
      try {
        if (!editorCm) _lastDropIndex = editorEl.selectionStart || 0;
      } catch(err) { _lastDropIndex = 0; }
    });

    editorEl.addEventListener('drop', (e) => {
      e.preventDefault();

      const jsonData = e.dataTransfer.getData('application/json');
      const textData = e.dataTransfer.getData('text/plain');

      let payload = null;
      if(jsonData) {
        try { payload = JSON.parse(jsonData); } catch(err) { payload = null; }
      }

      // If CodeMirror is active, map drop point precisely using coordsChar
      if (editorCm) {
        let pos;
        try { pos = editorCm.coordsChar({ left: e.clientX, top: e.clientY }); } catch(err) { pos = editorCm.getCursor(); }

        // Helper to insert text at pos and place cursor after insertion
        function insertAtPos(text) {
          try {
            editorCm.replaceRange(text, pos);
            const startIndex = editorCm.indexFromPos(pos);
            const endPos = editorCm.posFromIndex(startIndex + (text ? text.length : 0));
            editorCm.setSelection(endPos, endPos);
            editorCm.scrollIntoView(endPos);
          } catch (e) {
            // best-effort fallback
            try { editorCm.setValue(editorCm.getValue() + text); } catch(_) {}
          }
        }

        // Insert generated component HTML for API drops
        if (payload?.apiName) {
          const method = (payload.method || 'GET').toUpperCase();
          const apiName = payload.apiName;

          if (!payload.sample) {
            try {
              if (selectedSite?.apis) {
                const apiDef = selectedSite.apis.find(a => a.name === apiName);
                if (apiDef?.bodyTemplate) payload.sample = typeof apiDef.bodyTemplate === 'string' ? JSON.parse(apiDef.bodyTemplate) : apiDef.bodyTemplate;
              }
            } catch (err) { /* ignore */ }
          }

          let componentHtml = '';
          try {
            if (method === 'GET') {
              var _gen = (window.TemplateGenerators && window.TemplateGenerators.generateGetComponent) ? window.TemplateGenerators.generateGetComponent(payload) : null;
              if (!_gen) _gen = '<div>GET ' + apiName + ' component</div>';
              if (typeof _gen === 'string' && _gen.indexOf('AB_TEMPLATE_GENERATOR_V2') === -1) componentHtml = '<!-- AB_TEMPLATE_MISSING -->' + _gen; else componentHtml = _gen;
              showMessage('Inserted loop for ' + apiName + '. Edit the content inside the loop-item div to display data.', 'Loop inserted');
            } else if (method === 'POST' || method === 'PUT' || method === 'PATCH') {
              componentHtml = window.TemplateGenerators?.generatePostComponent(payload) || `<form><p>${method} ${apiName} form</p><button type="submit">Submit</button></form>`;
              showMessage(`Inserted form for ${apiName}`, 'Form inserted');
            } else if (method === 'DELETE') {
              componentHtml = window.TemplateGenerators?.generateDeleteComponent(payload) || `<button>Delete ${apiName}</button>`;
              showMessage(`Inserted DELETE button for ${apiName} with confirmation.`, 'Button inserted');
            } else {
              componentHtml = window.TemplateGenerators?.generateOtherComponent(payload) || `<button>${method} ${apiName}</button>`;
              showMessage(`Inserted ${method} button for ${apiName}.`, 'Button inserted');
            }
          } catch (err) {
            console.error('Template generation failed:', err);
            componentHtml = `<div>Error generating ${method} component for ${apiName}</div>`;
            showMessage('Failed to generate component template', 'Error');
          }

          insertAtPos(componentHtml);

          const currentPage = document.getElementById('pageEditor')?.getAttribute('data-current-page');
          if (currentPage) savePageMapping(currentPage, apiName, method, componentHtml);
          return;
        }

        // For simple API field drops (inserting {{...}} placeholders)
        if (payload?.type) {
          const fullPath = payload.apiPath;
          const fullText = editorCm.getValue();
          const startIndex = editorCm.indexFromPos(pos);
          const before = fullText.slice(0, startIndex);
          const lastOpen = before.lastIndexOf('{{#each');
          const lastClose = before.lastIndexOf('{{/each}}');
          const insideLoop = lastOpen > lastClose;
          let insertText = '';
          if (insideLoop) {
            const parts = fullPath.split('.');
            const field = parts[parts.length - 1];
            insertText = `{{this.${field}}}`;
          } else {
            insertText = `{{${fullPath}}}`;
          }
          insertAtPos(insertText);
          return;
        }

        // Fallback insertion for plain text drags
        const insertText = jsonData || textData || '';
        if (insertText) insertAtPos(insertText);
        return;
      }

      // Non-CodeMirror fallback: keep existing textarea/mirror-based insertion logic
      // Determine insertion index. Prefer the textarea selection/caret if available.
      var dropIndex = null;
      try { dropIndex = editorEl.selectionStart; } catch (err) { dropIndex = null; }

      // If selectionStart is not available or not set, try to map mouse coordinates to a character
      if (dropIndex === null || dropIndex === undefined) {
        try {
          // Create a temporary mirror div positioned exactly over the textarea so caretRangeFromPoint can be used
          var rect = editorEl.getBoundingClientRect();
          var mirror = document.createElement('div');
          var cs = window.getComputedStyle(editorEl);
          mirror.style.position = 'absolute';
          mirror.style.left = (rect.left + window.scrollX) + 'px';
          mirror.style.top = (rect.top + window.scrollY) + 'px';
          mirror.style.width = rect.width + 'px';
          mirror.style.height = rect.height + 'px';
          mirror.style.whiteSpace = 'pre-wrap';
          mirror.style.wordWrap = 'break-word';
          mirror.style.overflow = 'hidden';
          mirror.style.padding = cs.padding;
          mirror.style.border = '0';
          mirror.style.margin = '0';
          mirror.style.font = cs.font || (cs.fontSize + ' ' + cs.fontFamily);
          mirror.style.lineHeight = cs.lineHeight;
          mirror.style.letterSpacing = cs.letterSpacing;
          mirror.style.boxSizing = 'border-box';
          mirror.style.color = 'transparent';
          mirror.style.background = 'transparent';
          mirror.style.zIndex = 999999;
          mirror.style.pointerEvents = 'none';

          mirror.textContent = editorEl.value || '';
          document.body.appendChild(mirror);

          var range = null;
          try {
            if (document.caretRangeFromPoint) {
              range = document.caretRangeFromPoint(e.clientX, e.clientY);
            } else if (document.caretPositionFromPoint) {
              const caretPos = document.caretPositionFromPoint(e.clientX, e.clientY);
              if (caretPos) {
                range = document.createRange();
                range.setStart(caretPos.offsetNode, caretPos.offset);
              }
            }
          } catch (err) { range = null; }

          if (range && range.startContainer) {
            var node = range.startContainer;
            var offsetInNode = range.startOffset || 0;
            function nodeCharIndex(n) {
              var sum = 0; var walker = document.createTreeWalker(mirror, NodeFilter.SHOW_TEXT, null, false); var cur;
              while ((cur = walker.nextNode())) { if (cur === n) break; sum += cur.nodeValue ? cur.nodeValue.length : 0; }
              return sum;
            }
            var base = 0;
            if (node.nodeType === Node.TEXT_NODE) base = nodeCharIndex(node);
            else {
              var walker2 = document.createTreeWalker(node, NodeFilter.SHOW_TEXT, null, false);
              var firstText = walker2.nextNode(); if (firstText) base = nodeCharIndex(firstText);
            }
            dropIndex = base + offsetInNode;
          } else {
            var relY = (e.clientY - rect.top);
            var ratio = 0; if (rect.height > 0) ratio = relY / rect.height; if (ratio < 0) ratio = 0; if (ratio > 1) ratio = 1;
            dropIndex = Math.floor(ratio * (editorEl.value ? editorEl.value.length : 0));
          }

          try { document.body.removeChild(mirror); } catch (err) { }
        } catch (err) { dropIndex = 0; }
      }

      if (typeof dropIndex !== 'number' || isNaN(dropIndex)) dropIndex = 0;
      if (dropIndex < 0) dropIndex = 0;
      if (dropIndex > (editorEl.value ? editorEl.value.length : 0)) dropIndex = editorEl.value ? editorEl.value.length : 0;

      const start = dropIndex;
      // If the user has an active selection, replace it; otherwise insert at the drop point
      const hasSelection = (typeof editorEl.selectionStart === 'number' && typeof editorEl.selectionEnd === 'number' && editorEl.selectionStart !== editorEl.selectionEnd);
      const end = hasSelection ? editorEl.selectionEnd : start;
      const val = editorEl.value;
      let pos = 0;

      if(payload?.apiName) {
        const method = (payload.method || 'GET').toUpperCase();
        const apiName = payload.apiName;
        if(!payload.sample) {
          try {
            if(selectedSite?.apis) {
              const apiDef = selectedSite.apis.find(a => a.name === apiName);
              if(apiDef?.bodyTemplate) payload.sample = typeof apiDef.bodyTemplate === 'string' ? JSON.parse(apiDef.bodyTemplate) : apiDef.bodyTemplate;
            }
          } catch(err) { }
        }

        let componentHtml = '';
        try {
          if(method === 'GET') {
            var _gen = (window.TemplateGenerators && window.TemplateGenerators.generateGetComponent) ? window.TemplateGenerators.generateGetComponent(payload) : null;
            if(!_gen) _gen = '<div>GET ' + apiName + ' component</div>';
            if (typeof _gen === 'string' && _gen.indexOf('AB_TEMPLATE_GENERATOR_V2') === -1) componentHtml = '<!-- AB_TEMPLATE_MISSING -->' + _gen; else componentHtml = _gen;
            showMessage('Inserted loop for ' + apiName + '. Edit the content inside the loop-item div to display data.', 'Loop inserted');
          } else if(method === 'POST' || method === 'PUT' || method === 'PATCH') {
            componentHtml = window.TemplateGenerators?.generatePostComponent(payload) || `<form><p>${method} ${apiName} form</p><button type="submit">Submit</button></form>`;
            showMessage(`Inserted form for ${apiName}`, 'Form inserted');
          } else if(method === 'DELETE') {
            componentHtml = window.TemplateGenerators?.generateDeleteComponent(payload) || `<button>Delete ${apiName}</button>`;
            showMessage(`Inserted DELETE button for ${apiName} with confirmation.`, 'Button inserted');
          } else {
            componentHtml = window.TemplateGenerators?.generateOtherComponent(payload) || `<button>${method} ${apiName}</button>`;
            showMessage(`Inserted ${method} button for ${apiName}.`, 'Button inserted');
          }
        } catch(err) { console.error('Template generation failed:', err); componentHtml = `<div>Error generating ${method} component for ${apiName}</div>`; showMessage('Failed to generate component template', 'Error'); }

        const newVal = val.slice(0, start) + componentHtml + val.slice(end);
        editorEl.value = newVal;
        pos = start + componentHtml.length;
        editorEl.selectionStart = editorEl.selectionEnd = pos;
        const editor = qs('#pageEditor'); const currentPage = editor ? editor.getAttribute('data-current-page') : null;
        if(currentPage) savePageMapping(currentPage, apiName, method, componentHtml);
        return;
      }

      if(payload?.type) {
        const fullPath = payload.apiPath;
        const before = val.slice(0, start);
        const lastOpen = before.lastIndexOf('{{#each');
        const lastClose = before.lastIndexOf('{{/each}}');
        const insideLoop = lastOpen > lastClose;
        let insertText = '';
        if(insideLoop) {
          const parts = fullPath.split('.');
          const field = parts[parts.length - 1];
          insertText = `{{this.${field}}}`;
        } else {
          insertText = `{{${fullPath}}}`;
        }
        const newVal = val.slice(0, start) + insertText + val.slice(end);
        editorEl.value = newVal;
        pos = start + insertText.length;
        editorEl.selectionStart = editorEl.selectionEnd = pos;
        return;
      }

      const fallback = jsonData || textData || '';
      editorEl.value = val.slice(0, start) + fallback + val.slice(end);
      pos = start + fallback.length;
      editorEl.selectionStart = editorEl.selectionEnd = pos;
    });
  }

  // Save page mapping
  function savePageMapping(page, apiName, method, componentHtml) {
    const fieldMappings = {};
    let submitSelector = null;

    const parser = new DOMParser();
    const doc = parser.parseFromString(componentHtml, 'text/html');

    const inputs = doc.querySelectorAll('input[name], textarea[name], select[name]');
    inputs.forEach(input => {
      const name = input.getAttribute('name');
      if(name) {
        fieldMappings[name] = `[name="${name}"]`;
      }
    });

    const submitBtn = doc.querySelector('input[type="submit"], button[type="submit"], button:not([type])');
    if(submitBtn) {
      if(submitBtn.id) {
        submitSelector = `#${submitBtn.id}`;
      } else if(submitBtn.className) {
        submitSelector = `.${submitBtn.className.split(' ')[0]}`;
      } else {
        submitSelector = submitBtn.tagName.toLowerCase();
        if(submitBtn.type) submitSelector += `[type="${submitBtn.type}"]`;
      }
    }

    fetch(`/api/sites/${selectedSite.name}/page-mappings`, {
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

  // Event handlers
  qs('#savePageBtn').addEventListener('click', async () => {
    if(!selectedSite) { showMessage('Select a site first', 'Error'); return; }
    const path = qs('#pageEditor').getAttribute('data-current-page') || 'index.html';
    if(!path) { showMessage('No page selected','Input required'); return; }
    const content = qs('#pageEditor').value;
    await fetch(`/api/sites/${selectedSite.name}/pages/save`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ path, content }) });
    showMessage('Saved', 'Saved');
    const pf = qs('#previewFrame');
    if(pf) {
      // update sandboxed preview with latest content. Try server-rendered HTML first
      try {
        try {
          const encodePathForUrl = (p) => p.split('/').map(encodeURIComponent).join('/');
          const resp = await fetch(`/site/${encodeURIComponent(selectedSite.name)}/${encodePathForUrl(path)}?t=${Date.now()}`);
          const rendered = await resp.text();
          pf.srcdoc = sanitizeHtmlForPreview(rendered || '');
        } catch (e) {
          try {
            const rendered = await renderTemplateForPreviewAsync(content || '', window.latestAggregatedData || {});
            pf.srcdoc = sanitizeHtmlForPreview(rendered || '');
          } catch (e2) {
            pf.srcdoc = sanitizeHtmlForPreview(content || '');
          }
        }
      } catch (e) {
        // Keep current src if update fails
      }
    }
    const pl = qs('#previewLink');
    if(pl) {
      pl.href = `/site/${selectedSite.name}/${encodePathForUrl(path)}?t=${Date.now()}`;
    }
  });

  qs('#previewRenderedBtn').addEventListener('click', () => {
    if(!selectedSite) { showMessage('No site selected', 'Error'); return; }
    const path = qs('#pageEditor').getAttribute('data-current-page') || 'index.html';
    window.open(`/site/${selectedSite.name}/${encodePathForUrl(path)}`, '_blank');
  });

  // Create new HTML page for selected site
  qs('#createPageBtn').addEventListener('click', async ()=>{
    if(!selectedSite){ showMessage('Select a site first','Error'); return; }
    let name = (qs('#newPageNameInput') && qs('#newPageNameInput').value.trim()) || '';
    if(!name) name = `new-page-${Date.now()}.html`;
    // ensure .html extension
    if(!name.toLowerCase().endsWith('.html')) name += '.html';
    const demo = '<!doctype html>\n<html><head><meta charset="utf-8" /><meta name="viewport" content="width=device-width,initial-scale=1" /><title>Demo Page</title><style>body{font-family:Inter,system-ui,Arial;background:#f8fafc;color:#0f1724;padding:24px}h1{color:#0b61ff}</style></head><body><h1>Demo Page</h1><p>This is a starter page. Drag variables from the palette into this content to bind API values.</p><div style="margin-top:18px;"><!-- Example placeholder: {{apiName.path}} --></div></body></html>';
    try{
      await fetch(`/api/sites/${selectedSite.name}/pages/save`, { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify({ path: name, content: demo }) });
      showMessage(`Created page: ${name}`, 'Saved');
      qs('#newPageNameInput').value = '';
      // refresh site details and open the new page in the editor
      await selectSite(selectedSite.name);
      await loadPageIntoEditor(name, selectedSite.name);
    }catch(e){ console.error(e); showMessage('Could not create page','Error'); }
  });

  qs('#openVisualEditor')?.addEventListener('click', () => openVisualEditor());

  qs('#openFieldMapper')?.addEventListener('click', () => {
    if(!selectedSite) { showMessage('No site selected', 'Error'); return; }
    const apis = selectedSite.apis || [];
    if(apis.length === 0) { showMessage('No APIs configured. Add an API first.', 'Notice'); return; }

    if(apis.length === 1) {
      showFieldMapper();
    } else {
      const options = apis.map(a => `<option value="${a.name}">${a.name} (${(a.method || 'GET').toUpperCase()})</option>`).join('');
      const html = `<div style="padding:12px"><label style="display:block;margin-bottom:8px;font-weight:600">Select API to map:</label><select id="fieldMapperApiSelect" style="width:100%;padding:10px;border-radius:8px;background:rgba(255,255,255,0.02);border:1px solid rgba(255,255,255,0.03)">${options}</select><button id="fieldMapperOpenBtn" class="btn" style="margin-top:12px;width:100%">Open Field Mapper</button></div>`;
      AppUtils.Modal.show({ title: 'Select API', body: html });
      setTimeout(() => {
        qs('#fieldMapperOpenBtn').onclick = () => {
          showFieldMapper();
        };
      }, 100);
    }
  });

  qs('#openFormBuilder')?.addEventListener('click', () => {
    if(!selectedSite) { showMessage('Select a site first', 'Error'); return; }
    const currentPage = qs('#pageEditor').getAttribute('data-current-page');
    if(!currentPage) { showMessage('Open a page first', 'Error'); return; }

    const apis = selectedSite.apis || [];
    if(apis.length === 0) { showMessage('No APIs configured. Add an API first.', 'Notice'); return; }

    if(apis.length === 1) {
      const apiDef = apis[0];
      openFormBuilderForAPI(apiDef, currentPage);
    } else {
      const options = apis.map(a => `<option value="${a.name}">${a.name} (${(a.method || 'GET').toUpperCase()})</option>`).join('');
      const html = `<div style="padding:12px"><label style="display:block;margin-bottom:8px;font-weight:600">Select API for Form Builder:</label><select id="formBuilderApiSelect" style="width:100%;padding:10px;border-radius:8px;background:rgba(255,255,255,0.02);border:1px solid rgba(255,255,255,0.03)">${options}</select><button id="formBuilderOpenBtn" class="btn" style="margin-top:12px;width:100%">Open Form Builder</button></div>`;
      AppUtils.Modal.show({ title: 'Select API', body: html });
      setTimeout(() => {
        qs('#formBuilderOpenBtn').onclick = () => {
          const sel = qs('#formBuilderApiSelect');
          const apiName = sel ? sel.value : apis[0].name;
          const apiDef = apis.find(a => a.name === apiName);
          openFormBuilderForAPI(apiDef, currentPage);
        };
      }, 100);
    }
  });

  qs('#backToAdmin')?.addEventListener('click', () => {
    window.location.href = '/admin';
  });

  // Placeholder functions for visual editor, field mapper, form builder
  function openVisualEditor() {
    showMessage('Visual Editor not implemented yet', 'Notice');
  }

  function showFieldMapper() {
    showMessage('Field Mapper not implemented yet', 'Notice');
  }

  function openFormBuilderForAPI(apiDef, pageName) {
    sessionStorage.setItem('formBuilderAPI', JSON.stringify({
      api: apiDef,
      method: apiDef.method || 'POST',
      siteName: selectedSite.name,
      page: pageName
    }));
    const formBuilderUrl = '/admin-static/form-builder.html';
    window.open(formBuilderUrl, '_blank');
    showMessage(`Opened form builder for ${apiDef.name} on page ${pageName}`, 'Form Builder opened');
  }

  // Initialize editor (CodeMirror if available) and then load sites
  let editorCm = null;
  function initEditor() {
    const el = document.getElementById('pageEditor');
    if(!el) return;
    // If CodeMirror is available, initialize it and augment the container
    if(window.CodeMirror) {
      try {
        editorCm = CodeMirror(el, {
          value: '',
          mode: 'htmlmixed',
          lineNumbers: true,
          lineWrapping: true,
          matchBrackets: true,
          autoCloseTags: true,
          theme: 'default',
          foldGutter: true,
          gutters: ["CodeMirror-linenumbers", "CodeMirror-foldgutter"]
        });

        // helper to convert pos <-> index
        function posToIndex(pos) {
          const txt = editorCm.getValue();
          const lines = txt.split('\n');
          let idx = 0;
          for (let i = 0; i < pos.line; i++) idx += lines[i].length + 1;
          idx += pos.ch;
          return idx;
        }
        function indexToPos(index) {
          const txt = editorCm.getValue();
          const lines = txt.split('\n');
          let remaining = index;
          for (let i = 0; i < lines.length; i++) {
            const lineLen = lines[i].length;
            if (remaining <= lineLen) return { line: i, ch: remaining };
            remaining -= (lineLen + 1);
          }
          const last = lines.length - 1;
          return { line: last, ch: lines[last].length };
        }

        // Ensure CodeMirror fills the `#pageEditor` element height and stays responsive
        try {
          // Compute fixed width from the host element so the editor width remains constant
          var hostEl = el; // #pageEditor element
          function applyEditorSize() {
            try {
              var hostW = (hostEl.clientWidth && hostEl.clientWidth > 0) ? hostEl.clientWidth : parseInt(getComputedStyle(hostEl).width, 10) || 760;
              editorCm.setSize(hostW + 'px', '100%');
              var w = editorCm.getWrapperElement && editorCm.getWrapperElement();
              if (w && w.style) w.style.height = '100%';
            } catch (err) { /* ignore */ }
          }
          // Initial sizing
          applyEditorSize();
          // Refresh on window resize and on container resizes
          try { window.addEventListener('resize', function () { applyEditorSize(); try { editorCm.refresh(); } catch(e){} }); } catch (e) {}
          // Observe changes to the pageEditor container (e.g., when controls toggle) and reapply
          try {
            var ro = new MutationObserver(function () { applyEditorSize(); try { editorCm.refresh(); } catch(e){} });
            ro.observe(hostEl, { attributes: true, childList: true, subtree: false });
          } catch (e) { /* ignore if MutationObserver not available */ }
        } catch (e) {
          // ignore if not available
        }

        // Define textarea-like properties on the container so existing code still works
        Object.defineProperty(el, 'value', { configurable: true, enumerable: true, get: () => editorCm.getValue(), set: (v) => editorCm.setValue(v) });
        Object.defineProperty(el, 'clientHeight', { configurable: true, enumerable: true, get: () => editorCm.getScrollInfo().clientHeight });
        Object.defineProperty(el, 'scrollHeight', { configurable: true, enumerable: true, get: () => editorCm.getScrollInfo().height });
        Object.defineProperty(el, 'scrollTop', { configurable: true, enumerable: true, get: () => editorCm.getScrollInfo().top, set: (v) => editorCm.scrollTo(null, v) });

        Object.defineProperty(el, 'selectionStart', { configurable: true, enumerable: true, get: () => {
          try {
            const sel = (editorCm.listSelections && editorCm.listSelections()[0]) || null;
            let a, b;
            if(sel) { a = sel.anchor; b = sel.head; }
            else { a = editorCm.getCursor(); b = a; }
            const ai = posToIndex(a); const bi = posToIndex(b);
            return Math.min(ai, bi);
          } catch(e) { return 0; }
        }});
        Object.defineProperty(el, 'selectionEnd', { configurable: true, enumerable: true, get: () => {
          try {
            const sel = (editorCm.listSelections && editorCm.listSelections()[0]) || null;
            let a, b;
            if(sel) { a = sel.anchor; b = sel.head; }
            else { a = editorCm.getCursor(); b = a; }
            const ai = posToIndex(a); const bi = posToIndex(b);
            return Math.max(ai, bi);
          } catch(e) { return 0; }
        }});

        el.setSelection = (start, end) => {
          try {
            const from = indexToPos(start);
            const to = indexToPos(end);
            editorCm.setSelection(from, to);
          } catch(e) {}
        };

        // map addEventListener for 'scroll' and 'input' to CodeMirror events
        const nativeAdd = el.addEventListener.bind(el);
        el.addEventListener = function (name, handler) {
          if (name === 'scroll') {
            editorCm.on('scroll', handler);
            return;
          }
          if (name === 'input') {
            editorCm.on('change', () => handler());
            return;
          }
          nativeAdd(name, handler);
        };

        // Bind Ctrl-Q to toggle fold (CodeMirror default pattern)
        editorCm.addKeyMap({
          'Ctrl-Q': function(cm) { cm.foldCode(cm.getCursor()); }
        });

        // Wire format button (uses existing beautifyHtml helper) if present
        const fmtBtn = document.getElementById('formatPageBtn');
        if(fmtBtn) {
          fmtBtn.addEventListener('click', () => {
            try {
              const cur = editorCm.getValue();
              const currentPage = (document.getElementById('pageEditor') && document.getElementById('pageEditor').getAttribute('data-current-page')) || '';
              const isMd = typeof currentPage === 'string' && currentPage.toLowerCase().endsWith('.md');
              if (isMd && window.prettier && window.prettierPlugins) {
                const indent = getFormatOptions();
                const useTabs = !!indent.indent_with_tabs;
                const tabWidth = (indent.indent_size && indent.indent_size > 0) ? indent.indent_size : 2;
                const formatted = window.prettier.format(cur, { parser: 'markdown', plugins: window.prettierPlugins, tabWidth, useTabs });
                editorCm.setValue(formatted);
                showMessage('Formatted Markdown', 'Success');
              } else {
                // HTML formatting via beautifyHtml, which uses getFormatOptions()
                const formatted = (typeof beautifyHtml === 'function') ? beautifyHtml(cur) : (window.html_beautify ? window.html_beautify(cur, { indent_size: 2 }) : cur);
                editorCm.setValue(formatted);
                showMessage('Formatted HTML', 'Success');
              }
            } catch(e) {
              console.error('Format failed', e);
              showMessage('Format failed', 'Error');
            }
          });
        }

        // expose small helpers used elsewhere
        window.__getEditorValue = () => editorCm.getValue();
        window.__setEditorValue = (v) => editorCm.setValue(v);
        window.__focusEditor = () => editorCm.focus();
      } catch (e) {
        console.warn('CodeMirror init failed', e);
      }
    } else {
      // If CodeMirror not present, ensure we still have a usable element
      window.__getEditorValue = () => (el && el.value) || '';
      window.__setEditorValue = (v) => { if(el) el.value = v; };
      window.__focusEditor = () => { try { el && el.focus && el.focus(); } catch(e) {} };
    }
  }

  initEditor();
  loadSelectedSite();

  // --- Page selector preview helpers ---
  // Sanitize HTML for srcdoc preview: remove scripts and inline event handlers
  function sanitizeHtmlForPreview(html) {
    try {
      let s = (html || '').replace(/<script[\s\S]*?>[\s\S]*?<\/script>/gi, '');
      s = s.replace(/\son\w+\s*=\s*(?:"[^"]*"|'[^']*')/gi, '');
      s = s.replace(/(href|src)\s*=\s*(["'])\s*javascript:[^\2]*\2/gi, '$1=$2#$2');
      return s;
    } catch (e) { return html || ''; }
  }

  // Encode a site-relative path for use in URLs while preserving slashes.
  // Behavior:
  // - Empty, null, or `/` -> returns empty string (so URL becomes `/site/<site>/`)
  // - Strips leading/trailing slashes, encodes each segment, and rejoins with '/'
  function encodePathForUrl(p) {
    try {
      if (!p) return '';
      const s = String(p).trim();
      if (!s || s === '/') return '';
      const cleaned = s.replace(/^\/+/, '').replace(/\/+$/, '');
      return cleaned.split('/').map(encodeURIComponent).join('/');
    } catch (e) {
      try { return encodeURIComponent(String(p || '')).replace(/%2F/g, '/'); } catch (e2) { return String(p || ''); }
    }
  }

  // Render template content for preview using available runtime or a lightweight fallback
  async function loadScript(url) {
    return new Promise((resolve, reject) => {
      try {
        const s = document.createElement('script');
        s.src = url;
        s.onload = () => resolve();
        s.onerror = (err) => reject(err);
        document.head.appendChild(s);
      } catch (e) { reject(e); }
    });
  }

  async function ensureHandlebars() {
    if (window.Handlebars && typeof window.Handlebars.compile === 'function') return;
    // Try multiple CDNs in order until one loads a Handlebars implementation with compile()
    const candidates = [
      'https://cdnjs.cloudflare.com/ajax/libs/handlebars.js/4.7.7/handlebars.min.js',
      'https://unpkg.com/handlebars@4.7.7/dist/handlebars.min.js',
      'https://cdn.jsdelivr.net/npm/handlebars@4.7.7/dist/handlebars.min.js'
    ];
    // Also try a local vendored copy (recommended for offline or blocked environments)
    // Place `handlebars.min.js` at `admin-static/libs/handlebars.min.js`
    candidates.push('/admin-static/libs/handlebars.min.js');
    let lastErr = null;
    for (const url of candidates) {
      try {
        // If already available, stop
        if (window.Handlebars && typeof window.Handlebars.compile === 'function') return;
        await loadScript(url);
        // small delay to ensure global is populated
        await new Promise(r => setTimeout(r, 20));
        if (window.Handlebars && typeof window.Handlebars.compile === 'function') {
          console.debug('Loaded Handlebars from', url);
          return;
        }
      } catch (e) {
        lastErr = e;
        console.debug('Failed to load Handlebars from', url, e && e.message ? e.message : e);
      }
    }
    console.warn('Could not load Handlebars from CDNs/local candidate', lastErr);
  }

  // Render template content for preview using available runtime or a lightweight fallback
  async function renderTemplateForPreviewAsync(template, data) {
    try {
      const ctx = data || window.latestAggregatedData || {};

      // Prefer full Handlebars if present — try to load it if missing
      if (!(window.Handlebars && typeof window.Handlebars.compile === 'function')) {
        await ensureHandlebars();
      }
      if (window.Handlebars && typeof window.Handlebars.compile === 'function') {
        try {
          console.debug('Rendering with Handlebars');
          const fn = window.Handlebars.compile(template);
          return fn(ctx || {});
        } catch (e) {
          console.warn('Handlebars render failed, will try other renderers', e);
        }
      } else {
        console.debug('Handlebars not available, will try Mustache or lightweight fallback');
      }

      // Prefer Mustache if present
      if (window.Mustache && typeof window.Mustache.render === 'function') {
        try { console.debug('Rendering with Mustache'); return window.Mustache.render(template, ctx || {}); } catch (e) { console.warn('Mustache render failed', e); }
      }

      // Lightweight fallback renderer: supports {{path}} and simple {{#each path}}...{{/each}} blocks
      let out = template;

      // handle simple each blocks
      out = out.replace(/{{#each\s+([^}]+)}}([\s\S]*?){{\/each}}/g, (m, path, inner) => {
        const arr = resolvePath(ctx, path.trim());
        if (!Array.isArray(arr)) return '';
        return arr.map((item, idx) => {
          return inner.replace(/{{\s*this\.([\w$.]+)\s*}}/g, (_, p) => { return String(resolvePath(item, p) ?? ''); })
                      .replace(/{{\s*@index\s*}}/g, String(idx))
                      .replace(/{{\s*([\w$.]+)\s*}}/g, (_, p) => { return String(resolvePath(item, p) ?? resolvePath(ctx, p) ?? ''); });
        }).join('');
      });

      // simple variable replacements
      out = out.replace(/{{\s*([\w$.]+)\s*}}/g, (m, path) => {
        const v = resolvePath(ctx, path.trim());
        return v == null ? '' : String(v);
      });

      console.debug('Rendering with lightweight fallback');
      return out;
    } catch (e) { return template || ''; }
  }

  function resolvePath(obj, path) {
    try {
      if (!obj || !path) return undefined;
      const parts = path.split('.');
      let cur = obj;
      for (const p of parts) {
        if (cur == null) return undefined;
        cur = cur[p];
      }
      return cur;
    } catch (e) { return undefined; }
  }

  // Populate page selector (exposed so renderSiteDetails can call it)
  window.populatePageSelector = function(tree) {
    try {
      const sel = qs('#pageSelector'); if(!sel) return;
      const list = [];
      (function walk(nodes){ (nodes||[]).forEach(n=>{ if(n.type === 'file' && typeof n.name === 'string') list.push(n.path); else if(n.type === 'dir' && Array.isArray(n.children)) walk(n.children); }); })(tree || []);
      sel.innerHTML = '';
      list.forEach(p => { const opt = document.createElement('option'); opt.value = p; opt.textContent = p; sel.appendChild(opt); });
    } catch(e){ console.warn('populatePageSelector failed', e); }
  };

  // Hook up preview/load buttons
  (function wirePreviewButtons(){
    const btnPreview = qs('#btnLoadPreview');
    const btnLoadIntoEditor = qs('#btnLoadIntoEditor');
    const sel = qs('#pageSelector');
    const preview = qs('#previewFrame');
    // Disable manual page selector/preview controls: preview should reflect the page
    // currently loaded in the editor (either auto-opened on site select or opened from site files).
    try {
      if (sel) sel.style.display = 'none';
      if (btnPreview) btnPreview.style.display = 'none';
      if (btnLoadIntoEditor) btnLoadIntoEditor.style.display = 'none';
    } catch (e) { /* ignore styling errors */ }
  })();

  // --- Preview hover/click mapping ---
  // Attach handlers to the sandboxed preview so hovering elements highlights related editor code
  (function wirePreviewHovering(){
    const preview = qs('#previewFrame');
    if(!preview) return;

    function escapeRegexText(s){ return (s+'').replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&'); }

    let currentHoverMarker = null;

    function clearHoverMark() {
      try {
        if (currentHoverMarker && editorCm) { currentHoverMarker.clear(); currentHoverMarker = null; }
        const ed = document.getElementById('pageEditor');
        if (!editorCm && ed) {
          try { ed.selectionStart = ed.selectionEnd = ed.selectionStart || 0; } catch(e){}
        }
      } catch (e) { /* ignore */ }
    }

    function markRangeInEditor(startIndex, endIndex) {
      try {
        if (startIndex == null || endIndex == null || startIndex >= endIndex) return;
        if (editorCm) {
          const from = editorCm.posFromIndex(startIndex);
          const to = editorCm.posFromIndex(endIndex);
          try { if (currentHoverMarker) currentHoverMarker.clear(); } catch(e){}
          try { currentHoverMarker = editorCm.markText(from, to, { className: 'ab-preview-hover', inclusiveLeft:true, inclusiveRight:true }); } catch(e) { currentHoverMarker = null; }
          try { editorCm.setSelection(from, to); } catch(e){}
          try { editorCm.scrollIntoView({ from, to }); } catch(e){}
        } else {
          const ed = document.getElementById('pageEditor');
          if (ed) { ed.selectionStart = startIndex; ed.selectionEnd = endIndex; try { ed.scrollTop = ed.selectionStart; } catch(e){} }
        }
      } catch (e) { console.warn('markRangeInEditor failed', e); }
    }

    function findMatchingIndexes(node, editorText) {
      try {
        if(!node || !editorText) return null;
        // try id match
        if(node.id) {
          const re = new RegExp("id\\s*=\\s*(?:\"|')" + escapeRegexText(node.id) + "(?:\"|')", 'i');
          const m = editorText.match(re);
          if(m) {
            const idx = m.index;
            let tagStart = editorText.lastIndexOf('<', idx);
            if(tagStart === -1) tagStart = idx;
            let tagEnd = editorText.indexOf('>', idx);
            if(tagEnd === -1) tagEnd = Math.min(editorText.length, idx + node.outerHTML.length);
            return { start: tagStart, end: tagEnd + 1 };
          }
        }

        // try class match (first token)
        try {
          const cls = (node.className || '').split && (node.className || '').split(/\s+/).filter(Boolean)[0];
          if(cls) {
            const re = new RegExp("class\\s*=\\s*(?:\"|')[^\"']*\\b" + escapeRegexText(cls) + "\\b[^\"']*(?:\"|')", 'i');
            const m = editorText.match(re);
            if(m) {
              const idx = m.index;
              let tagStart = editorText.lastIndexOf('<', idx);
              if(tagStart === -1) tagStart = idx;
              let tagEnd = editorText.indexOf('>', idx);
              if(tagEnd === -1) tagEnd = Math.min(editorText.length, idx + node.outerHTML.length);
              return { start: tagStart, end: tagEnd + 1 };
            }
          }
        } catch(e) {}

        // try outerHTML snippet match (trim whitespace)
        try {
          const outer = (node.outerHTML || '').replace(/\s+/g, ' ').trim();
          if(outer && outer.length > 10) {
            const snippet = outer.length > 200 ? outer.slice(0,200) : outer;
            const idx = editorText.indexOf(snippet);
            if(idx !== -1) return { start: idx, end: idx + snippet.length };
            // try opening tag only
            const opening = snippet.split('>')[0] + '>';
            const idx2 = editorText.indexOf(opening);
            if(idx2 !== -1) {
              const closeTag = editorText.indexOf('</' + node.tagName.toLowerCase(), idx2);
              if(closeTag !== -1) {
                const closeEnd = editorText.indexOf('>', closeTag);
                return { start: idx2, end: (closeEnd !== -1 ? closeEnd+1 : closeTag + 3) };
              }
              return { start: idx2, end: idx2 + opening.length };
            }
          }
        } catch(e) {}

        // try text content match
        try {
          const txt = (node.textContent || '').trim().slice(0,80);
          if(txt) {
            const idx = editorText.indexOf(txt);
            if(idx !== -1) {
              // approximate surrounding
              let start = editorText.lastIndexOf('<', idx);
              if(start === -1) start = Math.max(0, idx - 20);
              const close = editorText.indexOf('</' + node.tagName.toLowerCase(), idx);
              if(close !== -1) {
                const closeEnd = editorText.indexOf('>', close);
                return { start: start, end: (closeEnd !== -1 ? closeEnd+1 : close + 3) };
              }
              return { start: start, end: idx + txt.length };
            }
          }
        } catch(e) {}

        return null;
      } catch (e) { return null; }
    }

    // Keep a helper to perform the mapping for a node (used on click)
    function handlePreviewHover(node) {
      try {
        if(!node) { return; }
        const editorText = editorCm ? editorCm.getValue() : (document.getElementById('pageEditor') && document.getElementById('pageEditor').value) || '';
        const match = findMatchingIndexes(node, editorText);
        if(match) {
          markRangeInEditor(match.start, match.end);
        }
      } catch (e) { console.warn('handlePreviewHover failed', e); }
    }

    function handlePreviewClick(node) {
      try {
        handlePreviewHover(node);
        // focus editor and keep selection
        try { if (editorCm) editorCm.focus(); else document.getElementById('pageEditor') && document.getElementById('pageEditor').focus(); } catch(e) {}
      } catch (e) {}
    }

    function attachHandlersToDoc(doc) {
      if(!doc) return;
      // Only respond to clicks. Do not map on hover to avoid jumping while selecting.
      doc.addEventListener('click', (ev)=>{
        try { ev.preventDefault(); ev.stopPropagation(); handlePreviewClick(ev.target); } catch(e) {}
      }, true);
    }

    function tryAttach() {
      try {
        const doc = preview.contentDocument || (preview.contentWindow && preview.contentWindow.document);
        if(doc && (doc.readyState === 'complete' || doc.readyState === 'interactive')) {
          attachHandlersToDoc(doc);
        } else if(doc) {
          doc.addEventListener('DOMContentLoaded', ()=> attachHandlersToDoc(doc));
        }
      } catch(e) { /* ignore cross-origin or other errors */ }
    }

    // Attach on load and attempt immediate attach (for existing srcdoc)
    preview.addEventListener('load', tryAttach);
    setTimeout(tryAttach, 300);
  })();

  // --- Find / Search support (use CodeMirror native search if available) ---
  const editorFindInput = document.getElementById('editorFindInput');
  const editorFindNext = document.getElementById('editorFindNext');
  const editorFindPrev = document.getElementById('editorFindPrev');
  const editorFindClose = document.getElementById('editorFindClose');

  function openCmFindDialog() {
    if (editorCm && CodeMirror && CodeMirror.commands && CodeMirror.commands.find) {
      try { CodeMirror.commands.find(editorCm); return; } catch(e) { /* fallthrough */ }
    }
    // fallback: focus local input
    if (editorFindInput) { editorFindInput.focus(); editorFindInput.select(); }
  }

  // Ctrl+F -> CodeMirror find dialog (native)
  document.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'f') {
      e.preventDefault();
      openCmFindDialog();
    }
  });

  // Next / Prev buttons: prefer CodeMirror commands, fall back to searchCursor
  if (editorFindNext) editorFindNext.addEventListener('click', () => {
    if (editorCm && CodeMirror && CodeMirror.commands && CodeMirror.commands.findNext) {
      try { CodeMirror.commands.findNext(editorCm); return; } catch(e) { /* fallback */ }
    }
    const q = (editorFindInput && editorFindInput.value || '').trim();
    if (!q || !editorCm) return;
    const cursor = editorCm.getSearchCursor(q, editorCm.getCursor());
    if (cursor.findNext()) {
      editorCm.setSelection(cursor.from(), cursor.to());
      editorCm.scrollIntoView({ from: cursor.from(), to: cursor.to() });
    } else {
      // wrap
      const c2 = editorCm.getSearchCursor(q, { line: 0, ch: 0 });
      if (c2.findNext()) { editorCm.setSelection(c2.from(), c2.to()); editorCm.scrollIntoView({ from: c2.from(), to: c2.to() }); }
    }
  });

  if (editorFindPrev) editorFindPrev.addEventListener('click', () => {
    if (editorCm && CodeMirror && CodeMirror.commands && CodeMirror.commands.findPrev) {
      try { CodeMirror.commands.findPrev(editorCm); return; } catch(e) { /* fallback */ }
    }
    const q = (editorFindInput && editorFindInput.value || '').trim();
    if (!q || !editorCm) return;
    const cursor = editorCm.getSearchCursor(q, editorCm.getCursor());
    if (cursor.findPrevious()) {
      editorCm.setSelection(cursor.from(), cursor.to());
      editorCm.scrollIntoView({ from: cursor.from(), to: cursor.to() });
    } else {
      // wrap to end
      const last = editorCm.getSearchCursor(q, { line: editorCm.lastLine(), ch: null });
      if (last.findPrevious()) { editorCm.setSelection(last.from(), last.to()); editorCm.scrollIntoView({ from: last.from(), to: last.to() }); }
    }
  });

  if (editorFindClose) editorFindClose.addEventListener('click', () => {
    if (editorFindInput) editorFindInput.value = '';
    if (editorCm && CodeMirror && CodeMirror.commands && CodeMirror.commands.clearSearch) {
      try { CodeMirror.commands.clearSearch(editorCm); } catch(e) {}
    }
    if (editorCm) try { editorCm.focus(); } catch(e) {}
  });

  // If a user still types into the small external find box, we don't need to mirror highlights anymore.
});