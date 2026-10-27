// Security attack suite against the live page.
const { chromium } = require('playwright');
const fs = require('fs');
const FILE = process.argv[2] || 'fee_reconciliation_workbench.html';
const html = fs.readFileSync(FILE, 'utf8');
const wrap = h => h.startsWith('<!doctype') ? h : '<!doctype html><html><head><meta charset="utf-8"></head><body>' + h + '</body></html>';
const X = n => `"><img src=x onerror="window.__x=(window.__x||[]).concat('${n}')"><svg onload="window.__x=(window.__x||[]).concat('${n}s')">'\`<script>window.__x=(window.__x||[]).concat('${n}j')</script>`;

(async () => {
  const b = await chromium.launch();
  const ctx = await b.newContext({ viewport: { width: 1360, height: 900 } });
  await ctx.route(/fonts\./, r => r.abort());
  const p = await ctx.newPage();
  const errs = []; p.on('pageerror', e => errs.push(e.message));
  await p.setContent(wrap(html), { waitUntil: 'load' });
  const S = (fn, a) => p.evaluate(fn, a);
  const findings = [];
  const F = (area, ok, detail) => findings.push({ area, ok, detail });

  // ---------- 1. Stored XSS through every text input ----------
  await S(X => {
    const x = n => X.replace(/NAME/g, n);
    E.ingest({ source: 'bank', sourceTxnId: x('id'), channel: x('chan'), amount: 12345, payerName: x('payer'), payerContact: x('contact'), remark: x('remark'), batch: x('batch') });
    E.ingest({ source: 'bank', sourceTxnId: 'RV/' + x('r'), channel: 'x', amount: -100, remark: x('revremark'), reversalOf: x('revof') });
    E.ingest({ source: 'cash', sourceTxnId: x('cashid'), channel: 'Cash', amount: 500, remark: x('cashremark') }, 'counsellor');
    E.registerStudent('system', { id: 'S106', name: x('studentname') });
    E.submitClaim('student:S102', { utr: x('utr'), amount: 900, payerName: x('claimpayer'), file: x('file.jpg') });
    E.raiseCase('student:S102', { ref: x('caseref'), text: x('casetext') });
    const p9 = E.propose('ops', 'P9', [{ sid: 'S104', comp: 'Tuition', amount: 1000 }], x('reason'), x('evidence'));
    E.requestEvidence('ops', 'P2', x('evreq'));
    E.escalate('ops', 'P2', x('esc'));
    E.recordCashEvidence('counsellor', 'P5', { sid: 'S102', receiptBook: x('book'), depositRef: x('dep') });
    if (p9.ok) E.reject('finapp', p9.prop.id, x('rejectnote'));
    const p3 = E.propose('ops', 'P3', [{ sid: 'S103', comp: 'Admission', amount: 0 }], 'x');
    E.resolveCase('ops', E.cases[0]?.id, x('resolution'));
    render();
  }, X('NAME'));
  const views = ['overview', 'queue', 'detail', 'ledger', 'audit', 'policy', 'gaps', 'decisions', 'workflow', 'handoff', 'apm', 'founder'];
  const roles = ['ops', 'finapp', 'admin', 'student:S102', 'student:S106'];
  for (const r of roles) { await p.selectOption('#role', r).catch(() => {}); for (const v of views) await S(v => go(v), v); }
  for (const id of await S(() => E.txns.map(t => t.id))) { await p.selectOption('#role', 'finapp'); await S(id => go('detail', id), id); }
  for (const sid of ['S102', 'S106']) await S(s => go('ledger', s), sid);
  await S(() => { const r = E.receipts[0]; if (r) receiptModal(r.no); });
  await S(x => { UI.simPre = { id: x, amt: 1, payer: x, contact: x, remark: x, rev: x }; UI.simTab = 'bank'; simModal(); }, X('sim'));
  await S(() => closeModal());
  await p.waitForTimeout(300);
  const xss = await S(() => window.__x || []);
  const injected = await S(() => document.querySelectorAll('main [onerror], main svg[onload], main script, #modal [onerror]').length);
  F('Stored XSS: payloads in 25 text fields rendered across every view, role, detail page, receipt and simulator', !xss.length && !injected, xss.length ? 'Executed from: ' + [...new Set(xss)].join(', ') : 'No payload executed; no injected elements in DOM');

  // ---------- 2. Hash routing abuse ----------
  for (const h of ['constructor', '__proto__', 'toString', 'hasOwnProperty', 'detail-<img src=x onerror=alert(1)>', 'ledger-__proto__', 'detail-constructor']) {
    await S(h => { location.hash = '#' + h; }, h); await p.waitForTimeout(40);
  }
  const mainTxt = await S(() => document.querySelector('main').textContent.slice(0, 40));
  F('Hash routing: #constructor, #__proto__, #toString and script-like hashes', !errs.length && !/object Object|function/.test(mainTxt), errs.length ? 'Page error: ' + errs.join(' | ') : 'Handled: ' + mainTxt);
  errs.length = 0;

  // ---------- 3. Student data exposure ----------
  await S(() => { E = demoSeed({}); UI.role = 'student:S101'; ME = demoMe(); go('overview'); });
  const ov = await S(() => document.querySelector('main').textContent);
  F('Student sees college-wide finance totals on Start page', !/Live books check|Verified money in feed/.test(ov), /Live books check/.test(ov) ? 'Student S101 can see total verified money, posted, pending and unallocated for the whole college' : 'Hidden');
  await S(() => go('ledger', 'S103'));
  const led = await S(() => document.querySelector('main h2').textContent);
  F('Student opens another student\'s ledger by link (#ledger-S103)', !/Zara/.test(led), 'Shown: ' + led);
  for (const v of ['queue', 'detail', 'audit', 'policy']) await S(v => go(v), v);
  const where = await S(() => UI.view);
  F('Student opens staff screens by link (queue, detail, audit, policy)', where === 'ledger', 'Ended on ' + where);
  const otherReceipt = await S(() => { const e = seededEngine(); const r = e.propose('ops', 'P3', [{ sid: 'S103', comp: 'Tuition', amount: 15000 }], 'x'); e.approve('finapp', r.prop.id); E = e; UI.role = 'student:S101'; ME = demoMe(); go('ledger'); return document.querySelector('main').textContent.includes('RCPT/26-27/00001'); });
  F('Student ledger lists another student\'s receipt', !otherReceipt, otherReceipt ? 'Leak' : 'Only own receipts shown');

  // ---------- 4. Claim enumeration oracle ----------
  await S(() => { E = demoSeed({}); UI.role = 'student:S101'; ME = demoMe(); go('ledger'); });
  await p.fill('#cl-utr', 'IMPS/430815344201'); await p.fill('#cl-amt', '25000'); await p.click('[data-act=claim]');
  const t1 = await p.locator('#toast').textContent(); const l1 = await S(() => document.querySelector('main').textContent);
  F('Student probes a UTR they did not pay (P9, Dev Nair\'s money): does the UI confirm it exists?', !/Found in bank|found in bank records\. Operations|Found in bank · being allocated/.test(t1 + l1), 'Toast: "' + t1 + '"');

  // ---------- 5. Claim hijack ----------
  const hijack = await S(() => { const e = seededEngine(); e.submitClaim('student:S102', { utr: 'UPI/430219884120', amount: 10000 }); const t = e.txn('P1'); return { matched: t.matched, cands: t.candidates.map(c => c.sid + ':' + c.conf), flags: t.flags }; });
  F('Student S102 claims P1, which carries S101\'s ID in the bank reference', !hijack.cands.includes('S102:High') && hijack.flags.some(f => /S101|reference/i.test(f) && /S102/.test(f)), JSON.stringify(hijack));

  // ---------- 6. Separation of duties ----------
  const sod = await S(() => {
    const e = seededEngine(); const out = {};
    const r = e.propose('ops', 'P9', [{ sid: 'S104', comp: 'Tuition', amount: 25000 }], 'x', 'guardian confirmed by phone'); e.approve('finapp', r.prop.id);
    const c = (e.requestCorrection || e.correct).call(e, 'finapp', r.prop.allocIds[0], 'single-person reversal of an approved allocation');
    out.singlePersonCorrection = !!(c.ok && e.allocs.find(a => a.id === r.prop.allocIds[0]).status === 'corrected');
    out.caseByStaff = e.raiseCase('ops', { text: 'fake complaint' }).ok;
    out.claimSpam = Array.from({ length: 30 }, (_, i) => e.submitClaim('student:S101', { utr: 'SPAM/' + i, amount: 1 }).ok).filter(Boolean).length;
    out.hugeAmount = (e.ingest({ source: 'bank', sourceTxnId: 'BIG/1', channel: 'x', amount: 1e15, remark: 'S101' }) || { amount: 0 }).amount;
    out.longText = e.raiseCase('student:S101', { text: 'A'.repeat(100000) }).ok ? e.cases[e.cases.length - 1].text.length : 0;
    out.fracAmount = e.submitClaim('student:S102', { utr: 'FR/1', amount: '0.4' }).ok;
    return out;
  });
  F('One Finance approver can approve an allocation and then reverse it alone', !sod.singlePersonCorrection, sod.singlePersonCorrection ? 'Correction is single-person: approve + correct with no second check' : 'Correction needs a second person');
  F('Staff can file mismatch cases pretending to be a student', !sod.caseByStaff, sod.caseByStaff ? 'Ops filed a case with no student' : 'Refused');
  F('Student can flood Operations with claims', sod.claimSpam <= 10, sod.claimSpam + ' claims accepted in a row');
  F('Implausible amounts accepted (₹1,00,00,00,00,00,00,000)', sod.hugeAmount <= 1e8 || sod.hugeAmount === 0, 'Stored ' + sod.hugeAmount);
  F('Unbounded free text (100,000-character case)', sod.longText <= 2000, 'Stored ' + sod.longText + ' chars');
  F('Fractional or zero claim amount', !sod.fracAmount, sod.fracAmount ? 'Accepted ₹0.4 rounded to 0' : 'Refused');

  // ---------- 7. Least privilege on the audit log ----------
  await S(() => { E = demoSeed({}); UI.role = 'counsellor'; ME = demoMe(); go('audit'); });
  const cv = await S(() => UI.view);
  F('Counsellor can read the full audit log (evidence notes, all students)', cv !== 'audit', cv === 'audit' ? 'Counsellor reads every audit entry' : 'Redirected');

  // ---------- 8. Network and storage ----------
  const net = html.match(/https?:\/\/[^"'\s)>]+/g) || [];
  const hosts = [...new Set(net.map(u => new URL(u).host))];
  F('Outbound network destinations in page source', hosts.every(h => /fonts\.(googleapis|gstatic)\.com/.test(h)), hosts.join(', '));
  F('Uses fetch/XHR/WebSocket/beacon/eval', !/\bfetch\(|XMLHttpRequest|WebSocket|sendBeacon|\beval\(|new Function/.test(html), 'none found');
  F('Writes to localStorage/sessionStorage/cookies', !/localStorage|sessionStorage|document\.cookie/.test(html), 'none found');
  F('Reads uploaded screenshot contents', !/FileReader|readAsDataURL|\.arrayBuffer\(/.test(html), 'Only the file name is read; file never leaves the browser');
  F('Standalone file declares a Content-Security-Policy', /Content-Security-Policy/.test(html) || !html.startsWith('<!doctype'), /Content-Security-Policy/.test(html) ? 'present' : 'missing (published page is protected by the platform CSP; standalone copy is not)');

  console.log(JSON.stringify(findings, null, 1));
  console.log(findings.filter(f => !f.ok).length + ' findings open of ' + findings.length + ' checks');
  await b.close();
})();
