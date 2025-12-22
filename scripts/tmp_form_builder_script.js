// extracted script for syntax checking
const fs = require('fs');
const p = 'admin-static/form-builder.html';
const html = fs.readFileSync(p,'utf8');
const start = html.indexOf('<script>');
const end = html.lastIndexOf('</script>');
const script = html.slice(start + '<script>'.length, end);
fs.writeFileSync('scripts/tmp_extracted_script_body.js', script, 'utf8');
console.log('wrote scripts/tmp_extracted_script_body.js');
