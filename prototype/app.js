/* ============================================================
   Corbitals prototype — behavior
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
function closeSheets(){ $('#scrim').classList.remove('show'); $$('.sheet').forEach(s => s.classList.remove('show')); }
document.addEventListener('keydown', e => { if (e.key === 'Escape') closeSheets(); });

function store(key, val){ try { localStorage.setItem(key, JSON.stringify(val)); } catch(e){} }
function load(key, fallback){
  try { const v = localStorage.getItem(key); return v ? JSON.parse(v) : fallback; }
  catch(e){ return fallback; }
}

/* ---------- main tabs ---------- */
$('#tabs').addEventListener('click', e => {
  const b = e.target.closest('.tab');
  if (!b) return;
  $$('.tab').forEach(t => t.classList.toggle('on', t === b));
  $$('.panel').forEach(p => p.classList.toggle('on', p.id === 'p-' + b.dataset.t));
});

/* ---------- audience selectors ----------
   .audsel.single → radio behavior; .audsel → toggle any.
   Buttons starting with "＋" are actions, never selections. */
document.addEventListener('click', e => {
  const b = e.target.closest('.audsel button');
  if (!b) return;
  const label = b.textContent;
  if (label.startsWith('＋')) { toast('Adding people/circles: full picker flow is TBD'); return; }
  if (label.includes('Custom') || label.includes('Pick')) {
    toast('Custom picker: choose exact people or circles per post (full flow TBD)');
  }
  if (b.parentElement.classList.contains('single')) {
    b.parentElement.querySelectorAll('button').forEach(x => x.classList.toggle('on', x === b));
  } else {
    b.classList.toggle('on');
  }
});

/* ============================================================
   ACCOUNTS — username + password, no email.
   Storage layer: localStorage today (per-device), designed so a
   Supabase adapter replaces loadAccounts/saveAccounts + the social
   store to make usernames globally unique across all devices.
   ============================================================ */
const AVATARS = ['🙂','😎','🐆','🦍','🐬','⚡','🔥','🌊','🏔️','🎧'];
const USERS_KEY = 'cb_accounts';

function loadAccounts(){ return load(USERS_KEY, {}); }
function saveAccounts(a){ store(USERS_KEY, a); }

/* password hashing — PBKDF2-HMAC-SHA256, 100k rounds, per-user salt.
   Deliberately slow to make guessing expensive. Passwords are never
   stored or transmitted in readable form; only this derived hash is
   kept, and only on the user's own device. Legacy (v1 sha256) hashes
   are verified once and silently upgraded on successful sign-in. */
const PBKDF2_ITERS = 100000;
async function hashPw(pw, salt){
  if (window.crypto && crypto.subtle) {
    const keyMat = await crypto.subtle.importKey('raw', new TextEncoder().encode(pw), 'PBKDF2', false, ['deriveBits']);
    const bits = await crypto.subtle.deriveBits(
      { name:'PBKDF2', hash:'SHA-256', salt: new TextEncoder().encode(salt), iterations: PBKDF2_ITERS },
      keyMat, 256);
    return 'v2:' + [...new Uint8Array(bits)].map(b => b.toString(16).padStart(2, '0')).join('');
  }
  /* non-secure contexts (file://) — dev fallback only */
  let h = 5381;
  const msg = salt + '::' + pw;
  for (let i = 0; i < msg.length; i++) h = ((h << 5) + h + msg.charCodeAt(i)) >>> 0;
  return 'fb' + h.toString(16);
}
async function legacyHashPw(pw, salt){
  if (!(window.crypto && crypto.subtle)) return null;
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(salt + '::' + pw));
  return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
}
/* verify against current scheme, fall back to legacy, upgrade in place */
async function verifyPw(pw, acc){
  if (await hashPw(pw, acc.salt) === acc.hash) return true;
  const legacy = await legacyHashPw(pw, acc.salt);
  if (legacy && legacy === acc.hash) {
    acc.salt = newSalt();
    acc.hash = await hashPw(pw, acc.salt);
    const accounts = loadAccounts();
    accounts[acc.username.toLowerCase()] = acc;
    saveAccounts(accounts);
    return true;
  }
  return false;
}
const newSalt = () => Math.random().toString(36).slice(2) + Date.now().toString(36);

/* display-name cleanliness filter */
const BAD_WORDS = ['fuck','shit','bitch','cunt','nigg','fagg','whore','slut','retard','dick','cock','pussy','penis','vagina','rape','nazi'];
function isCleanName(name){
  const flat = name.toLowerCase().replace(/[^a-z]/g, '');
  return !BAD_WORDS.some(w => flat.includes(w));
}

const USER_RE = /^[A-Za-z0-9_]{3,20}$/;

/* email: optional, recovery only. Stored lowercase; shown masked. */
function normEmail(raw){
  const e = raw.trim().toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(e) ? e : null;
}
function maskEmail(e){
  const [n, d] = e.split('@');
  return n[0] + '•••@' + d;
}
/* DEMO EMAIL: real delivery comes free with the backend (Supabase /
   Resend). Until then the code is shown on screen, clearly labeled. */
function sendCode(email, code){
  toast(`✉️ DEMO EMAIL to ${maskEmail(email)}: your Corbitals code is ${code} (real emails arrive once the backend is live)`);
}
const newCode = () => String(Math.floor(100000 + Math.random() * 900000));

/* seeded demo friends so search + requests are testable on one device */
(async function seedDemo(){
  const acc = loadAccounts();
  const demo = [['maya','Maya 🏋️'], ['sam','Sam ⚡'], ['dev','Dev 📚'], ['lena','Lena 🏃']];
  let changed = false;
  for (const [u, dn] of demo) {
    if (!acc[u]) {
      const salt = newSalt();
      acc[u] = { username:u, displayName:dn, salt, hash: await hashPw('friends1', salt),
                 av: AVATARS[(u.length * 3) % AVATARS.length], demo:true };
      changed = true;
    }
  }
  if (changed) saveAccounts(acc);
})();

/* ---------- session + gate ---------- */
let me = null;   /* the signed-in account object */
let authMode = 'in';

function currentUser(){
  const u = load('cb_session', null);
  return u ? loadAccounts()[u] || null : null;
}

function setAuthMode(m){
  authMode = m;
  $$('#authseg button').forEach(x => x.classList.toggle('on', x.dataset.m === m));
  $('#gf-name').style.display = m === 'up' ? 'block' : 'none';
  $('#gf-email').style.display = m === 'up' ? 'block' : 'none';
  $('#gf-code').style.display = 'none';
  $('#g-pass').parentElement.style.display = 'block';
  $('#g-passlabel').textContent = 'Password';
  $('#g-forgot').style.display = m === 'in' ? 'inline-flex' : 'none';
  $('#g-go').textContent = m === 'up' ? 'Create account' : 'Sign in';
  $('#g-pass').autocomplete = m === 'up' ? 'new-password' : 'current-password';
  $('#g-err').textContent = '';
  fp = null;
}
$('#authseg').addEventListener('click', e => {
  const b = e.target.closest('button');
  if (b) setAuthMode(b.dataset.m);
});

/* ---------- forgot password (needs a linked email) ---------- */
let fp = null;   /* { stage, key, code } */
function startForgot(){
  const key = $('#g-user').value.trim().toLowerCase();
  const acc = loadAccounts()[key];
  if (!USER_RE.test(key)) { $('#g-err').textContent = 'Type your username first, then tap Forgot password'; return; }
  if (!acc) { $('#g-err').textContent = 'No account with that username on this device'; return; }
  if (!acc.email) { $('#g-err').textContent = 'No email linked to this account, so the password can\'t be reset — add one in Profile next time'; return; }
  fp = { stage:'code', key, code: newCode() };
  sendCode(acc.email, fp.code);
  $('#gf-code').style.display = 'block';
  $('#g-pass').parentElement.style.display = 'none';
  $('#g-go').textContent = 'Verify code';
  $('#g-err').textContent = '';
  $('#g-code').focus();
}
['g-user','g-pass','g-name'].forEach(id => {
  document.getElementById(id).addEventListener('keydown', e => { if (e.key === 'Enter') authSubmit(); });
});

async function authSubmit(){
  const err = m => { $('#g-err').textContent = m; };
  err('');
  if (fp) {
    const accounts = loadAccounts();
    const acc = accounts[fp.key];
    if (fp.stage === 'code') {
      if ($('#g-code').value.trim() !== fp.code) { err('Wrong code — check the text we sent'); return; }
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
      acc.salt = newSalt();
      acc.hash = await hashPw(np, acc.salt);
      accounts[fp.key] = acc;
      saveAccounts(accounts);
      store('cb_session', fp.key);
      fp = null;
      setAuthMode('in');
      enterApp();
      toast('Password reset — you\'re signed in ✓');
      return;
    }
  }
  const user = $('#g-user').value.trim();
  const pass = $('#g-pass').value;
  const accounts = loadAccounts();
  const key = user.toLowerCase();

  if (!USER_RE.test(user)) { err('Username: 3–20 characters, only letters, numbers and _'); return; }

  if (authMode === 'up') {
    let dn = $('#g-name').value.trim() || user;
    if (!isCleanName(dn)) { err('Pick a friendlier display name 🙂'); return; }
    if (pass.length <= 6) { err('Password has to be more than 6 characters'); return; }
    if (accounts[key]) { err('That username is taken — try another'); return; }
    const rawEmail = $('#g-email').value.trim();
    let email = null;
    if (rawEmail) {
      email = normEmail(rawEmail);
      if (!email) { err('That email doesn\'t look right (or leave it empty)'); return; }
    }
    const salt = newSalt();
    accounts[key] = { username:user, displayName:dn, salt, hash: await hashPw(pass, salt), email,
                      av: AVATARS[Math.floor(Math.random() * AVATARS.length)] };
    saveAccounts(accounts);
    store('cb_session', key);
    enterApp();
    toast(`Welcome to Corbitals, ${dn}!`);
  } else {
    const acc = accounts[key];
    if (!acc) { err('No account with that username on this device'); return; }
    if (!(await verifyPw(pass, acc))) { err('Wrong password'); return; }
    store('cb_session', key);
    enterApp();
    toast(`Welcome back, ${acc.displayName}`);
  }
}

function enterApp(){
  me = currentUser();
  if (!me) { $('#authgate').classList.remove('hidden'); return; }
  $('#authgate').classList.add('hidden');
  $('#profilebtn').textContent = me.av;
  $('#pf-name').value = me.displayName;
  $('#pf-account').textContent = '@' + me.username + (me.demo ? ' · demo account' : '');
  $('#pf-email').value = me.email ? maskEmail(me.email) : '';
  $$('#pf-av button').forEach(b => b.classList.toggle('on', b.textContent === me.av));
  drawFriendsTab();
}

function logoutUser(){
  localStorage.removeItem('cb_session');
  me = null;
  closeSheets();
  $('#authgate').classList.remove('hidden');
  $('#g-pass').value = '';
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

function saveProfile(){
  if (!me) return;
  const dn = $('#pf-name').value.trim() || me.username;
  if (!isCleanName(dn)) { toast('Pick a friendlier display name 🙂'); return; }
  me.displayName = dn;
  const rawEmail = $('#pf-email').value.trim();
  if (!rawEmail) { me.email = null; }
  else if (!rawEmail.includes('•')) {
    const em = normEmail(rawEmail);
    if (!em) { toast('That email doesn\'t look right'); return; }
    me.email = em;
  }
  const accounts = loadAccounts();
  accounts[me.username.toLowerCase()] = me;
  saveAccounts(accounts);
  $('#profilebtn').textContent = me.av;
  closeSheets();
  drawFriendsTab();
  toast(`Saved — hey ${dn} ${me.av}`);
}

/* ---------- change password (code if email linked, else current password) ---------- */
async function changePassword(){
  if (!me) return;
  if (me.email) {
    const code = newCode();
    sendCode(me.email, code);
    const got = prompt(`A verification code was sent to ${maskEmail(me.email)}.\nEnter the 6-digit code:`);
    if (got === null) return;
    if (got.trim() !== code) { toast('Wrong code — password unchanged'); return; }
  } else {
    const cur = prompt('No email linked — enter your current password instead:');
    if (cur === null) return;
    if (!(await verifyPw(cur, me))) { toast('Wrong password — nothing changed'); return; }
  }
  const np = prompt('New password (more than 6 characters):');
  if (np === null) return;
  if (np.length <= 6) { toast('Too short — password has to be more than 6 characters'); return; }
  me.salt = newSalt();
  me.hash = await hashPw(np, me.salt);
  const accounts = loadAccounts();
  accounts[me.username.toLowerCase()] = me;
  saveAccounts(accounts);
  toast('Password changed ✓');
}

/* ---------- friends: search, requests, list ---------- */
function socialKey(){ return 'cb_social_' + me.username.toLowerCase(); }
function loadSocial(){ return load(socialKey(), { friends:[], reqIn:[], reqOut:[] }); }
function saveSocial(x){ store(socialKey(), x); }

function frowHTML(acc, right){
  return `<div class="frow"><span class="fav2">${acc.av}</span>` +
    `<div class="g"><div class="dn">${acc.displayName}</div><div class="un">@${acc.username}</div></div>${right}</div>`;
}

function drawFriendsTab(){
  if (!me) return;
  const soc = loadSocial();
  const accounts = loadAccounts();
  $('#mecard').innerHTML =
    `<span class="fav2">${me.av}</span>` +
    `<div class="g"><div class="dn">${me.displayName}</div><div class="un">@${me.username} · ${soc.friends.length} friend${soc.friends.length === 1 ? '' : 's'}</div></div>` +
    `<button class="btn small" onclick="openSheet('profile')">Edit</button>`;

  const inReqs = soc.reqIn.map(u => accounts[u]).filter(Boolean);
  const outReqs = soc.reqOut.map(u => accounts[u]).filter(Boolean);
  $('#freqs').innerHTML = (inReqs.length || outReqs.length)
    ? inReqs.map(a => frowHTML(a, `<button class="btn primary small" onclick="acceptReq('${a.username}')">Accept</button>`)).join('') +
      outReqs.map(a => frowHTML(a, `<span class="un">Requested…</span>`)).join('')
    : '<div class="sub">No pending requests.</div>';

  const friends = soc.friends.map(u => accounts[u]).filter(Boolean);
  $('#flist').innerHTML = friends.length
    ? friends.map(a => frowHTML(a, '<span class="st">✓ Friends</span>')).join('')
    : '<div class="sub">No friends yet — search a username above.</div>';
  drawFSearch();
}

function drawFSearch(){
  const q = $('#fsearch').value.trim().toLowerCase();
  const box = $('#fresults');
  if (!q) { box.innerHTML = '<div class="sub">Type a username above to find people.</div>'; return; }
  const soc = loadSocial();
  const accounts = loadAccounts();
  const hits = Object.values(accounts).filter(a =>
    a.username.toLowerCase() !== me.username.toLowerCase() &&
    (a.username.toLowerCase().includes(q) || a.displayName.toLowerCase().includes(q))
  ).slice(0, 8);
  if (!hits.length) { box.innerHTML = '<div class="sub">Nobody found — usernames are exact, ask your friend for theirs.</div>'; return; }
  box.innerHTML = hits.map(a => {
    const u = a.username.toLowerCase();
    let right;
    if (soc.friends.includes(u)) right = '<span class="st">✓ Friends</span>';
    else if (soc.reqOut.includes(u)) right = '<span class="un">Requested…</span>';
    else if (soc.reqIn.includes(u)) right = `<button class="btn primary small" onclick="acceptReq('${u}')">Accept</button>`;
    else right = `<button class="btn primary small" onclick="sendReq('${u}')">＋ Add</button>`;
    return frowHTML(a, right);
  }).join('');
}
$('#fsearch').addEventListener('input', drawFSearch);

function sendReq(u){
  const soc = loadSocial();
  if (!soc.reqOut.includes(u)) soc.reqOut.push(u);
  saveSocial(soc);
  drawFriendsTab();
  const acc = loadAccounts()[u];
  toast(`Request sent to @${u}`);
  if (acc && acc.demo) {
    setTimeout(() => {
      const s2 = loadSocial();
      s2.reqOut = s2.reqOut.filter(x => x !== u);
      if (!s2.friends.includes(u)) s2.friends.push(u);
      saveSocial(s2);
      drawFriendsTab();
      toast(`${acc.displayName} accepted! 🎉 (demo — real friends accept from their own phone once the backend is live)`);
    }, 1500);
  }
}
function acceptReq(u){
  const soc = loadSocial();
  soc.reqIn = soc.reqIn.filter(x => x !== u);
  if (!soc.friends.includes(u)) soc.friends.push(u);
  saveSocial(soc);
  drawFriendsTab();
  toast(`You and @${u} are now friends 🤝`);
}

/* ---------- SCHD: multi-week calendar ---------- */
const DOW = ['MON','TUE','WED','THU','FRI','SAT','SUN'];
const BASE = new Date(2026, 6, 27);        /* Mon Jul 27 — week containing "today" */
const TODAY_IX = 4;                        /* Fri Jul 31 */
let weeksShown = 1;
let selDay = TODAY_IX;

function dayDate(ix){ const d = new Date(BASE); d.setDate(d.getDate() + ix); return d; }
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
  if (selDay >= weeksShown * 7) selDay = TODAY_IX;
  drawWeek();
  drawSlots();
});

function drawWeek(){
  const w = $('#weekstrip');
  w.innerHTML = '';
  const total = weeksShown * 7;
  for (let i = 0; i < total; i++) {
    const el = document.createElement('button');
    el.className = 'day' + (i === selDay ? ' on' : '');
    const marks = (daySlots[i] || []).slice(0, 3)
      .map(s => `<i style="background:${i === selDay ? 'var(--on-brand)' : s.c}"></i>`).join('');
    el.innerHTML = `<div class="dow">${DOW[i % 7]}</div><div class="num">${dayDate(i).getDate()}</div><div class="marks">${marks}</div>`;
    el.onclick = () => { selDay = i; drawWeek(); drawSlots(); };
    w.appendChild(el);
  }
  const endD = dayDate(total - 1);
  $('#weekrangelabel').textContent = weeksShown === 1
    ? 'This week'
    : `Jul 27 – ${endD.toLocaleDateString('en-US', { month:'short', day:'numeric' })}`;
}

function drawSlots(){
  $('#daylabel').textContent = dayLabel(selDay);
  const box = $('#slots');
  box.innerHTML = '';
  const list = daySlots[selDay] || [];
  if (!list.length) {
    box.innerHTML = '<div class="card sub">Nothing planned — tap an activity chip above to add.</div>';
  }
  list.forEach((s, ix) => {
    const el = document.createElement('div');
    el.className = 'slot' + (s.done ? ' done' : '');
    el.style.setProperty('--c', s.c);
    el.innerHTML =
      `<div class="stripe"></div>` +
      `<button class="doneb" title="Mark done — logs it everywhere" aria-label="Mark done">✓</button>` +
      `<div style="flex:1"><div class="t">${s.act}${(s.tags && s.tags.length) ? ' · ' + s.tags.join(' + ') : ''} · <span class="mono">${s.t}</span></div>` +
      `<div class="body"><div class="sub">${s.note}</div><div class="meta">` +
      `${s.range ? '<span class="pill">⇄ range post</span>' : ''}<span class="pill">👁 ${s.posted}</span></div></div></div>` +
      `<span class="chev">▾</span>` +
      `<button class="del" title="Remove" aria-label="Remove">✕</button>`;
    el.onclick = () => el.classList.toggle('open');
    el.querySelector('.del').onclick = e => { e.stopPropagation(); list.splice(ix, 1); drawWeek(); drawSlots(); toast('Removed'); };
    el.querySelector('.doneb').onclick = e => {
      e.stopPropagation();
      if (s.done) { s.done = false; drawSlots(); return; }
      s.done = true;
      const tags = (s.tags && s.tags.length) ? s.tags : inferTags(s.act, s.note);
      logActivity(s.act, tags, 'from your schedule');
      burst(e.clientX, e.clientY, 26);
      drawSlots();
    };
    box.appendChild(el);
  });
  drawRecs();
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
function openComposer(a){
  curAct = a;
  compSel = [];
  $('#composer').style.display = 'block';
  $('#composer-title').textContent = 'Plan: ' + a.n;
  drawCompSubs();
  $('#composer').scrollIntoView({ behavior:'smooth', block:'center' });
}
function hideComposer(){ $('#composer').style.display = 'none'; }

$('#posttype').addEventListener('click', e => {
  const b = e.target.closest('button');
  if (!b) return;
  $$('#posttype button').forEach(x => x.classList.toggle('on', x === b));
  $('#timerow').style.display = b.dataset.v === 'ask' ? 'none' : 'flex';
});

function postPlan(){
  if (!curAct) return;
  const f = +$('#t-from').value, t = +$('#t-to').value;
  const type = $('#posttype .on').dataset.v;
  if (type !== 'ask' && t <= f) { toast('End time has to be after start'); return; }
  const aud = $('#c-aud .on').textContent;
  const note = $('#c-note').value.trim() || (type === 'ask' ? '(question)' : 'open to friends in this window');
  (daySlots[selDay] = daySlots[selDay] || []).push({
    act: curAct.n, c: curAct.c,
    t: type === 'ask' ? 'anytime' : `${fmtT(f)}–${fmtT(t)}`,
    note, posted: aud, range: type !== 'ask',
    tags: [...compSel],
  });
  curAct.uses++;                                   /* usage count drives chip order */
  store('cb_acts', acts);
  bumpTotals(curAct.n, curAct.c);
  hideComposer();
  $('#c-note').value = '';
  drawWeek(); drawSlots(); drawChips(); drawTotals();
  toast(aud === 'Only me'
    ? 'Added to your schedule (private)'
    : 'Posted — friends can now join or suggest a time inside your range');
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
  for (let e = 0; e < horizon; e++) {
    const ev = (daySlots[e] || []).find(s => slotTags(s).event);
    if (!ev) continue;
    const evName = ev.note.split('—')[0].trim() || ev.act;
    for (let i = Math.max(0, e - 2); i < e; i++) {
      if ((daySlots[i] || []).some(s => slotTags(s).legs && !s.done)) {
        recs.push({ ic:'⚠️', t:`${evName} ${dayName(e)} — keep legs fresh`,
          body:`You have ${evName.toLowerCase()} ${dayName(e)} and heavy leg work planned ${dayName(i)}. Go light or skip legs entirely so you're fresh for it.` });
      } else if ((daySlots[i] || []).some(s => slotTags(s).hard && !s.done)) {
        recs.push({ ic:'⚠️', t:`${evName} ${dayName(e)} — ease up ${dayName(i)}`,
          body:`Intense session planned ${dayName(i)}, right before ${evName.toLowerCase()} ${dayName(e)}. Consider a lighter version.` });
      }
    }
  }
  for (let i = 0; i < horizon; i++) {
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
  for (let i = 0; i < horizon; i++) {
    if ((daySlots[i] || []).some(s => slotTags(s).hard)) {
      streak++;
      if (streak === 3) recs.push({ ic:'😮‍💨', t:'Three intense days in a row',
        body:`Your streak ends ${dayName(i)} — consider making one day lighter or adding a rest day.` });
    } else streak = 0;
  }
  recs.push({ ic:'🤝', t:'Two friends run Saturday morning',
    body:'Sam and Maya both plan runs Saturday morning — post yours as a range to line up.' });
  const box = $('#recs');
  box.innerHTML = recs.length
    ? recs.map(r =>
        `<div class="rec" onclick="this.classList.toggle('open')"><span class="ic">${r.ic}</span>` +
        `<span class="tt">${r.t}</span><span class="chev">▾</span>` +
        `<div class="body sub">${r.body}</div></div>`).join('')
    : '<div class="sub">Nothing to flag — these recs are generated from your own schedule and goals, and right now the spacing looks good 👌</div>';
}

/* ---------- FRDS: add friend ---------- */
function toggleAddFriend(){ document.querySelector('[data-t="friends"]').click(); $('#fsearch').focus(); }
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
        `<div class="replybox"><div class="sub" style="margin-bottom:6px">Propose a slot inside ${p.who}'s ${p.from}–${p.to} window:</div>` +
        `<div class="row"><select class="rf"><option value="18">6 PM</option><option value="19">7 PM</option><option value="20" selected>8 PM</option><option value="21">9 PM</option></select>` +
        `<span class="sub">to</span><select class="rt"><option value="19">7 PM</option><option value="20">8 PM</option><option value="21" selected>9 PM</option><option value="22">10 PM</option></select>` +
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
        `<button class="reaction" onclick="fireOnce(this, &quot;You're in — it lands on your SCHD for Sat ☕&quot;)">☕ I'm in · <span class="count">${p.ins}</span></button>` +
        `<button class="btn small" onclick="toast('Suggested a different time — ${p.who} will see it on their post')">⇄ Suggest time</button></div>`;
    }
    el.innerHTML = body;
    box.appendChild(el);
  });
}

function toggleReply(btn){ btn.closest('.card').querySelector('.replybox').classList.toggle('show'); }

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
  toast(`Sent — if ${who} accepts, it locks into both your SCHD calendars`);
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

/* ---------- PLANNIT: availability grids ---------- */
const STATES = ['s0','s1','s2','s3','s4'];
const SYMS = ['', '✓', '✕', '?', '◷'];

function cellBtn(start = 0){
  const b = document.createElement('button');
  b.className = STATES[start];
  b.textContent = SYMS[start];
  b.onclick = () => {
    const i = (STATES.indexOf(b.className) + 1) % STATES.length;
    b.className = STATES[i];
    b.textContent = SYMS[i];
  };
  return b;
}

function buildGrid(quiet){
  const fmt = $('#pl-format').value;
  const name = $('#pl-name').value.trim() || 'Untitled invite';
  $('#pl-title').textContent = `${name} — ${$('#pl-format').selectedOptions[0].textContent.toLowerCase()}`;
  const t = $('#availgrid');
  t.innerHTML = '<tr><th></th>' + DOW.map(d => `<th>${d}</th>`).join('') + '</tr>';
  if (fmt === 'hourly') {
    for (let hr = 8; hr <= 21; hr += 2) {
      const tr = document.createElement('tr');
      tr.innerHTML = `<th class="rowlab mono">${fmtT(hr).replace(':00 ', '')}–${fmtT(hr + 2).replace(':00 ', '')}</th>`;
      for (let d2 = 0; d2 < 7; d2++) { const td = document.createElement('td'); td.appendChild(cellBtn()); tr.appendChild(td); }
      t.appendChild(tr);
    }
  } else {
    const weeks = +fmt[1];
    for (let w = 0; w < weeks; w++) {
      const tr = document.createElement('tr');
      tr.innerHTML = `<th class="rowlab">Wk ${w + 1}</th>`;
      for (let d2 = 0; d2 < 7; d2++) { const td = document.createElement('td'); td.appendChild(cellBtn()); tr.appendChild(td); }
      t.appendChild(tr);
    }
  }
  if (quiet !== true) toast('Grid ready — fill yours, then hit Send');
}

function buildReceivedGrid(){
  const t = $('#recvgrid');
  const cols = ['SAT 8–10','SAT 10–12','SAT 12–2','SAT 2–4','SAT 4–6'];
  t.innerHTML = '<tr>' + cols.map(c => `<th>${c}</th>`).join('') + '</tr>';
  const yes = [1, 3, 2, 1, 0];
  const tr = document.createElement('tr');
  yes.forEach(y => {
    const td = document.createElement('td');
    const b = document.createElement('button');
    b.className = y >= 3 ? 's1' : y >= 1 ? 's3' : 's0';
    b.textContent = y ? y + '✓' : '';
    b.title = `${y} of 3 said yes so far`;
    b.onclick = () => toast(`${y} said yes here — the full multi-person row view is scoped for LATER`);
    td.appendChild(b);
    tr.appendChild(td);
  });
  t.appendChild(tr);
}

/* ---------- SEARCH ---------- */
const searchData = {
  person: { ph:'Search a friend…', items:[
    { s:'var(--gym)',   t:'Maya — today', d:'Gym 6–10 PM (range, 1 joined) · free before 5', live:false },
    { s:'var(--run)',   t:'Sam — today',  d:'Run 7 AM done ✓ · Study 8–10 PM', live:false },
    { s:'var(--study)', t:'Dev — today',  d:'BIO120 lecture 2–4 · asking for notes', live:false },
  ]},
  group: { ph:'Search a group…', items:[
    { s:'var(--gym)',   t:'Gym crew (4)',      d:'Maya posted 6–10 PM tonight · 2 of 4 free after 8', live:false },
    { s:'var(--other)', t:'Close friends (6)', d:'Café invite Sat ~2 PM · 2 in so far', live:false },
    { s:'var(--study)', t:'Study group (3)',   d:'Nothing planned — start a PLANNIT?', live:false },
  ]},
  activity: { ph:'Try “run”, “gym”, “swim”, “study”…', items:[
    { s:'var(--run)', t:'Run · Sat 9–11 AM', d:'You — easy 5k, open invite (Close friends)', live:false },
    { s:'var(--run)', t:'Run · Sat 8 AM',    d:'Sam — tempo 8k, Don Mills trail', live:false },
    { s:'var(--run)', t:'Run · Sun 10 AM',   d:'Lena — recovery jog, anyone welcome', live:false },
  ]},
  location: { ph:'Try “YMCA”, “Fairview”, “Don Mills”, “Bayview”…', items:[
    { s:'var(--swim)',  t:'YMCA — Maya · swim',      d:'Laps now until 3 PM', live:true },
    { s:'var(--gym)',   t:'YMCA — Dev · lift',       d:'Planned 6–8 PM', live:false },
    { s:'var(--other)', t:'Bayview — café invite',   d:'Sat ~2 PM · 2 going', live:false },
    { s:'var(--run)',   t:'Don Mills — Sam · run',   d:'Sat 8 AM tempo', live:false },
  ]},
};
let curSearch = 'person';

$('#searchtabs').addEventListener('click', e => {
  const b = e.target.closest('button');
  if (!b) return;
  curSearch = b.dataset.s;
  $$('#searchtabs button').forEach(x => x.classList.toggle('on', x === b));
  $('#searchbox').placeholder = searchData[curSearch].ph;
  drawSearch();
});
$('#searchbox').addEventListener('input', drawSearch);

function drawSearch(){
  const q = $('#searchbox').value.toLowerCase();
  const box = $('#searchresults');
  box.innerHTML = '';
  const items = searchData[curSearch].items.filter(i => !q || (i.t + i.d).toLowerCase().includes(q));
  if (curSearch === 'activity' && items.length)
    box.insertAdjacentHTML('beforeend', '<div class="sub" style="margin-bottom:8px">Chronological — soonest first</div>');
  if (curSearch === 'location')
    box.insertAdjacentHTML('beforeend', '<div class="sub" style="margin-bottom:8px">Places in your network · region search (Fairview, Don Mills, Bayview…) <span class="tag-todo">TBD</span></div>');
  if (!items.length) {
    box.insertAdjacentHTML('beforeend', '<div class="card sub">No matches in your network. (Results are canned for the prototype.)</div>');
    return;
  }
  items.forEach(i => {
    const el = document.createElement('div');
    el.className = 'result';
    el.style.setProperty('--c', i.s);
    el.innerHTML =
      `<div class="stripe"></div><div><div class="t">${i.t}</div><div class="sub">${i.d}</div></div>` +
      (i.live ? '<span class="livepill live">LIVE</span>' : '');
    box.appendChild(el);
  });
}

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
buildGrid(true);
buildReceivedGrid();
drawSearch();
enterApp();
