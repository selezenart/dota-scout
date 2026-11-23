const make=(tag,cls,text)=>{const node=document.createElement(tag);if(cls)node.className=cls;if(text!=null)node.textContent=text;return node;};
const STATE_TEXT={loading:'Loading…',closed:'Closed account',error:'Stats unavailable'};

function comfortRow(row,{portrait,heroName}){
 const item=make('span','seat-hero tier-'+row.tier),image=portrait(row.heroId),text=make('span','seat-hero-text'),stat=make('span','seat-stat');
 image.alt='';
 const rate=row.winRate==null?'—':(row.tier==='hot'?'▲ ':'')+row.winRate+'%',games=row.games+' games'+(row.tier==='low'?' · low':'');
 stat.append(make('b',null,rate),make('small',null,games));text.append(make('span','seat-hero-name',heroName(row.heroId)),stat);item.append(image,text);
 item.title=`${heroName(row.heroId)}: ${rate} over ${row.games} games in the last 180 days`;
 return item;
}

function seatCard(seat,options){
 const {focusId,portrait,heroName,onToggle}=options;
 const card=make('button','seat-card is-'+seat.side);card.type='button';card.dataset.seatId=seat.id;card.setAttribute('aria-pressed',String(focusId===seat.id));card.classList.toggle('is-focused',focusId===seat.id);card.onclick=()=>onToggle(seat.id);
 const head=make('span','seat-head');head.append(make('strong',null,seat.name),make('small',null,seat.position?'Pos '+seat.position:'Pos ?'));card.append(head);
 const status=STATE_TEXT[seat.state];
 if(status)card.append(make('span','seat-state',status));
 if(seat.comfort.length){const list=make('span','seat-comfort');for(const row of seat.comfort)list.append(comfortRow(row,{portrait,heroName}));card.append(list);}
 card.append(make('span','seat-caption',seat.banLabel),make('span','seat-ban',seat.bans));
 const cup=make('span','seat-cup');
 if(seat.cup.length)for(const game of seat.cup){const item=make('span','seat-game '+(game.won==null?'is-unknown':game.won?'is-win':'is-loss')),image=portrait(game.heroId),result=game.won==null?'?':game.won?'W':'L';image.alt=`${result==='?'?'Unknown result':result==='W'?'Won':'Lost'} on ${heroName(game.heroId)}`;item.append(image,make('span',null,result));cup.append(item);}
 else cup.append(make('small',null,'No recent cups'));
 card.append(make('span','seat-caption','Last Battle Cup'),cup);
 return card;
}

function emptySeat(side,onAddEnemy){
 if(side==='ally'){const seat=make('div','seat-card seat-empty is-ally');seat.append(make('strong',null,'Open seat'));return seat;}
 const add=make('button','seat-card seat-empty seat-add-enemy is-enemy','Add enemy');add.type='button';add.onclick=onAddEnemy;return add;
}

export function renderPlayerRail(root,options){
 const focused=root.contains(document.activeElement)?document.activeElement.dataset?.seatId:null;
 root.replaceChildren();
 for(const [side,seats] of [['ally',options.allies],['enemy',options.enemies]]){
  const group=make('div','seat-group');group.setAttribute('role','group');group.setAttribute('aria-label',side==='ally'?'Our players':'Enemy players');
  for(let index=0;index<5;index++)group.append(seats[index]?seatCard(seats[index],options):emptySeat(side,options.onAddEnemy));
  root.append(group);
 }
 if(focused!=null)[...root.querySelectorAll('[data-seat-id]')].find(node=>node.dataset.seatId===focused)?.focus({preventScroll:true});
}
