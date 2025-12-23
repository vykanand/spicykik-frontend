const fs = require('fs');
const vm = require('vm');
const lines = fs.readFileSync('admin-static/easybuild.js','utf8').split(/\r?\n/);
for(let k=lines.length; k>0; k--) {
  const s = lines.slice(0,k).join('\n');
  try { new vm.Script(s); console.log('Valid prefix length:', k);
    // print context around k
    const start = Math.max(1, k-8); const end = Math.min(lines.length, k+8);
    for(let i=start;i<=end;i++) console.log((i===k? '>>':'  '), i.toString().padStart(4,' '), lines[i-1]);
    break;
  } catch(e) { /* continue searching */ }
}
