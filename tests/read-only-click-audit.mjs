const base='https://elegant-swan-98c20a.netlify.app/.netlify/functions/',date='2026-11-27';
const read=async name=>{const r=await fetch(base+name,{cache:'no-store',redirect:'error',signal:AbortSignal.timeout(60000)});if(!r.ok)throw Error(name+' HTTP '+r.status);return r.json();};
const [g,d,o,v]=await Promise.all([read('gta-report?reuse=1'),read('dashboard'),read('of-report'),read('campaign-overview')]);
const groups=[['GTA QRTs',g],['GTA original posts',g.originals],['Viral QRTs (Mandy)',g.mandy],['GTA Instagram',g.instagram]];
const seen=new Set();let gta=0;
for(const [name,r] of groups){
 if(!r){console.log(name,'unavailable');continue;}
 const links=r.shortIo?.links||[],pubs=r.publishers||[];
 const eligible=links.filter(p=>p.attributed&&p.posted&&p.publicationAt&&p.publicationAt.slice(0,10)<=date);
 const daily=eligible.flatMap(p=>(p.dailyClicks||[]).filter(d=>d.date===date).map(d=>({link:p.trackingUrl,...d})));
 let clicks=0;for(const p of daily){if(seen.has(p.link))continue;seen.add(p.link);clicks+=p.clicks;}
 if(name!=='GTA Instagram')gta+=clicks;
 const cost=rows=>Math.round(rows.reduce((n,p)=>n+(Number(p.cost)||0),0)*100)/100;
 console.log('CLICK_AUDIT '+JSON.stringify({name,clicks,eligible:eligible.length,dated:daily.length,stale:daily.filter(d=>d.stale).length,fullDay:daily.filter(d=>!d.stale&&d.end?.startsWith(date+'T23:59:59')).length,latestDailyAt:daily.map(d=>d.at).sort().at(-1),missing:eligible.length-daily.length,allLinks:links.length,published:pubs.filter(p=>p.posted).length,paidPending:pubs.filter(p=>p.paid&&!p.posted).length,paidPendingCost:cost(pubs.filter(p=>p.paid&&!p.posted)),paid27:cost(pubs.filter(p=>p.paid&&p.paidAt===date)),published27:pubs.filter(p=>p.posted&&p.postUrl&&(()=>{try{return new Date(Number((BigInt(p.postUrl.match(/status\/(\d+)/)[1])>>22n)+1288834974657n)).toISOString().startsWith(date);}catch{return false;}})()).length,newDomain:links.filter(p=>p.trackingUrl?.includes('createmyai.app/')).length,newDomainLifetime:links.filter(p=>p.trackingUrl?.includes('createmyai.app/')).reduce((s,p)=>s+(p.clicks||0),0),newDomainDaily:daily.filter(p=>p.link?.includes('createmyai.app/')).reduce((s,p)=>s+p.clicks,0),newDomainDated:daily.filter(p=>p.link?.includes('createmyai.app/')).length,summary:r.summary,sourceStale:r.sourceStale,shortIoStale:r.shortIo?.stale,errors:r.shortIo?.errors}));
}
const articleCodes=new Set(v.campaigns.find(c=>c.id==='x-articles')?.rows?.map(r=>String(r.code))||[]),ofCodes=new Set(v.campaigns.find(c=>c.id==='of-terms')?.rows?.map(r=>String(r.code))||[]);
const sum=(rows,codes)=>rows?.filter(r=>r.date===date&&(!codes||codes.has(String(r.code)))).reduce((n,r)=>n+r.clicks,0)??null;
const articles=sum(d.clickActivity,articleCodes),of=sum(o.activity,ofCodes);
console.log('CLICK_AUDIT '+JSON.stringify({date,gta,articles,of,dashboard:(articles??0)+(of??0)+gta,articlesAllEvents:sum(d.clickActivity),ofAllEvents:sum(o.activity),articleTrackingReady:d.trackingReady,ofReady:o.ready,articleCheckedAt:d.checkedAt,ofCheckedAt:o.checkedAt,gtaCheckedAt:g.checkedAt,overviewCheckedAt:v.checkedAt,overviewStale:v.stale}));
