import assert from 'node:assert/strict';
import {chromium} from 'playwright';
const base='https://elegant-swan-98c20a.netlify.app',sleep=ms=>new Promise(r=>setTimeout(r,ms));
let ready=false;for(let i=0;i<45;i++){try{const r=await fetch(base+'/?qa='+Date.now(),{cache:'no-store',signal:AbortSignal.timeout(10000)});if((await r.text()).includes('20261128-verified-exposure-v68')){ready=true;break}}catch{}await sleep(3000)}
assert.ok(ready,'production version published');
const browser=await chromium.launch({headless:true,executablePath:process.env.CHROME_BIN||undefined,args:['--no-sandbox']});
try{
 const ctx=await browser.newContext({viewport:{width:430,height:932},isMobile:true,hasTouch:true});
 await ctx.route('**/*',r=>{const u=new URL(r.request().url());return (u.origin===base&&!/^\/(?:r|s|of|p)\//.test(u.pathname))||u.hostname==='fonts.googleapis.com'||u.hostname.endsWith('gstatic.com')?r.continue():r.abort();});
 const page=await ctx.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto(base+'/#home',{waitUntil:'domcontentloaded'});
 await page.waitForFunction(()=>window.XTrackerCampaignReporting?.getData()?.viewHistoryVersion===1,{},{timeout:120000});
 const ov=await page.evaluate(()=>window.XTrackerCampaignReporting.getData());
 const pick=id=>ov.campaigns.find(c=>c.id===id);
 // Independent accounting of underlying verified rows, including original RT groups.
 const ledger=objects=>{const m=new Map();for(const c of objects.filter(Boolean)){
  const rows=c.id==='article-rts'?(c.articleRtGroups||[]).filter(g=>g.paidCount>0&&g.postedCount>0).map(g=>({...g,posted:true})):c.rows||[];
  for(const r of rows){if(r.posted!==true)continue;
   const values=r.postViews?Object.entries(r.postViews):[[String(r.postUrl||'').match(/status\/(\d+)/)?.[1],r.views??r.xViews]];
   for(const [id,v] of values){if(!id||v==null||!Number.isFinite(Number(v)))continue;const at=Date.parse(r.metricAt||r.xUpdated||'')||0,prev=m.get(id);if(!prev||at>prev.at)m.set(id,{v:Number(v),at});}
  }
 }return {views:[...m.values()].reduce((n,r)=>n+r.v,0),posts:m.size};};
 const articles=[pick('x-articles'),pick('article-rts')],gta=[pick('gta-qrts'),pick('gta-originals'),pick('gta-mandy')],of=[pick('of-terms')],guru=[pick('guru-rts')];
 const expected={home:ledger([...articles,...gta,...of,...guru]),'x-articles':ledger(articles),'gta-vi':ledger(gta),'viral-qrts':ledger([pick('gta-mandy')]),'of-terms':ledger(of),'guru-promotion':ledger(guru),'x-articles/rts':ledger([pick('article-rts')])};
 console.log('LIVE exposure independent '+JSON.stringify({expected,articleDirect:ledger([articles[0]]),rtOriginal:ledger([articles[1]]),rtGroups:articles[1]?.articleRtGroups?.length,rtHistory:articles[1]?.history?.length,ofHistory:of[0]?.history?.length,guruHistory:guru[0]?.history?.length}));
 for(const [route,amount] of Object.entries(expected)){
  await page.evaluate(route=>location.hash=route,route);
  const selector=route==='home'?'[data-view="all-time"]':'#fvPage>.fv-kpi-periods [data-period="all-time"]';
  await page.locator(selector).click();
  await page.waitForFunction(()=>[...document.querySelectorAll('#fvPage>.fv-strip .fv-metric')].some(e=>e.querySelector('.fv-metric-label')?.textContent.trim()==='Views'));
  const metric=page.locator('#fvPage>.fv-strip .fv-metric').filter({has:page.locator('.fv-metric-label',{hasText:/^Views$/})});
  const formatted=await page.evaluate(v=>window.FanvueCore.compact(v),amount.views);
  if(amount.posts>0)await page.waitForFunction(expected=>[...document.querySelectorAll('#fvPage>.fv-strip .fv-metric')].some(e=>e.querySelector('.fv-metric-label')?.textContent.trim()==='Views'&&e.querySelector('.fv-metric-value')?.textContent.includes(expected)),formatted,{timeout:30000});
  console.log('LIVE views '+route+' '+(await metric.innerText()).replace(/\n/g,' ')+' expected '+amount.views);
 }
 await page.evaluate(()=>location.hash='home');
 await page.locator('[data-view="this-week"]').click();
 const weekly=await page.evaluate(()=>{const c=window.FanvueCore,t=c.londonDay(Date.now()),w=c.weekStart(t),a=window.FanvueApp.reporting;return {week:w,views:a.periodTotals(w,t).views.value,last:a.periodTotals(c.addDays(w,-7),c.addDays(w,-1)).views.value}});
 console.log('LIVE date-scoped measured view gains '+JSON.stringify(weekly));
 assert.deepEqual(errors,[]);
 console.log('PASS exposure totals reconcile by unique source post, not by purchased RT count');
}finally{await browser.close();}
