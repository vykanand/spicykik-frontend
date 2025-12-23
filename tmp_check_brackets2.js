const fs = require('fs');
const path = 'admin-static/easybuild.js';
const s = fs.readFileSync(path, 'utf8');
// We'll scan and report the first mismatch and the location of the matching open if available
const pairs = {'(':')','{':'}','[':']'};
const revPairs = {')':'(', '}':'{', ']':'['};
let stack = [];
let line = 1, col = 0;
let mismatch = null;
for (let i = 0; i < s.length; i++) {
  const ch = s[i];
  if (ch === '\n') { line++; col = 0; continue; }
  col++;
  if (ch === '(' || ch === '{' || ch === '[') {
    stack.push({ch, line, col, i});
  } else if (ch === ')' || ch === '}' || ch === ']') {
    if (stack.length === 0) { mismatch = {type:'closing_without_open',ch,line,col,i}; break; }
    const last = stack.pop();
    const expected = pairs[last.ch];
    if (ch !== expected) { mismatch = {type:'mismatch', open:last, got:ch, expected, line, col, i}; break; }
  }
}
if (mismatch) {
  console.log('MISMATCH:', mismatch);
  if (mismatch.open) console.log('OPEN AT:', mismatch.open);
  const lines = s.split(/\r?\n/);
  const L = Math.max(1, mismatch.line-6);
  const R = Math.min(lines.length, mismatch.line+6);
  for (let i=L;i<=R;i++) console.log((i===mismatch.line? '>>':'  '), i.toString().padStart(4,' '), lines[i-1]);
  process.exit(2);
}
if (stack.length) {
  const last = stack[stack.length-1];
  console.log('UNMATCHED OPEN:', last);
  process.exit(2);
}
console.log('No mismatches found.');
