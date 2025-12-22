const express = require('express');
const path = require('path');
const fs = require('fs');
const os = require('os');
const bodyParser = require('body-parser');
const cors = require('cors');
const axios = require('axios');
const get = require('lodash.get');

// JSONBin.io client for persistent storage on read-only filesystems
const JSONBinClient = require('./jsonbin-client');
let jsonBinClient = null;

// Initialize JSONBin if credentials are provided
if (process.env.JSONBIN_MASTER_KEY) {
  jsonBinClient = new JSONBinClient(
    process.env.JSONBIN_MASTER_KEY,
    process.env.JSONBIN_ACCESS_KEY || null
  );
  console.log('✓ JSONBin.io client initialized (remote storage enabled)');
}

// Load local environment variables from .env when present (useful for local testing)
try { require('dotenv').config(); } catch (e) { /* ignore if dotenv not installed */ }

const app = express();
const PORT = process.env.PORT || 3000;

const ROOT = path.resolve(__dirname);
const WEBSITES_DIR = path.join(ROOT, 'websites');
const DB_FILE = path.join(ROOT, 'api-repo.json');
const MAPPINGS_FILE = path.join(ROOT, 'mappings.json');
const CONFIG_FILE = path.join(ROOT, 'app-config.json');
const TMP_CONFIG_FILE = path.join(os.tmpdir(), 'app-config.json');

// JSONBin storage configuration (bin IDs from environment)
const JSONBIN_CONFIG = {
  enabled: !!jsonBinClient,
  configBinId: process.env.JSONBIN_CONFIG_BIN_ID || null,
  dbBinId: process.env.JSONBIN_DB_BIN_ID || null,
  mappingsBinId: process.env.JSONBIN_MAPPINGS_BIN_ID || null
};

async function readDB() {
  // Use JSONBin if available and configured
  if (JSONBIN_CONFIG.enabled && JSONBIN_CONFIG.dbBinId) {
    try {
      const data = await jsonBinClient.readBin(JSONBIN_CONFIG.dbBinId);
      return data || { sites: [] };
    } catch (err) {
      try { logger && logger.error && logger.error('JSONBin DB read failed, falling back to file: ' + (err && err.message)); } catch (e) { /* ignore */ }
    }
  }

  // Fallback to file-based storage
  try {
    if (!fs.existsSync(DB_FILE)) return { sites: [] };
    const content = fs.readFileSync(DB_FILE, 'utf8');
    return JSON.parse(content || '{"sites":[]}');
  } catch (err) {
    try { logger && logger.error && logger.error('Error reading DB file: ' + (err && err.message)); } catch (e) { /* ignore */ }
    return { sites: [] };
  }
}

async function writeDB(db) {
  // Use JSONBin if available and configured
  if (JSONBIN_CONFIG.enabled && JSONBIN_CONFIG.dbBinId) {
    try {
      await jsonBinClient.updateBin(JSONBIN_CONFIG.dbBinId, db);
      return true;
    } catch (err) {
      try { logger && logger.error && logger.error('JSONBin DB write failed: ' + (err && err.message)); } catch (e) { /* ignore */ }
      throw err;
    }
  }

  // Fallback to file-based storage
  try {
    fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2));
    return true;
  } catch (err) {
    try { logger && logger.error && logger.error('Error writing DB file: ' + (err && err.message)); } catch (e) { /* ignore */ }
    throw err;
  }
}

// Normalize various incoming params shapes to a plain object { key: value }
function normalizeParams(params) {
  // If nothing provided, return empty object
  if (!params) return {};
  // If already an object (and not an array), coerce keys to strings and trim
  if (typeof params === 'object' && !Array.isArray(params)) {
    const out = {};
    Object.keys(params).forEach(k => {
      if (k == null) return;
      const key = String(k).trim();
      if (!key) return;
      const v = params[k];
      // prefer primitive string/number/boolean; stringify objects
      out[key] = (v === undefined || v === null) ? '' : (typeof v === 'object' ? JSON.stringify(v) : v);
    });
    return out;
  }
  // If an array of pairs provided (e.g. [{key, value}] or [[k,v],...]) convert to object
  if (Array.isArray(params)) {
    const out = {};
    params.forEach(item => {
      if (!item) return;
      if (Array.isArray(item) && item.length >= 2) {
        const k = String(item[0]).trim(); if (!k) return; out[k] = item[1];
      } else if (typeof item === 'object') {
        // support { key, value } or { name, value }
        const k = (item.key || item.name || item.param || item.k);
        if (!k) return;
        const key = String(k).trim(); if (!key) return;
        out[key] = item.value || item.v || '';
      }
    });
    return out;
  }
  // For primitive types, return empty map
  return {};
}

async function readConfig() {
  // Use JSONBin if available and configured
  if (JSONBIN_CONFIG.enabled && JSONBIN_CONFIG.configBinId) {
    try {
      const data = await jsonBinClient.readBin(JSONBIN_CONFIG.configBinId);
      return data || { productionFolder: 'production', activePrototype: null };
    } catch (err) {
      try { logger && logger.warn && logger.warn('JSONBin config read failed, falling back to file: ' + (err && err.message)); } catch (e) { /* ignore */ }
    }
  }

  // Fallback to file-based storage
  try {
    if (!fs.existsSync(CONFIG_FILE)) {
      const def = { productionFolder: 'production', activePrototype: null };
      try {
        fs.writeFileSync(CONFIG_FILE, JSON.stringify(def, null, 2));
      } catch (e) {
        try {
          // fall back to temp dir (ephemeral on serverless platforms)
          fs.writeFileSync(TMP_CONFIG_FILE, JSON.stringify(def, null, 2));
          logger && logger.warn && logger.warn('Config file not writable in project root; using tmp fallback: ' + TMP_CONFIG_FILE);
        } catch (e2) {
          /* ignore write errors */
        }
      }
      return def;
    }
    const content = fs.readFileSync(CONFIG_FILE, 'utf8');
    return JSON.parse(content || '{}');
  } catch (err) {
    try { logger && logger.warn && logger.warn('Could not read config file: ' + (err && err.message)); } catch (e) { /* ignore */ }
    // Try reading from temp fallback if available
    try {
      if (fs.existsSync(TMP_CONFIG_FILE)) {
        const tmpContent = fs.readFileSync(TMP_CONFIG_FILE, 'utf8');
        return JSON.parse(tmpContent || '{}');
      }
    } catch (e2) {
      try { logger && logger.warn && logger.warn('Could not read tmp config file: ' + (e2 && e2.message)); } catch (e3) { /* ignore */ }
    }
    return { productionFolder: 'production', activePrototype: null };
  }
}

async function writeConfig(cfg) {
  // Use JSONBin if available and configured
  if (JSONBIN_CONFIG.enabled && JSONBIN_CONFIG.configBinId) {
    try {
      await jsonBinClient.updateBin(JSONBIN_CONFIG.configBinId, cfg);
      return true;
    } catch (err) {
      try { logger && logger.warn && logger.warn('JSONBin config write failed: ' + (err && err.message)); } catch (e) { /* ignore */ }
      return false;
    }
  }

  // Fallback to file-based storage
  try {
    fs.writeFileSync(CONFIG_FILE, JSON.stringify(cfg, null, 2));
    return true;
  } catch (err) {
    try { logger && logger.warn && logger.warn('Could not write config file: ' + (err && err.message)); } catch (e) { /* ignore */ }
    // Try writing to temp fallback (ephemeral storage on serverless)
    try {
      fs.writeFileSync(TMP_CONFIG_FILE, JSON.stringify(cfg, null, 2));
      logger && logger.warn && logger.warn('Wrote config to tmp fallback: ' + TMP_CONFIG_FILE);
      return true;
    } catch (err2) {
      try { logger && logger.warn && logger.warn('Could not write tmp config file: ' + (err2 && err2.message)); } catch (e) { /* ignore */ }
      return false;
    }
  }
}

app.use(cors());
app.use(bodyParser.json({ limit: '1mb' }));
// Provide the `extended` option to urlencoded to avoid deprecation warnings
app.use(bodyParser.urlencoded({ extended: true }));

// logging
const logger = require('./logger');
app.use(logger.requestLogger);

// endpoint to receive client-side logs
app.post('/api/logs', (req, res) => {
  const { level, message, meta } = req.body || {};
  const m = meta ? `${message} | meta: ${JSON.stringify(meta)}` : message;
  if(level === 'error') logger.error(m); else if(level === 'warn') logger.warn(m); else logger.info(m);
  res.json({ ok: true });
});

// ensure folders (make best-effort; on serverless platforms writing to
// the deployment folder may be read-only — fall back gracefully)
try {
  if (!fs.existsSync(WEBSITES_DIR)) fs.mkdirSync(WEBSITES_DIR, { recursive: true });
} catch (err) {
  console.warn('Warning: cannot create WEBSITES_DIR during startup:', err && err.message);
}
try {
  if (!fs.existsSync(DB_FILE)) fs.writeFileSync(DB_FILE, JSON.stringify({ sites: [] }, null, 2));
} catch (err) {
  console.warn('Warning: cannot write DB_FILE during startup:', err && err.message);
}
try {
  if (!fs.existsSync(MAPPINGS_FILE)) fs.writeFileSync(MAPPINGS_FILE, JSON.stringify({ sites: {} }, null, 2));
} catch (err) {
  console.warn('Warning: cannot write MAPPINGS_FILE during startup:', err && err.message);
}
// Read mappings file with validation and safe recovery
async function readMappings() {
  // Use JSONBin if available and configured
  if (JSONBIN_CONFIG.enabled && JSONBIN_CONFIG.mappingsBinId) {
    try {
      const data = await jsonBinClient.readBin(JSONBIN_CONFIG.mappingsBinId);
      if (!data.sites) data.sites = {};
      return data;
    } catch (err) {
      try { logger && logger.error && logger.error('JSONBin mappings read failed, falling back to file: ' + (err && err.message)); } catch (e) { /* ignore */ }
    }
  }

  // Fallback to file-based storage
  try {
    if (!fs.existsSync(MAPPINGS_FILE)) {
      logger && logger.warn && logger.warn('Mappings file does not exist, creating default structure');
      const defaultMappings = { sites: {} };
      await writeMappings(defaultMappings);
      return defaultMappings;
    }

    const content = fs.readFileSync(MAPPINGS_FILE, 'utf8');

    // Basic validation - check if it starts with '{'
    if (!content || !content.trim().startsWith('{')) {
      throw new Error('File does not appear to be valid JSON');
    }

    const parsed = JSON.parse(content);

    if (!parsed || typeof parsed !== 'object') {
      throw new Error('Parsed content is not a valid object');
    }

    if (!parsed.sites) parsed.sites = {};
    return parsed;
  } catch (err) {
    logger && logger.error && logger.error(`Error reading mappings file: ${err && err.message}`);
    // Try to backup corrupted file
    try {
      if (fs.existsSync(MAPPINGS_FILE)) {
        const backupFile = MAPPINGS_FILE + '.backup.' + Date.now();
        fs.copyFileSync(MAPPINGS_FILE, backupFile);
        logger && logger.info && logger.info(`Backed up corrupted mappings file to: ${backupFile}`);
      }
    } catch (backupErr) {
      logger && logger.error && logger.error(`Error backing up corrupted file: ${backupErr && backupErr.message}`);
    }

    const defaultMappings = { sites: {} };
    try { await writeMappings(defaultMappings); logger && logger.info && logger.info('Created new default mappings file'); } catch (writeErr) { logger && logger.error && logger.error(`Error creating default mappings file: ${writeErr && writeErr.message}`); }
    return defaultMappings;
  }
}

async function writeMappings(mappings) {
  // Use JSONBin if available and configured
  if (JSONBIN_CONFIG.enabled && JSONBIN_CONFIG.mappingsBinId) {
    try {
      await jsonBinClient.updateBin(JSONBIN_CONFIG.mappingsBinId, mappings);
      return true;
    } catch (err) {
      logger.error(`JSONBin mappings write failed: ${err.message}`);
      throw err;
    }
  }

  // Fallback to file-based storage
  try {
    const tempFile = MAPPINGS_FILE + '.tmp';
    // Write to temporary file first
    fs.writeFileSync(tempFile, JSON.stringify(mappings, null, 2));
    // Then atomically rename it
    fs.renameSync(tempFile, MAPPINGS_FILE);
  } catch (err) {
    logger.error(`Error writing mappings file: ${err.message}`);
    // Clean up temp file if it exists
    try {
      if (fs.existsSync(MAPPINGS_FILE + '.tmp')) {
        fs.unlinkSync(MAPPINGS_FILE + '.tmp');
      }
    } catch (cleanupErr) {
      logger.error(`Error cleaning up temp file: ${cleanupErr.message}`);
    }
    throw err;
  }
}

// Serve admin UI
app.get('/admin', (req, res) => {
  res.sendFile(path.join(ROOT, 'admin.html'));
});

// Serve favicon for main app
app.get('/favicon.ico', (req, res) => {
  res.sendFile(path.join(ROOT, 'favicon.ico'));
});

// Serve favicon for individual sites (dynamic from their root folder, fallback to main)
app.get('/site/:siteName/favicon.ico', (req, res) => {
  const siteName = req.params.siteName;
  const siteFavicon = path.join(WEBSITES_DIR, siteName, 'favicon.ico');
  if (fs.existsSync(siteFavicon)) {
    res.sendFile(siteFavicon);
  } else {
    res.sendFile(path.join(ROOT, 'favicon.ico'));
  }
});

// Serve any HTML file in root directory dynamically by filename (e.g. /rest-client -> rest-client.html)
app.get('/:page', (req, res, next) => {
  const page = req.params.page;
  // Skip if this looks like an API route or other special route
  if (page.startsWith('api') || page === 'admin' || page === 'favicon.ico' || page === 'site' || page === 'website') {
    return next();
  }
  // Only allow valid filename characters for .html files in root, block directory traversal
  if (!/^[\w\-\.]+$/.test(page)) return res.status(400).send('Invalid page name');

  // Handle both /pagename and /pagename.html requests
  let fileName = page;
  if (fileName.endsWith('.html')) {
    fileName = fileName.slice(0, -5); // remove .html extension
  }
  const filePath = path.join(ROOT, `${fileName}.html`);
  fs.access(filePath, fs.constants.F_OK, err => {
    if (err) return next(); // fallback to other routes if not found
    res.sendFile(filePath);
  });
});

// Serve static admin assets if present
app.use('/admin-static', express.static(path.join(ROOT, 'admin-static')));

// Serve the whole `websites` folder at /websites so files like websites/index.html
// are addressable at /websites/index.html (helps relative paths resolve correctly)
try{
  if (fs.existsSync(WEBSITES_DIR)) {
    app.use('/websites', express.static(WEBSITES_DIR));
  }
} catch (e) {
  logger && logger.warn && logger.warn('Could not mount /websites static route: ' + (e && e.message));
}

// Serve production files (dynamic) if configured — try to serve files from the configured
// production folder before other app routes so the main domain can serve the production site.
app.use(async (req, res, next) => {
  try {
    const cfg = await readConfig();
    const p = req.path === '/' ? 'index.html' : req.path.replace(/^\//, '');
    // If an activePrototype is configured, prefer serving files from websites/<activePrototype>
    let candidateBase;
    if (cfg && cfg.activePrototype) {
      candidateBase = path.join(WEBSITES_DIR, cfg.activePrototype);
    } else {
      // otherwise serve from the explicit production folder (relative to project root)
      const prodFolder = cfg && cfg.productionFolder ? cfg.productionFolder : 'production';
      candidateBase = path.join(ROOT, prodFolder);
    }
    const candidate = path.join(candidateBase, p);
    if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) {
      // If serving from an active prototype and the file is HTML, render it through templating
      const ext = path.extname(candidate).toLowerCase();
      if (cfg && cfg.activePrototype && (ext === '.html' || ext === '.htm')) {
        try {
          const rendered = await renderSiteHtml(cfg.activePrototype, p);
          if (rendered !== null) {
            res.set('Content-Type', 'text/html');
            return res.send(rendered);
          }
        } catch (e) {
          logger && logger.warn && logger.warn('Error rendering activePrototype HTML: ' + (e && e.message));
          // fallthrough to sendFile as a best-effort fallback
        }
      }
      return res.sendFile(candidate);
    }
  } catch (err) {
    // ignore errors and continue to other routes
    logger && logger.warn && logger.warn('Production serve middleware error: ' + (err && err.message));
  }
  return next();
});

// Admin API
app.get('/api/sites', async (req, res) => {
  const db = await readDB();
  // discover folders under WEBSITES_DIR and ensure entries exist in db
  const folders = fs.existsSync(WEBSITES_DIR) ? fs.readdirSync(WEBSITES_DIR).filter(d => fs.statSync(path.join(WEBSITES_DIR, d)).isDirectory()) : [];
  let changed = false;
  for (const f of folders) {
    if (!db.sites.find(s => s.name === f)) {
      db.sites.push({ name: f, apis: [], mappings: [] });
      changed = true;
    }
  }
  if (changed) await writeDB(db);
  res.json(db.sites);
});

// Return websites/index.html raw content if present (used to render custom prototype list in admin)
app.get('/api/websites-index', (req, res) => {
  try {
    const idx = path.join(WEBSITES_DIR, 'index.html');
    if (fs.existsSync(idx)) {
      const content = fs.readFileSync(idx, 'utf8');
      res.set('Content-Type', 'text/html');
      return res.send(content);
    }

    // If a developer-provided index.html is not present, generate a simple
    // listing of available prototype folders so admin has something to open.
    const folders = fs.existsSync(WEBSITES_DIR) ? fs.readdirSync(WEBSITES_DIR).filter(d => fs.statSync(path.join(WEBSITES_DIR, d)).isDirectory()) : [];
    const html = `<!doctype html><html><head><meta charset="utf-8"><title>Prototypes</title><style>body{font-family:Inter,system-ui,Arial;padding:24px;background:#f7fafc;color:#0f1724}a{color:#2563eb}</style></head><body><h1>Available Prototypes</h1><ul>` + folders.map(f=>`<li><a href="/site/${encodeURIComponent(f)}/">${f}</a> — <a href="/websites/${encodeURIComponent(f)}/">(raw)</a></li>`).join('') + `</ul></body></html>`;
    res.set('Content-Type', 'text/html');
    return res.send(html);
  } catch (err) {
    logger && logger.warn && logger.warn('Could not read websites/index.html: ' + (err && err.message));
    return res.status(500).json({ error: 'could not read' });
  }
});

// Return directory tree for a site (folders and files)
function readTree(dir, baseDir) {
  const items = [];
  for (const name of fs.readdirSync(dir)) {
    const abs = path.join(dir, name);
    const rel = path.relative(baseDir, abs).split('\\').join('/');
    const stat = fs.statSync(abs);
    if (stat.isDirectory()) {
      items.push({ name, path: rel + '/', type: 'dir', children: readTree(abs, baseDir) });
    } else {
      items.push({ name, path: rel, type: 'file' });
    }
  }
  return items;
}

app.get('/api/sites/:siteName/tree', (req, res) => {
  const siteName = req.params.siteName;
  const siteFolder = path.join(WEBSITES_DIR, siteName);
  if (!fs.existsSync(siteFolder)) return res.status(404).json({ error: 'site not found' });
  try {
    const tree = readTree(siteFolder, siteFolder);
    res.json(tree);
  } catch (err) {
    logger.error(err);
    res.status(500).json({ error: String(err.message) });
  }
});

app.post('/api/sites', async (req, res) => {
  const { name } = req.body;
  if (!name) return res.status(400).json({ error: 'name required' });
  const db = await readDB();
  if (db.sites.find(s => s.name === name)) return res.status(400).json({ error: 'site exists' });
  const site = { name, apis: [] };
  db.sites.push(site);
  
  // Initialize mappings for the new site
  const mappings = await readMappings();
  mappings.sites = mappings.sites || {};
  mappings.sites[name] = { actions: [], mappings: [], pageMappings: [] };
  await writeMappings(mappings);
  
  // ensure website folder
  const siteFolder = path.join(WEBSITES_DIR, name);
  if (!fs.existsSync(siteFolder)) fs.mkdirSync(siteFolder, { recursive: true });
  await writeDB(db);
  res.json(site);
});

app.get('/api/sites/:siteName', async (req, res) => {
  const db = await readDB();
  const s = db.sites.find(x => x.name === req.params.siteName);
  if (!s) return res.status(404).json({ error: 'site not found' });
  res.json(s);
});

// List HTML pages for a site
app.get('/api/sites/:siteName/pages', (req, res) => {
  const siteName = req.params.siteName;
  logger.info(`Listing pages for site: ${siteName}`);
  try {
    const siteFolder = path.join(WEBSITES_DIR, siteName);
    if (!fs.existsSync(siteFolder)) {
      logger.warn(`Site folder not found: ${siteFolder}`);
      return res.status(404).json({ error: 'site not found' });
    }
    const files = [];
    function walk(dir) {
      for (const f of fs.readdirSync(dir)) {
        const abs = path.join(dir, f);
        const rel = path.relative(siteFolder, abs).split('\\').join('/');
        const stat = fs.statSync(abs);
        if (stat.isDirectory()) walk(abs);
        else if (['.html', '.htm'].includes(path.extname(f).toLowerCase())) files.push(rel);
      }
    }
    walk(siteFolder);
    logger.info(`Found ${files.length} HTML pages for site ${siteName}`);
    res.json(files);
  } catch (err) {
    logger.error(`Error listing pages for site ${siteName}: ${err.message}`);
    res.status(500).json({ error: 'internal server error' });
  }
});

// Get raw page content (not processed)
app.get('/api/sites/:siteName/pages/content', (req, res) => {
  const siteName = req.params.siteName;
  const p = req.query.path || 'index.html';
  // sanitize path
  if (p.includes('..')) return res.status(400).json({ error: 'invalid path' });
  const filePath = path.join(WEBSITES_DIR, siteName, p);
  if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'not found' });
  res.set('Content-Type', 'text/plain');
  res.send(fs.readFileSync(filePath, 'utf8'));
});

// Get page content by page name
app.get('/api/sites/:siteName/pages/:pageName', (req, res) => {
  const siteName = req.params.siteName;
  const pageName = req.params.pageName;
  logger.info(`Getting page content for site: ${siteName}, page: ${pageName}`);
  try {
    // sanitize path
    if (pageName.includes('..')) {
      logger.warn(`Invalid path detected: ${pageName}`);
      return res.status(400).json({ error: 'invalid path' });
    }
    const filePath = path.join(WEBSITES_DIR, siteName, pageName);
    if (!fs.existsSync(filePath)) {
      logger.warn(`Page file not found: ${filePath}`);
      return res.status(404).json({ error: 'not found' });
    }
    logger.info(`Serving page content from: ${filePath}`);
    res.set('Content-Type', 'text/html');
    res.send(fs.readFileSync(filePath, 'utf8'));
  } catch (err) {
    logger.error(`Error getting page content: ${err.message}`);
    res.status(500).json({ error: 'internal server error' });
  }
});

// Save page content (overwrite or create)
app.post('/api/sites/:siteName/pages/save', (req, res) => {
  const siteName = req.params.siteName;
  const { path: relPath, content } = req.body;
  if (!relPath || relPath.includes('..')) return res.status(400).json({ error: 'invalid path' });
  const filePath = path.join(WEBSITES_DIR, siteName, relPath);
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(filePath, content, 'utf8');
  res.json({ ok: true });
});

app.post('/api/sites/:siteName/apis', async (req, res) => {
  const { name, url, method, headers, params, bodyTemplate } = req.body;
  if (!name || !url) return res.status(400).json({ error: 'name and url required' });
  const db = await readDB();
  const s = db.sites.find(x => x.name === req.params.siteName);
  if (!s) return res.status(404).json({ error: 'site not found' });
  if (s.apis.find(a => a.name === name)) return res.status(400).json({ error: 'api name exists' });
  // sanitize/normalize params to avoid duplicates or strange shapes
  const paramsObj = normalizeParams(params);
  const api = { name, url, method: method || 'GET', headers: headers || {}, params: paramsObj, bodyTemplate: bodyTemplate || null };
  s.apis.push(api);
  await writeDB(db);
  res.json(api);
});

// Update an existing API definition (allow updating mapping configuration and bodyTemplate)
app.put('/api/sites/:siteName/apis/:apiName', async (req, res) => {
  const siteName = req.params.siteName;
  const apiName = req.params.apiName;
  const db = await readDB();
  const s = db.sites.find(x => x.name === siteName);
  if (!s) return res.status(404).json({ error: 'site not found' });
  const api = s.apis.find(a => a.name === apiName);
  if (!api) return res.status(404).json({ error: 'api not found' });
  // Allow renaming via `name` property in the request body. Also update mappings/actions that reference the API name.
  const { url, method, headers, params, bodyTemplate, mappingConfig, name: newName } = req.body;

  // Handle rename if requested
  if (newName !== undefined && newName !== apiName) {
    // ensure no conflict with other APIs
    if (s.apis.find(a => a.name === newName)) return res.status(400).json({ error: 'api name exists' });
    // update mappings/actions that reference this api name
    try {
      const mappings = await readMappings();
      mappings.sites = mappings.sites || {};
      const siteMappings = mappings.sites[siteName] || null;
      if (siteMappings) {
        (siteMappings.actions || []).forEach(a => { if (a.apiName === apiName) a.apiName = newName; });
        (siteMappings.mappings || []).forEach(m => { if (m.apiName === apiName) m.apiName = newName; });
        (siteMappings.pageMappings || []).forEach(pm => { if (pm.apiName === apiName) pm.apiName = newName; });
        await writeMappings(mappings);
      }
    } catch (e) {
      logger && logger.warn && logger.warn('Could not update mappings during API rename: ' + (e && e.message));
    }
    api.name = newName;
  }

  if (url !== undefined) api.url = url;
  if (method !== undefined) api.method = method;
  if (headers !== undefined) api.headers = headers;
  if (params !== undefined) api.params = normalizeParams(params);
  if (bodyTemplate !== undefined) api.bodyTemplate = bodyTemplate;
  if (mappingConfig !== undefined) api.mappingConfig = mappingConfig;

  await writeDB(db);
  res.json(api);
});

// Delete an API definition for a site
app.delete('/api/sites/:siteName/apis/:apiName', async (req, res) => {
  const siteName = req.params.siteName;
  const apiName = req.params.apiName;
  const db = await readDB();
  const s = db.sites.find(x => x.name === siteName);
  if (!s) return res.status(404).json({ error: 'site not found' });
  const idx = s.apis.findIndex(a => a.name === apiName);
  if (idx === -1) return res.status(404).json({ error: 'api not found' });
  s.apis.splice(idx, 1);
  await writeDB(db);
  res.json({ ok: true });
});

// Persist UI-driven actions (button/form -> API mappings)
app.post('/api/sites/:siteName/actions', async (req, res) => {
  const { selector, apiName, method, fields, page } = req.body || {};
  if (!selector || !apiName) return res.status(400).json({ error: 'selector and apiName required' });
  const mappings = await readMappings();
  mappings.sites = mappings.sites || {};
  mappings.sites[req.params.siteName] = mappings.sites[req.params.siteName] || { actions: [], mappings: [], pageMappings: [] };
  const siteMappings = mappings.sites[req.params.siteName];
  siteMappings.actions = siteMappings.actions || [];
  const action = { id: 'action_' + Date.now().toString(36), selector, apiName, method: method || 'POST', fields: fields || [], page: page || null };
  siteMappings.actions.push(action);
  await writeMappings(mappings);
  res.json(action);
});

app.post('/api/sites/:siteName/mappings', async (req, res) => {
  const { placeholder, apiName, jsonPath, pages } = req.body;
  if (!placeholder || !apiName || !jsonPath) return res.status(400).json({ error: 'placeholder, apiName, jsonPath required' });
  const mappings = await readMappings();
  mappings.sites = mappings.sites || {};
  mappings.sites[req.params.siteName] = mappings.sites[req.params.siteName] || { actions: [], mappings: [], pageMappings: [] };
  const siteMappings = mappings.sites[req.params.siteName];
  siteMappings.mappings = siteMappings.mappings || [];
  siteMappings.mappings.push({ placeholder, apiName, jsonPath, pages: pages || [] });
  await writeMappings(mappings);
  res.json({ placeholder, apiName, jsonPath });
});

// Get pages that use a specific API (from actions)
app.get('/api/sites/:siteName/api/:apiName/pages', async (req, res) => {
  const siteName = req.params.siteName;
  const apiName = req.params.apiName;
  const db = await readDB();
  const s = db.sites.find(x => x.name === siteName);
  if (!s) return res.status(404).json({ error: 'site not found' });
  
  const mappings = await readMappings();
  mappings.sites = mappings.sites || {};
  const siteMappings = mappings.sites[siteName] || { actions: [], mappings: [], pageMappings: [] };
  
  // Get unique pages from actions that use this API
  const pagesFromActions = [...new Set((siteMappings.actions || [])
    .filter(a => a.apiName === apiName && a.page)
    .map(a => a.page))];
  
  // Also get pages from mappings
  const pagesFromMappings = [...new Set((siteMappings.mappings || [])
    .filter(m => m.apiName === apiName && m.pages)
    .flatMap(m => m.pages))];

  // Also get pages from pageMappings
  const pagesFromPageMappings = [...new Set((siteMappings.pageMappings || [])
    .filter(pm => pm.apiName === apiName && pm.page)
    .map(pm => pm.page))];
  
  // Combine and deduplicate
  const allPages = [...new Set([...pagesFromActions, ...pagesFromMappings, ...pagesFromPageMappings])];
  
  res.json(allPages);
});

// Save/update page-API mapping (for drag-and-drop snippets)
app.post('/api/sites/:siteName/page-mappings', async (req, res) => {
  const { page, apiName, method, fieldMappings, submitSelector } = req.body;
  if (!page || !apiName) return res.status(400).json({ error: 'page and apiName required' });
  
  const mappings = await readMappings();
  mappings.sites = mappings.sites || {};
  mappings.sites[req.params.siteName] = mappings.sites[req.params.siteName] || { actions: [], mappings: [], pageMappings: [] };
  const siteMappings = mappings.sites[req.params.siteName];
  siteMappings.pageMappings = siteMappings.pageMappings || [];
  
  // Find existing mapping for this page+api combination
  let existingMapping = siteMappings.pageMappings.find(pm => pm.page === page && pm.apiName === apiName);
  
  if (existingMapping) {
    // Update existing mapping
    if (method !== undefined) existingMapping.method = method;
    if (fieldMappings !== undefined) existingMapping.fieldMappings = fieldMappings;
    if (submitSelector !== undefined) existingMapping.submitSelector = submitSelector;
  } else {
    // Create new mapping
    const mapping = {
      id: 'pm_' + Date.now().toString(36),
      page,
      apiName,
      method: method || 'POST',
      fieldMappings: fieldMappings || {},
      submitSelector: submitSelector || null
    };
    siteMappings.pageMappings.push(mapping);
  }
  
  await writeMappings(mappings);
  res.json({ success: true });
});

// Get page mappings for a specific page
app.get('/api/sites/:siteName/pages/:pageName/mappings', async (req, res) => {
  const siteName = req.params.siteName;
  const pageName = req.params.pageName;
  logger.info(`Getting page mappings for site: ${siteName}, page: ${pageName}`);
  try {
    const mappings = await readMappings();
    mappings.sites = mappings.sites || {};
    const siteMappings = mappings.sites[siteName];
    if (!siteMappings) {
      logger.warn(`Site not found in mappings: ${siteName}`);
      return res.status(404).json({ error: 'site not found' });
    }
    
    const pageMappings = (siteMappings.pageMappings || []).filter(pm => pm.page === pageName);
    logger.info(`Found ${pageMappings.length} mappings for page ${pageName}`);
    res.json(pageMappings);
  } catch (err) {
    logger.error(`Error getting page mappings: ${err.message}`);
    res.status(500).json({ error: 'internal server error' });
  }
});

// Get page mapping for a specific API on a page
app.get('/api/sites/:siteName/pages/:pageName/api/:apiName/mapping', async (req, res) => {
  const siteName = req.params.siteName;
  const pageName = req.params.pageName;
  const apiName = req.params.apiName;
  const mappings = await readMappings();
  mappings.sites = mappings.sites || {};
  const siteMappings = mappings.sites[siteName];
  if (!siteMappings) return res.status(404).json({ error: 'site not found' });
  
  const mapping = (siteMappings.pageMappings || []).find(pm => pm.page === pageName && pm.apiName === apiName);
  if (!mapping) return res.status(404).json({ error: 'mapping not found' });
  
  res.json(mapping);
});

// Execute a configured endpoint server-side (test or runtime)
app.post('/api/sites/:siteName/endpoints/:apiName/execute', async (req, res) => {
  const siteName = req.params.siteName;
  const apiName = req.params.apiName;
  logger.info(`Executing API endpoint for site: ${siteName}, api: ${apiName}`);
  try {
    const db = await readDB();
    const s = db.sites.find(x => x.name === siteName);
    if (!s) {
      logger.warn(`Site not found in DB: ${siteName}`);
      return res.status(404).json({ error: 'site not found' });
    }
    const api = s.apis.find(a => a.name === apiName);
    if (!api) {
      logger.warn(`API not found: ${apiName} in site ${siteName}`);
      return res.status(404).json({ error: 'api not found' });
    }
    // allow overriding params/body in request
    const override = req.body || {};
    const url = api.url;
    const method = api.method || 'GET';
    const headers = Object.assign({}, api.headers || {}, override.headers || {});
    let data = null;
    if (api.bodyTemplate) data = override.body || api.bodyTemplate;
    logger.info(`Making ${method} request to ${url}`);
    const resp = await axios({ method, url, headers, params: Object.assign({}, api.params || {}, override.params || {}), data });
    logger.info(`API call successful, status: ${resp.status}`);
    return res.json({ status: resp.status, data: resp.data, headers: resp.headers });
  } catch (err) {
    logger.error(`Error executing API ${apiName}: ${err.message}`);
    return res.status(500).json({ error: String(err.message), response: err.response ? { status: err.response.status, data: err.response.data } : undefined });
  }
});

// Aggregated API data for a site (server-side fetch of all configured apis)
app.get('/api/sites/:siteName/data', async (req, res) => {
  const siteName = req.params.siteName;
  logger.info(`Getting API data for site: ${siteName}`);
  try {
    const db = await readDB();
    const s = db.sites.find(x => x.name === siteName);
    if (!s) {
      logger.warn(`Site not found in DB: ${siteName}`);
      return res.status(404).json({ error: 'site not found' });
    }
    const data = await fetchAPIsForSite(s);
    logger.info(`Fetched API data for site ${siteName}`);
    res.json(data);
  } catch (err) {
    logger.error(`Error fetching API data for site ${siteName}: ${err.message}`);
    res.status(500).json({ error: String(err.message) });
  }
});

// Helper: fetch all APIs for site (simple, no auth caching)
async function fetchAPIsForSite(site) {
  const results = {};
  results.__meta__ = {};
  for (const api of site.apis) {
    try {
      const resp = await axios({ method: api.method || 'GET', url: api.url, headers: api.headers || {}, params: api.params || {}, data: api.bodyTemplate || undefined });
      results[api.name] = resp.data;
      results.__meta__[api.name] = { method: (api.method || 'GET').toUpperCase(), status: resp.status, url: api.url };
    } catch (err) {
      results[api.name] = { _error: String(err.message) };
      results.__meta__[api.name] = { method: (api.method || 'GET').toUpperCase(), status: 'error', url: api.url };
    }
  }
  return results;
}

// Render an HTML file for a given site + relative path using mappings and API data
async function renderSiteHtml(siteName, relPath) {
  const filePath = path.join(WEBSITES_DIR, siteName, relPath);
  if (!fs.existsSync(filePath)) return null;
  const contentRaw = fs.readFileSync(filePath, 'utf8');

  const db = await readDB();
  const site = db.sites.find(x => x.name === siteName);
  if (!site) return contentRaw; // no site metadata -> return raw

  let content = contentRaw;

  // Read mappings for this site
  const mappings = await readMappings();
  mappings.sites = mappings.sites || {};
  const siteMappings = mappings.sites[siteName] || { actions: [], mappings: [], pageMappings: [] };

  // Fetch APIs
  const apiData = await fetchAPIsForSite(site);

  // Handle simple each blocks: {{#each apiName.jsonPath}}...{{/each}}
  content = content.replace(/{{#each\s+([^}]+)}}([\s\S]*?){{\/each}}/g, (match, p1, inner) => {
    const arr = get(apiData, p1, []);
    if (!Array.isArray(arr)) return '';
    return arr.map(item => {
      return inner.replace(/{{\s*(?:this\.)?([\w$\.\-]+)\s*}}/g, (mm, key) => {
        const v = get(item, key, '');
        if (v === undefined || v === null) return '';
        return (typeof v === 'object') ? JSON.stringify(v) : String(v);
      });
    }).join('');
  });

  // Placeholder substitution from mappings
  for (const m of siteMappings.mappings || []) {
    if (m.pages && m.pages.length > 0) {
      const matches = m.pages.some(pp => pp === relPath);
      if (!matches) continue;
    }
    let value = get(apiData[m.apiName], m.jsonPath);
    if (value === undefined || value === null) value = '';
    else if (typeof value === 'object') value = JSON.stringify(value);
    else value = String(value);
    const re = new RegExp('{{\\s*' + escapeRegExp(m.placeholder) + '\\s*}}', 'g');
    content = content.replace(re, value);
  }

  // Direct placeholders like {{apiName.path.to.value}}
  content = content.replace(/{{\s*([\w0-9_.-]+)\s*}}/g, (mm, key) => {
    const val = get(apiData, key);
    if (val === undefined || val === null) return '';
    return (typeof val === 'object') ? JSON.stringify(val) : String(val);
  });

  // Inject action wiring for buttons/forms if site.actions exist
  try{
    const actions = (siteMappings.actions || []).filter(a => !a.page || a.page === relPath);
    if(actions && actions.length>0){
      const safe = JSON.stringify(actions).replace(/</g,'\\u003c');
      const script = `\n<script>/* AppBuilder action bindings */(function(actions, siteName){try{actions.forEach(function(a){try{var els = document.querySelectorAll(a.selector||''); if(!els) return; els.forEach(function(el){ if(el.__ab_action_bound) return; el.__ab_action_bound = true; el.addEventListener('click', async function(ev){ try{ ev.preventDefault(); var body = {}; (a.fields||[]).forEach(function(f){ try{ var inp = document.querySelector('[name="'+f+'"]') || document.querySelector('[data-field="'+f+'"]') || document.getElementById(f); body[f] = inp ? (inp.value || inp.textContent || '') : ''; }catch(e){} }); await fetch('/api/sites/'+encodeURIComponent(siteName)+'/endpoints/'+encodeURIComponent(a.apiName)+'/execute', { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify({ body: body }) }); }catch(e){ console && console.error && console.error(e); } }); }); }catch(e){} });}catch(e){console && console.error && console.error(e);} })(` + safe + `, ${JSON.stringify(siteName)});</script>\n`;
      if(content.lastIndexOf('</body>')!==-1){ content = content.replace(/<\/body>\s*$/i, script + '</body>'); }
      else { content = content + script; }
    }
  }catch(e){ logger.error(e); }

  return content;
}

// Serve all files for a site dynamically from root folder (no processing)
app.get('/website/:siteName/*', (req, res) => {
  const siteName = req.params.siteName;
  const relPath = req.params[0];
  // sanitize path
  if (relPath.includes('..')) return res.status(400).send('Invalid path');
  const filePath = path.join(WEBSITES_DIR, siteName, relPath);
  if (!fs.existsSync(filePath)) return res.status(404).send('Not found');
  res.sendFile(filePath);
});

// Serve website files with injection for .html only
app.get('/site/:siteName/*', async (req, res) => {
  const siteName = req.params.siteName;
  const db = await readDB();
  const site = db.sites.find(x => x.name === siteName);
  const relPath = req.params[0] || 'index.html';
  const filePath = path.join(WEBSITES_DIR, siteName, relPath);
  if (!fs.existsSync(filePath)) return res.status(404).send('Not found');
  const ext = path.extname(filePath).toLowerCase();
  if (ext !== '.html' && ext !== '.htm') return res.sendFile(filePath);

  let content = fs.readFileSync(filePath, 'utf8');
  if (!site) return res.send(content);

  // Read mappings for this site
  const mappings = await readMappings();
  mappings.sites = mappings.sites || {};
  const siteMappings = mappings.sites[siteName] || { actions: [], mappings: [], pageMappings: [] };

  // Fetch APIs
  const apiData = await fetchAPIsForSite(site);

  // First handle simple each blocks: {{#each apiName.jsonPath}}...{{/each}}
  content = content.replace(/{{#each\s+([^}]+)}}([\s\S]*?){{\/each}}/g, (match, p1, inner) => {
    const arr = get(apiData, p1, []);
    if (!Array.isArray(arr)) return '';
    return arr.map(item => {
      // replace {{this.prop}} or {{prop}} in inner — support dot-paths as well
      return inner.replace(/{{\s*(?:this\.)?([\w$\.\-]+)\s*}}/g, (mm, key) => {
        const v = get(item, key, '');
        if (v === undefined || v === null) return '';
        return (typeof v === 'object') ? JSON.stringify(v) : String(v);
      });
    }).join('');
  });

  // Do placeholder substitution: {{placeholder}} -> look up mapping values by mapping list
  for (const m of siteMappings.mappings || []) {
    // apply mapping only if mapping.pages empty (global) or includes this relPath
    if (m.pages && m.pages.length > 0) {
      const matches = m.pages.some(pp => pp === relPath);
      if (!matches) continue;
    }
    let value = get(apiData[m.apiName], m.jsonPath);
    if (value === undefined || value === null) value = '';
    else if (typeof value === 'object') value = JSON.stringify(value);
    else value = String(value);
    // match placeholder with optional whitespace inside braces (e.g. {{ placeholder }})
    const re = new RegExp('{{\\s*' + escapeRegExp(m.placeholder) + '\\s*}}', 'g');
    content = content.replace(re, value);
  }

  // Also allow direct placeholders like {{apiName.path.to.value}}
  content = content.replace(/{{\s*([\w0-9_.-]+)\s*}}/g, (mm, key) => {
    const val = get(apiData, key);
    if (val === undefined || val === null) return '';
    return (typeof val === 'object') ? JSON.stringify(val) : String(val);
  });

  // Inject action wiring for buttons/forms if site.actions exist
  try{
    const actions = (siteMappings.actions || []).filter(a => !a.page || a.page === relPath);
    if(actions && actions.length>0){
      const safe = JSON.stringify(actions).replace(/</g,'\\u003c');
      const script = `\n<script>/* AppBuilder action bindings */(function(actions, siteName){try{actions.forEach(function(a){try{var els = document.querySelectorAll(a.selector||''); if(!els) return; els.forEach(function(el){ if(el.__ab_action_bound) return; el.__ab_action_bound = true; el.addEventListener('click', async function(ev){ try{ ev.preventDefault(); var body = {}; (a.fields||[]).forEach(function(f){ try{ var inp = document.querySelector('[name="'+f+'"]') || document.querySelector('[data-field="'+f+'"]') || document.getElementById(f); body[f] = inp ? (inp.value || inp.textContent || '') : ''; }catch(e){} }); await fetch('/api/sites/'+encodeURIComponent(siteName)+'/endpoints/'+encodeURIComponent(a.apiName)+'/execute', { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify({ body: body }) }); }catch(e){ console && console.error && console.error(e); } }); }); }catch(e){} });}catch(e){console && console.error && console.error(e);} })(` + safe + `, ${JSON.stringify(siteName)});</script>\n`;
      // append before closing body if present, else at end
      if(content.lastIndexOf('</body>')!==-1){ content = content.replace(/<\/body>\s*$/i, script + '</body>'); }
      else { content = content + script; }
    }
  }catch(e){ logger.error(e); }

  res.set('Content-Type', 'text/html');
  res.send(content);
});

// express error handler (catch-all)
app.use((err, req, res, next) => {
  try{ logger.error(err); }catch(e){ process.stderr.write('logger failed ' + String(e) + '\n'); }
  res.status(500).json({ error: 'internal server error' });
});

// capture uncaught exceptions and unhandled rejections
process.on('unhandledRejection', (reason, p) => {
  logger.error(`UnhandledRejection: ${reason} ${p}`);
});
process.on('uncaughtException', (err) => {
  logger.error(`UncaughtException: ${err && err.stack ? err.stack : err}`);
  // optional: exit to allow a supervisor to restart
  // process.exit(1);
});

// Helper escape
function escapeRegExp(string) {
  return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Serve root: list sites
app.get('/', async (req, res) => {
  // Serve configured site (activePrototype) or configured production folder index.
  try {
    const cfg = await readConfig();

    // If an active prototype is configured, prefer serving its index (rendered)
    if (cfg && cfg.activePrototype) {
      const siteIndex = path.join(WEBSITES_DIR, cfg.activePrototype, 'index.html');
      if (fs.existsSync(siteIndex)) {
        try {
          const rendered = await renderSiteHtml(cfg.activePrototype, 'index.html');
          if (rendered !== null) {
            res.set('Content-Type', 'text/html');
            return res.send(rendered);
          }
        } catch (e) {
          logger && logger.warn && logger.warn('Error rendering activePrototype index: ' + (e && e.message));
        }
        return res.sendFile(siteIndex);
      }
    }

    // Otherwise, try the configured productionFolder (relative to project root)
    const prodFolder = cfg && cfg.productionFolder ? cfg.productionFolder : 'production';
    const prodIndex = path.join(ROOT, prodFolder, 'index.html');
    if (fs.existsSync(prodIndex)) return res.sendFile(prodIndex);
  } catch (err) {
    logger && logger.warn && logger.warn('Error serving production/index for root: ' + (err && err.message));
  }

  // Fallback: show prototype list from DB
  try {
    const db = await readDB();
    return res.send(`<h2>AppBuilder Prototype</h2><p>Sites:</p><ul>${db.sites.map(s=>`<li><a href="/site/${s.name}/">${s.name}</a></li>`).join('')}</ul><p>Admin: <a href="/admin">Open admin</a></p>`);
  } catch (err) {
    logger && logger.warn && logger.warn('Error reading DB for root listing: ' + (err && err.message));
    return res.status(500).send('unable to display sites');
  }
});

// Config API
app.get('/api/config', async (req, res) => {
  const cfg = await readConfig();
  res.json(cfg);
});

app.post('/api/config', async (req, res) => {
  const { productionFolder, activePrototype } = req.body || {};
  const cfg = await readConfig();
  if (productionFolder !== undefined) cfg.productionFolder = productionFolder;
  if (activePrototype !== undefined) cfg.activePrototype = activePrototype;
  const ok = await writeConfig(cfg);
  if (!ok) return res.status(500).json({ error: 'could not persist config (read-only FS?)' });
  res.json(cfg);
});

// Start server only when this file is run directly (e.g. `node server.js`).
// When required (for example by a serverless shim like `api/index.js`),
// the Express `app` will be exported without binding to a port so the
// serverless platform can handle incoming requests.
if (require.main === module) {
  // Start HTTP server and capture the server instance so we can gracefully
  // shut it down on SIGINT / SIGTERM. This avoids long Node exit hangs.
  let server;
  try {
    server = app.listen(PORT, () => {
      logger.info(`AppBuilder running on http://localhost:${PORT}`);
    });
  } catch (err) {
    // listen can throw synchronously on some platforms when the port is in use
    try { logger.error('Failed to bind HTTP server: ' + (err && err.message)); } catch (e) { console.error('Failed to bind HTTP server', err); }
    if (err && err.code === 'EADDRINUSE') {
      try { logger.error(`Port ${PORT} already in use. Set environment variable PORT to a free port or stop the process using this port.`); } catch (e) { console.error('Port in use'); }
      process.exit(1);
    }
    throw err;
  }

  // Also catch asynchronous 'error' events from the server
  if (server && typeof server.on === 'function') {
    server.on('error', (err) => {
      try { logger.error('HTTP server error: ' + (err && err.message)); } catch (e) { console.error('HTTP server error', err); }
      if (err && err.code === 'EADDRINUSE') {
        try { logger.error(`Port ${PORT} already in use.`); } catch (e) {}
        process.exit(1);
      }
    });
  }

  // Track open connections so we can destroy them if shutdown takes too long
  const sockets = new Set();
  server.on('connection', (socket) => {
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
  });

  let shuttingDown = false;
  async function gracefulShutdown(signal, exitCode = 0) {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info(`Received ${signal} — shutting down gracefully`);

    // Stop accepting new connections
    try {
      server.close((err) => {
        if (err) {
          logger.error('Error during server.close(): ' + (err && err.message));
        } else {
          logger.info('HTTP server closed');
        }
      });
    } catch (e) {
      logger.warn('server.close() threw: ' + (e && e.message));
    }

    // Give outstanding requests some time to finish, then destroy sockets
    const FORCE_KILL_AFTER = parseInt(process.env.SHUTDOWN_TIMEOUT_MS || '10000', 10);
    const killTimer = setTimeout(() => {
      logger.warn(`Forcing shutdown after ${FORCE_KILL_AFTER}ms`);
      for (const s of sockets) {
        try { s.destroy(); } catch (e) { /* ignore */ }
      }
      process.exit(exitCode);
    }, FORCE_KILL_AFTER).unref();

    // If all sockets close before timeout, clear the timer and exit
    if (sockets.size === 0) {
      clearTimeout(killTimer);
      logger.info('No open sockets — exiting now');
      process.exit(exitCode);
    } else {
      // poll for sockets to drain
      const interval = setInterval(() => {
        if (sockets.size === 0) {
          clearInterval(interval);
          clearTimeout(killTimer);
          logger.info('All connections closed — exiting');
          process.exit(exitCode);
        }
      }, 200).unref();
    }
  }

  // Handle stop signals (Ctrl+C on most shells -> SIGINT)
  process.on('SIGINT', () => gracefulShutdown('SIGINT', 0));
  process.on('SIGTERM', () => gracefulShutdown('SIGTERM', 0));

  // Support being killed via Windows taskkill which may send 'message' with 'shutdown'
  process.on('message', (msg) => {
    if (msg === 'shutdown') gracefulShutdown('message:shutdown', 0);
  });

  // If an uncaught exception occurs, attempt graceful shutdown then exit non-zero
  process.on('uncaughtException', (err) => {
    try { logger.error('UncaughtException: ' + (err && err.stack ? err.stack : String(err))); } catch (e) { /* ignore */ }
    // try a graceful shutdown, but force exit in 10s
    gracefulShutdown('uncaughtException', 1);
  });

} else {
  logger.info('Express app loaded as a module — not listening (serverless or external runner will handle requests)');
}

module.exports = app;
