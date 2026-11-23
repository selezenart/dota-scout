export const MIN_GAMES=10,WARN_RATE=55,HOT_RATE=60,MIN_MATCHUP_GAMES=20;
const CUP_LOBBY=9,DAY=86400,WINDOW_DAYS=180;

export function winTier(winRate,games){
 if(!(Number(games)>=MIN_GAMES))return 'low';
 if(winRate==null)return 'unknown';
 return winRate>=HOT_RATE?'hot':winRate>=WARN_RATE?'warm':'normal';
}

export function heroStatRows(heroes){
 return (Array.isArray(heroes)?heroes:[]).filter(h=>+h.games>0)
  .map(h=>({heroId:+h.hero_id,games:+h.games,wins:h.win==null?null:Math.max(0,+h.win||0)}))
  .sort((a,b)=>b.games-a.games||(b.wins??0)-(a.wins??0))
  .map(h=>({...h,winRate:h.wins==null?null:Math.round(100*h.wins/h.games)}));
}

// 'ok' when every named source answered; players without source tracking count as answered.
export function sourceStatus(player={},keys=[]){
 const sources=player.sources||{};
 if(!Object.keys(sources).length)return 'ok';
 const statuses=keys.map(key=>sources[key]?.status);
 if(statuses.includes('fetching'))return 'loading';
 return statuses.every(status=>status==='updated'||status==='empty')?'ok':'error';
}

export function comfortRows({player={},summary={},side}){
 const top=summary.topHeroes||[],stats=new Map(top.map(row=>[+row.heroId,row]));
 const self=player.selfReport||{};
 const ids=side==='enemy'?top.map(row=>+row.heroId):[...(self.signatureHeroes||[]),...(self.desiredHeroes||[]),...top.map(row=>row.heroId)].map(Number);
 return [...new Set(ids)].slice(0,2).map(heroId=>{
  const row=stats.get(heroId),games=row?.games??0,winRate=row?.winRate??null;
  return {heroId,games,winRate,tier:winTier(winRate,games)};
 });
}

export function enemyBanTarget(summary={},takenIds=new Set()){
 return (summary.topHeroes||[])
  .filter(row=>!takenIds.has(+row.heroId)&&row.winRate!=null&&row.games>=MIN_GAMES)
  .sort((a,b)=>b.winRate-a.winRate||b.games-a.games)[0]||null;
}

export function allyCounterBans(heroId,rows,takenIds=new Set()){
 if(!Array.isArray(rows))return [];
 return rows
  .map(row=>({heroId:+row.hero_id,games:+row.games_played,winRate:Math.round(100*(+row.wins)/(+row.games_played))}))
  .filter(row=>row.heroId!==+heroId&&!takenIds.has(row.heroId)&&row.games>=MIN_MATCHUP_GAMES&&Number.isFinite(row.winRate))
  .sort((a,b)=>a.winRate-b.winRate||b.games-a.games).slice(0,2);
}

export function recentCupGames(player={},now=Date.now()/1000){
 const seen=new Set(),games=[];
 for(const match of [player.recent,player.cupMatches].flatMap(rows=>Array.isArray(rows)?rows:[])){
  const age=(now-Number(match.start_time))/DAY,key=String(match.match_id);
  if(match.match_id==null||match.hero_id==null||+match.lobby_type!==CUP_LOBBY||!(age>=0&&age<=WINDOW_DAYS)||seen.has(key))continue;
  seen.add(key);
  games.push({matchId:match.match_id,heroId:+match.hero_id,startTime:+match.start_time,
   won:match.radiant_win==null?null:Boolean(match.radiant_win)===(+match.player_slot<128)});
 }
 return games.sort((a,b)=>b.startTime-a.startTime).slice(0,3).map(({startTime,...game})=>game);
}

export function tileMark({takenMode,pick=false,ban=false}={}){
 if(takenMode)return takenMode.endsWith('Ban')?{text:'BAN',kind:'banned'}:{text:'PICK',kind:'picked'};
 if(pick&&ban)return {text:'P+B',kind:'contested'};
 if(pick)return {text:'P',kind:'sug-pick'};
 if(ban)return {text:'B',kind:'sug-ban'};
 return null;
}
