const { request } = require('playwright'); const fs = require('fs');
const PW = fs.readFileSync('/home/claude/frd/server.log','utf8').match(/Shared demo password:\s+(\S+)/)[1];
async function s(u){ const c=await request.newContext({baseURL:'http://localhost:5090'}); let t=(await (await c.get('/api/csrf')).json()).token; await c.post('/api/login',{data:{userName:u,password:PW},headers:{'X-CSRF-TOKEN':t}}); c.t=(await (await c.get('/api/csrf')).json()).token; return c; }
(async()=>{
  const ops=[await s('meera'), await s('arjun'), await s('kavita')];
  // 20 simultaneous proposals of the full ₹25,000 on P9 from three people
  const rs = await Promise.all(Array.from({length:20},(_,i)=>ops[i%3].post('/api/act/propose',{data:{txnId:'P9',rows:[{sid:'S104',comp:'Tuition',amount:25000}],reason:'race '+i,evidence:'guardian confirmed by phone call'},headers:{'X-CSRF-TOKEN':ops[i%3].t}}).then(r=>r.json())));
  const won = rs.filter(r=>r.ok).length;
  const kav=ops[2]; const rah=await s('rahul');
  const st=await (await kav.get('/api/state')).json(); const props=st.proposals.filter(p=>p.txnId==='P9'&&p.status==='proposed');
  // approve every proposal at once from two approvers
  const ap = await Promise.all(props.flatMap(p=>[rah, kav].map(c=>c.post('/api/act/approve',{data:{propId:p.id},headers:{'X-CSRF-TOKEN':c.t}}).then(r=>r.json()))));
  const st2=await (await kav.get('/api/state')).json();
  const posted = st2.ledger.filter(l=>l.txnId==='P9').reduce((a,l)=>a+l.amount,0);
  console.log(JSON.stringify({proposalsAccepted:won, approvalsOk:ap.filter(r=>r.ok).length, postedOnP9:posted, receipts:st2.receipts.filter(r=>r.txnId==='P9').length}));
})();
