// Script to check and kill process on port 3001 (backend) if needed
// Helps avoid EADDRINUSE on Windows when an old node process is still running.
import { execSync } from 'node:child_process';
import os from 'node:os';

const PORT = 3001;
const isWindows = os.platform() === 'win32';

function tryExec(cmd) {
  return execSync(cmd, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
}

try {
  if (isWindows) {
    let stdout = '';
    try {
      stdout = tryExec(`netstat -ano | findstr :${PORT}`);
    } catch {
      // no listeners
    }

    if (!stdout) process.exit(0);

    const pids = new Set();
    stdout
      .trim()
      .split('\n')
      .map(l => l.trim())
      .filter(Boolean)
      .forEach(line => {
        const parts = line.split(/\s+/);
        const pid = parts[parts.length - 1];
        if (pid && /^\d+$/.test(pid) && pid !== '0') pids.add(pid);
      });

    if (pids.size === 0) process.exit(0);

    console.log(`Found ${pids.size} process(es) on port ${PORT}, killing...`);
    for (const pid of pids) {
      try {
        execSync(`taskkill /PID ${pid} /F`, { stdio: 'ignore' });
      } catch {
        // ignore
      }
    }
  } else {
    let stdout = '';
    try {
      stdout = tryExec(`lsof -ti:${PORT}`);
    } catch {
      // no listeners
    }

    if (!stdout) process.exit(0);

    const pids = stdout
      .trim()
      .split('\n')
      .map(s => s.trim())
      .filter(Boolean);

    if (pids.length === 0) process.exit(0);

    console.log(`Found ${pids.length} process(es) on port ${PORT}, killing...`);
    for (const pid of pids) {
      try {
        execSync(`kill -9 ${pid}`, { stdio: 'ignore' });
      } catch {
        // ignore
      }
    }
  }
} catch {
  // Best-effort; don't fail dev startup because of this script
}

