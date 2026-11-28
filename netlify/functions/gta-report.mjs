/**
 * GTA VI campaign report, independent from OF Terms and article tracking.
 * Uses the existing promotion spreadsheet, ExcelJS and Netlify Blobs.
 * GET reads verified source/cached metrics; POST performs a throttled manual X fetch.
 * Historical metrics never reset on provider errors. No synthetic UTM clicks.
 */
import ExcelJS from 'exceljs';
import {paymentDay,paymentDetailsDate,confirmedPayment,confirmedPlan} from '../lib/payment-dates.mjs';
import {createHash} from 'node:crypto';
import {summarisePlacements} from '../lib/placement-reporting.mjs';
import {getStore} from '@netlify/blobs';
import {campaignLinkClicks,trackingLink} from '../lib/gta-shortio.mjs';
import {readGtaXMetric,gtaMetricStatus} from '../lib/gta-x-metrics.mjs';
import {seed,seedVerifiedAt} from '../lib/gta-seed.mjs';
import {summariseQuotedOriginals} from '../lib/quoted-originals.mjs';

const SHEET_ID='1D8rI3BuuFHIemYZY92QFiHDMkj876F8oiwpDR6sMiTE';
// Every GTA VI source tab, identified by its permanent Google Sheets tab ID (gid). The first three
// are required; the others are read when present. The xlsx export carries no gids, so a tab is found
// by its current name, then any earlier name, then its stable "X Accounts NN" prefix, and finally,
// only if all of those fail, by matching the tab's own CSV export (fetched by gid) to a sheet.
// A new GTA VI campaign tab is added here and to GROUPS.
const SOURCE_TABS=[
  {id:'GTAQ',gid:1636113127,name:'X Accounts 15 (GTA VI QRTs)'},
  {id:'GTA1',gid:274433746,name:'X Accounts 12 (GTA)'},
  {id:'GTA2',gid:1074485134,name:'X Accounts 14 (GTA VI V2)'},
  {id:'GTAQ2',gid:697482283,name:'X Accounts 16 (GTA VI QRTs)'},
  {id:'GTAIG',gid:1589347864,name:'IG Accounts 3 (GTA VI)'},
  {id:'GTAM',gid:1700251126,name:'X Accounts 17 (Mandy QRTs)',aliases:['X Accounts 17 (Article QRTs V2)']}
];
export const SOURCE_TAB_IDS=Object.freeze(SOURCE_TABS.map(t=>({...t})));
const prefixOf=name=>(String(name).match(/^((?:X|IG) Accounts \d+)/i)?.[1]||String(name)).toLowerCase();
const namesOf=def=>[def.name,...(def.aliases||[])];
// True when a sheet name belongs to this tab definition (current name, earlier name or same numbered prefix).
const tabMatches=(def,name)=>{const n=String(name||'');if(namesOf(def).includes(n))return true;
  const p=prefixOf(def.name),l=n.toLowerCase();return l===p||l.startsWith(p+' ')||l.startsWith(p+'(');};
export function findSheet(workbook,def,resolved={}){
  if(resolved[def.gid]&&workbook.getWorksheet(resolved[def.gid]))return workbook.getWorksheet(resolved[def.gid]);
  for(const n of namesOf(def)){const s=workbook.getWorksheet(n);if(s)return s;}
  const hits=workbook.worksheets.filter(s=>tabMatches(def,s.name)&&prefixOf(s.name)===prefixOf(def.name));
  return hits.length===1?hits[0]:null;
}
const OPTIONAL_TABS=new Set(['GTAQ2','GTAIG','GTAM']);
export const GROUPS={qrts:['GTAQ','GTAQ2'],originals:['GTA1','GTA2'],instagram:['GTAIG'],mandy:['GTAM']};
// Groups reported as their own campaign: a tracking link they share with another group is never attributed.
const SEPARATE_GROUPS=['mandy'];
const QUOTE_CAMPAIGNS=new Set(['GTAQ','GTAQ2','GTAM']);
// Approved programme budget for GTA VI (owner-confirmed, USD).
export const GTA_BUDGET=Object.freeze({amount:10000,currency:'USD'});
const defOf=campaign=>SOURCE_TABS.find(t=>t.id===campaign);
// A row belongs to a group when its campaign matches and it came from that campaign's tab (by gid or name).
export const inGroup=(p,group)=>GROUPS[group].includes(p.campaign)&&!!defOf(p.campaign)&&(p.sourceGid===defOf(p.campaign).gid||tabMatches(defOf(p.campaign),p.sourceTab));
export const publishedOriginals=rows=>(rows||[]).filter(p=>inGroup(p,'originals')&&p.posted===true);
// Apply the same boundary to live sheets, legacy caches and the verified snapshot.
export const publishedQrts=rows=>(rows||[]).filter(p=>inGroup(p,'qrts')&&p.posted===true);
const SHEET_TTL=90_000;

const sheetStore=()=>getStore({name:'fanvue-gta-report-v1',consistency:'strong'});
const metricStore=()=>getStore({name:'fanvue-gta-metrics-v1',consistency:'strong'});
const json=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:{'content-type':'application/json; charset=utf-8','cache-control':'no-store','x-content-type-options':'nosniff'}});
const val=c=>{const v=c?.value;if(v==null)return '';if(typeof v!=='object')return v;if(v instanceof Date)return v.toISOString();return v.result??v.text??v.richText?.map(x=>x.text).join('')??'';};
const txt=c=>String(val(c)).trim();
const link=c=>String(c?.hyperlink||c?.value?.hyperlink||c?.value?.formula?.match(/^HYPERLINK\(\s*"([^"]+)"/i)?.[1]||txt(c)).trim();
const yes=c=>val(c)===true||txt(c).toUpperCase()==='TRUE';
const usd=c=>{let v=String(val(c)).replace(/[$,\s]/g,'');return v!==''&&Number.isFinite(Number(v))&&Number(v)>=0?Number(v):null;};
const safeUrl=(value,host)=>{try{const u=new URL(String(value));return u.protocol==='https:'&&(!host||host.some(x=>u.hostname===x))?u.href:'';}catch{return '';}};
const X_HOSTS=['x.com','twitter.com'],IG_HOSTS=['www.instagram.com','instagram.com'];
const xPost=(url)=>{const m=String(url).match(/^https:\/\/(?:www\.)?(?:x\.com|twitter\.com)\/([A-Za-z0-9_]+)\/status\/(\d+)(?:[/?#]|$)/i);return m?{handle:m[1],id:m[2]}:null;};

export function parseRows(workbook,report={read:[],skipped:[]},resolved={}){
  const result=[];report.readIds=report.readIds||[];
  for(const def of SOURCE_TABS){
    const campaign=def.id,sheet=findSheet(workbook,def,resolved);
    if(!sheet){if(campaign==='GTAQ')throw new Error('GTA source tab missing: '+def.name);continue;}
    const tab=sheet.name,gid=def.gid;
    const instagram=campaign==='GTAIG',hosts=instagram?IG_HOSTS:X_HOSTS;
    const col={};sheet.getRow(7).eachCell((c,i)=>{const name=txt(c).toUpperCase();if(name&&(!col[name]||name==='LINK'))col[name]=i;});
    // Instagram tabs mark publication as "UP?" and have no separate post-link column.
    const postedKey=instagram&&col['UP?']?'UP?':'POSTED?';
    const required=instagram?['ACCOUNT','ACCOUNT SUM','PAID?',postedKey]:['ACCOUNT','ACCOUNT SUM','PAID?',postedKey,'LINK','UTM LINK'];
    const missing=required.filter(key=>!col[key]);
    // An unreadable optional tab is skipped and reported; it never stops the required tabs.
    if(missing.length){if(OPTIONAL_TABS.has(campaign)){report.skipped.push(tab);continue;}throw new Error('GTA column missing '+missing[0]+' in '+tab);}
    report.read.push(tab);report.readIds.push(campaign);
    const formats=instagram?['POST','STORY','BOTH'].filter(k=>col[k]):[];
    for(let i=8;i<=sheet.rowCount;i++){
      const r=sheet.getRow(i),cell=key=>r.getCell(col[key]),publisher=txt(cell('ACCOUNT'));
      if(publisher.length>100)continue;
      const priced=formats.filter(k=>txt(cell(k))!=='');
      const formatKey=priced.length===1?priced[0]:priced.length>1?'BOTH':null;
      // Instagram: a blank total with a single priced format (e.g. a $0 post) uses that price.
      const cost=usd(cell('ACCOUNT SUM'))??(instagram&&priced.length===1?usd(cell(priced[0])):null),paid=yes(cell('PAID?')),posted=yes(cell(postedKey));
      // Retain every account row; finance, publication and click eligibility are separate.
      const candidate=instagram?'':link(cell('LINK'));
      const postUrl=safeUrl(candidate,X_HOSTS);
      // A row may record more than one live post (one payment for several posts).
      const linkCell=instagram?null:cell('LINK');
      const postUrls=instagram?[]:[...new Set([candidate,String(linkCell?.value?.hyperlink||''),txt(linkCell)].join(' ')
        .match(/https:\/\/(?:www\.)?(?:x\.com|twitter\.com)\/[A-Za-z0-9_]+\/status\/\d+/gi)||[])].filter(u=>xPost(u));
      // Posts bought with this payment: a "N posts" note on the row, otherwise one per paid row.
      const noted=Number(txt(col['NOTES']?cell('NOTES'):null).match(/\b(\d{1,2})\s*(?:x\s*)?posts?\b/i)?.[1]);
      const accountUrl=safeUrl(link(r.getCell(col['ACCOUNT']+1)),hosts);
      const trackingUrl=col['UTM LINK']?trackingLink(link(r.getCell(col['UTM LINK'])))?.url||'':'';
      // Paid bookings survive missing handles and publication URLs; blank template rows do not qualify.
      if(!publisher&&!paid&&!posted&&!(trackingUrl&&cost!==null))continue;
      const identity=trackingUrl||accountUrl||publisher.toLowerCase()||('row:'+gid+':'+i);
      const code=campaign+'-'+createHash('sha256').update(trackingUrl?identity:identity+'|'+publisher.toLowerCase()).digest('hex').slice(0,20);
      const explicitDate=paymentDay(val(col['PAID DATE']?cell('PAID DATE'):col['PAYMENT DATE']?cell('PAYMENT DATE'):col['PAID AT']?cell('PAID AT'):null));
      const payment=paid&&!explicitDate?paymentDetailsDate(val(col['PAYMENT DETAILS']?cell('PAYMENT DETAILS'):null),cost):{};
      const format=instagram?(formatKey||'').toLowerCase()||null:(QUOTE_CAMPAIGNS.has(campaign)?'qrt':'original');
      result.push({code,campaign,sourceRow:i,sourceTab:tab,sourceGid:gid,platform:instagram?'instagram':'x',format,
        publisher:publisher.replace(/\s*\((?:TBC|TBD)\)/gi,'').trim(),publisherPending:!publisher,profileUrl:accountUrl||(!instagram&&/^\w{1,20}$/.test(publisher)?`https://x.com/${publisher}`:''),postUrl:xPost(postUrl)?postUrl:'',
        cost,paid,posted,trackingUrl,clicks:null,
        paidAt:explicitDate||payment.paidAt||'',...payment,
        plannedAt:paymentDay(val(col['PLANNED DATE']?cell('PLANNED DATE'):col['BOOKING DATE']?cell('BOOKING DATE'):col['BOOKED DATE']?cell('BOOKED DATE'):col['PLANNED AT']?cell('PLANNED AT'):col['BOOKED AT']?cell('BOOKED AT'):null)),
        ...(postUrls.length>1?{postUrls}:{}),...(campaign==='GTAM'?{purchasedPosts:Number.isSafeInteger(noted)&&noted>0?noted:paid?1:null}:{})});
    }
  }
  // Mandy has one unique tracking link per booking. Enrich rather than count a copied row again.
  // Preserve separate historical bookings in other tabs, where shared links can be legitimate.
  const canonical=new Map(),rows=[];
  for(const r of result){
    if(r.campaign!=='GTAM'||!r.trackingUrl){rows.push(r);continue;}
    const prior=canonical.get(r.trackingUrl);
    if(!prior){canonical.set(r.trackingUrl,r);rows.push(r);continue;}
    const conflict=!!(prior.identityAmbiguous||r.identityAmbiguous||
      (prior.paid&&r.paid&&prior.cost!==r.cost)||
      (prior.publisher&&r.publisher&&prior.publisher.toLowerCase()!==r.publisher.toLowerCase())||
      (prior.postUrl&&r.postUrl&&prior.postUrl!==r.postUrl));
    const paidRow=prior.paid?prior:r.paid?r:prior;
    const enriched={...paidRow,publisher:paidRow.publisher||prior.publisher||r.publisher,
      profileUrl:paidRow.profileUrl||prior.profileUrl||r.profileUrl,
      postUrl:paidRow.postUrl||prior.postUrl||r.postUrl,
      posted:prior.posted||r.posted,identityAmbiguous:conflict};
    enriched.publisherPending=!enriched.publisher;
    canonical.set(r.trackingUrl,enriched);
  }
  const merged=rows.map(r=>r.campaign==='GTAM'&&r.trackingUrl?canonical.get(r.trackingUrl):r);
  const counts=new Map();for(const r of merged)counts.set(r.code,(counts.get(r.code)||0)+1);
  return merged.map(r=>({...r,identityAmbiguous:!!r.identityAmbiguous||counts.get(r.code)>1}));
}

// Only when a tab cannot be found by name or prefix: fetch that tab's CSV by its gid and match it to a
// sheet by header row and first account names. The mapping is cached so this runs once per rename.
const cells=line=>{const out=[];let cur='',q=false;for(let i=0;i<line.length;i++){const ch=line[i];
  if(q){if(ch==='"'&&line[i+1]==='"'){cur+='"';i++;}else if(ch==='"')q=false;else cur+=ch;}
  else if(ch==='"')q=true;else if(ch===','){out.push(cur);cur='';}else cur+=ch;}out.push(cur);return out.map(v=>v.trim());};
export function matchSheetByContent(workbook,csv){
  const rows=String(csv).split(/\r?\n/).map(cells);
  const headRow=(rows[6]||[]).map(v=>v.toUpperCase()),acc=headRow.indexOf('ACCOUNT');
  const head=headRow.filter(Boolean).join('|');
  const names=acc<0?[]:rows.slice(7,13).map(r=>r[acc]||'');
  if(!head||!names.some(Boolean))return null;
  const hits=workbook.worksheets.filter(s=>{
    const h=[];let col=0;s.getRow(7).eachCell((c,i)=>{const v=txt(c).toUpperCase();if(v){h.push(v);if(v==='ACCOUNT'&&!col)col=i;}});
    if(h.join('|')!==head||!col)return false;
    return names.every((n,i)=>txt(s.getRow(8+i).getCell(col))===n);
  });
  return hits.length===1?hits[0].name:null;
}
async function resolveRenamedTabs(workbook,fetcher=fetch){
  const missing=SOURCE_TABS.filter(def=>!findSheet(workbook,def));
  if(!missing.length)return {};
  let saved={};try{saved=await sheetStore().get('tab-gids-v1',{type:'json'})||{};}catch{}
  const resolved={};
  for(const def of missing){
    if(saved[def.gid]&&workbook.getWorksheet(saved[def.gid])){resolved[def.gid]=saved[def.gid];continue;}
    try{
      const r=await fetcher(`https://docs.google.com/spreadsheets/d/${SHEET_ID}/export?format=csv&gid=${def.gid}`,{cache:'no-store',signal:AbortSignal.timeout(10000)});
      if(!r.ok)continue;
      const name=matchSheetByContent(workbook,await r.text());
      if(name)resolved[def.gid]=name;
    }catch{}
  }
  if(Object.keys(resolved).length){try{await sheetStore().setJSON('tab-gids-v1',{...saved,...resolved});}catch{}}
  return resolved;
}

async function readWorkbook(){
  const url=`https://docs.google.com/spreadsheets/d/${SHEET_ID}/export?format=xlsx`;
  const resp=await fetch(url,{cache:'no-store',signal:AbortSignal.timeout(19000)});
  if(!resp.ok)throw new Error('GTA spreadsheet export HTTP '+resp.status);
  const bytes=await resp.arrayBuffer();if(bytes.byteLength>13_000_000)throw new Error('GTA source workbook too large');
  const workbook=new ExcelJS.Workbook();await workbook.xlsx.load(Buffer.from(bytes));
  const resolved=await resolveRenamedTabs(workbook);
  for(const def of SOURCE_TABS)if(!OPTIONAL_TABS.has(def.id)&&!findSheet(workbook,def,resolved))throw new Error('GTA source tab missing: '+def.name);
  const report={read:[],skipped:[]};
  return {rows:parseRows(workbook,report,resolved),report};
}

async function readSourceRows(force=false){
  const store=sheetStore();let cache=null;
  try{cache=await store.get('last-good-groups-v2',{type:'json'});}catch{}
  if(!force&&cache?.schema===3&&Array.isArray(cache?.rows)&&Date.now()-Date.parse(cache.at)<SHEET_TTL)return {...cache,cached:true};
  try{const {rows,report}=await readWorkbook(),updated={schema:3,rows,at:new Date().toISOString(),source:'GOOGLE_SHEETS_LIVE',tabs:report.read,tabIds:report.readIds,skippedTabs:report.skipped};
    try{await store.setJSON('last-good-groups-v2',updated);}catch{}return {...updated,cached:false};
  }catch(e){
    if(!Array.isArray(cache?.rows))for(const key of ['last-good-groups-v1','last-good-shortio-v3','last-good']){
      try{cache=await store.get(key,{type:'json'});}catch{}
      if(Array.isArray(cache?.rows))break;
    }
    if(Array.isArray(cache?.rows))return {...cache,cached:true,warning:'Live GTA spreadsheet unavailable; displaying last verified data.'};
    return {rows:seed,at:seedVerifiedAt,source:'VERIFIED_SNAPSHOT',cached:true,warning:'Live GTA spreadsheet unavailable; showing verified 16 Nov snapshot. Check Google Sheets export access.'};
  }
}

// Preserve source payment flags. Legacy caches may carry the old synthetic paid flag.
// Keep the export name for existing consumers; planned rows are never paid spend.
const PLANNED_CAMPAIGNS=new Set(['GTAQ2','GTAM']);
export const countPlannedAsPaid=rows=>(rows||[]).map(p=>{
  const {duplicateOf,...r}=p;
  if(r.planned===true)return {...r,paid:false};
  return PLANNED_CAMPAIGNS.has(r.campaign)&&r.paid!==true&&typeof r.cost==='number'&&r.cost>0?{...r,planned:true}:r;
});
async function sourceRows(force=false){
  const source=await readSourceRows(force);
  const rows=countPlannedAsPaid(source.rows).map(confirmedPayment).map(confirmedPlan);
  const usage=new Map();
  for(const p of rows){if(p.posted&&p.postUrl&&p.trackingUrl){const posts=usage.get(p.trackingUrl)||new Set();posts.add(p.postUrl);usage.set(p.trackingUrl,posts);}}
  // A link used both by a separately reported campaign and by another group cannot be credited to either.
  const groupOf=p=>Object.keys(GROUPS).find(g=>GROUPS[g].includes(p.campaign));
  const linkGroups=new Map();
  for(const p of rows)if(p.trackingUrl){const s=linkGroups.get(p.trackingUrl)||new Set();s.add(groupOf(p));linkGroups.set(p.trackingUrl,s);}
  const crossed=url=>{const s=linkGroups.get(url);return !!s&&s.size>1&&SEPARATE_GROUPS.some(g=>s.has(g));};
  return {...source,rows:rows.map(p=>({...p,sharedTracking:usage.get(p.trackingUrl)?.size>1,...(p.trackingUrl&&crossed(p.trackingUrl)?{crossCampaignTracking:true}:{})}))};
}

const sumKnown=vals=>vals.every(v=>v===null||v===undefined)?null:vals.reduce((n,v)=>n+(v||0),0);
const mergeMetrics=(rows,metrics)=>rows.map(p=>{
  if(p.postUrls?.length>1){
    // Several posts on one payment: each post is read on its own; totals only cover measured posts.
    const ms=p.postUrls.map(u=>{const id=xPost(u)?.id;return [id,id&&metrics?.[id]?.at?metrics[id]:null];});
    const ok=ms.filter(([,m])=>m);
    return {...p,postViews:Object.fromEntries(ms.map(([id,m])=>[id,m?m.views:null])),postsMeasured:ok.length,
      views:sumKnown(ok.map(([,m])=>m.views)),likes:sumKnown(ok.map(([,m])=>m.likes)),reposts:sumKnown(ok.map(([,m])=>m.reposts)),replies:sumKnown(ok.map(([,m])=>m.replies)),
      metricAt:ok.map(([,m])=>m.at).sort().at(-1)||null,metricError:ms.map(([,m],i)=>m?'':metrics?.[ms[i][0]]?.error||'').filter(Boolean)[0]||'',metricErrorCategory:'',metricLastAttemptAt:null};
  }
  const post=xPost(p.postUrl),m=post&&metrics?.[post.id];
  if(!m?.at)return {...p,views:null,likes:null,reposts:null,replies:null,metricAt:null,metricError:m?.error||'',metricErrorCategory:m?.errorCategory||'',metricLastAttemptAt:m?.lastAttemptAt||null};
  return {...p,views:m.views,likes:m.likes,reposts:m.reposts,replies:m.replies,metricAt:m.at,metricError:m.error||'',metricErrorCategory:m.errorCategory||'',metricLastAttemptAt:m.lastAttemptAt||null};
});

async function getMetrics(storage=metricStore()){return await storage.get('latest',{type:'json'})||{metrics:{},history:[],lastSuccessfulAt:null};}

export async function groupReport(source,metric,{force=false,refreshClicks=false,cacheOnly=true,clickOptions={}}={}){
  const shortIo=await campaignLinkClicks(source.rows.filter(p=>!p.crossCampaignTracking),{force:refreshClicks||force,cacheOnly,...clickOptions,dailyHistory:true});
  const byLink=new Map(shortIo.links.map(p=>[trackingLink(p.trackingUrl)?.url,p]));
  const publishers=mergeMetrics(source.rows,metric.metrics).map(p=>{
    const reading=byLink.get(trackingLink(p.trackingUrl)?.url);
    const attributed=p.posted&&p.postUrl?reading?.postPublicationClicks??null:null;
    const shared=p.identityAmbiguous||p.crossCampaignTracking||p.sharedTracking||source.rows.filter(r=>r.posted&&r.trackingUrl&&r.trackingUrl===p.trackingUrl).length>1;
    return {...p,clicks:shared?null:attributed,allTimeClicks:reading?.clicks??null,clickAt:reading?.clickAt,postPublicationVerifiedAt:reading?.publicationVerifiedAt,clickStale:!!(reading?.stale||reading?.publicationStale),clickError:shared?'Shared link; see campaign link breakdown.':reading?.clickError||reading?.attributionError||'',clickTracked:!!reading&&!shared,cpc:!shared&&p.paid&&p.cost!==null&&attributed>0?p.cost/attributed:null};
  });
  const xStatus=gtaMetricStatus(source.rows,metric);
  // History covers every post, including extra posts on a multi-post booking.
  const ids=new Set(source.rows.flatMap(p=>p.postUrls?.length?p.postUrls:[p.postUrl]).map(u=>xPost(u)?.id).filter(Boolean).map(String));
  // Keep enough history for the preceding UK week and its baseline.
  const cutoff=Date.now()-21*24*60*60*1000;
  const history=(Array.isArray(metric.history)?metric.history:[])
    .filter(h=>ids.has(String(h.id||''))&&Date.parse(h.at||'')>=cutoff&&Number.isFinite(Number(h.views)));
  return {ok:true,id:'GTA',name:'GTA VI',scope:'published-qrts-v1',ready:true,checkedAt:new Date().toISOString(),
    source:source.source,sourceVerifiedAt:source.at,sourceStale:!!source.warning,cached:source.cached,warning:source.warning||'',
    publishers,summary:summarisePlacements(source.rows),activity:shortIo.links.filter(p=>p.attributed&&!p.sharedTracking).flatMap(p=>(p.dailyClicks||[]).map(d=>({...d,code:p.code,trackingUrl:p.trackingUrl,postId:xPost(p.postUrl)?.id}))),history,clickTracking:true,shortIo,clickTrackingReason:'All-time human clicks are separate from verified post-publication clicks; each link is counted once.',
    metricLastSuccessfulAt:xStatus.lastSuccessfulAt,intervalHours:2,
    xStatus,metricErrors:xStatus.errors};
}

export async function getReport(options={}){
  const [source,metric]=await Promise.all([sourceRows(options.force),getMetrics()]);
  const [qrts,originals,instagram]=await Promise.all(['qrts','originals','instagram'].map(group=>
    groupReport({...source,rows:source.rows.filter(p=>inGroup(p,group))},metric,options)));
  const quoteGroups=summariseQuotedOriginals(qrts.publishers,metric.metrics);
  const mandy=await groupReport({...source,rows:source.rows.filter(p=>inGroup(p,'mandy'))},metric,options);
  const paidOriginals=new Set(originals.publishers.filter(p=>p.posted&&p.paid).map(p=>xPost(p.postUrl)?.id).filter(Boolean));
  quoteGroups.rows=quoteGroups.rows.map(row=>({...row,paidOriginalMatch:paidOriginals.has(row.originalPostId)}));
  const tabs=source.tabs||[...new Set(source.rows.map(p=>p.sourceTab))],skipped=source.skippedTabs||[];
  // Mandy QRTs is its own campaign inside GTA VI; its quoted original (the viral tweet) is summarised separately.
  const readIds=source.tabIds||[...new Set(source.rows.map(p=>p.campaign))];
  const mandyRead=readIds.includes('GTAM')&&!skipped.some(n=>tabMatches(defOf('GTAM'),n));
  return {...qrts,originals:{...originals,scope:'published-originals-v1'},instagram:{...instagram,scope:'instagram-v1'},quotedOriginals:quoteGroups,
    ...(mandyRead||mandy.publishers.length?{mandy:{...mandy,scope:'mandy-qrts-v1',quotedOriginals:summariseQuotedOriginals(mandy.publishers,metric.metrics,['GTAM'])}}:{}),
    campaignSummary:summarisePlacements(source.rows),
    budget:GTA_BUDGET,
    // Optional tabs that could not be read (or Instagram missing) are flagged, never silently dropped.
    missingTabs:source.source==='GOOGLE_SHEETS_LIVE'?SOURCE_TABS.filter(def=>OPTIONAL_TABS.has(def.id)&&(skipped.some(n=>tabMatches(def,n))||(['GTAIG','GTAM'].includes(def.id)&&!readIds.includes(def.id)))).map(def=>def.name):[]};
}

export async function refreshGtaMetrics({manual=false,fetcher=fetch,storage=metricStore(),readSource=sourceRows,readReport=getReport}={}){
  // A cache read failure must abort rather than overwrite verified history with an empty state.
  const st=storage,last=await st.get('latest',{type:'json'})||{metrics:{},history:[]},now=Date.now();
  const source=await readSource(manual),posts=source.rows.filter(p=>p.posted).flatMap(p=>(p.postUrls?.length?p.postUrls:[p.postUrl]).map(u=>({p,post:xPost(u)}))).filter(x=>x.post);
  const distinct=[...new Map(posts.map(x=>[x.post.id,x])).values()];
  const metrics={...last.metrics},errors=[];let updated=0;
  for(let i=0;i<distinct.length;i+=6){
    const batch=await Promise.all(distinct.slice(i,i+6).map(async ({post})=>{
      try{
        const metric=await readGtaXMetric(post,{fetcher}),prior=metrics[post.id];
        if(['views','likes','reposts','replies'].some(k=>prior?.[k]>0&&metric[k]===0))throw Object.assign(new Error('X provider returned zero for a previously verified metric'),{category:'suspect_regression'});
        return {id:post.id,metric};
      }catch(e){return {id:post.id,error:String(e.message||e),category:e.category||'api_failure'};}
    }));
    for(const item of batch){
      if(item.metric){
        // Preserve a verified QRT-to-original relationship if the X provider temporarily omits quote data.
        const oldQuote=metrics[item.id]?.quotedPost;
        if(oldQuote&&(!item.metric.quotedPost||item.metric.quotedPost.id!==oldQuote.id||['views','likes','reposts','replies'].some(k=>oldQuote[k]>0&&item.metric.quotedPost[k]===0)))item.metric.quotedPost=oldQuote;
        metrics[item.id]=item.metric;updated++;
      }
      else{metrics[item.id]={...(metrics[item.id]||{}),error:item.error,errorCategory:item.category,lastAttemptAt:new Date().toISOString()};errors.push({postId:item.id,error:item.error,category:item.category});}
    }
  }
  const at=new Date().toISOString();const history=Array.isArray(last.history)?last.history.slice():[];
  // Keep one sample per post per 2-hour bucket, not one per request. No fabricated history.
  for(const {post} of distinct){const m=metrics[post.id];if(!m?.at||m.error)continue;
    const bucket=Math.floor(Date.parse(m.at)/7_200_000);if(!history.some(x=>x.id===post.id&&x.bucket===bucket))history.push({id:post.id,bucket,at:m.at,views:m.views,likes:m.likes,reposts:m.reposts,replies:m.replies});
  }
  const next={metrics,history,lastSuccessfulAt:updated?at:last.lastSuccessfulAt||null,lastAttemptAt:at,
    lastManualAt:manual?now:Number(last.lastManualAt||0),updated,total:distinct.length,errors};
  await st.setJSON('latest',next);
  const report=await readReport({refreshClicks:true,cacheOnly:false});
  return {...report,refreshed:errors.length===0&&!report.sourceStale&&report.shortIo.errors===0&&report.originals.shortIo.errors===0&&!(report.instagram?.shortIo.errors)&&!(report.mandy?.shortIo.errors),updated,total:distinct.length,errors,
    skipped:false,serverNow:Date.now(),nextRefreshAt:manual?now:Number(last.lastManualAt||0)};
}

export default async function handler(request){
  if(request.method==='GET'||request.method==='HEAD'){
    try{
      const params=new URL(request.url).searchParams;
      if(params.has('status'))return json({ok:true,refresh:await refreshStatus()});
      // A job-status lookup must never invalidate an otherwise verified report.
      const saved=(params.has('job')||params.has('reuse'))?await metricStore().get('latest-refresh-report-v1',{type:'json'}).catch(()=>null):null;
      const fresh=saved?.report?.ready===true&&((params.has('job')&&saved.id===params.get('job'))||(params.has('reuse')&&Date.now()-Date.parse(saved.at)<120000));
      const report=fresh?saved.report:await getReport({force:params.has('refresh')});
      const refresh=await refreshStatus().catch(()=>null);
      return json({...report,refresh});
    }
    catch(e){return json({ok:false,ready:false,error:String(e.message||e)},503);}
  }
  if(request.method==='POST'){
    try{return json(await startRefresh(request),202);}
    catch{return json({ok:false,error:'GTA refresh could not start'},503);}
  }
  return json({ok:false,error:'METHOD_NOT_ALLOWED'},405);
}

export async function refreshStatus(){const job=await metricStore().get('refresh-job-v2',{type:'json'});return job&&['queued','running'].includes(job.state)&&job.expiresAt<Date.now()?{...job,state:'failed',error:'Refresh did not complete; retry to resume with saved readings.'}:job;}
export async function startRefresh(request){
  const st=metricStore(),now=Date.now(),prior=await st.getWithMetadata('refresh-job-v2',{type:'json'});
  if(prior?.data?.expiresAt>now&&['queued','running'].includes(prior.data.state))return {ok:true,refresh:prior.data};
  const job={id:crypto.randomUUID(),state:'queued',startedAt:new Date(now).toISOString(),expiresAt:now+16*60_000};
  const acquired=await st.setJSON('refresh-job-v2',job,prior?{onlyIfMatch:prior.etag}:{onlyIfNew:true});
  if(!acquired.modified)return {ok:true,refresh:await refreshStatus()};
  try{
    const response=await fetch(new URL('/.netlify/functions/gta-refresh-background',request.url),{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({id:job.id})});
    if(!response.ok)throw Error('Worker unavailable');
  }catch(e){await st.setJSON('refresh-job-v2',{...job,state:'failed',expiresAt:0,error:'Refresh worker unavailable'});throw e;}
  return {ok:true,refresh:job};
}
export async function runRefreshJob(id){
 const st=metricStore(),prior=await st.getWithMetadata('refresh-job-v2',{type:'json'});
 if(prior?.data?.id!==id||prior.data.state!=='queued')return;
 const job={...prior.data,state:'running'};
 const claimed=await st.setJSON('refresh-job-v2',job,{onlyIfMatch:prior.etag});if(!claimed.modified)return;
 try{const report=await refreshGtaMetrics({manual:true});
 const {at:unused,...snapshot}=report;await st.setJSON('latest-refresh-report-v1',{id,at:new Date().toISOString(),report:snapshot}).catch(()=>{});
 await st.setJSON('refresh-job-v2',{...job,state:'complete',expiresAt:0,completedAt:new Date().toISOString(),errors:report.shortIo.errors+report.originals.shortIo.errors+(report.instagram?.shortIo.errors||0)+(report.mandy?.shortIo.errors||0)+(report.errors?.length||0),updated:report.updated,total:report.total});}
 catch{await st.setJSON('refresh-job-v2',{...job,state:'failed',expiresAt:0,error:'Refresh failed; last verified readings retained',completedAt:new Date().toISOString()});}
}
