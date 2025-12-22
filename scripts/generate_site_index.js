#!/usr/bin/env node
const fs = require('fs').promises;
const path = require('path');

async function walk(dir, base){
  base = base || dir;
  const entries = await fs.readdir(dir, { withFileTypes: true });
  const results = [];
  for(const ent of entries){
    const full = path.join(dir, ent.name);
    const rel = path.relative(base, full).replace(/\\/g,'/');
    if(ent.isDirectory()){
      results.push({ type: 'dir', name: ent.name, path: rel });
      const sub = await walk(full, base);
      results.push(...sub);
    } else if(ent.isFile()){
      const st = await fs.stat(full);
      results.push({ type: 'file', name: ent.name, path: rel, size: st.size, mtime: st.mtimeMs });
    }
  }
  return results;
}

function renderHtml(list, title){
  const rows = list.map(i => {
    if(i.type === 'dir') return `<li class="dir">📁 <strong>${i.path}</strong></li>`;
    return `<li class="file">📄 <a href="${encodeURI(i.path)}">${i.path}</a> <span class="meta">${i.size} bytes</span></li>`;
  }).join('\n');
  return `<!doctype html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Files — ${title}</title>
<style>body{font-family:system-ui,Segoe UI,Roboto,Arial;margin:20px}ul{list-style:none;padding:0}li{padding:6px 0} .meta{color:#666;font-size:0.9em;margin-left:8px}</style>
</head><body>
<h1>Files for ${title}</h1>
<p>Generated at ${new Date().toISOString()}</p>
<ul>
${rows}
</ul>
</body></html>`;
}

async function main(){
  const siteArg = process.argv[2] || 'websites/snack';
  const sitePath = path.resolve(siteArg);
  try{
    const list = await walk(sitePath, sitePath);
    const outJson = path.join(sitePath, 'files.json');
    const outHtml = path.join(sitePath, '_index.html');
    await fs.writeFile(outJson, JSON.stringify(list, null, 2), 'utf8');
    await fs.writeFile(outHtml, renderHtml(list, siteArg), 'utf8');
    console.log('Wrote', outJson, 'and', outHtml);
  }catch(err){
    console.error('Error:', err.message);
    process.exit(1);
  }
}

if(require.main === module) main();
