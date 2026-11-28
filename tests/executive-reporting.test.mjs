import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import ExcelJS from 'exceljs';
import {countPlannedAsPaid} from '../netlify/functions/gta-report.mjs';
import {applyPaymentDates} from '../netlify/lib/payment-dates.mjs';
import {assembleCampaignOverview} from '../netlify/functions/campaign-overview.mjs';
import {parseDirectory,createDirectoryHandler} from '../netlify/functions/publisher-directory.mjs';
await import('../public/fanvue-core.js');
const C=globalThis.FanvueCore;
const url=n=>'https://x.com/publisher/status/'+n;
const campaign=(id,rows,extra={})=>({id,source:'CONNECTED',rows,paidCount:rows.filter(r=>r.paid&&!r.planned).length,paidSpendKnown:rows.filter(r=>r.paid&&!r.planned).reduce((n,r)=>n+(r.cost||0),0),unknownPaidCosts:0,...extra});
function app(overview,extras={}){
  const window={FanvueCore:C,FanvuePaymentDates:globalThis.FanvuePaymentDates,FanvueDirectory:{state:{accounts:[]},load(){}},XTrackerCampaignReporting:{getData:()=>overview,status:()=>({}),ensure(){},discord:()=>extras.discord||{},refreshDiscord(){}},XTrackerApp:{dashboard:()=>extras.dashboard||null,gta:()=>({report:extras.gta||null}),of:()=>({report:extras.of}),loadGta(){},loadOf(){}}};
  const context=vm.createContext({window,location:{hash:'#home'},document:{readyState:'loading',addEventListener(){}},URL,Intl,Date,Math,Map,Set,Number,String,Array,Object,JSON,console,setTimeout,clearTimeout});
  vm.runInContext(readFileSync('public/fanvue-ui.js','utf8'),context);
  vm.runInContext(readFileSync('public/fanvue-app.js','utf8'),context);
  return window.FanvueApp.reporting;
}
test('planned bookings never become paid; legacy synthetic flags are removed idempotently',()=>{
  const input=[{campaign:'GTAQ2',paid:false,cost:100},{campaign:'GTAM',paid:true,planned:true,cost:50},{campaign:'GTAM',paid:true,cost:180}];
  const rows=countPlannedAsPaid(input);
  assert.deepEqual(rows.map(r=>r.paid),[false,false,true]);
  assert.deepEqual(countPlannedAsPaid(rows),rows);
  assert.equal(input[1].paid,true,'source objects must not be mutated');
});
test('paid, committed, planned and remaining are separate amounts in the reporting feed',()=>{
  const rows=countPlannedAsPaid([{campaign:'GTAQ2',paid:false,cost:100},{campaign:'GTAQ',paid:false,cost:40},{campaign:'GTAQ',paid:true,cost:180}]);
  const group={ready:true,source:'CONNECTED',publishers:rows,shortIo:{}};
  const ov=assembleCampaignOverview({gta:{data:{...group,budget:{amount:1000,currency:'USD'},originals:{...group,publishers:[]},instagram:{...group,publishers:[]},mandy:{...group,publishers:[]}}}});
  const s=C.campaignSummary(ov,'gta-vi');
  assert.equal(s.paidSpend.value,180);assert.equal(s.spend.value,320);assert.equal(s.allocatedSpend.value,320);assert.equal(s.committed,40);assert.equal(s.planned,100);assert.equal(s.budget.remaining.value,680);
});
test('CPC and clicks per dollar use matched paid traffic and exclude planned and shared counters',()=>{
  const rows=[{paid:true,posted:true,cost:100,clicks:25,trackingUrl:'https://example.com/a',postUrl:url(1)},{paid:true,planned:true,posted:true,cost:500,clicks:1000,trackingUrl:'https://example.com/b',postUrl:url(2)},{paid:true,posted:true,cost:1000,clicks:500,sharedTracking:true,trackingUrl:'https://example.com/c',postUrl:url(3)}];
  assert.equal(C.efficiency([{rows}]).cpc.value,4);
  assert.equal(1/C.efficiency([{rows}]).cpc.value,.25);
});
test('weekly spend follows payment date independently of post date; undated payments are partial',()=>{
  const ov={campaigns:[campaign('x-articles',[{code:'A1',paid:true,posted:true,cost:100,paidAt:'2026-11-24T12:00:00Z',postUrl:url(1)},{code:'A2',paid:true,posted:true,cost:250,postUrl:url(2)}])]};
  const r=app(ov).periodTotals('2026-11-23','2026-11-29');
  assert.equal(r.spend.value,100);assert.equal(r.spend.state,'partial');
  const missing=app({campaigns:[campaign('x-articles',[{code:'A3',paid:true,cost:50}])]}).periodTotals('2026-11-23','2026-11-29');
  assert.equal(missing.spend.value,null);
});
test('views never fabricate zero gain on a day with no reading or assign multi-day gains to a single day',()=>{
  const d=C.dailySeries([{id:'old',at:'2026-11-23T12:00:00Z',views:100},{id:'old',at:'2026-11-26T12:00:00Z',views:400}],{now:Date.parse('2026-11-26T15:00:00Z')});
  assert.ok(d.gained.every(p=>p.value===null));
});
test('Discord periods before snapshots remain unknown and net growth can be negative',()=>{
  const a=app({campaigns:[]},{discord:{members:{history:[{date:'2026-11-25',memberCount:100},{date:'2026-11-26',memberCount:90}],latest:{date:'2026-11-26',memberCount:90}},clicks:{total:10,daysTotal:10,days:{'2026-11-26':10}}}});
  const d=a.discordStats('2026-11-23','2026-11-26','2026-11-16','2026-11-22');
  assert.equal(d.last.growth.value,null);assert.equal(d.last.members.value,null);assert.equal(d.last.clicks.value,null);assert.equal(d.all.growth.value,-10);
});
test('Viral QRTs is a view of the same placement, not another global cost or original-view total',()=>{
  const row={code:'M1',campaign:'GTAM',sourceTab:'Mandy',sourceRow:8,publisher:'P',paid:true,posted:true,cost:50,clicks:10,views:100,trackingUrl:'https://example.com/a',postUrl:url(1)};
  const ov={campaigns:[campaign('gta-mandy',[row],{postPublicationClicks:10,quotedOriginals:{rows:[{originalPostId:'99',originalUrl:url(99),handle:'original',views:1000000,qrts:[{postUrl:url(1)}]}]}})]};
  const a=app(ov);const html=a.pages['viral-qrts']({}).body;
  assert.doesNotMatch(html,/Viral Posts|1,000,000/,'the standalone original-view summary is intentionally removed');
  assert.match(html,/data-expand=/,'per-placement details remain available');
  assert.equal(a.xKpis([{raw:row,paid:true,type:'QRT',clicks:C.M.value(10)}]).views.value,100);
  assert.ok(!C.CAMPAIGNS.some(c=>c.key==='viral-qrts'));
});
test('publisher directory exposes only identities and merges duplicate platform handles',()=>{
  const b=new ExcelJS.Workbook();for(const name of ['X_ AI','X_ News']){const s=b.addWorksheet(name);s.getRow(5).values=['X · @SameUser',10000,50,null,null,null,'PRIVATE PAYMENT DETAILS'];}
  const rows=parseDirectory(b);assert.equal(rows.length,1);assert.deepEqual(Object.keys(rows[0]).sort(),['handle','key','platform','profileUrl']);assert.ok(!JSON.stringify(rows).includes('PRIVATE'));
});
test('OF Terms has one publisher results page; Accounts has history, filters and no graph',()=>{
  const a=app({campaigns:[campaign('of-terms',[])]});
  const of=a.pages['of-terms']({}).body,accounts=a.pages['all-accounts']({}).body;
  assert.doesNotMatch(of,/fv-subnav/);assert.match(of,/fv-view-slot/);assert.doesNotMatch(accounts,/acc-chart/);
});

test('directory returns a safe dated snapshot even when storage and source are unavailable',async()=>{
  const handler=createDirectoryHandler({storeFactory:()=>{throw Error('private environment error')},fetcher:async()=>{throw Error('source offline')}});
  const response=await handler();assert.equal(response.status,200);const data=await response.json();assert.equal(data.ok,true);assert.equal(data.stale,true);assert.equal(data.accounts.length,342);assert.ok(data.checkedAt);assert.ok(!JSON.stringify(data).includes('private environment error'));
});

test('chart hover targets remain inside the plot and cannot cover sidebar navigation',()=>{
  const context=vm.createContext({window:{FanvueCore:C},URL,Intl,Date,Math,Number,String,Array,Object,Map,Set,JSON});
  vm.runInContext(readFileSync('public/fanvue-ui.js','utf8'),context);
  const plot={clientWidth:600,clientHeight:230,innerHTML:''};
  for(const n of [1,2,3,20]){
    const series=Array.from({length:n},(_,i)=>({week:'2026-11-'+String(i+1).padStart(2,'0'),label:String(i+1),value:i+1}));
    context.window.FanvueUI.drawChart({querySelector:()=>plot},{series,title:'Views'},'line');
    const targets=[...plot.innerHTML.matchAll(/class="fv-hit"[^>]*style="left:([0-9.-]+)px;width:([0-9.-]+)px/g)];
    assert.equal(targets.length,n);for(const hit of targets){assert.ok(Number(hit[1])>=0);assert.ok(Number(hit[1])+Number(hit[2])<=600);}
  }
});

test('history is a period bar chart, never a running total, and short real histories are retained',()=>{
  const context=vm.createContext({window:{FanvueCore:C},URL,Intl,Date,Math,Number,String,Array,Object,Map,Set,JSON});
  vm.runInContext(readFileSync('public/fanvue-ui.js','utf8'),context);const U=context.window.FanvueUI;
  const series=[5,3,9].map((value,i)=>({week:'2026-11-'+String(i*7+2).padStart(2,'0'),value,label:String(i)}));
  const html=U.chartPanel({id:'weekly',measures:[{key:'clicks',title:'Weekly Clicks',series}]},{});
  assert.match(html,/data-type="bar"/);assert.doesNotMatch(html,/fv-switch/);
  assert.deepEqual([...U.getMeasure('weekly','clicks').series].map(r=>r.value),[5,3,9]);
  assert.match(U.chartPanel({id:'short',measures:[{key:'gain',title:'Daily Views',period:'Day',series:series.slice(0,2)}]},{}),/data-type="bar"/);
  assert.equal(U.chartPanel({id:'empty',measures:[{key:'gain',title:'Daily Views',period:'Day',series:[]}]},{}),'');
  const daily=Array.from({length:5},(_,i)=>({week:'2026-11-'+(20+i),value:i,label:String(i)}));
  assert.match(U.chartPanel({id:'daily',measures:[{key:'gain',title:'Daily Views',period:'Day',series:daily}]},{}),/data-type="bar"/);
});
test('Dashboard uses one selected period and one click figure; the Viral view is not added again',()=>{
  const ov={campaigns:[campaign('gta-qrts',[],{postPublicationClicks:10}),campaign('gta-originals',[]),campaign('gta-instagram',[]),campaign('gta-mandy',[],{postPublicationClicks:5}),campaign('x-articles',[],{trackedClicks:50}),campaign('article-rts',[]),campaign('of-terms',[],{trackedClicks:20}),campaign('guru-rts',[],{paidReposts:[]})]};
  const a=app(ov),all=a.pages.home({view:'all-time'}).body;
  assert.equal((all.match(/aria-label="Key metrics"/g)||[]).length,1);assert.match(all,/>85</);
  assert.doesNotMatch(all,/fv-period-card|fv-click-breakdown|fv-coverage/);
  for(const p of ['this-week','last-week','all-time'])assert.match(all,new RegExp('data-view="'+p+'"'));
  const week=a.pages.home({view:'this-week'}).body;assert.match(week,/data-view="this-week" aria-pressed="true"/);
  const initial=a.pages.home({view:''}).body;
  assert.match(initial,/data-view="this-week" aria-pressed="true"/,'This Week is selected by default');
  assert.match(initial,/data-view="last-week" aria-pressed="false"/);
  assert.match(initial,/data-view="all-time" aria-pressed="false"/);
  assert.deepEqual([...initial.matchAll(/data-view="(this-week|last-week|all-time)"/g)].map(m=>m[1]),['this-week','last-week','all-time']);
  assert.match(a.pages.home({view:'last-week'}).body,/data-view="last-week" aria-pressed="true"/);
  assert.match(all,/data-view="all-time" aria-pressed="true"/);
  assert.doesNotMatch(week,/fv-period-card/);
});
test('published headlines remain tied to the verified post identity',async()=>{
  const {parseXResponse,applyMetrics}=await import('../netlify/lib/metrics.mjs');
  const m=parseXResponse({tweet:{id:'123',views:10,likes:1,replies:0,retweets:0,article:{title:'Verified public headline'}}},'123','2026-11-26T12:00:00Z');
  assert.equal(m.articleTitle,'Verified public headline');
  assert.equal(applyMetrics([{code:'P1',postUrl:url(123)}],{metrics:{P1:m}})[0].articleTitle,'Verified public headline');
  assert.equal(applyMetrics([{code:'P1',postUrl:url(124)}],{metrics:{P1:m}})[0].articleTitle,undefined);
});

test('daily click bars report each day independently, including verified zero-event days',()=>{
  const series=C.dailyEventSeries([{date:'2026-11-22',clicks:1},{date:'2026-11-23',clicks:10},{date:'2026-11-24',clicks:64},{date:'2026-11-26',clicks:3}],{now:Date.parse('2026-11-26T15:00:00Z')});
  assert.deepEqual(series.map(r=>r.value),[1,10,64,0,3]);assert.equal(series[0].week,'2026-11-22');assert.equal(series.at(-1).incomplete,true);
});

test('Discord uses the latest dated count consistently without rewriting snapshots or mixing approximate sources',()=>{
  const members={history:[{date:'2026-11-23',memberCount:24168},{date:'2026-11-26',memberCount:24266}],latest:{date:'2026-11-26',memberCount:24288}};
  const readings=C.memberReadings(members);assert.equal(readings.at(-1).memberCount,24288);assert.equal(members.history.at(-1).memberCount,24266);
  const a=app({campaigns:[]},{discord:{members,clicks:{total:171,days:{'2026-11-26':10}}}});
  assert.equal(a.discordStats('2026-11-23','2026-11-26','2026-11-16','2026-11-22').all.growth.value,120);
  const html=a.pages.discord({}).body;assert.match(html,/\+120/);assert.match(html,/>24,288</);assert.doesNotMatch(html,/>24,266</);
  assert.equal(C.memberReadings({...members,source:'DISCORD_INVITE_APPROXIMATE'}).at(-1).memberCount,24266);
  assert.equal(C.memberReadings({...members,latest:{date:'2026-11-22',memberCount:99999}}).at(-1).memberCount,24266);
});

test('Viral QRTs keeps Clicks first and renders short verified daily click history as pink-compatible bars',()=>{
  const row={code:'M1',publisher:'Publisher',paid:true,posted:true,cost:50,clicks:74,postUrl:'https://x.com/publisher/status/2125636187897610404'};
  const a=app({campaigns:[campaign('gta-mandy',[row],{postPublicationClicks:74})]},{gta:{mandy:{activity:[{code:'M1',date:'2026-11-25',clicks:10},{code:'M1',date:'2026-11-26',clicks:64}]}}});
  const html=a.pages['viral-qrts']({}).body;assert.match(html,/Daily Clicks/);assert.match(html,/data-type="bar"/);assert.ok(html.indexOf('Clicks')<html.indexOf('Views'));assert.match(html,/>74</);
});

test('publisher value badges use matched CPC and require a meaningful traffic sample',()=>{
 const a=app({campaigns:[]}),rows=[1,2,3,4].map(n=>({key:String(n),matchedClicks:20,cpc:C.M.value(n)}));
 const marked=a.markAccountValue([...rows,{key:'tiny',matchedClicks:1,cpc:C.M.value(.01)},{key:'missing',matchedClicks:500,cpc:C.M.na('No matched costs')}]);
 assert.deepEqual([...marked].filter(r=>r.bestValue).map(r=>r.key),['1']);assert.ok(!rows.some(r=>'bestValue' in r));
 assert.ok(!a.markAccountValue(rows.slice(0,3)).some(r=>r.bestValue));
});

test('seven UK dates retain gaps and suppress future values; historical weeks stay historical',()=>{
 const context=vm.createContext({window:{FanvueCore:C},URL,Intl,Date,Math,Number,String,Array,Object,Map,Set,JSON});
 vm.runInContext(readFileSync('public/fanvue-ui.js','utf8'),context);
 const U=context.window.FanvueUI,now=Date.parse('2026-11-26T12:00:00Z');
 const points=[{week:'2026-11-26',value:0},{week:'2026-11-23',value:8},{week:'2026-11-29',value:100}];
 const slots=U.weekSlots(points,now);
 assert.deepEqual(Array.from(slots,p=>p.week),['2026-11-23','2026-11-24','2026-11-25','2026-11-26','2026-11-27','2026-11-28','2026-11-29']);
 assert.deepEqual(Array.from(slots,p=>p.value),[8,null,null,0,null,null,null]);
 assert.equal(U.weekSlots([],now,'2026-11-16')[6].week,'2026-11-22');
 const prior=C.addDays(C.weekStart(C.londonDay(Date.now())),-7),plot={clientWidth:305,clientHeight:130,innerHTML:''};
 U.drawChart({querySelector:()=>plot},{period:'Day',weekFrom:prior,series:[{week:prior,value:8},{week:C.addDays(prior,1),value:0}],title:'Clicks',unit:'Clicks'},'bar');
 assert.equal((plot.innerHTML.match(/data-bar=/g)||[]).length,1);
 assert.equal((plot.innerHTML.match(/class="fv-hit"/g)||[]).length,7);
 assert.doesNotMatch(plot.innerHTML,/fv-bar-value/);
 assert.match(plot.innerHTML,/dy="15"/);
});
test('campaign and Discord views reserve four cards, a chart and listings even without data',()=>{
 const A=app({campaigns:[]});let columns;
 for(const [key,view] of [['gta-vi','overview'],['gta-vi','lucia'],['gta-vi','mandy'],['viral-qrts','overview'],['x-articles','overview'],['x-articles','articles'],['x-articles','rts'],['of-terms','overview'],['guru-promotion','overview'],['discord','overview']]){
  const html=A.pages[key]({view}).body;
  assert.equal((html.match(/class="fv-metric"/g)||[]).length,4,key+'/'+view);
  const k=html.indexOf('fv-strip'),g=html.indexOf('fv-chart-panel'),l=html.indexOf('fv-table-panel');assert.ok(k>=0&&k<g&&g<l,key+'/'+view);
  if(key!=='discord'){const col=html.match(/<colgroup>.*?<\/colgroup>/)?.[0];assert.ok(col);if(!columns)columns=col;assert.equal(col,columns,key+'/'+view);}
 }
 assert.doesNotMatch(A.pages['all-accounts']({}).body,/fv-account-tag|fv-value-badge|is-best-value/);
});

test('dashboard always reserves campaign rows and follows the shared frame, even while loading',()=>{
 const html=app(null).pages.home({view:'all-time'}).body;
 const k=html.indexOf('fv-strip'),g=html.indexOf('fv-chart-panel'),l=html.indexOf('home-comparison'),d=html.indexOf('fv-home-discord');
 assert.ok(k>=0&&k<g&&g<l&&l<d);
 assert.equal((html.slice(k,g).match(/class="fv-metric"/g)||[]).length,4);
 assert.equal((html.slice(d).match(/class="fv-metric"/g)||[]).length,3);
 assert.match(html.slice(d),/aria-label="Discord metrics"/);
 assert.equal((html.match(/class="fv-row"/g)||[]).length,5);
});
test('dashboard weekly clicks include scoped Short.io readings exactly once, not lifetime totals',()=>{
 const day=C.londonDay(Date.now());
 const post='https://x.com/test/status/'+String(BigInt(Date.now()-86400000-1288834974657)<<22n);
 const row={code:'G1',campaign:'GTAM',publisher:'Test',paid:true,posted:true,postUrl:post,trackingUrl:'https://example.com/g1',cost:20,clicks:999};
 const ar={code:'A1',publisher:'Article',paid:true,posted:true,postUrl:url(1),cost:20,clicks:888};
 const of={code:'O1',publisher:'OF',paid:true,posted:true,postUrl:url(2),cost:20,clicks:777};
 const ov={campaigns:[campaign('gta-mandy',[row]),campaign('x-articles',[ar]),campaign('of-terms',[of])]};
 const a=app(ov,{gta:{mandy:{activity:[{code:'G1',date:day,clicks:7},{code:'G1',date:day,clicks:7}]}},dashboard:{activityReady:true,activity:[{code:'A1',date:day,clicks:3},{code:'UNRELATED',date:day,clicks:1000}]},of:{ready:true,activity:[{code:'O1',date:day,clicks:2}]}});
 assert.equal(a.periodTotals(day,day).clicks.value,12);
});

test('only the confirmed portion of a changed payment amount is allocated to its known week',()=>{
 const ov={campaigns:[campaign('gta-mandy',[{code:'GTAM-N',campaign:'GTAM',publisher:'Nekt_0',paid:true,cost:100,paidAt:'2026-11-25',datedPaidAmount:70}])]};
 const r=app(ov).periodTotals('2026-11-23','2026-11-29');assert.equal(r.spend.value,70);assert.equal(r.spend.state,'partial');
});

test('old saved campaign data receives confirmed payment dates without losing all-time spend',()=>{
 const rows=[{code:'old-mandy',campaign:'GTAM',publisher:'kyronis_talks',paid:true,cost:180},{code:'old-aman',campaign:'GTAM',publisher:'aiwithaman',paid:true,cost:50},{code:'old-nekt',campaign:'GTAM',publisher:'Nekt_0',paid:true,cost:100},{code:'old-q',campaign:'GTAQ',publisher:'Quam',paid:true,cost:100},{code:'undated',campaign:'GTAQ',publisher:'other',paid:true,cost:300}];
 const raw={ok:true,campaigns:[campaign('gta-mandy',rows.slice(0,3)),campaign('gta-qrts',rows.slice(3))]};
 const migrated=applyPaymentDates(raw);assert.equal(raw.campaigns[0].rows[0].paidAt,undefined);
 assert.equal(migrated.campaigns[0].paidSpendKnown,330);
 assert.equal(app(raw).periodTotals('2026-11-23','2026-11-29').spend.value,280);
 assert.equal(app(raw).periodTotals('2026-11-16','2026-11-22').spend.value,75);
 assert.equal(app(raw).periodTotals('2026-11-16','2026-11-22').spend.state,'partial');
 const missing=app({campaigns:[campaign('x-articles',[{code:'null-date',paid:true,cost:100,paidAt:null}])]}).periodTotals('2026-11-23','2026-11-29').spend;
 assert.equal(missing.value,null);assert.equal(missing.label,undefined);assert.equal(missing.displayDash,true);assert.match(missing.reason,/Payment dates are not recorded/);
 assert.match(app(raw).pages.home({view:'this-week'}).body,/\$280/);
});

test('GTA VI spend includes allocations once, retaining genuine paid flags',()=>{
 const planned={code:'gta-plan',campaign:'GTAQ2',publisher:'arkavx',paid:false,planned:true,cost:150};
 const committed={code:'gta-book',campaign:'GTAQ',paid:false,cost:100,plannedAt:'2026-11-24'};
 const paid={code:'gta-paid',campaign:'GTAM',paid:true,cost:50,paidAt:'2026-11-25'};
 const nonGta={code:'non-gta',paid:false,planned:true,cost:900,plannedAt:'2026-11-24'};
 const ov={campaigns:[campaign('gta-qrts',[planned,committed],{plannedSpendKnown:150,committedUnpaidKnown:100}),campaign('gta-originals',[]),campaign('gta-mandy',[paid]),campaign('x-articles',[nonGta])]};
 const a=app(ov);
 assert.equal(a.periodTotals('2026-11-23','2026-11-29').spend.value,300);
 const s=C.campaignSummary(ov,'gta-vi');assert.equal(s.spend.value,300);assert.equal(s.allocatedSpend.value,300);assert.equal(s.paidSpend.value,50);
 assert.match(a.pages.home({view:'this-week'}).body,/\$300/);
 const converted={...planned,paid:true,planned:false,paidAt:'2026-11-25'};
 const next={campaigns:[campaign('gta-qrts',[converted,committed],{plannedSpendKnown:0,committedUnpaidKnown:100}),campaign('gta-originals',[]),campaign('gta-mandy',[paid]),campaign('x-articles',[nonGta])]};
 assert.equal(app(next).periodTotals('2026-11-23','2026-11-29').spend.value,300);
 assert.equal(C.campaignSummary(next,'gta-vi').spend.value,300);assert.equal(C.campaignSummary(next,'gta-vi').allocatedSpend.value,300);
 assert.equal(C.campaignSummary(next,'gta-vi').paidSpend.value,200);
});

test('every campaign KPI group has the same period controls; GTA VI period spend uses dated payments and allocations',()=>{
 const now=C.londonDay(Date.now()),ws=C.weekStart(now),prior=C.addDays(ws,-7);
 const rows=[{code:'current',campaign:'GTAM',publisher:'Current',paid:true,paidAt:now,cost:50},{code:'last',campaign:'GTAM',publisher:'Last',paid:true,paidAt:prior,cost:120},{code:'plan',campaign:'GTAM',publisher:'Future',paid:false,planned:true,plannedAt:now,cost:70}];
 const ov={campaigns:[campaign('gta-mandy',rows,{plannedSpendKnown:70}),campaign('gta-qrts',[]),campaign('gta-originals',[]),campaign('x-articles',[]),campaign('article-rts',[]),campaign('of-terms',[]),campaign('guru-rts',[])]};
 const a=app(ov),pages=['gta-vi','viral-qrts','x-articles','of-terms','guru-promotion','discord'];
 for(const key of pages){const html=a.pages[key]({}).body;assert.deepEqual([...html.matchAll(/data-period="([^"]+)"/g)].map(m=>m[1]),['this-week','last-week','all-time'],key);assert.match(html,/data-period="this-week" aria-pressed="true"/);}
 for(const key of ['gta-vi','viral-qrts']){for(const [period,amount] of [['this-week',120],['last-week',120],['all-time',240]]){const html=a.pages[key]({period}).body;assert.match(html,new RegExp('data-period="'+period+'" aria-pressed="true"'));const strip=html.split('aria-label="Key metrics"')[1]?.split('</section>')[0]||html;assert.ok(strip.includes('$'+amount),key+' '+period+' '+amount);}}
});

test('Discord period scope is visible and both pages use identical verified member snapshots',()=>{
 const today=C.londonDay(Date.now()),ws=C.weekStart(today),last=C.addDays(ws,-1),prior=C.addDays(ws,-7);
 const members={history:[{date:prior,memberCount:100},{date:last,memberCount:110},{date:today,memberCount:125}],latest:{date:today,memberCount:125}};
 const x=app({campaigns:[]},{discord:{members,clicks:{total:40,last7Days:25,daysTotal:40,days:{[last]:15,[today]:25}}}});
 const d=x.discordStats(ws,today,prior,last);assert.equal(d.week.growth.value,15);assert.equal(d.week.startingMembers.value,110);assert.equal(d.last.members.value,110);assert.equal(d.all.growth.value,25);
 for(const [view,label,growth] of [['this-week','This Week',15],['last-week','Last Week',10],['all-time','All Time',25]]){const html=x.pages.home({view}).body;assert.match(html,new RegExp('fv-discord-scope" title="[^"]*">'+label+'</span>'));assert.doesNotMatch(html,/class="fv-discord-scope"[^>]*><div/);assert.ok(html.includes('href="#discord/'+view+'"'));assert.ok(html.includes('Net Growth'));const page=x.pages.discord({period:view}).body;assert.ok(page.includes('Net Growth'));assert.ok(page.includes('Start Members'));assert.doesNotMatch(page,/fv-period-date|fv-discord-periods/);assert.match(page,/data-period="this-week"[^>]*>This Week<\/button>/);assert.doesNotMatch(page,/7d Course Clicks/);assert.ok(page.includes('+'+growth));}
 const noWeek=app({campaigns:[]},{discord:{members:{history:[{date:C.addDays(prior,-1),memberCount:80}],latest:{date:C.addDays(prior,-1),memberCount:80}}}}).discordStats(ws,today,prior,last);assert.equal(noWeek.last.members.value,null);assert.equal(noWeek.week.growth.value,null);
});

test('allocation stays in its original week after payment, uses current source cost and excludes unrelated unpaid rows',()=>{const r={campaign:'GTAQ2',publisher:'arkavx',code:'p',cost:155,paid:false,planned:true,plannedAt:'2026-11-24'};const paid={...r,paid:true,planned:false,paidAt:'2026-12-02'};for(const row of [r,paid]){const entry=C.financeEntry(row);assert.equal(C.financeSpend([entry,entry]).value,155);assert.equal(C.financeSpend([entry],{from:'2026-11-23',to:'2026-11-29'}).value,155);assert.equal(C.financeSpend([entry],{from:'2026-11-30',to:'2026-12-06'}).value,0);}assert.equal(C.financeEntry({...r,campaign:'OTHER'}),null);assert.equal(C.weekStart(C.londonDay('2026-07-05T23:00:00Z')),'2026-07-06');assert.equal(C.weekStart(C.londonDay('2026-07-05T22:59:59Z')),'2026-06-29');});

test('daily clicks reconcile stale adapter with fresh overview by link and day, without duplicates',()=>{
 const date='2026-11-27',post='https://x.com/publisher/status/'+String((BigInt(Date.parse(date+'T10:00:00Z')-1288834974657)<<22n)+1n),link='https://createmyai.app/test';
 const r={code:'new-code',campaign:'GTAM',publisher:'Publisher',paid:true,posted:true,postUrl:post,trackingUrl:link,cost:35,clicks:16};
 const old={code:'old-code',trackingUrl:link,date,clicks:4,end:date+'T12:00:00.000Z',at:date+'T12:01:00.000Z'};
 const fresh={...old,clicks:16,end:date+'T23:59:59.999Z',at:'2026-11-28T00:03:00.000Z'};
 const ov={campaigns:[campaign('gta-mandy',[r],{clickHistory:[fresh],clickHistoryReady:true,clickHistoryCheckedAt:fresh.at})]};
 const a=app(ov,{gta:{mandy:{activity:[old,fresh]}}});
 const series=a.dashboardClickSources()[0][1];assert.equal(series.find(p=>p.week===date).value,16);assert.equal(a.periodTotals(date,date).clicks.value,16);
});
test('dated event history chooses newest snapshot rather than adding both or synthesising future zero days',()=>{
 const date='2026-11-27',r={code:'A01-P01',paid:true,posted:true,cost:50,clicks:8,postUrl:url(1)};
 const ov={campaigns:[campaign('x-articles',[r],{trackedClicks:8,clickHistoryReady:true,clickHistoryCheckedAt:'2026-11-28T01:00:00Z',clickHistory:[{code:r.code,date,clicks:8}]})]};
 const a=app(ov,{dashboard:{activityReady:true,checkedAt:'2026-11-27T12:00:00Z',activity:[{code:r.code,date,clicks:2}]}});
 assert.equal(a.dashboardClickSources()[1][1].find(p=>p.week===date).value,8);
});
