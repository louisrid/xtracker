import assert from 'node:assert/strict';
import {chromium} from 'playwright';
const base='https://elegant-swan-98c20a.netlify.app',endpoint=base+'/.netlify/functions/tracker-refresh';
const pause=ms=>new Promise(r=>setTimeout(r,ms));
const busy=j=>j&&['queued','running'].includes(j.state);
async function status(){const r=await fetch(endpoint,{cache:'no-store',signal:AbortSignal.timeout(12000)});if(!r.ok)throw Error('Refresh API '+r.status);return (await r.json()).refresh;}
let ready=false;
for(let i=0;i<50;i++){try{const r=await fetch(base+'/?qa='+Date.now(),{cache:'no-store',signal:AbortSignal.timeout(10000)});if((await r.text()).includes('20261128-verified-exposure-v68')){await status();ready=true;break;}}catch{}await pause(3000);}
assert.ok(ready,'new production version and refresh endpoint available');
const browser=await chromium.launch({headless:true,executablePath:process.env.CHROME_BIN||undefined,args:['--no-sandbox']});
let ctx,page,posts=0;
async function open(hash){
 ctx=await browser.newContext({viewport:{width:430,height:932},isMobile:true,hasTouch:true});
 await ctx.route('**/*',r=>{const u=new URL(r.request().url());if(u.href===endpoint&&r.request().method()==='POST')posts++;return (u.origin===base&&!/^\/(?:r|s|of|p)\//.test(u.pathname))||u.hostname==='fonts.googleapis.com'||u.hostname.endsWith('gstatic.com')?r.continue():r.abort();});
 page=await ctx.newPage();await page.goto(base+'/#'+hash,{waitUntil:'domcontentloaded'});
 await page.waitForFunction(()=>window.FanvueApp&&document.querySelector('#fvRefresh')&&!document.querySelector('#fvRefresh').hidden);
}
try{
 let old=await status();
 for(let i=0;busy(old)&&i<120;i++){await pause(2500);old=await status();}
 assert.ok(!busy(old),'no overlapping production refresh before test');
 await open('home');
 await page.waitForFunction(()=>!document.querySelector('#fvRefresh').disabled,{},{timeout:90000});
 const responsePromise=page.waitForResponse(r=>r.url()===endpoint&&r.request().method()==='POST');
 await page.locator('#fvRefresh').click();
 const response=await responsePromise;assert.ok(response.ok());const job=(await response.json()).refresh;
 assert.equal(job.scope,'all');assert.ok(job.id);assert.equal(posts,1);
 console.log('LIVE refresh accepted '+JSON.stringify({id:job.id,scope:job.scope,state:job.state,completed:job.completed,total:job.total}));
 await page.evaluate(()=>{location.hash='gta-vi';});
 await page.waitForFunction(()=>location.hash==='#gta-vi'&&document.querySelector('#fvTitle')?.textContent==='GTA VI');
 await ctx.close();ctx=null;
 let detached=await status();assert.equal(detached.id,job.id);
 console.log('LIVE after all tabs closed '+JSON.stringify({id:detached.id,state:detached.state,completed:detached.completed}));
 await pause(3500);
 await open('viral-qrts');
 const resumed=await status();assert.equal(resumed.id,job.id);
 if(busy(resumed))await page.waitForFunction(()=>!document.querySelector('#fvRefreshProgress').hidden&&document.querySelector('#fvRefresh').disabled,{},{timeout:30000});
 assert.equal(posts,1,'reopening does not submit another refresh');
 await page.reload({waitUntil:'domcontentloaded'});
 const afterReload=await status();assert.equal(afterReload.id,job.id);
 assert.equal(posts,1,'browser reload does not resubmit');
 await ctx.close();ctx=null;
 const deadline=Date.now()+240000;let final;
 do{final=await status();assert.equal(final.id,job.id);if(!busy(final))break;await pause(2500);}while(Date.now()<deadline);
 assert.ok(!busy(final),'server completes even with every browser tab closed');
 assert.equal(final.completed,final.total,'all source operations settled');
 assert.equal(final.total,6);
 assert.ok(['complete','failed'].includes(final.state));
 console.log('LIVE terminal job '+JSON.stringify({id:final.id,state:final.state,completed:final.completed,total:final.total,issues:final.issues,done:final.done}));
 await open('home');
 await page.waitForFunction(()=>document.querySelector('#fvRefreshProgress').hidden&&!document.querySelector('#fvRefresh').disabled&&document.querySelector('#fvRefreshCount').textContent==='',{},{timeout:120000});
 assert.equal(posts,1,'completion rehydration is read-only');
 console.log('PASS live refresh continued through navigation, full tab closure, reopening, browser reload and detached completion');
}finally{if(ctx)await ctx.close();await browser.close();}
