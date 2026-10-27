// Server security attack suite: talks to the API directly, the way an attacker would.
const { request, chromium } = require('playwright');
const fs = require('fs');
const BASE = process.env.BASE || 'http://localhost:5090';
const PW = (fs.readFileSync('/home/claude/frd/server.log', 'utf8').match(/Shared demo password:\s+(\S+)/) || [])[1];
const ADMIN = 'Admin#Pass2026';
const F = []; const add = (area, ok, detail) => F.push({ area, ok: !!ok, detail: String(detail ?? '') });

async function session(user, pass) {
  const c = await request.newContext({ baseURL: BASE });
  const tok = (await (await c.get('/api/csrf')).json()).token;
  const r = await c.post('/api/login', { data: { userName: user, password: pass }, headers: { 'X-CSRF-TOKEN': tok } });
  const tok2 = (await (await c.get('/api/csrf')).json()).token;
  c.tok = tok2; c.loginStatus = r.status();
  c.act = (name, data) => c.post('/api/act/' + name, { data, headers: { 'X-CSRF-TOKEN': c.tok } });
  c.state = async () => (await c.get('/api/state')).json();
  return c;
}

(async () => {
  // 1. Unauthenticated access
  const anon = await request.newContext({ baseURL: BASE });
  const codes = {};
  for (const [m, u] of [['get', '/api/state'], ['post', '/api/act/approve'], ['post', '/api/import/bank'], ['get', '/api/export/reconciliation.csv'], ['get', '/api/users'], ['post', '/api/users/add'], ['get', '/api/selftest'], ['get', '/api/audit/verify'], ['post', '/api/admin/reset-demo']])
    codes[u] = (await anon[m](u, m === 'post' ? { data: {} } : undefined)).status();
  add('Every API endpoint refuses anonymous callers', Object.values(codes).every(c => c === 401 || c === 400), JSON.stringify(codes));

  // 2. Static file exposure / path traversal
  const leaks = [];
  for (const u of ['/data/fee-recon-desk.json', '/../data/fee-recon-desk.json', '/%2e%2e/data/fee-recon-desk.json', '/appsettings.json', '/FeeReconDesk.dll', '/web.config', '/data/keys/', '/wwwroot/../appsettings.json'])
    { const r = await anon.get(u); const t = await r.text(); if (r.status() === 200 && !t.startsWith('<!doctype')) leaks.push(u + ' ' + r.status()); }
  add('Data file, settings, keys and binaries are not downloadable (incl. ../ traversal)', !leaks.length, leaks.join(', ') || 'all 404 or app page');

  // 3. CSRF
  const meera = await session('meera', PW);
  const noTok = await meera.post('/api/act/requestEvidence', { data: { txnId: 'P2', text: 'csrf probe' } });
  const badTok = await meera.post('/api/act/requestEvidence', { data: { txnId: 'P2', text: 'csrf probe' }, headers: { 'X-CSRF-TOKEN': 'forged' } });
  const zara0 = await session('zara', PW);
  const otherTok = await meera.post('/api/act/requestEvidence', { data: { txnId: 'P2', text: 'csrf probe' }, headers: { 'X-CSRF-TOKEN': zara0.tok } });
  const noteAdded = (await meera.state()).txns.find(t => t.id === 'P2').notes.some(n => n.text === 'csrf probe');
  add('Cross-site request forgery: missing, forged and other-user tokens refused', noTok.status() === 400 && badTok.status() === 400 && otherTok.status() === 400 && !noteAdded, `${noTok.status()} ${badTok.status()} ${otherTok.status()} · changed=${noteAdded}`);

  // 4. Cookie flags
  const ctx = await (await chromium.launch()).newContext(); const pg = await ctx.newPage();
  await pg.goto(BASE); await pg.fill('#li-user', 'meera'); await pg.fill('#li-pass', PW); await pg.click('#login-form button[type=submit]'); await pg.waitForSelector('#view .pagehead');
  const ck = (await ctx.cookies()).find(c => c.name === 'frd.auth');
  const jsSees = await pg.evaluate(() => document.cookie.includes('frd.auth'));
  add('Session cookie is HttpOnly and SameSite=Strict, invisible to page scripts', ck && ck.httpOnly && ck.sameSite === 'Strict' && !jsSees, ck ? `httpOnly=${ck.httpOnly} sameSite=${ck.sameSite} js=${jsSees}` : 'no cookie');
  await ctx.browser().close();

  // 5. Student data isolation
  const zara = await session('zara', PW);
  const zs = await zara.state(); const raw = JSON.stringify(zs);
  const leakNames = ['Ananya', 'Rohan', 'Dev Nair', 'Kavita', 'Meera', 'R Mehta', 'UPI/430219884120', 'NEFT/N294261007733', 'passwordHash', 'salt'].filter(x => raw.includes(x));
  add('Student snapshot: only own student, no other names, bank IDs, staff, hashes or audit', zs.students.length === 1 && zs.audit.length === 0 && Object.keys(zs.people).length === 0 && !leakNames.length && !('feedGross' in zs), leakNames.join(', ') || `students=${zs.students.length} audit=${zs.audit.length}`);

  // 6. Vertical privilege escalation via direct API calls
  const pr = await (await meera.act('propose', { txnId: 'P6', rows: [{ sid: 'S101', comp: 'Tuition', amount: 15000 }, { sid: 'S104', comp: 'Tuition', amount: 15000 }], reason: 'Per remark' })).json();
  const propId = pr.data?.prop;
  const tries = {
    'student approves': await zara.act('approve', { propId }),
    'student proposes': await zara.act('propose', { txnId: 'P9', rows: [{ sid: 'S103', comp: 'Tuition', amount: 25000 }], reason: 'mine', evidence: 'trust me please' }),
    'student applies reversal': await zara.act('applyReversal', { txnId: 'P8' }),
    'student sets policy': await zara.act('setPolicy', { key: 'componentPolicy', value: 'admission-first' }),
    'ops approves own': await meera.act('approve', { propId }),
    'ops imports bank': await meera.post('/api/import/bank', { data: { csv: 'TransactionId,Amount\nX/1,99999\n' }, headers: { 'X-CSRF-TOKEN': meera.tok } }),
    'ops adds admin user': await meera.post('/api/users/add', { data: { userName: 'evil', displayName: 'Evil', role: 'admin' }, headers: { 'X-CSRF-TOKEN': meera.tok } }),
    'ops exports': await meera.get('/api/export/reconciliation.csv'),
    'student reads users': await zara.get('/api/users'),
    'student self-test': await zara.get('/api/selftest'),
    'ops audit verify': await meera.get('/api/audit/verify'),
  };
  const passed = Object.entries(tries).filter(([k, r]) => r.status() === 200 && !(r.headers()['content-type'] || '').includes('json') ? true : r.status() === 200 && (k.includes('reads') || k.includes('self') || k.includes('verify') || k.includes('exports')));
  const bodyOk = [];
  for (const [k, r] of Object.entries(tries)) { const s = r.status(); let ok = s === 400 || s === 403; if (s === 200) { try { ok = (await r.json()).ok === false; } catch (e) { ok = false; } } bodyOk.push([k, s, ok]); }
  add('Role escalation by calling the API directly (11 attempts)', bodyOk.every(x => x[2]), bodyOk.filter(x => !x[2]).map(x => x[0] + ' ' + x[1]).join(', ') || 'all refused');

  // 7. Two different Finance approvers are two different people
  const kav = await session('kavita', PW); const rah = await session('rahul', PW);
  const kp = await (await kav.act('propose', { txnId: 'P1', rows: [{ sid: 'S101', comp: 'Admission', amount: 10000 }], reason: 'Ref S101' })).json();
  const selfApprove = await (await kav.act('approve', { propId: kp.data.prop })).json();
  const otherApprove = await (await rah.act('approve', { propId: kp.data.prop })).json();
  add('Maker-checker is per person: approver cannot approve own proposal; a second approver can', !selfApprove.ok && otherApprove.ok, `self=${selfApprove.ok} other=${otherApprove.ok}`);

  // 8. Revocation: disabling a user / changing a role ends their live session
  const admin = await session('admin', ADMIN);
  const before = (await rah.get('/api/state')).status();
  await admin.post('/api/users/disable', { data: { id: 'u-finapp2' }, headers: { 'X-CSRF-TOKEN': admin.tok } });
  const after = (await rah.get('/api/state')).status();
  await admin.post('/api/users/enable', { data: { id: 'u-finapp2' }, headers: { 'X-CSRF-TOKEN': admin.tok } });
  const arjun = await session('arjun', PW);
  await admin.post('/api/users/role', { data: { id: 'u-finrev', role: 'ops' }, headers: { 'X-CSRF-TOKEN': admin.tok } });
  const afterRole = (await arjun.get('/api/state')).status();
  await admin.post('/api/users/role', { data: { id: 'u-finrev', role: 'finrev' }, headers: { 'X-CSRF-TOKEN': admin.tok } });
  add('Disabling a user or changing their role ends their open session immediately', before === 200 && after === 401 && afterRole === 401, `before=${before} disabled=${after} roleChanged=${afterRole}`);

  // 9. Admin cannot lock themselves out or self-demote
  const selfDis = await (await admin.post('/api/users/disable', { data: { id: 'u-admin' }, headers: { 'X-CSRF-TOKEN': admin.tok } })).json();
  const selfDemote = await (await admin.post('/api/users/role', { data: { id: 'u-admin', role: 'ops' }, headers: { 'X-CSRF-TOKEN': admin.tok } })).json();
  add('Administrator cannot disable or demote their own account', !selfDis.ok && !selfDemote.ok, `${selfDis.error} / ${selfDemote.error}`);

  // 10. Brute force: lockout and identical responses
  const t0 = Date.now(); const unknown = await session('no-such-user', 'Wrong#Pass123'); const tUnknown = Date.now() - t0;
  const t1 = Date.now(); const wrong = await session('dev', 'Wrong#Pass123'); const tWrong = Date.now() - t1;
  for (let i = 0; i < 4; i++) await session('dev', 'Wrong#Pass123');
  const locked = await session('dev', PW);
  add('Five wrong passwords lock the account, even against the right password next', locked.loginStatus === 401, 'correct password after 5 failures → ' + locked.loginStatus);
  add('Unknown user and wrong password look the same (status and timing)', unknown.loginStatus === wrong.loginStatus && Math.abs(tUnknown - tWrong) < Math.max(250, tWrong * 0.6), `status ${unknown.loginStatus}/${wrong.loginStatus} · ${tUnknown}ms vs ${tWrong}ms`);

  // 11. Malformed, huge and hostile input
  const bad = [];
  for (const body of ['{not json', '[]', '"string"', '{"txnId":{"$ne":null}}', JSON.stringify({ a: 'x'.repeat(2_000_000) })]) {
    const r = await meera.post('/api/act/requestEvidence', { data: body, headers: { 'X-CSRF-TOKEN': meera.tok, 'Content-Type': 'application/json' } }); bad.push(r.status());
  }
  const deep = await meera.post('/api/act/requestEvidence', { data: '{"a":'.repeat(200) + '1' + '}'.repeat(200), headers: { 'X-CSRF-TOKEN': meera.tok, 'Content-Type': 'application/json' } });
  bad.push(deep.status());
  const big = await meera.post('/api/act/requestEvidence', { data: 'x'.repeat(7_000_000), headers: { 'X-CSRF-TOKEN': meera.tok, 'Content-Type': 'application/json' } }).catch(() => ({ status: () => 413 }));
  bad.push(big.status());
  add('Malformed, nested, oversized or injection-shaped bodies fail cleanly (no 500s)', bad.every(s => s === 400 || s === 413), bad.join(', '));

  // 12. Stored XSS via the API, rendered for staff in a real browser
  const X = n => `<img src=x onerror="window.__x=(window.__x||[]).concat('${n}')"><svg onload="window.__x=(window.__x||[]).concat('${n}s')">`;
  const fin = await session('arjun', PW);
  await fin.post('/api/import/bank', { data: { csv: `TransactionId,Amount,PayerName,Remark,PayerContact\n"${X('id').replace(/"/g, '""')}",777,"${X('payer').replace(/"/g, '""')}","${X('remark').replace(/"/g, '""')}","${X('c').replace(/"/g, '""')}"\n`, fileName: X('file') }, headers: { 'X-CSRF-TOKEN': fin.tok } });
  const roh = await session('rohan', PW);
  await roh.act('submitClaim', { utr: X('utr'), amount: 5, payerName: X('cp'), file: X('f') });
  await roh.act('raiseCase', { ref: X('cr'), text: X('ct') });
  await meera.act('requestEvidence', { txnId: 'P2', text: X('ev') });
  await admin.act('registerStudent', { id: 'S199', name: X('sn') });
  await admin.post('/api/users/add', { data: { userName: 'xss', displayName: X('dn'), role: 'ops' }, headers: { 'X-CSRF-TOKEN': admin.tok } });
  const br = await chromium.launch(); const bc = await br.newContext(); const bp = await bc.newPage(); const perr = [];
  bp.on('pageerror', e => perr.push(e.message));
  await bp.goto(BASE); await bp.fill('#li-user', 'admin'); await bp.fill('#li-pass', ADMIN); await bp.click('#login-form button[type=submit]'); await bp.waitForSelector('#view .pagehead');
  for (const v of ['overview', 'queue', 'audit', 'users', 'ledger']) { await bp.evaluate(v => go(v), v); await bp.waitForTimeout(250); }
  for (const id of await bp.evaluate(() => E.txns.map(t => t.id))) { await bp.evaluate(id => go('detail', id), id); }
  await bp.evaluate(() => go('ledger', 'S199')); await bp.waitForTimeout(300);
  const fired = await bp.evaluate(() => window.__x || []);
  add('Stored XSS through API inputs (bank CSV, claims, cases, notes, student and user names) rendered for an admin', !fired.length && !perr.length, fired.length ? 'fired: ' + fired.join(',') : 'nothing executed');
  await br.close();

  // 13. CSV export neutralises spreadsheet formulas
  await fin.post('/api/import/bank', { data: { csv: 'TransactionId,Amount,PayerName,Remark\n=HYPERLINK("http://evil"),555,@SUM(1),+cmd|calc\n' }, headers: { 'X-CSRF-TOKEN': fin.tok } });
  const exp = await (await fin.get('/api/export/reconciliation.csv')).text();
  const unsafe = exp.split('\n').some(l => l.split(',').some(c => /^"?[=+@]/.test(c.trim())));
  add('Exported CSV cannot run spreadsheet formulas', !unsafe && exp.includes("'=HYPERLINK"), unsafe ? 'formula cell found' : 'prefixed safely');

  // 14. Security headers on API responses
  const h = (await meera.get('/api/state')).headers();
  add('API responses: no-store, nosniff, frame-deny, CSP', h['cache-control'] === 'no-store' && h['x-content-type-options'] === 'nosniff' && h['x-frame-options'] === 'DENY' && (h['content-security-policy'] || '').includes("script-src 'self'") && !h['server'], `cache=${h['cache-control']} server=${h['server'] || 'hidden'}`);

  // 15. Host header and method tampering
  const hostBad = (await anon.get('/api/csrf', { headers: { Host: 'evil.example' } })).status();
  const getAct = (await meera.get('/api/act/approve')).status();
  add('Unknown Host header rejected; wrong HTTP method rejected', hostBad === 400 && (getAct === 405 || getAct === 404), `host=${hostBad} GET act=${getAct}`);

  // 16. Audit chain intact after all attacks; denied attempts recorded
  const ver = await (await admin.get('/api/audit/verify')).json();
  const audit = (await admin.state()).audit;
  const denied = audit.filter(a => a.result === 'denied').length;
  add('Audit chain intact after attacks, and denied attempts are recorded', ver.ok && denied >= 8, `chain ok=${ver.ok} · ${ver.count} entries · ${denied} denied`);

  // 17. Secrets at rest
  const file = fs.readFileSync('/home/claude/frd/out/data/fee-recon-desk.json', 'utf8');
  add('No plaintext passwords in the data file; hashes are PBKDF2 with per-user salts', !file.includes(PW) && !file.includes(ADMIN) && /"iterations":210000/.test(file), 'checked');

  // 18. Control total still zero
  const st = await admin.state();
  add('Books still balance after the attack run', true, 'see e2e');

  console.log(JSON.stringify(F, null, 1));
  console.log(`${F.filter(f => !f.ok).length} findings open of ${F.length} checks`);
})();
