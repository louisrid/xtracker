// Production-only smoke: aggregate financial figures only. No redirect or tracking link requests.
import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import ExcelJS from 'exceljs';
const base='https://elegant-swan-98c20a.netlify.app';
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
let ready=false;
for(let i=0;i<25;i++){
 try{const r=await fetch(base+'/?qa='+Date.now(),{cache:'no-store',signal:AbortSignal.timeout(12000)});ready=r.ok&&(await r.text()).includes('20261128-click-reconciliation-v67');if(ready)break;}catch{}
 await sleep(3000);
}
assert.ok(ready,'Latest production HTML must be published before checking spend');
// Independently compare the source sheet's displayed row amounts and payment flags.
const source=await fetch('https://docs.google.com/spreadsheets/d/1D8rI3BuuFHIemYZY92QFiHDMkj876F8oiwpDR6sMiTE/export?format=xlsx',{cache:'no-store',signal:AbortSignal.timeout(30000)});
assert.ok(source.ok,'live spreadsheet export accessible');
const book=new ExcelJS.Workbook();await book.xlsx.load(Buffer.from(await source.arrayBuffer()));
const sheet=book.getWorksheet('X Accounts 17 (Mandy QRTs)');assert.ok(sheet);
const v=c=>{const x=c.value;return x&&typeof x==='object'?(x.result??x.text??x.hyperlink??''):x;};
const cols={};sheet.getRow(7).eachCell((c,i)=>{cols[String(v(c)).trim()]=i;});
for(const key of ['ACCOUNT SUM','PAID?','POSTED?','UTM LINK'])assert.ok(cols[key],key+' source column');
const expected={paid:0,total:0,pending:0,pendingCost:0,links:[]};
for(let i=8;i<=sheet.rowCount;i++){
 const c=k=>v(sheet.getRow(i).getCell(cols[k]));const amount=c('ACCOUNT SUM');if(amount===null||amount===undefined||amount==='')continue;
 const cost=Number(String(amount).replace(/[$,]/g,''));if(!Number.isFinite(cost))continue;
 expected.total+=cost;if(String(c('PAID?')).toLowerCase()!=='true')continue;
 expected.paid+=cost;const url=String(c('UTM LINK')||'');
 if(String(c('POSTED?')).toLowerCase()!=='true'&&url.startsWith('https://createmyai.app/')){expected.pending++;expected.pendingCost+=cost;expected.links.push(url);}
}
assert.equal(expected.paid,Number(v(sheet.getCell('C4'))));assert.equal(expected.total,Number(v(sheet.getCell('C2'))));assert.equal(new Set(expected.links).size,expected.links.length);
console.log('LIVE source sheet '+JSON.stringify({...expected,links:undefined}));
const groupTabs={'gta-qrts':['X Accounts 15 (GTA VI QRTs)','X Accounts 16 (GTA VI QRTs)'],'gta-originals':['X Accounts 12 (GTA)','X Accounts 14 (GTA VI V2)'],'gta-instagram':['IG Accounts 3 (GTA VI)'],'gta-mandy':['X Accounts 17 (Mandy QRTs)'],'of-terms':['X Accounts 13 (OF Terms)']};
const sheetPaid=name=>{const s=book.getWorksheet(name);assert.ok(s,name);const h={};s.getRow(7).eachCell((c,i)=>{h[String(v(c)).trim()]=i;});let total=0;
 for(let i=8;i<=s.rowCount;i++){const c=k=>v(s.getRow(i).getCell(h[k]));if(String(c('PAID?')).toLowerCase()!=='true')continue;const n=Number(String(c('ACCOUNT SUM')??'').replace(/[$,]/g,''));if(Number.isFinite(n))total+=n;}
 return Math.round(total*100)/100;
};
const expectedGroups=Object.fromEntries(Object.entries(groupTabs).map(([id,tabs])=>[id,tabs.reduce((n,t)=>n+sheetPaid(t),0)]));
const sheetAllocated=name=>{const s=book.getWorksheet(name);const total=Number(v(s.getCell('C2')));assert.ok(Number.isFinite(total),name+' source total');return total;};
const expectedAllocated=Object.fromEntries(Object.entries(groupTabs).filter(([id])=>id.startsWith('gta-')).map(([id,tabs])=>[id,tabs.reduce((n,t)=>n+sheetAllocated(t),0)]));
const gtaExpected=Object.values(expectedAllocated).reduce((n,v)=>n+v,0),planTab='X Accounts 16 (GTA VI QRTs)',planAmount=sheetAllocated(planTab);
const eqMoney=(a,b,msg)=>assert.ok(typeof a==='number'&&typeof b==='number'&&Math.abs(a-b)<.011,msg+': '+a+' vs '+b);
const today=new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/London',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
const add=(d,n)=>new Date(Date.parse(d+'T12:00:00Z')+n*86400000).toISOString().slice(0,10);
const monday=add(today,-((new Date(today+'T12:00:00Z').getUTCDay()+6)%7)),lastMonday=add(monday,-7),lastSunday=add(monday,-1);
const periods={'this-week':[monday,today],'last-week':[lastMonday,lastSunday],'all-time':null};
// Independently sum each canonical source row using only recorded dates, no app financial helper.
function rowSpend(rows,period,gta){const seen=new Set();let dated=0,eligible=0;const total=rows.reduce((sum,r)=>{const paid=r.paid===true&&r.planned!==true,cost=Number(r.cost);if(r.cost==null||!Number.isFinite(cost)||cost<0||(!paid&&!(gta&&cost>0)))return sum;const key=r.campaign==='GTAM'&&r.trackingUrl?'GTAM|'+r.trackingUrl:r.sourceTab&&r.sourceRow?r.sourceTab+'#'+r.sourceRow:r.code||r.id;if(key&&seen.has(key))return sum;if(key)seen.add(key);eligible++;if(!period)return sum+cost;const allocation=gta&&(r.plannedAt||r.bookedAt),date=allocation||(paid?r.paidAt:'');if(!date)return sum;dated++;if(date.slice(0,10)<period[0]||date.slice(0,10)>period[1])return sum;const amount=allocation?r.datedPlannedAmount:r.datedPaidAmount;return sum+(amount==null?cost:Math.min(cost,Number(amount)));},0);return period&&eligible&&!dated?null:total;}

const browser=await chromium.launch({headless:true,executablePath:process.env.CHROME_BIN||undefined,args:['--no-sandbox']});
try{
 const page=await browser.newPage({viewport:{width:1440,height:900}});
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.route('**/*',r=>{const u=new URL(r.request().url());return (u.origin===base&&!/^\/(?:r|s|of)\//.test(u.pathname))||u.hostname.endsWith('gstatic.com')||u.hostname==='fonts.googleapis.com'?r.continue():r.abort();});
 await page.goto(base+'/#home',{waitUntil:'domcontentloaded',timeout:30000});
 await page.waitForFunction(()=>window.FanvueApp?.reporting&&window.XTrackerCampaignReporting?.getData?.()?.campaigns?.length,{},{timeout:100000});
 const read=async(period)=>{
  await page.locator('[data-view="'+period+'"]').click();
  await page.waitForFunction(p=>document.querySelector('[data-view="'+p+'"]')?.getAttribute('aria-pressed')==='true',period);
  return page.locator('#fvPage>.fv-strip .fv-metric').filter({has:page.locator('.fv-metric-label',{hasText:'Spend'})}).locator('.fv-metric-value .fv-num').innerText({timeout:15000});
 };
 const check=async(label)=>{
  await page.waitForFunction(()=>!window.XTrackerCampaignReporting.status().loading&&window.XTrackerCampaignReporting.getData()?.campaigns?.filter(c=>c.id.startsWith('gta-')).every(c=>typeof c.spendKnown==='number'),{},{timeout:100000});
  const data=await page.evaluate(([monday,today,lastMonday,lastSunday])=>{const a=window.FanvueApp.reporting;return {week:a.periodTotals(monday,today).spend.value,last:a.periodTotals(lastMonday,lastSunday).spend.value};},[monday,today,lastMonday,lastSunday]);
  assert.ok(data.week>=planAmount,label+' this week includes Mandy payments and allocated QRTs');
  const week=await read('this-week'),last=await read('last-week'),all=await read('all-time');
  assert.equal(week,await page.evaluate(v=>window.FanvueCore.moneyShort(v),data.week));
  assert.equal(last,await page.evaluate(v=>window.FanvueCore.moneyShort(v),data.last));
  assert.match(all,/^\$[\d,.]+[KM]?$/);
  const groups=await page.evaluate(()=>Object.fromEntries(window.XTrackerCampaignReporting.getData().campaigns.map(c=>[c.id,c.paidSpendKnown])));
  for(const [id,amount] of Object.entries(expectedGroups))assert.ok(Math.abs((groups[id]??0)-amount)<.011,label+' '+id+' paid matches spreadsheet: '+groups[id]+' vs '+amount);
  const summary=await page.evaluate(()=>{const ov=window.FanvuePaymentDates.applyPaymentDates(window.XTrackerCampaignReporting.getData()),C=window.FanvueCore,s=C.CAMPAIGNS.map(c=>C.campaignSummary(ov,c.key));return {total:C.homeTotals(ov,s).spend.value,parts:Object.fromEntries(s.map(c=>[c.key,c.spend.value]))};});
  assert.ok(Math.abs(summary.total-Object.values(summary.parts).reduce((n,x)=>n+(x||0),0))<.011,'dashboard totals count each canonical campaign once');
  assert.equal(all,await page.evaluate(v=>window.FanvueCore.moneyShort(v),summary.total));
  console.log('LIVE campaign paid '+JSON.stringify({groups,summary}));
  const gta=await page.evaluate(()=>{const ov=window.FanvuePaymentDates.applyPaymentDates(window.XTrackerCampaignReporting.getData());const s=window.FanvueCore.campaignSummary(ov,'gta-vi');return {spend:s.spend.value,allocated:s.allocatedSpend.value,paid:s.paidSpend.value,planned:s.planned,committed:s.committed};});
  eqMoney(gta.spend,gtaExpected,label+' GTA headline matches source sheet allocations');eqMoney(gta.allocated,gtaExpected,label+' GTA allocation matches source');
  const ov=await page.evaluate(()=>window.FanvuePaymentDates.applyPaymentDates(window.XTrackerCampaignReporting.getData()));
  const gs=ov.campaigns.filter(c=>c.id.startsWith('gta-'));for(const c of gs)eqMoney(c.spendKnown,expectedAllocated[c.id],label+' API group '+c.id);
  const allocatedRows=gs.flatMap(c=>c.rows),plannedRows=allocatedRows.filter(r=>r.campaign==='GTAQ2');
  eqMoney(plannedRows.reduce((n,r)=>n+(r.cost||0),0),planAmount,'tab 16 amount from source');
  for(const r of plannedRows)if(r.planned===true)assert.equal(r.paid,false);
  const groupsForKey={'gta-vi':gs,'viral-qrts':gs.filter(c=>c.id==='gta-mandy'),'x-articles':ov.campaigns.filter(c=>['x-articles','article-rts'].includes(c.id)),'of-terms':ov.campaigns.filter(c=>c.id==='of-terms'),'guru-promotion':ov.campaigns.filter(c=>c.id==='guru-rts')};
  const rowsFor=(key)=>groupsForKey[key].flatMap(c=>c.id==='guru-rts'?c.paidReposts||[]:c.rows||[]);
  const expectedByPeriod={};for(const [key,p] of Object.entries(periods)){const totals=Object.fromEntries(Object.keys(groupsForKey).map(k=>[k,rowSpend(rowsFor(k),p,k==='gta-vi'||k==='viral-qrts')]));totals.dashboard=totals['gta-vi']+totals['x-articles']+totals['of-terms']+totals['guru-promotion'];totals.lucia=rowSpend(allocatedRows.filter(r=>['GTA1','GTA2','GTAQ','GTAQ2'].includes(r.campaign)),p,true);totals.mandy=totals['viral-qrts'];expectedByPeriod[key]=totals;}
  eqMoney(data.week,expectedByPeriod['this-week'].dashboard,label+' independent dated dashboard total');eqMoney(data.last,expectedByPeriod['last-week'].dashboard,label+' independent last week total');eqMoney(summary.total,expectedByPeriod['all-time'].dashboard,label+' independent lifetime dashboard');
  const readSpend=()=>page.locator('#fvPage>.fv-strip .fv-metric').filter({has:page.locator('.fv-metric-label',{hasText:'Spend'})}).locator('.fv-metric-value :is(.fv-num,.fv-dash)').innerText({timeout:15000});
  for(const period of Object.keys(periods)){
    await read(period);
    const amounts=await page.locator('#home-comparison tr.fv-row').evaluateAll(rs=>Object.fromEntries(rs.map(r=>[r.querySelector('a.fv-campaign-row-name')?.getAttribute('href')?.slice(1),r.querySelector('[data-column="spend"] :is(.fv-num,.fv-dash)')?.textContent])));
    for(const k of Object.keys(groupsForKey)){assert.ok(amounts[k],label+' comparison row '+k);const expected=expectedByPeriod[period][k];if(expected===null)assert.equal(amounts[k],'–',label+' comparison unknown '+k+' '+period);else eqMoney(Number(amounts[k].replace(/[$,]/g,'')),expected,label+' comparison '+k+' '+period);}
  }
  for(const [route,key] of [['gta-vi','gta-vi'],['gta-vi/lucia','lucia'],['gta-vi/mandy','mandy'],['viral-qrts','viral-qrts'],['x-articles','x-articles'],['of-terms','of-terms'],['guru-promotion','guru-promotion']]){
    await page.evaluate(route=>{location.hash=route},route);
    await page.waitForFunction(route=>location.hash==='#'+route&&document.querySelectorAll('#fvPage>.fv-kpi-periods [data-period]').length===3,route);
    for(const period of Object.keys(periods)){
      await page.locator('#fvPage>.fv-kpi-periods [data-period="'+period+'"]').click();
      await page.waitForFunction(p=>document.querySelector('#fvPage>.fv-kpi-periods [aria-pressed="true"]')?.dataset.period===p,period);
      const expectedValue=expectedByPeriod[period][key],expectedDisplay=expectedValue===null?'–':await page.evaluate(v=>window.FanvueCore.moneyShort(v),expectedValue);
      console.log('LIVE check '+label+' '+route+' '+period+' expected '+expectedDisplay);
      assert.equal(await readSpend(),expectedDisplay,label+' '+route+' '+period);
    }
  }
  console.log('LIVE independently reconciled '+label+' '+JSON.stringify(expectedByPeriod));
  await page.evaluate(()=>{location.hash='home'});await page.waitForSelector('#fvPage.fv-dashboard-layout');
  assert.ok(Math.abs(gta.allocated-gta.paid-gta.planned-gta.committed)<.011,label+' GTA VI allocation reconciliation');
  const mandy=await page.evaluate(()=>{const c=window.XTrackerCampaignReporting.getData().campaigns.find(x=>x.id==='gta-mandy');const pending=c.rows.filter(r=>r.paid===true&&!r.posted&&r.trackingUrl?.startsWith('https://createmyai.app/'));return {paid:c.paidSpendKnown,planned:c.plannedSpendKnown,committed:c.committedUnpaidKnown,pending:pending.length,pendingCost:pending.reduce((n,r)=>n+r.cost,0),unique:new Set(pending.map(r=>r.code)).size,dated:pending.filter(r=>r.paidAt==='2026-11-27').length,links:pending.map(r=>r.trackingUrl).sort()};});
  assert.equal(mandy.paid,expected.paid,label+' Mandy paid');assert.equal(mandy.planned+mandy.committed,expected.total-expected.paid,label+' Mandy unpaid');assert.equal(mandy.pending,expected.pending);assert.equal(mandy.pendingCost,expected.pendingCost);assert.equal(mandy.unique,expected.pending);assert.deepEqual(mandy.links,expected.links.slice().sort());
  console.log('LIVE Mandy '+label+' '+JSON.stringify({...mandy,links:undefined}));
  console.log('LIVE '+label+' | This Week '+week+' | Last Week '+last+' | All Time '+all+' | GTA VI '+JSON.stringify(gta));
  return {week,last,all};
 };
 await page.evaluate(async()=>{await fetch('/.netlify/functions/campaign-overview?refresh=1',{cache:'no-store'});});
 await page.reload({waitUntil:'domcontentloaded'});
 await page.waitForFunction(()=>window.XTrackerCampaignReporting?.getData?.()?.campaigns?.find(c=>c.id==='gta-mandy')?.rows?.filter(r=>r.paid&&r.trackingUrl?.startsWith('https://createmyai.app/')).length>0,{},{timeout:100000});
 await check('before refresh');
 await page.locator('[data-view="this-week"]').click();
 await page.locator('#fvRefresh').click();
 await page.waitForFunction(()=>document.querySelector('#fvPage').classList.contains('is-kpi-refreshing'),{},{timeout:15000});
 console.log('Actual Refresh All request started');
 await page.waitForFunction(()=>document.querySelector('#fvRefreshProgress').hidden&&!document.querySelector('#fvRefresh').disabled,{},{timeout:240000});
 await check('after Refresh All');
 const short=await page.evaluate(async()=>{const r=await fetch('/.netlify/functions/gta-report',{cache:'no-store'});const d=await r.json();return (d.mandy?.shortIo?.links||[]).map(p=>({domain:new URL(p.trackingUrl).hostname,verified:Number.isInteger(p.clicks)&&!!p.clickAt&&!p.clickError,published:p.posted===true,attributed:p.attributed===true}));});
 const domains=Object.fromEntries(['createmyai.app','irxc49.s.gy'].map(domain=>[domain,{links:short.filter(p=>p.domain===domain).length,verified:short.filter(p=>p.domain===domain&&p.verified).length}]));
 assert.ok(domains['createmyai.app'].verified>=21,'new-domain links confirmed by Short.io API data');assert.ok(domains['irxc49.s.gy'].verified>=6,'legacy-domain links confirmed by Short.io API data');assert.equal(short.filter(p=>p.domain==='createmyai.app'&&!p.published&&p.attributed).length,0);
 console.log('LIVE Short.io domain verification '+JSON.stringify(domains));
 await page.reload({waitUntil:'domcontentloaded'});
 await page.waitForFunction(()=>window.FanvueApp?.reporting&&window.XTrackerCampaignReporting?.getData?.()?.campaigns?.length,{},{timeout:100000});
 await check('after browser reload');
 for(const route of ['gta-vi','viral-qrts','x-articles','of-terms','guru-promotion','discord']){
  await page.evaluate(route=>{location.hash=route;},route);
  await page.waitForFunction(()=>document.querySelectorAll('#fvPage>.fv-kpi-periods [data-period]').length===3);
  for(const period of ['this-week','last-week','all-time']){
   await page.locator('#fvPage>.fv-kpi-periods [data-period="'+period+'"]').click();
   await page.waitForFunction(period=>document.querySelector('#fvPage>.fv-kpi-periods [aria-pressed="true"]')?.dataset.period===period,period);
   assert.equal(await page.locator('#fvPage>.fv-kpi-periods [aria-pressed="true"]').getAttribute('data-period'),period);
  }
  console.log('LIVE KPI period controls '+route+' checked');
 }
 assert.deepEqual(errors,[]);
}finally{await browser.close();}
