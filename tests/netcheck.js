const { chromium } = require('playwright'); const fs=require('fs');
(async()=>{ const b=await chromium.launch(); const ctx=await b.newContext(); const p=await ctx.newPage(); const reqs=[];
 p.on('request', r => { if (!r.url().startsWith('data:') && r.url() !== 'about:blank') reqs.push(r.method()+' '+r.url()); });
 await p.setContent('<!doctype html><html><head><meta charset="utf-8"></head><body>'+fs.readFileSync('fee_reconciliation_desk.html','utf8')+'</body></html>');
 for (const r of ['ops','counsellor','finrev','finapp','admin','student:S102']) { await p.selectOption('#role', r); for (const v of ['overview','queue','detail','ledger','audit','policy','check','workflow']) { await p.evaluate(v=>go(v),v); await p.waitForTimeout(60); } }
 await p.selectOption('#role','student:S102'); await p.evaluate(()=>go('ledger')); await p.fill('#cl-utr','UPI/1234567890'); await p.fill('#cl-amt','100'); await p.setInputFiles('#cl-file', { name: 'shot.png', mimeType: 'image/png', buffer: Buffer.from('fake') }); await p.click('[data-act=claim]'); await p.waitForTimeout(200);
 console.log('network requests made by the published page:', reqs.length ? reqs : 'none');
 await b.close(); })();
