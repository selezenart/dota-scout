import {signupProgress} from './signup-progress.js';
const zone = 'Europe/Kyiv';
const roles = ['Carry', 'Mid', 'Offlane', 'Soft support', 'Hard support'];
const parts = date => Object.fromEntries(new Intl.DateTimeFormat('en-GB', {timeZone:zone,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'}).formatToParts(date).filter(p=>p.type!=='literal').map(p=>[p.type,Number(p.value)]));

export function nextBattleCup(now = new Date()) {
  const local=parts(now);
  const day=new Date(Date.UTC(local.year,local.month-1,local.day));
  let ahead=(6-day.getUTCDay()+7)%7;
  if(ahead===0&&local.hour>=20)ahead=7;
  day.setUTCDate(day.getUTCDate()+ahead);
  const wall=Date.UTC(day.getUTCFullYear(),day.getUTCMonth(),day.getUTCDate(),20);
  let instant=wall;
  for(let i=0;i<2;i++){
    const shown=parts(new Date(instant));
    const offset=Date.UTC(shown.year,shown.month-1,shown.day,shown.hour,shown.minute,shown.second)-instant;
    instant=wall-offset;
  }
  return new Date(instant).toISOString();
}
const element=(tag,text,className)=>{const node=document.createElement(tag);if(text!=null)node.textContent=text;if(className)node.className=className;return node;};

export function mountBattleCup({root,getContext,onSignIn=()=>{},onSetup=()=>{},onTeam=()=>{},onProfile=()=>{},onToday=onProfile,onDraft=()=>{}}) {
  let contextKey='',selectedTeam='',snapshot=null,selectedSlot=null,positions=[],dirty=false,busy=false,error='',feedback='',loading=false,request=0;
  let sample=null,setupRequired=false,confirmCancel=false;
  const context=()=>getContext();
  const identity=()=>{const c=context();return [c.user?.id,c.version,c.demo,selectedTeam].join('|');};
  function button(parent,label,action,primary=false){const b=element('button',label,primary?'primary':'');b.type='button';b.onclick=action;parent.append(b);return b;}
  function reset(){confirmCancel=false;request++;snapshot=null;selectedSlot=null;positions=[];dirty=false;busy=false;loading=false;error='';feedback='';setupRequired=false;}
  function apply(value){
    if(!value||!Number.isFinite(Date.parse(value.eventAt))||!Array.isArray(value.signups))throw Error('Invalid Battle Cup response. Refresh to retry.');
    const changed=snapshot?.eventAt!==value.eventAt;snapshot=value;
    if(changed)feedback='';
    if(changed||!dirty){const mine=value.signups.find(row=>row.userId===(context().demo?'demo-you':context().user?.id));selectedSlot=mine?.slot??null;positions=[...(mine?.positions||[])];dirty=false;}
  }
  function sync(){
    const c=context();const nextKey=[c.user?.id,c.version,c.demo].join('|');
    if(nextKey!==contextKey){contextKey=nextKey;selectedTeam=c.teamId||c.teams?.[0]?.id||'';reset();sample=null;render();}
  }
  async function refresh(){
    if(busy)return;
    const c=context();
    if(!c.teams?.some(team=>team.id===selectedTeam))selectedTeam='';
    if(c.demo){
      const eventAt=nextBattleCup();
      if(!sample||sample.eventAt!==eventAt)sample={eventAt,signups:[{slot:1,userId:'sample-mid',displayName:'Ira',positions:[2]},{slot:3,userId:'sample-offlane',displayName:'Danylo',positions:[3,4]}]};
      apply(sample);render();return;
    }
    if(!c.user){snapshot=null;render();return;}
    const focusKey=root.contains(document.activeElement)?document.activeElement.dataset.cupFocus:null;
    const key=identity(),token=++request;loading=true;error='';setupRequired=false;render();
    try{const value=await c.backend.listBattleCup(selectedTeam);if(key!==identity()||token!==request)return;apply(value);}
    catch(e){if(key===identity()&&token===request){setupRequired=!selectedTeam&&e.code==='PGRST202';error=setupRequired?'Open-lineup signup is not available yet. You can still prepare your profile or join a team.':e.message||'Unable to load availability.';snapshot=null;}}
    finally{if(key===identity()&&token===request){loading=false;render();if(focusKey&&!root.hidden&&document.activeElement===document.body)root.querySelector('[data-cup-focus="'+focusKey+'"]:not(:disabled)')?.focus({preventScroll:true});}}
  }
  async function save(cancel=false){
    if(busy||!snapshot)return;
    if(!cancel&&(!selectedSlot||positions.length<1||positions.length>2)){error='Choose an available spot and one or two positions.';render();return;}
    const c=context(),key=identity(),token=++request,eventAt=snapshot.eventAt;
    const returnFocus=root.contains(document.activeElement);
    confirmCancel=false;busy=true;error='';feedback='';render();
    try{
      let result;
      if(c.demo){
        if(sample.eventAt!==nextBattleCup())throw Error('This event has started. Refresh the next Battle Cup.');
        const others=sample.signups.filter(row=>row.userId!=='demo-you');
        if(!cancel&&others.some(row=>row.slot===selectedSlot))throw Error('This slot is taken.');
        sample={eventAt,signups:cancel?others:[...others,{slot:selectedSlot,userId:'demo-you',displayName:'You',positions:[...positions]}]};result=sample;
      }else{
        if(!c.user)throw Error('Sign in to reserve a spot.');
        result=cancel?await c.backend.cancelBattleCup(selectedTeam,eventAt,c.user.id):await c.backend.saveBattleCup(selectedTeam,eventAt,selectedSlot,[...positions],c.user.id);
      }
      if(key!==identity()||token!==request)return;
      dirty=false;apply(result);
      if(cancel)feedback='Signup canceled. Your spot is available again.';
    }catch(e){
      if(key!==identity()||token!==request)return;
      error=e.message||'Unable to save. Refresh availability and try again.';
      if(!c.demo&&(e.code==='23505'||e.code==='22023')){
        try{const fresh=await c.backend.listBattleCup(selectedTeam);if(key===identity()&&token===request)apply(fresh);}catch{}
      }
    }
    finally{if(key===identity()&&token===request){busy=false;render();if(returnFocus&&!root.hidden&&document.activeElement===document.body)root.querySelector('.cup-error,.cup-success,#cup-selection-summary')?.focus();}}
  }
  function render(){
    const c=context(),userId=c.demo?'demo-you':c.user?.id;
    const checklistOpen=root.querySelector('.cup-plan-details')?.open||false;
    const active=document.activeElement;
    const focusKey=root.contains(active)?active.dataset.cupFocus:null;
    root.replaceChildren();
    const restoreFocus=()=>root.querySelector('[data-cup-focus="'+focusKey+'"]:not(:disabled)')?.focus({preventScroll:true});
    const heading=element('header',null,'cup-heading');const title=element('h1','Next Battle Cup');title.id='cup-title';title.tabIndex=-1;heading.append(title);
    if(c.demo)heading.append(element('span','Demo','cup-demo-label'));
    const eventAt=snapshot?.eventAt||nextBattleCup();
    heading.append(element('p',new Intl.DateTimeFormat('en-GB',{timeZone:zone,weekday:'long',day:'numeric',month:'long',year:'numeric'}).format(new Date(eventAt))+' · 20:00 Kyiv','cup-date'));
    heading.append(element('p','Pick a main or replacement spot and choose one or two positions.','cup-intro'));root.append(heading);
    if(!c.demo&&!c.user){root.append(element('p','Sign in to see available spots and reserve your place.','cup-intro'),signupProgress(0,false,{},true));button(root,'Sign in or create an account',onSignIn,true).classList.add('cup-guest-signin');return;}
    if(!c.demo){const label=element('label','Lineup · team is optional','cup-team'),select=element('select');select.disabled=busy;select.dataset.cupFocus='team';select.setAttribute('aria-label','Battle Cup team');const open=element('option','Open lineup · no team needed');open.value='';select.append(open);for(const team of c.teams||[]){const option=element('option',team.name);option.value=team.id;select.append(option);}select.value=selectedTeam;select.onchange=()=>{selectedTeam=select.value;reset();void refresh();};label.append(select);root.append(label);}
    const toolbar=element('div',null,'cup-toolbar');
    if(snapshot){const main=snapshot.signups.filter(row=>row.slot<=5).length;toolbar.append(element('strong',`${5-main} / 5 main spots available`),element('span',snapshot.signups.some(row=>row.slot===6)?'Replacement taken':'Replacement available'));}
    const reload=button(toolbar,loading?'Refreshing…':'Refresh availability',()=>void refresh());reload.dataset.cupFocus='refresh';reload.disabled=loading||busy;root.append(toolbar);
    if(error){const message=element('p',error,'cup-message cup-error');message.tabIndex=-1;message.setAttribute('role','alert');root.append(message);}
    if(setupRequired){const actions=element('div',null,'cup-actions');button(actions,'Set up my profile',onProfile,true);button(actions,'Join or create a team',onSetup);root.append(actions);}
    if(loading){const message=element('p','Checking team availability…','cup-message');message.setAttribute('role','status');root.append(message);}
    if(!snapshot)return;
    const mine=snapshot.signups.find(row=>row.userId===userId);
    const readyToDraft=!!mine&&(c.profileReady===true||c.demo);
    const guide=element('nav',null,'cup-guide');guide.setAttribute('aria-label','Your Battle Cup plan');guide.append(element('h2','Your Battle Cup plan'),element('p',mine?'You’re registered. Update your hero wishes, meet the lineup, or review your reservation.':c.profileReady===false?'Start with your profile so the captain knows your roles and heroes. Then reserve a spot.':'Your profile is ready. Choose a free spot and one or two positions below.','cup-guide-tip'));
    guide.append(signupProgress(c.profileReady === false ? 2 : 3,!!mine && c.profileReady !== false,{
      0:onProfile,1:onSetup,2:onProfile,3:()=>{(root.querySelector('.cup-slots input:checked:not(:disabled)')||root.querySelector('.cup-slots input:not(:disabled)'))?.focus();root.querySelector('.cup-slots')?.scrollIntoView?.({behavior:'smooth',block:'center'});},
    },!selectedTeam));
    if(readyToDraft){
      const details=element('details',null,'cup-plan-details');
      details.open=checklistOpen;
      details.append(element('summary','View your Battle Cup checklist'),guide);
      root.append(details);
    }else root.insertBefore(guide,heading.nextSibling);
    if(c.profileReady === false){
      const help=element('div',null,'cup-profile-step');
      help.append(element('p','Add your role preferences and hero pool so your captain can plan the draft.'));
      button(help,'Set up my profile',onProfile,true);
      root.append(help);
    }
    if(mine){const status=element('p',`You’re signed up · ${mine.slot===6?'Replacement':'Main spot '+mine.slot} · ${mine.positions.map(p=>'P'+p).join(' / ')}`,'cup-message cup-success');status.tabIndex=-1;status.setAttribute('role','status');root.insertBefore(status,heading.nextSibling);
      if(readyToDraft){
        const ready=element('section',null,'cup-draft-ready');ready.append(element('h2','You’re ready to draft'),element('p','Your profile and Battle Cup spot are saved. Explore picks and bans on the draft board. Joining a team is optional.'));
        button(ready,'Open draft board',onDraft,true);
        if(c.profileHasDraftDetails===false){
          ready.append(element('p','Add roles and heroes so your captain can plan around you.'));
          button(ready,'Edit my profile',onProfile);
        }
        status.after(ready);
      }
      const next=element('section',null,'cup-next');next.append(element('h2','Get ready for Saturday.'),element('p','Your spot is saved. Here are a few things to do before Saturday.'));
      const cards=element('div',null,'cup-next-actions');
      for(const [title,description,action] of [['Choose tonight’s heroes','Tell your captain what you feel like playing.',onToday],selectedTeam||c.demo?['Meet your lineup','Review teammates’ roles and hero pools.',onTeam]:['Find your team','Create or join a team whenever you’re ready.',onSetup],selectedTeam||c.demo?['Shape your team','Suggest a team name and an image to download.',onTeam]:['Polish your player card','Review your roles and signature heroes.',onProfile]]){
        const card=button(cards,'',()=>action===onTeam?onTeam(selectedTeam):action());card.className='cup-next-card';card.append(element('strong',title),element('span',description),element('span','Open →','cup-next-link'));
      }
      next.append(cards);root.append(next);
    }
    const slots=element('fieldset',null,'cup-slots');
    slots.append(element('legend','Choose your spot'));
    for(let slot=1;slot<=6;slot++){
      const signup=snapshot.signups.find(row=>row.slot===slot),own=signup?.userId===userId;
      const card=element('label',null,'cup-slot');
      const radio=element('input');
      radio.type='radio';
      radio.name='cup-slot';
      radio.value=slot;
      radio.dataset.slot=slot;
      radio.dataset.cupFocus='spot-'+slot;
      radio.checked=selectedSlot===slot;
      radio.disabled=busy||!!signup&&!own;
      radio.onchange=()=>{selectedSlot=slot;dirty=true;render();};
      card.classList.toggle('cup-replacement',slot===6);
      card.classList.toggle('cup-taken',!!signup&&!own);
      card.append(radio,element('span',slot===6?'Replacement':'Main spot '+slot,'cup-slot-label'),
        element('strong',signup?.displayName||'Available'));
      if(signup)card.append(element('small',signup.positions.map(p=>'P'+p+' '+roles[p-1]).join(' · ')));
      if(own)card.append(element('small','Your reservation'));
      slots.append(card);
    }
    root.append(slots);
    const fieldset=element('fieldset',null,'cup-positions');fieldset.disabled=busy;fieldset.append(element('legend','Your positions · '+positions.length+' of 2'));
    fieldset.setAttribute('aria-describedby','cup-role-hint');
    for(let position=1;position<=5;position++){
      const label=element('label',null,'cup-position'),input=element('input');input.type='checkbox';input.name='cup-position';input.value=position;input.dataset.cupFocus='role-'+position;input.checked=positions.includes(position);input.disabled=!input.checked&&positions.length>=2;
      input.onchange=()=>{positions=input.checked?[...positions,position]:positions.filter(value=>value!==position);dirty=true;render();};
      label.append(input,element('strong','P'+position),element('span',roles[position-1]));fieldset.append(label);
    }
    const hint=element('p',positions.length===2?'Uncheck a position to choose another.':'Choose one or two positions. Your captain assigns the final lineup.','cup-footnote');
    hint.id='cup-role-hint';
    fieldset.append(hint);
    root.append(fieldset);
    const spotTaken=snapshot.signups.some(row=>row.slot===selectedSlot&&row.userId!==userId);
    const summary=element('p',spotTaken?'That spot is taken. Choose another available spot.':selectedSlot?(selectedSlot===6?'Replacement':'Main spot '+selectedSlot)+' · '+(positions.length?positions.map(p=>'P'+p+' '+roles[p-1]).join(' / '):'Choose one or two positions'):'Choose an available spot to continue.','cup-summary');
    summary.id='cup-selection-summary';summary.tabIndex=-1;
    summary.setAttribute('role','status');
    if(feedback){const message=element('p',feedback,'cup-message cup-success');message.tabIndex=-1;message.setAttribute('role','status');root.append(message);}
    root.append(summary);
    const actions=element('div',null,'cup-actions');
    const submit=button(actions,busy?'Saving…':mine?'Update my signup':'Save my spot',()=>void save(),true);const unchanged=mine&&mine.slot===selectedSlot&&positions.length===mine.positions.length&&positions.every(position=>mine.positions.includes(position));
    submit.disabled=busy||loading||spotTaken||!selectedSlot||positions.length<1||positions.length>2||!!unchanged;
    submit.setAttribute('aria-describedby',summary.id);
    if(mine&&confirmCancel){
      actions.append(element('p','Cancel your signup? This spot will become available to other players.'));
      button(actions,'Keep my spot',()=>{confirmCancel=false;render();root.querySelector('[data-cup-focus=cancel]')?.focus();}).dataset.cupFocus='keep';
      button(actions,'Confirm cancellation',()=>void save(true));
    }else if(mine){
      const cancel=button(actions,'Cancel my signup',()=>{confirmCancel=true;render();root.querySelector('[data-cup-focus=keep]')?.focus();});
      cancel.dataset.cupFocus='cancel';cancel.disabled=busy||loading;
    }
    root.append(actions);
    restoreFocus();
  }
  render();
  return {refresh,sync};
}
