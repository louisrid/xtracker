/* Fanvue Marketing Dashboard: shell, router and the eight pages (DESIGN §4).
   Presentation only. Data comes from the existing adapters: campaign-reporting.js
   (campaign-overview and Discord feeds) and app.js (dashboard, OF, GTA and boosts
   feeds, record views, editors and refresh logic). Only the explicit refresh action starts a server job. */
(function(){
  'use strict';
  const C=window.FanvueCore,U=window.FanvueUI,esc=C.escapeHtml,M=C.M;
  const $=id=>document.getElementById(id);
  const APP_NAME='Fanvue Marketing Dashboard';
  const requestedLayout=typeof URLSearchParams==='function'&&typeof location!=='undefined'?new URLSearchParams(location.search||'').get('layout'):null;
  const dashboardLayout=/^[1-8]$/.test(requestedLayout||'')?requestedLayout:'1';
  if(document.documentElement?.dataset)document.documentElement.dataset.dashboardLayout=dashboardLayout;

  /* ---------- data bridge (read-only) ---------- */
  const D={
    app:()=>window.XTrackerApp||null,
    rep:()=>window.XTrackerCampaignReporting||null,
    overview(){const data=this.rep()?.getData?.()||null;return window.FanvuePaymentDates?.applyPaymentDates(data)||data;},
    overviewStatus(){return this.rep()?.status?.()||{};},
    discord(){return this.rep()?.discord?.()||{};},
    dashboard(){return this.app()?.dashboard?.()||null;},
    of(){return this.app()?.of?.()||{};},
    gta(){return this.app()?.gta?.()||{};},
    campaign(id){return this.overview()?.campaigns?.find(c=>c.id===id)||null;}
  };
  const directory=window.FanvueDirectory.state;
  const loadDirectory=()=>window.FanvueDirectory.load();
  const ensured=new Set();
  function ensure(name){
    if(ensured.has(name))return;ensured.add(name);
    try{
      if(name==='overview')void D.rep()?.ensure?.();
      if(name==='discord')void D.rep()?.refreshDiscord?.(false);
      if(name==='gta')void D.app()?.loadGta?.(false);
      if(name==='of')void D.app()?.loadOf?.(false);
      if(name==='directory')void loadDirectory();
    }catch(e){console.warn('Source load failed',name,e);}
  }

  /* ---------- routes ---------- */
  // Viral QRTs is a view of GTA VI's Mandy group (owner, 26 Nov): its own page, but counted once, inside GTA VI.
  const VIRAL={key:'viral-qrts',name:'Viral QRTs',icon:'zap',color:'amber'};
  // Menu order (owner, 26 Nov): Dashboard; campaigns by size and kind; community; Accounts last.
  const NAV_ORDER=['gta-vi','viral-qrts','x-articles','of-terms','guru-promotion'];
  const PAGES=[
    {key:'home',title:'Dashboard',icon:'home',group:'general'},
    ...NAV_ORDER.map(k=>k==='viral-qrts'?VIRAL:C.CAMPAIGNS.find(c=>c.key===k)).filter(Boolean).map(c=>({key:c.key,title:c.name,icon:c.icon,group:'paid',color:c.color})),
    {key:'discord',title:'Discord',icon:'discord',group:'community'},
    {key:'all-accounts',title:'Accounts',icon:'users',group:'more'}
  ];
  const RECORDS={
    placements:{title:'Article tracker',parent:'x-articles'},
    accounts:{title:'Accounts',parent:'x-articles'},
    campaigns:{title:'Campaigns',parent:'x-articles'},
    'x-rts':{title:'Promoted posts',parent:'guru-promotion'}
  };
  /* Every legacy hash keeps working: it opens the matching page, view or record list. */
  const LEGACY={
    '':'home',dashboard:'home',home:'home',stats:'home',historical:'home','report-all':'home',reporting:'home','report-other':'home',
    discord:'discord','report-discord':'discord',
    'report-articles':'x-articles','report-article-rt':'x-articles/paid-reposts',articles:'x-articles/original-posts',upcoming:'x-articles/original-posts',
    'gta-vi':'gta-vi','report-gta':'gta-vi',
    'campaign-C001':'of-terms','report-of':'of-terms',of:'of-terms',
    'report-harness':'home',
    'report-guru':'guru-promotion',
    'boosted-tweets':'x-rts'
  };
  function parseHash(raw=location.hash){
    let h=decodeURIComponent(String(raw||'').replace(/^#/,'')).trim();
    if(h in LEGACY)h=LEGACY[h];
    if(RECORDS[h])return {kind:'records',key:h,canonical:h};
    const [page,requestedView]=h.split('/');
    const view=page==='gta-vi'&&requestedView==='instagram'?'overview':requestedView;
    if(PAGES.some(p=>p.key===page))return {kind:'page',key:page,view:view||'',canonical:view?page+'/'+view:page};
    if(page==='campaign'&&view)return {kind:'added',key:view,canonical:'campaign/'+view};
    return {kind:'page',key:'home',view:'',canonical:'home'};
  }

  /* ---------- per-page interface state ---------- */
  const ui={};
  const pageState=key=>ui[key]||(ui[key]={chart:{},charts:{},tables:{},view:''});
  // Each chart keeps its own metric and display choice (a page can show a bar card and a main chart).
  const chartState=(page,id)=>{const s=pageState(page);return s.charts[id]||(s.charts[id]={});};
  const tableState=(page,id)=>{const s=pageState(page);return s.tables[id]||(s.tables[id]={sort:null,q:'',expanded:new Set(),filter:''});};

  /* ---------- shared formatting helpers ---------- */
  const metric=(label,iconName,m,format='count',note)=>({label,icon:iconName,metric:m,format,note});
  const outcomeItems=(c)=>[
    metric('Signups','user',c?.signups||M.na(C.OUTCOME_REASON)),
    metric('KYC','shield',c?.kyc||M.na(C.OUTCOME_REASON)),
    metric('Earning Creators','check',c?.earning||M.na(C.OUTCOME_REASON))
  ];
  const feedDown=()=>Boolean(D.overviewStatus().error)&&!D.overview();
  const FEED_DOWN='Data unavailable. The reporting feed did not respond and this browser has no saved copy yet.';
  // Loading placeholders list only the figures each page can show, so the strip does not jump.
  const loadingStrip=labels=>U.strip(labels.map(([l,i])=>metric(l,i,feedDown()?M.na(FEED_DOWN):M.loading())));
  const waiting=text=>feedDown()?'Data Unavailable':text;
  const money=v=>C.num(v)===null?'':esc(C.money(v));
  const count=v=>C.num(v)===null?'':esc(C.full(v));
  const when=v=>v?esc(C.stamp(v)):'';
  // One restrained dash for an unavailable cell; the reason is available on hover, focus and to screen readers.
  const dash=reason=>U.reasonButton('–',reason||'Not available.','fv-dash');
  const section=title=>'<h2 class="fv-section-title">'+esc(title)+'</h2>';
  const payState=r=>r.planned===true?'Planned':r.paid===true?'Paid':C.isGtaRow(r)&&C.num(r.cost)>0?'Committed':C.num(r.cost)!==null?'Unpaid':'';
  const payStatus=r=>{const s=payState(r);return s==='Paid'?U.status('Paid','good'):s?U.status(s):'';};
  // A post X reports as not found (HTTP 404) was deleted or hidden by its publisher after going live.
  const isDeleted=r=>r?.posted===true&&(/not_found/i.test(String(r.metricErrorCategory||''))||/HTTP 404/.test(String(r.metricError||'')));
  const viewsOfRow=r=>{const v=C.num(r.views??r.xViews);if(v!==null)return M.value(v,isDeleted(r)?{reason:'Last verified views before the post was deleted on X.'}:{});
    if(isDeleted(r))return M.na('Deleted on X before a reading was taken.');
    if(r.posted!==true)return M.na('Not live yet.');
    if(!C.postId(r.postUrl))return M.na('No X post link recorded.');
    return M.na(r.metricError||'No verified X reading yet.');};
  const accountLabel=r=>r.publisher||r.name||r.handle||(r.trackingUrl?'Pending · '+r.trackingUrl.replace(/^https:\/\//,''):'Pending publisher');
  const accountName=(r)=>{const name=accountLabel(r);return '<span class="fv-name" title="'+esc(name)+'">'+U.accountMark(name)+'<span>'+esc(name)+'</span></span>';};
  const trackingText=url=>url?'<span class="fv-mono">'+esc(url)+'</span>':'';
  const engagement=r=>{const l=C.num(r.likes??r.xLikes),rp=C.num(r.reposts??r.xShares),re=C.num(r.replies??r.xComments),v=C.num(r.views??r.xViews);
    if([l,rp,re].some(x=>x===null))return '';
    return esc(C.full(l)+' likes · '+C.full(rp)+' reposts · '+C.full(re)+' replies'+(v>0?' · '+((l+rp+re)/v*100).toFixed(2)+'%':''));};
  const ALIGNED=['24%','12.5%','12.5%','12.5%','12.5%','11.5%','11.5%','3%'];
  const rowKeyOf=r=>r.campaign==='GTAM'&&r.trackingUrl?'GTAM|'+r.trackingUrl:(r.code||r.id||'')+'@'+(r.sourceTab||'')+'#'+(r.sourceRow||'');
  const sourceRow=r=>r.sourceTab?esc(r.sourceTab+(r.sourceRow?' · row '+r.sourceRow:'')):'';

  /* ---------- universal X records: one schema and nine columns for every X placement ---------- */
  // Type is one of Post, RT, QRT or Article; threads are posts.
  const TYPE_NAMES={post:'Post',thread:'Post',original:'Post',rt:'RT',qrt:'QRT',article:'Article',story:'Story'};
  const typeName=t=>TYPE_NAMES[String(t||'').toLowerCase()]||'Post';
  // A placement is a booking: it has a price, a payment, a live post, a planned stage or clicks. Contact-list rows are left out.
  const isBooking=r=>C.num(r.cost)!==null||r.paid===true||r.posted===true||!!r.stage||C.num(r.clicks)>0;
  function xRecord(r,{campaign,parent,platform='X',type,clicks,views,ownLink=true}){
    const deleted=isDeleted(r);
    const link=ownLink&&!deleted&&r.posted===true&&C.safeUrl(r.postUrl)&&C.postId(r.postUrl)?r.postUrl:'';
    return {raw:r,campaign,parent:parent||campaign,platform,type:typeName(type),account:accountLabel(r),price:C.num(r.cost),
      live:deleted?false:r.posted===true?true:r.posted===false?false:null,deleted,link,paid:r.paid===true&&r.planned!==true,planned:r.planned===true,
      views:views?views(r):viewsOfRow(r),clicks:clicks?clicks(r):M.na('No tracked link for this placement.')};
  }
  // Only publication evidence is eligible; reposts may point to somebody else's original.
  function publicationAge(x){
    const r=x.raw||x;
    const own=x.type!=='RT'&&String(r.type||'').toLowerCase()!=='rt';
    const link=own&&x.live!==false&&r.posted!==false?C.postId(x.link||r.postUrl):null;
    const exact=link?postBorn(link):null;
    if(exact&&exact<=Date.now())return {at:exact,dayOnly:false};
    const v=r.postedAt;
    if(!v)return null;
    const dayOnly=typeof v==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(v);
    const at=typeof v==='number'?v:Date.parse(v);
    return Number.isFinite(at)&&at>0&&at<=Date.now()?{at,dayOnly}:null;
  }
  const originalAge=id=>{const at=postBorn(id);return at&&at<=Date.now()?{at,dayOnly:false}:null;};
  const latestAge=rows=>rows.map(publicationAge).filter(Boolean).sort((a,b)=>b.at-a.at)[0]||null;
  const xState=(page,id)=>{const st=tableState(page,id);return st.xf||(st.xf={group:'',type:'',live:'',pay:''});};
  const xActive=f=>!!(f.group||f.type||f.live||f.pay);
  const xMatch=f=>x=>(!f.group||x.campaign===f.group)&&(!f.type||x.type===f.type)&&(!f.live||(f.live==='Yes'?x.live===true:f.live==='Deleted'?x.deleted:x.live!==true&&!x.deleted))&&
    (!f.pay||(f.pay==='Planned'?x.planned:f.pay==='Paid'?x.paid&&!x.planned:!x.paid));
  function xFilters(id,records,f,{groups=true}={}){
    const present=(key,order)=>order.filter(v=>records.some(x=>key(x)===v));
    const sel=(key,label,opts,min=2)=>opts.length<min&&!f[key]?'':'<label class="fv-select fv-filter"><span class="fv-sr">'+esc(label)+'</span><select data-xfilter="'+key+'" data-table="'+esc(id)+'">'+
      [['',label+': All'],...opts.map(o=>[o,label+': '+o])].map(([v,l])=>'<option value="'+esc(v)+'"'+(f[key]===v?' selected':'')+'>'+esc(l)+'</option>').join('')+'</select>'+U.icon('select',14)+'</label>';
    const groupOpts=groups?[...new Set(records.map(x=>x.campaign))].filter(g=>GROUPS_VERIFIED.has(g)):[];
    return (groupOpts.length>=1&&new Set(records.map(x=>x.campaign)).size>1?sel('group','Group',groupOpts,1):'')+
      sel('type','Type',present(x=>x.type,['Post','Article','RT','QRT']));
  }
  // Verified content groups only; unverified records stay under their parent campaign.
  const GROUPS_VERIFIED=new Set(['Mandy','Lucia','Partner Articles','Classic Articles']);
  const X_COLUMNS=[
    {key:'campaign',label:'Campaign',type:'text',keep:true,html:x=>esc(x.campaign),sort:x=>x.campaign},
    {key:'platform',label:'Platform',type:'text',keep:true,nosort:true,html:x=>esc(x.platform||'X')},
    {key:'type',label:'Type',type:'text',keep:true,html:x=>esc(x.type),sort:x=>x.type},
    {key:'account',label:'Account',type:'name',keep:true,html:x=>accountName(x.raw),sort:x=>x.account.toLowerCase()},
    {key:'price',label:'Price',format:'money',keep:true,get:x=>x.price===null?M.na('No price recorded.'):M.value(x.price)},
    {key:'live',label:'Live?',type:'status',keep:true,html:x=>x.deleted?U.reasonButton('Deleted','Marked posted in the sheet, but X reports this post as not found: the publisher deleted or hid it.','fv-status is-bad'):x.live===true?U.status('Yes','good'):x.live===false?U.status('No'):dash('Publication not recorded.'),sort:x=>x.live===true?1:x.deleted?-1:0},
    {key:'link',label:'Link',type:'link',keep:true,nosort:true,html:x=>x.link?U.extLink(x.link,'Open post by '+x.account,{iconOnly:true}):dash(x.deleted?'Deleted on X.':x.type==='RT'?'No repost link is recorded.':x.live?'No post link recorded.':'Not live yet.')},
    {key:'views',label:'Views',keep:true,get:x=>x.views},
    {key:'clicks',label:'Clicks',keep:true,get:x=>x.clicks}
  ];
  // Record details, in a fixed order: booking, publication, tracking, results, history. Empty fields are left out.
  function xDetail(x,eff,{source,extra=[]}={}){
    const r=x.raw,e=eff?.get(r)||{};
    return U.detailGrid([
      ['Payment',payStatus(r)],['Price',C.num(r.cost)!==null?U.value(M.value(C.num(r.cost)),'money'):''],['Paid Date',r.paidAt?when(r.paidAt):''],['Planned Date',r.plannedAt?when(r.plannedAt):''],['Quantity',C.num(r.purchasedPosts)!==null?U.value(M.value(C.num(r.purchasedPosts))):''],
      ['Published',r.postedAt?when(r.postedAt):''],['Source Post',source||''],['Profile',U.extLink(r.profileUrl,'Profile')||''],
      ...(r.postUrls?.length>1?[['Posts',r.postUrls.map((u,i)=>U.extLink(u,'Post '+(i+1))).join(' ')]]:[]),
      ['Tracking Link',trackingText(r.trackingUrl)],
      ['Views',U.value(x.views)],['Clicks',U.value(x.clicks)],['CPC',e.cpc&&C.hasValue(e.cpc)?U.value(e.cpc,'money'):''],['CPM',e.cpm&&C.hasValue(e.cpm)?U.value(e.cpm,'money'):''],['Engagement',engagement(r)],
      ...extra,
      ['Updated',r.metricAt||r.xUpdated?when(r.metricAt||r.xUpdated):''],['Source Row',sourceRow(r)]
    ]);
  }
  function xTable(page,id,{title,icon='layers',records,f,expand,empty,groups=true,includeType=true}){
    const ts=tableState(page,id);if(!ts.sort)ts.sort={key:'age',dir:-1};
    return U.tablePanel({id,title,icon,age:publicationAge,hideEmpty:false,search:true,filters:xFilters(id,records,f,{groups}),filter:xMatch(f),rows:records,rowKey:x=>rowKeyOf(x.raw),rowLabel:x=>x.account,
      minWidth:820,cls:'is-list is-placement-list',searchText:x=>[x.account,x.campaign,x.raw.trackingUrl||'',x.raw.articleLabel||''].join(' '),empty,columns:resultColumns(records,{includeType}),expand},ts);
  }
  const articleHeadline=r=>r.articleTitle||r.headline||(!/^ARTICLE\s*\d/i.test(r.articleLabel||'')?r.articleLabel:'')||'';
  function resultColumns(records,{article=false}={}){
    const eff=C.placementEfficiency(records.map(x=>x.raw));
    return [
      {key:'account',label:'Account',type:'name',html:x=>accountName(x.raw),sort:x=>x.account.toLowerCase()},
      {key:'type',label:'Type',type:'text',html:x=>esc(x.type),sort:x=>x.type},
      {key:'clicks',label:'Clicks',keep:true,get:x=>x.clicks},
      {key:'views',label:'Views',keep:true,get:x=>x.views},
      {key:'spend',label:'Spend',format:'money',get:recordSpend},
      {key:'cpc',label:'CPC',format:'money',keep:true,get:x=>eff.get(x.raw)?.cpc||M.na('No matched traffic cost.')},
      {key:'post',label:'Post',type:'link',html:x=>x.link?U.extLink(x.link,'Open post',{iconOnly:true}):dash('No live post link.')}
    ];
  }
  function rtSummaryColumns({name,views,spend,rtCount,url}){
    return [
      {key:'account',label:'Account',type:'name',html:r=>accountName({publisher:name(r)}),sort:name},
      {key:'type',label:'Type',type:'text',html:()=> 'RT',sort:()=> 'RT'},
      {key:'rts',label:'RTs',get:r=>M.value(rtCount(r))},
      {key:'views',label:'Views',get:r=>{const m=views(r);return C.hasValue(m)?{...m,reason:'Views of the promoted post, including organic exposure. Separate RT impressions are not tracked.'}:m;}},
      {key:'spend',label:'Spend',format:'money',get:spend},
      {key:'cost',label:'Cost/RT',format:'money',get:r=>{const m=spend(r),n=rtCount(r);return m?.state==='value'&&n>0?M.value(m.value/n):M.na('Needs verified spend and purchased RT count.');}},
      {key:'post',label:'Post',type:'link',html:r=>U.extLink(url(r),'Original post',{iconOnly:true})||dash('No verified original post link.')}
    ];
  }
  function rtCosts(records){
    return '<div class="fv-publisher-costs">'+records.map(x=>'<div><b>'+esc(x.account)+'</b><span>'+esc(x.paid?'Paid':x.planned?'Planned':'Unpaid')+'</span><strong>'+(x.price===null?dash('No cost recorded.'):money(x.price))+'</strong></div>').join('')+'</div>';
  }
  // RT bookings contribute distinct measured original exposure, not reposter impressions.
  const gtaFinance=x=>x.parent==='GTA VI'||C.isGtaRow(x.raw);
  const actualPaid=x=>x.raw?.paid===true&&x.raw?.planned!==true;
  const financeEntry=x=>C.financeEntry(x.raw,gtaFinance(x));
  const bookedCost=x=>!!financeEntry(x);
  function recordSpend(x){
    if(!bookedCost(x))return M.na('Not paid.');
    const cost=C.num(x.raw.cost);
    return cost===null?M.na('Cost missing.'):M.value(cost,{reason:actualPaid(x)?'Recorded payment.':'Included in GTA VI allocated spend; not yet paid.'});
  }
  function xKpis(records){
    const raws=records.map(x=>x.raw),own=records.filter(x=>x.type!=='RT').map(x=>x.raw);
    const spend=C.financeSpend(records.map(financeEntry));
    const views=C.viewsOf([{source:'FILTER',rows:own},{id:'article-rts',rows:records.filter(x=>x.type==='RT').map(x=>x.raw)}]);
    const links=new Map();
    for(const x of records){if(!C.hasValue(x.clicks)||x.raw.sharedTracking||x.raw.identityAmbiguous)continue;const key=x.raw.trackingUrl||rowKeyOf(x.raw);links.set(key,Math.max(links.get(key)||0,x.clicks.value));}
    const clickValue=[...links.values()].reduce((n,v)=>n+v,0),missing=records.filter(x=>x.raw.trackingUrl&&x.live===true&&(!C.hasValue(x.clicks)||x.raw.sharedTracking||x.raw.identityAmbiguous)).length;
    const clicks=links.size?(missing?M.partial(clickValue,missing+' live tracking links have missing or shared readings.'):M.value(clickValue,{reason:'Verified clicks on distinct placement links. Shared counters are excluded.'})):M.na('No attributable tracked clicks in this selection.');
    return {spend,views,clicks,cpc:C.efficiency([{source:'FILTER',rows:own}]).cpc};
  }
  const kpiStrip=k=>U.strip([metric('Clicks','cursor',k.clicks),metric('Views','eye',k.views,'compact'),metric('Spend','wallet',k.spend,'moneyShort'),metric('CPC','cursor',k.cpc,'money')]);
  const KPI_LOADING=[['Clicks','cursor'],['Views','eye'],['Spend','wallet'],['CPC','cursor']];
  const filteredNote=f=>xActive(f)?'<p class="fv-filter-note">'+U.icon('info',14)+'<span>Figures show the selected records.</span></p>':'';
  // Old view URLs open the equivalent filter.
  function applyLegacyView(page,id,view){
    const f=xState(page,id),map={'x-original-posts':{type:'Post'},'x-quote-posts':{type:'QRT'},'mandy-qrts':{group:'Mandy'},
      'original-posts':{type:'Article'},'paid-reposts':{type:'RT'}}[view];
    const st=tableState(page,id);
    if(map&&st.legacyView!==view){Object.assign(f,{group:'',type:'',live:'',pay:''},map);}
    st.legacyView=view;
  }

  /* ---------- pages ---------- */
  function overviewNotice(){
    const st=D.overviewStatus(),ov=D.overview();
    if(st.error&&ov)return '<div class="fv-notice" role="status">'+'<span>'+U.reasonButton('Last Verified '+C.stamp(ov.checkedAt),'The latest refresh failed; these are the last verified figures.','fv-notice-reason')+'</span><button type="button" data-retry>Retry</button></div>';
    if(st.error&&!ov)return '<div class="fv-notice is-error" role="alert">'+'<span>Data Unavailable</span><button type="button" data-retry>Retry</button></div>';
    if(ov?.stale)return '<div class="fv-notice" role="status">'+U.icon('alert',15)+'<span>'+U.reasonButton('Cached Data','The reporting feed is showing its last verified snapshot.','fv-notice-reason')+'</span></div>';
    return '';
  }
  const summaries=()=>{const ov=D.overview();return ov?C.CAMPAIGNS.map(c=>C.campaignSummary(ov,c.key,{gtaReport:D.gta().report})):null;};
  // Live Posts: distinct verified paid promotional X publications (each post once, extra posts on a booking included).
  const LIVE_SOURCES={'x-articles':['x-articles'],'gta-vi':['gta-qrts','gta-originals','gta-mandy'],'of-terms':['of-terms']};
  function livePosts(ov,ids){
    const seen=new Set();
    for(const id of ids)for(const r of ov?.campaigns?.find(c=>c.id===id)?.rows||[]){
      if(r.paid!==true||r.posted!==true||isDeleted(r))continue;
      for(const u of r.postUrls?.length?r.postUrls:[r.postUrl]){const p=C.postId(u);if(p)seen.add(p);}
    }
    return seen.size;
  }

  /* One executive view at a time; the period applies to both totals and campaign rows. */
  function homePage(st){
    ensure('overview');ensure('discord');ensure('gta');ensure('of');
    const ov=D.overview(),S=summaries(),today=C.londonDay(Date.now()),ws=C.weekStart(today),lws=C.addDays(ws,-7),lwe=C.addDays(ws,-1);
    const tabs=[{key:'this-week',label:'This Week'},{key:'last-week',label:'Last Week'},{key:'all-time',label:'All Time'}];
    const active=tabs.some(t=>t.key===st.view)?st.view:'this-week';
    const period=active==='all-time'?null:active==='this-week'?{from:ws,to:today}:{from:lws,to:lwe};
    const dc=discordStats(ws,today,lws,lwe),community=active==='all-time'?dc.all:active==='this-week'?dc.week:dc.last;
    const load=M.loading();let paid={clicks:load,views:load,spend:load,posts:load};
    if(S){
      if(period)paid=periodTotals(period.from,period.to);
      else{const T=C.homeTotals(ov,S);paid={clicks:clickBreakdown(),views:T.views,spend:T.spend,posts:M.value(livePosts(ov,Object.values(LIVE_SOURCES).flat()))};}
    }
    const header=subTabs(tabs,active).replace('aria-label="Campaign sections"','aria-label="Dashboard periods"');
    const figures=U.strip([metric('Clicks','cursor',paid.clicks),metric('Views','eye',paid.views,'compact'),metric('Spend','wallet',paid.spend,'moneyShort'),metric('Live Posts','check',paid.posts)]);
    const discordHeading=U.panelHead('Discord','discord','<a class="fv-control fv-home-discord-link" href="#discord/'+active+'">'+U.icon('discord',15)+'View Discord</a>').replace('<span>Discord</span>','<span class="fv-discord-heading">Discord <span class="fv-discord-scope" title="'+esc(discordScope(active,community))+'">'+esc(tabs.find(t=>t.key===active).label)+'</span></span>');
    const discord='<section class="fv-panel fv-home-discord" aria-label="Discord">'+discordHeading+
      U.strip([metric('Members','users',community.members,'count'),metric('Net Growth','trend',community.growth,'signed'),metric('Course Clicks','graduation',community.clicks)],{cls:'fv-home-community-strip',ariaLabel:'Discord metrics'})+'</section>';
    const chart=dashboardChart(period),comparison=campaignComparison(S,period);
    const lower=dashboardLayout==='2'||dashboardLayout==='5'?chart+discord+comparison:dashboardLayout==='3'?comparison+chart+discord:dashboardLayout==='8'?discord+chart+comparison:chart+comparison+discord;
    return {title:'Dashboard',refreshLabel:'Refresh All',chipHtml:'<span class="fv-campaign-chip" aria-hidden="true">'+U.icon('home',15)+'</span>',updated:ov?.checkedAt,stale:!!(D.overviewStatus().error||ov?.stale),body:header+figures+lower+overviewNotice()};
  }
  // The graph and period totals share the exact same scoped, dated click series.
  function datedClicks(key,records){
    if(key==='gta-vi'||key==='viral-qrts')return shortIoDaily(gtaClickReport(D.gta()?.report),records);
    if(key==='guru-promotion')return [];
    const articles=key==='x-articles'||key.startsWith('added:');
    const source=articles?D.dashboard():D.of()?.report;
    const ready=articles?source?.activityReady:source?.ready;
    const campaign=D.campaign(articles?'x-articles':'of-terms');
    // Event history is a complete snapshot, not a cumulative list to append.
    const candidates=[...(ready&&Array.isArray(source.activity)?[{rows:source.activity,at:source.checkedAt||source.raw?.checkedAt||'',rank:1}]:[]),
      ...(campaign?.clickHistoryReady&&Array.isArray(campaign.clickHistory)?[{rows:campaign.clickHistory,at:campaign.clickHistoryCheckedAt||'',rank:0}]:[])];
    const best=candidates.sort((a,b)=>(Date.parse(b.at)||0)-(Date.parse(a.at)||0)||b.rank-a.rank)[0];
    if(!best)return [];
    const codes=new Set(records.map(x=>String(x.raw.code||'')).filter(Boolean));
    const series=C.dailyEventSeries(best.rows,{include:r=>codes.has(String(r.code||'')),days:14});
    // Do not extend a previously checked snapshot with fabricated zero-click days.
    const checked=C.londonDay(best.at);
    return checked?series.filter(p=>p.week<=checked).map(p=>({...p,incomplete:p.incomplete||p.week===checked})):series;
  }
  function dashboardClickSources(){
    return [['Short.io',datedClicks('gta-vi',gtaRecords())],['Article links',datedClicks('x-articles',xaRecords())],['OF links',datedClicks('of-terms',ofRecords())]];
  }
  function datedClickMetric(series,from,to){
    const points=series.filter(p=>p.week>=from&&p.week<=to&&C.num(p.value)!==null);
    if(!points.length)return M.na('No verified dated clicks in this period.');
    const total=points.reduce((n,p)=>n+C.num(p.value),0);
    const expected=Math.round((Date.parse(to)-Date.parse(from))/86400000)+1;
    return points.length<expected||points.some(p=>p.incomplete)?M.partial(total,'Recorded daily clicks only; some dates or link readings are incomplete.'):M.value(total);
  }
  function dashboardChart(period){
    const values=new Map();
    for(const [name,series] of dashboardClickSources())for(const p of series){const d=values.get(p.week)||{value:0,sources:[],incomplete:false};d.value+=p.value;d.sources.push(name+': '+C.full(p.value));d.incomplete||=p.incomplete===true;values.set(p.week,d);}
    const series=[...values].sort(([a],[b])=>a.localeCompare(b)).map(([date,d])=>({week:date,label:C.dayShort(date),range:C.dayLong(date),value:d.value,incomplete:d.incomplete||d.sources.length<3||date===C.londonDay(Date.now()),extra:d.sources.join(' · ')+'. Dated recorded clicks only; unavailable sources are excluded. Provider filtering differs.'}));
    const week=C.weekStart(C.londonDay(Date.now())),start=period?.from||week,end=C.addDays(start,6);
    const chartNote={text:start===week?'This Week':'Last Week',detail:C.dayShort(start)+' – '+C.dayShort(end)+(period?'':' · Weekly graph; KPI totals are all time')};
    const viewHistory=xHistory([...xaRecords(),...gtaRecords(),...ofRecords(),...guruRecords()],{includeGuru:true});
    const viewDays=C.dailySeries(viewHistory,{born:postBorn,days:21}).gained;
    return U.chartPanel({id:'home-chart',allowEmptyWeek:true,headerNote:chartNote,measures:[{key:'clicks',label:'Daily Clicks',title:'Daily Clicks',series,period:'Day',weekFrom:period?.from,unit:'Clicks'},...(viewDays.some(p=>p.value!==null)?[{key:'gained',label:'Daily Views',title:'Daily Views',series:viewDays,period:'Day',weekFrom:period?.from,unit:'Views Gained',format:'compact',tipFormat:'count'}]:[])]},chartState('home','home-chart'));
  }
  function clickBreakdown(from,to){
    const s=summaries();if(!s)return M.loading();
    const get=k=>s.find(x=>x.key===k)?.clicks||M.na('Unavailable');
    const parts=from?dashboardClickSources().map(([name,series])=>[name,datedClickMetric(series,from,to)]):[['Short.io',get('gta-vi')],['Article links',get('x-articles')],['OF links',get('of-terms')]];
    const known=parts.filter(([,m])=>C.hasValue(m));
    if(!known.length)return M.na('No verified click readings for this period.');
    const total=known.reduce((n,[,m])=>n+m.value,0);
    const reason=parts.map(([name,m])=>name+': '+(C.hasValue(m)?C.full(m.value):'not available')).join(' · ')+'. Recorded clicks across separate campaign links; provider filtering differs. This is not unique visitors or a human-only total.';
    return known.length<parts.length||known.some(([,m])=>m.state==='partial')?M.partial(total,reason+' Only available readings are included.'):M.value(total,{reason});
  }
  function campaignComparison(S,period){
    const load={clicks:M.loading(),views:M.loading(),spend:M.loading(),cpc:M.loading()};
    const rows=NAV_ORDER.map(key=>{
      const isViral=key==='viral-qrts',name=isViral?'Viral QRTs':C.CAMPAIGNS.find(c=>c.key===key).name;
      const summary=S?(isViral?xKpis(gtaRecords().filter(x=>x.campaign==='Mandy')):S.find(s=>s.key===key)):null;
      return {...(summary||load),key,name,alias:isViral};
    });
    if(S&&period)for(const row of rows)Object.assign(row,periodCampaign(row.key,period));
    const ts=tableState('home','home-comparison');if(!ts.sort)ts.sort={key:'clicks',dir:-1};
    return U.tablePanel({id:'home-comparison',title:'Campaigns',rows,rowKey:r=>r.key,hideEmpty:false,cls:'is-list is-home-comparison',minWidth:650,search:true,searchPlaceholder:'Search campaigns',searchText:r=>r.name,
      columns:[{key:'name',label:'Campaign',type:'name',html:r=>'<a class="fv-campaign-row-name" style="--fv-row-accent:'+esc(C.PALETTE[look(r.key).color]?.icon||'#FFFFFF')+'" href="#'+esc(r.key)+'"'+(r.alias?' title="Included in GTA VI totals; counted once."':'')+'>'+esc(r.name)+'</a>',sort:r=>r.name},
      {key:'clicks',label:'Clicks',get:r=>r.clicks},{key:'views',label:'Views',get:r=>r.views},{key:'spend',label:'Spend',format:'money',get:r=>r.spend},{key:'cpc',label:'CPC',format:'money',get:r=>r.cpc}]},ts);
  }
  function periodCampaign(key,period){
    const records=key==='gta-vi'?gtaRecords():key==='viral-qrts'?gtaRecords().filter(x=>x.campaign==='Mandy'):key==='x-articles'?xaRecords():key==='of-terms'?ofRecords():guruRecords();
    const totals=periodTotals(period.from,period.to,records,key==='gta-vi'?igSpendRecords():[]);
    if(key==='guru-promotion')totals.views=scopedViews(xHistory(records,{includeGuru:true}),period);
    const clicks=datedClickMetric(datedClicks(key,records),period.from,period.to);
    return {...totals,clicks,cpc:scopedCpc(key,records,period)};
  }
  /* ---------- Home: This Week (owner, 26 Nov) ---------- */
  // UK week, Monday to today.
  const weekRange=ws=>{const we=C.addDays(ws,6);return C.dayShort(ws).split(' ')[0]+(ws.slice(5,7)===we.slice(5,7)?'':' '+C.dayShort(ws).split(' ')[1])+'–'+C.dayShort(we);};
  const postIdsOfRecord=x=>(x.raw.postUrls?.length?x.raw.postUrls:[x.raw.postUrl]).map(u=>C.postId(u)).filter(Boolean).map(String);
  // GTA VI includes confirmed allocations, on the allocation date.
  // Undated costs remain in all-time totals, not invented weekly figures.
  function periodTotals(from,to,records,financeOnly){
    const all=records||[...xaRecords(),...gtaRecords(),...ofRecords(),...guruRecords()];
    const spendOnly=financeOnly||(records?[]:igSpendRecords());
    const spend=C.financeSpend([...all,...spendOnly].map(financeEntry),{from,to}),posts=new Set();
    for(const x of all){
      if(actualPaid(x)&&x.live===true&&x.platform==='X')for(const id of postIdsOfRecord(x)){const t=postBorn(id),d=t?C.londonDay(t):'';if(d>=from&&d<=to)posts.add(id);}
    }
    const history=xHistory(all,{includeGuru:!records});
    return {clicks:records?M.na('Scoped clicks are calculated separately.'):clickBreakdown(from,to),
      spend,
      views:C.periodViewMetric(history,from,to,{born:postBorn}),
      posts:M.value(posts.size,{reason:'Distinct paid X posts published in this period, based on verified post IDs.'})};
  }

  /* ---------- Home: Discord performance by period (This Week, Last Week, All Time) ---------- */
  function discordStats(ws,today,lws,lwe){
    const dd=D.discord(),members=dd.members,clicks=dd.clicks;
    const snaps=C.memberReadings(members).filter(h=>h.date<=today);
    const first=snaps[0],latest=snaps.at(-1);
    const began=first?' Member tracking began '+C.dayLong(first.date)+'.':'';
    const lastOnOrBefore=d=>snaps.filter(h=>h.date<=d).at(-1);
    const waiting=dd.loading||(!members&&!dd.error);
    const naM=r=>waiting?M.loading():M.na(r);
    // Members at the end of a period, and the change from the previous period's last snapshot (or from the first snapshot, if tracking began inside the period).
    // A missing observation is unknown, including periods before tracking began.
    const growthFallback=reason=>waiting?M.loading():M.na(reason);
    const period=(from,to,isNow)=>{
      const end=lastOnOrBefore(to);
      if(!end||end.date<from){
        const unknown=naM('No member snapshot in this period.'+began);
        return {members:unknown,growth:unknown,startingMembers:unknown,growthFrom:'',growthTo:''};
      }
      const before=lastOnOrBefore(C.addDays(from,-1)),base=before||snaps.find(h=>h.date>=from&&h.date<=to);
      const reason=base?'Net change between '+C.dayLong(base.date)+' and '+C.dayLong(end.date)+'. Not gross joins.':'Needs two member snapshots.';
      const partial=base&&(base.date!==C.addDays(from,-1)||end.date!==to);
      const growth=!base||base.date===end.date?growthFallback('Needs two member snapshots.'+began):
        partial?M.partial(end.memberCount-base.memberCount,reason+' Complete period boundaries are not recorded.'):M.value(end.memberCount-base.memberCount,{reason});
      return {members:M.value(end.memberCount,{reason:'Members at the latest verified snapshot in this period ('+C.dayLong(end.date)+').'}),
        growth,startingMembers:base?M.value(base.memberCount,{reason:'Starting snapshot: '+C.dayLong(base.date)+'.'}):growthFallback('No starting snapshot.'),
        growthFrom:C.hasValue(growth)?base.date:'',growthTo:C.hasValue(growth)?end.date:'',memberDate:end.date};
    };
    const days=clicks?.days&&typeof clicks.days==='object'?clicks.days:null;
    const clicksIn=(from,to)=>{
      if(!clicks)return dd.error?M.na('Course click counter is temporarily unavailable.'):M.loading();
      if(!days)return M.na('Daily course clicks are not available yet.');
      // Do not backfill the time before click tracking began.
      const firstDay=Object.keys(days).sort()[0];
      if(!firstDay||to<firstDay)return M.na('No dated course click history in this period.');
      const n=Object.entries(days).filter(([d])=>d>=from&&d<=to).reduce((a,[,v])=>a+(Number(v)||0),0);
      const covered=C.num(clicks.daysTotal),gap=covered!==null&&covered<clicks.total;
      return gap?M.partial(n,'Course button clicks with a recorded time ('+C.full(covered)+' of '+C.full(clicks.total)+' clicks have one).'):M.value(n,{reason:'Course button clicks recorded in this period.'});
    };
    const allGrowth=first&&latest&&latest.date!==first.date?M.value(latest.memberCount-first.memberCount,{reason:'Net change from '+C.dayLong(first.date)+' to '+C.dayLong(latest.date)+'. Not gross joins.'}):growthFallback('Needs two member snapshots.'+began);
    const recent=C.num(clicks?.last7Days);
    return {
      week:{...period(ws,today,true),clicks:clicksIn(ws,today)},
      last:{...period(lws,lwe,false),clicks:clicksIn(lws,lwe)},
      all:{members:latest?M.value(latest.memberCount,{reason:'Latest verified member count ('+C.dayLong(latest.date)+').'}):naM('Member count unavailable.'),growth:allGrowth,
        startingMembers:first?M.value(first.memberCount,{reason:'First verified snapshot: '+C.dayLong(first.date)+'.'}):naM('No starting snapshot.'),
        growthFrom:C.hasValue(allGrowth)?first.date:'',growthTo:C.hasValue(allGrowth)?latest.date:'',memberDate:latest?.date||'',
        clicks:clicks?M.value(clicks.total,{reason:'All course button clicks since the counter was enabled. Not signups or enrolments.'+(recent!==null?' Last 7 days: '+C.full(recent)+'.':'')}):clicksIn('','')}
    };
  }
  function discordDateRange(from,to){
    if(!from||!to)return '';
    if(from===to)return C.dayShort(from);
    return from.slice(0,7)===to.slice(0,7)?C.dayShort(from).split(' ')[0]+'–'+C.dayShort(to):C.dayShort(from)+'–'+C.dayShort(to);
  }
  function discordScope(active,stats){
    const label=KPI_PERIODS.find(([key])=>key===active)?.[1]||'This Week',period=periodRange(active);
    if(!period)return label+(stats.growthFrom?' · Growth '+discordDateRange(stats.growthFrom,stats.growthTo):' · Since tracking began');
    const span=discordDateRange(period.from,period.to);
    const partial=stats.growthFrom&&(stats.growthFrom!==C.addDays(period.from,-1)||stats.growthTo!==period.to);
    return label+' · '+span+(partial?' · Growth '+discordDateRange(stats.growthFrom,stats.growthTo):'');
  }
  function homeDetail(r){
    const b=r.budget;
    return U.detailGrid([
      b?['Budget',U.value(b.budget,'money')]:null,
      b?['Planned',U.value(M.value((r.planned||0)+(C.num(r.committed)||0)),'money')]:null,
      b?['Remaining',U.value(b.remaining,'money')]:null,
      ['CPM',C.hasValue(r.cpm)?esc(C.money(r.cpm.value)):''],
      ['Click Source',r.clicks?.provider?esc(r.clicks.provider):''],
      r.key==='gta-vi'&&r.clicks?.allTime!==undefined?['All-Time Clicks',esc(C.full(r.clicks.allTime))]:null,
      ['Coverage',r.views?.posts?esc(C.full(r.views.measured)+' of '+C.full(r.views.posts)+' live posts measured'):''],
      ['Source Updated',r.verifiedAt?esc(C.stamp(r.verifiedAt)):''],
      ['KYC',C.hasValue(r.kyc)?U.value(r.kyc):''],['Earning Creators',C.hasValue(r.earning)?U.value(r.earning):'']
    ].filter(Boolean))+(r.warnings.length?'<p class="fv-detail-note">'+r.warnings.map(esc).join(' ')+'</p>':'');
  }
  function netGrowth(members){
    const h=C.memberReadings(members);
    if(!members)return M.loading();
    if(h.length<2||h[0].date===h.at(-1).date)return M.na('Member Growth needs two dated daily snapshots. '+(h.length?'Snapshots began '+C.dayLong(h[0].date)+'.':'No snapshot recorded yet.'));
    return M.value(h.at(-1).memberCount-h[0].memberCount,{reason:'Change in members between the snapshots of '+C.dayLong(h[0].date)+' and '+C.dayLong(h.at(-1).date)+'. Not gross joins.'});
  }

  function discordPage(st){
    ensure('discord');
    const dd=D.discord(),members=dd.members,clicks=dd.clicks;
    const active=selectedPeriod('discord',st),todayUK=C.londonDay(Date.now()),startUK=C.weekStart(todayUK);
    const periodStats=discordStats(startUK,todayUK,C.addDays(startUK,-7),C.addDays(startUK,-1));
    const scoped=active==='all-time'?periodStats.all:active==='last-week'?periodStats.last:periodStats.week;
    const strip=U.strip([metric('Members','users',scoped.members,'count'),metric('Net Growth','trend',scoped.growth,'signed'),metric('Course Clicks','graduation',scoped.clicks),metric('Start Members','users',scoped.startingMembers)]);
    const chartPeriod=periodRange(active)||{from:startUK,to:todayUK};
    const chartScope={text:active==='last-week'?'Last Week':'This Week',detail:discordDateRange(chartPeriod.from,chartPeriod.to)+(active==='all-time'?' · Daily chart; headline metrics are all time.':'')};
    // The last four weeks that have snapshots. Earlier weeks are never back-filled.
    const readings=C.memberReadings(members),weeks=C.recentWeeks(readings,4);
    const netSeries=weeks.filter(w=>w.value!==null);
    // Daily member growth: change between snapshots on consecutive UK days (last 14 days). Negative days are real.
    const byDay=new Map(readings.map(h=>[h.date,h.memberCount]));
    const today=C.londonDay(Date.now());
    const dailyNet=[...byDay].filter(([d])=>byDay.has(C.addDays(d,-1))).map(([d,v])=>({week:d,label:C.dayShort(d),range:C.dayLong(d),value:v-byDay.get(C.addDays(d,-1)),incomplete:d===today})).slice(-14);
    const courseSeries=C.eventSeries(Object.entries(clicks?.days||{}).map(([date,clicks])=>({date,clicks})));
    const courseByWeek=new Map(courseSeries.map(p=>[p.week,p]));
    const dailyCourse=C.dailyEventSeries(Object.entries(clicks?.days||{}).map(([date,clicks])=>({date,clicks})));
    const chart=campaignChart(U.chartPanel({id:'discord-chart',allowEmptyWeek:true,headerNote:chartScope,measures:[
      {key:'course',label:'Course Clicks',title:'Daily Course Clicks',series:dailyCourse,period:'Day',weekFrom:chartPeriod.from,unit:'Course Clicks'},
      dailyNet.length>=1?{key:'daily',label:'Daily Member Growth',title:'Daily Member Growth',series:dailyNet,period:'Day',weekFrom:chartPeriod.from,format:'signed',unit:'Member Growth',kinds:['bar','line']}:null,
      // Owner (26 Nov): "Weekly X" naming, matching OF Terms' "Weekly Clicks"; no table view (line/bar only, per every other chart).

    ].filter(Boolean)},chartState('discord','discord-chart')),'Daily Course Clicks');
    const ts=tableState('discord','discord-table');if(!ts.sort)ts.sort={key:'week',dir:-1};
    const table=U.tablePanel({id:'discord-table',title:'Listings',icon:'users',dropEmptyRows:true,hideEmpty:false,search:true,searchPlaceholder:'Search weeks',searchText:r=>r.range,cls:'is-list is-discord-history',empty:'No verified weekly history',
      rows:weeks.slice().reverse(),rowKey:r=>r.week,
      columns:[
        {key:'week',label:'Week',type:'name',html:r=>esc(r.range)+(r.incomplete?' (in progress)':''),sort:r=>r.week},
        {key:'end',label:'Members',get:r=>r.end===null?M.na('No snapshot this week.'):M.value(r.end)},
        {key:'net',label:'Net Growth',format:'signed',get:r=>r.value===null?M.na('Needs the previous week’s snapshot.'):M.value(r.value)},
        {key:'course',label:'Course Clicks',get:r=>courseByWeek.has(r.week)?M.value(courseByWeek.get(r.week).value):M.na('No dated course history in this week.')}
      ]},ts);
    // Owner (26 Nov): a short line saying what this page actually tracks, and the Weekly Stats table (previously built but never shown).
    const intro='<p class="fv-filter-note">'+U.icon('discord',14)+'<span>How the Fanvue Academy community is growing: member count, net new members, and clicks on the free course button.</span></p>';
    return {title:'Discord',chipHtml:'<span class="fv-campaign-chip" style="background:#5865F2" aria-hidden="true">'+U.icon('discord',15)+'</span>',refreshLabel:'Refresh',updated:members?.checkedAt||clicks?.checkedAt,stale:!!dd.error,body:periodControls('discord',st,true,periodStats)+strip+chart+table};
  }

  /* X Articles: every article redirect leads to the Fanvue partner (affiliates) page, so all
     verified placements are Partner Articles. RTs without a matched original stay under X Articles. */
  const articleGroup=r=>/fanvue\.com\/pages\/affiliates/i.test(r.destinationUrl||'')||/\/[rs]\/A\d+/i.test(r.trackingUrl||'')?'Partner Articles':'X Articles';
  /* ---------- shared record builders (campaign pages and Accounts use the same records) ---------- */
  function xaRecords(){
    const xa=D.campaign('x-articles'),rt=D.campaign('article-rts');
    return [
      ...(xa?.rows||[]).filter(isBooking).map(r=>xRecord(r,{campaign:articleGroup(r),parent:'X Articles',type:'article',clicks:r=>C.num(r.clicks)===null?M.na('Click storage unavailable.'):M.value(r.clicks,{reason:'Site redirect clicks (/r/ and /s/ links).'})})),
      ...(rt?.rows||[]).filter(isBooking).map(r=>xRecord(r,{campaign:'X Articles',parent:'X Articles',type:'rt',ownLink:false,views:()=>M.na('Repost impressions are not measured; the original post’s views are in the details.'),clicks:()=>M.na('Paid RTs have no tracked link.')}))
    ];
  }
  const gtaClicks=r=>{const v=C.num(r.clicks);if(v!==null)return M.value(v,{reason:'Short.io human clicks since publication.'});return M.na(r.clickError||(r.trackingUrl?(r.posted?'No post-publication reading yet.':'Not live yet.'):'No tracking link in the source sheet.'));};
  function gtaRecords(){
    const qr=D.campaign('gta-qrts'),og=D.campaign('gta-originals'),mq=D.campaign('gta-mandy');
    return [
      ...(og?.rows||[]).filter(isBooking).map(r=>xRecord(r,{campaign:gtaGroup(r),parent:'GTA VI',type:'post',clicks:gtaClicks})),
      ...(qr?.rows||[]).filter(isBooking).map(r=>xRecord(r,{campaign:gtaGroup(r),parent:'GTA VI',type:'qrt',clicks:gtaClicks})),
      ...(mq?.rows||[]).filter(isBooking).map(r=>xRecord(r,{campaign:'Mandy',parent:'GTA VI',type:'qrt',clicks:gtaClicks}))
    ];
  }
  // Historical non-X costs stay in period finance totals only; never render these rows.
  function igSpendRecords(){
    return (D.campaign('gta-instagram')?.rows||[]).filter(isBooking).map(r=>xRecord(r,{campaign:'GTA VI',parent:'GTA VI',platform:'Instagram',type:r.format==='post'?'post':'story',ownLink:false,
      views:()=>M.na('Instagram views are not measured.'),clicks:()=>M.na('No tracked link for this placement.')}));
  }
  const ofRecords=()=>(D.campaign('of-terms')?.rows||[]).filter(isBooking).map(r=>xRecord(r,{campaign:'OF Terms',parent:'OF Terms',type:r.type||r.format||'post',clicks:r=>C.num(r.clicks)===null?M.na('No /of/ link events recorded.'):M.value(r.clicks,{reason:'Events on the /of/ tracking link.'})}));
  const guruRecords=()=>(D.campaign('guru-rts')?.paidReposts||[]).map(r=>xRecord(r,{campaign:'Guru RTs',parent:'Guru RTs',type:'rt',ownLink:false,
    views:()=>M.na('Repost impressions are not measured. The original post’s views are in its group.'),clicks:()=>M.na('Paid RTs have no tracked link.')}));

  /* ---------- campaign subpages ---------- */
  // Each campaign page opens on an Overview (totals, chart and one summary row per group).
  // Every group has its own tab with its own KPIs, chart and placement table.
  function subTabs(tabs,active){
    return '<nav class="fv-segments fv-subnav" aria-label="Campaign sections">'+tabs.map(t=>'<button type="button" data-view="'+esc(t.key)+'" aria-pressed="'+(t.key===active)+'"'+(t.key===active?' aria-current="page"':'')+'>'+esc(t.label)+(t.n!==undefined?'<span class="fv-subnav-n">'+esc(C.full(t.n))+'</span>':'')+'</button>').join('')+'</nav>';
  }
  const KPI_PERIODS=[['this-week','This Week'],['last-week','Last Week'],['all-time','All Time']];
  const selectedPeriod=(page,st={})=>KPI_PERIODS.some(([k])=>k===st.period)?st.period:pageState(page).period||'this-week';
  function periodRange(active){
    if(active==='all-time')return null;
    const today=C.londonDay(Date.now()),ws=C.weekStart(today);
    return active==='last-week'?{from:C.addDays(ws,-7),to:C.addDays(ws,-1)}:{from:ws,to:today};
  }
  function periodControls(page,st={},only=true,discordPeriods=null){
    const active=selectedPeriod(page,st);
    return (only?overviewTabs():'')+'<nav class="fv-segments fv-kpi-periods" aria-label="KPI reporting period">'+KPI_PERIODS.map(([key,label])=>{
      const s=discordPeriods&&(key==='all-time'?discordPeriods.all:key==='last-week'?discordPeriods.last:discordPeriods.week);
      return '<button type="button" data-period="'+key+'" aria-pressed="'+(active===key)+'"'+(discordPeriods?' title="'+esc(discordScope(key,s))+'"':'')+'>'+label+'</button>';
    }).join('')+'</nav>';
  }
  function scopedViews(history,period){
    return C.periodViewMetric(history,period.from,period.to,{born:postBorn});
  }
  function paidDay(row){
    return row?.paidAt?(window.FanvuePaymentDates?.paymentDay(row.paidAt)||C.londonDay(row.paidAt)):'';
  }
  function scopedCpc(key,records,period){
    const links=new Set(),seen=new Set(),usage=new Map();let cost=0,clicks=0,matched=0,gaps=0;
    for(const x of records){const link=x.raw.trackingUrl;if(link)usage.set(link,(usage.get(link)||0)+1);}
    for(const x of records){
      const r=x.raw,day=paidDay(r);
      if(!actualPaid(x)||!day||day<period.from||day>period.to||x.live!==true||x.type==='RT'||x.price===null||!r.trackingUrl||r.sharedTracking||r.identityAmbiguous||usage.get(r.trackingUrl)>1)continue;
      const k=rowKeyOf(r);if(seen.has(k)||links.has(r.trackingUrl))continue;seen.add(k);links.add(r.trackingUrl);
      const m=datedClickMetric(datedClicks(key,[x]),period.from,period.to);
      if(!C.hasValue(m)){gaps++;continue;}
      const partial=C.num(r.datedPaidAmount),amount=partial===null?x.price:Math.min(x.price,partial);
      if(amount<x.price||m.state==='partial')gaps++;
      cost+=amount;clicks+=m.value;matched++;
    }
    if(!matched||clicks<=0)return M.na('No matched paid costs and dated clicks for this period.');
    return M.partial(cost/clicks,'Recorded payment amounts divided by dated clicks on the same matched placements. Planned allocations are excluded. Coverage may be incomplete.');
  }
  function scopedKpis(page,st,allTime,records,{finance=[],history,sourceKey=page}={}){
    const period=periodRange(selectedPeriod(page,st));
    if(!period||!allTime)return allTime;
    const t=periodTotals(period.from,period.to,records,finance);
    const clicks=datedClickMetric(datedClicks(sourceKey,records),period.from,period.to);
    return {spend:t.spend,views:history?scopedViews(history,period):t.views,clicks,cpc:scopedCpc(sourceKey,records,period)};
  }
  function scopedRtKpis(page,st,records,history,allViews,allPosts){
    const period=periodRange(selectedPeriod(page,st)),total=xKpis(records);
    if(!period)return {rts:M.value(records.filter(actualPaid).reduce((n,x)=>n+(C.num(x.raw.purchasedPosts)||1),0)),views:allViews,spend:total.spend,posts:M.value(allPosts)};
    const paid=records.filter(x=>{const d=paidDay(x.raw);return actualPaid(x)&&d&&d>=period.from&&d<=period.to;});
    const missing=records.some(x=>actualPaid(x)&&!paidDay(x.raw)),ids=new Set(paid.map(x=>C.postId(x.raw.sourcePostUrl||x.raw.postUrl)).filter(Boolean));
    const metricCount=(n)=>missing?(paid.length?M.partial(n,'Only RT bookings with verified payment dates are included.'):M.na('Payment dates are not recorded for these RTs.')):M.value(n);
    return {rts:metricCount(paid.reduce((n,x)=>n+(C.num(x.raw.purchasedPosts)||1),0)),views:scopedViews(history,period),spend:periodTotals(period.from,period.to,records,[]).spend,posts:metricCount(ids.size)};
  }
  const overviewTabs=()=>'<div class="fv-view-slot"><span>Overview</span></div>';
  const campaignChart=(chart,title='Daily Clicks')=>chart||U.chartPanel({id:'empty-week-chart',allowEmptyWeek:true,measures:[{key:'empty',label:title,title,period:'Day',series:[],unit:title}]},{});
  const pickTab=(view,tabs,alias={})=>{const v=alias[view]||view;return tabs.some(t=>t.key===v)?v:'overview';};
  const livePostCount=records=>{const ids=new Set();let noLink=0;
    for(const x of records){if(x.live!==true)continue;const l=(x.raw.postUrls?.length?x.raw.postUrls:[x.link]).map(u=>C.postId(u)).filter(Boolean);if(l.length)l.forEach(i=>ids.add(i));else noLink++;}
    return ids.size+noLink;};
  const summaryRow=(key,name,records,extra={})=>({key,name,view:key,records,placements:records.length,live:livePostCount(records),k:xKpis(records),...extra});
  // One row per group: the four KPIs plus placements and live posts. The name opens that group's tab.
  function summaryTable(page,id,{title,icon,nameLabel='Group',rows,empty}){
    return U.tablePanel({id,title,icon,rows,rowKey:r=>r.key,rowLabel:r=>r.name,minWidth:760,empty,hideEmpty:false,cls:'is-summary',
      columns:[
        {key:'name',label:nameLabel,type:'name',html:r=>'<span class="fv-name">'+U.marker(r.icon||icon,'',{plain:true})+(r.view?'<a class="fv-sub-link" href="#'+esc(page+'/'+r.view)+'">'+esc(r.name)+'</a>':'<span>'+esc(r.name)+'</span>')+'</span>',sort:r=>r.name.toLowerCase()},
        {key:'placements',label:'Placements',type:'count',get:r=>r.placements},
        {key:'live',label:'Live Posts',type:'count',get:r=>r.live},
        {key:'spend',label:'Spend',format:'money',get:r=>r.k.spend},
        {key:'views',label:'Views',get:r=>r.k.views},
        {key:'clicks',label:'Clicks',get:r=>r.k.clicks},
        {key:'cpc',label:'CPC',format:'money',get:r=>r.k.cpc}
      ]},tableState(page,id));
  }
  // Views chart from dated per-post readings (last 14 UK days): views gained each day.
  // Owner (25 Nov): graphs show per-period figures only; totals stay as numbers in the KPI strip.
  // A post's first reading is its starting point, never counted as one day's gain.
  function viewsChart(id,page,history,{idOf=r=>r.id,at=r=>r.at,value=r=>r.views,extra=[],noun='Views'}={}){
    const d=C.dailySeries(history,{id:idOf,at,value,born:postBorn}),tip=p=>({...p,extra:p.count+' posts with a reading'+(p.fresh?' · '+p.fresh+' new '+(p.fresh===1?'post':'posts')+' counted from publication':'')});
    const gained=d.gained.some(p=>p.value!==null)?d.gained.map(tip):[],weekFrom=periodRange(selectedPeriod(page))?.from;
    return U.chartPanel({id,allowEmptyWeek:true,measures:[
      ...extra,
      gained.length?{key:'gained',label:'Daily '+noun,title:'Daily '+noun,series:gained,period:'Day',weekFrom,format:'compact',tipFormat:'count',unit:noun==='Views'?'Views Gained':noun+' Gained'}:null
    ].filter(Boolean)},chartState(page,id));
  }
  // Publication time of an X post, from its ID (X IDs carry their creation time).
  const postBorn=key=>{const m=String(key||'').match(/(\d{15,20})/);if(!m)return null;try{return Number((BigInt(m[1])>>22n)+1288834974657n);}catch{return null;}};
  // Dated view readings for a set of placement records (GTA VI and X Articles posts), one id per post.
  function xHistory(records,{includeGuru=false}={}){
    const gr=D.gta().report,dash=D.dashboard(),of=D.of().report;
    const ids=new Set(),codes=new Map(),latest=[];
    const addRow=r=>{
      if(r.posted!==true)return;
      const entries=r.postViews?Object.entries(r.postViews):[[C.postId(r.postUrl),r.views??r.xViews]];
      for(const [id,v] of entries){
        if(!id)continue;ids.add(String(id));
        if(r.code)codes.set(String(r.code),String(id));
        const at=r.metricAt||r.xUpdated||r.metricLastVerifiedAt||r.at;
        if(at&&C.num(v)!==null)latest.push({id:String(id),at,views:C.num(v)});
      }
    };
    for(const x of records){
      const r=x.raw;
      if(x.platform!=='X')continue;
      if(x.type!=='RT')addRow(r);
      else if(r.paid===true&&r.posted===true){
        const id=C.postId(r.sourcePostUrl||r.postUrl);if(id)ids.add(String(id));
        if(r.sourceViews===true)addRow({...r,postUrl:r.sourcePostUrl||r.postUrl,views:r.sourceOriginalViews});
      }
    }
    if(includeGuru||records.some(x=>x.parent==='Guru RTs'))for(const r of D.campaign('guru-rts')?.rows||[])addRow(r);
    // Reuse real readings of the exact post across reporting sources. One X ID,
    // never a separate prefixed identity for the same post in another campaign.
    const rows=[...(gr?.history||[]),...(gr?.originals?.history||[]),...(gr?.mandy?.history||[]),...(dash?.history||[]),...(of?.history||[]),
      ...['gta-qrts','gta-originals','gta-mandy','x-articles','article-rts','of-terms','guru-rts'].flatMap(k=>D.campaign(k)?.history||[]),
      ...(D.campaign('guru-rts')?.rows||[]).flatMap(r=>(r.history||[]).map(h=>({...h,id:r.id}))),...latest];
    const out=new Map();
    for(const h of rows){
      const id=String(h.postId||h.id||codes.get(String(h.code||''))||'');
      if(!ids.has(id)||!h.at||C.num(h.views)===null)continue;
      const key=id+'|'+h.at;if(!out.has(key))out.set(key,{id,at:h.at,views:C.num(h.views)});
    }
    return [...out.values()];
  }
  const postIdsOf=records=>new Set(records.flatMap(x=>x.raw.postUrls?.length?x.raw.postUrls:[x.raw.postUrl]).map(u=>C.postId(u)).filter(Boolean).map(String));

  function xArticlesPage(st){
    ensure('overview');
    const ov=D.overview(),s=ov?C.campaignSummary(ov,'x-articles'):null,xa=D.campaign('x-articles'),dash=D.dashboard();
    const names=new Map((dash?.campaigns||[]).map(c=>[c.id,c.name]));
    const records=xaRecords();
    const arts=records.filter(x=>x.type!=='RT'),rts=records.filter(x=>x.type==='RT');
    const tabs=[{key:'overview',label:'Overview'},{key:'articles',label:'Articles',n:arts.length},{key:'rts',label:'RTs',n:rts.length}];
    const tab=pickTab(st.view,tabs,{'original-posts':'articles','paid-reposts':'rts'});
    const scoped=tab==='articles'?arts:tab==='rts'?rts:records,id='xa-'+tab;
    const f=xState('x-articles',id),shown=scoped.filter(xMatch(f));
    const listState=tableState('x-articles',id);if(!listState.sort)listState.sort={key:tab==='rts'?'views':'clicks',dir:-1};
    const k=scopedKpis('x-articles',st,!s?null:tab==='overview'?{spend:s.spend,views:s.views,clicks:s.clicks,cpc:s.cpc}:xKpis(shown),tab==='overview'?records:shown);
    const rtK=s&&tab==='rts'?scopedRtKpis('x-articles',st,shown,xHistory(shown),C.viewsOf([{id:'article-rts',rows:shown.map(x=>x.raw)}]),new Set(shown.filter(actualPaid).map(x=>C.postId(x.raw.sourcePostUrl||x.raw.postUrl)).filter(Boolean)).size):null;
    const strip=tab==='rts'?rtK?U.strip([metric('RTs','refresh',rtK.rts),metric('Views','eye',rtK.views,'compact'),metric('Spend','wallet',rtK.spend,'moneyShort'),metric('Articles','doc',rtK.posts)]):loadingStrip([['RTs','refresh'],['Views','eye'],['Spend','wallet'],['Articles','doc']]):!k?loadingStrip(KPI_LOADING):kpiStrip(k);
    // Chart history is limited to the posts in this tab.
    // The Paid RTs tab charts the articles the RTs promote (RT impressions are not measured).
    const own=(tab==='rts'?arts:shown).filter(x=>x.type!=='RT'),codes=new Set(own.map(x=>String(x.raw.code||''))),ids=postIdsOf(own);
    const hist=xHistory(tab==='overview'?records:shown);
    const clickSeries=datedClicks('x-articles',own);
    // Owner (26 Nov): one chart name, "Daily Views", everywhere a views-over-time chart appears.
    const chart=campaignChart(viewsChart('xa-chart','x-articles',hist,{idOf:r=>r.postId||r.code,extra:[tab!=='rts'?{key:'clicks',label:'Daily Clicks',title:'Daily Clicks',series:clickSeries,period:'Day',weekFrom:periodRange(selectedPeriod('x-articles',st))?.from,unit:'Clicks'}:null]}),tab==='rts'?'Daily Views':'Daily Clicks');
    let body;
    if(tab==='overview'){
      const originals=arts.filter(x=>x.paid||x.live===true||C.hasValue(x.clicks)&&x.clicks.value>0),eff=C.placementEfficiency(originals.map(x=>x.raw));
      const ts=tableState('x-articles','xa-overview');if(!ts.sort)ts.sort={key:'age',dir:-1};
      body=chart+U.tablePanel({id:'xa-overview',title:'Listings',icon:'doc',age:publicationAge,rows:originals,search:true,cls:'is-list is-placement-list',rowKey:x=>rowKeyOf(x.raw),rowLabel:x=>x.account,minWidth:820,hideEmpty:false,columns:resultColumns(originals,{article:true}),expand:x=>xDetail(x,eff,{extra:[['Headline',esc(articleHeadline(x.raw))]]})},ts);
    }else if(tab==='rts'){
      const grouped=new Map();
      for(const x of shown){const key=C.postId(x.raw.sourcePostUrl||x.raw.postUrl)||'unlinked';if(!grouped.has(key))grouped.set(key,[]);grouped.get(key).push(x);}
      const rows=[...grouped].map(([key,list])=>{
        const original=arts.find(x=>C.postId(x.raw.postUrl)===key);
        const g=D.campaign('article-rts')?.articleRtGroups?.find(g=>String(g.postId)===key);
        return {key,list,name:original?.account||g?.handle||(key==='unlinked'?'Unlinked article':'Article'),headline:original?articleHeadline(original.raw):'',url:list[0].raw.sourcePostUrl||original?.link||'',
          views:original?.views||(C.num(g?.views)!==null?M.value(g.views):M.na('Original views unavailable.')),k:xKpis(list)};
      });
      body=chart+U.tablePanel({id:'xa-rts',title:'Listings',icon:'refresh',age:r=>originalAge(r.key),rows,search:true,searchText:r=>r.name,rowKey:r=>r.key,rowLabel:r=>r.name,minWidth:898,cls:'is-list is-placement-list',hideEmpty:false,
        columns:rtSummaryColumns({name:r=>r.name,views:r=>r.views,spend:r=>r.k.spend,rtCount:r=>r.list.filter(x=>x.paid).reduce((n,x)=>n+(C.num(x.raw.purchasedPosts)||1),0),url:r=>r.url}),expand:r=>U.detailGrid([['Headline',esc(r.headline||'')]])+rtCosts(r.list)},tableState('x-articles','xa-rts'))+
        '<p class="fv-filter-note">Views include organic reach. Separate RT clicks and views are not tracked.</p>'+(D.campaign('article-rts')?.trackingWarning?'<p class="fv-filter-note">'+esc(D.campaign('article-rts').trackingWarning)+'</p>':'');
    }else{
      const eff=C.placementEfficiency(shown.map(x=>x.raw));
      body=chart+U.tablePanel({id,title:'Listings',icon:'doc',age:publicationAge,records:scoped,rows:scoped,search:true,cls:'is-list is-placement-list',rowKey:x=>rowKeyOf(x.raw),rowLabel:x=>x.account,minWidth:820,hideEmpty:false,
        columns:resultColumns(scoped,{article:true}),expand:x=>xDetail(x,eff,{extra:[['Headline',esc(articleHeadline(x.raw))]]})},tableState('x-articles',id));
    }
    const label={overview:'Article Performance',articles:'Article Performance',rts:'Paid RT Performance'}[tab];
    return {title:'X Articles',chip:'x-articles',refreshLabel:'Refresh',updated:ov?.checkedAt,stale:!!(D.overviewStatus().error||xa?.sourceStale||xa?.dataWarning),
      body:subTabs(tabs,tab)+periodControls('x-articles',st,false)+strip+body+overviewNotice()+(tab==='overview'&&s?'<div class="fv-cost-split"><span>Articles <b>'+U.value(C.spendOf(xa),'money')+'</b></span><span>RTs <b>'+U.value(C.spendOf(D.campaign('article-rts')),'money')+'</b></span></div>':'')};
  }

  // GTA VI content groups: Mandy is tab 17; the owner confirmed (25 Nov) that the earlier X tabs 12, 14, 15 and 16 are Lucia.
  const GTA_LUCIA=new Set(['GTA1','GTA2','GTAQ','GTAQ2']);
  const gtaGroup=r=>r.campaign==='GTAM'?'Mandy':GTA_LUCIA.has(r.campaign)?'Lucia':'GTA VI';
  function gtaPage(st){
    ensure('overview');ensure('gta');
    const ov=D.overview(),gr=D.gta().report,s=ov?C.campaignSummary(ov,'gta-vi',{gtaReport:gr}):null,qr=D.campaign('gta-qrts'),og=D.campaign('gta-originals'),mq=D.campaign('gta-mandy');
    const records=gtaRecords();
    const group=g=>records.filter(x=>x.campaign===g);
    const tabs=[{key:'overview',label:'Overview'},{key:'lucia',label:'Lucia',n:group('Lucia').length},{key:'mandy',label:'Mandy',n:group('Mandy').length},
      {key:'other',label:'Other',n:group('GTA VI').length}].filter(t=>t.key!=='other'||t.n!==0);
    const tab=pickTab(st.view,tabs,{'all-formats':'overview','x-original-posts':'lucia','x-quote-posts':'lucia','mandy-qrts':'mandy'});
    const scoped=tab==='lucia'?group('Lucia'):tab==='mandy'?group('Mandy'):tab==='other'?group('GTA VI'):records,id='gta-'+tab;
    const f=xState('gta-vi',id),shown=scoped.filter(xMatch(f));
    let strip;
    if(!s)strip=loadingStrip(KPI_LOADING);
    else if(tab==='overview'){
      const k={spend:s.spend,views:s.views,clicks:s.clicks,cpc:s.cpc,spendNote:undefined,
        clicksChip:s.clicks&&C.hasValue(s.clicks)&&s.clicks.state!=='stale'&&s.clicks.allTime!==undefined?U.reasonButton(C.full(s.clicks.allTime)+' All-Time',s.clicks.reason,'fv-chip'):undefined};

      strip=kpiStrip(scopedKpis('gta-vi',st,k,records,{finance:igSpendRecords()}));
    }else strip=kpiStrip(scopedKpis('gta-vi',st,xKpis(shown),shown));
    // Compact, campaign-wide (All Time) budget and IG summary, on the Overview only.
    const b=s?.budget;
    const budget=tab==='overview'&&b?U.supportPanel('Budget','wallet',U.inlineMetrics([
      ['Budget',U.value(b.budget,'money')],
      ['Paid',U.value(s.paidSpend,'money')],
      ['Allocated',U.value(s.allocatedSpend,'money')],
      ['Committed',U.value(M.value(s.committed||0),'money')],
      ['Planned',U.value(M.value(s.planned||0),'money')],
      ['Remaining',U.value(b.remaining,'money')],

    ].filter(Boolean))):'';
    // Views chart for the posts in this tab (every post, including extra posts on a booking); Spend by group on the Overview.
    const ids=postIdsOf(shown);
    const history=xHistory(shown);
    const clickDays=shortIoDaily(gtaClickReport(gr),shown);
    const chart=campaignChart(viewsChart('gta-chart','gta-vi',history,{extra:[{key:'clicks',label:'Daily Clicks',title:'Daily Clicks',series:clickDays,period:'Day',weekFrom:periodRange(selectedPeriod('gta-vi',st))?.from,unit:'Clicks'}]}));
    let body;
    const eff=C.placementEfficiency(shown.map(x=>x.raw));
    const quoted=new Map([...(qr?.quotedOriginals?.rows||[]),...(mq?.quotedOriginals?.rows||[])].flatMap(o=>(o.qrts||[]).map(q=>[q.postUrl,o])));
    body=chart+xTable('gta-vi',id,{title:'Listings',icon:'gamepad',records:scoped,f,groups:tab==='overview',empty:s?'No listings':waiting('Loading…'),expand:x=>{const o=quoted.get(x.raw.postUrl);return xDetail(x,eff,{source:o?U.extLink(o.originalUrl,o.handle?'@'+o.handle:'Source Post'):'',extra:[['Quoted post views',o&&C.num(o.views)!==null?esc(C.full(o.views)):'']]});}})+filteredNote(f)+(tab==='overview'?budget:'');
    // Shown only when a spreadsheet tab could not be read, so its rows are missing from the totals.
    const tabWarning=(qr?.missingTabs||[]).map(t=>'<div class="fv-notice" role="status">'+U.icon('alert',15)+'<span>'+U.reasonButton('Missing Data',t+' could not be read from the spreadsheet, so its rows are not counted.','fv-notice-reason')+'</span></div>').join('');
    const label=tab==='overview'?'Campaign Performance':tabs.find(t=>t.key===tab).label+' Performance';
    return {title:'GTA VI',chip:'gta-vi',refreshLabel:'Refresh',updated:ov?.checkedAt,stale:!!(D.overviewStatus().error||qr?.sourceStale||og?.sourceStale),
      body:subTabs(tabs,tab)+periodControls('gta-vi',st,false)+strip+body+overviewNotice()+tabWarning};
  }

  // Viral campaigns reuse their canonical placement objects; never add a second finance record.
  const gtaClickReport=gr=>({activity:[...(gr?.activity||[]),...(gr?.originals?.activity||[]),...(gr?.mandy?.activity||[])]});
  function shortIoDaily(report,records){
    const links=new Map(),byCode=new Map();
    for(const x of records){
      const r=x.raw;if(x.live!==true||r.sharedTracking||r.crossCampaignTracking||r.identityAmbiguous)continue;
      const key=r.trackingUrl||String(r.code||'');if(!key)continue;
      links.set(key,x);if(r.code)byCode.set(String(r.code),key);
    }
    const overview=['gta-qrts','gta-originals','gta-mandy'].flatMap(id=>D.campaign(id)?.clickHistory||[]);
    const selected=new Map();
    // Merge duplicate link/day readings, never sum snapshots of the same interval.
    // Prefer a complete interval over a partial one, then the newest verification.
    for(const r of [...overview,...(report?.activity||[])]){
      const key=links.has(r.trackingUrl)?r.trackingUrl:byCode.get(String(r.code));
      if(!key||C.num(r.clicks)===null||!C.validDay(r.date))continue;
      const x=links.get(key),postId=C.postId(x.raw.postUrl);
      if(r.postId&&postId&&String(r.postId)!==String(postId))continue;
      const id=key+'|'+r.date,prior=selected.get(id);
      const end=Date.parse(r.end)||0,prevEnd=Date.parse(prior?.end)||0,at=Date.parse(r.at)||0,prevAt=Date.parse(prior?.at)||0;
      if(!prior||end>prevEnd||end===prevEnd&&(at>prevAt||at===prevAt&&prior.stale&&!r.stale))selected.set(id,{...r,key});
    }
    const sums=new Map();
    for(const r of selected.values()){
      const d=sums.get(r.date)||{value:0,codes:new Set(),stale:false};d.codes.add(r.key);d.value+=r.clicks;
      const last=r.end?C.londonDay(Date.parse(r.end)+1):'';
      d.stale||=r.stale===true||!!(last&&last===r.date);sums.set(r.date,d);
    }
    return [...sums].sort(([a],[b])=>a.localeCompare(b)).map(([date,d])=>{
      const expected=[...links.values()].filter(x=>{const born=C.londonDay(postBorn(x.raw.postUrl));return born&&born<=date;}).length;
      return {week:date,label:C.dayShort(date),range:C.dayLong(date),value:d.value,incomplete:date===C.londonDay(Date.now())||d.codes.size<expected||d.stale,extra:d.codes.size+' tracked links with a verified daily reading'+(d.codes.size<expected?' of '+expected:'')+'. Human clicks since each post was published.'};
    }).slice(-14);
  }
  function viralPage(st){
    ensure('overview');ensure('gta');
    const ov=D.overview(),gr=D.gta().report;
    const sources=(ov?.campaigns||[]).filter(c=>c.id==='gta-mandy');
    const quoted=sources.flatMap(c=>c.quotedOriginals?.rows||[]);
    const mapping=new Map(quoted.flatMap(o=>(o.qrts||[]).map(q=>[C.postId(q.postUrl),o])));
    const records=gtaRecords().filter(x=>x.campaign==='Mandy');
    const f=xState('viral-qrts','viral-results'),shown=records.filter(xMatch(f));
    const ids=postIdsOf(shown),daily=shortIoDaily(gr?.mandy,shown),chart=campaignChart(viewsChart('viral-chart','viral-qrts',xHistory(shown),{extra:[{key:'clicks',label:'Daily Clicks',title:'Daily Clicks',series:daily,period:'Day',weekFrom:periodRange(selectedPeriod('viral-qrts',st))?.from,unit:'Clicks'}]}));
    const ts=tableState('viral-qrts','viral-results');if(!ts.sort)ts.sort={key:'age',dir:-1};
    const eff=C.placementEfficiency(shown.map(x=>x.raw));
    const table=U.tablePanel({id:'viral-results',title:'Listings',icon:'zap',age:publicationAge,records,rows:records,search:true,filter:xMatch(f),filters:xFilters('viral-results',records,f),rowKey:x=>rowKeyOf(x.raw),rowLabel:x=>x.account,
      minWidth:820,cls:'is-list is-placement-list',hideEmpty:false,columns:resultColumns(records),
      expand:x=>{const o=mapping.get(C.postId(x.raw.postUrl));return xDetail(x,eff,{source:o?U.extLink(o.originalUrl,'@'+o.handle):'',extra:[['Quoted post views',o&&C.num(o.views)!==null?U.value(M.value(C.num(o.views))):''],['View count',o?'Views of the quoted post are excluded from QRT totals.':'']]});}},ts);
    const l=look(VIRAL.key);
    return {title:'Viral QRTs',chipHtml:'<span class="fv-campaign-chip" style="background:'+C.PALETTE[l.color].fill+'">'+U.icon(l.icon,15)+'</span>',refreshLabel:'Refresh',updated:ov?.checkedAt,
      body:periodControls('viral-qrts',st)+(ov?kpiStrip(scopedKpis('viral-qrts',st,xKpis(shown),shown)):loadingStrip(KPI_LOADING))+chart+table+overviewNotice()};
  }

  function ofPage(st){
    ensure('overview');ensure('of');
    const ov=D.overview(),s=ov?C.campaignSummary(ov,'of-terms'):null,c=D.campaign('of-terms'),rep=D.of().report;
    const records=ofRecords(),f=xState('of-terms','of-results'),shown=records.filter(xMatch(f));
    const k=scopedKpis('of-terms',st,s?(xActive(f)?xKpis(shown):s):null,shown);
    const codes=new Set(shown.map(x=>String(x.raw.code)));
    const series=datedClicks('of-terms',shown);
    const chart=campaignChart(viewsChart('of-chart','of-terms',xHistory(shown),{extra:[{key:'clicks',label:'Daily Clicks',title:'Daily Clicks',series,period:'Day',weekFrom:periodRange(selectedPeriod('of-terms',st))?.from,unit:'Clicks'}]}));
    const eff=C.placementEfficiency(shown.map(x=>x.raw));
    return {title:'OF Terms',chip:'of-terms',refreshLabel:'Refresh',updated:ov?.checkedAt,stale:!!c?.sourceStale,
      body:periodControls('of-terms',st)+(!k?loadingStrip(KPI_LOADING):kpiStrip(k))+chart+xTable('of-terms','of-results',{title:'Listings',icon:'users',records,f,groups:false,includeType:false,expand:x=>xDetail(x,eff)})+overviewNotice()};
  }

  function guruPage(st){
    ensure('overview');
    const ov=D.overview(),g=D.campaign('guru-rts'),s=ov?C.campaignSummary(ov,'guru-promotion'):null,records=guruRecords();
    const groups=new Map();for(const x of records){const key=C.postId(x.raw.sourcePostUrl||x.raw.postUrl)||'unlinked';if(!groups.has(key))groups.set(key,[]);groups.get(key).push(x);}
    const rows=(g?.rows||[]).map(r=>{const list=groups.get(String(r.id))||[];groups.delete(String(r.id));return {key:String(r.id),r,list,name:guruName(r,g.rows),spend:xKpis(list).spend};});
    for(const [key,list] of groups)rows.push({key,r:{},list,name:'Unmatched original post',spend:xKpis(list).spend});
    const guruHistory=xHistory(records,{includeGuru:true});
    const rtK=s?scopedRtKpis('guru-promotion',st,records,guruHistory,{...s.views,reason:'Views of the original promoted posts, including organic exposure. These are not exclusively paid impressions.'},(g?.rows||[]).length):null;
    const table=U.tablePanel({id:'guru-summary',title:'Listings',icon:'megaphone',age:r=>originalAge(r.key),rows,search:true,searchText:r=>r.name,rowKey:r=>r.key,rowLabel:r=>r.name,minWidth:898,cls:'is-list is-placement-list',hideEmpty:false,
      columns:rtSummaryColumns({name:r=>r.name,views:r=>C.num(r.r.views)===null?M.na('No verified original view reading.'):M.value(r.r.views),spend:r=>r.spend,rtCount:r=>r.list.filter(x=>x.paid).reduce((n,x)=>n+(C.num(x.raw.purchasedPosts)||1),0),url:r=>r.r.postUrl||r.list[0]?.raw.sourcePostUrl}),expand:r=>rtCosts(r.list)},tableState('guru-promotion','guru-summary'));
    const adSpend=C.num(g?.boostSpendKnown);
    const chart=campaignChart(viewsChart('guru-chart','guru-promotion',guruHistory,{noun:'Views'}),'Daily Views');
    return {title:'Guru RTs',chip:'guru-promotion',refreshLabel:'Refresh',updated:ov?.checkedAt,
      body:periodControls('guru-promotion',st)+(rtK?U.strip([metric('RTs','refresh',rtK.rts),metric('Views','eye',rtK.views,'compact'),metric('Spend','wallet',rtK.spend,'moneyShort'),metric('Posts','doc',rtK.posts)]):loadingStrip([['RTs','refresh'],['Views','eye'],['Spend','wallet'],['Posts','doc']]))+
      chart+table+overviewNotice()+
      (adSpend!==null?U.supportPanel('Direct X Advertising','wallet',U.inlineMetrics([['X Ad Spend',U.value(M.value(adSpend),'money')]])+'<p class="fv-detail-note">Separate from publisher RT spend and excluded from the RT total above.</p>'):'')};
  }
  // Two promoted posts by the same account are told apart by their post date.
  const postDay=id=>{try{return C.dayShort(C.londonDay(Number((BigInt(String(id))>>22n)+1288834974657n)));}catch{return '';}};
  const guruName=(r,rows)=>{const n=r.publisher||r.handle||'Original post';return (rows||[]).filter(x=>(x.publisher||x.handle)===n).length>1?n+' · '+postDay(r.id):n;};

  /* Placement columns for custom linked campaigns: the same nine columns over raw rows. */
  function placementColumns({clicks}={}){
    return X_COLUMNS.map(c=>({...c,html:c.html?r=>c.html(r.__x||(r.__x=xRecord(r,{campaign:'',type:r.type||'post',clicks}))):undefined,
      get:c.get?r=>c.get(r.__x||(r.__x=xRecord(r,{campaign:'',type:r.type||'post',clicks}))):undefined,
      sort:c.sort?r=>c.sort(r.__x||(r.__x=xRecord(r,{campaign:'',type:r.type||'post',clicks}))):undefined}));
  }

  /* ---------- Accounts: every account across the site's own promotion and article sources ---------- */
  // One account = one platform + handle (from the profile link), else the recorded name.
  function accountKey(x){
    if(!x.raw.publisher&&!x.raw.handle&&x.raw.trackingUrl)return {key:x.platform+'|pending|'+x.raw.trackingUrl,handle:x.account};
    const u=String(x.raw.profileUrl||x.link||''),m=u.match(/^https:\/\/(?:www\.)?(x\.com|twitter\.com|instagram\.com)\/([A-Za-z0-9_.]+)/i);
    const handle=m?m[2]:String(x.raw.handle||x.account||'').match(/@([A-Za-z0-9_.]+)/)?.[1]||String(x.raw.handle||x.account||'').replace(/^@/,'').trim();
    return {key:x.platform+'|'+handle.toLowerCase().replace(/\s+/g,''),handle:m?'@'+m[2]:(x.account||handle)};
  }
  function accountRows(records){
    const by=new Map();
    for(const x of records){const k=accountKey(x);if(!by.has(k.key))by.set(k.key,{key:k.key,name:k.handle,platform:x.platform,records:[]});by.get(k.key).records.push(x);}
    return [...by.values()].map(a=>{
      // Each booking once (tab + row), each post once, each tracking link's clicks once.
      const seen=new Set(),recs=a.records.filter(x=>{const k=rowKeyOf(x.raw)+'|'+x.parent;if(seen.has(k))return false;seen.add(k);return true;});
      const own=recs.filter(x=>x.type!=='RT'&&x.platform==='X').map(x=>x.raw);
      const posts=new Set();let liveNoLink=0;
      for(const x of recs){if(x.live!==true)continue;const ids=(x.raw.postUrls?.length?x.raw.postUrls:[x.link]).map(u=>C.postId(u)).filter(Boolean);if(ids.length)ids.forEach(i=>posts.add(i));else liveNoLink++;}
      const costs=recs.filter(x=>bookedCost(x)&&x.price!==null),links=new Map();
      for(const x of recs){if(!C.hasValue(x.clicks)||x.raw.sharedTracking||x.raw.identityAmbiguous)continue;const k=x.raw.trackingUrl||rowKeyOf(x.raw);links.set(k,Math.max(links.get(k)||0,x.clicks.value));}
      const e=C.efficiency([{source:'ACCOUNTS',rows:own}]),matched=C.placementEfficiency(own);
      const matchedClicks=own.reduce((n,r)=>n+(C.hasValue(matched.get(r)?.cpc)?C.num(r.clicks):0),0);
      const totalPosts=posts.size+liveNoLink,totalClicks=links.size?[...links.values()].reduce((n,v)=>n+v,0):null;
      const clicks=totalClicks!==null?M.value(totalClicks,{reason:'All tracked clicks on this account’s links, ever.'}):M.na('No tracked clicks.');
      // Owner (26 Nov): clicks/post and clicks/$ alongside the existing (all-time) Clicks and CPC.
      const perPost=totalClicks!==null&&totalPosts>0?M.value(totalClicks/totalPosts,{reason:'Total clicks ÷ live posts.'}):M.na('Needs at least one tracked click and one live post.');
      const perDollar=C.hasValue(e.cpc)&&e.cpc.value>0?M.value(1/e.cpc.value,{reason:'The reciprocal of CPC: tracked clicks per dollar spent, from the same matched placements.'}):M.na('Needs a recorded cost and tracked clicks on a placement.');
      return {...a,records:recs,campaigns:[...new Set(recs.map(x=>x.parent))],posts:totalPosts,
        spend:costs.length?xKpis(recs).spend:M.na('No recorded costs.'),
        views:C.viewsOf([{source:'ACCOUNTS',rows:own}]),
        clicks,perPost,perDollar,matchedClicks,cpc:e.cpc,cpm:e.cpm};
    });
  }
  function markAccountValue(rows){
    const eligible=rows.filter(a=>a.matchedClicks>=20&&C.hasValue(a.cpc)&&a.cpc.value>0).sort((a,b)=>a.cpc.value-b.cpc.value);
    const best=new Set(eligible.length>=4?eligible.slice(0,Math.ceil(eligible.length/4)).map(a=>a.key):[]);
    return rows.map(a=>({...a,bestValue:best.has(a.key)}));
  }
  function accountHistory(account){
    if(!account.records.length)return '<p class="fv-detail-note">No placements recorded for this account.</p>';
    const rows=[...account.records].sort((a,b)=>(publicationAge(b)?.at||0)-(publicationAge(a)?.at||0));
    const stat=m=>C.hasValue(m)?esc(C.full(m.value)):dash(m?.reason||'Not recorded');
    const history=rows.map(x=>{
      const date=publicationAge(x),cost=x.price===null?dash('No price recorded.'):esc(C.money(x.price)),post=x.link?U.extLink(x.link,'View'):x.type==='RT'?U.extLink(x.raw.sourcePostUrl,'Source post'):'';
      return '<div class="fv-account-history-row"><span class="fv-account-history-date">'+(date?esc(U.ageText(date.at,date.dayOnly)):dash('No publication date recorded.'))+'</span><span class="fv-account-history-campaign">'+esc(x.campaign)+'</span><span>'+esc(x.type)+'</span><span data-label="Clicks">'+stat(x.clicks)+'</span><span data-label="Price">'+cost+'</span><span>'+esc(x.paid?'Paid':x.planned?'Planned':'Unpaid')+'</span><span>'+(post||dash('No link recorded.'))+'</span></div>';
    }).join('');
    return '<div class="fv-account-history"><div class="fv-account-history-title"><strong>Post history</strong>'+(C.hasValue(account.perDollar)?'<span>'+esc(C.rate(account.perDollar.value))+' clicks per $</span>':'')+'</div><div class="fv-account-history-head"><span>Posted</span><span>Campaign</span><span>Type</span><span>Clicks</span><span>Price</span><span>Payment</span><span>Post</span></div>'+history+'</div>';
  }
  function accountsPage(st){
    ensure('overview');ensure('gta');ensure('directory');
    const ov=D.overview();
    const all=ov?[...xaRecords(),...gtaRecords(),...ofRecords(),...guruRecords()]:[];
    const ts=tableState('all-accounts','acc-table');
    // Accounts uses the shared table controls. No extra filters or preselected sort arrow.
    // Keep every publisher available, and apply numeric colour only on explicit sorting.
    const rows=accountRows(all.filter(x=>x.platform==='X'));
    {
      const keys=new Set(rows.map(a=>a.key));for(const a of directory.accounts||[]){if(keys.has(a.key)||a.platform!=='X')continue;rows.push({key:a.key,name:a.handle,platform:'X',campaigns:[],posts:0,records:[],spend:M.na('No paid placement.'),views:M.na('No measured post.'),clicks:M.na('No tracked placement.'),cpc:M.na('No matched traffic.'),perDollar:M.na('No matched traffic.')});keys.add(a.key);}
    }
    rows.sort((a,b)=>a.name.localeCompare(b.name,undefined,{sensitivity:'base'}));
    const table=U.tablePanel({id:'acc-table',title:'Listings',icon:'users',age:a=>latestAge(a.records),ageLabel:'Last Post',search:true,searchPlaceholder:'Search accounts',rows,cls:'is-list is-accounts',hideEmpty:false,rowKey:a=>a.key,rowLabel:a=>a.name,minWidth:820,searchText:a=>[a.name,...a.records.map(x=>x.account)].join(' '),empty:ov?'No accounts found':waiting('Loading…'),
      expand:accountHistory,
      columns:[
        {key:'name',label:'Account',type:'name',html:a=>{const raw=a.records.find(r=>r.raw?.profileUrl||r.link||r.raw?.handle||String(r.account||'').startsWith('@')),candidate=String(raw?.raw?.profileUrl||raw?.link||''),match=candidate.match(/^https:\/\/(?:www\.)?(?:x\.com|twitter\.com)\/([A-Za-z0-9_]{1,15})(?:[/?#]|$)/i),explicit=String(raw?.raw?.handle||a.name||'').match(/^@([A-Za-z0-9_]{1,15})$/),handle=match?.[1]||explicit?.[1],url=handle?'https://x.com/'+handle:'';const label='<span class="fv-name">'+U.accountMark(a.name)+'<span class="fv-account-plain" title="'+esc(a.name)+'">'+esc(a.name)+'</span></span>';return url?'<a class="fv-account-link" href="'+esc(url)+'" target="_blank" rel="noopener noreferrer">'+label+'</a>':label;},sort:a=>a.name.toLowerCase()},
        {key:'clicks',label:'Clicks',get:a=>a.clicks},{key:'views',label:'Views',get:a=>a.views},{key:'spend',label:'Spend',format:'money',get:a=>a.spend},{key:'cpc',label:'CPC',format:'money',get:a=>a.cpc},{key:'posts',label:'Posts',get:a=>a.records.length?M.value(a.posts):M.na('No recorded placements.')},{key:'campaigns',label:'Campaigns',get:a=>a.records.length?M.value(a.campaigns.length):M.na('No recorded campaigns.')}
      ]},ts);
    const note=directory.error||directory.stale?'<p class="fv-filter-note">Publisher directory is temporarily unavailable. Placement history remains available.</p>':'';
    return {title:'Accounts',chipHtml:'<span class="fv-campaign-chip" style="background:#475569" aria-hidden="true">'+U.icon('users',15)+'</span>',refreshLabel:'Refresh All',updated:ov?.checkedAt,stale:!!(D.overviewStatus().error||ov?.stale),body:table+overviewNotice()+note};
  }

  // Linked or empty custom campaigns use the same frame as built-in campaigns.
  function customCampaignBody(slug,raw,linked,name){
    const page='added:'+slug,id='added-placements',records=raw.map(r=>xRecord(r,{campaign:name,parent:name,type:r.type||'article',clicks:r=>C.num(r.clicks)===null?M.na('No verified click count.'):M.value(r.clicks)})),f=xState(page,id);
    const nc=M.notConnected('No linked data source.'),k=linked?{clicks:C.num(linked.trackedClicks)===null?M.na('No recorded clicks.'):M.value(linked.trackedClicks),views:C.num(linked.xViews)===null?M.na('No verified X reading.'):M.value(linked.xViews),spend:C.num(linked.paidSpendKnown)===null?M.na('No recorded spend.'):M.value(linked.paidSpendKnown),cpc:xKpis(records).cpc}:{clicks:nc,views:nc,spend:nc,cpc:nc};
    const dash=D.dashboard(),codes=new Set(records.map(x=>String(x.raw.code||''))),series=dash?.activityReady?C.dailyEventSeries(dash.activity,{include:r=>codes.has(String(r.code))}):[];
    const chart=U.chartPanel({id:'added-chart',allowEmptyWeek:true,measures:[{key:'clicks',label:'Daily Clicks',title:'Daily Clicks',series,period:'Day',unit:'Clicks'}]},chartState(page,'added-chart'));
    const eff=C.placementEfficiency(records.map(x=>x.raw));
    const customHist=(dash?.history||[]).filter(h=>codes.has(String(h.code||''))).map(h=>({id:h.postId||h.code,at:h.at,views:h.views}));
    return periodControls(page)+(linked?kpiStrip(scopedKpis(page,{},k,records.filter(xMatch(f)),{history:customHist})):kpiStrip(k))+chart+xTable(page,id,{title:'Listings',records,f,groups:false,empty:linked?'No placements recorded.':'No data source connected.',expand:x=>xDetail(x,eff)});
  }
  const RENDER={home:homePage,'all-accounts':accountsPage,discord:discordPage,'x-articles':xArticlesPage,'gta-vi':gtaPage,'viral-qrts':viralPage,'of-terms':ofPage,'guru-promotion':guruPage};

  /* ---------- shell rendering ---------- */
  let current=parseHash(),recordsShown=false;
  const hooks={addedRoute:null,navExtra:null,headerExtra:null};  // extension points (campaign manager)
  function navHtml(active){
    const item=p=>{
      const o=p.group==='paid'?look(p.key):null;
      const color=o?C.PALETTE[o.color]?.icon:p.key==='discord'?'var(--fv-discord)':'#FFFFFF';
      return '<a class="fv-nav-item" href="#'+esc(p.key)+'" style="--fv-icon:'+esc(color)+'"'+(p.key===active?' aria-current="page"':'')+'>'+U.icon(o?o.icon:p.icon,17)+'<span>'+esc(p.title)+'</span></a>';
    };
    return '<div class="fv-nav" role="group" aria-label="General">'+PAGES.filter(p=>p.group==='general').map(item).join('')+'</div>'+
      '<div class="fv-nav-group"><span class="fv-nav-group-label" id="fvPaidLabel">Campaigns</span>'+(hooks.navAddButton?hooks.navAddButton():'')+'</div>'+
      '<div class="fv-nav" role="group" aria-labelledby="fvPaidLabel">'+PAGES.filter(p=>p.group==='paid').map(item).join('')+(hooks.navExtra?hooks.navExtra(active):'')+'</div>'+
      '<div class="fv-nav-group"><span class="fv-nav-group-label" id="fvCommunityLabel">Extras</span></div>'+
      '<div class="fv-nav" role="group" aria-labelledby="fvCommunityLabel">'+PAGES.filter(p=>p.group==='community').map(item).join('')+'</div>'+
      '<div class="fv-nav fv-nav-more" role="group" aria-label="More">'+PAGES.filter(p=>p.group==='more').map(item).join('')+'</div>';
  }
  // Keep navigation nodes stable across data refreshes and active-route changes.
  // If a very short viewport or a long custom campaign list would overflow, page
  // the menu rather than scrolling it or silently clipping any destinations.
  let navPage=0,navPageSize=0,navActive='',navFitPending=false;
  function navLinks(){return [...$('fvNav').querySelectorAll('a.fv-nav-item')];}
  function showNavPage(page){
    const links=navLinks(),pager=$('fvNav').querySelector('.fv-nav-pager');
    if(!pager||!navPageSize)return;
    const total=Math.max(1,Math.ceil(links.length/navPageSize));
    navPage=Math.max(0,Math.min(total-1,page));
    links.forEach((a,i)=>{a.hidden=i<navPage*navPageSize||i>=(navPage+1)*navPageSize;});
    pager.querySelector('[data-fv-nav-page="prev"]').disabled=navPage===0;
    pager.querySelector('[data-fv-nav-page="next"]').disabled=navPage>=total-1;
    pager.querySelector('.fv-nav-page-label').textContent=(navPage+1)+' / '+total;
  }
  function fitNav(){
    const nav=$('fvNav'),sidebar=$('fvSidebar'),links=navLinks();
    nav.querySelector('.fv-nav-pager')?.remove();
    links.forEach(a=>{a.hidden=false;});
    sidebar.classList.remove('is-nav-compact','is-nav-paged');
    navPageSize=0;
    const fits=()=>sidebar.scrollHeight<=sidebar.clientHeight+1;
    if(fits()){navPage=0;return;}
    sidebar.classList.add('is-nav-compact');
    if(fits()){navPage=0;return;}
    sidebar.classList.add('is-nav-paged');
    const pager=document.createElement('div');pager.className='fv-nav-pager';
    pager.innerHTML='<button type="button" data-fv-nav-page="prev" aria-label="Previous navigation page">'+U.icon('left',15)+'</button><span class="fv-nav-page-label" aria-live="polite"></span><button type="button" data-fv-nav-page="next" aria-label="Next navigation page">'+U.icon('right',15)+'</button>';
    nav.append(pager);links.forEach(a=>{a.hidden=true;});
    for(const a of links){a.hidden=false;if(!fits()){a.hidden=true;break;}navPageSize++;}
    navPageSize=Math.max(1,navPageSize);
    const activeIndex=links.findIndex(a=>a.getAttribute('aria-current')==='page');
    showNavPage(activeIndex>=0?Math.floor(activeIndex/navPageSize):navPage);
  }
  function queueNavFit(){if(navFitPending)return;navFitPending=true;requestAnimationFrame(()=>{navFitPending=false;fitNav();});}
  function setNav(active){
    const el=$('fvNav'),markup=navHtml(''),changed=el.dataset.renderedNav!==markup;
    if(changed){el.innerHTML=markup;el.dataset.renderedNav=markup;}
    const links=navLinks();
    for(const a of links){const selected=a.getAttribute('href')==='#'+active;if(selected)a.setAttribute('aria-current','page');else a.removeAttribute('aria-current');}
    if(changed)fitNav();
    else if(active!==navActive&&navPageSize){const i=links.findIndex(a=>a.getAttribute('aria-current')==='page');if(i>=0)showNavPage(Math.floor(i/navPageSize));}
    navActive=active;
  }
  // Built-in campaign icon and colour, with any saved override from the campaign manager.
  function look(key){const d=C.CAMPAIGNS.find(c=>c.key===key)||(key===VIRAL.key?VIRAL:null);const o=hooks.override?.(key);return {icon:o?.icon?glyphName(o.icon):(d.icon==='x'?'xmark':d.icon),color:o?.color||d.color};}
  // Use the saved campaign colour on every subpage and record view.
  function setTheme(shell,key,customColor){
    const color=customColor||(key==='home'?'pink':key==='discord'?'discord':key==='all-accounts'?'slate':NAV_ORDER.includes(key)?look(key).color:'slate');
    if(shell.dataset)shell.dataset.campaignTheme=color==='discord'||Object.prototype.hasOwnProperty.call(C.PALETTE,color)?color:'slate';
  }
  const glyphName=n=>({'trending-up':'trend','user-plus':'userplus','graduation-cap':'graduation'}[n]||n);
  function setTitle(text){document.title=text+' · '+APP_NAME;}

  function captureFocus(){
    const a=document.activeElement;if(!a||!$('fvPage').contains(a))return null;
    const attrs=['data-search','data-sort','data-expand','data-view','data-period','data-chart-type','data-chart-measure','data-filter','data-xfilter','data-mobile-sort','data-reset'];
    const attr=attrs.find(x=>a.hasAttribute(x));if(!attr)return null;
    return {attr,value:a.getAttribute(attr),table:a.getAttribute('data-table'),start:a.selectionStart,end:a.selectionEnd};
  }
  function restoreFocus(f){
    if(!f)return;
    const sel='['+f.attr+'="'+CSS.escape(f.value)+'"]'+(f.table?'[data-table="'+CSS.escape(f.table)+'"]':'');
    const n=$('fvPage').querySelector(sel);if(!n)return;
    n.focus({preventScroll:true});if(f.attr==='data-search'&&typeof f.start==='number')try{n.setSelectionRange(f.start,f.end);}catch{}
  }

  let lastHeader='',renderedRoute='',activeRefresh=null;
  const renderedSections=new WeakMap();
  // Preserve unchanged sections during feed updates, filters and sorting.
  const sectionSignature=el=>el.outerHTML.replace(/(<time\b[^>]*data-age-at="[^"]+"[^>]*>)[^<]*(<\/time>)/g,'$1$2');
  function mountPage(host,html,route){
    const template=document.createElement('template');template.innerHTML=html;
    const incoming=[...template.content.children],existing=[...host.children];
    if(renderedRoute!==route||!existing.length){host.replaceChildren(...incoming);for(const el of incoming)renderedSections.set(el,sectionSignature(el));renderedRoute=route;return;}
    const ordered=incoming.map((next,i)=>{const old=existing[i],sig=sectionSignature(next);if(old&&renderedSections.get(old)===sig)return old;renderedSections.set(next,sig);return next;});
    for(let i=0;i<ordered.length;i++)if(host.children[i]!==ordered[i])host.insertBefore(ordered[i],host.children[i]||null);
    for(const el of [...host.children])if(!ordered.includes(el))el.remove();
  }
  function render(){
    U.hideTip();
    const r=current;
    const shell=$('fvShell'); // Keep the navigation state across feed updates and route changes.
    shell.classList.toggle('is-home',r.kind==='page'&&r.key==='home');
    // Owner (26 Nov): a small back control, top-left, above every page but the Dashboard itself.
    $('fvBack').hidden=r.kind==='page'&&r.key==='home';
    // Page colour for tiles, graphs and pills (owner, 26 Nov, style 74).
    shell.className=shell.className.replace(/\bpg-[\w-]+/g,'').trim()+' pg-'+(r.kind==='page'?r.key:r.kind);
    setTheme(shell,r.kind==='records'?RECORDS[r.key].parent:r.kind==='page'?r.key:'');
    if(r.kind==='records'){
      const rec=RECORDS[r.key];
      setNav(rec.parent);setTitle(rec.title);
      $('fvHeader').hidden=true;$('fvPage').hidden=true;$('fvPage').innerHTML='';$('fvRecords').hidden=false;
      D.app()?.showRecords?.(r.key);recordsShown=true;
      syncRefreshUI();return;
    }
    // Leave the record views only on navigation; re-renders must not close an open editor.
    if(recordsShown||!$('fvRecords').hidden){D.app()?.showRecords?.('');recordsShown=false;}
    $('fvRecords').hidden=true;
    $('fvHeader').hidden=false;$('fvPage').hidden=false;
    let page;
    if(r.kind==='added'){page=hooks.addedRoute?hooks.addedRoute(r.key):null;
      if(!page)page={title:'Campaign not found',refreshLabel:'',body:'<section class="fv-panel fv-notfound"><h2>Campaign not found</h2><p>This campaign does not exist or has been archived.</p><a class="fv-control" href="#home">'+U.icon('home',15)+'Go to Dashboard</a></section>'};
      setTheme(shell,'',page.themeColor);
      setNav(page.navKey||'');
    }else{
      page=RENDER[r.key]({view:r.view});
      setNav(r.key);
    }
    setTitle(page.title);
    const chipDef=C.CAMPAIGNS.find(c=>c.key===page.chip);
    $('fvTitleChip').innerHTML='';
    if(chipDef&&hooks.extraBody)page.body+=hooks.extraBody(chipDef.key)||'';
    $('fvTitle').textContent=page.title;
    $('fvTitle').title=page.title;
    const upd=$('fvUpdated');
    upd.textContent=page.updated?(page.stale?'Last Verified ':'Updated ')+C.stamp(page.updated):'';
    upd.classList.toggle('is-stale',!!page.stale);
    const refresh=$('fvRefresh');
    refresh.hidden=!page.refreshLabel;$('fvRefreshLabel').textContent=page.refreshLabel||'Refresh';
    refresh.setAttribute('aria-label',(page.refreshLabel||'Refresh')+' '+page.title+' data');
    $('fvHeaderExtra').innerHTML=hooks.headerExtra?hooks.headerExtra(r,page):'';
    const key=r.kind+':'+r.key;
    if(lastHeader!==key){$('fvRefreshStatus').textContent='';$('fvRefreshStatus').className='fv-refresh-status';lastHeader=key;}
    const focus=captureFocus();
    const scrolls=new Map([...$('fvPage').querySelectorAll('.fv-table-wrap')].map(el=>[el.closest('.fv-table-panel')?.id,el.scrollLeft]));
    $('fvPage').classList.toggle('fv-campaign-layout',r.kind==='added'||(r.kind==='page'&&(NAV_ORDER.includes(r.key)||r.key==='discord'||r.key==='home')));
    $('fvPage').classList.toggle('fv-accounts-layout',r.kind==='page'&&r.key==='all-accounts');
    $('fvPage').classList.toggle('fv-dashboard-layout',r.kind==='page'&&r.key==='home');
    mountPage($('fvPage'),page.body,r.kind==='page'?'page:'+r.key:r.canonical);
    for(const el of $('fvPage').querySelectorAll('.fv-table-wrap')){const id=el.closest('.fv-table-panel')?.id;if(scrolls.has(id))el.scrollLeft=scrolls.get(id);}
    drawCharts();
    restoreFocus(focus);
    syncRefreshUI();
  }
  // Dashboard tiles: all figures share one size, shrunk just enough for the longest to fit on one line.
  // Figures shrink together until the longest fits on one line; labels keep the same proportion to the figures,
  // so every tile looks the same whatever its size. Dashboard tiles share one size; each key-number card has its own.
  function fitGroup(vals,labels){
    // Skip until laid out (a hidden or not-yet-sized tile would read as zero width).
    if(!vals.length||vals.some(v=>!v.clientWidth))return;
    const set=px=>{vals.forEach(v=>{v.style.fontSize=px?px+'px':'';v.querySelectorAll('*:not(.fv-coverage)').forEach(c=>c.style.fontSize=px?px+'px':'');});
      labels.forEach(l=>l.style.fontSize='');};
    set(0);
    let size=parseFloat(getComputedStyle(vals[0].firstElementChild||vals[0]).fontSize)||25;
    const over=()=>vals.some(v=>{const w=v.clientWidth;return [...v.children].some(c=>c.getBoundingClientRect().width>w+0.5)||v.scrollWidth>w+0.5;});
    set(size);
    for(let i=0;i<40&&over();i++){size-=0.5;set(size);}
  }
  function runFitTiles(){
    const page=$('fvPage');
    // Each period card sizes its own tiles (owner, 26 Nov): a short "Last Week" figure shouldn't be
    // shrunk to match a longer "All Time" one three cards away.
    const cards=[...page.querySelectorAll('.fv-period-card')];
    if(cards.length)cards.forEach(card=>fitGroup([...card.querySelectorAll('.fv-tile-value')],[...card.querySelectorAll('.fv-tile-label')]));
    else fitGroup([...page.querySelectorAll('.fv-tile-value')],[...page.querySelectorAll('.fv-tile-label')]);
    for(const strip of page.querySelectorAll('.fv-panel.fv-strip'))for(const value of strip.querySelectorAll('.fv-metric-value')){
      value.style.fontSize='';for(const el of value.querySelectorAll('*:not(.fv-coverage)'))el.style.fontSize='';
      // Use the shared type scale; shrink only an unusually long individual value.
      if(value.scrollWidth>value.clientWidth+1)fitGroup([value],[]);
    }
  }
  // Several independent background refreshes (GTA, Discord, boosts) can all resolve within the
  // same tick after a tab regains focus, each calling fitTiles. Coalesce them into one pass so
  // they can't pile up redundant synchronous reflow work on the page (owner, 26 Nov: this was
  // making the site freeze after visiting Discord, switching tabs, then opening a campaign).
  let fitPending=false;
  function fitTiles(){
    if(fitPending)return;
    fitPending=true;
    requestAnimationFrame(()=>{fitPending=false;runFitTiles();});
  }
  const drawnCharts=new WeakMap();
  function drawCharts(){
    fitTiles();setTimeout(fitTiles,400);
    for(const host of $('fvPage').querySelectorAll('.fv-chart')){
      if(host.dataset.type==='table')continue;
      const m=U.getMeasure(host.id,host.dataset.measure),plot=host.querySelector('.fv-plot');if(!m||!plot)continue;
      const sig=JSON.stringify([plot.clientWidth,plot.clientHeight,m.period==='Day'?U.weekSlots(m.series,Date.now(),m.weekFrom):m.series||m.categories,m.key,m.format,m.unit]);
      if(drawnCharts.get(host)!==sig){U.drawChart(host,m,host.dataset.type);drawnCharts.set(host,sig);}
    }
  }
  function rerender(){if(current.kind==='records'){setNav(RECORDS[current.key].parent);return;}render();}

  /* ---------- events ---------- */
  function go(hash){if(location.hash==='#'+hash)rerender();else location.hash=hash;}
  function onHash(){
    const next=parseHash();
    if(next.canonical!==decodeURIComponent(location.hash.replace(/^#/,'')))history.replaceState(history.state,'','#'+next.canonical);
    const changedPage=next.kind!==current.kind||next.key!==current.key;
    current=next;
    if(next.kind==='page'){
      const state=pageState(next.key);state.view=next.view;
      if(next.key==='discord'&&KPI_PERIODS.some(([key])=>key===next.view))state.period=next.view;
    }
    render();
    if(changedPage)window.scrollTo({top:0,behavior:'instant'in window?'instant':'auto'});
  }
  // The server owns every manual refresh. The browser only starts, observes and
  // displays it; closing/reloading a tab never owns or cancels provider work.
  const refreshEndpoint='/.netlify/functions/tracker-refresh';
  const refreshScopes={'home':'all','all-accounts':'accounts','gta-vi':'gta','viral-qrts':'gta','x-articles':'x','of-terms':'of','guru-promotion':'boosts','discord':'discord'};
  const scopeForRoute=()=>current.kind==='added'?'registry':refreshScopes[current.kind==='records'?RECORDS[current.key]?.parent:current.key]||'summary';
  const busyJob=j=>!!j&&['queued','running'].includes(j.state);
  const REFRESH_RESET_MS=5*60_000,REFRESH_STALE_MS=30_000,REFRESH_SYNC_MS=20000;
  const finishedRecently=j=>{const at=Date.parse(j?.finishedAt||'');return Number.isFinite(at)&&Date.now()-at<REFRESH_RESET_MS;};
  const currentJob=j=>busyJob(j)&&(!Number.isFinite(j.expiresAt)||j.expiresAt>Date.now());
  const allJob=j=>j?.scope==='all'||j?.scope==='accounts';
  const relevantJob=j=>!!j&&(allJob(j)||j.scope===scopeForRoute()||(j.scope==='x'&&['of','boosts'].includes(scopeForRoute())));
  const legacySelectors='#refreshXStats,#reloadAllButton,#gtaRefreshButton,#discordRefreshButton,#reportingRefreshButton,[data-refresh]';
  const scopeForLegacy=e=>e.id==='reloadAllButton'?'all':e.id==='gtaRefreshButton'?'gta':e.id==='discordRefreshButton'?'discord':e.id==='reportingRefreshButton'?'summary':e.dataset.refresh==='boosts'?'boosts':e.dataset.refresh==='of'?'of':'x';
  let refreshStarting=false,refreshReading=null,lastRefreshRead=0,lastRefreshConfirmed=0,syncedRefreshId='',syncedRefreshResult=null,refreshSync=null,refreshGeneration=0,refreshDeployment='',refreshHiddenAt=0;
  function resetRefreshState(){
    refreshGeneration++;
    refreshReading?.controller.abort();refreshReading=null;
    refreshStarting=false;refreshSync=null;activeRefresh=null;lastRefreshRead=0;lastRefreshConfirmed=0;
    syncRefreshUI();
  }
  function observeDeployment(deployment){
    if(!deployment)return;
    if(refreshDeployment&&deployment!==refreshDeployment)resetRefreshState();
    refreshDeployment=deployment;
  }
  function syncRefreshUI(){
    const run=activeRefresh,busy=busyJob(run),here=!!run&&current.kind!=='records',affected=relevantJob(run);
    const page=$('fvPage'),btn=$('fvRefresh'),progress=$('fvRefreshProgress'),track=$('fvRefreshTrack'),status=$('fvRefreshStatus');
    btn.disabled=busy;btn.classList.toggle('is-busy',busy&&here);
    if(busy&&here)btn.setAttribute('aria-busy','true');else btn.removeAttribute('aria-busy');
    page.classList.toggle('is-kpi-refreshing',busy&&here&&affected);
    for(const strip of page.querySelectorAll(':scope>.fv-panel.fv-strip')){
      if(busy&&here&&affected)strip.setAttribute('aria-busy','true');else strip.removeAttribute('aria-busy');
    }
    // Legacy record views use the same job and must not launch separate POSTs.
    for(const button of document.querySelectorAll(legacySelectors)){
      if(busy){button.disabled=true;button.dataset.durableRefresh='1';button.classList.toggle('is-refreshing',scopeForLegacy(button)===run.scope||allJob(run));button.setAttribute('aria-busy','true');}
      else if(button.dataset.durableRefresh){delete button.dataset.durableRefresh;button.disabled=false;button.classList.remove('is-refreshing');button.removeAttribute('aria-busy');}
    }
    for(const node of document.querySelectorAll('[data-x-refresh-status],#xRefreshStatus,#reloadAllStatus,#gtaRefreshStatus,#ofRefreshStatus,#boostRefreshStatus,#discordRefreshStatus')){
      if(!run){node.textContent='';node.removeAttribute('title');node.classList.remove('is-error','is-success');continue;}
      node.textContent=busy?run.label:(run.state==='complete'?'Updated':'Latest available data');
      node.title=(run.issues||[]).join('; ')||run.label;
      node.classList.toggle('is-error',run.state==='failed');node.classList.toggle('is-success',run.state==='complete');
    }
    progress.hidden=!(busy&&here&&!btn.hidden);
    if(progress.hidden){
      $('fvRefreshFill').style.width='0%';$('fvRefreshCount').textContent='';$('fvRefreshStage').textContent='';track.setAttribute('aria-valuemax','1');track.setAttribute('aria-valuenow','0');track.removeAttribute('aria-valuetext');
      if(run&&!busy&&affected){const ok=run.state==='complete';status.textContent=ok?'Updated':'Latest available data';status.className='fv-refresh-status '+(ok?'is-ok':'is-error');status.title=(run.issues||[]).join('; ')||status.textContent;status.setAttribute('aria-label',status.textContent);}
      else{status.textContent='';status.className='fv-refresh-status';status.removeAttribute('title');status.removeAttribute('aria-label');}
      return;
    }
    const total=Math.max(1,run.total||1),completed=Math.min(total,Math.max(0,run.completed||0));
    $('fvRefreshStage').textContent=run.label||'Refreshing connected sources…';
    $('fvRefreshCount').textContent=completed+' / '+total;
    track.setAttribute('aria-valuemax',String(total));track.setAttribute('aria-valuenow',String(completed));track.setAttribute('aria-valuetext',completed+' of '+total+' refresh tasks completed');
    $('fvRefreshFill').style.width=(100*completed/total)+'%';
    status.textContent='';
  }
  function acceptRefresh(job,{submitted=false}={}){
    if(!job||!job.id||!job.scope||!['queued','running','complete','failed'].includes(job.state)){
      if(!refreshStarting){activeRefresh=null;syncRefreshUI();}return;
    }
    if(currentJob(job)){
      // All tasks settled, even if an older deployment missed its terminal write.
      if(job.total>0&&job.completed>=job.total&&job.done?.length>=job.total){
        job={...job,state:job.issues?.length?'failed':'complete',finishedAt:job.finishedAt||job.startedAt};
      }else{activeRefresh=job;syncRefreshUI();return;}
    }
    if(busyJob(job)){activeRefresh=null;syncRefreshUI();return;}
    const observed=submitted||activeRefresh?.id===job.id;
    if(!observed&&!finishedRecently(job)){activeRefresh=null;syncRefreshUI();return;}
    // Report hydration is read-only and never holds the progress bar at 6/6.
    // A newly opened page starts idle, even when a recent job completed.
    activeRefresh=observed?(job.id===syncedRefreshId?syncedRefreshResult||job:job):null;
    syncRefreshUI();
    if(job.id===syncedRefreshId||refreshSync?.id===job.id)return;
    const token={id:job.id,generation:refreshGeneration};
    refreshSync=token;syncedRefreshId=job.id;syncedRefreshResult=job;
    void (async()=>{
      let result=job,timer;
      try{
        const scopes=job.scope==='all'||job.scope==='accounts'?['x','gta','of','boosts']:job.scope==='x'?['x','of','boosts']:['gta','of','boosts'].includes(job.scope)?[job.scope]:[];
        const calls=[];
        if(scopes.length&&D.app()?.syncVerifiedRefresh)calls.push(D.app().syncVerifiedRefresh(scopes));
        if(job.scope!=='discord'&&D.rep()?.syncVerifiedRefresh)calls.push(D.rep().syncVerifiedRefresh());
        if(job.snapshot&&D.rep()?.acceptDiscordRefresh)D.rep().acceptDiscordRefresh(job.snapshot);
        if(job.scope==='accounts')calls.push(loadDirectory());
        if(job.scope==='registry')calls.push(window.FanvueCampaigns?.load?.());
        const outcomes=await Promise.race([Promise.allSettled(calls),new Promise(resolve=>{timer=setTimeout(()=>resolve(null),REFRESH_SYNC_MS);})]);
        if(!outcomes||outcomes.some(x=>x.status==='rejected'||x.value===false))result={...job,state:'failed',issues:[...(job.issues||[]),'Saved reports could not all be reloaded in this tab.']};
      }catch{result={...job,state:'failed',issues:[...(job.issues||[]),'Saved reports could not all be reloaded in this tab.']};}
      finally{clearTimeout(timer);}
      if(refreshSync!==token||token.generation!==refreshGeneration)return;
      refreshSync=null;syncedRefreshResult=result;
      if(activeRefresh?.id===job.id&&!busyJob(activeRefresh))activeRefresh=result;
      try{rerender();}finally{syncRefreshUI();}
    })();
  }
  function pullRefreshStatus(){
    if(refreshStarting)return Promise.resolve(null);
    if(refreshReading)return refreshReading.promise;
    lastRefreshRead=Date.now();
    const token={generation:refreshGeneration,controller:new AbortController(),promise:null};
    refreshReading=token;
    token.promise=(async()=>{
      const timer=setTimeout(()=>token.controller.abort(),12000);
      try{
        const res=await fetch(refreshEndpoint,{cache:'no-store',signal:token.controller.signal});
        const data=await res.json();if(!res.ok||!data.ok)throw Error('Refresh status unavailable');
        if(!refreshStarting&&token.generation===refreshGeneration){
          observeDeployment(data.deployment);lastRefreshConfirmed=Date.now();acceptRefresh(data.refresh||null);
        }
        return data.refresh||null;
      }catch{
        if(token.generation===refreshGeneration&&!refreshStarting&&busyJob(activeRefresh)&&
           (!lastRefreshConfirmed||Date.now()-lastRefreshConfirmed>=REFRESH_STALE_MS||!currentJob(activeRefresh))){
          activeRefresh=null;syncRefreshUI();
        }
        return undefined;
      }finally{clearTimeout(timer);if(refreshReading===token)refreshReading=null;}
    })();
    return token.promise;
  }
  async function onRefresh(scope=scopeForRoute()){
    if(typeof scope!=='string')scope=scopeForRoute();
    if(refreshStarting||busyJob(activeRefresh))return;
    refreshStarting=true;const generation=++refreshGeneration;
    refreshReading?.controller.abort();refreshReading=null;refreshSync=null;
    const previous=activeRefresh;
    activeRefresh={scope,state:'queued',completed:0,total:scope==='all'?6:scope==='accounts'?7:scope==='summary'?1:2,label:'Starting refresh…',issues:[]};
    syncRefreshUI();
    try{
      const res=await fetch(refreshEndpoint,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({scope}),cache:'no-store',keepalive:true,signal:AbortSignal.timeout(20000)});
      const data=await res.json();if(!res.ok||!data.ok||!data.refresh)throw Error('Refresh could not start');
      if(generation!==refreshGeneration)return;
      refreshStarting=false;observeDeployment(data.deployment);lastRefreshConfirmed=Date.now();acceptRefresh(data.refresh,{submitted:true});
    }catch{
      if(generation!==refreshGeneration)return;
      refreshStarting=false;const job=await pullRefreshStatus();
      if(generation!==refreshGeneration)return;
      if(!job||(!busyJob(job)&&job.id===previous?.id)){
        activeRefresh={scope,state:'failed',completed:0,total:1,label:'Latest available data',issues:['Refresh could not be confirmed. Retry when connected.']};syncRefreshUI();
      }
    }finally{if(generation===refreshGeneration)refreshStarting=false;}
  }
  // Table interactions do not destroy or redraw the chart, header, KPI cards or sidebar.
  function rerenderTable(id){
    const host=$('fvPage'),old=host.querySelector('#'+CSS.escape(id));
    if(!old||!['page','added'].includes(current.kind)){rerender();return;}
    const focus=captureFocus(),wrap=old.querySelector('.fv-table-wrap'),left=wrap?.scrollLeft||0;
    const page=current.kind==='added'?hooks.addedRoute?.(current.key):RENDER[current.key]({view:current.view}),tpl=document.createElement('template');
    if(!page){rerender();return;}
    tpl.innerHTML=page.body;
    const next=tpl.content.querySelector('#'+CSS.escape(id));
    if(!next){rerender();return;}
    const signature=sectionSignature(next);
    U.hideTip();
    // Retain the actual scroll container and controls whenever the schema is unchanged.
    const nextWrap=next.querySelector('.fv-table-wrap'),table=wrap?.querySelector('table'),fresh=nextWrap?.querySelector('table');
    const stable=table&&fresh&&table.querySelector('colgroup')?.outerHTML===fresh.querySelector('colgroup')?.outerHTML;
    if(stable){
      table.querySelector('thead').replaceWith(fresh.querySelector('thead'));
      table.querySelector('tbody').replaceWith(fresh.querySelector('tbody'));
      const a=old.querySelector('[data-mobile-sort]'),b=next.querySelector('[data-mobile-sort]');if(a&&b){a.value=b.value;a.toggleAttribute('data-user-sort',b.hasAttribute('data-user-sort'));}
       renderedSections.set(old,signature);
    }else{renderedSections.set(next,signature);old.replaceWith(next);}
    const w=host.querySelector('#'+CSS.escape(id)+' .fv-table-wrap');if(w)w.scrollLeft=left;
    restoreFocus(focus);
  }
  function onClick(e){
    const t=e.target;
    const sort=t.closest('[data-sort]');
    if(sort){const st=tableState(pageKey(),sort.dataset.table),k=sort.dataset.sort;st.sort=st.sort?.key===k?{key:k,dir:-st.sort.dir,user:true}:{key:k,dir:k==='account'||k==='name'||k==='week'||k==='cpc'?1:-1,user:true};rerenderTable(sort.dataset.table);return;}
    const exp=t.closest('[data-expand]');
    if(exp){const st=tableState(pageKey(),exp.dataset.table),k=exp.dataset.expand;if(st.expanded.has(k))st.expanded.delete(k);else st.expanded.add(k);rerenderTable(exp.dataset.table);return;}
    const period=t.closest('[data-period]');
    if(period&&KPI_PERIODS.some(([key])=>key===period.dataset.period)){pageState(pageKey()).period=period.dataset.period;if(pageKey()==='discord')go('discord/'+period.dataset.period);else rerender();return;}
    const view=t.closest('[data-view]');
    if(view&&current.kind==='page'){const def=defaultView(current.key);go(current.key+(view.dataset.view===def?'':'/'+view.dataset.view));return;}
    const ct=t.closest('[data-chart-type]');
    if(ct){const st=chartState(pageKey(),ct.dataset.chart);st.type=ct.dataset.chartType;rerender();return;}
     const reset=t.closest('[data-reset]');
    if(reset){const st=tableState(pageKey(),reset.dataset.reset);st.q='';st.filter='';if(st.xf)for(const k of Object.keys(st.xf))st.xf[k]='';rerender();return;}
    if(t.closest('[data-retry]')){void onRefresh('summary');return;}
  }
  const pageKey=()=>current.kind==='page'?current.key:'added:'+current.key;
  const defaultView=k=>({'home':'this-week','x-articles':'overview','gta-vi':'overview','of-terms':'overview',discord:'weekly-history','guru-promotion':'overview','viral-qrts':'overview'}[k]||'');
  function onInput(e){
    const s=e.target.closest('[data-search]');
    if(s){tableState(pageKey(),s.dataset.search).q=s.value;rerenderTable(s.dataset.search);}
  }
  function onChange(e){
    const sort=e.target.closest('[data-mobile-sort]');
    if(sort){const [key,dir]=sort.value.split(':');if(key&&[1,-1].includes(Number(dir))){tableState(pageKey(),sort.dataset.mobileSort).sort={key,dir:Number(dir),user:true};rerenderTable(sort.dataset.mobileSort);}return;}
    const m=e.target.closest('[data-chart-measure]');
    if(m){const st=chartState(pageKey(),m.dataset.chartMeasure);st.measure=m.value;st.type='';rerender();return;}
    const xf=e.target.closest('[data-xfilter]');
    if(xf){const st=tableState(pageKey(),xf.dataset.table);(st.xf||(st.xf={group:'',type:'',live:'',pay:''}))[xf.dataset.xfilter]=xf.value;rerender();return;}
    const f=e.target.closest('[data-filter]');
    if(f){tableState(pageKey(),f.dataset.filter).filter=f.value;rerender();}
  }


  let rerenderQueued=false;
  function queueRerender(){if(rerenderQueued)return;rerenderQueued=true;requestAnimationFrame(()=>{rerenderQueued=false;rerender();});}

  function init(){
    // Header icons are injected so static HTML stays text-only.
    $('fvRefresh').insertAdjacentHTML('afterbegin',U.icon('refresh',15));
    $('fvMenu').innerHTML=U.icon('menu',26);$('fvDrawerClose').innerHTML=U.icon('close',20);
    $('fvBack').innerHTML=U.icon('arrowLeft',16)+'<span>Back</span>';
    $('fvBack').setAttribute('aria-label','Back to Dashboard');
    $('fvBack').addEventListener('click',()=>go('home'));
    U.bindTips(document.body);
    const page=$('fvPage');
    page.addEventListener('click',onClick);page.addEventListener('input',onInput);page.addEventListener('change',onChange);
    window.setInterval(()=>U.refreshAges(page),1000);
    $('fvRefresh').addEventListener('click',()=>void onRefresh());
    document.addEventListener('click',e=>{const button=e.target.closest?.(legacySelectors);if(!button)return;e.preventDefault();e.stopImmediatePropagation();void onRefresh(scopeForLegacy(button));},true);
    const wakeRefresh=()=>{
      if(document.hidden){if(!refreshHiddenAt)refreshHiddenAt=Date.now();return;}
      const now=Date.now();
      if((refreshHiddenAt&&now-refreshHiddenAt>=REFRESH_RESET_MS)||(lastRefreshRead&&now-lastRefreshRead>=REFRESH_RESET_MS))resetRefreshState();
      refreshHiddenAt=0;
      void pullRefreshStatus();
    };
    document.addEventListener('visibilitychange',wakeRefresh);
    window.addEventListener('pagehide',()=>{refreshHiddenAt=Date.now();});
    window.addEventListener('pageshow',wakeRefresh);window.addEventListener('focus',wakeRefresh);window.addEventListener('online',wakeRefresh);
    window.setInterval(()=>{
      if(document.hidden){if(!refreshHiddenAt)refreshHiddenAt=Date.now();return;}
      if((refreshHiddenAt&&Date.now()-refreshHiddenAt>=REFRESH_RESET_MS)||(lastRefreshRead&&Date.now()-lastRefreshRead>=REFRESH_RESET_MS)){wakeRefresh();return;}
      if(activeRefresh&&!busyJob(activeRefresh)&&activeRefresh.finishedAt&&!finishedRecently(activeRefresh)){activeRefresh=null;syncRefreshUI();}
      if(Date.now()-lastRefreshRead>=(busyJob(activeRefresh)?2000:12000))void pullRefreshStatus();
    },2000);
    void pullRefreshStatus();
    // Feed updates keep the menu open; selecting a destination closes it.
    const setMenuOpen=(open,focus=false)=>{
      $('fvShell').classList.toggle('is-nav-open',open);
      $('fvMenu').setAttribute('aria-expanded',String(open));
      $('fvMenu').setAttribute('aria-label',open?'Close menu':'Open menu');
      if(focus&&!open)$('fvMenu').focus({preventScroll:true});
    };
    const close=()=>setMenuOpen(false,true);
    $('fvMenu').addEventListener('click',()=>setMenuOpen(!$('fvShell').classList.contains('is-nav-open')));
    document.addEventListener('keydown',e=>{if(e.key==='Escape'&&$('fvShell').classList.contains('is-nav-open'))close();});
    $('fvNav').addEventListener('click',e=>{const pager=e.target.closest?.('[data-fv-nav-page]');if(pager){showNavPage(navPage+(pager.dataset.fvNavPage==='next'?1:-1));return;}const link=e.target.closest?.('a[href^="#"]');if(link&&$('fvShell').classList.contains('is-nav-open'))close();});
    $('fvDrawerClose').addEventListener('click',close);
    $('fvScrim').addEventListener('click',close);
    window.addEventListener('hashchange',onHash);
    window.addEventListener('xtracker:campaign-overview',queueRerender);
    window.addEventListener('xtracker:data',queueRerender);
    window.addEventListener('xtracker:discord',queueRerender);
    // Tile figures are re-fitted once the display font has loaded (it is wider than the fallback).
    document.fonts?.ready?.then(()=>{if(current.kind!=='records')fitTiles();});document.fonts?.load?.('900 25px Montserrat').then(()=>{if(current.kind!=='records')fitTiles();}).catch(()=>{});document.fonts?.addEventListener?.('loadingdone',()=>{if(current.kind!=='records')fitTiles();});
    let w=window.innerWidth;
    window.addEventListener('resize',()=>{queueNavFit();if(window.innerWidth>=768&&$('fvShell').classList.contains('is-nav-open'))setMenuOpen(false);if(Math.abs(window.innerWidth-w)<2)return;w=window.innerWidth;U.hideTip();if(current.kind!=='records')drawCharts();},{passive:true});
    // Reload-all reports Discord status through these hooks; they reuse the
    // validated Discord adapter instead of the superseded standalone scripts.
    window.XTrackerDiscordMembers={refresh:()=>D.rep()?.refreshDiscord?.(true)};
    window.XTrackerDiscordCourse={refresh:()=>D.rep()?.refreshDiscord?.(true)};
    onHash();
    document.fonts?.ready?.then(queueNavFit);
  }
  window.FanvueApp=Object.freeze({hooks,rerender,go,parseHash,RECORDS,LEGACY,PAGES,data:D,state:pageState,tableState,
    placementColumns,publicationAge,metric,outcomeItems,overviewTabs,campaignChart,customCampaignBody,reporting:Object.freeze({xKpis,periodTotals,accountRows,markAccountValue,discordStats,datedClicks,dashboardClickSources,shortIoDaily,xHistory,pages:RENDER})});
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init,{once:true});else init();
})();
