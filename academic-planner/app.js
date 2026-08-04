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
let state = { planId: null, plan: null, requirements: [], courses: [] };
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

function createPlan(){
  const title = $('#new-title').value.trim() || 'My four-year plan';
  const major = $('#new-major').value.trim();
  const credits = Number($('#new-credits').value) || 120;
  sb.rpc('create_academic_plan', { p_title: title, p_major: major }).then(({ data, error }) => {
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
    if (error || !data || !data.ok) {
      toast('That plan link doesn’t work anymore');
      goHome();
      return;
    }
    state.planId = id;
    state.plan = data.plan;
    state.requirements = data.requirements || [];
    state.courses = data.courses || [];
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
  return `
    <div class="coursecard" onclick="openCourseModal(${c.term_index}, '${c.id}')">
      <div class="cc-top">
        <span class="cc-code">${escHTML(c.code || '')}</span>
        <span>${fmtCredits(c.credits)} cr</span>
      </div>
      <div class="cc-name">${escHTML(c.title)}</div>
      <div class="cc-meta">
        <span class="badge ${c.status}">${statusLabel}${c.grade ? ' · ' + escHTML(c.grade) : ''}</span>
        ${req ? `<span class="badge cat">${escHTML(req.name)}</span>` : ''}
      </div>
    </div>`;
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
}

function addTerm(){
  const terms = state.plan.terms.slice();
  terms.push('New term');
  state.plan.terms = terms;
  persistPlanFields().then(() => renderTerms());
}

function removeLastTerm(){
  const terms = state.plan.terms;
  if (terms.length <= 1) { toast('You need at least one term'); return; }
  const idx = terms.length - 1;
  const hasCourses = state.courses.some(c => c.term_index === idx);
  if (hasCourses && !confirm(`"${terms[idx]}" still has courses in it. Remove it anyway? Those courses will stay on the plan but hidden until you add the term back.`)) return;
  state.plan.terms = terms.slice(0, -1);
  persistPlanFields().then(() => renderTerms());
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
    $('#cm-delete').hidden = true;
  }
  $('#scrim').classList.add('show');
  $('#course-modal').classList.add('show');
  $('#cm-name').focus();
}
function closeModal(){
  $('#scrim').classList.remove('show');
  $('#course-modal').classList.remove('show');
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
    notes: $('#cm-notes').value.trim()
  };

  if (editingCourseId){
    sb.rpc('update_course', {
      p_plan_id: state.planId, p_id: editingCourseId, p_term_index: addingToTermIndex,
      p_code: payload.code, p_title: payload.title, p_credits: payload.credits,
      p_requirement_id: payload.requirement_id,
      p_status: payload.status, p_grade: payload.grade, p_notes: payload.notes
    }).then(({ data, error }) => {
      if (error || !data || !data.ok) { toast('Could not save course'); return; }
      const c = state.courses.find(x => x.id === editingCourseId);
      Object.assign(c, payload);
      closeModal();
      renderRequirements(); renderProgress(); renderTerms();
    });
  } else {
    sb.rpc('add_course', {
      p_plan_id: state.planId, p_term_index: addingToTermIndex,
      p_code: payload.code, p_title: payload.title, p_credits: payload.credits,
      p_requirement_id: payload.requirement_id, p_status: payload.status,
      p_grade: payload.grade, p_notes: payload.notes
    }).then(({ data, error }) => {
      if (error || !data || !data.ok) { toast('Could not add course'); return; }
      state.courses.push(Object.assign({ id: data.id, plan_id: state.planId, term_index: addingToTermIndex, sort_order: 0 }, payload));
      closeModal();
      renderRequirements(); renderProgress(); renderTerms();
    });
  }
}

function deleteCourseFromModal(){
  if (!editingCourseId) return;
  if (!confirm('Delete this course?')) return;
  sb.rpc('delete_course', { p_plan_id: state.planId, p_id: editingCourseId }).then(({ data, error }) => {
    if (error || !data || !data.ok) { toast('Could not delete course'); return; }
    state.courses = state.courses.filter(x => x.id !== editingCourseId);
    closeModal();
    renderRequirements(); renderProgress(); renderTerms();
  });
}

document.addEventListener('keydown', e => { if (e.key === 'Escape') closeModal(); });
