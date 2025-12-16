const fs = require('fs');
const path = require('path');
const os = require('os');

let LOG_DIR = path.join(__dirname, 'logs');
let fileLogging = true;

// Try to create the normal logs dir; if that fails (serverless readonly),
// fall back to the OS temp directory. If all fails, disable file logging.
try {
  fs.mkdirSync(LOG_DIR, { recursive: true });
} catch (err) {
  try {
    LOG_DIR = path.join(os.tmpdir(), 'chirag-frontend-logs');
    fs.mkdirSync(LOG_DIR, { recursive: true });
  } catch (err2) {
    fileLogging = false;
    console.warn('Logger: file logging disabled — cannot create logs directory.', err2 && err2.message);
  }
}

const LOG_FILE = path.join(LOG_DIR, 'app.log');

function timestamp(){ return new Date().toISOString(); }

function write(level, msg){
  const line = `[${timestamp()}] [${level.toUpperCase()}] ${msg}\n`;
  if (fileLogging) {
    try{
      fs.appendFileSync(LOG_FILE, line);
    }catch(e){
      // disable file logging to avoid repeated errors in serverless
      fileLogging = false;
      console.warn('Logger: disabling file logging due to append error', e && e.message);
    }
  }
  // always mirror to console so platform logs capture entries
  if(level === 'error') console.error(line); else console.log(line);
}

module.exports = {
  info: (msg) => write('info', typeof msg === 'string' ? msg : JSON.stringify(msg)),
  warn: (msg) => write('warn', typeof msg === 'string' ? msg : JSON.stringify(msg)),
  error: (msg) => write('error', typeof msg === 'string' ? msg : (msg && msg.stack) ? msg.stack : JSON.stringify(msg)),
  debug: (msg) => write('debug', typeof msg === 'string' ? msg : JSON.stringify(msg)),
  requestLogger: function(req, res, next){
    const start = Date.now();
    res.on('finish', ()=>{
      const ms = Date.now() - start;
      const meta = `${req.method} ${req.originalUrl} -> ${res.statusCode} ${ms}ms`;
      write('info', meta);
    });
    next();
  }
};
