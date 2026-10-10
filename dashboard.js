async function api(url,options={}){const r=await fetch(url,{headers:{'Content-Type':'application/json'},...options});return r.json()}
async function load(){const d=await api('/api/me');if(d.guest){document.getElementById('userName').textContent='زائر';return}
document.getElementById('userAvatar').src=d.user.avatar||'';document.getElementById('userName').textContent=d.user.username;
const page=document.body.dataset.page;
if(page==='profile'){document.getElementById('wallet').textContent=d.user.wallet+' ZC';document.getElementById('bank').textContent=d.user.bank+' ZC';document.getElementById('total').textContent=d.total+' ZC';document.getElementById('streak').textContent=d.user.streak+' يوم';document.getElementById('level').textContent=d.user.level;document.getElementById('xp').textContent=d.user.xp}
if(page==='wallet'){document.getElementById('wallet').textContent=d.user.wallet+' ZC';document.getElementById('bank').textContent=d.user.bank+' ZC'}
if(page==='daily'){document.getElementById('streak').textContent=d.user.streak+' يوم'}
if(page==='transfer'){const tx=document.getElementById('txList');tx.innerHTML=d.transactions.map(t=>`<li>${t.sender} → ${t.receiver}: ${t.amount} ZC</li>`).join('')||'<li>لا يوجد تحويلات</li>'}
if(page==='top'){const top=await api('/api/top');document.getElementById('topList').innerHTML=top.map((u,i)=>`<li>${i+1}. ${u.username} — ${u.total} ZC</li>`).join('')}
if(page==='achievements'){const ach=await api('/api/achievements');document.getElementById('achList').innerHTML=ach.map(a=>`<li class='${a.unlocked?'done':''}'>${a.name} — ${a.unlocked?'مفتوح':'مقفل'}</li>`).join('')}}
document.getElementById('dailyBtn')?.addEventListener('click',async()=>{const r=await api('/api/daily',{method:'POST'});alert(r.ok?'تم استلام 250 ZC':'غير متاح الآن');load()});
document.getElementById('transferBtn')?.addEventListener('click',async()=>{const r=await api('/api/transfer',{method:'POST',body:JSON.stringify({username:document.getElementById('transferName').value,amount:document.getElementById('transferAmount').value})});alert(r.ok?'تم التحويل':'فشل التحويل');load()});
document.getElementById('depositBtn')?.addEventListener('click',async()=>{await api('/api/bank',{method:'POST',body:JSON.stringify({action:'deposit',amount:100})});load()});
document.getElementById('withdrawBtn')?.addEventListener('click',async()=>{await api('/api/bank',{method:'POST',body:JSON.stringify({action:'withdraw',amount:100})});load()});
load();