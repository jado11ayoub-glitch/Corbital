/* ============================================================
   Corbital prototype — behavior
   All demo data lives in the plain arrays/objects below —
   edit them freely, refresh the page, done. No build step.
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

/* ---------- main tabs ---------- */
$('#tabs').addEventListener('click', e => {
  const b = e.target.closest('.tab');
  if (!b) return;
  $$('.tab').forEach(t => t.classList.toggle('on', t === b));
  $$('.panel').forEach(p => p.classList.toggle('on', p.id === 'p-' + b.dataset.t));
});

/* ---------- audience selectors ----------
   .audsel.single → radio behavior (exactly one selected)
   .audsel        → checkbox behavior (toggle any)
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

/* ---------- SCHD: week strip ---------- */
const DOW = ['MON','TUE','WED','THU','FRI','SAT','SUN'];
const weekDates = [27, 28, 29, 30, 31, 1, 2];
const dayLabels = ['Mon Jul 27','Tue Jul 28','Wed Jul 29','Thu Jul 30','Today — Fri Jul 31','Sat Aug 1','Sun Aug 2'];
let selDay = 4;

const daySlots = {
  4: [
    { act:'Gym',   c:'var(--gym)',   t:'6:00 PM–10:00 PM', note:'chest & tris — posted as a range', posted:'Everyone', range:true },
    { act:'Study', c:'var(--study)', t:'2:00 PM–4:00 PM',  note:'BIO120 review', posted:'Only me', range:false },
  ],
  5: [
    { act:'Run', c:'var(--run)', t:'9:00 AM–11:00 AM', note:'easy 5k, open invite', posted:'Close friends', range:true },
  ],
};

function drawWeek(){
  const w = $('#weekstrip');
  w.innerHTML = '';
  DOW.forEach((d, i) => {
    const el = document.createElement('button');
    el.className = 'day' + (i === selDay ? ' on' : '');
    const marks = (daySlots[i] || []).slice(0, 3)
      .map(s => `<i style="background:${i === selDay ? 'var(--on-brand)' : s.c}"></i>`).join('');
    el.innerHTML = `<div class="dow">${d}</div><div class="num">${weekDates[i]}</div><div class="marks">${marks}</div>`;
    el.onclick = () => { selDay = i; drawWeek(); drawSlots(); };
    w.appendChild(el);
  });
}

function drawSlots(){
  $('#daylabel').textContent = dayLabels[selDay];
  const box = $('#slots');
  box.innerHTML = '';
  const list = daySlots[selDay] || [];
  if (!list.length) {
    box.innerHTML = '<div class="card sub">Nothing planned — tap an activity chip above to add.</div>';
    return;
  }
  list.forEach((s, ix) => {
    const el = document.createElement('div');
    el.className = 'slot';
    el.style.setProperty('--c', s.c);
    el.innerHTML =
      `<div class="stripe"></div><div><div class="t">${s.act} · <span class="mono">${s.t}</span></div>` +
      `<div class="sub">${s.note}</div><div class="meta">` +
      `${s.range ? '<span class="pill">⇄ range post</span>' : ''}<span class="pill">👁 ${s.posted}</span></div></div>` +
      `<button class="del" title="Remove" aria-label="Remove">✕</button>`;
    el.querySelector('.del').onclick = () => { list.splice(ix, 1); drawWeek(); drawSlots(); toast('Removed'); };
    box.appendChild(el);
  });
}

/* ---------- SCHD: activity chips ---------- */
let acts = [
  { n:'Gym',   c:'var(--gym)' },
  { n:'Run',   c:'var(--run)' },
  { n:'Swim',  c:'var(--swim)' },
  { n:'Study', c:'var(--study)' },
];
const pickColors = ['var(--gym)','var(--run)','var(--swim)','var(--study)','var(--other)'];
let naColor = pickColors[4];

function drawChips(){
  const r = $('#actchips');
  r.innerHTML = '';
  acts.forEach(a => {
    const b = document.createElement('button');
    b.className = 'chip';
    b.style.setProperty('--c', a.c);
    b.innerHTML = `<span class="swatch"></span>${a.n}`;
    b.onclick = () => openComposer(a);
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
  acts.push({ n, c: naColor });
  $('#na-name').value = '';
  $('#newact').classList.remove('show');
  drawChips();
  toast(`“${n}” saved — it's now a permanent one-tap chip ✓`);
}

/* ---------- SCHD: composer ---------- */
let curAct = null;
const times = [];
for (let h = 6; h <= 23; h++) times.push(h);

function fmtT(v){
  v = +v;
  return `${((v + 11) % 12) + 1}:00 ${v < 12 ? 'AM' : 'PM'}`;
}

['t-from','t-to'].forEach((id, ix) => {
  const s = document.getElementById(id);
  times.forEach(t => {
    const o = document.createElement('option');
    o.value = t;
    o.textContent = fmtT(t);
    s.appendChild(o);
  });
  s.value = ix ? 22 : 18; /* default 6 PM – 10 PM */
});

function openComposer(a){
  curAct = a;
  $('#composer').style.display = 'block';
  $('#composer-title').textContent = 'Plan: ' + a.n;
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
  });
  hideComposer();
  $('#c-note').value = '';
  drawWeek();
  drawSlots();
  toast(aud === 'Only me'
    ? 'Added to your schedule (private)'
    : 'Posted — friends can now join or suggest a time inside your range');
}

/* ---------- FRDS feed ---------- */
const feed = [
  { who:'Maya', ini:'M', when:'20 min ago · Gym crew', kind:'range', c:'var(--gym)',
    txt:'Gym tonight — anyone in?', from:'6 PM', to:'10 PM', joins:1 },
  { who:'Dev',  ini:'D', when:'1 h ago · Study group', kind:'ask',
    txt:'Anyone have notes for BIO120 lecture 8? Missed it 😭', replies:2 },
  { who:'Sam',  ini:'S', when:'3 h ago · Everyone', kind:'goal',
    txt:'New goal: bench 185 lb by Sept 🎯', enc:4 },
  { who:'Lena', ini:'L', when:'Yesterday · Close friends', kind:'done',
    txt:'Goal complete — ran 5k in 23:58, new PR 🏁', congrats:9 },
  { who:'Maya', ini:'M', when:'Yesterday · Everyone', kind:'invite',
    txt:'New café on Bayview — anyone wanna try it Sat around 2?', ins:2 },
];

function drawFeed(){
  const box = $('#feed');
  box.innerHTML = '';
  feed.forEach((p, ix) => {
    const el = document.createElement('div');
    el.className = 'card post';
    let body =
      `<div class="head"><div class="avatar">${p.ini}</div>` +
      `<div><div class="who">${p.who}</div><div class="when">${p.when}</div></div></div><div>${p.txt}</div>`;

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
        `<button class="btn small" onclick="toast('Suggested a different time — ${p.who} will see it on her post')">⇄ Suggest time</button></div>`;
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

/* ---------- GLPR: charts ---------- */
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

function logSession(){
  freq.series[0].v[3] = Math.min(7, freq.series[0].v[3] + 1);
  drawFreq();
  toast('Gym session logged for this week 💪');
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
lineChart($('#benchchart'), [{x:1,y:10},{x:5,y:13},{x:8,y:11},{x:12,y:16}], ' reps', 'var(--gym)', false);
lineChart($('#swimchart'),  [{x:1,y:9},{x:6,y:8.5},{x:14,y:8}], ' min', 'var(--swim)', true);
buildGrid(true);
buildReceivedGrid();
drawSearch();
