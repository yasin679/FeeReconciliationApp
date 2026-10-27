// Live scenario suite: drives the real page with clicks/typing like a user would.
const { chromium } = require('playwright');
const fs = require('fs');
const FILE = process.argv[2] || 'fee_reconciliation_desk.html';
const html = fs.readFileSync(FILE, 'utf8');
const wrap = h => h.startsWith('<!doctype') ? h : '<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body>' + h + '</body></html>';

(async () => {
  const b = await chromium.launch();
  const ctx = await b.newContext({ viewport: { width: 1360, height: 900 } });
  await ctx.route(/fonts\.(googleapis|gstatic)\.com/, r => r.abort());
  const p = await ctx.newPage();
  let errs = [];
  p.on('pageerror', e => errs.push('PAGEERROR ' + e.message));
  p.on('console', m => { if (m.type() === 'error' && !/ERR_FAILED|Failed to load resource/.test(m.text())) errs.push('CONSOLE ' + m.text()); });
  await p.setContent(wrap(html), { waitUntil: 'load' });

  const S = fn => p.evaluate(fn);
  const role = async r => { await p.selectOption('#role', r); };
  const goto = async (v, s) => { await p.evaluate(([v, s]) => go(v, s), [v, s]); };
  const reset = async () => { await p.setViewportSize({ width: 1360, height: 900 }); await p.evaluate(() => { closeModal(); E = demoSeed({}); UI.ed = null; UI.tests = null; UI.role = 'ops'; ME = demoMe(); render(); }); errs = []; };
  const toastText = async () => (await p.locator('#toast').textContent()) || '';
  const click = async sel => { await p.locator(sel).first().click({ timeout: 4000 }); };
  const setLine = async (i, sid, comp, amt) => {
    const row = `#ed-rows .edrow[data-i="${i}"]`;
    if (sid) await p.selectOption(`${row} [data-ed=sid]`, sid);
    if (comp) await p.selectOption(`${row} [data-ed=comp]`, comp);
    if (amt !== undefined) await p.fill(`${row} [data-ed=amount]`, String(amt));
  };
  const invariants = async () => S(() => {
    const t = E.totals(); const out = [];
    if (t.diff !== 0) out.push('control difference ' + t.diff);
    const ids = E.receipts.map(r => r.allocId); if (new Set(ids).size !== ids.length) out.push('duplicate receipt for one allocation');
    const keys = E.ledger.map(l => l.key); if (new Set(keys).size !== keys.length) out.push('duplicate ledger key');
    E.txns.forEach(x => { if ((x.kind === 'payment' || x.kind === 'cash') && !x.duplicateOf && E.allocatable(x) < 0) out.push(x.id + ' over-allocated'); });
    E.students.forEach(s => { if (E.ledger.filter(l => l.sid === s.id).length && !E.student(s.id)) out.push('orphan'); });
    return out;
  });
  const results = [];
  async function scenario(name, fn) {
    await reset();
    let fail = [];
    try { const r = await fn(); if (Array.isArray(r)) fail.push(...r.filter(Boolean)); }
    catch (e) { fail.push('THREW ' + String(e.message).split('\n')[0]); }
    fail.push(...(await invariants().catch(e => ['invariant check threw ' + e.message])));
    fail.push(...errs);
    results.push({ name, ok: !fail.length, fail });
  }
  const expect = (cond, msg) => cond ? null : msg;

  await scenario('S01 Ops matches P1 → Admission; Ops cannot approve; Finance approves; ledger + receipt', async () => {
    await goto('detail', 'P1'); await setLine(0, null, 'Admission'); await p.fill('#ed-reason', 'Reference S101'); await click('#ed-go');
    const opsBtn = await p.locator('[data-act=approve]').isDisabled();
    await role('finapp'); await p.fill('input[id^=ap-PR]', 'ok'); await click('[data-act=approve]');
    const st = await S(() => ({ paid: E.postedFor('S101', 'Admission'), rc: E.receipts.filter(r => r.txnId === 'P1').length }));
    return [expect(opsBtn, 'Ops approve button not disabled'), expect(st.paid === 10000, 'S101 admission paid ' + st.paid), expect(st.rc === 1, 'receipts ' + st.rc)];
  });

  await scenario('S02 P6 split through the UI, approved, money counted once', async () => {
    await goto('detail', 'P6'); await setLine(0, null, 'Tuition'); await setLine(1, null, 'Tuition'); await p.fill('#ed-reason', 'Per bank remark'); await click('#ed-go');
    await role('finapp'); await click('[data-act=approve]');
    const st = await S(() => ({ r: E.receipts.filter(r => r.txnId === 'P6').length, a: E.allocatable(E.txn('P6')), net: E.totals().net }));
    return [expect(st.r === 2, 'P6 receipts ' + st.r), expect(st.a === 0, 'P6 unallocated ' + st.a), expect(st.net === 100000, 'net ' + st.net)];
  });

  await scenario('S03 Finance rejects a proposal, Ops re-proposes straight away', async () => {
    await goto('detail', 'P9'); await setLine(0, 'S104', 'Tuition', 25000); await p.fill('#ed-reason', 'Name match'); await p.fill('#ed-evidence', 'Guardian confirmed from ••5482');
    await click('#ed-go');
    await role('finapp'); await p.fill('input[id^=ap-PR]', 'Need remittance advice'); await click('[data-act=reject]');
    await role('ops'); await setLine(0, 'S104', 'Tuition', 25000); await p.fill('#ed-reason', 'Remittance advice received'); await p.fill('#ed-evidence', 'Remittance advice REM-221 names S104');
    await click('#ed-go'); const t = await toastText();
    const n = await S(() => E.proposals.filter(x => x.txnId === 'P9' && x.status === 'proposed').length);
    return [expect(n === 1, 'Re-proposal failed: "' + t + '"')];
  });

  await scenario('S04 Bank re-sends the P8 reversal; open its detail page', async () => {
    await click('#btn-sim'); await p.fill('#s-id', 'RVSL/430712008711'); await p.fill('#s-amt', '-5000'); await p.fill('#s-remark', 'Partial reversal of P3'); await p.fill('#s-rev', 'UPI/430312902337');
    await click('[data-act=sim-bank]');
    const dup = await S(() => E.txns[E.txns.length - 1].duplicateOf);
    const shown = await p.locator('h2').first().textContent();
    return [expect(dup === 'P8', 'not flagged duplicate'), expect(/P10/.test(shown), 'detail page did not render')];
  });

  await scenario('S05 Reversal whose remark points at duplicate P4', async () => {
    await click('#btn-sim'); await p.fill('#s-id', 'RVSL/X1'); await p.fill('#s-amt', '-1000'); await p.fill('#s-remark', 'Reversal of P4'); await click('[data-act=sim-bank]');
    const st = await S(() => E.txns[E.txns.length - 1].reversal);
    return [expect(st && st.state === 'exception', 'reversal linked to duplicate P4: ' + JSON.stringify(st))];
  });

  await scenario('S06 Positive amount wrongly tagged with a reversal reference', async () => {
    await click('#btn-sim'); await p.fill('#s-id', 'NEFT/POS1'); await p.fill('#s-amt', '5000'); await p.fill('#s-remark', 'S102'); await p.fill('#s-rev', 'UPI/430312902337'); await click('[data-act=sim-bank]');
    const k = await S(() => E.txns[E.txns.length - 1].kind);
    const p3 = await S(() => E.txn('P3').reversedApplied);
    return [expect(k === 'payment', 'positive credit treated as ' + k)];
  });

  await scenario('S07 Re-import of P1 with different formatting (lower case, spaces)', async () => {
    await click('#btn-sim'); await p.fill('#s-id', ' upi/430219884120 '); await p.fill('#s-amt', '10000'); await p.fill('#s-remark', 'S101'); await click('[data-act=sim-bank]');
    const d = await S(() => E.txns[E.txns.length - 1].duplicateOf);
    return [expect(d === 'P1', 'formatted re-import not caught as duplicate')];
  });

  await scenario('S08 Student types UTR digits only; bank credit arrives later', async () => {
    await role('student:S101'); await p.fill('#cl-utr', '4309 1122 3344'); await p.fill('#cl-amt', '12,000'); await click('[data-act=claim]');
    await role('ops'); await click('#btn-sim'); await p.fill('#s-id', 'UPI/430911223344'); await p.fill('#s-amt', '12000'); await p.fill('#s-remark', ''); await click('[data-act=sim-bank]');
    const st = await S(() => { const c = E.txns.find(t => t.kind === 'claim' && t.studentHint === 'S101'); return c && c.verification; });
    return [expect(st === 'linked', 'claim not linked: ' + st)];
  });

  await scenario('S09 Two students claim the same UTR', async () => {
    await role('student:S101'); await p.fill('#cl-utr', 'UPI/430618771204'); await p.fill('#cl-amt', '20000'); await click('[data-act=claim]');
    await role('ops'); await click('#btn-sim'); await p.fill('#s-id', 'UPI/430618771204'); await p.fill('#s-amt', '20000'); await p.fill('#s-remark', ''); await click('[data-act=sim-bank]');
    const st = await S(() => { const t = E.txns[E.txns.length - 1]; return { high: t.candidates.filter(c => c.conf === 'High').length, flag: t.flags.some(f => /two students|both|more than one/i.test(f)) }; });
    return [expect(st.high < 2, 'two High candidates for one payment'), expect(st.flag, 'no conflict flag')];
  });

  await scenario('S10 Payment before registration → sync → retry → allocate', async () => {
    await click('#btn-sim'); await p.fill('#s-id', 'IMPS/LATE1'); await p.fill('#s-amt', '25000'); await p.fill('#s-remark', 'S105'); await click('[data-act=sim-bank]');
    const id = await S(() => UI.sel);
    await click('#btn-sim'); await click('[data-act=sim-tab][data-tab=reg]'); await click('[data-act=sim-reg]');
    await goto('detail', id); await click('[data-act=lookup]');
    await setLine(0, null, 'Admission', 25000); await p.fill('#ed-reason', 'Ref S105'); await click('#ed-go');
    await role('finapp'); await click('[data-act=approve]');
    await goto('ledger', 'S105');
    const st = await S(() => E.postedFor('S105'));
    return [expect(st === 25000, 'S105 posted ' + st)];
  });

  await scenario('S11 Cash P5: counsellor evidence → counsellor cannot verify → finance verifies → allocate', async () => {
    await role('counsellor'); await goto('detail', 'P5');
    await p.selectOption('#cash-sid', 'S102'); await p.fill('#cash-book', 'CRB-1'); await p.fill('#cash-dep', 'DEP-1'); await click('[data-act=cash-evidence]');
    const dis = await p.locator('[data-act=cash-verify]').isDisabled();
    await role('finrev'); await p.check('#cash-confirm'); await click('[data-act=cash-verify]');
    await setLine(0, null, 'Tuition'); await p.fill('#ed-reason', 'Cash verified'); await click('#ed-go');
    await role('finapp'); await click('[data-act=approve]');
    const st = await S(() => E.postedFor('S102'));
    return [expect(dis, 'counsellor could verify own cash'), expect(st === 10000, 'S102 posted ' + st)];
  });

  await scenario('S12 Student-system timeout → retry twice → one entry', async () => {
    await goto('policy'); await p.check('#pol-fail');
    await goto('detail', 'P1'); await setLine(0, null, 'Admission'); await p.fill('#ed-reason', 'x'); await click('#ed-go');
    await role('finapp'); await click('[data-act=approve]');
    const failed = await S(() => E.ledger.filter(l => l.txnId === 'P1').length);
    await click('[data-act=retry]');
    const st = await S(() => ({ l: E.ledger.filter(l => l.txnId === 'P1').length, r: E.receipts.filter(r => r.txnId === 'P1').length }));
    const r2 = await S(() => { const p = E.proposals.find(x => x.txnId === 'P1'); return E.retry('ops', p.id).noop; });
    return [expect(failed === 0, 'posted on failure'), expect(st.l === 1 && st.r === 1, JSON.stringify(st)), expect(r2, 'second retry not noop')];
  });

  await scenario('S13 Wrong allocation corrected, then re-allocated correctly', async () => {
    await goto('detail', 'P9'); await setLine(0, 'S104', 'Tuition', 25000); await p.fill('#ed-reason', 'x'); await p.fill('#ed-evidence', 'guardian confirmed by phone'); await click('#ed-go');
    await role('finapp'); await click('[data-act=approve]');
    await role('ops'); await click('[data-act=correct-open]'); await p.fill('#corr-reason', 'Payer is parent of S102 per bank'); await click('[data-act=correct-request]'); await role('finapp'); await click('button[data-act=correct]');
    await role('ops'); await setLine(0, 'S102', 'Tuition', 25000); await p.fill('#ed-reason', 'Bank confirmed'); await p.fill('#ed-evidence', 'Bank letter names S102 as beneficiary student');
    await click('#ed-go'); const t = await toastText();
    await role('finapp'); await click('[data-act=approve]');
    const st = await S(() => ({ s104: E.postedFor('S104'), s102: E.postedFor('S102') }));
    return [expect(st.s104 === 0 && st.s102 === 25000, JSON.stringify(st) + ' toast: ' + t)];
  });

  await scenario('S14 Reset while signed in as a late-registered student', async () => {
    await click('#btn-sim'); await click('[data-act=sim-tab][data-tab=reg]'); await click('[data-act=sim-reg]');
    await role('student:S105'); await click('#btn-reset');
    const h = await p.locator('h2').first().textContent();
    return [expect(!!h, 'page blank after reset')];
  });

  await scenario('S15 Oversized second reversal on P3 goes to exception and can be closed', async () => {
    await role('finapp'); await goto('detail', 'P8'); await click('[data-act=reverse]');
    await click('#btn-sim'); await p.fill('#s-id', 'RVSL/BIG'); await p.fill('#s-amt', '-12000'); await p.fill('#s-remark', 'Reversal of P3'); await p.fill('#s-rev', 'UPI/430312902337'); await click('[data-act=sim-bank]');
    const st = await S(() => E.txns[E.txns.length - 1].reversal.state);
    const closeBtn = await p.locator('[data-act=rev-close]').count();
    return [expect(st === 'exception', 'state ' + st), expect(closeBtn > 0, 'no way to close a reversal exception (stays in queue forever)')];
  });

  await scenario('S16 Deep links to missing records', async () => {
    await p.evaluate(() => { location.hash = '#detail-P999'; }); await p.waitForTimeout(50);
    await p.evaluate(() => { location.hash = '#ledger-S999'; }); await p.waitForTimeout(50);
    await p.evaluate(() => { location.hash = '#nosuchview'; }); await p.waitForTimeout(50);
    return [];
  });

  await scenario('S17 Every view renders for every role', async () => {
    const roles = ['ops', 'counsellor', 'finrev', 'finapp', 'admin', 'student:S101', 'student:S102', 'student:S103', 'student:S104'];
    const views = ['overview', 'queue', 'detail', 'ledger', 'audit', 'policy', 'check', 'workflow'];
    for (const r of roles) { await role(r); for (const v of views) await goto(v); }
    for (const id of ['P1', 'P2', 'P3', 'P4', 'P5', 'P6', 'P7', 'P8', 'P9']) { await role('ops'); await goto('detail', id); }
    return [];
  });

  await scenario('S18 Phone width: no sideways page scroll on any view', async () => {
    await p.setViewportSize({ width: 390, height: 844 });
    const bad = [];
    for (const v of ['overview', 'queue', 'detail', 'ledger', 'audit', 'policy', 'check', 'workflow']) {
      await goto(v); const w = await S(() => document.documentElement.scrollWidth); if (w > 392) bad.push(v + ' ' + w + 'px');
    }
    await click('#btn-sim'); const mw = await S(() => document.documentElement.scrollWidth); if (mw > 392) bad.push('sim modal ' + mw);
    await p.keyboard.press('Escape');
    await p.setViewportSize({ width: 1360, height: 900 });
    return bad.map(x => 'overflow: ' + x);
  });

  await scenario('S19 Admin turns on AA-1, resets; P1 and P3 auto-post', async () => {
    await role('admin'); await goto('policy'); await p.selectOption('#pol-comp', 'admission-first'); await click('[data-act=reset]');
    const st = await S(() => ({ s101: E.postedFor('S101', 'Admission'), aud: E.audit.some(a => a.action === 'Policy setting changed') }));
    await S(() => { E.settings.componentPolicy = 'none'; });
    return [expect(st.s101 === 10000, 'P1 not auto-posted: ' + st.s101)];
  });

  await scenario('S20 Overpayment needs an approval note', async () => {
    await goto('detail', 'P6'); await setLine(0, null, 'Admission'); await setLine(1, null, 'Admission'); await p.fill('#ed-reason', 'x'); await click('#ed-go');
    await goto('detail', 'P9'); await setLine(0, 'S104', 'Admission', 25000); await p.fill('#ed-reason', 'x'); await p.fill('#ed-evidence', 'guardian confirmed by phone'); await click('#ed-go');
    await role('finapp'); await click('[data-act=approve]');
    const blocked = await S(() => E.proposals.find(x => x.txnId === 'P9').status);
    return [expect(blocked === 'proposed', 'overpayment approved without note (S104 admission pending 15k + 25k > 25k due)')];
  });

  await scenario('S21 Student view shows a linked + posted claim as recognised', async () => {
    await click('#btn-sim'); await p.fill('#s-id', 'UPI/430618771204'); await p.fill('#s-amt', '20000'); await p.fill('#s-remark', ''); await click('[data-act=sim-bank]');
    await setLine(0, 'S102', 'Tuition', 20000); await p.fill('#ed-reason', 'Claim UTR matches'); await click('#ed-go');
    await role('finapp'); await click('[data-act=approve]');
    await role('student:S102');
    const txt = await p.locator('main').textContent();
    return [expect(!/being allocated/.test(txt), 'student still told the posted payment is "being allocated"')];
  });

  await scenario('S22 Books check card counts student claims it says it counts', async () => {
    await goto('overview');
    const st = await S(() => { const txt = document.querySelector('main').textContent; return txt.includes('₹30,000'); });
    return [expect(st, 'overview "claimed or reported, unverified" omits P7 claim (shows only cash)')];
  });

  await scenario('S23 Queue keyboard access', async () => {
    await goto('queue'); const ti = await p.locator('tr[data-open]').first().getAttribute('tabindex');
    return [expect(ti === '0', 'queue rows not reachable by keyboard')];
  });

  await scenario('S24 Search, filters and audit filter while typing', async () => {
    await goto('queue'); await p.fill('#q', 'mehta'); const n = await p.locator('tr[data-open]').count();
    await click('[data-filter=all]'); await goto('audit'); const opsBlocked = await S(() => UI.view !== 'audit'); await role('finrev'); await goto('audit'); await p.fill('#aq', 'denied'); if (!opsBlocked) throw new Error('Operations reached the audit log');
    return [expect(n >= 1, 'search found nothing for mehta')];
  });

  await scenario('S25 Two proposals pending, reversal tries to over-commit', async () => {
    await goto('detail', 'P1'); await setLine(0, null, 'Admission', 6000); await p.fill('#ed-reason', 'part'); await click('#ed-go');
    await setLine(0, 'S101', 'Tuition', 4000); await p.fill('#ed-reason', 'rest'); await click('#ed-go');
    await role('finapp'); const btns = p.locator('[data-act=approve]'); await btns.nth(0).click(); await p.locator('[data-act=approve]').first().click();
    const st = await S(() => ({ a: E.allocatable(E.txn('P1')), r: E.receipts.filter(r => r.txnId === 'P1').length }));
    return [expect(st.a === 0 && st.r === 2, JSON.stringify(st))];
  });


  await scenario('S26 Same bank ID re-sent with a different amount', async () => {
    await click('#btn-sim'); await p.fill('#s-id', 'UPI/430219884120'); await p.fill('#s-amt', '25000'); await p.fill('#s-remark', 'S101'); await click('[data-act=sim-bank]');
    const st = await S(() => E.status(E.txn(UI.sel)).label);
    const dis = await p.locator('[data-act=conflict-close]').isDisabled();
    await role('finrev'); await p.fill('#conf-note', 'Bank confirms P1 is the correct line'); await click('[data-act=conflict-close]');
    const after = await S(() => E.status(E.txn(UI.sel)).key);
    await goto('queue'); const kpi = await p.locator('.kpi.t-muted .v').textContent();
    return [expect(st === 'Same ID, different amount', 'status ' + st), expect(dis, 'Ops could close conflict'), expect(after === 'dup', 'not closed ' + after), expect(kpi.trim() === '2', 'duplicate KPI ' + kpi)];
  });

  await scenario('S27 Run the in-app QA suite from the Engineering page', async () => {
    await role('finrev'); await goto('check'); await click('[data-act=tests]'); await p.waitForTimeout(300);
    const txt = await p.locator('main').textContent();
    return [expect(/25\/25 passing/.test(txt), 'in-app suite not all passing')];
  });

  console.log(JSON.stringify(results, null, 1));
  console.log(`\n${results.filter(r => r.ok).length}/${results.length} scenarios clean`);
  await b.close();
})();
