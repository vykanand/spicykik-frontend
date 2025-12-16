const { spawn } = require('child_process');
const path = require('path');

// Spawn the server as a child process (use a distinct port to avoid conflicts)
const serverPath = path.join(__dirname, '..', 'server.js');
const env = Object.assign({}, process.env, { PORT: '3010' });

console.log('Starting server for shutdown test (port 3010)...');
const child = spawn(process.execPath, [serverPath], { cwd: path.join(__dirname, '..'), env, stdio: 'inherit' });

console.log('Spawned server PID:', child.pid);

// After a short delay, send SIGINT to the child to simulate Ctrl+C
setTimeout(() => {
  console.log('Sending SIGINT to server...');
  try {
    process.kill(child.pid, 'SIGINT');
  } catch (err) {
    console.error('Failed to send SIGINT:', err && err.message);
    try { child.kill(); } catch (e) {}
  }
}, 3000);

// When child exits, report and exit this script
child.on('exit', (code, signal) => {
  console.log('Server process exited. code=', code, 'signal=', signal);
  process.exit(0);
});
