/* Fanvue dashboard core: formatting, Europe/London week bucketing and the
   data-honesty rules shared by every page. Pure functions only: no DOM and no
   network, so the same file runs in the browser and in node tests.

   Rules enforced here (SPECS §5-6, DESIGN §4.1 and §5):
   - Missing values are never shown as zero. Every metric is a descriptor with a
     state: value, partial, stale, na (Not available), notConnected, notTracked
     or loading, plus a reason that the interface shows on demand.
   - Overlapping campaign-overview objects are never summed. Home totals are only
     built from records proven disjoint at runtime; otherwise they are labelled.
   - Click providers retain their counting definitions. A mixed-source recorded
     click aggregate must disclose those definitions and cannot imply unique or human-only visitors.
   - Weekly series come only from dated events or dated snapshots, bucketed into
     Monday-Sunday Europe/London weeks, with the current week marked incomplete. */
(function(root){
  'use strict';
  const TZ='Europe/London';
  const blank=v=>v===null||v===undefined||v==='';
  const num=v=>blank(v)||!Number.isFinite(Number(v))?null:Number(v);
  const nf=new Intl.NumberFormat('en-GB',{maximumFractionDigits:0});
  const sig3=v=>{const s=Number(v).toPrecision(3);return String(Number(s));};

  /* ---------- formatting ---------- */
  const full=v=>num(v)===null?'':nf.format(Math.round(num(v)));
  function compact(v){
    const n=num(v);if(n===null)return '';
    const a=Math.abs(n);
    // Owner (26 Nov): at most one decimal place, and none when it is .0 (2.65M -> 2.7M, 10.0K -> 10K).
    const d1=x=>String(Math.abs(x)>=100?Math.round(x):Math.round(x*10)/10);
    if(a>=1e9)return d1(n/1e9)+'B';
    if(a>=1e6)return d1(n/1e6)+'M';
    if(a>=1e4)return d1(n/1e3)+'K';
    return nf.format(Math.round(n));
  }
  // Owner (26 Nov): money shows at most one decimal place and drops a trailing .0 ($6.26 -> $6.3, $10,000.00 -> $10,000).
  function money(v,dp=2){
    const n=num(v);if(n===null)return '';
    return (n<0?'-':'')+'$'+new Intl.NumberFormat('en-GB',{minimumFractionDigits:0,maximumFractionDigits:dp}).format(Math.abs(n));
  }
  // Strip money: whole dollars below $100K, compact above.
  const moneyShort=v=>{const n=num(v);if(n===null)return '';return Math.abs(n)>=1e5?'$'+compact(n):money(n,0);};
  // A plain ratio (clicks per post, clicks per dollar): at most one decimal, no trailing .0, no currency sign.
  const rate=v=>{const n=num(v);if(n===null)return '';return new Intl.NumberFormat('en-GB',{minimumFractionDigits:0,maximumFractionDigits:1}).format(n);};
  const signed=v=>{const n=num(v);if(n===null)return '';return (n>0?'+':n<0?'−':'')+full(Math.abs(n));};

  /* ---------- dates (Europe/London) ---------- */
  const dayFmt=new Intl.DateTimeFormat('en-GB',{timeZone:TZ,year:'numeric',month:'2-digit',day:'2-digit'});
  function londonDay(value){
    const d=value instanceof Date?value:new Date(value);
    if(Number.isNaN(d.getTime()))return '';
    const p=Object.fromEntries(dayFmt.formatToParts(d).filter(x=>x.type!=='literal').map(x=>[x.type,x.value]));
    return p.year+'-'+p.month+'-'+p.day;
  }
  const validDay=s=>/^\d{4}-\d{2}-\d{2}$/.test(String(s||''));
  const utcNoon=s=>new Date(s+'T12:00:00Z');
  function addDays(s,n){const d=utcNoon(s);d.setUTCDate(d.getUTCDate()+n);return d.toISOString().slice(0,10);}
  function weekStart(s){const d=utcNoon(s);return addDays(s,-((d.getUTCDay()+6)%7));}
  const months=['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  const parts=s=>{const [y,m,d]=s.split('-').map(Number);return {y,m,d};};
  const dayShort=s=>{if(!validDay(s))return '';const p=parts(s);return p.d+' '+months[p.m-1];};
  const dayLong=s=>{if(!validDay(s))return '';const p=parts(s);return p.d+' '+months[p.m-1]+' '+p.y;};
  function weekLabel(ws){
    const we=addDays(ws,6),a=parts(ws),b=parts(we);
    if(a.y!==b.y)return dayLong(ws)+' – '+dayLong(we);
    if(a.m!==b.m)return a.d+' '+months[a.m-1]+' – '+b.d+' '+months[b.m-1]+' '+b.y;
    return a.d+'–'+b.d+' '+months[b.m-1]+' '+b.y;
  }
  const timeFmt=new Intl.DateTimeFormat('en-GB',{timeZone:TZ,hour:'2-digit',minute:'2-digit',hour12:false});
  function stamp(value){
    const d=value instanceof Date?value:new Date(value);
    if(!value||Number.isNaN(d.getTime()))return '';
    return dayLong(londonDay(d))+', '+timeFmt.format(d)+' UK';
  }
  function weeksFrom(first,now=Date.now()){
    const out=[],end=weekStart(londonDay(now));
    if(!validDay(first))return out;
    for(let w=weekStart(first);w<=end&&out.length<520;w=addDays(w,7))out.push(w);
    return out;
  }
  const point=(week,value,current,extra={})=>({week,label:dayShort(week),range:weekLabel(week),value,incomplete:week===current,...extra});

  /* Weekly sums of dated events (clicks). A week inside the counting period with
     no events is a verified zero; nothing is reported before the first counted day. */
  function eventSeries(rows,{day=r=>r.date,value=r=>r.clicks,include=()=>true,from='',now=Date.now()}={}){
    const totals=new Map();let first=validDay(from)?from:'';
    for(const r of rows||[]){
      if(!include(r))continue;
      const d=day(r),v=num(value(r));
      if(!validDay(d)||v===null)continue;
      if(!first||d<first)first=d;
      const w=weekStart(d);totals.set(w,(totals.get(w)||0)+v);
    }
    if(!first)return [];
    const current=weekStart(londonDay(now));
    return weeksFrom(first,now).map(w=>point(w,totals.get(w)||0,current));
  }

  // Daily event counts from verified dated counters. Never a running total and
  // never backfilled before the first observed tracking date.
  function dailyEventSeries(rows,{day=r=>r.date,value=r=>r.clicks,include=()=>true,now=Date.now(),days=14}={}){
    const totals=new Map();let first='';
    for(const r of rows||[]){if(!include(r))continue;const d=day(r),v=num(value(r));if(!validDay(d)||v===null)continue;if(!first||d<first)first=d;totals.set(d,(totals.get(d)||0)+v);}
    if(!first)return [];
    const today=londonDay(now),start=addDays(today,-days+1)>first?addDays(today,-days+1):first,out=[];
    for(let d=start;d<=today;d=addDays(d,1))out.push({week:d,label:dayShort(d),range:dayLong(d),value:totals.get(d)||0,incomplete:d===today});
    return out;
  }

  /* Cumulative latest-reading totals at each week end, from dated snapshots of
     individual posts (e.g. X view readings). Never derived from a lifetime total. */
  function snapshotSeries(rows,{id=r=>r.id,at=r=>r.at,value=r=>r.views,now=Date.now()}={}){
    const readings=[];
    for(const r of rows||[]){
      const key=id(r),d=londonDay(at(r)),v=num(value(r)),t=Date.parse(at(r));
      if(blank(key)||!d||v===null||!Number.isFinite(t))continue;
      readings.push({key:String(key),day:d,t,v});
    }
    if(!readings.length)return [];
    readings.sort((a,b)=>a.t-b.t);
    const current=weekStart(londonDay(now));
    const latest=new Map();let i=0;
    return weeksFrom(readings[0].day,now).map(w=>{
      const end=addDays(w,6);
      while(i<readings.length&&readings[i].day<=end){latest.set(readings[i].key,readings[i].v);i++;}
      let total=0;for(const v of latest.values())total+=v;
      return point(w,total,current,{count:latest.size});
    });
  }

  /* Daily view readings from dated per-post snapshots (Europe/London days).
     total: sum of each post's latest reading at the end of each day.
     gained: views added that day, from each post's last reading the day before. A post published
     that day or the day before (born) starts from 0, so a new post's first views count on the day it
     is first read. An older post first read late starts from its first reading, so its lifetime views
     never show as one day's gain. */
  function dailySeries(rows,{id=r=>r.id,at=r=>r.at,value=r=>r.views,born=()=>null,now=Date.now(),days=14}={}){
    const readings=[];
    for(const r of rows||[]){
      const key=id(r),d=londonDay(at(r)),v=num(value(r)),t=Date.parse(at(r));
      if(blank(key)||!d||v===null||!Number.isFinite(t))continue;
      readings.push({key:String(key),day:d,t,v});
    }
    if(!readings.length)return {total:[],gained:[]};
    readings.sort((a,b)=>a.t-b.t);
    const today=londonDay(now),first=readings[0].day,start=addDays(today,-(days-1))>first?addDays(today,-(days-1)):first;
    const latest=new Map(),firstRead=new Map(),readDay=new Map();let i=0,prev=null;const total=[],gained=[];
    const dayPoint=(d,value,extra)=>({week:d,label:dayShort(d),range:dayLong(d),value,incomplete:d===today,...extra});
    for(let d=first;d<=today;d=addDays(d,1)){
      while(i<readings.length&&readings[i].day<=d){const r=readings[i];if(!firstRead.has(r.key))firstRead.set(r.key,r);latest.set(r.key,r.v);readDay.set(r.key,r.day);i++;}
      const snap=new Map(latest);
      if(d>=start){
        let sum=0;for(const v of snap.values())sum+=v;
        total.push(dayPoint(d,sum,{count:snap.size}));
        // Baseline: the post's last reading the day before, or its first reading if it was first read that day.
        let g=0,n=0,fresh=0;
        for(const [k,v] of snap){
          if(readDay.get(k)!==d)continue;
          let base=null;
          if(prev?.has(k)&&readings.some(r=>r.key===k&&r.day===addDays(d,-1)))base=prev.get(k);
          else if(firstRead.get(k).day===d){
            const b=num(born(k)),bd=b!==null?londonDay(b):'';
            if(bd===d){base=0;fresh++;}
          }
          if(base!==null){g+=Math.max(0,v-base);n++;}
        }
        gained.push(dayPoint(d,n?g:null,{count:n,fresh}));
      }
      prev=snap;
    }
    return {total,gained};
  }

  /* Discord membership: point-in-time snapshots, never summed. End members is the
     last snapshot in the week; net growth needs the previous week's last snapshot. */
  function memberWeeks(history,now=Date.now()){
    const rows=(history||[]).filter(h=>validDay(h?.date)&&Number.isSafeInteger(h.memberCount)).slice().sort((a,b)=>a.date.localeCompare(b.date));
    if(!rows.length)return [];
    const current=weekStart(londonDay(now)),byWeek=new Map();
    for(const h of rows){const w=weekStart(h.date);const e=byWeek.get(w)||{first:h,last:h,count:0};e.last=h;e.count++;byWeek.set(w,e);}
    let prev=null;
    return weeksFrom(rows[0].date,now).map(w=>{
      const e=byWeek.get(w);
      const start=prev&&weekStart(prev.date)===addDays(w,-7)?prev.memberCount:null,end=e?e.last.memberCount:null;
      const out=point(w,start!==null&&end!==null?end-start:null,current,{start,end,snapshots:e?.count||0,lastDate:e?.last.date||''});
      if(e)prev=e.last;
      return out;
    });
  }

  // The latest verified count supersedes an older reading on the same day.
  // Approximate invite counts are a different source and never replace bot history.
  function memberReadings(members){
    const rows=(members?.history||[]).filter(h=>validDay(h?.date)&&Number.isSafeInteger(h.memberCount));
    const byDay=new Map(rows.map(h=>[h.date,{...h}]));
    const latest=members?.latest,last=[...byDay.keys()].sort().at(-1);
    if(members?.source!=='DISCORD_INVITE_APPROXIMATE'&&validDay(latest?.date)&&Number.isSafeInteger(latest.memberCount)&&(!last||latest.date>=last))byDay.set(latest.date,{...latest});
    return [...byDay.values()].sort((a,b)=>a.date.localeCompare(b.date));
  }

  /* The most recent weeks that have at least one snapshot. Earlier weeks are never back-filled. */
  const recentWeeks=(history,n=4,now=Date.now())=>memberWeeks(history,now).filter(w=>w.snapshots).slice(-n);

  /* ---------- metric descriptors ---------- */
  const M={
    value:(value,extra={})=>({state:'value',value:num(value),...extra}),
    partial:(value,reason,extra={})=>({state:'partial',value:num(value),reason,...extra}),
    na:(reason,extra={})=>({state:'na',value:null,reason,...extra}),
    notConnected:(reason,extra={})=>({state:'notConnected',value:null,reason,...extra}),
    notTracked:(reason,extra={})=>({state:'notTracked',value:null,reason,...extra}),
    loading:()=>({state:'loading',value:null})
  };
  const hasValue=m=>m&&m.value!==null&&['value','partial','stale'].includes(m.state);

  /* ---------- campaign-overview helpers ---------- */
  const postId=url=>String(url||'').match(/^https:\/\/(?:www\.)?(?:x\.com|twitter\.com)\/[A-Za-z0-9_]{1,15}\/status\/(\d+)(?:[/?#]|$)/i)?.[1]||null;
  const notConnected=c=>!c||c.source==='NOT_CONNECTED';
  const unavailable=c=>!c||c.unavailable===true||c.source==='UNAVAILABLE';
  const OUTCOME_REASON='Not connected: Orion creator outcomes (signups, KYC, earning creators) are not connected yet.';

  function sourceReason(c,what){
    if(!c)return what+' source is not loaded.';
    if(notConnected(c))return 'Not connected: '+(typeof c.unavailable==='string'?c.unavailable:'no campaign-specific feed is linked')+'.';
    if(unavailable(c))return (typeof c.unavailable==='string'?c.unavailable:'Source unavailable')+'.';
    return '';
  }

  // Spend for one overview object. Unknown costs make the figure partial.
  function spendOf(c,{noSpendReason='No paid costs are recorded in this source.'}={}){
    if(notConnected(c)||unavailable(c))return M.na(sourceReason(c,'Spend'));
    const synthetic=(c.rows||[]).filter(r=>r.planned===true&&r.paid===true);
    const adjustment=synthetic.reduce((n,r)=>n+(num(r.cost)||0),0);
    const raw=num(c.paidSpendKnown),known=raw===null?null:raw-adjustment,unknown=num(c.unknownPaidCosts)||0,paid=(num(c.paidCount)||0)-synthetic.length;
    // A connected source with no paid placements contributes nothing; it is not a gap.
    if(known===null&&paid===0)return {...M.na(noSpendReason),noSpend:true};
    if(known===null)return M.na(paid+' paid placements have no recorded cost.');
    if(unknown>0)return M.partial(known,'Known subtotal: '+unknown+' of '+paid+' paid placements have no recorded cost.');
    return M.value(known,{paidCount:paid});
  }
  const isGtaSource=c=>['gta-qrts','gta-originals','gta-mandy','gta-instagram'].includes(c?.id);
  const isGtaRow=r=>['GTA1','GTA2','GTAQ','GTAQ2','GTAM','GTAIG'].includes(r?.campaign);
  // Shared financial ledger. GTA VI allocations are recorded on the allocation date,
  // including after payment; all other placements use confirmed payment dates.
  function financeEntry(row,gta=isGtaRow(row)){
    const paid=row?.paid===true&&row?.planned!==true,cost=num(row?.cost);
    const valid=cost!==null&&cost>=0;
    if(!paid&&!(gta&&valid&&cost>0))return null;
    const allocation=gta&&(row.plannedAt||row.bookedAt),date=allocation||(paid?row.paidAt:'');
    const day=validDay(date)?String(date):date?londonDay(date):'';
    const recorded=num(allocation?row.datedPlannedAmount:row.datedPaidAmount);
    const amount=valid?(recorded===null?cost:Math.max(0,Math.min(cost,recorded))):null;
    const key=row.campaign==='GTAM'&&row.trackingUrl?'GTAM|'+row.trackingUrl:
      row.sourceTab&&row.sourceRow?'sheet|'+row.sourceTab+'|'+row.sourceRow:row.code?'code|'+row.code:row.id?'id|'+row.id:null;
    return {key,cost:valid?cost:null,paid,gta,day,amount};
  }
  function financeSpend(entries,{from,to}={}){
    const seen=new Set(),scoped=!!from&&!!to;let total=0,known=0,dated=0,unknown=0;
    for(const e of entries.filter(Boolean)){
      if(e.key){if(seen.has(e.key))continue;seen.add(e.key);}
      if(e.cost===null){unknown++;continue;}
      known++;
      if(!scoped){total+=e.cost;continue;}
      if(!e.day){unknown++;continue;}
      dated++;if(e.day>=from&&e.day<=to)total+=e.amount??e.cost;
      if(e.amount!==null&&e.amount<e.cost)unknown++;
    }
    total=Math.round(total*100)/100;
    if(scoped&&!dated&&unknown)return M.na('Payment dates are not recorded for these payments or allocations. Weekly spend cannot be inferred from publication dates.',{displayDash:true});
    if(!scoped&&!known&&unknown)return M.na('No recorded costs for eligible placements.',{displayDash:true});
    const reason='Recorded payments and confirmed GTA VI allocations only; other unpaid bookings are excluded.';
    return unknown?M.partial(total,reason+' Some costs or dates are unknown.'):M.value(total,{reason});
  }
  function allocatedGtaSpend(c){
    const paid=spendOf(c);
    if(notConnected(c)||unavailable(c))return paid;
    const rows=c.rows||[];
    if(rows.length)return financeSpend(rows.map(r=>financeEntry(r,true)));
    const planned=num(c.plannedSpendKnown)??rows.filter(r=>r.planned===true).reduce((n,r)=>n+(num(r.cost)||0),0);
    const committed=num(c.committedUnpaidKnown)??rows.filter(r=>r.paid!==true&&r.planned!==true).reduce((n,r)=>n+(num(r.cost)||0),0);
    if(!planned&&!committed)return paid;
    const total=Math.round(((hasValue(paid)?paid.value:0)+planned+committed)*100)/100;
    const reason='Includes '+money(planned)+' planned and '+money(committed)+' committed unpaid GTA VI allocations, plus recorded payments. Not all allocated costs have been paid.';
    return (!hasValue(paid)&&!paid.noSpend)||paid.state==='partial'?M.partial(total,reason+' '+(paid.reason||'')):M.value(total,{reason});
  }
  function addSpend(parts,label){
    const all=parts.filter(Boolean),valid=all.filter(p=>!p.noSpend);
    if(!valid.length||valid.every(p=>!hasValue(p)))return (valid.length?valid:all).find(p=>p.reason)||M.na('No spend recorded.');
    const total=valid.filter(hasValue).reduce((s,p)=>s+p.value,0);
    const missing=valid.filter(p=>!hasValue(p)||p.state==='partial');
    if(missing.length)return M.partial(total,(label?label+': ':'')+'known subtotal. '+missing.map(p=>p.reason).filter(Boolean).join(' '));
    return M.value(total);
  }
  // Post views, deduplicated by post ID across rows; coverage noted when partial.
  function viewsOf(objects,{scope='Post views'}={}){
    const list=objects.filter(Boolean);
    if(!list.length||list.every(c=>notConnected(c)||unavailable(c)))return M.na(sourceReason(list[0],scope));
    const seen=new Map();let withUrl=0,measured=0;
    // A row can carry several posts (r.postViews by post ID); each post is counted once.
    const entries=r=>r.postViews?Object.entries(r.postViews).map(([id,v])=>[id,num(v)]):[[postId(r.postUrl),num(r.views??r.xViews)]];
    for(const c of list)for(const r of c.rows||[])for(const [id,v] of (r.posted===true?entries(r):[])){
      if(!id)continue;
      const prior=seen.get(id);
      if(!prior){withUrl++;if(v!==null)measured++;seen.set(id,{v,at:Date.parse(r.metricAt||r.xUpdated||'')||0});}
      else if(v!==null&&(prior.v===null||(Date.parse(r.metricAt||r.xUpdated||'')||0)>prior.at)){if(prior.v===null)measured++;seen.set(id,{v,at:Date.parse(r.metricAt||r.xUpdated||'')||0});}
    }
    let total=0;for(const x of seen.values())if(x.v!==null)total+=x.v;
    if(!withUrl)return M.na('No published posts with an X post link yet.');
    if(!measured)return M.na('No verified X view reading yet for '+withUrl+' published posts.');
    const extra={posts:withUrl,measured};
    if(measured<withUrl)return M.partial(total,measured+' of '+withUrl+' published posts measured.',extra);
    return M.value(total,extra);
  }
  const outcome=(c,key)=>{
    const v=num(c?.[key]);
    if(v!==null&&c?.conversionSource&&c.conversionSource!=='NOT_CONNECTED')return M.value(v);
    return M.na(OUTCOME_REASON);
  };
  const costPerSignup=(spend,signups)=>hasValue(spend)&&hasValue(signups)&&signups.value>0?
    M.value(spend.value/signups.value):M.na('Needs connected creator signups and matched spend.');

  /* Built-in campaign definitions: presentation names only; source IDs unchanged. */
  const CAMPAIGNS=[
    {key:'x-articles',name:'X Articles',icon:'x',color:'white',ids:['x-articles','article-rts']},
    {key:'gta-vi',name:'GTA VI',icon:'gamepad',color:'violet',ids:['gta-qrts','gta-originals','gta-instagram','gta-mandy']},
    {key:'of-terms',name:'OF Terms',icon:'layers',color:'blue',ids:['of-terms']},
    {key:'guru-promotion',name:'Guru RTs',icon:'megaphone',color:'pink',ids:['guru-rts']}
  ];
  const PALETTE={
    slate:{icon:'#94A3B8',fill:'#475569',label:'Slate'},blue:{icon:'#6AA8F0',fill:'#1D5FB8',label:'Blue'},
    cyan:{icon:'#4FC3D9',fill:'#0E7490',label:'Cyan'},teal:{icon:'#3CC7B0',fill:'#0F766E',label:'Teal'},
    green:{icon:'#5FC98A',fill:'#15803D',label:'Green'},amber:{icon:'#E9B44C',fill:'#B45309',label:'Amber'},
    pink:{icon:'#EE7DB8',fill:'#BE185D',label:'Pink'},violet:{icon:'#A994F0',fill:'#6D28D9',label:'Violet'},
    white:{icon:'#FFFFFF',fill:'#000000',label:'White'}
  };

  /* Cost per click and cost per 1,000 views from matched rows only. A placement counts when it
     is paid with a recorded cost, published, and has its own verified reading. Untracked or
     shared readings are left out of both sides of the division, never treated as zero. */
  function matchedRows(objects){
    const rows=objects.filter(c=>c&&!unavailable(c)&&!notConnected(c)).flatMap(c=>c.rows||[]);
    const links=new Map(),posts=new Map();
    for(const r of rows){if(r.posted!==true)continue;
      if(r.trackingUrl)links.set(r.trackingUrl,(links.get(r.trackingUrl)||0)+1);
      const id=postId(r.postUrl);if(id)posts.set(id,(posts.get(id)||0)+1);}
    const paid=r=>r.paid===true&&r.planned!==true&&num(r.cost)!==null&&r.posted===true;
    const clickRow=r=>paid(r)&&!!r.trackingUrl&&links.get(r.trackingUrl)===1&&!r.sharedTracking&&r.clickTracked!==false&&num(r.clicks)!==null;
    // CPM only when every post on the payment has a reading, so views are never understated.
    const viewRow=r=>paid(r)&&!!postId(r.postUrl)&&num(r.views??r.xViews)!==null&&!(r.postViews&&Object.values(r.postViews).some(v=>num(v)===null));
    return {rows,clickRow,viewRow,sharedPost:r=>posts.get(postId(r.postUrl))>1};
  }
  function efficiency(objects){
    const {rows,clickRow,viewRow}=matchedRows(objects);
    const cr=rows.filter(clickRow),spendC=cr.reduce((n,r)=>n+num(r.cost),0),clicks=cr.reduce((n,r)=>n+num(r.clicks),0);
    const cpc=!cr.length?M.na('No placements have both a recorded cost and tracked clicks.'):clicks>0?
      M.value(spendC/clicks,{reason:'Matched spend '+money(spendC)+' ÷ '+full(clicks)+' tracked clicks, from '+full(cr.length)+' published placements that have both.'}):M.na('Matched placements have no clicks yet.');
    const byPost=new Map();
    for(const r of rows.filter(viewRow)){const id=postId(r.postUrl),g=byPost.get(id)||{cost:0,views:num(r.views??r.xViews)};g.cost+=num(r.cost);byPost.set(id,g);}
    const spendV=[...byPost.values()].reduce((n,g)=>n+g.cost,0),views=[...byPost.values()].reduce((n,g)=>n+g.views,0);
    const cpm=!byPost.size?M.na('No placements have both a recorded cost and verified views.'):views>0?
      M.value(spendV/views*1000,{reason:'Matched spend '+money(spendV)+' ÷ '+full(views)+' views × 1,000, from '+full(byPost.size)+' published posts that have both. Each post is counted once.'}):M.na('Matched posts have no views yet.');
    return {cpc,cpm};
  }
  /* Per-placement CPC and CPM for a table of rows (same matching rules). */
  function placementEfficiency(rows){
    const {clickRow,viewRow,sharedPost}=matchedRows([{rows}]),out=new Map();
    for(const r of rows){
      const c=num(r.clicks),v=num(r.views??r.xViews);
      out.set(r,{
        cpc:clickRow(r)&&c>0?M.value(num(r.cost)/c):M.na('Needs a recorded cost and tracked clicks on this placement.'),
        cpm:viewRow(r)&&!sharedPost(r)&&v>0?M.value(num(r.cost)/v*1000):M.na('Needs a recorded cost and verified views on its own post.')
      });
    }
    return out;
  }
  /* Budget view for a campaign: spend, committed (agreed, not yet paid) and what is left. */
  function budgetOf(spend,committed,budget){
    const amount=num(budget?.amount);
    if(amount===null)return null;
    const left=hasValue(spend)&&spend.state!=='partial'?amount-spend.value-(num(committed)||0):null;
    return {budget:M.value(amount),spend,planned:null,committed:num(committed)===null?M.na('No committed placements recorded.'):M.value(num(committed)),
      remaining:left===null?M.na('Needs the full spend figure.'):spend.state==='partial'?M.partial(left,'Spend is a known subtotal.'):M.value(left)};
  }

  /* One campaign's comparable summary, from campaign-overview objects. */
  function campaignSummary(overview,key,extras={}){
    const find=id=>overview?.campaigns?.find(c=>c.id===id)||null;
    const out={key,objects:{}};
    for(const id of CAMPAIGNS.find(c=>c.key===key)?.ids||[])out.objects[id]=find(id);
    const o=out.objects;
    if(key==='x-articles'){
      out.spend=addSpend([spendOf(o['x-articles']),spendOf(o['article-rts'],{noSpendReason:'No paid reposts are recorded.'})],'Articles and paid reposts');
      if(hasValue(out.spend))out.spend.parts={articles:spendOf(o['x-articles']),reposts:spendOf(o['article-rts'])};
      out.views=viewsOf([o['x-articles']]);
      const c=o['x-articles'];
      const tracked=num(c?.trackedClicks);
      out.clicks=unavailable(c)?M.na(sourceReason(c,'Clicks')):tracked===null?M.na('Click storage is temporarily unavailable.'):
        M.value(tracked,{provider:'Site redirect clicks (/r/ and /s/ links)'});
      out.published=unavailable(c)?null:num(c?.published);
      out.paidCount=(num(c?.paidCount)||0)+(num(o['article-rts']?.paidCount)||0);
      // Paid reposts carry the original post's views and no clicks, so they are not matched.
      Object.assign(out,efficiency([c]));
    }else if(key==='gta-vi'){
      // The legacy non-X source contributes to financial totals, not traffic or publication metrics.
      const parts=[o['gta-qrts'],o['gta-originals'],o['gta-mandy']].filter((c,i)=>c||i<2);
      const financeParts=[...parts,...(o['gta-instagram']?[o['gta-instagram']]:[])];
      out.paidSpend=addSpend(financeParts.map(c=>spendOf(c)),'Recorded payments');
      out.allocatedSpend=addSpend(financeParts.map(allocatedGtaSpend),'GTA VI paid, planned and committed costs');
      out.spend=out.allocatedSpend;
      out.views=viewsOf([o['gta-qrts'],o['gta-originals'],o['gta-mandy']]);
      const pp=parts.map(c=>num(c?.postPublicationClicks)).filter(v=>v!==null);
      const all=parts.map(c=>num(c?.allTimeHumanClicks)).filter(v=>v!==null);
      const gr=extras.gtaReport;
      const stale=!!(gr&&(gr.shortIo?.stale||gr.originals?.shortIo?.stale));
      if(!pp.length)out.clicks=M.na(unavailable(o['gta-qrts'])?sourceReason(o['gta-qrts'],'Clicks'):'No Short.io reading yet.');
      else{
        const post=pp.reduce((a,b)=>a+b,0),allTime=all.reduce((a,b)=>a+b,0);
        const reason='Short.io human clicks. '+full(post)+' since each post was published; '+full(allTime)+' all-time on the same links. Shared links are not individually attributed.';
        const extra={provider:'Short.io human clicks',allTime,postPublication:post,
          lastVerified:gr?.shortIo?.lastSuccessfulAt||null};
        out.clicks=stale?{state:'stale',value:post,reason:reason+' Short.io refresh is overdue; showing the last verified reading'+(gr?.shortIo?.lastSuccessfulAt?' from '+stamp(gr.shortIo.lastSuccessfulAt):'')+'.',...extra}:M.value(post,{...extra,reason});
      }
      out.published=parts.every(unavailable)?null:parts.reduce((n,c)=>n+(num(c?.published)||0),0);
      out.paidCount=parts.reduce((n,c)=>n+(num(c?.paidCount)||0),0);
      out.committed=financeParts.every(unavailable)?null:Math.round(financeParts.reduce((n,c)=>n+(num(c?.committedUnpaidKnown)||0),0)*100)/100;
      // GTA VI alone includes allocations in displayed spend; paid flags are unchanged.
      out.planned=Math.round(financeParts.reduce((n,c)=>n+(num(c?.plannedSpendKnown)||0),0)*100)/100;

      out.budget=budgetOf(out.allocatedSpend,0,o['gta-qrts']?.budget);
      if(out.budget)out.budget.committed=M.value(out.committed||0);
      Object.assign(out,efficiency(parts));
    }else if(key==='of-terms'){
      const c=o['of-terms'];
      out.spend=spendOf(c);out.views=viewsOf([c]);
      const t=num(c?.trackedClicks);
      out.clicks=unavailable(c)?M.na(sourceReason(c,'Clicks')):t===null?M.na('No OF click events recorded yet.'):
        M.value(t,{provider:'OF link events (/of/ links)',reason:'Events recorded by the /of/ tracking links. A different definition from Short.io human clicks; never combined.'});
      out.published=unavailable(c)?null:num(c?.published);out.paidCount=num(c?.paidCount)||0;
      Object.assign(out,efficiency([c]));
    }else if(key==='guru-promotion'){
      const c=o['guru-rts'];
      // Spend = paid RTs of the Guru accounts' posts (Article RTs tab). X boost spend is separate.
      out.spend=spendOf(c,{noSpendReason:'No paid RTs are recorded for these posts.'});
      if(hasValue(out.spend))out.spend.reason=full(num(c.paidCount))+' paid RTs of the promoted posts.';
      out.views=viewsOf([c]);if(out.views)out.views.scope='original';
      out.clicks=unavailable(c)?M.na(sourceReason(c,'Clicks')):M.notTracked('Promoted original posts have no tracked link.');
      out.published=unavailable(c)?null:num(c?.published);out.paidCount=num(c?.paidCount)||0;
      Object.assign(out,efficiency([c]));
    }else{
      const c=Object.values(o)[0];
      const reason='Not connected: no spend or placement source is linked for this campaign yet.';
      out.spend=M.na(reason);out.views=M.na(reason);out.clicks=M.na('Not connected: no click source is linked for this campaign yet.');
      out.published=null;out.paidCount=null;out.notConnected=notConnected(c);
      out.cpc=M.na(reason);out.cpm=M.na(reason);
    }
    const lead=Object.values(o).find(Boolean);
    out.signups=outcome(lead,'signups');out.kyc=outcome(lead,'kyc');out.earning=outcome(lead,'earningCreators');
    out.cps=costPerSignup(out.spend,out.signups);
    out.verifiedAt=Object.values(o).map(c=>c?.sourceVerifiedAt).filter(Boolean).sort().at(-1)||null;
    out.warnings=Object.values(o).flatMap(c=>[c?.dataWarning,c?.trackingWarning,c?.sourceStale?'Source is showing its last verified data.':null]).filter(Boolean);
    return out;
  }

  /* Home totals. Spend is summed only when every paid row is proven unique across
     campaigns (sheet tab + row, or tracker code). Post views only cover paid
     placement posts, deduplicated by post ID. Clicks are never combined. */
  function homeTotals(overview,summaries){
    const rowKey=r=>r.sourceTab&&r.sourceRow?('sheet|'+r.sourceTab+'|'+r.sourceRow):r.code?('code|'+r.code):r.id?('id|'+r.id):null;
    const keys=new Map();let duplicates=0,keyless=0;
    for(const s of summaries)for(const c of Object.values(s.objects)){
      if(!c)continue;
      for(const r of [...(c.rows||[]),...(c.paidReposts||[])]){
        if(!financeEntry(r,isGtaSource(c)))continue;
        const k=rowKey(r);if(!k){keyless++;continue;}
        if(keys.has(k)&&keys.get(k)!==c.id)duplicates++;keys.set(k,c.id);
      }
    }
    let spend;
    const parts=summaries.map(s=>s.spend);
    if(duplicates||keyless)spend=M.na('Spend rows could not be proven unique across campaigns ('+(duplicates+keyless)+' ambiguous), so no total is shown.');
    else{
      const known=parts.filter(hasValue).reduce((a,p)=>a+p.value,0);
      const gaps=summaries.filter(s=>!hasValue(s.spend)||s.spend.state==='partial').map(s=>CAMPAIGNS.find(c=>c.key===s.key)?.name);
      spend=gaps.length?M.partial(known,'Known subtotal of recorded payments and GTA VI allocations. Not included or incomplete: '+gaps.join(', ')+'.',{chip:'Known subtotal'}):M.value(known,{reason:'Recorded payments plus GTA VI allocations, counted once.',chip:'Campaign costs'});
    }
    const placementObjects=['x-articles','gta-qrts','gta-originals','gta-mandy','of-terms','guru-rts'].map(id=>overview?.campaigns?.find(c=>c.id===id)).filter(Boolean);
    const views=viewsOf(placementObjects);
    if(hasValue(views)){
      views.chip='Promoted post exposure';
      views.reason=(views.reason?views.reason+' ':'')+'Deduplicated by post ID across X Articles, GTA VI, OF Terms and Guru promoted originals. Includes organic exposure; excludes the external viral originals behind purchased QRTs. This is exposure, not unique reach or paid-only impressions.';
    }
    const clicks=M.na('Click providers differ (site redirects, Short.io human clicks and OF events), so they are not added together. See each campaign.');
    return {spend,views,clicks};
  }

  /* Sorting: explicit, stable, unavailable values always last. */
  function sortRows(rows,get,dir=1){
    return rows.map((row,i)=>({row,i,v:get(row)})).sort((a,b)=>{
      const am=a.v===null||a.v===undefined||a.v==='',bm=b.v===null||b.v===undefined||b.v==='';
      if(am!==bm)return am?1:-1;if(am)return a.i-b.i;
      const c=typeof a.v==='number'&&typeof b.v==='number'?a.v-b.v:String(a.v).localeCompare(String(b.v),'en-GB',{numeric:true,sensitivity:'base'});
      return c*dir||a.i-b.i;
    }).map(x=>x.row);
  }
  const escapeHtml=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  function safeUrl(value){try{const u=new URL(String(value||''));return u.protocol==='https:'?u.href:'';}catch{return '';}}

  root.FanvueCore=Object.freeze({TZ,num,full,compact,money,moneyShort,rate,signed,londonDay,addDays,weekStart,validDay,dailySeries,weekLabel,dayShort,dayLong,stamp,
    eventSeries,dailyEventSeries,snapshotSeries,memberWeeks,recentWeeks,memberReadings,M,hasValue,postId,spendOf,allocatedGtaSpend,isGtaRow,isGtaSource,financeEntry,financeSpend,addSpend,viewsOf,campaignSummary,homeTotals,efficiency,placementEfficiency,budgetOf,
    CAMPAIGNS,PALETTE,OUTCOME_REASON,sortRows,escapeHtml,safeUrl,notConnected,unavailable});
})(typeof globalThis!=='undefined'?globalThis:window);
