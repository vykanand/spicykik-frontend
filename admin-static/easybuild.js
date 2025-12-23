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
  // Selected elements from preview (for Element Explorer)
  let selectedElements = []; // { selector, snippet, color, fade }
  window.__selectedElements = selectedElements;
  // currently selected palette field (apiName or apiName.field)
  let selectedPaletteField = null;

  // Color management for selection highlights
  const __usedHues = new Set();
  function generateUniqueHsl() {
    // pick a hue not recently used (attempts)
    for(let i=0;i<36;i++){
      const h = Math.floor(Math.random()*360);
      if(!__usedHues.has(h)) { __usedHues.add(h); if(__usedHues.size>40) { /* keep set bounded */ const it = __usedHues.values().next().value; __usedHues.delete(it); } const color = `hsl(${h} 75% 50%)`; const fade = `hsla(${h} 75% 0.12)`; return { color, fade, h }; }
    }
    // fallback
    const h = Math.floor(Math.random()*360); const color = `hsl(${h} 75% 50%)`; const fade = `hsla(${h} 75% 0.12)`; return { color, fade, h };
  }

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
      const displayName = (s && s.name) ? String(s.name).trim() : '';
      li.textContent = displayName;
      li.dataset.siteName = displayName;
      li.style.display = 'flex'; li.style.justifyContent = 'space-between'; li.style.alignItems = 'center';
      // clicking the list item opens the site
      li.addEventListener('click', ()=> selectSite(li.dataset.siteName));
      if(selectedSite && selectedSite.name && selectedSite.name.trim() === displayName) li.classList.add('active');
      ul.appendChild(li);
    });
  }

  async function selectSite(name){
    try {
      selectedSite = await api(`/api/sites/${encodeURIComponent(name)}`) || null;
      window.selectedSite = selectedSite;
      await renderSiteList();
      await renderSiteDetails();
      // After rendering site details, automatically open the first HTML page (if any)
      try {
        // Fetch site tree and find first .html file
        const tree = await api(`/api/sites/${encodeURIComponent(name)}/tree`);
        function findFirstHtml(nodeList) {
          if(!Array.isArray(nodeList) || nodeList.length === 0) return null;
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
      const content = await api(`/api/sites/${encodeURIComponent(siteName)}/pages/content?path=${encodeURIComponent(path)}`);
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
      if(preview) preview.href = `/site/${encodeURIComponent(siteName)}/${encodePathForUrl(path)}`;
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
            // Reset element explorer state when navigating to a new page
            try { previewFrame.onload = () => { try { attachHandlersToDoc(previewFrame.contentDocument || previewFrame.contentWindow.document); resetElementExplorer(); } catch(e){} }; } catch(e){}
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
    const pl = qs('#previewLink'); if(pl) pl.href = `/site/${encodeURIComponent(selectedSite.name)}/`;

    // render full folder/file tree inside siteFileTree
    try{
      const tree = await api(`/api/sites/${encodeURIComponent(selectedSite.name)}/tree`);
      const container = qs('#siteFileTree'); if(container){
        container.innerHTML = '';
          (tree||[]).forEach(n=> renderFileTreeNode(n, container));
          // After rendering tree, try to highlight the currently loaded page
          try {
            const current = document.getElementById('pageEditor')?.getAttribute('data-current-page');
            if(current) {
              const nodes = container.querySelectorAll('.sf-node');
              for(const nEl of nodes) {
                if(nEl && nEl.title === current) {
                  // simulate selection
                  nEl.classList.add('selected');
                  window.__currentSelectedFileEl = nEl;
                  const info = qs('#siteActions'); if(info) info.textContent = `Selected: ${current} — File`;
                  break;
                }
              }
            }
          } catch(e) { /* ignore */ }
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
      const data = await api(`/api/sites/${encodeURIComponent(selectedSite.name)}/data`);
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
    if (!container) return;
    ensurePaletteStyles();
    try { container.style.display = 'block'; container.innerHTML = ''; } catch (e) {}

    const meta = data?.__meta__ || {};
    const apiKeys = Object.keys(data || {}).filter(k => k !== '__meta__');
    if (apiKeys.length === 0) {
      container.innerHTML = '<div style="padding:16px;text-align:center;color:#64748b;font-style:italic;">No APIs configured for this site.<br>Add APIs in the admin panel to enable drag-and-drop components.</div>';
      return;
    }

    function makeHandle(fullPath, labelEl) {
      const h = document.createElement('span');
      h.className = 'api-handle';
      h.title = 'Click or drag to connect';
      h.dataset.field = fullPath;
      h.addEventListener('click', (ev) => { ev.stopPropagation(); try { setSelectedPalette(fullPath); startConnectMode(fullPath, labelEl, 'field'); } catch (e) {} });
      h.addEventListener('mousedown', (ev) => { ev.stopPropagation(); try { startDragConnect(fullPath, labelEl, ev.clientX, ev.clientY, 'field'); } catch (e) {} });
      return h;
    }

    const treeWrap = document.createElement('div'); treeWrap.className = 'simple-palette';
    for (const apiName of apiKeys) {
      try {
        const root = document.createElement('div'); root.className = 'palette-root';

        // Header with caret, title, method and root handle
        const header = document.createElement('div'); header.className = 'palette-root-header'; header.tabIndex = 0;
        const caret = document.createElement('span'); caret.className = 'palette-caret'; caret.textContent = '▸'; caret.style.marginRight = '8px'; caret.style.opacity = '0.9';
        header.appendChild(caret);
        const title = document.createElement('span'); title.className = 'palette-root-title'; title.textContent = apiName; title.style.fontWeight = '700';
        header.appendChild(title);
        // expose api name on header for mapping persistence
        try { header.dataset.apiName = apiName; } catch(e) {}
        // clicking header selects the entire API (highlights children)
        header.addEventListener('click', (ev)=>{ ev.stopPropagation(); setSelectedPalette(apiName); });
        const method = (meta[apiName]?.method || '').toUpperCase();
        if (method) {
          const m = document.createElement('span'); m.className = 'palette-method'; m.textContent = method; header.appendChild(m);
        }
        // blue handle on the parent API root as well
        try { header.appendChild(makeHandle(apiName, header)); } catch(e){}
        root.appendChild(header);

        const childrenWrap = document.createElement('div'); childrenWrap.className = 'palette-children'; childrenWrap.style.display = 'none';

        // Expand/collapse behavior
        function toggleChildren() {
          const isHidden = childrenWrap.style.display === 'none';
          childrenWrap.style.display = isHidden ? 'block' : 'none';
          caret.textContent = isHidden ? '▾' : '▸';
        }
        header.addEventListener('click', (ev) => { ev.stopPropagation(); toggleChildren(); });
        header.addEventListener('keypress', (ev) => { if(ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); toggleChildren(); } });

        // Determine a sample object to inspect fields (arrays -> first element)
        const sample = Array.isArray(data[apiName]) ? (data[apiName][0] || {}) : (data[apiName] && typeof data[apiName] === 'object' ? data[apiName] : {});
        if (sample && typeof sample === 'object' && Object.keys(sample).length > 0) {
          for (const k of Object.keys(sample)) {
            const row = document.createElement('div'); row.className = 'palette-row';
            const label = document.createElement('span'); label.className = 'palette-key'; label.textContent = k;
            // sample value (beautified short)
            try {
              const v = sample[k];
              const s = (v === null) ? 'null' : (typeof v === 'object' ? JSON.stringify(v) : String(v));
              const sampleEl = document.createElement('span'); sampleEl.className = 'palette-sample'; sampleEl.textContent = s.length > 40 ? s.slice(0,40) + '…' : s; sampleEl.style.marginLeft = '8px'; sampleEl.style.color = 'var(--palette-sample)'; sampleEl.style.fontSize = '12px';
              label.appendChild(sampleEl);
            } catch(e) {}
            const fullPath = `${apiName}.${k}`;
            row.dataset.field = fullPath;
            row.appendChild(label);
            row.appendChild(makeHandle(fullPath, label));
            // clicking row selects this field
            row.addEventListener('click', (ev)=>{ ev.stopPropagation(); setSelectedPalette(fullPath); });
            childrenWrap.appendChild(row);
          }
        } else {
          const row = document.createElement('div'); row.className = 'palette-row'; row.textContent = '(no fields)'; row.style.color = 'var(--palette-sample)'; childrenWrap.appendChild(row);
        }

        root.appendChild(childrenWrap);
        treeWrap.appendChild(root);
      } catch (e) { /* best-effort per-API */ }
    }

    try { container.appendChild(treeWrap); } catch (e) { container.innerHTML = '<div style="padding:12px;color:#fca5a5">Palette render failed</div>'; }
  }

  // Inject high-contrast palette styles for dark theme (idempotent)
  function ensurePaletteStyles() {
    try {
      if(document.getElementById('ab-palette-styles')) return;
      const s = document.createElement('style'); s.id = 'ab-palette-styles';
      s.textContent = `
        #dataPalette { background: #0b1220; color: #e6f3ff; padding: 8px; font-family: Inter, system-ui, Arial; }
        #dataPalette .simple-palette { display:block; }
        #dataPalette .palette-root { margin-bottom:8px; border-radius:8px; overflow:hidden; }
        #dataPalette .palette-root-header { display:flex; align-items:center; gap:8px; padding:8px; background: linear-gradient(180deg,#071020 0%, #071827 100%); cursor:pointer; border:1px solid rgba(255,255,255,0.03); }
        #dataPalette .palette-root-header:hover { background: linear-gradient(180deg,#0c1726 0%, #071827 100%); }
        #dataPalette .palette-root-header.selected { outline: 3px solid rgba(96,165,250,0.95); box-shadow: 0 6px 18px rgba(2,6,23,0.6); }
        #dataPalette .palette-caret { color: rgba(255,255,255,0.6); }
        #dataPalette .palette-children { padding:6px 8px; background: linear-gradient(180deg, rgba(255,255,255,0.01), rgba(255,255,255,0.008)); }
        #dataPalette .palette-row { display:flex; align-items:center; justify-content:space-between; padding:6px; border-radius:6px; margin-bottom:6px; background:transparent; transition: background .12s, transform .06s; }
        #dataPalette .palette-row:hover { background: rgba(255,255,255,0.01); transform: translateY(-1px); }
        #dataPalette .palette-row.selected { background: rgba(96,165,250,0.06); box-shadow: inset 4px 0 0 0 rgba(96,165,250,0.95); }
        #dataPalette .palette-key { font-weight:600; color: #dbefff; }
        #dataPalette .palette-sample { color: #a2c0dd; }
        #dataPalette .api-handle { width:18px; height:18px; display:inline-block; border-radius:6px; background: linear-gradient(180deg,#60a5fa,#3b82f6); box-shadow: 0 6px 18px rgba(2,6,23,0.6); margin-left:8px; cursor:pointer; }
      `;
      document.head.appendChild(s);
    } catch(e) { /* ignore style injection errors */ }
  }

  // Mark a palette field (api or api.field) as selected and highlight its children
  function setSelectedPalette(field) {
    try {
      selectedPaletteField = field;
      const container = document.getElementById('dataPalette'); if(!container) return;
      // clear previous
      container.querySelectorAll('.palette-root-header.selected, .palette-row.selected').forEach(n=> n.classList.remove('selected'));
      // highlight matching header (api root)
      const headers = container.querySelectorAll('.palette-root-header');
      headers.forEach(h => { try { if(h.dataset && h.dataset.apiName === field) h.classList.add('selected'); } catch(e){} });
      // highlight matching rows: exact match or children when root selected
      const rows = container.querySelectorAll('.palette-row');
      rows.forEach(r => {
        try {
          const f = r.dataset && r.dataset.field ? r.dataset.field : null;
          if(!f) return;
          if(f === field) r.classList.add('selected');
          else if(field && field.indexOf('.') === -1 && f.indexOf(field + '.') === 0) r.classList.add('selected');
          else r.classList.remove('selected');
        } catch(e) {}
      });
    } catch(e) { console.warn('setSelectedPalette failed', e); }
  }

  // --- Connector overlay and click-to-connect behavior (adapted from form-builder) ---
  const formCanvas = document.body; // overlay sits over whole page
  let connectingField = null;
  let connectingAPINode = null;
  let connectingKind = null; // 'field' or 'method'
  let connectingKey = null;
  const connections = {};
  connections.methods = connections.methods || {};

  function initConnectorOverlay() {
    if (document.getElementById('connectorSvg')) return;
    const svg = document.createElementNS('http://www.w3.org/2000/svg','svg');
    svg.id = 'connectorSvg';
    svg.setAttribute('style','position:fixed;left:0;top:0;width:100%;height:100%;pointer-events:none;z-index:9999');
    const defs = document.createElementNS('http://www.w3.org/2000/svg','defs');
    const marker = document.createElementNS('http://www.w3.org/2000/svg','marker');
    marker.setAttribute('id','arrow-end'); marker.setAttribute('markerWidth','8'); marker.setAttribute('markerHeight','8'); marker.setAttribute('refX','6'); marker.setAttribute('refY','4'); marker.setAttribute('orient','auto');
    const path = document.createElementNS('http://www.w3.org/2000/svg','path');
    path.setAttribute('d','M0,0 L8,4 L0,8 z'); path.setAttribute('fill','rgba(96,165,250,0.95)');
    marker.appendChild(path); defs.appendChild(marker); svg.appendChild(defs); document.body.appendChild(svg);
  }

  function getElementSelector(element) {
    try {
      if (!element) return '[data-invalid-target]';
      if (element.id) return '#' + element.id;
      if (element.name) return `[name="${element.name.replace(/"/g,'\\"')}"]`;
      if (element.className && typeof element.className === 'string') {
        const className = element.className.split(' ')[0]; if (className) return '.' + className;
      }
      if (!element.id) {
        element.id = `abgen_${Date.now().toString(36)}_${Math.floor(Math.random()*10000)}`;
        return '#' + element.id;
      }
      let selector = element.tagName.toLowerCase(); if (element.type) selector += `[type="${element.type}"]`;
      return selector;
    } catch (e) { return '[data-invalid-selector]'; }
  }

  function startConnectMode(key, apiNode, kind) {
    initConnectorOverlay();
    connectingKind = kind || 'field';
    connectingKey = key;
    if (connectingKind === 'field') connectingField = key; else connectingField = null;
    connectingAPINode = apiNode;
    document.querySelectorAll('.api-item, .node-label').forEach(n => n.classList && n.classList.remove('connecting'));
    try { apiNode.classList.add('connecting'); } catch(e){}
    const status = document.getElementById('injectStatus'); if(status) status.textContent = connectingKind === 'method' ? `Connecting: select a submit button for method "${key}"` : `Connecting: select a target element for "${key}"`;
  }

  function cancelConnectMode() {
    connectingField = null; if(connectingAPINode) try{ connectingAPINode.classList.remove('connecting'); }catch(e){}
    connectingAPINode = null; const status = document.getElementById('injectStatus'); if(status) status.textContent = '';
  }

  function createMapping(field, target) {
    try {
      window.__mappings = window.__mappings || {};
      window.__mappings[field] = { element: target, selector: getElementSelector(target) };
      try { target.classList.add('mapped'); } catch(e){}
      // update live patch preview area
      try { const mp = document.getElementById('mappingPreview'); if(mp) { mp.innerHTML = `<div><strong>${field}</strong> → ${window.__mappings[field].selector}</div>`; } } catch(e){}
      // persist mapping if possible (best-effort)
      const editor = document.getElementById('pageEditor'); const currentPage = editor ? editor.getAttribute('data-current-page') : null;
      if(currentPage && connectingAPINode && connectingAPINode.dataset && connectingAPINode.dataset.apiName) {
        try { savePageMapping(currentPage, connectingAPINode.dataset.apiName, (connectingAPINode.dataset.method||'GET').toUpperCase(), ''); } catch(e){}
      }
    } catch(e) { console.warn('createMapping failed', e); }
  }

  function drawConnection(field, apiNode, target) {
    try {
      initConnectorOverlay();
      const svg = document.getElementById('connectorSvg'); if(!svg) return;
      if(connections[field] && connections[field].path) { try{ connections[field].path.remove(); }catch(e){} }
      // start rect (apiNode) may be in main doc, target may be inside iframe
      let aRect = null;
      try { const h = apiNode && apiNode.querySelector ? apiNode.querySelector('.api-handle') : null; aRect = h ? h.getBoundingClientRect() : apiNode.getBoundingClientRect(); } catch(e) { aRect = apiNode.getBoundingClientRect(); }
      let tRect = target.getBoundingClientRect();
      // if target is inside an iframe, offset by iframe position
      try {
        const pf = document.getElementById('previewFrame');
        if(pf && pf.contentWindow && target.ownerDocument === pf.contentDocument) {
          const iframeRect = pf.getBoundingClientRect();
          tRect = { left: iframeRect.left + tRect.left, top: iframeRect.top + tRect.top, width: tRect.width, height: tRect.height, right: iframeRect.left + tRect.right, bottom: iframeRect.top + tRect.bottom };
        }
      } catch(e) {}
      const startX = aRect.left + aRect.width/2; const startY = aRect.top + aRect.height/2;
      const endX = tRect.left + tRect.width/2; const endY = tRect.top + tRect.height/2;
      const dx = Math.abs(endX - startX); const controlX1 = startX + dx*0.25; const controlX2 = endX - dx*0.25;
      const pathStr = `M ${startX} ${startY} C ${controlX1} ${startY} ${controlX2} ${endY} ${endX} ${endY}`;
      const path = document.createElementNS('http://www.w3.org/2000/svg','path');
      path.setAttribute('d', pathStr); path.setAttribute('marker-end','url(#arrow-end)'); path.setAttribute('stroke','rgba(96,165,250,0.9)'); path.setAttribute('stroke-width','3'); path.setAttribute('fill','none'); path.setAttribute('data-field', field); path.style.filter = 'drop-shadow(0 6px 18px rgba(2,6,23,0.6))';
      svg.appendChild(path);
      connections[field] = connections[field] || {}; connections[field].path = path; try { connections[field].apiNode = apiNode; connections[field].element = target; } catch(e){}
    } catch(e) { console.error('drawConnection error', e); }
  }

  function updateConnectionPath(field) {
    try {
      const conn = connections[field]; if(!conn || !conn.path || !conn.element || !conn.apiNode) return;
      const apiNode = conn.apiNode; const target = conn.element;
      let aRect = null; try { const h = apiNode && apiNode.querySelector ? apiNode.querySelector('.api-handle') : null; aRect = h ? h.getBoundingClientRect() : apiNode.getBoundingClientRect(); } catch(e) { aRect = apiNode.getBoundingClientRect(); }
      let tRect = target.getBoundingClientRect(); try { const pf = document.getElementById('previewFrame'); if(pf && pf.contentWindow && target.ownerDocument === pf.contentDocument) { const iframeRect = pf.getBoundingClientRect(); tRect = { left: iframeRect.left + tRect.left, top: iframeRect.top + tRect.top, width: tRect.width, height: tRect.height, right: iframeRect.left + tRect.right, bottom: iframeRect.top + tRect.bottom }; } } catch(e){}
      const startX = aRect.left + aRect.width/2; const startY = aRect.top + aRect.height/2; const endX = tRect.left + tRect.width/2; const endY = tRect.top + tRect.height/2;
      const dx = Math.abs(endX - startX); const controlX1 = startX + dx*0.25; const controlX2 = endX - dx*0.25; const pathStr = `M ${startX} ${startY} C ${controlX1} ${startY} ${controlX2} ${endY} ${endX} ${endY}`;
      conn.path.setAttribute('d', pathStr);
    } catch(e) {}
  }

  let _connRaf = null;
  function updateAllConnections() { try { Object.keys(connections).forEach(f => updateConnectionPath(f)); } catch(e) {} _connRaf = null; }
  function scheduleConnectionsUpdate(){ if(_connRaf) return; _connRaf = requestAnimationFrame(updateAllConnections); }
  window.addEventListener('resize', scheduleConnectionsUpdate); window.addEventListener('scroll', scheduleConnectionsUpdate, true);

  // Drag-to-connect (visual)
  let _dragState = null;
  function startDragConnect(field, apiNode, startX, startY, kind) {
    // Clean, robust drag-to-connect implementation.
    try {
      initConnectorOverlay();
    } catch (e) {}

    const svg = document.getElementById('connectorSvg');
    if (!svg) return;

    // Create temporary path for the drag visualization
    const tempPath = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    tempPath.setAttribute('stroke', 'rgba(96,165,250,0.85)');
    tempPath.setAttribute('stroke-width', '3');
    tempPath.setAttribute('fill', 'none');
    tempPath.setAttribute('stroke-dasharray', '6 8');
    tempPath.setAttribute('marker-end', 'url(#arrow-end)');
    tempPath.style.pointerEvents = 'none';
    svg.appendChild(tempPath);

    const prevUserSelect = document.body.style.userSelect || '';
    const prevCursor = document.body.style.cursor || '';
    try { document.body.style.userSelect = 'none'; document.body.style.cursor = 'crosshair'; } catch (e) {}

    _dragState = { field, apiNode, tempPath, prevUserSelect, prevCursor, kind };

    function computeSourceCenter(node) {
      try {
        const handle = node && node.querySelector ? node.querySelector('.api-handle') : null;
        const r = handle ? handle.getBoundingClientRect() : (node ? node.getBoundingClientRect() : { left: 0, top: 0, width: 0, height: 0 });
        return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
      } catch (e) { return { x: 0, y: 0 }; }
    }

    function buildPath(sx, sy, ex, ey) {
      const dx = Math.abs(ex - sx);
      const c1 = sx + dx * 0.25;
      const c2 = ex - dx * 0.25;
      return `M ${sx} ${sy} C ${c1} ${sy} ${c2} ${ey} ${ex} ${ey}`;
    }

    function onMove(ev) {
      try {
        const x = ev.clientX;
        const y = ev.clientY;
        const src = computeSourceCenter(apiNode);
        const d = buildPath(src.x, src.y, x, y);
        try { tempPath.setAttribute('d', d); } catch (e) {}
        try { document.body.style.cursor = 'grabbing'; } catch (e) {}
      } catch (e) {
        // ignore
      }
    }

    function findTargetAtPoint(x, y) {
      try {
        let el = document.elementFromPoint(x, y);
        if (el) return el.closest('input,textarea,select,button');
        // If not found, test inside preview iframe
        const pf = document.getElementById('previewFrame');
        if (pf && pf.getBoundingClientRect) {
          const rect = pf.getBoundingClientRect();
          const relX = x - rect.left;
          const relY = y - rect.top;
          if (relX >= 0 && relY >= 0 && relX <= rect.width && relY <= rect.height) {
            try {
              const idoc = pf.contentDocument || pf.contentWindow && pf.contentWindow.document;
              if (idoc && idoc.elementFromPoint) {
                const el2 = idoc.elementFromPoint(relX, relY);
                return el2 ? el2.closest('input,textarea,select,button') : null;
              }
            } catch (e) { return null; }
          }
        }
      } catch (e) {}
      return null;
    }

    function cleanupAndRestore() {
      try { if (_dragState && _dragState.tempPath) _dragState.tempPath.remove(); } catch (e) {}
      try { document.body.style.userSelect = _dragState ? _dragState.prevUserSelect || '' : prevUserSelect; } catch (e) {}
      try { document.body.style.cursor = _dragState ? _dragState.prevCursor || '' : prevCursor; } catch (e) {}
      _dragState = null;
      scheduleConnectionsUpdate();
    }

    function onUp(ev) {
      try {
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onUp);
        if (!_dragState) return;
        const x = ev.clientX;
        const y = ev.clientY;
        const target = findTargetAtPoint(x, y);
        if (!target) { cleanupAndRestore(); return; }

        if (_dragState.kind === 'method') {
          connections.methods = connections.methods || {};
          connections.methods[_dragState.field] = { element: target, selector: getElementSelector(target) };
          try { target.classList.add('mapped'); } catch (e) {}
          drawConnection(_dragState.field, _dragState.apiNode, target);
        } else {
          // field mapping
          createMapping(_dragState.field, target);
          drawConnection(_dragState.field, _dragState.apiNode, target);
        }

        cleanupAndRestore();
      } catch (e) {
        try { cleanupAndRestore(); } catch (err) {}
      }
    }

    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
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

  // Event handlers
  const _savePageBtn = qs('#savePageBtn');
  if (_savePageBtn) _savePageBtn.addEventListener('click', async () => {
    if(!selectedSite) { showMessage('Select a site first', 'Error'); return; }
    const path = qs('#pageEditor').getAttribute('data-current-page') || 'index.html';
    if(!path) { showMessage('No page selected','Input required'); return; }
    const content = qs('#pageEditor').value;
    await fetch(`/api/sites/${encodeURIComponent(selectedSite.name)}/pages/save`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ path, content }) });
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
      pl.href = `/site/${encodeURIComponent(selectedSite.name)}/${encodePathForUrl(path)}?t=${Date.now()}`;
    }
  });

  const _previewRenderedBtn = qs('#previewRenderedBtn');
  if (_previewRenderedBtn) _previewRenderedBtn.addEventListener('click', () => {
    if(!selectedSite) { showMessage('No site selected', 'Error'); return; }
    const path = qs('#pageEditor').getAttribute('data-current-page') || 'index.html';
    window.open(`/site/${encodeURIComponent(selectedSite.name)}/${encodePathForUrl(path)}`, '_blank');
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
      await fetch(`/api/sites/${encodeURIComponent(selectedSite.name)}/pages/save`, { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify({ path: name, content: demo }) });
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
        // Also update selection info UI with line numbers
        try {
          const infoEl = document.getElementById('editorSelectionInfo');
          if(infoEl) {
            const preText = editorCm ? editorCm.getValue() : (document.getElementById('pageEditor') && document.getElementById('pageEditor').value) || '';
            const startLine = preText.slice(0, startIndex).split('\n').length;
            const endLine = preText.slice(0, endIndex).split('\n').length;
            infoEl.textContent = `Selected: lines ${startLine} - ${endLine}`;
            infoEl.style.display = 'block';
          }
        } catch(e) {}
      } catch (e) { console.warn('markRangeInEditor failed', e); }
    }

    function findMatchingIndexes(node, editorText) {
      try {
        if (!node || !editorText) return null;
        const tag = (node.tagName || '').toLowerCase();

        // 1) Try exact outerHTML match (fastest & most accurate) using raw outerHTML
        try {
          const rawOuter = node.outerHTML || '';
          if (rawOuter && rawOuter.length > 5) {
            const idx = editorText.indexOf(rawOuter);
            if (idx !== -1) return { start: idx, end: idx + rawOuter.length };
          }
        } catch (e) {}

        // 2) Build opening-tag match candidates (prefer id, then class, then any opening tag)
        const id = node.id || null;
        let firstClass = null;
        try { firstClass = (node.className || '').split && (node.className || '').split(/\s+/).filter(Boolean)[0]; } catch (e) { firstClass = null; }

        const openingCandidates = [];
        if (id) openingCandidates.push(new RegExp('<' + tag + '[^>]*\\bid\\s*=\s*(?:"|\')' + escapeRegexText(id) + '(?:"|\')[^>]*>', 'i'));
        if (firstClass) openingCandidates.push(new RegExp('<' + tag + '[^>]*\\bclass\\s*=\s*(?:"|\')[^"\']*\\b' + escapeRegexText(firstClass) + '\\b[^"\']*(?:"|\')[^>]*>', 'i'));
        openingCandidates.push(new RegExp('<' + tag + '\\b[^>]*>', 'i'));

        // Helper: from an opening tag index, find the matching closing tag using depth counting
        function findMatchingCloseFrom(openingEndIndex) {
          try {
            const sub = editorText.slice(openingEndIndex);
            const re = new RegExp('</\\s*' + tag + '\\b[^>]*>|<' + tag + '\\b[^>]*>', 'ig');
            let depth = 0;
            let m;
            while ((m = re.exec(sub)) !== null) {
              const tok = m[0];
              const isClose = /^<\//.test(tok);
              const selfClose = /\/>\s*$/.test(tok) || /<[^>]+\/\s*>$/.test(tok);
              if (!isClose && !selfClose) {
                depth++;
                continue;
              }
              if (isClose) {
                if (depth === 0) {
                  // match closing for our original open
                  return openingEndIndex + m.index + tok.length;
                }
                depth--;
              }
            }
            return null;
          } catch (e) { return null; }
        }

        // Search through editorText for any opening that matches our candidates and try to find its close
        for (const cand of openingCandidates) {
          // ensure global search
          const flags = (cand.flags || '') + (cand.flags && cand.flags.indexOf('g') === -1 ? 'g' : '');
          const g = new RegExp(cand.source, flags || 'g');
          let m;
          while ((m = g.exec(editorText)) !== null) {
            const start = m.index;
            const openEnd = start + m[0].length;
            // If self-closing opening, return that small range
            if (/\/>\s*$/.test(m[0])) return { start, end: openEnd };
            const closeEnd = findMatchingCloseFrom(openEnd);
            if (closeEnd) return { start, end: closeEnd };
          }
        }

        // 3) Fallback: try to match by a short innerText snippet within an opening tag occurrence
        try {
          const inner = (node.textContent || '').trim().slice(0, 120);
          if (inner) {
            const openingRe = new RegExp('<' + tag + '\\b[^>]*>', 'i');
            let m = openingRe.exec(editorText);
            while (m) {
              const s = m.index;
              const found = editorText.indexOf(inner, s);
              if (found !== -1) {
                const closeTag = editorText.indexOf('</' + tag, found);
                if (closeTag !== -1) {
                  const closeEnd = editorText.indexOf('>', closeTag);
                  return { start: s, end: closeEnd !== -1 ? closeEnd + 1 : closeTag + 3 };
                }
                return { start: s, end: found + inner.length };
              }
              // continue searching for next opening
              const nextIndex = m.index + 1;
              m = openingRe.exec(editorText.slice(nextIndex));
              if (m) m.index += nextIndex;
            }
          }
        } catch (e) {}

        return null;
      } catch (e) { return null; }
    }

    // Attempt more robust matching and provide candidates when automatic match fails
    function showMatchPicker(node, editorText, onSelect) {
      try {
        const tag = (node.tagName || '').toLowerCase();
        const outer = (node.outerHTML || '').replace(/\s+/g,' ').trim();
        const innerText = ((node.textContent||'')+'').trim().slice(0,200);
        const candidates = [];

        // 1) exact outer occurrences
        try {
          let idx = editorText.indexOf(outer);
          while(idx !== -1 && candidates.length < 6) {
            const end = idx + outer.length;
            candidates.push({ type:'outer', start: idx, end, snippet: editorText.slice(Math.max(0, idx-80), Math.min(editorText.length, end+80)) });
            idx = editorText.indexOf(outer, idx+1);
          }
        } catch(e) {}

        // 2) search for opening tags of same tag
        try {
          const re = new RegExp('<' + tag + '\\b[^>]*>', 'ig');
          let m; while((m = re.exec(editorText)) && candidates.length < 12) {
            const s = m.index; const openEnd = s + m[0].length; // find closing for this element roughly
            const closeIdx = editorText.indexOf('</' + tag, openEnd);
            const end = closeIdx !== -1 ? (editorText.indexOf('>', closeIdx) + 1) : Math.min(editorText.length, openEnd + 200);
            candidates.push({ type:'tag', start: s, end, snippet: editorText.slice(Math.max(0, s-80), Math.min(editorText.length, end+80)) });
          }
        } catch(e) {}

        // 3) innerText matches
        try {
          if(innerText) {
            let idx = editorText.indexOf(innerText);
            while(idx !== -1 && candidates.length < 20) {
              const start = Math.max(0, idx-120);
              const end = Math.min(editorText.length, idx + innerText.length + 120);
              candidates.push({ type:'text', start, end, snippet: editorText.slice(start, end) });
              idx = editorText.indexOf(innerText, idx+1);
            }
          }
        } catch(e) {}

        if(candidates.length === 0) {
          showMessage('No candidate matches found in the editor. Manual edit required.', 'Warning');
          return false;
        }

        // Build modal content
        const listHtml = candidates.map((c,i) => `<div class="match-candidate" data-idx="${i}" style="padding:8px;border-radius:6px;margin-bottom:8px;background:#071226;border:1px solid rgba(255,255,255,0.03);cursor:pointer"><div style="font-weight:700;margin-bottom:6px">Candidate ${i+1} — ${c.type}</div><pre style="white-space:pre-wrap;max-height:140px;overflow:auto;color:#cfe9ff;margin:0;padding:6px;background:transparent;border-radius:4px">${escapeHtml(c.snippet)}</pre></div>`).join('');
        const body = `<div style="display:flex;flex-direction:column;gap:8px;max-height:420px;overflow:auto">${listHtml}</div>`;
        if(window.AppUtils && AppUtils.Modal) {
          AppUtils.Modal.show({ title: 'Select matching location in editor', body });
          setTimeout(()=>{
            try {
              const nodes = document.querySelectorAll('.match-candidate');
              nodes.forEach(n => { n.onclick = () => {
                try {
                  const idx = parseInt(n.dataset.idx,10);
                  const sel = candidates[idx];
                  AppUtils.Modal.hide();
                  if(typeof onSelect === 'function') onSelect(sel.start, sel.end);
                } catch(e) { console.warn(e); }
              }; });
            } catch(e) {}
          }, 50);
          return true;
        }

        // Fallback: alert with count
        showMessage(`Found ${candidates.length} possible locations. Please open the editor and search for the snippet.`, 'Notice');
        return false;
      } catch(e) { console.warn('showMatchPicker failed', e); return false; }
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
        try { addSelectedElement(node); } catch(e) {}
      } catch (e) {}
    }

    // Ensure an element has a unique identifier we can use as selector (id, class or generated data attribute)
    function ensureElementIdentifier(node) {
      try {
        if (!node) return null;
        if (node.id) return '#' + node.id;
        if (node.classList && node.classList.length > 0) {
          // prefer first class but include full class list in data
          return '.' + node.classList[0];
        }
        // prefer attributes like name, data-* if present
        const attrs = node.attributes || [];
        for (let i=0;i<attrs.length;i++) {
          const a = attrs[i];
          if (!a) continue;
          const n = a.name;
          if (n === 'name' || n.startsWith('data-') || n === 'href') {
            try { return `[${n}="${a.value}"]`; } catch(e) { return `[${n}]`; }
          }
        }
        // fallback: generate a stable data attribute id
        if (!node.getAttribute('data-ab-id')) {
          const gen = `ab_${Date.now().toString(36)}_${Math.floor(Math.random()*10000)}`;
          try { node.setAttribute('data-ab-id', gen); } catch(e) { /* best-effort */ }
          // attempt to persist this data-ab-id into the editor source so future renderings keep the selector
          try { persistDataAbIdForNode(node, gen); } catch(e) { /* ignore persist failures */ }
        }
        return '#' + node.getAttribute('data-ab-id');
      } catch (e) { return null; }
    }

    // Persist a generated data-ab-id into the editor content by finding the opening tag and injecting the attribute.
    // Replace the element in editor HTML identified by `selector` with the provided outerHTML.
    // options: { autoSave: boolean }
    function patchEditorWithOuterHTML(selector, outerHtml, options) {
      try {
        options = options || {};
        const editorText = (window.__getEditorValue && typeof window.__getEditorValue === 'function') ? window.__getEditorValue() : (editorCm ? editorCm.getValue() : (document.getElementById('pageEditor') && document.getElementById('pageEditor').value) || '');
        if(!editorText) return false;
        // preserve doctype if present
        const doctypeMatch = editorText.match(/^<!doctype[^>]*>/i);
        const doctype = doctypeMatch ? doctypeMatch[0] + '\n' : '';
        const parser = new DOMParser();
        const doc = parser.parseFromString(editorText, 'text/html');
        let target = null;
        try { target = doc.querySelector(selector); } catch(e) { target = null; }
        if(!target) {
          // try stripping leading # for data-ab-id style selectors like '#ab_x' which may exist as data-ab-id
          try {
            if(selector && selector[0] === '#') {
              const idName = selector.slice(1);
              target = doc.querySelector('[data-ab-id="' + idName + '"]') || doc.getElementById(idName) || null;
            }
          } catch(e) { target = null; }
        }
        if(!target) return false;
        // Replace in parsed DOM
        try {
          // create a temporary container to parse outerHtml into nodes
          const fragDoc = parser.parseFromString(outerHtml, 'text/html');
          const newNode = fragDoc.body.firstElementChild || fragDoc.body;
          if(newNode) target.replaceWith(newNode);
          else {
            // fallback: set innerHTML of target's parent
            target.outerHTML = outerHtml;
          }
        } catch(e) {
          try { target.outerHTML = outerHtml; } catch(e2) { return false; }
        }
        // serialize back
        const serializer = new XMLSerializer();
        // Use innerHTML of documentElement to avoid adding unwanted xmlns attributes; rebuild full HTML
        const html = doc.documentElement ? doc.documentElement.outerHTML : doc.body.outerHTML;
        const final = (doctype || '') + html;
        if(window.__setEditorValue && typeof window.__setEditorValue === 'function') window.__setEditorValue(final);
        else if(editorCm) editorCm.setValue(final);
        else { const ta = document.getElementById('pageEditor'); if(ta) ta.value = final; }
        // re-render preview and reattach handlers
        try {
          const pf = document.getElementById('previewFrame');
          if(pf) {
            const rendered = awaitMaybeRender(final);
            pf.srcdoc = sanitizeHtmlForPreview(rendered || final);
            pf.onload = () => { try { attachHandlersToDoc(pf.contentDocument || pf.contentWindow.document); applyColorsToPreview(); } catch(e){} };
          }
        } catch(e) {}
        // auto-save to server if requested
        if(options.autoSave && selectedSite) {
          try {
            const currentPage = document.getElementById('pageEditor')?.getAttribute('data-current-page');
            if(currentPage) {
              fetch(`/api/sites/${encodeURIComponent(selectedSite.name)}/pages/save`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ path: currentPage, content: final }) })
              .then(()=> showMessage('Saved to site', 'Saved'))
              .catch(()=> {/* ignore */});
            }
          } catch(e) {}
        }
        return true;
      } catch(e) { console.warn('patchEditorWithOuterHTML failed', e); return false; }
    }

    // Helper to optionally render template using handlebars/mustache or return input
    function awaitMaybeRender(content) {
      // If rendering is async, use Promise resolution; otherwise return string
      try {
        const p = renderTemplateForPreviewAsync(content, window.latestAggregatedData || {});
        if(p && typeof p.then === 'function') return p;
        return content;
      } catch(e) { return content; }
    }

    // Replace an exact snippet in the editor HTML by parsing the editor DOM and finding a matching element.
    // Returns true if replacement succeeded.
    function patchEditorReplaceSnippet(originalSnippet, replacementHtml, options) {
      try {
        options = options || {};
        const editorText = (window.__getEditorValue && typeof window.__getEditorValue === 'function') ? window.__getEditorValue() : (editorCm ? editorCm.getValue() : (document.getElementById('pageEditor') && document.getElementById('pageEditor').value) || '');
        if(!editorText || !originalSnippet) return false;

        // Try exact substring match first (fast, precise)
        let startIndex = editorText.indexOf(originalSnippet);
        let endIndex = startIndex !== -1 ? startIndex + originalSnippet.length : -1;

        // If exact not found, try whitespace-tolerant regex match built from tokenized chunks
        if (startIndex === -1) {
          try {
            function escapeForRe(s){ return (s||'').replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&'); }
            const parts = (originalSnippet||'').split(/\s+/).filter(Boolean).map(p => escapeForRe(p));
            if(parts.length) {
              const pattern = parts.join('\\s+');
              const re = new RegExp(pattern, 'i');
              const m = re.exec(editorText);
              if(m) { startIndex = m.index; endIndex = m.index + m[0].length; }
            }
          } catch(e) { /* ignore regex errors */ }
        }

        // If we have indices, compute line numbers and perform line-based replacement (preserve indentation)
        if (startIndex !== -1 && endIndex !== -1) {
          try {
            const before = editorText.slice(0, startIndex);
            const inside = editorText.slice(startIndex, endIndex);
            const after = editorText.slice(endIndex);
            const startLine = editorText.slice(0, startIndex).split('\n').length; // 1-based
            const endLine = editorText.slice(0, endIndex).split('\n').length; // 1-based

            const lines = editorText.split('\n');
            const replacementLines = (replacementHtml || '').split('\n');

            // preserve leading indentation of the original start line
            const lineStartIdx = editorText.lastIndexOf('\n', startIndex - 1) + 1;
            const indentMatch = editorText.slice(lineStartIdx, startIndex).match(/^[ \t]*/);
            const indent = (indentMatch && indentMatch[0]) || '';
            const normalizedReplacement = replacementLines.map((l, i) => (i === 0 ? l : (indent + l)));

            // Replace lines [startLine-1 .. endLine-1]
            lines.splice(startLine - 1, endLine - startLine + 1, ...normalizedReplacement);
            const newEditorText = lines.join('\n');

            if (window.__setEditorValue && typeof window.__setEditorValue === 'function') window.__setEditorValue(newEditorText);
            else if (editorCm) editorCm.setValue(newEditorText);
            else { const ta = document.getElementById('pageEditor'); if (ta) ta.value = newEditorText; }

            // mark the inserted region in editor for user clarity
            try {
              const newStart = before.length;
              const newEnd = newStart + (replacementHtml || '').length;
              try { markRangeInEditor(newStart, newEnd); } catch(e){}
            } catch(e) {}

            // Re-render preview and reattach handlers
            try {
              const pf = document.getElementById('previewFrame');
              if (pf) {
                const rendered = awaitMaybeRender(newEditorText);
                Promise.resolve(rendered).then(r => { try { pf.srcdoc = sanitizeHtmlForPreview(r || newEditorText); pf.onload = () => { try { attachHandlersToDoc(pf.contentDocument || pf.contentWindow.document); applyColorsToPreview(); } catch(e){} }; } catch(e){} });
              }
            } catch(e) {}

            if (options.autoSave && selectedSite) {
              try {
                const currentPage = document.getElementById('pageEditor')?.getAttribute('data-current-page');
                if (currentPage) {
                  fetch(`/api/sites/${encodeURIComponent(selectedSite.name)}/pages/save`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ path: currentPage, content: newEditorText }) })
                    .then(() => showMessage('Saved to site', 'Saved'))
                    .catch(() => {});
                }
              } catch(e) {}
            }
            return true;
          } catch(e) { console.warn('line-based replacement failed', e); }
        }

        // Fallback: DOM-based replacement (best-effort, may change formatting)
        try {
          // Normalize whitespace helper
          function norm(s){ return (s||'').replace(/\s+/g,' ').trim(); }
          const origNorm = norm(originalSnippet);
          const parser = new DOMParser();
          const doc = parser.parseFromString(editorText, 'text/html');
          const all = doc.querySelectorAll('*');
          for(const el of all) {
            try {
              const out = el.outerHTML || '';
              if(!out) continue;
              if(norm(out) === origNorm || norm(out).indexOf(origNorm) !== -1) {
                try {
                  const fragDoc = parser.parseFromString(replacementHtml, 'text/html');
                  const newNode = fragDoc.body.firstElementChild || fragDoc.body;
                  if(newNode) el.replaceWith(newNode);
                  else el.outerHTML = replacementHtml;
                } catch(e2) {
                  try { el.outerHTML = replacementHtml; } catch(e3) { continue; }
                }
                const htmlOut = (doc.documentElement && doc.documentElement.outerHTML) || doc.body.outerHTML;
                if(window.__setEditorValue && typeof window.__setEditorValue === 'function') window.__setEditorValue(htmlOut);
                else if(editorCm) editorCm.setValue(htmlOut);
                else { const ta = document.getElementById('pageEditor'); if(ta) ta.value = htmlOut; }
                try {
                  const pf = document.getElementById('previewFrame'); if(pf) {
                    const rendered = awaitMaybeRender(htmlOut);
                    Promise.resolve(rendered).then(r => { try { pf.srcdoc = sanitizeHtmlForPreview(r || htmlOut); pf.onload = () => { try { attachHandlersToDoc(pf.contentDocument || pf.contentWindow.document); applyColorsToPreview(); } catch(e){} }; } catch(e){} });
                  }
                } catch(e) {}
                if(options.autoSave && selectedSite) {
                  try {
                    const currentPage = document.getElementById('pageEditor')?.getAttribute('data-current-page');
                    if(currentPage) {
                      fetch(`/api/sites/${encodeURIComponent(selectedSite.name)}/pages/save`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ path: currentPage, content: htmlOut }) })
                      .then(()=> showMessage('Saved to site', 'Saved'))
                      .catch(()=> {});
                    }
                  } catch(e) {}
                }
                return true;
              }
            } catch(e) { continue; }
          }
        } catch(e) { console.warn('DOM fallback replacement failed', e); }

        return false;
      } catch(e) { console.warn('patchEditorReplaceSnippet failed', e); return false; }
    }

    // Persist a generated data-ab-id into the editor content by replacing the element's outerHTML
    function persistDataAbIdForNode(node, genId) {
      try {
        if(!node || !genId) return false;
        // Ensure attribute on node (preview DOM)
        try { node.setAttribute('data-ab-id', genId); } catch(e){}
        const outer = (node.outerHTML || '').trim();
        // attempt to patch editor and auto-save
        const patched = patchEditorWithOuterHTML('#' + genId, outer, { autoSave: true });
        return !!patched;
      } catch(e) { console.warn('persistDataAbIdForNode failed', e); return false; }
    }

    function resolveGranularNode(node) {
      try {
        if(!node) return null;
        const sel = document.getElementById('elementGranularity');
        const mode = sel ? sel.value : 'exact';
        // support optional numeric depth input for Nth ancestor
        const depthInput = document.getElementById('elementGranularityDepth');
        const depth = depthInput ? parseInt(depthInput.value, 10) || 0 : 0;

        if(mode === 'exact') return node;
        if(mode === 'parent') return node.parentElement || node;
        if(mode === 'nth') {
          // climb up N levels (0 -> exact, 1 -> parent, etc.)
          let cur = node;
          let remaining = Math.max(0, depth);
          while(remaining > 0 && cur && cur.parentElement) { cur = cur.parentElement; remaining--; }
          return cur || node;
        }
        if(mode === 'block') return node.closest('div,section,article,li,td,tr,table,header,footer,main,aside') || node;
        if(mode === 'closestIdClass') return node.closest('[id], [class]') || node;
        return node;
      } catch(e) { return node; }
    }

    function scanPreviewForElements() {
      try {
        const pf = document.getElementById('previewFrame'); if(!pf) return;
        const idoc = pf.contentDocument || (pf.contentWindow && pf.contentWindow.document);
        if(!idoc) return;
        const all = idoc.querySelectorAll('*');
        let added = 0;
        for(let i=0;i<all.length && added<500;i++){
          const el = all[i];
          try{
            if(!el || el.nodeType !== 1) continue;
            // skip non-visible or layout-only tags
            const tag = (el.tagName || '').toLowerCase();
            if(['script','style','link','meta','head','noscript'].includes(tag)) continue;
            // prefer visible elements to avoid noise
            const rect = el.getBoundingClientRect ? el.getBoundingClientRect() : null;
            if(rect && rect.width === 0 && rect.height === 0) continue;

            // ensure stable selector exists (ensureElementIdentifier will create data-ab-id when needed)
            const sel = ensureElementIdentifier(el);
            if(!sel) continue;
            if(selectedElements.find(s=>s.selector===sel)) continue;
            const snippet = (el.outerHTML||el.tagName.toLowerCase()).trim().slice(0,220);
            const c = generateUniqueHsl();
            selectedElements.push({ selector: sel, snippet, color: c.color, fade: c.fade });
            added++;
          }catch(e){ /* best-effort */ }
        }
        window.__selectedElements = selectedElements;
        renderElementExplorer();
      } catch(e) { console.warn('scanPreviewForElements failed', e); }
    }

    function addSelectedElement(node) {
      try {
        if (!node) return;
        // apply granularity resolution before building selector/snippet
        const resolved = resolveGranularNode(node) || node;
        const selector = ensureElementIdentifier(resolved);
        if (!selector) return;
        // Deduplicate by selector
        if (selectedElements.find(s => s.selector === selector)) return;
        // create brief snippet (outerHTML trimmed)
        let snippet = '';
        try { snippet = resolved.outerHTML || resolved.tagName.toLowerCase(); } catch(e) { snippet = resolved.tagName.toLowerCase(); }
        if (snippet.length > 220) snippet = snippet.slice(0,220) + '…';
        const c = generateUniqueHsl();
        const entry = { selector, snippet, color: c.color, fade: c.fade };
        selectedElements.push(entry);
        window.__selectedElements = selectedElements;

        // apply inline highlight styling directly to the preview element (best-effort)
        try {
          resolved.setAttribute('data-ab-color', c.color);
          resolved.style.outline = `3px solid ${c.color}`;
          resolved.style.boxShadow = `0 8px 24px ${c.fade}`;
          resolved.style.borderRadius = resolved.style.borderRadius || '6px';
        } catch(e) { /* cross-origin or readonly may fail */ }

        renderElementExplorer();
      } catch(e) { console.warn('addSelectedElement failed', e); }
    }

    function renderElementExplorer() {
      try {
        const container = document.getElementById('elementExplorer'); if(!container) return;
        container.innerHTML = '';

        // Controls header: filter + granularity + scan
        const header = document.createElement('div'); header.style.display='flex'; header.style.gap='8px'; header.style.alignItems='center'; header.style.padding='8px'; header.style.borderBottom='1px solid rgba(255,255,255,0.03)';
        const filter = document.createElement('input'); filter.id = 'elementFilter'; filter.placeholder = 'Filter selectors or snippet...'; filter.style.flex='1'; filter.style.padding='8px'; filter.style.borderRadius='6px'; filter.style.background='rgba(255,255,255,0.02)'; filter.style.border='1px solid rgba(255,255,255,0.03)';
        header.appendChild(filter);
        const gran = document.createElement('select'); gran.id = 'elementGranularity'; gran.style.padding='8px'; gran.style.borderRadius='6px'; gran.style.background='rgba(255,255,255,0.02)'; gran.style.border='1px solid rgba(255,255,255,0.03)';
        ['exact','closestIdClass','block','parent','nth'].forEach(v=>{ const o=document.createElement('option'); o.value=v; o.textContent = v === 'exact' ? 'Exact' : (v==='closestIdClass' ? 'Closest id/class' : (v==='block' ? 'Block ancestor' : (v==='parent' ? 'Parent' : 'Nth ancestor'))); gran.appendChild(o); });
        header.appendChild(gran);
        const depthInput = document.createElement('input'); depthInput.id = 'elementGranularityDepth'; depthInput.type='number'; depthInput.min='0'; depthInput.value='0'; depthInput.style.width='64px'; depthInput.title='Nth ancestor depth (0 = exact, 1 = parent)'; depthInput.style.padding='8px'; depthInput.style.borderRadius='6px'; depthInput.style.border='1px solid rgba(255,255,255,0.03)';
        header.appendChild(depthInput);
        const scanBtn = document.createElement('button'); scanBtn.id='elementScanBtn'; scanBtn.className='btn small'; scanBtn.textContent = 'Scan'; scanBtn.title = 'Scan preview for candidate elements (ids/classes/data-*)'; scanBtn.addEventListener('click', (ev)=>{ ev.stopPropagation(); try{ scanPreviewForElements(); }catch(e){} });
        header.appendChild(scanBtn);
        container.appendChild(header);

        // update on filter input change
        filter.addEventListener('input', ()=> renderElementExplorer());

        if (!selectedElements || selectedElements.length === 0) {
          const info = document.createElement('div'); info.style.padding='12px'; info.style.color='#64748b'; info.style.fontStyle='italic'; info.textContent = 'No elements selected yet. Click elements in the preview to add them here or use Scan.';
          container.appendChild(info); return;
        }

        const listWrap = document.createElement('div'); listWrap.style.display = 'flex'; listWrap.style.flexDirection = 'column'; listWrap.style.gap = '6px'; listWrap.style.padding = '8px';
        const q = (filter.value||'').trim().toLowerCase();
        selectedElements.forEach((it, idx) => {
          try{
            if(q) {
              const hay = (it.selector + ' ' + it.snippet).toLowerCase(); if(hay.indexOf(q) === -1) return;
            }
            const row = document.createElement('div'); row.className = 'explorer-row'; row.style.display='flex'; row.style.alignItems='center'; row.style.justifyContent='space-between'; row.style.padding='6px'; row.style.borderRadius='6px'; row.style.background='rgba(255,255,255,0.01)';
            // clicking the row opens the editor modal for editing this snippet
            row.addEventListener('click', (ev) => {
              try {
                ev.stopPropagation();
                // ensure palette selection updated
                try { setSelectedPalette(it.selector); } catch(e){}
                // Open the editor modal directly for this selector
                try { openExplorerItemEditor(it.selector); } catch(e) { console.warn('openExplorerItemEditor failed', e); showMessage('Could not open editor', 'Error'); }
              } catch(e) { console.warn('Explorer row click failed', e); }
            });
            const left = document.createElement('div'); left.style.display='flex'; left.style.flexDirection='column'; left.style.gap='4px'; left.style.flex='1';
            const title = document.createElement('div'); title.textContent = it.selector; title.style.fontWeight = '700'; title.style.color = '#d8f0ff'; title.style.fontSize = '13px';
            const snippet = document.createElement('div'); snippet.textContent = it.snippet; snippet.style.fontSize='12px'; snippet.style.color='#9fb6d6'; snippet.style.overflow='hidden'; snippet.style.textOverflow='ellipsis'; snippet.style.whiteSpace='nowrap';
            // color swatch & left border
            try {
              if(it.color) {
                row.style.borderLeft = `4px solid ${it.color}`;
                row.style.paddingLeft = '10px';
                const sw = document.createElement('span'); sw.style.display='inline-block'; sw.style.width='12px'; sw.style.height='12px'; sw.style.borderRadius='3px'; sw.style.marginRight='8px'; sw.style.background = it.color; sw.title = it.color;
                title.prepend(sw);
              }
            } catch(e) {}
            left.appendChild(title); left.appendChild(snippet);
            const actions = document.createElement('div'); actions.style.display='flex'; actions.style.gap='6px';
            const focusBtn = document.createElement('button'); focusBtn.className='btn small'; focusBtn.textContent='Focus'; focusBtn.addEventListener('click', (ev)=>{ ev.stopPropagation(); try { focusExplorerElement(it.selector); } catch(e){} });
            const mapBtn = document.createElement('button'); mapBtn.className='btn small primary'; mapBtn.textContent='Map'; mapBtn.title = 'Map currently-selected variable to this element (click palette handle first)';
            mapBtn.addEventListener('click', async (ev) => {
              ev.stopPropagation();
              try {
                if (!connectingField) { try { showMessage('Click a variable handle in the palette first to start mapping.', 'Notice'); } catch(e){} return; }
                const pf = document.getElementById('previewFrame'); if(!pf) { try { showMessage('Preview frame not available', 'Error'); } catch(e){} return; }
                let idoc = null; try { idoc = pf.contentDocument || (pf.contentWindow && pf.contentWindow.document); } catch(e) { idoc = null; }
                if(!idoc) { try { showMessage('Cannot access preview document (cross-origin?)', 'Error'); } catch(e){} return; }
                let target = null;
                try { target = idoc.querySelector(it.selector); } catch(e) { target = null; }
                if(!target) { try { showMessage('Could not find the element in preview for selector: ' + it.selector, 'Warning'); } catch(e){} return; }

                // If connectingField is a parent API (no dot) -> wrap element in {{#each api}} .. {{/each}}
                const isParentApi = typeof connectingField === 'string' && connectingField.indexOf('.') === -1;
                if (isParentApi) {
                  try {
                    const apiName = connectingField;
                    const editorText = editorCm ? editorCm.getValue() : (document.getElementById('pageEditor') && document.getElementById('pageEditor').value) || '';
                    const match = findMatchingIndexes(target, editorText);
                    if(!match) { try { showMessage('Could not map element to editor HTML for wrapping.', 'Warning'); } catch(e){} return; }
                    const original = editorText.slice(match.start, match.end);
                    const wrapped = `{{#each ${apiName}}}\n${original}\n{{/each}}`;
                    // Try robust DOM-based replacement first
                    let ok = patchEditorReplaceSnippet(original, wrapped, { autoSave: true });
                    if(!ok) {
                      const newText = editorText.slice(0, match.start) + wrapped + editorText.slice(match.end);
                      if(window.__setEditorValue && typeof window.__setEditorValue === 'function') window.__setEditorValue(newText);
                      else if(editorCm) editorCm.setValue(newText);
                      else { const ta = document.getElementById('pageEditor'); if(ta) ta.value = newText; }
                    }

                    // create mapping for the parent API to this element
                    createMapping(apiName, target);
                    try { drawConnection(apiName, connectingAPINode || document.querySelector(`[data-api-name="${apiName}"]`), target); } catch(e) {}
                    cancelConnectMode();

                    // re-render preview from updated editor content
                    try {
                      const pf2 = document.getElementById('previewFrame');
                      if(pf2) {
                        const rendered = await renderTemplateForPreviewAsync(newText, window.latestAggregatedData || {});
                        pf2.srcdoc = sanitizeHtmlForPreview(rendered || newText);
                        pf2.onload = () => { try { attachHandlersToDoc(pf2.contentDocument || pf2.contentWindow.document); } catch(e){} };
                      }
                    } catch(e) {}
                    return;
                  } catch(e) { console.warn('Parent API mapping failed', e); try { showMessage('Mapping failed', 'Error'); } catch(_){} return; }
                }

                // Field mapping (api.field)
                try {
                  createMapping(connectingField, target);
                  try { drawConnection(connectingField, connectingAPINode, target); } catch(e) {}
                  cancelConnectMode();
                  try { showMessage('Mapped ' + connectingField + ' → ' + it.selector, 'Success'); } catch(e) {}
                } catch(e) { console.warn('Field mapping failed', e); try { showMessage('Mapping failed', 'Error'); } catch(_){} }
              } catch (e) { console.warn('mapBtn handler failed', e); }
            });
            const editBtn = document.createElement('button'); editBtn.className='btn small'; editBtn.textContent='Edit'; editBtn.title = 'Edit selected HTML snippet'; editBtn.addEventListener('click', (ev)=>{ ev.stopPropagation(); try{ openExplorerItemEditor(it.selector); }catch(e){ console.warn(e);} });

            const removeBtn = document.createElement('button'); removeBtn.className='btn small ghost'; removeBtn.textContent='Remove'; removeBtn.addEventListener('click', (ev)=>{ ev.stopPropagation();
              // remove preview inline styles
              try {
                const pf = document.getElementById('previewFrame'); if(pf){ const idoc = pf.contentDocument || (pf.contentWindow && pf.contentWindow.document); if(idoc){ const el = idoc.querySelector(it.selector); if(el){ try{ el.style.outline = ''; el.style.boxShadow = ''; el.removeAttribute('data-ab-color'); }catch(e){} } } }
              } catch(e) {}
              selectedElements = selectedElements.filter(s => s.selector !== it.selector); window.__selectedElements = selectedElements; renderElementExplorer();
            });
            actions.appendChild(focusBtn); actions.appendChild(mapBtn); actions.appendChild(editBtn); actions.appendChild(removeBtn);
            row.appendChild(left); row.appendChild(actions);
            listWrap.appendChild(row);
          }catch(e){/* per-item best-effort */}
        });
        container.appendChild(listWrap);
      } catch(e){ console.warn('renderElementExplorer failed', e); }
    }

    function focusExplorerElement(selector) {
      try {
        const pf = document.getElementById('previewFrame'); if(!pf) return;
        const idoc = pf.contentDocument || (pf.contentWindow && pf.contentWindow.document);
        if(!idoc) return;
        let el = null;
        try { el = idoc.querySelector(selector); } catch(e) {}
        if(!el) {
          // try matching by attribute fallback (#data-ab-id)
          const sel = selector.replace(/\"/g, '\\"');
          try { el = idoc.querySelector(selector); } catch(e) { el = null; }
        }
        if(el) {
          try {
            // colorized focus if available
            const se = selectedElements.find(s=>s.selector===selector);
            const color = se && se.color ? se.color : null;
            if(color) {
              const prev = el.getAttribute('data-ab-prev-outline');
              try { el.setAttribute('data-ab-prev-outline', el.style.outline || ''); } catch(e){}
              try { el.style.outline = `3px solid ${color}`; el.style.boxShadow = `0 10px 30px ${se.fade || 'rgba(0,0,0,0.12)'}`; } catch(e){}
              el.scrollIntoView({ behavior: 'smooth', block: 'center' });
              setTimeout(()=>{ try{ el.style.outline = el.getAttribute('data-ab-prev-outline') || ''; el.style.boxShadow = ''; el.removeAttribute('data-ab-prev-outline'); }catch(_){} }, 2000);
            } else {
              el.classList.add('ab-selected'); el.scrollIntoView({ behavior: 'smooth', block: 'center' }); setTimeout(()=>{ try{ el.classList.remove('ab-selected'); }catch(_){} }, 2000);
            }
          } catch(e){}
        }
      } catch(e) { console.warn('focusExplorerElement failed', e); }
    }

    // Apply stored colors to elements inside the preview iframe (idempotent)
    function applyColorsToPreview() {
      try {
        const pf = document.getElementById('previewFrame'); if(!pf) return;
        const idoc = pf.contentDocument || (pf.contentWindow && pf.contentWindow.document);
        if(!idoc) return;
        selectedElements.forEach(se => {
          try {
            if(!se || !se.selector) return;
            const el = idoc.querySelector(se.selector);
            if(!el) return;
            try { el.setAttribute('data-ab-color', se.color || ''); } catch(e){}
            try { el.style.outline = se.color ? `3px solid ${se.color}` : ''; } catch(e){}
            try { el.style.boxShadow = se.fade ? `0 10px 30px ${se.fade}` : ''; } catch(e){}
            try { el.style.borderRadius = el.style.borderRadius || '6px'; } catch(e){}
          } catch(e) {}
        });
      } catch(e) { console.warn('applyColorsToPreview failed', e); }
    }

    // Reset Element Explorer state when a new page is loaded
    function resetElementExplorer() {
      try {
        // clear stored selections
        selectedElements = [];
        window.__selectedElements = selectedElements;

        // remove any connection paths and reset connections map
        try {
          Object.keys(connections || {}).forEach(k => {
            try { if(connections[k] && connections[k].path) connections[k].path.remove(); } catch(e){}
          });
        } catch(e){}
        connections = {};

        // clear svg overlay content
        try {
          const svg = document.getElementById('connectorSvg'); if(svg) svg.innerHTML = '';
        } catch(e){}

        // clear explorer UI
        try { const container = document.getElementById('elementExplorer'); if(container) container.innerHTML = ''; } catch(e){}

        // clear any inline highlights in the preview (best-effort)
        try {
          const pf = document.getElementById('previewFrame');
          if(pf) {
            const idoc = pf.contentDocument || (pf.contentWindow && pf.contentWindow.document);
            if(idoc) {
              try { Array.from(idoc.querySelectorAll('[data-ab-color]')).forEach(n=>{ try{ n.style.outline=''; n.style.boxShadow=''; n.removeAttribute('data-ab-color'); }catch(e){} }); } catch(e){}
              try { Array.from(idoc.querySelectorAll('.ab-hover, .ab-selected')).forEach(n=>{ try{ n.classList.remove('ab-hover'); n.classList.remove('ab-selected'); }catch(e){} }); } catch(e){}
            }
          }
        } catch(e) {}

        // re-render explorer UI (shows empty state)
        try { renderElementExplorer(); } catch(e){}
      } catch(e) { console.warn('resetElementExplorer failed', e); }
    }

    // Open editor modal for an explorer item, allow editing snippet and saving to page/editor
    function openExplorerItemEditor(selector) {
      try {
        const se = selectedElements.find(s=>s.selector === selector);
        if(!se) { showMessage('Selected element not found', 'Error'); return; }

        // attempt to mark the corresponding range in the editor for clarity
        try {
          const pf = document.getElementById('previewFrame');
          if(pf) {
            const idoc = pf.contentDocument || (pf.contentWindow && pf.contentWindow.document);
            if(idoc) {
              const target = idoc.querySelector(selector);
              if(target) {
                const editorText = (window.__getEditorValue && typeof window.__getEditorValue === 'function') ? window.__getEditorValue() : (editorCm ? editorCm.getValue() : (document.getElementById('pageEditor') && document.getElementById('pageEditor').value) || '');
                const match = findMatchingIndexes(target, editorText);
                if(match) { try { markRangeInEditor(match.start, match.end); } catch(e){} }
              }
            }
          }
        } catch(e) { /* non-fatal */ }

        const textareaId = 'explorerEditArea';
        const html = `<div style="display:flex;flex-direction:column;gap:8px;min-width:560px;max-width:960px;">
          <label style="font-weight:600">Selector: <code style="font-size:12px">${escapeHtml(selector)}</code></label>
          <textarea id="${textareaId}" style="min-height:240px;width:100%;font-family:monospace;font-size:12px;padding:8px;border-radius:6px;border:1px solid rgba(255,255,255,0.05)">${escapeHtml(se.snippet)}</textarea>
          <div style="display:flex;gap:8px;justify-content:flex-end"><button id="explorerEditCancel" class="btn">Cancel</button><button id="explorerEditSave" class="btn primary">Save</button></div>
        </div>`;

        if(window.AppUtils && AppUtils.Modal) {
          AppUtils.Modal.show({ title: `Edit element: ${selector}`, body: html });
          setTimeout(()=>{
            const ta = document.getElementById(textareaId);
            const btnSave = document.getElementById('explorerEditSave');
            const btnCancel = document.getElementById('explorerEditCancel');
            if(btnCancel) btnCancel.onclick = ()=> { try{ AppUtils.Modal.hide(); }catch(e){} };
            if(btnSave) btnSave.onclick = async () => {
              try {
                const newSnippet = ta ? ta.value : se.snippet;
                // Update editor: find matching indexes for selector in editor text via preview element
                const pf = document.getElementById('previewFrame'); if(!pf) { showMessage('Preview not available', 'Error'); return; }
                const idoc = pf.contentDocument || (pf.contentWindow && pf.contentWindow.document);
                if(!idoc) { showMessage('Cannot access preview document', 'Error'); return; }
                const target = idoc.querySelector(selector);
                if(!target) { showMessage('Could not locate element in preview', 'Warning'); return; }

                const editorText = (window.__getEditorValue && typeof window.__getEditorValue === 'function') ? window.__getEditorValue() : (editorCm ? editorCm.getValue() : (document.getElementById('pageEditor') && document.getElementById('pageEditor').value) || '');
                const match = findMatchingIndexes(target, editorText);
                if(!match) {
                  // open match picker to let user select exact location
                  const picked = showMatchPicker(target, editorText, (start, end) => {
                    try {
                      const original = editorText.slice(start, end);
                      const patched = patchEditorReplaceSnippet(original, newSnippet, { autoSave: true });
                      if(!patched) {
                        const newText = editorText.slice(0, start) + newSnippet + editorText.slice(end);
                        if(window.__setEditorValue && typeof window.__setEditorValue === 'function') window.__setEditorValue(newText);
                        else if(editorCm) editorCm.setValue(newText);
                        else { const taEd = document.getElementById('pageEditor'); if(taEd) taEd.value = newText; }
                      }
                      se.snippet = newSnippet.length > 220 ? newSnippet.slice(0,220) + '…' : newSnippet;
                      renderElementExplorer(); applyColorsToPreview();
                      showMessage('Saved snippet (manual selection)', 'Saved');
                    } catch(e) { console.warn('manual match patch failed', e); showMessage('Save failed', 'Error'); }
                  });
                  if(!picked) { showMessage('Could not locate corresponding HTML in editor. Edit manually.', 'Warning'); }
                  return;
                }

                const original = editorText.slice(match.start, match.end);
                // Use DOM-based replacement to avoid duplication
                let patched = patchEditorReplaceSnippet(original, newSnippet, { autoSave: true });
                if(!patched) {
                  const newText = editorText.slice(0, match.start) + newSnippet + editorText.slice(match.end);
                  if(window.__setEditorValue && typeof window.__setEditorValue === 'function') window.__setEditorValue(newText);
                  else if(editorCm) editorCm.setValue(newText);
                  else { const taEd = document.getElementById('pageEditor'); if(taEd) taEd.value = newText; }
                }

                // update stored snippet and reapply colors after preview update
                se.snippet = newSnippet.length > 220 ? newSnippet.slice(0,220) + '…' : newSnippet;
                window.__selectedElements = selectedElements;

                // re-render preview
                try {
                  const rendered = await renderTemplateForPreviewAsync(newText, window.latestAggregatedData || {});
                  pf.srcdoc = sanitizeHtmlForPreview(rendered || newText);
                  pf.onload = () => { try { attachHandlersToDoc(pf.contentDocument || pf.contentWindow.document); applyColorsToPreview(); } catch(e){} };
                } catch(e) { /* best-effort */ }

                try { AppUtils.Modal.hide(); } catch(e) {}
                renderElementExplorer();
                showMessage('Saved snippet and updated preview', 'Saved');
              } catch(e) { console.error('Explorer edit save failed', e); showMessage('Save failed', 'Error'); }
            };
          }, 50);
        } else {
          // fallback simple prompt
          const newSnippet = prompt('Edit snippet for ' + selector, se.snippet);
          if(newSnippet != null) {
            // attempt to patch editor similarly (best-effort)
            try {
              const pf = document.getElementById('previewFrame'); const idoc = pf && (pf.contentDocument || (pf.contentWindow && pf.contentWindow.document)); const target = idoc && idoc.querySelector(selector);
              const editorText = (window.__getEditorValue && typeof window.__getEditorValue === 'function') ? window.__getEditorValue() : (editorCm ? editorCm.getValue() : (document.getElementById('pageEditor') && document.getElementById('pageEditor').value) || '');
              const match = target ? findMatchingIndexes(target, editorText) : null;
              if(match) {
                const original = editorText.slice(match.start, match.end);
                const patched = patchEditorReplaceSnippet(original, newSnippet, { autoSave: true });
                if(!patched) {
                  const newText = editorText.slice(0, match.start) + newSnippet + editorText.slice(match.end);
                  if(window.__setEditorValue && typeof window.__setEditorValue === 'function') window.__setEditorValue(newText);
                  else if(editorCm) editorCm.setValue(newText);
                  else { const taEd = document.getElementById('pageEditor'); if(taEd) taEd.value = newText; }
                }
                se.snippet = newSnippet.length > 220 ? newSnippet.slice(0,220) + '…' : newSnippet;
                renderElementExplorer(); applyColorsToPreview();
                showMessage('Saved snippet', 'Saved');
              } else {
                showMessage('Could not update editor automatically. Please edit manually.', 'Warning');
              }
            } catch(e) { console.warn(e); showMessage('Save failed', 'Error'); }
          }
        }
      } catch(e) { console.warn('openExplorerItemEditor failed', e); showMessage('Could not open editor', 'Error'); }
    }

    function attachHandlersToDoc(doc) {
      if(!doc) return;

      // Inject highlight styles (idempotent)
      try {
        if (!doc.getElementById('ab-preview-highlights')) {
          const s = doc.createElement('style');
          s.id = 'ab-preview-highlights';
          s.textContent = `
            .ab-hover { outline: 3px solid rgba(34,197,94,0.95) !important; background: rgba(34,197,94,0.06) !important; box-shadow: 0 8px 24px rgba(34,197,94,0.08) !important; border-radius: 6px !important; }
            .ab-selected { outline: 3px solid rgba(34,197,94,1) !important; background: rgba(34,197,94,0.08) !important; box-shadow: 0 10px 30px rgba(34,197,94,0.12) !important; border-radius: 6px !important; }
          `;
          try { (doc.head || doc.documentElement).appendChild(s); } catch(e) { try { doc.documentElement.appendChild(s); } catch(_){} }
        }
      } catch (e) { /* ignore style injection errors (cross-origin) */ }

      let lastHover = null;
      let lastSelected = null;

      function clearHoverLocal() {
        try { if(lastHover && lastHover.classList) lastHover.classList.remove('ab-hover'); lastHover = null; } catch(e) {}
      }

      // Hover: highlight element under pointer (single element only)
      doc.addEventListener('mouseover', (ev) => {
        try {
          const t = ev.target;
          if (!t || t.nodeType !== 1) return;
          if (lastHover && lastHover !== t) { try { lastHover.classList.remove('ab-hover'); } catch(e) {} }
          lastHover = t;
          try { t.classList.add('ab-hover'); } catch(e) {}
          // Map to editor highlighting as well (best-effort)
          try { handlePreviewHover(t); } catch(e) {}
        } catch (e) { /* ignore */ }
      }, true);

      doc.addEventListener('mouseout', (ev) => {
        try { const t = ev.target; if (t && t.nodeType === 1 && t === lastHover) { try { t.classList.remove('ab-hover'); } catch(e){} lastHover = null; } } catch(e){}
      }, true);

      // Click: if ctrl/meta pressed -> allow native action (perform click); otherwise treat as selection/highlight only
      doc.addEventListener('click', (ev) => {
        try {
          const t = ev.target;
          if (!t || t.nodeType !== 1) return;

          // If we are in connector mode, handle mapping clicks specially
          if (window.connectingKind || typeof connectingKind !== 'undefined' && connectingKind) {
            ev.preventDefault(); ev.stopPropagation();
            try {
              if (connectingKind === 'field') {
                const target = t.closest('input,textarea,select,button');
                if (!target) { cancelConnectMode(); return; }
                createMapping(connectingField, target);
                drawConnection(connectingField, connectingAPINode, target);
                cancelConnectMode();
                return;
              } else if (connectingKind === 'method') {
                const target = t.closest('input[type="submit"],button[type="submit"],button:not([type]),input[type="button"],button[type="button"]');
                if (!target) { cancelConnectMode(); return; }
                connections.methods = connections.methods || {};
                connections.methods[connectingKey] = { element: target, selector: getElementSelector(target) };
                try { target.classList.add('mapped'); } catch(e) {}
                drawConnection(connectingKey, connectingAPINode, target);
                cancelConnectMode();
                return;
              }
            } catch (e) { cancelConnectMode(); return; }
          }

          // If user held ctrl or meta, allow the click to proceed (perform action)
          if (ev.ctrlKey || ev.metaKey) {
            try { clearHoverLocal(); } catch(e){}
            return;
          }

          // Otherwise intercept and use as selector: prevent navigation/actions
          ev.preventDefault(); ev.stopPropagation();

          // Clear previous selected marker
          try { if (lastSelected && lastSelected !== t && lastSelected.classList) lastSelected.classList.remove('ab-selected'); } catch(e) {}
          lastSelected = t;
          try { t.classList.add('ab-selected'); } catch(e) {}

          // Also map to editor selection
          try { handlePreviewClick(t); } catch(e) {}
        } catch (e) { /* ignore */ }
      }, true);

      // Allow dropping API/palette items onto preview elements
      doc.addEventListener('dragover', (ev) => {
        try { ev.preventDefault(); } catch(e) {}
      }, true);

      doc.addEventListener('drop', async (ev) => {
        try {
          ev.preventDefault(); ev.stopPropagation();
          const jsonData = ev.dataTransfer.getData('application/json');
          const textData = ev.dataTransfer.getData('text/plain');
          let payload = null;
          if(jsonData) {
            try { payload = JSON.parse(jsonData); } catch(e) { payload = null; }
          }

          const x = ev.clientX; const y = ev.clientY;
          let target = ev.target;
          try {
            // elementFromPoint within iframe doc coordinates
            const elAt = doc.elementFromPoint(x, y);
            if(elAt) target = elAt;
          } catch (e) {}

          // If payload indicates an API insert (top-level with apiName), wrap the target element with an each loop
          if(payload && payload.apiName) {
            const apiName = payload.apiName;
            const editorText = (window.__getEditorValue && typeof window.__getEditorValue === 'function') ? window.__getEditorValue() : (editorCm ? editorCm.getValue() : (document.getElementById('pageEditor') && document.getElementById('pageEditor').value) || '');
            const match = findMatchingIndexes(target, editorText);
            if(!match) {
              try { showMessage('Could not locate corresponding HTML in editor for this drop target.', 'Warning'); } catch(e){}
              return;
            }

            // Avoid double-wrapping if already inside same each
            const beforeSnippet = editorText.slice(Math.max(0, match.start - 200), match.start);
            if(beforeSnippet.includes('{{#each') && beforeSnippet.includes(apiName)) {
              try { showMessage('Target already appears to be inside a loop for this API.', 'Notice'); } catch(e){}
              return;
            }

            const original = editorText.slice(match.start, match.end);
            const wrapped = `{{#each ${apiName}}}\n${original}\n{{/each}}`;
            // Attempt DOM-based replacement first
            let didReplace = patchEditorReplaceSnippet(original, wrapped, { autoSave: true });
            if(!didReplace) {
              const newText = editorText.slice(0, match.start) + wrapped + editorText.slice(match.end);
              try {
                if(window.__setEditorValue && typeof window.__setEditorValue === 'function') {
                  window.__setEditorValue(newText);
                } else if (editorCm) {
                  editorCm.setValue(newText);
                } else {
                  const ta = document.getElementById('pageEditor'); if(ta) ta.value = newText;
                }
              } catch(e){ console.warn('Failed to update editor value', e); }
            }

            // Update live patch preview panel if present
            try { const codeEl = document.getElementById('livePatchCode'); if(codeEl) codeEl.textContent = wrapped; } catch(e){}

            // Re-render preview from updated editor content
            try {
              const pf = document.getElementById('previewFrame');
              if(pf) {
                const rendered = await renderTemplateForPreviewAsync(newText, window.latestAggregatedData || {});
                pf.srcdoc = sanitizeHtmlForPreview(rendered || newText);
                // Re-attach handlers after load
                pf.onload = () => { try { attachHandlersToDoc(pf.contentDocument || pf.contentWindow.document); } catch(e){} };
              }
            } catch(e) { console.warn('Preview update failed', e); }
            return;
          }

          // If payload is a simple field drop (text/plain contains handlebars), insert into target's innerText location
          if(textData && textData.indexOf('{{') !== -1) {
            try {
              const insertText = textData;
              // We will try to patch the editor's matched node content: find match and replace inner portion
              const editorText = (window.__getEditorValue && typeof window.__getEditorValue === 'function') ? window.__getEditorValue() : (editorCm ? editorCm.getValue() : (document.getElementById('pageEditor') && document.getElementById('pageEditor').value) || '');
              const match = findMatchingIndexes(target, editorText);
              if(!match) { try { showMessage('Could not map field drop to editor HTML.', 'Warning'); } catch(e){} return; }
              const original = editorText.slice(match.start, match.end);
              // Insert inside the element: replace innerHTML roughly by replacing the first closing of opening tag
              const openingEnd = original.indexOf('>');
              if(openingEnd === -1) return;
              const innerStart = openingEnd + 1;
              const closingIndex = original.lastIndexOf('</');
              const innerEnd = closingIndex === -1 ? original.length : closingIndex;
              const newInner = original.slice(0, innerStart) + insertText + original.slice(innerEnd);
              const newText = editorText.slice(0, match.start) + newInner + editorText.slice(match.end);
              if(window.__setEditorValue && typeof window.__setEditorValue === 'function') window.__setEditorValue(newText); else if(editorCm) editorCm.setValue(newText); else { const ta=document.getElementById('pageEditor'); if(ta) ta.value=newText; }
              try { const codeEl = document.getElementById('livePatchCode'); if(codeEl) codeEl.textContent = insertText; } catch(e){}
              // re-render
              const pf = document.getElementById('previewFrame'); if(pf) { const rendered = await renderTemplateForPreviewAsync(newText, window.latestAggregatedData || {}); pf.srcdoc = sanitizeHtmlForPreview(rendered || newText); pf.onload = () => { try { attachHandlersToDoc(pf.contentDocument || pf.contentWindow.document); } catch(e){} }; }
            } catch(e) { console.warn('Field drop handling failed', e); }
          }

        } catch (e) { console.warn('preview drop handler failed', e); }
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