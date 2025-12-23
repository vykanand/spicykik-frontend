const fs = require('fs');
const vm = require('vm');
const s = fs.readFileSync('admin-static/easybuild.js','utf8');
try{
  new vm.Script(s);
  console.log('OK: parsed successfully');
}catch(e){
  console.error('PARSE ERROR:', e && e.message);
  if(e && e.stack){
    const m = e.stack.split('\n')[0];
    console.error(e.stack.split('\n').slice(0,3).join('\n'));
  }
  process.exit(2);
}
