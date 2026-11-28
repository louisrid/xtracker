import assert from 'node:assert/strict';
import {chromium} from 'playwright';
const base='https://elegant-swan-98c20a.netlify.app',fn=base+'/.netlify/functions/',sleep=ms=>new Promise(r=>setTimeout(r,ms));
const read=async n=>{const r=await fetch(fn+n,{cache:'no-store',redirect:'error',signal:AbortSignal.timeout(120000)});assert.ok(r.ok,n+' '+r.status);return r.json()};
let ready=false;
for(let i=0;i<40;i++){try{const r=await fetch(base+'/?qa='+Date.now(),{cache:'no-store'});if((await r.text()).includes('20261128-verified-exposure-v68')){ready=true;break}}catch{}await sleep(3000)}
assert.ok(ready,'new production version');
const [g,d,o]=await Promise.all([read('gta-report'),read('dashboard'),read('of-report')]);
const londonDay=t=>new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/London',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(t));
const today=londonDay(Date.now()),date=new Date(Date.parse(today+'T12:00:00Z')-86400000).toISOString().slice(0,10);
const gtaGroups=[g,g.originals,g.mandy].filter(Boolean);
const unique=new Set(),totals={};
for(const group of gtaGroups){for(const p of group.shortIo?.links||[]){if(!p.attributed||!p.posted)continue;const row=p.dailyClicks?.find(x=>x.date===date);if(!row||unique.has(p.trackingUrl))continue;unique.add(p.trackingUrl);totals.gta=(totals.gta||0)+row.clicks;if(group===g.mandy)totals.mandy=(totals.mandy||0)+row.clicks;}}
totals.articles=(d.clickActivity||[]).filter(x=>x.date===date).reduce((s,x)=>s+x.clicks,0);
totals.of=(o.activity||[]).filter(x=>x.date===date).reduce((s,x)=>s+x.clicks,0);
totals.total=(totals.gta||0)+totals.articles+totals.of;
console.log('LIVE independent prior-day click source totals '+JSON.stringify({date,totals}));
const browser=await chromium.launch({headless:true,executablePath:process.env.CHROME_BIN||undefined,args:['--no-sandbox']});
try{
 const ctx=await browser.newContext({viewport:{width:430,height:932},isMobile:true,hasTouch:true});
 await ctx.route('**/*',r=>{const u=new URL(r.request().url());return (u.origin===base&&!/^\/(?:r|s|of|p)\//.test(u.pathname))||u.hostname==='fonts.googleapis.com'||u.hostname.endsWith('gstatic.com')?r.continue():r.abort();});
 const page=await ctx.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto(base+'/#home',{waitUntil:'domcontentloaded'});
 const verify=async label=>{
  await page.waitForFunction(()=>window.FanvueApp?.reporting?.dashboardClickSources&&window.XTrackerCampaignReporting?.getData()?.clickHistoryVersion===2,{},{timeout:120000});
  await page.waitForFunction(({date,totals})=>{
   const a=window.FanvueApp.reporting,s=a.dashboardClickSources();return a.periodTotals(date,date).clicks.value===totals.total&&s[0][1].find(x=>x.week===date)?.value===totals.gta;
  },{date,totals},{timeout:120000});
  const result=await page.evaluate(date=>{const r=window.FanvueApp.reporting;return {clicks:r.periodTotals(date,date).clicks.value,sources:r.dashboardClickSources().map(([n,s])=>[n,s.find(x=>x.week===date)?.value??null])}},date);
  assert.equal(result.clicks,totals.total);assert.equal(result.sources[1][1],totals.articles);assert.equal(result.sources[2][1],totals.of);
  console.log('LIVE reconciled '+label+' '+JSON.stringify(result));
  // Dashboard graph and period KPI use the exact same daily series.
  await page.evaluate(()=>location.hash='home');await page.waitForFunction(()=>document.querySelector('#fvTitle')?.textContent==='Dashboard');
  const daily=await page.evaluate(date=>window.FanvueUI.getMeasure('home-chart','clicks')?.series.find(p=>p.week===date)?.value,date);assert.equal(daily,totals.total,'rendered dashboard chart');
  for(const [route,title,id,expected] of [['gta-vi','GTA VI','gta-chart',totals.gta],['gta-vi/mandy','GTA VI','gta-chart',totals.mandy],['viral-qrts','Viral QRTs','viral-chart',totals.mandy],['x-articles','X Articles','xa-chart',totals.articles],['of-terms','OF Terms','of-chart',totals.of]]){
   await page.evaluate(route=>location.hash=route,route);
   await page.waitForFunction(({route,id,title})=>location.hash==='#'+route&&document.querySelector('#fvTitle')?.textContent===title&&document.querySelector('#'+id),{route,id,title});
   await page.waitForFunction(({date,id,expected})=>window.FanvueUI.getMeasure(id,'clicks')?.series.find(p=>p.week===date)?.value===expected,{date,id,expected},{timeout:30000});
   console.log('LIVE chart '+label+' '+route+' '+expected);
  }
 };
 await verify('initial');
 await page.reload({waitUntil:'domcontentloaded'});await verify('reload');
 assert.deepEqual(errors,[]);
 console.log('PASS dated clicks match independent live sources across dashboard, GTA VI, Mandy, Viral QRTs, X Articles and OF Terms');
}finally{await browser.close();}
