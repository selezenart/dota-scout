// Player profile dialog and its hero picker.
import {signupProgress} from './signup-progress.js';
import {parseAccountIds} from './draft-engine.js';
import {loadPlayer} from './data.js';
import {DISPLAY_NAME_MAX,HERO_LIST_MAX,ROSTER_SIZE} from './constants.js';
import {demo} from './url-state.js';
import {store} from './store.js';
import {$,el,button,field,show} from './dom.js';
import {ui,render} from './ui.js';
import {touch,observations,roleNames,heroName,portrait} from './draft-data.js';
import {saveLocal} from './practice-store.js';
import {refreshScouting} from './scouting.js';
import {loadTeam} from './draft-sync.js';

function heroPicker(parent,label,values,{kind,getRoles,getAccountId,onError}={}){

 const selected=new Set(values||[]),wrap=el('section',null,'profile-hero-picker');

 wrap.dataset.kind=kind;

 const heading=el('div',null,'profile-section-heading'),count=el('span');

 heading.append(el('h3',label),count);

 const search=field(wrap,'Find a hero'),chips=el('div',null,'profile-hero-chips'),hint=el('p',null,'profile-help'),list=el('div',null,'profile-hero-suggestions');

 wrap.prepend(heading);wrap.append(chips,hint,list);parent.append(wrap);

 function toggle(id){

  if(selected.has(id))selected.delete(id);

  else{

   if(selected.size>=HERO_LIST_MAX){onError(`Choose up to ${HERO_LIST_MAX} heroes in each list. Remove one first.`);return;}

   selected.add(id);

  }

  const focused=document.activeElement,source=focused?.classList.contains('profile-hero-chip')?'chip':'choice';
  onError('');draw();
  const replacement=wrap.querySelector(`[data-hero-id="${id}"][data-source="${source}"]`)||wrap.querySelector(`[data-hero-id="${id}"]`);
  (replacement||search).focus();

 }

 function draw(){

  count.textContent=selected.size+' / '+HERO_LIST_MAX+' selected';chips.replaceChildren();

  for(const id of selected){

   const b=button('',()=>toggle(id),chips,'profile-hero-chip');

   b.dataset.heroId=id;b.dataset.source='chip';
   b.append(portrait(id),el('span',heroName(id)),el('span','×'));

   b.setAttribute('aria-label','Remove '+heroName(id));

  }

  search.placeholder='Search all heroes';
  const played=new Map((observations.get(getAccountId?.()||String(store.profile.steamAccountId||''))?.heroes||[]).filter(h=>h.games>0).map(h=>[+h.hero_id,h.games]));

  const query=search.value.trim().toLowerCase(),roles=getRoles(),support=roles.length&&roles.every(role=>role>=4);

  const core=roles.length&&roles.every(role=>role<=3);

  hint.textContent=query?'Matching heroes · click to toggle.':support?'Popular support suggestions · choose heroes you actually play.':core?'Popular core suggestions · choose heroes you actually play.':'Popular suggestions · choose heroes you actually play.';

  if(!query&&played.size)hint.textContent='Selected heroes first, then your public match history. Import can suggest heroes in empty lists; review before saving.';

  let choices=Object.values(store.heroes).filter(h=>h.localized_name.toLowerCase().includes(query));

  if(!query&&support)choices=choices.filter(h=>selected.has(+h.id)||(h.roles||[]).includes('Support'));

  else if(!query&&core)choices=choices.filter(h=>selected.has(+h.id)||!(h.roles||[]).includes('Support')||(h.roles||[]).includes('Carry'));

  choices.sort((a,b)=>Number(selected.has(+b.id))-Number(selected.has(+a.id))||(played.get(+b.id)||0)-(played.get(+a.id)||0)||(b.pub_pick||0)-(a.pub_pick||0)||a.localized_name.localeCompare(b.localized_name));

  list.replaceChildren();

  for(const h of choices.slice(0,Math.max(12,selected.size))){

   const b=button('',()=>toggle(+h.id),list,'profile-hero-choice');

   b.dataset.heroId=h.id;b.dataset.source='choice';
   const image=portrait(h.id);image.alt='';b.append(image,el('span',h.localized_name));b.setAttribute('aria-pressed',String(selected.has(+h.id)));

  }

  if(!list.children.length)list.append(el('p','No matching heroes.'));

 }

 search.oninput=draw;draw();

 return {values:()=>[...selected],draw,replace(values){
  if(values.length>HERO_LIST_MAX){
   onError(`This list has more than ${HERO_LIST_MAX} heroes. Choose up to ${HERO_LIST_MAX} before copying it to Today.`);
   return false;
  }
  selected.clear();
  for(const id of values)selected.add(id);
  draw();
  return true;
 }};

}

export function startProfileSetup(continueAfterSave,joinedTeam=null){
 ui.welcome.board();
 $('app-shell').dataset.profileSetup='true';
 profileDialog(false,joinedTeam,false,0,continueAfterSave);
}

export function profileDialog(local=false,joinedTeam=null,continueToCup=false,initialHeroTab=0,continueAfterSave=null){

 if(store.backend&&!store.user&&!demo&&!local){ui.welcome.home('signin');return;}

 const root=$('profile-content');
 root.replaceChildren();
 $('profile-title').textContent=continueAfterSave?'Set up your player profile':'Your profile';
 $('profile-dialog').querySelector('[data-close]').hidden=!!continueAfterSave;
 $('profile-dialog').oncancel=continueAfterSave?event=>event.preventDefault():null;
 $('profile-dialog').querySelector('.profile-footer')?.remove();

 if(continueAfterSave)root.append(el('p','Choose a display name and at least one position to continue. You can add or change heroes anytime.','profile-help'));
 if(joinedTeam||continueToCup)root.append(signupProgress(2));
 if(joinedTeam)root.append(el('p',`You joined ${joinedTeam.name}. Add the roles and heroes you want your team to see, then save your profile.`,'profile-help'));

 if(!store.backend||!store.user||demo)root.append(el('p',demo?'Demo preferences are invented and local.':'Local preference profile · no authentication or sync.','profile-help'));

 root.append(el('p','Build your player card. Choose your roles, then tell your captain what you want to play.','profile-intro'));

 const identity=el('div',null,'profile-identity');
 root.append(identity);

 const name=field(identity,'Display name',store.profile.displayName||''),account=field(identity,'Public account ID or player URL · optional',store.profile.steamAccountId||'');
 const workspace=el('div',null,'profile-workspace'),roleSection=el('section',null,'profile-roles-section'),heroSection=el('section',null,'profile-heroes-section');
 workspace.append(roleSection,heroSection);
 root.append(workspace);

 const presetBar=el('div',null,'profile-role-presets'),roles=el('div',null,'profile-role-grid');

 roleSection.append(el('h3','Where do you play?'),el('p','Select your preferred positions. Open Comfort to adjust your experience.','profile-help'),presetBar,roles);
 const presetHelp=el('p','Presets replace your roles and comfort levels. Undo is available.','profile-help profile-preset-help');
 roleSection.append(presetHelp);

 const roleInputs=[],pickers=[];

 const redrawHeroes=()=>pickers.forEach(picker=>picker.draw());
 const updateComfort=()=>{for(const role of roleInputs){role.summary.textContent='Comfort · '+role.radios.find(r=>r.checked)?.nextElementSibling.textContent;}};
 const clearPreset=()=>{for(const b of presetBar.querySelectorAll('button'))b.setAttribute('aria-pressed','false');updateComfort();};
 const manualRoles=()=>{clearPreset();redrawHeroes();};

 for(let i=1;i<=5;i++){

  const card=el('div',null,'profile-role-card'),preference=el('label',null,'profile-role-toggle'),c=el('input');

  c.type='checkbox';c.id='profile-role-'+i;c.checked=(store.profile.preferredRoles||[]).includes(i);

  preference.htmlFor=c.id;preference.append(c,el('span','P'+i,'profile-role-number'),el('span',roleNames[i-1],'profile-role-name'));c.onchange=manualRoles;
  const expertise=el('details',null,'profile-role-expertise'),summary=el('summary');expertise.append(summary);

  const comfort=el('fieldset',null,'profile-comfort');comfort.append(el('legend','Comfort for '+roleNames[i-1]));

  const radios=[];

  ['Unset','Learning','Playable','Comfortable','Strong','Signature'].forEach((text,value)=>{

   const label=el('label'),radio=el('input');
   radio.type='radio';
   radio.name='profile-comfort-'+i;
   radio.id='profile-comfort-'+i+'-'+value;
   radio.value=String(value);

   radio.checked=Number(store.profile.roleComfort?.[i]||0)===value;
   radio.onchange=clearPreset;
   label.htmlFor=radio.id;

   label.append(radio,el('span',text));
   comfort.append(label);
   radios.push(radio);

  });

  expertise.append(comfort);card.append(preference,expertise);roles.append(card);roleInputs.push({i,c,radios,summary});

 }
 updateComfort();

 let previousRoles;

 for(const [label,preferred] of [['Carry',[1]],['Mid',[2]],['Offlane',[3]],['Support',[4,5]],['Flex',[1,2,3,4,5]]]){

  const preset=button(label,()=>{

   previousRoles=roleInputs.map(role=>({checked:role.c.checked,comfort:role.radios.find(radio=>radio.checked)?.value||'0'}));

   undoPreset.hidden=false;

   for(const role of roleInputs){role.c.checked=preferred.includes(role.i);for(const radio of role.radios)radio.checked=+radio.value===(role.c.checked?3:0);}

   for(const b of presetBar.querySelectorAll('button'))b.setAttribute('aria-pressed',String(b===preset));
   updateComfort();

   redrawHeroes();

  },presetBar);preset.setAttribute('aria-pressed','false');

 }

 const undoPreset=button('Undo preset',()=>{
  if(!previousRoles)return;
  roleInputs.forEach((role,index)=>{
   role.c.checked=previousRoles[index].checked;
   for(const radio of role.radios)radio.checked=radio.value===previousRoles[index].comfort;
  });
  for(const b of presetBar.querySelectorAll('button'))b.setAttribute('aria-pressed','false');
  undoPreset.hidden=true;
  updateComfort();
  redrawHeroes();
 },presetBar);
 undoPreset.hidden=true;

 const status=el('p',null,'profile-save-status');
 status.setAttribute('role','status');
 status.setAttribute('aria-live','polite');

 function message(text,error=false){status.textContent=text;status.dataset.state=error?'error':'idle';}

 const options=kind=>({kind,getRoles:()=>roleInputs.filter(role=>role.c.checked).map(role=>role.i),getAccountId:()=>String(parseAccountIds(account.value)[0]||''),onError:text=>message(text,!!text)});

 heroSection.append(el('h3','Your hero pool'),el('p','Keep your proven picks separate from what you feel like playing today.','profile-help'));
 const heroTabs=el('div',null,'profile-hero-tabs');
 heroTabs.setAttribute('role','tablist');
 heroTabs.setAttribute('aria-label','Hero preferences');
 heroSection.append(heroTabs);

 const heroSections=el('div');
 heroSection.append(heroSections);

 const signatures=heroPicker(heroSections,'Signature heroes · your proven picks',store.profile.signatureHeroes,options('signature'));

 const desired=heroPicker(heroSections,'Today · heroes you want to play',store.profile.desiredHeroes,options('desired'));

 const todayActions=el('div',null,'profile-today-actions');

 button('Use signatures for today',()=>{if(desired.replace(signatures.values()))message('Today replaced with your signature heroes.');},todayActions);

 button('Clear today',()=>{desired.replace([]);message('Today’s list cleared.');},todayActions);

 heroSections.querySelector('[data-kind=desired]').querySelector('input')?.parentElement.after(todayActions);

 const avoid=heroPicker(heroSections,'Avoid · heroes to leave out',store.profile.avoidHeroes,options('avoid'));

 pickers.push(signatures,desired,avoid);
 const importPanel=el('div',null,'profile-import'),importStatus=el('p','Start here: import your public match history to fill empty Signatures and Today lists. Review the suggestions before saving.','profile-help');
 importStatus.setAttribute('role','status');
 identity.after(importPanel);
 account.placeholder='Dotabuff or OpenDota player link, or Steam ID';
 const importHelp=el('details',null,'profile-import-help');
 importHelp.append(el('summary','Where do I find my player link?'),el('p','Open your player page on Dotabuff or OpenDota and copy its address. You can also paste your numeric Dota account ID or Steam ID. Enable public match data in Dota if your history is private.'));
 identity.after(importHelp);
 if(/^Steam \d+$/.test(name.value))name.parentElement.append(el('small','Use a nickname your teammates will recognize.','profile-help'));
 const importButton=button('Import public stats',async()=>{
  if(importButton.disabled)return;
  const ids=parseAccountIds(account.value);
  if(ids.length!==1){importStatus.textContent='Enter one Dota account ID, Steam ID or player URL first.';account.focus();return;}
  const id=String(ids[0]),gen=store.generation,initialName=name.value;
  importButton.disabled=true;
  save.disabled=true;
  importButton.setAttribute('aria-busy','true');
  importStatus.textContent='Loading public match history…';
  try{
   const player=await loadPlayer(id);
   if(gen!==store.generation||!root.contains(importPanel)||parseAccountIds(account.value).map(String).join()!==id)return;
   observations.set(id,player);
   const suggestions=(player.heroes||[]).filter(h=>Number(h.games)>0&&store.heroes[Number(h.hero_id)]).sort((a,b)=>Number(b.games)-Number(a.games)).slice(0,5).map(h=>Number(h.hero_id));
   if(name.value===initialName&&(!initialName||initialName==='Steam player'||/^Steam \d+$/.test(initialName))&&player.profile?.profile?.personaname)name.value=player.profile.profile.personaname;
   if(suggestions.length){
    if(!signatures.values().length)signatures.replace(suggestions);
    const copiedToday=!desired.values().length;
    if(copiedToday)desired.replace(signatures.values());
    importStatus.textContent=copiedToday?'Public history loaded. Signatures are also suggested in Today. Change either list to match what you want to play, then save.':'Public history loaded. Your existing Today choices were kept. Review your hero lists, then save.';
   }
   else importStatus.textContent=player.sources.heroes?.status==='error'?'OpenDota history could not be loaded. Try again, or choose your heroes manually.':'No public hero history found. Enable public match data in Dota, or choose heroes manually.';
   redrawHeroes();
  }catch{importStatus.textContent='Public stats are unavailable. Try again, or select heroes manually.';}
  finally{importButton.disabled=false;save.disabled=false;importButton.removeAttribute('aria-busy');}
 },importPanel,'primary');
 importPanel.append(importStatus);

 function activateHeroTab(index,focus=false){
  for(const [i,section] of [...heroSections.children].entries())section.hidden=i!==index;
  [...heroTabs.children].forEach((tab,i)=>{tab.setAttribute('aria-selected',String(i===index));tab.tabIndex=i===index?0:-1;});
  if(focus)heroTabs.children[index].focus();
 }
 for(const [index,label] of ['Signatures','Today','Avoid'].entries()){
  const panel=heroSections.children[index];
  panel.id='profile-hero-panel-'+index;
  panel.setAttribute('role','tabpanel');
  const tab=button(label,()=>activateHeroTab(index),heroTabs);
  tab.id='profile-hero-tab-'+index;
  tab.setAttribute('role','tab');
  tab.setAttribute('aria-controls',panel.id);
  tab.onkeydown=event=>{
   let next;
   if(event.key==='ArrowRight')next=(index+1)%3;else if(event.key==='ArrowLeft')next=(index+2)%3;else if(event.key==='Home')next=0;else if(event.key==='End')next=2;else return;
   event.preventDefault();
   activateHeroTab(next,true);
  };
  panel.setAttribute('aria-labelledby',tab.id);
 }
 activateHeroTab(initialHeroTab);

 const extras=el('details',null,'profile-extras');
 extras.append(el('summary','Notes and availability · optional'));
 root.append(extras);

 const notes=field(extras,'Notes · optional',store.profile.notes||'','textarea'),availabilityLabel=el('label','Availability · optional'),availability=el('select');

 availability.id='profile-availability';
 availabilityLabel.htmlFor=availability.id;

 for(const value of ['available','maybe','unavailable'])availability.append(new Option(value,value));
 availability.value=store.profile.availability||'available';
 availabilityLabel.append(availability);
 extras.append(availabilityLabel);

 const footer=el('div',null,'profile-footer'),footerActions=el('div',null,'profile-footer-actions');
 footer.append(status,footerActions);
 $('profile-dialog').append(footer);

 const avatar=el('select');
 avatar.append(new Option('Random signature hero',''));
 for(const hero of Object.values(store.heroes).sort((a,b)=>a.localized_name.localeCompare(b.localized_name))){
  avatar.append(new Option(hero.localized_name,hero.id));
 }
 avatar.value=String(store.profile.avatarHeroId||'');
 const avatarLabel=el('label','Player card portrait');
 avatarLabel.append(avatar);
 extras.append(avatarLabel);

 const save=button('Save profile',async()=>{

  if(save.disabled)return;

  try{

   const ids=parseAccountIds(account.value);

   if(account.value.trim()&&ids.length!==1)throw Error('Enter one valid numeric public account ID or player URL.');

   const p={...(avatar.value||store.profile.avatarHeroId?{avatarHeroId:Number(avatar.value)||null}:{}),displayName:name.value.trim().slice(0,DISPLAY_NAME_MAX)||'Player',steamAccountId:ids[0]?String(ids[0]):'',preferredRoles:roleInputs.filter(r=>r.c.checked).map(r=>r.i),roleComfort:Object.fromEntries(roleInputs.map(r=>[r.i,+(r.radios.find(radio=>radio.checked)?.value||0)])),signatureHeroes:signatures.values(),desiredHeroes:desired.values(),avoidHeroes:avoid.values(),notes:notes.value.slice(0,500),availability:availability.value};

   if(continueAfterSave&&(!name.value.trim()||!p.preferredRoles.length))throw Error('Enter your display name and choose at least one position.');
   const conflicts=p.avoidHeroes.filter(id=>p.signatureHeroes.includes(id)||p.desiredHeroes.includes(id));
   if(conflicts.length){
    activateHeroTab(2);
    heroSections.children[2].querySelector('input')?.focus();
    throw Error('Remove '+conflicts.map(heroName).join(', ')+' from Avoid before saving: also selected in Signatures or Today.');
   }

   save.disabled=true;importButton.disabled=true;save.textContent='Saving…';save.setAttribute('aria-busy','true');message('Saving your profile…');

   const gen=store.generation,saved=store.user&&!demo?await store.backend.saveProfile(p,store.user.id):p;

   if(gen!==store.generation)return;

   store.profile=saved;store.profileSaved=true;

   if(!$('team-view').hidden){store.homeRoster=store.homeRoster.map(item=>item.userId===store.user?.id?{...item,...store.profile}:item);ui.renderTeamHome();}
   if(!store.shared){
    store.state.roster=[{...store.profile,id:store.user?.id||'local-own'},...store.state.roster.filter(p=>p.id!=='local-own'&&p.id!==store.user?.id)].slice(0,ROSTER_SIZE);
    touch();
   }

   observations.clear();refreshScouting();saveLocal();render();

   if(joinedTeam&&store.team?.id===joinedTeam.id)void loadTeam(store.team.id,{preserveSelection:store.teamRoster.length>0}).catch(()=>{});
   if(continueAfterSave){
    message('Profile saved.');
    store.profileSetupRequired=false;
    delete $('app-shell').dataset.profileSetup;
    $('profile-dialog').close();
    await continueAfterSave();
    return;
   }
   if((joinedTeam||continueToCup)&&$('profile-dialog').open){$('profile-dialog').close();if(joinedTeam)ui.navigateTeam(joinedTeam.id);else ui.navigateCup();}
   message(store.shared?'Saved. Refresh the shared roster snapshot in Setup to use these changes.':joinedTeam?`Profile saved. ${joinedTeam.name} can now see your preferences.`:'Profile saved.');

  }catch(error){message(error.message||'Unable to save your profile. Try again.',true);}

  finally{save.disabled=false;importButton.disabled=false;save.textContent='Save profile';save.removeAttribute('aria-busy');}

 },footerActions,'primary profile-save');

 if(!continueAfterSave&&(joinedTeam||continueToCup))button(joinedTeam?'Back to team':'Skip to Battle Cup',()=>{
  $('profile-dialog').close();
  if(joinedTeam)ui.navigateTeam(joinedTeam.id);else ui.navigateCup();
 },footerActions);
 if(store.user)button('Sign out',ui.signOut,continueAfterSave?footerActions:extras);

 show('profile-dialog');
 if(store.profile.steamAccountId&&!store.profile.signatureHeroes?.length&&(!store.profileSaved||!store.profile.preferredRoles?.length))void importButton.click();

}
