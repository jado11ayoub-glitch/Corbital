/* ============================================================
   Corbits prototype — behavior
   All demo data lives in the plain arrays/objects below —
   edit them freely, refresh the page, done. No build step.
   Profile + activity usage persist in localStorage.
   ============================================================ */

/* ---------- helpers ---------- */
const $ = s => document.querySelector(s);
const $$ = s => [...document.querySelectorAll(s)];

function toast(m){
  const t = $('#toast');
  t.textContent = m;
  t.classList.add('show');
  clearTimeout(t._h);
  t._h = setTimeout(() => t.classList.remove('show'), 2600);
}
function openSheet(n){ $('#scrim').classList.add('show'); $('#sheet-' + n).classList.add('show'); }
function closeSheets(){
  $('#scrim').classList.remove('show');
  $$('.sheet').forEach(s => s.classList.remove('show'));
  stopChatPoll();
  stopMsgListPoll();
}
document.addEventListener('keydown', e => { if (e.key === 'Escape') closeSheets(); });

/* escape untrusted text for safe use inside a single-quoted onclick="...('...')" attribute */
function escJS(s){ return String(s == null ? '' : s).replace(/\\/g, '\\\\').replace(/'/g, "\\'"); }
/* escape untrusted text for safe use inside innerHTML (chat message bodies, etc.) */
function escHTML(s){ return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }

function store(key, val){ try { localStorage.setItem(key, JSON.stringify(val)); } catch(e){} }
function load(key, fallback){
  try { const v = localStorage.getItem(key); return v ? JSON.parse(v) : fallback; }
  catch(e){ return fallback; }
}

/* ---------- main tabs ---------- */
function showPanel(t){
  const litTab = t === 'friends' ? 'frds' : t;
  $$('.tab').forEach(x => x.classList.toggle('on', x.dataset.t === litTab));
  $$('.panel').forEach(p => p.classList.toggle('on', p.id === 'p-' + t));
  if (t === 'frds' && me) loadFriendsFeed();
  if (t === 'plannit' && me) { closePlannitDetail(); loadPlannitFeed(); }
  if (t === 'search' && me) { loadSearchData(); startSearchPoll(); } else { stopSearchPoll(); }
}
$('#tabs').addEventListener('click', e => {
  const b = e.target.closest('.tab');
  if (b) showPanel(b.dataset.t);
});

/* ---------- audience selectors ----------
   .audsel.single → radio behavior; .audsel → toggle any.
   Buttons starting with "＋" are actions, never selections. */
document.addEventListener('click', e => {
  const b = e.target.closest('.audsel button');
  if (!b) return;
  const label = b.textContent;
  if (label === '＋ New circle') { createNewCircle(); return; }
  if (label.startsWith('＋')) { toast('TBD'); return; }
  if (label.includes('Pick')) {
    toast('Custom picker: choose exact people per post (full flow TBD)');
  }
  if (b.parentElement.classList.contains('single')) {
    b.parentElement.querySelectorAll('button').forEach(x => x.classList.toggle('on', x === b));
  } else {
    b.classList.toggle('on');
  }
});

/* ============================================================
   ACCOUNTS — username + password, no email required.
   Real backend: Supabase Postgres. Every account/friend/schedule
   operation below calls a SECURITY DEFINER SQL function (see
   /supabase/schema.sql) so passwords are hashed server-side with
   bcrypt and never touch the client in any form.
   ============================================================ */
const SUPABASE_URL = 'https://noingtyctnvemgreegcy.supabase.co';
const SUPABASE_KEY = 'sb_publishable__8xajLrVS-ie0zrRxfsi7Q_nww5wx4c';
const sb = supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

const AVATARS = ['🙂','😎','🐆','🦍','🐬','⚡','🔥','🌊','🏔️','🎧'];

/* display-name cleanliness filter */
const BAD_WORDS = ['fuck','shit','bitch','cunt','nigg','fagg','whore','slut','retard','dick','cock','pussy','penis','vagina','rape','nazi'];
function isCleanName(name){
  const flat = name.toLowerCase().replace(/[^a-z]/g, '');
  return !BAD_WORDS.some(w => flat.includes(w));
}

const USER_RE = /^[A-Za-z0-9_]{3,20}$/;

/* email: optional, recovery only. Server stores/masks it; the raw
   address only ever appears client-side when the user themselves
   just typed it (signup, or entering it during forgot-password). */
function normEmail(raw){
  const e = raw.trim().toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(e) ? e : null;
}
function maskEmail(e){
  const [n, d] = e.split('@');
  return n[0] + '•••@' + d;
}
/* Codes are generated, stored, and checked entirely server-side
   (send_verification_email / verify_code in schema.sql) and delivered
   by real email via SendGrid — nothing code-related touches the
   browser except "sent" / "wrong code" outcomes. */

/* ---------- session + gate ---------- */
let me = null;   /* { username, displayName, av } — the signed-in account */
let authMode = 'in';

function currentUser(){ return load('cb_me', null); }

function setAuthMode(m){
  authMode = m;
  const isFp = m === 'fp';
  $('#authseg').style.display = isFp ? 'none' : 'flex';
  $('#fp-head').style.display = isFp ? 'block' : 'none';
  $('#gf-remail').style.display = isFp ? 'block' : 'none';
  $('#gf-user').style.display = isFp ? 'none' : 'block';
  $$('#authseg button').forEach(x => x.classList.toggle('on', x.dataset.m === m));
  $('#gf-name').style.display = m === 'up' ? 'block' : 'none';
  $('#gf-email').style.display = m === 'up' ? 'block' : 'none';
  $('#gf-code').style.display = 'none';
  $('#g-pass').parentElement.style.display = isFp ? 'none' : 'block';
  $('#g-passlabel').textContent = 'Password';
  $('#g-forgot').style.display = m === 'in' ? 'inline-flex' : 'none';
  $('#g-back').style.display = isFp ? 'inline-flex' : 'none';
  $('#g-go').textContent = isFp ? 'Send code' : (m === 'up' ? 'Create account' : 'Sign in');
  $('#g-pass').autocomplete = m === 'up' ? 'new-password' : 'current-password';
  $('#g-err').textContent = '';
  fp = isFp ? { stage:'email' } : null;
  if (isFp) $('#g-remail').focus();
}
$('#authseg').addEventListener('click', e => {
  const b = e.target.closest('button');
  if (b) setAuthMode(b.dataset.m);
});

/* ---------- forgot password (needs a linked email) ---------- */
let fp = null;   /* { stage, key, code } */
function startForgot(){ setAuthMode('fp'); }
['g-user','g-pass','g-name','g-remail','g-code'].forEach(id => {
  document.getElementById(id).addEventListener('keydown', e => { if (e.key === 'Enter') authSubmit(); });
});

async function authSubmit(){
  const err = m => { $('#g-err').textContent = m; };
  err('');
  const btn = $('#g-go');
  const busy = async fn => { btn.disabled = true; try { return await fn(); } finally { btn.disabled = false; } };

  if (fp) {
    if (fp.stage === 'email') {
      const em = normEmail($('#g-remail').value);
      if (!em) { err('That email doesn\'t look right'); return; }
      const { data, error } = await busy(() => sb.rpc('find_account_by_email', { p_email: em }));
      if (error) { err('Network error — check your connection and try again'); return; }
      if (!data.ok) { err('No account uses that email'); return; }
      fp.key = data.username;
      const sent = await busy(() => sb.rpc('send_verification_email', { p_username: fp.key }));
      if (sent.error || !sent.data.ok) { err('Could not send the email — try again in a moment'); return; }
      fp.stage = 'code';
      toast(`✉️ Code sent to ${maskEmail(em)} — CHECK YOUR SPAM FOLDER`);
      $('#gf-remail').style.display = 'none';
      $('#gf-code').style.display = 'block';
      $('#g-go').textContent = 'Verify code';
      $('#g-code').value = '';
      $('#g-code').focus();
      return;
    }
    if (fp.stage === 'code') {
      const { data, error } = await busy(() => sb.rpc('verify_code', { p_username: fp.key, p_code: $('#g-code').value.trim() }));
      if (error) { err('Network error — check your connection and try again'); return; }
      if (!data.ok) { err('Wrong or expired code — check the email we sent'); return; }
      fp.stage = 'newpass';
      $('#gf-code').style.display = 'none';
      $('#g-pass').parentElement.style.display = 'block';
      $('#g-passlabel').textContent = 'New password';
      $('#g-pass').value = '';
      $('#g-go').textContent = 'Set new password';
      $('#g-pass').focus();
      return;
    }
    if (fp.stage === 'newpass') {
      const np = $('#g-pass').value;
      if (np.length <= 6) { err('Password has to be more than 6 characters'); return; }
      const { data, error } = await busy(() => sb.rpc('reset_password', { p_username: fp.key, p_new: np }));
      if (error || !data.ok) { err('Could not reset the password — try again'); return; }
      const login = await sb.rpc('login', { p_username: fp.key, p_password: np });
      if (login.error || !login.data.ok) { err('Reset worked, but sign-in failed — try signing in manually'); return; }
      store('cb_me', { username: login.data.username, displayName: login.data.display_name, av: login.data.avatar });
      setAuthMode('in');
      $('#g-remail').value = '';
      $('#g-code').value = '';
      await enterApp();
      toast('Password reset — you\'re signed in ✓');
      return;
    }
  }

  const user = $('#g-user').value.trim();
  const pass = $('#g-pass').value;
  if (!USER_RE.test(user)) { err('Username: 3–20 characters, only letters, numbers and _'); return; }

  if (authMode === 'up') {
    let dn = $('#g-name').value.trim() || user;
    if (!isCleanName(dn)) { err('Pick a friendlier display name 🙂'); return; }
    if (pass.length <= 6) { err('Password has to be more than 6 characters'); return; }
    const rawEmail = $('#g-email').value.trim();
    let email = '';
    if (rawEmail) {
      email = normEmail(rawEmail);
      if (!email) { err('That email doesn\'t look right (or leave it empty)'); return; }
    }
    const av = AVATARS[Math.floor(Math.random() * AVATARS.length)];
    const { data, error } = await busy(() => sb.rpc('signup', {
      p_username: user, p_display_name: dn, p_password: pass, p_email: email || null,
    }));
    if (error) { err('Network error — check your connection and try again'); return; }
    if (!data.ok) {
      err(data.error === 'taken' ? 'That username is taken — try another'
        : data.error === 'weak_password' ? 'Password has to be more than 6 characters'
        : 'That username isn\'t allowed — 3–20 letters, numbers and _');
      return;
    }
    store('cb_me', { username: user, displayName: dn, av });
    await enterApp();
    toast(`Welcome to Corbits, ${dn}!`);
  } else {
    const { data, error } = await busy(() => sb.rpc('login', { p_username: user, p_password: pass }));
    if (error) { err('Network error — check your connection and try again'); return; }
    if (!data.ok) { err('Wrong username or password'); return; }
    store('cb_me', { username: data.username, displayName: data.display_name, av: data.avatar });
    await enterApp();
    toast(`Welcome back, ${data.display_name}`);
  }
}

/* stats (weekly chart / all-time totals / logbook) stay local per
   account for now — not yet moved to the database (see build notes) */
function statsKey(){ return 'cb_stats_' + me.username.toLowerCase(); }
function saveStats(){ if (me) store(statsKey(), { totals, logbook, freqV: freq.series.map(x => x.v) }); }
function loadStats(){
  const st = load(statsKey(), null);
  if (!st) return;
  Object.keys(totals).forEach(k => delete totals[k]);
  Object.assign(totals, st.totals);
  logbook.length = 0;
  logbook.push(...st.logbook);
  if (st.freqV) freq.series.forEach((x, i) => { if (st.freqV[i]) x.v = st.freqV[i]; });
}

/* ---------- schedule: synced to the database, shared with friends ---------- */
function rowToSlot(r){
  return { id: r.id, act: r.act, c: r.color, t: r.time_label, note: r.note,
           posted: r.audience, range: r.is_range, tags: r.tags || [], done: r.done,
           cancelled: !!r.cancelled, edited: !!r.edited };
}
async function loadScheduleFromServer(){
  const who = me.username;
  const { data, error } = await sb.rpc('list_plans', { p_me: who, p_owner: who });
  if (!me || me.username !== who) return;   /* a different account signed in while this was in flight */
  if (error) { toast('Could not load your schedule — check your connection'); return; }
  Object.keys(daySlots).forEach(k => delete daySlots[k]);
  data.forEach(r => { (daySlots[r.day_index] = daySlots[r.day_index] || []).push(rowToSlot(r)); });
}

async function enterApp(){
  me = currentUser();
  if (!me) { $('#authgate').classList.remove('hidden'); return; }
  $('#authgate').classList.add('hidden');
  $('#profilebtn').textContent = me.av;
  $('#pf-name').value = me.displayName;
  $('#pf-account').textContent = '@' + me.username;
  $$('#pf-av button').forEach(b => b.classList.toggle('on', b.textContent === me.av));
  TODAY_IX = computeTodayIx();
  weekOffset = 0;
  selDay = TODAY_IX;
  loadStats();
  await loadScheduleFromServer();
  drawWeek(); drawSlots(); drawFreq(); drawTotals(); drawLogbook();
  const em = await sb.rpc('get_masked_email', { p_username: me.username });
  $('#pf-email').value = (!em.error && em.data.has_email) ? em.data.masked : '';
  await drawFriendsTab();
  loadFriendsFeed();
  await loadCircles();
  drawAudienceSelectors();
  drawPrivacyCircles();
  loadSearchData();
  loadPlannitFeed();
  startReqBadgePoll();
  startMsgBadgePoll();
}

function openPrivacy(){
  drawAudienceSelectors();
  drawPrivacyCircles();
  $$('#notif-pref button').forEach(b => b.classList.toggle('on', b.dataset.v === notifPref()));
  openSheet('privacy');
}

function logoutUser(){
  localStorage.removeItem('cb_me');
  me = null;
  stopReqBadgePoll();
  stopMsgBadgePoll();
  stopSearchPoll();
  searchLoaded = false;
  activeChat = null;
  closeSheets();
  $('#authgate').classList.remove('hidden');
  $('#g-pass').value = '';
}

/* ---------- friend-request badge on the FRIENDS tab ---------- */
function paintReqBadge(n){
  const b = $('#freq-badge');
  if (n > 0) { b.textContent = n > 9 ? '9+' : n; b.hidden = false; }
  else b.hidden = true;
}
let reqBadgeTimer = null;
async function pollReqBadge(){
  if (!me) return;
  const who = me.username;
  const { data, error } = await sb.rpc('list_incoming_requests', { p_me: who });
  if (!error && me && me.username === who) paintReqBadge((data || []).length);
}
function startReqBadgePoll(){
  stopReqBadgePoll();
  pollReqBadge();
  reqBadgeTimer = setInterval(pollReqBadge, 25000);
}
function stopReqBadgePoll(){
  if (reqBadgeTimer) clearInterval(reqBadgeTimer);
  reqBadgeTimer = null;
}

/* ---------- profile sheet (avatar + display name on the account) ---------- */
(function initProfile(){
  const cp = $('#pf-av');
  AVATARS.forEach(a => {
    const b = document.createElement('button');
    b.textContent = a;
    b.onclick = () => { if (me) me.av = a; cp.querySelectorAll('button').forEach(x => x.classList.toggle('on', x === b)); };
    cp.appendChild(b);
  });
})();

async function saveProfile(){
  if (!me) return;
  const dn = $('#pf-name').value.trim() || me.username;
  if (!isCleanName(dn)) { toast('Pick a friendlier display name 🙂'); return; }
  const rawEmail = $('#pf-email').value.trim();
  let emailArg = '__unchanged__';
  if (!rawEmail) emailArg = '';
  else if (!rawEmail.includes('•')) {
    const em = normEmail(rawEmail);
    if (!em) { toast('That email doesn\'t look right'); return; }
    emailArg = em;
  }
  const { error } = await sb.rpc('update_profile', {
    p_username: me.username, p_display_name: dn, p_avatar: me.av, p_email: emailArg,
  });
  if (error) { toast('Could not save — check your connection'); return; }
  me.displayName = dn;
  store('cb_me', me);
  $('#profilebtn').textContent = me.av;
  closeSheets();
  drawFriendsTab();
  toast(`Saved — hey ${dn} ${me.av}`);
}

/* ---------- change password (code if email linked, else current password) ---------- */
async function changePassword(){
  if (!me) return;
  const em = await sb.rpc('get_masked_email', { p_username: me.username });
  if (em.error) { toast('Could not reach the server — try again'); return; }
  if (em.data.has_email) {
    const sent = await sb.rpc('send_verification_email', { p_username: me.username });
    if (sent.error || !sent.data.ok) { toast('Could not send the email — try again in a moment'); return; }
    toast(`✉️ Code sent to ${em.data.masked} — CHECK YOUR SPAM FOLDER`);
    const got = prompt(`A verification code was sent to ${em.data.masked}.\nCHECK YOUR SPAM FOLDER if you don't see it.\nEnter the 6-digit code:`);
    if (got === null) return;
    const check = await sb.rpc('verify_code', { p_username: me.username, p_code: got.trim() });
    if (check.error) { toast('Could not reach the server — try again'); return; }
    if (!check.data.ok) { toast('Wrong or expired code — password unchanged'); return; }
    const np = prompt('New password (more than 6 characters):');
    if (np === null) return;
    if (np.length <= 6) { toast('Too short — password has to be more than 6 characters'); return; }
    const { data, error } = await sb.rpc('reset_password', { p_username: me.username, p_new: np });
    if (error || !data.ok) { toast('Could not change the password — try again'); return; }
  } else {
    const cur = prompt('No email linked — enter your current password instead:');
    if (cur === null) return;
    const np = prompt('New password (more than 6 characters):');
    if (np === null) return;
    if (np.length <= 6) { toast('Too short — password has to be more than 6 characters'); return; }
    const { data, error } = await sb.rpc('change_password', { p_username: me.username, p_old: cur, p_new: np });
    if (error) { toast('Could not reach the server — try again'); return; }
    if (!data.ok) { toast('Wrong password — nothing changed'); return; }
  }
  toast('Password changed ✓');
}

/* ---------- friends: search, requests, list — all real, synced via Supabase ---------- */
function frowHTML(acc, right){
  return `<div class="frow"><span class="fav2">${acc.avatar}</span>` +
    `<div class="g"><div class="dn">${acc.display_name}</div><div class="un">@${acc.username}</div></div>${right}</div>`;
}

let friendsCache = [], reqInCache = [], reqOutCache = [];

async function drawFriendsTab(){
  if (!me) return;
  const who = me.username;
  const [friends, reqIn, reqOut] = await Promise.all([
    sb.rpc('list_friends', { p_me: who }),
    sb.rpc('list_incoming_requests', { p_me: who }),
    sb.rpc('list_outgoing_requests', { p_me: who }),
  ]);
  if (!me || me.username !== who) return;   /* a different account signed in while this was in flight */
  friendsCache = friends.data || [];
  reqInCache = reqIn.data || [];
  reqOutCache = reqOut.data || [];
  paintReqBadge(reqInCache.length);

  $('#mecard').innerHTML =
    `<span class="fav2">${me.av}</span>` +
    `<div class="g"><div class="dn">${me.displayName}</div><div class="un">@${me.username} · ${friendsCache.length} friend${friendsCache.length === 1 ? '' : 's'}</div></div>` +
    `<button class="btn small" onclick="openSheet('profile')">Edit</button>`;

  $('#freqs').innerHTML = (reqInCache.length || reqOutCache.length)
    ? reqInCache.map(a => frowHTML(a,
        `<button class="btn primary small" onclick="acceptReq('${a.username}')">Accept</button>` +
        `<button class="btn small" onclick="declineReq('${a.username}')">Decline</button>`)).join('') +
      reqOutCache.map(a => frowHTML(a,
        `<button class="btn small" onclick="cancelReq('${a.username}')">Cancel request</button>`)).join('')
    : '<div class="sub">No pending requests.</div>';

  $('#flist').innerHTML = friendsCache.length
    ? friendsCache.map(a => frowHTML(a,
        `<button class="btn small" onclick="viewFriendSchedule('${a.username}')">📅 Schedule</button>` +
        `<button class="btn small" onclick="openDMChat('${a.username}', '${escJS(a.display_name)}')" title="Message">💬</button>` +
        `<button class="btn small" onclick="unfriend('${a.username}')" title="Remove friend">Unfriend</button>`)).join('')
    : '<div class="sub">No friends yet — search a username above.</div>';
  drawFSearch();
}

async function unfriend(u){
  if (!confirm(`Remove @${u} from your friends? They'll stop seeing your shared plans.`)) return;
  const { error } = await sb.rpc('remove_friend', { p_me: me.username, p_other: u });
  if (error) { toast('Could not remove — check your connection'); return; }
  await drawFriendsTab();
  loadFriendsFeed();
  toast(`Removed @${u}`);
}
async function cancelReq(u){
  const { error } = await sb.rpc('cancel_friend_request', { p_me: me.username, p_to: u });
  if (error) { toast('Could not cancel — check your connection'); return; }
  await drawFriendsTab();
  toast(`Request to @${u} cancelled`);
}
async function declineReq(u){
  const { error } = await sb.rpc('decline_friend_request', { p_me: me.username, p_from: u });
  if (error) { toast('Could not decline — check your connection'); return; }
  await drawFriendsTab();
  toast(`Declined @${u}`);
}

/* ---------- circles: one reusable, persistent audience group, used
   everywhere a "who can see this" picker shows up (composer, Privacy,
   PLANNIT send-to) — create once, use anywhere, any combination you want. ---------- */
let circlesCache = [];

async function loadCircles(){
  if (!me) return;
  const who = me.username;
  const { data, error } = await sb.rpc('list_my_circles', { p_me: who });
  if (!me || me.username !== who) return;
  if (!error) circlesCache = data || [];
}

function audienceButtonsHTML(selected){
  const names = ['Everyone', ...circlesCache.map(c => c.name)];
  const matches = selected === 'Only me' || names.includes(selected);
  const fallbackToEveryone = !matches; /* e.g. editing a post whose circle got deleted since */
  let html = names.map(n =>
    `<button${n === selected || (fallbackToEveryone && n === 'Everyone') ? ' class="on"' : ''}>${escHTML(n)}</button>`
  ).join('');
  html += `<button>＋ New circle</button><button${selected === 'Only me' ? ' class="on"' : ''}>Only me</button>`;
  return html;
}

function drawAudienceSelectors(){
  const cAud = $('#c-aud');
  if (cAud) { const cur = cAud.querySelector('.on'); cAud.innerHTML = audienceButtonsHTML(cur ? cur.textContent : null); }
  const defAud = $('#def-aud');
  if (defAud) { const cur = defAud.querySelector('.on'); defAud.innerHTML = audienceButtonsHTML(cur ? cur.textContent : null); }
}

function drawPrivacyCircles(){
  const box = $('#priv-circles');
  if (!box) return;
  box.innerHTML = circlesCache.length
    ? circlesCache.map(c =>
        `<button onclick="openCircleMembers('${c.id}', '${escJS(c.name)}')">${escHTML(c.name)} (${c.members.length})</button>`
      ).join('') + `<button>＋ New circle</button>`
    : `<button>＋ New circle</button>`;
}

async function createNewCircle(){
  const name = prompt('Name this circle — e.g. "Gym crew":');
  if (name === null) return;
  const trimmed = name.trim();
  if (!trimmed) return;
  const { data, error } = await sb.rpc('create_circle', { p_me: me.username, p_name: trimmed });
  if (error || !data.ok) {
    toast(data && data.error === 'taken' ? 'You already have a circle with that name' : 'Could not create — try again');
    return;
  }
  await loadCircles();
  drawAudienceSelectors();
  drawPrivacyCircles();
  toast(`"${trimmed}" created — add friends to it`);
  openCircleMembers(data.id, trimmed);
}

let circleMembersTarget = null; /* {id, name} for the circle sheet-circlemembers is managing */

async function openCircleMembers(id, name){
  circleMembersTarget = { id, name };
  $('#cm-title').textContent = name;
  openSheet('circlemembers');
  drawCircleMembers();
}

function drawCircleMembers(){
  if (!circleMembersTarget) return;
  const circle = circlesCache.find(c => c.id === circleMembersTarget.id);
  const members = new Set(circle ? circle.members : []);
  $('#cm-list').innerHTML = friendsCache.length ? friendsCache.map(a => {
    const inCircle = members.has(a.username);
    return `<div class="frow"><span class="fav2">${a.avatar}</span>` +
      `<div class="g"><div class="dn">${a.display_name}</div><div class="un">@${a.username}</div></div>` +
      `<button class="btn small ${inCircle ? 'primary' : ''}" onclick="toggleCircleMember('${a.username}', ${!inCircle})">${inCircle ? '✓ In circle' : '＋ Add'}</button></div>`;
  }).join('') : '<div class="sub">Add some friends first — search from FRIENDS.</div>';
}

async function toggleCircleMember(username, addIt){
  if (!circleMembersTarget) return;
  const { data, error } = await sb.rpc('set_circle_member', {
    p_me: me.username, p_id: circleMembersTarget.id, p_member: username, p_in: addIt,
  });
  if (error || !data.ok) { toast('Could not update — try again'); return; }
  await loadCircles();
  drawCircleMembers();
  drawAudienceSelectors();
  drawPrivacyCircles();
}

async function deleteCurrentCircle(){
  if (!circleMembersTarget) return;
  if (!confirm(`Delete circle "${circleMembersTarget.name}"? You won't be able to post to it again — past posts sent to it are unaffected.`)) return;
  await sb.rpc('delete_circle', { p_me: me.username, p_id: circleMembersTarget.id });
  const name = circleMembersTarget.name;
  closeSheets();
  circleMembersTarget = null;
  await loadCircles();
  drawAudienceSelectors();
  drawPrivacyCircles();
  toast(`"${name}" deleted`);
}

/* ---------- viewing a friend's shared schedule (read-only) ---------- */
async function viewFriendSchedule(u){
  const friend = friendsCache.find(f => f.username === u);
  $('#fs-title').textContent = `🗓️ ${friend ? friend.display_name : '@' + u}'s schedule`;
  $('#fs-sub').textContent = 'Only what they\'ve shared with friends — anything posted "Only me" stays private.';
  $('#fs-list').innerHTML = '<div class="sub">Loading…</div>';
  openSheet('friendsched');
  const { data, error } = await sb.rpc('list_plans', { p_me: me.username, p_owner: u });
  if (error) { $('#fs-list').innerHTML = '<div class="sub">Could not load — check your connection.</div>'; return; }
  if (!data.length) { $('#fs-list').innerHTML = '<div class="sub">Nothing shared with you yet.</div>'; return; }
  const byDay = {};
  data.sort((a, b) => a.day_index - b.day_index).forEach(r => (byDay[r.day_index] = byDay[r.day_index] || []).push(r));
  $('#fs-list').innerHTML = Object.entries(byDay).map(([day, rows]) => {
    const label = dayLabel(+day).replace('Today — ', '');
    const items = rows.map(r =>
      `<div class="slot${r.cancelled ? ' cancelled' : ''}" style="--c:${r.color}"><div class="stripe"></div>` +
      `<div style="flex:1"><div class="t">${r.act}${(r.tags && r.tags.length) ? ' · ' + r.tags.join(' + ') : ''} · <span class="mono">${r.time_label}</span></div>` +
      `<div class="body sub" style="display:block">${r.note}${r.edited && !r.cancelled ? ' (edited)' : ''}` +
      `${r.cancelled ? '<div class="cancelled-banner">🚫 Event cancelled</div>' : ''}</div></div></div>`
    ).join('');
    return `<div class="eyebrow">${label}</div>${items}`;
  }).join('');
}

async function drawFSearch(){
  const q = $('#fsearch').value.trim().toLowerCase();
  const box = $('#fresults');
  if (!q) { box.innerHTML = '<div class="sub">Type a username above to find people.</div>'; return; }
  const { data, error } = await sb.rpc('search_accounts', { p_query: q, p_exclude: me.username });
  if (error) { box.innerHTML = '<div class="sub">Could not search — check your connection.</div>'; return; }
  if (!data.length) { box.innerHTML = '<div class="sub">Nobody found — usernames are exact, ask your friend for theirs.</div>'; return; }
  box.innerHTML = data.map(a => {
    const u = a.username.toLowerCase();
    let right;
    if (friendsCache.some(f => f.username.toLowerCase() === u)) right = '<span class="st">✓ Friends</span>';
    else if (reqOutCache.some(f => f.username.toLowerCase() === u)) right = '<span class="un">Requested…</span>';
    else if (reqInCache.some(f => f.username.toLowerCase() === u)) right = `<button class="btn primary small" onclick="acceptReq('${a.username}')">Accept</button>`;
    else right = `<button class="btn primary small" onclick="sendReq('${a.username}')">＋ Add</button>`;
    return frowHTML(a, right);
  }).join('');
}
$('#fsearch').addEventListener('input', drawFSearch);

async function sendReq(u){
  const { data, error } = await sb.rpc('send_friend_request', { p_from: me.username, p_to: u });
  if (error) { toast('Could not send the request — check your connection'); return; }
  if (!data.ok) { toast(data.error === 'already_friends' ? 'Already friends' : 'Could not send request'); return; }
  await drawFriendsTab();
  toast(data.status === 'friends' ? `You and @${u} are now friends 🤝` : `Request sent to @${u}`);
}
async function acceptReq(u){
  const { error } = await sb.rpc('accept_friend_request', { p_me: me.username, p_from: u });
  if (error) { toast('Could not accept — check your connection'); return; }
  await drawFriendsTab();
  loadFriendsFeed();
  toast(`You and @${u} are now friends 🤝`);
}

/* ---------- SCHD: multi-week calendar ----------
   day_index is stable across time: it's the real calendar day count
   since a fixed reference date (Jan 1 1970, local time), NOT an offset
   from "today" — so a plan you post today keeps meaning the same real
   date forever, even as "today" moves forward every day this stays open. */
const DOW = ['MON','TUE','WED','THU','FRI','SAT','SUN'];
const EPOCH_REF = new Date(1970, 0, 1);
function ixFromDate(date){
  const a = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  return Math.round((a - EPOCH_REF) / 86400000);
}
function dayDate(ix){ const d = new Date(EPOCH_REF); d.setDate(d.getDate() + ix); return d; }
function computeTodayIx(){ return ixFromDate(new Date()); }
function mondayIxOf(ix){ const dow = (dayDate(ix).getDay() + 6) % 7; /* 0=Mon..6=Sun */ return ix - dow; }

let TODAY_IX = computeTodayIx();
let weeksShown = 1;
let weekOffset = 0;                        /* 0 = the real current week; negative = past weeks */
let selDay = TODAY_IX;

/* catches a real midnight rollover if the app is left open overnight */
setInterval(() => {
  const fresh = computeTodayIx();
  if (fresh !== TODAY_IX) {
    TODAY_IX = fresh;
    drawWeek(); drawSlots();
  }
}, 60000);

function dayLabel(ix){
  const d = dayDate(ix);
  const s = d.toLocaleDateString('en-US', { weekday:'short', month:'short', day:'numeric' });
  return ix === TODAY_IX ? 'Today — ' + s : s;
}

const daySlots = {
  [TODAY_IX]: [
    { act:'Gym',   c:'var(--gym)',   t:'6:00 PM–10:00 PM', note:'leg day — posted as a range', posted:'Everyone', range:true, tags:['Legs'] },
    { act:'Study', c:'var(--study)', t:'2:00 PM–4:00 PM',  note:'BIO120 review', posted:'Only me', range:false, tags:['Review'] },
  ],
  [TODAY_IX + 1]: [
    { act:'Run', c:'var(--run)', t:'9:00 AM–11:00 AM', note:'easy 5k, open invite', posted:'Close friends', range:true, tags:['Long'] },
  ],
  [TODAY_IX + 2]: [
    { act:'Event', c:'var(--amber)', t:'7:00 PM', note:'Football game — big event', posted:'Everyone', range:false, event:true },
  ],
  [TODAY_IX + 3]: [
    { act:'Gym',  c:'var(--gym)',  t:'6:00 PM–8:00 PM', note:'back + pull day', posted:'Gym crew', range:false, tags:['Back'] },
  ],
  [TODAY_IX + 4]: [
    { act:'Swim', c:'var(--swim)', t:'7:00 AM–8:00 AM', note:'laps at the YMCA', posted:'Close friends', range:false, tags:['Distance'] },
  ],
};

$('#weeksseg').addEventListener('click', e => {
  const b = e.target.closest('button');
  if (!b) return;
  $$('#weeksseg button').forEach(x => x.classList.toggle('on', x === b));
  weeksShown = +b.dataset.w;
  const start = mondayIxOf(TODAY_IX) + weekOffset * 7;
  if (selDay < start || selDay >= start + weeksShown * 7) selDay = Math.max(selDay, start);
  drawWeek();
  drawSlots();
});

const MAX_WEEKS_BACK = 8;
function shiftWeekOffset(delta){
  weekOffset = Math.max(-MAX_WEEKS_BACK, Math.min(0, weekOffset + delta));
  selDay = mondayIxOf(TODAY_IX) + weekOffset * 7;
  drawWeek();
  drawSlots();
}

function drawWeek(){
  const w = $('#weekstrip');
  w.innerHTML = '';
  const total = weeksShown * 7;
  const start = mondayIxOf(TODAY_IX) + weekOffset * 7;
  for (let k = 0; k < total; k++) {
    const ix = start + k;
    const el = document.createElement('button');
    el.className = 'day' + (ix === selDay ? ' on' : '') + (ix < TODAY_IX ? ' past' : '');
    const marks = (daySlots[ix] || []).filter(s => !s.cancelled).slice(0, 3)
      .map(s => `<i style="background:${ix === selDay ? 'var(--on-brand)' : s.c}"></i>`).join('');
    el.innerHTML = `<div class="dow">${DOW[k % 7]}</div><div class="num">${dayDate(ix).getDate()}</div><div class="marks">${marks}</div>`;
    el.onclick = () => { selDay = ix; drawWeek(); drawSlots(); };
    w.appendChild(el);
  }
  const startD = dayDate(start), endD = dayDate(start + total - 1);
  $('#weekrangelabel').textContent = weekOffset === 0 && weeksShown === 1
    ? 'This week'
    : `${startD.toLocaleDateString('en-US', { month:'short', day:'numeric' })} – ${endD.toLocaleDateString('en-US', { month:'short', day:'numeric' })}`;
  $('#weekback').style.display = weekOffset <= -MAX_WEEKS_BACK ? 'none' : '';
  $('#weekfwd').style.display = weekOffset === 0 ? 'none' : '';
}

function drawSlots(){
  $('#daylabel').textContent = dayLabel(selDay);
  const isPast = selDay < TODAY_IX;
  $('#quickadd-block').style.display = isPast ? 'none' : '';
  $('#pastday-note').style.display = isPast ? '' : 'none';
  const box = $('#slots');
  box.innerHTML = '';
  const list = daySlots[selDay] || [];
  if (!list.length) {
    box.innerHTML = isPast
      ? '<div class="card sub">Nothing was planned this day.</div>'
      : '<div class="card sub">Nothing planned — tap an activity chip above to add.</div>';
  }
  list.forEach((s, ix) => {
    const el = document.createElement('div');
    el.className = 'slot' + (s.done ? ' done' : '') + (s.cancelled ? ' cancelled' : '');
    el.style.setProperty('--c', s.c);
    const noteText = s.note + (s.edited && !s.cancelled ? ' (edited)' : '');
    const actions = s.cancelled
      ? `<span class="doneb cancelledmark" title="Cancelled" aria-label="Cancelled">🚫</span>`
      : `<button class="doneb" title="Mark done — logs it everywhere" aria-label="Mark done">✓</button>`;
    el.innerHTML =
      `<div class="stripe"></div>` +
      actions +
      `<div style="flex:1"><div class="t">${s.act}${(s.tags && s.tags.length) ? ' · ' + s.tags.join(' + ') : ''} · <span class="mono">${s.t}</span></div>` +
      `<div class="body"><div class="sub">${noteText}</div><div class="meta">` +
      `${s.range ? '<span class="pill">⇄ range post</span>' : ''}<span class="pill">👁 ${s.posted}</span></div>` +
      (s.cancelled ? `<div class="cancelled-banner">🚫 Event cancelled</div>` : '') +
      `</div></div>` +
      (s.cancelled ? '' : `<span class="chev">▾</span><button class="more" title="Options" aria-label="Event options">⋮</button>`);
    el.onclick = () => el.classList.toggle('open');
    if (s.cancelled) { box.appendChild(el); return; }
    el.querySelector('.more').onclick = e => {
      e.stopPropagation();
      openSlotMenu(selDay, ix);
    };
    el.querySelector('.doneb').onclick = e => {
      e.stopPropagation();
      const nextDone = !s.done;
      s.done = nextDone;
      if (s.id) sb.rpc('set_plan_done', { p_me: me.username, p_id: s.id, p_done: nextDone });
      if (!nextDone) { drawSlots(); return; }
      const tags = (s.tags && s.tags.length) ? s.tags : inferTags(s.act, s.note);
      logActivity(s.act, tags, 'from your schedule');
      burst(e.clientX, e.clientY, 26);
      drawSlots();
    };
    box.appendChild(el);
  });
  drawRecs();
}

/* ---------- SCHD: 3-dot event menu (rename / edit / cancel) ---------- */
let menuTarget = null; /* {day, ix} for the slot the ⋮ menu / cancel confirm is acting on */

function openSlotMenu(day, ix){
  const s = (daySlots[day] || [])[ix];
  if (!s) return;
  menuTarget = { day, ix };
  $('#sm-title').textContent = s.act + ' — ' + s.t;
  openSheet('slotmenu');
}

async function renameSlotFromMenu(){
  if (!menuTarget) return;
  const { day, ix } = menuTarget;
  const s = (daySlots[day] || [])[ix];
  closeSheets();
  if (!s) return;
  const next = prompt('Rename this event:', s.note || '');
  if (next === null) return;
  const note = next.trim() || s.note;
  if (!s.id) { s.note = note; drawSlots(); toast('Renamed ✓'); return; }
  const { data, error } = await sb.rpc('upsert_plan', {
    p_me: me.username, p_id: s.id, p_day: day, p_act: s.act, p_color: s.c,
    p_time: s.t, p_note: note, p_audience: s.posted, p_range: s.range, p_tags: s.tags || [],
  });
  if (error || !data) { toast('Could not rename — check your connection and try again'); return; }
  s.note = data.note; s.edited = !!data.edited;
  drawSlots();
  loadSearchData();
  toast('Renamed ✓');
}

function editSlotFromMenu(){
  if (!menuTarget) return;
  const { day, ix } = menuTarget;
  closeSheets();
  openComposerForEdit(day, ix);
}

function cancelSlotFromMenu(){
  if (!menuTarget) return;
  closeSheets();
  openSheet('confirmcancel');
}

async function confirmCancelYes(){
  const target = menuTarget;
  menuTarget = null;
  closeSheets();
  if (!target) return;
  const { day, ix } = target;
  const s = (daySlots[day] || [])[ix];
  if (!s) return;
  if (!s.id) {
    /* never made it to the server — safe to just drop it locally */
    (daySlots[day] || []).splice(ix, 1);
    drawWeek(); drawSlots();
    toast('Removed');
    return;
  }
  const { data, error } = await sb.rpc('cancel_plan', { p_me: me.username, p_id: s.id });
  if (error || !data || !data.ok) {
    toast('Could not cancel — check your connection and try again');
    return;
  }
  /* soft cancel: stays visible marked "Cancelled" for you and for friends who saw it, and can no longer be joined */
  s.cancelled = true;
  drawWeek(); drawSlots();
  loadSearchData();
  toast('Cancelled — friends who saw this will see it marked cancelled');
}

/* ---------- SCHD: activity chips (favorites + sorted by usage) ---------- */
let acts = load('cb_acts', [
  { n:'Gym',   c:'var(--gym)',   fav:true,  uses:34 },
  { n:'Run',   c:'var(--run)',   fav:false, uses:21 },
  { n:'Study', c:'var(--study)', fav:false, uses:18 },
  { n:'Swim',  c:'var(--swim)',  fav:false, uses:12 },
]);
const pickColors = ['var(--gym)','var(--run)','var(--swim)','var(--study)','var(--other)',
                    'var(--pink)','var(--amber)','var(--crimson)','var(--sky)','var(--moss)'];
let naColor = pickColors[4];

function sortedActs(){
  /* favorites pinned first; inside each group, most-used first */
  return [...acts].sort((a, b) => (b.fav - a.fav) || (b.uses - a.uses));
}

function drawChips(){
  const r = $('#actchips');
  r.innerHTML = '';
  sortedActs().forEach(a => {
    const b = document.createElement('button');
    b.className = 'chip';
    b.style.setProperty('--c', a.c);
    b.innerHTML = `<span class="swatch"></span>${a.n} <span class="uses">×${a.uses}</span>` +
                  `<span class="fav ${a.fav ? 'on' : ''}" title="${a.fav ? 'Unfavorite' : 'Favorite — pins it to the front'}">${a.fav ? '★' : '☆'}</span>`;
    b.onclick = () => openComposer(a);
    b.querySelector('.fav').onclick = e => {
      e.stopPropagation();
      a.fav = !a.fav;
      store('cb_acts', acts);
      drawChips();
      toast(a.fav ? `★ ${a.n} pinned to the front` : `${a.n} unpinned — back to usage order`);
    };
    r.appendChild(b);
  });
  const plus = document.createElement('button');
  plus.className = 'chip add';
  plus.textContent = '＋ Make your own';
  plus.onclick = () => { $('#newact').classList.toggle('show'); $('#na-name').focus(); };
  r.appendChild(plus);
}

(function initColorPicker(){
  const cp = $('#na-colors');
  pickColors.forEach((c, i) => {
    const b = document.createElement('button');
    b.style.background = c;
    b.setAttribute('aria-label', 'color option');
    if (i === 4) b.classList.add('on');
    b.onclick = () => { naColor = c; cp.querySelectorAll('button').forEach(x => x.classList.toggle('on', x === b)); };
    cp.appendChild(b);
  });
})();

function saveNewActivity(){
  const n = $('#na-name').value.trim();
  if (!n) { toast('Give it a name first'); return; }
  if (acts.some(a => a.n.toLowerCase() === n.toLowerCase())) { toast('You already have that one'); return; }
  acts.push({ n, c: naColor, fav:false, uses:0 });
  store('cb_acts', acts);
  $('#na-name').value = '';
  $('#newact').classList.remove('show');
  drawChips();
  toast(`“${n}” saved — it's now a permanent one-tap chip ✓`);
}

/* ---------- SCHD: composer ---------- */
let curAct = null;

function fmtT(v){
  v = +v;
  return `${((v + 11) % 12) + 1}:00 ${v < 12 ? 'AM' : 'PM'}`;
}

['t-from','t-to'].forEach((id, ix) => {
  const s = document.getElementById(id);
  for (let h = 6; h <= 23; h++) {
    const o = document.createElement('option');
    o.value = h;
    o.textContent = fmtT(h);
    s.appendChild(o);
  }
  s.value = ix ? 22 : 18; /* default 6 PM – 10 PM */
});

let compSel = [];
function drawCompSubs(){
  const row = $('#c-subs');
  const opts = LOG_DETAILS[curAct ? curAct.n : ''] || [];
  $('#c-subrow').style.display = opts.length ? 'flex' : 'none';
  row.innerHTML = '';
  opts.forEach(d => {
    const b = document.createElement('button');
    b.textContent = d;
    b.style.setProperty('--c', curAct.c);
    b.classList.toggle('on', compSel.includes(d));
    b.onclick = () => {
      compSel = compSel.includes(d) ? compSel.filter(x => x !== d) : [...compSel, d];
      drawCompSubs();
    };
    row.appendChild(b);
  });
}
let editingSlot = null; /* {day, ix} while the composer is editing an existing slot, else null */

function openComposer(a){
  if (selDay < TODAY_IX) { toast("Can't plan for a day that's already passed"); return; }
  editingSlot = null;
  curAct = a;
  compSel = [];
  $('#composer').style.display = 'block';
  $('#composer-title').textContent = 'Plan: ' + a.n;
  $('#posttype .on').classList.remove('on');
  $('#posttype button[data-v="plan"]').classList.add('on');
  $('#timerow').style.display = 'flex';
  $('#c-note').value = '';
  $('#c-aud').innerHTML = audienceButtonsHTML('Everyone');
  drawCompSubs();
  $('#composer').scrollIntoView({ behavior:'smooth', block:'center' });
}
function hideComposer(){ $('#composer').style.display = 'none'; editingSlot = null; }

function hourFromLabel(label){
  for (let h = 6; h <= 23; h++) if (fmtT(h) === label) return h;
  return null;
}

function openComposerForEdit(day, ix){
  const s = (daySlots[day] || [])[ix];
  if (!s) return;
  editingSlot = { day, ix };
  curAct = { n: s.act, c: s.c, uses: 0 };
  compSel = [...(s.tags || [])];
  $('#composer').style.display = 'block';
  $('#composer-title').textContent = 'Edit: ' + s.act;

  const isAsk = s.t === 'anytime' && !s.range;
  $$('#posttype button').forEach(b => b.classList.toggle('on', b.dataset.v === (isAsk ? 'ask' : 'plan')));
  $('#timerow').style.display = isAsk ? 'none' : 'flex';
  if (!isAsk) {
    const [fromLabel, toLabel] = s.t.split('–');
    const fh = hourFromLabel(fromLabel), th = hourFromLabel(toLabel);
    if (fh !== null) $('#t-from').value = fh;
    if (th !== null) $('#t-to').value = th;
  }
  $('#c-note').value = s.note || '';
  $('#c-aud').innerHTML = audienceButtonsHTML(s.posted);
  drawCompSubs();
  $('#composer').scrollIntoView({ behavior:'smooth', block:'center' });
}

$('#posttype').addEventListener('click', e => {
  const b = e.target.closest('button');
  if (!b) return;
  $$('#posttype button').forEach(x => x.classList.toggle('on', x === b));
  $('#timerow').style.display = b.dataset.v === 'ask' ? 'none' : 'flex';
});

async function postPlan(){
  if (!curAct) return;
  const editing = editingSlot;
  const day = editing ? editing.day : selDay;
  if (!editing && day < TODAY_IX) { toast("Can't plan for a day that's already passed"); return; }
  const f = +$('#t-from').value, t = +$('#t-to').value;
  const type = $('#posttype .on').dataset.v;
  if (type !== 'ask' && t <= f) { toast('End time has to be after start'); return; }
  const aud = $('#c-aud .on').textContent;
  const note = $('#c-note').value.trim() || (type === 'ask' ? '(question)' : 'open to friends in this window');
  const timeLabel = type === 'ask' ? 'anytime' : `${fmtT(f)}–${fmtT(t)}`;
  const isRange = type !== 'ask';
  const tags = [...compSel];
  const existing = editing ? (daySlots[editing.day] || [])[editing.ix] : null;

  const { data, error } = await sb.rpc('upsert_plan', {
    p_me: me.username, p_id: existing ? existing.id : null, p_day: day, p_act: curAct.n, p_color: curAct.c,
    p_time: timeLabel, p_note: note, p_audience: aud, p_range: isRange, p_tags: tags,
  });
  if (error) {
    toast(error.message && error.message.includes('backdate')
      ? "Can't plan for a day that's already passed"
      : 'Could not save — check your connection');
    return;
  }

  if (editing) {
    daySlots[editing.day][editing.ix] = rowToSlot(data);
  } else {
    (daySlots[day] = daySlots[day] || []).push(rowToSlot(data));
    curAct.uses++;                                 /* usage count drives chip order */
    store('cb_acts', acts);
    bumpTotals(curAct.n, curAct.c);
  }
  hideComposer();
  $('#c-note').value = '';
  saveStats();
  drawWeek(); drawSlots(); drawChips(); drawTotals();
  loadSearchData();
  toast(editing
    ? 'Event updated ✓'
    : (aud === 'Only me'
        ? 'Added to your schedule (private)'
        : 'Posted — friends can now join or suggest a time inside your range'));
}

/* ---------- SCHD: smart recommendations (v0 — 3 hardcoded rules) ----------
   Real version needs a muscle-group/intensity model per activity (see notes). */
function slotTags(s){
  const txt = (s.act + ' ' + s.note).toLowerCase();
  return {
    legs:  /leg|squat|lunge/.test(txt),
    back:  /back|pull|deadlift|row|lat/.test(txt),
    run:   s.act === 'Run',
    swim:  s.act === 'Swim',
    hard:  ['Gym','Run','Swim'].includes(s.act),
    event: s.event || /game|match|tournament|race|meet|final|tryout/.test(txt),
  };
}
/* map a free-text note to sub-group tags when none were picked at plan time */
const TAG_HINTS = [
  [/leg|squat|lunge/i, 'Gym', 'Legs'], [/chest|bench/i, 'Gym', 'Chest'],
  [/back|pull|row|lat|deadlift/i, 'Gym', 'Back'], [/arm|bicep|tricep|curl/i, 'Gym', 'Arms'],
  [/shoulder|delt/i, 'Gym', 'Shoulders'], [/core|abs/i, 'Gym', 'Core'],
  [/sprint/i, 'Run', 'Sprint'], [/tempo/i, 'Run', 'Tempo'], [/long|5k|10k|easy/i, 'Run', 'Long'],
  [/sprint/i, 'Swim', 'Sprint'], [/lap|distance|400|800/i, 'Swim', 'Distance'], [/technique|drill/i, 'Swim', 'Technique'],
  [/review/i, 'Study', 'Review'], [/group/i, 'Study', 'Group'], [/deep|exam|bio|math|chem/i, 'Study', 'Deep work'],
];
function inferTags(act, note){
  const tags = TAG_HINTS.filter(([re, a]) => a === act && re.test(note)).map(([,,t]) => t);
  return [...new Set(tags)];
}

function dayName(ix){
  if (ix === TODAY_IX) return 'today';
  if (ix === TODAY_IX + 1) return 'tomorrow';
  return dayDate(ix).toLocaleDateString('en-US', { weekday:'long' });
}

function drawRecs(){
  const recs = [];
  const horizon = Math.max(weeksShown * 7, 14);
  /* big-event awareness: protect the 2 days before anything tagged as an event */
  for (let eo = 0; eo < horizon; eo++) {
    const e = TODAY_IX + eo;
    const ev = (daySlots[e] || []).find(s => slotTags(s).event);
    if (!ev) continue;
    const evName = ev.note.split('—')[0].trim() || ev.act;
    for (let i = Math.max(TODAY_IX, e - 2); i < e; i++) {
      if ((daySlots[i] || []).some(s => slotTags(s).legs && !s.done)) {
        recs.push({ ic:'⚠️', t:`${evName} ${dayName(e)} — keep legs fresh`,
          body:`You have ${evName.toLowerCase()} ${dayName(e)} and heavy leg work planned ${dayName(i)}. Go light or skip legs entirely so you're fresh for it.` });
      } else if ((daySlots[i] || []).some(s => slotTags(s).hard && !s.done)) {
        recs.push({ ic:'⚠️', t:`${evName} ${dayName(e)} — ease up ${dayName(i)}`,
          body:`Intense session planned ${dayName(i)}, right before ${evName.toLowerCase()} ${dayName(e)}. Consider a lighter version.` });
      }
    }
  }
  for (let io = 0; io < horizon; io++) {
    const i = TODAY_IX + io;
    const today = (daySlots[i] || []).map(slotTags);
    const next  = (daySlots[i + 1] || []).map(slotTags);
    if (today.some(t => t.legs) && next.some(t => t.run)) {
      recs.push({ ic:'🦵', t:`Legs ${dayName(i)} + run ${dayName(i + 1)}`,
        body:`Keep the run easy, or swap the order so your legs get recovery time.` });
    }
    if (today.some(t => t.back) && next.some(t => t.swim)) {
      recs.push({ ic:'🏊', t:`Back day next to your swim`,
        body:`Back workout ${dayName(i)}, swim ${dayName(i + 1)} — lats and shoulders overlap. Make the swim technique-focused or space them out.` });
    }
  }
  let streak = 0;
  for (let io = 0; io < horizon; io++) {
    const i = TODAY_IX + io;
    if ((daySlots[i] || []).some(s => slotTags(s).hard)) {
      streak++;
      if (streak === 3) recs.push({ ic:'😮‍💨', t:'Three intense days in a row',
        body:`Your streak ends ${dayName(i)} — consider making one day lighter or adding a rest day.` });
    } else streak = 0;
  }
  /* same-day overload: 3+ separate hard activities stacked on one day */
  for (let io = 0; io < horizon; io++) {
    const i = TODAY_IX + io;
    const hardActs = [...new Set((daySlots[i] || []).filter(s => slotTags(s).hard).map(s => s.act))];
    if (hardActs.length >= 3) {
      recs.push({ ic:'🥵', t:`${hardActs.join(' + ')} all on ${dayName(i)}`,
        body:`That's ${hardActs.length} intense activities the same day — nothing's stopping you, but that's a lot of load at once. Worth spacing at least one out, or scaling back intensity on the others.` });
    }
  }
  /* habitual-activity gap: something you usually do a lot is missing from your whole visible window */
  sortedActs().filter(a => a.uses >= 5).forEach(a => {
    const scheduled = Array.from({ length: horizon }, (_, io) => daySlots[TODAY_IX + io] || []).flat().some(s => s.act === a.n);
    if (!scheduled) {
      recs.push({ ic:'🫥', t:`No ${a.n} on your calendar right now`,
        body:`You've logged ${a.n} ${a.uses} times before — it's usually a regular thing for you, but it's not scheduled anywhere in the next ${horizon} days. Might be intentional, might not be — worth a check.` });
    }
  });
  const box = $('#recs');
  box.innerHTML = recs.length
    ? recs.map(r =>
        `<div class="rec" onclick="this.classList.toggle('open')"><span class="ic">${r.ic}</span>` +
        `<span class="tt">${r.t}</span><span class="chev">▾</span>` +
        `<div class="body sub">${r.body}</div></div>`).join('')
    : '<div class="sub">Nothing to flag — these recs are generated from your own schedule and goals, and right now the spacing looks good 👌</div>';
}

/* ---------- FRDS: add friend ---------- */
function toggleAddFriend(){ showPanel('friends'); $('#fsearch').focus(); }
function sendFriendReq(){
  const n = $('#af-name').value.trim();
  if (!n) { toast('Type a name or @handle first'); return; }
  $('#af-name').value = '';
  $('#addfriend').classList.remove('show');
  toast(`Friend request sent to ${n} — they appear in your feed once they accept 🤝`);
}

/* ---------- FRDS feed ---------- */
/* main = the activity (big, bold, colored); sub = the specifics underneath */
const feed = [
  { who:'Maya', ini:'M', when:'20 min ago · Gym crew', kind:'range', c:'var(--gym)',
    main:'Gym', label:'PLAN', txt:'Tonight — anyone in?', from:'6 PM', to:'10 PM', joins:1 },
  { who:'Dev',  ini:'D', when:'1 h ago · Study group', kind:'ask', c:'var(--study)',
    main:'Study', label:'ASK', txt:'Anyone have notes for BIO120 lecture 8? Missed it 😭', replies:2 },
  { who:'Sam',  ini:'S', when:'3 h ago · Everyone', kind:'goal', c:'var(--gym)',
    main:'Gym', label:'NEW GOAL', txt:'Bench 185 lb by Sept 🎯', enc:4 },
  { who:'Lena', ini:'L', when:'Yesterday · Close friends', kind:'done', c:'var(--run)',
    main:'Run', label:'PR · GOAL COMPLETE', txt:'5k in 23:58 🏁', congrats:9 },
  { who:'Maya', ini:'M', when:'Yesterday · Everyone', kind:'invite', c:'var(--pink)',
    main:'Hangout', label:'OPEN INVITE', txt:'New café on Bayview — anyone wanna try it Sat around 2?', ins:2 },
];

function drawFeed(){
  const box = $('#feed');
  box.innerHTML = '';
  feed.forEach((p, ix) => {
    const el = document.createElement('div');
    el.className = 'card post';
    el.style.setProperty('--c', p.c);
    let body =
      `<div class="head"><div class="avatar">${p.ini}</div>` +
      `<div><div class="who">${p.who}</div><div class="when">${p.when}</div></div>` +
      `<span class="actbadge">${p.main}</span></div>` +
      `<div class="kind">${p.label}</div><div class="subact">${p.txt}</div>`;

    if (p.kind === 'range') {
      body +=
        `<div class="rangebar" style="--c:${p.c}"><span class="mono">${p.from}</span>` +
        `<div class="track"><i style="left:0;right:0"></i></div><span class="mono">${p.to}</span></div>` +
        `<div class="actions">` +
        `<button class="btn small primary" onclick="joinPlan(${ix}, this)">🙋 Request to join · <span class="count">${p.joins}</span></button>` +
        `<button class="btn small" onclick="toggleReply(this)">⇄ Suggest a time</button></div>` +
        `<div class="replybox"><div class="sub" style="margin-bottom:6px">Only needs to overlap with ${p.who}'s ${p.from}–${p.to} — going longer on your end is fine, you two can sort out the rest by message.</div>` +
        `<div class="row"><select class="rf"><option value="17">5 PM</option><option value="18">6 PM</option><option value="19">7 PM</option><option value="20" selected>8 PM</option><option value="21">9 PM</option></select>` +
        `<span class="sub">to</span><select class="rt"><option value="19">7 PM</option><option value="20">8 PM</option><option value="21" selected>9 PM</option><option value="22">10 PM</option><option value="23">11 PM</option></select>` +
        `<input placeholder="e.g. chest & triceps" style="flex:1;min-width:120px"></div>` +
        `<button class="btn small primary" onclick="suggestTime(this, '${p.who}')">Send suggestion</button></div>`;
    }
    if (p.kind === 'ask') {
      body +=
        `<div class="actions"><button class="btn small" onclick="toggleReply(this)">💬 Answer · <span class="count">${p.replies}</span></button></div>` +
        `<div class="replybox"><div class="row"><input placeholder="I got you — sending after class" style="flex:1">` +
        `<button class="btn small primary" onclick="sendReply(this)">Reply</button></div></div>`;
    }
    if (p.kind === 'goal') {
      body +=
        `<div class="actions">` +
        `<button class="reaction" onclick="fireOnce(this, 'Encouragement sent ✓ — one tap, LinkedIn style')">👏 Encourage · <span class="count">${p.enc}</span></button>` +
        `<button class="btn small" onclick="toast('Joined! This goal now shows in your GLPR with a shared-progress tag 🤝')">🤝 Join this goal</button></div>`;
    }
    if (p.kind === 'done') {
      body +=
        `<div class="actions">` +
        `<button class="reaction" onclick="fireOnce(this, 'Congrats sent 🎉')">🎉 Congrats · <span class="count">${p.congrats}</span></button></div>`;
    }
    if (p.kind === 'invite') {
      body +=
        `<div class="actions">` +
        `<button class="reaction" onclick="fireOnce(this, &quot;You're in — it lands on your Schedule for Sat ☕&quot;)">☕ I'm in · <span class="count">${p.ins}</span></button>` +
        `<button class="btn small" onclick="toast('Suggested a different time — ${p.who} will see it on their post')">⇄ Suggest time</button></div>`;
    }
    el.innerHTML = body;
    box.appendChild(el);
  });
}

function toggleReply(btn){ btn.closest('.card').querySelector('.replybox').classList.toggle('show'); }

/* ---------- real feed: what friends have actually posted to SCHD ---------- */
/* shared by the FRIENDS feed and SEARCH -> Activity so a plan card looks
   and behaves identically everywhere it shows up */
function renderFeedCard(p, opts){
  opts = opts || {};
  const isOwn = opts.isOwn || false;
  const initials = (p.owner_display || p.owner).trim()[0].toUpperCase();
  const when = dayName(p.day_index);
  let actions;
  if (p.cancelled) {
    actions = `<div class="cancelled-banner">🚫 Event cancelled — no longer joinable</div>`;
  } else if (isOwn) {
    actions = `<div class="actions"><button class="btn small" onclick="openEventChat('${p.id}','${escJS(p.act)}')">💬 Open event chat</button></div>`;
  } else if (p.my_join_status === 'accepted') {
    actions = `<div class="actions"><button class="btn small primary" onclick="openEventChat('${p.id}','${escJS(p.act)}')">💬 Open event chat</button></div>`;
  } else if (p.my_join_status === 'pending') {
    actions = `<div class="actions"><button class="btn small" disabled>🙋 Requested — waiting for approval</button></div>`;
  } else {
    actions = `<div class="actions"><button class="btn small primary" onclick="requestJoinPlan('${p.id}', this)">🙋 Request to join · <span class="count">${p.join_count}</span></button></div>`;
  }
  return `<div class="card post" style="--c:${p.color}">` +
    `<div class="head"><div class="avatar">${p.owner_avatar || initials}</div>` +
    `<div><div class="who">${isOwn ? 'You' : p.owner_display}</div><div class="when">${when}</div></div>` +
    `<span class="actbadge">${p.act}</span></div>` +
    `<div class="kind">${p.cancelled ? 'CANCELLED' : (p.is_range ? 'PLAN' : 'ASK')}</div>` +
    `<div class="subact">${p.note}${p.edited && !p.cancelled ? ' (edited)' : ''}${p.is_range ? ' · <span class="mono">' + p.time_label + '</span>' : ''}</div>` +
    actions +
    `</div>`;
}

let feedFilterMode = 'all';         /* 'all' | 'schedule' | 'plannit' | 'milestone' */
let friendsFeedCache = [];

async function loadFriendsFeed(){
  if (!me) return;
  const who = me.username;
  const [feedRes, plannitRes] = await Promise.all([
    sb.rpc('list_friends_feed', { p_me: who }),
    sb.rpc('list_my_plannit_events', { p_me: who }),
  ]);
  if (!me || me.username !== who) return;   /* a different account signed in while this was in flight */
  const rows = [];
  (feedRes.data || []).forEach(p => rows.push({ kind:'schedule', day: p.day_index, html: renderFeedCard(p) }));
  (plannitRes.data || []).forEach(pe => rows.push({ kind:'plannit', day: pe.start_day, html: renderPlannitCard(pe) }));
  rows.sort((a, b) => b.day - a.day);
  friendsFeedCache = rows;
  drawFriendsFeed();
}

function drawFriendsFeed(){
  const box = $('#realfeed');
  if (feedFilterMode === 'milestone') { box.innerHTML = ''; $('#feed').style.display = ''; return; }
  $('#feed').style.display = feedFilterMode === 'all' ? '' : 'none';
  const items = feedFilterMode === 'all' ? friendsFeedCache : friendsFeedCache.filter(r => r.kind === feedFilterMode);
  box.innerHTML = items.length ? items.map(r => r.html).join('') : (feedFilterMode === 'all' ? '' : '<div class="sub">Nothing to show yet.</div>');
}
$('#feed-filter').addEventListener('click', e => {
  const b = e.target.closest('button');
  if (!b) return;
  feedFilterMode = b.dataset.f;
  $$('#feed-filter button').forEach(x => x.classList.toggle('on', x === b));
  drawFriendsFeed();
});

async function requestJoinPlan(planId, btn){
  btn.disabled = true;
  const { data, error } = await sb.rpc('request_join_plan', { p_me: me.username, p_plan_id: planId });
  if (error || !data.ok) {
    btn.disabled = false;
    const errs = { cancelled:'This plan was cancelled', blocked:'Could not send the request',
      already_joined:"You're already in this event", already_requested:'Already requested — waiting on them' };
    toast((data && errs[data.error]) || 'Could not send the request — try again');
    return;
  }
  btn.outerHTML = '<button class="btn small" disabled>🙋 Requested — waiting for approval</button>';
  toast('Request sent — they\'ll see it in Messages 🙌');
}

/* ---------- messages: DM threads + event group chats ---------- */
let msgMode = 'dm';                 /* 'dm' | 'events' — which list the Messages sheet shows */
let activeChat = null;              /* {type:'dm', other, otherDisplay} or {type:'event', planId, title} */

function openMessages(){
  if (!me) return;
  msgMode = 'dm';
  $$('#msg-seg button').forEach(b => b.classList.toggle('on', b.dataset.m === 'dm'));
  openSheet('messages');
  drawMessagesList();
  markMessagesRead();
  startMsgListPoll();
}
$('#msg-seg').addEventListener('click', e => {
  const b = e.target.closest('button');
  if (!b) return;
  msgMode = b.dataset.m;
  $$('#msg-seg button').forEach(x => x.classList.toggle('on', x === b));
  drawMessagesList();
});

async function drawMessagesList(silent){
  const box = $('#msg-list');
  if (!silent) box.innerHTML = '<div class="sub">Loading…</div>';
  const who = me.username;
  const mode = msgMode;
  let html;
  if (mode === 'dm') {
    const { data, error } = await sb.rpc('list_dm_threads', { p_me: who });
    if (!me || me.username !== who || mode !== msgMode) return;
    if (error) { if (!silent) box.innerHTML = '<div class="sub">Could not load — check your connection.</div>'; return; }
    if (!data.length) { html = '<div class="sub">No messages yet — message a friend from the FRIENDS tab.</div>'; }
    else html = data.map(t => {
      let preview;
      if (t.last_kind === 'join_request') {
        preview = t.last_request_status === 'pending'
          ? (t.last_sender === who ? '🙋 Join request sent — waiting' : '🙋 Wants to join your event')
          : `🙋 Join request — ${t.last_request_status}`;
      } else {
        preview = (t.last_sender === who ? 'You: ' : '') + escHTML(t.last_body);
      }
      return `<div class="frow" style="cursor:pointer" onclick="openDMChat('${t.other}','${escJS(t.other_display)}')">` +
        `<span class="fav2">${t.other_avatar}</span>` +
        `<div class="g"><div class="dn">${t.other_display}</div><div class="un">${preview}</div></div></div>`;
    }).join('');
  } else if (mode === 'events') {
    const { data, error } = await sb.rpc('list_my_event_chats', { p_me: who });
    if (!me || me.username !== who || mode !== msgMode) return;
    if (error) { if (!silent) box.innerHTML = '<div class="sub">Could not load — check your connection.</div>'; return; }
    if (!data.length) { html = '<div class="sub">No event chats yet — post or join an event to start one.</div>'; }
    else html = data.map(c => {
      const preview = c.last_body ? escHTML(c.last_body) : 'No messages yet';
      return `<div class="frow" style="cursor:pointer" onclick="openEventChat('${c.plan_id}','${escJS(c.title)}')">` +
        `<span class="fav2">${c.owner === who ? '👑' : '💬'}</span>` +
        `<div class="g"><div class="dn">${c.title}${c.cancelled ? ' (cancelled)' : ''}</div><div class="un">${preview}</div></div></div>`;
    }).join('');
  } else {
    const { data, error } = await sb.rpc('list_my_plannit_events', { p_me: who });
    if (!me || me.username !== who || mode !== msgMode) return;
    if (error) { if (!silent) box.innerHTML = '<div class="sub">Could not load — check your connection.</div>'; return; }
    if (!data.length) { html = '<div class="sub">No plans yet — start one from the PLANNIT tab.</div>'; }
    else html = data.map(e => {
      const preview = e.cancelled ? '🚫 Cancelled' : (e.last_body ? escHTML(e.last_body) : 'No messages yet');
      return `<div class="frow" style="cursor:pointer" onclick="openPlannitChat('${e.id}','${escJS(e.name)}')">` +
        `<span class="fav2">${e.owner === who ? '👑' : '🗓️'}</span>` +
        `<div class="g"><div class="dn">${escHTML(e.name)}</div><div class="un">${preview}</div></div></div>`;
    }).join('');
  }
  if (box.innerHTML !== html) box.innerHTML = html;
}

let msgListPollTimer = null;
function startMsgListPoll(){
  stopMsgListPoll();
  msgListPollTimer = setInterval(() => { if ($('#sheet-messages').classList.contains('show')) drawMessagesList(true); }, 4000);
}
function stopMsgListPoll(){ if (msgListPollTimer) clearInterval(msgListPollTimer); msgListPollTimer = null; }

async function openDMChat(other, otherDisplay){
  activeChat = { type:'dm', other, otherDisplay };
  $('#chat-title').textContent = otherDisplay || ('@' + other);
  $('#chat-members-btn').style.display = 'none';
  openSheet('chat');
  await drawChatMessages();
  markMessagesRead();
  startChatPoll();
}

async function openEventChat(planId, title){
  activeChat = { type:'event', planId, title };
  $('#chat-title').textContent = title;
  $('#chat-members-btn').style.display = 'inline-flex';
  openSheet('chat');
  await drawChatMessages();
  markMessagesRead();
  startChatPoll();
}

async function openPlannitChat(eventId, title){
  activeChat = { type:'plannit', eventId, title };
  $('#chat-title').textContent = title;
  $('#chat-members-btn').style.display = 'none';
  openSheet('chat');
  await drawChatMessages();
  markMessagesRead();
  startChatPoll();
}

function closeChatSheet(){
  stopChatPoll();
  $('#sheet-chat').classList.remove('show');
  activeChat = null;
  if ($('#sheet-messages').classList.contains('show')) drawMessagesList();
  else $('#scrim').classList.remove('show');
}

async function drawChatMessages(silent){
  if (!activeChat) return;
  const chat = activeChat;
  const box = $('#chat-messages');
  if (!silent) box.innerHTML = '<div class="sub">Loading…</div>';
  const wasAtBottom = box.scrollTop + box.clientHeight >= box.scrollHeight - 40;
  let html;
  if (chat.type === 'dm') {
    const { data, error } = await sb.rpc('list_dm_messages', { p_me: me.username, p_other: chat.other });
    if (activeChat !== chat) return;
    if (error) { if (!silent) box.innerHTML = '<div class="sub">Could not load.</div>'; return; }
    html = data.map(renderDMBubble).join('') || '<div class="sub">Say hi 👋</div>';
  } else if (chat.type === 'plannit') {
    const { data, error } = await sb.rpc('list_plannit_messages', { p_me: me.username, p_event_id: chat.eventId });
    if (activeChat !== chat) return;
    if (error) { if (!silent) box.innerHTML = '<div class="sub">Could not load.</div>'; return; }
    html = data.map(renderEventBubble).join('') || '<div class="sub">No messages yet — say hi 👋</div>';
  } else {
    const { data, error } = await sb.rpc('list_event_messages', { p_me: me.username, p_plan_id: chat.planId });
    if (activeChat !== chat) return;
    if (error) { if (!silent) box.innerHTML = '<div class="sub">Could not load.</div>'; return; }
    html = data.map(renderEventBubble).join('') || '<div class="sub">No messages yet — say hi 👋</div>';
  }
  if (box.innerHTML === html) return;
  box.innerHTML = html;
  if (!silent || wasAtBottom) box.scrollTop = box.scrollHeight;
}

let chatPollTimer = null;
function startChatPoll(){
  stopChatPoll();
  chatPollTimer = setInterval(() => {
    if (!activeChat || !$('#sheet-chat').classList.contains('show')) return;
    drawChatMessages(true);
    markMessagesRead();
  }, 3000);
}
function stopChatPoll(){ if (chatPollTimer) clearInterval(chatPollTimer); chatPollTimer = null; }

function renderDMBubble(m){
  const mine = m.sender === me.username;
  if (m.kind === 'join_request') {
    let statusLine;
    if (m.request_status === 'pending' && !mine) {
      statusLine = `<div class="reqbtns">` +
        `<button class="btn small primary" onclick="respondJoinRequest('${m.id}', true)">Yes</button>` +
        `<button class="btn small danger" onclick="respondJoinRequest('${m.id}', false)">No</button></div>`;
    } else if (m.request_status === 'pending' && mine) {
      statusLine = `<div class="status">Waiting for approval…</div>`;
    } else {
      statusLine = `<div class="status">${m.request_status === 'accepted' ? '✅ Accepted' : '❌ Declined'}</div>`;
    }
    return `<div class="msgrow ${mine ? 'mine' : 'theirs'}"><div class="bubble">🙋 ${escHTML(m.body)}${statusLine}</div></div>`;
  }
  if (m.kind === 'plannit_invite') {
    let statusLine;
    if (m.request_status === 'pending' && !mine) {
      statusLine = `<div class="reqbtns">` +
        `<button class="btn small primary" onclick="respondPlannitInvite('${m.id}', true)">Yes</button>` +
        `<button class="btn small danger" onclick="respondPlannitInvite('${m.id}', false)">No</button></div>`;
    } else if (m.request_status === 'pending' && mine) {
      statusLine = `<div class="status">Waiting for response…</div>`;
    } else {
      statusLine = `<div class="status">${m.request_status === 'accepted' ? '✅ Joined' : '❌ Declined'}</div>`;
    }
    return `<div class="msgrow ${mine ? 'mine' : 'theirs'}"><div class="bubble">🗓️ ${escHTML(m.body)}${statusLine}</div></div>`;
  }
  return `<div class="msgrow ${mine ? 'mine' : 'theirs'}"><div class="bubble">${escHTML(m.body)}</div></div>`;
}

function renderEventBubble(m){
  const mine = m.sender === me.username;
  return `<div class="msgrow ${mine ? 'mine' : 'theirs'}"><div class="bubble">` +
    (mine ? '' : `<div class="who">${m.sender_avatar} ${escHTML(m.sender_display)}</div>`) +
    `${escHTML(m.body)}</div></div>`;
}

async function sendChatMessage(){
  const input = $('#chat-input');
  const body = input.value.trim();
  if (!body || !activeChat) return;
  const chat = activeChat;
  input.value = '';
  const res = chat.type === 'dm'
    ? await sb.rpc('send_dm', { p_me: me.username, p_to: chat.other, p_body: body })
    : chat.type === 'plannit'
    ? await sb.rpc('send_plannit_message', { p_me: me.username, p_event_id: chat.eventId, p_body: body })
    : await sb.rpc('send_event_message', { p_me: me.username, p_plan_id: chat.planId, p_body: body });
  if (activeChat !== chat) return;
  if (res.error || !res.data || !res.data.ok) {
    const errs = { not_friends:'You can only message friends', blocked:'Could not send — blocked', not_member:'You\'re no longer in this event chat' };
    toast((res.data && errs[res.data.error]) || 'Could not send — try again');
    input.value = body;
    return;
  }
  await drawChatMessages();
}
$('#chat-input').addEventListener('keydown', e => { if (e.key === 'Enter') sendChatMessage(); });

async function respondJoinRequest(messageId, accept){
  const { data, error } = await sb.rpc('respond_join_request', { p_me: me.username, p_message_id: messageId, p_accept: accept });
  if (error || !data.ok) { toast('Could not respond — try again'); return; }
  toast(accept ? 'Accepted into the event ✓' : 'Declined');
  await drawChatMessages();
  drawMessagesList();
  pollMsgBadge();
  loadFriendsFeed();
}

async function respondPlannitInvite(messageId, accept){
  const { data, error } = await sb.rpc('respond_plannit_invite', { p_me: me.username, p_message_id: messageId, p_accept: accept });
  if (error || !data.ok) { toast('Could not respond — try again'); return; }
  toast(accept ? 'Joined the plan ✓' : 'Declined');
  await drawChatMessages();
  drawMessagesList();
  pollMsgBadge();
  loadPlannitFeed();
}

async function openChatMembers(){
  if (!activeChat || activeChat.type !== 'event') return;
  const chat = activeChat;
  openSheet('chatmembers');
  const box = $('#chatmembers-list');
  box.innerHTML = '<div class="sub">Loading…</div>';
  const { data, error } = await sb.rpc('list_event_members', { p_me: me.username, p_plan_id: chat.planId });
  if (activeChat !== chat) return;
  if (error) { box.innerHTML = '<div class="sub">Could not load.</div>'; return; }
  const iAmOwner = data.some(mem => mem.is_owner && mem.username === me.username);
  $('#leave-chat-btn').style.display = iAmOwner ? 'none' : 'flex';
  const others = data.filter(mem => mem.username !== me.username);
  box.innerHTML = others.length ? others.map(mem => {
    const blockBtn = mem.blocked_by_me
      ? `<button class="btn small" onclick="unblockFromChat('${mem.username}')">Unblock</button>`
      : `<button class="btn small danger" onclick="blockFromChat('${mem.username}')">Block</button>`;
    return `<div class="frow"><span class="fav2">${mem.avatar}</span>` +
      `<div class="g"><div class="dn">${mem.display_name}${mem.is_owner ? ' 👑' : ''}</div><div class="un">@${mem.username}${mem.blocked_by_me ? ' · blocked' : ''}</div></div>${blockBtn}</div>`;
  }).join('') : '<div class="sub">Just you in here so far.</div>';
}

async function blockFromChat(u){
  if (!confirm(`Block @${u}? You won't see their messages anywhere, in this chat or in DMs.`)) return;
  await sb.rpc('block_user', { p_me: me.username, p_target: u });
  openChatMembers();
  drawChatMessages();
}
async function unblockFromChat(u){
  await sb.rpc('unblock_user', { p_me: me.username, p_target: u });
  openChatMembers();
  drawChatMessages();
}

async function leaveCurrentEventChat(){
  if (!activeChat || activeChat.type !== 'event') return;
  if (!confirm('Leave this event chat? Your join will be removed and you\'ll stop seeing its messages.')) return;
  const { data, error } = await sb.rpc('leave_event_chat', { p_me: me.username, p_plan_id: activeChat.planId });
  if (error || !data.ok) { toast('Could not leave — try again'); return; }
  stopChatPoll();
  closeSheets();
  activeChat = null;
  toast('Left the event chat');
  loadFriendsFeed();
  drawMessagesList();
}

/* ---------- messages: red-circle badge, mirrors the FRIENDS request badge ---------- */
function paintMsgBadge(n){
  const b = $('#msg-badge');
  if (n > 0) { b.textContent = n > 9 ? '9+' : n; b.hidden = false; }
  else b.hidden = true;
}
let msgBadgeTimer = null;
function notifPref(){ return load('cb_notifpref', 'all'); }
$('#notif-pref').addEventListener('click', e => {
  const b = e.target.closest('button');
  if (!b) return;
  store('cb_notifpref', b.dataset.v);
  pollMsgBadge();
});

async function pollMsgBadge(){
  if (!me) return;
  const who = me.username;
  const rpcName = notifPref() === 'requests' ? 'count_pending_join_requests' : 'count_unread_messages';
  const { data, error } = await sb.rpc(rpcName, { p_me: who });
  if (!error && me && me.username === who) paintMsgBadge(data || 0);
}
function startMsgBadgePoll(){
  stopMsgBadgePoll();
  pollMsgBadge();
  msgBadgeTimer = setInterval(pollMsgBadge, 25000);
}
function stopMsgBadgePoll(){ if (msgBadgeTimer) clearInterval(msgBadgeTimer); msgBadgeTimer = null; }

async function markMessagesRead(){
  if (!me) return;
  await sb.rpc('mark_messages_read', { p_me: me.username });
  pollMsgBadge();
}

function joinPlan(ix, btn){
  if (btn.dataset.sent) { toast('Request already sent — waiting on ' + feed[ix].who); return; }
  btn.dataset.sent = '1';
  feed[ix].joins++;
  btn.querySelector('.count').textContent = feed[ix].joins;
  toast('Request sent — ' + feed[ix].who + ' gets a one-tap accept 🙌');
}

function suggestTime(btn, who){
  const box = btn.closest('.replybox');
  const f = +box.querySelector('.rf').value, t = +box.querySelector('.rt').value;
  if (t <= f) { toast('End time has to be after start'); return; }
  const note = box.querySelector('input').value.trim();
  box.classList.remove('show');
  const chip = document.createElement('div');
  chip.className = 'notechip';
  chip.textContent = `You proposed ${fmtT(f)}–${fmtT(t)}${note ? ' · ' + note : ''} ✓`;
  btn.closest('.card').appendChild(chip);
  toast(`Sent — message ${who} to lock in whatever overlap works for both of you`);
}

function sendReply(btn){ btn.closest('.replybox').classList.remove('show'); toast('Reply posted 💬'); }

/* one-shot reaction buttons (encourage / congrats / I'm in) */
function fireOnce(btn, msg){
  if (btn.classList.contains('fired')) return;
  btn.classList.add('fired');
  const c = btn.querySelector('.count');
  c.textContent = +c.textContent + 1;
  toast(msg);
}

/* ---------- GLPR: all-time totals (month / year / ever) ---------- */
const totals = {
  Gym:   { c:'var(--gym)',   month:9,  year:64,  ever:180 },
  Run:   { c:'var(--run)',   month:6,  year:41,  ever:97  },
  Study: { c:'var(--study)', month:11, year:88,  ever:203 },
  Swim:  { c:'var(--swim)',  month:3,  year:22,  ever:45  },
};
function bumpTotals(name, color){
  if (!totals[name]) totals[name] = { c:color, month:0, year:0, ever:0 };
  totals[name].month++; totals[name].year++; totals[name].ever++;
}
function drawTotals(){
  const box = $('#totals');
  box.innerHTML = Object.entries(totals)
    .sort((a, b) => b[1].ever - a[1].ever)
    .map(([n, t]) =>
      `<div class="statrow"><span class="swatch" style="--c:${t.c}"></span><span class="n">${n}</span>` +
      `<span class="v"><b>${t.month}</b> this month · <b>${t.year}</b> this year · <b>${t.ever}</b> all-time</span></div>`
    ).join('');
}

/* ---------- GLPR: weekly consistency + charts ---------- */
const freq = {
  weeks: ['W1','W2','W3','W4'],
  series: [
    { n:'Gym',   c:'var(--gym)',   v:[2,3,3,4] },
    { n:'Run',   c:'var(--run)',   v:[1,2,2,3] },
    { n:'Study', c:'var(--study)', v:[3,2,4,4] },
  ],
};

function drawFreq(){
  const box = $('#freqchart');
  box.innerHTML = '';
  const max = 5;
  freq.weeks.forEach((w, wi) => {
    const col = document.createElement('div');
    col.className = 'col';
    const grp = document.createElement('div');
    grp.className = 'grp';
    freq.series.forEach(s => {
      const b = document.createElement('div');
      b.className = 'bar';
      b.style.setProperty('--c', s.c);
      b.style.height = (s.v[wi] / max * 100) + '%';
      b.style.width = '12px';
      b.title = `${s.n}: ${s.v[wi]} sessions`;
      grp.appendChild(b);
    });
    col.appendChild(grp);
    col.insertAdjacentHTML('beforeend', `<div class="l">${w}</div>`);
    box.appendChild(col);
  });
  $('#freqlegend').innerHTML = freq.series
    .map(s => `<span><i style="background:${s.c}"></i>${s.n}</span>`).join('');
}

/* ---------- universal workout logger ----------
   One log → weekly chart + all-time stats + matching performance cards. */
/* optional specifics per activity — shown one block per selected sub-section */
const SPEC_FIELDS = {
  Gym:   [['ex','Exercise','bench, squat…'], ['wt','Weight (lb)','135'], ['sets','Sets','3'], ['reps','Reps','8']],
  Run:   [['dist','Distance (km)','5'], ['spr','Sprints ×','8'], ['pace','Pace / speed','5:10 /km'], ['time','Time (min)','26']],
  Swim:  [['dist','Distance (m)','400'], ['laps','Laps','16'], ['time','Time (min)','8.5'], ['stroke','Stroke','free']],
  Study: [['subj','Subject','BIO120'], ['time','Duration (min)','90'], ['scope','Pages / topics','ch. 8']],
};
const LOG_DETAILS = {
  Gym:   ['Chest','Back','Arms','Shoulders','Legs','Core'],
  Run:   ['Sprint','Tempo','Long'],
  Swim:  ['Sprint','Distance','Technique'],
  Study: ['Deep work','Review','Group'],
};
let logAct = 'Gym';
let logSel = [];
const logbook = [
  { act:'Gym', c:'var(--gym)', tags:['Legs'], when:'Yesterday' },
  { act:'Run', c:'var(--run)', tags:['Tempo'], when:'Wed' },
];

function drawLogger(){
  const ar = $('#log-acts');
  ar.innerHTML = '';
  sortedActs().forEach(a => {
    const b = document.createElement('button');
    b.textContent = a.n;
    b.style.setProperty('--c', a.c);
    b.classList.toggle('on', a.n === logAct);
    b.onclick = () => { logAct = a.n; logSel = []; drawLogger(); };
    ar.appendChild(b);
  });
  const dr = $('#log-details');
  dr.innerHTML = '';
  const cur = acts.find(a => a.n === logAct);
  (LOG_DETAILS[logAct] || ['Session']).forEach(d => {
    const b = document.createElement('button');
    b.textContent = d;
    b.style.setProperty('--c', cur ? cur.c : 'var(--other)');
    b.classList.toggle('on', logSel.includes(d));
    b.onclick = () => {
      logSel = logSel.includes(d) ? logSel.filter(x => x !== d) : [...logSel, d];
      drawLogger();
    };
    dr.appendChild(b);
  });
  drawSpecs();
  drawLogbook();
}

function drawSpecs(){
  const box = $('#log-specs');
  const cur = acts.find(a => a.n === logAct);
  const fields = SPEC_FIELDS[logAct] || [['note','Details','anything worth remembering']];
  /* keep whatever was already typed when re-rendering */
  const prev = {};
  box.querySelectorAll('.specblock').forEach(bl => {
    prev[bl.dataset.tag] = {};
    bl.querySelectorAll('input').forEach(i => { prev[bl.dataset.tag][i.dataset.k] = i.value; });
  });
  box.innerHTML = '';
  logSel.forEach(tag => {
    const bl = document.createElement('div');
    bl.className = 'specblock';
    bl.dataset.tag = tag;
    bl.style.setProperty('--c', cur ? cur.c : 'var(--other)');
    bl.innerHTML = `<div class="sh">${tag} <span class="opt">specifics — optional</span></div>` +
      `<div class="specfields">` +
      fields.map(([k, label, ph]) =>
        `<label>${label}<input data-k="${k}" placeholder="${ph}" value="${(prev[tag] && prev[tag][k]) || ''}"></label>`
      ).join('') + `</div>`;
    box.appendChild(bl);
  });
}

function drawLogbook(){
  $('#logbook').innerHTML = logbook.slice(0, 5).map(e =>
    `<div class="logentry"><span class="swatch" style="--c:${e.c}"></span>` +
    `<b>${e.act}</b><span class="tags">${e.tags.join(' · ')}</span>` +
    `<span class="when">${e.when}</span></div>`).join('');
}

/* fan-out core: called by the logger AND by checking off a planned slot */
function logActivity(actName, tags, sourceNote, specs){
  specs = specs || {};
  const a = acts.find(x => x.n === actName);
  const color = a ? a.c : 'var(--other)';
  const hit = ['this week','all-time stats'];
  const series = freq.series.find(x => x.n === actName);
  if (series) series.v[3] = Math.min(7, series.v[3] + 1);
  bumpTotals(actName, color);
  if (actName === 'Gym' && tags.includes('Chest')) {
    const sp = specs['Chest'] || {};
    const isBench = !sp.ex || /bench/i.test(sp.ex);
    if (isBench) {
      const reps = parseInt(sp.reps, 10);
      benchPts.push({ x: benchPts[benchPts.length - 1].x + 3,
                      y: reps > 0 ? reps : benchPts[benchPts.length - 1].y + 1 });
      drawBench();
      hit.push(reps > 0 ? `bench trend (${reps} reps logged)` : 'bench trend');
    }
  }
  if (actName === 'Swim' && (tags.includes('Distance') || tags.includes('Sprint'))) {
    swimPts.push({ x: swimPts[swimPts.length - 1].x + 4, y: Math.max(7, swimPts[swimPts.length - 1].y - 0.2) });
    drawSwim();
    hit.push('swim trend');
  }
  const tagLine = tags.length
    ? tags.map(t => specs[t] ? specText(t, specs[t]) : t)
    : [sourceNote || 'Session'];
  logbook.unshift({ act: actName, c: color, tags: tagLine, when:'Just now' });
  saveStats();
  drawFreq(); drawTotals(); drawLogbook();
  toast(`Logged ${actName}${tags.length ? ' · ' + tags.join(', ') : ''} → ${hit.join(' + ')} ✓`);
}

function collectSpecs(){
  const specs = {};
  $('#log-specs').querySelectorAll('.specblock').forEach(bl => {
    const vals = {};
    bl.querySelectorAll('input').forEach(i => { if (i.value.trim()) vals[i.dataset.k] = i.value.trim(); });
    if (Object.keys(vals).length) specs[bl.dataset.tag] = vals;
  });
  return specs;
}
function specText(tag, v){
  if (!v) return tag;
  if (logAct === 'Gym' || v.ex) {
    return `${tag}: ${[v.ex, v.wt && v.wt + ' lb', v.sets && v.reps ? v.sets + '×' + v.reps : (v.reps && v.reps + ' reps')].filter(Boolean).join(' ')}`.trim();
  }
  return `${tag}: ` + Object.values(v).join(' · ');
}

function logWorkout(){
  const specs = collectSpecs();
  logActivity(logAct, logSel, null, specs);
  logSel = [];
  drawLogger();
  const btn = document.querySelector('.logcard .btn.primary');
  const r = btn.getBoundingClientRect();
  burst(r.left + r.width / 2, r.top, 30);
}

/* ---------- goal completion: ladder fills + fireworks ---------- */
function completeGoal(btn){
  const card = btn.closest('.card');
  const next = card.querySelector('.step.next');
  if (!next) { toast('Goal already complete — set a new milestone in the wizard'); return; }
  next.classList.remove('next');
  next.classList.add('done');
  next.querySelector('.s').textContent = 'Today';
  card.classList.remove('celebrate');
  void card.offsetWidth;
  card.classList.add('celebrate');
  const r = card.getBoundingClientRect();
  fireworks(r.left + r.width / 2, r.top + r.height / 2);
  logActivity('Swim', ['Distance'], 'goal milestone');
  toast('GOAL COMPLETE — 800 m nonstop! Friends with access can congratulate you in FRDS 🎉');
}

/* ---------- canvas confetti / fireworks ---------- */
const fxc = document.getElementById('fx');
const fxx = fxc.getContext('2d');
let parts = [], fxRunning = false;
function fxResize(){ fxc.width = innerWidth; fxc.height = innerHeight; }
addEventListener('resize', fxResize); fxResize();
const FX_COLORS = ['#D2622A','#4A5BD7','#0E93A0','#9A4FBF','#1E9A55','#D9A012','#C7527E'];
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;

function burst(x, y, n){
  if (reducedMotion) return;
  for (let i = 0; i < n; i++) {
    const a = Math.random() * Math.PI * 2, sp = 2 + Math.random() * 4;
    parts.push({ x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 2,
      life: 50 + Math.random() * 30, c: FX_COLORS[i % FX_COLORS.length], s: 3 + Math.random() * 3 });
  }
  runFx();
}
function fireworks(x, y){
  if (reducedMotion) { toast('🎆'); return; }
  burst(x, y, 60);
  setTimeout(() => burst(x - 90, y - 60, 40), 200);
  setTimeout(() => burst(x + 90, y - 30, 40), 400);
  setTimeout(() => burst(x, y - 100, 50), 650);
}
function runFx(){
  if (fxRunning) return;
  fxRunning = true;
  (function tick(){
    fxx.clearRect(0, 0, fxc.width, fxc.height);
    parts = parts.filter(p => p.life > 0);
    parts.forEach(p => {
      p.x += p.vx; p.y += p.vy; p.vy += 0.12; p.vx *= 0.99; p.life--;
      fxx.globalAlpha = Math.min(1, p.life / 30);
      fxx.fillStyle = p.c;
      fxx.fillRect(p.x, p.y, p.s, p.s);
    });
    fxx.globalAlpha = 1;
    if (parts.length) requestAnimationFrame(tick);
    else { fxRunning = false; fxx.clearRect(0, 0, fxc.width, fxc.height); }
  })();
}

/* Generic SVG line chart. invert=true → lower values plot higher (times). */
function lineChart(el, pts, unit, color, invert){
  const W = 480, H = 150, P = { l:52, r:14, t:14, b:24 };
  const xs = pts.map(p => p.x), ys = pts.map(p => p.y);
  const x0 = Math.min(...xs), x1 = Math.max(...xs);
  let y0 = Math.min(...ys), y1 = Math.max(...ys);
  const pad = (y1 - y0) * 0.25 || 1;
  y0 -= pad; y1 += pad;
  const X = x => P.l + (x - x0) / (x1 - x0) * (W - P.l - P.r);
  const Y = y => invert
    ? P.t + (y - y0) / (y1 - y0) * (H - P.t - P.b)
    : H - P.b - (y - y0) / (y1 - y0) * (H - P.t - P.b);
  const d = pts.map((p, i) => (i ? 'L' : 'M') + X(p.x).toFixed(1) + ' ' + Y(p.y).toFixed(1)).join(' ');
  const last = pts[pts.length - 1];
  let svg = `<svg viewBox="0 0 ${W} ${H}" style="width:100%;height:auto" role="img" aria-label="progress chart">`;
  [y0 + pad, y1 - pad].forEach(g => {
    svg += `<line class="grid" x1="${P.l}" x2="${W - P.r}" y1="${Y(g).toFixed(1)}" y2="${Y(g).toFixed(1)}"/>` +
           `<text x="4" y="${(Y(g) + 3).toFixed(1)}">${g}${unit}</text>`;
  });
  svg += `<line class="axis" x1="${P.l}" x2="${W - P.r}" y1="${H - P.b}" y2="${H - P.b}"/>`;
  svg += `<path d="${d}" fill="none" stroke="${color}" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>`;
  pts.forEach(p => {
    svg += `<circle cx="${X(p.x).toFixed(1)}" cy="${Y(p.y).toFixed(1)}" r="4.5" fill="${color}" stroke="var(--surface)" stroke-width="2">` +
           `<title>Day ${p.x}: ${p.y}${unit}</title></circle>` +
           `<text x="${X(p.x).toFixed(1)}" y="${H - 8}" text-anchor="middle">d${p.x}</text>`;
  });
  svg += `<text x="${(X(last.x) - 8).toFixed(1)}" y="${(Y(last.y) - 9).toFixed(1)}" text-anchor="end" style="font-weight:700;fill:var(--ink)">${last.y}${unit}</text></svg>`;
  el.innerHTML = svg;
}

const benchPts = [{x:1,y:10},{x:5,y:13},{x:8,y:11},{x:12,y:16}];
const swimPts  = [{x:1,y:9},{x:6,y:8.5},{x:14,y:8}];
function drawBench(){ lineChart($('#benchchart'), benchPts, ' reps', 'var(--gym)', false); }
function drawSwim(){ lineChart($('#swimchart'), swimPts, ' min', 'var(--swim)', true); }

/* ---------- PLANNIT: group plans with a shared weekly availability grid ----------
   Feed-first: #pl-feed lists your plans (owned or accepted), a + FAB
   creates a new one (name + invite friends — each gets a Yes/No message,
   same pattern as an SCHD join request). Opening a plan shows one
   real calendar week's grid; everyone's answers overlay so you can see
   the overlap yourself — no auto "best slot" picker yet, on purpose,
   same as the earlier "overlap engine" build note. */
const PLANNIT_SLOTS = [8,10,12,14,16,18,20]; /* 2-hour blocks, 8am–8pm start times */
const ANSWER_CLASS = { none:'s0', yes:'s1', no:'s2', maybe:'s3', depends:'s4' };
const ANSWER_SYM = { none:'', yes:'✓', no:'✕', maybe:'?', depends:'◷' };

let plannitFeedCache = [];
let activePlannitEvent = null; /* {id, name, owner, start_day, range_type, cancelled} while viewing detail */
let plannitGridCache = [];     /* rows from list_plannit_grid for the open event */
let plannitCreateInvitees = new Set();
let plannitCreateRange = 'week';

/* ---- range math: how far a plan's range runs, and what grid granularity
   fits it — a year of 2-hour slots would be unusable, so longer ranges
   trade time-of-day precision for coverage: 'today'/'week' keep the 2-hour
   slot grid, 'twoweek'/'month' drop to one cell per whole day, and 'year'
   drops further to one cell per 2-week block. ---- */
function plannitRangeEnd(startDay, rangeType){ /* exclusive end epoch-day */
  if (rangeType === 'today') return startDay + 1;
  if (rangeType === 'week') return startDay + 7;
  if (rangeType === 'twoweek') return startDay + 14;
  if (rangeType === 'month') {
    const d = dayDate(startDay);
    return ixFromDate(new Date(d.getFullYear(), d.getMonth() + 1, d.getDate()));
  }
  if (rangeType === 'year') {
    const d = dayDate(startDay);
    return ixFromDate(new Date(d.getFullYear() + 1, d.getMonth(), d.getDate()));
  }
  return startDay + 7;
}
function plannitGranularity(rangeType){
  if (rangeType === 'today' || rangeType === 'week') return 'slot';
  if (rangeType === 'year') return 'biweek';
  return 'day'; /* twoweek, month */
}
function plannitUnitCount(startDay, rangeType){
  const days = plannitRangeEnd(startDay, rangeType) - startDay;
  return plannitGranularity(rangeType) === 'biweek' ? Math.ceil(days / 14) : days;
}
function plannitRangeLabel(startDay, rangeType){
  if (rangeType === 'poll') return 'Poll';
  const fmt = d => d.toLocaleDateString('en-US', { month:'short', day:'numeric' });
  const start = dayDate(startDay);
  if (rangeType === 'today') return `Today — ${fmt(start)}`;
  const end = dayDate(plannitRangeEnd(startDay, rangeType) - 1);
  if (rangeType === 'week') return `Week of ${fmt(start)}`;
  if (rangeType === 'year') return `${fmt(start)}, ${start.getFullYear()} – ${fmt(end)}, ${end.getFullYear()}`;
  return `${fmt(start)} – ${fmt(end)}`;
}

async function loadPlannitFeed(){
  if (!me) return;
  const who = me.username;
  const { data, error } = await sb.rpc('list_my_plannit_events', { p_me: who });
  if (!me || me.username !== who) return;
  const box = $('#pl-feed');
  if (error) { box.innerHTML = '<div class="card sub">Could not load — check your connection.</div>'; return; }
  plannitFeedCache = data || [];
  if (!plannitFeedCache.length) {
    box.innerHTML = '<div class="card sub">No plans yet — tap ＋ to start one with friends.</div>';
    return;
  }
  box.innerHTML = plannitFeedCache.map(e => {
    const rangeLabel = plannitRangeLabel(e.start_day, e.range_type);
    const votingTag = (e.is_tbd || e.range_type === 'poll') && !e.poll_closed ? ' · 🗳️ voting open' : '';
    const preview = e.cancelled ? '🚫 Cancelled' : (e.last_body ? escHTML(e.last_body) : `${rangeLabel} · ${e.member_count} planning${votingTag}`);
    return `<div class="card post" style="cursor:pointer" onclick="openPlannitDetailById('${e.id}')">` +
      `<div class="head"><div class="avatar">${e.owner === me.username ? '👑' : '🗓️'}</div>` +
      `<div><div class="who">${escHTML(e.name)}</div><div class="when">${e.owner === me.username ? 'You' : e.owner_display} · ${rangeLabel}</div></div></div>` +
      `<div class="subact">${preview}</div>` +
      `</div>`;
  }).join('');
}

/* ---- create ---- */
function nextMondays(n){
  const mondayToday = mondayIxOf(TODAY_IX);
  return Array.from({ length: n }, (_, i) => mondayToday + i * 7);
}
function refreshPlannitRangePreview(){
  const startDay = (plannitCreateRange === 'week' || plannitCreateRange === 'twoweek') ? +$('#pln-week').value : TODAY_IX;
  $('#pln-range-preview').textContent = plannitRangeLabel(startDay, plannitCreateRange);
}
function setPlannitCreateRange(r){
  plannitCreateRange = r;
  $$('#pln-range button').forEach(x => x.classList.toggle('on', x.dataset.r === r));
  $('#pln-week-row').style.display = (r === 'week' || r === 'twoweek') ? '' : 'none';
  refreshPlannitRangePreview();
}
$('#pln-range').addEventListener('click', e => {
  const b = e.target.closest('button');
  if (b) setPlannitCreateRange(b.dataset.r);
});
$('#pln-week').addEventListener('change', refreshPlannitRangePreview);

function openCreatePlannit(){
  if (!me) return;
  $('#pln-name').value = '';
  plannitCreateInvitees = new Set();
  const weekSel = $('#pln-week');
  weekSel.innerHTML = nextMondays(8).map((ix, i) =>
    `<option value="${ix}">${i === 0 ? 'This week' : i === 1 ? 'Next week' : 'Week of'} — ${dayDate(ix).toLocaleDateString('en-US', { month:'short', day:'numeric' })}</option>`
  ).join('');
  $('#pln-people').innerHTML = friendsCache.length
    ? friendsCache.map(f =>
        `<label class="frow" style="cursor:pointer"><span class="fav2">${f.avatar}</span>` +
        `<div class="g"><div class="dn">${escHTML(f.display_name)}</div><div class="un">@${f.username}</div></div>` +
        `<input type="checkbox" style="width:18px;height:18px" onchange="togglePlannitInvitee('${f.username}', this.checked)"></label>`
      ).join('')
    : '<div class="sub">Add some friends first — search from FRIENDS.</div>';
  setPlannitCreateRange('week');
  openSheet('newplannit');
}
function togglePlannitInvitee(u, checked){
  if (checked) plannitCreateInvitees.add(u); else plannitCreateInvitees.delete(u);
}
async function submitCreatePlannit(){
  const name = $('#pln-name').value.trim();
  if (!name) { toast('Name the plan first'); return; }
  const startDay = (plannitCreateRange === 'week' || plannitCreateRange === 'twoweek') ? +$('#pln-week').value : TODAY_IX;
  const { data, error } = await sb.rpc('create_plannit_event', {
    p_me: me.username, p_name: name, p_start_day: startDay, p_range_type: plannitCreateRange, p_is_tbd: false, p_invitees: [...plannitCreateInvitees],
  });
  if (error || !data.ok) { toast('Could not create — try again'); return; }
  closeSheets();
  await loadPlannitFeed();
  toast(plannitCreateInvitees.size ? `Created — invited ${plannitCreateInvitees.size} ✉️` : 'Created ✓');
  openPlannitDetailById(data.id);
}

/* ---- detail (grid + poll) ---- */
async function openPlannitDetailById(id){
  const ev = plannitFeedCache.find(e => e.id === id);
  activePlannitEvent = ev
    ? { id: ev.id, name: ev.name, owner: ev.owner, start_day: ev.start_day, range_type: ev.range_type,
        is_tbd: ev.is_tbd, poll_closed: ev.poll_closed, cancelled: ev.cancelled }
    : { id, name: 'Plan', owner: null, start_day: TODAY_IX, range_type: 'week', is_tbd: false, poll_closed: false, cancelled: false };
  $('#pl-feed-view').style.display = 'none';
  $('#pl-detail-view').style.display = 'block';
  $('#pl-fab').style.display = 'none';
  $('#pl-detail-title').textContent = activePlannitEvent.name;
  $('#pl-cancelled-note').style.display = activePlannitEvent.cancelled ? '' : 'none';
  $('#pl-chat-btn').style.display = activePlannitEvent.cancelled ? 'none' : '';
  $('#pl-cancel-btn').style.display = (!activePlannitEvent.cancelled && activePlannitEvent.owner === me.username) ? '' : 'none';

  const showsPoll = activePlannitEvent.is_tbd || activePlannitEvent.range_type === 'poll';
  $('#pl-poll-card').style.display = showsPoll ? '' : 'none';
  $('#pl-grid-card').style.display = activePlannitEvent.range_type === 'poll' ? 'none' : '';
  const canOfferVote = !showsPoll && activePlannitEvent.range_type !== 'poll'
    && !activePlannitEvent.cancelled && activePlannitEvent.owner === me.username;
  $('#pl-vote-toggle-btn').style.display = canOfferVote ? '' : 'none';

  setPlannitBrush('yes');
  if (activePlannitEvent.range_type !== 'poll') await drawPlannitGrid();
  if (showsPoll) await loadPlannitPoll();
  await refreshPlannitSendButton();
}
async function togglePlannitVote(){
  const ev = activePlannitEvent;
  if (!ev) return;
  const { data, error } = await sb.rpc('set_plannit_tbd', { p_me: me.username, p_event_id: ev.id, p_is_tbd: true });
  if (error || !data.ok) { toast('Could not turn this into a vote — try again'); return; }
  ev.is_tbd = true;
  $('#pl-vote-toggle-btn').style.display = 'none';
  $('#pl-poll-card').style.display = '';
  toast('Now voting — add options below 🗳️');
  await loadPlannitPoll();
  loadPlannitFeed();
}

/* ---- send: owner fills in their own availability/poll options first,
   then explicitly sends the held-back invites to whoever they picked ---- */
async function refreshPlannitSendButton(){
  const ev = activePlannitEvent;
  if (!ev) return;
  if (!ev || ev.owner !== me.username || ev.cancelled) { $('#pl-send-btn').style.display = 'none'; return; }
  const { data, error } = await sb.rpc('list_plannit_members', { p_me: me.username, p_event_id: ev.id });
  if (!activePlannitEvent || activePlannitEvent.id !== ev.id) return;
  const pending = error ? [] : (data || []).filter(m => !m.is_owner && !m.notified);
  if (!pending.length) { $('#pl-send-btn').style.display = 'none'; return; }
  $('#pl-send-btn').style.display = '';
  $('#pl-send-btn').textContent = `📤 Send to ${pending.length} friend${pending.length === 1 ? '' : 's'}`;
}
async function sendPlannitInvites(){
  const ev = activePlannitEvent;
  if (!ev) return;
  const { data, error } = await sb.rpc('send_plannit_invites', { p_me: me.username, p_event_id: ev.id });
  if (error || !data.ok) { toast('Could not send — try again'); return; }
  toast(`Sent to ${data.sent_count} friend${data.sent_count === 1 ? '' : 's'} ✉️`);
  if (activePlannitEvent && activePlannitEvent.id === ev.id) refreshPlannitSendButton();
}

async function confirmCancelPlannitYes(){
  const ev = activePlannitEvent;
  closeSheets();
  if (!ev) return;
  const { data, error } = await sb.rpc('cancel_plannit_event', { p_me: me.username, p_event_id: ev.id });
  if (error || !data.ok) { toast('Could not cancel — try again'); return; }
  ev.cancelled = true;
  $('#pl-cancelled-note').style.display = '';
  $('#pl-chat-btn').style.display = 'none';
  $('#pl-cancel-btn').style.display = 'none';
  $('#pl-send-btn').style.display = 'none';
  toast('Plan cancelled');
  if (ev.range_type !== 'poll') drawPlannitGrid();
  loadPlannitFeed();
}
function closePlannitDetail(){
  activePlannitEvent = null;
  $('#pl-feed-view').style.display = '';
  $('#pl-detail-view').style.display = 'none';
  $('#pl-fab').style.display = '';
}

function plannitUnitHeadHTML(ev, unitIx, granularity){
  if (granularity === 'biweek') {
    const s = dayDate(ev.start_day + unitIx * 14);
    const e = dayDate(Math.min(ev.start_day + unitIx * 14 + 13, plannitRangeEnd(ev.start_day, ev.range_type) - 1));
    return `<span class="mono" style="font-weight:400;white-space:nowrap">${s.toLocaleDateString('en-US',{month:'short',day:'numeric'})}–${e.toLocaleDateString('en-US',{day:'numeric'})}</span>`;
  }
  const d = dayDate(ev.start_day + unitIx);
  const dow = d.toLocaleDateString('en-US', { weekday:'short' }).toUpperCase();
  return `${dow}<br><span class="mono" style="font-weight:400">${d.getDate()}</span>`;
}

async function drawPlannitGrid(){
  if (!activePlannitEvent) return;
  const ev = activePlannitEvent;
  const { data, error } = await sb.rpc('list_plannit_grid', { p_me: me.username, p_event_id: ev.id });
  if (!activePlannitEvent || activePlannitEvent.id !== ev.id) return;
  plannitGridCache = error ? [] : (data || []);

  const granularity = plannitGranularity(ev.range_type);
  const unitCount = plannitUnitCount(ev.start_day, ev.range_type);
  const t = $('#availgrid');
  const unitHeads = Array.from({ length: unitCount }, (_, u) => plannitUnitHeadHTML(ev, u, granularity));
  t.innerHTML = '<tr><th></th>' + unitHeads.map(h => `<th>${h}</th>`).join('') + '</tr>';

  const slots = granularity === 'slot' ? PLANNIT_SLOTS : [null];
  slots.forEach((hr, slotIx) => {
    const tr = document.createElement('tr');
    tr.innerHTML = granularity === 'slot'
      ? `<th class="rowlab mono">${fmtT(hr).replace(':00 ', '')}–${fmtT(hr + 2).replace(':00 ', '')}</th>`
      : `<th class="rowlab">Available</th>`;
    for (let u = 0; u < unitCount; u++) {
      const td = document.createElement('td');
      const cellAnswers = plannitGridCache.filter(r => r.day_offset === u && r.slot_index === slotIx);
      const mine = cellAnswers.find(r => r.member === me.username);
      const yesCount = cellAnswers.filter(r => r.answer === 'yes').length;
      const b = document.createElement('button');
      const shown = mine ? mine.answer : 'none';
      b.className = ANSWER_CLASS[shown];
      b.textContent = yesCount > 1 ? `${yesCount}${ANSWER_SYM.yes}` : ANSWER_SYM[shown];
      b.title = cellAnswers.length
        ? cellAnswers.map(r => `${r.member_display}: ${r.answer}`).join(', ')
        : 'No answers yet';
      if (!ev.cancelled) {
        b.onclick = () => paintPlannitAnswer(u, slotIx);
      } else {
        b.disabled = true;
      }
      td.appendChild(b);
      tr.appendChild(td);
    }
    t.appendChild(tr);
  });
}

/* legend-as-brush: pick a color once, then tap every slot it applies to —
   no per-tap cycling. */
let plannitBrush = 'yes';
function setPlannitBrush(a){
  plannitBrush = a;
  $$('#pl-legend span').forEach(x => x.classList.toggle('on', x.dataset.a === a));
}
$('#pl-legend').addEventListener('click', e => {
  const b = e.target.closest('span[data-a]');
  if (b) setPlannitBrush(b.dataset.a);
});

async function paintPlannitAnswer(dayOffset, slotIndex){
  const ev = activePlannitEvent;
  if (!ev) return;
  const { data, error } = await sb.rpc('set_plannit_answer', {
    p_me: me.username, p_event_id: ev.id, p_day_offset: dayOffset, p_slot_index: slotIndex, p_answer: plannitBrush,
  });
  if (error || !data.ok) { toast('Could not save — check your connection'); return; }
  if (activePlannitEvent && activePlannitEvent.id === ev.id) drawPlannitGrid();
}

/* ---- poll: vote on what the event/plan actually is (is_tbd dated
   events, or standalone range_type='poll' plans) ---- */
let plannitPollCache = [];
async function loadPlannitPoll(){
  if (!activePlannitEvent) return;
  const ev = activePlannitEvent;
  const { data, error } = await sb.rpc('list_plannit_poll', { p_me: me.username, p_event_id: ev.id });
  if (!activePlannitEvent || activePlannitEvent.id !== ev.id) return;
  const box = $('#pl-poll-options');
  if (error) { box.innerHTML = '<div class="sub">Could not load poll.</div>'; return; }
  plannitPollCache = data || [];
  const totalVotes = plannitPollCache.reduce((s, o) => s + Number(o.vote_count), 0);
  const locked = ev.poll_closed || ev.cancelled;
  box.innerHTML = plannitPollCache.length
    ? plannitPollCache.map(o => {
        const pct = totalVotes ? Math.round((o.vote_count / totalVotes) * 100) : 0;
        return `<div class="polloption${o.my_vote ? ' mine' : ''}"${locked ? '' : ` onclick="votePlannitOption('${o.option_id}')"`}>` +
          `<div class="pollbar" style="width:${pct}%"></div>` +
          `<div class="pollrow"><span>${o.my_vote ? '✓ ' : ''}${escHTML(o.label)}</span><span class="mono">${o.vote_count}</span></div>` +
          `</div>`;
      }).join('')
    : '<div class="sub">No options yet — add one below.</div>';
  $('#pl-poll-addrow').style.display = locked ? 'none' : '';
  $('#pl-poll-closed-note').style.display = ev.poll_closed ? '' : 'none';
  $('#pl-poll-lock-btn').style.display = (!locked && ev.owner === me.username && plannitPollCache.length > 0) ? '' : 'none';
}
async function votePlannitOption(optionId){
  const ev = activePlannitEvent;
  if (!ev) return;
  const mine = plannitPollCache.find(o => o.my_vote);
  const newOptionId = (mine && mine.option_id === optionId) ? null : optionId;
  const { data, error } = await sb.rpc('vote_plannit_poll', { p_me: me.username, p_event_id: ev.id, p_option_id: newOptionId });
  if (error || !data.ok) { toast('Could not vote — try again'); return; }
  if (activePlannitEvent && activePlannitEvent.id === ev.id) loadPlannitPoll();
}
async function addPlannitPollOption(){
  const ev = activePlannitEvent;
  if (!ev) return;
  const label = $('#pl-poll-newopt').value.trim();
  if (!label) { toast('Type an option first'); return; }
  const { data, error } = await sb.rpc('add_plannit_poll_option', { p_me: me.username, p_event_id: ev.id, p_label: label });
  if (error || !data.ok) { toast('Could not add — try again'); return; }
  $('#pl-poll-newopt').value = '';
  if (activePlannitEvent && activePlannitEvent.id === ev.id) loadPlannitPoll();
}
async function lockPlannitPollWinner(){
  const ev = activePlannitEvent;
  if (!ev) return;
  const { data, error } = await sb.rpc('lock_plannit_poll_winner', { p_me: me.username, p_event_id: ev.id });
  if (error || !data.ok) { toast('Could not lock in — try again'); return; }
  ev.name = data.name;
  ev.poll_closed = true;
  $('#pl-detail-title').textContent = ev.name;
  toast(`Locked in: ${data.name} 🔒`);
  loadPlannitPoll();
  loadPlannitFeed();
}

/* ---- members ---- */
async function openPlannitMembers(){
  if (!activePlannitEvent) return;
  const ev = activePlannitEvent;
  openSheet('plannitmembers');
  const box = $('#plm-list');
  box.innerHTML = '<div class="sub">Loading…</div>';
  const { data, error } = await sb.rpc('list_plannit_members', { p_me: me.username, p_event_id: ev.id });
  if (!activePlannitEvent || activePlannitEvent.id !== ev.id) return;
  if (error) { box.innerHTML = '<div class="sub">Could not load.</div>'; return; }
  const isOwner = ev.owner === me.username;
  $('#plm-invite-btn').style.display = isOwner && !ev.cancelled ? '' : 'none';
  box.innerHTML = (data || []).map(m => {
    const statusTag = m.is_owner ? '👑 Owner' : m.status === 'accepted' ? '✓ In'
      : m.status === 'pending' ? (m.notified ? '… Pending' : '✉️ Not sent yet') : '✕ Declined';
    return `<div class="frow"><span class="fav2">${m.avatar}</span>` +
      `<div class="g"><div class="dn">${escHTML(m.display_name)}</div><div class="un">@${m.username}</div></div>` +
      `<span class="pill">${statusTag}</span></div>`;
  }).join('');
}
function openPlannitInviteMore(){
  if (!activePlannitEvent) return;
  plannitCreateInvitees = new Set();
  $('#pln-invite-more-list').innerHTML = friendsCache.length
    ? friendsCache.map(f =>
        `<label class="frow" style="cursor:pointer"><span class="fav2">${f.avatar}</span>` +
        `<div class="g"><div class="dn">${escHTML(f.display_name)}</div><div class="un">@${f.username}</div></div>` +
        `<input type="checkbox" style="width:18px;height:18px" onchange="togglePlannitInvitee('${f.username}', this.checked)"></label>`
      ).join('')
    : '<div class="sub">Add some friends first — search from FRIENDS.</div>';
  openSheet('plannitinvitemore');
}
async function submitPlannitInviteMore(){
  if (!activePlannitEvent) return;
  const { data, error } = await sb.rpc('invite_to_plannit_event', {
    p_me: me.username, p_event_id: activePlannitEvent.id, p_invitees: [...plannitCreateInvitees],
  });
  if (error || !data.ok) { toast('Could not invite — try again'); return; }
  closeSheets();
  toast('Invited ✉️');
  openPlannitMembers();
}

function openPlannitChatFromDetail(){
  if (!activePlannitEvent) return;
  openPlannitChat(activePlannitEvent.id, activePlannitEvent.name);
}

function renderPlannitCard(pe){
  const isOwn = pe.owner === me.username;
  const rangeLabel = plannitRangeLabel(pe.start_day, pe.range_type);
  const preview = pe.cancelled ? '🚫 Cancelled' : (isOwn
    ? `You — planning with ${pe.member_count} ${pe.member_count === 1 ? 'person' : 'people'}`
    : `${pe.owner_display} invited you to plan "${escHTML(pe.name)}"`);
  return `<div class="card post" style="cursor:pointer" onclick="openPlannitFromSearch('${pe.id}')">` +
    `<div class="head"><div class="avatar">${isOwn ? '👑' : '🗓️'}</div>` +
    `<div><div class="who">${escHTML(pe.name)}</div><div class="when">${rangeLabel}</div></div>` +
    `<span class="actbadge">PLANNIT</span></div>` +
    `<div class="kind">${pe.cancelled ? 'CANCELLED' : 'PLANNIT'}</div>` +
    `<div class="subact">${preview}</div>` +
    `</div>`;
}
async function openPlannitFromSearch(id){
  showPanel('plannit');
  await loadPlannitFeed();
  openPlannitDetailById(id);
}

/* ---------- SEARCH ----------
   Person / Group / Activity are real, live data pulled from the same
   backend as everything else (list_plans, list_friends_feed,
   list_my_circles) — refreshed on tab-open, pull-to-refresh, and a
   light poll while SEARCH is the active panel, so a friend posting
   something new shows up without a manual page reload. Location stays
   canned demo data — there's no real location backend yet (see build
   notes: TBD). */
const PLACEHOLDERS = {
  person:'Search a friend…', group:'Search a group…',
  activity:'Try “run”, “gym”, “swim”, “study”…',
  location:'Try “YMCA”, “Fairview”, “Don Mills”, “Bayview”…',
};
const searchData = {
  location: { items:[
    { s:'var(--swim)',  t:'YMCA — Maya · swim',      d:'Laps now until 3 PM', live:true },
    { s:'var(--gym)',   t:'YMCA — Dev · lift',       d:'Planned 6–8 PM', live:false },
    { s:'var(--other)', t:'Bayview — café invite',   d:'Sat ~2 PM · 2 going', live:false },
    { s:'var(--run)',   t:'Don Mills — Sam · run',   d:'Sat 8 AM tempo', live:false },
  ]},
};
let curSearch = 'person';
let searchLoaded = false;
let searchFilterMode = 'all';       /* 'all' | 'schedule' | 'plannit' | 'milestone' — Activity tab only */

$('#searchtabs').addEventListener('click', e => {
  const b = e.target.closest('button');
  if (!b) return;
  curSearch = b.dataset.s;
  $$('#searchtabs button').forEach(x => x.classList.toggle('on', x === b));
  $('#searchbox').placeholder = PLACEHOLDERS[curSearch];
  drawSearch();
});
$('#searchbox').addEventListener('input', drawSearch);
$('#search-filter').addEventListener('click', e => {
  const b = e.target.closest('button');
  if (!b) return;
  searchFilterMode = b.dataset.f;
  $$('#search-filter button').forEach(x => x.classList.toggle('on', x === b));
  drawSearch();
});

async function loadSearchData(){
  if (!me) return;
  const who = me.username;

  const [ownPlans, friendPlans] = await Promise.all([
    sb.rpc('list_plans', { p_me: who, p_owner: who }),
    sb.rpc('list_friends_feed', { p_me: who }),
  ]);
  if (!me || me.username !== who) return;
  const activityRows = [];
  (ownPlans.data || []).forEach(p => activityRows.push({
    kind:'schedule', isOwn: true,
    raw: { ...p, owner: me.username, owner_display: me.displayName, owner_avatar: me.av },
    day: p.day_index,
    t: `${p.act} · ${dayLabel(p.day_index).replace('Today — ', '')} ${p.time_label}`,
    d: p.cancelled ? 'You — 🚫 Event cancelled' : `You — ${p.note}${p.edited ? ' (edited)' : ''}`,
  }));
  (friendPlans.data || []).forEach(p => activityRows.push({
    kind:'schedule', isOwn: false, raw: p,
    day: p.day_index,
    t: `${p.act} · ${dayLabel(p.day_index).replace('Today — ', '')} ${p.time_label}`,
    d: p.cancelled ? `${p.owner_display} — 🚫 Event cancelled` : `${p.owner_display} — ${p.note}${p.edited ? ' (edited)' : ''}`,
  }));

  const { data: plannitRows } = await sb.rpc('list_my_plannit_events', { p_me: who });
  if (!me || me.username !== who) return;
  (plannitRows || []).forEach(pe => activityRows.push({
    kind:'plannit', isOwn: pe.owner === who,
    raw: pe,
    day: pe.start_day,
    t: `${pe.name} · ${plannitRangeLabel(pe.start_day, pe.range_type)}`,
    d: pe.owner === who ? `You — planning with ${pe.member_count} ${pe.member_count === 1 ? 'person' : 'people'}` : `${pe.owner_display} invited you to plan "${pe.name}"`,
  }));

  activityRows.sort((a, b) => a.day - b.day);

  const personRows = await Promise.all(friendsCache.map(async f => {
    const { data } = await sb.rpc('list_plans', { p_me: who, p_owner: f.username });
    if (!me || me.username !== who) return null;
    const today = (data || []).filter(p => p.day_index === TODAY_IX && !p.cancelled);
    const summary = today.length
      ? today.map(p => `${p.act} ${p.time_label}`).join(' · ')
      : 'Nothing shared with you today';
    return { s:'var(--other)', t:`${f.display_name} — today`, d: summary };
  }));

  await loadCircles();
  const groupRows = circlesCache.map(c => ({
    s:'var(--other)', t:`${c.name} (${c.members.length})`,
    d: c.members.length ? 'Post to this circle from the composer’s "Who can see"' : 'No members yet — add some from Privacy → Circles',
  }));

  if (!me || me.username !== who) return;
  searchData.activity = { items: activityRows };
  searchData.person = { items: personRows.filter(Boolean) };
  searchData.group = { items: groupRows };
  searchLoaded = true;
  drawSearch();
}

let searchPollTimer = null;
function startSearchPoll(){
  stopSearchPoll();
  searchPollTimer = setInterval(() => { if ($('#p-search').classList.contains('on')) loadSearchData(); }, 12000);
}
function stopSearchPoll(){ if (searchPollTimer) clearInterval(searchPollTimer); searchPollTimer = null; }

function drawSearch(){
  const q = $('#searchbox').value.toLowerCase();
  const box = $('#searchresults');
  box.innerHTML = '';
  $('#search-filter').style.display = curSearch === 'activity' ? '' : 'none';
  const source = searchData[curSearch];
  if (curSearch !== 'location' && !searchLoaded) {
    box.innerHTML = '<div class="sub">Loading…</div>';
    return;
  }

  if (curSearch === 'activity') {
    if (searchFilterMode === 'milestone') {
      box.insertAdjacentHTML('beforeend', '<div class="card sub">Milestones aren\'t shareable yet — nothing to search here.</div>');
      return;
    }
    let rows = source ? source.items : [];
    if (searchFilterMode !== 'all') rows = rows.filter(r => r.kind === searchFilterMode);
    rows = rows.filter(r => !q || (r.t + r.d).toLowerCase().includes(q));
    if (!rows.length) { box.insertAdjacentHTML('beforeend', '<div class="card sub">Nothing to show yet.</div>'); return; }
    box.insertAdjacentHTML('beforeend', '<div class="sub" style="margin-bottom:8px">Chronological — soonest first</div>');
    rows.forEach(r => {
      box.insertAdjacentHTML('beforeend', r.kind === 'plannit' ? renderPlannitCard(r.raw) : renderFeedCard(r.raw, { isOwn: r.isOwn }));
    });
    return;
  }

  const items = (source ? source.items : []).filter(i => !q || (i.t + i.d).toLowerCase().includes(q));
  if (curSearch === 'location')
    box.insertAdjacentHTML('beforeend', '<div class="sub" style="margin-bottom:8px">Places in your network · region search (Fairview, Don Mills, Bayview…) <span class="tag-todo">TBD</span></div>');
  if (!items.length) {
    box.insertAdjacentHTML('beforeend', curSearch === 'location'
      ? '<div class="card sub">No matches in your network. (Results are canned for the prototype.)</div>'
      : '<div class="card sub">Nothing to show yet.</div>');
    return;
  }
  items.forEach(i => {
    const el = document.createElement('div');
    el.className = 'result';
    el.style.setProperty('--c', i.s);
    el.innerHTML =
      `<div class="stripe"></div><div><div class="t">${escHTML(i.t)}</div><div class="sub">${escHTML(i.d)}</div></div>` +
      (i.live ? '<span class="livepill live">LIVE</span>' : '');
    box.appendChild(el);
  });
}

/* ---------- pull-to-refresh (drag down from the top, like Instagram) ---------- */
(function pullToRefresh(){
  const el = $('#ptr-indicator');
  const THRESHOLD = 70;
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  let startY = null, dragging = false, refreshing = false;

  const scrollTop = () => window.scrollY || document.documentElement.scrollTop || 0;
  const setDist = px => { el.style.transform = `translateX(-50%) translateY(${px}px)`; };

  window.addEventListener('touchstart', e => {
    if (refreshing || scrollTop() > 2) { startY = null; return; }
    startY = e.touches[0].clientY;
    el.classList.add('dragging');
  }, { passive: true });

  window.addEventListener('touchmove', e => {
    if (startY === null || refreshing) return;
    const dy = e.touches[0].clientY - startY;
    if (dy <= 0 || scrollTop() > 2) { dragging = false; return; }
    dragging = true;
    const dist = Math.min(dy * 0.5, 90);
    setDist(dist);
    el.style.opacity = Math.min(dist / THRESHOLD, 1);
    el.classList.toggle('spinning', dist >= THRESHOLD);
  }, { passive: true });

  window.addEventListener('touchend', async () => {
    el.classList.remove('dragging');
    if (!dragging) { startY = null; return; }
    const ready = el.classList.contains('spinning');
    dragging = false; startY = null;
    if (!ready) { setDist(0); el.style.opacity = 0; return; }
    refreshing = true;
    setDist(THRESHOLD);
    el.style.opacity = 1;
    if (reduced) { await doRefresh(); }
    else { await Promise.all([doRefresh(), new Promise(r => setTimeout(r, 400))]); }
    el.classList.remove('spinning');
    setDist(0);
    el.style.opacity = 0;
    refreshing = false;
  });

  async function doRefresh(){
    if (!me) return;
    await Promise.all([loadScheduleFromServer(), drawFriendsTab(), pollReqBadge(), loadFriendsFeed(), pollMsgBadge(), loadSearchData()]);
    drawWeek(); drawSlots(); drawFreq(); drawTotals(); drawLogbook();
    toast('Refreshed ✓');
  }
})();

/* ---------- init ---------- */
drawWeek();
drawSlots();
drawChips();
drawFeed();
drawFreq();
drawTotals();
drawLogger();
drawBench();
drawSwim();
drawSearch();
enterApp();
