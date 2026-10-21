/* Cumulative course reports. Read-only snapshot; no Firebase mutations. */
'use strict';
const Reports = (() => {
  let data, models, charts = [], loading;
  const colors = ['#2563eb','#16a34a','#e11d48','#9333ea','#ea580c','#0891b2'];
  const el = id => document.getElementById(id);
  const esc = x => String(x).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const pct = x => Number.isFinite(x) ? x.toFixed(2)+'%' : 'N/A';
  const num = x => Number.isFinite(x) ? x.toFixed(2) : 'N/A';
  const mean = a => a.length ? a.reduce((s,x)=>s+x,0)/a.length : null;
  const week = date => Math.max(1,1+Math.floor((Date.parse(date+'T00:00:00Z')-Date.parse('2026-09-04T00:00:00Z'))/604800000));
  function weights(history,w) {
    if(w===1) return {SPY:1};
    const keys=Object.keys(history).map(Number).filter(k=>k<=w).sort((a,b)=>b-a);
    return keys.length ? history[keys[0]] : {SPY:1};
  }
  function turnover(a,b) {
    return 50*[...new Set([...Object.keys(a),...Object.keys(b)])].reduce((s,t)=>s+Math.abs((a[t]||0)-(b[t]||0)),0);
  }
  function dailyReturn(alloc,i,d) {
    return Object.entries(alloc).reduce((sum,[t,w])=>{
      if(!w) return sum;
      const p=d.prices[t];
      if(!p || !Number.isFinite(p[i]) || !Number.isFinite(p[i-1]) || p[i-1]<=0) throw Error('Missing prices for '+t+' on '+d.dates[i]);
      return sum+w*(p[i]/p[i-1]-1);
    },0);
  }
  function model(name,history,d) {
    let value=1,peak=1,drawdown=0;
    const returns=[],values=[1],contributions={},weekly={};
    for(let i=1;i<d.dates.length;i++) {
      const w=week(d.dates[i]), a=weights(history,w), r=dailyReturn(a,i,d);
      Object.entries(a).forEach(([t,weight])=>{
        if(weight) contributions[t]=(contributions[t]||0)+value*weight*(d.prices[t][i]/d.prices[t][i-1]-1)*100;
      });
      value*=1+r;peak=Math.max(peak,value);drawdown=Math.min(drawdown,value/peak-1);
      values.push(value);returns.push(r);weekly[w]=(weekly[w]||1)*(1+r);
    }
    const lastWeek=week(d.dates.at(-1));
    const decisions=[]; let missing=0;
    for(let w=2;w<=lastWeek;w++) {
      if(!history[w]) {missing++;continue;}
      const prior=weights(history,w-1),next=weights(history,w),amount=turnover(prior,next);
      let actual=1,hold=1,days=0;
      for(let i=1;i<d.dates.length;i++) if(week(d.dates[i])===w) {
        actual*=1+dailyReturn(next,i,d); hold*=1+dailyReturn(prior,i,d);days++;
      }
      if(days) decisions.push({week:w,amount,actual:(actual-1)*100,hold:(hold-1)*100,benefit:(actual-hold)*100,days});
    }
    const avg=mean(returns);
    const risk=returns.length>1?Math.sqrt(returns.reduce((s,r)=>s+(r-avg)**2,0)/(returns.length-1))*100:null;
    const current=weights(history,lastWeek);
    return {name,history,ret:(value-1)*100,risk,drawdown:drawdown*100,values,weekly,contributions,decisions,missing,
      activity:mean(decisions.map(x=>x.amount)),changes:decisions.filter(x=>x.amount>0.01).length,
      current,concentration:100*Object.values(current).reduce((s,w)=>s+w*w,0)};
  }
  function correlation(points) {
    if(points.length<3)return null;
    const ax=mean(points.map(p=>p.x)),ay=mean(points.map(p=>p.y));
    const den=Math.sqrt(points.reduce((s,p)=>s+(p.x-ax)**2,0)*points.reduce((s,p)=>s+(p.y-ay)**2,0));
    return den ? points.reduce((s,p)=>s+(p.x-ax)*(p.y-ay),0)/den : null;
  }
  function chart(id,type,labels,datasets,xTitle='',yTitle='') {
    const textColor=getComputedStyle(document.body).getPropertyValue('--text').trim()||'#cbd5e1';
    const axis=title=>({title:{display:!!title,text:title,color:textColor},ticks:{color:textColor},grid:{color:'rgba(148,163,184,.18)'}});
    charts.push(new Chart(el(id),{type,data:{labels,datasets},options:{responsive:true,maintainAspectRatio:false,
      plugins:{legend:{display:datasets.length>1,labels:{color:textColor}},tooltip:{callbacks:{label:ctx=>{
        if(type==='scatter')return ctx.raw.team+': '+xTitle+' '+num(ctx.raw.x)+', '+yTitle+' '+num(ctx.raw.y);
        return ctx.dataset.label+': '+num(ctx.parsed.y);
      }}}},scales:{x:axis(xTitle),y:axis(yTitle)}}}));
  }
  function bars(id,labels,values,label) {chart(id,'bar',labels,[{label,data:values,backgroundColor:values.map(v=>v>=0?'#2563eb':'#e11d48')}],'',label);}
  function scatter(id,teams,x,y,xt,yt,bench=false) {
    const sets=[{label:'Teams',data:teams.filter(t=>Number.isFinite(t[x])&&Number.isFinite(t[y])).map(t=>({x:t[x],y:t[y],team:t.name})),backgroundColor:colors[0],pointRadius:6}];
    if(bench) [models.spy,models.ai].filter(Boolean).forEach((t,i)=>sets.push({label:t.name,data:[{x:t[x],y:t[y],team:t.name}],backgroundColor:colors[i+1],pointRadius:9,pointStyle:'triangle'}));
    chart(id,'scatter',[],sets,xt,yt);
  }
  function table(headers,rows) {
    el('reports-table').innerHTML='<table style="width:100%;border-collapse:collapse"><thead><tr>'+headers.map(x=>'<th style="text-align:left;padding:10px;border-bottom:1px solid var(--border)">'+esc(x)+'</th>').join('')+'</tr></thead><tbody>'+rows.map(row=>'<tr>'+row.map(x=>'<td style="padding:10px;border-bottom:1px solid var(--border)">'+esc(x)+'</td>').join('')+'</tr>').join('')+'</tbody></table>';
  }
  const holdings = t => Object.entries(t.current).filter(([,v])=>v>0).sort((a,b)=>b[1]-a[1]).map(([k,v])=>k+' '+pct(v*100)).join(' · ');
  const drivers = t => Object.entries(t.contributions).sort((a,b)=>a[1]-b[1]);
  function driverText(t) {
    const a=drivers(t),low=a[0],high=a.at(-1);
    if(!low)return '';
    return `${t.name}: largest contribution ${high[0]} (${num(high[1])} percentage points); lowest contribution ${low[0]} (${num(low[1])} points). These are contributions across all historical allocations, not only today's holdings.`;
  }
  function render() {
    if(!data)return;
    charts.forEach(c=>c.destroy());charts=[];
    const section=el('reports-section').value,kind=el('reports-type').value;
    const teams=models.teams.filter(t=>t.name.startsWith('S'+section+'-')).sort((a,b)=>b.ret-a.ret);
    el('reports-output').style.display=teams.length?'':'none';
    if(!teams.length){el('reports-status').textContent='No submissions available for this section.';return;}
    const lastWeek=week(data.dates.at(-1));
    el('reports-status').textContent=`Section ${section} · ${teams.length} teams · ${data.dates[0]} through ${data.dates.at(-1)} · Week ${lastWeek} · ${data.dates.length-1} daily returns. Current week may be partial. ${data.generatedAt?'Snapshot updated '+new Date(data.generatedAt).toLocaleString('en-US',{timeZone:'America/Los_Angeles'})+' Pacific. ':''}Reports use their own price snapshot; last-day values can differ from an earlier dashboard update.`;
    let paragraphs=[];
    if(kind==='leaders') {
      const best=teams[0],worst=teams.at(-1);
      bars('reports-chart-a',teams.map(t=>t.name),teams.map(t=>t.ret),'Cumulative return (%)');
      const tickers=[...new Set([...Object.keys(best.contributions),...Object.keys(worst.contributions)])];
      chart('reports-chart-b','bar',tickers,[best,worst].map((t,i)=>({label:t.name,data:tickers.map(k=>t.contributions[k]||0),backgroundColor:colors[i]})),'ETF','Contribution (percentage points)');
      paragraphs=[`${best.name} leads with ${pct(best.ret)}; ${worst.name} has the lowest return at ${pct(worst.ret)}. The gap is ${num(best.ret-worst.ret)} percentage points. SPY returned ${pct(models.spy.ret)} over the same period.`,driverText(best),driverText(worst)];
      table(['Team','Return','Vs. SPY (pp)','Daily risk','Max drawdown','Latest effective holdings'],teams.map(t=>[t.name,pct(t.ret),num(t.ret-models.spy.ret),pct(t.risk),pct(t.drawdown),holdings(t)]));
    } else if(kind==='activity') {
      const eligible=teams.filter(t=>t.activity!==null).sort((a,b)=>b.activity-a.activity);
      scatter('reports-chart-a',eligible,'activity','ret','Average target reallocation (%)','Cumulative return (%)');
      scatter('reports-chart-b',eligible,'activity','risk','Average target reallocation (%)','Daily volatility (%)');
      const cr=correlation(eligible.map(t=>({x:t.activity,y:t.ret}))),cv=correlation(eligible.map(t=>({x:t.activity,y:t.risk})));
      paragraphs=[eligible.length?`Highest average allocation activity: ${eligible[0].name} (${pct(eligible[0].activity)} per submitted decision). Lowest: ${eligible.at(-1).name} (${pct(eligible.at(-1).activity)}). Ties may occur; the table includes every team.`:'No submitted decisions are available for activity comparison.',
        `Across ${eligible.length} teams, the correlation of activity with return is ${num(cr)}, and with daily volatility is ${num(cv)}. N/A means too few observations or no variation. These describe associations, not evidence that trading caused returns or risk.`,
        'Activity is half the absolute change in target weights relative to the prior effective allocation. A repeated submission counts as zero change. Missing submissions are counted separately, not classified as passive decisions. This measures target allocation changes, not actual traded turnover.'];
      table(['Team','Mean reallocation','Changed / submitted weeks','Missing weeks','Return','Daily risk','Max drawdown'],teams.slice().sort((a,b)=>(b.activity??-1)-(a.activity??-1)).map(t=>[t.name,pct(t.activity),t.changes+' / '+t.decisions.length,t.missing,pct(t.ret),pct(t.risk),pct(t.drawdown)]));
    } else if(kind==='changes') {
      const results=teams.map(t=>{
        const changed=t.decisions.filter(d=>d.amount>0.01);
        return {...t,changed,benefit:mean(changed.map(d=>d.benefit)),helped:changed.filter(d=>d.benefit>0.000001).length};
      }).sort((a,b)=>(b.benefit??-Infinity)-(a.benefit??-Infinity));
      const active=results.filter(t=>t.changed.length);
      bars('reports-chart-a',active.map(t=>t.name),active.map(t=>t.benefit),'Mean decision benefit (pp)');
      const weeks=Array.from({length:Math.max(0,lastWeek-1)},(_,i)=>i+2);
      chart('reports-chart-b','bar',weeks.map(w=>'Week '+w),[{label:'Mean change benefit (pp)',data:weeks.map(w=>mean(active.flatMap(t=>t.changed.filter(d=>d.week===w).map(d=>d.benefit)))),backgroundColor:colors[0]}],'Decision week','Mean benefit (pp)');
      const all=active.flatMap(t=>t.changed),helped=all.filter(d=>d.benefit>0.000001).length;
      paragraphs=[`${all.length} allocation changes were evaluated across the full history. ${helped} improved that week's return versus keeping the previous target allocation. The average difference per changed decision was ${num(mean(all.map(d=>d.benefit)))} percentage points.`,
        active.length?`${active[0].name} has the highest mean decision benefit (${num(active[0].benefit)} points across ${active[0].changed.length} changes). Compare sample sizes before interpreting the ranking.`:'No allocation changes are available to evaluate.',
        'Each counterfactual holds the previous target weights constant for that decision week, using the same daily-weight convention as the dashboard. It is not a buy-and-hold share simulation. Benefits are averaged across decisions; they are not additive cumulative portfolio returns. No transaction costs are modeled.'];
      table(['Team','Changed weeks','Beneficial changes','Mean benefit (pp)','Cumulative return','Latest effective holdings'],results.map(t=>[t.name,t.changed.length,t.helped,num(t.benefit),pct(t.ret),holdings(t)]));
    } else if(kind==='risk') {
      scatter('reports-chart-a',teams,'risk','ret','Daily volatility (%)','Cumulative return (%)',true);
      bars('reports-chart-b',teams.map(t=>t.name),teams.map(t=>t.drawdown),'Maximum drawdown (%)');
      const least=teams.filter(t=>t.risk!==null).sort((a,b)=>a.risk-b.risk)[0];
      const outperform=teams.filter(t=>t.ret>models.spy.ret&&t.risk!==null&&models.spy.risk!==null&&t.risk<models.spy.risk);
      paragraphs=[least?`${least.name} has the lowest daily volatility (${pct(least.risk)}), with a cumulative return of ${pct(least.ret)} and maximum drawdown of ${pct(least.drawdown)}.`:'Too few daily observations to estimate volatility.',`${outperform.length} teams earned more than SPY with lower realized daily volatility over this sample${outperform.length?': '+outperform.map(t=>t.name).join(', '):''}. SPY: ${pct(models.spy.ret)} return and ${pct(models.spy.risk)} daily volatility.`,
        'Volatility is the sample standard deviation of daily returns, without annualization. Maximum drawdown measures the largest peak-to-trough loss in daily closing portfolio values. Short samples and incomplete weeks can change these rankings materially.'];
      table(['Team','Return','Daily volatility','Max drawdown','Vs. SPY (pp)','Latest effective holdings'],teams.map(t=>[t.name,pct(t.ret),pct(t.risk),pct(t.drawdown),num(t.ret-models.spy.ret),holdings(t)]));
    } else {
      scatter('reports-chart-a',teams,'concentration','ret','Current concentration (HHI × 100)','Cumulative return (%)');
      scatter('reports-chart-b',teams,'concentration','risk','Current concentration (HHI × 100)','Daily volatility (%)');
      const ordered=teams.slice().sort((a,b)=>b.concentration-a.concentration);
      paragraphs=[`${ordered[0].name} has the highest current concentration (${num(ordered[0].concentration)}); ${ordered.at(-1).name} has the lowest (${num(ordered.at(-1).concentration)}).`,
        'Concentration is the sum of squared target weights × 100: one holding scores 100; four equal holdings score 25. Current concentration is a snapshot, while return and risk cover the full history. This comparison cannot attribute historical performance to current holdings. ETF count also does not measure underlying sector overlap.'];
      table(['Team','Current concentration','Holdings count','Return','Daily risk','Latest effective holdings'],ordered.map(t=>[t.name,num(t.concentration),Object.values(t.current).filter(w=>w>0).length,pct(t.ret),pct(t.risk),holdings(t)]));
    }
    el('reports-analysis').innerHTML=paragraphs.map(p=>'<p style="margin:0 0 12px;line-height:1.65">'+esc(p)+'</p>').join('');
  }
  async function open() {
    if(data){render();return;}
    if(loading)return loading;
    el('reports-status').textContent='Loading portfolio history and calculating reports…';
    loading=(async()=>{
      try {
        const r=await fetch('reports-data.json',{cache:'no-store'});
        if(!r.ok)throw Error('Report data unavailable (HTTP '+r.status+')');
        const loaded=await r.json();
        if(loaded.dates.length<2)throw Error('At least two daily prices are required.');
        const teams=Object.entries(loaded.students).map(([id,h])=>model(id,h,loaded));
        models={teams,spy:model('SPY',{},loaded),ai:Object.keys(loaded.ai||{}).length?model('AI',loaded.ai,loaded):null};
        data=loaded;
        const sections=[...new Set(teams.map(t=>/^S(\d+)-/.exec(t.name)?.[1]).filter(Boolean))].sort((a,b)=>a-b);
        el('reports-section').innerHTML=sections.map(s=>'<option value="'+esc(s)+'">Section '+esc(s)+'</option>').join('');
        render();
      } catch(e) {data=null;el('reports-status').textContent=e.message+' Use Retry to load again.';}
      finally {loading=null;}
    })();
    return loading;
  }
  function mount() {
    const button=document.createElement('button');button.className='tab-btn';button.textContent='📈 Reports';button.onclick=function(){showPage('reports',this);open();};
    document.querySelector('.tab-bar').insertBefore(button,document.querySelector('.tab-bar').lastElementChild);
    const page=document.createElement('div');page.id='page-reports';page.className='page';
    page.innerHTML=`<div class="card" style="padding:24px"><h2 style="margin:0 0 8px">Portfolio Reports</h2><p style="color:var(--muted)">From inception through the latest available trading day. Explore decisions, performance and risk within each section.</p>
      <div style="display:flex;gap:16px;flex-wrap:wrap;margin:20px 0"><label>Report<br><select id="reports-type" style="padding:10px;max-width:100%"><option value="leaders">Leaders, laggards & return drivers</option><option value="activity">Active vs. stable allocations</option><option value="changes">Did allocation changes help?</option><option value="risk">Risk vs. reward</option><option value="concentration">Concentration & diversification</option></select></label><label>Section<br><select id="reports-section" style="padding:10px"><option>Loading…</option></select></label><button id="reports-retry" class="tab-btn">Retry / reload data</button></div>
      <p id="reports-status" role="status" style="color:var(--muted);line-height:1.6"></p>
      <div id="reports-output" style="display:none"><div id="reports-analysis" style="padding:20px;background:var(--surface);border:1px solid var(--border);border-radius:12px;margin:20px 0" aria-live="polite"></div>
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,380px),1fr));gap:24px"><div style="height:350px;min-width:0"><canvas id="reports-chart-a" aria-label="Primary report chart" role="img"></canvas></div><div style="height:350px;min-width:0"><canvas id="reports-chart-b" aria-label="Secondary report chart" role="img"></canvas></div></div>
      <div id="reports-table" style="overflow-x:auto;margin-top:24px;font-size:12px"></div><details style="margin-top:20px;line-height:1.7"><summary>Data & methodology</summary><p>Read-only snapshot of submitted allocations and adjusted Yahoo Finance closes. Week 1 is 100% SPY. Later missing submissions carry the last available allocation, or SPY if none exists. Target weights are applied to daily ETF returns, matching the dashboard convention; transaction costs are excluded. Reports recompute from the snapshot's full-precision prices, so rounding or later price revisions may produce small differences from previously generated dashboard figures. Latest holdings are target allocations, not drifted holdings. Text is generated from calculated statistics. No student names, credentials or rationales are included in this report snapshot.</p></details></div></div>`;
    document.getElementById('page-settings').before(page);
    el('reports-type').onchange=render;el('reports-section').onchange=render;
    el('reports-retry').onclick=()=>{data=null;el('reports-output').style.display='none';open();};
  }
  return {open,mount,model,turnover,week,correlation,weights};
})();
if(typeof document!=='undefined') Reports.mount();
if(typeof module!=='undefined') module.exports=Reports;
