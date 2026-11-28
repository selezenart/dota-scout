import {signupProgress} from './signup-progress.js';
import {DISPLAY_NAME_MAX,OAUTH_PROVIDER_KEY} from './constants.js';
export function createWelcome({getBackend,steamEnabled,googleEnabled,onSession,onRegistered,onPractice,onHome,onInvitation,hasInvitation,hasDraftInvitation,onOpenTeam}) {
 const $=id=>document.getElementById(id);
 function googleButton(){
  const wrap=document.createElement('div');wrap.className='google-auth';
  const button=document.createElement('button');button.type='button';button.className='google-auth-button';
  const icon=document.createElement('img');icon.src='data:image/svg+xml,'+encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48"><path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/><path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"/><path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"/><path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/></svg>');icon.alt='';icon.width=20;icon.height=20;
  const label=document.createElement('span');label.textContent='Continue with Google';button.append(icon,label);
  const hint=document.createElement('p');hint.className='google-auth-hint';hint.textContent='Google sign-in is being set up. Use Steam or email for now.';
  const error=document.createElement('p');error.className='auth-message';error.setAttribute('role','status');error.setAttribute('aria-live','polite');error.hidden=true;
  button.disabled=!googleEnabled?.();hint.hidden=!button.disabled;
  button.onclick=async()=>{
   if(busy||button.disabled)return;const backend=getBackend();if(!backend)return;
   busy=true;button.disabled=true;button.setAttribute('aria-busy','true');label.textContent='Opening Google…';error.hidden=true;
   try{try{sessionStorage.setItem(OAUTH_PROVIDER_KEY,'google');}catch{}await backend.signInGoogle();}
   catch{try{sessionStorage.removeItem(OAUTH_PROVIDER_KEY);}catch{}error.textContent='Google sign-in could not start. Try again, or use Steam or email.';error.hidden=false;}
   finally{busy=false;button.disabled=!googleEnabled?.();button.removeAttribute('aria-busy');label.textContent='Continue with Google';}
  };
  wrap.append(button,hint,error);return wrap;
 }
 function refreshGoogle(){for(const wrap of $('welcome-auth')?.querySelectorAll('.google-auth')||[]){if(!busy){wrap.querySelector('button').disabled=!googleEnabled?.();wrap.querySelector('.google-auth-hint').hidden=!!googleEnabled?.();}}}
 function steamLink(){
  const link=document.createElement('a');link.href='/api/steam';link.className='steam-auth-link';
  const icon=document.createElementNS('http://www.w3.org/2000/svg','svg');icon.setAttribute('viewBox','0 0 24 24');icon.setAttribute('aria-hidden','true');icon.setAttribute('focusable','false');
  const path=document.createElementNS('http://www.w3.org/2000/svg','path');path.setAttribute('d','M11.979 0C5.678 0 .511 4.86.022 11.037l6.432 2.658c.545-.371 1.203-.59 1.912-.59.063 0 .125.004.188.006l2.861-4.142V8.91c0-2.495 2.028-4.524 4.524-4.524 2.494 0 4.524 2.031 4.524 4.527s-2.03 4.525-4.524 4.525h-.105l-4.076 2.911c0 .052.004.105.004.159 0 1.875-1.515 3.396-3.39 3.396-1.635 0-3.016-1.173-3.331-2.727L.436 15.27C1.862 20.307 6.486 24 11.979 24c6.627 0 11.999-5.373 11.999-12S18.605 0 11.979 0zM7.54 18.21l-1.473-.61c.262.543.714.999 1.314 1.25 1.297.539 2.793-.076 3.332-1.375.263-.63.264-1.319.005-1.949s-.75-1.121-1.377-1.383c-.624-.26-1.29-.249-1.878-.03l1.523.63c.956.4 1.409 1.5 1.009 2.455-.397.957-1.497 1.41-2.454 1.012H7.54zm11.415-9.303c0-1.662-1.353-3.015-3.015-3.015-1.665 0-3.015 1.353-3.015 3.015 0 1.665 1.35 3.015 3.015 3.015 1.663 0 3.015-1.35 3.015-3.015zm-5.273-.005c0-1.252 1.013-2.266 2.265-2.266 1.249 0 2.266 1.014 2.266 2.266 0 1.251-1.017 2.265-2.266 2.265-1.253 0-2.265-1.014-2.265-2.265z');icon.append(path);
  link.append(icon,document.createTextNode('Continue with Steam'));return link;
 }
 let connection='checking';
 let explicitHome=false, mode='signin', busy=false, recovery=false;
 // A restored session must not look signed out on the home page.
 let signedInAccount=false,loadingMessage='',settled=false;
 function syncAccount(){
  const signin=$('welcome-signin'),register=$('welcome-register'),loading=$('welcome-loading');
  // While a session or sign-in callback is still resolving, show progress instead of signed-out controls.
  if(loading){if(loadingMessage)loading.textContent=loadingMessage;loading.hidden=!loadingMessage;}
  if(loadingMessage)document.documentElement.dataset.authPending='';
  else if(settled)delete document.documentElement.dataset.authPending;
  if(signin)signin.hidden=!!loadingMessage;
  if(signin){
   const updating=signedInAccount&&recovery;
   signin.textContent=updating?'Choose new password':signedInAccount?'Open my team':'Sign in';
   // Signed in, the button navigates instead of opening the auth panel.
   if(signedInAccount&&!updating)signin.removeAttribute('aria-controls');else signin.setAttribute('aria-controls','welcome-auth');
  }
  if(register)register.hidden=signedInAccount||!!loadingMessage;
 }
 function view(board){document.body.dataset.view=board?'board':'welcome';if($('welcome-view'))$('welcome-view').hidden=board;if($('app-shell'))$('app-shell').hidden=!board;}
 function board(){explicitHome=false;clear();view(true);}
 function continueToBoard(){if(!onInvitation?.()){if(onRegistered)onRegistered();else board();}}
 function refreshSteam(){const f=$('welcome-auth')?.querySelector('form.auth-form');if(!f||!['signin','register'].includes(mode)||!steamEnabled?.()||f.querySelector('.steam-auth-link'))return;(f.querySelector('.auth-providers')||f).prepend(steamLink());}
 function clear(){const root=$('welcome-auth');if(!root)return;root.querySelectorAll('input').forEach(i=>i.value='');root.replaceChildren();root.hidden=true;}
 function home(next){explicitHome=true;view(false);if(next)form(next);else clear();}
 function showConnection(message){if(connection==='unavailable')message.textContent='Team accounts are unavailable right now. You can continue with local practice or the demo.';else if(connection==='checking')message.textContent='Checking sign-in availability…';else message.textContent='';}
 function form(next='signin'){
  if(busy)return;
  mode=next;view(false);const root=$('welcome-auth');if(!root)return;clear();root.hidden=false;
  const f=document.createElement('form');f.className='auth-form';
  const heading=document.createElement('h2');heading.textContent={signin:'Sign in',register:'Create account',recover:'Recover password',update:'Choose a new password'}[mode];f.append(heading);
  if(['signin','register'].includes(mode)&&(hasInvitation?.()||new URLSearchParams(location.search).has('cup')))f.append(signupProgress(0,false,{},!hasInvitation?.()));
  if(hasInvitation?.()&&mode!=='update'){
   const context=document.createElement('p');context.className='auth-message';context.textContent='After signing in, you can accept your team invitation.';f.append(context);
  }
  if(hasDraftInvitation?.()&&mode!=='update'){
   const context=document.createElement('p');context.className='auth-context';context.textContent='You were invited to a shared draft. Sign in with the account you use for this team.';heading.after(context);
  }
  function field(label,type,autocomplete){const l=document.createElement('label');l.className='auth-field';l.textContent=label;const i=document.createElement('input');i.type=type;i.required=true;i.autocomplete=autocomplete;l.append(i);f.append(l);return i;}
  const name=mode==='register'?field('Display name','text','name'):null;if(name)name.maxLength=DISPLAY_NAME_MAX;
  const email=mode!=='update'?field('Email','email','email'):null;
  const password=mode!=='recover'?field('Password','password',mode==='signin'?'current-password':'new-password'):null;
  const actions=document.createElement('div');actions.className='auth-actions';
  function action(label,fn,parent=actions){const b=document.createElement('button');b.type='button';b.textContent=label;b.onclick=fn;parent.append(b);return b;}
  if(password){if(mode!=='signin')password.minLength=6;action('Show password',e=>{const visible=password.type==='password';password.type=visible?'text':'password';e.currentTarget.textContent=visible?'Hide password':'Show password';e.currentTarget.setAttribute('aria-pressed',String(visible));});}
  const submit=document.createElement('button');submit.type='submit';submit.className='primary';submit.textContent=heading.textContent;actions.append(submit);f.append(actions);
  const message=document.createElement('p');message.className='auth-message';message.setAttribute('role','status');message.setAttribute('aria-live','polite');f.append(message);showConnection(message);
  const switches=document.createElement('div');switches.className='auth-switch';for(const [label,target] of [['Sign in','signin'],['Create account','register'],['Forgot password?','recover']])if(target!==mode)action(label,()=>form(target),switches);
  if(hasInvitation?.()&&mode!=='update')action('Back to invitation',()=>onInvitation?.(),switches);
  else action('Back to welcome',()=>{onHome?.();const url=new URL(location.href);if(url.searchParams.has('draft')){url.searchParams.delete('draft');history.replaceState(history.state,'',url);}home();},switches);
  f.append(switches);if(['signin','register'].includes(mode)){const providers=document.createElement('div');providers.className='auth-providers';if(steamEnabled?.())providers.append(steamLink());providers.append(googleButton());const help=document.createElement('p');help.className='profile-help';help.textContent='Use the same sign-in method each time. Steam and Google currently create separate accounts.';providers.append(help);f.append(providers);}root.append(f);(name||email||password)?.focus();
  f.onsubmit=async event=>{
   event.preventDefault();
   if(busy||!f.reportValidity())return;
   const backend=getBackend();
   if(!backend){if(connection==='checking'){message.dataset.state='availability';showConnection(message);}else{message.dataset.state='availability';message.textContent='Sign-in service unavailable. Try again later or continue with local practice.';}return;}
   const address=email?.value.trim();
   const controls=[...f.querySelectorAll('button,input')];
   busy=true;
   controls.forEach(control=>control.disabled=true);
   actions.setAttribute('aria-busy','true');
   submit.dataset.loading='true';
   submit.textContent={signin:'Signing in…',register:'Creating account…',recover:'Requesting reset…',update:'Saving password…'}[mode];
   message.dataset.state='loading';
   message.textContent=submit.textContent;
   let confirmation=false;
   try{
    if(mode==='recover'){
     await backend.recoverPassword(address,new URL('/',location.origin).href);
     message.dataset.state='success';
     message.textContent=`If an account exists for ${address}, look for a password reset email. Check your spam folder too.`;
    }else if(mode==='update'){
     await backend.updatePassword(password.value);
     recovery=false;
     syncAccount();
     confirmation=true;
     password.value='';
     for(const child of [...f.children])if(child!==heading&&child!==message)child.remove();
     heading.textContent='Password saved';
     message.dataset.state='success';
     message.textContent='Your new password was saved. You can continue to the draft board.';
     const continueButton=action('Continue to board',continueToBoard,f);continueButton.className='primary';continueButton.focus();
    }else{
     const result=mode==='register'?await backend.signUp(address,password.value,name.value,'/'):await backend.signIn(address,password.value);
     // onSession runs the sign-in gates and opens the requested draft, Battle Cup or Team.
     if(result?.session){await onSession(result.session);onInvitation?.();}
     else if(mode==='register'){
      confirmation=true;
      password.value='';
      for(const child of [...f.children])if(child!==heading&&child!==message)child.remove();
      heading.textContent='Check your inbox';
      message.dataset.state='success';
      message.textContent=`Look for a confirmation email at ${address} to confirm your account. Open the link, then sign in. Check your spam folder if it hasn’t arrived.`;
      if(hasInvitation?.())message.textContent+=' Open the confirmation on this browser to resume your team invitation. On another browser, reopen the original team invite link after confirming.';
      const nextSteps=document.createElement('div');
      nextSteps.className='auth-actions';
      const signIn=action('Go to sign in',()=>{form('signin');$('welcome-auth').querySelector('input[type=email]').value=address;},nextSteps);
      signIn.className='primary';
      action('Use a different email',()=>form('register'),nextSteps);
      f.append(nextSteps);
      signIn.focus();
     }else{
      throw new Error('Sign-in did not return a session. Please try again.');
     }
    }
   }catch(error){
    message.dataset.state='error';
    message.textContent=error.code==='email_not_confirmed'
     ? `Confirm the email for ${address} before signing in. If you already clicked the link, try signing in again.`
     : error.message||'Unable to complete the request. Please try again.';
   }finally{
    busy=false;
    actions.removeAttribute('aria-busy');
    delete submit.dataset.loading;
    if(!confirmation){submit.textContent=heading.textContent;controls.forEach(control=>control.disabled=false);refreshGoogle();}
   }
  };
 }
 function invitation({account,invalid,expired,teamName,onAccept,onSwitch,onDismiss}){
  view(false);clear();const root=$('welcome-auth');if(!root)return;
  root.hidden=false;const card=document.createElement('section');card.className='auth-form';card.setAttribute('aria-labelledby','team-invite-heading');
  const heading=document.createElement('h2');heading.id='team-invite-heading';heading.textContent=teamName?'Join '+teamName:'Team invitation';card.append(heading);
  if(!invalid)card.append(signupProgress(account?1:0));
  const description=document.createElement('p');description.textContent=expired?'This invitation is invalid or expired. You can still sign up for Battle Cup without a team.':invalid?'This invitation link is invalid. Ask the team owner for a current link.':account?`Signed in as ${account}. Join to share your player profile with this team.`:'Sign in or create an account to accept this invitation and share your player profile with the team.';card.append(description);
  const actions=document.createElement('div');actions.className='auth-actions';card.append(actions);
  const message=document.createElement('p');message.className='auth-message';message.setAttribute('role','status');card.append(message);
  function action(label,fn,primary=false){
   const b=document.createElement('button');b.type='button';b.textContent=label;if(primary)b.className='primary';actions.append(b);
   b.onclick=async()=>{
    for(const control of actions.children)control.disabled=true;
    try{await fn();}catch(error){message.dataset.state='error';message.textContent=error.message||'Unable to complete the request. Try again.';}
    finally{for(const control of actions.children)control.disabled=false;}
   };return b;
  }
  if(!invalid&&account){action('Join team',()=>{message.dataset.state='loading';message.textContent='Joining team…';return onAccept();},true);action('Use another account',onSwitch);}
  else if(!invalid){if(steamEnabled?.())actions.append(steamLink());actions.append(googleButton());action('Create account',()=>form('register'));action('Sign in',()=>form('signin'));const help=document.createElement('p');help.className='profile-help';help.textContent='Use the same sign-in method each time. Steam and Google currently create separate accounts. If sign-in fails inside a messenger, open this link in your browser.';card.append(help);}
  action(expired?'Continue to Battle Cup':invalid?'Dismiss invitation':'Decline invitation',onDismiss,expired);
  root.append(card);actions.firstElementChild?.focus();
 }
 for(const [id,next] of [['welcome-signin','signin'],['welcome-register','register']])if($(id))$(id).onclick=e=>{e.preventDefault();if(signedInAccount){if(recovery)form('update');else if(onOpenTeam)onOpenTeam();else board();return;}form(next);};
 if($('welcome-practice'))$('welcome-practice').onclick=e=>{e.preventDefault();const result=onPractice();const enter=allowed=>{if(allowed===false)return;board();$('hero-search')?.focus();};if(result?.then)result.then(enter);else enter(result);};
 if($('home-button'))$('home-button').onclick=e=>{e.preventDefault();onHome?.();const url=new URL(location.href);url.searchParams.delete('cup');url.searchParams.delete('practice');url.searchParams.delete('demo');url.searchParams.delete('mock');url.searchParams.delete('draft');url.searchParams.delete('team');history.pushState({home:true},'',url);if(!onInvitation?.())home();};
 const params=new URLSearchParams(location.search);view(params.has('demo')||params.has('mock')||params.has('practice'));
 return {board,home,form,clear,invitation,setAccount(value,keepRecovery=false){signedInAccount=!!value;loadingMessage='';settled=true;if(!keepRecovery)recovery=false;syncAccount();},loading(message=''){loadingMessage=message;if(!message)settled=true;syncAccount();},setConnection(value){connection=value;if(value==='unavailable'){loadingMessage='';settled=true;}syncAccount();refreshSteam();refreshGoogle();const message=$('welcome-auth')?.querySelector('form>.auth-message[role="status"]');if(message&&!busy&&(!message.dataset.state||message.dataset.state==='availability')){delete message.dataset.state;showConnection(message);}},linkError(provider){
  loadingMessage='';settled=true;syncAccount();form('signin');
  const message=$('welcome-auth')?.querySelector('form>.auth-message[role="status"]');
  if(message){message.dataset.state='error';message.textContent=provider==='google'?'Google sign-in was canceled or could not finish. Try again, or use Steam or email.':'This email link is expired or has already been used. If you confirmed your email earlier, try signing in. For password recovery, request a fresh link.';}
 },get recovery(){return recovery;},signedIn(){if(recovery)return;clear();if(!explicitHome)board();},recover(){recovery=true;syncAccount();form('update');}};
}
