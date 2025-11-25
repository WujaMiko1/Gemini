// renderer/src/screens/Settings.tsx
import React, { useEffect, useState } from 'react'
declare global { interface Window { api: any } }

export default function Settings(){
  const [cfg,setCfg] = useState<any>(null)
  useEffect(()=>{ (async()=> setCfg(await window.api?.getConfig?.()))() },[])
  if (!cfg) return <div>Ładowanie…</div>

  async function save(){
    await window.api?.setConfig?.(cfg)
    alert('Zapisano. Nowe ustawienia zostaną zastosowane automatycznie.')
  }

  return (
    <div className="card" style={{maxWidth:600}}>
      <div className="title">Ustawienia Kontrolera</div>
      <div style={{display:'grid',gridTemplateColumns:'180px 1fr',gap:10, alignItems: 'center'}}>
        <label>Adres IP Sterownika</label>
        <input
          value={cfg.controller.ip}
          onChange={e=>setCfg((c:any)=>({...c, controller:{...c.controller, ip: e.target.value}}))}
          placeholder="192.168.1.97"
        />

        <label>Interwał odczytu (ms)</label>
        <input
          type="number"
          min={50}
          max={2000}
          value={cfg.controller.pollMs ?? 100}
          onChange={e=>setCfg((c:any)=>({...c, controller:{...c.controller, pollMs: Number(e.target.value)||100}}))}
        />
        <div />
        <div style={{fontSize:12,opacity:.75}}>100 ms = płynny podgląd. Zwiększ, jeżeli sterownik lub PC nie wyrabia.</div>
      </div>
      <div style={{marginTop:12, display:'flex', gap:8}}>
        <button className="btn" onClick={save}>Zapisz</button>
      </div>
    </div>
  )
}
