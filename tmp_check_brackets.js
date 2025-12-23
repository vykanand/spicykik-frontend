const fs = require('fs');
const path = 'admin-static/easybuild.js';
const s = fs.readFileSync(path, 'utf8');
const stack = [];
const pairs = {'(':')','{':'}','[':']'};
let line = 1, col = 0;
let first = null;
for (let i = 0; i < s.length; i++) {
  const ch = s[i];
  if (ch === '\n') { line++; col = 0; continue; }
  col++;
  if ('({['.includes(ch)) {
    stack.push({ch, line, col, i});
  } else if (')}]'.includes(ch)) {
    if (stack.length === 0) { first = {type: 'closing_without_open', ch, line, col, i}; break; }
    const last = stack.pop();
    const expected = pairs[last.ch];
    if (ch !== expected) { first = {type: 'mismatch', open: last.ch, expected, got: ch, line, col, i}; break; }
  }
}
if (!first && stack.length) {
  const last = stack[stack.length - 1];
  console.log('UNBALANCED: unclosed', last.ch, 'at line', last.line, 'col', last.col);
  process.exit(2);
}
if (first) {
  console.log('FIRST ERROR:', first);
  // print surrounding lines
  const lines = s.split(/\r?\n/);
  const errLine = first.line;
  for (let L = Math.max(1, errLine-3); L <= Math.min(lines.length, errLine+3); L++) {
    console.log((L===errLine? '>>':'   '), L, lines[L-1]);
  }
  process.exit(2);
}
console.log('All brackets/parentheses appear balanced.');
