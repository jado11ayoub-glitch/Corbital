/* ============================================================
   Four-Year Academic Planner — standalone, no login.
   A plan's UUID is its own access credential (same trust model as
   any unguessable share link) — see supabase/schema.sql for the
   backend functions this calls.
   ============================================================ */

const SUPABASE_URL = 'https://noingtyctnvemgreegcy.supabase.co';
const SUPABASE_KEY = 'sb_publishable__8xajLrVS-ie0zrRxfsi7Q_nww5wx4c';
const sb = supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

const $ = s => document.querySelector(s);
const $$ = s => [...document.querySelectorAll(s)];

function toast(m){
  const t = $('#toast');
  t.textContent = m;
  t.classList.add('show');
  clearTimeout(t._h);
  t._h = setTimeout(() => t.classList.remove('show'), 2600);
}
function escHTML(s){ return String(s == null ? '' : s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }

/* ---------- recent plans (localStorage only — a device-side shortcut list) ---------- */
const RECENTS_KEY = 'ap_recents';
function loadRecents(){ try { return JSON.parse(localStorage.getItem(RECENTS_KEY)) || []; } catch(e){ return []; } }
function saveRecents(list){ try { localStorage.setItem(RECENTS_KEY, JSON.stringify(list.slice(0, 10))); } catch(e){} }
function touchRecent(id, title, major){
  const list = loadRecents().filter(r => r.id !== id);
  list.unshift({ id, title, major, at: Date.now() });
  saveRecents(list);
}

/* ---------- state ---------- */
let state = { planId: null, plan: null, requirements: [], courses: [], meetings: [], assessments: [] };
let editingCourseId = null; // null = adding a new course; set = editing
let addingToTermIndex = 0;

/* ---------- boot ---------- */
function planIdFromLocation(){
  const usp = new URLSearchParams(location.search);
  return usp.get('plan') || null;
}
function extractPlanId(text){
  const t = (text || '').trim();
  if (!t) return null;
  const m = t.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i);
  return m ? m[0] : null;
}

window.addEventListener('DOMContentLoaded', () => {
  const id = planIdFromLocation();
  if (id) loadPlan(id); else showLanding();
});

function showLanding(){
  $('#view-planner').hidden = true;
  $('#view-landing').hidden = false;
  $('#btn-home').hidden = true;
  $('#btn-share').hidden = true;
  const recents = loadRecents();
  const block = $('#recents-block');
  if (recents.length){
    block.hidden = false;
    $('#recents-list').innerHTML = recents.map(r => `
      <div class="recent-row">
        <div class="rt"><div class="n">${escHTML(r.title || 'Untitled plan')}</div>
        <div class="m">${escHTML(r.major || 'No major set')}</div></div>
        <button class="btn small" onclick="openPlan('${r.id}')">Open</button>
      </div>`).join('');
  } else {
    block.hidden = true;
  }
}

function goHome(){
  history.pushState({}, '', location.pathname);
  showLanding();
}

/* A missing RPC means schema.sql hasn't been run yet — a completely
   different problem from a bad plan link, and worth saying plainly
   instead of letting it surface as "that link doesn't work". */
function isBackendMissing(error){
  if (!error) return false;
  const blob = [error.code, error.message, error.details, error.hint].filter(Boolean).join(' ');
  return error.code === 'PGRST202' || /could not find the function|schema cache|does not exist|404/i.test(blob);
}
function showSetupNote(){
  const n = $('#setup-note');
  if (n) n.hidden = false;
}

function createPlan(){
  const title = $('#new-title').value.trim() || 'My four-year plan';
  const major = $('#new-major').value.trim();
  const credits = Number($('#new-credits').value) || 120;
  sb.rpc('create_academic_plan', { p_title: title, p_major: major }).then(({ data, error }) => {
    if (isBackendMissing(error)) { showSetupNote(); toast('Database isn’t set up yet — see the setup note'); return; }
    if (error || !data || !data.ok) { toast('Could not create plan — try again'); return; }
    const id = data.id;
    // set the credits-required figure the user picked before landing on it
    sb.rpc('update_academic_plan', {
      p_plan_id: id, p_title: title, p_major: major, p_total_credits_required: credits, p_terms: null
    }).finally(() => openPlan(id));
  });
}

function openPlanFromInput(){
  const id = extractPlanId($('#open-id').value);
  if (!id) { toast('That doesn’t look like a valid plan link or ID'); return; }
  openPlan(id);
}

function openPlan(id){
  history.pushState({}, '', location.pathname + '?plan=' + id);
  loadPlan(id);
}

function loadPlan(id){
  sb.rpc('get_academic_plan', { p_plan_id: id }).then(({ data, error }) => {
    if (isBackendMissing(error)) {
      goHome();
      showSetupNote();
      toast('Database isn’t set up yet — see the setup note');
      return;
    }
    if (error || !data || !data.ok) {
      toast('That plan link doesn’t work anymore');
      goHome();
      return;
    }
    state.planId = id;
    state.plan = data.plan;
    state.requirements = data.requirements || [];
    state.courses = data.courses || [];
    state.meetings = data.meetings || [];
    state.assessments = data.assessments || [];
    touchRecent(id, state.plan.title, state.plan.major);
    renderPlanner();
    $('#view-landing').hidden = true;
    $('#view-planner').hidden = false;
    $('#btn-home').hidden = false;
    $('#btn-share').hidden = false;
  });
}

function shareLink(){
  const url = location.origin + location.pathname + '?plan=' + state.planId;
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(url).then(() => toast('Share link copied — anyone with it can view and edit this plan'));
  } else {
    prompt('Copy this link:', url);
  }
}

/* ---------- rendering ---------- */
function renderPlanner(){
  $('#pf-title').value = state.plan.title || '';
  $('#pf-major').value = state.plan.major || '';
  $('#pf-credits').value = state.plan.total_credits_required;
  renderProgress();
  renderRequirements();
  renderTerms();
  renderTimetableTermOptions();
  renderTimetable();
  renderGaps();
  renderPrereqs();
  renderMarksTermOptions();
  renderMarks();
}

function creditsFor(status, requirementId){
  return state.courses
    .filter(c => (requirementId === undefined || c.requirement_id === requirementId))
    .filter(c => status === 'planned_all' ? true : c.status === status)
    .reduce((sum, c) => sum + Number(c.credits || 0), 0);
}

function renderProgress(){
  const required = Number(state.plan.total_credits_required) || 0;
  const completed = state.courses.filter(c => c.status === 'completed').reduce((s,c) => s + Number(c.credits||0), 0);
  const plannedAll = state.courses.reduce((s,c) => s + Number(c.credits||0), 0);
  const pct = required > 0 ? Math.min(100, Math.round(completed / required * 100)) : 0;
  const pctPlanned = required > 0 ? Math.min(100, Math.round(plannedAll / required * 100)) : 0;

  $('#pg-completed').textContent = fmtCredits(completed);
  $('#pg-planned').textContent = fmtCredits(plannedAll);
  $('#pg-percent').textContent = pct + '%';
  $('#bar-done').style.width = pct + '%';
  $('#bar-planned').style.width = Math.max(pct, pctPlanned) + '%';

  const reqTotal = state.requirements.reduce((s,r) => s + Number(r.credits_required||0), 0);
  const note = $('#pg-note');
  if (required > 0 && plannedAll > required){
    note.textContent = `You've mapped out ${fmtCredits(plannedAll - required)} more credits than required — you're ahead or have room to drop something.`;
  } else if (state.requirements.length && reqTotal > 0 && reqTotal !== required){
    note.textContent = reqTotal < required
      ? `Your categories only add up to ${fmtCredits(reqTotal)} of the ${fmtCredits(required)} required — ${fmtCredits(required - reqTotal)} credits aren't assigned to a category yet.`
      : `Your categories add up to ${fmtCredits(reqTotal)}, more than the ${fmtCredits(required)} total required — you may be able to drop a category or lower one's requirement.`;
  } else {
    note.textContent = '';
  }
}

function fmtCredits(n){
  return String(Math.round(n * 100) / 100);
}

function renderRequirements(){
  const list = $('#req-list');
  if (!state.requirements.length){
    list.innerHTML = '<div class="sub">No categories yet — add one to start tracking credits toward your major, gen-eds, or electives.</div>';
    return;
  }
  list.innerHTML = state.requirements.map(r => {
    const completed = creditsFor('completed', r.id);
    const plannedAll = creditsFor('planned_all', r.id);
    const required = Number(r.credits_required) || 0;
    const pct = required > 0 ? Math.min(100, Math.round(completed/required*100)) : (plannedAll > 0 ? 100 : 0);
    const pctPlanned = required > 0 ? Math.min(100, Math.round(plannedAll/required*100)) : (plannedAll > 0 ? 100 : 0);
    return `
      <div class="reqcard">
        <div class="reqcard-head">
          <div class="reqcard-name">${escHTML(r.name)}</div>
          <div class="reqcard-actions">
            <button class="iconbtn" title="Edit" onclick="editRequirement('${r.id}')">✏️</button>
            <button class="iconbtn" title="Delete" onclick="deleteRequirementConfirm('${r.id}')">🗑️</button>
          </div>
        </div>
        <div class="reqcard-stats">${fmtCredits(completed)} / ${fmtCredits(required)} credits${plannedAll > completed ? ` · ${fmtCredits(plannedAll)} planned` : ''}</div>
        <div class="minibar"><div class="minibar-planned" style="width:${pctPlanned}%"></div><div class="minibar-done" style="width:${pct}%"></div></div>
      </div>`;
  }).join('');
}

function renderTerms(){
  const terms = state.plan.terms || [];
  const grid = $('#termsgrid');
  grid.innerHTML = terms.map((label, idx) => {
    const courses = state.courses.filter(c => c.term_index === idx);
    const total = courses.reduce((s,c) => s + Number(c.credits||0), 0);
    return `
      <div class="termcol">
        <div class="termcol-head">
          <input class="termlabel" value="${escHTML(label)}" data-idx="${idx}" onchange="renameTerm(${idx}, this.value)">
          <div class="termcredits">${fmtCredits(total)} credits</div>
        </div>
        <div class="termcol-body">
          ${courses.map(c => courseCardHTML(c)).join('')}
          <button class="btn small addcoursebtn" onclick="openCourseModal(${idx})">＋ Add course</button>
        </div>
      </div>`;
  }).join('');
}

function courseCardHTML(c){
  const req = state.requirements.find(r => r.id === c.requirement_id);
  const statusLabel = { planned: 'Planned', in_progress: 'In progress', completed: 'Completed' }[c.status] || c.status;
  const mtCount = meetingsForCourse(c.id).length;
  return `
    <div class="coursecard" onclick="openCourseModal(${c.term_index}, '${c.id}')">
      <div class="cc-top">
        <span class="cc-code">${escHTML(c.code || '')}</span>
        <span>${fmtCredits(c.credits)} cr</span>
      </div>
      <div class="cc-name">${escHTML(c.title)}</div>
      ${c.section ? `<div class="cc-section">${escHTML(c.section)}</div>` : ''}
      <div class="cc-meta">
        <span class="badge ${c.status}">${statusLabel}${c.grade ? ' · ' + escHTML(c.grade) : ''}</span>
        ${req ? `<span class="badge cat">${escHTML(req.name)}</span>` : ''}
        ${mtCount ? `<span class="badge cat">🗓️ ${mtCount}</span>` : ''}
      </div>
    </div>`;
}

/* ---------- marks, standing and GPA ----------
   York's undergraduate scale is 9-point (A+ = 9 at 90-100 down to F = 0);
   the percentage bands are the calendar's published guideline, and an
   individual instructor's scheme can differ, so treat a letter here as an
   estimate of where a course is heading rather than a registrar figure. */
const YORK_SCALE = [
  { min: 90, letter: 'A+', points: 9 },
  { min: 80, letter: 'A',  points: 8 },
  { min: 75, letter: 'B+', points: 7 },
  { min: 70, letter: 'B',  points: 6 },
  { min: 65, letter: 'C+', points: 5 },
  { min: 60, letter: 'C',  points: 4 },
  { min: 55, letter: 'D+', points: 3 },
  { min: 50, letter: 'D',  points: 2 },
  { min: 40, letter: 'E',  points: 1 },
  { min: 0,  letter: 'F',  points: 0 }
];
function gradeFor(pct){ return YORK_SCALE.find(g => pct >= g.min) || YORK_SCALE[YORK_SCALE.length - 1]; }

function assessmentsFor(courseId){
  return state.assessments.filter(a => a.course_id === courseId);
}

/* Current standing = how you're doing on the work that has actually been
   marked, not a projection onto the whole course. Ungraded pieces are
   deliberately excluded from both sides of the ratio. */
function courseStanding(courseId){
  const all = assessmentsFor(courseId);
  const graded = all.filter(a => a.score !== null && a.score !== undefined);
  const totalWeight = all.reduce((s,a) => s + Number(a.weight || 0), 0);
  const gradedWeight = graded.reduce((s,a) => s + Number(a.weight || 0), 0);
  if (!graded.length || gradedWeight <= 0){
    return { hasMarks: false, totalWeight, gradedWeight: 0, pct: null, grade: null };
  }
  const earned = graded.reduce((s,a) => s + Number(a.weight || 0) * (Number(a.score) / Number(a.max_score || 100)), 0);
  const pct = earned / gradedWeight * 100;
  return { hasMarks: true, totalWeight, gradedWeight, pct, grade: gradeFor(pct) };
}

/* Running standing after each marked piece, oldest first — the sparkline. */
function standingHistory(courseId){
  const graded = assessmentsFor(courseId)
    .filter(a => a.score !== null && a.score !== undefined)
    .slice()
    .sort((a,b) => String(a.due_date || a.created_at || '').localeCompare(String(b.due_date || b.created_at || '')));
  let w = 0, e = 0;
  return graded.map(a => {
    w += Number(a.weight || 0);
    e += Number(a.weight || 0) * (Number(a.score) / Number(a.max_score || 100));
    return w > 0 ? e / w * 100 : 0;
  });
}

function gpaOver(courses){
  let pts = 0, cr = 0;
  courses.forEach(c => {
    const st = courseStanding(c.id);
    if (!st.hasMarks) return;
    pts += st.grade.points * Number(c.credits || 0);
    cr += Number(c.credits || 0);
  });
  return cr > 0 ? { gpa: pts / cr, credits: cr } : { gpa: null, credits: 0 };
}

function renderMarksTermOptions(){
  const sel = $('#mk-term');
  const prev = sel.value;
  sel.innerHTML = (state.plan.terms || []).map((t,i) => `<option value="${i}">${escHTML(t)}</option>`).join('');
  const terms = state.plan.terms || [];
  sel.value = (prev !== '' && Number(prev) < terms.length) ? prev : '0';
}

/* Running standing after each marked piece. Dots are drawn at every point
   so two marks still read as a chart rather than as a stray underline;
   preserveAspectRatio is left at its default so those dots stay round. */
function sparklineSVG(vals){
  if (vals.length < 2) return '';
  const w = 88, h = 22, pad = 3;
  const lo = Math.min(...vals), hi = Math.max(...vals);
  const span = (hi - lo) || 1;
  const xy = vals.map((v,i) => [
    pad + (i / (vals.length - 1)) * (w - pad * 2),
    pad + (1 - (v - lo) / span) * (h - pad * 2)
  ]);
  const rising = vals[vals.length-1] >= vals[0];
  const col = rising ? 'var(--good)' : 'var(--danger)';
  const line = xy.map(p => `${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(' ');
  const dots = xy.map((p,i) =>
    `<circle cx="${p[0].toFixed(1)}" cy="${p[1].toFixed(1)}" r="${i === xy.length-1 ? 2.6 : 1.6}" fill="${col}"/>`
  ).join('');
  const delta = vals[vals.length-1] - vals[0];
  return `<svg class="spark" viewBox="0 0 ${w} ${h}" role="img"
      aria-label="Standing trend, ${delta >= 0 ? 'up' : 'down'} ${Math.abs(delta).toFixed(1)} points across ${vals.length} marks">
    <polyline points="${line}" fill="none" stroke="${col}" stroke-width="1.6"
      stroke-linejoin="round" stroke-linecap="round"/>${dots}</svg>`;
}

function ringSVG(pct, letter){
  const R = 34, C = 2 * Math.PI * R;
  const shown = pct === null ? 0 : Math.max(0, Math.min(100, pct));
  const off = C * (1 - shown / 100);
  const band = pct === null ? 'var(--line)'
    : pct >= 80 ? 'var(--good)' : pct >= 65 ? 'var(--accent)' : pct >= 50 ? 'var(--mid)' : 'var(--danger)';
  return `<svg class="ring" viewBox="0 0 80 80">
    <circle cx="40" cy="40" r="${R}" fill="none" stroke="var(--surface2)" stroke-width="8"/>
    <circle cx="40" cy="40" r="${R}" fill="none" stroke="${band}" stroke-width="8" stroke-linecap="round"
      stroke-dasharray="${C.toFixed(1)}" stroke-dashoffset="${off.toFixed(1)}" transform="rotate(-90 40 40)"/>
    <text x="40" y="38" class="ringpct">${pct === null ? '—' : Math.round(pct) + '%'}</text>
    <text x="40" y="53" class="ringletter">${letter || 'no marks'}</text>
  </svg>`;
}

function renderMarks(){
  const termIdx = Number($('#mk-term').value) || 0;
  const courses = state.courses.filter(c => c.term_index === termIdx);
  const grid = $('#ringgrid');
  const empty = $('#mk-empty');

  if (!courses.length){
    grid.innerHTML = '';
    empty.textContent = 'No courses in this term yet.';
  } else {
    empty.textContent = '';
    grid.innerHTML = courses.map(c => {
      const st = courseStanding(c.id);
      const hist = standingHistory(c.id);
      const n = assessmentsFor(c.id).length;
      return `
        <div class="ringcard" onclick="openMarksModal('${c.id}')">
          ${ringSVG(st.pct, st.hasMarks ? st.grade.letter : null)}
          <div class="ringmeta">
            <div class="ringcode">${escHTML(c.code || c.title)}</div>
            <div class="ringname">${escHTML(c.title)}</div>
            <div class="ringstat">${st.hasMarks
              ? `${fmtCredits(st.gradedWeight)}% of grade in · ${st.grade.points} pts`
              : (n ? `${n} item${n>1?'s':''}, none graded` : 'tap to add marks')}</div>
            ${sparklineSVG(hist)}
          </div>
        </div>`;
    }).join('');
  }

  const term = gpaOver(courses);
  const cum = gpaOver(state.courses);
  $('#gpa-term').textContent = term.gpa === null ? '—' : term.gpa.toFixed(2);
  $('#gpa-term-sub').textContent = term.gpa === null ? 'no marks yet' : `over ${fmtCredits(term.credits)} credits`;
  $('#gpa-cum').textContent = cum.gpa === null ? '—' : cum.gpa.toFixed(2);
  $('#gpa-cum-sub').textContent = cum.gpa === null ? 'York 9-point scale' : `over ${fmtCredits(cum.credits)} credits graded`;
  const box = $('#gpa-minbox');
  box.classList.toggle('below', cum.gpa !== null && cum.gpa < 5);
  box.classList.toggle('above', cum.gpa !== null && cum.gpa >= 5);
  $('#gpa-min-sub').textContent = cum.gpa === null ? 'C+ cumulative, Civil Eng'
    : cum.gpa >= 5 ? `you're ${(cum.gpa - 5).toFixed(2)} above` : `you're ${(5 - cum.gpa).toFixed(2)} below`;
}

/* ---------- the per-course marks modal ---------- */
let marksCourseId = null;

function openMarksModal(courseId){
  marksCourseId = courseId;
  const c = state.courses.find(x => x.id === courseId);
  $('#mm-title').textContent = (c.code ? c.code + ' — ' : '') + c.title;
  renderMarksModal();
  $('#scrim').classList.add('show');
  $('#marks-modal').classList.add('show');
}
function closeMarksModal(){
  marksCourseId = null;
  $('#scrim').classList.remove('show');
  $('#marks-modal').classList.remove('show');
}

function renderMarksModal(){
  if (!marksCourseId) return;
  const st = courseStanding(marksCourseId);
  const items = assessmentsFor(marksCourseId);

  $('#mm-standing').textContent = st.hasMarks
    ? `Currently sitting at ${st.pct.toFixed(1)}% (${st.grade.letter}, ${st.grade.points} grade points) on the ${fmtCredits(st.gradedWeight)}% of the course that's been marked.`
    : 'Nothing graded yet — add a mark below to start tracking.';

  $('#mm-bar-graded').style.width = Math.min(100, st.totalWeight ? st.gradedWeight : 0) + '%';
  $('#mm-graded-pct').textContent = fmtCredits(st.gradedWeight) + '%';
  $('#mm-bar-standing').style.width = (st.pct === null ? 0 : Math.min(100, st.pct)) + '%';
  $('#mm-standing-pct').textContent = st.pct === null ? '—' : st.pct.toFixed(1) + '%';

  const weightNote = st.totalWeight !== 100 && items.length
    ? `<div class="mm-warn">Weights add up to ${fmtCredits(st.totalWeight)}%, not 100% — add the missing pieces for an accurate projection.</div>` : '';

  $('#mm-list').innerHTML = weightNote + (items.length ? items.map(a => {
    const graded = a.score !== null && a.score !== undefined;
    const pct = graded ? (Number(a.score) / Number(a.max_score || 100) * 100) : null;
    return `
      <div class="mm-item${graded ? '' : ' pending'}">
        <div class="mm-item-main">
          <div class="mm-item-name">${escHTML(a.name)}</div>
          <div class="mm-item-sub">${escHTML(a.kind)} · worth ${fmtCredits(a.weight)}%${a.due_date ? ' · ' + escHTML(a.due_date) : ''}</div>
        </div>
        <div class="mm-item-score">
          ${graded
            ? `<b>${fmtCredits(a.score)}/${fmtCredits(a.max_score)}</b><span>${pct.toFixed(0)}% · ${gradeFor(pct).letter}</span>`
            : `<span class="mm-pending">not graded</span>`}
        </div>
        <button class="iconbtn" title="Delete" onclick="deleteAssessment('${a.id}')">🗑️</button>
      </div>`;
  }).join('') : '<div class="sub">No assessments yet.</div>');
}

function submitAssessment(){
  if (!marksCourseId) return;
  const name = $('#as-name').value.trim();
  if (!name){ toast('Give it a name'); return; }
  const weight = Number($('#as-weight').value);
  const maxScore = Number($('#as-max').value) || 100;
  const scoreRaw = $('#as-score').value.trim();
  const score = scoreRaw === '' ? null : Number(scoreRaw);
  if (score !== null && (isNaN(score) || score < 0)){ toast('Score has to be a positive number'); return; }
  if (maxScore <= 0){ toast('"Out of" has to be greater than zero'); return; }
  if (isNaN(weight) || weight < 0 || weight > 100){ toast('Weight has to be between 0 and 100'); return; }

  // snapshot so the toast can report the actual movement
  const before = courseStanding(marksCourseId);
  const beforeCum = gpaOver(state.courses);

  sb.rpc('add_assessment', {
    p_plan_id: state.planId, p_course_id: marksCourseId, p_name: name,
    p_kind: $('#as-kind').value, p_weight: weight, p_score: score,
    p_max_score: maxScore, p_due_date: $('#as-due').value || null
  }).then(({ data, error }) => {
    if (error || !data || !data.ok){ toast('Could not save that mark'); return; }
    state.assessments.push({
      id: data.id, course_id: marksCourseId, name, kind: $('#as-kind').value,
      weight, score, max_score: maxScore, due_date: $('#as-due').value || null,
      created_at: new Date().toISOString()
    });
    $('#as-name').value = ''; $('#as-weight').value = ''; $('#as-score').value = ''; $('#as-due').value = '';
    $('#as-max').value = 100;
    reportImpact(before, beforeCum);
    renderMarksModal(); renderMarks();
  });
}

function deleteAssessment(id){
  const before = courseStanding(marksCourseId);
  const beforeCum = gpaOver(state.courses);
  sb.rpc('delete_assessment', { p_plan_id: state.planId, p_id: id }).then(({ data, error }) => {
    if (error || !data || !data.ok){ toast('Could not delete that'); return; }
    state.assessments = state.assessments.filter(a => a.id !== id);
    reportImpact(before, beforeCum);
    renderMarksModal(); renderMarks();
  });
}

/* the "see the impact" bit — says what actually moved, not just "saved" */
function reportImpact(before, beforeCum){
  const after = courseStanding(marksCourseId);
  const afterCum = gpaOver(state.courses);
  const bits = [];
  if (after.hasMarks && before.hasMarks){
    const d = after.pct - before.pct;
    bits.push(`${before.pct.toFixed(1)}% → ${after.pct.toFixed(1)}% (${d >= 0 ? '+' : ''}${d.toFixed(1)})`);
  } else if (after.hasMarks){
    bits.push(`now at ${after.pct.toFixed(1)}% (${after.grade.letter})`);
  }
  if (afterCum.gpa !== null && beforeCum.gpa !== null && Math.abs(afterCum.gpa - beforeCum.gpa) >= 0.005){
    bits.push(`GPA ${beforeCum.gpa.toFixed(2)} → ${afterCum.gpa.toFixed(2)}`);
  } else if (afterCum.gpa !== null && beforeCum.gpa === null){
    bits.push(`GPA ${afterCum.gpa.toFixed(2)}`);
  }
  toast(bits.length ? bits.join(' · ') : 'Saved');
}

/* ---------- weekly timetable ----------
   Laid out as an absolutely-positioned overlay per weekday rather than a
   table, so a 90-minute class and a 2-hour lab both land on exact pixel
   offsets instead of being forced onto 30-minute row boundaries. */
const DAY_NAMES = ['Mon','Tue','Wed','Thu','Fri','Sat','Sun'];
const TT_START_MIN = 8 * 60;   /* grid starts 8:00 */
const TT_PX_PER_MIN = 0.9;

function fmtTime(min){
  const h = Math.floor(min / 60), m = min % 60;
  return String(h).padStart(2,'0') + ':' + String(m).padStart(2,'0');
}
function parseTimeInput(v){
  const m = /^(\d{1,2}):(\d{2})$/.exec((v || '').trim());
  if (!m) return null;
  const min = Number(m[1]) * 60 + Number(m[2]);
  return (min >= 0 && min <= 1440) ? min : null;
}
function meetingsForCourse(courseId){
  return state.meetings.filter(m => m.course_id === courseId);
}

function renderTimetableTermOptions(){
  const sel = $('#tt-term');
  const prev = sel.value;
  sel.innerHTML = (state.plan.terms || []).map((t, i) => `<option value="${i}">${escHTML(t)}</option>`).join('');
  const terms = state.plan.terms || [];
  sel.value = (prev !== '' && Number(prev) < terms.length) ? prev : '0';
}

function renderTimetable(){
  const termIdx = Number($('#tt-term').value) || 0;
  const courseIds = new Set(state.courses.filter(c => c.term_index === termIdx).map(c => c.id));
  const meetings = state.meetings.filter(m => courseIds.has(m.course_id));
  const grid = $('#tt-grid');
  const empty = $('#tt-empty');

  if (!meetings.length){
    grid.innerHTML = '';
    empty.textContent = 'No meeting times recorded for this term yet — open a course and add its lecture, tutorial, and lab times to see them here.';
    return;
  }
  empty.textContent = '';

  // only show weekend columns if something actually meets then
  const maxDay = Math.max(4, ...meetings.map(m => m.day_of_week));
  const days = DAY_NAMES.slice(0, maxDay + 1);
  const endMin = Math.max(...meetings.map(m => m.end_min));
  const lastHour = Math.min(24, Math.ceil(endMin / 60) + 1);
  const height = (lastHour * 60 - TT_START_MIN) * TT_PX_PER_MIN;

  let hoursHTML = '';
  for (let h = TT_START_MIN / 60; h < lastHour; h++){
    hoursHTML += `<div class="tt-hour" style="top:${(h * 60 - TT_START_MIN) * TT_PX_PER_MIN}px">
      <span>${fmtTime(h * 60)}</span></div>`;
  }

  const colsHTML = days.map((d, di) => {
    const dayMeetings = meetings.filter(m => m.day_of_week === di).sort((a,b) => a.start_min - b.start_min);
    const blocks = dayMeetings.map(m => {
      const c = state.courses.find(x => x.id === m.course_id);
      if (!c) return '';
      const top = (m.start_min - TT_START_MIN) * TT_PX_PER_MIN;
      const h = (m.end_min - m.start_min) * TT_PX_PER_MIN;
      const compClass = /lab/i.test(m.component) ? 'lab' : /tut/i.test(m.component) ? 'tut' : /blend/i.test(m.component) ? 'blend' : 'lec';
      return `<div class="tt-block ${compClass}" style="top:${top}px;height:${h}px"
        title="${escHTML(c.code || c.title)} · ${escHTML(m.component)} · ${fmtTime(m.start_min)}–${fmtTime(m.end_min)}${m.location ? ' · ' + escHTML(m.location) : ''}">
        <div class="tt-code">${escHTML(c.code || c.title)}</div>
        <div class="tt-meta">${escHTML(m.component)}</div>
        <div class="tt-meta">${fmtTime(m.start_min)}–${fmtTime(m.end_min)}</div>
        ${m.location ? `<div class="tt-meta">${escHTML(m.location)}</div>` : ''}
      </div>`;
    }).join('');
    return `<div class="tt-col"><div class="tt-colhead">${d}</div>
      <div class="tt-colbody" style="height:${height}px">${blocks}</div></div>`;
  }).join('');

  grid.innerHTML = `<div class="tt-inner">
    <div class="tt-gutter"><div class="tt-colhead"></div>
      <div class="tt-gutterbody" style="height:${height}px">${hoursHTML}</div></div>
    ${colsHTML}
  </div>`;
}

/* ---------- prerequisite chains ----------
   Reference data about York's Civil Engineering curriculum, not the
   student's own data, so it lives here rather than in the database —
   one edit updates it for every plan. Sourced from Lassonde's published
   undergraduate CIVL course listing. Keys are matched loosely against a
   course's code, so "SC/CHEM 1100 4.00" matches the key "CHEM 1100". */
const CIVL_PREREQS = {
  'CIVL 2120': ['CHEM 1100'],
  'CIVL 2150': ['ENG 1102'],
  'CIVL 2210': ['MATH 1014', 'PHYS 1800', 'CIVL 2120'],
  'CIVL 2220': ['CIVL 2210', 'PHYS 1800'],
  'CIVL 2240': ['ESSE 1012', 'CHEM 1100'],
  'CIVL 2000': ['ENG 2001', 'CIVL 2150'],
  'ESSE 2635': ['ESSE 1012', 'MATH 2930', 'CIVL 2150'],
  'CIVL 3110': ['CIVL 2160', 'CIVL 2210', 'CIVL 2220'],
  'CIVL 3120': ['CIVL 2210'],
  'CIVL 3130': ['CIVL 2220'],
  'CIVL 3160': ['ESSE 2635', 'MATH 2930'],
  'CIVL 3210': ['CIVL 3110'],
  'CIVL 3220': ['MATH 2930', 'CIVL 2210'],
  'CIVL 3230': ['CIVL 2120', 'CIVL 3130'],
  'CIVL 3240': ['CIVL 2240', 'CIVL 3120'],
  'CIVL 3260': ['ENG 2001', 'CIVL 3160'],
  'CIVL 4110': ['ENG 2001', 'ENG 3000'],
  'CIVL 4210': ['ENVS 2150', 'CIVL 4110']
};

/* pull the bare "DEPT NNNN" out of a code like "SC/CHEM 1100 4.00" */
function bareCode(code){
  const m = /([A-Z]{3,4})\s*(\d{4})/.exec(String(code || '').toUpperCase());
  return m ? `${m[1]} ${m[2]}` : null;
}
function courseByBareCode(bare){
  return state.courses.find(c => bareCode(c.code) === bare);
}

/* everything a given course directly unlocks, then transitively */
function unlockedBy(bare, seen){
  seen = seen || new Set();
  const direct = Object.keys(CIVL_PREREQS).filter(k => CIVL_PREREQS[k].includes(bare));
  direct.forEach(d => {
    if (!seen.has(d)){ seen.add(d); unlockedBy(d, seen); }
  });
  return { direct, all: seen };
}

function renderPrereqs(){
  const wrap = $('#prereq-list');
  const summary = $('#prereq-summary');

  // only first-year courses that actually gate something downstream
  const gates = state.courses
    .filter(c => c.term_index <= 1)
    .map(c => ({ course: c, bare: bareCode(c.code) }))
    .filter(x => x.bare)
    .map(x => Object.assign(x, unlockedBy(x.bare)))
    .filter(x => x.direct.length)
    .sort((a,b) => b.all.size - a.all.size || a.bare.localeCompare(b.bare));

  if (!gates.length){
    wrap.innerHTML = '<div class="sub" style="margin-top:10px">None of this plan’s first-year courses appear in the Civil Engineering prerequisite chains.</div>';
    summary.textContent = '';
    return;
  }
  summary.textContent = `${gates.length} first-year courses gate later ones`;

  wrap.innerHTML = gates.map(g => {
    const inPlan = b => {
      const c = courseByBareCode(b);
      return c ? `<span class="pq-chip" title="${escHTML((state.plan.terms||[])[c.term_index] || '')}">${escHTML(b)}</span>`
               : `<span class="pq-chip missing" title="not in this plan">${escHTML(b)}</span>`;
    };
    const downstream = [...g.all].sort();
    return `
      <div class="pqrow">
        <div class="pq-head">
          <span class="pq-src">${escHTML(g.course.code || g.bare)}</span>
          <span class="pq-title">${escHTML(g.course.title)}</span>
          <span class="pq-count">${g.all.size} course${g.all.size>1?'s':''} downstream</span>
        </div>
        <div class="pq-body">
          <div class="pq-line"><span class="pq-label">unlocks directly</span>${g.direct.sort().map(inPlan).join('')}</div>
          ${downstream.length > g.direct.length
            ? `<div class="pq-line"><span class="pq-label">and eventually</span>${downstream.filter(d => !g.direct.includes(d)).map(inPlan).join('')}</div>`
            : ''}
        </div>
      </div>`;
  }).join('');

  // ordering conflicts: a prereq sitting in the same term as, or later
  // than, the course that needs it
  const problems = [];
  Object.keys(CIVL_PREREQS).forEach(k => {
    const c = courseByBareCode(k);
    if (!c) return;
    CIVL_PREREQS[k].forEach(p => {
      const pc = courseByBareCode(p);
      if (pc && pc.term_index >= c.term_index){
        problems.push(`<b>${escHTML(k)}</b> needs ${escHTML(p)}, but it's scheduled ${pc.term_index === c.term_index ? 'in the same term' : 'later'}`);
      }
    });
  });
  if (problems.length){
    wrap.insertAdjacentHTML('afterbegin',
      `<div class="pq-warn"><b>Ordering to check with advising:</b><ul>${problems.map(p => `<li>${p}</li>`).join('')}</ul></div>`);
  }
}

/* ---------- study blocks ----------
   Only gaps *between* classes count: time before your first class or
   after your last isn't a gap, it's just your day. 45 minutes is the
   floor for something being usable rather than a walk between buildings. */
const GAP_FLOOR_MIN = 45;

function gapsForTerm(termIdx){
  const courseIds = new Set(state.courses.filter(c => c.term_index === termIdx).map(c => c.id));
  const meetings = state.meetings.filter(m => courseIds.has(m.course_id));
  const out = [];
  for (let d = 0; d < 7; d++){
    const day = meetings.filter(m => m.day_of_week === d).sort((a,b) => a.start_min - b.start_min);
    if (day.length < 2) continue;
    // merge overlaps first, so a gap is measured from the real end of
    // whatever was running, not from an earlier class that overlapped it
    const merged = [];
    day.forEach(m => {
      const last = merged[merged.length - 1];
      if (last && m.start_min <= last.end){ last.end = Math.max(last.end, m.end_min); last.after = m; }
      else merged.push({ start: m.start_min, end: m.end_min, before: m, after: m });
    });
    for (let i = 0; i < merged.length - 1; i++){
      const gap = merged[i+1].start - merged[i].end;
      if (gap < GAP_FLOOR_MIN) continue;
      out.push({
        day: d, start: merged[i].end, end: merged[i+1].start, mins: gap,
        afterCourse: state.courses.find(c => c.id === merged[i].after.course_id),
        beforeCourse: state.courses.find(c => c.id === merged[i+1].before.course_id)
      });
    }
  }
  return out;
}

function renderGaps(){
  const termIdx = Number($('#tt-term').value) || 0;
  const gaps = gapsForTerm(termIdx);
  const list = $('#gaps-list');
  const summary = $('#gaps-summary');

  if (!gaps.length){
    list.innerHTML = '';
    summary.textContent = '';
    list.innerHTML = '<div class="sub" style="margin-top:10px">No gaps of 45 minutes or more in this term — your classes run back to back.</div>';
    return;
  }
  const totalMins = gaps.reduce((s,g) => s + g.mins, 0);
  const hrs = Math.round(totalMins / 6) / 10;
  summary.textContent = `${hrs}h across ${gaps.length} block${gaps.length>1?'s':''} a week`;

  list.innerHTML = gaps.map(g => {
    const long = g.mins >= 90;
    const label = g.mins >= 60 ? `${Math.round(g.mins/6)/10}h` : `${g.mins}m`;
    return `
      <div class="gaprow${long ? ' long' : ''}">
        <span class="gap-day">${DAY_NAMES[g.day]}</span>
        <span class="gap-time">${fmtTime(g.start)}–${fmtTime(g.end)}</span>
        <span class="gap-len">${label}</span>
        <span class="gap-ctx">after ${escHTML(g.afterCourse ? (g.afterCourse.code || g.afterCourse.title) : '?')}
          → before ${escHTML(g.beforeCourse ? (g.beforeCourse.code || g.beforeCourse.title) : '?')}</span>
      </div>`;
  }).join('');
}

/* ---------- calendar export (.ics) ----------
   Times are written as floating local times (no Z, no TZID): a 9:30 class
   is 9:30 wherever the calendar is read, which is what you want for a
   campus timetable and avoids shipping a VTIMEZONE block. */
const YORK_TERM_PRESETS = {
  /* official York 2026-2027 Fall/Winter dates */
  fall:   { start: '2026-09-09', end: '2026-12-08', skipStart: '2026-10-10', skipEnd: '2026-10-16', label: 'York Fall 2026' },
  winter: { start: '2027-01-04', end: '2027-04-05', skipStart: '2027-02-13', skipEnd: '2027-02-19', label: 'York Winter 2027' }
};

function presetForTerm(termIdx){
  const name = ((state.plan.terms || [])[termIdx] || '').toLowerCase();
  if (/fall|\(f\)/.test(name)) return YORK_TERM_PRESETS.fall;
  if (/winter|\(w\)/.test(name)) return YORK_TERM_PRESETS.winter;
  return null;
}

function openExportModal(){
  const termIdx = Number($('#tt-term').value) || 0;
  $('#ex-termname').textContent = (state.plan.terms || [])[termIdx] || '';
  const p = presetForTerm(termIdx);
  $('#ex-start').value = p ? p.start : '';
  $('#ex-end').value = p ? p.end : '';
  $('#ex-skip-start').value = p ? p.skipStart : '';
  $('#ex-skip-end').value = p ? p.skipEnd : '';
  $('#ex-preset').textContent = p
    ? `Pre-filled with the ${p.label} dates from York's registrar — change them if your term runs differently.`
    : 'No York preset matched this term name, so fill the dates in yourself.';
  $('#scrim').classList.add('show');
  $('#export-modal').classList.add('show');
}

function parseDateOnly(s){
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec((s || '').trim());
  return m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : null;
}
function icsDate(d){
  const p = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth()+1)}${p(d.getDate())}`;
}
function icsStamp(d, min){
  const p = n => String(n).padStart(2, '0');
  return `${icsDate(d)}T${p(Math.floor(min/60))}${p(min%60)}00`;
}
/* RFC 5545 caps a line at 75 octets, continued with CRLF + one space.
   The limit is bytes, not characters — "—" is 3 bytes and room names carry
   accents — so measure in UTF-8 and never split a codepoint across the
   fold. Applied to every line, since UIDs blow past 75 on their own. */
function foldICS(line){
  const enc = new TextEncoder();
  if (enc.encode(line).length <= 75) return line;
  const out = [];
  let cur = '', curBytes = 0, limit = 75;
  for (const ch of line){                       // iterates by codepoint
    const n = enc.encode(ch).length;
    if (curBytes + n > limit){
      out.push(cur);
      cur = ch; curBytes = n;
      limit = 74;                               // continuation lines lose one octet to the leading space
    } else {
      cur += ch; curBytes += n;
    }
  }
  if (cur) out.push(cur);
  return out.join('\r\n ');
}
function escICS(s){
  return String(s == null ? '' : s).replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\n/g, '\\n');
}

function buildICS(termIdx, startDate, endDate, skipStart, skipEnd){
  const courseIds = new Set(state.courses.filter(c => c.term_index === termIdx).map(c => c.id));
  const meetings = state.meetings.filter(m => courseIds.has(m.course_id));
  const lines = ['BEGIN:VCALENDAR','VERSION:2.0','PRODID:-//Four-Year Planner//Timetable//EN','CALSCALE:GREGORIAN','METHOD:PUBLISH'];
  const until = new Date(endDate); until.setHours(23,59,59);

  meetings.forEach((m, i) => {
    const c = state.courses.find(x => x.id === m.course_id);
    if (!c) return;
    // first occurrence on/after the term start that lands on this weekday
    const first = new Date(startDate);
    const startDow = (first.getDay() + 6) % 7;           // JS Sun=0 -> Mon=0
    first.setDate(first.getDate() + ((m.day_of_week - startDow) + 7) % 7);
    if (first > endDate) return;

    // reading-week occurrences are excluded rather than the series being split
    const ex = [];
    if (skipStart && skipEnd){
      for (let d = new Date(first); d <= endDate; d.setDate(d.getDate() + 7)){
        if (d >= skipStart && d <= skipEnd) ex.push(icsStamp(d, m.start_min));
      }
    }
    lines.push('BEGIN:VEVENT');
    lines.push(`UID:${state.planId}-${m.id || i}@four-year-planner`);
    lines.push(`DTSTAMP:${icsDate(new Date())}T000000Z`);
    lines.push(`DTSTART:${icsStamp(first, m.start_min)}`);
    lines.push(`DTEND:${icsStamp(first, m.end_min)}`);
    lines.push(`RRULE:FREQ=WEEKLY;UNTIL=${icsStamp(until, 23*60+59)}`);
    if (ex.length) lines.push(`EXDATE:${ex.join(',')}`);
    lines.push(`SUMMARY:${escICS((c.code || c.title) + ' — ' + m.component)}`);
    if (m.location) lines.push(`LOCATION:${escICS(m.location)}`);
    lines.push(`DESCRIPTION:${escICS(c.title + (c.section ? ' · ' + c.section : ''))}`);
    lines.push('END:VEVENT');
  });

  lines.push('END:VCALENDAR');
  // fold once, centrally, so no line can slip past the limit
  return lines.map(foldICS).join('\r\n') + '\r\n';
}

function downloadICS(){
  const termIdx = Number($('#tt-term').value) || 0;
  const start = parseDateOnly($('#ex-start').value);
  const end = parseDateOnly($('#ex-end').value);
  if (!start || !end){ toast('Enter the first and last day of classes'); return; }
  if (end < start){ toast('The last day has to come after the first'); return; }
  const skipStart = parseDateOnly($('#ex-skip-start').value);
  const skipEnd = parseDateOnly($('#ex-skip-end').value);

  const ics = buildICS(termIdx, start, end, skipStart, skipEnd);
  const count = (ics.match(/BEGIN:VEVENT/g) || []).length;
  if (!count){ toast('No meeting times in this term to export'); return; }

  const name = ((state.plan.terms || [])[termIdx] || 'timetable').replace(/[^\w]+/g, '-').replace(/^-|-$/g, '');
  const blob = new Blob([ics], { type: 'text/calendar;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = name.toLowerCase() + '.ics';
  document.body.appendChild(a); a.click(); document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 2000);
  closeAnyModal();
  toast(`Exported ${count} class${count>1?'es':''} — open the file to import`);
}

/* ---------- meetings (inside the course modal) ---------- */
function renderMeetingsEditor(){
  const list = $('#cm-meetings-list');
  const form = $('#cm-meeting-form');
  const hint = $('#cm-meetings-hint');
  if (!editingCourseId){
    list.innerHTML = '';
    form.hidden = true;
    hint.hidden = false;
    return;
  }
  hint.hidden = true;
  form.hidden = false;
  const mine = meetingsForCourse(editingCourseId)
    .slice().sort((a,b) => a.day_of_week - b.day_of_week || a.start_min - b.start_min);
  list.innerHTML = mine.length ? mine.map(m => `
    <div class="meetingrow">
      <span class="mr-day">${DAY_NAMES[m.day_of_week]}</span>
      <span class="mr-time">${fmtTime(m.start_min)}–${fmtTime(m.end_min)}</span>
      <span class="mr-comp">${escHTML(m.component)}${m.location ? ' · ' + escHTML(m.location) : ''}</span>
      <button class="iconbtn" title="Remove" onclick="deleteMeeting('${m.id}')">🗑️</button>
    </div>`).join('')
    : '<div class="sub">No meetings yet.</div>';
}

function submitMeeting(){
  if (!editingCourseId) return;
  const start = parseTimeInput($('#mt-start').value);
  const end = parseTimeInput($('#mt-end').value);
  if (start === null || end === null){ toast('Enter valid start and end times'); return; }
  if (end <= start){ toast('End time has to be after the start time'); return; }
  const payload = {
    component: $('#mt-component').value,
    day_of_week: Number($('#mt-day').value),
    start_min: start,
    end_min: end,
    location: $('#mt-loc').value.trim()
  };
  sb.rpc('add_course_meeting', {
    p_plan_id: state.planId, p_course_id: editingCourseId, p_component: payload.component,
    p_day_of_week: payload.day_of_week, p_start_min: payload.start_min,
    p_end_min: payload.end_min, p_location: payload.location
  }).then(({ data, error }) => {
    if (error || !data || !data.ok) { toast('Could not add that meeting'); return; }
    state.meetings.push(Object.assign({ id: data.id, course_id: editingCourseId }, payload));
    $('#mt-loc').value = '';
    renderMeetingsEditor();
    renderTimetable();
  });
}

function deleteMeeting(id){
  sb.rpc('delete_course_meeting', { p_plan_id: state.planId, p_id: id }).then(({ data, error }) => {
    if (error || !data || !data.ok) { toast('Could not remove that meeting'); return; }
    state.meetings = state.meetings.filter(m => m.id !== id);
    renderMeetingsEditor();
    renderTimetable();
  });
}

/* ---------- plan-level field edits ---------- */
function persistPlanFields(){
  return sb.rpc('update_academic_plan', {
    p_plan_id: state.planId,
    p_title: state.plan.title,
    p_major: state.plan.major,
    p_total_credits_required: state.plan.total_credits_required,
    p_terms: state.plan.terms
  });
}
$('#pf-title').addEventListener('change', e => { state.plan.title = e.target.value.trim() || 'My four-year plan'; persistPlanFields(); touchRecent(state.planId, state.plan.title, state.plan.major); });
$('#pf-major').addEventListener('change', e => { state.plan.major = e.target.value.trim(); persistPlanFields(); touchRecent(state.planId, state.plan.title, state.plan.major); });
$('#pf-credits').addEventListener('change', e => {
  const v = Number(e.target.value);
  state.plan.total_credits_required = isNaN(v) ? 0 : v;
  persistPlanFields();
  renderProgress();
});

function renameTerm(idx, value){
  const terms = state.plan.terms.slice();
  terms[idx] = value.trim() || terms[idx];
  state.plan.terms = terms;
  persistPlanFields();
  renderTimetableTermOptions();
  renderMarksTermOptions();
}

function addTerm(){
  const terms = state.plan.terms.slice();
  terms.push('New term');
  state.plan.terms = terms;
  persistPlanFields().then(() => { renderTerms(); renderTimetableTermOptions(); renderMarksTermOptions(); });
}

function removeLastTerm(){
  const terms = state.plan.terms;
  if (terms.length <= 1) { toast('You need at least one term'); return; }
  const idx = terms.length - 1;
  const hasCourses = state.courses.some(c => c.term_index === idx);
  if (hasCourses && !confirm(`"${terms[idx]}" still has courses in it. Remove it anyway? Those courses will stay on the plan but hidden until you add the term back.`)) return;
  state.plan.terms = terms.slice(0, -1);
  persistPlanFields().then(() => { renderTerms(); renderTimetableTermOptions(); renderTimetable(); renderMarksTermOptions(); renderMarks(); });
}

/* ---------- requirement categories ---------- */
function toggleAddRequirement(){
  const f = $('#req-form');
  f.hidden = !f.hidden;
  if (!f.hidden){ $('#req-name').value = ''; $('#req-credits').value = ''; $('#req-name').focus(); }
}
function submitRequirement(){
  const name = $('#req-name').value.trim();
  const credits = Number($('#req-credits').value) || 0;
  if (!name) { toast('Give the category a name'); return; }
  sb.rpc('add_requirement', { p_plan_id: state.planId, p_name: name, p_credits_required: credits }).then(({ data, error }) => {
    if (error || !data || !data.ok) { toast('Could not add category'); return; }
    state.requirements.push({ id: data.id, plan_id: state.planId, name, credits_required: credits, sort_order: state.requirements.length });
    $('#req-form').hidden = true;
    renderRequirements();
    renderProgress();
    refreshCourseModalReqOptions();
  });
}
function editRequirement(id){
  const r = state.requirements.find(x => x.id === id);
  if (!r) return;
  const name = prompt('Category name', r.name);
  if (name === null) return;
  const creditsStr = prompt('Credits required', r.credits_required);
  if (creditsStr === null) return;
  const credits = Number(creditsStr) || 0;
  sb.rpc('update_requirement', { p_plan_id: state.planId, p_id: id, p_name: name.trim() || r.name, p_credits_required: credits }).then(({ data, error }) => {
    if (error || !data || !data.ok) { toast('Could not update category'); return; }
    r.name = name.trim() || r.name;
    r.credits_required = credits;
    renderRequirements();
    renderProgress();
    renderTerms();
  });
}
function deleteRequirementConfirm(id){
  const r = state.requirements.find(x => x.id === id);
  if (!r) return;
  if (!confirm(`Delete "${r.name}"? Courses linked to it keep their credits but lose the category tag.`)) return;
  sb.rpc('delete_requirement', { p_plan_id: state.planId, p_id: id }).then(({ data, error }) => {
    if (error || !data || !data.ok) { toast('Could not delete category'); return; }
    state.requirements = state.requirements.filter(x => x.id !== id);
    state.courses.forEach(c => { if (c.requirement_id === id) c.requirement_id = null; });
    renderRequirements();
    renderProgress();
    renderTerms();
    refreshCourseModalReqOptions();
  });
}

/* ---------- course modal ---------- */
function refreshCourseModalReqOptions(){
  const sel = $('#cm-req');
  const current = sel.value;
  sel.innerHTML = '<option value="">— None —</option>' +
    state.requirements.map(r => `<option value="${r.id}">${escHTML(r.name)}</option>`).join('');
  sel.value = current;
}

function openCourseModal(termIndex, courseId){
  addingToTermIndex = termIndex;
  editingCourseId = courseId || null;
  refreshCourseModalReqOptions();
  if (courseId){
    const c = state.courses.find(x => x.id === courseId);
    $('#cm-title').textContent = 'Edit course';
    $('#cm-code').value = c.code || '';
    $('#cm-name').value = c.title || '';
    $('#cm-credits').value = c.credits;
    $('#cm-status').value = c.status;
    $('#cm-req').value = c.requirement_id || '';
    $('#cm-grade').value = c.grade || '';
    $('#cm-notes').value = c.notes || '';
    $('#cm-section').value = c.section || '';
    $('#cm-delete').hidden = false;
  } else {
    $('#cm-title').textContent = 'Add course';
    $('#cm-code').value = '';
    $('#cm-name').value = '';
    $('#cm-credits').value = 3;
    $('#cm-status').value = 'planned';
    $('#cm-req').value = '';
    $('#cm-grade').value = '';
    $('#cm-notes').value = '';
    $('#cm-section').value = '';
    $('#cm-delete').hidden = true;
  }
  renderMeetingsEditor();
  $('#scrim').classList.add('show');
  $('#course-modal').classList.add('show');
  $('#cm-name').focus();
}
function closeModal(){
  $('#scrim').classList.remove('show');
  $('#course-modal').classList.remove('show');
}

/* the scrim and Escape sit behind whichever modal is open, so they close
   all of them rather than leaving one stranded without its backdrop */
function closeAnyModal(){
  marksCourseId = null;
  $('#scrim').classList.remove('show');
  $('#course-modal').classList.remove('show');
  $('#marks-modal').classList.remove('show');
  $('#export-modal').classList.remove('show');
}

function submitCourse(){
  const title = $('#cm-name').value.trim();
  if (!title) { toast('Give the course a title'); return; }
  const payload = {
    code: $('#cm-code').value.trim(),
    title,
    credits: Number($('#cm-credits').value) || 0,
    status: $('#cm-status').value,
    requirement_id: $('#cm-req').value || null,
    grade: $('#cm-grade').value.trim(),
    notes: $('#cm-notes').value.trim(),
    section: $('#cm-section').value.trim()
  };

  if (editingCourseId){
    sb.rpc('update_course', {
      p_plan_id: state.planId, p_id: editingCourseId, p_term_index: addingToTermIndex,
      p_code: payload.code, p_title: payload.title, p_credits: payload.credits,
      p_requirement_id: payload.requirement_id,
      p_status: payload.status, p_grade: payload.grade, p_notes: payload.notes,
      p_section: payload.section
    }).then(({ data, error }) => {
      if (error || !data || !data.ok) { toast('Could not save course'); return; }
      const c = state.courses.find(x => x.id === editingCourseId);
      Object.assign(c, payload);
      closeModal();
      renderRequirements(); renderProgress(); renderTerms(); renderTimetable();
    });
  } else {
    sb.rpc('add_course', {
      p_plan_id: state.planId, p_term_index: addingToTermIndex,
      p_code: payload.code, p_title: payload.title, p_credits: payload.credits,
      p_requirement_id: payload.requirement_id, p_status: payload.status,
      p_grade: payload.grade, p_notes: payload.notes, p_section: payload.section
    }).then(({ data, error }) => {
      if (error || !data || !data.ok) { toast('Could not add course'); return; }
      state.courses.push(Object.assign({ id: data.id, plan_id: state.planId, term_index: addingToTermIndex, sort_order: 0 }, payload));
      // reopen on the saved course so its meetings can be added right away
      editingCourseId = data.id;
      $('#cm-title').textContent = 'Edit course';
      $('#cm-delete').hidden = false;
      renderMeetingsEditor();
      toast('Course saved — you can add its meeting times now');
      renderRequirements(); renderProgress(); renderTerms(); renderTimetable();
    });
  }
}

function deleteCourseFromModal(){
  if (!editingCourseId) return;
  if (!confirm('Delete this course?')) return;
  sb.rpc('delete_course', { p_plan_id: state.planId, p_id: editingCourseId }).then(({ data, error }) => {
    if (error || !data || !data.ok) { toast('Could not delete course'); return; }
    state.meetings = state.meetings.filter(m => m.course_id !== editingCourseId);
    state.assessments = state.assessments.filter(a => a.course_id !== editingCourseId);
    state.courses = state.courses.filter(x => x.id !== editingCourseId);
    closeModal();
    renderRequirements(); renderProgress(); renderTerms(); renderTimetable(); renderMarks();
  });
}

document.addEventListener('keydown', e => { if (e.key === 'Escape') closeAnyModal(); });
