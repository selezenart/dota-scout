const steps = ['Sign in or register', 'Join your team', 'Set up your profile', 'Reserve a Battle Cup spot'];

export function signupProgress(current, complete = false, actions = {}, optionalTeam = false) {
  const list = document.createElement('ol');
  list.className = 'signup-progress';
  list.setAttribute('aria-label', 'Battle Cup registration progress');
  for (const [index, originalLabel] of steps.entries()) {
    const optional=optionalTeam&&index===1,label=optional?'Team · optional':originalLabel;
    const item = document.createElement('li');
    const done = !optional&&(complete || index < current);
    if (done) item.dataset.complete = '';
    else if (index === current) item.setAttribute('aria-current', 'step');
    const number = document.createElement('span');
    number.setAttribute('aria-hidden', 'true');
    number.textContent = done ? '✓' : optional?'＋':String(index + 1);
    if (typeof actions[index] === 'function') {
      const link = document.createElement('button');
      link.type = 'button';
      link.append(number,document.createTextNode(label));
      link.setAttribute('aria-label',label+(done?' · completed':index===current?' · current step':''));
      link.onclick = actions[index];
      item.append(link);
    } else {
      item.append(number,label);
    }
    if (done) {
      const state = document.createElement('span');
      state.className = 'sr-only';
      state.textContent = ' completed';
      item.append(state);
    }
    list.append(item);
  }
  return list;
}
