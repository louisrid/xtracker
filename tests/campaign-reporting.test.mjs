import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import ExcelJS from 'exceljs';
import {parseQuotedPost} from '../netlify/lib/gta-x-metrics.mjs';
import {summariseQuotedOriginals} from '../netlify/lib/quoted-originals.mjs';
import {parseArticleRtWorkbook,assembleCampaignOverview,enrichArticleRtMetrics,readReportParts,readArticleOriginalMetrics} from '../netlify/functions/campaign-overview.mjs';

const original={id:'2122103967551295552',url:'https://x.com/iluv_papi/status/2122103967551295552',
  author:{screen_name:'iluv_papi'},views:19906,likes:430,retweets:80,replies:12};
const metric=(v,quoted)=>({views:v,likes:10,reposts:3,replies:2,at:'2026-11-23T17:00:00Z',
  quotedPost:quoted?{...original,handle:'iluv_papi',url:original.url,views:original.views,
    likes:original.likes,reposts:original.retweets,replies:original.replies,at:'2026-11-23T17:00:00Z'}:null});
const qrt=(id,price,views)=>({
  publisher:'Publisher '+id,campaign:'GTAQ',posted:true,paid:true,cost:price,
  postUrl:'https://x.com/publisher/status/'+id,views,likes:10,reposts:3,replies:2,
  allTimeClicks:31,clicks:11,metricAt:'2026-11-23T17:00:00Z'
});

test('X quote data parses provider-confirmed original post and ignores incomplete or mismatched links',()=>{
  const parsed=parseQuotedPost({quote:original},'2026-11-23T17:00:00Z');
  assert.equal(parsed.id,original.id);
  assert.equal(parsed.handle,'iluv_papi');
  assert.equal(parsed.views,19906);
  assert.equal(parsed.url,original.url);
  assert.equal(parseQuotedPost({quote:{...original,id:'99'}},'2026-11-23T17:00:00Z'),null);
  assert.equal(parseQuotedPost({quote:{id:original.id,url:'https://untrusted.example/status/1'}},'2026-11-23T17:00:00Z'),null);
  assert.equal(parseQuotedPost({quote:null},'2026-11-23T17:00:00Z'),null);
});

test('QRTs group under one quoted original without doubling original view count',()=>{
  const a=qrt('2122351628162641990',70,5000),b=qrt('2122351628162641991',50,9000),u=qrt('2122351628162641992',80,400);
  const source={metrics:null};
  const state={'2122351628162641990':metric(5000,true),'2122351628162641991':metric(9000,true)};
  const result=summariseQuotedOriginals([a,b,u],state);
  assert.equal(result.rows.length,1);
  assert.equal(result.summary.publishedQrts,3);
  assert.equal(result.summary.matchedQrts,2);
  assert.equal(result.summary.unmatchedQrts,1);
  assert.equal(result.summary.quotedPostViews,19906);
  assert.equal(result.summary.qrtViews,14000);
  assert.equal(result.summary.allocatedPaidSpend,120);
  assert.equal(result.rows[0].paidQrtCount,2);
  assert.equal(result.rows[0].allTimeHumanClicks,62);
  assert.equal(result.rows[0].postPublicationClicks,22);
  // Repeated references to the same X QRT must not increase views or spend.
  assert.deepEqual(summariseQuotedOriginals([a,a,b,u],state).summary,result.summary);
  // Never silently treat a non-GTA QRT placement as part of this campaign.
  assert.deepEqual(summariseQuotedOriginals([{...a,campaign:'GTA1'}],state).rows,[]);
});

test('unknown spend and shared tracking links remain partial and never become invented clicks',()=>{
  const a={...qrt('2122351628162641990',null,null),allTimeClicks:null,clicks:null,sharedTracking:true};
  const r=summariseQuotedOriginals([a],{'2122351628162641990':metric(100,true)});
  assert.equal(r.rows[0].paidSpendKnown,0);
  assert.equal(r.rows[0].unknownPaidCosts,1);
  assert.equal(r.rows[0].allTimeHumanClicks,null);
  assert.equal(r.rows[0].qrtViews,null);
});

test('Article RT workbook preserves separate paid, posted and missing-post-link statuses',()=>{
  const book=new ExcelJS.Workbook(),tab=book.addWorksheet('X Accounts 11 (Article RTs)');
  tab.getRow(7).values=['ACCOUNT','LINK','UTM LINK','TYPE','FOLLOWERS','NOTES','MESSAGED?','RT','QRT','ARTICLE','POST','CUSTOM','1','2','3','4','5','ACCOUNT SUM','METHOD','PAYMENT DETAILS','PAID?','POSTED?','LINK'];
  tab.getRow(8).values=['0xKiyoro','https://x.com/0xKiyoro','','AI','','','FALSE','$15','','','','','TRUE','FALSE','FALSE','FALSE','FALSE','$15','Crypto','','TRUE','TRUE',''];
  tab.getRow(9).values=['Pending','https://x.com/pending','','AI','','','FALSE','$30','','','','','TRUE','FALSE','FALSE','FALSE','FALSE','$30','Crypto','','TRUE','FALSE',''];
  const rows=parseArticleRtWorkbook(book);
  assert.equal(rows.length,2);
  assert.equal(rows[0].publisher,'0xKiyoro');
  assert.equal(rows[0].paid,true);
  assert.equal(rows[0].posted,true);
  assert.equal(rows[0].postUrl,'');
  assert.equal(rows[0].cost,15);
  assert.equal(rows[0].profileUrl,'https://x.com/0xKiyoro');
  assert.equal(rows[0].views,null);
  assert.equal(rows[1].paid,true);
  assert.equal(rows[1].posted,false);
});

test('Unified lifetime report preserves separate campaign totals without invented conversions',()=>{
  const sources={
    gta:{data:{ok:true,ready:true,source:'GOOGLE_SHEETS_LIVE',sourceVerifiedAt:'2026-11-23T17:00:00Z',
      publishers:[{...qrt('2122351628162641990',70,5000),sourceTab:'X Accounts 15 (GTA VI QRTs)'}],
      shortIo:{total:40},originals:{ok:true,ready:true,publishers:[],shortIo:{total:null}},
      quotedOriginals:{scope:'verified-quoted-original-posts-v1',rows:[],summary:{originalPosts:0}}}},
    of:{data:{ok:true,ready:true,checkedAt:'2026-11-23T17:00:00Z',publishers:[]}},
    boosts:{data:{ok:true,tweets:[]}},
    dashboard:{data:{ok:true,placements:[],campaigns:[]}},
    articleRts:{data:{source:'GOOGLE_SHEETS_LIVE',at:'2026-11-23T17:00:00Z',
      rows:[{publisher:'0xKiyoro',cost:15,paid:true,posted:true,postUrl:'',views:null}]}}
  };
  const result=assembleCampaignOverview(sources);
  assert.equal(result.scope,'lifetime-campaign-reporting-v1');
  const gta=result.campaigns.find(c=>c.id==='gta-qrts');
  const rts=result.campaigns.find(c=>c.id==='article-rts');
  const discord=result.campaigns.find(c=>c.id==='discord');
  assert.equal(gta.paidSpendKnown,70);
  assert.equal(gta.views,5000);
  assert.equal(gta.allTimeHumanClicks,40);
  assert.equal(gta.earningCreators,null);
  assert.equal(gta.signups,null);
  assert.equal(gta.kyc,null);
  assert.equal(rts.paidSpendKnown,15);
  assert.equal(rts.published,1);
  assert.equal(rts.coverage.withXMetrics,0);
  assert.equal(rts.views,null);
  assert.match(rts.trackingWarning,/no original X post URL/);
  assert.equal(discord.source,'NOT_CONNECTED');
  assert.equal(discord.earningCreators,null);
  assert.ok(!('totalReach' in result));
  assert.ok(!('totalPaidSpend' in result));
});

test('Reporting routes remain while GTA VI has only QRT and standalone tabs',()=>{
  const html=readFileSync('public/index.html','utf8');
  const app=readFileSync('public/app.js','utf8');
  const ui=readFileSync('public/campaign-reporting.js','utf8');
  const shell=readFileSync('public/fanvue-app.js','utf8');
  // v3.1 redesign: report routes open the matching page or view in the new shell.
  assert.match(shell,/'report-articles':'x-articles'/);
  assert.match(shell,/'report-article-rt':'x-articles\/paid-reposts'/);
  assert.match(shell,/'report-guru':'guru-promotion'/);
  assert.match(html,/campaign-reporting\.js/);
  // Site recommendations: one GTA VI results table; old format URLs open the matching filter.
  assert.match(shell,/'x-original-posts':\{type:'Post'\},'x-quote-posts':\{type:'QRT'\},'mandy-qrts':\{group:'Mandy'\}/);
  assert.doesNotMatch(shell,/key:'quoted'/);
  // Quoted original posts now appear in each QRT's details as Source Post and Quoted post views.
  assert.match(shell,/\['Quoted post views',o&&C\.num\(o\.views\)!==null/);
  assert.match(app,/function renderGtaQuotedSources\(\)/);
  assert.match(app,/el\('gtaWeekLabel'\)\.textContent='All-time stats'/);
  assert.match(app,/data-page/);
  assert.match(app,/postPublicationClicks/);
  assert.match(ui,/X Article Boosts/);
  assert.match(app,/xtracker-gta-report-qrts-v1/);
});

test('Article RT views reuse only an exact verified original X post and never duplicate source views',()=>{
  const rows=[
    {publisher:'Reposter A',postUrl:'https://x.com/original/status/2121000000000000000',paid:true,posted:true,cost:30},
    {publisher:'Reposter B',postUrl:'https://x.com/original/status/2121000000000000000',paid:true,posted:true,cost:50},
    {publisher:'Reposter C',postUrl:'https://x.com/other/status/999',paid:true,posted:true,cost:20}
  ];
  const feeds={boosts:{tweets:[{id:'2121000000000000000',handle:'original',views:15000,likes:200,
    reposts:45,replies:10,at:'2026-11-23T17:00:00Z'}]}};
  const linked=enrichArticleRtMetrics(rows,feeds);
  assert.equal(linked[0].views,15000);
  assert.equal(linked[1].views,15000);
  assert.equal(linked[2].views,undefined);
  assert.equal(linked[0].metricSource,'X_RTS');
  const assembled=assembleCampaignOverview({
    articleRts:{data:{rows,at:'2026-11-23T17:00:00Z',source:'GOOGLE_SHEETS_LIVE'}},
    boosts:{data:{ok:true,tweets:feeds.boosts.tweets}}
  });
  const rts=assembled.campaigns.find(c=>c.id==='article-rts'),guru=assembled.campaigns.find(c=>c.id==='guru-rts');
  // Owner direction (25 Nov): RTs of a promoted Guru account's post are Guru Promotion spend.
  // The two RTs of the same original are counted once each; its views are counted once.
  assert.equal(guru.paidSpendKnown,80);
  assert.equal(guru.paidCount,2);
  assert.equal(guru.views,15000);
  assert.equal(rts.paidSpendKnown,20);
  assert.equal(rts.paidSpendKnown+guru.paidSpendKnown,100);
  assert.equal(rts.views,null);
});


test('dashboard has exactly one visible large Reload All control and keeps targeted refresh sources',()=>{
 const html=readFileSync('public/index.html','utf8');
 const app=readFileSync('public/app.js','utf8');
 const css=readFileSync('public/fanvue.css','utf8');
 const reporting=readFileSync('public/campaign-reporting.js','utf8');
 const shell=readFileSync('public/fanvue-app.js','utf8');
 // One header refresh control. Home labels it "Refresh All"
 // and runs the existing reload coordinator with real progress callbacks.
 assert.equal((html.match(/id="fvRefresh"/g)||[]).length,1);
 assert.match(html,/id="fvRefreshStatus"/);
// Owner (26 Nov): Home is named Dashboard; OnlyFans Terms is OF Terms; Guru X RTs is Guru RTs.
  assert.match(shell,/title:'Dashboard',refreshLabel:'Refresh All'/);
 assert.match(shell,/refreshScopes=\{'home':'all','all-accounts':'accounts'/);
 assert.match(shell,/fetch\(refreshEndpoint,\{method:'POST'/);
 const durable=readFileSync('netlify/lib/durable-refresh.mjs','utf8');
 assert.match(durable,/all:\['x','gta','discord','of-read','boosts-read','overview'\]/);
 assert.match(durable,/if\(plan.includes\('overview'\)\)await task\('overview'\)/);
 assert.match(app,/refresh:Object\.freeze\(\{all:reloadAllData,/);
 const start=app.indexOf('async function reloadAllData(');
 const end=app.indexOf('function applyDashboard(data)',start);
 assert.ok(start>0&&end>start);
 const coordinator=app.slice(start,end);
 assert.match(coordinator,/settle\(\(\)=>refreshXStats\(\)/);
 assert.match(coordinator,/settle\(\(\)=>refreshGtaReport\(label=>progress\(/);
 assert.match(coordinator,/loadOfReport\(true,false\)/);
 assert.match(coordinator,/loadBoosts\(true\)/);
 assert.match(coordinator,/XTrackerCampaignReporting\?\.reload\?\.\(\{reuseReports:/);
 assert.doesNotMatch(coordinator,/refreshBoostStats\(\)|refreshOfReport\(\)/);
 assert.match(app,/el\('reloadAllButton'\)\.addEventListener\('click',reloadAllData\)/);
 assert.match(css,/\.fv-control\{display:inline-flex/);
 assert.doesNotMatch(css,/#ff008c/i);
 assert.match(reporting,/\['article-rt','X Article Boosts'\]/);
});

test('manual reporting force-refresh bypasses Sheet and report caching without POSTing to X',async()=>{
 const calls=[];let sheetForce;
 const values=await readReportParts('https://example.netlify.app/',{
   force:true,
   fetcher:async (url,opts)=>{calls.push({url:String(url),options:opts});return Response.json({ok:true});},
   readRts:async ({force})=>{sheetForce=force;return {rows:[]};}
 });
 assert.equal(sheetForce,true);
 assert.equal(calls.length,4);
 assert.equal(calls.filter(r=>r.url.includes('?refresh=1')).length,3);
 assert.ok(calls.every(r=>r.options.cache==='no-store'));
 assert.ok(calls.every(r=>!r.options.method||r.options.method==='GET'));
 assert.equal(values.articleRts.data.rows.length,0);
});

test('completed refresh reuses freshly fetched reports but still rereads Article RT spend',async()=>{
 const calls=[];let force;
 await readReportParts('https://example.netlify.app/',{force:true,reuseReports:true,fetcher:async u=>{calls.push(String(u));return Response.json({ok:true});},readRts:async o=>{force=o.force;return {rows:[]};}});
 assert.equal(calls.length,4);assert.equal(force,true);assert.ok(calls.some(u=>u.includes('gta-report?reuse=1')));assert.ok(calls.every(u=>!u.includes('refresh=1')));
});

test('original RT history survives a refresh when another source supplies the newest exact-post reading',async()=>{
 const postUrl='https://x.com/example/status/123';
 const prior={postId:'123',postUrl,views:100,at:'2026-11-24T12:00:00Z',lastAttemptAt:'2026-11-24T12:00:00Z'};
 let data={metrics:{'123':prior},history:[{id:'123',postId:'123',views:100,at:prior.at}]},requests=0;
 const store={get:async()=>data,setJSON:async(key,value)=>{data=value;}};
 const row={paid:true,posted:false,postUrl,sourcePostUrl:postUrl,sourceViews:true,sourceOriginalViews:450,metricAt:'2026-11-28T12:00:00Z',metricSource:'X_RTS'};
 const result=await readArticleOriginalMetrics([row],{store,now:Date.parse('2026-11-28T12:00:30Z'),force:true,verifiedRows:[row],fetcher:async()=>{requests++;throw Error('unnecessary request');}});
 assert.equal(requests,0);assert.equal(result.metrics['123'].views,450);assert.equal(result.history.length,2);
 assert.equal(row.posted,false);
 const assembled=assembleCampaignOverview({articleRts:{data:{rows:[row],source:'GOOGLE_SHEETS_LIVE'}},boosts:{data:{ok:true,tweets:[{id:'123',handle:'example',views:100,at:prior.at}]}},articleOriginals:{data:result}});
 assert.equal(assembled.campaigns.find(c=>c.id==='guru-rts').views,450);
});
