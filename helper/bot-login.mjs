// One-time sign-in of the separate bot Steam account the helper uses to ask the Dota game
// coordinator for your lobby. You type the name, password and Steam Guard code here; only Steam's
// sign-in token is saved, in bot-login-token.txt next to this file. Never use your main account.
import {createInterface} from 'node:readline';
import {fileURLToPath} from 'node:url';
import {saveToken} from './gc/bot.mjs';

const TOKEN_FILE = fileURLToPath(new URL('./bot-login-token.txt', import.meta.url));

function ask(question, {hidden = false} = {}) {
  return new Promise(resolve => {
    const rl = createInterface({input: process.stdin, output: process.stdout, terminal: true});
    if (hidden) rl._writeToOutput = text => { if (text.includes(question)) rl.output.write(question); };
    rl.question(question, answer => { rl.close(); if (hidden) process.stdout.write('\n'); resolve(answer.trim()); });
  });
}

let SteamUser;
try {
  ({default: SteamUser} = await import('steam-user'));
} catch {
  console.error('Missing dependency. Run this once in the helper folder:  npm ci --ignore-scripts');
  process.exit(1);
}

const user = new SteamUser({dataDirectory: null, autoRelogin: false});

user.on('steamGuard', async (domain, callback, lastCodeWrong) => {
  if (lastCodeWrong) console.log('That Steam Guard code was wrong. Wait 30 s before the next one.');
  callback(await ask(domain ? `Steam Guard code sent to your email at ${domain}: ` : 'Steam Guard code from the Steam app: '));
});

user.on('refreshToken', async token => {
  try {
    await saveToken(TOKEN_FILE, token);
    console.log('Bot signed in. Saved its sign-in token to bot-login-token.txt. Start the helper now.');
  } catch {
    console.error('Could not save bot-login-token.txt.');
    process.exitCode = 1;
  }
  user.logOff();
  setTimeout(() => process.exit(), 500);
});

user.on('error', error => {
  console.error(`Steam sign-in failed: ${SteamUser.EResult?.[error?.eresult] || 'unknown error'}.`);
  process.exit(1);
});

console.log('Sign in the SEPARATE bot Steam account (not your main account). The password is not stored.');
const accountName = await ask('Bot account name: ');
const password = await ask('Bot account password: ', {hidden: true});
user.logOn({accountName, password});
