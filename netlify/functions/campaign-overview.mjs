// One read-only, lifetime reporting feed for the existing Fanvue X Tracker.
// It composes the *existing* independently tracked campaigns, never redirects tracking URLs,
// never writes to operational sheets and never represents missing conversions as zero.
import ExcelJS from 'exceljs';
import {paymentDay,paymentDetailsDate,applyPaymentDates} from '../lib/payment-dates.mjs';
import {getStore} from '@netlify/blobs';
import '../../public/fanvue-core.js';
const Finance=globalThis.FanvueCore;
const SHEET='1D8rI3BuuFHIemYZY92QFiHDMkj876F8oiwpDR6sMiTE';
const ARTICLE_RTS='X Accounts 11 (Article RTs)';
const OVERVIEW_CACHE_TTL=60_000;
const overviewStore=()=>getStore({name:'fanvue-campaign-overview-v1',consistency:'strong'});
const blank=v=>v===null||v===undefined||v==='';
const num=v=>blank(v)?null:Number.isFinite(Number(v))&&Number(v)>=0?Number(v):null;
const yes=v=>v===true||String(v).trim().toUpperCase()==='TRUE';
const handleOf=url=>String(url||'').match(/^https:\/\/(?:www\.)?(?:x\.com|twitter\.com)\/([A-Za-z0-9_]{1,15})\/status\/\d+/i)?.[1]||'';
const xPost=url=>String(url||'').match(/^https:\/\/(?:www\.)?(?:x\.com|twitter\.com)\/[A-Za-z0-9_]{1,15}\/status\/(\d+)(?:[/?#]|$)/i)?.[1]||null;
const goodUrl=url=>{try{const u=new URL(String(url||''));return u.protocol==='https:'?u.href:'';}catch{return ''}};
const sum=(rows,key)=>{const found=rows.map(key).map(num).filter(v=>v!==null);return found.length?found.reduce((a,b)=>a+b,0):null};
const uniqueSum=(rows,key)=>{const seen=new Set();return sum(rows.filter(p=>{const id=xPost(p.postUrl);if(!id||seen.has(id))return false;seen.add(id);return true;}),key)};
const moneyRows=rows=>{const paid=rows.filter(r=>r.paid===true&&r.planned!==true),known=paid.map(p=>num(p.cost)).filter(v=>v!==null);return {known:known.length?known.reduce((n,v)=>n+v,0):null,unknown:paid.length-known.length,paidCount:paid.length};};
// Committed: agreed placements with a recorded price that are not marked paid yet.
const committedRows=rows=>{const open=rows.filter(r=>!r.paid&&r.planned!==true&&num(r.cost)>0);return {known:Math.round(open.reduce((n,r)=>n+num(r.cost),0)*100)/100,count:open.length};};
const stamped=(o,...paths)=>paths.map(k=>o?.[k]).filter(Boolean)[0]||null;
const diagnostic=(x)=>x instanceof Error?x.message:String(x||'Unknown source failure');
const cellValue=c=>{let v=c?.value;if(v==null)return '';if(typeof v!=='object')return v;if(v instanceof Date)return v.toISOString();if('result' in v)return v.result??'';return v.text??v.richText?.map(x=>x.text).join('')??'';};
const cellText=c=>String(cellValue(c)).trim();
const cellLink=c=>String(c?.hyperlink||c?.value?.hyperlink||c?.value?.formula?.match(/^HYPERLINK\(\s*"([^"]+)"/i)?.[1]||cellText(c)).trim();

export function parseArticleRtWorkbook(workbook){
  const sheet=workbook.getWorksheet(ARTICLE_RTS);
  if(!sheet)throw Error('Article RT tab missing');
  const cols={},linkColumns=[];
  sheet.getRow(7).eachCell((c,i)=>{
    const k=cellText(c).toUpperCase();
    if(!k)return;
    if(k==='LINK')linkColumns.push(i);
    if(!cols[k]||k==='LINK')cols[k]=i;
  });
  for(const k of ['ACCOUNT','ACCOUNT SUM','PAID?','POSTED?','LINK'])if(!cols[k])throw Error('Article RT sheet column missing: '+k);
  const rows=[];
  for(let i=8;i<=sheet.rowCount;i++){
    const get=k=>sheet.getRow(i).getCell(cols[k]);
    const publisher=cellText(get('ACCOUNT'));
    if(publisher.length>100||(!publisher&&!yes(cellValue(get('PAID?')))&&!yes(cellValue(get('POSTED?')))))continue;
    // C is the publisher's profile, while the final LINK/X column is the
    // original post being retweeted. They must never be conflated.
    const postUrl=goodUrl(cellLink(sheet.getRow(i).getCell(linkColumns.at(-1)||cols['LINK'])));
    const profile=goodUrl(cellLink(sheet.getRow(i).getCell(linkColumns[0]||cols['ACCOUNT']+1)));
    const cost=num(cellText(get('ACCOUNT SUM')).replace(/[$,\s]/g,''));
    const explicitDate=paymentDay(cellValue(cols['PAID DATE']?get('PAID DATE'):cols['PAYMENT DATE']?get('PAYMENT DATE'):cols['PAID AT']?get('PAID AT'):null));
    const payment=yes(cellValue(get('PAID?')))&&!explicitDate?paymentDetailsDate(cellValue(cols['PAYMENT DETAILS']?get('PAYMENT DETAILS'):null),cost):{};
    rows.push({
      id:'ARTICLERT-'+i,sourceTab:ARTICLE_RTS,sourceRow:i,publisher,profileUrl:profile,
      postUrl:xPost(postUrl)?postUrl:'',sourcePostUrl:xPost(postUrl)?postUrl:'',trackingUrl:goodUrl(cols['UTM LINK']?cellLink(get('UTM LINK')):''),
      cost:num(cellText(get('ACCOUNT SUM')).replace(/[$,\s]/g,'')),
      paid:yes(cellValue(get('PAID?'))),posted:yes(cellValue(get('POSTED?'))),
      paidAt:explicitDate||payment.paidAt||'',...payment,
      views:null,likes:null,reposts:null,replies:null,clicks:null,signups:null,kyc:null,earningCreators:null
    });
  }
  return rows;
}
export async function readArticleRts({fetcher=fetch,store=getStore({name:'fanvue-campaign-reporting-v1',consistency:'strong'}),now=Date.now(),force=false}={}){
  let saved=null;
  try{saved=await store.get('article-rts-last-good',{type:'json'});}catch{}
  if(!force&&Array.isArray(saved?.rows)&&now-Date.parse(saved.at)<120_000)return {...saved,cached:true,stale:false};
  try{
    const url='https://docs.google.com/spreadsheets/d/'+SHEET+'/export?format=xlsx';
    const res=await fetcher(url,{cache:'no-store',signal:AbortSignal.timeout(19000)});
    if(!res.ok)throw Error('Article RT sheet export HTTP '+res.status);
    const bytes=await res.arrayBuffer();
    if(bytes.byteLength>13_000_000)throw Error('Article RT workbook exceeds size limit');
    const book=new ExcelJS.Workbook();await book.xlsx.load(Buffer.from(bytes));
    const result={rows:parseArticleRtWorkbook(book),at:new Date(now).toISOString(),source:'GOOGLE_SHEETS_LIVE'};
    try{await store.setJSON('article-rts-last-good',result);}catch{}
    return {...result,cached:false,stale:false};
  }catch(e){
    if(Array.isArray(saved?.rows))return {...saved,cached:true,stale:true,warning:'Article RT source temporarily unavailable; last verified rows retained.'};
    return {rows:[],at:null,stale:true,error:diagnostic(e),source:'UNAVAILABLE'};
  }
}

/* Verified original-post counters can be partial. The provider may return views
   while omitting likes/replies, and one missing counter must not hide valid views.
   Do not claim complete engagement when a counter is unavailable. */
export function parseOriginalXSnapshot(data,expectedId,at){
  const tweet=data?.tweet,id=String(tweet?.id??tweet?.id_str??'');
  if(id!==expectedId)throw Error('Original X provider returned a different post');
  const value=v=>v!==null&&v!==undefined&&v!==''&&Number.isFinite(Number(v))&&Number(v)>=0?
    Number(v):null;
  const views=value(tweet?.views);
  if(views===null)throw Error('Original X provider did not return verified views');
  const likes=value(tweet.likes),comments=value(tweet.replies),shares=value(tweet.retweets);
  const complete=[likes,comments,shares].every(v=>v!==null);
  return {postId:expectedId,views,likes,comments,shares,at,
    engagementRate:complete&&views>0?
      Math.round(10000*(likes+comments+shares)/views)/100:null,
    complete};
}

/* Read only provider-verified original-post metrics. These are NOT impressions
   generated by the individual paid retweet actions. Last-good X readings are
   retained on provider failures; source URLs come exclusively from the Sheet. */
export async function readArticleOriginalMetrics(rows=[],{
  fetcher=fetch,store=getStore({name:'fanvue-article-rt-original-metrics-v1',consistency:'strong'}),
  now=Date.now(),force=false
}={}){
  const targets=new Map();
  for(const p of rows){
    const match=String(p.sourcePostUrl||p.postUrl||'').match(/^https:\/\/(?:www\.)?(?:x\.com|twitter\.com)\/([A-Za-z0-9_]{1,15})\/status\/(\d+)(?:[/?#]|$)/i);
    if(match&&!targets.has(match[2]))targets.set(match[2],{id:match[2],handle:match[1],postUrl:p.sourcePostUrl||p.postUrl});
  }
  let saved=null;
  try{saved=await store.get('latest',{type:'json'});}catch{}
  const metrics={...(saved?.metrics||{})},nowISO=new Date(now).toISOString(),errors=[];
  const history=new Map((saved?.history||[]).filter(h=>Date.parse(h.at)>=now-91*86400000).map(h=>[h.postId+'|'+Finance.londonDay(h.at),h]));
  const remember=m=>{if(!m?.postId||!m.at||num(m.views)===null)return;const key=m.postId+'|'+Finance.londonDay(m.at),prior=history.get(key);if(!prior||Date.parse(m.at)>Date.parse(prior.at))history.set(key,{id:m.postId,postId:m.postId,at:m.at,views:m.views});};
  for(const m of Object.values(metrics))remember(m);
  const entries=[...targets.values()];
  for(let offset=0;offset<entries.length;offset+=4){
    await Promise.all(entries.slice(offset,offset+4).map(async target=>{
      const prior=metrics[target.id],age=now-(Date.parse(prior?.lastAttemptAt||'')||0);
      // Refresh automatically every two hours; user refresh never creates
      // an unlimited polling loop.
      if(age<(force?2*60_000:2*3_600_000))return;
      try{
        const response=await fetcher('https://api.fxtwitter.com/'+encodeURIComponent(target.handle)+'/status/'+target.id,
          {headers:{accept:'application/json'},cache:'no-store',signal:AbortSignal.timeout(10_000)});
        if(!response.ok)throw Error('X provider HTTP '+response.status);
        const value=parseOriginalXSnapshot(await response.json(),target.id,nowISO);
        if(prior&&['views','likes','comments','shares'].some(k=>value[k]===0&&Number(prior[k])>0))
          throw Error('X provider returned an invalid zero reset');
        metrics[target.id]={...value,postUrl:target.postUrl,source:'FXTWITTER',lastAttemptAt:nowISO};remember(metrics[target.id]);
      }catch(error){
        errors.push(target.id);
        metrics[target.id]={...(prior||{}),postUrl:target.postUrl,lastAttemptAt:nowISO,
          error:'Original X stats temporarily unavailable; last good reading preserved'};
      }
    }));
  }
  const result={metrics,history:[...history.values()],at:nowISO,source:'FXTWITTER',errors};
  try{await store.setJSON('latest',result);}catch{}
  return result;
}

/* Account for each paid RT placement exactly once. Shared originals are
   grouped for display, never charged once per post or counted as RT views. */
export function groupArticleRtSpend(rows=[]){
  const originals=new Map(),unlinked=[],paidRows=rows.filter(p=>p.paid===true);
  for(const p of paidRows){
    const postUrl=p.sourcePostUrl||p.postUrl||'',id=xPost(postUrl);
    if(!id){unlinked.push(p);continue;}
    const group=originals.get(id)||{postId:id,postUrl,paidCount:0,paidSpendKnown:0,
      unknownPaidCosts:0,postedCount:0,placements:[],views:null,likes:null,
      reposts:null,replies:null,interactions:null,engagementRate:null,
      metricAt:null,metricSource:null};
    group.paidCount++;if(p.posted)group.postedCount++;
    const cost=num(p.cost);if(cost===null)group.unknownPaidCosts++;else group.paidSpendKnown+=cost;
    group.placements.push({publisher:p.publisher,profileUrl:p.profileUrl,cost,paid:p.paid,
      posted:p.posted,sourceRow:p.sourceRow,postUrl});
    // Every reposter referencing this same original receives the *same* source
    // snapshot. Copy it onto the group once, never add it per reposter.
    const sourceViews=num(p.sourceOriginalViews??p.views);
    if(sourceViews!==null){
      const sourceAt=Date.parse(p.metricAt||'')||0;
      const savedAt=Date.parse(group.metricAt||'')||0;
      if(group.views===null||sourceAt>=savedAt){
        group.views=sourceViews;
        group.likes=num(p.likes);
        group.reposts=num(p.reposts);
        group.replies=num(p.replies);
        group.metricAt=p.metricAt||null;
        group.metricSource=p.metricSource||null;
        group.interactions=[group.likes,group.reposts,group.replies].every(v=>v!==null)?
          group.likes+group.reposts+group.replies:null;
        group.engagementRate=group.interactions!==null&&group.views>0?
          Math.round(10000*group.interactions/group.views)/100:null;
      }
    }
    originals.set(id,group);
  }
  const linked=[...originals.values()];
  const known=paidRows.map(p=>num(p.cost)).filter(v=>v!==null);
  const unlinkedKnown=unlinked.map(p=>num(p.cost)).filter(v=>v!==null);
  const complete=linked.filter(p=>p.views!==null&&p.interactions!==null);
  const completeViews=complete.reduce((total,p)=>total+p.views,0);
  const completeInteractions=complete.reduce((total,p)=>total+p.interactions,0);
  return {originals:linked,unlinked:unlinked.map(p=>({publisher:p.publisher,profileUrl:p.profileUrl,
      cost:num(p.cost),paid:p.paid,posted:p.posted,sourceRow:p.sourceRow})),
    summary:{paidCount:paidRows.length,paidSpendKnown:known.length?known.reduce((a,b)=>a+b,0):null,
      linkedPaidCount:linked.reduce((a,b)=>a+b.paidCount,0),
      linkedPaidSpendKnown:linked.reduce((a,b)=>a+b.paidSpendKnown,0),
      unlinkedPaidCount:unlinked.length,unlinkedPaidSpendKnown:unlinkedKnown.reduce((a,b)=>a+b,0),
      originalPosts:linked.length,
      originalViewsKnown:sum(linked,p=>p.views),
      originalLikesKnown:sum(linked,p=>p.likes),
      originalRepostsKnown:sum(linked,p=>p.reposts),
      originalRepliesKnown:sum(linked,p=>p.replies),
      originalInteractionsKnown:sum(linked,p=>p.interactions),
      originalEngagementRate:complete.length===linked.length&&completeViews>0?
        Math.round(10000*completeInteractions/completeViews)/100:null,
      originalsWithViews:linked.filter(p=>p.views!==null).length,
      originalsWithFullMetrics:complete.length}};
}

const converted=()=>({signups:null,kyc:null,earningCreators:null,conversionSource:'NOT_CONNECTED'});
function normalCampaign(id,name,kind,rows,sourceStatus={},extra={}){
  const paid=moneyRows(rows),committed=committedRows(rows),posted=rows.filter(p=>p.posted===true),
    linked=posted.filter(p=>!!xPost(p.postUrl)),
    reported=linked.filter(p=>num(p.views)!==null),
    views=uniqueSum(linked,p=>p.views),
    likes=uniqueSum(linked,p=>p.likes),
    reposts=uniqueSum(linked,p=>p.reposts),
    replies=uniqueSum(linked,p=>p.replies);
  const coverage={withPostUrl:linked.length,withXMetrics:reported.length,published:posted.length};
  return {
    id,name,kind,source:sourceStatus.source||'CONNECTED',sourceVerifiedAt:sourceStatus.at||null,
    dataWarning:sourceStatus.warning||null,unavailable:sourceStatus.error||null,
    placements:rows.length,published:posted.length,paidCount:paid.paidCount,
    paidSpendKnown:paid.known,unknownPaidCosts:paid.unknown,committedUnpaidKnown:committed.known,committedUnpaidCount:committed.count,
    // Planned bookings stay outside both paid and committed spend.
    plannedSpendKnown:Math.round(rows.filter(r=>r.planned===true&&num(r.cost)!==null).reduce((n,r)=>n+num(r.cost),0)*100)/100,
    views,likes,reposts,replies,coverage,rows,
    allTimeHumanClicks:null,postPublicationClicks:null,...converted(),...extra
  };
}
const GTA_GROUPS={
  qrts:{id:'gta-qrts',name:'GTA VI QRTs',kind:'qrt',campaigns:['GTAQ','GTAQ2']},
  originals:{id:'gta-originals',name:'GTA VI Originals',kind:'original',campaigns:['GTA1','GTA2']},
  instagram:{id:'gta-instagram',name:'GTA VI Instagram',kind:'instagram',campaigns:['GTAIG']},
  mandy:{id:'gta-mandy',name:'GTA VI Mandy QRTs',kind:'qrt',campaigns:['GTAM']}
};
function gtaCampaign(data,group='qrts'){
  const def=GTA_GROUPS[group],entry=group==='qrts'?data:data?.[group];
  // A GTA report from before Instagram was read has no group to show; it is not a failure.
  if((group==='instagram'||group==='mandy')&&data?.ready&&!data[group])return null;
  if(!entry?.ready)return {...normalCampaign(def.id,def.name,def.kind,[],{source:'UNAVAILABLE',error:'GTA report unavailable'}),unavailable:true};
  const rows=(entry.publishers||[]).filter(p=>def.campaigns.includes(p.campaign));
  const report=normalCampaign(def.id,def.name,def.kind,rows,{
    source:entry.source,at:entry.sourceVerifiedAt,warning:entry.warning
  },{
    allTimeHumanClicks:num(entry.shortIo?.total),
    postPublicationClicks:num(entry.shortIo?.postPublicationTotal),
    history:Array.isArray(entry.history)?entry.history:[],
    clickHistory:Array.isArray(entry.activity)?entry.activity:null,
    clickHistoryCheckedAt:entry.checkedAt||null,
    clickHistoryReady:Array.isArray(entry.activity),
    clickLinkCoverage:(entry.shortIo?.links||[]).map(p=>({code:p.code,trackingUrl:p.trackingUrl,posted:p.posted,attributed:p.attributed,publicationAt:p.publicationAt,publicationStale:p.publicationStale,clickError:p.clickError,attributionError:p.attributionError})),
    sourceStale:!!entry.sourceStale,
    xMetricErrors:(entry.xStatus?.errors||[]).length,
    quotedOriginals:group==='qrts'?data.quotedOriginals||null:group==='mandy'?entry.quotedOriginals||null:null,
    // Posts bought: one per paid row unless the sheet records more (e.g. one payment for two posts).
    purchasedPosts:rows.some(r=>r.purchasedPosts!==undefined)?rows.filter(r=>r.paid===true).reduce((n,r)=>n+(Number(r.purchasedPosts)||1),0):null,
    ...(group==='qrts'?{budget:data.budget||null,missingTabs:data.missingTabs||[]}:{})
  });
  return {...report,spendKnown:Finance.allocatedGtaSpend(report).value};
}
function ofCampaign(data){
  if(!data?.ready)return {...normalCampaign('of-terms','OF Terms','article',[],{source:'UNAVAILABLE',error:'OF Terms report unavailable'}),unavailable:true};
  const rows=(data.publishers||[]).map(p=>({...p,views:num(p.xViews??p.views),likes:num(p.xLikes??p.likes),
    reposts:num(p.xShares??p.reposts),replies:num(p.xComments??p.replies),clicks:num(p.clicks)}));
  const d=normalCampaign('of-terms','OF Terms','article',rows,{source:'OF_REPORT',at:data.checkedAt},{
    trackedClicks:sum(rows,p=>p.clicks),history:data.history||[],
    clickHistory:Array.isArray(data.activity)?data.activity:null,clickHistoryCheckedAt:data.checkedAt||null,clickHistoryReady:Array.isArray(data.activity),
    sourceNote:'OF Terms post clicks are recorded by the existing OF reporting feed. Do not mix them with Short.io click counts.'
  });
  return d;
}
function boostsCampaign(data,articleRows=[]){
  const grouped=groupArticleRtSpend(articleRows);
  if(!data?.ok||!Array.isArray(data.tweets))return {...normalCampaign('guru-rts','Guru RTs / X Boosts','boost',[],{source:'UNAVAILABLE',error:'X RT boosts feed unavailable'}),
    unavailable:true,articleRtGroups:grouped.originals,articleRtUnlinked:grouped.unlinked,articleRtSummary:grouped.summary};
  const groups=new Map(grouped.originals.map(g=>[g.postId,g]));
  const promoted=data.tweets.map(t=>{
    const postUrl='https://x.com/'+t.handle+'/status/'+t.id,rt=groups.get(String(t.id));
    return {...t,publisher:t.name||t.handle,postUrl,
      posted:true,paid:t.spend!==null&&t.spend!==undefined,cost:num(t.spend),views:num(t.views),likes:num(t.likes),
      reposts:num(t.reposts),replies:num(t.replies),metricAt:t.at||null,
      linkedRtPaidSpend:rt?.paidSpendKnown??null,linkedRtPaidCount:rt?.paidCount??0};
  });
  // Other posts by the same Guru accounts that were promoted with paid RTs (not in the boosts feed).
  const known=new Set(promoted.map(r=>String(r.id))),names=new Map(promoted.map(r=>[String(r.handle||'').toLowerCase(),r.publisher]));
  const extra=grouped.originals.filter(g=>!known.has(g.postId)).map(g=>{
    const handle=handleOf(g.postUrl);
    return {id:g.postId,handle,publisher:names.get(handle.toLowerCase())||handle,postUrl:'https://x.com/'+handle+'/status/'+g.postId,
      posted:true,paid:false,cost:null,views:g.views,likes:g.likes,reposts:g.reposts,replies:g.replies,metricAt:g.metricAt,
      linkedRtPaidSpend:g.paidSpendKnown,linkedRtPaidCount:g.paidCount,source:'PAID_RT_ORIGINAL'};
  });
  const rows=[...promoted,...extra];
  // Guru Promotion spend is the paid RTs of its accounts' posts (from the Article RTs tab).
  // X platform boost spend is a different cost type and stays separate.
  const base=normalCampaign('guru-rts','Guru RTs / X Boosts','boost',rows,{source:'X_RTS',at:rows.map(t=>t.metricAt).filter(Boolean).sort().at(-1)||null});
  const rtMoney=moneyRows(articleRows),rtOpen=committedRows(articleRows);
  return {...base,boostSpendKnown:base.paidSpendKnown,paidSpendKnown:rtMoney.known,unknownPaidCosts:rtMoney.unknown,paidCount:rtMoney.paidCount,
    committedUnpaidKnown:rtOpen.known,committedUnpaidCount:rtOpen.count,paidReposts:articleRows,
    articleRtGroups:grouped.originals,articleRtUnlinked:grouped.unlinked,articleRtSummary:grouped.summary,
    classificationNote:'X boosted original-post spend and sheet-paid RT placements are separate cost types; never combine them.'};
}
// Match Article RT placements to already monitored original X posts by exact status ID.
// These are ORIGINAL post views, not individual RT impressions. Reuse provider readings;
// never fetch X again or allocate the same article views once per paid reposter.
export function enrichArticleRtMetrics(articleRows=[],feeds={}){
  const known=new Map();
  const candidates=[];
  for(const p of [...(feeds.gta?.publishers||[]),...(feeds.gta?.originals?.publishers||[]),...(feeds.gta?.mandy?.publishers||[])])
    candidates.push({p,source:'GTA_X',at:p.metricAt,views:p.views,likes:p.likes,reposts:p.reposts,replies:p.replies});
  for(const p of feeds.of?.publishers||[])
    candidates.push({p,source:'OF_X',at:p.xUpdated||p.metricLastVerifiedAt,views:p.xViews??p.views,likes:p.xLikes??p.likes,reposts:p.xShares??p.reposts,replies:p.xComments??p.replies});
  for(const p of feeds.dashboard?.placements||[])
    candidates.push({p,source:'ARTICLE_X',at:p.xUpdated||p.metricLastVerifiedAt,views:p.xViews,likes:p.xLikes,reposts:p.xShares,replies:p.xComments});
  for(const p of feeds.boosts?.tweets||[])
    candidates.push({p:{postUrl:'https://x.com/'+p.handle+'/status/'+p.id},source:'X_RTS',at:p.at,views:p.views,likes:p.likes,reposts:p.reposts,replies:p.replies});
  for(const m of Object.values(feeds.articleOriginals?.metrics||[]))
    if(m?.postUrl)candidates.push({p:{postUrl:m.postUrl},source:'ARTICLE_RT_X',
      at:m.at,views:m.views,likes:m.likes,reposts:m.shares,replies:m.comments});
  for(const candidate of candidates){
    const id=xPost(candidate.p.postUrl);
    if(!id||num(candidate.views)===null)continue;
    const prior=known.get(id),date=Date.parse(candidate.at||'')||0;
    if(!prior||date>(Date.parse(prior.metricAt||'')||0))
      known.set(id,{views:num(candidate.views),likes:num(candidate.likes),reposts:num(candidate.reposts),replies:num(candidate.replies),metricAt:candidate.at||null,metricSource:candidate.source});
  }
  return articleRows.map(p=>{
    // The final LINK field names the original X post, even where the RT's
    // own POSTED? checkbox is still false. Its organic views are verifiable
    // independently of whether this paid reposter has published anything.
    const id=xPost(p.sourcePostUrl||p.postUrl),metric=id?known.get(id):null;
    return metric?{...p,...metric,sourceOriginalViews:metric.views,sourceViews:true}:
      {...p,sourceOriginalViews:null,sourceViews:false};
  });
}

function dashboardCampaigns(data){
  if(!data?.ok||!Array.isArray(data.placements))return [{...normalCampaign('x-articles','X Articles','article',[],{source:'UNAVAILABLE',error:'Article tracker unavailable'}),unavailable:true}];
  const rows=data.placements.map(p=>({...p,views:num(p.xViews),likes:num(p.xLikes),
    reposts:num(p.xShares),replies:num(p.xComments),clicks:num(p.clicks)}));
  const codes=new Set(rows.map(p=>String(p.code||'')).filter(Boolean));
  const cutoff=Date.now()-21*24*60*60*1000;
  const history=(Array.isArray(data.metricHistory)?data.metricHistory:[])
    .filter(h=>codes.has(String(h.code||''))&&Date.parse(h.at||'')>=cutoff&&num(h.views)!==null);
  const clickHistory=(Array.isArray(data.clickActivity)?data.clickActivity:[])
    .filter(h=>codes.has(String(h.code||''))&&Date.parse(String(h.date||'')+'T12:00:00Z')>=cutoff&&num(h.clicks)!==null);
  const general=normalCampaign('x-articles','X Articles','article',rows,{source:'ARTICLE_TRACKER',at:data.sheetVerifiedAt},{
    trackedClicks:sum(rows,p=>p.clicks),history,clickHistory:data.trackingReady===false?null:clickHistory,
    clickHistoryCheckedAt:data.checkedAt||null,clickHistoryReady:Array.isArray(data.clickActivity)&&data.trackingReady!==false,
    spendPeriod:'All-time across all tracked X Article placements'
  });
  const knownCampaigns=(data.campaigns||[]).filter(c=>c&&c.id).map(c=>{
    const relevant=rows.filter(p=>p.campaignId===c.id),cost=moneyRows(relevant);
    return {id:c.id,name:c.name||c.id,status:c.status||null,
      placements:relevant.length,published:relevant.filter(p=>p.posted).length,
      paidSpendKnown:cost.known,unknownPaidCosts:cost.unknown,
      xViews:uniqueSum(relevant.filter(p=>p.posted),p=>p.views),
      trackedClicks:sum(relevant,p=>p.clicks)};
  }).filter(c=>c.placements||c.status);
  general.sourceCampaigns=knownCampaigns;
  return [general];
}
export function assembleCampaignOverview(sources){
  const src=sources||{},errors=[];
  for(const [name,v] of Object.entries(src))if(v?.error)errors.push(name+': '+diagnostic(v.error));
  const gta=src.gta?.data,of=src.of?.data,boosts=src.boosts?.data,dashboard=src.dashboard?.data,article=src.articleRts?.data;
  const allArticleRts=enrichArticleRtMetrics(article?.rows||[],{gta,of,boosts,dashboard,
    articleOriginals:src.articleOriginals?.data});
  // A paid RT of a Guru Promotion account's post is Guru Promotion spend; every other paid RT
  // (including RTs with no original-post link) stays with X Articles. Each RT is counted once.
  const guruHandles=new Set((boosts?.ok&&Array.isArray(boosts.tweets)?boosts.tweets:[]).map(t=>String(t.handle||'').toLowerCase()).filter(Boolean));
  const isGuruRt=p=>guruHandles.has(handleOf(p.sourcePostUrl||p.postUrl).toLowerCase());
  const guruRts=allArticleRts.filter(isGuruRt),linkedArticleRts=allArticleRts.filter(p=>!isGuruRt(p));
  const rtGroups=groupArticleRtSpend(linkedArticleRts);
  const originalsHistory=[...(src.articleOriginals?.data?.history||[]),
    ...(gta?.history||[]),...(gta?.originals?.history||[]),...(gta?.mandy?.history||[]),
    ...(dashboard?.metricHistory||[]),...(of?.history||[]),
    ...(boosts?.tweets||[]).flatMap(t=>(t.history||[]).map(h=>({...h,id:t.id})))];
  const historyFor=ids=>originalsHistory.map(h=>({...h,id:String(h.postId||h.id||'')})).filter(h=>ids.has(h.id)&&num(h.views)!==null&&h.at);
  const rtCampaign=normalCampaign('article-rts','X Article Boosts','rt',linkedArticleRts,
    {source:article?.source||'UNAVAILABLE',at:article?.at,warning:article?.warning,error:article?.error},{
      views:rtGroups.summary.originalViewsKnown,
      likes:rtGroups.summary.originalLikesKnown,
      reposts:rtGroups.summary.originalRepostsKnown,
      replies:rtGroups.summary.originalRepliesKnown,
      interactions:rtGroups.summary.originalInteractionsKnown,
      engagementRate:rtGroups.summary.originalEngagementRate,
      viewScope:'ORIGINAL_X_POSTS',originalsWithViews:rtGroups.summary.originalsWithViews,
      originalPosts:rtGroups.summary.originalPosts,articleRtGroups:rtGroups.originals,
      history:historyFor(new Set(rtGroups.originals.map(g=>g.postId))),
      articleRtUnlinked:rtGroups.unlinked,articleRtSummary:rtGroups.summary,
      trackingWarning:rtGroups.summary.unlinkedPaidCount?
        rtGroups.summary.unlinkedPaidCount+' paid RT entries have no original X post URL; their costs are retained but cannot be assigned to an original post.':null,
      sourceNote:'Original X post views are measured automatically; these are NOT individual paid retweet impressions. Individual RTs need their own X post URL to measure impressions separately.'
    });
  const guruCampaign=boostsCampaign(boosts,guruRts);
  guruCampaign.history=historyFor(new Set((guruCampaign.rows||[]).map(r=>String(r.id||''))));
  const campaigns=[
    gtaCampaign(gta,'qrts'),gtaCampaign(gta,'originals'),...[gtaCampaign(gta,'mandy'),gtaCampaign(gta,'instagram')].filter(Boolean),ofCampaign(of),guruCampaign,
    rtCampaign,
    ...dashboardCampaigns(dashboard),
    {...normalCampaign('ai-harness','AI Harness','planned',[],{source:'NOT_CONNECTED',error:'No live campaign-specific feed linked'}),unavailable:true},
    {...normalCampaign('discord','Discord First Earnings','planned',[],{source:'NOT_CONNECTED',error:'Discord growth, KYC and earning-creator source not connected'}),unavailable:true}
  ];
  // No overall spend/view sum. Some data feeds overlap, and platform views are not deduplicated reach.
  return {ok:true,scope:'lifetime-campaign-reporting-v1',checkedAt:new Date().toISOString(),
    campaigns,errors,sourceHealth:Object.fromEntries(Object.entries(src).map(([k,v])=>[k,{ok:!!v?.data&&!v.error,error:v?.error?diagnostic(v.error):null}])),
    note:'Lifetime campaign counters; no mandatory date windows. Published, paid, spend, X views and attributed clicks are separate. Missing sign-up, KYC and first-earnings integrations are unknown, never zero.'};
}
export async function readReportParts(origin,{fetcher=fetch,readRts=readArticleRts,force=false,reuseReports=false}={}){
  const paths={gta:'gta-report',of:'of-report',boosts:'boosts',dashboard:'dashboard'};
  const names=Object.keys(paths);
  const tasks=names.map(async name=>{
    const url=new URL('/.netlify/functions/'+paths[name]+(force&&reuseReports?(name==='gta'?'?reuse=1':''):(force&&name!=='boosts'?'?refresh=1':'')),origin);
    const response=await fetcher(url,{cache:'no-store',signal:AbortSignal.timeout(24000)});
    if(!response.ok)throw Error(paths[name]+' HTTP '+response.status);
    const value=await response.json();
    if(!value?.ok)throw Error(value?.error||paths[name]+' returned no verified data');
    return value;
  });
  const outcomes=await Promise.allSettled([...tasks,readRts({force})]);
  const parts=Object.fromEntries([...names,'articleRts'].map((name,i)=>
    [name,outcomes[i].status==='fulfilled'?{data:outcomes[i].value}:{error:diagnostic(outcomes[i].reason)}]));
  const rows=parts.articleRts?.data?.rows||[];
  // The independently monitored X feeds already contain most originals.
  // Only request provider metrics for the unmonitored original post IDs.
  const previous=enrichArticleRtMetrics(rows,{
    gta:parts.gta?.data,of:parts.of?.data,boosts:parts.boosts?.data,dashboard:parts.dashboard?.data});
  const missing=previous.filter(p=>xPost(p.sourcePostUrl||p.postUrl)&&!p.sourceViews);
  if(missing.length){
    try{parts.articleOriginals={data:await readArticleOriginalMetrics(missing,{fetcher,force})};}
    catch(error){parts.articleOriginals={error:diagnostic(error)};}
  }
  return parts;
}
// Use the same ledger for live and cached API responses.
function withReportedSpend(overview){
  const data=applyPaymentDates(overview);
  return {...data,campaigns:(data.campaigns||[]).map(c=>Finance.isGtaSource(c)?{...c,spendKnown:Finance.allocatedGtaSpend(c).value}:c)};
}
export default async function handler(request){
  if(!['GET','HEAD'].includes(request.method))return Response.json({ok:false,error:'METHOD_NOT_ALLOWED'},{status:405});
  const force=new URL(request.url).searchParams.has('refresh');
  const store=overviewStore();
  let saved=null;
  try{saved=await store.get('latest',{type:'json'});}catch{}
  if(!force&&saved?.data?.ok&&saved.data.clickHistoryVersion===2&&saved.data.viewHistoryVersion===1&&Date.now()-Date.parse(saved.at)<OVERVIEW_CACHE_TTL){
    return Response.json({...withReportedSpend(saved.data),cached:true,cacheAgeMs:Math.max(0,Date.now()-Date.parse(saved.at))},{
      headers:{'cache-control':'no-store','x-content-type-options':'nosniff'}
    });
  }
  try{
    const parts=await readReportParts(request.url,{force,reuseReports:new URL(request.url).searchParams.has('reuse')});
    // A failed source can change RT attribution and totals. Retain the coherent prior snapshot rather than cache a degraded replacement.
    const result={...withReportedSpend(assembleCampaignOverview(parts)),clickHistoryVersion:2,viewHistoryVersion:1};
    // A failed unrelated provider must not roll back verified clicks or current placements.
    // Keep the failed source's own canonical groups; update healthy groups from the new snapshot.
    if(saved?.data?.ok&&Object.values(parts).some(part=>part.error)){
      const old=new Map(saved.data.campaigns.map(c=>[c.id,c]));
      const owners={'gta-qrts':['gta'],'gta-originals':['gta'],'gta-mandy':['gta'],'gta-instagram':['gta'],'x-articles':['dashboard'],'of-terms':['of'],'article-rts':['articleRts','articleOriginals'],'guru-rts':['articleRts','articleOriginals','boosts']};
      const failed=c=>(owners[c.id]||[]).some(k=>parts[k]?.error)||c.unavailable||c.sourceStale;
      result.campaigns=result.campaigns.map(c=>failed(c)&&old.has(c.id)?{...old.get(c.id),sourceStale:true,dataWarning:'Source unavailable; showing last verified campaign data.'}:c);
      for(const c of old.values())if(!result.campaigns.some(x=>x.id===c.id)&&failed(c))result.campaigns.push({...c,sourceStale:true});
      result.stale=true;
    }
    // Retain coherent verified groups across independent source failures.
    try{await store.setJSON('latest',{at:new Date().toISOString(),data:result});}catch{}
    return Response.json({...result,cached:false},{headers:{'cache-control':'no-store','x-content-type-options':'nosniff'}});
  }catch{
    if(saved?.data?.ok){
      const warning='Overview refresh failed; showing the last verified campaign snapshot.';
      return Response.json({...withReportedSpend(saved.data),cached:true,stale:true,errors:[...(saved.data.errors||[]),warning]},{
        headers:{'cache-control':'no-store','x-content-type-options':'nosniff'}
      });
    }
    return Response.json({ok:false,error:'Reporting feed unavailable; existing campaigns remain accessible.'},{status:503});
  }
}
