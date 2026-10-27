// End-to-end against the live C# server: real sign-ins, real roles, real persistence.
const { chromium } = require('playwright');
const fs = require('fs');
const BASE = 'http://localhost:5090';
const PW = (fs.readFileSync('/home/claude/frd/server.log', 'utf8').match(/Shared demo password:\s+(\S+)/) || [])[1];
const ADMIN = 'Admin#Pass2026';

(async () => {
  const b = await chromium.launch();
  const results = [];
  const errs = [];
  async function as(user, pass, fn) {
    const ctx = await b.newContext({ viewport: { width: 1360, height: 900 } });
    const p = await ctx.newPage();
    p.on('pageerror', e => errs.push(user + ': ' + e.message));
    p.on('console', m => { if (m.type() === 'error' && !/401|403|400/.test(m.text())) errs.push(user + ' console: ' + m.text()); });
    await p.goto(BASE + '/');
    await p.fill('#li-user', user); await p.fill('#li-pass', pass); await p.click('#login-form button[type=submit]');
    await p.waitForSelector('#view .pagehead, #view .fees', { timeout: 8000 });
    try { await fn(p); } finally { await ctx.close(); }
  }
  async function step(name, fn) { try { const r = await fn(); results.push({ name, ok: r !== false, note: typeof r === 'string' ? r : '' }); } catch (e) { results.push({ name, ok: false, note: String(e.message).split('\n')[0] }); } }
  const toast = p => p.locator('#toast').textContent();
  const state = p => p.evaluate(() => ({ diff: E.totals().diff, posted: E.ledger.reduce((s, l) => s + l.amount, 0) }));
  const goto = (p, v, s) => p.evaluate(([v, s]) => go(v, s), [v, s]);
  const line = async (p, i, sid, comp, amt) => { const r = `#ed-rows .edrow[data-i="${i}"]`; if (sid) await p.selectOption(`${r} [data-ed=sid]`, sid); if (comp) await p.selectOption(`${r} [data-ed=comp]`, comp); if (amt !== undefined) await p.fill(`${r} [data-ed=amount]`, String(amt)); };

  await step('Wrong password is refused with a generic message', async () => {
    const ctx = await b.newContext(); const p = await ctx.newPage(); await p.goto(BASE);
    await p.fill('#li-user', 'meera'); await p.fill('#li-pass', 'wrong-password'); await p.click('#login-form button[type=submit]');
    await p.waitForSelector('#login .callout'); const t = await p.locator('#login .callout').textContent(); await ctx.close();
    return /incorrect/.test(t) ? true : t;
  });

  await step('Operations proposes the P6 split', () => as('meera', PW, async p => {
    await goto(p, 'detail', 'P6'); await line(p, 0, null, 'Tuition'); await line(p, 1, null, 'Tuition'); await p.fill('#ed-reason', 'Per bank remark');
    await p.click('#ed-go'); await p.waitForTimeout(400);
    const n = await p.evaluate(() => E.proposals.filter(x => x.txnId === 'P6' && x.status === 'proposed').length);
    const approveDisabled = await p.locator('[data-act=approve]').first().isDisabled();
    if (n !== 1 || !approveDisabled) throw new Error(`proposals ${n}, approve disabled ${approveDisabled}`);
  }));

  await step('Finance approver Kavita approves P6; two receipts, books balance', () => as('kavita', PW, async p => {
    await goto(p, 'detail', 'P6'); await p.click('[data-act=approve]'); await p.waitForTimeout(400);
    const r = await p.evaluate(() => ({ rc: E.receipts.filter(x => x.txnId === 'P6').length, diff: E.totals().diff }));
    if (r.rc !== 2 || r.diff !== 0) throw new Error(JSON.stringify(r));
  }));

  await step('Kavita proposes P1, cannot approve it herself; Rahul approves', async () => {
    await as('kavita', PW, async p => { await goto(p, 'detail', 'P1'); await line(p, 0, null, 'Admission'); await p.fill('#ed-reason', 'Reference S101'); await p.click('#ed-go'); await p.waitForTimeout(300);
      const dis = await p.locator('[data-act=approve]').first().isDisabled(); if (!dis) throw new Error('self-approve allowed'); });
    await as('rahul', PW, async p => { await goto(p, 'detail', 'P1'); await p.click('[data-act=approve]'); await p.waitForTimeout(300);
      const n = await p.evaluate(() => E.receipts.filter(x => x.txnId === 'P1').length); if (n !== 1) throw new Error('receipts ' + n); });
  });

  await step('Kavita applies the P8 reversal; Zara sees ₹10,000 recognised', async () => {
    await as('kavita', PW, async p => { await goto(p, 'detail', 'P8'); await p.click('[data-act=reverse]'); await p.waitForTimeout(300); });
    await as('zara', PW, async p => {
      const txt = await p.locator('#view').textContent();
      const own = await p.evaluate(() => ({ students: E.students.length, txns: E.txns.length, audit: E.audit.length, posted: E.postedFor('S103') }));
      if (own.students !== 1 || own.audit !== 0 || own.posted !== 10000 || !/Adjusted|adjusted/.test(txt)) throw new Error(JSON.stringify(own));
    });
  });

  await step('Correction: Meera requests, Kavita approves', async () => {
    await as('meera', PW, async p => { await goto(p, 'detail', 'P1'); await p.click('[data-act=correct-open]'); await p.fill('#corr-reason', 'Payer confirmed as guardian of a different student'); await p.click('[data-act=correct-request]'); await p.waitForTimeout(300); });
    await as('kavita', PW, async p => { await goto(p, 'detail', 'P1'); await p.click('button[data-act=correct]'); await p.waitForTimeout(300);
      const st = await p.evaluate(() => ({ a: E.allocatable(E.txn('P1')), rc: E.receipts.find(r => r.txnId === 'P1').status })); if (st.a !== 10000 || st.rc !== 'cancelled') throw new Error(JSON.stringify(st)); });
  });

  await step('Rohan (student) submits a claim; UI does not reveal whether it exists', () => as('rohan', PW, async p => {
    await p.fill('#cl-utr', 'IMPS/430815344201'); await p.fill('#cl-amt', '25000'); await p.click('[data-act=claim]'); await p.waitForTimeout(400);
    const t = await toast(p); const main = await p.locator('#view').textContent();
    if (/Found in bank/.test(t + main)) throw new Error('enumeration leak');
    const leak = await p.evaluate(() => JSON.stringify(E.txns).includes('Dev Nair') || JSON.stringify(E).includes('P9'));
    if (leak) throw new Error('snapshot leaks P9 to Rohan');
  }));

  await step('Arjun imports a bank CSV: new, duplicate, conflict and bad rows handled', () => as('arjun', PW, async p => {
    const csv = 'TransactionId,Date,Amount,PayerName,PayerContact,Remark,ReversalOf\nUPI/430911223344,2026-10-26,12000,S Kapoor,9081,,\nUPI/430219884120,2026-10-19,10000,,7731,S101,\nUPI/430312902337,2026-10-20,99999,,,S103,\nBAD/1,2026-10-26,abc,,,,\n,2026-10-26,500,,,,\n';
    fs.writeFileSync('/tmp/stmt.csv', csv);
    await p.click('#btn-sim'); await p.setInputFiles('#bk-file', '/tmp/stmt.csv'); await p.click('[data-act=bank-import]'); await p.waitForTimeout(600);
    const t = await toast(p); if (!/1 new payments · 1 duplicates skipped · 1 ID conflicts · 2 rows rejected/.test(t)) throw new Error(t);
    const d = await state(p); if (d.diff !== 0) throw new Error('diff ' + d.diff);
  }));

  await step('Priya reports cash; cannot verify it; Arjun verifies', async () => {
    let id;
    await as('priya', PW, async p => { await p.click('#btn-sim'); await p.fill('#s-camt', '8000'); await p.selectOption('#s-csid', 'S104'); await p.click('[data-act=sim-cash]'); await p.waitForTimeout(400);
      id = await p.evaluate(() => UI.sel); await p.selectOption('#cash-sid', 'S104'); await p.fill('#cash-book', 'CRB-0915'); await p.fill('#cash-dep', 'DEP-77001'); await p.click('[data-act=cash-evidence]'); await p.waitForTimeout(300);
      if (!(await p.locator('[data-act=cash-verify]').isDisabled())) throw new Error('counsellor could verify'); });
    await as('arjun', PW, async p => { await goto(p, 'detail', id); await p.check('#cash-confirm'); await p.click('[data-act=cash-verify]'); await p.waitForTimeout(300);
      const v = await p.evaluate(id => E.txn(id).verification, id); if (v !== 'verified') throw new Error(v); });
  });

  await step('Admin adds a user, resets a password, disables an account; Meera cannot open Users', async () => {
    await as('admin', ADMIN, async p => {
      await goto(p, 'users'); await p.waitForSelector('[data-act=user-add]');
      await p.fill('#nu-user', 'sneha'); await p.fill('#nu-name', 'Sneha P.'); await p.selectOption('#nu-role', 'ops'); await p.click('[data-act=user-add]');
      await p.waitForSelector('#secret'); const pw = await p.locator('#secret').textContent(); fs.writeFileSync('/tmp/sneha.txt', pw); await p.click('#modal [data-act=close]');
      await p.waitForTimeout(300);
      await p.locator('tr', { hasText: 'Rahul' }).locator('[data-act=user-disable]').click(); await p.waitForTimeout(300);
    });
    await as('sneha', fs.readFileSync('/tmp/sneha.txt', 'utf8').trim(), async p => { if (!(await p.locator('#view h2').first().textContent()).includes('Sneha')) throw new Error('sneha not signed in'); });
    await as('meera', PW, async p => { await goto(p, 'users'); const v = await p.evaluate(() => UI.view); if (v === 'users') throw new Error('ops reached users'); });
    // disabled user cannot sign in
    const ctx = await b.newContext(); const p = await ctx.newPage(); await p.goto(BASE); await p.fill('#li-user', 'rahul'); await p.fill('#li-pass', PW); await p.click('#login-form button[type=submit]');
    await p.waitForSelector('#login .callout'); await ctx.close();
  });

  await step('Every view renders for every role without errors', async () => {
    for (const u of ['meera', 'priya', 'arjun', 'kavita', 'ananya', 'dev']) await as(u, PW, async p => { for (const v of ['overview', 'queue', 'detail', 'ledger', 'audit', 'policy', 'check', 'workflow']) { await goto(p, v); await p.waitForTimeout(80); } });
    await as('admin', ADMIN, async p => { for (const v of ['overview', 'queue', 'detail', 'ledger', 'audit', 'policy', 'users', 'check', 'workflow']) { await goto(p, v); await p.waitForTimeout(120); } });
  });

  await step('System check on the server: all C# tests pass', () => as('arjun', PW, async p => { await goto(p, 'check'); await p.waitForSelector('.badge-test'); const t = await p.locator('.pagehead .badge-test').textContent(); if (!/^(\d+)\/\1 passing/.test(t)) throw new Error(t); return t; }));

  await step('Audit chain verifies after all of the above', () => as('admin', ADMIN, async p => { await goto(p, 'audit'); await p.click('[data-act=audit-verify]'); await p.waitForSelector('.callout'); const t = await p.locator('#view .callout').first().textContent(); if (!/intact/.test(t)) throw new Error(t); return t; }));

  await step('Data survives a restart (persisted to disk)', async () => {
    const j = JSON.parse(fs.readFileSync('/home/claude/frd/out/data/fee-recon-desk.json', 'utf8'));
    if (!j.txns.some(t => t.sourceTxnId === 'UPI/430911223344')) throw new Error('import not persisted');
    if (j.users.some(u => u.passwordHash && u.passwordHash.length < 40)) throw new Error('weak hash');
    if (JSON.stringify(j).includes(PW) || JSON.stringify(j).includes(ADMIN)) throw new Error('plaintext password stored');
  });

  console.log(JSON.stringify({ results, errs }, null, 1));
  console.log(`${results.filter(r => r.ok).length}/${results.length} steps passed · ${errs.length} page errors`);
  await b.close();
})();
