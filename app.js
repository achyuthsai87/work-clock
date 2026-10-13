/* Anti-clickjacking: refuse to run inside someone else's frame (GitHub Pages can't send X-Frame-Options). */
if (window.top !== window.self) {
  try { window.top.location.replace(window.self.location.href); } catch (e) { document.documentElement.textContent = ""; }
} else { var fbEl = document.getElementById("fb"); if (fbEl) fbEl.remove(); }
(function(){
"use strict";
const KEY = "workclock.v1";
// ---------- Data validation: nothing from storage, backups or the sheet is trusted ----------
const ID_RE = /^[A-Za-z0-9_-]{1,64}$/;
const SYNC_URL_RE = /^https:\/\/script\.google\.com\/(?:macros|a\/macros\/[A-Za-z0-9.-]+)\/s\/[A-Za-z0-9_-]{8,200}\/exec$/;
const MIN_TS = 946684800000, MAX_TS = 4102444800000, MAX_SHIFT_MS = 7*86400000;   // 2000..2100, 7 days
function cleanShift(s){
  if(!s || typeof s !== "object") return null;
  const id = String(s.id == null ? "" : s.id), start = Number(s.start), end = s.end == null ? null : Number(s.end);
  if(!ID_RE.test(id) || !Number.isFinite(start) || start < MIN_TS || start > MAX_TS) return null;
  if(end !== null && (!Number.isFinite(end) || end < start || end - start > MAX_SHIFT_MS)) return null;
  const o = {id, start, end}, tp = Math.round(Number(s.tip != null ? s.tip : s.tips) * 100) / 100;
  if(Number.isFinite(tp) && tp > 0 && tp <= 100000) o.tip = tp;
  const sr = s.rate == null || s.rate === "" ? NaN : Number(s.rate); if(Number.isFinite(sr) && sr >= 0 && sr <= 100000) o.rate = sr;
  const nt = cleanText(s.note, 80); if(nt) o.note = nt;
  return o;
}
// Free text (notes): no control characters or angle brackets, and nothing a spreadsheet could read as a formula.
function cleanText(v, max){ return String(v == null ? "" : v).replace(/[\u0000-\u001f\u007f<>]/g, "").replace(/^[\s=+\-@]+/, "").trim().slice(0, max); }
function cleanPayment(p){
  if(!p || typeof p !== "object") return null;
  const id = String(p.id == null ? "" : p.id), ts = Number(p.ts), amt = Math.round(Number(p.amount) * 100) / 100;
  if(!ID_RE.test(id) || !Number.isFinite(ts) || ts < MIN_TS || ts > MAX_TS || !Number.isFinite(amt) || amt <= 0 || amt > 10000000) return null;
  return {id, ts, amount: amt, note: cleanText(p.note, 60)};
}
function cleanCore(d){   // the user's data only (shifts + display prefs)
  const out = {rate: 14, theme: "auto", shifts: []};
  if(!d || typeof d !== "object") return out;
  const r = Number(d.rate); if(Number.isFinite(r) && r >= 0 && r <= 100000) out.rate = r;
  const g = Number(d.goal); if(Number.isFinite(g) && g > 0 && g <= 1000000) out.goal = g;
  if(["auto","light","dark"].includes(d.theme)) out.theme = d.theme;
  if(["week","month","year"].includes(d.anaPeriod)) out.anaPeriod = d.anaPeriod;
  const bm = Math.round(Number(d.breakMin)); if(Number.isFinite(bm) && bm > 0 && bm <= 120) out.breakMin = bm;
  const ba = Number(d.breakAfter); if(Number.isFinite(ba) && ba >= 1 && ba <= 24) out.breakAfter = ba;
  const pd = Math.round(Number(d.payday)); if(Number.isFinite(pd) && pd >= 1 && pd <= 28) out.payday = pd;
  const seen = new Set();
  (Array.isArray(d.shifts) ? d.shifts : []).slice(0, 50000).forEach(x => { const c = cleanShift(x); if(c && !seen.has(c.id)){ seen.add(c.id); out.shifts.push(c); } });
  const ps = new Set(); out.payments = [];
  (Array.isArray(d.payments) ? d.payments : []).slice(0, 20000).forEach(x => { const c = cleanPayment(x); if(c && !ps.has(c.id)){ ps.add(c.id); out.payments.push(c); } });
  return out;
}
function cleanEvent(e, rate){
  if(!e || typeof e !== "object") return null;
  if(e.action === "delete" && ID_RE.test(String(e.id))) return {action:"delete", id:String(e.id)};
  if(e.action === "sset"){ const c = cleanSettings(e.settings); if(c) return {action:"sset", settings:c}; return null; }
  if(e.action === "pdelete" && ID_RE.test(String(e.id))) return {action:"pdelete", id:String(e.id)};
  if(e.action === "pupsert" && e.payment){ const c = cleanPayment(e.payment); if(c) return {action:"pupsert", payment:payPayload(c)}; }
  if(e.action === "bulk" && Array.isArray(e.shifts)){ const list = e.shifts.slice(0, 5000).map(x => cleanShift(x)).filter(c => c && c.end).map(c => shiftPayload(c, rate)); return list.length ? {action:"bulk", shifts:list} : null; }
  if(e.action === "upsert" && e.shift){ const c = cleanShift(e.shift); if(c && c.end) return {action:"upsert", shift:shiftPayload(c, rate)}; }
  return null;
}
function cleanLocal(d){  // everything persisted on this device, incl. sync + lock settings
  const out = cleanCore(d);
  if(d && d.sync && typeof d.sync === "object"){
    const u = String(d.sync.url || ""), good = SYNC_URL_RE.test(u);
    out.sync = {url: good ? u : "", secret: typeof d.sync.secret === "string" ? d.sync.secret.slice(0,200) : "", enabled: good && !!d.sync.enabled, err: ""};
  }
  out.outbox = (d && Array.isArray(d.outbox) ? d.outbox : []).slice(0, 5000).map(e => cleanEvent(e, out.rate)).filter(Boolean);
  if(d && Number.isFinite(Number(d.lastSync))) out.lastSync = Number(d.lastSync);
  if(d && d.lock && typeof d.lock.cred === "string" && /^[A-Za-z0-9_-]{8,2048}$/.test(d.lock.cred)) out.lock = {cred: d.lock.cred};
  return out;
}
let db = {rate: 14, theme: "auto", shifts: []};
try { const raw = localStorage.getItem(KEY); if (raw) db = cleanLocal(JSON.parse(raw)); } catch(e){}
function save(){ try{ localStorage.setItem(KEY, JSON.stringify(db)); }catch(e){} }

function applyTheme(){
  const t = db.theme || "auto";
  document.documentElement.dataset.theme = t;
  const dark = t==="dark" || (t==="auto" && window.matchMedia("(prefers-color-scheme: dark)").matches);
  const mc = document.querySelector('meta[name="theme-color"]');
  if (mc) mc.setAttribute("content", dark ? "#0c0f16" : "#f4f5f8");
  document.querySelectorAll("#themeSeg button").forEach(b=>b.classList.toggle("on", b.dataset.t===t));
}
const $ = id => document.getElementById(id);
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2,7);
const MONTHS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];

function fmtTime(ts){ const d=new Date(ts); let h=d.getHours(), m=d.getMinutes();
  const ap = h>=12?"PM":"AM"; h=h%12||12; return h+":"+String(m).padStart(2,"0")+" "+ap; }
function fmtDate(ts){ const d=new Date(ts); return MONTHS[d.getMonth()]+" "+d.getDate()+", "+d.getFullYear(); }
function dayKey(ts){ const d=new Date(ts); return d.getFullYear()+"-"+String(d.getMonth()+1).padStart(2,"0")+"-"+String(d.getDate()).padStart(2,"0"); }
function monthKey(ts){ const d=new Date(ts); return d.getFullYear()+"-"+String(d.getMonth()+1).padStart(2,"0"); }
function monthLabel(key){ const [y,m]=key.split("-").map(Number); return MONTHS[m-1]+" "+y; }
function hrs(s){ const h=(s.end - s.start)/3600000; return (db.breakMin>0 && h>=(db.breakAfter||6)) ? Math.max(0,h-db.breakMin/60) : h; }   // optional unpaid break
function money(n){ return "$"+n.toFixed(2); }
function tipOf(s){ return s.tip||0; }
const rateOf=s=>s.rate!=null?s.rate:db.rate;   // each shift keeps the rate it was worked at
function pay(s){ return hrs(s)*rateOf(s); }   // wages only; tips are tracked separately
function esc(s){ return String(s).replace(/[&<>"]/g, c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c])); }

function openShift(){ return db.shifts.find(s=>!s.end); }

let timer=null;
function render(){
  const btn=$("clockBtn"), line=$("statusLine"), cancel=$("cancelShift");
  const open=openShift();
  if(open){
    btn.textContent="Clock Out"; btn.classList.add("out");
    cancel.style.display="block";
    const tick=()=>{ const el=(Date.now()-open.start)/1000;
      const h=Math.floor(el/3600), m=Math.floor(el%3600/60), s=Math.floor(el%60);
      line.innerHTML='<span class="dot"></span>Clocked in at <b>'+esc(fmtTime(open.start))+"</b> · <b>"+
        String(h).padStart(2,"0")+":"+String(m).padStart(2,"0")+":"+String(s).padStart(2,"0")+"</b> elapsed"+(h>=10?'<div class="long">Still clocked in after '+h+'h. Forgot to clock out?</div>':''); };
    tick(); clearInterval(timer); timer=setInterval(tick,1000);
  } else {
    btn.textContent="Clock In"; btn.classList.remove("out"); cancel.style.display="none";
    clearInterval(timer);
    line.innerHTML = db.shifts.length ? "Not clocked in." : "Tap <b>Clock In</b> when your shift starts.";
  }

  // stats
  const today=dayKey(Date.now()), mk=monthKey(Date.now());
  let th=0, mh=0, ah=0, et=0, em=0, ea=0, tt=0, tw=0, tm=0, ta=0; const wk0=startOfWeek(Date.now());
  db.shifts.forEach(s=>{ if(!s.end) return; const h=hrs(s), p=pay(s); ah+=h; ea+=p;
    if(dayKey(s.start)===today){ th+=h; et+=p; } if(monthKey(s.start)===mk){ mh+=h; em+=p; } });
  db.shifts.forEach(s=>{ const tp=tipOf(s); if(!tp) return; ta+=tp; if(s.start>=wk0) tw+=tp; if(dayKey(s.start)===today) tt+=tp; if(monthKey(s.start)===mk) tm+=tp; });
  $("tipDay").textContent=money(tt); $("tipWeek").textContent=money(tw); $("tipMonth").textContent=money(tm); $("tipAll").textContent=money(ta);
  $("statToday").innerHTML = th.toFixed(2)+"h<small>"+money(et)+"</small>";
  $("statMonth").innerHTML = mh.toFixed(2)+"h<small>"+money(em)+"</small>";
  $("monthLabel").textContent = monthLabel(mk);
  $("statAll").innerHTML = money(ea)+"<small>"+ah.toFixed(1)+"h total</small>";

  // hero
  const hrNow=new Date().getHours();
  $("greet").textContent = hrNow<12?"Good morning":hrNow<17?"Good afternoon":"Good evening";
  const nd=new Date();
  $("heroDate").textContent = ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"][nd.getDay()]+", "+fmtDate(Date.now());
  $("heroEarn").textContent = money(et);
  $("tipToday").textContent = tt>0 ? "Tips today "+money(tt) : "No tips logged today";
  $("heroSub").textContent = th>0 ? th.toFixed(2)+"h worked today"+(tt>0?" · + "+money(tt)+" tips":"") : "No shifts yet today — tap Clock In below";
  renderAnalytics();
  renderPay();

  // history grouped by day
  const done=db.shifts.filter(s=>s.end).sort((a,b)=>b.start-a.start);
  const box=$("history"); box.innerHTML="";
  if(!done.length){ box.innerHTML='<div class="empty">No shifts yet. Clock in to start tracking.</div>'; }
  let lastDay="";
  done.forEach(s=>{
    const dk=dayKey(s.start);
    if(dk!==lastDay){ lastDay=dk;
      const d=document.createElement("div");
      d.style.cssText="font-size:12px;color:var(--muted);text-transform:uppercase;letter-spacing:.5px;margin:12px 0 2px";
      d.textContent=fmtDate(s.start); box.appendChild(d);
    }
    const h=hrs(s), row=document.createElement("div"); row.className="row";
    row.innerHTML='<div><div class="d">'+esc(fmtTime(s.start))+" – "+esc(fmtTime(s.end))+'</div>'+
      '<div class="t">'+h.toFixed(2)+' hours'+(s.tip?' · '+money(s.tip)+' tip':'')+(s.rate!=null&&s.rate!==db.rate?' · '+money(s.rate)+'/hr':'')+'</div></div>'+
      '<div class="m"><b>'+money(pay(s))+'</b>'+
      '<span><button class="icon-btn" data-edit="'+esc(s.id)+'">Edit</button>'+
      '<button class="icon-btn danger" data-del="'+esc(s.id)+'">Delete</button></span></div>';
    if(s.note){ const nd=document.createElement("div"); nd.className="shnote"; nd.textContent="\uD83D\uDCDD "+s.note; row.appendChild(nd); }
    box.appendChild(row);
  });
  box.querySelectorAll("[data-del]").forEach(b=>b.onclick=()=>{
    const id=b.dataset.del, gone=db.shifts.find(s=>s.id===id); if(!gone) return;
    db.shifts=db.shifts.filter(s=>s.id!==id); save(); render(); queueSync({action:"delete", id:id});
    showUndo("Shift deleted.", ()=>{ db.shifts.push(gone); save(); render(); if(gone.end) queueSync({action:"upsert", shift:shiftPayload(gone)}); }); });
  box.querySelectorAll("[data-edit]").forEach(b=>b.onclick=()=>openModal(db.shifts.find(s=>s.id===b.dataset.edit)));

  drawChart();
  applyTheme();
  $("rateInput").value=db.rate; fillSettingsPickers();
}

function drawChart(){
  const cv=$("chart"), ctx=cv.getContext("2d");
  const dpr=window.devicePixelRatio||1, W=cv.clientWidth, H=cv.clientHeight;
  cv.width=W*dpr; cv.height=H*dpr; ctx.scale(dpr,dpr); ctx.clearRect(0,0,W,H);
  const now=new Date(); const keys=[];
  for(let i=5;i>=0;i--){ const d=new Date(now.getFullYear(), now.getMonth()-i, 1); keys.push(monthKey(d.getTime())); }
  const sums={}; keys.forEach(k=>sums[k]=0);
  db.shifts.forEach(s=>{ if(!s.end) return; const k=monthKey(s.start); if(k in sums) sums[k]+=pay(s); });
  const max=Math.max(1,...Object.values(sums));
  const cs=getComputedStyle(document.documentElement);
  const colMuted=(cs.getPropertyValue("--muted")||"#6b7686").trim();
  const colInk=(cs.getPropertyValue("--ink")||"#1b2430").trim();
  const padL=8, padB=26, padT=28, cw=(W-padL)/6, bh=H-padB-padT;
  ctx.font="11px -apple-system, sans-serif"; ctx.textAlign="center";
  keys.forEach((k,i)=>{
    const v=sums[k], h=Math.max(3,(v/max)*bh), x=padL+i*cw+cw/2;
    const g=ctx.createLinearGradient(0,H-padB-h,0,H-padB);
    g.addColorStop(0,"#6f93f2"); g.addColorStop(1,"#c5d3fa");
    ctx.fillStyle=g;
    const bw=Math.min(44,cw-18);
    ctx.beginPath(); ctx.roundRect(x-bw/2, H-padB-h, bw, h, 6); ctx.fill();
    ctx.fillStyle=colMuted;
    ctx.fillText(monthLabel(k).split(" ")[0], x, H-10);
    if(v>0){ ctx.fillStyle=colInk; ctx.fillText("$"+Math.round(v), x, H-padB-h-6); }
  });
}

// ---------- Analytics ----------
function startOfWeek(ts){ const d=new Date(ts); const diff=(d.getDay()+6)%7; d.setHours(0,0,0,0); return d.getTime()-diff*86400000; }

let anaOff=0;
function dayStart(d){ const x=new Date(d); x.setHours(0,0,0,0); return x; }
// Buckets for the selected period: week -> 7 days, month -> its days, year -> 12 months. off = periods back/forward.
function buildBuckets(p, off){
  const B=[], now=new Date(); let title="";
  const add=(a,b,label)=>B.push({a:a.getTime(), b:b.getTime(), label, hours:0, earned:0, tips:0, n:0});
  if(p==="week"){
    const m=dayStart(now); m.setDate(m.getDate()-((m.getDay()+6)%7)+off*7);
    const names=["Mon","Tue","Wed","Thu","Fri","Sat","Sun"];
    for(let i=0;i<7;i++){ const a=new Date(m); a.setDate(m.getDate()+i); const b=new Date(a); b.setDate(a.getDate()+1); add(a,b,names[i]); }
    const e=new Date(m); e.setDate(m.getDate()+6);
    title=MONTHS[m.getMonth()]+" "+m.getDate()+" – "+MONTHS[e.getMonth()]+" "+e.getDate();
  } else if(p==="month"){
    const f=new Date(now.getFullYear(), now.getMonth()+off, 1), n=new Date(f.getFullYear(), f.getMonth()+1, 0).getDate();
    for(let i=1;i<=n;i++) add(new Date(f.getFullYear(),f.getMonth(),i), new Date(f.getFullYear(),f.getMonth(),i+1), String(i));
    title=["January","February","March","April","May","June","July","August","September","October","November","December"][f.getMonth()]+" "+f.getFullYear();
  } else {
    const y=now.getFullYear()+off;
    for(let i=0;i<12;i++) add(new Date(y,i,1), new Date(y,i+1,1), MONTHS[i][0]);
    title=String(y);
  }
  db.shifts.forEach(s=>{ if(!s.end) return; const t=s.start;
    for(const x of B){ if(t>=x.a && t<x.b){ const h=hrs(s); x.hours+=h; x.earned+=pay(s); x.tips+=tipOf(s); x.n++; break; } } });
  return {B, title};
}
function pctTag(cur, prev){
  if(!(prev>0)) return "";
  const d=Math.round((cur-prev)/prev*100); if(d===0) return "";
  return '<span class="d '+(d>0?"up":"dn")+'">'+(d>0?"▲":"▼")+Math.abs(d)+"%</span>";
}
function renderAnalytics(){
  const p = db.anaPeriod || "week";
  document.querySelectorAll("#anaSeg button").forEach(b=>b.classList.toggle("on", b.dataset.p===p));
  if(anaOff>0) anaOff=0;
  const cur=buildBuckets(p, anaOff), prev=buildBuckets(p, anaOff-1), days=cur.B;
  $("anaRange").textContent = anaOff===0 ? cur.title+" · now" : cur.title;
  $("anaNext").disabled = anaOff>=0;
  const sum=(arr,k)=>arr.reduce((a,x)=>a+x[k],0);
  const earned=sum(days,"earned"), hours=sum(days,"hours"), shifts=sum(days,"n");
  const tipsSum=sum(days,"tips"), pTips=sum(prev.B,"tips"), pEarned=sum(prev.B,"earned"), pHours=sum(prev.B,"hours");
  const worked=days.filter(x=>x.n>0);
  const best=days.reduce((a,x)=> x.earned>a.earned ? x : a, days[0]);
  const longest=db.shifts.filter(x=>x.end && x.start>=days[0].a && x.start<days[days.length-1].b).reduce((m,x)=>Math.max(m,hrs(x)),0);
  const nowT=Date.now(); const done=days.filter(x=>x.b<=nowT).length || (anaOff===0 ? Math.max(1,days.filter(x=>x.a<=nowT).length) : days.length);
  const bucketWord = p==="year" ? "month" : "day";
  const tiles=[
    ["Earned", money(earned)+pctTag(earned,pEarned)],
    ["Tips", money(tipsSum)+pctTag(tipsSum,pTips)+(tipsSum>0&&shifts>0?"<small>"+money(tipsSum/shifts)+" / shift</small>":"")],
    ["Hours", hours.toFixed(1)+"h"+pctTag(hours,pHours)],
    ["Shifts", String(shifts)+"<small>"+worked.length+" "+bucketWord+(worked.length===1?"":"s")+"</small>"],
    ["Avg shift", shifts ? (hours/shifts).toFixed(1)+"h" : "—"],
    ["Avg / "+bucketWord, (hours/Math.max(1,done)).toFixed(1)+"h<small>"+money(earned/Math.max(1,done))+"</small>"],
    ["Best "+bucketWord, best.earned>0 ? money(best.earned)+"<small>"+esc(p==="year"?MONTHS[days.indexOf(best)]:best.label)+"</small>" : "—"],
    ["Longest shift", longest>0 ? longest.toFixed(1)+"h" : "—"]
  ];
  if(earned>0 && anaOff===0 && p!=="week" && done>0 && done<days.length) tiles.push(["On pace for", money(earned/done*days.length)+"<small>"+(hours/done*days.length).toFixed(0)+"h</small>"]);
  else if(earned>0 && anaOff===0 && p==="week" && done>0 && done<7) tiles.push(["On pace for", money(earned/done*7)+"<small>"+(hours/done*7).toFixed(0)+"h</small>"]);
  const g=$("anaStats"); g.innerHTML="";
  tiles.forEach(([l,v])=>{ const d=document.createElement("div"); d.className="ana-tile";
    d.innerHTML='<div class="l">'+l+'</div><div class="v">'+v+'</div>'; g.appendChild(d); });
  drawAnaChart(days, p);
  renderInsights();
  renderFun();
}
// ---------- Data lab: the statistics behind your shifts ----------
const mean=a=>a.reduce((s,x)=>s+x,0)/a.length;
const sdev=a=>{ if(a.length<2) return 0; const m=mean(a); return Math.sqrt(a.reduce((s,x)=>s+(x-m)*(x-m),0)/(a.length-1)); };
const median=a=>{ const b=a.slice().sort((x,y)=>x-y), n=b.length; return n%2 ? b[(n-1)/2] : (b[n/2-1]+b[n/2])/2; };
function pearson(x,y){ const mx=mean(x), my=mean(y); let sxy=0,sxx=0,syy=0;
  for(let i=0;i<x.length;i++){ sxy+=(x[i]-mx)*(y[i]-my); sxx+=(x[i]-mx)*(x[i]-mx); syy+=(y[i]-my)*(y[i]-my); }
  return sxx&&syy ? sxy/Math.sqrt(sxx*syy) : 0; }
const T05=[4.303,3.182,2.776,2.571,2.447,2.365,2.306,2.262,2.228,2.201,2.179,2.160,2.145,2.131,2.120,2.110,2.101,2.093,2.086,2.080,2.074,2.069,2.064,2.060,2.056,2.052,2.048,2.045];  // two-tailed t, df 2..29
function linreg(y){
  const n=y.length, xs=y.map((_,i)=>i), mx=mean(xs), my=mean(y);
  let sxx=0,sxy=0; xs.forEach((x,i)=>{ sxx+=(x-mx)*(x-mx); sxy+=(x-mx)*(y[i]-my); });
  const b=sxx?sxy/sxx:0, a=my-b*mx; let sse=0,sst=0;
  y.forEach((v,i)=>{ const e=v-(a+b*i); sse+=e*e; sst+=(v-my)*(v-my); });
  const df=n-2, s=df>0?Math.sqrt(sse/df):0, se=sxx&&s?s/Math.sqrt(sxx):0, t=se?b/se:0;
  const crit=df>=2 ? (df<=29?T05[df-2]:1.96) : Infinity;
  return {n,a,b,mx,sxx,s,r2:sst?1-sse/sst:0,sig:Math.abs(t)>crit};
}
function labStats(done, dayMap){
  const L={n:done.length};
  const lens=done.map(hrs); L.lens=lens;
  if(lens.length){ L.mean=mean(lens); L.med=median(lens); L.sd=sdev(lens); L.cv=L.mean?L.sd/L.mean:0; }
  const sm=x=>{ const d=new Date(x); return d.getHours()*60+d.getMinutes(); };
  const starts=done.map(x=>sm(x.start)), ends=done.filter(x=>dayKey(x.end)===dayKey(x.start)).map(x=>sm(x.end));
  L.starts=starts; L.typStart=starts.length?mean(starts):null; L.typEnd=ends.length?mean(ends):null;
  L.early=L.n>=5 && starts.some(m=>m<=L.typStart-30);                                  // clocked in 30+ min before your usual start
  L.late =L.n>=5 && L.typEnd!==null && done.some(x=>dayKey(x.end)!==dayKey(x.start) || sm(x.end)>=L.typEnd+60);   // stayed 1h+ past your usual finish
  L.onDot=L.n>=8 ? starts.filter(m=>Math.abs(m-L.typStart)<=10).length : 0;
  // weekly series: complete weeks since your first week with data
  const wk=[]; for(let w=12;w>=1;w--){ wk.push(buildBuckets("week",-w).B.reduce((a,x)=>a+x.hours,0)); }
  while(wk.length && wk[0]===0) wk.shift();
  L.weeks=wk;
  if(wk.length>=4){ L.reg=linreg(wk); const r=L.reg, x=wk.length;
    L.pred=Math.max(0, r.a+r.b*x); L.half=2*r.s*Math.sqrt(1+1/r.n+Math.pow(x-r.mx,2)/(r.sxx||1));
    const mw=mean(wk); L.wcv=mw?sdev(wk)/mw:1; }
  // daily series
  const dk=Object.keys(dayMap); L.days=dk.map(k=>({k,h:dayMap[k].h,e:dayMap[k].e,t:dayMap[k].t||0}));
  const dh=L.days.map(d=>d.h); L.dmean=dh.length?mean(dh):0; L.dsd=sdev(dh);
  L.maxZ=0; L.zDay=null; if(L.dsd>0) L.days.forEach(d=>{ const z=(d.h-L.dmean)/L.dsd; if(z>L.maxZ){ L.maxZ=z; L.zDay=d; } });
  return L;
}
function drawTrend(L){
  const cv=$("trendChart"), ctx=cv.getContext("2d"), dpr=window.devicePixelRatio||1, W=cv.clientWidth, H=cv.clientHeight;
  if(!W) return; cv.width=W*dpr; cv.height=H*dpr; ctx.scale(dpr,dpr); ctx.clearRect(0,0,W,H);
  if(!L.reg){ return; }
  const cs=getComputedStyle(document.documentElement), acc=cs.getPropertyValue("--accent").trim()||"#4a78e8", mut=cs.getPropertyValue("--muted").trim()||"#6b7686", grn=cs.getPropertyValue("--green").trim()||"#2f9e6e";
  const y=L.weeks, n=y.length, padL=30, padR=16, padT=14, padB=22, top=Math.max(1,...y,L.pred+L.half)*1.08;
  const X=i=>padL+(i/n)*(W-padL-padR), Y=v=>padT+(1-v/top)*(H-padT-padB);
  ctx.font="10.5px -apple-system, sans-serif"; ctx.textAlign="right"; ctx.fillStyle=mut; ctx.strokeStyle=mut; ctx.lineWidth=.5; ctx.globalAlpha=.35;
  [0,.5,1].forEach(f=>{ const v=top*f; ctx.beginPath(); ctx.moveTo(padL,Y(v)); ctx.lineTo(W-padR,Y(v)); ctx.stroke(); }); ctx.globalAlpha=1;
  [0,.5,1].forEach(f=>ctx.fillText(Math.round(top*f)+"h",padL-6,Y(top*f)+3));
  ctx.textAlign="center"; ctx.fillText("now",X(n),H-6); ctx.fillText(n+"w ago",X(0),H-6);
  // regression line (dashed), actual weekly hours (solid), forecast with ~95% interval
  ctx.setLineDash([5,4]); ctx.strokeStyle=mut; ctx.lineWidth=1.5; ctx.beginPath(); ctx.moveTo(X(0),Y(L.reg.a)); ctx.lineTo(X(n),Y(L.reg.a+L.reg.b*n)); ctx.stroke(); ctx.setLineDash([]);
  ctx.strokeStyle=acc; ctx.lineWidth=2.5; ctx.lineJoin="round"; ctx.beginPath(); y.forEach((v,i)=>{ i?ctx.lineTo(X(i),Y(v)):ctx.moveTo(X(i),Y(v)); }); ctx.stroke();
  ctx.fillStyle=acc; y.forEach((v,i)=>{ ctx.beginPath(); ctx.arc(X(i),Y(v),3.2,0,7); ctx.fill(); });
  const lo=Math.max(0,L.pred-L.half), hi=L.pred+L.half;
  ctx.strokeStyle=grn; ctx.lineWidth=2; ctx.beginPath(); ctx.moveTo(X(n),Y(lo)); ctx.lineTo(X(n),Y(hi)); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(X(n)-5,Y(lo)); ctx.lineTo(X(n)+5,Y(lo)); ctx.moveTo(X(n)-5,Y(hi)); ctx.lineTo(X(n)+5,Y(hi)); ctx.stroke();
  ctx.fillStyle=grn; ctx.beginPath(); ctx.arc(X(n),Y(L.pred),4.2,0,7); ctx.fill();
}
function renderLab(L, rate){
  $("labN").textContent="n = "+L.n+" shifts";
  const g=$("labTiles"); g.textContent="";
  const tile=(l,v,sub)=>{ const d=document.createElement("div"); d.className="ana-tile"; const a=document.createElement("div"), b=document.createElement("div");
    a.className="l"; a.textContent=l; b.className="v"; b.textContent=v; if(sub){ const sm=document.createElement("small"); sm.textContent=sub; b.appendChild(sm); }
    d.appendChild(a); d.appendChild(b); g.appendChild(d); };
  const histo=$("histo"), find=$("findings"); histo.textContent=""; find.textContent="";
  if(L.n<3){ tile("Mean shift","—"); tile("Std dev","—"); $("trendNote").textContent="Log a few more shifts to unlock the stats."; drawTrend({}); 
    const li=document.createElement("li"); li.textContent="Findings appear after about 10 shifts."; find.appendChild(li); return; }
  tile("Mean shift", L.mean.toFixed(2)+"h", "median "+L.med.toFixed(1));
  tile("Std dev", "±"+L.sd.toFixed(2)+"h", "CV "+Math.round(L.cv*100)+"%");
  tile("Consistency", String(Math.max(0,Math.round(100*(1-L.cv))))+"/100");
  if(L.reg) tile("Weekly trend", (L.reg.b>=0?"+":"−")+Math.abs(L.reg.b).toFixed(2)+"h/wk", L.reg.sig?"p<0.05 ✓":"n.s.");
  if(L.reg) tile("Week forecast", L.pred.toFixed(1)+"h", "±"+L.half.toFixed(1)+" · "+money(L.pred*rate));
  if(L.reg) tile("Fit (R²)", L.reg.r2.toFixed(2), "n = "+L.reg.n+" weeks");
  // trend chart + note
  if(L.reg){ drawTrend(L);
    $("trendNote").textContent="Dashed line = linear fit. Green dot = forecast for this week with a rough 95% interval ("+Math.max(0,L.pred-L.half).toFixed(0)+"–"+(L.pred+L.half).toFixed(0)+"h)."; }
  else { drawTrend({}); $("trendNote").textContent="Need 4+ weeks of data for a trend line."; }
  // histogram of shift lengths (2h bins)
  const bins=[0,0,0,0,0,0], lab=["0–2h","2–4h","4–6h","6–8h","8–10h","10h+"];
  L.lens.forEach(h=>{ bins[Math.min(5,Math.floor(h/2))]++; });
  const mx=Math.max.apply(null,bins);
  bins.forEach((c,i)=>{ const r=document.createElement("div"); r.className="wk"; const a=document.createElement("span"), bar=document.createElement("span"), v=document.createElement("span"), f=document.createElement("i");
    a.className="n"; a.style.width="44px"; a.textContent=lab[i]; bar.className="bar"; f.style.width=Math.round(c/mx*100)+"%"; bar.appendChild(f); v.className="v"; v.style.width="68px"; v.style.whiteSpace="nowrap"; v.textContent=c+" ("+Math.round(c/L.n*100)+"%)";
    r.appendChild(a); r.appendChild(bar); r.appendChild(v); histo.appendChild(r); });
  // findings
  const F=[], nd=L.days.length, add=t=>F.push(t);
  if(nd>=10){ const sorted=L.days.slice().sort((a,b)=>b.e-a.e), k=Math.max(1,Math.round(nd*0.2)), tot=sorted.reduce((a,x)=>a+x.e,0);
    if(tot>0) add("Pareto: your best "+k+" days ("+Math.round(k/nd*100)+"%) bring in "+Math.round(sorted.slice(0,k).reduce((a,x)=>a+x.e,0)/tot*100)+"% of your earnings."); }
  if(L.n>=10){ const r=pearson(L.starts,L.lens);
    if(Math.abs(r)>=0.3) add("Later clock-ins go with "+(r<0?"shorter":"longer")+" shifts (r = "+r.toFixed(2)+")."); else add("Clock-in time barely predicts shift length (r = "+r.toFixed(2)+")."); }
  if(L.zDay && L.maxZ>=2) add("Biggest outlier: "+fmtDate(new Date(L.zDay.k+"T00:00:00").getTime())+", "+L.zDay.h.toFixed(1)+"h — "+L.maxZ.toFixed(1)+"σ above your daily mean.");
  const wd=Array.from({length:7},()=>[]), names=["Mondays","Tuesdays","Wednesdays","Thursdays","Fridays","Saturdays","Sundays"];
  L.days.forEach(d=>{ wd[(new Date(d.k+"T00:00:00").getDay()+6)%7].push(d.h); });
  let bw=-1, bd=0; wd.forEach((a,i)=>{ if(a.length>=3){ const dv=mean(a)-L.dmean; if(Math.abs(dv)>Math.abs(bd)){ bd=dv; bw=i; } } });
  if(bw>=0 && Math.abs(bd)>=0.5) add(names[bw]+" run "+Math.abs(bd).toFixed(1)+"h "+(bd>0?"longer":"shorter")+" than your typical day.");
  if(L.reg) add(L.reg.sig ? "Weekly hours are trending "+(L.reg.b>0?"up":"down")+" "+Math.abs(L.reg.b).toFixed(2)+"h per week (statistically significant, p<0.05)." : "No statistically significant trend in weekly hours — your schedule is stable.");
  if(!F.length) add("Keep logging shifts — more data, better insights.");
  F.slice(0,5).forEach(t=>{ const li=document.createElement("li"); li.textContent=t; find.appendChild(li); });
}

// ---------- The fun stuff: goal ring, heatmap, level, badges, fun facts ----------
let heatData={}, factIdx=0;
function renderFun(){
  const done=db.shifts.filter(x=>x.end), rate=db.rate;
  const dayMap={}; done.forEach(s=>{ const k=dayKey(s.start), h=hrs(s); const o=dayMap[k]||(dayMap[k]={h:0,e:0,t:0}); o.h+=h; o.e+=pay(s); o.t+=tipOf(s); });
  heatData=dayMap;

  // weekly goal ring
  const wk=buildBuckets("week",0).B, wkE=wk.reduce((a,x)=>a+x.earned,0), goal=db.goal||0, C=2*Math.PI*48, ring=$("goalRing");
  if(goal>0){
    const pct=wkE/goal;
    $("goalPct").textContent=Math.round(pct*100)+"%"; $("goalSub").textContent=money(wkE)+" of "+money(goal);
    $("goalMsg").textContent = pct>=1 ? "Goal smashed this week 🎉" : (rate>0 ? "About "+((goal-wkE)/rate).toFixed(1)+"h to go" : "Keep going");
    ring.classList.toggle("done", pct>=1); $("goalSet").textContent="Change goal";
    requestAnimationFrame(()=>ring.setAttribute("stroke-dashoffset", String(C*(1-Math.min(pct,1)))));
  } else {
    $("goalPct").textContent="—"; $("goalSub").textContent="No goal yet"; $("goalMsg").textContent="Pick a number to aim for each week";
    ring.classList.remove("done"); ring.setAttribute("stroke-dashoffset", String(C)); $("goalSet").textContent="Set goal";
  }

  // activity heatmap: 15 weeks x 7 days, Monday first
  const grid=$("hm"); grid.textContent="";
  const mon=dayStart(new Date()); mon.setDate(mon.getDate()-((mon.getDay()+6)%7)-14*7);
  const todayK=dayKey(Date.now());
  for(let c=0;c<15;c++) for(let r=0;r<7;r++){
    const d=new Date(mon); d.setDate(mon.getDate()+c*7+r);
    const k=dayKey(d.getTime()), v=dayMap[k], i=document.createElement("i");
    const lv=!v?0:v.h<3?1:v.h<6?2:v.h<9?3:4;
    i.className="l"+lv+(d.getTime()>Date.now()?" fut":"")+(k===todayK?" today":"");
    i.dataset.t=String(d.getTime()); grid.appendChild(i);
  }

  // totals, streaks, records
  const totH=done.reduce((a,x)=>a+hrs(x),0), totE=done.reduce((a,x)=>a+pay(x),0), totT=done.reduce((a,x)=>a+tipOf(x),0), n=done.length;
  let bestRun=0, run=0, prev=null;
  Object.keys(dayMap).sort().forEach(k=>{ const t=new Date(k+"T00:00:00").getTime();
    run=(prev!==null && Math.round((t-prev)/86400000)===1) ? run+1 : 1; prev=t; bestRun=Math.max(bestRun,run); });
  const longest=done.reduce((m,x)=>Math.max(m,hrs(x)),0);
  const L=labStats(done, dayMap); renderLab(L, rate);
  const early=L.early, night=L.late;

  // level (more hours => higher level, each one takes a bit longer)
  const lvl=Math.floor(Math.sqrt(totH/1.5))+1, lo=1.5*(lvl-1)*(lvl-1), hi=1.5*lvl*lvl;
  const names=["Rookie","Regular","Steady","Pro","Veteran","Legend"];
  $("lvlTitle").textContent="Level "+lvl+" · "+names[Math.min(names.length-1,Math.floor((lvl-1)/3))];
  $("lvlSub").textContent=(hi-totH).toFixed(1)+"h to level "+(lvl+1);
  $("xpBar").style.width=Math.round(Math.max(0,Math.min(1,(totH-lo)/(hi-lo)))*100)+"%";

  // fun facts (tap to cycle)
  const facts=[];
  if(totH>0){
    facts.push(["🎬","You've clocked "+totH.toFixed(0)+" hours — about "+(totH/2).toFixed(0)+" movies back to back."]);
    facts.push(["📺","That's roughly "+Math.round(totH/0.75)+" episodes of a 45-minute show."]);
    facts.push(["✈️","Enough time to fly from New York to Tokyo "+(totH/14).toFixed(1)+" times."]);
    if(totE>0){
      facts.push(["☕","You've earned about "+Math.round(totE/5)+" coffees ($5 each)."]);
      facts.push(["🍕","That's around "+Math.round(totE/15)+" pizzas ($15 each)."]);
      if(totT>0) facts.push(["🤑","On top of your "+money(totE)+" in pay, you've collected "+money(totT)+" in tips."]);
      facts.push(["⏱️","You make about "+money(rate/60)+" every minute you're clocked in."]);
    }
    const wd=Array(7).fill(0), names7=["Monday","Tuesday","Wednesday","Thursday","Friday","Saturday","Sunday"];
    done.forEach(x=>{ wd[(new Date(x.start).getDay()+6)%7]+=hrs(x); });
    if(L.n>=3) facts.push(["📊","Your average shift is "+L.mean.toFixed(2)+"h with a standard deviation of "+L.sd.toFixed(2)+"h — "+(L.cv<0.25?"a very tight distribution.":"a nicely varied schedule.")]);
    if(L.reg) facts.push(["🔮","Regression says you'll work about "+L.pred.toFixed(0)+"h this week (±"+L.half.toFixed(0)+"h)."]);
    facts.push(["📅","Your busiest day is "+names7[wd.indexOf(Math.max.apply(null,wd))]+"."]);
  }
  if(facts.length){ const f=facts[factIdx%facts.length]; $("factE").textContent=f[0]; $("factTxt").textContent=f[1]; }
  else { $("factE").textContent="✨"; $("factTxt").textContent="Clock a few shifts and fun facts will show up here."; }

  // achievements
  const B=[
    ["🎬","First shift","Log a shift",n>=1,Math.min(n/1,1)],
    ["🔟","10 shifts","Log 10 shifts",n>=10,Math.min(n/10,1)],
    ["💯","50 shifts","Log 50 shifts",n>=50,Math.min(n/50,1)],
    ["⏱️","100 hours","Clock 100 hours",totH>=100,Math.min(totH/100,1)],
    ["🏔️","500 hours","Clock 500 hours",totH>=500,Math.min(totH/500,1)],
    ["🔥","3-day streak","Work 3 days in a row",bestRun>=3,Math.min(bestRun/3,1)],
    ["🚀","7-day streak","Work 7 days in a row",bestRun>=7,Math.min(bestRun/7,1)],
    ["🌅","Early bird","Clock in 30 min before your usual start",early,early?1:0],
    ["🌙","Night owl","Stay 1h past your usual finish",night,night?1:0],
    ["⏰","On the dot","5 shifts within 10 min of your usual start",L.onDot>=5,Math.min(L.onDot/5,1)],
    ["🤑","Tipped!","Receive a tip",totT>0,totT>0?1:0],
    ["💸","$100 in tips","Collect $100 in tips",totT>=100,Math.min(totT/100,1)],
    ["🧪","n = 30","30 shifts: the central limit theorem kicks in",n>=30,Math.min(n/30,1)],
    ["🔔","Bell curve","20+ shifts with std dev under 1.5h",n>=20&&L.sd<=1.5,Math.min(n/20,1)*(L.sd?Math.min(1,1.5/L.sd):1)],
    ["📈","Significant!","A statistically significant weekly trend (p<0.05)",!!(L.reg&&L.reg.sig),L.reg?Math.min(1,Math.abs(L.reg.b)*3):0],
    ["🧘","Low variance","6+ weeks with weekly hours within ±15%",!!(L.reg&&L.weeks.length>=6&&L.wcv<0.15),L.reg&&L.wcv?Math.min(1,.15/L.wcv):0],
    ["🦄","Outlier","A day 2σ above your average",L.maxZ>=2,Math.min(L.maxZ/2,1)],
    ["🏃","Marathon","A shift of 10h or more",longest>=10,Math.min(longest/10,1)],
    ["💵","$1,000","Earn $1,000",totE>=1000,Math.min(totE/1000,1)],
    ["💎","$5,000","Earn $5,000",totE>=5000,Math.min(totE/5000,1)]
  ];
  const box=$("badges"); box.textContent="";
  B.forEach(b=>{ const d=document.createElement("div"); d.className="badge"+(b[3]?" on":"");
    const e=document.createElement("div"), t=document.createElement("div"), s=document.createElement("div");
    e.className="e"; e.textContent=b[0]; t.className="bt"; t.textContent=b[1]; s.className="bd"; s.textContent=b[2];
    d.appendChild(e); d.appendChild(t); d.appendChild(s); box.appendChild(d); });
  $("badgeCount").textContent=B.filter(b=>b[3]).length+" / "+B.length;
  const nxt=B.filter(b=>!b[3]).sort((a,b)=>b[4]-a[4])[0];
  $("badgeNext").textContent = nxt ? "Next up: "+nxt[1]+(nxt[4]>0&&nxt[4]<1?" — "+Math.round(nxt[4]*100)+"%":"") : "You've unlocked everything 🏆";
}
$("hm").addEventListener("click",e=>{ const i=e.target.closest("i"); if(!i) return;
  const t=Number(i.dataset.t), v=heatData[dayKey(t)];
  $("hmInfo").textContent=fmtDate(t)+" · "+(v ? v.h.toFixed(1)+"h · "+money(v.e) : (t>Date.now()?"upcoming":"no shifts")); });
$("factBtn").addEventListener("click",()=>{ factIdx++; renderFun(); });
// ---------- Settings pickers: tap a row to choose from a popup list instead of typing ----------
// Rebuilds a <select> only when its choices changed, and never while it is open (that would close the popup).
function fillPicker(sel, none, values, label, cur){
  if(document.activeElement===sel) return;
  const vs=values.slice(); if(cur>0 && !vs.includes(cur)){ vs.push(cur); vs.sort((a,b)=>a-b); }   // keep an older saved value selectable
  const sig=(none||"")+"|"+vs.map(v=>v+":"+label(v)).join(",");
  if(sel.dataset.sig!==sig){
    sel.textContent="";
    if(none!=null){ const o=document.createElement("option"); o.value=""; o.textContent=none; sel.appendChild(o); }
    vs.forEach(v=>{ const o=document.createElement("option"); o.value=String(v); o.textContent=label(v); sel.appendChild(o); });
    sel.dataset.sig=sig;
  }
  sel.value = cur>0 ? String(cur) : "";
}
const ordinal=n=>{ const s=["th","st","nd","rd"], v=n%100; return n+(s[(v-20)%10]||s[v]||s[0]); };
function fillSettingsPickers(){
  const rate=Number(db.rate)||0;
  fillPicker($("breakInput"),"None",[15,30,45,60],m=>m+" min",db.breakMin||0);
  fillPicker($("breakAfterInput"),null,[3,4,5,6,7,8,9,10],h=>h+"+ hours",db.breakAfter||6);
  $("breakAfterRow").style.display = db.breakMin>0 ? "" : "none";    // only matters once a break is set
  fillPicker($("paydayInput"),"Not set",Array.from({length:28},(_,i)=>i+1),ordinal,db.payday||0);
  // weekly goal: $10 steps, capped at what is possible in a 168-hour week at your pay rate; each choice shows its hours
  const top = rate>0 ? Math.floor(rate*168/10)*10 : 1000, goals=[]; for(let g=10; g<=top; g+=10) goals.push(g);
  fillPicker($("goalInput"),"No goal",goals,g=>"$"+g+(rate>0 ? " · "+(Math.round(g/rate*10)/10)+" h" : ""),db.goal||0);
}
fillSettingsPickers();
$("breakInput").addEventListener("change",e=>{ const v=Math.round(parseFloat(e.target.value)); if(Number.isFinite(v)&&v>0) db.breakMin=Math.min(v,120); else delete db.breakMin; e.target.value=db.breakMin||""; save(); render(); queueSettings(); });
$("breakAfterInput").addEventListener("change",e=>{ const v=parseFloat(e.target.value); if(Number.isFinite(v)&&v>=1) db.breakAfter=Math.min(v,24); else delete db.breakAfter; e.target.value=db.breakAfter||""; save(); render(); queueSettings(); });
$("paydayInput").addEventListener("change",e=>{ const v=Math.round(parseFloat(e.target.value)); if(Number.isFinite(v)&&v>=1&&v<=28) db.payday=v; else delete db.payday; e.target.value=db.payday||""; save(); renderPay(); queueSettings(); });
$("goalInput").addEventListener("change",e=>{ const v=parseFloat(e.target.value); db.goal=(Number.isFinite(v)&&v>0)?Math.min(v,1000000):0; if(!db.goal) delete db.goal; save(); renderAnalytics(); queueSettings(); });
$("goalSet").addEventListener("click",()=>{ document.querySelector('.tabbar [data-tab="settings"]').click(); setTimeout(()=>$("goalInput").focus(),350); });

function renderInsights(){
  const done=db.shifts.filter(x=>x.end).sort((a,b)=>a.start-b.start);
  const g=$("anaInsights"), w=$("anaWeekday"); g.innerHTML=""; w.innerHTML="";
  if(!done.length){ g.innerHTML='<div class="empty" style="grid-column:1/-1">Insights appear after your first shift.</div>'; return; }
  const H=x=>hrs(x), totalH=done.reduce((a,x)=>a+H(x),0);
  const dayMap={}, wkMap={}, moMap={}, wd=Array.from({length:7},()=>({h:0,days:new Set()}));
  let inMin=0, outMin=0, longest=done[0];
  done.forEach(x=>{
    const s=new Date(x.start), e=new Date(x.end), k=dayKey(x.start);
    dayMap[k]=(dayMap[k]||0)+H(x);
    const wk=dayStart(new Date(startOfWeek(x.start))).getTime(); wkMap[wk]=(wkMap[wk]||0)+pay(x);
    const mk=monthKey(x.start); moMap[mk]=(moMap[mk]||0)+pay(x);
    const di=(s.getDay()+6)%7; wd[di].h+=H(x); wd[di].days.add(k);
    inMin+=s.getHours()*60+s.getMinutes(); outMin+=e.getHours()*60+e.getMinutes();
    if(H(x)>H(longest)) longest=x;
  });
  const t=m=>{ m=Math.round(m); const d=new Date(); d.setHours(Math.floor(m/60), m%60, 0, 0); return fmtTime(d.getTime()); };
  // streak: consecutive calendar days with a shift, counting back from today (or yesterday)
  let streak=0; const c=dayStart(new Date()); if(!(dayKey(c.getTime()) in dayMap)) c.setDate(c.getDate()-1);
  while(dayKey(c.getTime()) in dayMap){ streak++; c.setDate(c.getDate()-1); }
  const bestWk=Math.max(...Object.values(wkMap)), bestMo=Object.entries(moMap).sort((a,b)=>b[1]-a[1])[0];
  const nDays=Object.keys(dayMap).length;
  const tiles=[
    ["Days worked", String(nDays)+"<small>"+done.length+" shifts</small>"],
    ["Avg shift", (totalH/done.length).toFixed(1)+"h"],
    ["Typical start", t(inMin/done.length)],
    ["Typical finish", t(outMin/done.length)],
    ["Current streak", streak+" day"+(streak===1?"":"s")],
    ["Longest shift", H(longest).toFixed(1)+"h<small>"+esc(fmtDate(longest.start))+"</small>"],
    ["Best week", money(bestWk)],
    ["Best month", money(bestMo[1])+"<small>"+esc(monthLabel(bestMo[0]))+"</small>"]
  ];
  tiles.forEach(([l,v])=>{ const d=document.createElement("div"); d.className="ana-tile";
    d.innerHTML='<div class="l">'+l+'</div><div class="v">'+v+'</div>'; g.appendChild(d); });
  const names=["Mon","Tue","Wed","Thu","Fri","Sat","Sun"], mx=Math.max(...wd.map(x=>x.h),0.01);
  wd.forEach((x,i)=>{ const avg=x.days.size? x.h/x.days.size : 0;
    const r=document.createElement("div"); r.className="wk";
    r.innerHTML='<span class="n">'+names[i]+'</span><span class="bar"><i style="width:'+Math.round(x.h/mx*100)+'%"></i></span><span class="v">'+(x.days.size? avg.toFixed(1)+"h avg":"—")+'</span>';
    w.appendChild(r); });
}

function drawAnaChart(days, p){
  const cv=$("anaChart"), ctx=cv.getContext("2d");
  const dpr=window.devicePixelRatio||1, W=cv.clientWidth, H=cv.clientHeight;
  cv.width=W*dpr; cv.height=H*dpr; ctx.scale(dpr,dpr); ctx.clearRect(0,0,W,H);
  const cs=getComputedStyle(document.documentElement);
  const colMuted=(cs.getPropertyValue("--muted")||"#6b7686").trim();
  const colInk=(cs.getPropertyValue("--ink")||"#1b2430").trim();
  const maxH=Math.max(0.5,...days.map(d=>d.hours));
  const padB=22, padT=24, n=days.length, slot=W/n, bw=Math.min(34, slot*0.55);
  const best=days.reduce((a,x)=> x.hours>a.hours ? x : a, days[0]);
  ctx.font="10.5px -apple-system, sans-serif"; ctx.textAlign="center";
  days.forEach((d,i)=>{
    const h=Math.max(2,(d.hours/maxH)*(H-padB-padT));
    const x=i*slot+slot/2;
    const g=ctx.createLinearGradient(0,H-padB-h,0,H-padB);
    if(d===best && d.hours>0){ g.addColorStop(0,"#4fbf8b"); g.addColorStop(1,"#bfe8d5"); }
    else { g.addColorStop(0,"#6f93f2"); g.addColorStop(1,"#c5d3fa"); }
    ctx.fillStyle=g;
    ctx.beginPath(); ctx.roundRect(x-bw/2, H-padB-h, bw, h, 5); ctx.fill();
    if(d.hours>0 && (p==="week" || d===best)){ ctx.fillStyle=colInk; ctx.fillText(d.hours.toFixed(1)+"h", x, H-padB-h-5); }
    if(p!=="month" || i%5===0 || i===n-1){ ctx.fillStyle=colMuted; ctx.fillText(d.label, x, H-7); }
  });
}

document.querySelectorAll("#anaSeg button").forEach(b=>b.onclick=()=>{ db.anaPeriod=b.dataset.p; anaOff=0; save(); renderAnalytics(); });
$("anaPrev").onclick=()=>{ anaOff--; renderAnalytics(); };
$("anaNext").onclick=()=>{ if(anaOff<0){ anaOff++; renderAnalytics(); } };

// ---------- Google Sheets sync (via Apps Script web app) ----------
function syncCfg(){ return db.sync || (db.sync = {url:"", secret:"", enabled:false}); }
function shiftPayload(s, rate){
  const h=hrs(s); rate = s.rate!=null ? s.rate : (rate==null ? db.rate : rate);
  return {id:s.id, date:fmtDate(s.start), day:["Sun","Mon","Tue","Wed","Thu","Fri","Sat"][new Date(s.start).getDay()], month:monthKey(s.start), in:fmtTime(s.start), out:fmtTime(s.end),
          hours:Math.round(h*100)/100, earned:Math.round(h*rate*100)/100, tips:s.tip||0, note:s.note||"", rate:rate, start:s.start, end:s.end};
}
// Before the pay rate changes, lock every older shift to the rate it was worked at, so a raise only affects new shifts.
function stampRates(){ db.shifts.forEach(s=>{ if(s.rate==null) s.rate=db.rate; }); }
function queueRestamp(){ const l=db.shifts.filter(s=>s.end).map(s=>shiftPayload(s)); if(l.length) queueSync({action:"bulk", shifts:l}); }
function settingsPayload(){ return {rate:db.rate, goal:db.goal||0, payday:db.payday||0, breakMin:db.breakMin||0, breakAfter:db.breakAfter||6}; }
function cleanSettings(x){
  if(!x || typeof x !== "object") return null;
  const o = {}, r = Number(x.rate), g = Number(x.goal), p = Math.round(Number(x.payday));
  if(Number.isFinite(r) && r >= 0 && r <= 100000) o.rate = r;
  if(Number.isFinite(g) && g >= 0 && g <= 1000000) o.goal = g;
  if(Number.isFinite(p) && p >= 0 && p <= 28) o.payday = p;
  const bm = Math.round(Number(x.breakMin)), ba = Number(x.breakAfter);
  if(Number.isFinite(bm) && bm >= 0 && bm <= 120) o.breakMin = bm;
  if(Number.isFinite(ba) && ba >= 1 && ba <= 24) o.breakAfter = ba;
  return Object.keys(o).length ? o : null;
}
function queueSettings(){   // only the newest settings matter, so replace any waiting copy
  const c=syncCfg(); if(!c.enabled || !c.url) return;
  db.outbox=(db.outbox||[]).filter(e=>e.action!=="sset");
  queueSync({action:"sset", settings:settingsPayload()});
}
function payPayload(p){ return {id:p.id, date:fmtDate(p.ts), month:monthKey(p.ts), amount:p.amount, note:p.note, ts:p.ts}; }
// Talk to the script and READ the reply, so wrong secrets / bad deployments show up as errors.
async function syncCall(body){
  const c=syncCfg();
  if(!SYNC_URL_RE.test(c.url||"")) throw new Error("That isn't a Google Apps Script web app URL (it should end in /exec).");
  let res;
  try{
    res=await fetch(c.url, {method:"POST", redirect:"follow", credentials:"omit", referrerPolicy:"no-referrer", cache:"no-store",
      headers:{"Content-Type":"text/plain;charset=utf-8"},
      body:JSON.stringify(Object.assign({secret:c.secret}, body))});
  }catch(e){ const err=new Error(navigator.onLine ? "Can't reach the script. Check the URL and that access is set to Anyone." : "Offline"); err.offline=!navigator.onLine; throw err; }
  let j; try{ j=await res.json(); }catch(e){ throw new Error("Script didn't answer properly. Replace it with the latest Code.gs and redeploy."); }
  if(!j || !j.ok) throw new Error((j && j.error) || "Script error");
  return j;
}
function queueSync(ev){
  const c=syncCfg();
  if(!c.enabled || !c.url) return;
  db.outbox=db.outbox||[];
  db.outbox.push(ev);
  save();
  updateSyncStatus();
  flushOutbox();
}
let flushing=false;
async function flushOutbox(){
  const c=syncCfg();
  db.outbox=db.outbox||[];
  if(flushing) return;
  if(!c.enabled || !c.url || !db.outbox.length || !navigator.onLine){ updateSyncStatus(); return; }
  flushing=true;
  try{
    let warn="";
    while(db.outbox.length){
      const ev=db.outbox[0];
      try{ await syncCall(ev); }
      catch(e){ if(e.message==="Unknown action" && /^[ps]/.test(ev.action)){ db.outbox.shift(); warn="Update the script (Code.gs) to sync payments and settings"; save(); continue; } throw e; }
      db.outbox.shift();
      db.lastSync=Date.now(); c.err=""; save();
    }
    if(warn){ c.err=warn; save(); }
  }catch(e){ if(!e.offline) c.err=e.message; save(); }   // remaining events stay queued
  flushing=false;
  updateSyncStatus();
}
// Merge shifts that exist in the sheet but not on this device (restore after reinstall).
async function syncPull(applySettings){
  const j=await syncCall({action:"list"});
  const have=new Set(db.shifts.map(x=>x.id));
  const pendingDel=new Set((db.outbox||[]).filter(e=>e.action==="delete").map(e=>e.id));
  let added=0;
  (Array.isArray(j.shifts) ? j.shifts : []).slice(0,50000).forEach(r=>{
    const c=cleanShift(r && {id:r.id, start:r.start, end:r.end, tip:r.tip, note:r.note, rate:r.rate});
    if(!c || !c.end || have.has(c.id) || pendingDel.has(c.id)) return;
    have.add(c.id); db.shifts.push(c); added++;
  });
  try{
    const pj=await syncCall({action:"plist"}), haveP=new Set(pays().map(x=>x.id));
    const pendingPDel=new Set((db.outbox||[]).filter(e=>e.action==="pdelete").map(e=>e.id));
    (Array.isArray(pj.payments)?pj.payments:[]).slice(0,20000).forEach(r=>{ const c=cleanPayment(r); if(!c||haveP.has(c.id)||pendingPDel.has(c.id)) return; haveP.add(c.id); pays().push(c); added++; });
  }catch(e){ if(e.message!=="Unknown action") throw e; }
  if(applySettings && !(db.outbox||[]).some(e=>e.action==="sset")){
    try{
      const sj=await syncCall({action:"sget"}), c=cleanSettings(sj.settings);
      if(c){ if(c.rate!=null && c.rate!==db.rate){ stampRates(); db.rate=c.rate; } if(c.goal!=null){ if(c.goal>0) db.goal=c.goal; else delete db.goal; } if(c.payday!=null){ if(c.payday>0) db.payday=c.payday; else delete db.payday; }
        if(c.breakMin!=null){ if(c.breakMin>0) db.breakMin=c.breakMin; else delete db.breakMin; } if(c.breakAfter!=null) db.breakAfter=c.breakAfter;
        added+=0; save(); render(); }
    }catch(e){ if(e.message!=="Unknown action") throw e; }
  }
  if(added){ save(); render(); }
  return added;
}
async function syncUploadAll(){
  const list=db.shifts.filter(x=>x.end).map(shiftPayload);
  await syncCall({action:"bulk", shifts:list});
  try{ await syncCall({action:"sset", settings:settingsPayload()}); }catch(e){ if(e.message!=="Unknown action") throw e; }
  const pl=pays().map(payPayload);
  if(pl.length){ try{ await syncCall({action:"pbulk", payments:pl}); }catch(e){ if(e.message==="Unknown action") throw new Error("Shifts uploaded. Update the script (Code.gs) to sync payments too."); throw e; } }
  return list.length;
}
async function syncRun(label, fn){
  const el=$("syncStatus"), c=syncCfg();
  if(!c.url){ el.textContent="Paste the web app URL first"; el.classList.add("err"); return; }
  el.classList.remove("err"); el.textContent=label+"…";
  try{ const r=await fn(); c.err=""; save(); updateSyncStatus(typeof r==="string"?r:""); }
  catch(e){ c.err=e.message; save(); updateSyncStatus(); }
}
function updateSyncStatus(msg){
  const c=syncCfg(), el=$("syncStatus");
  if(!el) return;
  el.classList.remove("err");
  if(!c.url){ el.textContent="Not set up"; return; }
  if(c.err){ el.classList.add("err"); el.textContent=c.err; return; }
  if(msg){ el.textContent=msg; return; }
  const n=(db.outbox||[]).length;
  if(!c.enabled) el.textContent="Auto-sync is off";
  else if(n>0) el.textContent=n+" change"+(n===1?"":"s")+" waiting"+(navigator.onLine?"":" (offline)");
  else if(db.lastSync) el.textContent="Synced · "+fmtTime(db.lastSync);
  else el.textContent="Ready";
}
function updateSyncToggle(){
  const b=$("syncToggle");
  if(b) b.textContent=syncCfg().enabled ? "On" : "Off";
}
// ---------- /Google Sheets sync ----------

// modal
let editingId=null;
function openModal(shift){
  editingId = shift ? shift.id : null;
  $("modalTitle").textContent = shift ? "Edit shift" : "Add shift";
  const d = shift ? new Date(shift.start) : new Date();
  $("fDate").value = dayKey(shift?shift.start:Date.now());
  const t2 = ts => { const x=new Date(ts); return String(x.getHours()).padStart(2,"0")+":"+String(x.getMinutes()).padStart(2,"0"); };
  $("fIn").value = shift ? t2(shift.start) : "";
  $("fOut").value = (shift && shift.end) ? t2(shift.end) : "";
  $("fTip").value = (shift && shift.tip) ? shift.tip : ""; $("fNote").value = (shift && shift.note) ? shift.note : ""; $("fRate").value = shift ? rateOf(shift) : db.rate;
  $("modalBg").classList.add("open");
}
function closeModal(){ $("modalBg").classList.remove("open"); editingId=null; }
$("modalCancel").onclick=closeModal;
$("modalBg").addEventListener("click",e=>{ if(e.target===$("modalBg")) closeModal(); });
$("modalSave").onclick=()=>{
  const dv=$("fDate").value, iv=$("fIn").value, ov=$("fOut").value;
  if(!dv||!iv||!ov){ alert("Please fill date, clock-in and clock-out."); return; }
  const start=new Date(dv+"T"+iv).getTime();
  let end=new Date(dv+"T"+ov).getTime();
  if(end===start){ alert("Clock-out must be after clock-in."); return; }
  if(end<start) end+=86400000; // overnight shift: clock-out is the next day
  const tp=Math.round(parseFloat($("fTip").value)*100)/100, tipV=(Number.isFinite(tp)&&tp>0)?Math.min(tp,100000):0;
  const rv=parseFloat($("fRate").value), rateV=(Number.isFinite(rv)&&rv>=0)?Math.min(rv,100000):db.rate;
  const noteV=cleanText($("fNote").value,80);
  if(editingId){ const s=db.shifts.find(x=>x.id===editingId); s.start=start; s.end=end; if(tipV) s.tip=tipV; else delete s.tip; if(noteV) s.note=noteV; else delete s.note; s.rate=rateV; queueSync({action:"upsert", shift:shiftPayload(s)}); }
  else { const ns={id:uid(), start, end}; if(tipV) ns.tip=tipV; if(noteV) ns.note=noteV; ns.rate=rateV; db.shifts.push(ns); queueSync({action:"upsert", shift:shiftPayload(ns)}); }
  save(); closeModal(); render();
};
$("manualBtn").onclick=()=>openModal(null);


// tips: add to the open shift, or the latest finished shift today
function tipTarget(){
  const open=openShift(); if(open) return open;
  const t=dayKey(Date.now());
  return db.shifts.filter(x=>x.end && dayKey(x.start)===t).sort((a,b)=>b.start-a.start)[0] || null;
}
function closeTip(){ $("tipBg").classList.remove("open"); }
$("tipBtn").onclick=()=>{
  const t=tipTarget(); if(!t){ alert("Clock in first, or add a shift for today, then you can log tips."); return; }
  $("tipFor").textContent = t.end ? "For your shift "+fmtTime(t.start)+" – "+fmtTime(t.end) : "For your current shift";
  $("tipAmt").value=""; $("tipBg").classList.add("open");
};
$("tipChips").addEventListener("click",e=>{ const b=e.target.closest("button"); if(!b) return;
  const cur=parseFloat($("tipAmt").value)||0; $("tipAmt").value=(Math.round((cur+Number(b.dataset.v))*100)/100).toString(); });
$("tipCancel").onclick=closeTip;
$("tipBg").addEventListener("click",e=>{ if(e.target===$("tipBg")) closeTip(); });
$("tipSave").onclick=()=>{
  const v=Math.round(parseFloat($("tipAmt").value)*100)/100;
  if(!Number.isFinite(v)||v<=0){ alert("Enter a tip amount."); return; }
  const t=tipTarget(); if(!t){ closeTip(); return; }
  t.tip=Math.min(Math.round(((t.tip||0)+v)*100)/100,100000);
  save(); closeTip(); render(); if(t.end) queueSync({action:"upsert", shift:shiftPayload(t)});
};

// clock in/out
let undoFn=null, undoTimer=null;
function showUndo(msg, fn){ undoFn=fn; $("undoTxt").textContent=msg; $("undoBar").hidden=false; clearTimeout(undoTimer); undoTimer=setTimeout(()=>{ $("undoBar").hidden=true; undoFn=null; },8000); }
$("undoBtn").onclick=()=>{ const f=undoFn; undoFn=null; $("undoBar").hidden=true; clearTimeout(undoTimer); if(f) f(); };
let toastTimer=null, toastShift=null, toastTap=0;
function hideToast(){ $("toast").hidden=true; clearTimeout(toastTimer); }
$("toastBtn").onclick=()=>{ const s=db.shifts.find(x=>x.id===toastShift); if(!s) return hideToast(); hideToast();
  const d=new Date(s.end); $("endTime").value=String(d.getHours()).padStart(2,"0")+":"+String(d.getMinutes()).padStart(2,"0"); $("endBg").classList.add("open"); };
$("endCancel").onclick=()=>$("endBg").classList.remove("open");
$("endBg").addEventListener("click",e=>{ if(e.target===$("endBg")) $("endBg").classList.remove("open"); });
$("endSave").onclick=()=>{
  const s=db.shifts.find(x=>x.id===toastShift), v=$("endTime").value; if(!s||!v){ $("endBg").classList.remove("open"); return; }
  const base=new Date(toastTap), [hh,mm]=v.split(":").map(Number); base.setHours(hh,mm,0,0);
  const cand=base.getTime();
  if(cand<=s.start){ alert("That's before you clocked in."); return; }
  if(cand>toastTap+60000){ alert("You can only move the finish earlier than when you tapped Clock Out."); return; }
  s.end=cand; save(); render(); $("endBg").classList.remove("open"); queueSync({action:"upsert", shift:shiftPayload(s)});
};
sheetDrag($("endBg"), ()=>$("endBg").classList.remove("open"));
$("clockBtn").onclick=()=>{
  const open=openShift();
  if(open){ open.end=Date.now(); save(); render(); queueSync({action:"upsert", shift:shiftPayload(open)});
    toastShift=open.id; toastTap=open.end; $("toastTxt").textContent="Clocked out at "+fmtTime(open.end)+"."; $("toast").hidden=false; clearTimeout(toastTimer); toastTimer=setTimeout(hideToast,20000); }
  else { db.shifts.push({id:uid(), start:Date.now(), end:null, rate:db.rate}); save(); render(); }
};
$("cancelShift").onclick=()=>{ if(confirm("Discard the current open shift?")){
  db.shifts=db.shifts.filter(s=>s.end); save(); render(); }};

// settings
document.querySelectorAll("#themeSeg button").forEach(b=>b.onclick=()=>{
  db.theme=b.dataset.t; save(); applyTheme(); drawChart();
});
window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change",()=>{
  if((db.theme||"auto")==="auto"){ applyTheme(); drawChart(); }
});
$("rateInput").addEventListener("change",e=>{ const v=parseFloat(e.target.value);
  if(!(v>=0) || v===db.rate){ e.target.value=db.rate; return; }
  pendingRate=Math.min(v,100000); $("rateMsg").textContent=money(db.rate)+"/hr \u2192 "+money(pendingRate)+"/hr";
  const t=dayKey(Date.now()); $("rateFrom").value=t; $("rateFrom").max=t; $("rateBg").classList.add("open"); });
let pendingRate=null;
function closeRate(){ $("rateBg").classList.remove("open"); pendingRate=null; $("rateInput").value=db.rate; }
$("rateCancel").onclick=closeRate;
$("rateBg").addEventListener("click",e=>{ if(e.target===$("rateBg")) closeRate(); });
$("rateSave").onclick=()=>{
  if(pendingRate==null) return closeRate();
  const f=$("rateFrom").value; if(!f){ alert("Pick the day the new rate starts."); return; }
  const from=new Date(f+"T00:00:00").getTime(); if(from>Date.now()){ alert("The start day can't be in the future."); return; }
  stampRates();                                              // lock everything to the old rate first
  db.shifts.forEach(s=>{ if(s.start>=from) s.rate=pendingRate; });   // then move shifts from that day onward
  db.rate=pendingRate; pendingRate=null; save(); $("rateBg").classList.remove("open"); render(); queueSettings(); queueRestamp();
};
sheetDrag($("rateBg"), closeRate);
function download(name, text, type){
  const a=document.createElement("a");
  a.href=URL.createObjectURL(new Blob([text],{type})); a.download=name; a.click();
  setTimeout(()=>URL.revokeObjectURL(a.href),4000);
}
/* ===== XLSX EXPORT (pure functions — also unit-tested in node) ===== */
const XLSX_CRC_T=(()=>{const t=new Uint32Array(256);for(let n=0;n<256;n++){let c=n;for(let k=0;k<8;k++)c=c&1?0xEDB88320^(c>>>1):c>>>1;t[n]=c>>>0;}return t;})();
function xlsxCrc32(b){let c=0xFFFFFFFF;for(let i=0;i<b.length;i++)c=XLSX_CRC_T[(c^b[i])&0xFF]^(c>>>8);return (c^0xFFFFFFFF)>>>0;}
function xlsxEsc(s){return String(s).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;");}
function xlsxZip(files){
  const enc=new TextEncoder();
  const parts=[], central=[];
  let offset=0;
  files.forEach(f=>{
    const name=enc.encode(f.name), data=f.data, crc=xlsxCrc32(data);
    const lh=new DataView(new ArrayBuffer(30));
    lh.setUint32(0,0x04034b50,true); lh.setUint16(4,20,true);
    lh.setUint32(14,crc,true); lh.setUint32(18,data.length,true); lh.setUint32(22,data.length,true);
    lh.setUint16(26,name.length,true);
    parts.push(lh.buffer,name,data);
    central.push({name:name,crc:crc,size:data.length,offset:offset});
    offset+=30+name.length+data.length;
  });
  const cdStart=offset; let cdSize=0;
  central.forEach(e=>{
    const h=new DataView(new ArrayBuffer(46));
    h.setUint32(0,0x02014b50,true); h.setUint16(4,20,true); h.setUint16(6,20,true);
    h.setUint32(16,e.crc,true); h.setUint32(20,e.size,true); h.setUint32(24,e.size,true);
    h.setUint16(28,e.name.length,true); h.setUint32(42,e.offset,true);
    parts.push(h.buffer,e.name);
    cdSize+=46+e.name.length;
  });
  const end=new DataView(new ArrayBuffer(22));
  end.setUint32(0,0x06054b50,true);
  end.setUint16(8,central.length,true); end.setUint16(10,central.length,true);
  end.setUint32(12,cdSize,true); end.setUint32(16,cdStart,true);
  parts.push(end.buffer);
  return new Blob(parts,{type:"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"});
}
function xlsxDateSerial(y,mo,d){ return Math.round((Date.UTC(y,mo,d)/86400000+25569)*1e6)/1e6; }
function buildXLSXBlob(shifts, rate){
  const enc=new TextEncoder();
  const rows=shifts.filter(s=>s.end).sort((a,b)=>a.start-b.start);
  const n=rows.length, R0=5, TR=R0+n;
  const C=(ref,s,t,inner)=>'<c r="'+ref+'" s="'+s+'"'+(t?' t="'+t+'"':'')+'>'+inner+'</c>';
  const S=v=>'<is><t>'+xlsxEsc(v)+'</t></is>';
  const V=v=>'<v>'+v+'</v>';
  const M2=v=>'$'+v.toFixed(2);
  const MON=["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
  const fD=ts=>{const d=new Date(ts);return MON[d.getMonth()]+" "+d.getDate()+", "+d.getFullYear();};
  let sd='';
  sd+='<row r="1">'+C("A1",2,"inlineStr",S("Work Clock \u2014 Shift Export"))+'</row>';
  sd+='<row r="2">'+C("A2",1,"inlineStr",S("Generated "+fD(Date.now())+" \u00b7 "+n+" shift"+(n===1?"":"s")+" \u00b7 Current rate "+M2(rate)+"/hr"))+'</row>';
  sd+='<row r="3"></row>';
  sd+='<row r="4">'+["Date","Clock In","Clock Out","Hours","Tips","Earned"].map((h,i)=>C("ABCDEF"[i]+"4",2,"inlineStr",S(h))).join("")+'</row>';
  rows.forEach((s,i)=>{
    const r=R0+i, a=new Date(s.start), b=new Date(s.end);
    const dIn=xlsxDateSerial(a.getFullYear(),a.getMonth(),a.getDate());
    const dOut=xlsxDateSerial(b.getFullYear(),b.getMonth(),b.getDate());
    const tIn=Math.round((dIn+(a.getHours()*60+a.getMinutes())/1440)*1440)/1440;
    const tOut=Math.round((dOut+(b.getHours()*60+b.getMinutes())/1440)*1440)/1440;
    const h=Math.round(hrs(s)*100)/100;
    const tp=s.tip||0, e=Math.round(h*(s.rate!=null?s.rate:rate)*100)/100;
    sd+='<row r="'+r+'">'+C("A"+r,3,0,V(dIn))+C("B"+r,4,0,V(tIn))+C("C"+r,4,0,V(tOut))+C("D"+r,5,0,V(h))+C("E"+r,6,0,V(tp))+C("F"+r,6,0,V(e))+'</row>';
  });
  const fDsum=n>0?'<f>SUM(D'+R0+':D'+(R0+n-1)+')</f><v>0</v>':'<v>0</v>';
  const fEsum=n>0?'<f>SUM(E'+R0+':E'+(R0+n-1)+')</f><v>0</v>':'<v>0</v>';
  const fFsum=n>0?'<f>SUM(F'+R0+':F'+(R0+n-1)+')</f><v>0</v>':'<v>0</v>';
  sd+='<row r="'+TR+'">'+C("C"+TR,1,"inlineStr",S("Total:"))+'<c r="D'+TR+'" s="7">'+fDsum+'</c><c r="E'+TR+'" s="8">'+fEsum+'</c><c r="F'+TR+'" s="8">'+fFsum+'</c></row>';

  const sheet='<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
    +'<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">'
    +'<dimension ref="A1:F'+TR+'"/>'
    +'<sheetViews><sheetView workbookViewId="0"/></sheetViews>'
    +'<cols><col min="1" max="1" width="15" customWidth="1"/><col min="2" max="3" width="13" customWidth="1"/><col min="4" max="4" width="10" customWidth="1"/><col min="5" max="6" width="13" customWidth="1"/></cols>'
    +'<sheetData>'+sd+'</sheetData></worksheet>';

  const styles='<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
    +'<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">'
    +'<numFmts count="3"><numFmt numFmtId="164" formatCode="mmm d, yyyy"/><numFmt numFmtId="165" formatCode="h:mm AM/PM"/><numFmt numFmtId="166" formatCode="&quot;$&quot;#,##0.00"/></numFmts>'
    +'<fonts count="3"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font><font><b/><color rgb="FFFFFFFF"/><sz val="11"/><name val="Calibri"/></font></fonts>'
    +'<fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FF2F6FED"/><bgColor indexed="64"/></patternFill></fill></fills>'
    +'<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>'
    +'<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>'
    +'<cellXfs count="9">'
    +'<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>'
    +'<xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0"/>'
    +'<xf numFmtId="0" fontId="2" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1"/>'
    +'<xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>'
    +'<xf numFmtId="165" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>'
    +'<xf numFmtId="2" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>'
    +'<xf numFmtId="166" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>'
    +'<xf numFmtId="2" fontId="1" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>'
    +'<xf numFmtId="166" fontId="1" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>'
    +'</cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>';

  const ct='<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
    +'<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>';
  const rels='<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
    +'<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>';
  const wb='<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
    +'<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Shifts" sheetId="1" r:id="rId1"/></sheets></workbook>';
  const wbr='<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
    +'<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>';

  return xlsxZip([
    {name:"[Content_Types].xml", data:enc.encode(ct)},
    {name:"_rels/.rels", data:enc.encode(rels)},
    {name:"xl/workbook.xml", data:enc.encode(wb)},
    {name:"xl/_rels/workbook.xml.rels", data:enc.encode(wbr)},
    {name:"xl/styles.xml", data:enc.encode(styles)},
    {name:"xl/worksheets/sheet1.xml", data:enc.encode(sheet)}
  ]);
}
/* ===== /XLSX EXPORT ===== */

$("xlsxBtn").onclick=()=>{
  const blob=buildXLSXBlob(db.shifts, db.rate);
  const a=document.createElement("a");
  a.href=URL.createObjectURL(blob);
  a.download="workclock-"+dayKey(Date.now())+".xlsx";
  a.click();
  setTimeout(()=>URL.revokeObjectURL(a.href),4000);
};
$("csvBtn").onclick=()=>{
  let csv="Date,Clock In,Clock Out,Hours,Tips,Earned\n";
  db.shifts.filter(s=>s.end).sort((a,b)=>a.start-b.start).forEach(s=>{
    const h=hrs(s);
    csv+=[fmtDate(s.start),fmtTime(s.start),fmtTime(s.end),h.toFixed(2),tipOf(s).toFixed(2),pay(s).toFixed(2)].join(",")+"\n";
  });
  download("workclock.csv",csv,"text/csv");
};
$("jsonBtn").onclick=()=>download("workclock-backup.json",JSON.stringify({rate:db.rate, goal:db.goal, theme:db.theme, anaPeriod:db.anaPeriod, payday:db.payday, breakMin:db.breakMin, breakAfter:db.breakAfter, shifts:db.shifts, payments:db.payments||[]},null,2),"application/json");  // never includes sync URL/secret
$("importBtn").onclick=()=>$("importFile").click();
$("importFile").addEventListener("change",e=>{
  const f=e.target.files[0]; if(!f) return;
  if(f.size>5e6){ alert("That file is too large to be a Work Clock backup."); e.target.value=""; return; }
  const r=new FileReader();
  r.onload=()=>{ try{ const d=JSON.parse(r.result);
      if(!d || !Array.isArray(d.shifts)||typeof d.rate!=="number") throw 0;
      const clean=cleanCore(d), skipped=d.shifts.length-clean.shifts.length;
      if(confirm("Replace current data with this backup ("+clean.shifts.length+" shifts, "+clean.payments.length+" payments"+(skipped>0?", "+skipped+" invalid skipped":"")+")?")){
        // only shifts + display prefs come from a file; sync, secret and lock settings always stay as they are
        db=Object.assign(clean,{sync:db.sync, outbox:db.outbox, lastSync:db.lastSync, lock:db.lock}); save(); render(); }
    }catch(_){ alert("That file doesn't look like a Work Clock backup."); } };
  r.readAsText(f); e.target.value="";
});
$("wipeBtn").onclick=()=>{ if(confirm("Delete ALL shifts and payments and reset? This can't be undone.")){
  const keep={rate:db.rate, goal:db.goal, payday:db.payday, breakMin:db.breakMin, breakAfter:db.breakAfter, theme:db.theme, anaPeriod:db.anaPeriod, sync:db.sync, lock:db.lock};
  db=Object.assign({shifts:[], outbox:[]}, keep); save(); render(); updateSyncStatus(); }};

// google sheets sync settings
$("syncUrl").value=syncCfg().url||"";
$("syncSecret").value=syncCfg().secret||"";
updateSyncToggle(); updateSyncStatus();
function readSyncFields(){ const c=syncCfg(); c.url=$("syncUrl").value.trim(); c.secret=$("syncSecret").value; save(); }
$("syncUrl").addEventListener("change",()=>{ readSyncFields(); syncCfg().err=""; updateSyncStatus(); });
$("syncSecret").addEventListener("change",()=>{ readSyncFields(); syncCfg().err=""; updateSyncStatus(); });
$("syncForm").addEventListener("submit",e=>{ e.preventDefault(); readSyncFields(); const c=syncCfg();
  if(!/^https:\/\/script\.google\.com\/.+\/exec/.test(c.url)){ c.err="URL should look like https://script.google.com/macros/s/…/exec"; save(); updateSyncStatus(); return; }
  if(!c.secret || c.secret.length<16){ c.err="Use a secret of at least 16 characters (same as in your script)"; save(); updateSyncStatus(); return; }
  c.enabled=true; save(); updateSyncToggle();
  syncRun("Connecting", async()=>{ await syncCall({action:"ping"}); const n=await syncPull(true); await flushOutbox();
    return n ? "Connected · restored "+n+" shift"+(n===1?"":"s") : "Connected ✓"; }); });
$("syncToggle").onclick=()=>{ const c=syncCfg(); c.enabled=!c.enabled; save(); updateSyncToggle(); updateSyncStatus(); if(c.enabled) flushOutbox(); };
$("syncNowBtn").onclick=()=>syncRun("Syncing", async()=>{ await flushOutbox(); if(syncCfg().err) throw new Error(syncCfg().err); const n=await syncPull(); return n?"Restored "+n+" shift"+(n===1?"":"s"):"Up to date ✓"; });
$("syncUpBtn").onclick=()=>syncRun("Uploading", async()=>{ const n=await syncUploadAll(); return "Uploaded "+n+" shift"+(n===1?"":"s")+" ✓"; });
$("syncDownBtn").onclick=()=>syncRun("Restoring", async()=>{ const n=await syncPull(true); return n?"Restored "+n+" item"+(n===1?"":"s")+" ✓":"Restored from the sheet ✓"; });
// pull on open + whenever the app comes back to the foreground (iOS keeps PWAs alive)
async function autoSync(){ const c=syncCfg(); if(!c.enabled||!c.url||!navigator.onLine) return;
  try{ await flushOutbox(); if(!c.err) await syncPull(); }catch(e){ if(!e.offline){ c.err=e.message; save(); } } updateSyncStatus(); }
document.addEventListener("visibilitychange",()=>{ if(!document.hidden) autoSync(); });
// app updates without deleting the app
const APP_VERSION="2026.10.13.13";
$("appVer").textContent=APP_VERSION;
$("updateBtn").onclick=async()=>{ $("updateBtn").textContent="Updating…";
  try{ const regs=await navigator.serviceWorker.getRegistrations(); await Promise.all(regs.map(r=>r.unregister()));
       const ks=await caches.keys(); await Promise.all(ks.map(k=>caches.delete(k))); }catch(e){}
  location.reload(); };
window.addEventListener("online",autoSync);
autoSync();

// ---------- App lock (Face ID / device passcode via WebAuthn; the check happens on this device only) ----------
const b64u=buf=>btoa(String.fromCharCode.apply(null,new Uint8Array(buf))).replace(/\+/g,"-").replace(/\//g,"_").replace(/=+$/,"");
const unb64u=str=>Uint8Array.from(atob(str.replace(/-/g,"+").replace(/_/g,"/")+"=".repeat((4-str.length%4)%4)),c=>c.charCodeAt(0));
const LOCK_AFTER_MS=30000; let hiddenAt=0, unlocked=false;
function lockOn(){ return !!(db.lock && db.lock.cred); }
function showLock(){ $("lockMsg").textContent="Locked"; $("lockScreen").hidden=false; unlocked=false; }
function hideLock(){ $("lockScreen").hidden=true; unlocked=true; }
async function lockCheck(credId){
  const r=await navigator.credentials.get({publicKey:{challenge:crypto.getRandomValues(new Uint8Array(32)), rpId:location.hostname,
    allowCredentials:[{type:"public-key", id:unb64u(credId), transports:["internal","hybrid"]}], userVerification:"required", timeout:60000}});
  return !!r;
}
async function unlock(){ try{ if(await lockCheck(db.lock.cred)) hideLock(); }catch(e){ $("lockMsg").textContent="Couldn't verify. Tap Unlock to try again."; } }
async function enableLock(){
  if(!window.PublicKeyCredential || !navigator.credentials) throw new Error("App lock isn't supported in this browser");
  if(!(await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable())) throw new Error("Set up Face ID or a device passcode first");
  const cred=await navigator.credentials.create({publicKey:{challenge:crypto.getRandomValues(new Uint8Array(32)),
    rp:{name:"Work Clock", id:location.hostname}, user:{id:crypto.getRandomValues(new Uint8Array(16)), name:"work-clock", displayName:"Work Clock"},
    pubKeyCredParams:[{type:"public-key",alg:-7},{type:"public-key",alg:-257}],
    authenticatorSelection:{authenticatorAttachment:"platform", userVerification:"required", residentKey:"discouraged"}, attestation:"none", timeout:60000}});
  const id=b64u(cred.rawId);
  if(!(await lockCheck(id))) throw new Error("Verification failed");   // prove it works BEFORE turning it on, so you can't lock yourself out
  db.lock={cred:id}; save();
}
function updateLockUi(){ $("lockToggle").textContent=lockOn()?"On":"Off";
  const st=$("lockStatus"); if(!st.classList.contains("err")) st.textContent=lockOn()?"Locks after 30 s away from the app":"Off"; }
$("lockToggle").onclick=async()=>{ const st=$("lockStatus"); st.classList.remove("err");
  try{ if(lockOn()){ if(await lockCheck(db.lock.cred)){ delete db.lock; save(); } } else { await enableLock(); } }
  catch(e){ st.classList.add("err"); st.textContent = e && e.name==="NotAllowedError" ? "Cancelled" : ((e && e.message) || "Couldn't change app lock"); }
  updateLockUi(); };
$("unlockBtn").onclick=unlock;
function coverOnHide(){ if(!lockOn()) return; if(!hiddenAt || unlocked) hiddenAt=Date.now(); $("lockScreen").hidden=false; }   // also hides content in the app switcher
document.addEventListener("visibilitychange",()=>{
  if(document.hidden) coverOnHide();
  else if(lockOn()){ if(unlocked && Date.now()-hiddenAt<LOCK_AFTER_MS) $("lockScreen").hidden=true; else unlocked=false; hiddenAt=0; }
});
window.addEventListener("pagehide",coverOnHide);
updateLockUi(); if(lockOn()) showLock();

// ---------- Liquid glass motion: a spring-driven glass lens that stretches like a water droplet ----------
const REDUCED = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
function liquid(box, itemSel, pressScale){
  const thumb=document.createElement("span"), echo=document.createElement("span");
  thumb.className="glass-thumb"; echo.className="glass-thumb echo";
  box.prepend(thumb); box.prepend(echo); box.classList.add("liquid");
  const items=()=>Array.from(box.querySelectorAll(itemSel));
  const active=()=>box.querySelector(itemSel+".on")||items()[0];
  const S={x:0,w:0,vx:0,vw:0,sc:1,vs:0,ex:0,evx:0}, T={x:0,w:0,sc:1};
  let raf=0, last=0, drag=null, ready=false;
  function geom(it){ return {x:it.offsetLeft, w:it.offsetWidth, h:it.offsetHeight, top:it.offsetTop, r:getComputedStyle(it).borderRadius}; }
  function aim(g, snap){
    if(!g.w) return;
    T.x=g.x; T.w=g.w;
    [thumb,echo].forEach(el=>{ el.style.height=g.h+"px"; el.style.top=g.top+"px"; el.style.borderRadius=g.r; });
    if(snap||REDUCED||!ready){ S.x=S.ex=g.x; S.w=g.w; S.vx=S.evx=S.vw=S.vs=0; S.sc=T.sc=1; paint(); } else kick();
  }
  function paint(){
    const stretch=Math.min(Math.abs(S.vx)/2400,.34);                 // faster travel => longer, thinner drop
    const sx=(1+stretch)*S.sc, sy=(1-stretch*.5)*S.sc;
    thumb.style.width=S.w+"px"; thumb.style.opacity=ready?1:0;
    thumb.style.transform="translate3d("+S.x+"px,0,0) scale("+sx+","+sy+")";
    const lag=Math.abs(S.ex-S.x);
    echo.style.width=S.w+"px"; echo.style.opacity=ready?Math.min(lag/14,1)*.6:0;   // trailing smear fades in while moving
    echo.style.transform="translate3d("+S.ex+"px,0,0) scale("+(1+Math.min(lag/60,.25))+",.94)";
  }
  function step(dt){
    const sp=(p,v,t,k,c)=>{ v+=(-k*(p-t)-c*v)*dt; return [p+v*dt,v]; };
    [S.x,S.vx]=sp(S.x,S.vx,T.x,drag?900:380,drag?44:24);             // underdamped: overshoots, then settles
    [S.w,S.vw]=sp(S.w,S.vw,T.w,420,28);
    [S.sc,S.vs]=sp(S.sc,S.vs,T.sc,520,26);                           // press "magnify" bulge
    [S.ex,S.evx]=sp(S.ex,S.evx,S.x,140,15);                          // lazy follower = droplet trail
  }
  function tick(t){
    const dt=Math.min((t-last)/1000,.05); last=t;
    const n=Math.max(1,Math.ceil(dt/.008)); for(let i=0;i<n;i++) step(dt/n);
    paint();
    const rest=Math.abs(S.x-T.x)<.15&&Math.abs(S.vx)<2&&Math.abs(S.w-T.w)<.15&&Math.abs(S.sc-T.sc)<.002&&Math.abs(S.vs)<.02&&Math.abs(S.ex-S.x)<.15&&Math.abs(S.evx)<2;
    if(rest){ S.x=S.ex=T.x; S.w=T.w; S.sc=T.sc; S.vx=S.vw=S.vs=S.evx=0; paint(); raf=0; } else raf=requestAnimationFrame(tick);
  }
  function kick(){ if(!raf){ last=performance.now(); raf=requestAnimationFrame(tick); } }
  new MutationObserver(()=>{ if(!drag) aim(geom(active())); }).observe(box,{subtree:true,attributes:true,attributeFilter:["class"]});
  new ResizeObserver(()=>{ const a=active(); if(a){ aim(geom(a),true); ready=true; paint(); } }).observe(box);
  // press and drag the lens across the options, like iOS
  box.addEventListener("pointerdown",e=>{
    if(e.button>0) return; const it=e.target.closest(itemSel); if(!it||!box.contains(it)||it.disabled) return;
    drag={id:e.pointerId, hover:it, x0:e.clientX, moved:false};
    try{ box.setPointerCapture(e.pointerId); }catch(_){}
    T.sc=pressScale; aim(geom(it)); kick();
  });
  box.addEventListener("pointermove",e=>{
    if(!drag||e.pointerId!==drag.id) return;
    if(!drag.moved && Math.abs(e.clientX-drag.x0)>4) drag.moved=true;
    if(!drag.moved) return;
    const r=box.getBoundingClientRect(), w=T.w;
    T.x=Math.max(0,Math.min(r.width-w, e.clientX-r.left-w/2));
    let best=null, bd=1e9; items().forEach(i=>{ const d=Math.abs(i.offsetLeft+i.offsetWidth/2-(T.x+w/2)); if(d<bd){bd=d;best=i;} });
    if(best!==drag.hover){ drag.hover=best; T.w=best.offsetWidth; items().forEach(i=>i.classList.toggle("hot",i===best)); }
    kick();
  });
  const end=e=>{
    if(!drag||e.pointerId!==drag.id) return;
    const it=drag.hover; drag=null; T.sc=1; items().forEach(i=>i.classList.remove("hot"));
    try{ box.releasePointerCapture(e.pointerId); }catch(_){}
    if(e.type==="pointerup" && it && it!==active()) it.click(); else aim(geom(active()));
    kick();
  };
  box.addEventListener("pointerup",end); box.addEventListener("pointercancel",end);
}
liquid(document.querySelector(".tabbar"), "button", 1.14);
document.querySelectorAll(".seg").forEach(b=>liquid(b, "button", 1.08));

// water-ripple under the finger on buttons and tiles
document.addEventListener("pointerdown",e=>{
  if(REDUCED) return;
  const t=e.target.closest && e.target.closest(".big-btn,.btn,.icon-btn,.stat,.ana-tile"); if(!t||t.disabled) return;
  const r=t.getBoundingClientRect(), d=Math.max(r.width,r.height)*1.7, s=document.createElement("span");
  s.className="ripple"; s.style.cssText="width:"+d+"px;height:"+d+"px;left:"+(e.clientX-r.left-d/2)+"px;top:"+(e.clientY-r.top-d/2)+"px";
  t.appendChild(s); s.addEventListener("animationend",()=>s.remove());
},{passive:true});

// bottom sheet: drag the handle down to dismiss; it rubber-bands and springs back if you don't go far enough
function sheetDrag(bg, closeFn){
  const sheet=bg.querySelector(".modal"), grab=document.createElement("div");
  grab.className="grab"; sheet.prepend(grab);
  let y0=0,t0=0,dy=0,id=null;
  const clear=()=>{ sheet.style.transition=""; sheet.style.transform=""; bg.style.transition=""; bg.style.opacity=""; };
  grab.addEventListener("pointerdown",e=>{ id=e.pointerId; y0=e.clientY; t0=e.timeStamp; dy=0; sheet.style.transition="none"; bg.style.transition="none";
    try{ grab.setPointerCapture(id); }catch(_){} });
  grab.addEventListener("pointermove",e=>{ if(e.pointerId!==id) return; dy=e.clientY-y0;
    sheet.style.transform="translateY("+(dy>0?dy:dy*.15)+"px)"; bg.style.opacity=String(Math.max(.2,1-Math.max(0,dy)/420)); });
  const up=e=>{ if(e.pointerId!==id) return; id=null; const v=dy/Math.max(1,e.timeStamp-t0);
    if(dy>110||v>.8){ sheet.style.transition="transform .3s cubic-bezier(.4,0,1,1)"; sheet.style.transform="translateY(115%)";
      setTimeout(()=>{ closeFn(); clear(); },260); }
    else { sheet.style.transition="transform .6s cubic-bezier(.34,1.56,.64,1)"; sheet.style.transform=""; bg.style.transition="opacity .3s"; bg.style.opacity="";
      setTimeout(clear,650); } };
  grab.addEventListener("pointerup",up); grab.addEventListener("pointercancel",up);
}
sheetDrag($("modalBg"), closeModal);
sheetDrag($("tipBg"), closeTip);
sheetDrag($("payBg"), closePay);

window.addEventListener("resize",()=>{ drawChart(); if(document.getElementById("tab-analytics").classList.contains("on")) renderAnalytics(); });

// ---------- Pay: what the owner has actually paid you vs what you've earned ----------
const pays=()=>db.payments||(db.payments=[]);
function renderPay(){
  const done=db.shifts.filter(s=>s.end), P=pays();
  const earned=done.reduce((a,s)=>a+pay(s),0), recv=P.reduce((a,p)=>a+p.amount,0), owed=Math.round((earned-recv)*100)/100;
  $("payEarned").textContent=money(earned); $("payRecv").textContent=money(recv);
  const big=$("payOwed"); big.textContent=money(Math.abs(owed)); big.className="pay-big "+(owed>0.004?"owe":"ok");
  $("payOwedSub").textContent = !done.length && !P.length ? "Log what you're paid and it shows here." :
    owed>0.004 ? "Still owed to you" : owed<-0.004 ? "Paid ahead of what you've worked" : "All paid up \u2713";
  $("payBar").style.width=(earned>0?Math.min(100,recv/earned*100):(recv>0?100:0))+"%";
  // this month
  const mk=monthKey(Date.now()); let me=0, mr=0;
  done.forEach(s=>{ if(monthKey(s.start)===mk) me+=pay(s); }); P.forEach(p=>{ if(monthKey(p.ts)===mk) mr+=p.amount; });
  $("payMonthLabel").textContent=monthLabel(mk);
  $("payMEarn").textContent=money(me); $("payMRecv").textContent=money(mr);
  const sh=me-mr; $("payMBal").textContent=money(Math.max(0,sh)); $("payMBal").parentNode.firstChild.textContent = sh<-0.004?"Ahead by":"Short by";
  if(sh<-0.004) $("payMBal").textContent=money(-sh);
  $("payMBal").className="val "+(sh>0.004?"bad":"good");
  // month by month, with a running balance (late payments for last month's work are handled naturally)
  const M={}; const slot=k=>M[k]||(M[k]={e:0,r:0});
  done.forEach(s=>{ slot(monthKey(s.start)).e+=pay(s); }); P.forEach(p=>{ slot(monthKey(p.ts)).r+=p.amount; });
  const keys=Object.keys(M).sort(); let run=0; const rows=keys.map(k=>{ run+=M[k].e-M[k].r; return {k, e:M[k].e, r:M[k].r, bal:Math.round(run*100)/100}; }).reverse();
  const box=$("payMonths"); box.textContent="";
  if(!rows.length){ const d=document.createElement("div"); d.className="empty"; d.textContent="Nothing yet."; box.appendChild(d); }
  rows.forEach(x=>{
    const r=document.createElement("div"), a=document.createElement("div"), b=document.createElement("div"), t=document.createElement("b"), s=document.createElement("small"), c=document.createElement("span");
    r.className="prow"; t.textContent=monthLabel(x.k); s.textContent="earned "+money(x.e)+" \u00b7 received "+money(x.r);
    a.appendChild(t); a.appendChild(document.createElement("br")); a.appendChild(s);
    c.className="chip2 "+(x.bal>0.004?"bad":"good"); c.textContent = x.bal>0.004 ? "Total owed "+money(x.bal) : x.bal<-0.004 ? "Ahead "+money(-x.bal) : "Paid \u2713";
    b.appendChild(c); r.appendChild(a); r.appendChild(b); box.appendChild(r); });
  // payments list
  const lb=$("payList"); lb.textContent="";
  const sorted=P.slice().sort((a,b)=>b.ts-a.ts);
  if(!sorted.length){ const d=document.createElement("div"); d.className="empty"; d.textContent="No payments logged yet."; lb.appendChild(d); }
  sorted.forEach(p=>{
    const r=document.createElement("div"), a=document.createElement("div"), b=document.createElement("div"), m=document.createElement("b"), n=document.createElement("small"), e=document.createElement("button"), d=document.createElement("button");
    r.className="prow"; m.textContent=money(p.amount); n.textContent=fmtDate(p.ts)+(p.note?" \u00b7 "+p.note:"");
    a.appendChild(m); a.appendChild(document.createElement("br")); a.appendChild(n);
    e.className="icon-btn"; e.textContent="Edit"; e.onclick=()=>openPay(p); d.className="icon-btn danger"; d.textContent="Delete";
    d.onclick=()=>{ db.payments=pays().filter(x=>x.id!==p.id); save(); render(); queueSync({action:"pdelete", id:p.id});
      showUndo("Payment deleted.", ()=>{ pays().push(p); save(); render(); queueSync({action:"pupsert", payment:payPayload(p)}); }); };
    b.appendChild(e); b.appendChild(d); r.appendChild(a); r.appendChild(b); lb.appendChild(r); });
  renderPayExtras(done, P, recv);
}
function renderPayExtras(done, P, recv){
  // next payday: what you're owed now, plus a projection at your recent pace (last 28 days)
  const nx=$("payNext"); nx.style.display="none";
  if(db.payday){
    const now=new Date(), nd=new Date(now.getFullYear(), now.getMonth(), db.payday); if(nd.getTime()<=now.getTime()) nd.setMonth(nd.getMonth()+1);
    const owedNow=Math.max(0, done.reduce((a,s)=>a+pay(s),0)-recv), since=Date.now()-28*86400000;
    const pace=done.filter(s=>s.start>=since).reduce((a,s)=>a+pay(s),0)/28, days=Math.max(0,Math.ceil((nd.getTime()-Date.now())/86400000));
    const proj=owedNow+pace*days;
    if(owedNow>0.004 || pace>0){
      $("payNextTxt").textContent=fmtDate(nd.getTime())+" ("+days+" day"+(days===1?"":"s")+"): "+money(owedNow)+" owed so far"+(pace>0?", about "+money(proj)+" by then at your recent pace.":".");
      nx.style.display="block"; }
  }
  // overdue: wages for work done before the most recent payday, minus everything received so far
  const due=$("payDue"); due.style.display="none";
  if(db.payday){
    const now=new Date(), pd=new Date(now.getFullYear(), now.getMonth(), db.payday);
    if(pd.getTime()>now.getTime()) pd.setMonth(pd.getMonth()-1);
    const cut=pd.getTime(), wages=done.filter(s=>s.start<cut).reduce((a,s)=>a+pay(s),0), over=Math.round((wages-recv)*100)/100;
    if(over>0.004){ const days=Math.floor((Date.now()-cut)/86400000);
      $("payDueTxt").textContent=money(over)+" was due on "+fmtDate(cut)+(days>0?" ("+days+" day"+(days===1?"":"s")+" ago).":" (today)."); due.style.display="block"; }
  }
}
let payEditing=null;
function openPay(p){
  payEditing=p?p.id:null; $("payTitle").textContent=p?"Edit payment":"Log payment";
  $("payAmt").value=p?p.amount:""; $("payDate").value=dayKey(p?p.ts:Date.now()); $("payNote").value=p?p.note:"";
  $("payBg").classList.add("open");
}
function closePay(){ $("payBg").classList.remove("open"); payEditing=null; }
$("payAdd").onclick=()=>openPay(null);
$("payCancel").onclick=closePay;
$("payBg").addEventListener("click",e=>{ if(e.target===$("payBg")) closePay(); });
$("payFill").onclick=()=>{ const earned=db.shifts.filter(s=>s.end).reduce((a,s)=>a+pay(s),0), recv=pays().reduce((a,p)=>a+p.amount,0), o=Math.round((earned-recv)*100)/100; if(o>0) $("payAmt").value=o; };
$("paySave").onclick=()=>{
  const amt=Math.round(parseFloat($("payAmt").value)*100)/100, dv=$("payDate").value;
  if(!Number.isFinite(amt)||amt<=0||amt>10000000){ alert("Enter the amount you received."); return; }
  if(!dv){ alert("Pick the date you were paid."); return; }
  const ts=new Date(dv+"T12:00:00").getTime(), note=$("payNote").value;
  const c=cleanPayment({id:payEditing||uid(), ts, amount:amt, note}); if(!c){ alert("That payment doesn't look right."); return; }
  if(payEditing){ const i=pays().findIndex(x=>x.id===payEditing); if(i>=0) db.payments[i]=c; else pays().push(c); } else pays().push(c);
  save(); closePay(); render(); queueSync({action:"pupsert", payment:payPayload(c)});
};

// ---------- Pay statement (for the owner): shifts, wages, tips, payments and the balance ----------
function buildStatement(fromTs, toTs){
  const done=db.shifts.filter(s=>s.end).sort((a,b)=>a.start-b.start);
  const inR=done.filter(s=>s.start>=fromTs && s.start<=toTs);
  const hours=inR.reduce((a,s)=>a+hrs(s),0), wages=inR.reduce((a,s)=>a+pay(s),0);
  const earnedTo=done.filter(s=>s.start<=toTs).reduce((a,s)=>a+pay(s),0);
  const paidTo=pays().filter(p=>p.ts<=toTs).reduce((a,p)=>a+p.amount,0);
  const payIn=pays().filter(p=>p.ts>=fromTs && p.ts<=toTs).sort((a,b)=>a.ts-b.ts);
  return {inR, hours, wages, earnedTo, paidTo, owed:Math.round((earnedTo-paidTo)*100)/100, payIn, fromTs, toTs};
}
function statementText(S){
  const L=["Pay statement "+fmtDate(S.fromTs)+" to "+fmtDate(S.toTs), ""];
  S.inR.forEach(s=>L.push(fmtDate(s.start)+"  "+fmtTime(s.start)+" - "+fmtTime(s.end)+"  "+hrs(s).toFixed(2)+"h @ "+money(rateOf(s))+"  "+money(pay(s))));
  L.push("", "Hours: "+S.hours.toFixed(2), "Wages: "+money(S.wages));
  if(S.payIn.length){ L.push("", "Payments received:"); S.payIn.forEach(p=>L.push(fmtDate(p.ts)+"  "+money(p.amount)+(p.note?"  "+p.note:""))); }
  L.push("", "Wages earned through "+fmtDate(S.toTs)+": "+money(S.earnedTo), "Paid through "+fmtDate(S.toTs)+": "+money(S.paidTo), S.owed>0.004?"Balance owed: "+money(S.owed):S.owed<-0.004?"Paid ahead: "+money(-S.owed):"Balance: paid in full");
  return L.join("\n");
}
let stmtText="";
function showStatement(S){
  stmtText=statementText(S);
  const pg=$("stmtPage"); pg.textContent="";
  const el=(tag,txt,cls)=>{ const e=document.createElement(tag); if(txt!=null) e.textContent=txt; if(cls) e.className=cls; return e; };
  pg.appendChild(el("h1","Pay statement"));
  pg.appendChild(el("div",fmtDate(S.fromTs)+" \u2013 "+fmtDate(S.toTs)+"","muted"));
  const tb=el("table"), hd=el("tr"); ["Date","In","Out","Hours","Rate","Wages"].forEach(h=>hd.appendChild(el("th",h))); tb.appendChild(hd);
  S.inR.forEach(s=>{ const r=el("tr"); [fmtDate(s.start),fmtTime(s.start),fmtTime(s.end),hrs(s).toFixed(2),money(rateOf(s))+"/hr",money(pay(s))].forEach(v=>r.appendChild(el("td",v))); tb.appendChild(r); });
  if(!S.inR.length){ const r=el("tr"), c=el("td","No shifts in this period"); c.colSpan=6; r.appendChild(c); tb.appendChild(r); }
  pg.appendChild(tb);
  const sum=(l,v,b)=>{ const r=el("div",null,"srow"+(b?" b":"")); r.appendChild(el("span",l)); r.appendChild(el("span",v)); pg.appendChild(r); };
  sum("Hours",S.hours.toFixed(2)); sum("Wages",money(S.wages));
  if(S.payIn.length){ pg.appendChild(el("h2","Payments received")); S.payIn.forEach(p=>sum(fmtDate(p.ts)+(p.note?" \u00b7 "+p.note:""),money(p.amount))); }
  pg.appendChild(el("h2","Balance as of "+fmtDate(S.toTs)));
  sum("Wages earned (all shifts through this date)",money(S.earnedTo)); sum("Paid (all payments through this date)",money(S.paidTo));
  sum(S.owed>0.004?"Balance owed":S.owed<-0.004?"Paid ahead":"Balance", S.owed>0.004?money(S.owed):S.owed<-0.004?money(-S.owed):"Paid in full \u2713", true);
  $("stmt").hidden=false; document.body.classList.add("stmt-open");
}
function closeStmt(){ $("stmt").hidden=true; document.body.classList.remove("stmt-open"); }
$("stmtBtn").onclick=()=>{ $("stmtPd").style.display=db.payday?"":"none"; const n=new Date(); $("stmtFrom").value=dayKey(new Date(n.getFullYear(),n.getMonth(),1).getTime()); $("stmtTo").value=dayKey(Date.now()); $("stmtBg").classList.add("open"); };
$("stmtQuick").addEventListener("click",e=>{ const b=e.target.closest("button"); if(!b) return;
  const n=new Date(), y=n.getFullYear(), m=n.getMonth(), K=d=>dayKey(d.getTime()); let a,z=new Date(n);
  if(b.dataset.q==="month") a=new Date(y,m,1);
  else if(b.dataset.q==="last"){ a=new Date(y,m-1,1); z=new Date(y,m,0); }
  else if(b.dataset.q==="payday"){ const pd=new Date(y,m,db.payday||1); if(pd.getTime()>n.getTime()) pd.setMonth(pd.getMonth()-1); a=pd; }
  else { const f=db.shifts.reduce((mn,s)=>Math.min(mn,s.start),Date.now()); a=new Date(f); }
  $("stmtFrom").value=K(a); $("stmtTo").value=K(z); });
$("stmtCancel").onclick=()=>$("stmtBg").classList.remove("open");
$("stmtBg").addEventListener("click",e=>{ if(e.target===$("stmtBg")) $("stmtBg").classList.remove("open"); });
$("stmtGo").onclick=()=>{
  const f=$("stmtFrom").value, t=$("stmtTo").value; if(!f||!t){ alert("Pick both dates."); return; }
  const a=new Date(f+"T00:00:00").getTime(), b=new Date(t+"T23:59:59").getTime(); if(!(b>=a)){ alert("The end date is before the start date."); return; }
  $("stmtBg").classList.remove("open"); showStatement(buildStatement(a,b));
};
$("stmtClose").onclick=closeStmt;
$("stmtPrint").onclick=()=>window.print();
$("stmtCopy").onclick=async()=>{ try{ await navigator.clipboard.writeText(stmtText); $("stmtCopy").textContent="Copied \u2713"; setTimeout(()=>$("stmtCopy").textContent="Copy text",1500); }catch(_){ alert("Couldn't copy. Use Print / PDF instead."); } };
sheetDrag($("stmtBg"), ()=>$("stmtBg").classList.remove("open"));

// tab bar
document.querySelectorAll(".tabbar button").forEach(b=>b.onclick=()=>{
  document.querySelectorAll(".tabbar button").forEach(x=>x.classList.toggle("on",x===b));
  const t=b.dataset.tab;
  document.querySelectorAll(".tabpane").forEach(p=>p.classList.toggle("on",p.id==="tab-"+t));
  window.scrollTo(0,0);
  if(t==="analytics"){ renderAnalytics(); drawChart(); }
  if(t==="pay") renderPay();
});
render();
})();
/* Register the service worker so the app works fully offline once installed. */
if ("serviceWorker" in navigator) {
  var hadController = !!navigator.serviceWorker.controller, reloaded = false;
  window.addEventListener("load", function(){
    navigator.serviceWorker.register("./sw.js").then(function(reg){
      document.addEventListener("visibilitychange", function(){ if(!document.hidden) reg.update().catch(function(){}); });
    });
  });
  // a new version took over: reload once (never while the Add shift sheet is open)
  navigator.serviceWorker.addEventListener("controllerchange", function(){
    if(!hadController || reloaded) return; reloaded = true;
    var m = document.getElementById("modalBg");
    if(!(m && m.classList.contains("open"))) location.reload();
  });
}
