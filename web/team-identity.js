const demoKey = 'captain-demo-team-proposals';
const sampleEmblem = {
  id: 'demo-night-shift',
  proposed_name: 'Night Shift',
  image_mime: 'image/png',
};
const readDemo = () => JSON.parse(localStorage.getItem(demoKey) || '[]');

function sampleImage() {
  const canvas = document.createElement('canvas');
  canvas.width = 320;
  canvas.height = 180;
  const paint = canvas.getContext('2d');
  if (!paint) return null;
  const gradient = paint.createLinearGradient(0,0,320,180);
  gradient.addColorStop(0,'#352252');
  gradient.addColorStop(1,'#102832');
  paint.fillStyle = gradient;
  paint.fillRect(0,0,320,180);
  paint.fillStyle = '#dac8ff';
  paint.font = 'bold 31px system-ui';
  paint.textAlign = 'center';
  paint.fillText('NIGHT SHIFT',160,102);
  return canvas.toDataURL('image/png').split(',')[1];
}
export const demoIdentityBackend = {
  async setTeamIdentity() {},
  async listTeamIdentity() {return [...readDemo(),sampleEmblem,{id:'demo-name',proposed_name:'Moonlit Five'}];},
  async suggestTeamIdentity(_team, name, mime, data) {
    const rows = [{id:crypto.randomUUID(),proposed_name:name,image_mime:mime,data}, ...readDemo()];
    localStorage.setItem(demoKey, JSON.stringify(rows.slice(0,3)));
  },
  async getTeamIdentityImage(id) {
    if(id===sampleEmblem.id){const data=sampleImage();return data?{mime:sampleEmblem.image_mime,data}:null;}
    const row = readDemo().find(item => item.id === id);
    return row?.data ? {mime:row.image_mime,data:row.data} : null;
  }
};

const imageTypes = {'image/png':'png', 'image/jpeg':'jpg', 'image/webp':'webp'};

function element(tag, text) {
  const node = document.createElement(tag);
  if (text) node.textContent = text;
  return node;
}

export async function showIdentityDownload(root, backend, id) {
  const home = element('a', 'Captain’s Draft Board');
  home.href = '/';
  home.className = 'image-home';
  const heading = element('h1', 'Team image');
  const show = (...content) => root.replaceChildren(home, heading, ...content);
  show(element('p', 'Loading image…'));
  try {
    const image = await backend.getTeamIdentityImage(id);
    if (!image || !Object.hasOwn(imageTypes, image.mime)) throw Error('This image is unavailable.');
    const bytes = Uint8Array.from(atob(image.data), character => character.charCodeAt(0));
    const url = URL.createObjectURL(new Blob([bytes], {type:image.mime}));
    window.addEventListener('pagehide', event => {if (!event.persisted) URL.revokeObjectURL(url);});
    const preview = element('img');
    preview.alt = 'Proposed team image';
    preview.src = url;
    const link = element('a', 'Download image');
    link.href = url;
    link.download = 'team-image.' + imageTypes[image.mime];
    link.className = 'image-download-link';
    show(preview, link);
  } catch {
    show(element('p', 'This image is unavailable.'));
  }
}

export function mountTeamIdentity(root, context, onIdentityChanged) {
  let version = 0;
  let selectedTeam = '';
  let owner = '';
  function clear() {
    version++;
    root.replaceChildren();
  }
  function open(requestedTeam) {
    clear();
    const {user, teams, teamId, backend, demo} = context();
    if (owner !== user?.id) selectedTeam = '';
    owner = user?.id;
    if (!user || !teams.length || !backend?.listTeamIdentity) return;
    const current = version;
    let submitting = false;
    const active = () => current === version && context().user?.id === user.id;
    selectedTeam = [requestedTeam, teamId, selectedTeam, teams[0].id].find(id => teams.some(team => team.id === id));
    const selectedId = selectedTeam;
    const activeTeam = teams.find(team => team.id === selectedTeam);
    const captain = activeTeam?.owner_user_id === user.id;
    const panel = element('details');
    panel.className = 'team-branding-panel';
    panel.append(element('summary', 'Team name and emblem proposals'));
    const form = element('form');
    const name = element('input');
    name.maxLength = 80;
    const nameLabel = element('label', 'Proposed name');
    nameLabel.append(name);
    const file = element('input');
    file.type = 'file';
    file.accept = Object.keys(imageTypes).join(',');
    const fileLabel = element('label', 'Team image · PNG, JPG or WebP up to 512 KB');
    fileLabel.append(file);
    const submit = element('button', 'Submit proposal');
    submit.className = 'primary';
    const status = element('p');
    status.setAttribute('role','status');
    const list = element('ul');
    let useSample = false;
    form.append(nameLabel, fileLabel);
    if(demo){
      const sample = element('button','Use sample image');
      sample.type = 'button';
      sample.onclick = () => {useSample = true;file.value = '';status.textContent = 'Sample image selected.';};
      file.onchange = () => {useSample = false;};
      form.append(sample);
    }
    form.append(element('p', demo ? 'Demo links work in this browser.' : 'Anyone with the image link can download it.'), submit);
    root.append(panel);
    panel.append(form, status, list);
    let imageChoice;
    let thumbnails=[];
    const showThumbnails=()=>{if(panel.open)for(const show of thumbnails.splice(0,8))show();};
    panel.addEventListener('toggle',showThumbnails);
    if(captain && backend.setTeamIdentity){
      const editor = element('details');
      editor.className = 'team-branding-panel';
      editor.append(element('summary','Edit team identity'));
      const settings = element('form');
      const nameField = element('input');
      nameField.value = activeTeam.name;
      nameField.required = true;
      nameField.maxLength = 80;
      const nameCaption = element('label','Team name');
      nameCaption.append(nameField);
      imageChoice = element('select');
      imageChoice.append(new Option('No emblem',''));
      if(activeTeam.identity_image_id)imageChoice.append(new Option('Current emblem',activeTeam.identity_image_id));
      imageChoice.value = activeTeam.identity_image_id || '';
      const imageCaption = element('label','Emblem from proposals');
      imageCaption.append(imageChoice);
      const save = element('button','Save team identity');
      save.className = 'primary';
      const result = element('p');
      result.setAttribute('role','status');
      settings.append(nameCaption,imageCaption,save,result);
      editor.append(settings);
      root.prepend(editor);
      settings.onsubmit = async event => {
        event.preventDefault();
        if(save.disabled || !active())return;
        const nextName = nameField.value.trim();
        const imageId = imageChoice.value || null;
        if(!nextName){result.textContent='Enter a team name.';return;}
        save.disabled = true;
        try{
          await backend.setTeamIdentity(activeTeam.id,nextName,imageId,user.id);
          if(active()){
            onIdentityChanged?.(activeTeam.id,nextName,imageId);
            result.textContent='Team identity saved.';
          }
        }catch{
          if(active())result.textContent='Could not save team identity. Check that you are still the captain and try again.';
        }finally{save.disabled=false;}
      };
    }
    async function load() {
      const rows = await backend.listTeamIdentity(selectedId);
      if (!active()) return;
      list.replaceChildren();
      thumbnails=[];
      if(imageChoice){
        const previous=imageChoice.value;
        imageChoice.replaceChildren(new Option('No emblem',''));
        for(const row of rows.filter(row=>row.image_mime))imageChoice.append(new Option(row.proposed_name||'Image proposal',row.id));
        if(previous&&!Array.from(imageChoice.options).some(option=>option.value===previous))imageChoice.append(new Option('Current emblem',previous));
        imageChoice.value=previous;
      }
      for (const row of rows) {
        const item = element('li');
        item.append(element('strong',row.proposed_name || 'Image proposal'));
        if (row.image_mime) {
          const link = element('a', 'Open and download image');
          link.href = (demo ? '/?demo&team-image=' : '/?team-image=') + encodeURIComponent(row.id);
          link.target = '_blank';
          link.rel = 'noopener';
          const copy = element('button', 'Copy image link');
          copy.type = 'button';
          copy.onclick = async () => {
            try {await navigator.clipboard.writeText(link.href);status.textContent = 'Image link copied.';}
            catch {status.textContent = 'Open the image and copy its address from the browser.';}
          };
          const thumbnail=element('img');
          thumbnail.alt='Proposed emblem';
          thumbnail.loading='lazy';
          thumbnails.push(()=>void backend.getTeamIdentityImage(row.id).then(image=>{
            if(active()&&Object.hasOwn(imageTypes,image?.mime))thumbnail.src='data:'+image.mime+';base64,'+image.data;
          }).catch(()=>{}));
          item.prepend(thumbnail);
          item.append(link, copy);
        }
        list.append(item);
      }
      showThumbnails();
      if (!rows.length) list.append(element('li', 'No proposals yet.'));
    }
    void load().catch(() => {if (active()) status.textContent = 'Could not load proposals. Reopen Team to retry.';});
    form.onsubmit = async event => {
      event.preventDefault();
      if (submitting) return;
      const proposedName = name.value.trim();
      const image = file.files[0];
      if (!proposedName && !image && !useSample) {status.textContent = 'Enter a name or choose an image.';return;}
      if (image && (!Object.hasOwn(imageTypes, image.type) || image.size > 524288)) {
        status.textContent = 'Choose a PNG, JPG or WebP file up to 512 KB.';return;
      }
      submitting = submit.disabled = true;
      status.textContent = 'Submitting…';
      try {
        let data = null;
        if (image) {
          const bytes = new Uint8Array(await image.arrayBuffer());
          data = btoa(Array.from(bytes, byte => String.fromCharCode(byte)).join(''));
        }
        if(useSample)data=sampleImage();
        if (!active()) return;
        await backend.suggestTeamIdentity(selectedId, proposedName, useSample ? 'image/png' : image?.type ?? null, data, user.id);
        if (!active()) return;
        useSample = false;
        form.reset();
        status.textContent = 'Proposal submitted.';
        try {await load();} catch {if (active()) status.textContent = 'Proposal submitted. Reopen Team to refresh the list.';}
      } catch {
        if (active()) status.textContent = 'Could not submit the proposal. Check the image and try again.';
      } finally {
        submitting = false;
        if (active()) submit.disabled = false;
      }
    };
  }
  return {open,clear};
}
