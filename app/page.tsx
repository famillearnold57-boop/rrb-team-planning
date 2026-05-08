'use client';

import { useEffect, useMemo, useState } from 'react';
import { supabase } from '@/lib/supabase';

type Emp = { id: string; name: string; contract_hours: number | null; start_date: string | null; end_date: string | null };
type CellType = 'empty'|'presence'|'maladie'|'ferie'|'conges';
type Shift = { employee_id:string; day:string; slot:number; type:CellType };

const DAYS = ['Lundi','Mardi','Mercredi','Jeudi','Vendredi','Samedi','Dimanche'];
const TYPES: {key:CellType; label:string}[] = [
  {key:'presence', label:'Présence'}, {key:'maladie', label:'Maladie'}, {key:'ferie', label:'Férié'}, {key:'conges', label:'Congés'}, {key:'empty', label:'Effacer'}
];
const slots = Array.from({length:25}, (_,i)=> i%2===0 ? `${8+Math.floor(i/2)}h` : `${8+Math.floor(i/2)}h30`);

function mondayOf(d=new Date()){
  const x = new Date(d); const day = x.getDay() || 7; x.setDate(x.getDate()-day+1); x.setHours(12,0,0,0); return x;
}
function iso(d:Date){ return d.toISOString().slice(0,10); }
function fr(d:Date){ return d.toLocaleDateString('fr-FR',{day:'2-digit',month:'2-digit'}); }
function addDays(d:Date,n:number){ const x=new Date(d); x.setDate(x.getDate()+n); return x; }
function addWeeks(d:Date,n:number){ return addDays(d,n*7); }
function hoursLabel(n:number){ return Number.isInteger(n) ? `${n}h` : `${String(n).replace('.',',')}h`; }
function visibleForWeek(e:Emp, weekStart:Date){
  const end = addDays(weekStart, 6);
  if(e.start_date && new Date(e.start_date) > end) return false;
  if(e.end_date && new Date(e.end_date) < weekStart) return false;
  return true;
}

export default function Page(){
  const [weekStart,setWeekStart] = useState<Date>(mondayOf());
  const [weekId,setWeekId] = useState<string>('');
  const [employees,setEmployees] = useState<Emp[]>([]);
  const [shifts,setShifts] = useState<Shift[]>([]);
  const [activeType,setActiveType] = useState<CellType>('presence');
  const [activeDay,setActiveDay] = useState(0);
  const [weekMode,setWeekMode] = useState(false);
  const [painting,setPainting] = useState(false);
  const [newName,setNewName] = useState('');
  const [newContract,setNewContract] = useState(35);
  const [status,setStatus] = useState('');

  const weekLabel = useMemo(()=>`${fr(weekStart)} au ${fr(addDays(weekStart,6))}`,[weekStart]);
  const employeesVisible = useMemo(()=>employees.filter(e=>visibleForWeek(e, weekStart)),[employees,weekStart]);
  const keyOf = (emp:string,day:string,slot:number)=>`${emp}|${day}|${slot}`;
  const shiftMap = useMemo(()=>{
    const m = new Map<string,CellType>(); shifts.forEach(s=>m.set(keyOf(s.employee_id,s.day,s.slot),s.type)); return m;
  },[shifts]);

  useEffect(()=>{ loadAll(); },[]);
  useEffect(()=>{ loadWeek(); },[weekStart]);

  async function loadAll(){
    const {data,error} = await supabase.from('employees').select('*').order('name');
    if(error){ setStatus('Erreur salariés: '+error.message); return; }
    setEmployees(data || []);
  }
  async function loadWeek(){
    setStatus('Chargement...');
    const start = iso(weekStart);
    let {data:week,error} = await supabase.from('weeks').select('*').eq('start_date',start).maybeSingle();
    if(error){ setStatus('Erreur semaine: '+error.message); return; }
    if(!week){
      const r = await supabase.from('weeks').insert({start_date:start}).select('*').single();
      if(r.error){ setStatus('Erreur création semaine: '+r.error.message); return; }
      week = r.data;
    }
    setWeekId(week.id);
    const r2 = await supabase.from('shifts').select('employee_id,day,slot,type').eq('week_id',week.id);
    if(r2.error){ setStatus('Erreur planning: '+r2.error.message); return; }
    setShifts((r2.data || []) as Shift[]);
    setStatus('Sauvegarde automatique active');
  }

  async function addEmployee(){
    if(!newName.trim()) return;
    const {error} = await supabase.from('employees').insert({name:newName.trim(), contract_hours:newContract, start_date:iso(weekStart), end_date:null});
    if(error){ setStatus('Erreur ajout: '+error.message); return; }
    setNewName(''); setNewContract(35); loadAll();
  }
  async function updateEmployee(emp:Emp, patch:Partial<Emp>){
    const {error} = await supabase.from('employees').update(patch).eq('id',emp.id);
    if(error){ setStatus('Erreur salarié: '+error.message); return; }
    setEmployees(prev=>prev.map(e=>e.id===emp.id?{...e,...patch}:e));
  }

  async function setCell(empId:string, day:string, slot:number, type:CellType){
    const key = keyOf(empId,day,slot);
    const prev = shiftMap.get(key) || 'empty';
    if(prev === type) return;
    setShifts(old=>{
      const filtered = old.filter(s=>keyOf(s.employee_id,s.day,s.slot)!==key);
      return type==='empty' ? filtered : [...filtered,{employee_id:empId,day,slot,type}];
    });
    if(type==='empty') await supabase.from('shifts').delete().eq('week_id',weekId).eq('employee_id',empId).eq('day',day).eq('slot',slot);
    else {
      await supabase.from('shifts').delete().eq('week_id',weekId).eq('employee_id',empId).eq('day',day).eq('slot',slot);
      await supabase.from('shifts').insert({week_id:weekId,employee_id:empId,day,slot,type});
    }
  }

  function countHours(empId:string, day?:string){
    return shifts.filter(s=>s.employee_id===empId && s.type==='presence' && (!day || s.day===day)).length*0.5;
  }
  function exportPdf(){ window.print(); }
  function exportBackup(){
    const blob = new Blob([JSON.stringify({employees, shifts, weekStart:iso(weekStart)}, null, 2)], {type:'application/json'});
    const a=document.createElement('a'); a.href=URL.createObjectURL(blob); a.download='rrb-planning-sauvegarde.json'; a.click(); URL.revokeObjectURL(a.href);
  }

  function DayGrid({dayIndex}:{dayIndex:number}){
    const day = DAYS[dayIndex];
    return <div className="day-block">
      <div className="day-title"><span>{day}</span><span>{fr(addDays(weekStart,dayIndex))}</span></div>
      <div className="grid-wrap">
        <table className="planning"><thead><tr><th className="emp">Salarié · contrat · jour · sem.</th>{slots.map((s,i)=><th key={i}>{s}</th>)}<th className="side">Repas</th></tr></thead>
        <tbody>{employeesVisible.map(emp=><tr key={emp.id}>
          <td className="emp"><span>{emp.name}</span> <span style={{color:'#8b5a2b'}}>{emp.contract_hours||0}h</span> <span style={{color:'#111'}}>{hoursLabel(countHours(emp.id,day))}</span> <span style={{color:'#d99000'}}>{hoursLabel(countHours(emp.id))}</span></td>
          {slots.map((_,slot)=>{ const t=shiftMap.get(keyOf(emp.id,day,slot))||'empty'; return <td key={slot} className={`slot ${t}`} onMouseDown={()=>{setPainting(true);setCell(emp.id,day,slot,activeType)}} onMouseEnter={()=>painting&&setCell(emp.id,day,slot,activeType)} onTouchStart={()=>setCell(emp.id,day,slot,activeType)} /> })}
          <td className="side"><input type="checkbox" /></td>
        </tr>)}</tbody></table>
      </div>
    </div>
  }

  return <>
    <header className="app-header no-print"><div className="title">RRB Team Planning</div><div className="toolbar"><button className="btn" onClick={()=>setWeekStart(addWeeks(weekStart,-1))}>←</button><button className="btn yellow">{weekLabel}</button><button className="btn" onClick={()=>setWeekStart(addWeeks(weekStart,1))}>→</button><button className="btn brown desktop-only" onClick={()=>setWeekMode(!weekMode)}>{weekMode?'Mode jour':'Vue semaine'}</button><button className="btn blue" onClick={exportPdf}>PDF</button><button className="btn gray" onClick={exportBackup}>Sauvegarde</button></div></header>
    <main className="main" onMouseUp={()=>setPainting(false)} onMouseLeave={()=>setPainting(false)}>
      <h1 className="title-print">Rock & Roll Bakery — Planning {weekLabel}</h1>
      <div className="card no-print"><div className="selector">{TYPES.map(t=><button key={t.key} className={`btn legend-item ${activeType===t.key?'active':''}`} onClick={()=>setActiveType(t.key)}><span className={`dot ${t.key}`}></span>{t.label}</button>)}</div><div className="small">Couleur active : {TYPES.find(t=>t.key===activeType)?.label}. Clic + glisser pour remplir.</div></div>
      <div className="card no-print"><div className="weekbar"><input value={newName} onChange={e=>setNewName(e.target.value)} placeholder="Nom salarié"/><input type="number" value={newContract} onChange={e=>setNewContract(Number(e.target.value))} style={{width:90}}/><button className="btn green" onClick={addEmployee}>Ajouter</button><span className="small">{status}</span></div></div>
      <div className="card no-print"><div className="emp-list">{employees.map(emp=><div className="emp-row" key={emp.id}><b>{emp.name}</b><label>Contrat<input type="number" value={emp.contract_hours||0} onChange={e=>updateEmployee(emp,{contract_hours:Number(e.target.value)})}/></label><label>Entrée<input type="date" value={emp.start_date||''} onChange={e=>updateEmployee(emp,{start_date:e.target.value||null})}/></label><label>Sortie<input type="date" value={emp.end_date||''} onChange={e=>updateEmployee(emp,{end_date:e.target.value||null})}/></label></div>)}</div></div>
      <div className="card no-print mobile-only"><div className="selector">{DAYS.map((d,i)=><button key={d} className={`btn ${activeDay===i?'yellow':'gray'}`} onClick={()=>setActiveDay(i)}>{d.slice(0,3)} {fr(addDays(weekStart,i))}</button>)}</div></div>
      <div className="card">{weekMode ? DAYS.map((_,i)=><DayGrid key={i} dayIndex={i}/>) : <DayGrid dayIndex={activeDay}/>}</div>
    </main>
  </>;
}
