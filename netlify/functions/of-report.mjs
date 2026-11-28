import {readOfPublishers,readOfEvents} from '../lib/of-report.mjs';
import {json,getCounts} from '../lib/shared.mjs';
import {cachedReport} from '../lib/report-cache.mjs';
import {getStore} from '@netlify/blobs';
import {applyMetrics,refreshMetrics,postIdentity,readMetricHistory} from '../lib/metrics.mjs';

export function createOfReport({readPublishers=readOfPublishers,readEvents=readOfEvents,
  metricsStore=()=>getStore({name:'fanvue-of-metrics-v1',consistency:'strong'}),
  refresh=refreshMetrics,cache=cachedReport}={}){
  return async (req,context)=>{
    if(!['GET','HEAD','POST'].includes(req.method))return json({ok:false,error:'METHOD_NOT_ALLOWED'},405);
    const manual=req.method==='POST';
    const load=async()=>{
    try{
      const [publishers,events]=await Promise.all([readPublishers(),readEvents()]);
      const storage=metricsStore();
      let metrics=await storage.get('latest',{type:'json'})||{metrics:{}};
      let refreshResult={};
      // Populate newly published posts without requiring a manual button press.
      const missing=publishers.some(p=>{
        const id=p.posted&&postIdentity(p.postUrl)?.id,m=metrics.metrics?.[p.code];
        return id&&(!m?.at||m.postId!==id||!['views','likes','comments','shares'].every(k=>Number.isFinite(m[k])));
      });
      const autoDue=missing&&Date.now()-(Date.parse(metrics.lastAttemptAt||'')||0)>=300000;
      if(manual||autoDue){
        const now=Date.now(),next=Number(metrics.lastManualAt||0)+300000;
        if(now<next)refreshResult={skipped:true,retryAfter:Math.ceil((next-now)/1000)};
        else{
          await storage.setJSON('latest',{...metrics,lastManualAt:now});
          metrics=await refresh(publishers.map(p=>({...p,platform:'X'})),{storage});
          await storage.setJSON('latest',{...metrics,lastManualAt:now});
          refreshResult={updated:metrics.updated,total:metrics.total,errors:metrics.errors};
        }
      }
      const measured=applyMetrics(publishers,metrics);
      const history=await readMetricHistory(storage).catch(()=>[]);
      const counts=getCounts(events),groups=new Map();
      const dateFormat=new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/London',year:'numeric',month:'2-digit',day:'2-digit'});
      for(const event of events){
        const parts=Object.fromEntries(dateFormat.formatToParts(new Date(event.timestamp)).map(p=>[p.type,p.value]));
        const date=`${parts.year}-${parts.month}-${parts.day}`,key=date+'|'+event.code;
        const row=groups.get(key)||{date,code:event.code,clicks:0};row.clicks++;groups.set(key,row);
      }
      return json({ok:true,id:'C001',name:'OF Terms X Promo',ready:true,checkedAt:new Date().toISOString(),
        ...refreshResult,history,metricLastSuccessfulAt:metrics.lastSuccessfulAt||null,
        publishers:measured.map(p=>({...p,views:p.xViews??null,likes:p.xLikes??null,reposts:p.xShares??null,replies:p.xComments??null,...(counts[p.code]||{clicks:0,lastClick:'',firstClick:''})})),activity:[...groups.values()]});
    }catch(error){console.warn('OF report unavailable',error?.name, /^[A-Z0-9_]+$/.test(error?.code||'')?error.code:'');return json({ok:false,ready:false,error:'OF spreadsheet or verified click storage is temporarily unavailable. Please retry.'},503);}
    };
    // A manual refresh must never be replaced by a cached GET response.
    return manual?load():cache('of-report-v3',req,context,load);
  };
}
export default createOfReport();
