// Start the helper automatically when you log in, without a terminal window.
//   npm run autostart-on      turn it on (and start it now)
//   npm run autostart-off     turn it off (and stop it)
//   npm run autostart-status  show whether it is on
// The helper then waits in the background and signs the bot in only while Dota is running.
import {execFile} from 'node:child_process';
import {access, mkdir, rm, writeFile} from 'node:fs/promises';
import {homedir} from 'node:os';
import {dirname, join} from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';

export const LABEL = 'com.captainsdraft.helper';
// Settings from the current environment that the background helper keeps. No secrets:
// the helper reads steam-key.txt and bot-login-token.txt itself.
const PASSED_ENV = ['HELPER_ALLOWED_ORIGINS', 'DOTA_CONSOLE_LOG', 'STEAM_PATH', 'DOTA_ACCOUNT_ID'];

const xml = value => String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

export function launchAgentPlist({nodePath, serverPath, workDir, logPath, env = {}}) {
  const environment = {...env, HELPER_AUTOSTART: '1'};
  const entries = Object.entries(environment).map(([name, value]) => `      <key>${xml(name)}</key><string>${xml(value)}</string>`).join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
  <dict>
    <key>Label</key><string>${LABEL}</string>
    <key>ProgramArguments</key>
    <array>
      <string>${xml(nodePath)}</string>
      <string>${xml(serverPath)}</string>
    </array>
    <key>WorkingDirectory</key><string>${xml(workDir)}</string>
    <key>EnvironmentVariables</key>
    <dict>
${entries}
    </dict>
    <key>RunAtLoad</key><true/>
    <key>KeepAlive</key><dict><key>SuccessfulExit</key><false/></dict>
    <key>ThrottleInterval</key><integer>60</integer>
    <key>ProcessType</key><string>Background</string>
    <key>StandardOutPath</key><string>${xml(logPath)}</string>
    <key>StandardErrorPath</key><string>${xml(logPath)}</string>
  </dict>
</plist>
`;
}

// VBScript in the Startup folder: runs the helper with no window, output appended to a log file.
export function windowsStartupScript({nodePath, workDir, logPath, env = {}}) {
  const vbs = value => `"${String(value).replace(/"/g, '""')}"`;
  const environment = {...env, HELPER_AUTOSTART: '1'};
  const command = `cmd /c ""${nodePath}" server.mjs >> "${logPath}" 2>&1"`;
  return [
    "' Captain's Draft Board helper: starts at sign-in without a window. Remove with npm run autostart-off.",
    'Set shell = CreateObject("WScript.Shell")',
    `shell.CurrentDirectory = ${vbs(workDir)}`,
    ...Object.entries(environment).map(([name, value]) => `shell.Environment("PROCESS")(${vbs(name)}) = ${vbs(value)}`),
    `shell.Run ${vbs(command)}, 0, False`,
    '',
  ].join('\r\n');
}

function run(command, args) {
  return new Promise(resolve => {
    execFile(command, args, {timeout: 15000, windowsHide: true}, (error, stdout, stderr) => resolve({ok: !error, stdout: String(stdout), stderr: String(stderr)}));
  });
}

const exists = path => access(path).then(() => true, () => false);

function paths() {
  const helperDir = dirname(fileURLToPath(import.meta.url));
  if (process.platform === 'darwin') {
    return {
      helperDir,
      entry: join(homedir(), 'Library', 'LaunchAgents', `${LABEL}.plist`),
      log: join(homedir(), 'Library', 'Logs', 'CaptainsDraftHelper.log'),
    };
  }
  if (process.platform === 'win32') {
    const appData = process.env.APPDATA || join(homedir(), 'AppData', 'Roaming');
    const localAppData = process.env.LOCALAPPDATA || join(homedir(), 'AppData', 'Local');
    return {
      helperDir,
      entry: join(appData, 'Microsoft', 'Windows', 'Start Menu', 'Programs', 'Startup', 'CaptainsDraftHelper.vbs'),
      log: join(localAppData, 'CaptainsDraftHelper', 'helper.log'),
    };
  }
  return null;
}

async function turnOn(where) {
  if (!(await exists(join(where.helperDir, 'bot-login-token.txt'))) || !(await exists(join(where.helperDir, 'node_modules', 'steam-user')))) {
    console.error('Set up the bot first, in the helper folder:  npm ci --ignore-scripts  and  npm run bot-login');
    return 1;
  }
  const env = Object.fromEntries(PASSED_ENV.filter(name => process.env[name]).map(name => [name, process.env[name]]));
  await mkdir(dirname(where.entry), {recursive: true});
  await mkdir(dirname(where.log), {recursive: true});
  if (process.platform === 'darwin') {
    await writeFile(where.entry, launchAgentPlist({nodePath: process.execPath, serverPath: join(where.helperDir, 'server.mjs'), workDir: where.helperDir, logPath: where.log, env}), {mode: 0o600});
    const domain = `gui/${process.getuid()}`;
    await run('launchctl', ['bootout', `${domain}/${LABEL}`]);
    const loaded = await run('launchctl', ['bootstrap', domain, where.entry]);
    if (!loaded.ok) {
      console.error(`macOS did not start the helper: ${loaded.stderr.trim() || 'launchctl failed'}`);
      return 1;
    }
  } else {
    await writeFile(where.entry, windowsStartupScript({nodePath: process.execPath, workDir: where.helperDir, logPath: where.log, env}));
    await run('wscript.exe', [where.entry]);
  }
  console.log('The helper now starts when you log in and runs in the background.');
  console.log('The bot account signs in only while Dota is running.');
  console.log(`Log: ${where.log}`);
  return 0;
}

async function turnOff(where) {
  if (process.platform === 'darwin') await run('launchctl', ['bootout', `gui/${process.getuid()}/${LABEL}`]);
  await rm(where.entry, {force: true});
  console.log('The helper no longer starts at login.');
  if (process.platform === 'win32') console.log('A helper that is already running stops at your next sign-out (or end "Node.js" in Task Manager).');
  return 0;
}

async function status(where) {
  const on = await exists(where.entry);
  let running = '';
  if (on && process.platform === 'darwin') {
    const info = await run('launchctl', ['print', `gui/${process.getuid()}/${LABEL}`]);
    running = /state = running/.test(info.stdout) ? ' and running' : ' but not running right now';
  }
  console.log(on ? `Autostart is on${running}. Log: ${where.log}` : 'Autostart is off.');
  return 0;
}

async function main() {
  const where = paths();
  if (!where) {
    console.error('Autostart is available on macOS and Windows. On Linux, start ./helper/start.sh from your desktop session.');
    return 1;
  }
  const action = process.argv[2];
  if (action === 'on') return turnOn(where);
  if (action === 'off') return turnOff(where);
  if (action === 'status') return status(where);
  console.error('Usage: node autostart.mjs on|off|status');
  return 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) process.exitCode = await main();
