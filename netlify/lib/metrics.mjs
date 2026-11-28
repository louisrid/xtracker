import {getStore} from '@netlify/blobs';
import {timingSafeEqual} from 'node:crypto';
const bucket=()=>getStore({name:'fanvue-x-metrics-v1',consistency:'strong'});
export const metricAgeLimit=4*3600000;
export function workerAuth(req){
  const supplied=String(req.headers.get('authorization')||'').replace(/^Bearer\s+/i,'');
  return [process.env.TRACKER_WORKER_KEY,process.env.ADMIN_KEY,process.env.API_TOKEN].filter(Boolean).some(secret=>{
    const a=Buffer.from(supplied),b=Buffer.from(secret);return a.length===b.length&&a.length>0&&timingSafeEqual(a,b);
  });
}
export function postIdentity(url){
  const m=String(url||'').match(/^https:\/\/(?:www\.)?(?:x\.com|twitter\.com)\/([A-Za-z0-9_]+)\/status\/(\d+)(?:[/?#]|$)/i);
  return m?{handle:m[1],id:m[2]}:null;
}
export function parseXResponse(data,expectedId,at=new Date().toISOString()){
  const t=data?.tweet;if(String(t?.id||t?.id_str||'')!==expectedId)throw new Error('X provider returned a different post');
  const n=v=>v!==null&&v!==''&&v!==undefined&&Number.isFinite(Number(v))&&Number(v)>=0?Number(v):null;
  const views=n(t.views),likes=n(t.likes),comments=n(t.replies),shares=n(t.retweets);
  if([views,likes,comments,shares].some(v=>v===null))throw new Error('X provider did not return all four metrics');
  const title=typeof t.article?.title==='string'?t.article.title.trim():'';
  return {postId:expectedId,views,likes,comments,shares,at,...(title&&title.length<=300?{articleTitle:title}:{}),
    engagementRate:views>0&&comments!==null&&shares!==null?Math.round(10000*(likes+comments+shares)/views)/100:null};
}
export async function refreshMetrics(placements,{fetcher=fetch,storage=bucket()}={}){
  const previous=await storage.get('latest',{type:'json'})||{metrics:{}};
  const metrics={...previous.metrics},errors=[],now=new Date().toISOString();let updated=0;
  const posts=placements.filter(p=>p.posted===true&&p.platform==='X'&&postIdentity(p.postUrl));
  async function refreshOne(p){
    const identity=postIdentity(p.postUrl);
    try{
      const response=await fetcher('https://api.fxtwitter.com/'+encodeURIComponent(identity.handle)+'/status/'+identity.id,
        {signal:AbortSignal.timeout(10000),headers:{accept:'application/json'}});
      if(!response.ok)throw new Error('X provider HTTP '+response.status);
      const m=parseXResponse(await response.json(),identity.id);
      const prior=metrics[p.code];
      if(['views','likes','comments','shares'].some((k,i)=>m[k]===0&&((prior?.postId===identity.id&&prior[k]>0)||p[['xViews','xLikes','xComments','xShares'][i]]>0)))
        throw new Error('X provider returned zero for a previously verified metric');
      metrics[p.code]={...m,code:p.code,sourceTab:p.sourceTab,sourceRow:p.sourceRow,publisher:p.publisher,lastAttemptAt:now,error:''};updated++;
    }catch(e){
      errors.push({code:p.code,error:String(e.message||e)});
      const existing=metrics[p.code]||{};
      const samePost=(!existing.at&&!existing.postId)||existing.postId===identity.id;
      metrics[p.code]={...(samePost?existing:{}),code:p.code,postId:identity.id,
        sourceTab:p.sourceTab,sourceRow:p.sourceRow,publisher:p.publisher,
        lastAttemptAt:now,lastFailureAt:now,error:String(e.message||e)};
    }
  }
  for(let i=0;i<posts.length;i+=5)await Promise.all(posts.slice(i,i+5).map(refreshOne));
  const status={lastAttemptAt:now,lastSuccessfulAt:updated?new Date().toISOString():previous.lastSuccessfulAt||'',updated,total:posts.length,errors,metrics,provider:'FxTwitter',intervalHours:2};
  await storage.setJSON('latest',status);
  if(updated)await storage.setJSON('runs/'+now,{at:now,metrics:Object.values(metrics).filter(m=>m.at&&m.lastAttemptAt===now&&!m.error)});
  return status;
}
export async function readMetricState(){return await bucket().get('latest',{type:'json'})||{metrics:{},lastSuccessfulAt:'',errors:[],intervalHours:2,provider:'FxTwitter'};}
export function applyMetrics(placements,state,now=Date.now()){
  return placements.map(p=>{
    const m=state.metrics?.[p.code],id=postIdentity(p.postUrl)?.id;
    if(!m||m.postId!==id)return p;
    const sourceAt=Date.parse(p.xUpdated||'')||0;
    const savedAt=Date.parse(m.at||'')||0;
    const sheetVerified=sourceAt>0&&Number.isFinite(p.xViews)&&Number.isFinite(p.xLikes);
    const blobVerified=savedAt>0&&Number.isFinite(m.views)&&Number.isFinite(m.likes);
    // A failed lookup cannot turn a verified nonzero reading into zero or null.
    const suspiciousZero=blobVerified&&['views','likes','comments','shares'].some((k,i)=>m[k]>0&&p[['xViews','xLikes','xComments','xShares'][i]]===0);
    const useBlob=blobVerified&&(!sheetVerified||savedAt>=sourceAt||suspiciousZero);
    const keepVerified=(latest,verified)=>latest===0&&verified>0?verified:latest;
    const current=useBlob?{...p,xViews:keepVerified(m.views,p.xViews),xLikes:keepVerified(m.likes,p.xLikes),
      xComments:Number.isFinite(m.comments)?keepVerified(m.comments,p.xComments):p.xComments,
      xShares:Number.isFinite(m.shares)?keepVerified(m.shares,p.xShares):p.xShares,
      xUpdated:m.at,engagementRate:m.engagementRate,metricSource:'FxTwitter'}:{...p};
    const lastVerifiedAt=current.xUpdated||'';
    const failed=Boolean(m.error);
    return {...current,...(m.articleTitle?{articleTitle:m.articleTitle}:{}),metricError:m.error||'',metricLastVerifiedAt:lastVerifiedAt,
      metricStatus:failed?(lastVerifiedAt?'last-known-good':'unverified'):
        (!lastVerifiedAt?'unverified':now-Date.parse(lastVerifiedAt)>metricAgeLimit?'stale':'ok'),
      metricNote:failed&&lastVerifiedAt?'X stats temporarily unavailable. Showing last recorded figures.':''};
  });
}
export async function readMetricHistory(storage=bucket()){
  const entries=[],cutoff=new Date(Date.now()-91*86400000).toISOString();
  for await(const page of storage.list({prefix:'runs/',paginate:true}))entries.push(...page.blobs.filter(b=>b.key.slice(5)>=cutoff));
  const days=new Map();
  for(let i=0;i<entries.length;i+=20){
    const runs=await Promise.all(entries.slice(i,i+20).map(b=>storage.get(b.key,{type:'json'})));
    for(const run of runs)for(const m of run?.metrics||[]){
      const key=m.code+'|'+m.at.slice(0,10),prev=days.get(key);
      if(!prev||prev.at<m.at)days.set(key,{...m,date:m.at.slice(0,10),platform:'X',availability:'available'});
    }
  }
  return [...days.values()].sort((a,b)=>a.at.localeCompare(b.at));
}
