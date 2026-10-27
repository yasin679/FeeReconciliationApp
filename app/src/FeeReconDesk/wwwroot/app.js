/* Fee Reconciliation Desk — screens.
   SERVER mode: every action is sent to the C# server, which checks permissions and saves; this page only displays.
   Demo mode (published preview): the same screens run on the in-browser engine with a role switcher. */
'use strict';
const SERVER = !window.FRD_DEMO;
const INSTITUTION = 'Your institution';
const $ = s => document.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const dt = d => { try { return new Date(d).toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', hour12: false }); } catch (e) { return d; } };
const dOnly = d => { try { return new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }); } catch (e) { return d; } };
const ageOf = d => { const h = Math.max(0, (Date.now() - new Date(d).getTime()) / 36e5); return h < 24 ? Math.round(h) + 'h' : Math.floor(h / 24) + 'd'; };
const pill = (tone, text) => `<span class="pill ${tone}">${esc(text)}</span>`;
const amt = n => `<span class="amt${n < 0 ? ' neg' : ''}">${fmt(n)}</span>`;
const sname = id => (E.student(id)?.name || id);
const val = id => (document.getElementById(id)?.value ?? '').trim();

/* ---------------- state ---------------- */
let E = null;           // engine: hydrated from the server, or the live demo engine
let ME = null;          // signed-in user (server) or chosen role (demo)
let CSRF = '';
const UI = { role: 'ops', view: 'overview', sel: null, filter: 'needs', q: '', ledgerSid: 'S103', ed: null, simTab: 'bank', auditQ: '', tests: null, auditCheck: null, users: null, loading: false };

function demoSeed(opts) {
  const e = seededEngine(opts);
  e.clock = '2026-10-20T11:30:00'; const r = e.propose('ops', 'P3', [{ sid: 'S103', comp: 'Tuition', amount: 15000 }], 'Valid student ID S103 in UPI reference; student confirmed tuition instalment');
  e.clock = '2026-10-20T15:05:00'; if (r.ok) e.approve('finapp', r.prop.id, 'Reference verified');
  e.clock = null; e.demoMode = true;
  return e;
}
function demoMe() {
  const r = UI.role; const stu = r.startsWith('student:');
  const role = stu ? 'student' : r;
  return { id: r, name: stu ? (E.student(r.split(':')[1])?.name || r) : ROLES[r].person, role, roleLabel: ROLES[role]?.label || role, studentId: stu ? r.split(':')[1] : null, perms: Object.keys(PERMS).filter(p => PERMS[p].includes(role)).concat(role === 'student' ? [] : ['demoTools']) };
}
const actor = () => SERVER ? ME.id : UI.role;
const isStudent = () => ME?.role === 'student';
const meSid = () => ME?.studentId || null;
const can = p => !!ME && ME.perms.includes(p);

/* ---------------- server calls ---------------- */
async function http(method, url, body) {
  const opt = { method, headers: { 'Accept': 'application/json' }, credentials: 'same-origin' };
  if (method !== 'GET') { opt.headers['Content-Type'] = 'application/json'; opt.headers['X-CSRF-TOKEN'] = CSRF; opt.body = JSON.stringify(body || {}); }
  const res = await fetch(url, opt);
  if (res.status === 401 && url !== '/api/login') { ME = null; renderLogin('Your session ended. Please sign in again.'); throw new Error('signed-out'); }
  if (res.status === 429) return { ok: false, error: 'Too many requests. Wait a minute and try again.' };
  if (res.status === 403) return { ok: false, error: 'You do not have access to that.' };
  let j = null; try { j = await res.json(); } catch (e) { j = { ok: res.ok }; }
  return j;
}
async function refreshCsrf() { const r = await fetch('/api/csrf', { credentials: 'same-origin' }); CSRF = (await r.json()).token; }
async function loadState() {
  const r = await fetch('/api/state', { credentials: 'same-origin', headers: { 'Accept': 'application/json' } });
  if (r.status === 401) { ME = null; return false; }
  const snap = await r.json();
  const e = new Engine(snap.settings || {});
  e.settings = { ...e.settings, ...(snap.settings || {}) };
  for (const k of ['students', 'txns', 'allocs', 'proposals', 'ledger', 'receipts', 'cases', 'audit']) e[k] = snap[k] || [];
  e.can = (a, p) => ME.perms.includes(p);
  e.demoMode = !!snap.demo;
  PEOPLE = snap.people || {};
  ME = snap.me; E = e;
  return true;
}

// Demo-engine equivalents of each server action, so the same buttons work in the published preview.
const DEMO = {
  propose: a => E.propose(actor(), a.txnId, a.rows, a.reason, a.evidence, a.version),
  approve: a => E.approve(actor(), a.propId, a.note), reject: a => E.reject(actor(), a.propId, a.reason), retry: a => E.retry(actor(), a.propId),
  applyReversal: a => E.applyReversal(actor(), a.txnId, a.note), closeReversal: a => E.closeReversal(actor(), a.txnId, a.note), relinkReversal: a => E.relinkReversal(actor(), a.txnId),
  closeConflict: a => E.closeConflict(actor(), a.txnId, a.note),
  recordCashEvidence: a => E.recordCashEvidence(actor(), a.txnId, { sid: a.sid, receiptBook: a.receiptBook, depositRef: a.depositRef }),
  verifyCash: a => E.verifyCash(actor(), a.txnId, a.confirmed),
  requestCorrection: a => E.requestCorrection(actor(), a.allocId, a.reason), correct: a => E.correct(actor(), a.allocId), rejectCorrection: a => E.rejectCorrection(actor(), a.allocId, a.note),
  requestEvidence: a => E.requestEvidence(actor(), a.txnId, a.text), escalate: a => E.escalate(actor(), a.txnId, a.text),
  recheckClaim: a => E.recheckClaim(actor(), a.txnId), retryLookup: a => E.retryLookup(actor(), a.txnId),
  submitClaim: a => E.submitClaim(actor(), { utr: a.utr, amount: a.amount, payerName: a.payerName, file: a.file }),
  raiseCase: a => E.raiseCase(actor(), { ref: a.ref, text: a.text }), resolveCase: a => E.resolveCase(actor(), a.id, a.note),
  setPolicy: a => a.key === 'smsFail' ? (E.settings.smsFail = a.value === 'true', { ok: true }) : E.setPolicy(actor(), a.key, a.key === 'maxOpenClaims' ? +a.value : a.key === 'autoMatch' ? a.value === 'true' : a.value),
  reportCash: a => { const t = E.ingest({ source: 'cash', sourceTxnId: 'CASH-RPT-' + pad(E.txns.length + 40, 4), channel: 'Cash', amount: +a.amount, studentHint: a.sid || null, remark: a.remark || 'Cash collected', batch: 'Counsellor entry' }, actor()); return t ? { ok: true, data: { txn: t.id } } : { ok: false, error: 'Invalid amount' }; },
  registerStudent: a => E.registerStudent('system', { id: a.id, name: a.name }),
};

/** Runs an action, refreshes the screen and shows the outcome. */
async function run(name, args, okMsg) {
  if (UI.loading) return { ok: false };
  let r;
  try {
    UI.loading = true;
    if (SERVER) { r = await http('POST', '/api/act/' + name, args); await loadState(); }
    else { r = DEMO[name](args); if (r && r.ok && !('data' in r)) r.data = { prop: r.prop?.id, failed: r.failed, noop: r.noop, linked: r.linked, state: r.state, txn: r.txn?.id }; }
  } catch (e) { if (e.message === 'signed-out') return { ok: false }; r = { ok: false, error: 'The server could not be reached. Check that the app is still running.' }; }
  finally { UI.loading = false; }
  if (r && r.ok) { const msg = typeof okMsg === 'function' ? okMsg(r.data || {}) : okMsg; if (r.data?.failed) toast('Approved, but the student system timed out. Nothing posted; retry is safe.', true); else if (msg) toast(msg); }
  else toast(r?.error || 'Action failed', true);
  render();
  return r || { ok: false };
}

/* ---------------- navigation ---------------- */
const NAV = [
  { group: 'Workspace', items: [
    { id: 'overview', label: 'Overview', staff: true },
    { id: 'queue', label: 'Unmatched payments', count: () => E.txns.filter(t => ['review', 'verify', 'approval', 'rev', 'conflict'].includes(E.status(t).key)).length, staff: true },
    { id: 'detail', label: 'Reconciliation detail', staff: true },
    { id: 'ledger', label: 'Fee ledger', label2: 'My fee ledger' },
    { id: 'audit', label: 'Audit log', count: () => E.audit.length, staff: true, perm: 'viewAudit' },
  ] },
  { group: 'Administration', items: [
    { id: 'policy', label: 'Policy controls', staff: true },
    { id: 'users', label: 'Users and roles', staff: true, perm: 'users', server: true },
    { id: 'check', label: 'System check', staff: true, perm: 'selftest' },
    { id: 'workflow', label: 'How it works' },
  ] },
];
function renderTop() {
  const box = $('#who');
  if (SERVER) {
    box.innerHTML = ME ? `<div class="whoami"><div><b>${esc(ME.name)}</b><span>${esc(ME.roleLabel)}${ME.studentId ? ' · ' + esc(ME.studentId) : ''}</span></div><button class="btn sm" data-act="my-password">Password</button><button class="btn sm" data-act="logout">Sign out</button></div>` : '';
  } else {
    const staff = ['ops', 'counsellor', 'finrev', 'finapp', 'admin'].map(r => `<option value="${r}">${ROLES[r].label} · ${ROLES[r].person}</option>`).join('');
    const studs = E.students.map(s => `<option value="student:${s.id}">Student · ${esc(s.name)} (${s.id})</option>`).join('');
    box.innerHTML = `<div class="rolebox"><label for="role">Acting as</label><select id="role" aria-label="Switch role"><optgroup label="Staff">${staff}</optgroup><optgroup label="Student portal">${studs}</optgroup></select></div>`;
    $('#role').value = UI.role;
  }
  const tools = [];
  if (ME && (can('importBank') || can('reportCash') || can('students') || !SERVER) && !isStudent()) tools.push(`<button class="btn" data-act="sim-open" id="btn-sim">${SERVER ? 'Add payments' : 'Simulate incoming event'}</button>`);
  if (!SERVER) tools.push('<button class="btn" data-act="reset" id="btn-reset">Reset demo</button>');
  $('#tools').innerHTML = tools.join('');
}
function renderNav() {
  $('#side').innerHTML = NAV.map(g => `<div class="navgroup"><h4>${g.group}</h4>${g.items.filter(i => !(i.staff && isStudent()) && !(i.perm && !can(i.perm)) && !(i.server && !SERVER)).map(i => `<button class="nav${UI.view === i.id ? ' on' : ''}" data-go="${i.id}"><span>${isStudent() && i.label2 ? i.label2 : i.label}</span>${i.count ? `<span class="cnt">${i.count()}</span>` : ''}</button>`).join('')}</div>`).join('') +
    `<p class="sidefoot">${SERVER ? (E.demoMode ? 'Sample data is loaded. An administrator can switch it off in appsettings.json.' : 'Fee Reconciliation Desk 1.0') : 'Preview with sample data. Changes stay in this browser tab; Reset restores the sample.'}</p>`;
}
function go(view, sel) {
  if (sel !== undefined) { if (view === 'detail') UI.sel = sel; if (view === 'ledger') UI.ledgerSid = sel; }
  UI.view = view;
  const h = view === 'detail' && UI.sel ? 'detail-' + UI.sel : view === 'ledger' && UI.ledgerSid ? 'ledger-' + UI.ledgerSid : view;
  try { if (location.hash !== '#' + h) history.replaceState(null, '', '#' + h); } catch (e) {}
  render(); window.scrollTo({ top: 0 });
  if (view === 'users' && SERVER) loadUsers();
  if (view === 'check' && !UI.tests) loadTests();
}
function fromHash() {
  const h = (location.hash || '').slice(1); if (!h) return;
  const [v, ...rest] = h.split('-'); const arg = rest.join('-');
  if (Object.prototype.hasOwnProperty.call(VIEWS, v)) { UI.view = v; if (v === 'detail' && arg) UI.sel = arg; if (v === 'ledger' && arg) UI.ledgerSid = arg; }
}
function render() {
  if (!ME) return renderLogin();
  if (!Object.prototype.hasOwnProperty.call(VIEWS, UI.view)) UI.view = 'overview';
  if (isStudent() && ['queue', 'detail', 'audit', 'policy', 'users', 'check'].includes(UI.view)) UI.view = 'ledger';
  if (UI.view === 'audit' && !can('viewAudit')) UI.view = 'queue';
  if (UI.view === 'users' && (!SERVER || !can('users'))) UI.view = 'overview';
  if (UI.view === 'check' && !can('selftest')) UI.view = 'overview';
  $('#shell').hidden = false; $('#login').hidden = true;
  renderTop(); renderNav();
  $('#view').innerHTML = VIEWS[UI.view]();
  if (UI.view === 'detail') bindEditor();
}
function toast(msg, err) { const t = $('#toast'); t.textContent = msg; t.className = 'toast' + (err ? ' err' : ''); t.hidden = false; clearTimeout(toast._t); toast._t = setTimeout(() => t.hidden = true, err ? 5200 : 3200); }
const btn = (label, act, opts = {}) => {
  const dis = opts.why ? ' disabled' : '';
  return `<span class="field" style="gap:2px"><button class="btn ${opts.cls || ''}${opts.sm ? ' sm' : ''}" data-act="${act}"${opts.data ? ' ' + opts.data : ''}${dis} title="${esc(opts.why || '')}">${label}</button>${opts.why && !opts.quiet ? `<span class="why">${esc(opts.why)}</span>` : ''}</span>`;
};

/* ---------------- sign-in ---------------- */
function renderLogin(msg) {
  $('#shell').hidden = true; $('#login').hidden = false; $('#who').innerHTML = ''; $('#tools').innerHTML = '';
  $('#login').innerHTML = `<form class="card raised" id="login-form" autocomplete="on">
    <div><div class="eyebrow">Fee Reconciliation Desk</div><h2>Sign in</h2></div>
    <div class="field"><label for="li-user">User name</label><input id="li-user" name="username" type="text" autocomplete="username" required maxlength="64"></div>
    <div class="field"><label for="li-pass">Password</label><input id="li-pass" name="password" type="password" autocomplete="current-password" required maxlength="128"></div>
    ${msg ? `<div class="callout bad"><span>${esc(msg)}</span></div>` : ''}
    <button class="btn primary" type="submit">Sign in</button>
    <p class="small muted">Accounts are created by an administrator. After 5 wrong passwords an account is locked for 10 minutes.</p>
  </form>`;
  setTimeout(() => $('#li-user')?.focus(), 0);
}
async function doLogin() {
  const r = await http('POST', '/api/login', { userName: val('li-user'), password: $('#li-pass').value }).catch(() => ({ ok: false, error: 'The server could not be reached.' }));
  if (!r.ok) return renderLogin(r.error || 'Sign-in failed');
  await refreshCsrf(); await loadState(); UI.view = isStudent() ? 'ledger' : 'overview'; fromHash(); render();
}

/* ---------------- Overview ---------------- */
function vOverview() {
  if (isStudent()) { UI.view = 'ledger'; return vLedger(); }
  const T = E.totals();
  const rows = E.txns.map(t => ({ t, s: E.status(t) }));
  const k = key => rows.filter(r => r.s.key === key).length;
  return `
  <div class="pagehead"><div><div class="eyebrow">Overview</div><h2>Good to see you, ${esc(ME.name.split(' ')[0])}</h2><p class="lede">Payments in from the bank, cash desk and students, matched to the right student and fee, approved by a second person, posted once and receipted once.</p></div>
    <div class="actions"><button class="btn primary" data-go="queue">Open unmatched payments</button></div></div>
  <div class="kpis">
    <button class="kpi t-bad" data-go="queue" data-filter="review"><span class="k">To match or allocate</span><span class="v">${k('review')}</span><span class="s">${fmt(T.unalloc)} unallocated</span></button>
    <button class="kpi t-warn" data-go="queue" data-filter="verify"><span class="k">Awaiting verification</span><span class="v">${k('verify')}</span><span class="s">${fmt(T.unverified + T.claimed)} claimed</span></button>
    <button class="kpi t-info" data-go="queue" data-filter="approval"><span class="k">Awaiting approval</span><span class="v">${k('approval')}</span><span class="s">${fmt(T.pending)}</span></button>
    <button class="kpi t-rev" data-go="queue" data-filter="rev"><span class="k">Reversals and conflicts</span><span class="v">${k('rev') + k('conflict')}</span><span class="s">need Finance</span></button>
  </div>
  <section class="grid2">
    <div class="card raised">
      <h4>Books check</h4>
      <div class="kv">
        <dt>Verified money received</dt><dd>${amt(T.feedGross)}</dd>
        <dt>Reversals applied</dt><dd>${amt(-T.reversed)}</dd>
        <dt>Posted to student ledgers</dt><dd>${amt(T.posted)}</dd>
        <dt>Awaiting approval</dt><dd>${amt(T.pending)}</dd>
        <dt>Verified, not yet allocated</dt><dd>${amt(T.unalloc)}</dd>
        <dt>Claimed or reported, unverified</dt><dd>${amt(T.unverified + T.claimed)} <span class="small muted">(excluded)</span></dd>
      </div>
      <div class="callout ${T.diff === 0 ? 'ok' : 'bad'}"><b>Control difference ${fmt(T.diff)}</b><span>Verified money always equals posted + pending + unallocated.</span></div>
    </div>
    <div class="card">
      <h4>How a payment moves</h4>
      <ol class="steps">
        <li><div><b>Verified.</b> Money is confirmed in the bank statement Finance imports, or a cash deposit Finance has matched. Screenshots never count.</div></li>
        <li><div><b>Matched.</b> A valid student ID in the bank reference matches automatically. Names and phone numbers only suggest a student.</div></li>
        <li><div><b>Allocated.</b> Operations splits the money across students and fee components, never more than was received.</div></li>
        <li><div><b>Posted.</b> A different Finance approver approves; the ledger is written exactly once.</div></li>
        <li><div><b>Receipted.</b> One receipt per posted line. Reversals and corrections adjust it; nothing is deleted.</div></li>
      </ol>
    </div>
  </section>
  ${!SERVER ? `<div class="note"><b>Preview.</b> This page runs the full rules on sample data in your browser. Switch roles at the top to see what each person can do. The installed version adds real sign-in, server-side permissions and a saved, tamper-evident audit log.</div>` : ''}`;
}

/* ---------------- System check ---------------- */
async function loadTests() {
  if (SERVER) { const r = await fetch('/api/selftest', { credentials: 'same-origin' }); UI.tests = r.ok ? (await r.json()).map(t => ({ id: t.id, ac: t.ac, name: t.name, pass: t.pass, err: t.error, checks: t.checks.map(c => ({ d: c.description, v: c.passed })) })) : []; }
  else UI.tests = runTests();
  if (UI.view === 'check') render();
}
function vCheck() {
  const R = UI.tests;
  if (!R) return `<div class="empty">Running checks…</div>`;
  const passed = R.filter(r => r.pass).length;
  return `<div class="pagehead"><div><div class="eyebrow">Administration</div><h2>System check</h2><p class="lede">${SERVER ? 'The server runs every financial control against a fresh in-memory copy of the sample book. Live data is never touched.' : 'Every financial control, run against a fresh copy of the sample book.'}</p></div>
    <div class="actions"><span class="badge-test ${passed === R.length ? 'pass' : 'fail'}">${passed}/${R.length} passing</span><button class="btn sm" data-act="tests">Run again</button></div></div>
  <div class="card">${R.map(r => `<details class="tc cand"><summary><div class="row"><span><b class="mono">${esc(r.id)}</b> ${esc(r.name)}</span><span class="badge-test ${r.pass ? 'pass' : 'fail'}">${r.pass ? 'PASS' : 'FAIL'} · ${esc(r.ac)}</span></div></summary><ul class="checks">${r.checks.map(k => `<li class="${k.v ? 'y' : 'n'}">${esc(k.d)}</li>`).join('')}${r.err ? `<li class="n">Error: ${esc(r.err)}</li>` : ''}</ul></details>`).join('')}</div>
  <div class="card"><h3>Acceptance criteria</h3><div class="tablewrap" style="border:0"><table class="tbl compact"><tbody>${ACS.map(a => { const ts = R.filter(r => r.ac === a[0]); const ok = ts.length && ts.every(r => r.pass); return `<tr><td class="mono">${a[0]}</td><td class="small wrap">${esc(a[1])}</td><td style="white-space:nowrap">${ts.map(r => `<span class="badge-test ${r.pass ? 'pass' : 'fail'}">${esc(r.id)}</span>`).join(' ')}</td><td>${ts.length ? pill(ok ? 'ok' : 'bad', ok ? 'Passing' : 'Failing') : ''}</td></tr>`; }).join('')}</tbody></table></div></div>`;
}

/* ---------------- Users and roles (server) ---------------- */
const ROLE_OPTIONS = [['ops', 'Operations executive'], ['counsellor', 'Counsellor'], ['finrev', 'Finance reviewer'], ['finapp', 'Finance approver'], ['admin', 'Administrator']];
async function loadUsers() {
  const r = await fetch('/api/users', { credentials: 'same-origin' }); UI.users = r.ok ? await r.json() : [];
  // Refresh only the table, so anything typed in the Add user form is kept.
  const box = document.getElementById('user-list'); if (UI.view === 'users' && box) box.innerHTML = usersTable(); else if (UI.view === 'users') render();
}
function vUsers() {
  const U = UI.users;
  return `<div class="pagehead"><div><div class="eyebrow">Administration</div><h2>Users and roles</h2><p class="lede">Each person needs their own account, so the audit log and the two-person checks know who did what. New and reset passwords are shown once; share them securely.</p></div></div>
  <div class="card"><h3>Add a user</h3>
    <div class="fields">
      <div class="field"><label for="nu-user">User name</label><input id="nu-user" type="text" maxlength="32" placeholder="e.g. sneha"></div>
      <div class="field"><label for="nu-name">Display name</label><input id="nu-name" type="text" maxlength="60" placeholder="e.g. Sneha P."></div>
      <div class="field"><label for="nu-role">Role</label><select id="nu-role">${ROLE_OPTIONS.map(r => `<option value="${r[0]}">${r[1]}</option>`).join('')}<option value="student">Student</option></select></div>
      <div class="field"><label for="nu-sid">Student ID (students only)</label><select id="nu-sid"><option value="">—</option>${E.students.map(s => `<option value="${s.id}">${s.id} · ${esc(s.name)}</option>`).join('')}</select></div>
    </div>
    <div class="actions"><button class="btn primary sm" data-act="user-add">Add user</button></div>
  </div>
  <div id="user-list">${usersTable()}</div>`;
}
function usersTable() {
  const U = UI.users;
  return `<div class="tablewrap"><table class="tbl"><thead><tr><th>User</th><th>Role</th><th>Status</th><th>Last sign-in</th><th></th></tr></thead><tbody>
    ${!U ? '<tr><td colspan="5"><div class="empty">Loading…</div></td></tr>' : U.map(u => `<tr>
      <td><b>${esc(u.displayName)}</b><div class="mono small faint">${esc(u.userName)}</div></td>
      <td>${u.role === 'student' ? `Student · ${esc(u.studentId)}` : `<select data-user-role="${esc(u.id)}" aria-label="Role for ${esc(u.userName)}">${ROLE_OPTIONS.map(r => `<option value="${r[0]}"${u.role === r[0] ? ' selected' : ''}>${r[1]}</option>`).join('')}</select>`}</td>
      <td>${u.enabled ? (u.locked ? pill('warn', 'Locked') : pill('ok', 'Active')) : pill('muted', 'Disabled')}</td>
      <td class="small">${u.lastSignIn ? dt(u.lastSignIn) : '<span class="faint">Never</span>'}</td>
      <td><div class="actions">${u.id === ME.id ? '<span class="small muted">You</span>' : `<button class="btn sm" data-act="user-reset" data-id="${esc(u.id)}">Reset password</button>${u.enabled ? `<button class="btn sm danger" data-act="user-disable" data-id="${esc(u.id)}">Disable</button>` : `<button class="btn sm" data-act="user-enable" data-id="${esc(u.id)}">Enable</button>`}`}</div></td></tr>`).join('')}
  </tbody></table></div>`;
}
async function userOp(op, body, msg) {
  const r = await http('POST', '/api/users/' + op, body);
  if (r.ok) { if (r.data?.tempPassword) secretModal(msg, r.data.tempPassword); else toast(msg); await loadUsers(); }
  else toast(r.error || 'Failed', true);
}
function secretModal(title, secret) {
  openModal(`<div class="cardhead"><h3>${esc(title)}</h3><button class="btn sm x" data-act="close">Close</button></div>
  <p class="small">Temporary password. It is shown only now; give it to the person through a secure channel.</p>
  <div class="secret" id="secret">${esc(secret)}</div>
  <div class="actions"><button class="btn sm" data-act="copy-secret">Copy</button></div>`);
}
function passwordModal() {
  openModal(`<form id="pw-form"><div class="cardhead"><h3>Change your password</h3><button class="btn sm x" type="button" data-act="close">Close</button></div>
  <div class="field"><label for="pw-cur">Current password</label><input id="pw-cur" type="password" autocomplete="current-password" required></div>
  <div class="field"><label for="pw-new">New password</label><input id="pw-new" type="password" autocomplete="new-password" required minlength="10" maxlength="128"><span class="why">At least 10 characters, with three of: upper case, lower case, digits, symbols.</span></div>
  <div class="actions" style="margin-top:12px"><button class="btn primary" type="submit">Change password</button></div></form>`);
}

/* ---------------- Add payments (server) ---------------- */
function addModal() {
  const tabs = [can('importBank') && ['bank', 'Import bank statement'], can('reportCash') && ['cash', 'Report cash collection'], can('students') && ['reg', 'Add student']].filter(Boolean);
  if (!tabs.length) return toast('Your role cannot add payments.', true);
  if (!tabs.some(t => t[0] === UI.simTab)) UI.simTab = tabs[0][0];
  const tab = UI.simTab;
  openModal(`<div class="cardhead"><h3>Add payments</h3><button class="btn sm x" data-act="close">Close</button></div>
  <div class="tabs">${tabs.map(([k, l]) => `<button class="${tab === k ? 'on' : ''}" data-act="sim-tab" data-tab="${k}">${l}</button>`).join('')}</div>
  ${tab === 'bank' ? `<p class="small muted">Upload the statement exported from the college bank account (CSV). Only Finance can import, because this is the one route by which bank money enters the system. Re-importing the same file is safe: duplicates are detected.</p>
    <div class="filedrop"><label for="bk-file"><b>Bank statement CSV</b></label><input id="bk-file" type="file" accept=".csv,text/csv"><span class="small muted">Columns: <span class="mono">TransactionId, Date, Amount, PayerName, PayerContact, Remark, ReversalOf, Channel</span>. Only the first two are required. Reversals have a negative amount.</span></div>
    <details><summary class="small">Example file</summary><pre class="mono small" style="white-space:pre-wrap">TransactionId,Date,Amount,PayerName,PayerContact,Remark,ReversalOf
UPI/430911223344,2026-10-26,12000,S Kapoor,9081,S101 tuition,
RVSL/430799000002,2026-10-26,-2000,,,Partial reversal,UPI/430911223344</pre></details>
    <div class="actions"><button class="btn primary" data-act="bank-import">Import</button></div>` : ''}
  ${tab === 'cash' ? `<p class="small muted">Record cash collected at the desk. It stays out of every balance until Finance matches the bank deposit; you cannot verify your own collection.</p>
    <div class="fields"><div class="field"><label for="s-camt">Amount (₹)</label><input id="s-camt" inputmode="numeric" placeholder="8000"></div>
    <div class="field"><label for="s-csid">Collected for</label><select id="s-csid"><option value="">Not stated</option>${E.students.map(s => `<option value="${s.id}">${s.id} · ${esc(s.name)}</option>`).join('')}</select></div>
    <div class="field" style="grid-column:1/-1"><label for="s-cnote">Note</label><input id="s-cnote" type="text" maxlength="300" placeholder="e.g. Collected at front desk, receipt book CRB-0915"></div></div>
    <div class="actions"><button class="btn primary" data-act="sim-cash">Record cash report</button></div>` : ''}
  ${tab === 'reg' ? `<p class="small muted">Normally students come from the student-management system. Use this when a registration arrives late; payments held for that ID can then be retried.</p>
    <div class="fields"><div class="field"><label for="s-rid">Student ID</label><input id="s-rid" type="text" placeholder="S105" maxlength="4"></div><div class="field"><label for="s-rname">Name</label><input id="s-rname" type="text" maxlength="80"></div>
    <div class="field"><label for="s-rcon">Contact (last 4 digits)</label><input id="s-rcon" inputmode="numeric" maxlength="4"></div><div class="field"><label for="s-rgua">Guardian contact (last 4)</label><input id="s-rgua" inputmode="numeric" maxlength="4"></div></div>
    <div class="actions"><button class="btn primary" data-act="sim-reg">Add student</button></div>` : ''}`);
}
/* ---------------- Unmatched queue ---------------- */
const FILTERS = [
  { id: 'needs', label: 'Needs action', test: k => ['review', 'verify', 'approval', 'rev', 'conflict'].includes(k) },
  { id: 'review', label: 'To match or allocate', test: k => k === 'review' },
  { id: 'verify', label: 'Awaiting verification', test: k => k === 'verify' },
  { id: 'approval', label: 'Awaiting approval', test: k => k === 'approval' },
  { id: 'rev', label: 'Reversals', test: k => k === 'rev' },
  { id: 'dup', label: 'Duplicates', test: k => k === 'dup' || k === 'conflict' },
  { id: 'done', label: 'Resolved', test: k => k === 'done' },
  { id: 'all', label: 'All', test: () => true },
];
function nextAction(t) {
  const s = E.status(t);
  const m = { 'Duplicate — not posted': 'None. Linked to ' + t.duplicateOf, 'Matched — choose fee component': 'Propose fee component', 'Split — propose lines': 'Confirm split lines', 'Candidate — needs evidence': 'Get corroborating evidence', 'Unmatched — no identifier': 'Investigate payer', 'Awaiting approval': 'Finance approval', 'Posting failed — retry': 'Retry posting', 'Cash — unverified': 'Attach receipt + deposit slip', 'Cash — evidence with Finance': 'Verify deposit', 'Claim — not in bank records': 'Request UTR / re-check feed', 'Reversal — awaiting approval': 'Approve reversal', 'Reversal exception': 'Investigate with bank', 'Reference not in student system': 'Retry after registration sync', 'Same ID, different amount': 'Confirm true record with bank', 'Strong candidate — confirm and allocate': 'Confirm student, allocate', 'Reversal closed — not applied': '—' };
  return m[s.label] || (s.key === 'done' ? '—' : 'Review');
}
function vQueue() {
  const rows = E.txns.map(t => ({ t, s: E.status(t) }));
  const kp = k => rows.filter(r => r.s.key === k);
  const sumA = arr => arr.reduce((s, r) => s + (r.t.kind === 'reversal' ? r.t.amount : (r.t.kind === 'claim' ? 0 : E.allocatable(r.t) || r.t.amount)), 0);
  const f = FILTERS.find(x => x.id === UI.filter) || FILTERS[0];
  const q = UI.q.toLowerCase();
  const shown = rows.filter(r => f.test(r.s.key)).filter(r => !q || [r.t.id, r.t.sourceTxnId, r.t.payerName, r.t.remark, r.t.channel, r.s.label, ...r.t.candidates.map(c => c.sid + ' ' + sname(c.sid))].join(' ').toLowerCase().includes(q));
  const T = E.totals();
  const openCases = E.cases.filter(c => c.status === 'open');
  return `
  <div class="pagehead"><div><div class="eyebrow">Operations</div><h2>Unmatched payments</h2><p class="lede">Every payment event that needs a person, with the evidence gap and next step on each row. Candidate students are suggestions with a reason, never confirmations.</p></div></div>
  <div class="kpis">
    <button class="kpi t-bad" data-filter="review"><span class="k">Verified, not yet allocated</span><span class="v">${kp('review').length}</span><span class="s">${fmt(kp('review').reduce((s, r) => s + E.allocatable(r.t), 0))}</span></button>
    <button class="kpi t-warn" data-filter="verify"><span class="k">Awaiting verification</span><span class="v">${kp('verify').length}</span><span class="s">${fmt(kp('verify').reduce((s, r) => s + r.t.amount, 0))} claimed</span></button>
    <button class="kpi t-info" data-filter="approval"><span class="k">Awaiting approval</span><span class="v">${kp('approval').length}</span><span class="s">${fmt(T.pending)}</span></button>
    <button class="kpi t-rev" data-filter="rev"><span class="k">Reversals to review</span><span class="v">${kp('rev').length}</span><span class="s">${fmt(sumA(kp('rev')))}</span></button>
    <button class="kpi t-muted" data-filter="dup"><span class="k">Duplicates blocked</span><span class="v">${kp('dup').length + kp('conflict').length}</span><span class="s">${kp('conflict').length ? kp('conflict').length + ' with amount conflict' : 'no money, no receipt'}</span></button>
  </div>
  <div class="toolbar">
    ${FILTERS.map(x => `<button class="chip${UI.filter === x.id ? ' on' : ''}" data-filter="${x.id}">${x.label}<span class="n">${rows.filter(r => x.test(r.s.key)).length}</span></button>`).join('')}
    <input id="q" class="search" type="text" placeholder="Search ID, UTR, payer, student" value="${esc(UI.q)}" aria-label="Search payments">
  </div>
  <div class="tablewrap"><table class="tbl">
    <thead><tr><th>Payment</th><th>Received</th><th class="r">Amount</th><th>Source</th><th>Payer / reference</th><th>Verification</th><th>Candidate students</th><th>Status</th><th>Next action · owner</th></tr></thead>
    <tbody>${shown.length ? shown.map(({ t, s }) => `
      <tr class="click" data-open="${t.id}" tabindex="0" aria-label="Open ${t.id}">
        <td><b class="mono">${t.id}</b>${t.hold ? `<div><span class="tag">${esc(t.hold)}</span></div>` : ''}</td>
        <td class="small" style="white-space:nowrap">${dt(t.receivedAt)}<div class="faint mono">${ageOf(t.receivedAt)} old</div></td>
        <td class="r">${amt(t.amount)}</td>
        <td class="small">${esc(t.channel)}<div class="faint mono" style="font-size:.72rem">${esc(t.sourceTxnId)}</div></td>
        <td class="small wrap">${t.payerName ? `<div>${esc(t.payerName)}</div>` : ''}${t.remark ? `<div class="mono">"${esc(t.remark)}"</div>` : ''}${t.kind === 'claim' ? `<div>UTR ${esc(t.claimedUtr)} · screenshot</div>` : ''}${!t.payerName && !t.remark && t.kind !== 'claim' ? '<span class="faint">No payer details</span>' : ''}</td>
        <td>${verPill(t)}</td>
        <td class="small">${t.duplicateOf ? `<span class="faint">See ${t.duplicateOf}</span>` : t.kind === 'reversal' ? `Reverses <b class="mono">${t.reversal?.originalId || '?'}</b>` : t.matched ? `<b>${t.matched}</b> ${esc(sname(t.matched))} <span class="conf High">MATCHED</span>` : t.candidates.length ? t.candidates.map(c => `<div>${c.sid} ${esc(sname(c.sid))} <span class="conf ${c.conf}">${c.conf.toUpperCase()}</span></div>`).join('') : '<span class="faint">None</span>'}</td>
        <td>${pill(s.tone, s.label)}</td>
        <td class="small">${esc(nextAction(t))}<div class="faint">${esc(E.owner(t))}</div></td>
      </tr>`).join('') : `<tr><td colspan="9"><div class="empty">Nothing in this view. ${UI.filter === 'needs' ? 'Every payment has been resolved or is waiting on someone outside Operations.' : ''}</div></td></tr>`}
    </tbody></table></div>
  <div class="grid2">
    <div class="card">
      <div class="cardhead"><h3>Finance control totals</h3>${pill(T.diff === 0 ? 'ok' : 'bad', T.diff === 0 ? 'Balanced' : 'Out of balance')}</div>
      <div class="recon">
        <div><span class="k">Verified net</span><span class="v">${fmt(T.net)}</span></div>
        <div><span class="k">Posted</span><span class="v">${fmt(T.posted)}</span></div>
        <div><span class="k">Pending</span><span class="v">${fmt(T.pending)}</span></div>
        <div><span class="k">Unallocated</span><span class="v">${fmt(T.unalloc)}</span></div>
      </div>
      <p class="small muted">Unverified claims and cash (${fmt(T.unverified + T.claimed)}) sit outside these totals until they pass Gate 1.</p>
    </div>
    <div class="card">
      <div class="cardhead"><h3>Student mismatch cases</h3><span class="small muted">${openCases.length} open</span></div>
      ${E.cases.length ? E.cases.slice().reverse().map(k => `<div class="cand"><div class="row"><b class="mono">${k.id}</b>${pill(k.status === 'open' ? 'warn' : 'ok', k.status === 'open' ? 'Open' : 'Resolved')}</div><div class="small">${esc(sname(k.sid))} (${k.sid})${k.ref ? ' · about ' + esc(k.ref) : ''}: ${esc(k.text)}</div>${k.status === 'open' ? `<div class="actions"><input id="case-${k.id}" type="text" placeholder="Resolution the student will see" style="flex:1 1 200px">${btn('Resolve', 'case-resolve', { sm: true, data: `data-id="${k.id}"`, why: can('cases') ? '' : 'Operations or Finance resolves cases', quiet: true })}</div>` : `<div class="small muted">Resolution: ${esc(k.resolution)}</div>`}</div>`).join('') : '<p class="small muted">No cases yet. Students raise these from their fee ledger. Switch to a student role to try it.</p>'}
    </div>
  </div>`;
}
function verPill(t) {
  const m = { verified: ['ok', 'Verified'], pending: ['warn', 'Pending'], not_found: ['bad', 'Not in bank'], linked: ['ok', 'Linked'], duplicate: ['muted', 'Duplicate'] };
  const [tone, l] = m[t.verification] || ['muted', t.verification];
  return pill(tone, l);
}

/* ---------------- Reconciliation detail ---------------- */
function initEditor(t) {
  const free = E.allocatable(t);
  let rows = [];
  if (t.split && t.exception === 'Split payment') rows = t.split.map(p => ({ sid: p.sid, comp: '', amount: p.amount }));
  else if (t.matched) rows = [{ sid: t.matched, comp: '', amount: free }];
  else rows = [{ sid: '', comp: '', amount: free > 0 ? free : '' }];
  UI.ed = { txnId: t.id, version: t.version, rows, reason: '', evidence: '' };
}
function edChecks(t) {
  const ed = UI.ed; const rows = ed.rows.filter(r => r.sid || r.comp || r.amount);
  const sum = rows.reduce((s, r) => s + (+r.amount || 0), 0); const free = E.allocatable(t);
  const weak = [...new Set(rows.filter(r => r.sid && !E.strongBasis(t, r.sid)).map(r => r.sid))];
  const list = [
    { ok: can('propose'), t: can('propose') ? 'You can propose allocations' : `${ME.roleLabel} cannot propose allocations` },
    { ok: t.verification === 'verified', t: t.verification === 'verified' ? 'Funds verified in a trusted source' : 'Funds not verified — Gate 1 not passed' },
    { ok: rows.length > 0 && rows.every(r => r.sid && r.comp && Number.isInteger(+r.amount) && +r.amount > 0), t: 'Every line has a student, a fee component and a whole-rupee amount' },
    { ok: sum > 0 && sum <= free, t: `Lines total ${fmt(sum)} of ${fmt(free)} unallocated` },
    { ok: !!ed.reason.trim(), t: 'Reason recorded' },
  ];
  if (weak.length) list.push({ ok: ed.evidence.trim().length >= 10, t: `Corroborating evidence recorded for ${weak.join(', ')} (no verified identifier on this payment)` });
  return { list, sum, free, weak, ok: list.every(x => x.ok) };
}
function editorHtml(t) {
  // Re-initialise whenever the payment changed underneath (reject, reversal, cash verify, lookup) so the form never submits stale state.
  if (!UI.ed || UI.ed.txnId !== t.id || UI.ed.version !== t.version) initEditor(t);
  const ed = UI.ed; const ch = edChecks(t);
  const opts = (sel) => `<option value="">Student…</option>` + E.students.map(s => { const c = t.candidates.find(x => x.sid === s.id); return `<option value="${s.id}"${sel === s.id ? ' selected' : ''}>${s.id} · ${esc(s.name)}${t.matched === s.id ? ' (matched)' : c ? ` (candidate · ${c.conf})` : ''}</option>`; }).join('');
  const comps = (r) => `<option value="">Fee component…</option>` + COMPONENTS.map(c => `<option value="${c}"${r.comp === c ? ' selected' : ''}>${c}${r.sid ? ` · ${fmt(E.outstanding(r.sid, c))} due` : ''}</option>`).join('');
  return `
  <div class="card raised" id="editor">
    <div class="cardhead"><h3>Allocate</h3><span class="small muted">Proposals need a second person to approve</span></div>
    <div class="col" style="gap:8px" id="ed-rows">
      ${ed.rows.map((r, i) => `<div class="edrow" data-i="${i}">
        <select data-ed="sid" aria-label="Student, line ${i + 1}">${opts(r.sid)}</select>
        <select data-ed="comp" aria-label="Fee component, line ${i + 1}">${comps(r)}</select>
        <input data-ed="amount" inputmode="numeric" aria-label="Amount, line ${i + 1}" value="${esc(r.amount)}" placeholder="₹ amount">
        <button class="btn sm" data-act="ed-del" data-i="${i}" title="Remove line" aria-label="Remove line ${i + 1}">✕</button>
      </div>`).join('')}
      <div><button class="btn sm" data-act="ed-add">Add line</button></div>
    </div>
    <div id="ed-meter"></div>
    <div class="field"><label for="ed-reason">Reason</label><textarea id="ed-reason" placeholder="e.g. Bank remark assigns ₹15,000 each to S101 and S104; both confirmed tuition instalments">${esc(ed.reason)}</textarea></div>
    <div class="field" id="ed-ev-wrap"${ch.weak.length ? '' : ' hidden'}><label for="ed-evidence">Corroborating evidence <span id="ed-ev-who">${ch.weak.join(', ')}</span></label><textarea id="ed-evidence" placeholder="What proves this payer paid for this student? e.g. remittance advice, guardian confirmed from registered number ••5482">${esc(ed.evidence)}</textarea></div>
    <ul class="checks" id="ed-checks"></ul>
    <div class="actions"><button class="btn primary" data-act="propose" id="ed-go">Propose allocation</button><span class="why" id="ed-why"></span></div>
  </div>`;
}
function refreshEditor() {
  if (!UI.ed || !$('#ed-checks')) return;
  const t = E.txn(UI.ed.txnId); if (!t) return; const ch = edChecks(t);
  $('#ed-checks').innerHTML = ch.list.map(x => `<li class="${x.ok ? 'y' : 'n'}">${esc(x.t)}</li>`).join('');
  const pct = ch.free > 0 ? Math.min(100, ch.sum / ch.free * 100) : 0;
  const over = ch.sum > ch.free;
  $('#ed-meter').innerHTML = `<div class="meter" role="img" aria-label="Allocated ${fmt(ch.sum)} of ${fmt(ch.free)}"><i style="width:${pct}%;background:var(${over ? '--bad' : '--accent'})"></i></div><div class="small muted" style="margin-top:4px;display:flex;justify-content:space-between;gap:8px;flex-wrap:wrap"><span>Allocating <b class="amt">${fmt(ch.sum)}</b></span><span>${over ? `<b style="color:var(--bad)">Over by ${fmt(ch.sum - ch.free)}</b>` : `Left unallocated <b class="amt">${fmt(Math.max(0, ch.free - ch.sum))}</b>`}</span></div>`;
  const ew = $('#ed-ev-wrap'); if (ew) { ew.hidden = !ch.weak.length; $('#ed-ev-who').textContent = ch.weak.length ? '— required for ' + ch.weak.join(', ') : ''; }
  const over2 = UI.ed.rows.filter(r => r.sid && r.comp && +r.amount > E.outstanding(r.sid, r.comp) - E.pendingFor(r.sid, r.comp));
  $('#ed-go').disabled = !ch.ok;
  $('#ed-why').textContent = !ch.ok ? 'Resolve the red items above' : over2.length ? 'A line exceeds the fee outstanding; the approver must record the overpayment treatment' : '';
}
function bindEditor() { if ($('#editor')) refreshEditor(); }
function readEditor() {
  if (!UI.ed) return;
  document.querySelectorAll('#ed-rows .edrow').forEach(row => {
    const i = +row.dataset.i; const r = UI.ed.rows[i]; if (!r) return;
    r.sid = row.querySelector('[data-ed=sid]').value; r.comp = row.querySelector('[data-ed=comp]').value;
    const v = row.querySelector('[data-ed=amount]').value.replace(/[^\d]/g, ''); r.amount = v === '' ? '' : +v;
  });
  if ($('#ed-reason')) UI.ed.reason = $('#ed-reason').value;
  if ($('#ed-evidence')) UI.ed.evidence = $('#ed-evidence').value;
}

function vDetail() {
  if (!UI.sel || !E.txn(UI.sel)) { const first = E.txns.find(t => ['review', 'approval', 'rev', 'verify', 'conflict'].includes(E.status(t).key)) || E.txns[0]; UI.sel = first?.id; }
  const t = E.txn(UI.sel); if (!t) return '<div class="empty">No payments.</div>';
  const s = E.status(t); const idx = E.txns.indexOf(t);
  const prev = E.txns[idx - 1], next = E.txns[idx + 1];
  const props = E.proposals.filter(p => p.txnId === t.id);
  const audit = E.audit.filter(a => a.txn === t.id || a.entity === t.id || props.some(p => p.id === a.entity) || (t.duplicateOf && a.txn === t.duplicateOf && false));
  const rcpts = E.receipts.filter(r => r.txnId === t.id);
  const dupOf = t.duplicateOf ? E.txn(t.duplicateOf) : null;
  const dupKids = E.txns.filter(x => x.duplicateOf === t.id);
  return `
  <div class="pagehead">
    <div><div class="eyebrow">Payment reconciliation detail</div>
      <h2><span class="mono">${t.id}</span> · ${amt(t.amount)} · ${esc(t.channel)}</h2>
      <div class="actions" style="margin-top:8px">${pill(s.tone, s.label)} ${verPill(t)} ${t.hold ? pill('muted', t.hold) : ''}<span class="small muted">Owner: ${esc(E.owner(t))}</span></div>
    </div>
    <div class="actions">
      <button class="btn sm" data-go="queue">Back to queue</button>
      <button class="btn sm" data-go="detail" data-sel="${prev?.id || ''}" ${prev ? '' : 'disabled'}>← ${prev?.id || ''}</button>
      <button class="btn sm" data-go="detail" data-sel="${next?.id || ''}" ${next ? '' : 'disabled'}>${next?.id || ''} →</button>
    </div>
  </div>
  <div class="detailgrid">
    <div class="col">
      <div class="card">
        <h4>Source transaction</h4>
        <dl class="kv">
          <dt>Source</dt><dd>${{ bank: 'Approved bank statement feed', cash: 'Counsellor cash report', upload: 'Student portal submission' }[t.source]}</dd>
          <dt>Transaction ID</dt><dd class="mono">${esc(t.sourceTxnId)}</dd>
          <dt>Amount</dt><dd>${amt(t.amount)}</dd>
          <dt>Payer name</dt><dd>${esc(t.payerName) || '<span class="faint">Not provided</span>'}</dd>
          <dt>Payer contact</dt><dd>${t.payerContact ? 'ending ' + esc(t.payerContact) : '<span class="faint">Not provided</span>'}</dd>
          <dt>Remark / note</dt><dd class="mono">${esc(t.remark) || '<span class="faint">None</span>'}</dd>
          <dt>Received</dt><dd>${dt(t.receivedAt)}</dd>
          <dt>Imported</dt><dd>${dt(t.ingestedAt)} · ${esc(t.batch || '—')}</dd>
        </dl>
      </div>
      <div class="card">
        <div class="cardhead"><h4>Gate 1 · Verification</h4>${verPill(t)}</div>
        <p class="small">${esc(t.verificationNote)}</p>
        ${t.kind === 'claim' ? claimPanel(t) : ''}
        ${t.kind === 'cash' ? cashPanel(t) : ''}
      </div>
      <div class="card">
        <h4>Duplicate check</h4>
        ${dupOf ? `<div class="callout bad"><b>${t.idConflict ? 'ID conflict with' : 'Duplicate of'} ${dupOf.id}</b><span>Same source and transaction ID <span class="mono">${esc(t.sourceTxnId)}</span>${t.idConflict ? `, but ${fmt(t.amount)} instead of ${fmt(dupOf.amount)}` : ''}. Kept for the audit trail only: it adds no money, posting or receipt.</span></div>
          ${t.idConflict && !t.conflictClosed ? `<div class="field"><label for="conf-note">What did the bank confirm?</label><input id="conf-note" type="text" placeholder="e.g. Bank confirms ${dupOf.id} is correct; this line was a statement error"></div><div class="actions">${btn('Keep ' + dupOf.id + ' and close', 'conflict-close', { sm: true, why: can('verifyCash') ? '' : 'Finance resolves bank-data conflicts' })}</div>` : ''}
          ${t.notes.map(n => `<div class="note"><b>${esc(personOf(n.by))}</b> · ${dt(n.at)}<br>${esc(n.text)}</div>`).join('')}
          <button class="btn sm" data-go="detail" data-sel="${dupOf.id}">Open ${dupOf.id}</button>`
          : t.source === 'bank' ? `<div class="callout ok"><b>Unique</b><span>No other record with source "bank feed" and ID <span class="mono">${esc(t.sourceTxnId)}</span>.${dupKids.length ? ` Later re-imports blocked: ${dupKids.map(d => d.id).join(', ')}.` : ''}</span></div>` : `<p class="small muted">${t.kind === 'claim' ? 'Claims are de-duplicated by student and UTR.' : 'Cash reports are keyed by report number; Finance verification prevents double counting.'}</p>`}
      </div>
      ${(t.kind === 'payment' || t.kind === 'cash') && !t.duplicateOf ? candidatesPanel(t) : ''}
      ${t.kind === 'reversal' && !t.duplicateOf ? reversalPanel(t) : ''}
    </div>
    <div class="col">
      ${t.kind === 'payment' || t.kind === 'cash' ? fundsPanel(t) : ''}
      ${(t.kind === 'payment' || t.kind === 'cash') && !t.duplicateOf && E.allocatable(t) > 0 ? editorHtml(t) : ''}
      ${props.length ? proposalsPanel(t, props) : ''}
      ${rcpts.length ? `<div class="card"><h4>Gate 5 · Receipts</h4>${rcpts.map(r => receiptRow(r)).join('')}</div>` : ''}
      ${!t.duplicateOf && t.kind !== 'reversal' ? investigatePanel(t) : ''}
      <div class="card">
        <div class="cardhead"><h4>Audit history</h4><span class="small muted">${audit.length} events · append-only</span></div>
        ${timeline(audit)}
      </div>
    </div>
  </div>`;
}
function candidatesPanel(t) {
  return `<div class="card">
    <div class="cardhead"><h4>Gate 2 · Student identification</h4>${t.matched ? pill('ok', 'Matched ' + t.matched) : pill('warn', 'Not matched')}</div>
    ${t.matched ? `<div class="callout ok"><b>${t.matched} · ${esc(sname(t.matched))}</b><span>${esc(t.matchBasis)}</span></div>` : ''}
    ${t.candidates.filter(c => c.sid !== t.matched).map(c => `<div class="cand"><div class="row"><b>${c.sid} · ${esc(sname(c.sid))}</b><span class="conf ${c.conf}">${c.conf.toUpperCase()} CONFIDENCE</span></div>${c.reasons.map(r => `<span class="small muted">${esc(r)}</span>`).join('')}</div>`).join('')}
    ${!t.matched && t.candidates.length ? `<p class="small muted">Candidates are suggestions. A Medium or Low candidate can be allocated only after someone records evidence that links this payer to this student.</p>` : ''}
    ${!t.candidates.length && !t.matched ? (t.kind === 'cash' ? `<div class="callout warn"><b>Student not yet stated</b><span>The counsellor names the student when submitting the cash receipt and deposit evidence.</span></div>` : `<div class="callout bad"><b>No usable identifier</b><span>No student ID, no known contact and no name to go on. Investigate the payer through the bank or ask the depositor.</span></div>`) : ''}
    ${t.flags.map(f => `<div class="note">${esc(f)}</div>`).join('')}
    ${t.unknownRef ? `<div class="callout warn"><b>${esc(t.unknownRef)} is not in the student system yet</b><span>The payment is held. No student record is created here. Retry once the registration syncs.</span></div><div class="actions">${btn('Retry student lookup', 'lookup', { sm: true, why: can('propose') ? '' : 'Operations or Finance can retry' })}</div>` : ''}
  </div>`;
}
function fundsPanel(t) {
  const posted = E.allocs.filter(a => a.txnId === t.id && a.status === 'posted').reduce((s, a) => s + a.amount - a.reversed, 0);
  const pend = E.allocs.filter(a => a.txnId === t.id && ['proposed', 'approved', 'post_failed'].includes(a.status)).reduce((s, a) => s + a.amount, 0);
  const free = E.allocatable(t);
  if (t.duplicateOf) return '';
  return `<div class="card"><h4>Gate 3 · Funds on this payment</h4>
    <div class="recon">
      <div><span class="k">Received</span><span class="v">${fmt(t.amount)}</span></div>
      <div><span class="k">Reversed</span><span class="v">${fmt(-t.reversedApplied)}</span></div>
      <div><span class="k">Posted</span><span class="v">${fmt(posted)}</span></div>
      <div><span class="k">Pending</span><span class="v">${fmt(pend)}</span></div>
      <div><span class="k">Unallocated</span><span class="v">${fmt(free)}</span></div>
    </div>
    ${t.verification !== 'verified' ? `<div class="callout warn"><b>Allocation disabled</b><span>This money hasn't passed Gate 1. The student's balance cannot change until it does.</span></div>` : ''}
  </div>`;
}
function proposalsPanel(t, props) {
  return `<div class="card"><h4>Gate 4 · Approval and posting</h4>${props.slice().reverse().map(p => {
    const lines = E.allocs.filter(a => a.propId === p.id);
    const tone = { proposed: 'info', approved: 'info', posted: 'ok', post_failed: 'bad', rejected: 'muted' }[p.status];
    const label = { proposed: 'Awaiting approval', approved: 'Approved', posted: 'Posted', post_failed: 'Posting failed', rejected: 'Rejected' }[p.status];
    const own = p.proposer === actor();
    const whyA = !can('approve') ? 'Only a Finance approver can approve' : own ? 'You proposed this. Another approver must approve it.' : '';
    return `<div class="cand">
      <div class="row"><b class="mono">${p.id}</b>${pill(tone, label)}</div>
      <div class="tablewrap" style="border:0"><table class="tbl compact"><tbody>${lines.map(a => `<tr><td>${a.sid} · ${esc(sname(a.sid))}</td><td>${a.comp}</td><td class="r">${amt(a.amount)}${a.reversed ? `<div class="small neg">${fmt(-a.reversed)} reversed</div>` : ''}</td><td>${a.status === 'corrected' ? pill('muted', 'Corrected') : a.overpay ? pill('warn', 'Over outstanding') : ''}${a.status === 'posted' ? correctBtn(a) : ''}</td></tr>`).join('')}</tbody></table></div>
      <span class="small muted">Proposed by ${esc(personOf(p.proposer))} (${esc(roleLabel(p.proposer))}) · ${dt(p.createdAt)}. Reason: ${esc(p.reason)}</span>
      ${p.evidence ? `<span class="small muted">Evidence: ${esc(p.evidence)}</span>` : ''}
      ${p.approver ? `<span class="small muted">${p.status === 'rejected' ? 'Rejected' : 'Approved'} by ${esc(String(p.approver).startsWith('policy') ? 'policy rule AA-1' : personOf(p.approver))}${p.approvedAt ? ' · ' + dt(p.approvedAt) : ''}${p.note ? ' · ' + esc(p.note) : ''}</span>` : p.status === 'rejected' ? `<span class="small muted">Rejected: ${esc(p.note)}</span>` : ''}
      ${p.status === 'proposed' ? `<div class="field"><label for="ap-${p.id}">Approval or rejection note</label><input id="ap-${p.id}" type="text" placeholder="${lines.some(a => a.overpay) ? 'Required: overpayment treatment (e.g. hold as credit for next instalment)' : 'Optional for approval, required to reject'}"></div>
        <div class="actions">${btn('Approve and post', 'approve', { cls: 'primary', sm: true, data: `data-id="${p.id}"`, why: whyA })}${btn('Reject', 'reject', { sm: true, cls: 'danger', data: `data-id="${p.id}"`, why: !can('approve') ? 'Only a Finance approver can reject' : '', quiet: true })}</div>` : ''}
      ${p.status === 'post_failed' ? `<div class="callout bad"><b>Student-management system timed out</b><span>Nothing was written. Retrying uses idempotency key ${p.id}, so it cannot post twice.</span></div><div class="actions">${btn('Retry posting', 'retry', { sm: true, cls: 'primary', data: `data-id="${p.id}"`, why: can('retry') ? '' : 'Operations or Finance can retry' })}</div>` : ''}
    </div>`;
  }).join('')}</div>`;
}
function correctBtn(a) {
  if (a.corrReq) {
    const own = a.corrReq.by === actor();
    const why = !can('correct') ? 'Only a Finance approver can approve corrections' : own ? 'You requested this. Another Finance approver must approve it.' : '';
    return `<div class="note" style="margin-top:6px"><b>Correction requested</b> by ${esc(personOf(a.corrReq.by))}: ${esc(a.corrReq.reason)}</div>
      <div class="actions" style="margin-top:4px">${btn('Approve correction', 'correct', { sm: true, cls: 'danger', data: `data-id="${a.id}"`, why })}${btn('Reject', 'correct-reject', { sm: true, data: `data-id="${a.id}"`, why: can('correct') && !own ? '' : 'Finance approver other than the requester', quiet: true })}</div>`;
  }
  const why = can('requestCorrection') ? '' : 'Operations or Finance can request a correction';
  return `<div style="margin-top:4px"><button class="linkbtn small" data-act="correct-open" data-id="${a.id}" ${why ? 'disabled title="' + esc(why) + '"' : ''}>Request correction…</button></div>`;
}
function receiptRow(r) {
  const tone = { issued: 'ok', adjusted: 'rev', cancelled: 'bad' }[r.status];
  const net = r.amount + r.adjustments.reduce((s, x) => s + x.amount, 0);
  return `<div class="cand"><div class="row"><b class="mono">${r.no}</b>${pill(tone, r.status[0].toUpperCase() + r.status.slice(1))}</div><span class="small">${r.sid} · ${esc(sname(r.sid))} · ${r.comp} · ${amt(r.amount)}${r.adjustments.length ? ` · recognised now ${fmt(r.status === 'cancelled' ? 0 : net)}` : ''}</span><div><button class="linkbtn small" data-act="receipt" data-no="${r.no}">View receipt</button></div></div>`;
}
function claimPanel(t) {
  return `<div class="cand"><div class="row"><b>Student claim</b><span class="tag">Evidence only</span></div>
    <span class="small">Submitted for <b>${t.studentHint} · ${esc(sname(t.studentHint))}</b> · claims ${fmt(t.amount)}</span>
    <span class="small">UTR quoted: <span class="mono">${esc(t.claimedUtr)}</span></span>
    ${t.screenshot ? `<span class="small">Attachment: <span class="mono">${esc(t.screenshot)}</span> (stored with restricted access)</span>` : ''}
    ${t.verification === 'linked' ? `<button class="btn sm" data-go="detail" data-sel="${t.linkedBankTxn}">Open bank transaction ${t.linkedBankTxn}</button>` : `<div class="callout bad"><b>Cannot be concluded yet</b><span>That a payment of ${fmt(t.amount)} reached the college. The screenshot could be a failed, pending or edited transaction. No balance change, no receipt.</span></div>
    <div class="actions">${btn('Re-check bank feed', 'recheck', { sm: true, why: can('evidence') ? '' : 'Operations or Finance can re-check' })}</div>`}
  </div>`;
}
function cashPanel(t) {
  if (t.verification === 'verified') return `<div class="callout ok"><b>Deposit verified</b><span>Receipt book ${esc(t.cashEvidence.receiptBook)} · deposit slip ${esc(t.cashEvidence.depositRef)} · student ${t.cashEvidence.sid}</span></div>`;
  const stud = E.students.map(s => `<option value="${s.id}">${s.id} · ${esc(s.name)}</option>`).join('');
  return `<div class="callout warn"><b>Cannot be concluded yet</b><span>That ₹${t.amount.toLocaleString('en-IN')} reached the college's account, or which student it belongs to. A counsellor's report is not verified money.</span></div>
   ${t.cashEvidence ? `<div class="cand"><b>Evidence submitted</b><span class="small">Student ${t.cashEvidence.sid} · receipt book ${esc(t.cashEvidence.receiptBook)} · deposit slip ${esc(t.cashEvidence.depositRef)} · by ${esc(personOf(t.cashEvidence.by))}</span>
      <label class="small" style="display:flex;gap:8px;align-items:flex-start"><input type="checkbox" id="cash-confirm"> Deposit appears in the bank statement for the same amount and is entered in the cashbook</label>
      <div class="actions">${btn('Verify deposit', 'cash-verify', { sm: true, cls: 'primary', why: can('verifyCash') ? '' : 'Only Finance can verify cash. The collector never verifies their own collection.' })}</div></div>`
    : `<div class="fields">
        <div class="field"><label for="cash-sid">Collected for</label><select id="cash-sid"><option value="">Student…</option>${stud}</select></div>
        <div class="field"><label for="cash-book">Cash receipt-book no.</label><input id="cash-book" type="text" placeholder="CRB-0912"></div>
        <div class="field"><label for="cash-dep">Bank deposit slip ref.</label><input id="cash-dep" type="text" placeholder="DEP-55120"></div>
      </div><div class="actions">${btn('Submit evidence to Finance', 'cash-evidence', { sm: true, why: can('recordCash') ? '' : 'Counsellors or Operations submit cash evidence' })}</div>`}`;
}
function reversalPanel(t) {
  const r = t.reversal; const imp = E.reversalImpact(t);
  return `<div class="card">
    <div class="cardhead"><h4>Reversal</h4>${pill({ applied: 'ok', exception: 'bad', closed: 'muted' }[r.state] || 'rev', { applied: 'Applied', exception: 'Exception', closed: 'Closed — not applied' }[r.state] || 'Awaiting Finance approval')}</div>
    ${imp ? `<dl class="kv"><dt>Original payment</dt><dd><button class="linkbtn" data-go="detail" data-sel="${imp.orig.id}">${imp.orig.id}</button> · ${fmt(imp.orig.amount)} gross (kept)</dd>
      <dt>This reversal</dt><dd>${amt(t.amount)}</dd>
      <dt>Net recognised on ${imp.orig.id}</dt><dd>${r.state === 'awaiting_approval' ? `${fmt(imp.netBefore)} → ${fmt(imp.netAfter)} if applied` : fmt(imp.orig.amount - imp.orig.reversedApplied) + (r.state === 'applied' ? '' : ' (unchanged)')}</dd>
      ${r.state === 'awaiting_approval' ? `<dt>Comes off</dt><dd>${imp.fromAllocs.map(x => `${fmt(x.take)} from ${x.a.sid} ${x.a.comp} (${x.a.id})`).join('; ') || '—'}${imp.fromUnallocated ? `${imp.fromAllocs.length ? '; ' : ''}${fmt(imp.fromUnallocated)} from unallocated funds` : ''}</dd>` : ''}</dl>` : ''}
    ${r.state === 'exception' ? `<div class="callout bad"><b>Not applied</b><span>${esc(r.reason)}. Investigate with the bank before any balance changes.</span></div>` : ''}
    ${r.state === 'closed' ? `<div class="note">Closed by ${esc(personOf(r.approver))}: ${esc(r.note)}. No balance changed.</div>` : ''}
    ${['exception', 'awaiting_approval'].includes(r.state) ? `<div class="field"><label for="rev-close-note">Close without applying: what did the bank confirm?</label><input id="rev-close-note" type="text" placeholder="e.g. Bank confirms reversal was itself reversed; no money left the account"></div>
      <div class="actions">${r.state === 'exception' ? btn('Re-check link to original', 'rev-relink', { sm: true, why: can('reversal') ? '' : 'Only a Finance approver works reversals', quiet: true }) : ''}${btn('Close without applying', 'rev-close', { sm: true, cls: 'danger', why: can('reversal') ? '' : 'Only a Finance approver closes reversals' })}</div>` : ''}
    ${r.state === 'awaiting_approval' ? `${imp && !imp.ok ? `<div class="callout warn"><b>Blocked</b><span>Allocations pending on ${imp.orig.id} leave too little unallocated. Reject or reduce them first.</span></div>` : ''}
      <div class="field"><label for="rev-note">Approval note</label><input id="rev-note" type="text" placeholder="e.g. Bank advice confirms partial refund to payer"></div>
      <div class="actions">${btn('Apply reversal', 'reverse', { cls: 'primary', sm: true, why: can('reversal') ? '' : 'Only a Finance approver applies reversals' })}</div>
      <p class="small muted">Applying writes a linked negative ledger entry and marks the original receipt as adjusted. It never edits or deletes ${imp?.orig.id || 'the original'}.</p>` : ''}
  </div>`;
}
function investigatePanel(t) {
  if (E.status(t).key === 'done') return '';
  return `<div class="card"><h4>Investigation</h4>
    ${t.notes.map(n => `<div class="note"><b>${esc(personOf(n.by))}</b> · ${dt(n.at)}<br>${esc(n.text)}</div>`).join('')}
    <div class="field"><label for="inv-text">Evidence needed or escalation reason</label><input id="inv-text" type="text" placeholder="e.g. Ask payer bank for remittance advice naming the student"></div>
    <div class="actions">${btn('Request evidence', 'evidence', { sm: true, why: can('evidence') ? '' : 'Staff only' })}${btn('Escalate to Finance', 'escalate', { sm: true, why: can('escalate') ? '' : 'Operations, Counsellors or Finance reviewers escalate', quiet: true })}</div>
  </div>`;
}
function timeline(items) {
  if (!items.length) return '<p class="small muted">No events.</p>';
  return `<ul class="timeline">${items.slice().reverse().map(a => `<li class="${a.result}"><span class="t">${dt(a.ts)}</span><span class="dot"></span><div><b>${esc(a.action)}</b>${a.result !== 'ok' ? ' ' + pill(a.result === 'failed' ? 'bad' : 'bad', a.result) : ''}<div class="who">${esc(a.person)} · ${esc(a.role)}${a.entity ? ' · ' + esc(a.entity) : ''}</div><div class="small">${esc(a.detail)}</div></div></li>`).join('')}</ul>`;
}

/* ---------------- Student ledger ---------------- */
function vLedger() {
  const sid = isStudent() ? meSid() : (E.student(UI.ledgerSid) ? UI.ledgerSid : 'S101');
  const st = E.student(sid);
  const entries = E.ledger.filter(l => l.sid === sid);
  const comp = c => ({ due: E.due(sid, c), paid: E.postedFor(sid, c), bal: E.outstanding(sid, c) });
  const A = comp('Admission'), Tu = comp('Tuition');
  const claims = E.txns.filter(t => t.kind === 'claim' && t.studentHint === sid);
  const pend = E.allocs.filter(a => a.sid === sid && ['proposed', 'approved', 'post_failed'].includes(a.status));
  const cash = E.txns.filter(t => t.kind === 'cash' && t.verification !== 'verified' && (t.cashEvidence?.sid === sid || t.candidates.some(c => c.sid === sid)));
  const rc = E.receipts.filter(r => r.sid === sid);
  const myCases = E.cases.filter(c => c.sid === sid);
  const rows = [
    ...st.obligations.map(o => ({ ts: '2026-08-01T09:00:00', kind: 'fee', desc: `${o.comp} fee raised`, ref: o.id, comp: o.comp, amount: o.due })),
    ...entries.map(l => ({ ts: l.ts, kind: l.type, desc: l.type === 'payment' ? 'Payment recognised' : l.type === 'reversal' ? `Reversal of ${l.origTxnId}` : 'Correction (compensating entry)', ref: l.type === 'reversal' ? l.txnId + ' → ' + l.origTxnId : l.txnId, comp: l.comp, amount: l.amount, receipt: E.receipts.find(r => r.allocId === l.allocId) })),
  ].sort((a, b) => new Date(a.ts) - new Date(b.ts));
  return `
  <div class="pagehead">
    <div><div class="eyebrow">${isStudent() ? 'My fee ledger' : 'Student fee ledger'}</div><h2>${esc(st.name)} <span class="mono muted" style="font-size:1rem">${st.id}</span></h2>
      <p class="lede">Registered contact ••${esc(st.contact || '—')} · Guardian ••${esc(st.guardian || '—')}. Balances count recognised payments only. Anything still being checked is listed separately and does not reduce what is due.</p></div>
    ${isStudent() ? '' : `<div class="field"><label for="ledger-sid">Student</label><select id="ledger-sid">${E.students.map(s => `<option value="${s.id}"${s.id === sid ? ' selected' : ''}>${s.id} · ${esc(s.name)}</option>`).join('')}</select></div>`}
  </div>
  <div class="fees">
    ${[['Admission fee', A], ['Tuition fee', Tu]].map(([l, c]) => `<div class="fee"><h4>${l}</h4><span class="big">${fmt(Math.abs(c.bal))}</span><span class="small muted">${c.bal < 0 ? 'in credit (overpaid; Finance decides treatment)' : 'outstanding'}</span><div class="line"><span>Due</span><span>${fmt(c.due)}</span></div><div class="line"><span>Recognised</span><span>${fmt(c.paid)}</span></div></div>`).join('')}
    <div class="fee total"><h4 style="color:inherit;opacity:.75">Total outstanding</h4><span class="big">${fmt(A.bal + Tu.bal)}</span><div class="line"><span>Due</span><span>${fmt(A.due + Tu.due)}</span></div><div class="line"><span>Recognised</span><span>${fmt(A.paid + Tu.paid)}</span></div></div>
  </div>
  <div class="card"><div class="cardhead"><h3>Ledger</h3><span class="small muted">Posted entries only</span></div>
        <div class="tablewrap" style="border:0"><table class="tbl compact"><thead><tr><th>Date</th><th>Entry</th><th>Ref</th><th>Component</th><th class="r">Charge</th><th class="r">Credit</th><th>Receipt</th></tr></thead><tbody>
        ${rows.map(r => `<tr><td class="small" style="white-space:nowrap">${dOnly(r.ts)}</td><td>${esc(r.desc)}</td><td class="mono small">${esc(r.ref)}</td><td class="small">${r.comp}</td>
          <td class="r">${r.kind === 'fee' ? amt(r.amount) : ''}${r.kind !== 'fee' && r.amount < 0 ? amt(-r.amount) : ''}</td>
          <td class="r">${r.kind !== 'fee' && r.amount > 0 ? amt(r.amount) : ''}</td>
          <td>${r.receipt && r.kind === 'payment' ? `<button class="linkbtn small" data-act="receipt" data-no="${r.receipt.no}">${r.receipt.no.split('/').pop()}</button> ${r.receipt.status !== 'issued' ? pill(r.receipt.status === 'cancelled' ? 'bad' : 'rev', r.receipt.status) : ''}` : ''}</td></tr>`).join('')}
        </tbody></table></div>
  </div>
  <div class="detailgrid">
    <div class="col">
      <div class="card"><div class="cardhead"><h3>Being checked</h3><span class="small muted">Not yet counted in your balance</span></div>
        ${claims.length + pend.length + cash.length ? `
        ${claims.map(c => { const bk = c.verification === 'linked' ? E.txn(c.linkedBankTxn) : null; const mine = bk ? E.allocs.filter(a => a.txnId === bk.id && a.sid === sid && a.status === 'posted').reduce((s, a) => s + a.amount - a.reversed, 0) : 0; const st = !bk ? 'nf' : mine > 0 ? 'rec' : 'found';
          const stu = isStudent(); const lbl = st === 'rec' ? pill('ok', 'Received and recognised') : stu ? pill('warn', 'Under review') : st === 'found' ? pill('info', 'Found in bank · being allocated') : pill('warn', 'Not found in bank records yet');
          const msg = st === 'rec' ? `${fmt(mine)} is now in your ledger and receipted.` : stu ? 'Operations is checking this against the college bank account. Your balance changes only once the payment is confirmed and allocated to you. If it is taking long, raise a mismatch below with your bank statement.' : st === 'found' ? 'Found in bank records; waiting for Operations to allocate.' : 'Not in verified bank records yet.';
          return `<div class="cand"><div class="row"><b>${fmt(c.amount)} you reported · UTR <span class="mono">${esc(c.claimedUtr)}</span></b>${lbl}</div><span class="small muted">${msg} ${isStudent() ? '' : `<button class="linkbtn" data-go="detail" data-sel="${c.id}">Open ${c.id}</button>`}</span></div>`; }).join('')}
        ${pend.map(a => `<div class="cand"><div class="row"><b>${fmt(a.amount)} · ${a.comp} · from ${a.txnId}</b>${pill(a.status === 'post_failed' ? 'bad' : 'info', a.status === 'post_failed' ? 'Posting retry pending' : 'Awaiting Finance approval')}</div></div>`).join('')}
        ${cash.map(t => `<div class="cand"><div class="row"><b>${fmt(t.amount)} cash · ${t.id}</b>${pill('warn', 'Cash being verified')}</div><span class="small muted">Recognised once Finance matches the deposit.</span></div>`).join('')}`
        : '<p class="small muted">Nothing pending.</p>'}
      </div>
    </div>
    <div class="col">
      <div class="card"><h3>Receipts</h3>${rc.length ? rc.map(r => receiptRow(r)).join('') : '<p class="small muted">No receipts yet. A receipt is issued only after a payment is verified, allocated and posted.</p>'}</div>
      ${isStudent() ? studentForms(sid) : SERVER ? `<div class="card"><h3>Student actions</h3><p class="small muted">${esc(st.name)} submits payment details and raises mismatch cases from their own student account. Staff cannot act on a student's behalf.</p></div>` : `<div class="card"><h3>Student actions</h3><p class="small muted">Switch the role to <b>Student · ${esc(st.name)}</b> to submit payment details or raise a mismatch as this student.</p><div><button class="btn sm" data-act="as-student" data-sid="${sid}">View as ${esc(st.name.split(' ')[0])}</button></div></div>`}
      ${myCases.length ? `<div class="card"><h3>${isStudent() ? 'My cases' : 'Cases'}</h3>${myCases.map(k => `<div class="cand"><div class="row"><b class="mono">${k.id}</b>${pill(k.status === 'open' ? 'warn' : 'ok', k.status === 'open' ? 'With Operations' : 'Resolved')}</div><span class="small">${esc(k.text)}</span>${k.resolution ? `<span class="small muted">Reply: ${esc(k.resolution)}</span>` : ''}</div>`).join('')}</div>` : ''}
    </div>
  </div>`;
}
function studentForms(sid) {
  return `<div class="card"><h3>Tell us about a payment</h3>
    <p class="small muted">Use this if you paid but the payment isn't shown. A screenshot alone can't confirm a payment, so the UTR is required: it's the 12-digit reference in your UPI app or bank statement.</p>
    <div class="fields">
      <div class="field"><label for="cl-utr">UTR / transaction reference</label><input id="cl-utr" type="text" placeholder="UPI/430618771204"></div>
      <div class="field"><label for="cl-amt">Amount paid (₹)</label><input id="cl-amt" inputmode="numeric" placeholder="20000"></div>
      <div class="field"><label for="cl-payer">Paid by (if not you)</label><input id="cl-payer" type="text" placeholder="e.g. father, Rajesh Mehta"></div>
      <div class="field"><label for="cl-file">Screenshot (optional)</label><input id="cl-file" type="file" accept="image/*,.pdf"></div>
    </div>
    <div class="actions"><button class="btn primary sm" data-act="claim">Submit payment details</button></div>
  </div>
  <div class="card"><h3>Something looks wrong</h3>
    <div class="field"><label for="cs-ref">Payment or receipt reference (optional)</label><input id="cs-ref" type="text" placeholder="e.g. RCPT/26-27/00001 or your UTR"></div>
    <div class="field"><label for="cs-text">What's wrong?</label><textarea id="cs-text" placeholder="e.g. My mother paid ₹20,000 on 22 Oct but my balance hasn't changed"></textarea></div>
    <div class="actions"><button class="btn sm" data-act="case">Raise a mismatch</button></div>
  </div>`;
}

/* ---------------- Audit log ---------------- */
function vAudit() {
  const q = UI.auditQ.toLowerCase();
  const items = E.audit.filter(a => !q || Object.values(a).join(' ').toLowerCase().includes(q)).slice().reverse();
  return `<div class="pagehead"><div><div class="eyebrow">Finance and administration</div><h2>Audit log</h2><p class="lede">Every material action, including sign-ins and denied or blocked attempts. Entries are append-only${SERVER ? ' and hash-chained, so any edit or deletion is detectable' : ''}: corrections add records, they never rewrite old ones.</p></div>
    <div class="actions"><input id="aq" class="search" type="text" placeholder="Filter by person, action, P-number" value="${esc(UI.auditQ)}" aria-label="Filter audit log">${SERVER ? `<button class="btn sm" data-act="audit-verify">Verify integrity</button>${can('export') ? '<a class="btn sm" href="/api/export/reconciliation.csv" download>Export reconciliation (CSV)</a>' : ''}` : ''}</div></div>
  ${UI.auditCheck ? `<div class="callout ${UI.auditCheck.ok ? 'ok' : 'bad'}"><b>${UI.auditCheck.ok ? 'Audit chain intact' : 'Audit chain broken at entry ' + esc(UI.auditCheck.brokenAt)}</b><span>${UI.auditCheck.count} entries checked.</span></div>` : ''}
  <div class="tablewrap"><table class="tbl compact"><thead><tr><th>#</th><th>Time</th><th>Who</th><th>Action</th><th>Record</th><th>Result</th><th>Detail</th></tr></thead><tbody>
  ${items.map(a => `<tr><td class="mono small">${a.id}</td><td class="small" style="white-space:nowrap">${dt(a.ts)}</td><td class="small">${esc(a.person)}<div class="faint">${esc(a.role)}</div></td><td>${esc(a.action)}</td><td class="mono small">${a.txn ? `<button class="linkbtn" data-go="detail" data-sel="${esc(a.txn)}">${esc(a.txn)}</button>` : ''} ${a.entity && a.entity !== a.txn ? esc(a.entity) : ''}</td><td>${pill(a.result === 'ok' ? 'ok' : 'bad', a.result)}</td><td class="small wrap">${esc(a.detail)}</td></tr>`).join('')}
  </tbody></table></div>`;
}

/* ---------------- Policy controls ---------------- */
function vPolicy() {
  const s = E.settings; const adm = can('policy');
  return `<div class="pagehead"><div><div class="eyebrow">Administration</div><h2>Policy controls</h2><p class="lede">Matching and allocation rules are owned by Finance and changed only by an Administrator. Every change is written to the audit log. Changes apply to payments imported after the change.</p></div></div>
  ${adm ? '' : `<div class="callout info"><b>Read-only for ${esc(ME.roleLabel)}</b><span>Only an Administrator can change these.</span></div>`}
  <div class="grid2">
    <div class="card"><h3>AM-1 · Auto-match on a valid student ID</h3><p class="small muted">When a verified bank transaction carries exactly one valid student ID and nothing contradicts it, mark it matched without a person. Recommended: on.</p>
      <label style="display:flex;gap:8px;align-items:center"><input type="checkbox" id="pol-auto" ${s.autoMatch ? 'checked' : ''} ${adm ? '' : 'disabled'}> Enabled</label></div>
    <div class="card"><h3>AA-1 · Fee-component allocation order</h3><p class="small muted">Without a Finance-approved order, a person chooses admission or tuition on every line. With it, matched payments fill admission first, then tuition, and post automatically.</p>
      <select id="pol-comp" ${adm ? '' : 'disabled'}><option value="none"${s.componentPolicy === 'none' ? ' selected' : ''}>No policy: person chooses (default)</option><option value="admission-first"${s.componentPolicy === 'admission-first' ? ' selected' : ''}>Admission first, then tuition</option></select></div>
    <div class="card"><h3>Claims under review per student</h3><p class="small muted">Limits how many unconfirmed payment claims (and open cases) one student can have at a time, so the queue cannot be flooded.</p>
      <select id="pol-claims" ${adm ? '' : 'disabled'}>${[3, 5, 10, 20].map(n => `<option value="${n}"${s.maxOpenClaims === n ? ' selected' : ''}>${n}</option>`).join('')}</select></div>
    <div class="card"><h3>Maker-checker</h3><p class="small muted">The proposer of an allocation, the requester of a correction and the reporter of cash can never approve or verify their own work. Not configurable.</p>${pill('ok', 'Always on')}</div>
    ${E.demoMode ? `<div class="card"><h3>Demo only · student-system timeouts</h3><p class="small muted">Make the next posting attempt fail, to see the retry and idempotency behaviour.</p>
      <label style="display:flex;gap:8px;align-items:center"><input type="checkbox" id="pol-fail" ${s.smsFail ? 'checked' : ''} ${SERVER && !adm ? 'disabled' : ''}> Fail first posting attempt</label></div>` : ''}
  </div>
  ${E.demoMode && (!SERVER || adm) ? `<div class="actions"><button class="btn" data-act="reset">Reset demo data</button><span class="small muted">Restores the sample book (P1–P9). ${SERVER ? 'Users, settings and the audit history are kept.' : ''}</span></div>` : ''}`;
}
const OPEN_DECISIONS = [
  ['A-01', 'Which system is master for student IDs and fee balances?', 'Existing student-management system stays master; this tool writes postings to it.', 'Product + Engineering', true],
  ['A-02', 'What makes money "verified"?', 'Approved bank/UPI statement feed, or Finance-matched cash deposit. Screenshots are evidence only.', 'Finance', true],
  ['A-03', 'Can a verified payment with a valid student ID auto-match?', 'Yes, if unique, unconflicted and not a duplicate (AM-1).', 'Product + Finance', true],
  ['A-04', 'How is money split between admission and tuition?', 'No inference. Person chooses until Finance approves an order (AA-1).', 'Finance', true],
  ['A-05', 'Approval thresholds and who may approve what?', 'Maker-checker on every manual allocation; Finance approver role only.', 'Finance + Admin', true],
  ['A-06', 'Cash verification evidence?', 'Receipt-book number + deposit slip, matched by Finance to bank statement and cashbook.', 'Finance + Operations', true],
  ['A-07', 'Refunds and overpayments?', 'Overpayment flagged and needs an approval note; refunds are a separate Finance process (post-MVP).', 'Finance', false],
  ['A-08', 'Retention and access for screenshots and payer data?', 'Restricted evidence store; follow existing data-protection policy.', 'Admin + Compliance', false],
  ['A-09', 'Feed frequency, latency, retry targets?', 'Engineering to propose after discovery; no targets assumed.', 'Engineering', false],
];
function vWorkflow() {
  const lane = (cells) => cells.map(c => `<div class="step">${c.map(b => `<span class="box ${b[0]}">${esc(b[1])}</span>`).join('')}</div>`).join('');
  return `<div class="pagehead"><div><div class="eyebrow">Reference</div><h2>How it works</h2><p class="lede">Who does what at each gate. Dashed boxes run automatically; outlined teal boxes are control points where a second person or Finance must act.</p></div></div>
  <div class="legend"><span><i></i> Person</span><span><i class="auto"></i> Automatic</span><span><i class="gate"></i> Control point</span></div>
  <div class="tablewrap"><div class="lanes">
    <div class="lh">Actor</div><div class="lh">1 · Money arrives</div><div class="lh">2 · Identify student</div><div class="lh">3 · Allocate</div><div class="lh">4 · Approve and post</div><div class="lh">5 · Receipt and reconcile</div>
    <div class="actor">Student</div>${lane([[['', 'Pays by UPI / bank / cash'], ['', 'Optionally submits UTR + screenshot']], [['', 'Sees "being checked" on ledger']], [['', '—']], [['', '—']], [['', 'Downloads receipt'], ['', 'Raises mismatch case']]])}
    <div class="actor">System</div>${lane([[['auto', 'Imports bank feed'], ['auto', 'Blocks duplicate (source + ID)'], ['auto', 'Links claim if UTR found']], [['auto', 'Parses student IDs and split notes'], ['auto', 'Auto-match on valid ID (AM-1)'], ['auto', 'Ranks name/contact candidates']], [['auto', 'Validates lines ≤ available'], ['auto', 'Flags overpayment']], [['auto', 'Re-checks funds at approval'], ['auto', 'Posts once (idempotency key)']], [['auto', 'Issues one receipt per line'], ['auto', 'Control total check = ₹0']]])}
    <div class="actor">Operations / Counsellor</div>${lane([[['', 'Counsellor reports cash'], ['', 'Attaches receipt-book + deposit slip']], [['', 'Works unmatched queue'], ['', 'Requests evidence / escalates']], [['', 'Proposes student + component + amount'], ['gate', 'Records evidence for non-ID matches']], [['', 'Retries failed posting']], [['', 'Resolves student cases']]])}
    <div class="actor">Finance</div>${lane([[['gate', 'Verifies cash against bank + cashbook']], [['', 'Takes escalations']], [['', 'May propose (cannot self-approve)']], [['gate', 'Approver ≠ proposer'], ['gate', 'Applies reversals'], ['gate', 'Corrects posted lines']], [['', 'Daily reconciliation of totals']]])}
    <div class="actor">Admin</div>${lane([[['', '—']], [['gate', 'Sets AM-1 / AA-1 policy (Finance-owned)']], [['', '—']], [['', 'No financial actions (no bypass)']], [['', 'Reviews audit log, manages roles']]])}
  </div></div>

  <div class="card"><h3>How the system behaves in each situation</h3><div class="tablewrap" style="border:0"><table class="tbl"><thead><tr><th>Situation</th><th>Example</th><th>Automatic</th><th>Needs a person</th></tr></thead><tbody>
    <tr><td><b>Automatic match</b></td><td class="mono">P1, P3</td><td class="small">Match to student, record rule and rationale</td><td class="small">Choose fee component and approve (unless AA-1 approved)</td></tr>
    <tr><td><b>Suspected match</b></td><td class="mono">P2, P9</td><td class="small">Show candidates with confidence and reasons</td><td class="small">Record corroborating evidence, propose, second-person approval</td></tr>
    <tr><td><b>Missing student details</b></td><td class="small">Unknown S105; no identifier</td><td class="small">Hold, retry lookup after registration sync</td><td class="small">Investigate payer; never create a student here</td></tr>
    <tr><td><b>Multiple payments</b></td><td class="mono">P1 + P6 → S101; P6 split</td><td class="small">Each payment traced separately; lines can't exceed money</td><td class="small">Approve split lines together</td></tr>
    <tr><td><b>Reversal</b></td><td class="mono">P8</td><td class="small">Link to original, cap at unreversed amount, block duplicates</td><td class="small">Finance approver applies; receipt adjusted</td></tr>
    <tr><td><b>Unverified claim or cash</b></td><td class="mono">P5, P7</td><td class="small">Hold outside all balances; link claim when bank credit arrives</td><td class="small">Finance verifies cash; Ops requests UTR</td></tr>
  </tbody></table></div></div>

  <div class="grid2">
    <div class="card"><h3>State models</h3><div class="tablewrap" style="border:0"><table class="tbl compact"><tbody>
      <tr><td><b>Verification</b></td><td class="small">Pending · Not in bank → Verified · Linked · Duplicate</td></tr>
      <tr><td><b>Identification</b></td><td class="small">Unmatched → Candidate → Matched · Unknown reference</td></tr>
      <tr><td><b>Allocation</b></td><td class="small">Proposed → Approved → Posted · Posting failed → Posted · Rejected · Corrected</td></tr>
      <tr><td><b>Receipt</b></td><td class="small">Not eligible → Issued → Adjusted · Cancelled (history kept)</td></tr>
      <tr><td><b>Reversal</b></td><td class="small">Awaiting approval → Applied · Exception</td></tr>
    </tbody></table></div></div>
    <div class="card"><h3>Minimum data fields</h3><div class="tablewrap" style="border:0"><table class="tbl compact"><tbody>
      <tr><td><b>Payment</b></td><td class="small">id, source, source_txn_id (unique with source), channel, amount, payer name/contact, remark, received_at, ingested_at, batch, verification state, duplicate_of, reversed_amount, version</td></tr>
      <tr><td><b>Allocation</b></td><td class="small">id, payment_id, proposal_id, student_id, fee_obligation, amount, reversed, status, proposer, approver, reason, evidence</td></tr>
      <tr><td><b>Ledger entry</b></td><td class="small">id, idempotency_key, student_id, component, ±amount, type (payment/reversal/correction), payment_id, allocation_id</td></tr>
      <tr><td><b>Receipt</b></td><td class="small">number, allocation_id, student_id, amount, status, adjustments[], cancel_reason</td></tr>
      <tr><td><b>Claim / case</b></td><td class="small">student_id, claimed UTR, amount, attachment ref, linked payment; case text, status, resolution</td></tr>
      <tr><td><b>Audit event</b></td><td class="small">actor, role, time, action, record, before/after or detail, result (ok/denied/blocked/failed)</td></tr>
    </tbody></table></div></div>
  </div>

  <div class="card"><h3>Permissions and approval rules</h3><div class="tablewrap" style="border:0"><table class="tbl compact"><thead><tr><th>Action</th>${['Student', 'Counsellor', 'Operations', 'Finance reviewer', 'Finance approver', 'Admin'].map(r => `<th>${r}</th>`).join('')}</tr></thead><tbody>
    ${[['View own ledger, submit claim, raise case', 1, 0, 0, 0, 0, 0], ['View queue and evidence', 0, 1, 1, 1, 1, 1], ['Submit cash evidence', 0, 1, 1, 0, 0, 0], ['Verify cash deposit', 0, 0, 0, 1, 1, 0], ['Propose allocation', 0, 0, 1, 1, 1, 0], ['Approve / reject allocation (not own)', 0, 0, 0, 0, 1, 0], ['Apply reversal', 0, 0, 0, 0, 1, 0], ['Request correction of posted allocation', 0, 0, 1, 1, 1, 0], ['Approve correction (not own request)', 0, 0, 0, 0, 1, 0], ['Read full audit log', 0, 0, 0, 1, 1, 1], ['Change matching / allocation policy', 0, 0, 0, 0, 0, 1], ['Manage roles', 0, 0, 0, 0, 0, 1]].map(r => `<tr><td>${r[0]}</td>${r.slice(1).map(v => `<td>${v ? pill('ok', 'Yes') : '<span class="faint">—</span>'}</td>`).join('')}</tr>`).join('')}
  </tbody></table></div><p class="small muted">Every permission is enforced in the prototype's rules engine, not just hidden in the UI. Switch roles and try an action you shouldn't have: it is refused and logged.</p></div>

  <div class="card"><h3>Error states and exceptions</h3><div class="tablewrap" style="border:0"><table class="tbl compact"><thead><tr><th>Condition</th><th>What the user sees</th></tr></thead><tbody>
    ${[['Lines exceed available money', 'Red meter, "Over by ₹X", Propose disabled'], ['Missing fee component', 'Checklist item red; system never guesses admission vs tuition'], ['Weak match without evidence', 'Evidence box appears and is required'], ['Self-approval', 'Approve disabled: "You proposed this. Another approver must approve it."'], ['Self-approved correction', 'Approve disabled: "You requested this. Another Finance approver must approve it."'], ['Implausible or missing amount at import', 'Rejected at the door and audited; never becomes a payment'], ['Student over the claim limit', '"You already have 5 payments under review"'], ['Stale edit (another reviewer acted)', '"This payment changed while you were editing. Reload."'], ['Funds changed before approval', '"Only ₹X is still free. Reject and re-propose."'], ['Student-system timeout', 'Posting failed, nothing written, safe Retry button'], ['Reversal exceeds remaining', 'Reversal exception; Apply disabled'], ['Unknown student reference', 'Held; Retry lookup after registration sync'], ['Unauthorised action', 'Control disabled with reason; engine refuses and logs if forced']].map(r => `<tr><td>${r[0]}</td><td class="small">${r[1]}</td></tr>`).join('')}
  </tbody></table></div></div>

  <div class="card"><h3>Success metrics</h3><div class="tablewrap" style="border:0"><table class="tbl compact"><thead><tr><th>Metric</th><th>Definition</th><th>Target</th></tr></thead><tbody>
    <tr><td>Duplicate postings / receipts</td><td class="small">Confirmed duplicate financial entries per month</td><td>Zero (guardrail)</td></tr>
    <tr><td>Incorrect allocations</td><td class="small">Corrections ÷ posted allocations</td><td class="small">Baseline in month 1, then set</td></tr>
    <tr><td>Auto-match rate</td><td class="small">Verified payments matched by AM-1 ÷ verified payments with an ID in the reference</td><td class="small">Baseline first</td></tr>
    <tr><td>Time to reconcile</td><td class="small">Median and P90 from import to posted</td><td class="small">Baseline first</td></tr>
    <tr><td>Unmatched backlog</td><td class="small">Count and ₹ value open, by age bucket (0–2d, 3–7d, 8d+)</td><td class="small">Trend down; nothing &gt; 7d without owner</td></tr>
    <tr><td>Receipt turnaround</td><td class="small">Posting → receipt available</td><td class="small">Same day</td></tr>
    <tr><td>Student mismatch cases</td><td class="small">Cases raised ÷ active fee-paying students</td><td class="small">Trend down</td></tr>
    <tr><td>Control difference</td><td class="small">Verified − (posted + pending + unallocated), daily</td><td>₹0 every day</td></tr>
  </tbody></table></div><p class="small muted">The brief gives no baseline, so targets other than the guardrails are set after the first month of data rather than invented now.</p></div>`;
}
const ACS = [
  ['AC-01', 'Given a verified bank transaction whose reference contains exactly one valid student ID and no conflicting signal, when it is imported, then it is marked matched to that student with rule AM-1 recorded, and nothing is posted until a fee component is chosen and approved (or AA-1 is enabled).'],
  ['AC-02', 'Given AA-1 is enabled, when a matched payment is imported, then it is allocated admission-first then tuition, posted once and receipted once, with the policy recorded as approver.'],
  ['AC-03', 'Given a record with the same source and transaction ID already exists, when it is imported again (payment or reversal), then it is stored as a linked duplicate and creates no allocation, ledger entry or receipt.'],
  ['AC-04', 'Given a verified ₹30,000 payment with a reconciling split note, when ₹15,000 lines to S101 and S104 are approved, then two allocation rows reference one payment, they sum to ₹30,000, verified totals do not change, and one receipt issues per line.'],
  ['AC-05', 'Given allocation lines totalling more than the unallocated amount, or a line without a fee component, when a user proposes, then the proposal is refused with the amount available.'],
  ['AC-06', 'Given a payment whose only link to a student is a name or contact, when a user proposes it to that student without at least 10 characters of corroborating evidence, then the proposal is refused.'],
  ['AC-07', 'Given a proposal, when its proposer or any non-Finance-approver attempts approval, then the action is refused and an audit event with result "denied" or "blocked" is written.'],
  ['AC-08', 'Given a counsellor cash report, when no Finance user has verified receipt-book and deposit evidence, then it cannot be allocated, the student\'s balance is unchanged, and the collecting role cannot verify it.'],
  ['AC-09', 'Given a student claim whose UTR is not in verified bank records, then it is shown as "not found", is never allocatable, and issues no receipt; when a bank credit with that UTR arrives, then the two are linked and the student becomes a High candidate.'],
  ['AC-10', 'Given P3 is posted and P8 (−₹5,000) is approved, when it is applied, then P3 keeps its ₹15,000 gross amount, a −₹5,000 ledger entry linked to P3 is written, S103 nets ₹10,000, and the receipt shows an adjustment.'],
  ['AC-11', 'Given a reversal larger than the original\'s unreversed amount, when it is imported, then it is placed in exception and cannot be applied.'],
  ['AC-12', 'Given the student-management system times out on posting, when the posting is retried any number of times, then exactly one ledger entry and one receipt exist per allocation line.'],
  ['AC-13', 'Given a verified payment references a student ID not yet in the student system, then it is held without creating a student; when the registration syncs and lookup is retried, then it matches.'],
  ['AC-14', 'Given a posted allocation is corrected with a reason, then the original row is kept as "corrected", a compensating ledger entry is written, the receipt is cancelled with the reason, and the funds return to unallocated.'],
  ['AC-15', 'Given two reviewers editing the same payment, when the second submits on a stale version, then the submission is refused with a reload prompt.'],
  ['AC-16', 'Given any sequence of actions, then verified money − applied reversals = posted + pending + unallocated (control difference ₹0).'],
];/* ---------------- modals ---------------- */
function openModal(html) { const m = $('#modal'); m.innerHTML = `<div class="modal" role="dialog" aria-modal="true">${html}</div>`; m.hidden = false; }
function closeModal() { $('#modal').hidden = true; $('#modal').innerHTML = ''; }
function receiptModal(no) {
  const r = E.receipts.find(x => x.no === no); if (!r) return;
  const t = E.txn(r.txnId); const st = E.student(r.sid);
  const adj = r.adjustments.reduce((s, x) => s + x.amount, 0);
  openModal(`<div class="cardhead"><h3>Fee receipt</h3><button class="btn sm x" data-act="close">Close</button></div>
  <div class="receipt">
    <div class="rh"><div><b>${esc(INSTITUTION)}</b><div class="small muted">Fee receipt</div></div><span class="stamp" style="color:var(${r.status === 'issued' ? '--ok' : r.status === 'cancelled' ? '--bad' : '--rev'})">${r.status}</span></div>
    <div>Receipt no.   ${r.no}</div><div>Issued        ${dt(r.issuedAt)}</div><div>Student       ${st.id} · ${esc(st.name)}</div><div>Fee component ${r.comp}</div>
    <div>Payment ref   ${t.id} · ${esc(t.sourceTxnId)}</div><div>Channel       ${esc(t.channel)}</div><div>Amount        ${fmt(r.amount)}</div>
    ${r.adjustments.map(a => `<div>Adjustment    ${a.no} · ${fmt(a.amount)} (reversal ${a.revId})</div>`).join('')}
    ${r.status === 'cancelled' ? `<div>Cancelled     ${esc(r.cancelReason)}</div>` : ''}
    <div style="border-top:1px dashed var(--line-strong);padding-top:6px"><b>Recognised    ${fmt(r.status === 'cancelled' ? 0 : r.amount + adj)}</b></div>
  </div>
  <p class="small muted">In production this downloads as a PDF. The receipt number never changes; adjustments and cancellations are printed on it rather than replacing it.</p>`);
}
function correctModal(id) {
  const a = E.allocs.find(x => x.id === id);
  openModal(`<div class="cardhead"><h3>Request a correction to ${a.id}</h3><button class="btn sm x" data-act="close">Close</button></div>
  <p class="small">${fmt(a.amount - a.reversed)} to ${a.sid} · ${esc(sname(a.sid))} · ${a.comp}, from ${a.txnId}.</p>
  <div class="callout warn"><b>What happens</b><span>Nothing changes yet. A different Finance approver must approve. Then a compensating −${fmt(a.amount - a.reversed)} entry is written to ${a.sid}'s ledger, the receipt is cancelled with your reason, and the money returns to ${a.txnId}'s unallocated amount. The original allocation stays visible.</span></div>
  <div class="field"><label for="corr-reason">Why was this allocation wrong?</label><textarea id="corr-reason" placeholder="e.g. Payer confirmed by bank as guardian of a different student"></textarea></div>
  <div class="actions"><button class="btn danger" data-act="correct-request" data-id="${a.id}">Send for approval</button><button class="btn" data-act="close">Cancel</button></div>`);
}
function simModal() {
  const tab = UI.simTab;
  const presets = [
    ['Re-import P1', 'Same bank transaction ID as P1, from a new statement batch', { tab: 'bank', id: 'UPI/430219884120', amt: 10000, payer: '', contact: '7731', remark: 'S101' }],
    ['Bank credit matching Rohan\'s claim (P7)', 'The ₹20,000 UTR from the screenshot finally appears in the feed', { tab: 'bank', id: 'UPI/430618771204', amt: 20000, payer: 'Rajesh Mehta', contact: '9874', remark: '' }],
    ['Second reversal on P3, ₹12,000', 'More than P3\'s unreversed amount once P8 is applied', { tab: 'bank', id: 'RVSL/430799000001', amt: -12000, payer: '', contact: '', remark: 'Reversal of P3', rev: 'UPI/430312902337' }],
    ['Payment for S105, not yet registered', 'Money arrives before the student record', { tab: 'bank', id: 'IMPS/430901112233', amt: 25000, payer: 'Meher Shah', contact: '', remark: 'S105' }],
    ['Split that doesn\'t add up', '₹40,000 with note S102 20000 / S103 15000', { tab: 'bank', id: 'NEFT/N2950000999', amt: 40000, payer: '', contact: '', remark: 'S102 20000 / S103 15000' }],
    ['Guardian pays from registered number', 'No ID, but contact ending 9081 is Ananya\'s guardian', { tab: 'bank', id: 'UPI/430955510001', amt: 12000, payer: 'S Kapoor', contact: '9081', remark: '' }],
  ];
  openModal(`<div class="cardhead"><h3>Simulate an incoming event</h3><button class="btn sm x" data-act="close">Close</button></div>
  <p class="small muted">Feed the rules engine a new situation, the way an interviewer might. Everything goes through the same import, duplicate and matching rules as P1–P9.</p>
  <div class="tabs">${[['bank', 'Bank feed'], ['cash', 'Cash report'], ['claim', 'Student claim'], ['reg', 'Late registration'], ['presets', 'Scenarios']].map(([k, l]) => `<button class="${tab === k ? 'on' : ''}" data-act="sim-tab" data-tab="${k}">${l}</button>`).join('')}</div>
  ${tab === 'presets' ? `<div class="presets">${presets.map((p, i) => `<button class="preset" data-act="sim-preset" data-i="${i}"><b>${esc(p[0])}</b><span>${esc(p[1])}</span></button>`).join('')}</div>` : ''}
  ${tab === 'bank' ? `<div class="fields">
      <div class="field"><label for="s-id">Bank transaction ID / UTR</label><input id="s-id" type="text" value="${esc(UI.simPre?.id || 'UPI/4310' + Math.floor(Math.random() * 9e7))}"></div>
      <div class="field"><label for="s-amt">Amount (₹, negative for reversal)</label><input id="s-amt" type="text" value="${esc(UI.simPre?.amt ?? 15000)}"></div>
      <div class="field"><label for="s-payer">Payer name</label><input id="s-payer" type="text" value="${esc(UI.simPre?.payer || '')}"></div>
      <div class="field"><label for="s-contact">Payer contact (last 4)</label><input id="s-contact" type="text" value="${esc(UI.simPre?.contact || '')}"></div>
      <div class="field" style="grid-column:1/-1"><label for="s-remark">Remark / narration</label><input id="s-remark" type="text" value="${esc(UI.simPre?.remark ?? '')}" placeholder="e.g. S102 or S101 10000 / S103 5000"></div>
      <div class="field" style="grid-column:1/-1"><label for="s-rev">Reverses transaction ID (reversals only)</label><input id="s-rev" type="text" value="${esc(UI.simPre?.rev || '')}" placeholder="UPI/430312902337"></div>
    </div><div class="actions"><button class="btn primary" data-act="sim-bank">Import into feed</button></div>` : ''}
  ${tab === 'cash' ? `<div class="fields"><div class="field"><label for="s-camt">Amount (₹)</label><input id="s-camt" type="text" value="8000"></div><div class="field"><label for="s-csid">Student named by counsellor</label><select id="s-csid"><option value="">Not stated</option>${E.students.map(s => `<option value="${s.id}">${s.id} · ${esc(s.name)}</option>`).join('')}</select></div></div><div class="actions"><button class="btn primary" data-act="sim-cash">Record cash report</button></div>` : ''}
  ${tab === 'claim' ? `<p class="small">Student claims go through the student portal. Switch the role to a student and use <b>Tell us about a payment</b> on their fee ledger.</p><div class="actions"><button class="btn" data-act="as-student" data-sid="S102">View as Rohan Mehta</button></div>` : ''}
  ${tab === 'reg' ? `<div class="fields"><div class="field"><label for="s-rid">Student ID</label><input id="s-rid" type="text" value="S105"></div><div class="field"><label for="s-rname">Name</label><input id="s-rname" type="text" value="Meher Shah"></div></div><p class="small muted">Simulates the student-management system syncing a new registration. Payments already held for this ID can then be retried from their detail page.</p><div class="actions"><button class="btn primary" data-act="sim-reg">Sync registration</button></div>` : ''}`);
}
const VIEWS = { overview: vOverview, queue: vQueue, detail: vDetail, ledger: vLedger, audit: vAudit, policy: vPolicy, users: vUsers, check: vCheck, workflow: vWorkflow };

function readFileText(input) {
  return new Promise((res, rej) => { const f = input?.files?.[0]; if (!f) return res(null); if (f.size > 5 * 1024 * 1024) return rej(new Error('File too large (5 MB maximum).')); const r = new FileReader(); r.onload = () => res({ name: f.name, text: String(r.result) }); r.onerror = () => rej(new Error('Could not read the file.')); r.readAsText(f); });
}

document.addEventListener('submit', async e => {
  if (e.target.id === 'login-form') { e.preventDefault(); await doLogin(); }
  if (e.target.id === 'pw-form') {
    e.preventDefault();
    const r = await http('POST', '/api/users/my-password', { current: $('#pw-cur').value, next: $('#pw-new').value });
    if (r.ok) { closeModal(); toast('Password changed. Please sign in again.'); ME = null; renderLogin(); } else toast(r.error || 'Failed', true);
  }
});

document.addEventListener('click', async e => {
  const g = e.target.closest('[data-go]');
  if (g && !g.disabled) { if (g.dataset.filter) UI.filter = g.dataset.filter; go(g.dataset.go, g.dataset.sel || undefined); return; }
  const o = e.target.closest('[data-open]'); if (o) { go('detail', o.dataset.open); return; }
  const f = e.target.closest('[data-filter]'); if (f) { UI.filter = f.dataset.filter; render(); return; }
  if (e.target.id === 'modal') { closeModal(); return; }
  const b = e.target.closest('[data-act]'); if (!b || b.disabled) return;
  const A = b.dataset.act; const t = E && E.txn(UI.sel); const id = b.dataset.id;
  if (['ed-add', 'ed-del', 'propose'].includes(A) && t && (!UI.ed || UI.ed.txnId !== t.id)) initEditor(t);
  switch (A) {
    case 'logout': await http('POST', '/api/logout').catch(() => {}); ME = null; E = null; await refreshCsrf(); renderLogin(); break;
    case 'my-password': passwordModal(); break;
    case 'reset': break; // handled below: server and preview reset differently
    case 'ed-add': readEditor(); UI.ed.rows.push({ sid: '', comp: '', amount: '' }); render(); break;
    case 'ed-del': readEditor(); UI.ed.rows.splice(+b.dataset.i, 1); if (!UI.ed.rows.length) UI.ed.rows.push({ sid: '', comp: '', amount: '' }); render(); break;
    case 'propose': {
      readEditor();
      const r = await run('propose', { txnId: t.id, rows: UI.ed.rows.map(x => ({ sid: x.sid, comp: x.comp, amount: +x.amount || 0 })), reason: UI.ed.reason, evidence: UI.ed.evidence, version: UI.ed.version }, d => `${d.prop || 'Proposal'} sent for approval. A Finance approver who is not you must approve it.`);
      if (r.ok || /changed while you were editing/.test(r.error || '')) { UI.ed = null; render(); }
      break;
    }
    case 'approve': await run('approve', { propId: id, note: val('ap-' + id) }, 'Approved and posted. Receipt issued.'); break;
    case 'reject': await run('reject', { propId: id, reason: val('ap-' + id) }, 'Proposal rejected; funds released.'); break;
    case 'retry': await run('retry', { propId: id }, d => d.noop ? 'Already posted — nothing written twice' : 'Posted on retry'); break;
    case 'reverse': await run('applyReversal', { txnId: t.id, note: val('rev-note') }, 'Reversal applied. Original kept; receipt adjusted.'); break;
    case 'rev-close': await run('closeReversal', { txnId: t.id, note: val('rev-close-note') }, 'Reversal closed. No balance changed.'); break;
    case 'rev-relink': await run('relinkReversal', { txnId: t.id }, d => d.state === 'exception' ? 'Still no valid original payment' : 'Linked. Ready for approval.'); break;
    case 'conflict-close': await run('closeConflict', { txnId: t.id, note: val('conf-note') }, 'Conflict closed. Original kept.'); break;
    case 'cash-evidence': await run('recordCashEvidence', { txnId: t.id, sid: val('cash-sid'), receiptBook: val('cash-book'), depositRef: val('cash-dep') }, 'Evidence sent to Finance'); break;
    case 'cash-verify': await run('verifyCash', { txnId: t.id, confirmed: !!document.getElementById('cash-confirm')?.checked }, 'Cash verified. Now allocate it.'); break;
    case 'recheck': await run('recheckClaim', { txnId: t.id }, d => d.linked ? `Found: linked to ${d.linked}` : 'Still not in verified bank records'); break;
    case 'lookup': await run('retryLookup', { txnId: t.id }, 'Lookup retried'); break;
    case 'evidence': await run('requestEvidence', { txnId: t.id, text: val('inv-text') }, 'Evidence requested; marked waiting on payer'); break;
    case 'escalate': await run('escalate', { txnId: t.id, text: val('inv-text') }, 'Escalated to Finance'); break;
    case 'conflict': break;
    case 'correct-open': correctModal(id); break;
    case 'correct-request': { const r = await run('requestCorrection', { allocId: id, reason: val('corr-reason') }, 'Correction sent. A different Finance approver must approve it.'); if (r.ok) closeModal(); break; }
    case 'correct': await run('correct', { allocId: id }, 'Correction approved. Funds returned to unallocated.'); break;
    case 'correct-reject': await run('rejectCorrection', { allocId: id, note: 'Rejected by approver' }, 'Correction rejected. Allocation unchanged.'); break;
    case 'receipt': receiptModal(b.dataset.no); break;
    case 'close': closeModal(); break;
    case 'case-resolve': await run('resolveCase', { id, note: val('case-' + id) }, 'Case resolved'); break;
    case 'claim': {
      const file = document.getElementById('cl-file')?.files?.[0]?.name || '';
      await run('submitClaim', { utr: val('cl-utr'), amount: val('cl-amt').replace(/[^\d]/g, ''), payerName: val('cl-payer'), file }, 'Submitted for review. Your balance updates once the payment is confirmed and allocated to you.');
      break;
    }
    case 'case': await run('raiseCase', { ref: val('cs-ref'), text: val('cs-text') }, 'Your case is with Operations'); break;
    case 'as-student': if (!SERVER) { UI.role = 'student:' + b.dataset.sid; ME = demoMe(); closeModal(); go('ledger'); } break;
    case 'tests': UI.tests = null; render(); await loadTests(); toast('Checks re-run'); break;
    case 'audit-verify': { const r = await fetch('/api/audit/verify', { credentials: 'same-origin' }); UI.auditCheck = r.ok ? await r.json() : null; render(); break; }
    case 'sim-open': UI.simPre = null; UI.simTab = 'bank'; SERVER ? addModal() : simModal(); break;
    case 'sim-tab': UI.simTab = b.dataset.tab; if (b.dataset.tab !== 'bank') UI.simPre = null; SERVER ? addModal() : simModal(); break;
    case 'bank-import': {
      let file; try { file = await readFileText($('#bk-file')); } catch (err) { toast(err.message, true); break; }
      if (!file) { toast('Choose the bank statement CSV first', true); break; }
      const r = await http('POST', '/api/import/bank', { csv: file.text, fileName: file.name }).catch(() => ({ ok: false, error: 'The server could not be reached.' }));
      if (r.ok) { closeModal(); await loadState(); const d = r.data; toast(`${d.imported} new payments · ${d.duplicates} duplicates skipped · ${d.conflicts} ID conflicts · ${d.rejected} rows rejected`, d.conflicts + d.rejected > 0); UI.filter = 'needs'; go('queue'); }
      else toast(r.error || 'Import failed', true);
      break;
    }
    case 'sim-cash': { const r = await run('reportCash', { amount: val('s-camt').replace(/[^\d]/g, ''), sid: val('s-csid'), remark: val('s-cnote') || (SERVER ? '' : 'Counsellor reports cash collected') }, 'Held as unverified cash until Finance matches the deposit'); if (r.ok) { closeModal(); if (r.data?.txn) go('detail', r.data.txn); } break; }
    case 'sim-reg': { const r = await run('registerStudent', { id: val('s-rid').toUpperCase(), name: val('s-rname'), contact: val('s-rcon'), guardian: val('s-rgua') }, 'Student added. Retry lookup on any held payment.'); if (r.ok) { closeModal(); render(); } break; }
    case 'user-add': await userOp('add', { userName: val('nu-user'), displayName: val('nu-name'), role: val('nu-role'), studentId: val('nu-sid') }, 'User added'); break;
    case 'user-reset': await userOp('reset-password', { id }, 'Password reset'); break;
    case 'user-disable': await userOp('disable', { id }, 'User disabled. They are signed out on their next request.'); break;
    case 'user-enable': await userOp('enable', { id }, 'User enabled'); break;
    case 'copy-secret': { const s = $('#secret')?.textContent || ''; try { await navigator.clipboard.writeText(s); toast('Copied'); } catch (err) { const rg = document.createRange(); rg.selectNodeContents($('#secret')); getSelection().removeAllRanges(); getSelection().addRange(rg); toast('Selected. Press Ctrl+C to copy.'); } break; }
  }
  // Demo-only tools
  if (!SERVER) demoClick(A, b);
  else if (A === 'reset') {
    const r = await http('POST', '/api/admin/reset-demo', {}); if (r.ok) { await loadState(); UI.ed = null; UI.tests = null; toast('Sample data restored'); render(); } else toast(r.error || 'Failed', true);
  }
});

function demoClick(A, b) {
  switch (A) {
    case 'reset': E = demoSeed({ autoMatch: E.settings.autoMatch, componentPolicy: E.settings.componentPolicy, smsFail: E.settings.smsFail }); UI.ed = null; UI.tests = null;
      if (isStudent() && !E.student(meSid())) UI.role = 'ops';
      if (!E.student(UI.ledgerSid)) UI.ledgerSid = 'S103'; if (UI.sel && !E.txn(UI.sel)) UI.sel = null;
      ME = demoMe(); closeModal(); toast('Sample data restored'); render(); break;
    case 'sim-preset': { const p = [{ id: 'UPI/430219884120', amt: 10000, payer: '', contact: '7731', remark: 'S101' }, { id: 'UPI/430618771204', amt: 20000, payer: 'Rajesh Mehta', contact: '9874', remark: '' }, { id: 'RVSL/430799000001', amt: -12000, payer: '', contact: '', remark: 'Reversal of P3', rev: 'UPI/430312902337' }, { id: 'IMPS/430901112233', amt: 25000, payer: 'Meher Shah', contact: '', remark: 'S105' }, { id: 'NEFT/N2950000999', amt: 40000, payer: '', contact: '', remark: 'S102 20000 / S103 15000' }, { id: 'UPI/430955510001', amt: 12000, payer: 'S Kapoor', contact: '9081', remark: '' }][+b.dataset.i]; UI.simPre = p; UI.simTab = 'bank'; simModal(); break; }
    case 'sim-bank': { const amount = Math.round(+val('s-amt').replace(/[^\d\-]/g, '')); if (!amount) { toast('Enter a non-zero amount', true); break; } if (!val('s-id')) { toast('Enter a transaction ID', true); break; } const tx = E.ingest({ source: 'bank', sourceTxnId: val('s-id'), channel: amount < 0 ? 'Reversal' : 'Bank feed', amount, payerName: val('s-payer'), payerContact: val('s-contact'), remark: val('s-remark'), reversalOf: val('s-rev') || undefined, batch: 'Simulated' }); if (!tx) { toast('Rejected at import: amount must be non-zero and no more than ' + fmt(MAX_AMOUNT), true); break; } closeModal(); UI.simPre = null; UI.ed = null; toast(tx.duplicateOf ? `Blocked: duplicate of ${tx.duplicateOf}` : `${tx.id} imported: ${E.status(tx).label}`, !!tx.duplicateOf); go('detail', tx.id); break; }
  }
}

document.addEventListener('input', e => {
  if (e.target.id === 'q') { UI.q = e.target.value; const pos = e.target.selectionStart; render(); const q = $('#q'); q.focus(); try { q.setSelectionRange(pos, pos); } catch (x) {} return; }
  if (e.target.id === 'aq') { UI.auditQ = e.target.value; const pos = e.target.selectionStart; render(); const q = $('#aq'); q.focus(); try { q.setSelectionRange(pos, pos); } catch (x) {} return; }
  if (e.target.closest('#editor')) { readEditor(); refreshEditor(); }
});
document.addEventListener('change', async e => {
  if (e.target.id === 'role' && !SERVER) { UI.role = e.target.value; UI.ed = null; ME = demoMe(); render(); toast(`Now acting as ${isStudent() ? 'student ' + sname(meSid()) : ROLES[UI.role].label + ' · ' + ROLES[UI.role].person}`); return; }
  if (e.target.id === 'ledger-sid') { go('ledger', e.target.value); return; }
  if (e.target.closest('#editor') && e.target.matches('select')) { readEditor(); render(); return; }
  if (e.target.id === 'pol-auto') { await run('setPolicy', { key: 'autoMatch', value: String(e.target.checked) }, 'AM-1 updated. Applies to payments imported from now on.'); return; }
  if (e.target.id === 'pol-comp') { await run('setPolicy', { key: 'componentPolicy', value: e.target.value }, 'AA-1 updated. Applies to payments imported from now on.'); return; }
  if (e.target.id === 'pol-claims') { await run('setPolicy', { key: 'maxOpenClaims', value: e.target.value }, 'Claim limit updated'); return; }
  if (e.target.id === 'pol-fail') { await run('setPolicy', { key: 'smsFail', value: String(e.target.checked) }, e.target.checked ? 'Next posting attempt will time out' : 'Student system back to normal'); return; }
  if (e.target.dataset.userRole) { await userOp('role', { id: e.target.dataset.userRole, role: e.target.value }, 'Role changed. It applies on their next request.'); return; }
});
document.addEventListener('keydown', e => { if (e.key === 'Escape' && !$('#modal').hidden) closeModal(); if ((e.key === 'Enter' || e.key === ' ') && e.target.matches('tr[data-open]')) { e.preventDefault(); go('detail', e.target.dataset.open); } });
window.addEventListener('hashchange', () => { if (!ME) return; fromHash(); render(); });

(async function start() {
  if (!SERVER) { E = demoSeed(); ME = demoMe(); fromHash(); render(); return; }
  try { await refreshCsrf(); } catch (e) { $('#login').hidden = false; $('#login').innerHTML = '<div class="card"><b>The server is not responding.</b><p class="small">Start the app with start.bat and reload this page.</p></div>'; return; }
  if (await loadState()) { fromHash(); if (isStudent()) UI.view = 'ledger'; render(); } else renderLogin();
})();
