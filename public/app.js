(() => {
'use strict';
const TZ='Europe/London',el=id=>document.getElementById(id)||detachedNode(id);
// The redesigned shell (fanvue-app.js) renders Home, Discord and the campaign pages.
// Their superseded legacy containers resolve to detached nodes, so the retained data,
// refresh and record-editing logic below keeps working without touching the page.
const detachedNodes=new Map();
function detachedNode(id){let node=detachedNodes.get(id);if(!node){node=document.createElement(/Select$/.test(id)?'select':'div');detachedNodes.set(id,node);}return node;}
const legacyView=id=>Boolean(document.getElementById(id));
const APP_VERSION='5.0.40';
const fmt=n=>new Intl.NumberFormat('en-GB',{maximumFractionDigits:0}).format(Number(n));
const money=n=>n===null||n===undefined?'—':'$'+fmt(n);
const gbp=n=>new Intl.NumberFormat('en-GB',{style:'currency',currency:'GBP',minimumFractionDigits:2,maximumFractionDigits:2}).format(n);
const display=n=>n===null||n===undefined||n===''?'—':fmt(n);
const fixed=(n,places=2)=>n===null||n===undefined||!Number.isFinite(Number(n))?'—':Number(n).toFixed(places);
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const safeUrl=s=>{try{const u=new URL(String(s));return u.protocol==='https:'?u.href:'';}catch{return '';}};
const number=x=>x===null||x===undefined||x===''?null:Number.isFinite(Number(x))?Number(x):null;
const storage={get(k){try{return localStorage.getItem(k);}catch{return null;}},set(k,v){try{localStorage.setItem(k,v);}catch{}}};
// Stable report keys survive UI releases. Metric-definition changes require an explicit migration.
function validReport(data,field,flag){
  return !!data&&data[flag]===true&&Array.isArray(data[field])&&data[field].every(row=>row&&typeof row==='object'&&!Array.isArray(row))&&
    (field!=='publishers'||data.activity===undefined||Array.isArray(data.activity)&&data.activity.every(row=>row&&typeof row==='object'));
}
function readReportCache(key,field,flag){
  for(const candidate of [key,key+'-last-good']){
    try{const data=JSON.parse(storage.get(candidate));if(validReport(data,field,flag))return data;}catch{}
  }
  return null;
}
// Merge missing measurements only; live status, scope and explicit zero remain authoritative.
function retainCachedStats(data,previous){
  if(!previous)return data;
  let reused=false;
  const metricKeys=['views','likes','reposts','replies','clicks','xViews','xLikes','xShares','xComments','engagementRate','utmPerDollar'];
  const identity=row=>row.code||row.id||row.postUrl||row.trackingUrl;
  function rows(next,old){
    const lookup=new Map((old||[]).filter(r=>identity(r)).map(r=>[identity(r),r]));
    return next.map(row=>{
      const prior=lookup.get(identity(row));if(!prior)return row;
      // Never transfer post readings to a replacement post or clicks to a different link.
      const samePost=!!row.postUrl&&row.postUrl===prior.postUrl;
      const sameLink=!!row.trackingUrl&&row.trackingUrl===prior.trackingUrl&&data.shortIo?.metric===previous.shortIo?.metric;
      const result={...row};let saved=false;
      for(const key of metricKeys){
        if(key==='clicks'){if(!sameLink||((row.postUrl||prior.postUrl)&&!samePost))continue;}else if(!samePost)continue;
        if((row[key]===null||row[key]===undefined||row[key]==='')&&typeof prior[key]==='number'&&Number.isFinite(prior[key])){result[key]=prior[key];saved=true;}
      }
      if(saved){reused=true;result.statsCached=true;
        if(result.clicks>0&&result.paid&&typeof result.cost==='number')result.cpc=result.cost/result.clicks;
        for(const key of ['metricAt','xUpdated','clickAt','clickStartAt'])if(!result[key]&&prior[key])result[key]=prior[key];
      }
      return result;
    });
  }
  const result={...data};
  for(const field of ['placements','publishers','tweets'])if(Array.isArray(data[field]))result[field]=rows(data[field],previous[field]);
  // Click totals from different definitions cannot be mixed.
  if(data.shortIo?.metric&&data.shortIo.metric===previous.shortIo?.metric){
    result.shortIo={...data.shortIo};
    if(Array.isArray(data.shortIo.links)){
      result.shortIo.links=rows(data.shortIo.links,previous.shortIo.links);
      const measured=result.shortIo.links.filter(p=>(data.shortIo.metric!=='humanClicks'||p.attributed)&&typeof p.clicks==='number'&&Number.isFinite(p.clicks));
      result.shortIo.total=measured.length?measured.reduce((sum,p)=>sum+p.clicks,0):null;
      result.shortIo.verified=measured.length;
      result.shortIo.stale=!!data.shortIo.stale||result.shortIo.links.some(p=>p.statsCached);
    }
  }
  if(reused){result.cached=true;result.statsCached=true;}
  return result;
}
function saveReportCache(key,data){
  // Each write is independent: an unavailable/quota-limited browser store must not break rendering.
  const value=JSON.stringify(data);
  storage.set(key+'-last-good',value);
  storage.set(key,value);
}

const ICONS={articles:'<svg viewBox="0 0 24 24"><rect x="5" y="3" width="14" height="18" rx="3"/><path d="M9 8h6m-6 4h6"/></svg>',
  placements:'<svg viewBox="0 0 24 24"><rect x="4" y="4" width="7" height="7" rx="1"/><rect x="13" y="4" width="7" height="7" rx="1"/><rect x="4" y="13" width="7" height="7" rx="1"/><rect x="13" y="13" width="7" height="7" rx="1"/></svg>',
  money:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="2.75" y="5" width="18.5" height="15" rx="2.5"/><path d="M2.75 9h18.5M15.5 13h5.75v4H15.5a2 2 0 0 1 0-4Z"/></svg>', 
  clicks:'<svg viewBox="0 0 24 24"><path d="m10 14 4-4M8 17H7a5 5 0 0 1 0-10h4m5 0h1a5 5 0 0 1 0 10h-4"/></svg>',
  views:'<svg viewBox="0 0 24 24"><path d="M2 12s3-6 10-6 10 6 10 6-3 6-10 6-10-6-10-6Z"/><circle cx="12" cy="12" r="3"/></svg>',
  likes:'<svg viewBox="0 0 24 24"><path d="M20 8c0 5-8 11-8 11S4 13 4 8a4.5 4.5 0 0 1 8-2 4.5 4.5 0 0 1 8 2Z"/></svg>',
  paid:'<svg viewBox="0 0 24 24"><path d="M4 7h16v10H4z"/><path d="M7 10h4M16 12h1"/></svg>'};
const state={placements:[],campaigns:[],history:[],activity:[],activityReady:false,trackingReady:false,
  hourlyEvents:[],hourlyReady:false,owner:'ALL',page:'dashboard',modalCode:'',accountCode:'',modalType:'',lastFocus:null,
  loading:false,initialLoadSettled:false,loadError:false,lastLoadedAt:0,toastTimeout:0,adminKey:'',adminConfigured:false,
  selected:new Set(),pendingEditor:null,homePaidCodes:new Set(),homeVerified:false,dashboardWeek:'all'};
// Main dashboard always shows lifetime source data, regardless of a past
// browser-stored week selection. Historical click charts remain period-specific.
const WEEK_CHOICE_KEYS={dashboardWeek:'xtracker-dashboard-week-choice-v1'};
state.dashboardWeek='all';
function selectLatestNonemptyWeek(){
  const current=currentStatsWeekNumber();
  const recent=state.placements.filter(p=>isLive(p)).map(p=>weeklyTabNumber(p))
    .filter(n=>Number.isInteger(n)&&n>0&&n<=current);
  if(!recent.length)return;
  const last=Math.max(...recent);
  const hasCurrent=recent.includes(current);
  if(!hasCurrent&&storage.get(WEEK_CHOICE_KEYS.dashboardWeek)===null&&state.dashboardWeek==='current'){
    state.dashboardWeek=String(last);
  }
}
const dparts=d=>Object.fromEntries(new Intl.DateTimeFormat('en-GB',{timeZone:TZ,year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(d).filter(x=>x.type!=='literal').map(x=>[x.type,x.value]));
const day=d=>{if(!(d instanceof Date)||Number.isNaN(d.getTime()))return '';const p=dparts(d);return p.year+'-'+p.month+'-'+p.day;};
const shift=(str,n)=>{const [y,m,d]=str.split('-').map(Number);return new Date(Date.UTC(y,m-1,d+n)).toISOString().slice(0,10);};
const weekStart=d=>{const str=day(d),[y,m,a]=str.split('-').map(Number);return shift(str,-((new Date(Date.UTC(y,m-1,a)).getUTCDay()+6)%7));};
const monthStart=d=>day(d).slice(0,7)+'-01';
const validDate=s=>{if(s===null||s===undefined||s==='')return null;const d=new Date(s);return Number.isNaN(d.getTime())?null:d;};
const isBetween=(date,from,to)=>{const d=date?day(date):'';return !from&&!to||Boolean(d&&(!from||d>=from)&&(!to||d<=to));};
function postDate(p){
  if(p.postedAt){const d=validDate(p.postedAt);if(d)return d;}
  const m=String(p.postUrl||'').match(/\/(?:status|statuses)\/(\d{15,22})/i);
  if(!m)return null;
  try{const n=Number((BigInt(m[1])>>22n)+1288834974657n),d=new Date(n);return Number.isFinite(n)&&n>=1262304000000&&n<=Date.now()+86400000?d:null;}catch{return null;}
}
const isLive=p=>p.posted===true&&/^https:\/\/(?:www\.)?(?:x\.com|twitter\.com)\/[^/]+\/status\/\d+/.test(String(p.postUrl||''));
const ARTICLE_NEW_MS=48*60*60*1000;
// Only a precise, trustworthy publication instant qualifies for NEW!.
// X status IDs encode an exact creation timestamp; date-only spreadsheet
// strings are not a reliable timestamp. Keep postDate for existing reports.
function publicationInstant(p){
  if(!isLive(p))return null;
  const m=String(p.postUrl||'').match(/\/(?:status|statuses)\/(\d{15,22})(?:[/?#]|$)/i);
  if(m){try{const n=Number((BigInt(m[1])>>22n)+1288834974657n);
    if(Number.isSafeInteger(n)&&n>=1262304000000&&n<=Date.now()+60000)return n;
  }catch{} }
  const raw=p.postedAt;
  if(typeof raw!=='string'||!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})$/.test(raw))return null;
  const d=validDate(raw);return d&&d.getTime()<=Date.now()+60000?d.getTime():null;
}
const isNew=(p,now=Date.now())=>{const n=publicationInstant(p);return n!==null&&now>=n&&now-n<ARTICLE_NEW_MS;};
const isAged=p=>isLive(p)&&!isNew(p);
const latestPlacementTime=p=>publicationInstant(p)??(isLive(p)?postDate(p)?.getTime()??null:validDate(p.bookedAt)?.getTime()??validDate(p.paidAt)?.getTime()??null);
const articleSortOptions=['recent','clicks','views','priceHigh','priceLow'];
function compareArticles(a,b,mode='recent'){
  const score=(p)=>mode==='recent'?latestPlacementTime(p):mode==='clicks'?clicks(p):mode==='views'?number(p.xViews):number(p.cost);
  const x=score(a),y=score(b);
  if(x===null)return y===null?String(a.code||a.publisher||'').localeCompare(String(b.code||b.publisher||'')):1;
  if(y===null)return -1;
  const direction=mode==='priceLow'?1:-1;
  return (x-y)*direction || (latestPlacementTime(b)??0)-(latestPlacementTime(a)??0) || String(a.code||a.publisher||'').localeCompare(String(b.code||b.publisher||''));
}
const sortedArticles=(rows,mode='recent')=>[...rows].sort((a,b)=>compareArticles(a,b,mode));
const pubDate=p=>{const d=postDate(p);return d?new Intl.DateTimeFormat('en-GB',{day:'numeric',month:'short',year:'numeric',timeZone:TZ}).format(d):'';};
function liveAge(d){if(!d)return '';const n=Math.max(0,Math.floor((Date.now()-d.getTime())/1000));if(n<60)return 'Just live';if(n<3600)return Math.floor(n/60)+'m live';if(n<86400)return Math.floor(n/3600)+'h '+Math.floor(n%3600/60)+'m live';return Math.floor(n/86400)+'d '+Math.floor(n%86400/3600)+'h live';}
const ageMarkup=p=>{const d=postDate(p);return d?`<span data-post-age="${d.getTime()}">${liveAge(d)}</span>`:'';};
const metricTime=p=>{const d=validDate(p.xUpdated);return d?new Intl.DateTimeFormat('en-GB',{day:'numeric',month:'short',hour:'2-digit',minute:'2-digit',timeZone:TZ,timeZoneName:'short'}).format(d):'';};
const metricFullTime=p=>{const d=validDate(p.metricLastVerifiedAt||p.xUpdated);return d?new Intl.DateTimeFormat('en-GB',{day:'numeric',month:'long',year:'numeric',hour:'2-digit',minute:'2-digit',timeZone:TZ,timeZoneName:'short'}).format(d):'';};
const metricBadge=p=>p.metricError&&p.metricLastVerifiedAt?
  `<span class="metric-last-known-note" title="X stats temporarily unavailable. Showing last recorded figures. ${esc(p.metricError)} · Last verified ${esc(metricFullTime(p))}">Saved reading</span>`:'';
const placementPublished=p=>{const d=postDate(p);return d?`Posted ${pubDate(p)}`:(isLive(p)?'Live':'');};
const eligible=()=>state.placements.filter(p=>p.active&&(state.owner==='ALL'||p.owner===state.owner));
const selected=()=>eligible().filter(p=>p.active);
// Dashboard rows follow the selected reporting week from the Sheet.
const selectedDashboardWeek=()=>state.dashboardWeek==='all'?{
  number:'all',from:'0000-01-01',to:day(new Date()),today:day(new Date()),
  isCurrent:true,placements:state.placements.filter(p=>state.owner==='ALL'||p.owner===state.owner)
}:selectedStatsWeek(state.dashboardWeek);
const homePlacements=()=>{
  const scope=selectedDashboardWeek();
  if(scope.isCurrent)return scope.placements;
  const map=weeklyCodeClicks(scope);
  return scope.placements.map(p=>({...p,posted:weeklyLive(p,scope),postUrl:weeklyLive(p,scope)?p.postUrl:'',
    xViews:recordedMetricFor(p,'xViews',scope),xLikes:recordedMetricFor(p,'xLikes',scope),
    clicks:weeklyClicksFor(p,map),countVerified:state.activityReady}));
};
const homeEvents=()=>{const codes=new Set(homePlacements().map(p=>p.code));const {from,to}=selectedDashboardWeek();return state.activity.filter(e=>codes.has(e.code)&&e.date>=from&&e.date<=to);};
const homeClickTotal=()=>state.activityReady?homeEvents().reduce((n,e)=>n+(number(e.clicks)||0),0):null;
const available=p=>p.countVerified===true&&number(p.clicks)!==null;
const clicks=p=>available(p)?number(p.clicks):null;
const ratio=p=>{const c=clicks(p),cost=number(p.cost);return c!==null&&cost!==null&&cost>0&&p.paid?c/cost:null;};
// Shared default across published articles, upcoming placements and modal histories.
// Unknown click counts follow verified zero-click placements; recency is the tie-breaker.
const compareUTMClicks=(a,b)=>{
  const x=clicks(a),y=clicks(b);
  if(x===null)return y===null?String(a.publisher||'').localeCompare(String(b.publisher||'')):1;
  if(y===null)return -1;
  return y-x||(postDate(b)?.getTime()||0)-(postDate(a)?.getTime()||0)||String(a.publisher||'').localeCompare(String(b.publisher||''));
};
const accountKey=p=>[String(p.platform||'X').toLowerCase(),String(p.publisher||'').toLowerCase().replace(/^@/,'')].join('::');
const accountSet=()=>new Set(eligible().map(p=>p.code));
const activity=()=>{const codes=accountSet();return state.activity.filter(e=>codes.has(e.code));};
const countActivity=(start,end,rows=activity())=>rows.reduce((a,x)=>a+(x.date>=start&&x.date<=end?Number(x.clicks)||0:0),0);
// Exact 168-hour rolling count.  Daily click aggregations cannot accurately
// identify a moving 168-hour cutoff; use individual verified event timestamps.
const rollingClicks=(records=eligible(),now=Date.now())=>{
  if(!state.hourlyReady)return null;
  const codes=new Set(records.map(p=>p.code));
  const start=now-168*60*60*1000;
  return state.hourlyEvents.reduce((total,event)=>{
    const ms=Date.parse(event.timestamp);
    return total+(codes.has(event.code)&&Number.isFinite(ms)&&ms>start&&ms<=now?1:0);
  },0);
};
const snapshots=()=>{const codes=accountSet();return state.history.filter(x=>codes.has(x.code)&&x.at);};
const metricNumber=(p,key)=>number(p?.[key]);
function currentMetrics(all=eligible()){
  const now=new Date(),today=day(now),month=monthStart(now),monthPrefix=month.slice(0,7),codes=new Set(all.map(p=>p.code)),rows=activity().filter(e=>codes.has(e.code));
  const cutoff=now.getTime()-168*60*60*1000;
  const thisWeek=all.filter(p=>{const dt=postDate(p);return isLive(p)&&dt&&dt.getTime()>cutoff&&dt.getTime()<=now.getTime();});
  const published=all.filter(p=>isLive(p));
  const views=thisWeek.filter(p=>number(p.xViews)!==null),likes=thisWeek.filter(p=>number(p.xLikes)!==null);
  const paidRows=all.filter(p=>p.paid&&number(p.cost)!==null);
  const currentPaid=paidRows.filter(p=>p.active!==false);
  const datedCurrent=[],undatedCurrent=[];
  for(const p of currentPaid){
    const paidDate=validDate(p.paidAt);
    if(!paidDate){undatedCurrent.push(p);continue;}
    if(day(paidDate).slice(0,7)===monthPrefix)datedCurrent.push(p);
  }
  // A partial set of payment dates cannot verify a monthly total.
  const spendRows=undatedCurrent.length?currentPaid:datedCurrent;
  const monthDollars=spendRows.reduce((sum,p)=>sum+(number(p.cost)||0),0);
  const monthSpendBasis=undatedCurrent.length?'paidFallback':'paidAt';
  return {articles:thisWeek.length,placements:all.length,monthDollars,monthSpendBasis,monthPaidCount:spendRows.length,undatedPaidCount:undatedCurrent.length,
    totalBooked:all.filter(p=>p.active).reduce((s,p)=>s+(number(p.cost)||0),0),
    totalPaid:paidRows.reduce((s,p)=>s+(number(p.cost)||0),0),
    weekClicks:rollingClicks(all,now.getTime()),
    monthClicks:state.activityReady?countActivity(month,today,rows):null,
    allClicks:state.trackingReady?all.reduce((s,p)=>s+(clicks(p)||0),0):null,
    views:views.length?views.reduce((s,p)=>s+Number(p.xViews),0):(thisWeek.length?null:0),
    likes:likes.length?likes.reduce((s,p)=>s+Number(p.xLikes),0):(thisWeek.length?null:0),liveCount:published.length};
}
const metricDefs=(extra,records=eligible())=>{
  const v=currentMetrics(records);return [
    {id:'articles',label:'Articles · last 7 days',value:fmt(v.articles)},
    {id:'money',label:extra?(v.monthSpendBasis==='paidAt'?'Spend this month':'Paid total'):'Paid total',value:money(extra?v.monthDollars:v.totalPaid),badge:`${fmt(extra?v.monthPaidCount:records.filter(p=>p.paid).length)} paid articles`},
    {id:'clicks',label:'Clicks · last 7 days',value:display(v.weekClicks),support:'This month',suppValue:display(v.monthClicks)},
    {id:'views',label:'Views · last 7 days',value:display(v.views)},
    ...(extra?[{id:'likes',label:'Likes · last 7 days',value:display(v.likes)},
      {id:'money',label:'Total $ booked',value:money(v.totalBooked)},
      {id:'clicks',label:'Total Clicks',value:display(v.allClicks)}]:[])
  ];
};
function kpiCard(k){
  // Only the first pending request gets a spinner. Missing/unavailable metrics
  // return to an honest dash after the request settles; never spin forever.
  const value=state.initialLoadSettled?esc(k.value):'<span class="metric-spinner" role="status" aria-label="Loading statistic"></span>';
  const title=String(k.label||'').trim().replace(/[.!?]+\s*$/,'');
  return `<div class="kpi-card metric-${k.id}"><div class="kpi-top"><span class="kpi-label">${esc(title)}</span><span class="kpi-icon" aria-hidden="true">${ICONS[k.id]}</span></div><div class="kpi-value">${value}</div><div class="kpi-bottom">${state.initialLoadSettled&&k.badge?`<span class="kpi-support-badge">${esc(k.badge)}</span>`:''}${k.support?`<span class="kpi-support-note">${esc(k.support)}</span>${state.initialLoadSettled&&k.suppValue?`<strong>${esc(k.suppValue)}</strong>`:''}`:''}</div></div>`;
}
// Correct the known Fanvue Partners publisher assignment without changing
// unrelated explicit campaign IDs or future campaign mappings.
const publisherCampaignOverrides=new Map([['meetyoshi','C002']]);
const publisherKey=publisher=>String(publisher||'').trim().replace(/^@+/,'').toLowerCase();
function effectiveCampaignId(p){
  return publisherCampaignOverrides.get(publisherKey(p.publisher))||String(p.campaignId||'').trim();
}
// Display the explicit campaign mapping, falling back only to the campaign
// code embedded in this placement's tracking ID when no assignment exists.
function campaignLabel(p){
  if(/^OF\d+$/.test(String(p.code||''))&&p.campaignId==='C001')return 'OF Terms X Promo';
  const id=effectiveCampaignId(p);
  if(id&&id!=='UNASSIGNED'){
    const row=state.campaigns.find(c=>String(c.id||'')===id);
    return row&&row.name?String(row.name):id==='C002'?'Fanvue Partners':id;
  }
  const utm=String(p.code||'').match(/^(A\d{2,})-P\d{2,3}$/i);
  return utm?'Campaign '+utm[1].toUpperCase():'Unassigned';
}
// Unified punctuation for dynamic labels: exactly one blue full stop.
const headingHTML=value=>esc(String(value??'').trim().replace(/[.!?]+\s*$/,'').trim())+'<span class="heading-accent">.</span>';
const campaignTag=p=>`<span class="article-campaign-chip">${esc(campaignLabel(p))}</span>`;
const articleUrl=p=>safeUrl(p.articleUrl)||safeUrl(p.postUrl);
// One presentation for Dashboard, Historical and Tracker article cards.
function articleCardContent(p,{live=isLive(p),value=clicks(p),scope=null,tracker=false,promo=false,metricsOverride=null}={}){
  const views=scope?recordedMetricFor(p,'xViews',scope):p.xViews;
  const likes=scope?recordedMetricFor(p,'xLikes',scope):p.xLikes;
  const metrics=metricsOverride||[['clicks',scope?'Week Clicks':'Clicks',value],
    ...(live?[['views','Views',views],['likes','Likes',likes]]:[])];
  return `<span class="article-card-header"><strong class="article-publisher" title="${esc(p.publisher)}">${esc(p.publisher)}</strong><span class="article-card-tags">${live?'<span class="state-pill is-live">POSTED</span>'+(!promo&&isNew(p)?'<span class="new-badge">NEW!</span>':''):`<span class="state-pill">${p.paid?'Paid · Scheduled':'Unpaid · Planned'}</span>`}</span></span>
    <span class="article-card-meta">${campaignTag(p)}${metricBadge(p)}${p.articleLabel&&p.articleLabel!==p.code?`<span title="${esc(p.articleLabel)}">${esc(p.articleLabel)}</span>`:''}<span>${esc(p.code)}</span>${postDate(p)?`<span>${esc(pubDate(p))}</span>`:''}<span>${money(p.cost)}</span>${tracker?`<span>UTM/$ ${fixed(ratio(p))}</span>${p.platform&&p.platform!=='X'?`<span>${esc(p.platform)}</span>`:''}${p.unavailable?'<span class="state-pill is-error">Unavailable</span>':''}`:''}</span>
    <span class="article-kpis">${metrics.map(([kind,label,n])=>`<span class="article-kpi article-kpi-${kind}"><span class="article-kpi-label">${label}</span><strong class="article-kpi-value">${promo&&kind==='spend'?esc(n):display(n)}</strong></span>`).join('')}</span>`;
}
function weeklyCard(p){
  const live=isLive(p),url=live?safeUrl(p.postUrl):articleUrl(p),name=esc(p.publisher);
  const start=url?`<a href="${esc(url)}" target="_blank" rel="noopener noreferrer"`:`<button type="button" data-detail="${esc(p.code)}"`;
  const end=url?'a':'button';
  return `${start} data-placement-code="${esc(p.code)}" data-post-url="${esc(safeUrl(p.postUrl))}" class="article-card week-card ${p.paid?'paid-article':'unpaid-article'} ${live?'live-article':''} ${isNew(p)?'new-article':live?'is-aged':''}" data-home-code="${esc(p.code)}" aria-label="Open ${name} ${live?'live post':'article'}">
    ${articleCardContent(p,{live})}
  </${end}>`;
}
function renderDashboardWeekSelector(){
  // Keep the stable selector elements for existing listeners, but no weekly
  // restriction is applied to the visible main dashboard.
  const select=el('dashboardWeekSelect');
  select.innerHTML='<option value="all">Lifetime · all dates</option>';
  select.value='all';
  el('dashboardWeekRange').textContent='All recorded dates';
  const context=el('dashboardSnapshotContext');
  if(context&&!state.homeVerified)context.textContent='Loading article totals';
}
function renderWeekLabels(){
  renderDashboardWeekSelector();
  el('dashboardTitle').innerHTML='Dashboard<span class="heading-accent">.</span>';
}
function renderWeekly(){if(!legacyView('weeklyGrid'))return;
  const verified=state.homeVerified,placements=homePlacements(),sort=el('homeArticleSort').value;
  const live=sortedArticles(placements.filter(isLive),sort);
  const upcoming=sortedArticles(placements.filter(p=>!isLive(p)),sort);
  el('weeklyCount').textContent=verified?fmt(live.length):'—';
  el('weeklyCount').title='All published X Articles, lifetime';
  el('weeklyGrid').innerHTML=live.length?live.map(weeklyCard).join(''):`<div class="empty-state">${verified?'No live articles yet.':'Live data unavailable.'}</div>`;
  el('upcomingCount').textContent=verified?fmt(upcoming.length):'—';
  el('upcomingGrid').innerHTML=upcoming.length?upcoming.map(weeklyCard).join(''):`<div class="empty-state">${verified?'No scheduled articles.':'Live data unavailable.'}</div>`;
  const meta=el('dashboardArticleMeta');
  if(meta)meta.textContent=verified?`${fmt(live.length)} live · ${fmt(upcoming.length)} scheduled`:'Article status unavailable';
  const upcomingSection=el('upcomingSection');
  if(upcomingSection)upcomingSection.hidden=!verified||upcoming.length===0;
}
// Daily click totals are verified event counts, never estimated from post lifetime counts.
// Article cost is recorded in USD in the source Sheet. Avg. Daily Spend
// measures the average GBP per day over the seven UK calendar days ending today:
// sum(price in USD for paid + published articles in that window) × USD/GBP ÷ 7.
// Payment dates are not required: the user-defined criterion is Paid status
// AND Posted status, with a verified publication date in the window.
function renderKpis(){if(!legacyView('dashboardKpis'))return;
  // X Articles only: all recorded Sheet WEEK placements. Never mix in
  // separately paid GTA VI, OF Terms or Article RT campaigns.
  const placements=state.placements;
  const paid=placements.filter(p=>p.paid===true);
  const knownPaid=paid.filter(p=>number(p.cost)!==null);
  const published=placements.filter(isLive);
  const verifiedViews=published.filter(p=>number(p.xViews)!==null);
  const verifiedClicks=placements.filter(p=>p.countVerified===true&&number(p.clicks)!==null);
  const spend=knownPaid.reduce((sum,p)=>sum+number(p.cost),0);
  const views=verifiedViews.reduce((sum,p)=>sum+number(p.xViews),0);
  const clicksLifetime=verifiedClicks.reduce((sum,p)=>sum+number(p.clicks),0);
  const headline=[
    {id:'money',label:'Spend · all time',value:state.homeVerified?
      (knownPaid.length?money(spend):paid.length?'—':'$0'):'—'},
    {id:'clicks',label:'UTM clicks · all time',value:state.trackingReady?
      (verifiedClicks.length||!placements.length?fmt(clicksLifetime):'—'):'—'},
    {id:'views',label:'X views · all time',value:state.homeVerified?
      (verifiedViews.length?fmt(views):published.length?'—':'0'):'—'},
    {id:'articles',label:'Published posts · all time',value:state.homeVerified?
      fmt(published.length):'—'}
  ];
  el('dashboardKpis').innerHTML=headline.map(kpiCard).join('');
  const context=el('dashboardSnapshotContext');
  if(context&&state.homeVerified){
    const coverage=(paid.length!==knownPaid.length?' · '+fmt(knownPaid.length)+' of '+fmt(paid.length)+' paid costs verified':'')+
      (published.length!==verifiedViews.length?' · '+fmt(verifiedViews.length)+' of '+fmt(published.length)+' X view readings verified':'')+
      (state.trackingReady&&verifiedClicks.length!==placements.length?
        ' · '+fmt(verifiedClicks.length)+' of '+fmt(placements.length)+' click records verified':'');
    context.textContent=fmt(placements.length)+' placements · '+fmt(paid.length)+' paid'+coverage;
  }
}
function notify(s){const t=el('toast');t.textContent=s;t.hidden=false;clearTimeout(state.toastTimeout);state.toastTimeout=setTimeout(()=>t.hidden=true,2800);}
function optionList(records,selected='ALL',allLabel='All campaigns'){
  return `<option value="ALL">${allLabel}</option>`+records.map(x=>`<option value="${esc(x.id)}" ${x.id===selected?'selected':''}>${esc(x.name)}</option>`).join('');
}
function renderCampaignSelectors(){
  for(const id of ['trackerCampaign']){const e=el(id);if(!e)continue;const old=e.value;e.innerHTML=optionList(state.campaigns,old);if([...e.options].some(o=>o.value===old))e.value=old;}
  const e=el('bulkCampaign');if(e){const old=e.value;e.innerHTML='<option value="">Assign campaign</option>'+state.campaigns.map(c=>`<option value="${esc(c.id)}">${esc(c.name)}</option>`).join('');if([...e.options].some(o=>o.value===old))e.value=old;}
}
function filteredPlacements(){
  const q='',stage=el('trackerStatus').value,
    payment=el('trackerPaid').value,article='ALL',platform=el('trackerPlatform').value,campaign=el('trackerCampaign').value;
  const from=el('trackerFrom').value,to=el('trackerTo').value,
    minClicks=number(el('trackerMinClicks').value),minViews=number(el('trackerMinViews').value),maxCost=number(el('trackerMaxCost').value);
  const list=state.placements.filter(p=>p.platform==='X'&&(state.owner==='ALL'||p.owner===state.owner)).filter(p=>{
    if(q&&![p.publisher,p.code,p.articleLabel,p.owner,p.platform,p.campaignId].some(x=>String(x||'').toLocaleLowerCase('en-GB').includes(q)))return false;
    if(stage==='LIVE'&&!isLive(p))return false;
    if(stage==='PLANNED'&&isLive(p))return false;
    if(stage==='UNAVAILABLE'&&!p.unavailable)return false;
    if(payment==='PAID'&&p.paid!==true)return false;
    if(payment==='UNPAID'&&p.paid===true)return false;
    if(article!=='ALL'&&String(p.articleLabel||'')!==article)return false;
    if(platform!=='ALL'&&p.platform!==platform)return false;
    if(campaign!=='ALL'&&effectiveCampaignId(p)!==campaign)return false;
    if(minClicks!==null&&(clicks(p)===null||clicks(p)<minClicks))return false;
    if(minViews!==null&&(number(p.xViews)===null||number(p.xViews)<minViews))return false;
    if(maxCost!==null&&(number(p.cost)===null||number(p.cost)>maxCost))return false;
    if((from||to)&&!isBetween(postDate(p),from,to))return false;
    return true;
  });
  return sortedArticles(list,el('trackerSort').value);
}
function placementCard(p){
  const checked=state.selected.has(p.code),live=isLive(p);
  return `<div class="placement-shell ${live?'is-live':''} ${isNew(p)?'is-new':live?'is-aged':''} ${p.paid?'is-paid':''} ${checked?'is-marked':''}"><label class="placement-select" aria-label="Select ${esc(p.publisher)}"><input type="checkbox" data-select-placement="${esc(p.code)}" ${checked?'checked':''}></label>
    <button type="button" data-placement-code="${esc(p.code)}" data-post-url="${esc(safeUrl(p.postUrl))}" class="article-card tracker-article" data-detail="${esc(p.code)}" aria-label="View ${esc(p.publisher)} placement">${articleCardContent(p,{live,tracker:true})}</button></div>`;
}
function renderTracker(){const list=filteredPlacements(),chosen=state.placements.filter(p=>state.owner==='ALL'||p.owner===state.owner);el('resultCount').textContent=fmt(list.length);
  const paid=chosen.filter(p=>p.paid).reduce((sum,p)=>sum+(number(p.cost)||0),0);
  el('placementsOverview').innerHTML=`<span><strong>${fmt(chosen.length)}</strong> placements</span><span><strong>${display(state.trackingReady?chosen.reduce((sum,p)=>sum+(clicks(p)||0),0):null)}</strong> UTM clicks</span><span><strong>${money(paid)}</strong> paid</span>`;
  const live=list.filter(isLive),upcomingPaid=list.filter(p=>!isLive(p)&&p.paid===true),unpaid=list.filter(p=>!isLive(p)&&p.paid!==true);
  const group=(label,rows,kind)=>rows.length?`<section class="tracker-group tracker-group-${kind}" aria-label="${esc(label)}"><div class="tracker-group-heading"><h3>${esc(label)}<span class="heading-accent">.</span></h3><span class="section-count">${fmt(rows.length)}</span></div><div class="tracker-group-list">${rows.map(placementCard).join('')}</div></section>`:'';
  el('trackerFilterSummary').textContent=list.length===chosen.length?'':`${fmt(list.length)} of ${fmt(chosen.length)} placements`;
  el('trackerFilterSummary').hidden=list.length===chosen.length;
  el('trackerList').innerHTML=list.length?[
    group('Live articles',live,'live'),
    group('Scheduled',upcomingPaid,'upcoming'),
    group('Unpaid · Planned',unpaid,'unpaid')
  ].join(''):'<div class="empty-state">No matching placements.</div>';renderBulk();}
// Historical keeps complete source-week cohorts. Clicks are scoped to the
// recorded UK week; past-week X figures use snapshots at that week's cutoff.
// Never substitute present-day lifetime X counts for a completed week's data.
function renderBulk(){for(const code of [...state.selected])if(!state.placements.some(p=>p.code===code))state.selected.delete(code);
  const n=state.selected.size,bar=el('bulkBar');bar.hidden=n===0;el('bulkCount').textContent=n+' selected';}
function buildAccounts(){
  const records=state.placements.filter(p=>p.platform==='X');const grouped=new Map();
  const from=el('filterAccountFrom').value,to=el('filterAccountTo').value;
  for(const p of records){
    if((from||to)&&!isBetween(postDate(p),from,to))continue;
    const key=accountKey(p),account=grouped.get(key)||{
      key,publisher:p.publisher,platform:p.platform,owner:p.owner,profileUrl:p.profileUrl,
      items:[],clicks:0,clicksKnown:0,spent:0,views:0,viewsKnown:0,likes:0,likesKnown:0,
      comments:0,shares:0,posts:0,lastUsed:null};
    account.items.push(p);if(clicks(p)!==null){account.clicks+=clicks(p);account.clicksKnown++;}
    if(p.paid&&number(p.cost)!==null)account.spent+=Number(p.cost);
    if(isLive(p)){
      account.posts++;if(number(p.xViews)!==null){account.views+=Number(p.xViews);account.viewsKnown++;}
      if(number(p.xLikes)!==null){account.likes+=Number(p.xLikes);account.likesKnown++;}
      account.comments+=number(p.xComments)||0;account.shares+=number(p.xShares)||0;
      const posted=postDate(p);if(posted&&(!account.lastUsed||posted>account.lastUsed))account.lastUsed=posted;
    }
    grouped.set(key,account);
  }
  for(const a of grouped.values()){
    a.clicks=a.clicksKnown?a.clicks:(state.trackingReady?0:null);
    a.utmPerDollar=a.clicks!==null&&a.spent>0?a.clicks/a.spent:null;
    a.views=a.viewsKnown?a.views:(a.posts?null:0);
    a.likes=a.likesKnown?a.likes:(a.posts?null:0);
    a.engagement=a.views!==null&&a.views>0&&a.likes!==null&&a.items.filter(isLive).every(p=>number(p.xComments)!==null&&number(p.xShares)!==null)?100*(a.likes+a.comments+a.shares)/a.views:null;
  }
  return [...grouped.values()];
}
const accountScore=(a,k)=>k==='recent'?a.lastUsed?.getTime()??null:k==='clicks'?a.clicks:k==='views'?a.views:a.spent;
function filteredAccounts(){const q=el('accountSearch').value.trim().toLowerCase(),sort=el('accountSort').value;
  const fields={clicks:'filterClicks',utmPerDollar:'filterUtmDollar',spent:'filterSpent',views:'filterViews',likes:'filterLikes',engagement:'filterEngagement',posts:'filterPosts'};
  const from=el('filterLastUsed').value,to=el('filterLastUsedTo').value;
  return buildAccounts().filter(a=>{
    if(q&&!a.publisher.toLowerCase().includes(q)&&!a.items.some(p=>p.code.toLowerCase().includes(q)))return false;
    if((from||to)&&(!a.lastUsed||!isBetween(a.lastUsed,from,to)))return false;
    return Object.entries(fields).every(([key,id])=>{const v=el(id).value.trim();const n=key==='clicks'?a.clicks:key==='utmPerDollar'?a.utmPerDollar:key==='spent'?a.spent:key==='views'?a.views:key==='likes'?a.likes:key==='engagement'?a.engagement:a.posts;
      return v===''||(n!==null&&Number(n)>=Number(v));});
  }).sort((a,b)=>{const x=accountScore(a,sort),y=accountScore(b,sort);
    if(x===null)return y===null?a.publisher.localeCompare(b.publisher):1;
    if(y===null)return -1;
    return (x-y)*(sort==='priceLow'?1:-1)||(b.lastUsed?.getTime()??0)-(a.lastUsed?.getTime()??0)||a.publisher.localeCompare(b.publisher);
  });
}
function accountCell(a){return [a.publisher,display(a.clicks),fixed(a.utmPerDollar),money(a.spent),display(a.views),display(a.likes),a.engagement===null?'—':fixed(a.engagement)+'%',fmt(a.posts),a.lastUsed?pubDate({postedAt:a.lastUsed.toISOString()}):'—'];}
function renderAccounts(){const all=filteredAccounts();el('accountCount').textContent=fmt(all.length);
  el('accountTableBody').innerHTML=all.length?all.map(a=>{const v=accountCell(a);return `<tr class="account-row" data-account="${esc(a.key)}" tabindex="0" role="button" aria-label="View ${esc(a.publisher)} history">${v.map((s,i)=>`<td${i===1?' class="account-utm"':''}>${esc(s)}</td>`).join('')}</tr>`;}).join(''):'<tr><td colspan="9">No matching accounts</td></tr>';
  el('accountMobileList').innerHTML=all.map(a=>`<button type="button" class="account-mobile-card" data-account="${esc(a.key)}"><span class="account-mobile-top"><strong>${esc(a.publisher)}</strong>${a.platform&&a.platform!=='X'?`<small>${esc(a.platform)}</small>`:''}</span>
    <span class="account-mobile-metrics"><span><strong>${display(a.clicks)}</strong>UTM</span><span><strong>${fixed(a.utmPerDollar)}</strong>UTM/$</span><span><strong>${money(a.spent)}</strong>$</span></span>
    <span class="account-mobile-more"><span>${display(a.views)} views</span><span>${fmt(a.posts)} published</span><span>${a.lastUsed?esc(pubDate({postedAt:a.lastUsed.toISOString()})):'—'}</span></span></button>`).join('')||'<div class="empty-state">No matching accounts.</div>';
}
function summariseCampaign(c){const list=homePlacements().filter(p=>(effectiveCampaignId(p)||p.code.slice(0,3))===c.id);
  const paid=list.filter(p=>p.paid).reduce((n,p)=>n+(number(p.cost)||0),0),booked=list.filter(p=>p.active).reduce((n,p)=>n+(number(p.cost)||0),0);
  const views=list.filter(p=>isLive(p)&&number(p.xViews)!==null),clk=state.trackingReady?list.reduce((n,p)=>n+(clicks(p)||0),0):null;
  return {list,paid,booked,views:views.length?views.reduce((n,p)=>n+Number(p.xViews),0):(list.some(isLive)?null:0),clicks:clk,published:list.filter(isLive).length};
}
// The direct C001 page uses all of its existing placements, across reporting weeks.
function publishedCampaignGroups(){
  const byId=new Map(state.campaigns.filter(c=>c.id!=='C001'&&c.id!=='UNASSIGNED').map(c=>[c.id,{...c,rows:[],clicks:null,paid:0,views:null,recent:0}]));
  const records=state.placements;
  for(const p of records){
    const explicit=effectiveCampaignId(p);
    const utm=String(p.code||'').match(/^([A-Z]\d{2,})-P\d{2,3}$/i);
    const key=explicit&&explicit!=='UNASSIGNED'?explicit:(utm?utm[1].toUpperCase():'UNASSIGNED');
    if(key==='UNASSIGNED')continue; // No trustworthy campaign ID to group by.
    const defined=state.campaigns.find(c=>String(c.id||'')===key);
    const group=byId.get(key)||{id:key,name:defined?.name||'Campaign '+key,brief:defined?.brief||'',rows:[],clicks:null,paid:0,views:null,recent:0};
    group.rows.push(p);
    byId.set(key,group);
  }
  for(const group of byId.values()){
    group.rows.sort((a,b)=>compareArticles(a,b,el('campaignSort').value));
    group.paid=group.rows.filter(p=>p.paid).reduce((sum,p)=>sum+(number(p.cost)||0),0);
    group.clicks=state.trackingReady?group.rows.reduce((sum,p)=>sum+(clicks(p)||0),0):null;
    const views=group.rows.map(p=>number(p.xViews)).filter(n=>n!==null);
    group.views=views.length?views.reduce((sum,n)=>sum+n,0):null;
    group.published=group.rows.filter(isLive).length;
    group.recent=group.rows.reduce((max,p)=>Math.max(max,postDate(p)?.getTime()||0),0);
  }
  return [...byId.values()];
}
function renderCampaigns(){
  const root=el('campaignGrid');
  const opened=new Set([...root.querySelectorAll('details.campaign-accordion[open]')].map(x=>x.dataset.campaignKey));
  const q=el('campaignSearch').value.trim().toLowerCase(),sort=el('campaignSort').value;
  const groups=publishedCampaignGroups().filter(c=>!q||
    [c.id,c.name,...c.rows.flatMap(p=>[p.publisher,p.code,p.articleLabel])].some(x=>String(x||'').toLowerCase().includes(q)));
  const sorter=c=>sort==='recent'?c.recent:sort==='priceHigh'||sort==='priceLow'?c.paid:sort==='views'?c.views:c.clicks;
  groups.sort((a,b)=>{const x=sorter(a),y=sorter(b);
    if(x===null)return y===null?a.name.localeCompare(b.name):1;
    if(y===null)return -1;
    return (x-y)*(sort==='priceLow'?1:-1)||b.recent-a.recent||a.name.localeCompare(b.name);
  });
  if(state.campaignFocus==='C001'&&!groups.length){const c=state.campaigns.find(c=>c.id==='C001');if(c)groups.push({...c,rows:[],paid:0,clicks:state.trackingReady?0:null,views:null,published:0,recent:0});}
  const of=state.ofCampaign;
  if(of?.ready&&(!q||'of terms x promo c001'.includes(q)))groups.push({id:'C001',name:'OF Terms X Promo',rows:of.publishers,paid:of.publishers.filter(p=>p.paid).some(p=>p.cost===null)?null:of.publishers.filter(p=>p.paid).reduce((sum,p)=>sum+p.cost,0),clicks:of.publishers.reduce((sum,p)=>sum+p.clicks,0),of:true});
  const paid=groups.some(c=>c.paid===null)?null:groups.reduce((total,c)=>total+c.paid,0);
  el('campaignsOverview').innerHTML=`<span><strong>${fmt(groups.length)}</strong> ${groups.length===1?'campaign':'campaigns'}</span><span><strong>${money(paid)}</strong> paid ${state.campaignFocus?'in this campaign':'across campaigns'}</span>`;
  root.innerHTML=groups.length?groups.map(c=>c.of?`<a class="campaign-accordion campaign-summary of-campaign-summary" href="#campaign-C001"><span class="campaign-summary-heading"><small>C001 · ${fmt(c.rows.length)} publishers</small><strong class="campaign-name-heading">OF Terms X Promo<span class="heading-accent">.</span></strong></span><span class="campaign-summary-clicks"><strong>${display(c.clicks)}</strong><small>Verified clicks to date</small></span></a>`:`<details class="campaign-accordion" data-campaign-key="${esc(c.id)}" ${opened.has(c.id)||state.campaignFocus===c.id?'open':''}>
    <summary class="campaign-summary" aria-label="${esc(c.name)}, ${fmt(c.rows.length)} placements, expand for details">
      <span class="campaign-summary-heading"><small>${esc(c.id)} <span class="campaign-dot" aria-hidden="true"></span> ${fmt(c.rows.length)} placements</small><strong class="campaign-name-heading">${headingHTML(c.name)}</strong></span>
      <span class="campaign-summary-clicks"><strong>${display(c.clicks)}</strong><small>Clicks</small></span>
      <svg class="campaign-chevron" viewBox="0 0 24 24" aria-hidden="true"><path d="m7 9 5 5 5-5"/></svg>
    </summary>
    <div class="campaign-expanded">
      ${c.brief&&c.brief!=='No brief yet.'?`<p>${esc(c.brief)}</p>`:''}
      <div class="campaign-summary-metrics" aria-label="${esc(c.name)} performance">
        <span><small>Posted</small><strong>${fmt(c.published)}</strong></span>
        <span><small>Paid total</small><strong>${money(c.paid)}</strong></span>
        <span><small>Clicks</small><strong>${display(c.clicks)}</strong></span>
        <span><small>Views recorded</small><strong>${display(c.views)}</strong></span>
      </div>
      <div class="campaign-entries-heading"><h3>Placements<span class="heading-accent">.</span></h3><span class="section-count">${fmt(c.rows.length)}</span></div>
      ${!c.rows.length?'<div class="empty-state">No articles are currently assigned to this campaign.</div>':''}
      <div class="campaign-entries">${c.rows.map(p=>`<button type="button" class="campaign-entry ${isLive(p)?'is-posted':''}" data-detail="${esc(p.code)}" aria-label="View ${esc(p.publisher)} article details">
        <span class="campaign-entry-main"><strong>${esc(p.publisher)}</strong><small>${metricBadge(p)} ${p.articleLabel&&p.articleLabel!==p.code?esc(p.articleLabel)+' · ':''}${esc(p.code)}</small><span class="state-pill ${isLive(p)?'is-live':''}">${isLive(p)?'POSTED':p.paid?'Scheduled':'Planned'}</span></span>
        <span class="campaign-entry-stats"><span><strong>${display(clicks(p))}</strong><small>Clicks</small></span><span><strong>${p.paid?money(p.cost):'Unpaid'}</strong><small>${p.paid?'Paid':'Planned'}</small></span></span>
        <svg class="campaign-entry-chevron" viewBox="0 0 24 24" aria-hidden="true"><path d="m9 5 7 7-7 7"/></svg>
      </button>`).join('')}</div>
    </div>
  </details>`).join(''):'<div class="campaign-empty">No campaigns match.</div>';
}
function newestSnapshotByDay(){
  const list=snapshots().sort((a,b)=>String(a.at).localeCompare(String(b.at))),perDay=new Map();
  for(const x of list){const d=day(validDate(x.at)),k=d+'|'+x.code;if(!d)continue;
    if(x.availability!=='unavailable')perDay.set(k,{...x,date:d,engagements:[x.likes,x.comments,x.shares].every(v=>number(v)!==null)?Number(x.likes)+Number(x.comments)+Number(x.shares):null});
  }return [...perDay.values()].sort((a,b)=>a.date.localeCompare(b.date));
}
function bookedHistory(period){const today=day(new Date());const vals=[];
  const undated=eligible().some(p=>p.paid&&!p.paidAt&&!p.bookedAt);
  if(undated)return Array.from({length:period},(_,i)=>({date:shift(today,i-period+1),value:null}));
  for(let n=period-1;n>=0;n--){const d=shift(today,-n);let known=0,total=0;
    for(const p of eligible()){
      if(!p.paid||number(p.cost)===null)continue;
      const when=validDate(p.paidAt);
      if(when&&day(when)===d){total+=Number(p.cost);known++;}
    }
    vals.push({date:d,value:known?total:0});
  }
  return vals;
}
// Preserve the original historical Week 1 and Week 2 date ranges.
// Keep week numbering calendar-based so the selector rolls over even before
// a new WEEK 2 / WEEK 3 source tab has been created in Google Sheets.
const STATS_WEEK_ONE='2026-10-19';
const weeklyTabNumber=p=>{const m=String(p?.sourceTab||'').match(/^WEEK\s+([1-9]\d*)\s*(?:-|$)/i);return m?Number(m[1]):null;};
// Week 3 is explicitly anchored to 9 November; historical ranges stay intact.
function reportingWeekStart(n){return n<=2?shift(STATS_WEEK_ONE,(n-1)*7):shift('2026-11-09',(n-3)*7);}
function currentStatsWeekNumber(now=new Date()){
  const start=weekStart(now);
  if(start<'2026-11-09')return start<'2026-10-26'?1:2;
  return 3+Math.floor((Date.parse(start+'T12:00:00Z')-Date.parse('2026-11-09T12:00:00Z'))/604800000);
}
function ukMidnight(date){
  const utc=Date.parse(date+'T00:00:00Z');
  return day(new Date(utc-3600000))===date?utc-3600000:utc;
}
let rolloverTimer;
function scheduleWeekRollover(){
  clearTimeout(rolloverTimer);
  const now=new Date(),next=ukMidnight(shift(weekStart(now),7));
  rolloverTimer=setTimeout(()=>{render();scheduleWeekRollover();},Math.min(2147483647,Math.max(1,next-now)));
}
function selectedStatsWeek(selection='current'){
  const current=currentStatsWeekNumber();
  const requested=selection==='current'?current:Math.max(1,Math.min(current,Number(selection)||current));
  const from=reportingWeekStart(requested),to=shift(from,6);
  const today=day(new Date());
  return {number:requested,from,to,today,isCurrent:requested===current,
    placements:state.placements.filter(p=>(state.owner==='ALL'||p.owner===state.owner)&&weeklyTabNumber(p)===requested&&isLive(p))};
}
const scopeEvents=s=>state.activity.filter(e=>e.date>=s.from&&e.date<=s.to&&e.date<=s.today&&s.placements.some(p=>p.code===e.code));
function weeklyCodeClicks(scope){
  const out=new Map();
  if(!state.activityReady)return out;
  for(const e of scopeEvents(scope))out.set(e.code,(out.get(e.code)||0)+(Number(e.clicks)||0));
  return out;
}
const weeklyClicksFor=(p,map)=>state.activityReady?(map.get(p.code)||0):null;
function recordedMetricFor(p,key,scope){
  // The current week can use the latest available live X metric. For a
  // previous week use only a snapshot dated on/before that week ended.
  // During a provider failure the article displays its last verified reading
  // consistently in each report; the attached note identifies the fallback.
  if(p.metricStatus==='last-known-good')return number(p[key]);
  if(scope.isCurrent)return number(p[key]);
  const snapshotKey=key==='xViews'?'views':key==='xLikes'?'likes':key;
  const rows=state.history.filter(x=>x.code===p.code&&x.availability!=='unavailable'&&validDate(x.at)&&day(validDate(x.at))<=scope.to&&number(x[snapshotKey])!==null)
    .sort((a,b)=>String(a.at).localeCompare(String(b.at)));
  return rows.length?number(rows.at(-1)[snapshotKey]):null;
}
const weeklyLive=(p,scope)=>isLive(p)&&Boolean(postDate(p)&&day(postDate(p))<=scope.to&&day(postDate(p))<=scope.today);
const ageStates=new Map();
function tickAges(){
  document.querySelectorAll('[data-post-age]').forEach(t=>{const n=Number(t.dataset.postAge);if(Number.isFinite(n))t.textContent=liveAge(new Date(n));});
  const now=Date.now();let changed=false;
  for(const p of state.placements){const code=String(p.code||''),fresh=isNew(p,now);
    if(!ageStates.has(code)){ageStates.set(code,fresh);continue;}
    if(ageStates.get(code)!==fresh){ageStates.set(code,fresh);changed=true;}
  }
  if(changed){renderWeekly();renderTracker();renderCampaigns();}
}
// Background updates can replace tables before their observer rebuilds them.
// Restore after that frame, provided the reader has not navigated or interacted.
function preserveReadingPosition(update){
  const x=window.scrollX,y=window.scrollY,page=state.page;
  const active=document.activeElement;
  const tableKey=active?.closest('.xt-table-wrap')?.dataset.viewKey;
  const search=active?.matches('.xt-search input')?{key:tableKey,start:active.selectionStart,end:active.selectionEnd}:null;
  let cancelled=false;
  const cancel=()=>{cancelled=true;};
  const events=['wheel','touchstart','pointerdown','keydown'];
  events.forEach(name=>window.addEventListener(name,cancel,{once:true,passive:true}));
  update();
  requestAnimationFrame(()=>requestAnimationFrame(()=>{
    events.forEach(name=>window.removeEventListener(name,cancel));
    if(cancelled||state.page!==page)return;
    if(search){
      const input=Array.from(document.querySelectorAll('.xt-table-wrap')).find(node=>node.dataset.viewKey===search.key)?.querySelector('.xt-search input');
      if(input){input.focus({preventScroll:true});input.setSelectionRange(search.start,search.end);}
    }
    window.scrollTo({left:x,top:y,behavior:'instant'});
  }));
}
function render(){renderOfReport();renderWeekLabels();renderCampaignSelectors();renderWeekly();renderKpis();renderTracker();renderAccounts();renderCampaigns();tickAges();if(state.modalCode)refreshDetails();}
function closeDetails(){if(el('articleModal').hidden)return;el('articleModal').hidden=true;document.body.classList.remove('modal-open');state.modalCode='';state.modalType='';if(state.lastFocus?.isConnected)state.lastFocus.focus();}
function detailsAction(url,label,copy=false){const link=safeUrl(url);if(!link)return '';
  return copy?`<button type="button" class="modal-link" data-copy="${esc(link)}">${esc(label)}</button>`:
    `<a href="${esc(link)}" target="_blank" rel="noopener noreferrer" class="modal-link">${esc(label)} ↗</a>`;
}
function changeSince7(code,key){const rows=state.history.filter(x=>x.code===code&&number(x[key])!==null).sort((a,b)=>String(a.at).localeCompare(String(b.at)));
  const latest=rows.at(-1),cutoff=Date.now()-7*86400000,prior=[...rows].reverse().find(x=>Date.parse(x.at)<=cutoff);
  return !latest||!prior?null:Number(latest[key])-Number(prior[key]);
}
function openDetails(kind,id){state.modalType=kind;state.modalCode=id;state.lastFocus=document.activeElement;
  refreshDetails();el('articleModal').hidden=false;document.body.classList.add('modal-open');el('modalClose').focus();}
function refreshDetails(){
  if(state.modalType==='boost'){showBoostDetails(state.modalCode,false);return;}const id=state.modalCode,kind=state.modalType,body=el('modalBody');
  if(kind==='placement'){
    const p=state.placements.find(p=>p.code===id);if(!p)return;
    el('modalOwner').textContent=esc(p.owner)+' · '+esc(p.code);
    el('articleModal').classList.toggle('modal-is-posted',isLive(p));
    el('articleModal').classList.toggle('modal-is-unposted',!isLive(p));
    const delta=changeSince7(p.code,'views');
    body.innerHTML=`<h2 id="modalTitle" class="modal-title">${headingHTML(p.publisher)}</h2>
      <div class="modal-summary">${campaignTag(p)}<span class="state-pill ${isLive(p)?'is-live':''}">${isLive(p)?'POSTED':p.paid?'Scheduled':'Planned'}</span><span>${esc(p.platform||'X')}</span>${postDate(p)?`<span>${esc(pubDate(p))}</span>`:''}${p.unavailable?'<span class="state-pill is-error">Unavailable</span>':''}${metricBadge(p)}${!p.metricError&&metricTime(p)?`<span>Updated ${esc(metricTime(p))}</span>`:''}</div>
      <div class="modal-primary"><div class="modal-primary-label">Clicks</div><div class="modal-primary-number">${display(clicks(p))}</div></div>
      <div class="modal-metrics"><div class="modal-metric"><span>Views</span><strong>${display(p.xViews)}</strong></div><div class="modal-metric"><span>Likes</span><strong>${display(p.xLikes)}</strong></div><div class="modal-metric"><span>Engagement</span><strong>${number(p.engagementRate)===null?'—':fixed(p.engagementRate)+'%'}</strong></div><div class="modal-metric"><span>UTM/$</span><strong>${fixed(ratio(p))}</strong></div><div class="modal-metric"><span>Price</span><strong>${money(p.cost)}</strong></div><div class="modal-metric"><span>Views Δ7d</span><strong>${delta===null?'—':(delta>=0?'+':'')+fmt(delta)}</strong></div></div>
      <div class="modal-links">${detailsAction(articleUrl(p),'Read article')}${detailsAction(p.postUrl,'View post')}${detailsAction(p.trackingUrl,'Copy UTM link',true)}${detailsAction(p.profileUrl,'Profile')}<button type="button" class="modal-link main-link" data-edit-placement="${esc(p.code)}">Edit</button><button type="button" class="modal-link" data-record-metrics="${esc(p.code)}">Metrics</button></div>`;
  }else if(kind==='account'){
    const a=buildAccounts().find(x=>x.key===id);if(!a)return;
    el('articleModal').classList.remove('modal-is-posted','modal-is-unposted');
    el('modalOwner').textContent=esc(a.platform)+' · '+fmt(a.items.length)+' placements';
    const prices=a.items.filter(x=>number(x.cost)!==null&&(x.paid||x.stage==='booked')).map(x=>Number(x.cost)).sort((a,b)=>a-b);
    const typical=prices.length>=2?money((prices[Math.floor((prices.length-1)/2)]+prices[Math.floor(prices.length/2)])/2):'—';
    const rows=[...a.items].sort(compareUTMClicks);
    body.innerHTML=`<h2 id="modalTitle" class="modal-title">${headingHTML(a.publisher)}</h2><div class="modal-summary">${esc(a.owner)} · ${esc(a.platform)}</div>
      <div class="modal-primary"><div class="modal-primary-label">Clicks</div><div class="modal-primary-number">${display(a.clicks)}</div></div>
      <div class="modal-metrics"><div class="modal-metric"><span>UTM/$</span><strong>${fixed(a.utmPerDollar)}</strong></div><div class="modal-metric"><span>Paid $</span><strong>${money(a.spent)}</strong></div><div class="modal-metric"><span>Views</span><strong>${display(a.views)}</strong></div><div class="modal-metric"><span>Likes</span><strong>${display(a.likes)}</strong></div><div class="modal-metric"><span>Engagement</span><strong>${a.engagement===null?'—':fixed(a.engagement)+'%'}</strong></div><div class="modal-metric"><span>Typical rate</span><strong>${typical}</strong></div></div>
      <h3 class="modal-list-heading">Promotion history<span class="heading-accent">.</span></h3><div class="mini-history">${rows.map(p=>`<button type="button" class="history-row ${isLive(p)?'is-posted':''}" data-detail="${esc(p.code)}"><span>${esc(pubDate(p))}</span><strong>${display(clicks(p))} UTM</strong><span>${money(p.cost)}</span><span>${esc(p.code)}</span><span class="state-pill ${isLive(p)?'is-live':''}">${isLive(p)?'POSTED':p.paid?'Scheduled':'Planned'}</span></button>`).join('')}</div>
      <div class="modal-links">${detailsAction(a.profileUrl,'Open profile')}</div>`;
  }else if(kind==='campaign'){
    const c=state.campaigns.find(c=>c.id===id);if(!c)return;const s=summariseCampaign(c);
    el('articleModal').classList.remove('modal-is-posted','modal-is-unposted');
    el('modalOwner').textContent=esc(c.id)+' · '+fmt(s.list.length)+' placements';
    body.innerHTML=`<h2 id="modalTitle" class="modal-title">${headingHTML(c.name)}</h2><div class="modal-summary"><span>Budget ${money(number(c.budget))}</span>${c.status?`<span>${esc(c.status)}</span>`:''}</div>
      ${c.brief?`<p class="modal-brief">${esc(c.brief)}</p>`:''}
      <div class="modal-primary"><div class="modal-primary-label">Clicks</div><div class="modal-primary-number">${display(s.clicks)}</div></div>
      <div class="modal-metrics"><div class="modal-metric"><span>Paid $</span><strong>${money(s.paid)}</strong></div><div class="modal-metric"><span>Booked $</span><strong>${money(s.booked)}</strong></div><div class="modal-metric"><span>Views</span><strong>${display(s.views)}</strong></div></div>
      <div class="modal-links"><button type="button" class="modal-link main-link" data-new-placement-campaign="${esc(c.id)}">+ Placement</button>${!c.legacy?`<button type="button" class="modal-link" data-edit-campaign="${esc(c.id)}">Edit campaign</button>`:''}</div>
      <h3 class="modal-list-heading">Placements<span class="heading-accent">.</span></h3><div class="mini-history">${[...s.list].sort(compareUTMClicks).map(p=>`<button type="button" class="history-row ${isLive(p)?'is-posted':''}" data-detail="${esc(p.code)}"><span>${esc(p.publisher)}</span><strong>${display(clicks(p))} UTM</strong><span>${money(p.cost)}</span><span>${esc(p.stage||'planned')}</span><span class="state-pill ${isLive(p)?'is-live':''}">${isLive(p)?'POSTED':p.paid?'Scheduled':'Planned'}</span></button>`).join('')||'<div class="empty-state">No placements assigned.</div>'}</div>`;
  }
  tickAges();
}
function closeEditor(){el('editModal').hidden=true;document.body.classList.remove('modal-open');state.pendingEditor=null;settleUnlock(false);}
// The campaign manager reuses this unlock step. The key stays in this closure's memory.
const unlockWaiters=[];
function settleUnlock(ok){for(const waiter of unlockWaiters.splice(0))waiter(ok);}
function requestUnlock(){if(state.adminKey)return Promise.resolve(true);if(!state.adminConfigured){notify('Admin access not configured');return Promise.resolve(false);}
  return new Promise(resolve=>{openEditor('unlockOnly');unlockWaiters.push(resolve);});}
async function registryWrite(body){if(!state.adminKey)return {ok:false,status:401,error:'Editing is locked'};
  const res=await fetch('/.netlify/functions/campaign-registry',{method:'POST',cache:'no-store',headers:{'content-type':'application/json',authorization:'Bearer '+state.adminKey},body:JSON.stringify(body)});
  const data=await res.json().catch(()=>({ok:false,error:'Unrecognised response'}));if(res.status===401)state.adminKey='';return {...data,status:res.status};}
function editField(label,name,type='text',value='',extra=''){return `<label class="form-field"><span>${esc(label)}</span><input name="${esc(name)}" type="${type}" value="${esc(value??'')}" ${extra}></label>`;}
function editSelect(label,name,options,selected){return `<label class="form-field"><span>${esc(label)}</span><select name="${esc(name)}">${options.map(([value,text])=>`<option value="${esc(value)}" ${value===selected?'selected':''}>${esc(text)}</option>`).join('')}</select></label>`;}
const stages=[['planned','Planned'],['contacted','Contacted'],['booked','Booked'],['published','Published']];
const isoForInput=x=>{const d=validDate(x);return d?new Date(d.getTime()-d.getTimezoneOffset()*60000).toISOString().slice(0,16):'';};
const toISO=x=>x?new Date(x).toISOString():'';
function editorHtml(kind,id){
  if(kind==='boost')return boostEditorHtml(id);
  if(kind==='newCampaign')return `<h2 id="editModalTitle" class="modal-title">New campaign<span class="heading-accent">.</span></h2><form id="entityForm" class="edit-form" data-action="newCampaign"><div class="form-grid">${editField('Name','name','text','', 'required maxlength="100"')}${editField('Budget ($)','budget','number','', 'required min="0" step="0.01"')}${editField('Start','startDate','date')}${editField('End','endDate','date')}</div><label class="form-field"><span>Brief</span><textarea name="brief" rows="3" maxlength="700"></textarea></label><button class="button button-primary submit-button" type="submit">Create campaign</button></form>`;
  if(kind==='editCampaign'){
    const c=state.campaigns.find(x=>x.id===id);if(!c)return '';
    return `<h2 id="editModalTitle" class="modal-title">${headingHTML("Edit "+c.name)}</h2><form id="entityForm" class="edit-form" data-action="editCampaign" data-id="${esc(id)}"><div class="form-grid">${editField('Name','name','text',c.name,'required')}${editField('Budget ($)','budget','number',number(c.budget)??'','min="0" step="0.01"')}${editSelect('Status','status',[['active','Active'],['paused','Paused'],['complete','Complete']],c.status||'active')}${editField('Start','startDate','date',c.startDate?.slice(0,10)||'')}${editField('End','endDate','date',c.endDate?.slice(0,10)||'')}</div><label class="form-field"><span>Brief</span><textarea name="brief" rows="3">${esc(c.brief||'')}</textarea></label><button class="button button-primary submit-button" type="submit">Save campaign</button></form>`;
  }
  if(kind==='newPlacement'){
    const names=[...new Map(state.placements.filter(p=>p.platform==='X').map(p=>[p.publisher.toLowerCase(),p.publisher])).values()].sort((a,b)=>a.localeCompare(b));
    const camps=state.campaigns.map(c=>[c.id,c.name]);
    return `<h2 id="editModalTitle" class="modal-title">New placement<span class="heading-accent">.</span></h2><form id="entityForm" class="edit-form" data-action="newPlacement"><div class="form-grid">${editSelect('Existing account','publisher',names.map(s=>[s,s]),names[0]||'')}${editSelect('Campaign','campaignId',camps,id||camps[0]?.[0]||'A01')}${editField('Agreed price ($)','price','number','','required min="0" step="0.01"')}${editSelect('Platform','platform',[['X','X']],'X')}${editSelect('Stage','stage',stages,'planned')}${editField('Profile URL','profileUrl','url','','placeholder="https://x.com/..."')}${editField('Post URL (optional)','postUrl','url','','placeholder="https://..."')}${editField('Live date (optional)','postedAt','datetime-local')}</div><button class="button button-primary submit-button" type="submit">Add placement</button></form>`;
  }
  if(kind==='editPlacement'){
    const p=state.placements.find(x=>x.code===id);if(!p)return '';
    const camps=state.campaigns.map(c=>[c.id,c.name]);
    return `<h2 id="editModalTitle" class="modal-title">${headingHTML("Edit "+p.publisher)}</h2><form id="entityForm" class="edit-form" data-action="editPlacement" data-id="${esc(p.code)}"><div class="form-grid">${editSelect('Stage','stage',stages,p.stage||'planned')}${editSelect('Campaign','campaignId',camps,effectiveCampaignId(p)||p.code.slice(0,3))}${editSelect('Platform','platform',[['X','X']],p.platform||'X')}${editField('Agreed price ($)','price','number',number(p.cost)??'','required min="0" step="0.01"')}${editField('Post URL','postUrl','url',p.postUrl||'')}${editField('Live date','postedAt','datetime-local',isoForInput(p.postedAt))}${editField('Booked date','bookedAt','datetime-local',isoForInput(p.bookedAt))}${editField('Paid date','paidAt','datetime-local',isoForInput(p.paidAt))}</div><div class="edit-checkboxes"><label><input type="checkbox" name="paid" ${p.paid?'checked':''}> Paid</label><label><input type="checkbox" name="posted" ${p.posted?'checked':''}> Published</label></div><button class="button button-primary submit-button" type="submit">Save placement</button></form>`;
  }
  if(kind==='metrics'){
    const p=state.placements.find(x=>x.code===id);if(!p)return '';
    return `<h2 id="editModalTitle" class="modal-title">${headingHTML("Metrics · "+p.publisher)}</h2><form id="entityForm" class="edit-form" data-action="metrics" data-id="${esc(p.code)}"><div class="form-grid">${editField('Views','views','number',number(p.xViews)??'','min="0" step="1"')}${editField('Likes','likes','number',number(p.xLikes)??'','min="0" step="1"')}${editField('Comments','comments','number',number(p.xComments)??'','min="0" step="1"')}${editField('Shares','shares','number',number(p.xShares)??'','min="0" step="1"')}</div><button class="button button-primary submit-button" type="submit">Save metrics</button></form>`;
  }
  return '';
}
function openEditor(kind,id=''){
  if(!state.adminConfigured){notify('Admin access not configured');return;}
  closeDetails();state.pendingEditor={kind,id};el('editModal').hidden=false;document.body.classList.add('modal-open');
  if(!state.adminKey){el('editModalBody').innerHTML=`<h2 id="editModalTitle" class="modal-title">Unlock editing<span class="heading-accent">.</span></h2><form class="edit-form" id="unlockForm"><label class="form-field"><span>Admin key</span><input type="password" name="key" autocomplete="off" required></label><button type="submit" class="button button-primary submit-button">Unlock</button></form>`;}
  else el('editModalBody').innerHTML=editorHtml(kind,id);
  el('editClose').focus();
}
async function adminSend(body,key=state.adminKey){
  const res=await fetch('/.netlify/functions/admin',{method:'POST',cache:'no-store',headers:{'content-type':'application/json','authorization':'Bearer '+key},body:JSON.stringify(body)});
  const data=await res.json().catch(()=>({ok:false,error:'Unrecognised response'}));
  if(!res.ok||!data.ok)throw new Error(data.error||'Admin request failed');return data.result||{};
}
async function onUnlock(form){const key=form.elements.key.value.trim();if(!key)return;
  const button=form.querySelector('button');button.disabled=true;
  try{await adminSend({type:'check'},key);state.adminKey=key;const {kind,id}=state.pendingEditor;globalThis.dispatchEvent?.(new CustomEvent('xtracker:unlocked'));
    if(kind==='unlockOnly'){settleUnlock(true);closeEditor();notify('Editing unlocked');return;}
    el('editModalBody').innerHTML=editorHtml(kind,id);notify('Editing unlocked');}
  catch(e){notify(String(e.message||e));}
  finally{button.disabled=false;}
}
async function onEntity(form){const kind=form.dataset.action,id=form.dataset.id;
  const raw=Object.fromEntries(new FormData(form).entries()),checkbox=(n)=>form.elements[n]?.checked===true;
  const iso=n=>raw[n]?toISO(raw[n]):'';
  let body;
  if(kind==='newCampaign')body={type:'createCampaign',name:raw.name,brief:raw.brief,budget:raw.budget,startDate:raw.startDate,endDate:raw.endDate};
  else if(kind==='editCampaign')body={type:'updateCampaign',id,changes:{name:raw.name,brief:raw.brief,budget:raw.budget,status:raw.status,startDate:raw.startDate,endDate:raw.endDate}};
  else if(kind==='newPlacement')body={type:'createPlacement',publisher:raw.publisher,campaignId:raw.campaignId,price:raw.price,platform:raw.platform,profileUrl:raw.profileUrl,stage:raw.stage,postUrl:raw.postUrl,postedAt:iso('postedAt')};
  else if(kind==='editPlacement')body={type:'updatePlacement',code:id,changes:{stage:raw.stage,campaignId:raw.campaignId,price:raw.price,platform:raw.platform,postUrl:raw.postUrl,paid:checkbox('paid'),posted:checkbox('posted'),postedAt:iso('postedAt'),bookedAt:iso('bookedAt'),paidAt:iso('paidAt')}};
  else if(kind==='metrics')body={type:'recordMetrics',code:id,...Object.fromEntries(['views','likes','comments','shares'].map(k=>[k,raw[k]===''?null:Number(raw[k])]))};
  else return;
  const btn=form.querySelector('[type="submit"]');btn.disabled=true;btn.textContent='Saving…';
  try{await adminSend(body);closeEditor();state.selected.clear();notify('Saved to Google Sheets');await load(true);}
  catch(e){notify(String(e.message||e));btn.disabled=false;btn.textContent='Try again';}
}
async function saveBulk(){const codes=[...state.selected];const changes={};if(el('bulkStage').value)changes.stage=el('bulkStage').value;if(el('bulkCampaign').value)changes.campaignId=el('bulkCampaign').value;
  if(!codes.length||!Object.keys(changes).length){notify('Select a change');return;}
  if(!state.adminConfigured){notify('Admin access not configured');return;}
  if(!state.adminKey){openEditor('newPlacement');notify('Unlock editing, then apply again');return;}
  const btn=el('bulkSave');btn.disabled=true;
  try{await adminSend({type:'bulkUpdate',codes,changes});state.selected.clear();el('bulkStage').value='';el('bulkCampaign').value='';notify('Placements updated');await load(true);}
  catch(e){notify(String(e.message||e));}finally{btn.disabled=false;}
}
function activityFromCsv(text){
  const lines=String(text||'').trim().split(/\r?\n/);
  if(lines[0]?.replaceAll('"','')!=='TIMESTAMP,CODE,CTA')throw new Error('Invalid click feed');
  const map=new Map();for(const line of lines.slice(1)){
    if(!line.trim())continue;
    const fields=line.match(/^"([^"]*)","([^"]*)","([^"]*)"$/)?.slice(1)||line.split(',');
    if(fields.length!==3||!/^A\d{2}-P\d{2,3}$/.test(fields[1]))continue;
    const date=day(validDate(fields[0]));if(!date)continue;
    const key=date+'|'+fields[1],old=map.get(key)||{date,code:fields[1],clicks:0};old.clicks++;map.set(key,old);
  }return [...map.values()];
}
function normaliseActivity(rows){if(!Array.isArray(rows))return [];
  return rows.filter(x=>x&&/^\d{4}-\d{2}-\d{2}$/.test(x.date)&&/^A\d{2}-P\d{2,3}$/.test(x.code)&&number(x.clicks)!==null&&number(x.clicks)>=0)
    .map(x=>({date:x.date,code:x.code,clicks:Number(x.clicks)}));
}
function updateStatus(data=null,error=null){globalThis.dispatchEvent?.(new CustomEvent('xtracker:data'));
  const bar=el('feedWarning');
  const unavailable=Boolean(error)||data?.trackingReady===false;
  bar.hidden=!unavailable;
  bar.textContent=unavailable?(state.trackingReady?'Reporting is temporarily unavailable. Last recorded figures remain visible.':'Reporting is temporarily unavailable. Please try again shortly.'):'';
}
function showXRefreshTime(iso){
  const date=validDate(iso);
  document.querySelectorAll('#xRefreshTime,[data-x-refresh-time]').forEach(node=>node.textContent=date?'Updated: '+new Intl.DateTimeFormat('en-GB',{timeZone:TZ,dateStyle:'medium',timeStyle:'short'}).format(date)+' UK':'Updated: not yet available');
}
function syncXRefreshControls(){
  const source=el('refreshXStats'),status=el('xRefreshStatus');
  document.querySelectorAll('[data-refresh="x"]').forEach(button=>{
    button.disabled=source.disabled;
    button.classList.toggle('is-refreshing',source.disabled);
    if(source.disabled)button.setAttribute('aria-busy','true');else button.removeAttribute('aria-busy');
  });
  document.querySelectorAll('[data-x-refresh-status]').forEach(node=>{node.className=status.className;node.textContent=status.textContent;});
}
async function refreshOfReport(){
  const button=document.querySelector('[data-refresh="of"]')||el('ofRefreshButton'),status=el('ofRefreshStatus');
  if(button.disabled)return;
  button.disabled=true;button.classList.add('is-refreshing');button.setAttribute('aria-busy','true');
  status.className='x-refresh-status';status.textContent='Refreshing X and Short.io stats…';
  try{
    while(state.ofLoading)await new Promise(resolve=>setTimeout(resolve,100));
    if(!await loadOfReport(true,true))throw new Error('Campaign report could not refresh. Last recorded figures remain visible. Please try again.');
    const result=state.ofCampaign;
    status.className='x-refresh-status'+(result.updated>0?' is-success':'');
    status.textContent=result.skipped?'Latest verified X stats shown':result.updated?`Updated ${result.updated} of ${result.total} X posts${result.errors?.length?' · other saved readings retained':''}`:result.total?'X stats unavailable · last verified readings retained':'No published X posts to refresh';
  }catch(error){status.className='x-refresh-status is-error';status.textContent=String(error.message||error);}
  finally{button.disabled=false;button.classList.remove('is-refreshing');button.removeAttribute('aria-busy');}
}
async function refreshXStats(){
  const button=el('refreshXStats'),status=el('xRefreshStatus');
  if(button.disabled)return;
  button.disabled=true;button.classList.add('is-refreshing');button.setAttribute('aria-busy','true');
  status.className='x-refresh-status';status.textContent='Refreshing X and Short.io stats…';syncXRefreshControls();
  try{
    const response=await fetch('/.netlify/functions/dashboard',{method:'POST',cache:'no-store',headers:{accept:'application/json'},signal:AbortSignal.timeout(65000)});
    const result=await response.json().catch(()=>({error:'The refresh service returned an invalid response.'}));
    if(!response.ok)throw new Error(result.error||'X stats refresh failed.');
    while(state.loading)await new Promise(resolve=>setTimeout(resolve,100));
    if(!await load(true))throw new Error('X stats were fetched, but the dashboard could not reload. Please try again.');
    showXRefreshTime(result.lastSuccessfulAt);
    const errs=Array.isArray(result.errors)?result.errors:[];
    result.gonePosts=errs.filter(postGone).length;
    if(!result.ok&&errs.length&&errs.every(postGone))result.ok=true;
    if(result.ok){status.className='x-refresh-status is-success';status.textContent=`Updated ${result.updated} of ${result.total} articles`;}
    else{status.className='x-refresh-status is-error';status.textContent=`Updated ${result.updated} of ${result.total} articles. ${result.errors?.length||0} could not be refreshed; last verified figures remain visible.`;}
    return result;
  }catch(error){status.className='x-refresh-status is-error';status.textContent=error.name==='TimeoutError'?'X stats refresh timed out. Please try again.':String(error.message||error);return {ok:false,error:String(error.message||error)};}
  finally{button.disabled=false;button.classList.remove('is-refreshing');button.removeAttribute('aria-busy');syncXRefreshControls();}
}
async function reloadAllData(onProgress){
  const button=el('reloadAllButton'),status=el('reloadAllStatus');
  if(!button||button.disabled||el('refreshXStats').disabled||gtaState.refreshing)return false;
  button.disabled=true;button.classList.add('is-refreshing');button.setAttribute('aria-busy','true');
  const issues=new Set();let gone=0,completed=0;const total=6;
  status.dataset.summary='';
  const progress=label=>{status.className='x-refresh-status';status.textContent=label;if(typeof onProgress==='function')onProgress({completed,total,label});};
  const settle=async(task,label)=>{
    try{return {status:'fulfilled',value:await task()};}
    catch(reason){return {status:'rejected',reason};}
    finally{completed++;progress(label);}
  };
  const ok=r=>r.status==='fulfilled'&&r.value===true;
  try{
    progress('Refreshing connected sources…');
    // Independent refresh jobs start together. Only dependent report reads wait.
    // refreshXStats already reloads the dashboard; do not fetch it again.
    const xTask=settle(()=>refreshXStats(),'X metrics checked');
    const gtaTask=settle(()=>refreshGtaReport(label=>progress(label)),'GTA VI metrics checked');
    const discordTask=settle(()=>window.XTrackerCampaignReporting?.refreshDiscord?.(true),'Discord sources checked');
    // OF and Boosts metrics are written by the X refresh job; read only afterwards.
    const dependent=xTask.then(()=>Promise.all([
      settle(()=>loadOfReport(true,false),'OF Terms checked'),
      settle(async()=>{await loadBoosts(true);return !boostsState.error;},'Guru RTs checked')
    ]));
    const [xResult,gtaResult,discordResult,[ofResult,boostResult]]=await Promise.all([xTask,gtaTask,discordTask,dependent]);
    const x=xResult.value;
    if(!x?.ok)issues.add('X article metrics');
    if(!x||x.of?.error)issues.add('OF Terms X metrics');
    if(!x||x.boosts?.error)issues.add('X RT metrics');
    if(!ok(ofResult)||state.ofError)issues.add('OF Terms');
    if(!ok(boostResult))issues.add('Guru RTs');
    if(!ok(discordResult))issues.add('Discord');
    const gtaGroups=[gtaState.report,gtaState.report?.originals,gtaState.report?.mandy,gtaState.report?.instagram].filter(Boolean);
    const gtaStatus=gtaGroups.map(gtaSourceStatus).filter(Boolean);
    if(!ok(gtaResult)||gtaState.error||!gtaState.report||gtaStatus.some(g=>g.failed))issues.add('GTA VI metrics');
    gone+=gtaStatus.reduce((n,g)=>n+(g.gone||0),0)+(x?.gonePosts||0);
    // Assemble after the writers finish. Recently fetched reports can be reused;
    // the Article RT spreadsheet still receives its own fresh read.
    progress('Updating campaign summary…');
    const overview=await settle(()=>window.XTrackerCampaignReporting?.reload?.({reuseReports:!issues.size}),'Campaign summary checked');
    if(!ok(overview))issues.add('Campaigns');
    status.className='x-refresh-status '+(issues.size?'is-error':'is-success');
    const goneNote=gone?' '+gone+(gone===1?' post was':' posts were')+' deleted on X; '+(gone===1?'its':'their')+' last verified views are kept.':'';
    status.textContent=issues.size?'Reload finished with partial or unavailable sources: '+[...issues].join(', ')+'. Last verified figures are preserved.'+goneNote:'All connected sources checked and refreshed.'+goneNote;
    status.dataset.summary=issues.size?'Latest available data':'Updated';
    return issues.size===0;
  }catch(error){
    status.className='x-refresh-status is-error';
    status.textContent='Reload could not finish: '+String(error?.message||error)+'. Previously verified figures are preserved.';
    return false;
  }finally{
    button.disabled=false;button.classList.remove('is-refreshing');button.removeAttribute('aria-busy');
  }
}
function applyDashboard(data){
    const signature=JSON.stringify([data.placements,data.campaigns,data.metricHistory,data.clickActivity,data.hourlyEvents,data.homePaidCodes,data.homeVerified,data.trackingReady]);
    const changed=state.dashboardSignature!==signature||state.loadError;state.dashboardSignature=signature;
    state.homeVerified=data.homeVerified===true;
    state.homePaidCodes=new Set(state.homeVerified&&Array.isArray(data.homePaidCodes)?data.homePaidCodes:[]);
    state.placements=data.placements.map(p=>({...p,owner:String(p.owner||'').toUpperCase(),platform:p.platform||'X',
      profileUrl:p.profileUrl||(p.platform==='Instagram'?'https://instagram.com/'+p.publisher:'https://x.com/'+p.publisher)}));
    if(!state.ofCampaign?.ready&&data.ofCampaign?.ready)state.ofCampaign=data.ofCampaign;
    selectLatestNonemptyWeek();
    state.campaigns=Array.isArray(data.campaigns)?data.campaigns:[];
    state.history=Array.isArray(data.metricHistory)?data.metricHistory:[];
    state.trackingReady=data.trackingReady===true;
    state.adminConfigured=data.adminConfigured===true;
    if(Array.isArray(data.clickActivity)&&state.trackingReady){state.activity=normaliseActivity(data.clickActivity);state.activityReady=true;}
    else if(state.trackingReady){state.activityReady=false;}
    else{state.activity=[];state.activityReady=false;}
    // Reuse the verified timestamps already loaded by the dashboard API.
    if(Array.isArray(data.hourlyEvents)){state.hourlyEvents=data.hourlyEvents;state.hourlyReady=state.trackingReady;}

    state.lastLoadedAt=Date.now();state.initialLoadSettled=true;state.loadError=false;state.dashboardMeta={clickCountStartAt:data.clickCountStartAt||null,sheetVerifiedAt:data.sheetVerifiedAt||null,checkedAt:data.checkedAt||null,sourceStatus:data.sourceStatus||'',warning:data.warning||''};updateStatus(data);showXRefreshTime(data.metricAutomation?.lastSuccessfulAt);if(changed)preserveReadingPosition(render);else tickAges();
}
async function loadOfReport(force=false,refreshMetrics=false){
  if(state.ofLoading)return;state.ofLoading=true;
  try{
    const response=await fetch('/.netlify/functions/of-report'+(force?'?refresh=1':''),{method:refreshMetrics?'POST':'GET',cache:'no-store',signal:AbortSignal.timeout(refreshMetrics?65000:30000)});
    const data=await response.json();if(!response.ok||!validReport(data,'publishers','ready'))throw new Error(data.error||'Campaign report unavailable');
    if(!force&&state.ofCampaign?.publishers?.length&&data.publishers.length===0)
      throw new Error('Source temporarily empty; preserving saved OF Terms publishers');
    state.ofError='';state.ofCampaign=retainCachedStats(data,state.ofCampaign);saveReportCache('xtracker-of-cache-v1',state.ofCampaign);
    const verifiedAt=validDate(data.checkedAt||data.cachedAt);
    el('ofRefreshTime').textContent='Updated: '+(verifiedAt?new Intl.DateTimeFormat('en-GB',{timeZone:TZ,dateStyle:'medium',timeStyle:'short'}).format(verifiedAt)+' UK':'not yet available');return true;
  }catch(error){state.ofError='New readings are temporarily unavailable; showing saved figures when available.';if(!state.ofLastLoadedAt)el('ofRefreshTime').textContent='Updated: not yet available';if(!state.ofCampaign?.ready)state.ofCampaign={ready:false,error:'Campaign data temporarily unavailable. Please try again shortly.'};return false;}
  finally{state.ofLoading=false;state.ofSettled=true;state.ofLastLoadedAt=Date.now();preserveReadingPosition(()=>{renderOfReport();if(state.page==='campaigns')renderCampaigns();});}
}
async function load(force=false){if(state.loading)return false;
  state.loading=true;state.lastRefreshAttemptAt=Date.now();
  try{
    const response=await fetch('/.netlify/functions/dashboard'+(force?'?refresh='+Date.now():''),{cache:'no-store',signal:AbortSignal.timeout(30000)});
    const data=await response.json();if(!response.ok||!validReport(data,'placements','ok'))throw new Error(data.error||'Dashboard unavailable');
    // The backend and frontend can briefly have different release numbers after a
    // manual Netlify publish. A forced reload here previously trapped the entire
    // site in a loop and prevented otherwise valid data from rendering.
    if(data.uiVersion&&data.uiVersion!==APP_VERSION){
      console.info('X Tracker frontend/backend versions differ; using compatible live data',APP_VERSION,data.uiVersion);
    }
    if(state.trackingReady&&data.trackingReady===false)throw new Error('Reporting temporarily unavailable');
    // A transiently blank response must not erase the last verified source records.
    const lastGood=readReportCache('xtracker-dashboard-cache-v1','placements','ok');
    if(lastGood?.placements?.length&&data.placements.length===0&&
       (data.homeVerified!==true||data.trackingReady!==true||data.warning||data.sourceStale)){
      throw new Error('Source incomplete; preserving previous dashboard data');
    }
    const merged=retainCachedStats(data,readReportCache('xtracker-dashboard-cache-v1','placements','ok'));applyDashboard(merged);saveReportCache('xtracker-dashboard-cache-v1',merged);return true;
  }catch(e){state.initialLoadSettled=true;state.loadError=true;console.error('Tracker refresh:',String(e.message||e));updateStatus(null,e);
    if(!state.placements.length&&!state.homeVerified)state.hourlyReady=false;
    render();
    if(!state.placements.length&&!state.homeVerified){for(const id of ['weeklyGrid','upcomingGrid','trackerList','accountMobileList','campaignGrid']){const node=el(id);if(node)node.innerHTML='<div class="empty-state">Reporting is temporarily unavailable. Please try again shortly.</div>';}}return false;}
  finally{state.loading=false;}
}
function fiveDayViewHistory(history=[]){
  const cutoff=shift(day(new Date()),-4),latestBySeriesDay=new Map();
  for(const h of history){
    const at=validDate(h?.at),views=number(h?.views),id=String(h?.id||h?.postId||h?.code||'');
    if(!at||views===null||!id)continue;
    const date=day(at);if(date<cutoff)continue;
    const key=date+'|'+id,prior=latestBySeriesDay.get(key);
    if(!prior||at.getTime()>prior.at)latestBySeriesDay.set(key,{
      date,id,views,at:at.getTime(),
      likes:number(h?.likes),
      reposts:number(h?.reposts??h?.shares),
      replies:number(h?.replies??h?.comments)
    });
  }
  const days=new Map();
  const add=(row,key,value)=>{
    if(value===null||value===undefined)return;
    row[key]=(row[key]??0)+Number(value);
  };
  for(const h of latestBySeriesDay.values()){
    const row=days.get(h.date)||{date:h.date,value:0,likes:null,reposts:null,replies:null,series:0};
    row.value+=h.views;row.series++;
    add(row,'likes',h.likes);add(row,'reposts',h.reposts);add(row,'replies',h.replies);
    days.set(h.date,row);
  }
  for(const row of days.values()){
    const parts=[row.likes,row.reposts,row.replies].filter(v=>v!==null);
    row.interactions=parts.length?parts.reduce((a,b)=>a+b,0):null;
    row.engagement=row.value>0&&row.interactions!==null?row.interactions/row.value*100:null;
  }
  return [...days.values()].sort((a,b)=>a.date.localeCompare(b.date)).slice(-5);
}
function renderFiveDayLine(targetId,cardId,rows,{label='Historical trend',suffix='',title='',context=''}={}){
  const card=el(cardId),target=el(targetId);if(!card||!target)return false;
  const clicks=suffix==='clicks';
  const html=window.XTrackerMainChart.markup({rows,title:title||label,context,
    metric:clicks?'Daily clicks':'Total X views',unit:clicks?'clicks':'views',
    note:clicks?'Verified UTM clicks each day. Today is still in progress.':'Total views on posts with saved readings. Includes organic views.'});
  card.hidden=!html;card.classList.add('xt-main-chart');
  // Keep the existing plot ID for refreshes and navigation.
  target.className='';target.innerHTML=html;
  for(const child of [...card.children])if(child!==target)child.remove();
  return !!html;
}
function renderOfReport(){globalThis.dispatchEvent?.(new CustomEvent('xtracker:data'));if(!legacyView('ofMetrics'))return;
  const report=state.ofCampaign,ready=report?.ready===true;
  const today=day(new Date());
  el('ofWeekLabel').textContent='All-time stats';
  el('ofLiveStatus').textContent=ready?'':state.ofSettled?'Data unavailable':'Loading…';
  el('ofLiveStatus').classList.toggle('is-live',ready);
  el('ofReportError').hidden=ready?!(report.warning||state.ofError):!state.ofSettled;
  el('ofReportError').textContent=report?.warning||state.ofError||'Campaign data temporarily unavailable. Please try again shortly.';
  const allPublishers=(ready?report.publishers:[]).map(ofPublisherMetrics);
  const rows=allPublishers.filter(p=>p.posted===true),activity=ready?(report.activity||[]):[];
  const paid=allPublishers.filter(p=>p.paid===true),posted=rows;
  const knownClicks=allPublishers.filter(p=>number(p.clicks)!==null);
  const lifetimeClicks=ready?
    (knownClicks.length?knownClicks.reduce((sum,p)=>sum+number(p.clicks),0):0):null;
  const paidTotal=paid.some(p=>p.cost===null)?null:paid.reduce((sum,p)=>sum+p.cost,0);
  const defs=[['spend','Spend · all time',ready?money(paidTotal):'—',ready?
    `${paid.length} paid · ${paid.length-posted.filter(p=>p.paid).length} not live`:
    'Waiting for verified campaign data'],
    ['seven','X views · all time',gtaNumber(posted.some(p=>number(p.xViews)!==null)?
      posted.reduce((sum,p)=>sum+(number(p.xViews)??0),0):null),
      `${posted.filter(p=>number(p.xViews)!==null).length}/${posted.length} posts measured`],
    ['published','Published posts · all time',ready?fmt(posted.length):'—','Published X posts']];
  const interactions=interactionSummary(posted);
  defs.push(['interactions','Total interactions',gtaNumber(interactions.total),interactions.note]);
  renderEngagement('of',ready?posted:[]);
  defs.push(['shortio','UTM clicks · all time',gtaNumber(lifetimeClicks),
    `${knownClicks.length}/${allPublishers.length} links tracked`]);
  el('ofMetrics').innerHTML=defs.map(([kind,label,value,sub])=>`<${kind==='shortio'?'button type="button" aria-controls="ofPublishers" data-of-clicks':'div'} class="daily-metric daily-metric-${kind}"><span class="daily-metric-label">${esc(label)}</span><strong>${esc(value)}</strong><small>${esc(sub)}</small></${kind==='shortio'?'button':'div'}>`).join('');
  el('ofMetrics').querySelector('[data-of-clicks]')?.addEventListener('click',()=>focusPromoClicks('ofPublishers','Clicks'));

  if(ready){
    const start5=shift(today,-4),historyDates=new Set(activity.filter(e=>e.date>=start5&&e.date<=today).map(e=>e.date));
    const history5=Array.from({length:5},(_,i)=>{const date=shift(start5,i);return {date,value:activity.filter(e=>e.date===date).reduce((sum,e)=>sum+(number(e.clicks)||0),0)};});
    if(historyDates.size>=2)renderFiveDayLine('ofChart','ofTrendCard',history5,{title:'UTM clicks over time',context:'OF Terms',suffix:'clicks'});
    else{el('ofTrendCard').hidden=true;el('ofChart').innerHTML='';}
  }else{el('ofTrendCard').hidden=true;el('ofChart').innerHTML='';}
  const link=(url,label)=>safeUrl(url)?`<a class="button" href="${esc(safeUrl(url))}" target="_blank" rel="noopener noreferrer">${label}</a>`:'';
  const section=(title,publishers)=>`<section class="of-publisher-section"><div class="result-line"><h2>${title}<span class="heading-accent">.</span></h2><span class="section-count">${publishers.length}</span></div><div class="of-publisher-grid">${publishers.map(p=>{
    const live=p.posted===true,url=live?safeUrl(p.postUrl):safeUrl(p.profileUrl);
    const tag=url?'a':'div';
    const attributes=url?` href="${esc(url)}" target="_blank" rel="noopener noreferrer" aria-label="Open ${esc(p.publisher)} ${live?'live X post':'X profile'}"`:'';
    const content=articleCardContent({...p,articleLabel:'X post'},{live,promo:true,
      metricsOverride:[['clicks','Clicks',ready?p.clicks:null],
        ['views','Lifetime X views',p.views??null],
        ['spend','Paid cost',p.paid?money(p.cost):'Unpaid']]});
    const promoMetrics=JSON.stringify({views:p.views??null,likes:p.likes??null,reposts:p.reposts??null,replies:p.replies??null,clicks:p.clicks??null});
    return `<article class="of-publisher-entry"><${tag}${attributes} data-placement-code="${esc(p.code)}" data-post-url="${esc(safeUrl(p.postUrl))}" data-promo-metrics="${esc(promoMetrics)}" class="article-card of-post-card ${live?'live-article of-is-posted':''}">${content}</${tag}><div class="of-publisher-links">${link(p.profileUrl,'X profile')}${link(p.postUrl,'View post')}</div></article>`;
  }).join('')||'<div class="empty-state">No posts in this group.</div>'}</div></section>`;
  el('ofPublishers').innerHTML=ready?section('Published X posts',posted):'';
}
// Only entries visited in this document are eligible for the in-app back control.
// A fresh load (including reload) deliberately starts a new safe history boundary.
const navigationSession=crypto.randomUUID();
let navigationIndex=0;
const navigationEntries=[];
function recordNavigation(hash,updateUrl){
  if(!navigationEntries.length){
    navigationEntries.push(hash);
  }else if(updateUrl&&location.hash!=='#'+hash){
    navigationIndex++;
    navigationEntries.splice(navigationIndex,Infinity,hash);
    history.pushState(null,'','#'+hash);
  }else if(!updateUrl){
    const entry=history.state?.xtrackerNavigation;
    if(entry?.session===navigationSession&&navigationEntries[entry.index]===hash){
      navigationIndex=entry.index;
    }else{
      navigationIndex++;
      navigationEntries.splice(navigationIndex,Infinity,hash);
    }
  }
  history.replaceState({...history.state,xtrackerNavigation:{session:navigationSession,index:navigationIndex}},'','#'+hash);
}
function navigateBack(){
  const entry=history.state?.xtrackerNavigation;
  if(entry?.session===navigationSession&&entry.index===navigationIndex&&navigationIndex>0)history.back();
  else route('dashboard');
}
const defaultPageTitle=document.title;
// XTRACKER_GTA_V1
// GTA VI, reusing the OF Terms report's existing components and styling.
const gtaState={tab:'qrts',report:null,loading:null,lastLoadAt:0,error:'',refreshing:false};
function restoreGtaReport(){
  const saved=readReportCache('xtracker-gta-report-qrts-v1','publishers','ready');
  if(saved?.scope==='published-qrts-v1')return {...saved,cached:true};
  return null;
}
gtaState.report=restoreGtaReport();
const gtaNumber=v=>v===null||v===undefined?'—':fmt(v);
const gtaMoney=v=>v===null||v===undefined?'—':'$'+new Intl.NumberFormat('en-GB',{maximumFractionDigits:2}).format(Number(v));
const gtaCpc=v=>v===null||v===undefined?'—':'$'+Number(v).toFixed(2);
const gtaUKDate=at=>new Intl.DateTimeFormat('en-GB',{timeZone:TZ,dateStyle:'medium',timeStyle:'short'}).format(new Date(at))+' UK';
const gtaSafeLink=(url,label)=>safeUrl(url)?`<a class="button" href="${esc(safeUrl(url))}" target="_blank" rel="noopener noreferrer">${esc(label)}</a>`:'';
function gtaDate(day){return new Intl.DateTimeFormat('en-GB',{timeZone:'UTC',day:'numeric',month:'short',year:'numeric'}).format(new Date(day+'T12:00:00Z'));}
// Sum only complete readings: missing engagement metrics are not zero.
function interactionSummary(rows){
  const measured=rows.filter(p=>['likes','reposts','replies'].every(key=>Number.isFinite(p[key])&&p[key]>=0));
  return {total:measured.length?measured.reduce((sum,p)=>sum+p.likes+p.reposts+p.replies,0):null,
    note:measured.length===rows.length?'Likes + reposts + replies':`${measured.length}/${rows.length} posts measured`};
}
function ofPublisherMetrics(p){
  const measured=state.placements.find(row=>row.code===p.code || (p.postUrl && row.postUrl===p.postUrl))||{};
  return {...measured,...p,views:p.views??measured.xViews,likes:p.likes??measured.xLikes,
    reposts:p.reposts??measured.xShares,replies:p.replies??measured.xComments,
    xViews:p.views??p.xViews??measured.xViews,xLikes:p.likes??p.xLikes??measured.xLikes,
    xShares:p.reposts??p.xShares??measured.xShares,xComments:p.replies??p.xComments??measured.xComments};
}
function engagementSummary(rows){
  const measured=rows.filter(p=>['views','likes','reposts','replies'].every(key=>Number.isFinite(p[key])&&p[key]>=0)&&p.views>0);
  const views=measured.reduce((sum,p)=>sum+p.views,0);
  const interactions=measured.reduce((sum,p)=>sum+p.likes+p.reposts+p.replies,0);
  return {rate:views?interactions/views*100:null,count:measured.length,total:rows.length};
}
function renderEngagement(prefix,rows){
  const summary=engagementSummary(rows);
  el(prefix+'EngagementRate').textContent=summary.rate===null?'—':summary.rate.toFixed(2)+'%';
  el(prefix+'EngagementDetails').textContent=`(Likes + reposts + replies) ÷ views × 100. ${summary.count}/${summary.total} posts have complete X readings.${summary.rate===null?' Waiting for complete figures.':''}`;
}
// Measure the complete sticky navigation, including wrapped mobile rows.
function updatePromoScrollOffset(){
  const header=document.querySelector('.app-header');
  const style=header&&getComputedStyle(header);
  const pinned=style&&(style.position==='sticky'||style.position==='fixed');
  const height=pinned?Math.max(0,header.getBoundingClientRect().height+(parseFloat(style.top)||0)):0;
  const root=document.documentElement;
  root.style.setProperty('--promo-nav-height',`${Math.ceil(height)}px`);
  root.style.setProperty('--promo-scroll-padding',`${parseFloat(getComputedStyle(root).scrollPaddingTop)||0}px`);
  return Math.ceil(height);
}
const promoHeader=document.querySelector('.app-header');
if(promoHeader){
  if(typeof ResizeObserver!=='undefined')new ResizeObserver(updatePromoScrollOffset).observe(promoHeader);
  window.addEventListener('resize',updatePromoScrollOffset,{passive:true});
  updatePromoScrollOffset();
}
function focusPromoClicks(id,label){
  updatePromoScrollOffset();
  const target=el(id),sort=target.querySelector(`button[title="Sort by ${label}"]`);
  if(sort&&sort.closest('th').getAttribute('aria-sort')!=='descending')sort.click();
  for(const table of target.querySelectorAll('.xt-table-scroll'))table.scrollLeft=0;
  // Use document coordinates so root scroll-padding cannot change KPI clearance.
  const top=window.scrollY+target.getBoundingClientRect().top-updatePromoScrollOffset()-24;
  window.scrollTo({top:Math.max(0,top),behavior:window.matchMedia('(prefers-reduced-motion: reduce)').matches?'instant':'smooth'});
  target.focus({preventScroll:true});
}
// A post X reports as not found (deleted or made private by its publisher) is not a refresh failure:
// its last verified reading is kept and it is reported separately as deleted.
function postGone(e){return /not_found|HTTP 404/i.test(String(e?.category||'')+' '+String(e?.error||''));}
function gtaSourceStatus(report){
  const postGone=e=>/not_found|HTTP 404/i.test(String(e?.category||'')+' '+String(e?.error||''));
  const x=report?.xStatus,short=report?.shortIo;
  if(!x)return null;
  const gone=(x.errors||[]).filter(postGone).length,real=(x.errors||[]).filter(e=>!postGone(e)).length;
  const issues=[];
  if(real||x.unverified>gone)issues.push(`${x.retained} saved X readings retained; ${x.unverified} X posts unverified`);
  const linkIssues=Array.isArray(short?.links)&&short.links.length?short.links.some(p=>p.clickError||p.stale||p.publicationStale||(p.attributed&&p.attributionError)):!!(short?.errors||short?.stale);
  if(linkIssues)issues.push('Short.io has saved or incomplete readings');
  if(report?.warning)issues.push('Sheet source unavailable; saved records retained');
  const failed=issues.length>0;
  const text=`X: ${x.updated} of ${x.total} posts · Short.io: ${short?.refreshed||0} of ${short?.linkCount||0} links`+(failed?' · '+issues.join(' · '):' · Latest available readings verified')+(gone?` · ${gone} deleted on X`:'');
  return {failed,text,gone};
}
function renderGtaQuotedSources(){
  const panel=el('gtaQuotedSources');
  if(!panel)return;
  const linked=gtaState.report?.quotedOriginals;
  const rows=Array.isArray(linked?.rows)?linked.rows:[];
  const show=gtaState.tab==='qrts'&&gtaState.report?.ready===true&&rows.length>0;
  panel.hidden=!show;
  if(!show){panel.replaceChildren();return;}
  const summary=linked.summary||{};
  const sourceLink=(url,label)=>{
    const safe=safeUrl(url);
    return safe?'<a href="'+esc(safe)+'" target="_blank" rel="noopener noreferrer">'+esc(label)+'</a>':'';
  };
  const dateLabel=value=>{
    if(!value||!Number.isFinite(Date.parse(value)))return 'Not yet verified';
    return new Intl.DateTimeFormat('en-GB',{timeZone:TZ,day:'numeric',month:'short',
      year:'numeric',hour:'2-digit',minute:'2-digit'}).format(new Date(value))+' UK';
  };
  const entries=rows.map(row=>{
    const complete=[row.likes,row.reposts,row.replies].every(v=>Number.isFinite(v));
    const interactions=complete?row.likes+row.reposts+row.replies:null;
    const engagement=complete&&Number(row.views)>0?
      (interactions/Number(row.views)*100).toFixed(2)+'%':'—';
    const secondary=[
      ['Likes',row.likes],['Reposts',row.reposts],['Replies',row.replies],
      ['Interactions',interactions],['Engagement',engagement],
      ['Post-publication clicks',row.postPublicationClicks]
    ].map(([title,val])=>'<div><dt>'+esc(title)+'</dt><dd>'+
      esc(typeof val==='string'?val:gtaNumber(val))+'</dd></div>').join('');
    const linkedQrts=(row.qrts||[]).map(qrt=>
      '<li class="gta-source-qrt"><strong>@'+esc(qrt.publisher||'Publisher')+'</strong>'+
      '<span>'+esc(gtaNumber(qrt.views))+' views</span>'+
      '<span>'+(qrt.paid?esc(gtaMoney(qrt.cost)):'Payment unverified')+'</span>'+
      '<span>'+esc(gtaNumber(qrt.postPublicationClicks))+' clicks</span>'+
      '<span class="gta-source-qrt-links">'+sourceLink(qrt.postUrl,'Open QRT')+
      (safeUrl(qrt.profileUrl)?' · '+sourceLink(qrt.profileUrl,'Profile'):'')+
      (safeUrl(qrt.trackingUrl)?' · '+sourceLink(qrt.trackingUrl,'Tracking'):'')+
      '</span></li>').join('');
    return '<tr>'+
      '<td><span class="gta-source-handle">@'+esc(row.handle||'X post')+'</span>'+
      sourceLink(row.originalUrl,'View on X')+'</td>'+
      '<td>'+esc(gtaNumber(row.views))+'</td>'+
      '<td>'+esc(gtaNumber(row.qrtViews))+'</td>'+
      '<td>'+esc(gtaMoney(row.paidSpendKnown))+
        (row.unknownPaidCosts?' <small>Partial</small>':'')+'</td>'+
      '<td>'+esc(gtaNumber(row.qrtCount))+'</td>'+
      '<td><details class="gta-source-details" title="Original X updated '+esc(dateLabel(row.metricAt))+'"><summary>Details</summary>'+
      '<div class="gta-source-detail-body">'+
      '<dl class="gta-source-extra-metrics">'+secondary+'</dl>'+
      
      '<h4>Linked paid QRTs</h4>'+
      '<ul>'+linkedQrts+'</ul></div></details></td></tr>';
  }).join('');
  const missing=Number(summary.unmatchedQrts)||0;
  panel.innerHTML=
    '<div class="gta-quoted-header"><div>'+
    '<h2 id="gtaQuotedSourcesTitle">Quoted X posts</h2>'+
    ''+
    '</div><div class="gta-quoted-summary">'+
      '<span><strong>'+esc(gtaNumber(summary.originalPosts))+'</strong> source posts</span>'+
      '<span><strong>'+esc(gtaNumber(summary.matchedQrts))+'</strong> linked QRTs</span>'+
      '</div></div>'+
    (missing?'<p class="gta-quoted-warning">'+esc(gtaNumber(missing))+
      ' published QRTs have no verified original X post link. Their own performance remains tracked below.</p>':'')+
    '<details class="gta-quoted-collapse"><summary>View quoted X post results</summary>'+
    '<div class="gta-quoted-scroll"><table class="gta-quoted-table account-table">'+
      '<thead><tr><th>Original X post</th><th>Original views</th>'+
      '<th>QRT views</th><th>Paid QRT spend</th><th>QRTs</th><th data-no-sort-col="true">Details</th></tr></thead>'+
      '<tbody>'+entries+'</tbody></table></div></details>'+
    '<p class="gta-quoted-footnote">Original and QRT views are separate. Spend is included above.</p>';
}

function renderGtaReport(){globalThis.dispatchEvent?.(new CustomEvent('xtracker:data'));if(!legacyView('gtaMetrics'))return;
  const originals=gtaState.tab==='originals';
  const report=originals?gtaState.report?.originals:gtaState.report,ready=report?.ready===true;
  const placements=ready?(report.publishers||[]).filter(p=>originals?['GTA1','GTA2'].includes(p.campaign):p.campaign==='GTAQ'):[];
  const rows=placements.filter(p=>p.posted===true);
  el('gtaScopeLabel').textContent=originals?'GTA VI · STANDALONE CAMPAIGN POSTS':'GTA VI · PAID QRT PROMOTIONS';
  document.querySelectorAll('[data-gta-tab]').forEach(button=>{
    const active=button.dataset.gtaTab===gtaState.tab;
    button.classList.toggle('is-active',active);button.setAttribute('aria-selected',String(active));button.tabIndex=active?0:-1;
    if(active)el('gtaReportPanel').setAttribute('aria-labelledby',button.id);
  });
  el('gtaWeekLabel').textContent='All-time stats';
  const status=el('gtaLiveStatus');status.textContent=ready?(report.warning?'Saved data':''):gtaState.error?'Data unavailable':'Loading…';
  status.classList.toggle('is-live',ready);
  if(!gtaState.refreshing){const sourceStatus=gtaSourceStatus(report);if(sourceStatus){el('gtaRefreshStatus').textContent=sourceStatus.failed?'Partial data':'';el('gtaRefreshStatus').className='x-refresh-status '+(sourceStatus.failed?'is-error':'is-success');el('gtaRefreshStatus').title=[report.shortIo?.lastSuccessfulAt?'Short.io last successful: '+gtaUKDate(report.shortIo.lastSuccessfulAt):'',report.metricLastSuccessfulAt?'X last verified: '+gtaUKDate(report.metricLastSuccessfulAt):''].filter(Boolean).join(' · ');}}
  const error=el('gtaReportError');const issues=rows.flatMap(p=>[p.clickError,p.metricError].filter(Boolean).map(message=>p.publisher+': '+message));const diagnostics=[gtaState.error,report?.warning,...issues].filter(Boolean);error.hidden=!diagnostics.length;error.innerHTML='<summary>Data issues</summary><p>'+esc(diagnostics.join(' · '))+'</p>';
  const paid=placements.filter(p=>p.paid),posted=rows.filter(p=>p.posted===true&&safeUrl(p.postUrl));
  const gtaHistory=fiveDayViewHistory(report?.history||[]);
  renderFiveDayLine('gtaChart','gtaTrendCard',gtaHistory,{title:originals?'Original post views over time':'QRT views over time',context:originals?'GTA VI · Original posts':'GTA VI · QRTs',suffix:'views'});
  const knownPaid=paid.filter(p=>p.cost!==null&&Number.isFinite(Number(p.cost)));
  const spend=report?.summary?.paidSpend??(ready?knownPaid.reduce((n,p)=>n+Number(p.cost),0):null);
  const seen=posted.filter(p=>p.views!==null&&p.views!==undefined),views=seen.length?seen.reduce((n,p)=>n+Number(p.views),0):null;
  const defs=[['spend',originals?'Paid standalone spend · all time':'Paid QRT spend · all time',gtaMoney(spend),`${knownPaid.length} paid ${originals?'standalone posts':'QRTs'}`],['seven','X views · all time',gtaNumber(views),`${seen.length}/${posted.length} posts measured`],['published',originals?'Published posts · all time':'Published QRTs · all time',ready?fmt(report?.summary?.publishedPosts??posted.length):'—',originals?'Standalone posts':'Paid QRTs']];
  const interactions=interactionSummary(posted);
  defs.push(['interactions','Total Interactions',gtaNumber(interactions.total),interactions.note]);
  renderEngagement('gta',ready?posted:[]);
  const shortIo=report?.shortIo?.metric==='humanClicks'?report.shortIo:null;
  defs.push(['shortio','Short.io clicks · all time',gtaNumber(shortIo?.total),`${shortIo?.verified||0}/${shortIo?.totalPublishers||0} links tracked${shortIo?.stale?' · saved data':''}${shortIo&&shortIo.verified<shortIo.totalPublishers?' · partial':''}`]);
  el('gtaMetrics').innerHTML=defs.map(([kind,label,value,sub])=>`<${kind==='shortio'?'button type="button" aria-controls="gtaPublishers" data-gta-clicks':'div'} class="daily-metric daily-metric-${kind}"><span class="daily-metric-label">${esc(label)}</span><strong>${esc(value)}</strong><small>${esc(sub)}</small></${kind==='shortio'?'button':'div'}>`).join('');
  el('gtaMetrics').querySelector('[data-gta-clicks]')?.addEventListener('click',()=>focusPromoClicks('gtaPublishers','All-time clicks'));
  const section=(title,publishers)=>`<section class="of-publisher-section"><div class="result-line"><h2>${esc(title)}<span class="heading-accent">.</span></h2><span class="section-count">${publishers.length}</span></div><div class="of-publisher-grid">${publishers.map(p=>{
    const live=p.posted===true,link=live?safeUrl(p.postUrl):safeUrl(p.profileUrl);
    const tag=link?'a':'div',attributes=link?` href="${esc(link)}" target="_blank" rel="noopener noreferrer" aria-label="Open ${esc(p.publisher)} ${live?'live X post':'X profile'}"`:'';
    const prepared={...p,articleLabel:p.campaign==='GTAQ'?'GTA VI QRT':p.campaign==='GTA2'?'GTA VI V2 post':'GTA VI post',xViews:p.views,xLikes:p.likes,xComments:p.replies,xShares:p.reposts,xUpdated:p.metricAt||'',metricStatus:p.metricAt?(p.metricError?'last-known-good':'ok'):'unverified',campaignId:p.campaign,platform:'X',active:true};
    const info=articleCardContent(prepared,{live,promo:true,metricsOverride:[['views','X Views',p.views],['likes','Likes',p.likes],['spend','Paid total',p.paid?gtaMoney(p.cost):'Unpaid']]});
    const clickNote=' · Post-publication clicks: '+gtaNumber(p.clicks)+' · All-time human clicks: '+gtaNumber(p.allTimeClicks);

    return `<article class="of-publisher-entry"><${tag}${attributes} data-shortio-tracked="${Boolean(p.trackingUrl&&p.clickTracked!==false)}" data-shortio-clicks="${esc(p.clicks??'')}" data-shortio-cpc="${esc(p.cpc??'')}" data-shortio-note="${esc(p.clickError||clickNote)}" data-placement-code="${esc(p.code)}" data-post-url="${esc(safeUrl(p.postUrl))}" class="article-card of-post-card ${live?'live-article of-is-posted':''}">${info}</${tag}><div class="of-publisher-links">${gtaSafeLink(p.profileUrl,'X profile')}${gtaSafeLink(p.postUrl,'View post')}</div></article>`;
  }).join('')||'<div class="empty-state">No posts in this group.</div>'}</div></section>`;
  el('gtaPublishers').innerHTML=ready?section(originals?'Published standalone posts':'Published QRTs',posted):'<div class="empty-state">GTA VI data is temporarily unavailable.</div>';
  renderGtaQuotedSources();
}
async function loadGtaReport(force=false,{reuse=false}={}){
  if(gtaState.loading)return gtaState.loading;
  if(!force&&Date.now()-gtaState.lastLoadAt<45000&&gtaState.report?.ready)return;
  gtaState.lastLoadAt=Date.now();
  gtaState.loading=(async()=>{
    try{const response=await fetch('/.netlify/functions/gta-report'+(reuse?'?reuse=1':force?'?refresh=1':''),{cache:'no-store',signal:AbortSignal.timeout(30000)}),data=await response.json();
      if(!response.ok||!validReport(data,'publishers','ready'))throw new Error(data.error||'GTA VI report unavailable');
      if(gtaState.report?.publishers?.length&&data.publishers.length===0&&(!force||data.sourceStale))
        throw new Error('Source temporarily empty; preserving saved GTA VI publishers');
      if(data.sourceStale&&gtaState.report?.sourceVerifiedAt&&(!data.sourceVerifiedAt||Date.parse(data.sourceVerifiedAt)<Date.parse(gtaState.report.sourceVerifiedAt)))throw Error('Older source snapshot; preserving verified GTA VI records');
      gtaState.report=data;gtaState.error='';saveReportCache('xtracker-gta-report-qrts-v1',gtaState.report);
    }catch(e){gtaState.error=String(e.message||e);}
    finally{gtaState.loading=null;preserveReadingPosition(renderGtaReport);}
  })();return gtaState.loading;
}
async function refreshGtaReport(onProgress){
  const button=el('gtaRefreshButton'),status=el('gtaRefreshStatus');if(gtaState.refreshing)return;
  gtaState.refreshing=true;button.disabled=true;button.setAttribute('aria-busy','true');button.classList.add('is-refreshing');
  status.className='x-refresh-status';status.textContent='Refreshing X and Short.io stats…';
  const endpoint='/.netlify/functions/gta-report';
  const notify=label=>{if(typeof onProgress==='function')onProgress(label);};
  const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
  // Retrying reads is safe. Never blindly repeat a POST that may already have started a job.
  async function read(url){
    let lastError;
    for(let attempt=0;attempt<3;attempt++){
      try{
        const response=await fetch(url,{cache:'no-store',signal:AbortSignal.timeout(30000)});
        if(!response.ok)throw Object.assign(Error('Refresh data HTTP '+response.status),{permanent:response.status<500&&![408,429].includes(response.status)});
        return await response.json();
      }catch(e){lastError=e;if(e.permanent||attempt===2)throw e;await pause(500*2**attempt);}
    }
    throw lastError;
  }
  try{
    const response=await fetch(endpoint,{method:'POST',cache:'no-store',signal:AbortSignal.timeout(30000)}),initial=await response.json();
    if(!response.ok)throw Error(initial.error||'Refresh could not start');
    let data=initial,job=initial.refresh,jobFailure='';
    if(job){
      const id=job.id,deadline=Date.now()+16*60_000;
      // Poll only the job record, not the workbook, metrics and every Short.io link.
      notify('Refreshing GTA VI and Viral QRTs…');
      while(['queued','running'].includes(job.state)){
        if(Date.now()>=deadline)throw Error('Refresh is still pending; last verified figures retained');
        await pause(3000);
        const result=await read(endpoint+'?status=1');
        if(!result.refresh)throw Error('Refresh status temporarily unavailable');
        job=result.refresh;
        if(job.id!==id)throw Error('Refresh job changed; reload to view the latest verified readings');
      }
      if(job.state==='failed')jobFailure=job.error||'Refresh incomplete';
      notify('Loading verified GTA VI metrics…');
      data=await read(endpoint+'?job='+encodeURIComponent(id));
      data.updated=job.updated??0;data.total=job.total??0;
    }
    if(!validReport(data,'publishers','ready'))throw Error(data.error||'GTA VI metrics unavailable');
    if(data.sourceStale&&gtaState.report?.sourceVerifiedAt&&(!data.sourceVerifiedAt||Date.parse(data.sourceVerifiedAt)<Date.parse(gtaState.report.sourceVerifiedAt)))throw Error('Older source snapshot; preserving verified GTA VI records');
    gtaState.report=data;gtaState.error=jobFailure;saveReportCache('xtracker-gta-report-qrts-v1',data);renderGtaReport();
    const groups=[data,data.originals,data.mandy,data.instagram].filter(Boolean),statuses=groups.map(gtaSourceStatus).filter(Boolean);
    const failed=!!jobFailure||statuses.some(s=>s.failed);
    const active=gtaState.tab==='originals'?data.originals:data,sourceStatus=gtaSourceStatus(active);
    status.className='x-refresh-status '+(failed?'is-error':'is-success');
    status.textContent=failed?[jobFailure,...statuses.filter(s=>s.failed).map(s=>s.text)].filter(Boolean).join(' · '):sourceStatus?.text||'Latest available readings verified';
    if(active?.shortIo?.lastSuccessfulAt)status.title='Short.io last successful: '+gtaUKDate(active.shortIo.lastSuccessfulAt);
    return !failed;
  }catch(e){gtaState.error=String(e.message||e);status.className='x-refresh-status is-error';status.textContent=gtaState.error;return false;}
  finally{gtaState.refreshing=false;button.disabled=false;button.removeAttribute('aria-busy');button.classList.remove('is-refreshing');}
}

function initGtaUi(){
  for(const prefix of ['of','gta'])el(prefix+'EngagementButton').addEventListener('click',()=>{
    const button=el(prefix+'EngagementButton'),expanded=button.getAttribute('aria-expanded')==='true';
    button.setAttribute('aria-expanded',String(!expanded));el(prefix+'EngagementDetails').hidden=expanded;
  });
  setInterval(()=>{if(!document.hidden&&(state.page==='gta-vi'||gtaState.report?.ready))void loadGtaReport();},60000);
  el('gtaRefreshButton').addEventListener('click',refreshGtaReport);
  const gtaTabs=[...document.querySelectorAll('[data-gta-tab]')];
  gtaTabs.forEach((button,index)=>{
    button.addEventListener('click',()=>{gtaState.tab=button.dataset.gtaTab;renderGtaReport();});
    button.addEventListener('keydown',event=>{
      if(!['ArrowLeft','ArrowRight','Home','End'].includes(event.key))return;
      event.preventDefault();
      const next=event.key==='Home'?0:event.key==='End'?gtaTabs.length-1:(index+(event.key==='ArrowRight'?1:-1)+gtaTabs.length)%gtaTabs.length;
      gtaTabs[next].click();gtaTabs[next].focus();
    });
  });
  document.addEventListener('visibilitychange',()=>{if(!document.hidden&&(state.page==='gta-vi'||gtaState.report?.ready))void loadGtaReport();});
}

// Record views (Article tracker, Accounts, Campaigns and promoted-post management) keep
// their existing markup, filters and editors inside the new shell. fanvue-app.js owns
// every other route, the legacy hash mapping and document titles.
const RECORD_PAGES=['placements','accounts','campaigns','x-rts'];
function route(page,updateUrl=true){if(page==='boosted-tweets')page='x-rts';closeDetails();closeEditor();
  const pg=RECORD_PAGES.includes(page)?page:'';state.page=pg||'shell';state.campaignFocus=null;
  document.querySelectorAll('.site-page').forEach(e=>e.hidden=e.id!=='page-'+pg);
  if(!pg){if(updateUrl&&page&&location.hash!=='#'+page)location.hash=page;return;}
  recordNavigation(pg,updateUrl);
  if(pg==='x-rts'){renderBoosts();void loadBoosts();void window.XTrackerCampaignReporting?.ensure?.();}
  if(pg==='campaigns')renderCampaigns();
  window.scrollTo({top:0,behavior:'instant'});
}
function owner(next){state.owner=next;storage.set('xtracker-owner-v4',next);
  document.querySelectorAll('[data-owner]').forEach(b=>{const yes=b.dataset.owner===next;b.classList.toggle('is-selected',yes);b.setAttribute('aria-pressed',String(yes));});render();}
async function copyLink(url){if(!safeUrl(url)){notify('Link unavailable');return;}
  try{await navigator.clipboard.writeText(url);notify('Link copied');}catch{notify('Clipboard unavailable');}
}
function initReorder(){
  const wrap=el('dashboardSections'),valid=['summary','articles','upcoming'];let saved=[];
  try{saved=JSON.parse(storage.get('xtracker-section-order-v5')||'[]');if(!saved.length){const old=JSON.parse(storage.get('xtracker-section-order-v4')||storage.get('xtracker-section-order-v3')||'[]');if(old.length)saved=['summary',...old.filter(x=>x==='articles').flatMap(()=>['articles','upcoming'])];}}catch{}
  for(const name of ['summary',...(valid.every(x=>saved.includes(x))?saved.filter(x=>valid.includes(x)&&x!=='summary'):valid.filter(x=>x!=='summary'))]){const e=wrap.querySelector(`[data-section="${name}"]`);if(e)wrap.appendChild(e);}
  const persist=()=>storage.set('xtracker-section-order-v5',JSON.stringify([...wrap.children].map(x=>x.dataset.section)));
  for(const handle of wrap.querySelectorAll('[data-drag]')){
    const section=handle.closest('[data-section]');let drag=null;
    const begin=()=>{if(!drag)return;drag.active=true;section.classList.add('is-dragging');handle.setAttribute('aria-grabbed','true');};
    const finish=()=>{if(!drag)return;clearTimeout(drag.timer);if(drag.active){section.classList.remove('is-dragging');handle.setAttribute('aria-grabbed','false');persist();}drag=null;};
    handle.addEventListener('pointerdown',e=>{if(e.button!==0||drag)return;drag={id:e.pointerId,startX:e.clientX,startY:e.clientY,active:false,isTouch:e.pointerType==='touch',timer:0};try{handle.setPointerCapture(e.pointerId);}catch{};if(drag.isTouch)drag.timer=setTimeout(begin,340);});
    handle.addEventListener('pointermove',e=>{if(!drag||drag.id!==e.pointerId)return;
      const distance=Math.hypot(e.clientX-drag.startX,e.clientY-drag.startY);
      if(!drag.active){if(drag.isTouch){if(distance>12)finish();return;}if(distance>5)begin();else return;}
      e.preventDefault();const pointed=document.elementFromPoint(e.clientX,e.clientY)?.closest('[data-section]');if(!pointed||pointed===section||pointed.parentElement!==wrap)return;
      const center=pointed.getBoundingClientRect().top+pointed.getBoundingClientRect().height/2;
      if(e.clientY<center)wrap.insertBefore(section,pointed);else wrap.insertBefore(section,pointed.nextSibling);
    });
    handle.addEventListener('pointerup',finish);handle.addEventListener('pointercancel',finish);handle.addEventListener('lostpointercapture',finish);
    handle.addEventListener('keydown',e=>{if(!['ArrowUp','ArrowDown'].includes(e.key))return;e.preventDefault();const other=e.key==='ArrowUp'?section.previousElementSibling:section.nextElementSibling;
      if(other?.matches('[data-section]')){if(e.key==='ArrowUp')wrap.insertBefore(section,other);else wrap.insertBefore(other,section);persist();notify('Order saved');}});
  }
}
function events(){
  document.querySelector('.of-promo-button')?.addEventListener('click',event=>{if(event.button!==0||event.metaKey||event.ctrlKey||event.shiftKey||event.altKey)return;event.preventDefault();route(state.page==='of'?'dashboard':'campaign-C001');});
  el('refreshXStats').addEventListener('click',refreshXStats);
  el('reloadAllButton').addEventListener('click',reloadAllData);
  el('discordRefreshButton').addEventListener('click',async()=>{
    const button=el('discordRefreshButton'),status=el('discordRefreshStatus');
    if(button.disabled)return;
    button.disabled=true;button.setAttribute('aria-busy','true');
    status.textContent='Checking Discord sources…';
    try{
      await Promise.allSettled([window.XTrackerDiscordMembers?.refresh?.(),window.XTrackerDiscordCourse?.refresh?.()]);
      status.textContent='Sources checked · latest available readings shown below';
    }finally{button.disabled=false;button.removeAttribute('aria-busy');}
  });
  document.querySelectorAll('[data-refresh]').forEach(button=>button.addEventListener('click',button.dataset.refresh==='boosts'?refreshBoostStats:button.dataset.refresh==='of'?refreshOfReport:refreshXStats));
  document.querySelectorAll('[data-page]').forEach(b=>b.addEventListener('click',()=>route(b.dataset.page)));
  document.querySelectorAll('[data-owner]').forEach(b=>b.addEventListener('click',()=>owner(b.dataset.owner)));
  el('homeArticleSort').addEventListener('change',renderWeekly);
  el('dashboardWeekSelect').addEventListener('change',e=>{
    state.dashboardWeek=e.target.value;
    storage.set(WEEK_CHOICE_KEYS.dashboardWeek,state.dashboardWeek);
    renderWeekLabels();renderWeekly();renderKpis();
  });
  for(const id of ['trackerStatus','trackerPaid','trackerPlatform','trackerCampaign','trackerSort','trackerFrom','trackerTo','trackerMinClicks','trackerMinViews','trackerMaxCost'])
    el(id).addEventListener(['trackerMinClicks','trackerMinViews','trackerMaxCost'].includes(id)?'input':'change',renderTracker);
  el('resetTrackerFilters').addEventListener('click',()=>{
    for(const id of ['trackerFrom','trackerTo','trackerMinClicks','trackerMinViews','trackerMaxCost'])el(id).value='';
    for(const id of ['trackerStatus','trackerPaid','trackerPlatform','trackerCampaign'])el(id).value='ALL';
    el('trackerSort').value='recent';renderTracker();
  });
  for(const id of ['accountSearch','accountSort','filterClicks','filterUtmDollar','filterSpent','filterViews','filterLikes','filterEngagement','filterPosts','filterLastUsed','filterLastUsedTo','filterAccountFrom','filterAccountTo']){
    const node=el(id);node.addEventListener(node.tagName==='SELECT'?'change':'input',renderAccounts);
  }
  for(const id of ['campaignSearch','campaignSort'])el(id).addEventListener(id==='campaignSearch'?'input':'change',renderCampaigns);
  el('resetAccountFilters').addEventListener('click',()=>{
    document.querySelectorAll('#accountFilters input').forEach(n=>n.value='');
    el('accountSearch').value='';el('accountSort').value='recent';
    renderAccounts();
  });
  el('newCampaignButton').addEventListener('click',()=>openEditor('newCampaign'));
  el('newPlacementButton').addEventListener('click',()=>openEditor('newPlacement'));
  el('bulkSave').addEventListener('click',saveBulk);
  document.body.addEventListener('click',e=>{
    const copy=e.target.closest('[data-copy]');if(copy){copyLink(copy.dataset.copy);return;}
    const detail=e.target.closest('[data-detail]');if(detail){openDetails('placement',detail.dataset.detail);return;}
    const account=e.target.closest('[data-account]');if(account){openDetails('account',account.dataset.account);return;}
    const campaign=e.target.closest('[data-campaign-detail]');if(campaign){openDetails('campaign',campaign.dataset.campaignDetail);return;}
    const editPlacement=e.target.closest('[data-edit-placement]');if(editPlacement){openEditor('editPlacement',editPlacement.dataset.editPlacement);return;}
    const editCampaign=e.target.closest('[data-edit-campaign]');if(editCampaign){openEditor('editCampaign',editCampaign.dataset.editCampaign);return;}
    const place=e.target.closest('[data-new-placement-campaign]');if(place){openEditor('newPlacement',place.dataset.newPlacementCampaign);return;}
    const metrics=e.target.closest('[data-record-metrics]');if(metrics){openEditor('metrics',metrics.dataset.recordMetrics);return;}
  });
  document.body.addEventListener('change',e=>{const ch=e.target.closest('[data-select-placement]');if(!ch)return;
    if(ch.checked)state.selected.add(ch.dataset.selectPlacement);else state.selected.delete(ch.dataset.selectPlacement);renderTracker();});
  document.body.addEventListener('submit',e=>{if(e.target.id==='unlockForm'){e.preventDefault();onUnlock(e.target);}else if(e.target.id==='entityForm'){e.preventDefault();onEntity(e.target);}});
  document.body.addEventListener('keydown',e=>{if((e.key==='Enter'||e.key===' ')&&e.target.matches('.account-row[data-account]')){e.preventDefault();openDetails('account',e.target.dataset.account);}});
  el('modalClose').addEventListener('click',closeDetails);el('editClose').addEventListener('click',closeEditor);
  el('articleModal').addEventListener('click',e=>{if(e.target===el('articleModal'))closeDetails();});
  el('editModal').addEventListener('click',e=>{if(e.target===el('editModal'))closeEditor();});
  document.addEventListener('keydown',e=>{
    if(e.key==='Escape'){if(!el('editModal').hidden)closeEditor();else if(!el('articleModal').hidden)closeDetails();}
    if(e.key==='Tab'){const shade=!el('editModal').hidden?el('editModal'):!el('articleModal').hidden?el('articleModal'):null;if(!shade)return;
      const items=[...shade.querySelectorAll('a[href],input,select,textarea,button:not([disabled])')].filter(x=>x.getClientRects().length>0);
      if(!items.length)return;const first=items[0],last=items.at(-1);if(e.shiftKey&&document.activeElement===first){e.preventDefault();last.focus();}
      if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first.focus();}
    }
  });
  document.querySelectorAll('[data-back]').forEach(button=>button.addEventListener('click',navigateBack));
  window.addEventListener('hashchange',()=>route(location.hash.slice(1),false));
  document.addEventListener('visibilitychange',()=>{if(!document.hidden){scheduleWeekRollover();tickAges();if(Date.now()-(state.lastRefreshAttemptAt||0)>45000)load();if(Date.now()-(state.ofLastLoadedAt||0)>45000)loadOfReport();}});
  setInterval(()=>{if(!document.hidden)tickAges();},15000);
  setInterval(()=>{if(!document.hidden){if(Date.now()-(state.lastRefreshAttemptAt||0)>45000)load();if(Date.now()-(state.ofLastLoadedAt||0)>45000)loadOfReport();}},60000);
}
// The live graph redraws when its available width changes (phone rotation,
// split-screen resizing, returning to the Dashboard), without scaling labels.

// Fit presentation text after rendering, route changes, fonts loading and resizing.
// Values remain complete and retain their original formatting and precision.
const fittedTextSelector=[
  '.article-kpi-value','.kpi-value','.primary-number','.mini-metric strong','.tracker-metric strong',
  '.historical-week-kpi strong','.historical-card-numbers strong',
  '.campaign-summary-clicks strong','.campaign-entry-stats strong',
  '.campaign-summary-metrics strong','.account-mobile-metrics strong',
  '.daily-metric strong','.daily-projection strong','.modal-primary-number',
  '.modal-metric strong','.kpi-label','.daily-metric-label',
  '.historical-week-kpi > span','.article-campaign-chip','.article-kpi-label'
].join(',');
let textFitPending=false;
function scheduleTextFit(){
  if(textFitPending)return;
  textFitPending=true;
  requestAnimationFrame(()=>{
    textFitPending=false;
    document.querySelectorAll(fittedTextSelector).forEach(value=>{
      if(!value.getClientRects().length)return;
      value.style.removeProperty('font-size');
      const base=parseFloat(getComputedStyle(value).fontSize);
      const available=value.clientWidth;
      if(!base||!available)return;
      let size=base;
      for(let attempt=0;attempt<4&&value.scrollWidth>available+1;attempt++){
        size=Math.max(9,size*available/value.scrollWidth*.94);
        value.style.setProperty('font-size',size+'px','important');
      }
    });
  });
}
new MutationObserver(scheduleTextFit).observe(document.body,{
  subtree:true,childList:true,characterData:true,attributes:true,attributeFilter:['hidden']
});
window.addEventListener('resize',scheduleTextFit,{passive:true});
window.addEventListener('resize',()=>{if(state.page==='of')renderOfReport();},{passive:true});
if(document.fonts?.ready)document.fonts.ready.then(scheduleTextFit);
scheduleTextFit();
const boostsState={tweets:[],loaded:false,loading:null,lastLoad:0,error:''};
try{const saved=readReportCache('xtracker-boosts-v1','tweets','ok');if(saved){boostsState.tweets=saved.tweets;boostsState.loaded=true;}}catch{}
const boostNumber=v=>v===null||v===undefined?'—':fmt(v);
const boostMoney=v=>v===null||v===undefined?'—':new Intl.NumberFormat('en-US',{style:'currency',currency:'USD',maximumFractionDigits:2}).format(v);
const boostPercent=v=>v===null||v===undefined?'—':Number(v).toFixed(2)+'%';
const boostDate=at=>new Intl.DateTimeFormat('en-GB',{timeZone:TZ,dateStyle:'medium',timeStyle:'short'}).format(new Date(at))+' UK';
const boostURL=t=>'https://x.com/'+t.handle+'/status/'+t.id;
// XTRACKER_RT_REFRESH_FIX_V1
function updateBoostCooldown(data){
  if(data){
    const epoch=v=>typeof v==='string'?Date.parse(v):Number(v);
    const next=epoch(data.nextRefreshAt),remoteNow=epoch(data.serverNow);
    const remaining=Number.isFinite(next)&&Number.isFinite(remoteNow)?next-remoteNow:Number(data.retryAfter)*1000;
    if(Number.isFinite(remaining))boostsState.refreshAvailableAt=Date.now()+Math.max(0,remaining);
  }
  clearTimeout(boostsState.cooldownTimer);
  const secs=Math.max(0,Math.ceil(((boostsState.refreshAvailableAt||0)-Date.now())/1000));
  const button=document.querySelector('[data-refresh="boosts"]');
  if(button)button.disabled=Boolean(boostsState.refreshing);
  const cooldown=el('boostRefreshCooldown');
  if(cooldown)cooldown.textContent=secs?`New X readings available in ${Math.floor(secs/60)}:${String(secs%60).padStart(2,'0')}`:'';
  if(secs)boostsState.cooldownTimer=setTimeout(()=>updateBoostCooldown(),1000);
}
async function refreshBoostStats(){
  const button=document.querySelector('[data-refresh="boosts"]'),status=el('boostRefreshStatus');
  if(!button||!status||boostsState.refreshing)return;
  boostsState.refreshing=true;button.disabled=true;button.classList.add('is-refreshing');button.setAttribute('aria-busy','true');
  status.className='x-refresh-status';status.textContent='Checking X stats…';
  try{
    if(boostsState.loading)await boostsState.loading;
    // This branch deliberately makes a safe GET only, never an unnecessary paid provider request.
    if(Date.now()<(boostsState.refreshAvailableAt||0)){
      await loadBoosts(true);
      status.className='x-refresh-status';status.textContent='Latest saved X readings shown';
      return;
    }
    const response=await fetch('/.netlify/functions/boosts',{method:'POST',cache:'no-store',signal:AbortSignal.timeout(45000)});
    const result=await response.json().catch(()=>({error:'Invalid refresh response'}));
    updateBoostCooldown(result);
    if(response.status===429||result.skipped===true||result.refreshReason==='cooldown'){
      // A recent successful server refresh is not an error. Do not claim a new fetch occurred.
      await loadBoosts(true);
      status.className='x-refresh-status';status.textContent='Latest saved X readings shown';
      return;
    }
    if(!response.ok&&!(Number(result.updated)>0&&Array.isArray(result.tweets)))throw new Error(result.error||'X provider refresh failed');
    if(!Array.isArray(result.tweets)&&!(Number(result.updated)>0))throw new Error(result.error||'X provider returned no new measurements');
    // Reload from the actual server source of truth so all KPI, table and modal state agrees.
    await loadBoosts(true);
    const updated=Number(result.updated)||0,total=Number(result.total)||boostsState.tweets.length;
    if(!updated){status.className='x-refresh-status';status.textContent='No new readings available';}
    else if(total&&updated<total){status.className='x-refresh-status';status.textContent=`Updated ${updated} of ${total} tweets · other saved readings retained`;}
    else{status.className='x-refresh-status is-success';status.textContent='X stats updated';}
  }catch(e){
    // Always retain cached metrics and show an accurate failure only when a real request failed.
    status.className='x-refresh-status is-error';
    status.textContent=e?.name==='TimeoutError'?'Refresh timed out · saved X stats preserved':String(e.message||e);
    try{await loadBoosts(true);}catch{}
  }finally{
    boostsState.refreshing=false;button.classList.remove('is-refreshing');button.removeAttribute('aria-busy');
    updateBoostCooldown();
  }
}

async function loadBoosts(force=false){
  if(boostsState.loading){if(!force)return boostsState.loading;await boostsState.loading;}
  if(!force&&Date.now()-boostsState.lastLoad<60000)return;
  boostsState.lastLoad=Date.now();
  boostsState.loading=(async()=>{try{
    const r=await fetch('/.netlify/functions/boosts',{cache:'no-store',signal:AbortSignal.timeout(15000)}),data=await r.json();
    if(!r.ok||!validReport(data,'tweets','ok'))throw new Error('Saved readings are temporarily unavailable');
    if(!force&&boostsState.loaded&&boostsState.tweets.length&&data.tweets.length===0)
      throw new Error('Source temporarily empty; preserving saved X boost records');
    updateBoostCooldown(data);
    const changed=JSON.stringify(boostsState.tweets)!==JSON.stringify(data.tweets)||!boostsState.loaded||Boolean(boostsState.error);
    const merged=retainCachedStats(data,{tweets:boostsState.tweets});boostsState.tweets=merged.tweets;boostsState.loaded=true;boostsState.error='';saveReportCache('xtracker-boosts-v1',merged);
    if(changed){renderBoosts();if(state.modalType==='boost')showBoostDetails(state.modalCode,false);}
  }catch{if(!boostsState.error){boostsState.error='Saved readings are temporarily unavailable';renderBoosts();}}
  finally{boostsState.loading=null;}})();
  return boostsState.loading;
}
function renderBoosts(){
  const campaigns=window.XTrackerCampaignReporting;
  const guru=campaigns?.getCampaign?.('guru-rts');
  const article=campaigns?.getCampaign?.('article-rts');
  const groups=guru?.articleRtGroups||article?.articleRtGroups||[];
  const byOriginal=new Map(groups.map(g=>[String(g.postId),g]));
  const rtSummary=guru?.articleRtSummary||article?.articleRtSummary;
  // Each boosted X original can be linked to paid RT placements; boost spend
  // itself is a *different* source and remains missing unless explicitly paid.
  const rows=boostsState.tweets.map(t=>{
    const group=byOriginal.get(String(t.id));
    return {...t,rtSpend:group?.paidSpendKnown??null,rtCount:group?.paidCount??null};
  });
  const rtStrip=el('boostPaidRtSummary');
  if(rtStrip){
    if(rtSummary){
      const waiting=Number(rtSummary.unlinkedPaidCount)||0;
      rtStrip.textContent='Paid RTs: '+boostMoney(rtSummary.paidSpendKnown)+' · '+
        fmt(rtSummary.paidCount)+' accounts · '+
        boostMoney(rtSummary.linkedPaidSpendKnown)+' matched'+
        (waiting?' · '+boostMoney(rtSummary.unlinkedPaidSpendKnown)+
          ' missing source links ('+fmt(waiting)+')':'')+
        '. Ad boost costs are separate.';
      rtStrip.classList.remove('is-pending');
    }else{
      rtStrip.textContent=campaigns?.getCampaign?
        'Paid RT data unavailable · saved X stats shown':'Loading paid RT data…';
      rtStrip.classList.add('is-pending');
    }
  }
  const known=rows.filter(t=>Number.isFinite(t.spend)),seen=rows.filter(t=>t.views!==null&&t.views!==undefined),spend=known.length?known.reduce((s,t)=>s+t.spend,0):null;
  const views=seen.length?seen.reduce((s,t)=>s+t.views,0):null;
  const matched=known.filter(t=>t.views>0),eff=known.length&&matched.length===known.length?1000*matched.reduce((s,t)=>s+t.spend,0)/matched.reduce((s,t)=>s+t.views,0):null;
  const interactions=interactionSummary(rows);
  el('boostKpis').innerHTML=[['Known ad boost spend · all time',boostMoney(spend),`${known.length}/${rows.length} costs entered`],['Original X views · all time',boostNumber(views),`${seen.length}/${rows.length} views tracked`],['Ad cost / 1K original views',eff===null?'—':boostMoney(eff),'Boost spend ÷ views'],['Original interactions · all time',boostNumber(interactions.total),interactions.note]].map(([label,value,note],i)=>`<div class="daily-metric daily-metric-${['spend','seven','click','interactions'][i]}"><span class="daily-metric-label">${label}</span><strong>${value}</strong><small>${note}</small></div>`).join('');
  el('boostStatus').textContent=boostsState.error?(boostsState.loaded?'Saved stats · refresh unavailable':'Data unavailable'):boostsState.loaded?'':'Loading…';
  const sort=el('boostSort').value,field={spend:'spend',rtSpend:'rtSpend',views:'views',engagement:'engagement',efficiency:'efficiency'}[sort];
  rows.sort((a,b)=>{if(!field)return new Date(b.added_at)-new Date(a.added_at)||b.id.localeCompare(a.id);const x=a[field],y=b[field];return x==null?(y==null?0:1):y==null?-1:sort==='efficiency'?x-y:y-x;});
  const values=t=>[boostMoney(t.spend),boostMoney(t.rtSpend),t.rtCount==null?'—':boostNumber(t.rtCount),boostNumber(t.views),boostNumber(t.likes),boostNumber(t.reposts),boostNumber(t.replies),boostPercent(t.engagement),t.efficiency==null?'—':boostMoney(t.efficiency),t.growth24==null?'Not enough history':boostNumber(t.growth24)];
  el('boostRows').innerHTML=rows.map(t=>`<tr class="account-row" data-boost="${esc(t.id)}" tabindex="0" role="button" aria-label="View ${esc(t.name)} tweet"><td><strong>${esc(t.name)}</strong><br><small>@${esc(t.handle)}</small></td>${values(t).map(v=>`<td>${esc(v)}</td>`).join('')}</tr>`).join('')||`<tr><td colspan="11">${boostsState.loaded?'No boosted tweets.':boostsState.error?'Saved records could not be loaded.':'Loading saved tweets…'}</td></tr>`;
  const labels=['Actual ad boost spend','Paid RT spend','Paid RT accounts','Original X views','Original likes','Original reposts','Original replies','Original engagement rate','Ad cost / 1K views','Original views gained · 24h'];
  el('boostMobile').innerHTML=rows.map(t=>`<button class="account-mobile-card" data-boost="${esc(t.id)}"><span class="account-mobile-top"><strong>${esc(t.name)}</strong><small>@${esc(t.handle)}</small></span><span class="boost-card-metrics">${values(t).map((v,i)=>`<span><strong>${esc(v)}</strong><small>${labels[i]}</small></span>`).join('')}</span></button>`).join('');
}
function boostChart(t){
  const samples=(t.history||[]).filter(s=>s.views!=null);if(samples.length<2)return '<p class="empty-state">Not enough history</p>';
  const times=samples.map(s=>new Date(s.at).getTime()),vals=samples.map(s=>s.views),min=Math.min(...vals),range=Math.max(...vals)-min||1,span=times.at(-1)-times[0]||1;
  const points=samples.map((s,i)=>`${30+640*(times[i]-times[0])/span},${180-150*(s.views-min)/range}`).join(' ');
  const dots=samples.map((s,i)=>{
    const interactions=[number(s.likes),number(s.reposts),number(s.replies)].filter(v=>v!==null);
    const totalInteractions=interactions.length?interactions.reduce((a,b)=>a+b,0):null;
    const engagement=Number(s.views)>0&&totalInteractions!==null?totalInteractions/Number(s.views)*100:null;
    const metrics=[
      {label:'Views',value:fmt(s.views)},
      ...(number(s.likes)!==null?[{label:'Likes',value:fmt(s.likes)}]:[]),
      ...(number(s.reposts)!==null?[{label:'Reposts',value:fmt(s.reposts)}]:[]),
      ...(number(s.replies)!==null?[{label:'Replies',value:fmt(s.replies)}]:[]),
      ...(totalInteractions!==null?[{label:'Interactions',value:fmt(totalInteractions)}]:[]),
      ...(engagement!==null?[{label:'Engagement',value:engagement.toFixed(2)+'%'}]:[])
    ];
    return `<circle cx="${30+640*(times[i]-times[0])/span}" cy="${180-150*(s.views-min)/range}" r="4.5" fill="var(--blue)" tabindex="0" role="button" data-chart-point data-chart-title="${esc(t.name||'X RT history')}" data-chart-date="${esc(boostDate(s.at))}" data-chart-metrics="${encodeURIComponent(JSON.stringify(metrics))}" aria-label="${esc(boostDate(s.at)+': '+fmt(s.views)+' views. Hover or focus for details.')}"><title>${esc(boostDate(s.at))}: ${fmt(s.views)} views</title></circle>`;
  }).join('');
  return `<svg class="boost-chart" viewBox="0 0 700 210" role="img" aria-label="Public X views over time"><polyline points="${points}" fill="none" stroke="var(--blue)" stroke-width="3"/>${dots}</svg><p>${esc(boostDate(samples[0].at))} — ${esc(boostDate(samples.at(-1).at))}</p>`;
}
function showBoostDetails(id,focus=true){
  const t=boostsState.tweets.find(t=>t.id===id);if(!t)return;
  const signature=JSON.stringify(t);
  if(!focus&&boostsState.detailSignature===signature&&!el('articleModal').hidden)return;
  boostsState.detailSignature=signature;
  if(focus)state.lastFocus=document.activeElement;
  state.modalType='boost';state.modalCode=id;
  el('modalOwner').textContent='Original X tweet';el('articleModal').classList.remove('modal-is-posted','modal-is-unposted');
  const group=window.XTrackerCampaignReporting?.getCampaign?.('guru-rts')?.articleRtGroups?.find(g=>String(g.postId)===String(t.id));
  const metrics=[['Actual ad boost spend',boostMoney(t.spend)],
    ['Paid RT spend (Google Sheets)',boostMoney(group?.paidSpendKnown)],
    ['Paid RT accounts',group?.paidCount==null?'—':boostNumber(group.paidCount)],
    ['Original X views',boostNumber(t.views)],['Original likes',boostNumber(t.likes)],
    ['Original reposts',boostNumber(t.reposts)],['Original replies',boostNumber(t.replies)],
    ['Original engagement rate',boostPercent(t.engagement)],
    ['Ad cost / 1K original views',t.efficiency==null?'—':boostMoney(t.efficiency)],
    ['24-hour view growth',t.growth24==null?'Not enough history':boostNumber(t.growth24)],
    ['7-day view growth',t.growth7==null?'Not enough history':boostNumber(t.growth7)]];
  el('modalBody').innerHTML=`<h2 class="modal-title" id="modalTitle">${esc(t.name)}<span class="heading-accent">.</span></h2><p>@${esc(t.handle)}</p><div class="modal-links"><a class="button" href="${esc(boostURL(t))}" target="_blank" rel="noopener noreferrer">Original X post</a><button class="button" data-boost-edit="${esc(id)}">Edit tweet / spend</button></div><p class="boost-text">${esc(t.tweet_text||'Tweet text is currently unavailable.')}</p><div class="modal-metrics">${metrics.map(([label,val])=>`<div class="modal-metric"><span>${label}</span><strong>${esc(val)}</strong></div>`).join('')}</div><p>X metrics updated: ${t.at?esc(boostDate(t.at)):'—'}</p>${t.error?`<p role="status">${esc(t.error)}</p>`:''}<h3>Views over time</h3>${boostChart(t)}<p>Public views include organic traffic. Unknown costs are excluded from spending totals.</p>`;
  el('articleModal').hidden=false;document.body.classList.add('modal-open');if(focus)el('modalClose').focus();
}
function boostEditorHtml(id){
  const t=boostsState.tweets.find(t=>t.id===id);
  return `<h2 class="modal-title" id="editModalTitle">${t?'Edit Post':'Add Post'}<span class="heading-accent">.</span></h2><form class="edit-form" id="boostForm" data-id="${esc(id||'')}">${t?`${editField('Original account name','name','text',t.name,'required maxlength="100"')}${editField('Total actual boost spend (USD)','spend','number',t.spend??'','min="0" max="999999999999.99" step="0.01"')}<p>Leave blank when unknown. Enter the combined amount actually paid to amplify this tweet.</p>`:editField('Original X status URL','url','url','','required placeholder="https://x.com/handle/status/…"')}<button class="button button-primary" type="submit">${t?'Save changes':'Add Tweet'}</button>${t?'<button class="button" type="button" id="boostRemove">Remove tweet</button><label id="boostRemoveConfirm" hidden><input name="confirmRemoval" type="checkbox"> Confirm removal from X RTs</label>':''}<p id="boostFormStatus" role="status"></p></form>`;
}
async function saveBoostForm(form,remove=false){
  const raw=Object.fromEntries(new FormData(form)),id=form.dataset.id,btn=form.querySelector('[type="submit"]');btn.disabled=true;
  try{await adminSend(remove?{type:'boostRemove',id}:id?{type:'boostUpdate',id,name:raw.name,spend:raw.spend}:{type:'boostAdd',url:raw.url});closeEditor();await loadBoosts(true);notify('X RTs saved');}
  catch(e){const status=el('boostFormStatus');if(status)status.textContent=e.message;else notify('Changes saved; showing last loaded figures.');}finally{btn.disabled=false;}
}
function initBoosts(){
  el('boostSort').addEventListener('change',renderBoosts);
  window.addEventListener('xtracker:campaign-overview',()=>{
    if(state.page==='x-rts')renderBoosts();
  });
  el('boostAdd').addEventListener('click',()=>openEditor('boost',''));
  document.addEventListener('click',e=>{const row=e.target.closest('[data-boost]');if(row)showBoostDetails(row.dataset.boost);const edit=e.target.closest('[data-boost-edit]');if(edit)openEditor('boost',edit.dataset.boostEdit);if(e.target.id==='boostRemove'){const label=el('boostRemoveConfirm');label.hidden=false;if(label.querySelector('input').checked)void saveBoostForm(el('boostForm'),true);else el('boostFormStatus').textContent='Confirm removal, then press Remove tweet again.';}});
  document.addEventListener('keydown',e=>{if(['Enter',' '].includes(e.key)&&e.target.matches('tr[data-boost]')){e.preventDefault();showBoostDetails(e.target.dataset.boost);}});
  document.addEventListener('submit',e=>{if(e.target.id==='boostForm'){e.preventDefault();void saveBoostForm(e.target);}});
  document.addEventListener('visibilitychange',()=>{if(!document.hidden&&(state.page==='x-rts'||boostsState.loaded))void loadBoosts();});
  setInterval(()=>{if(!document.hidden&&(state.page==='x-rts'||boostsState.loaded))void loadBoosts();},60000);
  renderBoosts();
}
initReorder();events();initBoosts();initGtaUi();
renderWeekLabels();scheduleWeekRollover();renderKpis();
try{const cached=readReportCache('xtracker-dashboard-cache-v1','placements','ok');if(cached?.ok&&Array.isArray(cached.placements))applyDashboard({...cached,cached:true});}catch{}
try{const cached=readReportCache('xtracker-of-cache-v1','publishers','ready');if(cached?.ready)state.ofCampaign={...cached,cached:true};}catch{}
route(location.hash.slice(1),false);load();if(!state.ofLoading)loadOfReport();
// Read-only bridge for the redesigned shell: the existing adapters' verified state and
// the existing refresh and editor actions. It adds no new requests or data writes.
window.XTrackerApp=Object.freeze({
  dashboard:()=>({placements:state.placements,campaigns:state.campaigns,history:state.history,activity:state.activity,
    activityReady:state.activityReady,trackingReady:state.trackingReady,checkedAt:state.dashboardMeta?.checkedAt,adminConfigured:state.adminConfigured,
    loading:state.loading,loadError:state.loadError,settled:state.initialLoadSettled,raw:state.dashboardMeta||null}),
  of:()=>({report:state.ofCampaign||null,error:state.ofError||'',loading:Boolean(state.ofLoading)}),
  gta:()=>({report:gtaState.report,error:gtaState.error,loading:Boolean(gtaState.loading),refreshing:gtaState.refreshing}),
  boosts:()=>({tweets:boostsState.tweets,loaded:boostsState.loaded,error:boostsState.error}),
  load:force=>load(force),loadOf:force=>loadOfReport(force),loadGta:force=>loadGtaReport(force),loadBoosts:force=>loadBoosts(force),
  syncVerifiedRefresh:async scopes=>{
    const pause=ms=>new Promise(r=>setTimeout(r,ms));
    const waitUntilIdle=async busy=>{const until=Date.now()+15000;while(busy()&&Date.now()<until)await pause(100);return !busy();};
    const tasks=[];
    if(scopes.includes('x'))tasks.push((async()=>{if(!await waitUntilIdle(()=>state.loading))return false;return load(false);})());
    if(scopes.includes('of'))tasks.push((async()=>{if(!await waitUntilIdle(()=>state.ofLoading))return false;return loadOfReport(false,false);})());
    if(scopes.includes('gta'))tasks.push((async()=>{if(gtaState.loading)await gtaState.loading;await loadGtaReport(true,{reuse:true});return !gtaState.error&&!!gtaState.report?.ready;})());
    if(scopes.includes('boosts'))tasks.push((async()=>{await loadBoosts(true);return !boostsState.error&&boostsState.loaded;})());
    return (await Promise.allSettled(tasks)).every(r=>r.status==='fulfilled'&&r.value===true);
  },
  refresh:Object.freeze({all:reloadAllData,x:refreshXStats,of:refreshOfReport,gta:refreshGtaReport,boosts:refreshBoostStats}),
  status:id=>{const node=el(id);return {text:node.textContent||'',summary:node.dataset?.summary||'',error:node.classList.contains('is-error')};},
  showRecords:page=>route(page||'',false),
  openEditor:(kind,id)=>openEditor(kind,id),
  isUnlocked:()=>Boolean(state.adminKey),
  requestUnlock,
  registryWrite
});
})();

