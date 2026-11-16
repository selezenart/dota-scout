// Signs in the separate bot Steam account with its saved sign-in token and keeps a
// connection to the Dota game coordinator for lobby lookups. Never signs in your main account.
import {chmod, writeFile} from 'node:fs/promises';
import {MSG, decodeFields, encodeClientHello} from './protobuf.mjs';
import {createLobbyLookup} from './lookup.mjs';

const DOTA_APP_ID = 570;

function connectionLost(payload) {
  try {
    return (decodeFields(payload).get(1)?.[0] ?? 0n) !== 0n;
  } catch {
    return false;
  }
}

export async function saveToken(file, token) {
  await writeFile(file, token, {mode: 0o600});
  await chmod(file, 0o600);
}

export function startBot({SteamUser, refreshToken, tokenFile, log, onToken = () => {}}) {
  const user = new SteamUser({dataDirectory: null, autoRelogin: true});
  let ready = false;
  let helloTimer = null;
  const lobbies = createLobbyLookup({
    send: payload => user.sendToGC(DOTA_APP_ID, MSG.FIND_SOURCETV_GAMES, {}, payload),
    isReady: () => ready,
  });

  const disconnect = () => {
    ready = false;
    clearInterval(helloTimer);
    lobbies.reset();
  };

  // Say hello every 5 s until the coordinator welcomes the bot.
  const greet = () => {
    clearInterval(helloTimer);
    const hello = () => { if (!ready) user.sendToGC(DOTA_APP_ID, MSG.CLIENT_HELLO, {}, encodeClientHello()); };
    hello();
    helloTimer = setInterval(hello, 5000);
  };

  user.on('loggedOn', () => {
    log('Bot account signed in. Connecting to the Dota game coordinator…');
    user.requestFreeLicense([DOTA_APP_ID], () => {
      user.gamesPlayed([DOTA_APP_ID]);
      greet();
    });
  });

  user.on('receivedFromGC', (appid, msgType, payload) => {
    if (appid !== DOTA_APP_ID) return;
    if (msgType === MSG.CLIENT_WELCOME && !ready) {
      ready = true;
      clearInterval(helloTimer);
      log('Connected to the Dota game coordinator. The lineup appears when picks start.');
    }
    if (msgType === MSG.FIND_SOURCETV_GAMES_RESPONSE) lobbies.handleResponse(payload);
    // CMsgConnectionStatus.status (field 1) other than HAVE_SESSION (0): the coordinator dropped
    // this session while Steam stayed connected, so start over.
    if (msgType === MSG.CLIENT_CONNECTION_STATUS && ready && connectionLost(payload)) {
      disconnect();
      log('The Dota game coordinator dropped the bot; reconnecting…');
      greet();
    }
  });

  user.on('playingState', blocked => {
    if (blocked) log('The bot account is playing on another device; the game coordinator lookup is paused.');
  });

  user.on('refreshToken', token => {
    onToken(token);
    saveToken(tokenFile, token).catch(() => log('Could not save the renewed bot sign-in token.'));
  });

  user.on('disconnected', () => {
    disconnect();
    log('Bot account disconnected from Steam; reconnecting…');
  });

  user.on('error', error => {
    disconnect();
    const reason = SteamUser.EResult?.[error?.eresult] || 'unknown error';
    log(`Bot sign-in failed (${reason}). Run "npm run bot-login" in the helper folder, then restart the helper.`);
  });

  user.logOn({refreshToken});

  return {
    lookupLobby: lobbies.lookup,
    stop: () => { disconnect(); user.logOff(); },
  };
}
