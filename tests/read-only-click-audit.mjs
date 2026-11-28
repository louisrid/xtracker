import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {mkdir} from 'node:fs/promises';
const base='https://elegant-swan-98c20a.netlify.app',pause=ms=>new Promise(r=>setTimeout(r,ms));
const fresh=async n=>{const r=await fetch(base+'/.netlify/functions/'+n,{cache:'no-store',redirect:'error',signal:AbortSignal.timeout(90000)});assert.ok(r.ok,n+' '+r.status);return r.json()};
let version=false;
for(let i=0;i<30;i++){try{const r=await fetch(base+'/fanvue-app.js?qa='+Date.now(),{cache:'no-store',signal:AbortSignal.timeout(10000)});if((await r.text()).includes("x.platform==='X'&&x.type!=='RT')for(const id of postIdsOfRecord(x))")){version=true;break;}}catch{}await pause(3000);}
assert.ok(version,'latest live post rule deployed');
const [o,dm,dc]=await Promise.all([fresh('campaign-overview'),fresh('discord-members'),fresh('discord-course-clicks')]);
const ids=['gta-qrts','gta-originals','gta-mandy','gta-instagram','x-articles','article-rts','of-terms','guru-rts'];
console.log('CURRENT_SOURCES '+JSON.stringify({at:o.checkedAt,health:o.sourceHealth,stale:o.stale,groups:o.campaigns.filter(c=>ids.includes(c.id)).map(c=>({id:c.id,paid:c.paidSpendKnown,spend:c.spendKnown,views:c.views,clicks:c.postPublicationClicks??c.trackedClicks,rows:c.rows?.length,posted:c.published,stale:c.sourceStale,history:c.history?.length})),discord:{members:dm.latest?.memberCount,latestDate:dm.latest?.date,course:dc.total}}));
await mkdir('live-audit-screens',{recursive:true});
const browser=await chromium.launch({headless:true,executablePath:process.env.CHROME_BIN||undefined,args:['--no-sandbox']});
const routes=[['home','Dashboard'],['gta-vi','GTA VI'],['gta-vi/lucia','GTA VI'],['gta-vi/mandy','GTA VI'],['viral-qrts','Viral QRTs'],['x-articles','X Articles'],['x-articles/articles','X Articles'],['x-articles/rts','X Articles'],['of-terms','OF Terms'],['guru-promotion','Guru RTs'],['discord','Discord'],['all-accounts','Accounts']];
const periods=['this-week','last-week','all-time'];
const discrepancies=[];
try{
 for(const viewport of [{width:430,height:932},{width:1440,height:900}]){
  const ctx=await browser.newContext({viewport,isMobile:viewport.width<768,hasTouch:viewport.width<768});
  await ctx.route('**/*',r=>{const u=new URL(r.request().url());return (u.origin===base&&!/^\/(?:r|s|of|p)\//.test(u.pathname)&&!u.searchParams.has('source'))||u.hostname==='fonts.googleapis.com'||u.hostname.endsWith('gstatic.com')?r.continue():r.abort()});
  const page=await ctx.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto(base+'/#home',{waitUntil:'domcontentloaded'});
  await page.waitForFunction(()=>window.XTrackerCampaignReporting?.getData()?.viewHistoryVersion===2&&window.XTrackerApp?.gta()?.report?.ready&&window.XTrackerApp?.of()?.report?.ready&&window.XTrackerCampaignReporting?.discord()?.members?.ok&&window.XTrackerCampaignReporting?.discord()?.clicks?.ok,{},{timeout:120000});
  const saved={};
  for(const [route,title] of routes){
   await page.evaluate(route=>location.hash=route,route);
   await page.waitForFunction(({route,title})=>location.hash==='#'+route&&document.querySelector('#fvTitle')?.textContent===title&&document.querySelector('#fvPage')?.children.length>0,{route,title});
   await page.waitForFunction(()=>!document.querySelector('#fvPage').classList.contains('is-kpi-refreshing')&&!document.querySelector('#fvPage>.fv-strip .fv-skel'),{},{timeout:120000});
   if(route==='all-accounts'){
    await page.waitForFunction(()=>document.querySelectorAll('#acc-table tr.fv-row').length>0);
    const count=await page.locator('#acc-table tr.fv-row').count();console.log('LIVE_ACCOUNT_ROWS '+viewport.width+' '+count);await page.screenshot({path:'live-audit-screens/'+viewport.width+'-accounts.png'});continue;
   }
   for(const period of periods){
    const selector=route==='home'?'#fvPage [data-view="'+period+'"]':'#fvPage>.fv-kpi-periods [data-period="'+period+'"]';
    await page.locator(selector).click();await page.waitForFunction(s=>document.querySelector(s)?.getAttribute('aria-pressed')==='true',selector);
    await page.waitForFunction(()=>!document.querySelector('#fvPage').classList.contains('is-kpi-refreshing')&&!document.querySelector('#fvPage>.fv-strip .fv-skel'),{},{timeout:120000});
    const result=await page.evaluate(()=>{
      const val=e=>e?.querySelector('.fv-num')?.textContent.trim()??'–';
      const metrics=el=>Object.fromEntries([...el?.querySelectorAll(':scope>.fv-metric')||[]].map(e=>[e.querySelector('.fv-metric-label span:last-child')?.textContent.trim(),val(e)]));
      const main=document.querySelector('#fvPage>.fv-strip');
      const rows=[...document.querySelectorAll('#home-comparison tr.fv-row')].map(r=>[r.querySelector('.fv-campaign-row-name')?.getAttribute('href')?.slice(1),Object.fromEntries(['clicks','views','spend','cpc'].map(k=>[k,val(r.querySelector('[data-column="'+k+'"]'))]))]);
      const out=[...main?.querySelectorAll('.fv-metric-value .fv-num')||[]].filter(e=>{const r=e.getBoundingClientRect(),p=e.closest('.fv-metric').getBoundingClientRect();return r.left<p.left-1||r.right>p.right+1||r.top<p.top-1||r.bottom>p.bottom+1;}).length;
      return {metrics:metrics(main),community:metrics(document.querySelector('.fv-home-community-strip')),comparison:Object.fromEntries(rows),rows:document.querySelectorAll('#fvPage tr.fv-row').length,overflows:out,pageOverflow:document.documentElement.scrollWidth>innerWidth+1,headerPadding:parseFloat(getComputedStyle(document.querySelector('#mainContent')).paddingTop)};
    });
    console.log('LIVE_PAGE '+JSON.stringify({width:viewport.width,route,period,...result}));
    assert.equal(result.overflows,0,route+' KPI overflow');assert.equal(result.pageOverflow,false,route+' horizontal overflow');assert.equal(result.headerPadding,viewport.width<768?48:72);
    if(route==='home')saved[period]=result;
    else if(['gta-vi','viral-qrts','x-articles','of-terms','guru-promotion'].includes(route)){
      const table=saved[period].comparison[route];
      if(table)for(const [label,key] of [['Clicks','clicks'],['Views','views'],['Spend','spend'],['CPC','cpc']]){
        if(!(label in result.metrics))continue;
        const expected=await page.evaluate(({v,key})=>{if(v==='–')return v;const n=Number(v.replace(/[$,]/g,''));return Number.isFinite(n)?key==='views'?window.FanvueCore.compact(n):key==='spend'?window.FanvueCore.moneyShort(n):v:v;},{v:table[key],key});
        if(result.metrics[label]!==expected)discrepancies.push({width:viewport.width,route,period,label,card:result.metrics[label],comparison:table[key],expected});
      }
    }else if(route==='discord'){
      for(const [label,v] of Object.entries(saved[period].community))if(label in result.metrics&&result.metrics[label]!==v)discrepancies.push({width:viewport.width,route,period,label,card:result.metrics[label],dashboard:v});
    }
    if(period==='all-time'||route==='home')await page.screenshot({path:'live-audit-screens/'+viewport.width+'-'+route.replaceAll('/','-')+'-'+period+'.png'});
   }
  }
  assert.deepEqual(errors,[]);await ctx.close();
 }
 console.log('LIVE_COMPARISON_DISCREPANCIES '+JSON.stringify(discrepancies));assert.deepEqual(discrepancies,[]);console.log('PASS live all-page, all-period KPI and layout consistency');
}finally{await browser.close();}
