/* Fee Reconciliation Desk — rules engine (browser copy). In server mode it only derives display state; the C# server decides every action. */

/* ============================================================
   RULES ENGINE — implements PRD business rules and DR-01..DR-10
   Verification, matching, allocation, posting and receipt are
   five separate states. Nothing here is UI.
   ============================================================ */
const FEES = { Admission: 25000, Tuition: 120000 }; // illustrative; brief gives no fee values
const COMPONENTS = ['Admission', 'Tuition'];
const SEED_STUDENTS = [
  { id: 'S101', name: 'Ananya Kapoor', contact: '2140', guardian: '9081' },
  { id: 'S102', name: 'Rohan Mehta',   contact: '2189', guardian: '9874' },
  { id: 'S103', name: 'Zara Ali',      contact: '4408', guardian: '1172' },
  { id: 'S104', name: 'Dev Nair',      contact: '6622', guardian: '5482' },
];
const FEED = [
  { ref:'P1', source:'bank', sourceTxnId:'UPI/430219884120', channel:'UPI', amount:10000, payerName:'', payerContact:'7731', remark:'S101', receivedAt:'2026-10-19T10:14:00', batch:'BANK-STMT-19OCT' },
  { ref:'P2', source:'bank', sourceTxnId:'NEFT/N293260551901', channel:'Bank transfer', amount:20000, payerName:'R Mehta', payerContact:'', remark:'COLLEGE FEES', receivedAt:'2026-10-19T15:40:00', batch:'BANK-STMT-19OCT' },
  { ref:'P3', source:'bank', sourceTxnId:'UPI/430312902337', channel:'UPI', amount:15000, payerName:'', payerContact:'', remark:'S103', receivedAt:'2026-10-20T09:02:00', batch:'BANK-STMT-20OCT' },
  { ref:'P4', source:'bank', sourceTxnId:'UPI/430219884120', channel:'UPI', amount:10000, payerName:'', payerContact:'7731', remark:'S101', receivedAt:'2026-10-19T10:14:00', batch:'BANK-STMT-20OCT (re-import)' },
  { ref:'P5', source:'cash', sourceTxnId:'CASH-RPT-0041', channel:'Cash', amount:10000, payerName:'', remark:'Counsellor reports cash collected at centre', receivedAt:'2026-10-21T12:30:00', batch:'Counsellor entry' },
  { ref:'P6', source:'bank', sourceTxnId:'NEFT/N294261007733', channel:'Bank transfer', amount:30000, payerName:'', payerContact:'', remark:'S101 15000 / S104 15000', receivedAt:'2026-10-21T16:05:00', batch:'BANK-STMT-21OCT' },
  { ref:'P7', source:'upload', sourceTxnId:'UPLOAD-S102-001', channel:'UPI (claimed)', amount:20000, studentHint:'S102', claimedUtr:'UPI/430618771204', screenshot:'gpay_receipt_20000.jpg', payerName:'', receivedAt:'2026-10-22T19:20:00', batch:'Student portal' },
  { ref:'P8', source:'bank', sourceTxnId:'RVSL/430712008711', channel:'UPI reversal', amount:-5000, remark:'Partial reversal of P3', reversalOf:'UPI/430312902337', receivedAt:'2026-10-23T11:45:00', batch:'BANK-STMT-23OCT' },
  { ref:'P9', source:'bank', sourceTxnId:'IMPS/430815344201', channel:'Bank transfer', amount:25000, payerName:'Dev Nair', payerContact:'', remark:'', receivedAt:'2026-10-24T14:10:00', batch:'BANK-STMT-24OCT' },
];
const ROLES = {
  ops:        { label:'Operations executive', person:'Meera J.' },
  counsellor: { label:'Counsellor', person:'Priya S.' },
  finrev:     { label:'Finance reviewer', person:'Arjun K.' },
  finapp:     { label:'Finance approver', person:'Kavita R.' },
  admin:      { label:'Administrator', person:'Sameer D.' },
  student:    { label:'Student', person:'Student' },
  system:     { label:'System', person:'System' },
};
const PERMS = {
  viewQueue:   ['ops','counsellor','finrev','finapp','admin'],
  propose:     ['ops','finrev','finapp'],
  approve:     ['finapp'],
  retry:       ['ops','finrev','finapp'],
  recordCash:  ['counsellor','ops'],
  verifyCash:  ['finrev','finapp'],
  reversal:    ['finapp'],
  correct:     ['finapp'],
  requestCorrection: ['ops','finrev','finapp'],
  viewAudit:   ['finrev','finapp','admin'],
  importBank:  ['finrev','finapp'],
  export:      ['finrev','finapp','admin'],
  students:    ['admin'],
  users:       ['admin'],
  reportCash:  ['counsellor','ops'],
  selftest:    ['admin','finrev','finapp'],
  evidence:    ['ops','counsellor','finrev','finapp'],
  escalate:    ['ops','counsellor','finrev'],
  cases:       ['ops','finrev','finapp'],
  policy:      ['admin'],
};
const fmt = n => (n < 0 ? '−' : '') + '₹' + Math.abs(n).toLocaleString('en-IN');
const roleOf = a => String(a).split(':')[0];
let PEOPLE = null; // server mode: { userId: { name, role } }
const roleLabel = a => PEOPLE && PEOPLE[a] ? (ROLES[PEOPLE[a].role]?.label || PEOPLE[a].role) : roleOf(a) === 'student' ? 'A student' : (ROLES[roleOf(a)]?.label || a);
const personOf = a => String(a).startsWith('policy') ? 'Allocation policy AA-1' : PEOPLE && PEOPLE[a] ? PEOPLE[a].name : roleOf(a) === 'student' ? 'Student ' + String(a).split(':')[1] : (ROLES[roleOf(a)]?.person || a);
const norm = s => String(s || '').toLowerCase().replace(/[^a-z ]/g, ' ').replace(/\s+/g, ' ').trim();
const pad = (n, w = 3) => String(n).padStart(w, '0');
const ACTIVE = ['proposed', 'approved', 'post_failed', 'posted'];
// Bank IDs arrive formatted differently across exports ("UPI/4302…", "upi/4302… ", "4302 …").
const idKey = s => String(s || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
const idDigits = s => String(s || '').replace(/\D/g, '');
const clip = (s, n) => String(s ?? '').slice(0, n);
const MAX_AMOUNT = 1e8; // ₹10 crore: any single fee event above this is a data error, not a payment
const MAX_OPEN_CLAIMS = 5;
const sameId = (a, b) => !!a && !!b && (idKey(a) === idKey(b) || (idDigits(a).length >= 10 && idDigits(a) === idDigits(b)));

class Engine {
  constructor(opts = {}) {
    this.settings = { autoMatch: true, componentPolicy: 'none', smsFail: false, maxOpenClaims: MAX_OPEN_CLAIMS, ...opts };
    this.students = SEED_STUDENTS.map(s => this.mkStudent(s));
    this.txns = []; this.allocs = []; this.proposals = []; this.ledger = []; this.receipts = []; this.audit = []; this.cases = [];
    this.n = { prop: 0, a: 0, l: 0, r: 0, c: 0, au: 0, adj: 0 };
    this.clock = null;
  }
  mkStudent(s) { return { ...s, obligations: COMPONENTS.map(c => ({ id: `${s.id}-${c.slice(0,3).toUpperCase()}`, comp: c, due: FEES[c] })) }; }
  ts() { return this.clock || new Date().toISOString(); }
  can(actor, perm) { return (PERMS[perm] || []).includes(roleOf(actor)); }
  log(o) { this.audit.push({ id: ++this.n.au, ts: this.ts(), actor: o.actor, person: personOf(o.actor), role: roleLabel(o.actor), action: o.action, entity: o.entity || '', txn: o.txn || '', detail: o.detail || '', result: o.result || 'ok' }); }
  deny(actor, action, entity, txn, msg) { this.log({ actor, action, entity, txn, detail: msg, result: 'denied' }); return { ok: false, error: msg }; }
  block(actor, action, entity, txn, msg) { this.log({ actor, action, entity, txn, detail: msg, result: 'blocked' }); return { ok: false, error: msg }; }

  student(id) { return this.students.find(s => s.id === id); }
  txn(id) { return this.txns.find(t => t.id === id); }
  prop(id) { return this.proposals.find(p => p.id === id); }
  postedFor(sid, comp) { return this.ledger.filter(l => l.sid === sid && (!comp || l.comp === comp)).reduce((s, l) => s + l.amount, 0); }
  due(sid, comp) { const st = this.student(sid); return st ? st.obligations.filter(o => !comp || o.comp === comp).reduce((s, o) => s + o.due, 0) : 0; }
  outstanding(sid, comp) { return this.due(sid, comp) - this.postedFor(sid, comp); }
  pendingFor(sid, comp) { return this.allocs.filter(a => a.sid === sid && a.comp === comp && ['proposed','approved','post_failed'].includes(a.status)).reduce((s, a) => s + a.amount, 0); }
  activeNet(t) { return this.allocs.filter(a => a.txnId === t.id && ACTIVE.includes(a.status)).reduce((s, a) => s + a.amount - a.reversed, 0); }
  allocatable(t) { if (!t || t.duplicateOf || !(t.kind === 'payment' || t.kind === 'cash')) return 0; return t.amount - t.reversedApplied - this.activeNet(t); }
  pendingRev(t, excludeId) { return this.txns.filter(r => r.kind === 'reversal' && r.reversal?.originalId === t.id && r.reversal.state === 'awaiting_approval' && r.id !== excludeId).reduce((s, r) => s + Math.abs(r.amount), 0); }
  nextId() { let i = this.txns.length + 1; while (this.txn('P' + i)) i++; return 'P' + i; }

  /* ---------- ingestion (FR-001..003) ---------- */
  ingest(ev, actor = 'system') {
    // FR-002: reject malformed records at the door; they never become financial events.
    const raw = +ev.amount;
    if (!Number.isFinite(raw) || Math.round(raw) === 0 || Math.abs(raw) > MAX_AMOUNT || !String(ev.sourceTxnId || '').trim()) {
      this.log({ actor, action: 'Import rejected', entity: clip(ev.sourceTxnId, 64) || '—', detail: !String(ev.sourceTxnId || '').trim() ? 'Missing transaction ID' : `Invalid amount (${clip(ev.amount, 30)}). Allowed: non-zero, up to ${fmt(MAX_AMOUNT)}.`, result: 'blocked' });
      return null;
    }
    const id = ev.ref && !this.txn(ev.ref) ? ev.ref : this.nextId();
    const t = { id, source: ev.source, sourceTxnId: clip(String(ev.sourceTxnId || '').trim(), 64), reversalOfRef: clip(String(ev.reversalOf || '').trim(), 64), channel: clip(ev.channel, 60), amount: Math.round(raw),
      payerName: clip(ev.payerName, 120), payerContact: clip(ev.payerContact, 20), remark: clip(ev.remark, 300), receivedAt: ev.receivedAt || this.ts(), ingestedAt: this.ts(),
      batch: clip(ev.batch, 60), kind: 'payment', verification: 'verified', verificationNote: '', duplicateOf: null, candidates: [], matched: null, matchBasis: '',
      split: null, exception: null, flags: [], hold: null, notes: [], reversedApplied: 0, reversal: null, unknownRef: null,
      studentHint: ev.studentHint || null, claimedUtr: clip(ev.claimedUtr, 64), screenshot: clip(ev.screenshot, 120), linkedClaim: null, linkedBankTxn: null,
      cashEvidence: null, reportedBy: ev.source === 'cash' ? (ev.reportedBy || 'counsellor') : null, version: 0 };

    if (ev.source === 'bank') {
      const orig = this.txns.find(x => x.source === 'bank' && !x.duplicateOf && sameId(x.sourceTxnId, t.sourceTxnId));
      if (orig) {
        t.kind = t.amount < 0 ? 'reversal' : 'payment'; t.verification = 'duplicate'; t.duplicateOf = orig.id; t.exception = 'Duplicate import';
        t.verificationNote = `Same bank transaction ID as ${orig.id}. Linked, not counted as new money.`;
        if (t.amount !== orig.amount) {
          t.idConflict = true; t.exception = 'Same ID, different amount';
          t.verificationNote = `Same bank transaction ID as ${orig.id} but ${fmt(t.amount)} instead of ${fmt(orig.amount)}. Not counted as money. Finance must confirm the correct record with the bank.`;
        }
        this.txns.push(t);
        this.log({ actor, action: t.idConflict ? 'Import blocked: ID conflict' : 'Import blocked as duplicate', entity: t.id, txn: t.id, detail: t.idConflict ? t.verificationNote : `${t.sourceTxnId} already ingested as ${orig.id}. No posting, no receipt.`, result: 'blocked' });
        if (t.idConflict) this.log({ actor, action: 'Import blocked: ID conflict', entity: t.id, txn: orig.id, detail: `${t.id} re-uses this ID with ${fmt(t.amount)}` });
        return t;
      }
      t.verificationNote = 'Present in the approved bank statement feed';
      this.txns.push(t);
      this.log({ actor, action: 'Imported from bank feed', entity: t.id, txn: t.id, detail: `${fmt(t.amount)} · ${t.sourceTxnId} · batch ${t.batch || '—'}` });
      if (t.amount < 0) { t.kind = 'reversal'; this.setupReversal(t, actor); return t; }
      if (t.reversalOfRef) t.flags.push(`Feed marked this as a reversal of ${t.reversalOfRef}, but the amount is a credit. Treated as a new payment; confirm with the bank.`);
      this.txns.filter(c => c.kind === 'claim' && c.verification === 'not_found' && sameId(c.claimedUtr, t.sourceTxnId)).forEach(c => this.linkClaim(c, t, actor));
      this.match(t); this.dispose(t, actor);
      return t;
    }
    if (ev.source === 'cash') {
      t.kind = 'cash'; t.verification = 'pending'; t.exception = 'Cash not yet verified';
      t.verificationNote = 'Counsellor report only. No deposit proof or cashbook reconciliation yet.';
      if (ev.studentHint && this.student(ev.studentHint)) t.candidates.push({ sid: ev.studentHint, conf: 'Medium', reasons: ['Named by the collecting counsellor (unverified)'] });
      this.txns.push(t);
      this.log({ actor, action: 'Cash collection reported', entity: t.id, txn: t.id, detail: `${fmt(t.amount)} reported. Held as pending verification; ledger unchanged.` });
      return t;
    }
    if (ev.source === 'upload') {
      t.kind = 'claim'; t.channel = t.channel || 'Claimed payment';
      this.txns.push(t);
      this.log({ actor, action: 'Payment details submitted by student', entity: t.id, txn: t.id, detail: `Claims ${fmt(t.amount)} with UTR ${t.claimedUtr || '—'}${t.screenshot ? ' · screenshot ' + t.screenshot : ''}` });
      const bank = this.txns.find(b => b.source === 'bank' && !b.duplicateOf && b.kind === 'payment' && sameId(b.sourceTxnId, t.claimedUtr));
      if (bank) this.linkClaim(t, bank, actor);
      else { t.verification = 'not_found'; t.exception = 'Not found in bank records'; t.verificationNote = 'No transaction with this UTR in verified bank records. A screenshot is evidence to investigate, not proof of receipt.'; }
      return t;
    }
    return t;
  }
  linkClaim(claim, bank, actor) {
    claim.verification = 'linked'; claim.linkedBankTxn = bank.id; claim.exception = null;
    claim.verificationNote = `Matched to verified bank transaction ${bank.id}`;
    const prior = bank.linkedClaim ? this.txn(bank.linkedClaim) : null;
    bank.linkedClaim = bank.linkedClaim || claim.id;
    bank.linkedClaims = [...(bank.linkedClaims || []), claim.id];
    const claimants = [...new Set(bank.linkedClaims.map(id => this.txn(id)?.studentHint))];
    const existing = bank.candidates.find(c => c.sid === claim.studentHint);
    if (existing) existing.reasons.push(`Also claimed by the student in ${claim.id}`);
    else if (claim.amount === bank.amount) bank.candidates.push({ sid: claim.studentHint, conf: 'High', reasons: [`UTR and amount match student claim ${claim.id}`], basis: 'claim' });
    else { bank.flags.push(`Claim ${claim.id} quotes this UTR but a different amount (${fmt(claim.amount)})`); bank.candidates.push({ sid: claim.studentHint, conf: 'Medium', reasons: [`UTR matches claim ${claim.id}; amount differs`] }); }
    if (claimants.length > 1) {
      bank.flags.push(`Two students claim this payment: ${claimants.join(' and ')}. Neither claim is enough on its own; confirm with the payer.`);
      bank.candidates.forEach(c => { if (c.basis === 'claim') { c.conf = 'Medium'; c.basis = 'claim-conflict'; } });
    }
    // A claim can never outrank the bank's own reference: stops a student claiming money that names someone else.
    const refOwner = bank.matched || bank.candidates.find(c => c.basis === 'ref' || c.basis === 'split')?.sid;
    if (refOwner && refOwner !== claim.studentHint) {
      const c = bank.candidates.find(x => x.sid === claim.studentHint); if (c) { c.conf = 'Low'; c.basis = 'claim-disputed'; }
      bank.flags.push(`Student ${claim.studentHint} (${claim.id}) claims this payment, but the bank reference names ${refOwner}. The claim does not change the match; investigate before acting.`);
    }
    const allocatedTo = [...new Set(this.allocs.filter(a => a.txnId === bank.id && ACTIVE.includes(a.status)).map(a => a.sid))].filter(s => s !== claim.studentHint);
    if (allocatedTo.length) bank.flags.push(`${claim.id} (student ${claim.studentHint}) claims money already allocated to ${allocatedTo.join(', ')}. Investigate before changing anything.`);
    if (['No identifier', 'Name or contact similarity only'].includes(bank.exception)) bank.exception = 'Candidate needs review';
    if (prior && prior.id === claim.id) return;
    this.log({ actor, action: 'Student claim linked to bank transaction', entity: claim.id, txn: bank.id, detail: `${claim.id} ↔ ${bank.id} via UTR ${bank.sourceTxnId}` });
  }

  /* ---------- matching (FR-004) ---------- */
  match(t) {
    const text = String(t.remark || '').toUpperCase();
    const ids = [...new Set([...text.matchAll(/\bS\d{3}\b/g)].map(m => m[0]))];
    const pairs = [...text.matchAll(/\b(S\d{3})\s*[:=\-]?\s*₹?\s*(\d[\d,]*)/g)].map(m => ({ sid: m[1], amount: +m[2].replace(/,/g, '') }));
    const add = (sid, conf, reason, basis) => {
      const rank = { High: 3, Medium: 2, Low: 1 };
      const c = t.candidates.find(x => x.sid === sid);
      if (c) { c.reasons.push(reason); if (rank[conf] > rank[c.conf]) { c.conf = conf; c.basis = basis; } }
      else t.candidates.push({ sid, conf, reasons: [reason], basis });
    };
    if (ids.length >= 2) {
      t.split = pairs.length ? pairs : null;
      const sum = pairs.reduce((s, p) => s + p.amount, 0);
      const unknown = ids.filter(i => !this.student(i));
      if (pairs.length < ids.length) { t.exception = 'Several student IDs, no split amounts'; ids.filter(i => this.student(i)).forEach(i => add(i, 'Medium', 'Student ID in bank remark; amount for this student not stated')); }
      else if (unknown.length) { t.exception = `Unknown student ID in split (${unknown.join(', ')})`; t.unknownRef = unknown[0]; }
      else if (sum !== t.amount) { t.exception = `Split amounts total ${fmt(sum)}, payment is ${fmt(t.amount)}`; pairs.forEach(p => add(p.sid, 'Medium', `Remark assigns ${fmt(p.amount)}, but split does not reconcile`)); }
      else { t.exception = 'Split payment'; pairs.forEach(p => add(p.sid, 'High', `Bank remark instructs ${fmt(p.amount)} for ${p.sid}`, 'split')); }
    } else if (ids.length === 1) {
      if (this.student(ids[0])) add(ids[0], 'High', 'Valid student ID in the verified bank reference', 'ref');
      else { t.unknownRef = ids[0]; t.exception = `Reference ${ids[0]} not found in student system`; }
    }
    if (t.payerContact) {
      const last4 = String(t.payerContact).replace(/\D/g, '').slice(-4);
      this.students.forEach(s => {
        if (s.contact === last4) add(s.id, 'Medium', `Payer contact ending ${last4} matches registered contact`);
        if (s.guardian === last4) add(s.id, 'Medium', `Payer contact ending ${last4} matches guardian contact`);
      });
      if (!this.students.some(s => s.contact === last4 || s.guardian === last4)) t.flags.push(`Payer contact ending ${last4} is not on any student record. A parent, friend or sibling may have paid; this neither confirms nor rules out ownership.`);
    }
    if (t.payerName) {
      const pn = norm(t.payerName); const parts = pn.split(' ');
      this.students.forEach(s => {
        const sn = norm(s.name); const sp = sn.split(' ');
        if (sn === pn) add(s.id, 'Medium', 'Payer name exactly matches student name. Names are not unique identifiers.');
        else if (parts.length >= 2 && parts[0].length === 1 && parts[parts.length - 1] === sp[sp.length - 1] && sp[0][0] === parts[0]) add(s.id, 'Low', `"${t.payerName}" shares initial and surname with ${s.name}. Could be a parent or anyone else.`);
        else if (sp[sp.length - 1] === parts[parts.length - 1] && parts.length >= 1 && pn.length > 2) add(s.id, 'Low', `Payer surname matches ${s.name}`);
      });
    }
    const refC = t.candidates.filter(c => c.conf === 'High');
    if (refC.length && t.candidates.some(c => c.conf !== 'High' && !refC.some(r => r.sid === c.sid))) t.flags.push('Conflicting signals: the reference and the name/contact point to different students.');
  }
  dispose(t, actor = 'system') {
    const strong = t.candidates.filter(c => c.conf === 'High' && c.basis === 'ref');
    const conflict = t.flags.some(f => f.startsWith('Conflicting'));
    if (!t.split && strong.length === 1 && t.candidates.length === 1 && !conflict && this.settings.autoMatch && !t.unknownRef) {
      t.matched = strong[0].sid; t.matchBasis = 'Rule AM-1: verified bank transaction carries a valid student ID; no conflicting signal; not a duplicate';
      this.log({ actor: 'system', action: 'Auto-matched to student', entity: t.id, txn: t.id, detail: `${t.id} → ${t.matched} (${t.matchBasis})` });
      if (this.settings.componentPolicy === 'admission-first') this.autoAllocate(t);
      else { t.exception = 'Fee component not specified'; }
      return;
    }
    if (!t.exception) {
      if (!t.candidates.length) t.exception = 'No identifier';
      else if (t.candidates.every(c => c.conf !== 'High')) t.exception = 'Name or contact similarity only';
      else t.exception = 'Candidate needs review';
    }
  }
  autoAllocate(t) {
    let left = this.allocatable(t); const rows = [];
    for (const comp of COMPONENTS) {
      const out = this.outstanding(t.matched, comp) - this.pendingFor(t.matched, comp);
      const take = Math.min(left, Math.max(0, out));
      if (take > 0) { rows.push({ sid: t.matched, comp, amount: take }); left -= take; }
    }
    if (!rows.length) { t.exception = 'Overpayment — Finance policy needed'; return; }
    const p = this.mkProposal(t, rows, 'system', 'Rule AA-1: Finance-approved allocation order (admission first, then tuition)', '');
    p.status = 'approved'; p.approver = 'policy:AA-1'; p.approvedAt = this.ts();
    this.allocs.filter(a => a.propId === p.id).forEach(a => a.status = 'approved');
    this.log({ actor: 'system', action: 'Auto-allocated under approved policy', entity: p.id, txn: t.id, detail: rows.map(r => `${fmt(r.amount)} → ${r.comp}`).join('; ') });
    this.post('system', p.id);
    t.exception = left > 0 ? 'Unallocated remainder (overpayment)' : null;
  }
  mkProposal(t, rows, actor, reason, evidence) {
    const p = { id: 'PR-' + pad(++this.n.prop), txnId: t.id, proposer: actor, status: 'proposed', reason, evidence, createdAt: this.ts(), allocIds: [], note: '' };
    rows.forEach(r => {
      const out = this.outstanding(r.sid, r.comp) - this.pendingFor(r.sid, r.comp);
      const a = { id: 'AL-' + pad(++this.n.a), txnId: t.id, propId: p.id, sid: r.sid, comp: r.comp, amount: r.amount, reversed: 0, status: 'proposed', overpay: r.amount > out };
      this.allocs.push(a); p.allocIds.push(a.id);
    });
    this.proposals.push(p); t.version++;
    return p;
  }
  strongBasis(t, sid) { return t.matched === sid || t.candidates.some(c => c.sid === sid && c.conf === 'High'); }

  /* ---------- allocation, approval, posting (FR-007..012) ---------- */
  propose(actor, txnId, rows, reason = '', evidence = '', expectedVersion = null) {
    const A = 'Propose allocation'; const t = this.txn(txnId); reason = clip(reason, 1000); evidence = clip(evidence, 1000);
    if (!this.can(actor, 'propose')) return this.deny(actor, A, txnId, txnId, `${roleLabel(actor)} cannot propose allocations`);
    if (!t) return { ok: false, error: 'Unknown payment' };
    if (expectedVersion !== null && expectedVersion !== t.version) return this.block(actor, A, txnId, txnId, 'This payment changed while you were editing (another reviewer acted on it). Reload the record and try again.');
    if (t.duplicateOf) return this.block(actor, A, txnId, txnId, `${t.id} is a duplicate import of ${t.duplicateOf}. It carries no money of its own.`);
    if (!(t.kind === 'payment' || t.kind === 'cash')) return this.block(actor, A, txnId, txnId, 'Only payments can be allocated. Claims and reversals are linked records.');
    if (t.verification !== 'verified') return this.block(actor, A, txnId, txnId, 'Funds are not verified. Allocation stays disabled until the money is confirmed in a trusted source.');
    rows = (rows || []).filter(r => r && (r.sid || r.amount || r.comp));
    if (!rows.length) return this.block(actor, A, txnId, txnId, 'Add at least one allocation line');
    for (const r of rows) {
      if (!this.student(r.sid)) return this.block(actor, A, txnId, txnId, 'Choose a valid student on every line');
      if (!COMPONENTS.includes(r.comp)) return this.block(actor, A, txnId, txnId, 'Choose the fee component on every line. The system does not guess admission versus tuition.');
      if (!(Number.isInteger(r.amount) && r.amount > 0)) return this.block(actor, A, txnId, txnId, 'Amounts must be whole rupees above zero');
    }
    const sum = rows.reduce((s, r) => s + r.amount, 0); const free = this.allocatable(t);
    if (sum > free) return this.block(actor, A, txnId, txnId, `Lines total ${fmt(sum)} but only ${fmt(free)} of ${t.id} is unallocated`);
    if (!String(reason).trim()) return this.block(actor, A, txnId, txnId, 'Give a reason for the allocation');
    const weak = [...new Set(rows.filter(r => !this.strongBasis(t, r.sid)).map(r => r.sid))];
    if (weak.length && String(evidence).trim().length < 10) return this.block(actor, A, txnId, txnId, `${weak.join(', ')} has no verified identifier on this payment. A name or contact resemblance is not proof. Record the corroborating evidence first.`);
    const p = this.mkProposal(t, rows, actor, reason, evidence);
    this.log({ actor, action: A, entity: p.id, txn: t.id, detail: rows.map(r => `${fmt(r.amount)} → ${r.sid} ${r.comp}`).join('; ') + (evidence ? ` · Evidence: ${evidence}` : '') + ` · Reason: ${reason}` });
    return { ok: true, prop: p };
  }
  approve(actor, propId, note = '') {
    const A = 'Approve allocation'; const p = this.prop(propId); const tx = p?.txnId || ''; note = clip(note, 1000);
    if (!this.can(actor, 'approve')) return this.deny(actor, A, propId, tx, `${roleLabel(actor)} cannot approve allocations`);
    if (!p || p.status !== 'proposed') return this.block(actor, A, propId, tx, 'Only proposed allocations can be approved');
    if (p.proposer === actor) return this.block(actor, A, propId, tx, 'Separation of duties: the person who proposed an allocation cannot approve it');
    const t = this.txn(p.txnId); const mine = this.allocs.filter(a => a.propId === p.id);
    if (t.verification !== 'verified') return this.block(actor, A, propId, tx, 'Funds are no longer verified');
    const others = this.allocs.filter(a => a.txnId === t.id && a.propId !== p.id && ['approved', 'posted', 'post_failed'].includes(a.status)).reduce((s, a) => s + a.amount - a.reversed, 0);
    const room = t.amount - t.reversedApplied - others; const total = mine.reduce((s, a) => s + a.amount, 0);
    if (total > room) return this.block(actor, A, propId, tx, `Funds changed after this proposal: only ${fmt(room)} is still free. Reject and re-propose.`);
    if (mine.some(a => a.overpay) && String(note).trim().length < 5) return this.block(actor, A, propId, tx, 'A line exceeds the fee outstanding. Record the overpayment treatment in the approval note.');
    p.status = 'approved'; p.approver = actor; p.approvedAt = this.ts(); p.note = note;
    mine.forEach(a => a.status = 'approved');
    this.log({ actor, action: A, entity: p.id, txn: t.id, detail: `Approved ${fmt(total)} on ${t.id}` + (note ? ` · ${note}` : '') });
    return this.post('system', p.id);
  }
  reject(actor, propId, reason = '') {
    const A = 'Reject allocation'; const p = this.prop(propId); const tx = p?.txnId || ''; reason = clip(reason, 1000);
    if (!this.can(actor, 'approve')) return this.deny(actor, A, propId, tx, `${roleLabel(actor)} cannot reject allocations`);
    if (!p || p.status !== 'proposed') return this.block(actor, A, propId, tx, 'Only proposed allocations can be rejected');
    if (String(reason).trim().length < 5) return this.block(actor, A, propId, tx, 'Give a reason so the proposer knows what to fix');
    p.status = 'rejected'; p.note = reason; this.allocs.filter(a => a.propId === p.id).forEach(a => a.status = 'rejected');
    this.txn(p.txnId).version++;
    this.log({ actor, action: A, entity: p.id, txn: tx, detail: reason });
    return { ok: true };
  }
  post(actor, propId) {
    const p = this.prop(propId); const allocs = this.allocs.filter(a => a.propId === propId);
    if (!p) return { ok: false, error: 'Unknown proposal' };
    if (p.status === 'posted') { this.log({ actor, action: 'Post to student system', entity: p.id, txn: p.txnId, detail: 'Already posted. Idempotent no-op; no second entry or receipt.' }); return { ok: true, noop: true }; }
    if (!['approved', 'post_failed'].includes(p.status)) return { ok: false, error: 'Only approved allocations can be posted' };
    if (this.settings.smsFail && !p.failedOnce) {
      p.failedOnce = true; p.status = 'post_failed'; allocs.forEach(a => a.status = 'post_failed');
      this.log({ actor: 'system', action: 'Post to student system', entity: p.id, txn: p.txnId, detail: `Student-management system timed out. Nothing posted. Retry is safe: idempotency key ${p.id}.`, result: 'failed' });
      return { ok: true, failed: true };
    }
    allocs.forEach(a => {
      if (!this.ledger.some(l => l.key === a.id)) this.ledger.push({ id: 'LE-' + pad(++this.n.l, 4), key: a.id, sid: a.sid, comp: a.comp, amount: a.amount, type: 'payment', txnId: a.txnId, allocId: a.id, ts: this.ts() });
      a.status = 'posted'; a.postedAt = this.ts();
      if (!this.receipts.some(r => r.allocId === a.id)) this.receipts.push({ no: 'RCPT/26-27/' + pad(++this.n.r, 5), allocId: a.id, sid: a.sid, txnId: a.txnId, comp: a.comp, amount: a.amount, status: 'issued', issuedAt: this.ts(), adjustments: [] });
    });
    p.status = 'posted';
    this.log({ actor: 'system', action: 'Posted to student ledger', entity: p.id, txn: p.txnId, detail: `${allocs.length} line(s) posted with idempotency key ${p.id}; one receipt per line` });
    return { ok: true };
  }
  retry(actor, propId) {
    const p = this.prop(propId);
    if (!this.can(actor, 'retry')) return this.deny(actor, 'Retry posting', propId, p?.txnId, `${roleLabel(actor)} cannot retry postings`);
    this.log({ actor, action: 'Retry posting', entity: propId, txn: p?.txnId, detail: 'Manual retry requested' });
    return this.post(actor, propId);
  }

  /* ---------- reversals (FR-013) ---------- */
  setupReversal(t, actor) {
    let orig = null; let why = 'Original payment not found';
    const reversible = x => x && x.source === 'bank' && x.kind === 'payment' && !x.duplicateOf;
    if (t.reversalOfRef) orig = this.txns.find(x => reversible(x) && sameId(x.sourceTxnId, t.reversalOfRef)) || null;
    if (!orig) {
      const m = String(t.remark).toUpperCase().match(/\bP\d+\b/);
      const c = m ? this.txn(m[0]) : null;
      if (reversible(c)) orig = c;
      else if (c) why = c.duplicateOf ? `${c.id} is a duplicate import of ${c.duplicateOf}; reverse the original instead` : `${c.id} is not a bank payment, so it cannot be reversed by the bank`;
    }
    t.reversal = { originalId: orig?.id || null, state: 'awaiting_approval', reason: '' };
    t.exception = 'Reversal';
    if (!orig) { t.reversal.state = 'exception'; t.reversal.reason = why; t.exception = 'Reversal: original not found'; }
    else {
      const remaining = orig.amount - orig.reversedApplied - this.pendingRev(orig, t.id);
      if (Math.abs(t.amount) > remaining) { t.reversal.state = 'exception'; t.reversal.reason = `Reversal ${fmt(Math.abs(t.amount))} exceeds the unreversed ${fmt(remaining)} on ${orig.id}`; t.exception = 'Reversal exceeds remaining amount'; }
    }
    this.log({ actor: 'system', action: 'Reversal validated', entity: t.id, txn: t.id, detail: t.reversal.state === 'exception' ? t.reversal.reason : `Linked to ${orig.id}. Awaiting Finance approval before any balance changes.`, result: t.reversal.state === 'exception' ? 'blocked' : 'ok' });
  }
  relinkReversal(actor, revId) {
    const r = this.txn(revId);
    if (!this.can(actor, 'reversal')) return this.deny(actor, 'Retry reversal link', revId, revId, `${roleLabel(actor)} cannot work reversals`);
    if (!r || r.kind !== 'reversal' || r.duplicateOf || r.reversal.state !== 'exception') return this.block(actor, 'Retry reversal link', revId, revId, 'Only reversal exceptions can be re-checked');
    this.setupReversal(r, actor); r.version++;
    return { ok: true, state: r.reversal.state };
  }
  closeReversal(actor, revId, note = '') {
    const A = 'Close reversal without applying'; const r = this.txn(revId); note = clip(note, 1000);
    if (!this.can(actor, 'reversal')) return this.deny(actor, A, revId, revId, `${roleLabel(actor)} cannot close reversals`);
    if (!r || r.kind !== 'reversal' || r.duplicateOf || !['exception', 'awaiting_approval'].includes(r.reversal.state)) return this.block(actor, A, revId, revId, 'Only open reversals can be closed');
    if (String(note).trim().length < 10) return this.block(actor, A, revId, revId, 'Record what the bank confirmed (at least 10 characters)');
    r.reversal.state = 'closed'; r.reversal.note = note; r.reversal.approver = actor; r.exception = null;
    this.log({ actor, action: A, entity: r.id, txn: r.id, detail: `No balance change. ${note}` });
    if (r.reversal.originalId) this.log({ actor, action: A, entity: r.id, txn: r.reversal.originalId, detail: `${r.id} closed without applying. ${note}` });
    return { ok: true };
  }
  reversalImpact(r) {
    const orig = this.txn(r.reversal?.originalId); if (!orig) return null;
    let left = Math.abs(r.amount); const fromAllocs = [];
    const posted = this.allocs.filter(a => a.txnId === orig.id && a.status === 'posted' && a.amount - a.reversed > 0).reverse();
    for (const a of posted) { if (left <= 0) break; const take = Math.min(left, a.amount - a.reversed); fromAllocs.push({ a, take }); left -= take; }
    const unalloc = this.allocatable(orig);
    return { orig, fromAllocs, fromUnallocated: left, ok: left <= unalloc, unalloc, netBefore: orig.amount - orig.reversedApplied, netAfter: orig.amount - orig.reversedApplied - Math.abs(r.amount) };
  }
  applyReversal(actor, revId, note = '') {
    const A = 'Apply reversal'; const r = this.txn(revId); note = clip(note, 1000);
    if (!this.can(actor, 'reversal')) return this.deny(actor, A, revId, revId, `${roleLabel(actor)} cannot apply reversals`);
    if (!r || r.kind !== 'reversal' || r.duplicateOf) return this.block(actor, A, revId, revId, 'Not an applicable reversal');
    if (r.reversal.state !== 'awaiting_approval') return this.block(actor, A, revId, revId, r.reversal.state === 'applied' ? 'Already applied' : (r.reversal.reason || 'Reversal is in exception'));
    const imp = this.reversalImpact(r);
    const remaining = imp.orig.amount - imp.orig.reversedApplied;
    if (Math.abs(r.amount) > remaining) { r.reversal.state = 'exception'; r.reversal.reason = 'Exceeds remaining amount'; return this.block(actor, A, revId, revId, `Reversal exceeds the unreversed ${fmt(remaining)}`); }
    if (!imp.ok) return this.block(actor, A, revId, revId, `${fmt(imp.fromUnallocated)} must come from unallocated funds, but only ${fmt(imp.unalloc)} is free because allocations are pending. Reject or reduce the pending proposal first.`);
    imp.fromAllocs.forEach(({ a, take }) => {
      a.reversed += take;
      const adj = 'ADJ/26-27/' + pad(++this.n.adj, 4);
      this.ledger.push({ id: 'LE-' + pad(++this.n.l, 4), key: `${r.id}:${a.id}`, sid: a.sid, comp: a.comp, amount: -take, type: 'reversal', txnId: r.id, origTxnId: imp.orig.id, allocId: a.id, ts: this.ts() });
      const rc = this.receipts.find(x => x.allocId === a.id);
      if (rc) { rc.status = 'adjusted'; rc.adjustments.push({ no: adj, amount: -take, revId: r.id }); }
    });
    imp.orig.reversedApplied += Math.abs(r.amount); imp.orig.version++;
    r.reversal.state = 'applied'; r.reversal.approver = actor; r.reversal.note = note; r.exception = null;
    this.log({ actor, action: A, entity: r.id, txn: imp.orig.id, detail: `${fmt(r.amount)} applied to ${imp.orig.id}. Original kept; net recognised ${fmt(imp.netBefore)} → ${fmt(imp.netAfter)}.` + (note ? ` · ${note}` : '') });
    this.log({ actor, action: A, entity: r.id, txn: r.id, detail: `Applied against ${imp.orig.id}` });
    return { ok: true };
  }

  /* ---------- cash (FR-014) ---------- */
  recordCashEvidence(actor, txnId, ev) {
    const A = 'Record cash evidence'; const t = this.txn(txnId);
    if (!this.can(actor, 'recordCash')) return this.deny(actor, A, txnId, txnId, `${roleLabel(actor)} cannot record cash evidence`);
    if (!t || t.kind !== 'cash') return this.block(actor, A, txnId, txnId, 'Not a cash record');
    if (t.verification === 'verified') return this.block(actor, A, txnId, txnId, 'Cash already verified');
    if (!this.student(ev.sid)) return this.block(actor, A, txnId, txnId, 'Name the student the cash was collected for');
    if (!String(ev.receiptBook || '').trim() || !String(ev.depositRef || '').trim()) return this.block(actor, A, txnId, txnId, 'Both the cash receipt-book number and the bank deposit slip reference are required');
    ev = { sid: ev.sid, receiptBook: clip(ev.receiptBook, 40), depositRef: clip(ev.depositRef, 40) };
    t.cashEvidence = { ...ev, by: actor, at: this.ts() };
    t.candidates = [{ sid: ev.sid, conf: 'Medium', reasons: [`Named in cash receipt ${ev.receiptBook}; pending Finance verification`] }];
    t.verificationNote = `Evidence submitted (receipt ${ev.receiptBook}, deposit ${ev.depositRef}). Awaiting Finance to match the deposit to the bank statement and cashbook.`;
    t.version++;
    this.log({ actor, action: A, entity: t.id, txn: t.id, detail: `Student ${ev.sid} · receipt book ${ev.receiptBook} · deposit slip ${ev.depositRef}` });
    return { ok: true };
  }
  verifyCash(actor, txnId, confirmed) {
    const A = 'Verify cash deposit'; const t = this.txn(txnId);
    if (!this.can(actor, 'verifyCash')) return this.deny(actor, A, txnId, txnId, `${roleLabel(actor)} cannot verify cash. The collector cannot verify their own collection.`);
    if (!t || t.kind !== 'cash') return this.block(actor, A, txnId, txnId, 'Not a cash record');
    if (!t.cashEvidence) return this.block(actor, A, txnId, txnId, 'No receipt-book or deposit evidence recorded yet');
    if (!confirmed) return this.block(actor, A, txnId, txnId, 'Confirm the deposit appears in the bank statement and the cashbook before verifying');
    t.verification = 'verified'; t.matched = t.cashEvidence.sid; t.matchBasis = 'Cash receipt-book entry and bank deposit verified by Finance';
    t.candidates = [{ sid: t.matched, conf: 'High', reasons: ['Deposit verified against bank statement and cashbook'] }];
    t.exception = 'Fee component not specified'; t.verificationNote = `Deposit ${t.cashEvidence.depositRef} matched to bank statement and cashbook`; t.version++;
    this.log({ actor, action: A, entity: t.id, txn: t.id, detail: t.verificationNote });
    return { ok: true };
  }

  /* ---------- corrections (FR-015) ---------- */
  // Maker-checker: one person requests, a different Finance approver approves. Nobody can approve and then undo alone.
  requestCorrection(actor, allocId, reason = '') {
    const A = 'Request correction'; const a = this.allocs.find(x => x.id === allocId);
    reason = clip(reason, 1000);
    if (!this.can(actor, 'requestCorrection')) return this.deny(actor, A, allocId, a?.txnId, `${roleLabel(actor)} cannot request corrections`);
    if (!a || a.status !== 'posted') return this.block(actor, A, allocId, a?.txnId, 'Only posted allocations can be corrected');
    if (a.corrReq) return this.block(actor, A, allocId, a.txnId, 'A correction is already waiting for approval');
    if (reason.trim().length < 10) return this.block(actor, A, allocId, a.txnId, 'Record why the allocation was wrong (at least 10 characters)');
    a.corrReq = { by: actor, reason, at: this.ts() }; this.txn(a.txnId).version++;
    this.log({ actor, action: A, entity: a.id, txn: a.txnId, detail: `${fmt(a.amount - a.reversed)} for ${a.sid} ${a.comp}. Reason: ${reason}. Needs a different Finance approver.` });
    return { ok: true };
  }
  rejectCorrection(actor, allocId, note = '') {
    const A = 'Reject correction'; const a = this.allocs.find(x => x.id === allocId);
    if (!this.can(actor, 'correct')) return this.deny(actor, A, allocId, a?.txnId, `${roleLabel(actor)} cannot decide corrections`);
    if (!a || !a.corrReq) return this.block(actor, A, allocId, a?.txnId, 'No correction request on this allocation');
    this.log({ actor, action: A, entity: a.id, txn: a.txnId, detail: clip(note, 1000) || 'Rejected' }); a.corrReq = null; this.txn(a.txnId).version++;
    return { ok: true };
  }
  correct(actor, allocId) {
    const A = 'Approve correction'; const a = this.allocs.find(x => x.id === allocId);
    if (!this.can(actor, 'correct')) return this.deny(actor, A, allocId, a?.txnId, `${roleLabel(actor)} cannot approve corrections`);
    if (!a || a.status !== 'posted') return this.block(actor, A, allocId, a?.txnId, 'Only posted allocations can be corrected');
    if (!a.corrReq) return this.block(actor, A, allocId, a.txnId, 'Request the correction first; a second person approves it');
    if (a.corrReq.by === actor) return this.block(actor, A, allocId, a.txnId, 'Separation of duties: the person who requested a correction cannot approve it');
    const reason = a.corrReq.reason;
    const net = a.amount - a.reversed;
    this.ledger.push({ id: 'LE-' + pad(++this.n.l, 4), key: 'corr:' + a.id, sid: a.sid, comp: a.comp, amount: -net, type: 'correction', txnId: a.txnId, allocId: a.id, ts: this.ts() });
    a.status = 'corrected'; a.correctedBy = actor; a.correctionReason = reason; a.correctionRequestedBy = a.corrReq.by; a.corrReq = null;
    const rc = this.receipts.find(x => x.allocId === a.id); if (rc) { rc.status = 'cancelled'; rc.cancelReason = reason; }
    this.txn(a.txnId).version++;
    this.log({ actor, action: A, entity: a.id, txn: a.txnId, detail: `Compensating entry ${fmt(-net)} for ${a.sid} ${a.comp}. Original allocation kept; receipt ${rc?.no || ''} cancelled. Reason: ${reason}` });
    return { ok: true };
  }

  /* ---------- investigation helpers ---------- */
  requestEvidence(actor, txnId, what) {
    const t = this.txn(txnId);
    if (!this.can(actor, 'evidence')) return this.deny(actor, 'Request evidence', txnId, txnId, `${roleLabel(actor)} cannot request evidence`);
    if (!String(what || '').trim()) return this.block(actor, 'Request evidence', txnId, txnId, 'Say what evidence is needed');
    what = clip(what, 1000); t.hold = 'Waiting on payer'; t.notes.push({ by: actor, at: this.ts(), text: what });
    this.log({ actor, action: 'Requested evidence', entity: t.id, txn: t.id, detail: what });
    return { ok: true };
  }
  escalate(actor, txnId, why) {
    const t = this.txn(txnId);
    if (!this.can(actor, 'escalate')) return this.deny(actor, 'Escalate', txnId, txnId, `${roleLabel(actor)} cannot escalate`);
    why = clip(why, 1000); t.hold = 'Escalated to Finance'; t.notes.push({ by: actor, at: this.ts(), text: why || 'Escalated' });
    this.log({ actor, action: 'Escalated to Finance', entity: t.id, txn: t.id, detail: why || '' });
    return { ok: true };
  }
  recheckClaim(actor, txnId) {
    const t = this.txn(txnId);
    if (!this.can(actor, 'evidence')) return this.deny(actor, 'Re-check bank feed', txnId, txnId, `${roleLabel(actor)} cannot re-check claims`);
    if (t.verification === 'linked') return { ok: true, linked: t.linkedBankTxn };
    const bank = this.txns.find(b => b.source === 'bank' && !b.duplicateOf && b.kind === 'payment' && sameId(b.sourceTxnId, t.claimedUtr));
    if (bank) { this.linkClaim(t, bank, actor); return { ok: true, linked: bank.id }; }
    this.log({ actor, action: 'Re-checked bank feed', entity: t.id, txn: t.id, detail: `UTR ${t.claimedUtr} still not in verified bank records` });
    return { ok: true, linked: null };
  }
  retryLookup(actor, txnId) {
    const t = this.txn(txnId);
    if (!this.can(actor, 'propose')) return this.deny(actor, 'Retry student lookup', txnId, txnId, `${roleLabel(actor)} cannot retry lookups`);
    t.candidates = []; t.exception = null; t.unknownRef = null; t.split = null; t.flags = []; t.matched = null;
    this.match(t); this.dispose(t, actor); t.version++;
    this.log({ actor, action: 'Retried student lookup', entity: t.id, txn: t.id, detail: t.matched ? `Now matched to ${t.matched}` : (t.exception || 'Still unmatched') });
    return { ok: true };
  }
  registerStudent(actor, s) {
    if (!/^S\d{3}$/.test(s.id || '')) return { ok: false, error: 'Student ID must look like S105' };
    if (this.student(s.id)) return { ok: false, error: `${s.id} already exists` };
    if (!String(s.name || '').trim()) return { ok: false, error: 'Name required' };
    this.students.push(this.mkStudent({ contact: '', guardian: '', id: s.id, name: clip(s.name, 80) }));
    this.log({ actor, action: 'Student registration synced from student system', entity: s.id, detail: `${s.id} · ${s.name}` });
    return { ok: true };
  }
  submitClaim(actor, c) {
    const sid = String(actor).split(':')[1];
    if (roleOf(actor) !== 'student' || !this.student(sid)) return { ok: false, error: 'Only a signed-in student can submit payment details' };
    const amount = Math.round(+c.amount || 0);
    if (!(amount > 0) || amount > MAX_AMOUNT) return { ok: false, error: 'Enter the amount you paid, in whole rupees' };
    const utr = clip(String(c.utr || '').trim(), 64);
    if (!utr) return { ok: false, error: 'Enter the UTR / transaction reference from your bank or UPI app' };
    const dup = this.txns.find(t => t.kind === 'claim' && t.studentHint === sid && sameId(t.claimedUtr, utr));
    if (dup) return { ok: false, error: `You already submitted this reference (${dup.id})` };
    const open = this.txns.filter(t => t.kind === 'claim' && t.studentHint === sid && t.verification === 'not_found').length;
    if (open >= (this.settings.maxOpenClaims || MAX_OPEN_CLAIMS)) { this.log({ actor, action: 'Payment details refused', entity: sid, detail: `${open} claims already under review`, result: 'blocked' }); return { ok: false, error: `You already have ${open} payments under review. Please wait for those to be checked, or raise a mismatch case.` }; }
    const t = this.ingest({ source: 'upload', sourceTxnId: `UPLOAD-${sid}-${pad(this.txns.length + 1)}`, channel: 'Claimed payment', amount, studentHint: sid, claimedUtr: utr, screenshot: clip(c.file, 120), payerName: clip(c.payerName, 120), receivedAt: this.ts() }, actor);
    return { ok: true, txn: t };
  }
  raiseCase(actor, c) {
    const sid = String(actor).split(':')[1];
    if (roleOf(actor) !== 'student' || !this.student(sid)) return this.deny(actor, 'Raise mismatch case', '', '', 'Only a signed-in student can raise a mismatch case for themselves');
    if (!String(c.text || '').trim()) return { ok: false, error: 'Describe what looks wrong' };
    if (this.cases.filter(k => k.sid === sid && k.status === 'open').length >= (this.settings.maxOpenClaims || MAX_OPEN_CLAIMS)) return { ok: false, error: 'You already have several open cases. Operations will reply to those first.' };
    c = { ref: clip(c.ref, 64), text: clip(c.text, 1000) };
    const k = { id: 'CASE-' + pad(++this.n.c), sid, ref: c.ref || '', text: c.text, status: 'open', at: this.ts(), resolution: '' };
    this.cases.push(k);
    this.log({ actor, action: 'Mismatch case raised', entity: k.id, txn: c.ref || '', detail: `${c.ref ? c.ref + ': ' : ''}${c.text}` });
    return { ok: true, case: k };
  }
  resolveCase(actor, id, note) {
    const k = this.cases.find(c => c.id === id);
    if (!this.can(actor, 'cases')) return this.deny(actor, 'Resolve case', id, '', `${roleLabel(actor)} cannot resolve cases`);
    if (!String(note || '').trim()) return this.block(actor, 'Resolve case', id, '', 'Add the resolution the student will see');
    if (!k || k.status !== 'open') return this.block(actor, 'Resolve case', id, '', 'Case not found or already resolved');
    k.status = 'resolved'; k.resolution = clip(note, 1000); k.resolvedBy = actor;
    this.log({ actor, action: 'Resolved case', entity: id, txn: k.ref, detail: k.resolution });
    return { ok: true };
  }
  closeConflict(actor, txnId, note = '') {
    const A = 'Close ID conflict'; const t = this.txn(txnId); note = clip(note, 1000);
    if (!this.can(actor, 'verifyCash')) return this.deny(actor, A, txnId, txnId, `${roleLabel(actor)} cannot resolve bank-data conflicts`);
    if (!t || !t.idConflict || t.conflictClosed) return this.block(actor, A, txnId, txnId, 'No open ID conflict on this record');
    if (String(note).trim().length < 10) return this.block(actor, A, txnId, txnId, 'Record what the bank confirmed (at least 10 characters)');
    t.conflictClosed = true; t.exception = 'Duplicate import'; t.notes.push({ by: actor, at: this.ts(), text: note });
    this.log({ actor, action: A, entity: t.id, txn: t.id, detail: `Kept ${t.duplicateOf} as the true record; ${t.id} stays non-financial. ${note}` });
    return { ok: true };
  }
  setPolicy(actor, key, value) {
    if (!this.can(actor, 'policy')) return this.deny(actor, 'Change policy', key, '', `${roleLabel(actor)} cannot change policy settings`);
    const before = this.settings[key]; this.settings[key] = value;
    this.log({ actor, action: 'Policy setting changed', entity: key, detail: `${before} → ${value}` });
    return { ok: true };
  }

  /* ---------- reporting (FR-019) ---------- */
  status(t) {
    if (t.duplicateOf && t.idConflict && !t.conflictClosed) return { key: 'conflict', label: 'Same ID, different amount', tone: 'bad' };
    if (t.duplicateOf) return { key: 'dup', label: 'Duplicate — not posted', tone: 'muted' };
    if (t.kind === 'reversal') {
      const s = t.reversal?.state;
      if (s === 'applied') return { key: 'done', label: 'Reversal applied', tone: 'ok' };
      if (s === 'closed') return { key: 'done', label: 'Reversal closed — not applied', tone: 'muted' };
      if (s === 'exception') return { key: 'rev', label: 'Reversal exception', tone: 'bad' };
      return { key: 'rev', label: 'Reversal — awaiting approval', tone: 'rev' };
    }
    if (t.kind === 'claim') return t.verification === 'linked' ? { key: 'done', label: `Claim linked to ${t.linkedBankTxn}`, tone: 'ok' } : { key: 'verify', label: 'Claim — not in bank records', tone: 'warn' };
    if (t.verification !== 'verified') return { key: 'verify', label: t.cashEvidence ? 'Cash — evidence with Finance' : 'Cash — unverified', tone: 'warn' };
    const props = this.proposals.filter(p => p.txnId === t.id);
    if (props.some(p => p.status === 'post_failed')) return { key: 'approval', label: 'Posting failed — retry', tone: 'bad' };
    if (props.some(p => p.status === 'proposed')) return { key: 'approval', label: 'Awaiting approval', tone: 'info' };
    const free = this.allocatable(t);
    if (free <= 0) return { key: 'done', label: 'Allocated and posted', tone: 'ok' };
    if (this.activeNet(t) > 0) return { key: 'review', label: `Partly allocated · ${fmt(free)} left`, tone: 'info' };
    if (t.split && t.exception === 'Split payment') return { key: 'review', label: 'Split — propose lines', tone: 'info' };
    if (t.matched) return { key: 'review', label: 'Matched — choose fee component', tone: 'info' };
    if (t.unknownRef) return { key: 'review', label: 'Reference not in student system', tone: 'warn' };
    if (t.candidates.some(c => c.conf === 'High')) return { key: 'review', label: 'Strong candidate — confirm and allocate', tone: 'info' };
    if (t.candidates.length) return { key: 'review', label: 'Candidate — needs evidence', tone: 'warn' };
    return { key: 'review', label: 'Unmatched — no identifier', tone: 'bad' };
  }
  owner(t) {
    const s = this.status(t).key;
    if (s === 'done' || s === 'dup') return '—';
    if (s === 'approval' || s === 'rev') return 'Finance approver';
    if (s === 'conflict') return 'Finance reviewer';
    if (s === 'verify') return t.kind === 'cash' ? (t.cashEvidence ? 'Finance reviewer' : 'Counsellor') : 'Operations';
    if (t.hold === 'Escalated to Finance') return 'Finance reviewer';
    return 'Operations';
  }
  totals() {
    const pays = this.txns.filter(t => (t.kind === 'payment' || t.kind === 'cash') && !t.duplicateOf);
    const verified = pays.filter(t => t.verification === 'verified');
    const feedGross = verified.reduce((s, t) => s + t.amount, 0);
    const reversed = verified.reduce((s, t) => s + t.reversedApplied, 0);
    const posted = this.ledger.reduce((s, l) => s + l.amount, 0);
    const pending = this.allocs.filter(a => ['proposed', 'approved', 'post_failed'].includes(a.status)).reduce((s, a) => s + a.amount - a.reversed, 0);
    const unalloc = verified.reduce((s, t) => s + this.allocatable(t), 0);
    const unverified = pays.filter(t => t.verification !== 'verified').reduce((s, t) => s + t.amount, 0);
    const claimed = this.txns.filter(t => t.kind === 'claim' && t.verification === 'not_found').reduce((s, t) => s + t.amount, 0);
    return { feedGross, reversed, net: feedGross - reversed, posted, pending, unalloc, unverified, claimed, diff: feedGross - reversed - posted - pending - unalloc };
  }
}
function seededEngine(opts) {
  const e = new Engine(opts);
  FEED.forEach(ev => { e.clock = new Date(new Date(ev.receivedAt).getTime() + 4 * 60000).toISOString(); e.ingest(ev); });
  e.clock = null;
  return e;
}

/* ---------- automated product QA (runs in the browser) ---------- */
const TESTS = [
  { id: 'TC-01', ac: 'AC-01', name: 'Valid student ID in a verified reference is matched, but not posted while the fee component is undefined', run(c) {
    const e = seededEngine(); const t = e.txn('P1');
    c('P1 matched to S101 by rule AM-1', t.matched === 'S101');
    c('Unregistered payer contact is flagged, not treated as a mismatch', t.flags.some(f => f.includes('7731')));
    c('No ledger entry and no receipt yet', e.ledger.length === 0 && e.receipts.length === 0);
  } },
  { id: 'TC-02', ac: 'AC-02', name: 'With a Finance-approved allocation order, P1 posts automatically once', run(c) {
    const e = seededEngine({ componentPolicy: 'admission-first' });
    c('₹10,000 posted to S101 Admission', e.postedFor('S101', 'Admission') === 10000);
    c('Exactly one receipt for P1', e.receipts.filter(r => r.txnId === 'P1').length === 1);
    c('P3 also auto-posted to S103', e.postedFor('S103') === 15000);
  } },
  { id: 'TC-03', ac: 'AC-03', name: 'Duplicate import P4 and a full re-import create no new money, posting or receipt', run(c) {
    const e = seededEngine({ componentPolicy: 'admission-first' });
    const before = { l: e.ledger.length, r: e.receipts.length, net: e.totals().net };
    c('P4 linked as duplicate of P1', e.txn('P4').duplicateOf === 'P1');
    c('P4 has nothing to allocate', e.allocatable(e.txn('P4')) === 0);
    c('Proposing on P4 is blocked', !e.propose('ops', 'P4', [{ sid: 'S101', comp: 'Tuition', amount: 10000 }], 'test').ok);
    FEED.forEach(ev => e.ingest({ ...ev, ref: null }));
    c('Re-importing all nine records changes no ledger entry, receipt or verified total', e.ledger.length === before.l && e.receipts.length === before.r && e.totals().net === before.net);
  } },
  { id: 'TC-04', ac: 'AC-04', name: 'P6 split: one source transaction, two allocation lines, money counted once', run(c) {
    const e = seededEngine(); const netBefore = e.totals().net;
    const r = e.propose('ops', 'P6', [{ sid: 'S101', comp: 'Tuition', amount: 15000 }, { sid: 'S104', comp: 'Tuition', amount: 15000 }], 'Per bank remark');
    c('Proposal accepted', r.ok);
    c('Approved by Finance approver and posted', e.approve('finapp', r.prop.id).ok && e.prop(r.prop.id).status === 'posted');
    const lines = e.allocs.filter(a => a.txnId === 'P6');
    c('Two allocation rows reference one source payment', lines.length === 2 && e.txns.filter(t => t.sourceTxnId === 'NEFT/N294261007733').length === 1);
    c('Lines sum to ₹30,000; P6 fully allocated', lines.reduce((s, a) => s + a.amount, 0) === 30000 && e.allocatable(e.txn('P6')) === 0);
    c('Verified total unchanged by the split', e.totals().net === netBefore);
    c('One receipt per student line', e.receipts.filter(x => x.txnId === 'P6').length === 2);
  } },
  { id: 'TC-05', ac: 'AC-05', name: 'Allocation above the available amount is blocked', run(c) {
    const e = seededEngine();
    const r = e.propose('ops', 'P6', [{ sid: 'S101', comp: 'Tuition', amount: 20000 }, { sid: 'S104', comp: 'Tuition', amount: 15000 }], 'test');
    c('₹35,000 against ₹30,000 rejected', !r.ok && /only ₹30,000/.test(r.error));
    c('Missing fee component rejected', !e.propose('ops', 'P6', [{ sid: 'S101', comp: '', amount: 15000 }], 'test').ok);
  } },
  { id: 'TC-06', ac: 'AC-06', name: 'Name-only candidates (P2, P9) need recorded evidence before any proposal', run(c) {
    const e = seededEngine();
    c('P2 "R Mehta" is a Low candidate, not a match', e.txn('P2').candidates.some(x => x.sid === 'S102' && x.conf === 'Low') && !e.txn('P2').matched);
    c('P9 "Dev Nair" is a Medium candidate, not a match', e.txn('P9').candidates.some(x => x.sid === 'S104' && x.conf === 'Medium') && !e.txn('P9').matched);
    c('Proposing P9 → S104 without evidence is blocked', !e.propose('ops', 'P9', [{ sid: 'S104', comp: 'Tuition', amount: 25000 }], 'name matches').ok);
    const r = e.propose('ops', 'P9', [{ sid: 'S104', comp: 'Tuition', amount: 25000 }], 'Confirmed by guardian', 'Guardian confirmed by call to registered number ••5482; remittance advice on file');
    c('With evidence it becomes a proposal, still unposted', r.ok && e.ledger.length === 0);
  } },
  { id: 'TC-07', ac: 'AC-07', name: 'Maker-checker: nobody approves their own proposal; only Finance approvers approve', run(c) {
    const e = seededEngine();
    const r = e.propose('finapp', 'P3', [{ sid: 'S103', comp: 'Tuition', amount: 15000 }], 'Per reference');
    c('Finance approver cannot approve own proposal', !e.approve('finapp', r.prop.id).ok);
    const r2 = e.propose('ops', 'P1', [{ sid: 'S101', comp: 'Admission', amount: 10000 }], 'Per reference');
    c('Operations cannot approve', !e.approve('ops', r2.prop.id).ok);
    c('Denied attempt written to audit log', e.audit.some(a => a.result === 'denied' && a.action === 'Approve allocation'));
  } },
  { id: 'TC-08', ac: 'AC-08', name: 'P5 cash stays out of the ledger until Finance verifies the deposit', run(c) {
    const e = seededEngine(); const t = e.txn('P5');
    c('Cash is pending, not verified', t.verification === 'pending');
    c('Allocation blocked while unverified', !e.propose('ops', 'P5', [{ sid: 'S102', comp: 'Tuition', amount: 10000 }], 'test').ok);
    c('Counsellor cannot verify their own collection', !e.verifyCash('counsellor', 'P5', true).ok);
    c('Counsellor records receipt-book and deposit evidence', e.recordCashEvidence('counsellor', 'P5', { sid: 'S102', receiptBook: 'CRB-0912', depositRef: 'DEP-55120' }).ok);
    c('Finance reviewer verifies; ledger still unchanged until allocation is approved', e.verifyCash('finrev', 'P5', true).ok && e.ledger.length === 0);
  } },
  { id: 'TC-09', ac: 'AC-09', name: 'P7 screenshot is not proof; a later bank credit with the same UTR links to it', run(c) {
    const e = seededEngine(); const t = e.txn('P7');
    c('Claim is "not found", never verified', t.verification === 'not_found');
    c('Nothing to allocate, no receipt', e.allocatable(t) === 0 && !e.receipts.some(r => r.sid === 'S102'));
    const b = e.ingest({ source: 'bank', sourceTxnId: 'UPI/430618771204', channel: 'UPI', amount: 20000, remark: '' });
    c('Bank credit links to claim P7', e.txn('P7').verification === 'linked' && b.linkedClaim === 'P7');
    c('S102 becomes a High candidate, still awaiting allocation', b.candidates.some(x => x.sid === 'S102' && x.conf === 'High') && e.ledger.length === 0);
  } },
  { id: 'TC-10', ac: 'AC-10', name: 'P8 partial reversal after posting keeps P3 and nets it to ₹10,000', run(c) {
    const e = seededEngine();
    const r = e.propose('ops', 'P3', [{ sid: 'S103', comp: 'Tuition', amount: 15000 }], 'Per reference'); e.approve('finapp', r.prop.id);
    c('Reversal waits for approval; no balance change yet', e.txn('P8').reversal.state === 'awaiting_approval' && e.postedFor('S103') === 15000);
    c('Finance approver applies it', e.applyReversal('finapp', 'P8').ok);
    c('P3 still shows ₹15,000 gross', e.txn('P3').amount === 15000);
    c('S103 net recognised ₹10,000', e.postedFor('S103') === 10000);
    c('Receipt marked adjusted with linked note', e.receipts.find(x => x.txnId === 'P3').status === 'adjusted');
  } },
  { id: 'TC-11', ac: 'AC-11', name: 'A reversal larger than the unreversed amount is blocked', run(c) {
    const e = seededEngine(); e.applyReversal('finapp', 'P8');
    const r = e.ingest({ source: 'bank', sourceTxnId: 'RVSL/999', channel: 'UPI reversal', amount: -12000, remark: 'Reversal P3', reversalOf: 'UPI/430312902337' });
    c('−₹12,000 against ₹10,000 remaining goes to exception', r.reversal.state === 'exception');
    c('It cannot be applied', !e.applyReversal('finapp', r.id).ok && e.txn('P3').reversedApplied === 5000);
  } },
  { id: 'TC-12', ac: 'AC-03', name: 'Re-delivered reversal event is idempotent', run(c) {
    const e = seededEngine(); e.applyReversal('finapp', 'P8');
    const d = e.ingest({ ...FEED[7], ref: null });
    c('Second P8 delivery flagged duplicate', !!d.duplicateOf);
    c('P3 reversed only once', e.txn('P3').reversedApplied === 5000);
  } },
  { id: 'TC-13', ac: 'AC-12', name: 'Student-system timeout: retry posts exactly once', run(c) {
    const e = seededEngine({ smsFail: true });
    const r = e.propose('ops', 'P3', [{ sid: 'S103', comp: 'Tuition', amount: 15000 }], 'Per reference'); e.approve('finapp', r.prop.id);
    c('First attempt fails; nothing posted', e.prop(r.prop.id).status === 'post_failed' && e.ledger.length === 0);
    e.retry('ops', r.prop.id); e.retry('ops', r.prop.id);
    c('After two retries: one ledger entry, one receipt', e.ledger.length === 1 && e.receipts.length === 1);
  } },
  { id: 'TC-14', ac: 'AC-07', name: 'Unauthorised actions are denied and logged', run(c) {
    const e = seededEngine();
    const r = e.propose('ops', 'P3', [{ sid: 'S103', comp: 'Tuition', amount: 15000 }], 'Per reference');
    c('Student cannot approve', !e.approve('student:S103', r.prop.id).ok);
    c('Administrator cannot propose or approve (no bypass)', !e.propose('admin', 'P1', [{ sid: 'S101', comp: 'Tuition', amount: 1 }], 'x').ok && !e.approve('admin', r.prop.id).ok);
    c('Counsellor cannot apply a reversal', !e.applyReversal('counsellor', 'P8').ok);
    c('Each denial is in the audit log', e.audit.filter(a => a.result === 'denied').length >= 4);
  } },
  { id: 'TC-15', ac: 'AC-13', name: 'Payment arrives before registration: held, then matched after sync', run(c) {
    const e = seededEngine();
    const t = e.ingest({ source: 'bank', sourceTxnId: 'UPI/LATE-1', channel: 'UPI', amount: 25000, remark: 'S105' });
    c('Held as unknown reference; no student invented', t.unknownRef === 'S105' && !e.student('S105'));
    e.registerStudent('system', { id: 'S105', name: 'Meher Shah' }); e.retryLookup('ops', t.id);
    c('After sync and retry it matches S105', e.txn(t.id).matched === 'S105');
  } },
  { id: 'TC-16', ac: 'AC-14', name: 'Correcting a wrong allocation keeps history and frees the funds', run(c) {
    const e = seededEngine();
    const r = e.propose('ops', 'P9', [{ sid: 'S104', comp: 'Tuition', amount: 25000 }], 'Guardian confirmed', 'Guardian confirmed via registered contact'); e.approve('finapp', r.prop.id);
    c('Correction request needs a reason', !e.requestCorrection('ops', r.prop.allocIds[0], 'x').ok);
    c('Requested by Operations', e.requestCorrection('ops', r.prop.allocIds[0], 'Payer later identified as parent of another student').ok);
    c('Approved by a different person (Finance approver)', e.correct('finapp', r.prop.allocIds[0]).ok);
    c('Original allocation row kept as corrected', e.allocs.find(a => a.id === r.prop.allocIds[0]).status === 'corrected');
    c('Ledger nets to zero for S104; receipt cancelled', e.postedFor('S104') === 0 && e.receipts.find(x => x.txnId === 'P9').status === 'cancelled');
    c('₹25,000 back to unallocated', e.allocatable(e.txn('P9')) === 25000);
  } },
  { id: 'TC-17', ac: 'AC-15', name: 'Two reviewers on the same payment: the stale edit is rejected', run(c) {
    const e = seededEngine(); const v = e.txn('P6').version;
    c('Reviewer A proposes on version ' + v, e.propose('ops', 'P6', [{ sid: 'S101', comp: 'Tuition', amount: 15000 }, { sid: 'S104', comp: 'Tuition', amount: 15000 }], 'A', '', v).ok);
    c('Reviewer B, still on version ' + v + ', is blocked', !e.propose('finrev', 'P6', [{ sid: 'S101', comp: 'Tuition', amount: 30000 }], 'B', '', v).ok);
  } },
  { id: 'TC-18', ac: 'AC-16', name: 'Books balance: verified money = posted + pending + unallocated', run(c) {
    const e = seededEngine();
    const r = e.propose('ops', 'P6', [{ sid: 'S101', comp: 'Tuition', amount: 15000 }, { sid: 'S104', comp: 'Tuition', amount: 15000 }], 'x'); e.approve('finapp', r.prop.id);
    e.propose('ops', 'P3', [{ sid: 'S103', comp: 'Tuition', amount: 15000 }], 'x');
    c('Pending proposal blocks reversal from over-committing P3', !e.applyReversal('finapp', 'P8').ok);
    c('Control difference is ₹0', e.totals().diff === 0);
  } },
  { id: 'TC-19', ac: 'AC-03', name: 'Re-import with different formatting of the same bank ID is still a duplicate', run(c) {
    const e = seededEngine();
    const d = e.ingest({ source: 'bank', sourceTxnId: ' upi/430219884120 ', channel: 'UPI', amount: 10000, remark: 'S101' });
    c('Lower-case, padded ID caught as duplicate of P1', d.duplicateOf === 'P1');
    const d2 = e.ingest({ source: 'bank', sourceTxnId: 'UPI/430219884120', channel: 'UPI', amount: 25000, remark: 'S101' });
    c('Same ID with a different amount is an ID conflict, not money', d2.idConflict && e.allocatable(d2) === 0 && e.status(d2).key === 'conflict');
    c('Conflict needs Finance to close it', !e.closeConflict('ops', d2.id, 'bank confirmed P1 correct').ok && e.closeConflict('finrev', d2.id, 'Bank confirmed P1 is the correct line').ok);
  } },
  { id: 'TC-20', ac: 'AC-09', name: 'UTR typed as plain digits links to the formatted bank ID', run(c) {
    const e = seededEngine();
    const r = e.submitClaim('student:S101', { utr: '4309 1122 3344', amount: 12000 });
    c('Claim held as not found', r.ok && r.txn.verification === 'not_found');
    const b = e.ingest({ source: 'bank', sourceTxnId: 'UPI/430911223344', channel: 'UPI', amount: 12000, remark: '' });
    c('Bank credit links to the claim', e.txn(r.txn.id).verification === 'linked' && b.candidates.some(x => x.sid === 'S101'));
  } },
  { id: 'TC-21', ac: 'AC-09', name: 'Two students claiming one payment are both downgraded and flagged', run(c) {
    const e = seededEngine();
    e.submitClaim('student:S101', { utr: 'UPI/430618771204', amount: 20000 });
    const b = e.ingest({ source: 'bank', sourceTxnId: 'UPI/430618771204', channel: 'UPI', amount: 20000, remark: '' });
    c('No High candidate when two students claim the same money', !b.candidates.some(x => x.conf === 'High'));
    c('Conflict flagged for Operations', b.flags.some(f => /Two students/.test(f)));
  } },
  { id: 'TC-22', ac: 'AC-11', name: 'Reversals must target a real bank payment and carry a negative amount', run(c) {
    const e = seededEngine();
    const r1 = e.ingest({ source: 'bank', sourceTxnId: 'RVSL/A', channel: 'x', amount: -1000, remark: 'Reversal of P4' });
    c('Reversal pointing at duplicate P4 goes to exception', r1.reversal.state === 'exception' && /duplicate/.test(r1.reversal.reason));
    const r2 = e.ingest({ source: 'bank', sourceTxnId: 'RVSL/B', channel: 'x', amount: -1000, remark: 'Reversal of P5' });
    c('Reversal pointing at cash P5 goes to exception', r2.reversal.state === 'exception');
    const p = e.ingest({ source: 'bank', sourceTxnId: 'NEFT/POS', channel: 'x', amount: 5000, remark: 'S102', reversalOf: 'UPI/430312902337' });
    c('Positive credit tagged as reversal is a payment, with a flag', p.kind === 'payment' && p.flags.length > 0 && e.txn('P3').reversedApplied === 0);
    c('Exception can be closed by Finance with a note, no balance change', e.closeReversal('finapp', r1.id, 'Bank confirmed no such reversal').ok && e.totals().diff === 0);
  } },
  { id: 'TC-23', ac: 'AC-07', name: 'Security: nobody can approve an allocation and then undo it alone', run(c) {
    const e = seededEngine();
    const r = e.propose('ops', 'P9', [{ sid: 'S104', comp: 'Tuition', amount: 25000 }], 'x', 'Guardian confirmed via registered contact'); e.approve('finapp', r.prop.id);
    const a = r.prop.allocIds[0];
    c('Direct correction without a request is refused', !e.correct('finapp', a).ok);
    c('Finance approver requests, then cannot approve own request', e.requestCorrection('finapp', a, 'Self-initiated reversal attempt').ok && !e.correct('finapp', a).ok);
    c('Allocation still posted', e.allocs.find(x => x.id === a).status === 'posted' && e.postedFor('S104') === 25000);
  } },
  { id: 'TC-24', ac: 'AC-09', name: 'Security: a student cannot claim money whose bank reference names another student', run(c) {
    const e = seededEngine();
    e.submitClaim('student:S102', { utr: 'UPI/430219884120', amount: 10000 });
    const t = e.txn('P1');
    c('P1 stays matched to S101', t.matched === 'S101');
    c('S102 claim is Low and flagged', t.candidates.some(x => x.sid === 'S102' && x.conf === 'Low') && t.flags.some(f => /S102/.test(f) && /S101/.test(f)));
  } },
  { id: 'TC-25', ac: 'AC-07', name: 'Security: input abuse is bounded', run(c) {
    const e = seededEngine();
    c('Staff cannot raise a case as a student', !e.raiseCase('ops', { text: 'fake' }).ok);
    c('Claims per student capped at ' + MAX_OPEN_CLAIMS, Array.from({ length: 12 }, (_, i) => e.submitClaim('student:S101', { utr: 'SP/' + i, amount: 100 }).ok).filter(Boolean).length === MAX_OPEN_CLAIMS);
    c('Implausible amounts rejected at import', e.ingest({ source: 'bank', sourceTxnId: 'BIG', channel: 'x', amount: 1e15, remark: 'S101' }) === null && e.ingest({ source: 'bank', sourceTxnId: 'NAN', channel: 'x', amount: 'abc' }) === null);
    e.raiseCase('student:S102', { text: 'A'.repeat(50000) });
    c('Free text clipped to 1,000 characters', e.cases[e.cases.length - 1].text.length === 1000);
    c('Rejections are audited', e.audit.some(a => a.action === 'Import rejected') && e.audit.some(a => a.result === 'denied' && a.action === 'Raise mismatch case'));
  } },
];
function runTests() {
  return TESTS.map(t => { const checks = []; let err = null; try { t.run((d, v) => checks.push({ d, v: !!v })); } catch (x) { err = String(x && x.message || x); } return { ...t, checks, err, pass: !err && checks.length > 0 && checks.every(k => k.v) }; });
}
if (typeof module !== 'undefined') module.exports = { Engine, seededEngine, runTests, FEED };
