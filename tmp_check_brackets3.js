const fs = require('fs');
const path = 'admin-static/easybuild.js';
const s = fs.readFileSync(path, 'utf8');
let stack = [];
const pairs = {'(':')','{':'}','[':']'};
let line = 1, col = 0;
let inSingle=false,inDouble=false,inTemplate=false,inLineComment=false,inBlockComment=false,prev='';
let mismatch=null;
for(let i=0;i<s.length;i++){
  const ch=s[i];
  if(ch==='\n'){ line++; col=0; inLineComment=false; prev=''; continue; }
  col++;
  if(inLineComment){ prev=ch; continue; }
  if(inBlockComment){ if(prev==='*' && ch==='/' ){ inBlockComment=false; prev=''; } else prev=ch; continue; }
  if(!inSingle && !inDouble && !inTemplate){
    if(ch==='/'){
      const next = s[i+1];
      if(next==='/' ){ inLineComment=true; i++; continue; }
      if(next==='*'){ inBlockComment=true; i++; prev=''; continue; }
    }
  }
  if(!inDouble && !inTemplate && ch==="'" && prev !== '\\') { inSingle = !inSingle; prev=ch; continue; }
  if(!inSingle && !inTemplate && ch==='"' && prev !== '\\') { inDouble = !inDouble; prev=ch; continue; }
  if(!inSingle && !inDouble && ch==='`' && prev !== '\\') { inTemplate = !inTemplate; prev=ch; continue; }
  if(inSingle || inDouble || inTemplate){ prev=ch; continue; }
  // now we are in code
  if(ch==='('||ch==='{'||ch==='[') stack.push({ch,line,col,i});
  else if(ch===')'||ch==='}'||ch===']'){
    if(stack.length===0){ mismatch={type:'closing_without_open',ch,line,col,i}; break; }
    const last = stack.pop(); const expected = pairs[last.ch]; if(ch!==expected){ mismatch={type:'mismatch',open:last,got:ch,expected,line,col,i}; break; }
  }
  prev=ch;
}
if(mismatch){ console.log('MISMATCH',mismatch); if(mismatch.open) console.log('OPEN AT',mismatch.open); const lines=s.split(/\r?\n/); const L=Math.max(1,mismatch.line-6); const R=Math.min(lines.length,mismatch.line+6); for(let j=L;j<=R;j++) console.log((j===mismatch.line?'>>':'  '), j.toString().padStart(4,' '), lines[j-1]); process.exit(2); }
if(stack.length){ const last=stack[stack.length-1]; console.log('UNMATCHED OPEN',last); process.exit(2); }
console.log('BALANCED');
