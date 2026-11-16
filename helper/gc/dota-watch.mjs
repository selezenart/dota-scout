// Keeps the bot account signed in only while Dota is running, so a helper that starts at login
// does not keep the bot online around the clock.
import {execFile} from 'node:child_process';

// True when a process list (macOS/Linux `ps -A -o comm=`, Windows `tasklist /FO CSV /NH`) contains Dota.
export function dotaInProcessList(text, platform = process.platform) {
  const lines = String(text || '').split(/\r?\n/).map(line => line.trim());
  if (platform === 'win32') return lines.some(line => /^"dota2\.exe"/i.test(line));
  return lines.some(line => /(^|\/)dota2$/.test(line));
}

function run(command, args) {
  return new Promise((resolve, reject) => {
    execFile(command, args, {timeout: 5000, windowsHide: true, maxBuffer: 4 * 1024 * 1024}, (error, stdout) => (error ? reject(error) : resolve(stdout)));
  });
}

export function dotaRunningCheck(platform = process.platform, runCommand = run) {
  return platform === 'win32'
    ? async () => dotaInProcessList(await runCommand('tasklist', ['/FI', 'IMAGENAME eq dota2.exe', '/FO', 'CSV', '/NH']), platform)
    : async () => dotaInProcessList(await runCommand('ps', ['-A', '-o', 'comm=']), platform);
}

// check() is called on a timer. When the process list cannot be read, the bot stays signed in,
// so the lineup still works.
export function createDotaWatch({isDotaRunning, startBot, log = () => {}, graceMs = 120000, now = Date.now}) {
  let bot = null;
  let lastSeen = -Infinity;

  async function check() {
    let running;
    try {
      running = await isDotaRunning();
    } catch {
      running = true;
    }
    if (running) {
      lastSeen = now();
      if (!bot) {
        log('Dota is running. Signing in the bot account…');
        bot = startBot();
      }
    } else if (bot && now() - lastSeen >= graceMs) {
      log('Dota closed. Signing the bot account out until Dota starts again.');
      bot.stop();
      bot = null;
    }
  }

  return {
    check,
    isActive: () => bot !== null,
    lookupLobby: async lobbyId => (bot ? bot.lookupLobby(lobbyId) : null),
    stop: () => { bot?.stop(); bot = null; },
  };
}
