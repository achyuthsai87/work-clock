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
const PLACE_RE = /^(-?\d{1,2}(?:\.\d{1,6})?),(-?\d{1,3}(?:\.\d{1,6})?),(\d{1,5})$/;
function placeOk(v){ const m = PLACE_RE.exec(String(v)); return !!m && Math.abs(+m[1]) <= 90 && Math.abs(+m[2]) <= 180; }
function cleanShift(s){
  if(!s || typeof s !== "object") return null;
  const id = String(s.id == null ? "" : s.id), start = Number(s.start), end = s.end == null ? null : Number(s.end);
  if(!ID_RE.test(id) || !Number.isFinite(start) || start < MIN_TS || start > MAX_TS) return null;
  if(end !== null && (!Number.isFinite(end) || end < start || end - start > MAX_SHIFT_MS)) return null;
  const o = {id, start, end}, tp = Math.round(Number(s.tip != null ? s.tip : s.tips) * 100) / 100;
  if(Number.isFinite(tp) && tp > 0 && tp <= 100000) o.tip = tp;
  const sr = s.rate == null || s.rate === "" ? NaN : Number(s.rate); if(Number.isFinite(sr) && sr >= 0 && sr <= 100000) o.rate = sr;
  const bk = s.brk == null || s.brk === "" ? NaN : Math.round(Number(s.brk)); if(Number.isFinite(bk) && bk >= 0 && bk <= 720){ o.brk = bk; if(s.bp === 1 || s.bp === true || s.brkPaid === 1 || s.brkPaid === true) o.bp = 1; }
  const nt = cleanText(s.note, 80); if(nt) o.note = nt;
  if(s.job != null && ID_RE.test(String(s.job))) o.job = String(s.job);
  for(const k of ["pin","pout"]) if(typeof s[k] === "string" && placeOk(s[k]) && (k === "pin" || end !== null)) o[k] = s[k];
  const ae = Number(s.autoEnd); if(end === null && Number.isFinite(ae) && ae > start && ae - start <= MAX_SHIFT_MS) o.autoEnd = ae;
  return o;
}
// Free text (notes): no control characters or angle brackets, and nothing a spreadsheet could read as a formula.
function cleanText(v, max){ return String(v == null ? "" : v).replace(/[\u0000-\u001f\u007f<>]/g, "").replace(/^[\s=+\-@]+/, "").trim().slice(0, max); }
function cleanPayment(p){
  if(!p || typeof p !== "object") return null;
  const id = String(p.id == null ? "" : p.id), ts = Number(p.ts), amt = Math.round(Number(p.amount) * 100) / 100;
  if(!ID_RE.test(id) || !Number.isFinite(ts) || ts < MIN_TS || ts > MAX_TS || !Number.isFinite(amt) || amt <= 0 || amt > 10000000) return null;
  const out = {id, ts, amount: amt, note: cleanText(p.note, 60)}; const g = Math.round(Number(p.gross) * 100) / 100; if(p.gross != null && p.gross !== "" && Number.isFinite(g) && g >= amt && g <= 10000000) out.gross = g;
  if(p.job != null && p.job !== "" && ID_RE.test(String(p.job))) out.job = String(p.job);
  return out;
}
const HM_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
const DAY_RE = /^20\d\d-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;
function cleanJob(j){
  if(!j || typeof j !== "object" || !ID_RE.test(String(j.id))) return null;
  const name = cleanText(j.name, 24), rate = Number(j.rate);
  if(!name || !Number.isFinite(rate) || rate < 0 || rate > 100000) return null;
  const out={id: String(j.id), name, rate}; if(typeof j.left==="string" && DAY_RE.test(j.left)) out.left=j.left; return out;
}
function cleanExpense(x){
  if(!x || typeof x !== "object" || !ID_RE.test(String(x.id))) return null;
  const ts = Number(x.ts), amt = Math.round(Number(x.amount) * 100) / 100;
  if(!Number.isFinite(ts) || ts < MIN_TS || ts > MAX_TS || !Number.isFinite(amt) || amt < 0 || amt > 10000000) return null;
  const o = {id: String(x.id), ts, amount: amt, note: cleanText(x.note, 60)};
  const mi = Math.round(Number(x.miles) * 10) / 10; if(Number.isFinite(mi) && mi > 0 && mi <= 100000){ o.kind = "mileage"; o.miles = mi; } else o.kind = "expense";
  if(o.kind === "expense" && amt <= 0) return null;
  return o;
}
function cleanPlan(p){   // today's/auto schedule: start+end as HH:MM, optional repeat weekdays (0=Sun) or a single date
  if(!p || typeof p !== "object" || !HM_RE.test(String(p.start)) || !HM_RE.test(String(p.end)) || p.start === p.end) return null;
  const o = {id: (p.id != null && ID_RE.test(String(p.id))) ? String(p.id) : ("p" + Date.now().toString(36) + Math.random().toString(36).slice(2,5)), start: String(p.start), end: String(p.end)};
  if(p.job != null && ID_RE.test(String(p.job))) o.job = String(p.job);
  if(typeof p.since === "string" && DAY_RE.test(p.since)) o.since = p.since;
  const days = Array.isArray(p.days) ? Array.from(new Set(p.days.map(Number).filter(n => Number.isInteger(n) && n >= 0 && n <= 6))).sort() : [];
  if(days.length) o.days = days; else if(DAY_RE.test(String(p.once))) o.once = String(p.once); else return null;
  return o;
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
  const tp = Number(d.taxPct); if(Number.isFinite(tp) && tp > 0 && tp <= 60) out.taxPct = Math.round(tp * 10) / 10;
  const mr = Number(d.mileRate); if(Number.isFinite(mr) && mr > 0 && mr <= 10) out.mileRate = Math.round(mr * 1000) / 1000;
  const wp = Number(d.wkndPct); if(Number.isFinite(wp) && wp > 0 && wp <= 300) out.wkndPct = Math.round(wp * 10) / 10;
  const ow = Number(d.otWeek); if(Number.isFinite(ow) && ow > 0 && ow <= 168) out.otWeek = Math.round(ow * 10) / 10;
  const od = Number(d.otDay); if(Number.isFinite(od) && od > 0 && od <= 24) out.otDay = Math.round(od * 10) / 10;
  const op = Number(d.otPct); if(Number.isFinite(op) && op > 0 && op <= 300) out.otPct = Math.round(op * 10) / 10;
  const hp = Number(d.holPct); if(Number.isFinite(hp) && hp > 0 && hp <= 300) out.holPct = Math.round(hp * 10) / 10;
  if(d.holidays && typeof d.holidays === "object"){ out.holidays = {}; Object.keys(d.holidays).filter(k => DAY_RE.test(k)).sort().slice(-400).forEach(k => { out.holidays[k] = 1; }); if(!Object.keys(out.holidays).length) delete out.holidays; }
  if(d.netTrack) out.netTrack = 1;
  if(["weekly","biweekly","monthly"].includes(d.payCycle)) out.payCycle = d.payCycle;
  if(typeof d.payAnchor === "string" && DAY_RE.test(d.payAnchor)) out.payAnchor = d.payAnchor;
  const jn = cleanText(d.jobName, 24); if(jn) out.jobName = jn;
  const jb = new Set(); out.jobs = [];
  (Array.isArray(d.jobs) ? d.jobs : []).slice(0, 8).forEach(x => { const c = cleanJob(x); if(c && !jb.has(c.id)){ jb.add(c.id); out.jobs.push(c); } });
  if(!out.jobs.length) delete out.jobs;
  if(typeof d.activeJob === "string" && jb.has(d.activeJob)) out.activeJob = d.activeJob;
  out.plans = []; const pids = new Set();
  (Array.isArray(d.plans) ? d.plans : (d.plan ? [Object.assign({id: "plan1"}, d.plan)] : [])).slice(0, 40).forEach(x => { const c = cleanPlan(x); if(c && !pids.has(c.id)){ pids.add(c.id); out.plans.push(c); } });
  if(!out.plans.length) delete out.plans;
  if(d.daysOff && typeof d.daysOff === "object"){ out.daysOff = {}; Object.keys(d.daysOff).filter(k => DAY_RE.test(k)).sort().slice(-800).forEach(k => { out.daysOff[k] = 1; }); if(!Object.keys(out.daysOff).length) delete out.daysOff; }
  const ex = new Set(); out.expenses = [];
  (Array.isArray(d.expenses) ? d.expenses : []).slice(0, 5000).forEach(x => { const c = cleanExpense(x); if(c && !ex.has(c.id)){ ex.add(c.id); out.expenses.push(c); } });
  if(!out.expenses.length) delete out.expenses;
  const seen = new Set();
  (Array.isArray(d.shifts) ? d.shifts : []).slice(0, 50000).forEach(x => { const c = cleanShift(x); if(c && !seen.has(c.id)){ seen.add(c.id); out.shifts.push(c); } });
  const ps = new Set(); out.payments = [];
  (Array.isArray(d.payments) ? d.payments : []).slice(0, 20000).forEach(x => { const c = cleanPayment(x); if(c && !ps.has(c.id)){ ps.add(c.id); out.payments.push(c); } });
  return out;
}
function cleanEvent(e, rate){
  if(!e || typeof e !== "object") return null;
  if(e.action === "delete" && ID_RE.test(String(e.id))) return {action:"delete", id:String(e.id)};
  if(e.action === "meta") return {action:"meta"};
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
    out.sync = {url: good ? u : "", secret: typeof d.sync.secret === "string" ? d.sync.secret.slice(0,200) : "", enabled: good && !!d.sync.enabled, err: "", name: cleanText(d.sync.name, 40).replace(/\s+/g, " "), mirrors: []};
    const seenN = new Set([out.sync.name.toLowerCase()]), seenU = new Set([u]);
    (good && Array.isArray(d.sync.mirrors) ? d.sync.mirrors : []).slice(0, 4).forEach(m => {
      if(!m || typeof m !== "object" || !ID_RE.test(String(m.id)) || !SYNC_URL_RE.test(String(m.url))) return;
      const nm = cleanText(m.name, 40).replace(/\s+/g, " "); if(!nm || seenN.has(nm.toLowerCase()) || seenU.has(m.url)) return;
      seenN.add(nm.toLowerCase()); seenU.add(m.url);
      out.sync.mirrors.push({id:String(m.id), name:nm, url:String(m.url), secret: typeof m.secret === "string" ? m.secret.slice(0,200) : "", err:"", last: Number.isFinite(Number(m.last)) ? Number(m.last) : 0,
        outbox:(Array.isArray(m.outbox) ? m.outbox : []).slice(0, 5000).map(e => cleanEvent(e, out.rate)).filter(Boolean)});
    });
  }
  if(d && d.loc && typeof d.loc === "object"){
    out.loc = {on: d.loc.on === 0 ? 0 : 1, work: {}};
    if(d.loc.at && typeof d.loc.at === "object"){ out.loc.at = {}; Object.keys(d.loc.at).slice(0, 12).forEach(k => { if((k === "" || ID_RE.test(k)) && d.loc.at[k] === 1) out.loc.at[k] = 1; }); }
    if(d.loc.work && typeof d.loc.work === "object") Object.keys(d.loc.work).slice(0, 12).forEach(k => { if((k === "" || ID_RE.test(k)) && placeOk(d.loc.work[k])) out.loc.work[k] = d.loc.work[k]; });
  }
  if(d && d.profile && typeof d.profile === "object"){
    const pf = d.profile, kinds = ["initials","photo","animal"], animals = ["lion","cat","fox","panda","bunny","penguin"];
    out.profile = {name: cleanText(pf.name, 30).replace(/\s+/g, " "), kind: kinds.includes(pf.kind) ? pf.kind : "initials", animal: animals.includes(pf.animal) ? pf.animal : "lion"};
    if(typeof pf.photo === "string" && /^data:image\/jpeg;base64,[A-Za-z0-9+\/=]{1,120000}$/.test(pf.photo)) out.profile.photo = pf.photo;
  }
  if(d && d.planDone && typeof d.planDone === "object"){ out.planDone = {};
    Object.keys(d.planDone).forEach(k => { const m = /^(?:([A-Za-z0-9_-]{1,64}):)?(\d{4}-\d{2}-\d{2})$/.exec(k); if(!m) return; const key = m[1] ? k : (d.plan && !d.plans ? "plan1:" + k : ""); if(key) out.planDone[key] = true; });
    const ks = Object.keys(out.planDone).sort((a,b) => a.split(":").pop() < b.split(":").pop() ? -1 : 1); ks.slice(0, Math.max(0, ks.length - 300)).forEach(k => delete out.planDone[k]); }
  if(d && Array.isArray(d.punchSeen)) out.punchSeen = d.punchSeen.map(String).filter(x => ID_RE.test(x)).slice(-80);
  out.outbox = (d && Array.isArray(d.outbox) ? d.outbox : []).slice(0, 5000).map(e => cleanEvent(e, out.rate)).filter(Boolean);
  if(d && Number.isFinite(Number(d.lastSync))) out.lastSync = Number(d.lastSync);
  for(const k of ["lastBackup","nudgeAt"]) if(d && Number.isFinite(Number(d[k])) && Number(d[k])>0) out[k] = Number(d[k]);
  if(d && d.lock && typeof d.lock.cred === "string" && /^[A-Za-z0-9_-]{8,2048}$/.test(d.lock.cred)) out.lock = {cred: d.lock.cred};
  return out;
}
let otCache = null;
let db = {rate: 14, theme: "auto", shifts: []};
try { const raw = localStorage.getItem(KEY); if (raw) db = cleanLocal(JSON.parse(raw)); } catch(e){}
function save(){ otCache=null; try{ localStorage.setItem(KEY, JSON.stringify(db)); }catch(e){} }
if(!db.loc || !db.loc.at){ db.loc=db.loc||{on:1,work:{}}; db.loc.work=db.loc.work||{}; db.loc.at={"":1}; (db.jobs||[]).forEach(j=>{ db.loc.at[j.id]=1; }); save(); }   // existing jobs keep recording; new jobs start "on the road"

function applyTheme(){
  const t = db.theme || "auto";
  document.documentElement.dataset.theme = t;
  const dark = t==="dark" || (t==="auto" && window.matchMedia("(prefers-color-scheme: dark)").matches);
  const mc = document.querySelector('meta[name="theme-color"]');
  if (mc) mc.setAttribute("content", dark ? "#0c0f16" : "#f4f5f8");
  const cs=document.querySelector('meta[name="color-scheme"]'); if(cs) cs.setAttribute("content", t==="auto"?"light dark":(dark?"dark":"light"));
  document.documentElement.style.backgroundColor = dark ? "#0a0c18" : "#f4f5f8";
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
function hrs(s){ const h=(s.end - s.start)/3600000; if(s.brk!=null) return s.bp ? h : Math.max(0,h-s.brk/60); return (db.breakMin>0 && h>=(db.breakAfter||6)) ? Math.max(0,h-db.breakMin/60) : h; }   // optional unpaid break
function money(n){ return "$"+Number(n).toLocaleString("en-US",{minimumFractionDigits:2, maximumFractionDigits:2}); }
function fmtDay(ts){ const d=new Date(ts), y=d.getFullYear()===new Date().getFullYear()?"":", "+d.getFullYear(); return ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"][d.getDay()]+", "+MONTHS[d.getMonth()]+" "+d.getDate()+y; }
function tipOf(s){ return s.tip||0; }
const jobLeft=id=>{ const j=id && (db.jobs||[]).find(x=>x.id===id); return !!(j&&j.left); };
function jobRate(id){ const j=id && (db.jobs||[]).find(x=>x.id===id); return j ? j.rate : db.rate; }
function jobName(id){ const j=id && (db.jobs||[]).find(x=>x.id===id); return j ? j.name : (db.jobName||"Main job"); }
function rateAt(job, ts){ let r=jobRate(job); const w=db.wkndPct||0, hol=db.holPct>0 && db.holidays && db.holidays[dayKey(ts)];
  if(hol) r=Math.round(r*(1+db.holPct/100)*100)/100;   // a holiday rate replaces the weekend premium
  else if(w>0){ const dw=new Date(ts).getDay(); if(dw===0||dw===6) r=Math.round(r*(1+w/100)*100)/100; } return r; }   // weekend premium applies to new shifts
function mkShift(start, end, job){ const s={id:uid(), start, end, rate:rateAt(job,start)}; if(job) s.job=job; return s; }
const rateOf=s=>s.rate!=null?s.rate:jobRate(s.job);   // each shift keeps the rate it was worked at
// overtime (optional, off unless set in Settings): hours past a daily and/or weekly limit are paid at an extra %, worked out per job
function otMap(){
  if(!(db.otWeek>0 || db.otDay>0)) return null;
  if(otCache) return otCache;
  const map={}, groups={};
  db.shifts.filter(s=>s.end).forEach(s=>{ (groups[s.job||""]=groups[s.job||""]||[]).push(s); });
  Object.keys(groups).forEach(g=>{
    const dayTot={}, wkReg={};
    groups[g].sort((a,b)=>a.start-b.start).forEach(s=>{
      const h=hrs(s), d=new Date(s.start), dk=dayKey(s.start), mon=new Date(d.getFullYear(),d.getMonth(),d.getDate()-((d.getDay()+6)%7)), wk=dayKey(mon.getTime());
      let ot=0, reg=h;
      if(db.otDay>0){ const room=Math.max(0, db.otDay-(dayTot[dk]||0)); ot=Math.max(0,h-room); reg=h-ot; }
      if(db.otWeek>0){ const room=Math.max(0, db.otWeek-(wkReg[wk]||0)), o2=Math.max(0,reg-room); ot+=o2; reg-=o2; }
      dayTot[dk]=(dayTot[dk]||0)+h; wkReg[wk]=(wkReg[wk]||0)+reg; if(ot>0) map[s.id]=ot; }); });
  return otCache=map;
}
const otPctOn=()=>db.otPct||50;
function otHrs(s){ const m=otMap(); return (m&&m[s.id])||0; }
function pay(s){ return hrs(s)*rateOf(s) + otHrs(s)*rateOf(s)*otPctOn()/100; }   // wages only (incl. overtime if turned on); tips are tracked separately
function esc(s){ return String(s).replace(/[&<>"']/g, c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c])); }

function openShift(){ return db.shifts.find(s=>!s.end); }

let timer=null, liveTimer=null;
// ---- planned shift: a reminder on the calendar; when its time has passed and nothing was logged, the app asks what happened ----
function planTimes(plan, base){   // base = local midnight of the day the plan starts on
  const [sh,sm]=plan.start.split(":").map(Number), [eh,em]=plan.end.split(":").map(Number);
  const S=new Date(base); S.setHours(sh,sm,0,0); const E=new Date(base); E.setHours(eh,em,0,0);
  if(E<=S) E.setDate(E.getDate()+1);
  return {S:S.getTime(), E:E.getTime()};
}
function missedList(){   // planned shifts whose time has passed with nothing logged and no answer yet (last 14 days)
  const out=[], now=Date.now(), today=new Date(); today.setHours(0,0,0,0);
  (db.plans||[]).forEach(plan=>{
    if(jobLeft(plan.job)) return;
    if(!plan.since){ plan.since=dayKey(today.getTime()-86400000); save(); }   // plans from before this feature only ask about yesterday onward
    for(let back=14; back>=0; back--){
      const base=new Date(today); base.setDate(base.getDate()-back); const dk=dayKey(base.getTime()); if(dk<plan.since) continue;
      const k=plan.id+":"+dk; if((db.planDone&&db.planDone[k]) || (db.daysOff&&db.daysOff[dk]) || !planApplies(plan,base)) continue;
      const {S,E}=planTimes(plan,base); if(E>now) continue;
      if(db.shifts.some(x=>x.start<E && (x.end==null?now:x.end)>S && x.start>=S-2*3600000)) continue;   // you already logged it
      out.push({plan,dk,k,S,E}); } });
  return out.sort((a,b)=>a.S-b.S);
}
function planApplies(plan, d){ if(plan.job && jobLeft(plan.job)) return false; return plan.once ? plan.once===dayKey(d.getTime()) : (plan.days||[]).includes(d.getDay()); }
function nextPlanned(days){   // soonest planned shift that hasn't started (looks ahead, skips days off)
  const pls=db.plans||[]; const base=new Date(); base.setHours(0,0,0,0);
  for(let i=0;i<(days||21);i++){ const d=new Date(base); d.setDate(base.getDate()+i); const dk=dayKey(d.getTime()); if(db.daysOff&&db.daysOff[dk]) continue;
    const hit=pls.filter(p=>planApplies(p,d) && !(db.planDone&&db.planDone[p.id+":"+dk]) && planTimes(p,d).E>Date.now()).sort((p,q)=>p.start<q.start?-1:1)[0];
    if(hit) return {plan:hit, day:d.getTime(), today:i===0}; }
  return null;
}
function applyPlan(){
  let changed=false; const now=Date.now();
  db.shifts.forEach(s=>{ if(s.end==null && s.autoEnd && now>=s.autoEnd){ s.end=s.autoEnd; delete s.autoEnd; changed=true; queueSync({action:"upsert", shift:shiftPayload(s)}); } });
  const plans=db.plans||[]; if(plans.length){   // planned shifts never start the clock by themselves; finished one-day plans are tidied away once you've answered for them
    const drop=plans.filter(p=>p.once && p.once<dayKey(now) && db.planDone && db.planDone[p.id+":"+p.once]).map(p=>p.id);
    if(drop.length){ db.plans=plans.filter(p=>!drop.includes(p.id)); if(!db.plans.length) delete db.plans; changed=true; }
  }
  if(changed) save(); return changed;
}
let histQ="", histMonth="all", histJob="all", jobFilter="all";
const histF={hMin:null,hMax:null,aMin:null,aMax:null};
const hfActive=()=>Object.values(histF).filter(v=>v!=null).length;
function histSearchOk(s,q){   // notes, dates and months only; never the time of day or the amount
  const d=new Date(s.start), toks=(String(s.note||"")+" "+fmtDay(s.start)+" "+fmtDate(s.start)+" "+monthLabel(monthKey(s.start))).toLowerCase().split(/[^a-z0-9]+/).filter(Boolean), note=String(s.note||"").toLowerCase();
  return q.split(/\s+/).filter(Boolean).every(w=>/^\d+$/.test(w)?toks.includes(w):(toks.some(t=>!/^\d+$/.test(t)&&t.includes(w))||note.includes(w)));
}
function histRangeOk(s){ const h=Math.round(hrs(s)*100)/100, a=Math.round(pay(s)*100)/100;
  return (histF.hMin==null||h>=histF.hMin) && (histF.hMax==null||h<=histF.hMax) && (histF.aMin==null||a>=histF.aMin) && (histF.aMax==null||a<=histF.aMax); }
function queueMeta(){ const c=db.sync; if(!c||!c.enabled||!c.url) return; db.outbox=db.outbox||[]; const ev={action:"meta"}; pushEv(db.outbox,ev); mirrors().forEach(m=>pushEv(outboxOf(m),ev)); save(); updateSyncStatus(); flushOutbox(); }
// jobs, planned shifts, days off, expenses and a few settings travel as small JSON blobs ("core" + one per year of expenses)
function metaPayloads(){
  const core={jobs:db.jobs||[], jobName:db.jobName||"", plans:db.plans||[], daysOff:Object.keys(db.daysOff||{}).sort().slice(-400), wkndPct:db.wkndPct||0, taxPct:db.taxPct||0, mileRate:db.mileRate||0};
  for(const k of ["otWeek","otDay","otPct","holPct","payCycle","payAnchor"]) if(db[k]) core[k]=db[k];
  if(db.netTrack) core.netTrack=1; if(db.holidays && Object.keys(db.holidays).length) core.holidays=Object.keys(db.holidays).sort().slice(-400);
  const out={core:JSON.stringify(core)}, by={};
  (db.expenses||[]).forEach(x=>{ const y=new Date(x.ts).getFullYear(); (by[y]=by[y]||[]).push(x); });
  Object.keys(by).forEach(y=>{ out["exp-"+y]=JSON.stringify(by[y].sort((a,b)=>a.ts-b.ts)); });
  return out;
}
async function pushMeta(remote, t){   // writes whatever differs from the sheet's copy
  const mine=metaPayloads(); let n=0;
  for(const k of Object.keys(mine)){
    const empty=k==="core" && mine[k]===JSON.stringify({jobs:[],jobName:"",plans:[],daysOff:[],wkndPct:0,taxPct:0,mileRate:0});
    if(remote && remote[k]===mine[k]) continue; if(empty && (!remote||remote[k]==null)) continue;
    if(mine[k].length>44000) throw new Error("Too much expense data for one year to sync."); await syncCall({action:"kvset", key:k, value:mine[k]}, t); n++; }
  return n;
}
function mergeMeta(remote){   // sheet -> phone: add anything missing here, never overwrite what's set here
  let n=0; const parse=t=>{ try{ return JSON.parse(t); }catch(e){ return null; } };
  const core=remote.core && parse(remote.core);
  if(core && typeof core==="object"){
    const jb=new Set((db.jobs||[]).map(j=>j.id)); (Array.isArray(core.jobs)?core.jobs:[]).slice(0,8).forEach(x=>{ const c=cleanJob(x); if(c && !jb.has(c.id) && (db.jobs||[]).length<8){ jb.add(c.id); (db.jobs=db.jobs||[]).push(c); n++; } });
    const pb=new Set((db.plans||[]).map(p=>p.id)); (Array.isArray(core.plans)?core.plans:[]).slice(0,40).forEach(x=>{ const c=cleanPlan(x); if(c && !pb.has(c.id) && (db.plans||[]).length<40){ pb.add(c.id); (db.plans=db.plans||[]).push(c); n++; } });
    (Array.isArray(core.daysOff)?core.daysOff:[]).slice(0,800).forEach(k=>{ if(DAY_RE.test(String(k)) && !(db.daysOff&&db.daysOff[k])){ (db.daysOff=db.daysOff||{})[k]=1; n++; } });
    const num=(v,max)=>{ v=Number(v); return Number.isFinite(v)&&v>0&&v<=max?v:0; };
    if(!db.wkndPct && num(core.wkndPct,300)){ db.wkndPct=num(core.wkndPct,300); n++; } if(!db.taxPct && num(core.taxPct,60)){ db.taxPct=num(core.taxPct,60); n++; } if(!db.mileRate && num(core.mileRate,10)){ db.mileRate=num(core.mileRate,10); n++; }
    for(const [k,max] of [["otWeek",168],["otDay",24],["otPct",300],["holPct",300]]) if(!db[k] && num(core[k],max)){ db[k]=num(core[k],max); n++; }
    if(!db.payCycle && ["weekly","biweekly","monthly"].includes(core.payCycle)){ db.payCycle=core.payCycle; n++; } if(!db.payAnchor && typeof core.payAnchor==="string" && DAY_RE.test(core.payAnchor)){ db.payAnchor=core.payAnchor; n++; }
    if(!db.netTrack && core.netTrack){ db.netTrack=1; n++; }
    (Array.isArray(core.holidays)?core.holidays:[]).slice(0,400).forEach(k=>{ if(DAY_RE.test(String(k)) && !(db.holidays&&db.holidays[k])){ (db.holidays=db.holidays||{})[k]=1; n++; } });
    if(!db.jobName){ const jn=cleanText(core.jobName,24); if(jn){ db.jobName=jn; n++; } }
  }
  const eb=new Set((db.expenses||[]).map(x=>x.id));
  Object.keys(remote).filter(k=>/^exp-\d{4}$/.test(k)).forEach(k=>{ const arr=parse(remote[k]); (Array.isArray(arr)?arr:[]).slice(0,5000).forEach(x=>{ const c=cleanExpense(x); if(c && !eb.has(c.id)){ eb.add(c.id); (db.expenses=db.expenses||[]).push(c); n++; } }); });
  return n;
}
function fillJobSelect(sel, val){ sel.innerHTML=""; const add=(v,t)=>{ const o=document.createElement("option"); o.value=v; o.textContent=t; sel.appendChild(o); };
  add("", jobName("")); (db.jobs||[]).forEach(j=>{ if(!j.left || j.id===val) add(j.id,j.name+(j.left?" (left)":"")); }); sel.value=(val&&(db.jobs||[]).some(j=>j.id===val))?val:""; }
const hasJobs=()=>!!(db.jobs&&db.jobs.length);
const jobOk=(s,f)=>f==="all" ? !jobLeft(s.job) : (f==="main" ? !s.job || !(db.jobs||[]).some(j=>j.id===s.job) : s.job===f);
function S(){ return db.shifts.filter(s=>jobOk(s,jobFilter)); }   // shifts in view for Analytics
let homeJob="all";   // which job the Home totals are showing
const JPAL=["#4f8bff","#2fd08e","#ff9b5e","#c78bff","#ff6fa3","#f2c94c","#38c6d9","#9aa7bd"];
function jobColor(id){ const i=id?(db.jobs||[]).findIndex(j=>j.id===id)+1:0; return JPAL[(i<0?0:i)%JPAL.length]; }
const jobDot=id=>'<i class="jd" style="--jc:'+jobColor(id)+'"></i>';
// a row of job chips; opt: all (adds "All jobs"), main (value used for the main job), left (include jobs you left), disabled
function jobChips(el, cur, onPick, opt){
  el.innerHTML=""; const mk=(v,t,id)=>{ const b=document.createElement("button"); b.type="button"; b.className="jchip"+(v===cur?" on":""); b.style.setProperty("--jc", id==null?"var(--muted)":jobColor(id));
    b.innerHTML=(id==null?"":'<i class="jd"></i>')+esc(t); b.disabled=!!opt.disabled; b.setAttribute("aria-pressed", v===cur); b.onclick=()=>onPick(v); el.appendChild(b); };
  if(opt.all) mk("all","All jobs",null); mk(opt.main==null?"":opt.main, jobName(""), "");
  (db.jobs||[]).forEach(j=>{ if(!j.left || opt.left) mk(j.id, j.name+(j.left?" (left)":""), j.id); }); }
function jobStats(f){ const today=dayKey(Date.now()), mk=monthKey(Date.now()), r={tw:0,th:0,mw:0,mh:0,aw:0,ah:0,tt:0,mt:0,n:0};
  db.shifts.forEach(s=>{ if(!jobOk(s,f)) return; const tp=tipOf(s); if(tp){ if(dayKey(s.start)===today) r.tt+=tp; if(monthKey(s.start)===mk) r.mt+=tp; }
    if(!s.end) return; r.n++; const h=hrs(s), p=pay(s); r.ah+=h; r.aw+=p; if(dayKey(s.start)===today){ r.th+=h; r.tw+=p; } if(monthKey(s.start)===mk){ r.mh+=h; r.mw+=p; } }); return r; }

function showFs(){ const el=$("fsClock"); if(!openShift()) return; el.hidden=false; { const mc=document.querySelector('meta[name="theme-color"]'); if(mc) mc.setAttribute("content","#0b0f1a"); } document.body.classList.add("fs-open"); { const o=openShift(), el=$("fsLoc"); if(el && !el.textContent.startsWith("Getting")){ const t=o&&locOn()&&o.pin?placeNote(o,"pin"):""; el.textContent=t; el.hidden=!t; } } tickFs(); { const jp=$("fsJob"); jp.classList.remove("pop"); void jp.offsetWidth; jp.classList.add("pop"); } clearInterval(fsTimer); fsTimer=setInterval(tickFs,250); }
function hideFs(){ const el=$("fsClock"); if(!el||el.hidden) return; el.hidden=true; el.style.transform=""; el.style.transition=""; el.classList.remove("dragging"); applyTheme(); document.body.classList.remove("fs-open"); clearInterval(fsTimer); }
let fsTimer=null;
function planOf(o){   // the planned shift this clock-in belongs to, if any
  const d0=new Date(o.start); d0.setHours(0,0,0,0);
  for(const back of [0,1]){ const base=new Date(d0); base.setDate(base.getDate()-back);
    for(const p of (db.plans||[])){ if(!planApplies(p,base) || (p.job||"")!==(o.job||"")) continue; const t=planTimes(p,base); if(o.start>=t.S-2*3600000 && o.start<t.E) return t; } }
  return null; }
function tickFs(){ const o=openShift(); if(!o){ hideFs(); return; } const el=Math.max(0,Date.now()-o.start)/1000, h=Math.floor(el/3600), m=Math.floor(el%3600/60), s=Math.floor(el%60), p2=n=>String(n).padStart(2,"0");
  $("fsH").textContent=p2(h); $("fsM").textContent=p2(m); $("fsS").textContent=p2(s);
  const pl=planOf(o), tr=$("fsTrack"), cap=$("fsPlan"); tr.hidden=false; tr.classList.toggle("idle",!pl); cap.hidden=!pl;
  { const jp=$("fsJob"); jp.hidden=!hasJobs(); if(hasJobs()){ $("fsJobName").textContent=jobName(o.job); $("fsClock").style.setProperty("--jc",jobColor(o.job)); } }
  if(!pl){ $("fsFill").style.width="100%"; $("fsExtra").style.width="0%"; }
  if(pl){ const len=pl.E-pl.S, worked=hrs({start:o.start,end:Date.now(),brk:o.brk,bp:o.bp})*3600000, f=worked/len, ex=Math.max(0,worked-len)/60000;
    $("fsFill").style.width=(Math.min(f,1)*100).toFixed(1)+"%"; $("fsExtra").style.width=(f>1?Math.min(f-1,1)*100:0).toFixed(1)+"%";
    cap.textContent=f<1 ? Math.floor(f*100)+"% of your "+"planned shift"+" \u00b7 until "+fmtTime(pl.E) : "Planned shift done"+(ex>=1?" \u00b7 +"+brkText(Math.round(ex))+" extra":""); }
  const hh=hrs({start:o.start,end:Date.now(),brk:o.brk,bp:o.bp}); $("fsEarn").textContent=money(hh*rateOf(o))+" earned so far"+(hasJobs()?" \u00b7 "+jobName(o.job):"");
  $("fsBreak").textContent=o.brk>0?"Break \u00b7 "+brkText(o.brk)+(o.bp?" (paid)":""):"Break"; }
// Nudge to back up when history isn't saved anywhere else
function updateNudge(){ const el=$("backupNudge"); if(!el) return; const DAY=864e5, now=Date.now(), c=db.sync;
  const synced=c && c.enabled && c.url && db.lastSync && now-db.lastSync<14*DAY;
  const need=db.shifts.filter(s=>s.end).length>=3 && !synced && now-(db.lastBackup||0)>21*DAY && now-(db.nudgeAt||0)>7*DAY;
  el.hidden=!need; }
function render(){
  if(typeof updateAvatar==="function") try{ updateAvatar(); }catch(e){}
  applyPlan();
  if(!openShift()) hideFs();
  updateNudge();
  const btn=$("clockBtn"), line=$("statusLine"), cancel=$("cancelShift");
  const open=openShift();
  if(open){
    btn.textContent="Clock Out"; btn.classList.add("out"); $("startEdit").style.display="block";
    cancel.style.display="block";
    const tick=()=>{ const el=(Date.now()-open.start)/1000;
      const h=Math.floor(el/3600), m=Math.floor(el%3600/60), s=Math.floor(el%60);
      line.innerHTML='<div class="live-row"><span class="live-l"><span class="dot"></span>Shift in progress</span><b class="live-t">'+
        String(h).padStart(2,"0")+":"+String(m).padStart(2,"0")+":"+String(s).padStart(2,"0")+'</b></div><div class="live-s">Clocked in at '+esc(fmtTime(open.start))+(hasJobs()?" · "+esc(jobName(open.job)):"")+" · tap for full screen</div>"+(h>=10?'<div class="long">Still clocked in after '+h+'h. Forgot to clock out?</div>':''); };
    tick(); clearInterval(timer); timer=setInterval(tick,1000);
  } else {
    btn.textContent="Clock In"; btn.classList.remove("out"); cancel.style.display="none"; $("startEdit").style.display="none";
    clearInterval(timer);
    line.innerHTML = db.shifts.length ? '<div class="live-row"><span class="live-l idle"><span class="dot off"></span>Not clocked in</span></div><div class="live-s">Ready for your next shift</div>' : "Tap <b>Clock In</b> when your shift starts.";
  }

  // stats
  const today=dayKey(Date.now()), mk=monthKey(Date.now());
  let th=0, mh=0, ah=0, et=0, em=0, ea=0, tt=0, tw=0, tm=0, ta=0; const wk0=startOfWeek(Date.now());
  const hv=db.shifts.filter(s=>jobOk(s,homeJob));
  hv.forEach(s=>{ if(!s.end) return; const h=hrs(s), p=pay(s); ah+=h; ea+=p;
    if(dayKey(s.start)===today){ th+=h; et+=p; } if(monthKey(s.start)===mk){ mh+=h; em+=p; } });
  hv.forEach(s=>{ const tp=tipOf(s); if(!tp) return; ta+=tp; if(s.start>=wk0) tw+=tp; if(dayKey(s.start)===today) tt+=tp; if(monthKey(s.start)===mk) tm+=tp; });
  { const nm=homeJob==="all"?"":" \u00b7 "+jobName(homeJob==="main"?"":homeJob); $("tipHead").textContent="Tips"+nm; $("wageHead").textContent="Wages"+nm; }
  $("tipDay").textContent=money(tt); $("tipWeek").textContent=money(tw); $("tipMonth").textContent=money(tm); $("tipAll").textContent=money(ta);
  $("statToday").innerHTML = money(et)+"<small>"+th.toFixed(1)+"h</small>";
  $("statMonth").innerHTML = money(em)+"<small>"+mh.toFixed(1)+"h</small>";
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
  { const line=$("planLine"), pls=db.plans||[]; const dn=["Sun","Mon","Tue","Wed","Thu","Fri","Sat"];
    const f=t=>{ const [hh,mm]=t.split(":").map(Number); const d=new Date(); d.setHours(hh,mm,0,0); return fmtTime(d.getTime()); };
    if(pls.length===1){ const pl=pls[0];
      line.textContent=f(pl.start)+" – "+f(pl.end)+" · "+(pl.once?(pl.once===dayKey(Date.now())?"today":fmtDay(new Date(pl.once+"T12:00:00").getTime())):[1,2,3,4,5,6,0].filter(x=>pl.days.includes(x)).map(x=>dn[x]).join(" "));
      line.style.display=""; $("planBtn").textContent="Edit"; }
    else if(pls.length>1){ const nx=nextPlanned(); line.textContent=pls.length+" planned shifts"+(nx?" · next "+(nx.today?"today ":fmtDay(nx.day)+" ")+f(nx.plan.start):""); line.style.display=""; $("planBtn").textContent="Calendar"; }
    else { line.textContent="Nothing planned yet"; line.style.display=""; $("planBtn").textContent="Plan a shift"; } }
  clearInterval(liveTimer);
  if(open && jobOk(open,homeJob) && dayKey(open.start)===today){ const upd=()=>{ const h=(Date.now()-open.start)/3600000, hh=(db.breakMin>0&&h>=(db.breakAfter||6))?Math.max(0,h-db.breakMin/60):h;
      $("heroEarn").textContent=money(et+hh*rateOf(open)); $("heroSub").textContent=(th+hh).toFixed(2)+"h so far today"+(tt>0?" · + "+money(tt)+" tips":""); };
    upd(); liveTimer=setInterval(upd,1000); }
  renderJobsUI();
  renderCalendar();
  renderAnalytics();
  renderPay();

  // history grouped by day
  const allDone=db.shifts.filter(s=>s.end).sort((a,b)=>b.start-a.start);
  const mSel=$("histMonth"); { const keys=[...new Set(allDone.map(s=>monthKey(s.start)))]; if(histMonth!=="all" && !keys.includes(histMonth)) histMonth="all";
    mSel.innerHTML=""; const o0=document.createElement("option"); o0.value="all"; o0.textContent="All months"; mSel.appendChild(o0);
    keys.forEach(k=>{ const o=document.createElement("option"); o.value=k; o.textContent=monthLabel(k); mSel.appendChild(o); }); mSel.value=histMonth; }
  const q=histQ.trim().toLowerCase();
  const done=allDone.filter(s=>jobOk(s,histJob) && (histMonth==="all"||monthKey(s.start)===histMonth) && (!q || histSearchOk(s,q)) && histRangeOk(s));
  const hs=$("histSum"); if(allDone.length && (q||histMonth!=="all"||hfActive())){ const hh=done.reduce((t,x)=>t+hrs(x),0), ww=done.reduce((t,x)=>t+pay(x),0), tt2=done.reduce((t,x)=>t+(x.tip||0),0);
    hs.textContent=done.length+" shift"+(done.length===1?"":"s")+" \u00b7 "+hh.toFixed(1)+"h \u00b7 "+money(ww)+(tt2?" wages \u00b7 "+money(tt2)+" tips":""); hs.hidden=false; } else hs.hidden=true;
  if(typeof hfPaint==="function") hfPaint();
  const box=$("history"); box.innerHTML="";
  if(!allDone.length){ box.innerHTML='<div class="empty">No shifts yet. Clock in to start tracking.</div>'; }
  else if(!done.length){ box.innerHTML='<div class="empty">No shifts match.</div>'; }
  let lastDay="";
  done.forEach(s=>{
    const dk=dayKey(s.start);
    if(dk!==lastDay){ lastDay=dk;
      const d=document.createElement("div");
      d.className="dayhead"; const dt=done.filter(x=>dayKey(x.start)===dk).reduce((t,x)=>t+pay(x),0);
      const dl=document.createElement("span"); dl.textContent=fmtDay(s.start); const dm=document.createElement("span"); dm.textContent=done.filter(x=>dayKey(x.start)===dk).length>1?money(dt):""; d.appendChild(dl); d.appendChild(dm); box.appendChild(d);
    }
    const h=hrs(s), row=document.createElement("div"); row.className="row";
    row.innerHTML='<div><div class="d">'+esc(fmtTime(s.start))+" – "+esc(fmtTime(s.end))+'</div>'+
      '<div class="t">'+h.toFixed(2)+' hours'+(s.tip?' · '+money(s.tip)+' tip':'')+(s.rate!=null&&s.rate!==jobRate(s.job)?' · '+money(s.rate)+'/hr':'')+(hasJobs()?' · <span class="jtag" style="--jc:'+jobColor(s.job)+'"><i class="jd"></i>'+esc(jobName(s.job))+'</span>':'')+'</div></div>'+
      '<div class="m"><b>'+money(pay(s))+'</b><span class="chev" aria-hidden="true">\u203a</span></div>';
    row.dataset.edit=s.id; row.tabIndex=0; row.setAttribute("role","button"); row.setAttribute("aria-label","Edit shift "+fmtTime(s.start));
    if(s.note){ const nd=document.createElement("div"); nd.className="shnote"; nd.textContent="\uD83D\uDCDD "+s.note; row.appendChild(nd); }
    if(s.pin||s.pout){ const nd=document.createElement("div"); nd.className="shnote"; const di=distFromWork(s,"pin"), dout=distFromWork(s,"pout");
      nd.textContent="\uD83D\uDCCD In "+(s.pin?(di!==""?fmtDist(di)+" from work":"saved"):"\u2013")+" \u00b7 Out "+(s.pout?(dout!==""?fmtDist(dout)+" from work":"saved"):"\u2013"); row.appendChild(nd); }
    box.appendChild(row);
  });
  box.querySelectorAll("[data-edit]").forEach(b=>{ b.onclick=()=>openModal(db.shifts.find(s=>s.id===b.dataset.edit));
    b.onkeydown=e=>{ if(e.key==="Enter"||e.key===" "){ e.preventDefault(); b.click(); } }; });

  drawChart();
  applyTheme();
  { const c=cycleOf(); $("cycleInput").value=c; $("paydayRow").style.display=c==="monthly"?"":"none"; $("anchorRow").style.display=(c==="weekly"||c==="biweekly")?"":"none"; if(document.activeElement!==$("anchorInput")) $("anchorInput").value=db.payAnchor||"";
  for(const [id,k] of [["otWeekInput","otWeek"],["otDayInput","otDay"],["otPctInput","otPct"],["holInput","holPct"]]) if(document.activeElement!==$(id)) $(id).value=db[k]||"";
  $("otPctRow").style.display=(db.otWeek>0||db.otDay>0)?"":"none"; $("netInput").value=db.netTrack?"1":""; }
  $("rateInput").value=db.rate; $("wkndInput").value=db.wkndPct||""; $("taxInput").value=db.taxPct||""; $("mileInput").value=db.mileRate||""; fillSettingsPickers();
}

// ---------- Calendar ----------
let calOff=0, dayKeySel=null;
function plansOn(d){ const dk=dayKey(d.getTime()); if(db.daysOff&&db.daysOff[dk]) return [];
  return (db.plans||[]).filter(p=>planApplies(p,d) && !(db.planDone&&db.planDone[p.id+":"+dk])); }
function renderCalendar(){
  const now=new Date(), f=new Date(now.getFullYear(), now.getMonth()+calOff, 1), last=new Date(f.getFullYear(), f.getMonth()+1, 0).getDate();
  $("calTitle").textContent=["January","February","March","April","May","June","July","August","September","October","November","December"][f.getMonth()]+" "+f.getFullYear();
  const g=$("calGrid"); g.innerHTML=""; const lead=(f.getDay()+6)%7, today=dayKey(Date.now());
  const byDay={}; db.shifts.forEach(s=>{ if(jobLeft(s.job)) return; const k=dayKey(s.start); (byDay[k]=byDay[k]||[]).push(s); });
  for(let i=0;i<lead;i++){ g.appendChild(document.createElement("span")); }
  let nS=0,hh=0,ww=0,nOff=0;
  for(let d=1; d<=last; d++){
    const date=new Date(f.getFullYear(), f.getMonth(), d), k=dayKey(date.getTime()), list=byDay[k]||[], off=!!(db.daysOff&&db.daysOff[k]);
    const planned=!list.length && date.getTime()>=new Date(new Date().setHours(0,0,0,0)).getTime() && plansOn(date).length>0;
    const b=document.createElement("button"); b.type="button"; b.className="cal-day"+(k===today?" today":"")+(list.length?" worked":"")+(planned?" planned":"")+(off?" off":"")+(db.holPct>0&&db.holidays&&db.holidays[k]?" hol":""); b.dataset.day=k;
    const n=document.createElement("b"); n.textContent=String(d); b.appendChild(n);
    const t=document.createElement("small");
    if(list.length){ const h=list.reduce((a,x)=>a+(x.end?hrs(x):0),0); t.textContent=h>0?h.toFixed(h%1?1:0)+"h":"\u2022"; }
    else if(off) t.textContent="Off"; else if(planned) t.textContent="Plan";
    b.appendChild(t); b.setAttribute("aria-label", fmtDay(date.getTime())+(list.length?", worked":"")+(planned?", planned":"")+(off?", day off":""));
    b.onclick=()=>openDay(k); g.appendChild(b);
    list.forEach(x=>{ if(x.end){ nS++; hh+=hrs(x); ww+=pay(x); } }); if(off) nOff++;
  }
  $("calSum").textContent=nS+" shift"+(nS===1?"":"s")+" \u00b7 "+hh.toFixed(1)+"h \u00b7 "+money(ww)+(nOff?" \u00b7 "+nOff+" day"+(nOff===1?"":"s")+" off":"");
  $("calNext").disabled=calOff>=12; $("calPrev").disabled=calOff<=-36;
  // coming up: next planned shifts over the next 5 weeks
  const L=$("calNextList"); L.innerHTML=""; let c=0; const base=new Date(); base.setHours(0,0,0,0);
  const ft=(p,d)=>{ const {S,E}=planTimes(p,d); return fmtTime(S)+" \u2013 "+fmtTime(E); };
  for(let i=0;i<35 && c<8;i++){ const d=new Date(base); d.setDate(base.getDate()+i); const ps=plansOn(d).filter(p=>planTimes(p,d).E>Date.now());
    ps.sort((a,b)=>a.start<b.start?-1:1).forEach(p=>{ if(c>=8) return; c++;
      const r=document.createElement("button"); r.type="button"; r.className="job-row"; const a=document.createElement("span"); a.textContent=(i===0?"Today":fmtDay(d.getTime()));
      const m=document.createElement("span"); m.className="job-rate"; m.textContent=ft(p,d)+(hasJobs()?" \u00b7 "+jobName(p.job):"")+(p.once?"":" \u00b7 weekly"); r.appendChild(a); r.appendChild(m);
      r.onclick=()=>openPlan(p, dayKey(d.getTime())); L.appendChild(r); }); }
  if(!c){ const e=document.createElement("div"); e.className="empty"; e.textContent="Nothing planned. Tap a day to plan a shift or mark a day off."; L.appendChild(e); }
}
function openDay(k){
  dayKeySel=k; const d=new Date(k+"T12:00:00"), isPast=k<dayKey(Date.now()), off=!!(db.daysOff&&db.daysOff[k]);
  $("dayTitle").textContent=fmtDay(d.getTime());
  const B=$("dayBody"); B.innerHTML="";
  const row=(a,b,fn)=>{ const r=document.createElement("button"); r.type="button"; r.className="job-row"; const x=document.createElement("span"); x.textContent=a; const y=document.createElement("span"); y.className="job-rate"; y.textContent=b; r.appendChild(x); r.appendChild(y); if(fn) r.onclick=fn; B.appendChild(r); };
  db.shifts.filter(s=>dayKey(s.start)===k && !jobLeft(s.job)).sort((a,b)=>a.start-b.start).forEach(s=>row(fmtTime(s.start)+(s.end?" \u2013 "+fmtTime(s.end):" \u2013 now"), s.end?money(pay(s))+(hasJobs()?" \u00b7 "+jobName(s.job):""):"in progress", ()=>{ closeDay(); if(s.end) openModal(s); }));
  plansOn(d).forEach(p=>{ const {S,E}=planTimes(p,d); row("Planned "+fmtTime(S)+" \u2013 "+fmtTime(E), p.once?"one day":"weekly", ()=>{ closeDay(); openPlan(p,k); }); });
  if(off){ const n=document.createElement("div"); n.className="job-hint"; n.textContent="Marked as a day off. Planned shifts are skipped, and it isn't counted in your daily averages or projection."; B.appendChild(n); }
  if(!B.children.length){ const n=document.createElement("div"); n.className="empty"; n.textContent=isPast?"No shifts this day.":"Nothing planned yet."; B.appendChild(n); }
  $("dayHol").style.display=db.holPct>0?"":"none"; $("dayHol").textContent=(db.holidays&&db.holidays[k])?"Remove holiday":"Mark as holiday"; $("dayPlan").style.display=isPast?"none":""; $("dayOff").textContent=off?"Remove day off":"Mark as day off";
  $("dayBg").classList.add("open"); }
function closeDay(){ $("dayBg").classList.remove("open"); }
$("dayBg").addEventListener("click",e=>{ if(e.target===$("dayBg")) closeDay(); });
$("dayAdd").onclick=()=>{ const k=dayKeySel; closeDay(); openModal(null); $("fDate").value=k; };
$("dayPlan").onclick=()=>{ const k=dayKeySel; closeDay(); openPlan(null,k); };
$("dayHol").onclick=()=>{ const k=dayKeySel; db.holidays=db.holidays||{}; if(db.holidays[k]) delete db.holidays[k]; else db.holidays[k]=1; if(!Object.keys(db.holidays).length) delete db.holidays;
  const ch=[]; db.shifts.forEach(s=>{ if(dayKey(s.start)===k && s.end){ const nr=rateAt(s.job,s.start); if(nr!==s.rate){ s.rate=nr; ch.push(shiftPayload(s)); } } });
  if(ch.length) queueSync({action:"bulk", shifts:ch});
  save(); closeDay(); render(); queueMeta(); };
$("dayOff").onclick=()=>{ const k=dayKeySel; db.daysOff=db.daysOff||{};
  if(db.daysOff[k]) delete db.daysOff[k]; else { if(db.shifts.some(s=>dayKey(s.start)===k && s.end)){ alert("There are shifts on this day, so it can't be a day off."); return; } db.daysOff[k]=1; }
  if(!Object.keys(db.daysOff).length) delete db.daysOff; save(); closeDay(); render(); queueMeta(); };
$("calPrev").onclick=()=>{ calOff--; renderCalendar(); }; $("calNext").onclick=()=>{ if(calOff<12){ calOff++; renderCalendar(); } };
sheetDrag($("dayBg"), closeDay);
// ---------- Tip yield ----------
function renderTipYield(){
  const card=$("tipYieldCard"), done=S().filter(x=>x.end && hrs(x)>0), withTips=done.filter(x=>x.tip>0);
  card.hidden = withTips.length<1; if(card.hidden) return;
  const bucket=(n,keyFn)=>{ const B=Array.from({length:n},()=>({t:0,h:0,n:0})); done.forEach(x=>{ const b=B[keyFn(x)]; b.t+=tipOf(x); b.h+=hrs(x); b.n++; }); return B; };
  const wd=bucket(7,x=>(new Date(x.start).getDay()+6)%7), dp=bucket(4,x=>{ const h=new Date(x.start).getHours(); return h>=5&&h<11?0:h>=11&&h<16?1:h>=16&&h<21?2:3; });
  const wn=["Mon","Tue","Wed","Thu","Fri","Sat","Sun"], dn=["Morning","Afternoon","Evening","Night"];
  const draw=(el,B,names)=>{ el.innerHTML=""; const mx=Math.max(0.0001,...B.map(b=>b.h>0?b.t/b.h:0));
    B.forEach((b,i)=>{ const r=document.createElement("div"); r.className="wk"; const y=b.h>0?b.t/b.h:0;
      const n=document.createElement("span"); n.className="n"; n.style.width=names===dn?"68px":"34px"; n.textContent=names[i];
      const bar=document.createElement("span"); bar.className="bar"; const fill=document.createElement("i"); fill.style.width=Math.round(y/mx*100)+"%"; bar.appendChild(fill);
      const v=document.createElement("span"); v.className="v"; v.textContent=b.n?money(y)+"/h":"\u2014"; r.appendChild(n); r.appendChild(bar); r.appendChild(v); el.appendChild(r); }); };
  draw($("tyWeekday"),wd,wn); draw($("tyDaypart"),dp,dn);
  const best=(B,names)=>{ let bi=-1,by=-1; B.forEach((b,i)=>{ if(b.n>=2 && b.h>0 && b.t/b.h>by){ by=b.t/b.h; bi=i; } }); return bi>=0?names[bi]:null; };
  const bw=best(wd,wn), bd=best(dp,dn);
  $("tyNote").textContent=(bw||bd ? "Best so far: "+[bw,bd&&bd.toLowerCase()].filter(Boolean).join(", ")+". " : "")+"Tips per hour worked, from "+done.length+" shift"+(done.length===1?"":"s")+(done.length<15?". Early numbers; more shifts make this more reliable.":".");
}
function renderJobsUI(){
  const on=hasJobs();
  const row=$("jobPickRow"); row.hidden=!on; if(on){ if(db.activeJob && !db.jobs.some(j=>j.id===db.activeJob && !j.left)) delete db.activeJob; fillJobSelect($("jobPick"), db.activeJob);
    const o=openShift(), cur=o?(o.job||""):(db.activeJob||"");
    $("jobPickH").textContent=o?"Clocked in for":"Clock in for";
    jobChips($("jobChips"), cur, v=>{ if(v) db.activeJob=v; else delete db.activeJob; save(); renderJobsUI(); }, {main:"", disabled:!!o}); }
  { const hr=$("homeJobRow"); hr.hidden=!on; if(!on) homeJob="all";
    if(on){ if(homeJob!=="all" && homeJob!=="main" && !(db.jobs||[]).some(j=>j.id===homeJob && !j.left)) homeJob="all";
      jobChips($("homeChips"), homeJob, v=>{ homeJob=v; render(); }, {all:true, main:"main"}); } }
  renderJobCards();
  for(const [id,get,set] of [["histJob",()=>histJob,v=>histJob=v],["anaJob",()=>jobFilter,v=>jobFilter=v]]){
    const el=$(id); el.hidden=true; $("anaJobRow").hidden=!on; $("histChips").hidden=!on; if(!on){ set("all"); continue; }
    el.innerHTML=""; const add=(v,t)=>{ const o=document.createElement("option"); o.value=v; o.textContent=t; el.appendChild(o); };
    add("all","All jobs"); add("main",jobName("")); db.jobs.forEach(j=>add(j.id,j.name+(j.left?" (left)":"")));
    if(![...el.options].some(o=>o.value===get())) set("all"); el.value=get(); }
  if(on){ jobChips($("histChips"), histJob, v=>{ histJob=v; render(); }, {all:true, main:"main", left:true}); jobChips($("anaChips"), jobFilter, v=>{ jobFilter=v; renderJobsUI(); renderAnalytics(); drawChart(); }, {all:true, main:"main", left:true}); }
  const L=$("jobList"); L.innerHTML="";
  const mk=(id,name,rate,left)=>{ const r=document.createElement("button"); r.type="button"; r.className="job-row"+(left?" job-left":""); r.dataset.job=id;
    const n=document.createElement("span"); n.textContent=name; const m=document.createElement("span"); m.className="job-rate"; m.textContent=left?"Left "+fmtDay(new Date(left+"T12:00:00").getTime()):money(rate)+"/hr"; r.appendChild(n); r.appendChild(m); r.onclick=()=>openJob(id||null, true); L.appendChild(r); };
  mk("", jobName(""), db.rate); (db.jobs||[]).forEach(j=>mk(j.id,j.name,j.rate,j.left));
  if(typeof renderLoc==="function") renderLoc();
}
function renderJobCards(){
  const box=$("jobCards"); box.innerHTML=""; const on=hasJobs() && homeJob==="all"; box.hidden=!on; if(!on) return;
  const list=[["main","",jobName(""),db.rate]].concat((db.jobs||[]).filter(j=>!j.left).map(j=>[j.id,j.id,j.name,j.rate]));
  list.forEach(([f,id,name,rate])=>{ const st=jobStats(f), c=document.createElement("button"); c.type="button"; c.className="card jobcard"; c.style.setProperty("--jc", jobColor(id));
    const live=openShift() && (openShift().job||"")===id;
    c.innerHTML='<div class="jc-top"><span class="jc-name"><i class="jd"></i>'+esc(name)+(live?'<em class="jc-live">working now</em>':'')+'</span><span class="jc-rate">'+money(rate)+'/hr</span></div>'+
      '<div class="jc-grid"><div><small>Today</small><b>'+money(st.tw)+'</b><span>'+st.th.toFixed(1)+'h</span></div><div><small>This month</small><b>'+money(st.mw)+'</b><span>'+st.mh.toFixed(1)+'h</span></div><div><small>Tips (month)</small><b class="tp">'+money(st.mt)+'</b><span>'+money(st.tt)+' today</span></div></div>'+
      '<div class="jc-all">All time '+money(st.aw)+' \u00b7 '+st.ah.toFixed(1)+'h</div>';
    c.onclick=()=>{ homeJob=f; render(); window.scrollTo(0,0); }; box.appendChild(c); });
}
let jobEditId=null, jobIsMain=false;
function openJob(id, existing){
  jobIsMain=existing && !id; jobEditId=id; const j=(db.jobs||[]).find(x=>x.id===id);
  $("jobTitle").textContent=jobIsMain?"Main job":(j?"Edit job":"Add a job");
  $("jobNameIn").value=jobIsMain?jobName(""):(j?j.name:""); $("jobRateIn").value=j?j.rate:"";
  $("jobRateF").style.display=jobIsMain?"none":""; $("jobMainNote").style.display=jobIsMain?"":"none"; $("jobDelete").style.display=(j&&j.left)?"":"none"; $("jobLeave").style.display=j?"":"none"; $("jobLeave").textContent=(j&&j.left)?"I'm back at this job":"I left this job";
  $("jobPlace").value=(db.loc&&db.loc.at&&(jobIsMain?db.loc.at[""]===1:(!!id&&db.loc.at[id]===1)))?"1":"";
  $("jobBg").classList.add("open"); }
function closeJob(){ $("jobBg").classList.remove("open"); }
$("jobAdd").onclick=()=>{ if((db.jobs||[]).length>=7){ alert("That's the maximum number of extra jobs."); return; } openJob(null,false); };
$("jobCancel").onclick=closeJob; $("jobBg").addEventListener("click",e=>{ if(e.target===$("jobBg")) closeJob(); });
let jobSaveId="";
function setPlaceMode(id,on){ db.loc=db.loc||{on:1,work:{}}; db.loc.at=db.loc.at||{}; if(on) db.loc.at[id]=1; else delete db.loc.at[id]; }
$("jobSave").onclick=()=>{
  const name=cleanText($("jobNameIn").value,24); if(!name){ alert("Give the job a name."); return; }
  if(jobIsMain){ if(name==="Main job") delete db.jobName; else db.jobName=name; }
  else { const rate=parseFloat($("jobRateIn").value); if(!(rate>=0) || rate>100000){ alert("Enter an hourly rate."); return; }
    const c=cleanJob({id:jobEditId||("j"+Date.now().toString(36)+Math.random().toString(36).slice(2,4)), name, rate}); if(!c) return;
    db.jobs=db.jobs||[]; const i=db.jobs.findIndex(x=>x.id===c.id); if(i>=0) db.jobs[i]=c; else db.jobs.push(c); jobSaveId=c.id; }
  setPlaceMode(jobIsMain?"":jobSaveId, $("jobPlace").value==="1");
  save(); closeJob(); render(); queueMeta(); };
$("jobLeave").onclick=async()=>{ const j=(db.jobs||[]).find(x=>x.id===jobEditId); if(!j) return;
  if(!j.left && !await askConfirm("Leave "+j.name+"?", "You won't be able to add new shifts or clock in for it, and its shifts will be hidden from History, Analytics and Calendar. Your earnings still count in your totals. You can come back to it anytime from Settings.", "Yes, I left", false)) return;
  if(j.left) delete j.left; else { j.left=dayKey(Date.now()); if(db.activeJob===j.id) delete db.activeJob; }
  save(); closeJob(); render(); queueMeta(); };
$("jobDelete").onclick=async()=>{
  const id=expJobId(), j=(db.jobs||[]).find(x=>x.id===id); if(!j) return; if(!j.left) return;
  const mine=db.shifts.filter(s=>s.job===id), done=mine.filter(s=>s.end);
  const hh=done.reduce((t,x)=>t+hrs(x),0), ww=done.reduce((t,x)=>t+pay(x),0), pl=(db.plans||[]).filter(p=>p.job===id).length;
  const msg=done.length||mine.length
    ? "\""+j.name+"\" has "+mine.length+" shift"+(mine.length===1?"":"s")+" logged ("+hh.toFixed(1)+"h, "+money(ww)+"). You\u2019ll choose next whether to keep them (under "+jobName("")+") or delete them too."+(pl?" "+pl+" planned shift"+(pl===1?"":"s")+" for it will be removed.":"")+" You can undo right after."
    : "\""+j.name+"\" has no shifts yet."+(pl?" "+pl+" planned shift"+(pl===1?"":"s")+" for it will be removed.":"")+" You can undo right after.";
  if(!await askConfirm("Delete "+j.name+"?", msg, "Delete job", true)) return;
  let wipe=false;
  if(mine.length) wipe=await askConfirm("What about its "+mine.length+" shift"+(mine.length===1?"":"s")+"?", "Keep them in your history and pay totals, or delete them too? Deleting removes "+hh.toFixed(1)+"h and "+money(ww)+" of recorded pay (handy if this was just a test job).", "Delete shifts too", true, "Keep shifts");
  const jobSnap=JSON.stringify({jobs:db.jobs, plans:db.plans, activeJob:db.activeJob, mine, loc:db.loc});
  if(wipe){ const gone=mine.slice(); const ids=new Set(gone.map(x=>x.id)); db.shifts=db.shifts.filter(x=>!ids.has(x.id)); gone.filter(x=>x.end).forEach(x=>queueSync({action:"delete", id:x.id})); }
  else db.shifts.forEach(s=>{ if(s.job===id){ if(s.rate==null) s.rate=j.rate; delete s.job; } });   // keep each shift's pay exactly as it was
  db.jobs=db.jobs.filter(x=>x.id!==id); if(!db.jobs.length) delete db.jobs; if(db.loc){ if(db.loc.at) delete db.loc.at[id]; if(db.loc.work) delete db.loc.work[id]; } if(db.activeJob===id) delete db.activeJob;
  if(db.plans){ db.plans=db.plans.filter(p=>p.job!==id); if(!db.plans.length) delete db.plans; }
  if(histJob===id) histJob="all"; if(jobFilter===id) jobFilter="all";
  const upd=wipe?[]:mine.filter(s=>s.end).map(s=>shiftPayload(s)); if(upd.length) queueSync({action:"bulk", shifts:upd});
  save(); closeJob(); render(); queueMeta();
  showUndo("Job deleted.", ()=>{ const o=JSON.parse(jobSnap); db.jobs=o.jobs; if(o.plans) db.plans=o.plans; else delete db.plans; if(o.activeJob) db.activeJob=o.activeJob; if(o.loc) db.loc=o.loc;
    const ids=new Set(o.mine.map(x=>x.id)); db.shifts=db.shifts.filter(x=>!ids.has(x.id)).concat(o.mine); save(); render(); queueMeta();
    const l=o.mine.filter(x=>x.end).map(x=>shiftPayload(x)); if(l.length) queueSync({action:"bulk", shifts:l}); }); };
function expJobId(){ return jobEditId; }
sheetDrag($("jobBg"), closeJob);
$("jobPick").onchange=e=>{ if(e.target.value) db.activeJob=e.target.value; else delete db.activeJob; save(); };
$("histJob").onchange=e=>{ histJob=e.target.value; render(); };
$("anaJob").onchange=e=>{ jobFilter=e.target.value; renderAnalytics(); drawChart(); };
let monOff=0, monGeom=null, wkStart=null;
function firstShiftTs(){ return S().reduce((m,x)=>Math.min(m,x.start),Infinity); }
// stacked bars: green = wages, pink = tips, numbers inside each part and the total on top
function stackedChart(cv, items, solo){
  const ctx=cv.getContext("2d"), dpr=window.devicePixelRatio||1, W=cv.clientWidth, H=cv.clientHeight;
  cv.width=W*dpr; cv.height=H*dpr; ctx.scale(dpr,dpr); ctx.clearRect(0,0,W,H);
  const cs=getComputedStyle(document.documentElement), colMuted=(cs.getPropertyValue("--muted")||"#6b7686").trim(), colInk=(cs.getPropertyValue("--ink")||"#1b2430").trim();
  const n=items.length, padL=8, padB=26, padT=34, cw=(W-padL)/n, bh=H-padB-padT-8, f="-apple-system, sans-serif";
  const max=Math.max(1,...items.map(i=>i.w+i.t));
  items.forEach((it,i)=>{
    const x=padL+i*cw+cw/2, bw=Math.min(52,cw-12), v=it.w+it.t, hasT=it.t>0.004;
    let h=v>0?Math.max(4,(v/max)*bh):3, wh=v>0?h*(it.w/v):h, th=hasT?h-wh:0;
    if(v>0){ if(it.w>0.004) wh=Math.max(wh,20); if(hasT) th=Math.max(th,18); }
    const topY=H-padB-(wh+th);
    const g=ctx.createLinearGradient(0,H-padB-wh,0,H-padB); g.addColorStop(0,"#4fcf93"); g.addColorStop(1,"#1fa971");
    ctx.fillStyle=v>0?g:"rgba(128,138,155,.35)"; ctx.beginPath(); ctx.roundRect(x-bw/2, H-padB-wh, bw, wh, th>0?[0,0,6,6]:6); ctx.fill();
    if(th>0){ ctx.fillStyle="#f06aa8"; ctx.beginPath(); ctx.roundRect(x-bw/2, topY, bw, th, [6,6,0,0]); ctx.fill(); }
    ctx.textAlign="center"; ctx.textBaseline="middle"; ctx.font="700 10.5px "+f; ctx.fillStyle="#fff";
    if(!solo && it.w>0.004 && wh>=18) ctx.fillText("$"+Math.round(it.w), x, H-padB-wh/2);
    if(!solo && hasT && th>=16) ctx.fillText("$"+Math.round(it.t), x, topY+th/2);
    ctx.textBaseline="alphabetic"; ctx.fillStyle=colMuted; ctx.font="11px "+f; ctx.fillText(it.label, x, H-10);
    if(v>0){ ctx.fillStyle=colInk; ctx.font="700 12px "+f; ctx.fillText("$"+Math.round(v), x, topY-6); }
  });
  return {padL, cw, n};
}
function drawChart(){
  const now=new Date(), keys=[];
  for(let i=5;i>=0;i--){ const d=new Date(now.getFullYear(), now.getMonth()+monOff-i, 1); keys.push(monthKey(d.getTime())); }
  const sums={}, tipS={}; keys.forEach(k=>{ sums[k]=0; tipS[k]=0; });
  S().forEach(s=>{ if(!s.end) return; const k=monthKey(s.start); if(k in sums){ sums[k]+=pay(s); tipS[k]+=tipOf(s); } });
  $("monRange").textContent=monthLabel(keys[0])+" \u2013 "+monthLabel(keys[5]);
  const first=firstShiftTs(), fk=Number.isFinite(first)?monthKey(first):null;
  $("monNext").disabled=monOff>=0; $("monPrev").disabled=!fk || fk>=keys[0];
  monGeom=Object.assign({keys}, stackedChart($("chart"), keys.map(k=>{ const [mn,yr]=monthLabel(k).split(" "); return {label:mn+(k.endsWith("-01")?" \u2019"+yr.slice(2):""), w:sums[k], t:tipS[k]}; })));
}
// drill-down pop-up: months -> weeks of a month -> seven days of a week; mode = all | wages | tips
let dr={mode:"all",level:1,floor:1,mk:null,wk:null,off:0}, drGeom=null;
const mondayOf=ts=>{ const d=new Date(ts); d.setHours(0,0,0,0); d.setDate(d.getDate()-((d.getDay()+6)%7)); return d.getTime(); };
const shortD=ts=>{ const d=new Date(ts); return MONTHS[d.getMonth()].slice(0,3)+" "+d.getDate(); };
function drAgg(list){ const m=dr.mode; return {w:m==="tips"?0:list.reduce((t,x)=>t+pay(x),0), t:m==="wages"?0:list.reduce((t,x)=>t+tipOf(x),0), h:list.reduce((t,x)=>t+hrs(x),0), n:list.length}; }
function renderWeek(){
  const mode=dr.mode, all=S().filter(x=>x.end), nowTs=Date.now(), fs=firstShiftTs(), fk=Number.isFinite(fs)?monthKey(fs):null, noun=mode==="tips"?"Tips":mode==="wages"?"Wages":"Earnings";
  let items=[], targets=[], list=[], lab="", title="", hint="", prevOff=true, nextOff=true;
  if(dr.level===0){
    const keys=[], now=new Date();
    for(let i=5;i>=0;i--){ keys.push(monthKey(new Date(now.getFullYear(), now.getMonth()+dr.off-i, 1).getTime())); }
    keys.forEach(k=>{ const ss=all.filter(x=>monthKey(x.start)===k); list=list.concat(ss); const a=drAgg(ss), [mn,yr]=monthLabel(k).split(" "); items.push({label:mn+(k.endsWith("-01")?" ’"+yr.slice(2):""), w:a.w, t:a.t}); targets.push(k); });
    title=noun+" by month"; lab=monthLabel(keys[0])+" – "+monthLabel(keys[5]); hint="Tap a month to see it week by week";
    prevOff=!fk||fk>=keys[0]; nextOff=dr.off>=0;
  } else if(dr.level===1){
    const [y,m]=dr.mk.split("-").map(Number), f=new Date(y,m-1,1), l=new Date(y,m,0), cur=monthKey(nowTs)===dr.mk;
    for(let d=new Date(mondayOf(f.getTime())); d<=l; d.setDate(d.getDate()+7)){
      const w0=d.getTime(), e=new Date(d); e.setDate(e.getDate()+7);
      const ss=all.filter(x=>monthKey(x.start)===dr.mk && x.start>=w0 && x.start<e.getTime()); list=list.concat(ss); const a=drAgg(ss);
      items.push({label:shortD(Math.max(w0,f.getTime())), w:a.w, t:a.t}); targets.push(w0); }
    title=monthLabel(dr.mk); lab=cur?"This month":"Week by week"; hint="Tap a week to see its days";
    prevOff=!fk||fk>=dr.mk; nextOff=dr.mk>=monthKey(nowTs);
  } else {
    const a=new Date(dr.wk), b=new Date(a), e=new Date(a); b.setDate(a.getDate()+7); e.setDate(a.getDate()+6);
    ["Mon","Tue","Wed","Thu","Fri","Sat","Sun"].forEach((nm,i)=>{ const d0=new Date(a), d1=new Date(a); d0.setDate(a.getDate()+i); d1.setDate(a.getDate()+i+1);
      const ss=all.filter(x=>x.start>=d0.getTime()&&x.start<d1.getTime()); list=list.concat(ss); const g=drAgg(ss); items.push({label:nm, w:g.w, t:g.t}); });
    const cur=mondayOf(nowTs)===a.getTime();
    title=MONTHS[a.getMonth()]+" "+a.getDate()+" – "+(e.getMonth()!==a.getMonth()?MONTHS[e.getMonth()]+" ":"")+e.getDate()+(e.getFullYear()!==new Date().getFullYear()?", "+e.getFullYear():"");
    lab=cur?"This week":"Day by day"; hint=""; prevOff=!Number.isFinite(fs)||mondayOf(fs)>=a.getTime(); nextOff=cur||a.getTime()>nowTs;
  }
  const T=drAgg(list);
  $("monTitle").textContent=title; $("mwLab").textContent=lab; $("mwPrev").disabled=prevOff; $("mwNext").disabled=nextOff;
  $("mwBack").hidden=dr.level<=dr.floor; $("mwBack").textContent=dr.level===2?"\u2039 Weeks":"\u2039 Months";
  const st=$("mwStats"); st.innerHTML="";
  [["Wages",T.w,"g",mode!=="tips"],["Tips",T.t,"p",mode!=="wages"],["Total",T.w+T.t,"",mode==="all"]].forEach(([l,v,c,show])=>{ if(!show) return; const d=document.createElement("div"); d.className="mw-tile "+c; d.innerHTML='<small>'+l+'</small><b>'+money(v)+'</b>'; st.appendChild(d); });
  $("mwNote").textContent=T.n?(hint?hint+" · ":"")+T.h.toFixed(1)+"h · "+T.n+" shift"+(T.n===1?"":"s"):"No shifts here";
  const g=stackedChart($("wkChart"), items, mode!=="all"); drGeom=Object.assign({targets}, g);
}
function openDrill(mode, level, mk, wk){ syncBack(); dr={mode, level, floor:level, mk:mk||monthKey(Date.now()), wk:wk||mondayOf(Date.now()), off:0}; $("monBg").classList.add("open"); renderWeek(); }
function openWeekFor(monthKeySel, mode){ openDrill(mode||"all", 1, monthKeySel); }
// when a pop-up sends you to another tab, remember where you came from so Back can return you to the same spot
let navBack=null;
function currentTab(){ const b=document.querySelector(".tabbar button.on, #avatarBtn.on"); return b?b.dataset.tab:"home"; }
function redirectTo(tab, open){ navBack={tab:currentTab(), y:window.scrollY}; document.querySelector('[data-tab="'+tab+'"]').click(); setTimeout(()=>{ open(); syncBack(); },120); }
function syncBack(){ const b=$("mwHome"); if(b) b.hidden=!navBack; }
function goDrill(mode, level){ if(hasJobs()){ jobFilter=homeJob; } redirectTo("analytics", ()=>openDrill(mode, level)); }
const moveWeek=d=>{
  if(dr.level===0) dr.off+=d*6;
  else if(dr.level===1){ const [y,m]=dr.mk.split("-").map(Number); dr.mk=monthKey(new Date(y,m-1+d,1).getTime()); }
  else { const a=new Date(dr.wk); a.setDate(a.getDate()+7*d); dr.wk=a.getTime(); }
  renderWeek(); };
$("mwPrev").onclick=()=>moveWeek(-1); $("mwNext").onclick=()=>moveWeek(1);
$("mwBack").onclick=()=>{ if(dr.level===2){ dr.mk=monthKey(dr.wk+3*86400000); dr.level=1; } else if(dr.level===1) dr.level=0; renderWeek(); };
$("wkChart").addEventListener("click",e=>{ if(!drGeom||dr.level>=2) return; const r=$("wkChart").getBoundingClientRect(), i=Math.floor((e.clientX-r.left-drGeom.padL)/drGeom.cw); if(i<0||i>=drGeom.n) return;
  if(dr.level===0){ dr.mk=drGeom.targets[i]; dr.level=1; } else { dr.wk=drGeom.targets[i]; dr.level=2; } renderWeek(); });
const closeMon=()=>{ $("monBg").classList.remove("open"); navBack=null; syncBack(); };
$("mwHome").onclick=()=>{ const nb=navBack; closeMon(); if(!nb) return; document.querySelector('[data-tab="'+nb.tab+'"]').click(); setTimeout(()=>window.scrollTo(0,nb.y),60); };
$("mwClose").onclick=closeMon; $("monBg").addEventListener("click",e=>{ if(e.target===$("monBg")) closeMon(); }); sheetDrag($("monBg"), closeMon);
[["monthStat","wages",1],["allStat","wages",0],["tipWeekStat","tips",2],["tipMonthStat","tips",1],["tipTot","tips",0]].forEach(([id,mode,lv])=>{ const el=$(id); el.addEventListener("click",()=>goDrill(mode,lv)); el.addEventListener("keydown",e=>{ if(e.key==="Enter"||e.key===" "){ e.preventDefault(); el.click(); } }); });
$("monPrev").onclick=()=>{ monOff--; drawChart(); }; $("monNext").onclick=()=>{ if(monOff<0){ monOff++; drawChart(); } };
$("chart").addEventListener("click",e=>{ if(!monGeom) return; const r=$("chart").getBoundingClientRect(), i=Math.floor((e.clientX-r.left-monGeom.padL)/monGeom.cw); if(i>=0&&i<6) openWeekFor(monGeom.keys[i],"all"); });

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
  S().forEach(s=>{ if(!s.end) return; const t=s.start;
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
  const longest=S().filter(x=>x.end && x.start>=days[0].a && x.start<days[days.length-1].b).reduce((m,x)=>Math.max(m,hrs(x)),0);
  const nowT=Date.now(), isOff=x=>p!=="year" && !!(db.daysOff && db.daysOff[dayKey(x.a)]);   // days off don't count against your averages or pace
  const usable=days.filter(x=>!isOff(x)), totalDays=Math.max(1,usable.length);
  const done=usable.filter(x=>x.b<=nowT).length || (anaOff===0 ? Math.max(1,usable.filter(x=>x.a<=nowT).length) : totalDays);
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
  // projection: point estimate at the pace so far, with a likely range from how much each finished day/month varied
  const paceTile=(total)=>{
    const point=earned/done*total, r=total-done, comp=usable.filter(x=>x.b<=nowT).map(x=>x.earned);
    let sub=(hours/done*total).toFixed(0)+"h", main=money(point);
    if(comp.length>=3 && r>0){
      const mean=comp.reduce((a,x)=>a+x,0)/comp.length, sd=Math.sqrt(comp.reduce((a,x)=>a+(x-mean)*(x-mean),0)/(comp.length-1));
      const spread=sd*Math.sqrt(r), rd=v=>Math.round(v/10)*10;
      const lo=Math.max(earned,rd(point-spread)), hi=Math.max(lo,rd(point+spread));
      if(hi-lo>=10){ main=money(lo).replace(/\.00$/,"")+" – "+money(hi).replace(/\.00$/,""); sub="likely range · about "+money(point).replace(/\.00$/,"")+" at this pace"; }
    } else if(comp.length<3){ sub+=" · too early for a range"; }
    tiles.push(["On pace for", main+"<small>"+sub+"</small>"]);
  };
  if(earned>0 && anaOff===0 && done>0 && done<totalDays) paceTile(totalDays);
  const g=$("anaStats"); g.innerHTML="";
  tiles.forEach(([l,v])=>{ const d=document.createElement("div"); d.className="ana-tile";
    d.innerHTML='<div class="l">'+l+'</div><div class="v">'+v+'</div>'; g.appendChild(d); });
  drawAnaChart(days, p); if($("tab-analytics").classList.contains("on")) drawChart();
  renderInsights(); renderTipYield();
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
  const done=S().filter(x=>x.end), rate=db.rate;
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
$("paydayInput").addEventListener("change",e=>{ const v=Math.round(parseFloat(e.target.value)); if(Number.isFinite(v)&&v>=1&&v<=28){ db.payday=v; db.payCycle="monthly"; } else delete db.payday; e.target.value=db.payday||""; save(); render(); queueMeta(); queueSettings(); });
$("goalInput").addEventListener("change",e=>{ const v=parseFloat(e.target.value); db.goal=(Number.isFinite(v)&&v>0)?Math.min(v,1000000):0; if(!db.goal) delete db.goal; save(); renderAnalytics(); queueSettings(); });
$("goalSet").addEventListener("click",()=>{ document.querySelector('[data-tab="settings"]').click(); setTimeout(()=>$("goalInput").focus(),350); });

function renderInsights(){
  const done=S().filter(x=>x.end).sort((a,b)=>a.start-b.start);
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

let anaRaf=0;
const RM=()=>window.matchMedia&&matchMedia("(prefers-reduced-motion: reduce)").matches;
function drawAnaChart(days, p){
  cancelAnimationFrame(anaRaf);
  if(RM()){ drawAnaFrame(days,p,null); return; }
  const t0=performance.now(), n=days.length, DUR=520, STAG=Math.min(40,300/Math.max(1,n));
  const step=now=>{
    const el=now-t0; drawAnaFrame(days,p,el/ (DUR+STAG*n), el);
    if(el<DUR+STAG*n) anaRaf=requestAnimationFrame(step); else drawAnaFrame(days,p,null);
  };
  anaRaf=requestAnimationFrame(step);
}
function drawAnaFrame(days, p, prog, el){
  const DUR=520, n0=days.length, STAG=Math.min(40,300/Math.max(1,n0));
  const kOf=i=> prog==null ? 1 : (()=>{ const u=Math.min(1,Math.max(0,(el-i*STAG)/DUR)); return 1-Math.pow(1-u,3); })();
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
    const k=kOf(i), h=Math.max(2,(d.hours/maxH)*(H-padB-padT))*k;
    const x=i*slot+slot/2;
    const g=ctx.createLinearGradient(0,H-padB-h,0,H-padB);
    if(d===best && d.hours>0){ g.addColorStop(0,"#4fbf8b"); g.addColorStop(1,"#bfe8d5"); }
    else { g.addColorStop(0,"#6f93f2"); g.addColorStop(1,"#c5d3fa"); }
    ctx.fillStyle=g;
    ctx.beginPath(); ctx.roundRect(x-bw/2, H-padB-h, bw, h, 5); ctx.fill();
    if(k>0.85 && d.hours>0 && (p==="week" || d===best)){ ctx.fillStyle=colInk; ctx.fillText(d.hours.toFixed(1)+"h", x, H-padB-h-5); }
    if(p!=="month" || i%5===0 || i===n-1){ ctx.fillStyle=colMuted; ctx.fillText(d.label, x, H-7); }
  });
}

document.querySelectorAll("#anaSeg button").forEach(b=>b.onclick=()=>{ db.anaPeriod=b.dataset.p; anaOff=0; save(); renderAnalytics(); });
$("anaPrev").onclick=()=>{ anaOff--; renderAnalytics(); };
$("anaNext").onclick=()=>{ if(anaOff<0){ anaOff++; renderAnalytics(); } };

// ---------- Google Sheets sync (via Apps Script web app) ----------
function syncCfg(){ const c = db.sync || (db.sync = {url:"", secret:"", enabled:false}); if(!Array.isArray(c.mirrors)) c.mirrors = []; return c; }
const mirrors = () => syncCfg().mirrors;
const outboxOf = t => t === syncCfg() ? (db.outbox = db.outbox || []) : (t.outbox = t.outbox || []);
const sheetName = t => t.name || (t === syncCfg() ? "My sheet" : "Backup sheet");
function shiftPayload(s, rate){
  const h=hrs(s); rate = s.rate!=null ? s.rate : (rate==null ? jobRate(s.job) : rate);
  return {id:s.id, date:fmtDate(s.start), day:["Sun","Mon","Tue","Wed","Thu","Fri","Sat"][new Date(s.start).getDay()], month:monthKey(s.start), in:fmtTime(s.start), out:fmtTime(s.end),
          hours:Math.round(h*100)/100, earned:Math.round(h*rate*100)/100, tips:s.tip||0, note:s.note||"", rate:rate, start:s.start, end:s.end, brk:(s.brk==null?"":s.brk), brkPaid:(s.brk!=null&&s.bp?1:""), job:s.job||"", jobName:(db.jobs&&db.jobs.length)?jobName(s.job):"",
          pin:s.pin||"", pout:s.pout||"", dIn:distFromWork(s,"pin"), dOut:distFromWork(s,"pout")};
}
// Before the pay rate changes, lock every older shift to the rate it was worked at, so a raise only affects new shifts.
function stampRates(){ db.shifts.forEach(s=>{ if(s.rate==null) s.rate=jobRate(s.job); }); }
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
  queueSync({action:"sset", settings:settingsPayload()});
}
function payPayload(p){ return {id:p.id, date:fmtDate(p.ts), month:monthKey(p.ts), amount:p.amount, note:p.note, ts:p.ts, gross:p.gross, job:p.job||""}; }
// Talk to the script and READ the reply, so wrong secrets / bad deployments show up as errors.
async function syncCall(body, t){
  const c=t||syncCfg(); window.__syncStep=body&&body.action;
  if(!SYNC_URL_RE.test(c.url||"")) throw new Error("That isn't a Google Apps Script web app URL (it should end in /exec).");
  let res; const ac=new AbortController(); const tmo=setTimeout(()=>ac.abort(),30000);
  try{
    res=await fetch(c.url, {method:"POST", redirect:"follow", credentials:"omit", referrerPolicy:"no-referrer", cache:"no-store", signal:ac.signal,
      headers:{"Content-Type":"text/plain;charset=utf-8"},
      body:JSON.stringify(Object.assign({secret:c.secret}, body))});
  }catch(e){ clearTimeout(tmo); if(e && e.name==="AbortError"){ const t=new Error("The script didn't answer in 30 s. Open the URL in Safari to check it, or redeploy the script (new version)."); throw t; } const err=new Error(navigator.onLine ? "Can't reach the script. Check the URL and that access is set to Anyone." : "Offline"); err.offline=!navigator.onLine; throw err; }
  clearTimeout(tmo);
  let j; try{ j=await res.json(); }catch(e){ throw new Error("Script didn't answer properly. Replace it with the latest Code.gs and redeploy."); }
  if(!j || !j.ok) throw new Error((j && j.error) || "Script error");
  progStep();
  return j;
}
function pushEv(list, ev){
  if(ev.action==="sset"){ for(let k=list.length-1;k>=0;k--) if(list[k].action==="sset") list.splice(k,1); }
  else if(ev.action==="meta" && list.some(e=>e.action==="meta")) return;
  list.push(ev); if(list.length>5000) list.splice(0, list.length-5000);
}
function queueSync(ev){
  const c=syncCfg();
  if(!c.enabled || !c.url) return;
  db.outbox=db.outbox||[];
  pushEv(db.outbox, ev); mirrors().forEach(m=>pushEv(outboxOf(m), ev));
  save();
  updateSyncStatus();
  flushOutbox();
}
let flushing=false;
async function flushList(t, list, isMain){
  let warn="";
  try{
    while(list.length){
      const ev=list[0];
      try{ if(ev.action==="meta"){ try{ await pushMeta(null,t); }catch(e){ if(e.message==="Unknown action"){ warn="Update the script (Code.gs) to sync jobs, plans and expenses"; } else throw e; } } else await syncCall(ev,t); }
      catch(e){ if(e.message==="Unknown action" && /^[ps]/.test(ev.action)){ list.shift(); warn="Update the script (Code.gs) to sync payments and settings"; save(); continue; } throw e; }
      list.shift();
      if(isMain) db.lastSync=Date.now(); else t.last=Date.now();
      t.err=""; save();
    }
    if(warn){ t.err=warn; save(); }
  }catch(e){ if(!e.offline) t.err=e.message; save(); }   // remaining events stay queued
}
async function flushOutbox(){
  const c=syncCfg();
  db.outbox=db.outbox||[];
  if(flushing) return;
  if(!c.enabled || !c.url || !navigator.onLine || !(db.outbox.length || mirrors().some(m=>outboxOf(m).length))){ updateSyncStatus(); return; }
  flushing=true; progBegin(db.outbox.length+mirrors().reduce((a,m)=>a+outboxOf(m).length,0)+1,"Syncing");
  try{
    if(db.outbox.length) await flushList(c, db.outbox, true);
    for(const m of mirrors().slice()) if(outboxOf(m).length) await flushList(m, outboxOf(m), false);
  } finally{ flushing=false; progFinish(); }
  updateSyncStatus();
  if(db.outbox.length && !c.err && navigator.onLine) setTimeout(flushOutbox,0);   // something was queued while we were busy
}
// Merge shifts that exist in the sheet but not on this device (restore after reinstall).
let pushedN=0;
async function syncPull(applySettings, t){
  t=t||syncCfg(); const OB=outboxOf(t);
  const j=await syncCall({action:"list"},t);
  const have=new Set(db.shifts.map(x=>x.id));
  const sheetIds=new Set((Array.isArray(j.shifts)?j.shifts:[]).map(r=>String(r&&r.id))); let sheetPIds=null; pushedN=0;
  const pendingDel=new Set(OB.filter(e=>e.action==="delete").map(e=>e.id));
  let added=0;
  (Array.isArray(j.shifts) ? j.shifts : []).slice(0,50000).forEach(r=>{
    const c=cleanShift(r && {id:r.id, start:r.start, end:r.end, tip:r.tip, note:r.note, rate:r.rate, job:r.job, brk:r.brk, brkPaid:r.brkPaid, pin:r.pin, pout:r.pout});
    if(!c || !c.end || have.has(c.id) || pendingDel.has(c.id)) return;
    have.add(c.id); db.shifts.push(c); added++;
  });
  try{
    const pj=await syncCall({action:"plist"},t), haveP=new Set(pays().map(x=>x.id));
    sheetPIds=new Set((Array.isArray(pj.payments)?pj.payments:[]).map(r=>String(r&&r.id)));
    const pendingPDel=new Set(OB.filter(e=>e.action==="pdelete").map(e=>e.id));
    (Array.isArray(pj.payments)?pj.payments:[]).slice(0,20000).forEach(r=>{ const c=cleanPayment(r); if(!c||haveP.has(c.id)||pendingPDel.has(c.id)) return; haveP.add(c.id); pays().push(c); added++; });
  }catch(e){ if(e.message!=="Unknown action") throw e; }
  if(!OB.some(e=>e.action==="meta")){
    try{ const kj=await syncCall({action:"kvget"},t), remote=kj.data&&typeof kj.data==="object"?kj.data:{};
      const m=mergeMeta(remote); added+=m; if(m){ save(); render(); }
      pushedN+=await pushMeta(remote,t); }catch(e){ if(e.message!=="Unknown action") throw e; }
  }
  if(applySettings && !OB.some(e=>e.action==="sset")){
    try{
      const sj=await syncCall({action:"sget"},t), c=cleanSettings(sj.settings);
      if(c){ if(c.rate!=null && c.rate!==db.rate){ stampRates(); db.rate=c.rate; } if(c.goal!=null){ if(c.goal>0) db.goal=c.goal; else delete db.goal; } if(c.payday!=null){ if(c.payday>0) db.payday=c.payday; else delete db.payday; }
        if(c.breakMin!=null){ if(c.breakMin>0) db.breakMin=c.breakMin; else delete db.breakMin; } if(c.breakAfter!=null) db.breakAfter=c.breakAfter;
        added+=0; save(); render(); }
    }catch(e){ if(e.message!=="Unknown action") throw e; }
  }
  // two-way: anything finished on this phone that the sheet doesn't have yet goes up now
  const queued=new Set(OB.map(e=>e.shift&&e.shift.id||e.payment&&e.payment.id));
  const missS=db.shifts.filter(x=>x.end && !sheetIds.has(String(x.id)) && !queued.has(x.id));
  if(missS.length){ await syncCall({action:"bulk", shifts:missS.map(shiftPayload)},t); pushedN+=missS.length; }
  if(sheetPIds){ const missP=pays().filter(x=>!sheetPIds.has(String(x.id)) && !queued.has(x.id)); if(missP.length){ try{ await syncCall({action:"pbulk", payments:missP.map(payPayload)},t); pushedN+=missP.length; }catch(e){ if(e.message!=="Unknown action") throw e; } } }
  if(t===syncCfg()){ try{ added+=await applyPunches(); }catch(e){ if(!e.offline) throw e; } }
  if(added){ save(); render(); }
  return added;
}
// "Clock in" / "clock out" sent from an iPhone Shortcut (via the sheet script) are applied here, at the exact time they were sent.
async function applyPunches(){
  let j; try{ j=await syncCall({action:"punches"}); }catch(e){ if(e.message==="Unknown action") return 0; throw e; }
  const list=(Array.isArray(j.punches)?j.punches:[]).filter(x=>x && /^[A-Za-z0-9_-]{1,64}$/.test(String(x.id)) && (x.kind==="in"||x.kind==="out") && Number.isFinite(Number(x.ts))).slice(0,200).sort((p,q)=>p.ts-q.ts);
  db.punchSeen=Array.isArray(db.punchSeen)?db.punchSeen:[];
  const now=Date.now(); let n=0; const done=[];
  list.forEach(x=>{
    done.push(String(x.id)); if(db.punchSeen.includes(String(x.id))) return; db.punchSeen.push(String(x.id));
    const ts=Number(x.ts); if(ts>now+5*60000 || ts<now-72*3600000) return;
    const open=openShift();
    if(x.kind==="in"){ if(open || db.shifts.some(s=>s.end && s.start<=ts && ts<s.end)) return; db.shifts.push(mkShift(ts, null, db.activeJob)); n++; }
    else if(open && ts>open.start){ open.end=ts; delete open.autoEnd; queueSync({action:"upsert", shift:shiftPayload(open)}); n++; }
  });
  db.punchSeen=db.punchSeen.slice(-80);
  if(done.length){ save(); try{ await syncCall({action:"punchdel", ids:done}); }catch(e){} }
  if(n) render();
  return n;
}
async function syncUploadAll(t){
  t=t||syncCfg();
  const list=db.shifts.filter(x=>x.end).map(shiftPayload);
  await syncCall({action:"bulk", shifts:list},t);
  try{ await syncCall({action:"sset", settings:settingsPayload()},t); }catch(e){ if(e.message!=="Unknown action") throw e; }
  const pl=pays().map(payPayload);
  if(pl.length){ try{ await syncCall({action:"pbulk", payments:pl},t); }catch(e){ if(e.message==="Unknown action") throw new Error("Shifts uploaded. Update the script (Code.gs) to sync payments too."); throw e; } }
  return list.length;
}
// Bring a backup sheet up to date: send whatever it is missing, never read from it.
async function mirrorSync(m){
  const j=await syncCall({action:"list"},m), ids=new Set((Array.isArray(j.shifts)?j.shifts:[]).map(r=>String(r&&r.id)));
  const miss=db.shifts.filter(x=>x.end && !ids.has(String(x.id)));
  if(miss.length) await syncCall({action:"bulk", shifts:miss.map(shiftPayload)},m);
  let n=miss.length;
  try{ const pj=await syncCall({action:"plist"},m), pid=new Set((Array.isArray(pj.payments)?pj.payments:[]).map(r=>String(r&&r.id))), mp=pays().filter(x=>!pid.has(String(x.id)));
    if(mp.length){ await syncCall({action:"pbulk", payments:mp.map(payPayload)},m); n+=mp.length; } }catch(e){ if(e.message!=="Unknown action") throw e; }
  try{ await syncCall({action:"sset", settings:settingsPayload()},m); }catch(e){ if(e.message!=="Unknown action") throw e; }
  try{ const kj=await syncCall({action:"kvget"},m); n+=await pushMeta(kj.data&&typeof kj.data==="object"?kj.data:{},m); }catch(e){ if(e.message!=="Unknown action") throw e; }
  m.last=Date.now(); m.err=""; save();
  return n;
}
// live sync progress: a bar that fills as each request to the sheet finishes, then vanishes
const prog={on:false, depth:0, total:1, done:0, label:"Syncing"};
function paintProg(final){
  const bar=$("syncBar"); if(!bar) return; const i=bar.firstElementChild;
  const pct=final?100:Math.min(95, Math.round(prog.done/Math.max(prog.total,1)*100));
  bar.hidden=false; bar.classList.remove("fade"); i.style.width=pct+"%"; bar.setAttribute("aria-valuenow",String(pct));
}
function progBegin(est,label){
  if(prog.on){ prog.depth++; prog.total+=est; return; }
  prog.on=true; prog.depth=1; prog.total=Math.max(est,2); prog.done=0; prog.label=label||"Syncing"; clearTimeout(progBegin.t); paintProg(); updateSyncStatus();
}
function progStep(){ if(!prog.on) return; prog.done++; if(prog.done>=prog.total) prog.total=prog.done+1; paintProg(); }
function progFinish(){
  if(!prog.on) return; if(--prog.depth>0) return;
  paintProg(true); prog.on=false;
  const bar=$("syncBar"); setTimeout(()=>{ if(!prog.on&&bar) bar.classList.add("fade"); },380);
  progBegin.t=setTimeout(()=>{ if(!prog.on&&bar){ bar.hidden=true; bar.classList.remove("fade"); bar.firstElementChild.style.width="0"; } },900);
}
function setStatus(text, dots){
  const el=$("syncStatus"); if(!el) return; el.textContent="";
  const s=String(text), more=/\u2026$/.test(s); el.appendChild(document.createTextNode(more?s.slice(0,-1):s));
  if(dots||more){ const d=document.createElement("span"); d.className="sdots"; d.setAttribute("aria-hidden","true"); d.innerHTML="<i></i><i></i><i></i>"; el.appendChild(d); }
}
async function syncRun(label, fn, t){
  const c=t||syncCfg();
  if(!c.url){ const el=$("syncStatus"); setStatus("Add a sheet first"); el.classList.add("err"); return; }
  const queued=(db.outbox||[]).length+mirrors().reduce((a,m)=>a+outboxOf(m).length,0);
  const est={Syncing:7+queued+4*mirrors().length, Connecting:10, Restoring:8, "Backing up":6}[label]||8;
  progBegin(est,label);
  let ok=false, info="";
  try{ const r=await fn(); c.err=""; if(c===syncCfg()) db.lastSync=Date.now(); save(); ok=true; info=typeof r==="string"?r:""; }
  catch(e){ c.err=e.message; save(); }
  progFinish();
  if(ok && info && label!=="Syncing" && !/^(Up to date|Connected \u2713|Restored from the sheet)/.test(info)){ updateSyncStatus(info); setTimeout(()=>{ if(!prog.on) updateSyncStatus(); },3500); }
  else updateSyncStatus();
}
function updateSyncStatus(msg){
  const c=syncCfg(), el=$("syncStatus");
  renderSheetList();
  if(!el) return;
  el.classList.remove("err"); el.classList.toggle("busy",prog.on);
  if(!c.url){ setStatus("Not set up"); return; }
  if(prog.on){ setStatus(prog.label,true); return; }
  if(c.err){ el.classList.add("err"); setStatus(mirrors().length?sheetName(c)+": "+c.err:c.err); return; }
  const bad=mirrors().find(m=>m.err); if(bad){ el.classList.add("err"); setStatus(sheetName(bad)+": "+bad.err); return; }
  if(msg){ setStatus(msg); return; }
  const n=(db.outbox||[]).length+mirrors().reduce((a,m)=>a+outboxOf(m).length,0);
  if(!c.enabled) setStatus("Auto-sync is off");
  else if(n>0) setStatus(n+" change"+(n===1?"":"s")+" waiting"+(navigator.onLine?"":" (offline)"),true);
  else if(db.lastSync) setStatus("Synced \u00b7 "+fmtTime(db.lastSync));
  else setStatus("Ready");
}
function renderSheetList(){
  const box=$("sheetList"); if(!box) return; const c=syncCfg(); box.textContent="";
  const all=c.url?[c].concat(mirrors()):[];
  if(!all.length){ const e=document.createElement("div"); e.className="sh-empty"; e.textContent="No sheet added yet."; box.appendChild(e); }
  all.forEach((t,i)=>{
    const b=document.createElement("button"); b.type="button"; b.className="job-row";
    const l=document.createElement("span"), n=document.createElement("span"), s=document.createElement("span");
    n.className="sh-n"; n.textContent=sheetName(t);
    const q=outboxOf(t).length, last=i===0?db.lastSync:t.last;
    s.className="sh-s"+(t.err?" err":"");
    s.textContent=(i===0?"Main":"Backup")+" · "+(t.err?t.err:(!c.enabled?"Auto-sync is off":q?q+" waiting":last?"Synced "+fmtTime(last):"Ready"));
    l.appendChild(n); l.appendChild(s); b.appendChild(l);
    const ch=document.createElement("i"); ch.textContent="›"; ch.setAttribute("aria-hidden","true"); b.appendChild(ch);
    b.onclick=()=>openSheet(t); box.appendChild(b);
  });
  const add=$("sheetAdd"); if(add){ const full=all.length>=5; add.disabled=full; add.textContent=full?"5 sheets is the limit":(all.length?"Add another sheet":"Add a sheet"); }
}
function updateSyncToggle(){
  const b=$("syncToggle");
  if(b){ const on=!!syncCfg().enabled; b.setAttribute("aria-checked",on?"true":"false"); }
}
// ---------- /Google Sheets sync ----------

// modal
let editingId=null;
let missLater=new Set(), missCur=null, missCtx=null;
const markPlanDone=k=>{ (db.planDone=db.planDone||{})[k]=true; };
function showMissed(){
  if($("missBg").classList.contains("open") || document.querySelector(".modal-bg.open") || !$("lockScreen").hidden || document.body.classList.contains("fs-open")) return;
  const q=missedList().filter(m=>!missLater.has(m.k)); if(!q.length) return;
  missCur=q[0]; const m=missCur;
  $("missMsg").textContent=fmtDay(m.S)+" \u00b7 "+fmtTime(m.S)+" \u2013 "+fmtTime(m.E)+(hasJobs()?" \u00b7 "+jobName(m.plan.job):"")+(q.length>1?"   ("+q.length+" to check)":"");
  $("missBg").classList.add("open"); }
function closeMiss(){ $("missBg").classList.remove("open"); setTimeout(showMissed,200); }
$("missYes").onclick=()=>{ const m=missCur; if(!m) return; const ns=mkShift(m.S,m.E,m.plan.job); db.shifts.push(ns); markPlanDone(m.k); save(); queueSync({action:"upsert", shift:shiftPayload(ns)}); render(); closeMiss(); };
$("missOff").onclick=()=>{ const m=missCur; if(!m) return; (db.daysOff=db.daysOff||{})[m.dk]=1; save(); render(); queueMeta(); closeMiss(); };
$("missSkip").onclick=()=>{ const m=missCur; if(!m) return; markPlanDone(m.k); save(); render(); closeMiss(); };
$("missLater").onclick=()=>{ missedList().forEach(m=>missLater.add(m.k)); $("missBg").classList.remove("open"); };
$("missDiff").onclick=()=>{ const m=missCur; if(!m) return; $("missBg").classList.remove("open"); missCtx=m.k; openModal(null);
  const t2=ts=>{ const x=new Date(ts); return String(x.getHours()).padStart(2,"0")+":"+String(x.getMinutes()).padStart(2,"0"); };
  $("fDate").value=m.dk; $("fIn").value=t2(m.S); $("fOut").value=t2(m.E); if(!$("fJobF").hidden) $("fJob").value=m.plan.job||""; $("fRate").value=rateAt(m.plan.job,m.S); };
function renderShiftLoc(shift){
  const box=$("fLoc"); box.textContent=""; box.hidden=!(shift && (shift.pin||shift.pout)); if(box.hidden) return;
  [["pin","Clocked in"],["pout","Clocked out"]].forEach(([k,lab])=>{
    const row=document.createElement("div"), b=document.createElement("b"), sp=document.createElement("span"); row.className="floc-r"; b.textContent=lab; row.appendChild(b);
    const p=placeParts(shift[k]);
    if(!p){ sp.textContent=shift.end||k==="pin"?"No location saved":"Not clocked out yet"; row.appendChild(sp); box.appendChild(row); return; }
    const d=distFromWork(shift,k);
    sp.textContent=p.la.toFixed(5)+", "+p.lo.toFixed(5)+" (\u00b1"+p.ac+" m)"+(d!==""?" \u00b7 "+fmtDist(d)+" from work":""); row.appendChild(sp);
    const a=document.createElement("a"); a.textContent="Map"; a.href="https://maps.apple.com/?ll="+p.la+","+p.lo+"&q="+encodeURIComponent(lab); a.target="_blank"; a.rel="noopener noreferrer"; row.appendChild(a); box.appendChild(row); });
}
function openModal(shift){
  editingId = shift ? shift.id : null;
  $("modalTitle").textContent = shift ? "Edit shift" : "Add shift";
  const d = shift ? new Date(shift.start) : new Date();
  $("fDate").value = dayKey(shift?shift.start:Date.now());
  const t2 = ts => { const x=new Date(ts); return String(x.getHours()).padStart(2,"0")+":"+String(x.getMinutes()).padStart(2,"0"); };
  $("fIn").value = shift ? t2(shift.start) : "";
  $("fOut").value = (shift && shift.end) ? t2(shift.end) : "";
  fillJobSelect($("fJob"), shift?shift.job:db.activeJob); $("fJobF").hidden=!hasJobs();
  $("fBrk").value = (shift && shift.brk!=null) ? shift.brk : ""; $("fBrkPaid").value = (shift && shift.bp) ? "1" : ""; $("fTip").value = (shift && shift.tip) ? shift.tip : ""; $("fNote").value = (shift && shift.note) ? shift.note : ""; $("fRate").value = shift ? rateOf(shift) : rateAt(db.activeJob, Date.now());
  $("modalDelete").style.display = shift ? "" : "none"; renderShiftLoc(shift);
  $("modalBg").classList.add("open");
}
$("modalDelete").onclick=async()=>{
  const id=editingId, gone=db.shifts.find(s=>s.id===id); if(!gone) return;
  if(!await askConfirm("Delete this shift?", fmtDate(gone.start)+" · "+fmtTime(gone.start)+(gone.end?" – "+fmtTime(gone.end):"")+". You can undo right after.", "Delete", true)) return;
  closeModal(); db.shifts=db.shifts.filter(s=>s.id!==id); save(); render(); queueSync({action:"delete", id:id});
  showUndo("Shift deleted.", ()=>{ db.shifts.push(gone); save(); render(); if(gone.end) queueSync({action:"upsert", shift:shiftPayload(gone)}); });
};
function closeModal(){ $("modalBg").classList.remove("open"); editingId=null; if(missCtx){ missLater.add(missCtx); missCtx=null; } }
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
  const rv=parseFloat($("fRate").value), jobV=$("fJobF").hidden?undefined:($("fJob").value||undefined), rateV=(Number.isFinite(rv)&&rv>=0)?Math.min(rv,100000):rateAt(jobV,start);
  const noteV=cleanText($("fNote").value,80), bkv=parseInt($("fBrk").value,10), brkV=(Number.isFinite(bkv)&&bkv>=0)?Math.min(bkv,720):null;
  if(editingId){ const s=db.shifts.find(x=>x.id===editingId); s.start=start; s.end=end; if(tipV) s.tip=tipV; else delete s.tip; if(noteV) s.note=noteV; else delete s.note; s.rate=rateV; if(brkV!=null){ s.brk=brkV; if($("fBrkPaid").value) s.bp=1; else delete s.bp; } else { delete s.brk; delete s.bp; } if(!$("fJobF").hidden){ if(jobV) s.job=jobV; else delete s.job; } queueSync({action:"upsert", shift:shiftPayload(s)}); }
  else { const ns={id:uid(), start, end}; if(tipV) ns.tip=tipV; if(noteV) ns.note=noteV; ns.rate=rateV; if(brkV!=null){ ns.brk=brkV; if($("fBrkPaid").value) ns.bp=1; } if(jobV) ns.job=jobV; db.shifts.push(ns); queueSync({action:"upsert", shift:shiftPayload(ns)}); }
  if(missCtx){ markPlanDone(missCtx); missCtx=null; }
  save(); closeModal(); render(); setTimeout(showMissed,300);
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
let cfmResolve=null;
let cfmLock=false;
function askConfirm(title,msg,yesLabel,danger,noLabel,center){
  return new Promise(res=>{
    if(cfmResolve) cfmResolve(false);
    cfmResolve=res; $("cfmTitle").textContent=title; $("cfmMsg").textContent=msg||""; $("cfmYes").textContent=yesLabel||"Confirm"; $("cfmNo").textContent=noLabel||"Cancel"; cfmLock=!!noLabel&&!center;
    $("cfmYes").classList.toggle("danger-btn",!!danger); $("cfmBg").classList.toggle("center",!!center); $("cfmBg").classList.add("open"); setTimeout(()=>{ try{ $("cfmNo").focus(); }catch(e){} },60); });
}
function cfmDone(v){ $("cfmBg").classList.remove("open"); const r=cfmResolve; cfmResolve=null; if(r) r(v); }
$("cfmYes").onclick=()=>cfmDone(true); $("cfmNo").onclick=()=>cfmDone(false);
$("cfmBg").addEventListener("click",e=>{ if(e.target===$("cfmBg") && !cfmLock) cfmDone(false); });
document.addEventListener("keydown",e=>{ if(e.key==="Escape" && cfmResolve) cfmDone(false); });
function hideUndo(){ const b=$("undoBar"); clearTimeout(undoTimer); undoFn=null; if(b.hidden) return; b.classList.add("out"); setTimeout(()=>{ if(!undoFn){ b.hidden=true; } b.classList.remove("out"); b.style.transform=""; b.style.opacity=""; },220); }
function showUndo(msg, fn){ const b=$("undoBar"); undoFn=fn; $("undoTxt").textContent=msg; b.classList.remove("out"); b.style.transform=""; b.style.opacity=""; b.hidden=false; clearTimeout(undoTimer); undoTimer=setTimeout(hideUndo,6000); const ub=b.querySelector(".ub-bar"); if(ub){ ub.style.animation="none"; void ub.offsetWidth; ub.style.animation=""; } }
// swipe any pop-up notice left or right to clear it (hold it to keep it on screen)
function swipeAway(b, onHold, onGone, onBack){ let x0=null, dx=0, id=null;
  b.addEventListener("pointerdown",e=>{ if(e.target.closest("button")) return; x0=e.clientX; dx=0; id=e.pointerId; try{ b.setPointerCapture(id); }catch(_){} b.style.transition="none"; if(onHold) onHold(); });
  b.addEventListener("pointermove",e=>{ if(x0==null||e.pointerId!==id) return; dx=e.clientX-x0; b.style.transform="translateX(calc(-50% + "+dx+"px))"; b.style.opacity=String(Math.max(0.2,1-Math.abs(dx)/200)); });
  const end=()=>{ if(x0==null) return; x0=null; b.style.transition="";
    if(Math.abs(dx)>60){ b.style.transform="translateX(calc(-50% + "+(dx>0?420:-420)+"px))"; b.style.opacity="0"; setTimeout(()=>{ b.style.transform=""; b.style.opacity=""; },260); onGone(); }
    else { b.style.transform=""; b.style.opacity=""; if(onBack) onBack(); } };
  b.addEventListener("pointerup",end); b.addEventListener("pointercancel",end); }
swipeAway($("undoBar"), ()=>clearTimeout(undoTimer), ()=>hideUndo(), ()=>{ undoTimer=setTimeout(hideUndo,3000); });
$("undoBtn").onclick=()=>{ const f=undoFn; hideUndo(); if(f) f(); };
let toastTimer=null, toastShift=null, toastTap=0;
function hideToast(){ $("toast").hidden=true; clearTimeout(toastTimer); }
swipeAway($("toast"), ()=>clearTimeout(toastTimer), ()=>setTimeout(hideToast,200), ()=>{ toastTimer=setTimeout(hideToast,6000); });
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
function countUp(el,from,to){
  if(!(isFinite(from)&&isFinite(to))||Math.abs(to-from)<0.005||(window.matchMedia&&matchMedia("(prefers-reduced-motion: reduce)").matches)) return;
  const t0=performance.now(), D=650, fin=el.textContent;
  (function step(t){ const k=Math.min(1,(t-t0)/D), e=1-Math.pow(1-k,3); el.textContent=k<1?money(from+(to-from)*e):fin; if(k<1) requestAnimationFrame(step); })(t0);
}
// plan sheet
function closePlan(){ $("planBg").classList.remove("open"); }
let planEditId=null, planDate=null;   // planDate: the single day this plan is for (YYYY-MM-DD) when no weekdays are chosen
function openPlan(plan, dateKey){
  planEditId=plan?plan.id:null; planDate=(plan&&plan.once)||dateKey||dayKey(Date.now());
  const isToday=planDate===dayKey(Date.now());
  $("planTitle").textContent=plan?"Edit planned shift":"Plan a shift";
  $("planStart").value=plan?plan.start:"15:00"; $("planEnd").value=plan?plan.end:"23:00";
  document.querySelectorAll("#planDays button").forEach(b=>b.classList.toggle("on", !!(plan&&plan.days&&plan.days.includes(Number(b.dataset.d)))));
  $("planRepeatL").textContent="Repeat weekly on (leave empty for "+(isToday?"today":fmtDay(new Date(planDate+"T12:00:00").getTime()))+" only)";
  fillJobSelect($("planJob"), plan?plan.job:db.activeJob); $("planJobF").hidden=!(db.jobs&&db.jobs.length);
  $("planRemove").style.display=plan?"":"none"; $("planBg").classList.add("open"); }
$("planBtn").onclick=()=>{ const pls=db.plans||[];
  if(pls.length>1){ document.querySelector('.tabbar button[data-tab="calendar"]').click(); return; }
  openPlan(pls[0]||null, dayKey(Date.now())); };
document.querySelectorAll("#planDays button").forEach(b=>b.onclick=()=>b.classList.toggle("on"));
$("planCancel").onclick=closePlan;
$("planBg").addEventListener("click",e=>{ if(e.target===$("planBg")) closePlan(); });
$("planRemove").onclick=async()=>{ if(!await askConfirm("Remove this planned shift?","It will no longer show on your calendar or ask about this shift. Shifts already logged stay.","Remove",true)) return;
  const gonePlan=(db.plans||[]).find(p=>p.id===planEditId);
  db.plans=(db.plans||[]).filter(p=>p.id!==planEditId); if(!db.plans.length) delete db.plans; save(); closePlan(); render(); queueMeta();
  if(gonePlan) showUndo("Planned shift removed.", ()=>{ (db.plans=db.plans||[]).push(gonePlan); save(); render(); queueMeta(); }); };
$("planSave").onclick=async()=>{
  const days=[...document.querySelectorAll("#planDays button.on")].map(b=>Number(b.dataset.d));
  const job=$("planJobF").hidden?undefined:($("planJob").value||undefined);
  const plan=cleanPlan({id:planEditId||undefined, start:$("planStart").value, end:$("planEnd").value, days:days, once:planDate, job:job});
  if(!plan){ alert("Pick a start and an end time that are different."); return; }
  const todayK=dayKey(Date.now());
  if(!days.length && planDate<todayK){ alert("Pick today or a day in the future."); return; }
  db.planDone=db.planDone||{};
  const prev=(db.plans||[]).find(p=>p.id===planEditId); plan.since=(prev&&prev.since)||todayK;
  if(planEditId) Object.keys(db.planDone).forEach(k=>{ if(k.startsWith(planEditId+":") && k.split(":").pop()>=todayK) delete db.planDone[k]; });
  db.plans=(db.plans||[]).filter(p=>p.id!==plan.id); db.plans.push(plan);
  save(); closePlan(); render(); queueMeta(); };
sheetDrag($("planBg"), closePlan);
setInterval(()=>{ if(!document.hidden){ if(applyPlan()) render(); showMissed(); } }, 20000);
document.addEventListener("visibilitychange",()=>{ if(!document.hidden){ if(applyPlan()) render(); setTimeout(showMissed,400); } });
$("fsOut").onclick=()=>{ Promise.resolve($("clockBtn").onclick()).then(()=>{ if(!openShift()) hideFs(); }); };
function minimiseFs(){ const el=$("fsClock"); if(el.hidden) return; document.body.classList.remove("fs-open"); el.classList.add("dragging"); el.style.transition="transform .32s cubic-bezier(.3,.8,.3,1)"; el.style.transform="translateY(-104%)"; setTimeout(hideFs,320); }
$("fsMin").onclick=minimiseFs;
(function(){ const el=$("fsClock"); let y0=null, id=null, dy=0, drag=false, t0=0;
  el.addEventListener("pointerdown",e=>{ y0=e.clientY; id=e.pointerId; dy=0; drag=false; t0=Date.now(); });
  el.addEventListener("pointermove",e=>{ if(y0==null||e.pointerId!==id) return; const d=e.clientY-y0;
    if(!drag){ if(d<-10){ drag=true; try{ el.setPointerCapture(id); }catch(_){ } document.body.classList.remove("fs-open"); el.classList.add("dragging"); el.style.transition="none"; } else return; }
    dy=Math.min(0,d); el.style.transform="translateY("+dy+"px)"; });
  const end=()=>{ if(y0==null) return; const was=drag; y0=null; if(!was) return; drag=false;
    const v=dy/Math.max(1,Date.now()-t0);
    if(dy<-window.innerHeight*0.45 || (v<-1.5 && dy<-window.innerHeight*0.25)){ el.style.transition="transform .28s cubic-bezier(.3,.8,.3,1)"; el.style.transform="translateY(-104%)"; setTimeout(hideFs,280); }
    else { el.style.transition="transform .42s cubic-bezier(.34,1.5,.5,1)"; el.style.transform="translateY(0)"; setTimeout(()=>{ el.style.transition=""; el.style.transform=""; el.classList.remove("dragging"); if(!el.hidden) document.body.classList.add("fs-open"); },430); } };
  el.addEventListener("pointerup",end); el.addEventListener("pointercancel",end);
})();
document.addEventListener("keydown",e=>{ if(e.key==="Escape" && !$("fsClock").hidden) hideFs(); });
$("statusLine").addEventListener("click",()=>{ if(openShift()) showFs(); });
function openStart(){ const s=openShift(); if(!s) return; const d=new Date(s.start); $("startTime").value=String(d.getHours()).padStart(2,"0")+":"+String(d.getMinutes()).padStart(2,"0"); $("startBg").classList.add("open"); }
const closeStart=()=>$("startBg").classList.remove("open");
$("startEdit").onclick=openStart; $("startCancel").onclick=closeStart;
$("startBg").addEventListener("click",e=>{ if(e.target===$("startBg")) closeStart(); }); sheetDrag($("startBg"), closeStart);
$("startQuick").addEventListener("click",e=>{ const b=e.target.closest("button"); if(!b) return; const s=openShift(); if(!s) return; const d=new Date(s.start-Number(b.dataset.m)*60000);
  $("startTime").value=String(d.getHours()).padStart(2,"0")+":"+String(d.getMinutes()).padStart(2,"0"); });
$("startSave").onclick=()=>{ const s=openShift(), v=$("startTime").value; if(!s||!HM_RE.test(v)){ closeStart(); return; }
  const o=new Date(s.start), [hh,mm]=v.split(":").map(Number), c=new Date(o); c.setHours(hh,mm,0,0); let cand=c.getTime();
  if(cand>Date.now()) cand-=86400000;
  if(cand>=Date.now()){ alert("The start time has to be before now."); return; }
  if(Date.now()-cand>24*3600000){ alert("That's more than 24 hours ago. Use Add shift for older work."); return; }
  if(db.shifts.some(x=>x!==s && x.end && x.end>cand && x.start<Date.now())){ alert("That overlaps another shift you logged."); return; }
  if(dayKey(cand)!==dayKey(s.start)) s.rate=rateAt(s.job,cand);
  s.start=cand; save(); closeStart(); render(); tickFs(); };
$("histQ").addEventListener("input",e=>{ histQ=e.target.value; render(); });
// hours / amount filter pop-up
function hfRead(){ const n=id=>{ const v=parseFloat($(id).value); return Number.isFinite(v)&&v>=0?v:null; };
  histF.hMin=n("hfHMin"); histF.hMax=n("hfHMax"); histF.aMin=n("hfAMin"); histF.aMax=n("hfAMax"); }
function hfPaint(){ const n=hfActive(), b=$("histFilterN"); b.hidden=!n; b.textContent=n; $("histFilterBtn").classList.toggle("on",!!n);
  const c=db.shifts.filter(s=>s.end&&jobOk(s,histJob)&&(histMonth==="all"||monthKey(s.start)===histMonth)&&(!histQ.trim()||histSearchOk(s,histQ.trim().toLowerCase()))&&histRangeOk(s)).length;
  $("hfCount").textContent=c+" shift"+(c===1?"":"s")+" match"+(n?"":" (no filters on)"); }
$("histFilterBtn").onclick=()=>{ $("hfHMin").value=histF.hMin??""; $("hfHMax").value=histF.hMax??""; $("hfAMin").value=histF.aMin??""; $("hfAMax").value=histF.aMax??""; hfPaint(); $("hfBg").classList.add("open"); };
["hfHMin","hfHMax","hfAMin","hfAMax"].forEach(id=>$(id).addEventListener("input",()=>{ hfRead(); hfPaint(); render(); }));
$("hfReset").onclick=()=>{ ["hfHMin","hfHMax","hfAMin","hfAMax"].forEach(id=>$(id).value=""); hfRead(); hfPaint(); render(); };
const hfClose=()=>{ $("hfBg").classList.remove("open"); try{ document.activeElement.blur(); }catch(e){} };
$("hfClose").onclick=hfClose; $("hfBg").addEventListener("click",e=>{ if(e.target===$("hfBg")) hfClose(); }); if(typeof sheetDrag==="function") sheetDrag($("hfBg"), hfClose);
$("histMonth").addEventListener("change",e=>{ histMonth=e.target.value; render(); hfPaint(); });
$("nudgeNow").onclick=()=>{ $("jsonBtn").click(); };
$("nudgeSync").onclick=()=>{ document.querySelector('[data-tab="settings"]').click(); if(!syncCfg().url) setTimeout(()=>openSheet(null),50); };
$("nudgeLater").onclick=()=>{ db.nudgeAt=Date.now(); save(); updateNudge(); };

// ---------- Where you clocked in and out: checked only at the moment you tap, never tracked in the background ----------
function locOn(){ return !(db.loc && db.loc.on===0); }
function locFor(job){ return locOn() && !!(db.loc && db.loc.at && db.loc.at[job||""]===1); }
function getPos(ms){
  return new Promise(res=>{
    if(!navigator.geolocation) return res({err:"unsupported"});
    let done=false; const fin=r=>{ if(!done){ done=true; clearTimeout(t); res(r); } }, t=setTimeout(()=>fin({err:"timeout"}), (ms||9000)+1500);
    try{ navigator.geolocation.getCurrentPosition(p=>{ const c=p.coords, la=Number(c.latitude), lo=Number(c.longitude);
        if(!isFinite(la)||!isFinite(lo)) return fin({err:"unavailable"});
        fin({s:la.toFixed(5)+","+lo.toFixed(5)+","+Math.min(99999,Math.max(1,Math.round(c.accuracy||0)))}); },
      e=>fin({err:e&&e.code===1?"denied":e&&e.code===3?"timeout":"unavailable"}), {enableHighAccuracy:true, timeout:ms||9000, maximumAge:0}); }catch(e){ fin({err:"unavailable"}); }
  });
}
function placeParts(v){ const m=PLACE_RE.exec(String(v||"")); return m&&placeOk(v)?{la:+m[1],lo:+m[2],ac:+m[3]}:null; }
function distM(a,b){ const R=6371000, rad=x=>x*Math.PI/180, dLa=rad(b.la-a.la), dLo=rad(b.lo-a.lo);
  const h=Math.sin(dLa/2)**2+Math.cos(rad(a.la))*Math.cos(rad(b.la))*Math.sin(dLo/2)**2; return 2*R*Math.asin(Math.min(1,Math.sqrt(h))); }
function workPlace(job){ const w=db.loc&&db.loc.work; return w?placeParts(w[job||""]):null; }
function distFromWork(s,key){ const p=placeParts(s&&s[key]), w=workPlace(s&&s.job); return p&&w?Math.round(distM(p,w)):""; }
function fmtDist(m){ if(m>=1000) return (m/1000).toFixed(1)+" km"; const st=m<100?1:5; return Math.max(1,Math.round(m/st)*st)+" m"; }
function placeNote(s,key){   // "Location saved · 30 m from work"
  const p=placeParts(s[key]); if(!p) return ""; const d=distFromWork(s,key);
  return "Location saved"+(d!==""?" \u00b7 "+fmtDist(d)+" from work":""); }
function locFail(e){ return e==="denied"?"Location is blocked for Work Clock":"Couldn\u2019t get a location"; }
function setLocNote(key,txt,id){
  if(key==="pin"){ const el=$("fsLoc"); if(el){ el.textContent=txt||""; el.hidden=!txt; } }
  else if(key==="pout" && toastShift===id && !$("toast").hidden && txt){ $("toastTxt").textContent=$("toastTxt").textContent.replace(/ \u00b7 [^\u00b7]*$/,"")+" \u00b7 "+txt; }
}
async function stampPlace(id,key){
  const s0=db.shifts.find(x=>x.id===id);
  if(!locFor(s0&&s0.job)) return setLocNote(key,"",id);
  setLocNote(key,"Getting location\u2026",id);
  const r=await getPos(), s=db.shifts.find(x=>x.id===id);
  if(!r.s){ setLocNote(key,locFail(r.err),id); return; }
  if(!s) return;
  s[key]=r.s; save(); setLocNote(key,placeNote(s,key),id); render(); if(s.end) queueSync({action:"upsert", shift:shiftPayload(s)});
}
try{ if(navigator.storage && navigator.storage.persist) navigator.storage.persist(); }catch(e){}
function doClock(){
  try{ if(navigator.vibrate) navigator.vibrate(18); }catch(e){}
  { const b=$("clockBtn"); b.classList.remove("pop"); void b.offsetWidth; b.classList.add("pop"); }
  const open=openShift();
  if(open){ const fromTxt=$("heroEarn").textContent; open.end=Date.now(); save(); render(); countUp($("heroEarn"), parseFloat(fromTxt.replace(/[^0-9.]/g,"")), parseFloat($("heroEarn").textContent.replace(/[^0-9.]/g,""))); queueSync({action:"upsert", shift:shiftPayload(open)});
    toastShift=open.id; toastTap=open.end; $("toastTxt").textContent="Clocked out at "+fmtTime(open.end)+"."; $("toast").hidden=false; clearTimeout(toastTimer); toastTimer=setTimeout(hideToast,20000); stampPlace(open.id,"pout"); }
  else { const ns=mkShift(Date.now(), null, db.activeJob); db.shifts.push(ns); save(); render(); showFs(); stampPlace(ns.id,"pin"); }
}
// planned shifts: ask before starting 5+ minutes late, or clocking out before the planned end
const PLAN_SLACK=5*60000, hmOf=ts=>{ const d=new Date(ts); return String(d.getHours()).padStart(2,"0")+":"+String(d.getMinutes()).padStart(2,"0"); };
function lateAsk(t){ return new Promise(res=>{ const now=Date.now();
  $("lateMsg").textContent="Your shift was planned for "+fmtTime(t.S)+". That was "+brkText(Math.round((now-t.S)/60000))+" ago. Start the clock now, or set the time you really started.";
  const done=v=>{ $("lateBg").classList.remove("open"); res(v); };
  $("lateGo").onclick=()=>done("now"); $("lateEdit").onclick=()=>done("edit"); $("lateNo").onclick=()=>done("cancel"); $("lateBg").onclick=e=>{ if(e.target===$("lateBg")) done("cancel"); };
  $("lateBg").classList.add("open"); }); }
$("clockBtn").onclick=async(ev,skipAsk)=>{
  const open=openShift(), now=Date.now();
  if(open){ const t=planOf(open);
    const early=t && now<t.E-PLAN_SLACK, left=early?brkText(Math.round((t.E-now)/60000)):"";
    if(!skipAsk && !await askConfirm("Are you sure?", early?"You're about to clock out. Your planned shift ends at "+fmtTime(t.E)+", and there's still "+left+" left.":"You're about to clock out.", "Yes", false, "No", true)) return;
    return doClock(); }
  const t=planOf({start:now, job:db.activeJob});
  if(t && now>t.S+PLAN_SLACK && !db.shifts.some(x=>(x.job||"")===(db.activeJob||"") && x.start>=t.S-2*3600000 && x.start<t.E)){
    const c=await lateAsk(t); if(c==="cancel") return;
    doClock(); if(c==="edit"){ openStart(); $("startTime").value=hmOf(t.S); }
    return; }
  doClock();
};
$("cancelShift").onclick=async()=>{ if(await askConfirm("Discard this shift?","The shift you're clocked into will be thrown away, not saved.","Discard",true)){
  const gone=openShift(); db.shifts=db.shifts.filter(s=>s.end); save(); render(); hideFs();
  if(gone) showUndo("Shift discarded.", ()=>{ if(!openShift()){ db.shifts.push(gone); save(); render(); } }); }};

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
for(const [id,key,max,dp] of [["otWeekInput","otWeek",168,1],["otDayInput","otDay",24,1],["otPctInput","otPct",300,1],["holInput","holPct",300,1]]){
  $(id).addEventListener("change",e=>{ const v=parseFloat(e.target.value), k=Math.pow(10,dp);
    if(v>0){ db[key]=Math.round(Math.min(v,max)*k)/k; } else delete db[key];
    save(); render(); queueMeta(); }); }
$("netInput").addEventListener("change",e=>{ if(e.target.value) db.netTrack=1; else delete db.netTrack; save(); render(); queueMeta(); });
$("cycleInput").addEventListener("change",e=>{ const v=e.target.value; if(v) db.payCycle=v; else { delete db.payCycle; delete db.payday; delete db.payAnchor; }
  if(v==="weekly"||v==="biweekly") delete db.payday; save(); render(); queueMeta(); queueSettings(); });
$("anchorInput").addEventListener("change",e=>{ const v=e.target.value; if(DAY_RE.test(v)) db.payAnchor=v; else delete db.payAnchor; save(); render(); queueMeta(); });
for(const [id,key,max,dp] of [["wkndInput","wkndPct",300,1],["taxInput","taxPct",60,1],["mileInput","mileRate",10,3]]){
  $(id).addEventListener("change",e=>{ const v=parseFloat(e.target.value), k=Math.pow(10,dp);
    if(v>0){ db[key]=Math.round(Math.min(v,max)*k)/k; } else delete db[key]; save(); render(); queueMeta(); }); }
function closeRate(){ $("rateBg").classList.remove("open"); pendingRate=null; $("rateInput").value=db.rate; }
$("rateCancel").onclick=closeRate;
$("rateBg").addEventListener("click",e=>{ if(e.target===$("rateBg")) closeRate(); });
$("rateSave").onclick=()=>{
  if(pendingRate==null) return closeRate();
  const f=$("rateFrom").value; if(!f){ alert("Pick the day the new rate starts."); return; }
  const from=new Date(f+"T00:00:00").getTime(); if(from>Date.now()){ alert("The start day can't be in the future."); return; }
  stampRates();                                              // lock everything to the old rate first
  db.rate=pendingRate;
  // then move this job's shifts from that day onward (weekend premium kept)
  db.shifts.forEach(s=>{ if(!s.job && s.start>=from) s.rate=rateAt(null, s.start); });
  pendingRate=null; save(); $("rateBg").classList.remove("open"); render(); queueSettings(); queueRestamp();
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
$("jsonBtn").onclick=()=>{ db.lastBackup=Date.now(); save(); updateNudge(); }; $("jsonBtn").addEventListener("click",()=>download("workclock-backup.json",JSON.stringify({rate:db.rate, goal:db.goal, theme:db.theme, anaPeriod:db.anaPeriod, payday:db.payday, breakMin:db.breakMin, breakAfter:db.breakAfter, shifts:db.shifts, payments:db.payments||[], jobs:db.jobs, jobName:db.jobName, wkndPct:db.wkndPct, taxPct:db.taxPct, mileRate:db.mileRate, otWeek:db.otWeek, otDay:db.otDay, otPct:db.otPct, holPct:db.holPct, holidays:db.holidays, netTrack:db.netTrack, payCycle:db.payCycle, payAnchor:db.payAnchor, plans:db.plans, daysOff:db.daysOff, expenses:db.expenses},null,2),"application/json"));  // never includes sync URL/secret
$("importBtn").onclick=()=>$("importFile").click();
$("importFile").addEventListener("change",e=>{
  const f=e.target.files[0]; if(!f) return;
  if(f.size>5e6){ alert("That file is too large to be a Work Clock backup."); e.target.value=""; return; }
  const r=new FileReader();
  r.onload=async()=>{ try{ const d=JSON.parse(r.result);
      if(!d || !Array.isArray(d.shifts)||typeof d.rate!=="number") throw 0;
      const clean=cleanCore(d), skipped=d.shifts.length-clean.shifts.length;
      if(await askConfirm("Replace your data?","Your current shifts and payments will be replaced by this backup ("+clean.shifts.length+" shifts, "+clean.payments.length+" payments"+(skipped>0?", "+skipped+" invalid skipped":"")+").","Replace",true)){
        // only shifts + display prefs come from a file; sync, secret and lock settings always stay as they are
        db=Object.assign(clean,{sync:db.sync, outbox:db.outbox, lastSync:db.lastSync, lock:db.lock, loc:db.loc, profile:db.profile}); save(); render(); }
    }catch(_){ alert("That file doesn't look like a Work Clock backup."); } };
  r.readAsText(f); e.target.value="";
});
$("wipeBtn").onclick=async()=>{ if(await askConfirm("Delete all data?","Every shift and payment on this phone will be erased. You get a few seconds to undo it afterwards, so back up first if you're not sure.","Delete everything",true)){
  const keep={rate:db.rate, goal:db.goal, payday:db.payday, breakMin:db.breakMin, breakAfter:db.breakAfter, jobs:db.jobs, jobName:db.jobName, wkndPct:db.wkndPct, taxPct:db.taxPct, mileRate:db.mileRate, otWeek:db.otWeek, otDay:db.otDay, otPct:db.otPct, holPct:db.holPct, holidays:db.holidays, netTrack:db.netTrack, payCycle:db.payCycle, payAnchor:db.payAnchor, activeJob:db.activeJob, theme:db.theme, anaPeriod:db.anaPeriod, sync:db.sync, lock:db.lock, loc:db.loc, profile:db.profile};
  const snapAll=JSON.stringify(Object.assign({},db,{sync:undefined, lock:undefined, outbox:undefined, loc:undefined, profile:undefined}));
  db=Object.assign({shifts:[], outbox:[]}, keep); mirrors().forEach(m=>{ m.outbox=[]; }); save(); render(); updateSyncStatus();
  showUndo("All data deleted.", ()=>{ const o=JSON.parse(snapAll); db=Object.assign(o,{sync:db.sync, lock:db.lock, outbox:db.outbox, lastSync:db.lastSync, loc:db.loc, profile:db.profile}); save(); render(); updateSyncStatus();
    const l=(o.shifts||[]).filter(x=>x.end).map(x=>shiftPayload(x)); if(l.length) queueSync({action:"bulk", shifts:l}); (o.payments||[]).forEach(p=>queueSync({action:"pupsert", payment:payPayload(p)})); queueMeta(); }); }};


// ---------- Profile circle: initials, your photo, or a cute animal; it "types" while you're clocked in ----------
const ANIMALS=[["lion","Lion"],["cat","Cat"],["fox","Fox"],["panda","Panda"],["bunny","Bunny"],["penguin","Penguin"]];
const AV_SVG={
 lion:'<rect width="100" height="100" fill="#ffe7b0"/><g class="a-head"><circle cx="50" cy="56" r="38" fill="#e59a3d"/><circle cx="27" cy="27" r="9" fill="#f2b25a"/><circle cx="27" cy="27" r="4.6" fill="#ffd9b0"/><circle cx="73" cy="27" r="9" fill="#f2b25a"/><circle cx="73" cy="27" r="4.6" fill="#ffd9b0"/><circle cx="50" cy="58" r="27" fill="#ffd694"/><ellipse cx="50" cy="68" rx="13" ry="10" fill="#fff0d2"/><g class="a-eyes"><circle cx="40" cy="54" r="3.7" fill="#3a2a22"/><circle cx="60" cy="54" r="3.7" fill="#3a2a22"/><circle cx="41.2" cy="52.8" r="1.2" fill="#fff"/><circle cx="61.2" cy="52.8" r="1.2" fill="#fff"/></g><path d="M46 62h8l-4 4z" fill="#c2603a"/><path d="M50 66v3M50 69q-4 4-8 1M50 69q4 4 8 1" stroke="#7a4a32" stroke-width="1.6" fill="none" stroke-linecap="round"/><ellipse cx="33" cy="64" rx="4.5" ry="3" fill="#ff9d8a" opacity=".65"/><ellipse cx="67" cy="64" rx="4.5" ry="3" fill="#ff9d8a" opacity=".65"/></g>',
 cat:'<rect width="100" height="100" fill="#d3e3ff"/><g class="a-head"><path d="M22 44L27 14L47 31Z" fill="#9ca8bf"/><path d="M28 36L30 22L40 31Z" fill="#ffb6c8"/><path d="M78 44L73 14L53 31Z" fill="#9ca8bf"/><path d="M72 36L70 22L60 31Z" fill="#ffb6c8"/><ellipse cx="50" cy="60" rx="31" ry="27" fill="#b6c0d5"/><path d="M50 36v8M43 37l2 7M57 37l-2 7" stroke="#8f9bb4" stroke-width="2.4" stroke-linecap="round"/><g class="a-eyes"><ellipse cx="38" cy="58" rx="4" ry="5" fill="#2b2f45"/><ellipse cx="62" cy="58" rx="4" ry="5" fill="#2b2f45"/><circle cx="39.4" cy="56.2" r="1.4" fill="#fff"/><circle cx="63.4" cy="56.2" r="1.4" fill="#fff"/></g><path d="M47 66h6l-3 3.2z" fill="#ff8fa8"/><path d="M50 69q-3 4-7 2M50 69q3 4 7 2" stroke="#6b5a6b" stroke-width="1.5" fill="none" stroke-linecap="round"/><path d="M24 66l-12-2M24 70l-12 3M76 66l12-2M76 70l12 3" stroke="#fff" stroke-width="1.5" stroke-linecap="round" opacity=".85"/><ellipse cx="31" cy="68" rx="4" ry="2.8" fill="#ff9fb4" opacity=".6"/><ellipse cx="69" cy="68" rx="4" ry="2.8" fill="#ff9fb4" opacity=".6"/></g>',
 fox:'<rect width="100" height="100" fill="#ffe3d3"/><g class="a-head"><path d="M20 46L25 12L47 30Z" fill="#ee7b38"/><path d="M26 36L28 21L40 30Z" fill="#4a3328"/><path d="M80 46L75 12L53 30Z" fill="#ee7b38"/><path d="M74 36L72 21L60 30Z" fill="#4a3328"/><ellipse cx="50" cy="58" rx="31" ry="27" fill="#f28c47"/><path d="M19 62Q36 80 50 86Q64 80 81 62Q66 70 50 70Q34 70 19 62Z" fill="#fff3e6"/><g class="a-eyes"><ellipse cx="38" cy="56" rx="3.6" ry="4.4" fill="#2a1f1f"/><ellipse cx="62" cy="56" rx="3.6" ry="4.4" fill="#2a1f1f"/><circle cx="39.2" cy="54.6" r="1.2" fill="#fff"/><circle cx="63.2" cy="54.6" r="1.2" fill="#fff"/></g><circle cx="50" cy="70" r="3.3" fill="#2a1f1f"/><path d="M50 73q-3 3.5-6 1.5M50 73q3 3.5 6 1.5" stroke="#6b3d28" stroke-width="1.4" fill="none" stroke-linecap="round"/><ellipse cx="30" cy="66" rx="4" ry="2.8" fill="#ff9d8a" opacity=".55"/><ellipse cx="70" cy="66" rx="4" ry="2.8" fill="#ff9d8a" opacity=".55"/></g>',
 panda:'<rect width="100" height="100" fill="#dff4e4"/><g class="a-head"><circle cx="25" cy="28" r="10.5" fill="#2c2c36"/><circle cx="75" cy="28" r="10.5" fill="#2c2c36"/><ellipse cx="50" cy="58" rx="32" ry="29" fill="#fff"/><ellipse cx="36" cy="55" rx="7.5" ry="9.5" transform="rotate(22 36 55)" fill="#2c2c36"/><ellipse cx="64" cy="55" rx="7.5" ry="9.5" transform="rotate(-22 64 55)" fill="#2c2c36"/><g class="a-eyes"><circle cx="37" cy="55" r="3.3" fill="#fff"/><circle cx="63" cy="55" r="3.3" fill="#fff"/><circle cx="37.4" cy="55.4" r="1.9" fill="#111"/><circle cx="62.6" cy="55.4" r="1.9" fill="#111"/></g><ellipse cx="50" cy="66" rx="4.4" ry="3.2" fill="#2c2c36"/><path d="M50 69q-3 4-7 2M50 69q3 4 7 2" stroke="#2c2c36" stroke-width="1.5" fill="none" stroke-linecap="round"/><ellipse cx="28" cy="68" rx="4" ry="2.8" fill="#ffa7b8" opacity=".6"/><ellipse cx="72" cy="68" rx="4" ry="2.8" fill="#ffa7b8" opacity=".6"/></g>',
 bunny:'<rect width="100" height="100" fill="#fde6f1"/><g class="a-head"><ellipse cx="35" cy="26" rx="8.5" ry="21" fill="#fff"/><ellipse cx="35" cy="27" rx="4" ry="14" fill="#ffbdd2"/><ellipse cx="65" cy="26" rx="8.5" ry="21" fill="#fff"/><ellipse cx="65" cy="27" rx="4" ry="14" fill="#ffbdd2"/><ellipse cx="50" cy="63" rx="30" ry="26" fill="#fff"/><g class="a-eyes"><circle cx="39" cy="60" r="3.7" fill="#3b2a3a"/><circle cx="61" cy="60" r="3.7" fill="#3b2a3a"/><circle cx="40.2" cy="58.8" r="1.2" fill="#fff"/><circle cx="62.2" cy="58.8" r="1.2" fill="#fff"/></g><ellipse cx="50" cy="67" rx="3.2" ry="2.3" fill="#ff8fb0"/><path d="M50 69.3q-4 4-7 1M50 69.3q4 4 7 1" stroke="#a66a80" stroke-width="1.4" fill="none" stroke-linecap="round"/><rect x="47" y="72" width="6" height="5" rx="1.6" fill="#fff" stroke="#e4cfd8" stroke-width="1"/><ellipse cx="30" cy="68" rx="4.4" ry="3" fill="#ffa7c0" opacity=".65"/><ellipse cx="70" cy="68" rx="4.4" ry="3" fill="#ffa7c0" opacity=".65"/></g>',
 penguin:'<rect width="100" height="100" fill="#d9edff"/><g class="a-head"><ellipse cx="50" cy="58" rx="31" ry="31" fill="#27324f"/><circle cx="39" cy="55" r="14" fill="#fff"/><circle cx="61" cy="55" r="14" fill="#fff"/><ellipse cx="50" cy="68" rx="21" ry="14" fill="#fff"/><g class="a-eyes"><circle cx="40" cy="56" r="3.5" fill="#1b2036"/><circle cx="60" cy="56" r="3.5" fill="#1b2036"/><circle cx="41.2" cy="54.8" r="1.2" fill="#fff"/><circle cx="61.2" cy="54.8" r="1.2" fill="#fff"/></g><path d="M43 63q7-4 14 0q-7 9-14 0Z" fill="#ffa83a"/><ellipse cx="31" cy="64" rx="4" ry="2.8" fill="#ff9fb0" opacity=".65"/><ellipse cx="69" cy="64" rx="4" ry="2.8" fill="#ff9fb0" opacity=".65"/></g>'
};
const animalSvg=k=>'<svg viewBox="0 0 100 100" aria-hidden="true">'+(AV_SVG[k]||AV_SVG.lion)+'</svg>';
function profile(){ const p=db.profile||{}; return {name:p.name||"", kind:p.kind||"initials", animal:p.animal||"lion", photo:p.photo||""}; }
function initialsOf(n){ const w=String(n||"").trim().split(/\s+/).filter(Boolean); if(!w.length) return ""; const f=Array.from(w[0])[0]||"", l=w.length>1?(Array.from(w[w.length-1])[0]||""):""; return (f+l).toUpperCase(); }
function nameHue(n){ let h=0; for(const ch of String(n)) h=(h*31+ch.charCodeAt(0))%360; return h; }
function paintFace(el, kind, pf){
  el.textContent=""; el.style.background="";
  if(kind==="animal"){ el.innerHTML=animalSvg(pf.animal); return; }
  if(kind==="photo" && pf.photo){ const im=document.createElement("img"); im.alt=""; im.src=pf.photo; el.appendChild(im); return; }
  const ini=initialsOf(pf.name), h=nameHue(pf.name||"x");
  if(ini){ el.style.background="linear-gradient(135deg,hsl("+h+" 72% 58%),hsl("+((h+42)%360)+" 70% 44%))"; const s=document.createElement("span"); s.className="av-ini"; s.textContent=ini; el.appendChild(s); }
  else { el.style.background="linear-gradient(135deg,#8da2c0,#5d7396)"; el.innerHTML='<svg viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" style="width:56%;height:56%"><circle cx="12" cy="8.5" r="3.6"/><path d="M4.5 20c.9-3.6 3.9-5.6 7.5-5.6s6.6 2 7.5 5.6"/></svg>'; }
}
function effKind(pf){ return pf.kind==="photo" && !pf.photo ? "initials" : pf.kind; }
function updateAvatar(){
  const pf=profile(), b=$("avatarBtn"); if(!b) return;
  const sig=JSON.stringify([effKind(pf), pf.name, pf.animal, pf.photo.length]); if(sig!==updateAvatar.sig){ updateAvatar.sig=sig; paintFace($("avFace"), effKind(pf), pf); paintFace($("fsAvFace"), effKind(pf), pf); }
  b.classList.toggle("working", !!openShift());
  b.setAttribute("aria-label", (pf.name?pf.name+", ":"")+"profile and settings"+(openShift()?" (clocked in)":""));
}
function renderProfile(){
  const pf=profile(), kind=effKind(pf), grid=$("avGrid"); grid.textContent="";
  if(document.activeElement!==$("profName")) $("profName").value=pf.name;
  { const t=$("nameText"); t.textContent=pf.name||"Add your name"; t.classList.toggle("empty",!pf.name); }
  paintFace($("profPrev").firstElementChild, kind, pf);
  const tile=(label, on, paint, fn)=>{ const b=document.createElement("button"); b.type="button"; b.className="av-tile"+(on?" on":""); b.setAttribute("aria-label",label); b.setAttribute("aria-pressed",on?"true":"false");
    const f=document.createElement("span"); f.className="av-face still"; paint(f); b.appendChild(f); const t=document.createElement("small"); t.textContent=label; b.appendChild(t); b.onclick=fn; grid.appendChild(b); };
  tile("Initials", kind==="initials", f=>paintFace(f,"initials",{name:pf.name}), ()=>setProfile({kind:"initials"}));
  tile("Photo", kind==="photo", f=>{ if(pf.photo) paintFace(f,"photo",pf); else { f.style.background="var(--chip)"; f.innerHTML='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" style="width:46%;height:46%;color:var(--muted)" aria-hidden="true"><path d="M4 8h3l1.6-2.2h6.8L17 8h3v11H4z"/><circle cx="12" cy="13.2" r="3.4"/></svg>'; } }, ()=>{ if(pf.photo) setProfile({kind:"photo"}); else $("avFile").click(); });
  ANIMALS.forEach(([k,n])=>tile(n, kind==="animal"&&pf.animal===k, f=>paintFace(f,"animal",{animal:k}), ()=>setProfile({kind:"animal", animal:k})));
  $("avUpload").textContent=pf.photo?"Change photo":"Upload a photo"; $("avRemove").hidden=!pf.photo;
}
function setProfile(patch){ db.profile=Object.assign({name:"",kind:"initials",animal:"lion"}, db.profile||{}, patch); save(); updateAvatar(); renderProfile(); }
$("profName").addEventListener("input",e=>{ const v=cleanText(e.target.value,30).replace(/\s+/g," "); db.profile=Object.assign({name:"",kind:"initials",animal:"lion"}, db.profile||{}, {name:v}); save(); updateAvatar(); paintFace($("profPrev").firstElementChild, effKind(profile()), profile()); renderProfileTilesOnly(); });
function nameEditing(on){ $("nameBox").hidden=!on; $("nameView").hidden=on; if(on){ $("profName").value=profile().name; try{ $("profName").focus(); }catch(e){} } else { renderProfile(); } }
$("nameEdit").onclick=()=>nameEditing(true); $("nameText").onclick=()=>nameEditing(true);
$("nameDone").onclick=()=>nameEditing(false);
$("profName").addEventListener("keydown",e=>{ if(e.key==="Enter"){ e.preventDefault(); nameEditing(false); } });
function renderProfileTilesOnly(){ const t=$("avGrid").firstElementChild; if(t){ paintFace(t.querySelector(".av-face"),"initials",{name:profile().name}); } }
function readPhoto(file){ return new Promise((res,rej)=>{ if(!file||!/^image\//.test(file.type)||file.size>20e6) return rej(new Error("Choose a picture file."));
  const r=new FileReader(); r.onerror=()=>rej(new Error("Couldn’t read that picture.")); r.onload=()=>{ const im=new Image(); im.onerror=()=>rej(new Error("Couldn’t open that picture.")); im.onload=()=>{
    const S=256, c=document.createElement("canvas"); c.width=c.height=S; const x=c.getContext("2d"), m=Math.min(im.width,im.height); if(!m) return rej(new Error("Couldn’t open that picture."));
    x.drawImage(im,(im.width-m)/2,(im.height-m)/2,m,m,0,0,S,S); res(c.toDataURL("image/jpeg",.85)); }; im.src=r.result; }; r.readAsDataURL(file); }); }
$("avUpload").onclick=()=>$("avFile").click();
$("avFile").addEventListener("change",async e=>{ const f=e.target.files[0]; e.target.value=""; if(!f) return; $("profMsg").textContent="";
  try{ const url=await readPhoto(f); setProfile({photo:url, kind:"photo"}); }catch(err){ $("profMsg").textContent=err.message||"Couldn’t use that picture."; } });
$("avRemove").onclick=()=>{ const p=Object.assign({}, db.profile||{}); delete p.photo; if(p.kind==="photo") p.kind="initials"; db.profile=p; save(); updateAvatar(); renderProfile(); };
updateAvatar(); renderProfile();
// location settings
function renderLoc(){
  const on=locOn(); $("locToggle").setAttribute("aria-checked",on?"true":"false"); const box=$("locWork"); box.textContent=""; box.hidden=!on;
  if(!on) return;
  const list=[{id:"",name:jobName("")}].concat((db.jobs||[]).filter(j=>!j.left).map(j=>({id:j.id,name:j.name})));
  list.forEach(j=>{
    const at=!!(db.loc&&db.loc.at&&db.loc.at[j.id]===1), w=workPlace(j.id), wrap=document.createElement("div"); wrap.className="loc-job";
    const row=document.createElement("div"); row.className="settings-row"; const l=document.createElement("span"); l.textContent=j.name; row.appendChild(l);
    const seg=document.createElement("span"); seg.className="seg";
    [["","On the road"],["1","At a place"]].forEach(([v,t])=>{ const b=document.createElement("button"); b.type="button"; b.textContent=t; b.classList.toggle("on",(v==="1")===at);
      b.onclick=()=>{ setPlaceMode(j.id,v==="1"); save(); $("locMsg").textContent=""; renderLoc(); }; seg.appendChild(b); });
    row.appendChild(seg); wrap.appendChild(row);
    if(at){
      const r2=document.createElement("div"); r2.className="settings-row loc-sub"; const l2=document.createElement("span"), sm=document.createElement("small");
      l2.textContent="Job location"; sm.textContent=w?"Saved \u00b7 accurate to about "+w.ac+" m":"Not set yet. Stand there, then tap Set here."; l2.appendChild(sm); r2.appendChild(l2);
      const bs=document.createElement("span"), set=document.createElement("button"), clr=document.createElement("button");
      set.type=clr.type="button"; set.className=clr.className="icon-btn"; set.textContent=w?"Update":"Set here"; clr.textContent="Clear"; clr.hidden=!w;
      set.onclick=async()=>{ $("locMsg").textContent="Getting location\u2026"; const r=await getPos(); if(!r.s){ $("locMsg").textContent=locFail(r.err)+(r.err==="denied"?". Turn it on in iPhone Settings > Privacy & Security > Location Services.":"."); return; }
        (db.loc=db.loc||{on:1,work:{}}).work=db.loc.work||{}; db.loc.work[j.id]=r.s; save(); $("locMsg").textContent="Saved. Stand in your store when you set this."; renderLoc(); render(); queueRestamp(); };
      clr.onclick=()=>{ if(db.loc&&db.loc.work) delete db.loc.work[j.id]; save(); $("locMsg").textContent=""; renderLoc(); render(); queueRestamp(); };
      bs.appendChild(set); bs.appendChild(clr); r2.appendChild(bs); wrap.appendChild(r2); }
    box.appendChild(wrap); });
}
$("locToggle").onclick=()=>{ db.loc=db.loc||{on:1,work:{}}; db.loc.on=locOn()?0:1; save(); $("locMsg").textContent=""; renderLoc(); };
renderLoc();
// google sheets sync settings
updateSyncToggle(); updateSyncStatus();
let shT=null;   // the sheet being edited (null = adding a new one)
const nameKey=s=>String(s||"").replace(/\s+/g," ").trim().toLowerCase();
function nameTaken(nm, except){ const k=nameKey(nm); return !!k && (syncCfg().url?[syncCfg()].concat(mirrors()):[]).some(t=>t!==except && nameKey(t.name)===k); }
function shErr(msg){ const e=$("shErr"); e.textContent=msg||""; e.hidden=!msg; }
function openSheet(t){
  shT=t||null; const c=syncCfg(), all=c.url?[c].concat(mirrors()):[], isNew=!t;
  $("shTitle").textContent=isNew?(all.length?"Add another sheet":"Add your sheet"):sheetName(t);
  $("syncName").value=isNew?"":(t.name||""); $("syncUrl").value=isNew?"":t.url||""; $("syncSecret").value=isNew?"":t.secret||"";
  $("syncSaveBtn").textContent=isNew?"Save & connect":"Save"; $("syncSaveBtn").disabled=false;
  $("shMore").hidden=isNew; $("shMain").hidden=isNew||t===c; shErr("");
  $("shBg").classList.add("open"); }
function closeSheet(){ $("shBg").classList.remove("open"); shT=null; try{ document.activeElement.blur(); }catch(e){} }
$("sheetAdd").onclick=()=>openSheet(null);
$("shClose").onclick=closeSheet; $("shBg").addEventListener("click",e=>{ if(e.target===$("shBg")) closeSheet(); });
if(typeof sheetDrag==="function") sheetDrag($("shBg"), closeSheet);
$("syncName").addEventListener("input",()=>{ shErr(nameTaken($("syncName").value, shT)?"You already have a sheet with that name.":""); });
function uniqueName(base){ let nm=base, k=2; while(nameTaken(nm, shT)) nm=base+" "+(k++); return nm; }
$("syncForm").addEventListener("submit",async e=>{ e.preventDefault();
  const c=syncCfg(), isNew=!shT, t=shT, first=isNew && !c.url;
  let name=cleanText($("syncName").value,40).replace(/\s+/g," "), url=$("syncUrl").value.trim(), secret=$("syncSecret").value;
  if(name && nameTaken(name,t)) return shErr("You already have a sheet with that name.");
  if(!SYNC_URL_RE.test(url)) return shErr("The URL should look like https://script.google.com/macros/s/…/exec");
  if(secret.length<16) return shErr("Use a secret of at least 16 characters (same as in your script).");
  if((c.url?[c].concat(mirrors()):[]).some(x=>x!==t && x.url===url)) return shErr("That sheet is already added.");
  const same=t && t.url===url && t.secret===secret;
  if(same){ if(!name) return shErr("Give the sheet a name."); t.name=name; save(); updateSyncStatus(); closeSheet(); return; }
  const btn=$("syncSaveBtn"); btn.disabled=true; btn.textContent="Connecting…"; shErr("");
  try{
    const probe={url:url, secret:secret}, pj=await syncCall({action:"ping"}, probe);
    if(!name){ name=uniqueName(cleanText(pj.sheet||"",40).replace(/\s+/g," ")||(first?"My sheet":"Backup sheet")); }
    if(nameTaken(name,t)) throw new Error("You already have a sheet with that name.");
    if(first || t===c){
      c.name=name; c.url=url; c.secret=secret; c.err=""; c.enabled=true; save(); updateSyncToggle(); closeSheet();
      syncRun("Connecting", async()=>{ const n=await syncPull(true); await flushOutbox(); return n ? "Connected · restored "+n+" shift"+(n===1?"":"s") : "Connected ✓"; });
    } else {
      let m=t; if(!m){ if(mirrors().length>=4) throw new Error("You can add up to 5 sheets."); m={id:uid(), name:name, url:url, secret:secret, err:"", outbox:[], last:0}; }
      else { m.name=name; m.url=url; m.secret=secret; m.err=""; }
      if(!t) mirrors().push(m); save(); closeSheet(); updateSyncStatus("Backing up to "+name+"…");
      syncRun("Backing up", async()=>{ const n=await syncUploadAll(m); await pushMeta(null,m); m.last=Date.now(); save(); return "Backed up "+n+" shift"+(n===1?"":"s")+" to "+name+" ✓"; }, m);
    }
  }catch(err){ btn.disabled=false; btn.textContent=isNew?"Save & connect":"Save"; shErr(err.message); }
});
$("shMain").onclick=async()=>{ const c=syncCfg(), m=shT; if(!m||m===c) return;
  if(!await askConfirm("Make "+sheetName(m)+" the main sheet?","Your shifts are restored from the main sheet, and Shortcuts clock-ins are read from it. "+sheetName(c)+" becomes a backup.","Make main",false)) return;
  const tmp={name:c.name,url:c.url,secret:c.secret,err:c.err,outbox:db.outbox,last:db.lastSync};
  c.name=m.name; c.url=m.url; c.secret=m.secret; c.err=m.err||""; db.outbox=outboxOf(m); db.lastSync=m.last||0;
  m.name=tmp.name; m.url=tmp.url; m.secret=tmp.secret; m.err=tmp.err||""; m.outbox=tmp.outbox||[]; m.last=tmp.last||0;
  save(); closeSheet(); updateSyncStatus(); flushOutbox(); };
$("shRemove").onclick=async()=>{ const c=syncCfg(), t=shT; if(!t) return;
  if(!await askConfirm("Remove "+sheetName(t)+"?","The app stops syncing with this sheet. Nothing is deleted from the sheet or from this phone.","Remove",true)) return;
  const snapS=JSON.stringify(db.sync), snapO=JSON.stringify(db.outbox||[]);
  if(t===c){
    if(mirrors().length){ const m=mirrors().shift(); c.name=m.name; c.url=m.url; c.secret=m.secret; c.err=m.err||""; db.outbox=outboxOf(m); db.lastSync=m.last||0; }
    else { c.name=""; c.url=""; c.secret=""; c.err=""; c.enabled=false; db.outbox=[]; updateSyncToggle(); }
  } else { const i=mirrors().indexOf(t); if(i>=0) mirrors().splice(i,1); }
  save(); closeSheet(); updateSyncStatus();
  showUndo("Sheet removed.", ()=>{ db.sync=JSON.parse(snapS); db.outbox=JSON.parse(snapO); save(); updateSyncToggle(); updateSyncStatus(); if(db.sync.enabled) flushOutbox(); }); };
$("syncToggle").onclick=()=>{ const c=syncCfg(); c.enabled=!c.enabled; save(); updateSyncToggle(); updateSyncStatus(); if(c.enabled) flushOutbox(); };
$("syncNowBtn").onclick=()=>syncRun("Syncing", async()=>{ await flushOutbox(); if(syncCfg().err) throw new Error(syncCfg().err); const n=await syncPull(); let b=0;
  for(const m of mirrors().slice()){ try{ b+=await mirrorSync(m); }catch(e){ if(!e.offline) m.err=e.message; } } save();
  return n?"Restored "+n+" shift"+(n===1?"":"s"):((pushedN+b)?"Uploaded "+(pushedN+b)+" to your sheets ✓":"Up to date ✓"); });
if($("syncUpBtn")) $("syncUpBtn").onclick=()=>syncRun("Uploading", async()=>{ const n=await syncUploadAll(); return "Uploaded "+n+" shift"+(n===1?"":"s")+" ✓"; });
$("syncDownBtn").onclick=async()=>{ const t=shT; if(!t) return; if(!await askConfirm("Restore from "+sheetName(t)+"?","Shifts, payments and settings missing on this phone will be added from this sheet.","Restore",false)) return; closeSheet();
  syncRun("Restoring", async()=>{ const n=await syncPull(true,t); return n?"Restored "+n+" item"+(n===1?"":"s")+" ✓":"Restored from the sheet ✓"; }, t); };
// pull on open + whenever the app comes back to the foreground (iOS keeps PWAs alive)
async function autoSync(){ const c=syncCfg(); if(!c.enabled||!c.url||!navigator.onLine) return;
  progBegin(7,"Syncing");
  try{ await flushOutbox(); if(!c.err){ await syncPull(); db.lastSync=Date.now(); save(); } }catch(e){ if(!e.offline){ c.err=e.message; save(); } }
  progFinish(); updateSyncStatus(); }
document.addEventListener("visibilitychange",()=>{ if(!document.hidden) autoSync(); });
// app updates without deleting the app
const APP_VERSION="2026.10.19.58";
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
function updateLockUi(){ $("lockToggle").setAttribute("aria-checked",lockOn()?"true":"false");
  const st=$("lockStatus"); if(!st.classList.contains("err")) st.textContent=lockOn()?"Locks after 30 s away from the app":"Locks after 30 s away, using Face ID or your passcode"; }
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
  const active=()=>box.querySelector(itemSel+".on")||(box.hasAttribute("data-optional")?null:items()[0]);
  const S={x:0,w:0,vx:0,vw:0,sc:1,vs:0,ex:0,evx:0}, T={x:0,w:0,sc:1};
  let raf=0, last=0, drag=null, ready=false, hidden=false;
  const hideThumb=()=>{ hidden=true; paint(); };
  function geom(it){ return {x:it.offsetLeft, w:it.offsetWidth, h:it.offsetHeight, top:it.offsetTop, r:getComputedStyle(it).borderRadius}; }
  function aim(g, snap){
    if(!g.w) return;
    hidden=false; T.x=g.x; T.w=g.w;
    [thumb,echo].forEach(el=>{ el.style.height=g.h+"px"; el.style.top=g.top+"px"; el.style.borderRadius=g.r; });
    if(snap||REDUCED||!ready){ S.x=S.ex=g.x; S.w=g.w; S.vx=S.evx=S.vw=S.vs=0; S.sc=T.sc=1; paint(); } else kick();
  }
  function paint(){
    const stretch=Math.min(Math.abs(S.vx)/2400,.34);                 // faster travel => longer, thinner drop
    const sx=(1+stretch)*S.sc, sy=(1-stretch*.5)*S.sc;
    thumb.style.width=S.w+"px"; thumb.style.opacity=ready&&!hidden?1:0;
    thumb.style.transform="translate3d("+S.x+"px,0,0) scale("+sx+","+sy+")";
    const lag=Math.abs(S.ex-S.x);
    echo.style.width=S.w+"px"; echo.style.opacity=ready&&!hidden?Math.min(lag/14,1)*.6:0;   // trailing smear fades in while moving
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
  new MutationObserver(()=>{ if(!drag){ const a=active(); if(a) aim(geom(a)); else hideThumb(); } }).observe(box,{subtree:true,attributes:true,attributeFilter:["class"]});
  new ResizeObserver(()=>{ const a=active(); if(a){ aim(geom(a),true); ready=true; paint(); } else { ready=true; hideThumb(); } }).observe(box);
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
    if(e.type==="pointerup" && it && it!==active()) it.click(); else { const a=active(); if(a) aim(geom(a)); else hideThumb(); }
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
let payJob="all";   // which job the Pay tab is showing
const payOk=(p,f)=>f==="all" ? !jobLeft(p.job) : (f==="main" ? !p.job || !(db.jobs||[]).some(j=>j.id===p.job) : p.job===f);
const credit=p=>(db.netTrack && p.gross!=null) ? p.gross : p.amount;   // what a payment settles: the gross wages it covers, if you track that
const cycleOf=()=>db.payCycle || (db.payday ? "monthly" : "");
function paydays(){   // {prev, next}: the latest payday on or before today and the next one after it
  const now=new Date(), c=cycleOf();
  if(c==="weekly"||c==="biweekly"){ if(!db.payAnchor) return null;
    const P=c==="weekly"?7:14, a=new Date(db.payAnchor+"T00:00:00"), t0=new Date(now.getFullYear(),now.getMonth(),now.getDate());
    const k=Math.floor(Math.round((t0-a)/864e5)/P), prev=new Date(a), next=new Date(a); prev.setDate(a.getDate()+k*P); next.setDate(a.getDate()+(k+1)*P); return {prev,next}; }
  if(!db.payday) return null;
  const nd=new Date(now.getFullYear(), now.getMonth(), db.payday), pd=new Date(nd);
  if(pd.getTime()>now.getTime()) pd.setMonth(pd.getMonth()-1); if(nd.getTime()<=now.getTime()) nd.setMonth(nd.getMonth()+1);
  return {prev:pd, next:nd};
}
// ---------- Expenses and mileage ----------
let expEditId=null, expKind="expense";
function renderExpenses(done, mk){
  const E=(db.expenses||[]).slice().sort((a,b)=>b.ts-a.ts); let em=0, ea=0; E.forEach(x=>{ ea+=x.amount; if(monthKey(x.ts)===mk) em+=x.amount; });
  $("expML").textContent=monthLabel(mk); $("expM").textContent=money(em); $("expA").textContent=money(ea);
  const net=$("expNet"); net.hidden=!E.length; if(E.length){ const inc=done.filter(s=>monthKey(s.start)===mk).reduce((a,s)=>a+pay(s)+tipOf(s),0); net.textContent="This month after expenses: "+money(inc-em)+" (wages and tips minus expenses)"; }
  const L=$("expList"); L.innerHTML="";
  E.slice(0,6).forEach(x=>{ const r=document.createElement("button"); r.type="button"; r.className="job-row"; const a=document.createElement("span"); a.textContent=fmtDate(x.ts).replace(/, \d{4}$/,"")+(x.kind==="mileage"?" \u00b7 "+x.miles+" mi":"")+(x.note?" \u00b7 "+x.note:"");
    const b=document.createElement("span"); b.className="job-rate"; b.textContent=money(x.amount); r.appendChild(a); r.appendChild(b); r.onclick=()=>openExp(x); L.appendChild(r); });
}
function setExpKind(k){ expKind=k; document.querySelectorAll("#expSeg button").forEach(b=>b.classList.toggle("on",b.dataset.k===k)); $("expAmtF").hidden=k==="mileage"; $("expMilesF").hidden=k!=="mileage";
  $("expMileHint").textContent=db.mileRate>0?"At "+money(db.mileRate)+" per mile":"Set your mileage rate in Settings to get a dollar amount. Miles are still saved."; }
function openExp(x){ expEditId=x?x.id:null; $("expTitle").textContent=x?"Edit entry":"Add expense"; setExpKind(x&&x.kind==="mileage"?"mileage":"expense");
  $("expDate").value=dayKey(x?x.ts:Date.now()); $("expAmt").value=x&&x.kind!=="mileage"?x.amount:""; $("expMiles").value=x&&x.miles?x.miles:""; $("expNote").value=x?x.note:""; $("expDelete").style.display=x?"":"none"; $("expBg").classList.add("open"); }
function closeExp(){ $("expBg").classList.remove("open"); }
$("expAdd").onclick=()=>openExp(null); $("expCancel").onclick=closeExp; $("expBg").addEventListener("click",e=>{ if(e.target===$("expBg")) closeExp(); });
document.querySelectorAll("#expSeg button").forEach(b=>b.onclick=()=>setExpKind(b.dataset.k));
$("expSave").onclick=()=>{
  const dv=$("expDate").value; if(!dv){ alert("Pick a date."); return; }
  const ts=new Date(dv+"T12:00:00").getTime(); let amount, miles;
  if(expKind==="mileage"){ miles=parseFloat($("expMiles").value); if(!(miles>0)){ alert("Enter the miles driven."); return; } amount=Math.round(miles*(db.mileRate||0)*100)/100; }
  else { amount=parseFloat($("expAmt").value); if(!(amount>0)){ alert("Enter an amount."); return; } }
  const c=cleanExpense({id:expEditId||("x"+Date.now().toString(36)+Math.random().toString(36).slice(2,4)), ts, amount, miles, note:$("expNote").value}); if(!c){ alert("That entry isn't valid."); return; }
  db.expenses=db.expenses||[]; const i=db.expenses.findIndex(x=>x.id===c.id); if(i>=0) db.expenses[i]=c; else db.expenses.push(c);
  save(); closeExp(); render(); queueMeta(); };
$("expDelete").onclick=async()=>{ const id=expEditId; if(!await askConfirm("Delete this entry?","You can undo right after.","Delete",true)) return;
  const goneE=(db.expenses||[]).find(x=>x.id===id);
  db.expenses=(db.expenses||[]).filter(x=>x.id!==id); if(!db.expenses.length) delete db.expenses; save(); closeExp(); render(); queueMeta();
  if(goneE) showUndo("Entry deleted.", ()=>{ (db.expenses=db.expenses||[]).push(goneE); save(); render(); queueMeta(); }); };
sheetDrag($("expBg"), closeExp);
function renderPay(){
  { const on=hasJobs(); $("payJobRow").hidden=!on; if(!on) payJob="all"; else { if(payJob!=="all"&&payJob!=="main"&&!(db.jobs||[]).some(j=>j.id===payJob)) payJob="all"; jobChips($("payChips"), payJob, v=>{ payJob=v; renderPay(); }, {all:true, main:"main", left:true}); } }
  const done=db.shifts.filter(s=>s.end && jobOk(s,payJob)), P=pays().filter(p=>payOk(p,payJob));
  const earned=done.reduce((a,s)=>a+pay(s),0), recv=P.reduce((a,p)=>a+credit(p),0), owed=Math.round((earned-recv)*100)/100, took=P.reduce((a,p)=>a+p.amount,0), held=Math.round((recv-took)*100)/100;
  $("payEarned").textContent=money(earned); $("payRecv").textContent=money(recv);
  { const h=$("payHeld"); h.hidden=!(db.netTrack && held>0.004); if(!h.hidden) h.textContent="Take-home so far "+money(took)+" \u00b7 "+money(held)+" held back before it reached you"; }
  const big=$("payOwed"); big.textContent=money(Math.abs(owed)); big.className="pay-big "+(owed>0.004?"owe":"ok");
  $("payOwedSub").textContent = !done.length && !P.length ? "Log what you're paid and it shows here." :
    owed>0.004 ? (earned>0 ? "You've been paid "+Math.round(Math.min(100,recv/earned*100))+"% of what you've earned" : "Still owed") : owed<-0.004 ? "Paid ahead of what you've worked" : "All paid up \u2713";
  $("payBar").style.width=(earned>0?Math.min(100,recv/earned*100):(recv>0?100:0))+"%";
  // this month
  const mk=monthKey(Date.now()); let me=0, mr=0;
  done.forEach(s=>{ if(monthKey(s.start)===mk) me+=pay(s); }); P.forEach(p=>{ if(monthKey(p.ts)===mk) mr+=credit(p); });
  { const pc=db.taxPct||0; $("taxCard").hidden=!pc; if(pc){ const k=pc/100; let tm=0,ta=0; done.forEach(s=>{ const v=(pay(s)+tipOf(s))*k; ta+=v; if(monthKey(s.start)===mk) tm+=v; });
      $("taxH").textContent="Set aside for tax ("+pc+"%)"; $("taxML").textContent=monthLabel(mk); $("taxM").textContent=money(tm); $("taxA").textContent=money(ta); } }
  renderExpenses(done, mk);
  $("payMonthLabel").textContent=monthLabel(mk);
  $("payMEarn").textContent=money(me); $("payMRecv").textContent=money(mr);
  const sh=me-mr; $("payMBal").textContent=money(Math.max(0,sh)); $("payMBal").parentNode.firstChild.textContent = sh<-0.004?"Ahead by":"Short by";
  if(sh<-0.004) $("payMBal").textContent=money(-sh);
  $("payMBal").className="val "+(sh>0.004?"bad":"good");
  // month by month, with a running balance (late payments for last month's work are handled naturally)
  const M={}; const slot=k=>M[k]||(M[k]={e:0,r:0});
  done.forEach(s=>{ slot(monthKey(s.start)).e+=pay(s); }); P.forEach(p=>{ slot(monthKey(p.ts)).r+=credit(p); });
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
    r.className="prow"; m.textContent=money(p.amount); n.textContent=fmtDate(p.ts)+(hasJobs()?" \u00b7 "+jobName(p.job):"")+(p.note?" \u00b7 "+p.note:"");
    a.appendChild(m); a.appendChild(document.createElement("br")); a.appendChild(n);
    e.className="icon-btn"; e.textContent="Edit"; e.onclick=()=>openPay(p); d.className="icon-btn danger"; d.textContent="Delete";
    d.onclick=async()=>{ if(!await askConfirm("Delete this payment?", money(p.amount)+" · "+fmtDate(p.ts)+(p.note?" · "+p.note:"")+". You can undo right after.", "Delete", true)) return; db.payments=pays().filter(x=>x.id!==p.id); save(); render(); queueSync({action:"pdelete", id:p.id});
      showUndo("Payment deleted.", ()=>{ pays().push(p); save(); render(); queueSync({action:"pupsert", payment:payPayload(p)}); }); };
    b.appendChild(e); b.appendChild(d); r.appendChild(a); r.appendChild(b); lb.appendChild(r); });
  renderPayExtras(done, P, recv);
}
function payRow(id, title, sub, amt){
  const el=$(id); el.textContent="";
  const l=document.createElement("div"), t=document.createElement("b"), s=document.createElement("small"), a=document.createElement("div");
  t.textContent=title; s.textContent=sub; l.appendChild(t); l.appendChild(document.createElement("br")); l.appendChild(s);
  a.className="amt"; a.textContent=amt; el.className="payrow"; el.appendChild(l); el.appendChild(a);
}
function renderPayExtras(done, P, recv){
  // next payday: what you're owed now, plus a projection at your recent pace (last 28 days)
  const nx=$("payNext"); nx.style.display="none";
  const PD=paydays();
  if(PD){
    const nd=PD.next;
    const owedNow=Math.max(0, done.reduce((a,s)=>a+pay(s),0)-recv), since=Date.now()-28*86400000;
    const pace=done.filter(s=>s.start>=since).reduce((a,s)=>a+pay(s),0)/28, days=Math.max(0,Math.ceil((nd.getTime()-Date.now())/86400000));
    const proj=owedNow+pace*days;
    if(owedNow>0.004 || pace>0){
      payRow("payNextTxt","Next payday \u00b7 "+fmtDay(nd.getTime()),days+" day"+(days===1?"":"s")+" away \u00b7 expected",money(pace>0?proj:owedNow));
      nx.style.display="block"; }
  }
  // overdue: wages for work done before the most recent payday, minus everything received so far
  const due=$("payDue"); due.style.display="none";
  if(PD){
    const pd=PD.prev;
    const cut=pd.getTime(), wages=done.filter(s=>s.start<cut).reduce((a,s)=>a+pay(s),0), over=Math.round((wages-recv)*100)/100;
    if(over>0.004){ const days=Math.floor((Date.now()-cut)/86400000);
      payRow("payDueTxt","Overdue",(days>0?"since "+fmtDay(cut)+" \u00b7 "+days+" day"+(days===1?"":"s")+" late":"due today"),money(over)); due.style.display="block"; }
  }
}
let payEditing=null;
function openPay(p){
  payEditing=p?p.id:null; $("payTitle").textContent=p?"Edit payment":"Log payment";
  $("payAmt").value=p?p.amount:""; $("payGrossF").hidden=!db.netTrack; $("payGross").value=(p&&p.gross!=null)?p.gross:""; $("payDate").value=dayKey(p?p.ts:Date.now()); $("payNote").value=p?p.note:"";
  { const on=hasJobs(); $("payJobF").hidden=!on; if(on){ const sel=$("payJobSel"); sel.innerHTML=""; const add=(v,t)=>{ const o=document.createElement("option"); o.value=v; o.textContent=t; sel.appendChild(o); };
      add("",jobName("")); (db.jobs||[]).forEach(j=>{ if(!j.left || (p&&p.job===j.id)) add(j.id,j.name+(j.left?" (left)":"")); });
      const want=p?(p.job||""):(payJob==="all"||payJob==="main"?(payJob==="main"?"":(db.activeJob||"")):payJob); sel.value=[...sel.options].some(o=>o.value===want)?want:""; } }
  $("payBg").classList.add("open");
}
function closePay(){ $("payBg").classList.remove("open"); payEditing=null; }
$("payAdd").onclick=()=>openPay(null);
$("payCancel").onclick=closePay;
$("payBg").addEventListener("click",e=>{ if(e.target===$("payBg")) closePay(); });
$("payFill").onclick=()=>{ const f=hasJobs()?($("payJobSel").value||"main"):"all", earned=db.shifts.filter(s=>s.end && jobOk(s,f)).reduce((a,s)=>a+pay(s),0), recv=pays().filter(p=>payOk(p,f)).reduce((a,p)=>a+credit(p),0), o=Math.round((earned-recv)*100)/100; if(o>0){ if(db.netTrack){ $("payGross").value=o; } else $("payAmt").value=o; } };
$("paySave").onclick=()=>{
  const amt=Math.round(parseFloat($("payAmt").value)*100)/100, dv=$("payDate").value;
  if(!Number.isFinite(amt)||amt<=0||amt>10000000){ alert("Enter the amount you received."); return; }
  if(!dv){ alert("Pick the date you were paid."); return; }
  const ts=new Date(dv+"T12:00:00").getTime(), note=$("payNote").value;
  const gv=db.netTrack&&$("payGross").value!==""?parseFloat($("payGross").value):undefined; if(gv!==undefined&&!(gv>=amt)){ alert("Gross wages can't be less than what you received."); return; }
  const c=cleanPayment({id:payEditing||uid(), ts, amount:amt, note, gross:gv, job:hasJobs()?$("payJobSel").value:""}); if(!c){ alert("That payment doesn't look right."); return; }
  if(payEditing){ const i=pays().findIndex(x=>x.id===payEditing); if(i>=0) db.payments[i]=c; else pays().push(c); } else pays().push(c);
  save(); closePay(); render(); queueSync({action:"pupsert", payment:payPayload(c)});
};

// ---------- Pay statement (for the owner): shifts, wages, tips, payments and the balance ----------
function buildStatement(fromTs, toTs, jf){
  jf=jf||"all"; const done=db.shifts.filter(s=>s.end && jobOk(s,jf)).sort((a,b)=>a.start-b.start);
  const inR=done.filter(s=>s.start>=fromTs && s.start<=toTs);
  const hours=inR.reduce((a,s)=>a+hrs(s),0), wages=inR.reduce((a,s)=>a+pay(s),0);
  const earnedTo=done.filter(s=>s.start<=toTs).reduce((a,s)=>a+pay(s),0);
  const paidTo=pays().filter(p=>payOk(p,jf) && p.ts<=toTs).reduce((a,p)=>a+credit(p),0);
  const payIn=pays().filter(p=>payOk(p,jf) && p.ts>=fromTs && p.ts<=toTs).sort((a,b)=>a.ts-b.ts);
  return {inR, hours, wages, earnedTo, paidTo, owed:Math.round((earnedTo-paidTo)*100)/100, payIn, fromTs, toTs, jf, jobLabel:(hasJobs()&&jf!=="all")?jobName(jf==="main"?"":jf):""};
}
function statementText(S){
  const L=["Pay statement"+(S.jobLabel?" \u2013 "+S.jobLabel:"")+" "+fmtDate(S.fromTs)+" to "+fmtDate(S.toTs), ""];
  S.inR.forEach(s=>L.push(fmtDate(s.start)+"  "+fmtTime(s.start)+" - "+fmtTime(s.end)+"  "+hrs(s).toFixed(2)+"h @ "+money(rateOf(s))+"  "+money(pay(s))));
  L.push("", "Hours: "+S.hours.toFixed(2), "Wages: "+money(S.wages));
  if(S.payIn.length){ L.push("", "Payments received:"); S.payIn.forEach(p=>L.push(fmtDate(p.ts)+"  "+money(credit(p))+(db.netTrack&&p.gross!=null?" (take-home "+money(p.amount)+")":"")+(p.note?"  "+p.note:""))); }
  L.push("", "Wages earned through "+fmtDate(S.toTs)+": "+money(S.earnedTo), "Paid through "+fmtDate(S.toTs)+": "+money(S.paidTo), S.owed>0.004?"Balance owed: "+money(S.owed):S.owed<-0.004?"Paid ahead: "+money(-S.owed):"Balance: paid in full");
  return L.join("\n");
}
let stmtText="";
function showStatement(S){
  stmtText=statementText(S);
  const pg=$("stmtPage"); pg.textContent="";
  const el=(tag,txt,cls)=>{ const e=document.createElement(tag); if(txt!=null) e.textContent=txt; if(cls) e.className=cls; return e; };
  pg.appendChild(el("h1","Pay statement"+(S.jobLabel?" \u2013 "+S.jobLabel:"")));
  pg.appendChild(el("div",fmtDate(S.fromTs)+" \u2013 "+fmtDate(S.toTs)+"","muted"));
  const tb=el("table"), hd=el("tr"); ["Date","In","Out","Hours","Rate","Wages"].forEach(h=>hd.appendChild(el("th",h))); tb.appendChild(hd);
  S.inR.forEach(s=>{ const r=el("tr"); [fmtDate(s.start),fmtTime(s.start),fmtTime(s.end),hrs(s).toFixed(2),money(rateOf(s))+"/hr",money(pay(s))].forEach(v=>r.appendChild(el("td",v))); tb.appendChild(r); });
  if(!S.inR.length){ const r=el("tr"), c=el("td","No shifts in this period"); c.colSpan=6; r.appendChild(c); tb.appendChild(r); }
  pg.appendChild(tb);
  const sum=(l,v,b)=>{ const r=el("div",null,"srow"+(b?" b":"")); r.appendChild(el("span",l)); r.appendChild(el("span",v)); pg.appendChild(r); };
  sum("Hours",S.hours.toFixed(2)); sum("Wages",money(S.wages));
  if(S.payIn.length){ pg.appendChild(el("h2","Payments received")); S.payIn.forEach(p=>sum(fmtDate(p.ts)+(db.netTrack&&p.gross!=null?" \u00b7 take-home "+money(p.amount):"")+(p.note?" \u00b7 "+p.note:""),money(credit(p)))); }
  pg.appendChild(el("h2","Balance as of "+fmtDate(S.toTs)));
  sum("Wages earned (all shifts through this date)",money(S.earnedTo)); sum("Paid (all payments through this date)",money(S.paidTo));
  sum(S.owed>0.004?"Balance owed":S.owed<-0.004?"Paid ahead":"Balance", S.owed>0.004?money(S.owed):S.owed<-0.004?money(-S.owed):"Paid in full \u2713", true);
  $("stmt").hidden=false; document.body.classList.add("stmt-open");
}
function closeStmt(){ $("stmt").hidden=true; document.body.classList.remove("stmt-open"); }
$("stmtBtn").onclick=()=>{ { const on=hasJobs(); $("stmtJobF").hidden=!on; if(on){ const sel=$("stmtJob"); sel.innerHTML=""; const add=(v,t)=>{ const o=document.createElement("option"); o.value=v; o.textContent=t; sel.appendChild(o); }; add("all","All jobs"); add("main",jobName("")); (db.jobs||[]).forEach(j=>add(j.id,j.name+(j.left?" (left)":""))); sel.value=[...sel.options].some(o=>o.value===payJob)?payJob:"all"; } } $("stmtPd").style.display=paydays()?"":"none"; const n=new Date(); $("stmtFrom").value=dayKey(new Date(n.getFullYear(),n.getMonth(),1).getTime()); $("stmtTo").value=dayKey(Date.now()); $("stmtBg").classList.add("open"); };
$("stmtQuick").addEventListener("click",e=>{ const b=e.target.closest("button"); if(!b) return;
  const n=new Date(), y=n.getFullYear(), m=n.getMonth(), K=d=>dayKey(d.getTime()); let a,z=new Date(n);
  if(b.dataset.q==="month") a=new Date(y,m,1);
  else if(b.dataset.q==="last"){ a=new Date(y,m-1,1); z=new Date(y,m,0); }
  else if(b.dataset.q==="payday"){ const P2=paydays(); a=P2?P2.prev:new Date(y,m,1); }
  else { const f=db.shifts.reduce((mn,s)=>Math.min(mn,s.start),Date.now()); a=new Date(f); }
  $("stmtFrom").value=K(a); $("stmtTo").value=K(z); });
$("stmtCancel").onclick=()=>$("stmtBg").classList.remove("open");
$("stmtBg").addEventListener("click",e=>{ if(e.target===$("stmtBg")) $("stmtBg").classList.remove("open"); });
$("stmtGo").onclick=()=>{
  const f=$("stmtFrom").value, t=$("stmtTo").value; if(!f||!t){ alert("Pick both dates."); return; }
  const a=new Date(f+"T00:00:00").getTime(), b=new Date(t+"T23:59:59").getTime(); if(!(b>=a)){ alert("The end date is before the start date."); return; }
  $("stmtBg").classList.remove("open"); showStatement(buildStatement(a,b,hasJobs()?$("stmtJob").value:"all"));
};
$("stmtClose").onclick=closeStmt;
$("stmtPrint").onclick=()=>window.print();
$("stmtCopy").onclick=async()=>{ try{ await navigator.clipboard.writeText(stmtText); $("stmtCopy").textContent="Copied \u2713"; setTimeout(()=>$("stmtCopy").textContent="Copy text",1500); }catch(_){ alert("Couldn't copy. Use Print / PDF instead."); } };
sheetDrag($("stmtBg"), ()=>$("stmtBg").classList.remove("open"));

// tab bar
function tweenText(el){
  if(!el || RM() || el.dataset.tw) return;
  const n=el.firstChild; if(!n || n.nodeType!==3) return;
  const m=n.nodeValue.match(/^(\D*)([\d,]+(?:\.\d+)?)(.*)$/s); if(!m) return;
  const to=parseFloat(m[2].replace(/,/g,"")); if(!isFinite(to)||to===0) return;
  const dec=(m[2].split(".")[1]||"").length, pre=m[1], post=m[3], t0=performance.now(), D=950;
  el.dataset.tw="1";
  const f=now=>{
    const u=Math.min(1,(now-t0)/D), v=to*(1-Math.pow(1-u,4));
    n.nodeValue=pre+v.toLocaleString("en-US",{minimumFractionDigits:dec,maximumFractionDigits:dec})+post;
    if(u<1) requestAnimationFrame(f); else { n.nodeValue=m[1]+m[2]+m[3]; delete el.dataset.tw; }
  };
  requestAnimationFrame(f);
}
const counted={};
function countUpAll(tab){
  const ids= tab==="home" ? ["statToday","statMonth","statAll","tipDay","tipWeek","tipMonth","tipAll"] : ["payOwed","payEarned","payRecv","payMEarn","payMRecv","payMBal"];
  if(tab==="home" && !db.shifts.some(s=>!s.end)) ids.unshift("heroEarn");
  ids.forEach(id=>tweenText($(id)));
}
document.querySelectorAll(".tabbar button, #avatarBtn").forEach(b=>b.onclick=()=>{
  hideFs();   // the full-screen timer steps aside when you go to another tab
  document.querySelectorAll(".tabbar button, #avatarBtn").forEach(x=>x.classList.toggle("on",x===b));
  const t=b.dataset.tab;
  document.querySelectorAll(".tabpane").forEach(p=>p.classList.toggle("on",p.id==="tab-"+t));
  window.scrollTo(0,0); hideUndo();
  if(t==="analytics"){ renderAnalytics(); drawChart(); }
  if(t==="pay") renderPay();
       if((t==="home"||t==="pay") && !counted[t]){ counted[t]=1; countUpAll(t); }
});
render();
function replayActive(){ const on=document.querySelector(".tabpane.on"); if(!on) return; const t=on.id.replace("tab-",""); if(t==="home"||t==="pay"){ counted[t]=1; countUpAll(t); } }
setTimeout(replayActive,80);
setTimeout(showMissed,1200);
let hidAt=0;
document.addEventListener("visibilitychange",()=>{ if(document.hidden){ hidAt=Date.now(); } else if(Date.now()-hidAt>4000){ for(const k in counted) delete counted[k]; setTimeout(replayActive,150); } });
try{ indexedDB.deleteDatabase("workclock-sounds"); localStorage.removeItem("workclock.alarm"); }catch(_){}
// ---- break: iPhone-style wheels for hours and minutes ----
function brkText(m){ const h=Math.floor(m/60), r=m%60; return h?(r?h+"h "+r+"m":h+"h"):r+" min"; }
(function(){
  const IH=36, wh=$("wheelH"), wm=$("wheelM");
  function build(el, n, fmt){ el.innerHTML=""; for(let i=0;i<n;i++){ const d=document.createElement("div"); d.className="wheel-i"; d.textContent=fmt(i); el.appendChild(d); } }
  build(wh, 6, i=>i); build(wm, 60, i=>String(i).padStart(2,"0"));
  const val=el=>Math.max(0,Math.min(el.children.length-1,Math.round(el.scrollTop/IH)));
  function paint(el){ const v=val(el); [...el.children].forEach((c,i)=>c.classList.toggle("sel",i===v)); }
  const upd=()=>{ paint(wh); paint(wm); const t=val(wh)*60+val(wm); $("brkSum").textContent=t?brkText(t):"No break"; };
  [wh,wm].forEach(el=>el.addEventListener("scroll",upd,{passive:true}));
  function setWheels(m){ wh.scrollTop=Math.floor(m/60)*IH; wm.scrollTop=(m%60)*IH; upd(); }
  let paid=false; const setPaid=p=>{ paid=p; $("brkPaid").classList.toggle("on",p); $("brkUnpaid").classList.toggle("on",!p); $("brkPaid").setAttribute("aria-pressed",p); $("brkUnpaid").setAttribute("aria-pressed",!p); $("brkNote").textContent=p?"Paid. Your hours stay the same.":"Unpaid. It comes off this shift's hours."; };
  $("brkPaid").onclick=()=>setPaid(true); $("brkUnpaid").onclick=()=>setPaid(false);
  const close=()=>$("brkBg").classList.remove("open");
  $("fsBreak").onclick=()=>{ const o=openShift(); if(!o) return; $("brkBg").classList.add("open"); $("brkClear").hidden=!(o.brk>0); setPaid(!!o.bp); setTimeout(()=>setWheels(o.brk||0),30); };
  $("brkCancel").onclick=close; $("brkBg").addEventListener("click",e=>{ if(e.target===$("brkBg")) close(); }); sheetDrag($("brkBg"), close);
  $("brkSave").onclick=()=>{ const o=openShift(); if(!o){ close(); return; } const t=val(wh)*60+val(wm); if(t>0){ o.brk=t; if(paid) o.bp=1; else delete o.bp; } else { delete o.brk; delete o.bp; } save(); close(); tickFs(); };
  $("brkClear").onclick=()=>{ const o=openShift(); if(o){ delete o.brk; delete o.bp; save(); tickFs(); } close(); };
})();

})();
/* Register the service worker so the app works fully offline once installed. */
if ("serviceWorker" in navigator) {
  var hadController = !!navigator.serviceWorker.controller, reloaded = false;
  window.addEventListener("load", function(){
    navigator.serviceWorker.register("./sw.js").then(function(reg){
      document.addEventListener("visibilitychange", function(){ if(!document.hidden && reg) reg.update().catch(function(){}); });
    });
  });
  // a new version took over: reload once (never while the Add shift sheet is open)
  navigator.serviceWorker.addEventListener("controllerchange", function(){
    if(!hadController || reloaded) return; reloaded = true;
    var m = document.getElementById("modalBg");
    if(!(m && m.classList.contains("open"))) location.reload();
  });
}

// Block pinch and double-tap zoom (iOS Safari ignores user-scalable)
["gesturestart","gesturechange","gestureend"].forEach(t=>document.addEventListener(t,e=>e.preventDefault()));
let lastTouchEnd=0;
document.addEventListener("touchend",e=>{ const n=Date.now(); if(n-lastTouchEnd<300 && !e.target.closest("input,textarea,select")) e.preventDefault(); lastTouchEnd=n; },{passive:false});
document.addEventListener("touchmove",e=>{ if(e.touches.length>1) e.preventDefault(); },{passive:false});


// ---- pop-ups: freeze the page behind them and keep them above the keyboard ----
(function(){
  let locked=false, savedY=0;
  const need=()=>!!document.querySelector(".modal-bg.open") || document.body.classList.contains("fs-open");
  function sync(){
    const n=need();
    if(n && !locked){ locked=true; savedY=window.scrollY; document.body.style.top=(-savedY)+"px"; document.body.classList.add("scroll-lock"); }
    else if(!n && locked){ locked=false; document.body.classList.remove("scroll-lock"); document.body.style.top=""; window.scrollTo(0,savedY); }
  }
  new MutationObserver(sync).observe(document.body,{subtree:true,attributes:true,attributeFilter:["class"]});
  const vv=window.visualViewport; let kbMetric=false, kbFocus=false;
  const textLike=el=>el&&el.closest&&el.closest(".modal-bg")&&(el.tagName==="TEXTAREA"||(el.tagName==="INPUT"&&!/^(date|time|datetime-local|month|checkbox|radio|range|button|submit|color|file)$/.test(el.type)));
  function setKbd(){ document.documentElement.classList.toggle("kbd", kbFocus||kbMetric); }
  document.addEventListener("focusin",e=>{ if(textLike(e.target)){ kbFocus=true; setKbd(); } });
  document.addEventListener("focusout",()=>{ setTimeout(()=>{ kbFocus=!!textLike(document.activeElement); setKbd(); },450); });
  function vvSet(){ if(!vv) return; const r=document.documentElement.style; const kb=Math.max(0, Math.round(window.innerHeight-vv.height-vv.offsetTop)); r.setProperty("--vvh",vv.height+"px"); r.setProperty("--kb",kb+"px"); r.setProperty("--avail",Math.max(200,window.innerHeight-kb)+"px"); kbMetric=kb>80||(vv.height<window.innerHeight-80); setKbd(); }
  if(vv){ vv.addEventListener("resize",vvSet); vv.addEventListener("scroll",vvSet); vvSet(); }
  document.addEventListener("focusin",e=>{ if(e.target.closest && e.target.closest(".modal-bg")) setTimeout(()=>{ vvSet(); try{ e.target.scrollIntoView({block:"nearest"}); }catch(_){} },300); });
})();
