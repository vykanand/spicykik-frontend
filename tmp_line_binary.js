const fs = require('fs');
const vm = require('vm');
const lines = fs.readFileSync('admin-static/easybuild.js','utf8').split(/\r?\n/);
let lo=1, hi=lines.length, firstFail=lines.length+1;
while(lo<=hi){
  const mid = Math.floor((lo+hi)/2);
  const s = lines.slice(0, mid).join('\n');
  try{ new vm.Script(s); // parses
    lo = mid + 1;
  }catch(e){ firstFail = Math.min(firstFail, mid); hi = mid - 1; }
}
if(firstFail<=lines.length){
  console.log('First failing line approximately at', firstFail);
  const start = Math.max(1, firstFail-5);
  const end = Math.min(lines.length, firstFail+5);
  for(let i=start;i<=end;i++) console.log((i===firstFail? '>>':'  '), i.toString().padStart(4,' '), lines[i-1]);
}else console.log('No failure detected in binary search');
