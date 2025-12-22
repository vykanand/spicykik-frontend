const fs = require('fs');
const path = require('path');
const file = path.join(__dirname, '..', 'admin-static', 'form-builder.html');
let html = fs.readFileSync(file, 'utf8');
const start = html.indexOf('<script>');
const end = html.lastIndexOf('</script>');
if (start === -1 || end === -1) {
  console.error('No <script> block found in form-builder.html');
  process.exit(2);
}
const script = html.slice(start + '<script>'.length, end);
console.log('Extracted script length:', script.length);
console.error('SCRIPT PREFIX (escaped):', JSON.stringify(script.slice(0,200)));
console.error('SCRIPT PREFIX CODES:', script.slice(0,200).split('').map(c=>c.charCodeAt(0)));

try {
  // Try to compile the script to detect syntax errors
  new Function(script);
  console.log('No syntax errors detected in extracted script.');
  process.exit(0);
} catch (e) {
  console.error('Syntax error while compiling script:');
  console.error(e && e.stack ? e.stack : e.toString());

  // Try to provide context: if message contains line number, show nearby lines
  const match = (e && e.stack) ? e.stack.match(/<anonymous>:(\d+):(\d+)/) : null;
  const lines = script.split(/\n/);
  if (match) {
    const line = parseInt(match[1], 10);
    const col = parseInt(match[2], 10);
    const startLine = Math.max(0, line - 5);
    const endLine = Math.min(lines.length, line + 5);
    console.error('Context (script lines):');
    for (let i = startLine; i < endLine; i++) {
      const num = i + 1;
      console.error((num === line ? '>>' : '  ') + (' ' + num).slice(-4) + '| ' + lines[i]);
    }
  } else {
    console.error('Could not extract precise location from error stack.');
  }

  // Additional diagnostics: count backticks and show last lines containing backticks
  let totalBackticks = 0;
  const backtickLines = [];
  for (let i = 0; i < lines.length; i++) {
    const count = (lines[i].match(/`/g) || []).length;
    if (count > 0) backtickLines.push({ line: i + 1, count, text: lines[i] });
    totalBackticks += count;
  }
  console.error('Backtick count in script:', totalBackticks);
  if (backtickLines.length) {
    console.error('Last 10 lines containing backticks:');
    backtickLines.slice(-10).forEach((b) => {
      console.error((' ' + b.line).slice(-4) + '| ' + b.count + ' | ' + b.text);
    });
  } else {
    console.error('No backticks found in script.');
  }

  // Locate unmatched backtick by scanning characters
  {
    let inTemplate = false;
    let lastPos = -1;
    for (let i = 0; i < script.length; i++) {
      const ch = script[i];
      const prev = script[i - 1];
      if (ch === '`' && prev !== '\\') {
        inTemplate = !inTemplate;
        if (inTemplate) lastPos = i;
        else lastPos = -1;
      }
    }
    if (inTemplate && lastPos !== -1) {
      const upto = script.slice(0, lastPos);
      const line = upto.split(/\n/).length;
      const col = lastPos - upto.lastIndexOf('\n');
      console.error(`Detected unmatched opening backtick at script line ${line}, col ${col}`);
      const scriptLines = script.split(/\n/);
      const start = Math.max(0, line - 6);
      const end = Math.min(scriptLines.length, line + 6);
      for (let i = start; i < end; i++) {
        console.error((' ' + (i + 1)).slice(-4) + '| ' + scriptLines[i]);
      }
    } else {
      console.error('No unmatched opening backtick detected by scan.');
    }
  }

  // Try to locate the earliest line where parsing fails using a binary search over lines
  try {
    const allLines = script.split(/\n/);
    let low = 1;
    let high = allLines.length;
    let found = -1;
    while (low <= high) {
      const mid = Math.floor((low + high) / 2);
      const chunk = allLines.slice(0, mid).join('\n');
      try {
        new Function(chunk);
        low = mid + 1;
      } catch (err) {
        const msg = (err && err.message) ? err.message : '';
        if (msg.includes('Unexpected end of input') || msg.includes('Unexpected token') || msg.includes('Invalid or unexpected token')) {
          found = mid;
          high = mid - 1;
        } else {
          found = mid;
          high = mid - 1;
        }
      }
    }

    if (found !== -1) {
      const contextStart = Math.max(0, found - 8);
      const contextEnd = Math.min(allLines.length, found + 2);
      console.error('First failing line estimate:', found);
      for (let i = contextStart; i < contextEnd; i++) {
        console.error((' ' + (i + 1)).slice(-4) + '| ' + allLines[i]);
      }
    } else {
      console.error('Could not locate failing line via binary search.');
    }
  } catch (e) {
    console.error('Error during binary search diagnostics:', e && e.stack ? e.stack : e.toString());
  }

  process.exit(1);
}


