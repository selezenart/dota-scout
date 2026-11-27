import { createClient } from '@supabase/supabase-js';

const own = (o, key) => Object.prototype.hasOwnProperty.call(o, key);
const normalizeProfile = row => row ? ({
  avatarHeroId: row.avatar_hero_id, userId: row.user_id, displayName: row.display_name || 'Teammate',
  steamAccountId: row.steam_account_id || '',
  preferredRoles: row.preferred_roles || [], roleComfort: row.role_comfort || {},
  signatureHeroes: row.signature_heroes || [], desiredHeroes: row.desired_heroes || [],
  avoidHeroes: row.avoid_heroes || [], availability: row.availability || 'available',
  notes: row.notes || '', updatedAt: row.updated_at || null,
}) : null;

/** Real Supabase client. Public URL/key only; authorization lives in Postgres. */
const randomHex = (bytes = 32) => Array.from(crypto.getRandomValues(new Uint8Array(bytes)), b => b.toString(16).padStart(2, '0')).join('');
async function sha256Hex(text) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2, '0')).join('');
}
export const googleAttemptKey = 'captain-google-oauth';

export function createBackend({ supabaseUrl, supabaseAnonKey, googleClientId = '' } = {}) {
  if (!supabaseUrl || !supabaseAnonKey) throw new Error('Team workspace is not configured. Set the public Supabase URL and publishable key.');
  const client = createClient(supabaseUrl, supabaseAnonKey, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
  });
  async function checked(request) {
    const { data, error } = await request;
    if (error) throw error;
    return data;
  }
  async function currentUser() {
    const { user } = await checked(client.auth.getUser());
    if (!user) throw new Error('Sign in to use your team workspace.');
    return user;
  }
  const rpc = (name, args = {}) => checked(client.rpc(name, args));
  async function accountRpc(name, args, expectedUserId) {
    const { session } = await checked(client.auth.getSession());
    if (session?.user.id !== expectedUserId || !session.access_token) throw Error('The active account changed. Open Battle Cup again.');
    const scoped = createClient(supabaseUrl, supabaseAnonKey, { accessToken: async () => session.access_token });
    return checked(scoped.rpc(name, args));
  }
  return {
    previewTeamInvitation(code) { return rpc('preview_scout_team_invite', {invite_token:code}); },
    listBattleCup(teamId) { return teamId?rpc('get_battle_cup', {target_team:teamId}):rpc('get_open_battle_cup',{}); },
    saveBattleCup(teamId,eventAt,slot,positions,userId) {
      return accountRpc(teamId?'save_battle_cup':'save_open_battle_cup',{...(teamId?{target_team:teamId}:{}),event_time:eventAt,target_slot:slot,chosen_positions:positions},userId);
    },
    cancelBattleCup(teamId,eventAt,userId) {
      return accountRpc(teamId?'cancel_battle_cup':'cancel_open_battle_cup',{...(teamId?{target_team:teamId}:{}),event_time:eventAt},userId);
    },
    verifySteam(token) { return checked(client.auth.verifyOtp({token_hash:token,type:'email'})); },
    async getSession() { return (await checked(client.auth.getSession())).session; },
    signIn(email, password) { return checked(client.auth.signInWithPassword({ email: email.trim(), password })); },
    // With a Google client ID, sign in directly with Google so its consent screen shows our own
    // address, then hand the ID token to Supabase (finishGoogle). Otherwise use Supabase's redirect.
    googleDirect: !!googleClientId,
    async signInGoogle() {
      if (!googleClientId) return checked(client.auth.signInWithOAuth({provider:'google',options:{redirectTo:new URL('/',location.origin).href,queryParams:{prompt:'select_account'}}}));
      const state = randomHex(), nonce = randomHex();
      sessionStorage.setItem(googleAttemptKey, JSON.stringify({ state, nonce, at: Date.now() }));
      const url = new URL('https://accounts.google.com/o/oauth2/v2/auth');
      url.search = new URLSearchParams({ client_id: googleClientId, redirect_uri: location.origin + '/', response_type: 'id_token', scope: 'openid email profile', state, nonce: await sha256Hex(nonce), prompt: 'select_account' });
      location.assign(url.href);
    },
    finishGoogle(token, nonce) { return checked(client.auth.signInWithIdToken({ provider: 'google', token, nonce })); },
    signUp(email, password, name = '', redirect = '/') {
      return checked(client.auth.signUp({ email: email.trim(), password, options: {
        emailRedirectTo: new URL(redirect, location.origin).href,
        data: { display_name: name.trim().slice(0, 80) },
      } }));
    },
    async signOut() { await checked(client.auth.signOut()); },
    async recoverPassword(email, redirectTo) {
      await checked(client.auth.resetPasswordForEmail(email.trim(), redirectTo ? { redirectTo } : {}));
    },
    async updatePassword(password) { return checked(client.auth.updateUser({ password })); },
    onAuthChange(callback) {
      const { data: { subscription } } = client.auth.onAuthStateChange((event, session) => callback(session, event));
      return () => subscription.unsubscribe();
    },
    async loadProfile() {
      const user = await currentUser();
      return normalizeProfile(await checked(client.from('player_profiles').select('*').eq('user_id', user.id).maybeSingle()));
    },
    async saveProfile(profile, expectedUserId) {
      const user = await currentUser();
      if (expectedUserId && user.id !== expectedUserId) throw new Error('The active account changed. Reopen your profile before saving.');
      const row = { user_id: user.id, updated_at: new Date().toISOString() };
      const fields = {
        displayName: 'display_name', steamAccountId: 'steam_account_id', preferredRoles: 'preferred_roles',
        avatarHeroId: 'avatar_hero_id', roleComfort: 'role_comfort', signatureHeroes: 'signature_heroes', desiredHeroes: 'desired_heroes',
        avoidHeroes: 'avoid_heroes', availability: 'availability', notes: 'notes',
      };
      for (const [key, field] of Object.entries(fields)) {
        if (own(profile, key)) row[field] = key === 'steamAccountId' ? (String(profile[key] || '').trim() || null) : profile[key];
      }
      return normalizeProfile(await checked(client.from('player_profiles').upsert(row, { onConflict: 'user_id' }).select('*').single()));
    },
    setTeamIdentity(teamId,name,imageId,userId) {
      return accountRpc('set_scout_team_identity',{target_team:teamId,new_name:name,image_id:imageId},userId);
    },
    listTeamIdentity(teamId) { return rpc('list_team_identity', {target_team:teamId}); },
    suggestTeamIdentity(teamId, name, mime, data, userId) {
      return accountRpc('suggest_team_identity', {target_team:teamId,suggestion:name,mime,encoded_image:data}, userId);
    },
    getTeamIdentityImage(id) { return rpc('get_team_identity_image', {image_id:id}); },
    async listEnemyMatches(teamId) { return await rpc('list_enemy_matches', {target_team: teamId}) || []; },
    saveEnemyMatch(teamId, matchId, summary, side, contextIds) {
      return rpc('save_enemy_match', {target_team: teamId, target_match: matchId, match_summary: summary, side: side || null, context_ids: contextIds || []});
    },
    setEnemyMatchSide(teamId, matchId, side) { return rpc('set_enemy_match_side', {target_team: teamId, target_match: matchId, side}); },
    async listEnemySightings(teamId) { return await rpc('list_enemy_sightings', {target_team: teamId}) || []; },
    recordEnemySightings(teamId, gameKey, entries, source = 'manual') {
      return rpc('record_enemy_sightings', {target_team: teamId, game_key: gameKey, entries, entry_source: source});
    },
    async listTeams() { return await rpc('list_my_teams') || []; },
    createTeam(name) { return rpc('create_scout_team', { team_name: name.trim() }); },
    async joinTeam(inviteCode, expectedUserId) {
      const args = { invite_token: inviteCode.trim() };
      if (!expectedUserId) return rpc('join_scout_team', args);
      const { session } = await checked(client.auth.getSession());
      if (session?.user.id !== expectedUserId || !session.access_token) throw new Error('The active account changed. Open the invitation again.');
      // Pin this request to the account the user explicitly chose, even if another
      // tab changes the active Supabase session while the request is being sent.
      const accessToken = session.access_token;
      const inviteClient = createClient(supabaseUrl, supabaseAnonKey, { accessToken: async () => accessToken });
      return checked(inviteClient.rpc('join_scout_team', args));
    },
    removeTeamMember(teamId, memberId, userId) {
      return accountRpc('remove_scout_team_member',{target_team:teamId,target_user:memberId},userId);
    },
    renewTeamInvite(teamId, userId) { return accountRpc('renew_scout_team_invite', {target_team: teamId}, userId); },
    deleteTeam(teamId, userId) { return accountRpc('delete_scout_team', {target_team: teamId}, userId); },
    leaveTeam(teamId, userId) { return accountRpc('leave_scout_team', {target_team: teamId}, userId); },
    async loadRoster(teamId) { return (await rpc('load_team_roster', { target_team: teamId }) || []).map(normalizeProfile); },
    createDraft(teamId, state = { actions: [], firstPick: true, enemyIds: [] }) {
      return rpc('create_team_draft', { target_team: teamId, initial_state: state });
    },
    getDraft(id) { return checked(client.from('team_drafts').select('*').eq('id', id).single()); },
    listDrafts(teamId) { return checked(client.from('team_drafts').select('*').eq('team_id', teamId).order('updated_at', { ascending: false }).limit(30)); },
    mutateDraft(id, expectedRevision, operation, payload = {}) {
      return rpc('mutate_team_draft', { draft_id: id, expected_revision: expectedRevision, operation, payload });
    },
  };
}
