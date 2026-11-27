import {parseAccountIds} from './draft-engine.js';
import {loadPlayer} from './data.js';
import {HERO_PORTRAIT_BASE, HISTORY_WINDOW_DAYS, ROLE_NAMES} from './constants.js';
import heroes from './heroes.json';
import './onboarding-demo.css';

const storageKey = 'captain-onboarding-demo-v2';
const roles = ROLE_NAMES;
const steps = ['Invitation', 'Dota account', 'Account', 'Confirm email', 'Join team', 'Your profile', 'Captain’s view'];
const defaults = () => ({step: 0, name: 'Maks', email: 'maks@example.com', role: '', signature: [8, 54], desired: [], accountId: '', accountLink: '', importNote: '', inbox: false});
const heroName = id => heroes[id]?.localized_name || 'Unknown hero';
const art = id => HERO_PORTRAIT_BASE + heroes[id].name.replace('npc_dota_hero_', '') + '.png';
const node = (tag, text, cls) => { const n = document.createElement(tag); if (text != null) n.textContent = text; if (cls) n.className = cls; return n; };

function mountOnboardingDemo() {
  let state = defaults();
  try {
    const saved = JSON.parse(sessionStorage.getItem(storageKey));
    if (saved && Number.isInteger(saved.step) && saved.step >= 0 && saved.step < steps.length) {
      state = {...state, step: saved.step, name: typeof saved.name === 'string' ? saved.name.slice(0, 40) : state.name, email: typeof saved.email === 'string' ? saved.email.slice(0, 100) : state.email, role: roles.includes(saved.role) ? saved.role : state.role, inbox: !!saved.inbox, accountId: /^\d+$/.test(saved.accountId || '') ? saved.accountId : '', accountLink: typeof saved.accountLink === 'string' ? saved.accountLink.slice(0, 200) : '', importNote: typeof saved.importNote === 'string' ? saved.importNote.slice(0, 300) : ''};
      for (const key of ['signature', 'desired']) if (Array.isArray(saved[key])) state[key] = [...new Set(saved[key].filter(id => Number.isInteger(id) && heroes[id]))].slice(0, 5);
    }
  } catch {}
  const persist = () => {try {sessionStorage.setItem(storageKey, JSON.stringify(state));} catch {}};
  const root = node('div', null, 'onboarding-demo'); root.id = 'onboarding-demo';
  document.getElementById('welcome-view')?.setAttribute('hidden', '');
  document.getElementById('app-shell')?.setAttribute('hidden', '');
  document.body.dataset.view = 'onboarding-demo';
  document.body.append(root);
  document.title = 'Join the team · Captain’s Draft Board demo';
  function button(parent, text, action, primary = false) {
    const b = node('button', text, primary ? 'od-primary' : ''); b.type = 'button'; b.dataset.demoAction = action;
    parent.append(b); return b;
  }
  function go(step) {state.step = step; persist(); render(); root.querySelector('h1')?.focus();}
  function portrait(id, parent) {const img = node('img'); img.src = art(id); img.alt = heroName(id); img.width = 256; img.height = 144; parent.append(img);}
  function field(parent, label, value, type = 'text') {
    const wrap = node('label', label, 'od-field'), input = node('input'); input.type = type; input.value = value; input.required = true; input.autocomplete = 'off'; wrap.append(input); parent.append(wrap); return input;
  }
  function heading(parent, kicker, title, description) {parent.append(node('p', kicker, 'od-kicker'));const h = node('h1', title); h.tabIndex = -1; parent.append(h, node('p', description, 'od-lede'));}
  function heroChips(parent, ids) {const strip = node('div', null, 'od-hero-chips'); for (const id of ids) {const item = node('div');portrait(id, item);item.append(node('span', heroName(id)));strip.append(item);} if (!ids.length) strip.append(node('span', 'Not selected yet', 'od-muted'));parent.append(strip);}
  function render() {
    root.replaceChildren();
    const nav = node('header', null, 'od-nav'), brand = node('a', '◈  CAPTAIN’S DRAFT BOARD', 'od-brand'); brand.href = './';
    const navActions = node('div'), exit = node('a', 'Exit demo'); exit.href = './';
    const restart = button(navActions, 'Restart demo', 'restart'); restart.onclick = () => {state = defaults(); go(0);}; navActions.append(exit); nav.append(brand, navActions);root.append(nav);
    const banner = node('div', null, 'od-banner'); banner.append(node('strong', 'INTERACTIVE DEMO'), node('span', 'Sample friends. No real account, email or team is created. Your progress stays in this tab.'));root.append(banner);
    const layout = node('main', null, 'od-layout'), rail = node('aside', null, 'od-rail'); rail.setAttribute('aria-label', 'Onboarding progress');
    rail.append(node('p', 'THE ROAD TO YOUR FIRST DRAFT', 'od-kicker'));
    const list = node('ol'); steps.forEach((label, index) => {const li = node('li', null, index === state.step ? 'od-current' : index < state.step ? 'od-complete' : '');li.append(node('span', index < state.step ? '✓' : String(index + 1).padStart(2, '0')), node('span', label));if (index === state.step) li.setAttribute('aria-current', 'step');list.append(li);});rail.append(list);
    const team = node('div', null, 'od-team-note');team.append(node('span', 'NS', 'od-team-emblem'), node('h2', 'Night Shift'), node('p', 'Five friends. One good draft.'), node('small', 'Sample team · Kyiv'));rail.append(team);layout.append(rail);
    const content = node('section', null, 'od-content');layout.append(content);root.append(layout);
    if (state.step === 0) {
      heading(content, 'YOU’RE ON THE LIST', 'Good drafts start with friends.', 'John invited you to Night Shift. Set up your player card so your captain knows your comfort picks before the first ban.');
      const invite = node('div', null, 'od-invite'); const artRow = node('div', null, 'od-art-row'); [8, 74, 2, 86, 5].forEach(id => portrait(id, artRow));invite.append(artRow, node('p', 'NIGHT SHIFT · TEAM INVITATION', 'od-kicker'), node('h2', 'Your fifth spot is waiting.'), node('p', 'John · Captain  /  Ira · Mid  /  Danylo · Offlane  /  Sofia · Support'));content.append(invite);
      button(content, 'Accept invitation', 'accept', true).onclick = () => go(1);
      content.append(node('p', 'About two minutes. No Steam connection required for this walkthrough.', 'od-muted'));
    } else if (state.step === 1) {
      heading(content, 'YOUR DOTA ACCOUNT', 'Bring your hero pool with you.', 'Paste a Dotabuff or OpenDota player link, a numeric Steam profile link, SteamID64 or Dota account ID. Public data is loaded through OpenDota.');
      const form = node('form', null, 'od-form');
      const account = field(form, 'Dota account link or Steam ID', state.accountLink);
      account.placeholder = 'https://www.dotabuff.com/players/123456789';
      const message = node('p', '', 'od-muted'); message.setAttribute('role', 'status');
      const submit = button(form, 'Import public profile', 'import-account', true); submit.type = 'submit';
      form.append(message); content.append(form);
      form.onsubmit = async event => {
        event.preventDefault(); if (submit.disabled || !form.reportValidity()) return;
        const value = account.value.trim(); let clean = value;
        try { const url = new URL(value); url.search = ''; url.hash = ''; clean = url.href; } catch {}
        const ids = parseAccountIds(clean);
        if (ids.length !== 1 || /[\s,;]/.test(clean)) {message.textContent = 'Enter one valid player link or numeric Steam/Dota ID. Steam vanity names need a numeric profile link.'; return;}
        const current = state;
        submit.disabled = true; submit.textContent = 'Loading public profile…'; form.setAttribute('aria-busy', 'true');
        message.textContent = 'Loading name, most-played heroes and recent matches from OpenDota…';
        try {
          const player = await loadPlayer(ids[0]); if (state !== current || state.step !== 1) return;
          const played = (Array.isArray(player.heroes) ? player.heroes : []).filter(row => heroes[row.hero_id] && row.games > 0).sort((a,b) => b.games - a.games || a.hero_id - b.hero_id);
          if (Object.values(player.sources).every(source => source.status === 'error')) {
            message.textContent = 'OpenDota is unavailable. Try again or continue manually.';
            return;
          }
          state.accountId = String(ids[0]); state.accountLink = value;
          state.name = String(player.profile?.profile?.personaname || '').slice(0,40);
          state.signature = [...new Set(played.map(row => row.hero_id))].slice(0,5);
          state.desired = [];
          const failures = Object.values(player.sources).some(source => source.status === 'error');
          state.importNote = 'OpenDota import · ' + played.length + ' heroes with games in the last ' + HISTORY_WINDOW_DAYS + ' days. ' + (failures ? 'Some data could not be loaded. ' : '') + (!played.length ? 'No public hero history found. Fill in your heroes manually. ' : '') + 'Most-played heroes are suggested signatures. Review them and choose your role and today’s heroes yourself.';
          go(2);
        } catch {if (state === current) message.textContent = 'Could not load public data. Try again or continue manually.';}
        finally {submit.disabled = false; submit.textContent = 'Import public profile'; form.removeAttribute('aria-busy');}
      };
      button(content, 'Use sample account', 'sample-account').onclick = () => {state.accountId = '123456789'; state.accountLink = 'https://www.dotabuff.com/players/123456789'; state.name = 'Maks'; state.signature = [8,54]; state.desired = []; state.importNote = 'Sample account · invented match history. Review the suggested signatures and choose today’s heroes.'; go(2);};
      button(content, 'Continue manually', 'manual-account').onclick = () => {state.signature = []; state.desired = []; state.importNote = 'Public data unavailable or skipped. Fill in your preferences manually.'; go(2);};
      content.append(node('p', 'Only public game data is requested. Missing history can be filled manually. Steam vanity URLs such as /id/name require a numeric Steam ID.', 'od-muted'));
    } else if (state.step === 2) {
      heading(content, '01 / YOUR DEMO ACCOUNT', 'Put a name on your picks.', 'Try the signup step with a sample identity. Please use fictional details here.');
      const form = node('form', null, 'od-form'), name = field(form, 'Display name', state.name), email = field(form, 'Sample email', state.email, 'email'); name.maxLength = 40; email.maxLength = 100;
      form.append(node('p', 'No password needed: this is a local simulation.', 'od-muted'));const submit = button(form, 'Create demo account', 'signup', true); submit.type = 'submit';
      form.onsubmit = event => {event.preventDefault(); if (!form.reportValidity()) return; if (!name.value.trim()) {name.setCustomValidity('Enter a display name.');name.reportValidity();return;}state.name = name.value.trim();state.email = email.value.trim();state.inbox = false;go(3);};name.oninput = () => name.setCustomValidity('');content.append(form);
    } else if (state.step === 3) {
      heading(content, '02 / EMAIL CONFIRMATION', state.inbox ? 'A little confirmation. You’re in.' : 'Check your sample inbox.', 'In the real app, you would confirm your email before joining the team. Here, you can open the sample message immediately.');
      const mail = node('div', null, 'od-mail');mail.append(node('span', '✉', 'od-mail-icon'), node('p', 'To: ' + state.email), node('h2', state.inbox ? 'Confirm your Captain’s Draft Board account' : 'Your confirmation message is ready'));
      mail.append(node('p', state.inbox ? 'Welcome, ' + state.name + '. Confirm your sample email to return to your Night Shift invitation.' : 'No email was sent. This inbox is part of the demo.'));
      button(mail, state.inbox ? 'Confirm demo email' : 'Open sample confirmation email', state.inbox ? 'confirm' : 'open-email', true).onclick = () => {if (state.inbox) go(4);else {state.inbox = true;persist();render();root.querySelector('h1')?.focus();}};content.append(mail);
    } else if (state.step === 4) {
      heading(content, '03 / INVITATION RESTORED', 'Welcome back, ' + state.name + '.', 'Your sample email is confirmed, and your invitation is still here. Now make it official.');
      const card = node('div', null, 'od-invite');card.append(node('span', '✓ EMAIL CONFIRMED · DEMO', 'od-success'), node('h2', 'Night Shift'), node('p', 'Invited by John · Four sample teammates are waiting.'));heroChips(card, [74, 2, 86, 5]);content.append(card);button(content, 'Join Night Shift', 'join', true).onclick = () => go(5);
    } else if (state.step === 5) {
      heading(content, '04 / YOUR PLAYER CARD', 'Give your captain a head start.', 'Pick your role, mark the heroes you know best, and choose what you feel like playing tonight.');
      content.append(node('p', state.importNote, 'od-muted'));
      const form = node('form', null, 'od-profile'); const name = field(form, 'Display name', state.name);name.maxLength = 40;
      const rolePicker = node('fieldset', null, 'od-role-picker');rolePicker.append(node('legend', 'Where do you want to play?'));
      const roleCards = node('div', null, 'od-role-cards');
      const descriptions = ['Safe lane · Farm and scale', 'Solo lane · Set the tempo', 'Off lane · Initiate fights', 'Roam · Create opportunities', 'Safe lane · Protect and enable'];
      roles.forEach((role,index) => {
        const label = node('label', null, 'od-role-card'), radio = node('input');
        radio.type = 'radio';radio.name = 'preferred-role';radio.value = role;radio.required = true;radio.checked = state.role === role;
        radio.setAttribute('aria-label', role);
        radio.onchange = () => {state.role = role;persist();};
        label.append(radio,node('span', 'Position ' + (index+1), 'od-kicker'),node('strong', role),node('small', descriptions[index]));roleCards.append(label);
      });rolePicker.append(roleCards);form.append(rolePicker);
      name.oninput = () => {name.setCustomValidity('');state.name = name.value;persist();};
      const feedback = node('p', '', 'od-muted');feedback.setAttribute('role', 'status');
      for (const [key, title, description] of [['signature', 'Signature heroes', 'Your reliable picks. Select up to five.'], ['desired', 'Want to play', 'Tonight’s wishlist. Select up to five.']]) {
        const section = node('section', null, 'od-picker');section.setAttribute('aria-label', title);section.append(node('h2', title), node('p', description, 'od-muted'));
        const chosen = node('div', null, 'od-chosen'), searchLabel = node('label', 'Search ' + title.toLowerCase(), 'od-field'), search = node('input');search.type = 'search';search.placeholder = 'Find any Dota 2 hero…';searchLabel.append(search);
        const tools = node('div', null, 'od-picker-tools');
        let filter = 'All';
        const filters = node('div', null, 'od-filters');filters.setAttribute('role','group');filters.setAttribute('aria-label', title + ' filters');
        for (const label of ['All','Selected','Strength','Agility','Intelligence','Universal']) {
          const control = button(filters,label,'filter-heroes');control.setAttribute('aria-pressed',String(label === filter));
          control.onclick = () => {filter = label;for(const other of filters.children)other.setAttribute('aria-pressed',String(other === control));refresh();};
        }
        tools.append(filters);
        if (key === 'desired') button(tools, 'Use my signatures', 'copy-signatures').onclick = () => {state.desired = [...state.signature];persist();refresh();feedback.textContent = 'Signature heroes copied to Want to play. You can adjust them.';};
        button(tools, 'Clear selection', 'clear-heroes').onclick = () => {state[key] = [];persist();refresh();feedback.textContent = title + ' cleared.';};
        const count = node('span', '', 'od-selection-count');tools.append(count);
        const grid = node('div', null, 'od-hero-grid');section.append(chosen, searchLabel, tools, grid);form.append(section);
        function refresh() {
          count.textContent = state[key].length + ' / 5 selected';
          chosen.replaceChildren();for (const id of state[key]) {const chip = button(chosen, heroName(id) + ' ×', 'remove-hero');chip.setAttribute('aria-label', 'Remove ' + heroName(id) + ' from ' + title.toLowerCase());portrait(id, chip);chip.onclick = () => {state[key] = state[key].filter(item => item !== id);persist();refresh();(chosen.querySelector('button') || search).focus();feedback.textContent = heroName(id) + ' removed.';};}
          if (!state[key].length) chosen.append(node('span', 'Choose your heroes below.', 'od-muted'));
          grid.replaceChildren();const query = search.value.trim().toLowerCase();
          const attributes = {Strength:'str',Agility:'agi',Intelligence:'int',Universal:'all'};
          const all = Object.values(heroes).sort((a,b) => Number(state[key].includes(b.id)) - Number(state[key].includes(a.id)) || a.localized_name.localeCompare(b.localized_name));
          const results = all.filter(hero => (!query || hero.localized_name.toLowerCase().includes(query)) && (filter !== 'Selected' || state[key].includes(hero.id)) && (!attributes[filter] || hero.primary_attr === attributes[filter]));
          for (const hero of results) {const b = button(grid, '', 'toggle-hero');b.setAttribute('aria-label', hero.localized_name);b.setAttribute('aria-pressed', String(state[key].includes(hero.id)));portrait(hero.id, b);b.append(node('span', hero.localized_name));b.onclick = () => {if (state[key].includes(hero.id)) state[key] = state[key].filter(id => id !== hero.id);else if (state[key].length < 5) state[key].push(hero.id);else {feedback.textContent = 'Choose up to five ' + title.toLowerCase() + '. Remove one to add another.';return;}persist();refresh();(grid.querySelector('[aria-label="' + hero.localized_name + '"]') || grid.querySelector('button') || search).focus();feedback.textContent = title + ': ' + state[key].length + ' selected.';};}
          if (!results.length) grid.append(node('p', filter === 'Selected' && !state[key].length ? 'No heroes selected yet. Choose All to browse your options.' : 'No heroes match these filters.'));
        }
        search.oninput = refresh;refresh();
      }
      form.append(feedback);const submit = button(form, 'Save profile', 'save-profile', true);submit.type = 'submit';form.onsubmit = event => {event.preventDefault();if (!form.reportValidity()) return;if (!name.value.trim()) {name.setCustomValidity('Enter a display name.');name.reportValidity();return;}state.name = name.value.trim();state.role = form.querySelector('input[name=preferred-role]:checked').value;go(6);};content.append(form);
    } else {
      heading(content, '05 / CAPTAIN’S VIEW · SAMPLE ROSTER', 'Five players. A clearer first pick.', 'Your player card is saved in this tab. Here’s how your captain would see the team before drafting.');
      const success = node('p', '✓ Profile saved · Demo only', 'od-success');success.setAttribute('role', 'status');content.append(success);
      const roster = node('div', null, 'od-roster');roster.setAttribute('aria-label', 'Captain roster preview');
      const players = [{name: state.name + ' · You', role: state.role, signature: state.signature, desired: state.desired}, {name: 'Ira', role: 'Mid', signature: [74, 25], desired: [13]}, {name: 'Danylo', role: 'Offlane', signature: [2, 96], desired: [29]}, {name: 'Sofia', role: 'Soft support', signature: [86, 26], desired: [9]}, {name: 'John · Captain', role: 'Hard support', signature: [5, 87], desired: [5]}];
      players.forEach((player, index) => {const card = node('article', null, 'od-player' + (index === 0 ? ' od-you' : ''));card.append(node('span', player.role, 'od-kicker'), node('h2', player.name), node('h3', 'Signature heroes'));heroChips(card, player.signature);card.append(node('h3', 'Want to play'));heroChips(card, player.desired);roster.append(card);});content.append(roster);
      const actions = node('div', null, 'od-end-actions');button(actions, 'Edit my profile', 'edit-profile').onclick = () => go(5);const cup = node('a', 'Continue to Battle Cup →', 'od-primary');cup.href = '?demo&cup';actions.append(cup);content.append(actions);
    }
    const footer = node('footer', 'Local walkthrough · Hero artwork © Valve', 'od-footer');root.append(footer);
  }
  render();
  return {root};
}

// main.js loads this module only for ?onboarding-demo.
mountOnboardingDemo();
