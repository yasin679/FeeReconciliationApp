const { seededEngine } = require('./eng.js');
let seed = 424242; const rnd = n => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed % n; };
const pick = a => a[rnd(a.length)];
const roles = ['ops','counsellor','finrev','finapp','admin','student:S101','student:S102','system'];
const sids = ['S101','S102','S103','S104','S105','S999',''];
const comps = ['Admission','Tuition',''];
const problems = new Map(); let steps = 0, okActs = 0;
for (let run = 0; run < 60; run++) {
  const e = seededEngine({ smsFail: run % 3 === 0, componentPolicy: run % 4 === 0 ? 'admission-first' : 'none' });
  for (let i = 0; i < 400; i++) {
    steps++;
    const t = pick(e.txns); const a = pick(roles); const pr = pick(e.proposals.length ? e.proposals : [{ id: 'X' }]);
    const al = pick(e.allocs.length ? e.allocs : [{ id: 'X' }]);
    const amt = pick([1, 500, 5000, 10000, 15000, 20000, 25000, 30000, 60000, -1, 0]);
    let r;
    try {
      switch (rnd(17)) {
        case 0: case 1: case 2: r = e.propose(a, t.id, Array.from({ length: 1 + rnd(3) }, () => ({ sid: pick(sids), comp: pick(comps), amount: amt })), pick(['', 'reason']), pick(['', 'guardian confirmed by phone call'])); break;
        case 3: case 4: r = e.approve(a, pr.id, pick(['', 'overpay held as credit'])); break;
        case 5: r = e.reject(a, pr.id, 'not enough evidence'); break;
        case 6: r = e.retry(a, pr.id); break;
        case 7: r = e.applyReversal(a, t.id, ''); break;
        case 8: r = rnd(2) ? e.requestCorrection(a, al.id, 'wrong student allocation') : e.correct(a, al.id); break;
        case 9: r = e.recordCashEvidence(a, t.id, { sid: pick(sids), receiptBook: 'CRB', depositRef: pick(['', 'DEP']) }); break;
        case 10: r = e.verifyCash(a, t.id, rnd(2)); break;
        case 11: r = e.ingest({ source: 'bank', sourceTxnId: pick(['UPI/430219884120', 'upi/430312902337 ', 'NEW/' + rnd(30), 'RVSL/430712008711', '430618771204']), channel: 'x', amount: pick([10000, -5000, -12000, 20000, 25000]), remark: pick(['S101', 'S105', 'S101 10000 / S104 10000', 'Reversal of P3', 'Reversal of P4', '']), reversalOf: pick(['', 'UPI/430312902337']) }); break;
        case 12: r = e.registerStudent('system', { id: 'S105', name: 'Meher' }); break;
        case 13: r = e.retryLookup(a, t.id); break;
        case 14: r = e.closeReversal(a, t.id, 'bank confirmed no reversal'); break;
        case 15: r = e.submitClaim(pick(['student:S101', 'student:S102']), { utr: pick(['430618771204', 'NEW/' + rnd(30), 'UPI/430911223344']), amount: pick([20000, 10000]) }); break;
        case 16: e.settings.smsFail = !e.settings.smsFail; break;
      }
      if (r && r.ok) okActs++;
    } catch (x) { const k = 'THREW ' + x.message; problems.set(k, (problems.get(k) || 0) + 1); }
    const T = e.totals();
    const flag = k => problems.set(k, (problems.get(k) || 0) + 1);
    if (T.diff !== 0) flag('control difference');
    e.txns.forEach(x => { if (!x.duplicateOf && (x.kind === 'payment' || x.kind === 'cash') && e.allocatable(x) < 0) flag('over-allocated payment'); if (x.kind === 'payment' && !x.duplicateOf && x.reversedApplied > x.amount) flag('reversed more than received'); });
    const rk = e.receipts.map(r => r.allocId); if (new Set(rk).size !== rk.length) flag('duplicate receipt');
    const lk = e.ledger.map(l => l.key); if (new Set(lk).size !== lk.length) flag('duplicate ledger key');
    e.ledger.forEach(l => { const x = e.txn(l.txnId); const src = l.type === 'reversal' ? e.txn(l.origTxnId) : x; if (!src || src.verification !== 'verified') flag('ledger entry from unverified money'); });
    e.proposals.forEach(p => { if (p.approver && p.approver === p.proposer) flag('self-approved');  if (p.approver && !String(p.approver).startsWith('policy') && !['finapp'].includes(String(p.approver))) flag('approved by non-approver ' + p.approver); });
    e.allocs.forEach(x => { if (x.status === 'corrected' && x.correctionRequestedBy === x.correctedBy) flag('self-approved correction'); if (x.status === 'posted' && !e.ledger.some(l => l.key === x.id)) flag('posted without ledger entry'); });
    if (e.txns.filter(x => x.source === 'bank' && !x.duplicateOf).some((x, _, arr) => arr.filter(y => y.sourceTxnId.toUpperCase().replace(/[^A-Z0-9]/g, '') === x.sourceTxnId.toUpperCase().replace(/[^A-Z0-9]/g, '')).length > 1)) flag('two live records with same bank ID');
  }
}
console.log('steps', steps, 'successful actions', okActs);
console.log(problems.size ? [...problems] : 'no invariant violations');
