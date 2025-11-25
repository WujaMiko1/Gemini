// renderer/src/main.tsx
import React, { useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'
import Machines from './screens/Machines'
import Dashboard from './screens/Dashboard'
import Settings from './screens/Settings'
import './styles.css'

declare global { interface Window { api:any } }

type ControllerState = {
  state?: string
  error?: string | null
  lastOkTs?: number | null
  pollMs?: number
  targetIp?: string | null
}

function App(){
  const [route, setRoute] = useState<'dashboard'|'machines'|'settings'>('dashboard')
  const [controllerState,setControllerState] = useState<ControllerState | null>(null)
  const [cfg, setCfg] = useState<any>(null)
  
  // Operator State
  const [currentOperator, setCurrentOperator] = useState<{id:number, name:string}|null>(null)
  const [loginModalOpen, setLoginModalOpen] = useState(false)
  const [pinInput, setPinInput] = useState('')
  const [loginError, setLoginError] = useState('')

  useEffect(()=>{
    const off=window.api.onControllerState((s:any)=>setControllerState(s));
    (async () => {
      try {
        const live = await (window as any).api.getLive?.();
        if (live) {
            setControllerState(live.controllerState);
            if (live.currentOperator) setCurrentOperator(live.currentOperator);
        }
        const config = await (window as any).api.getConfig?.();
        if (config) setCfg(config);
        
        const op = await window.api.getCurrentOperator?.();
        if (op) setCurrentOperator(op);
      } catch {}
    })();
    return ()=>off&&off()
  },[])

  const handleLogin = async () => {
    setLoginError('');
    const res = await window.api.loginOperator(pinInput);
    if (res.success) {
      setCurrentOperator(res.operator);
      setLoginModalOpen(false);
      setPinInput('');
    } else {
      setLoginError(res.error || 'Błąd logowania');
    }
  };


  const status = controllerState?.state || '—';
  const indicator = (() => {
    const s = status.toLowerCase();
    if (s === 'connected') return { color: '#22c55e', text: 'Połączono' };
    if (s === 'connecting' || s === 'reconnecting') return { color: '#f59e0b', text: 'Łączenie…' };
    if (s === 'error') return { color: '#ef4444', text: 'Błąd połączenia' };
    return { color: 'rgba(255,255,255,.35)', text: status };
  })();
  const controllerLine = cfg?.controller?.ip ? `Sterownik: ${cfg.controller.ip}` : 'Sterownik: —';
  const pollLine = controllerState?.pollMs ? `Odczyt co ${controllerState.pollMs} ms` : '';

  return (
    <div className="layout">
      <aside className="sidebar">
        <div className="logo">CNC Monitor</div>
        
        <div className="operator-card">
            <div>
                <span className="operator-label">Operator</span>
                <div className="operator-info">{currentOperator ? currentOperator.name : 'Niezalogowany'}</div>
            </div>
            {currentOperator ? (
                <div className="btn-logout" onClick={async () => { await window.api.logoutOperator(); setCurrentOperator(null); }}>Wyloguj</div>
            ) : (
                <div className="btn-logout" onClick={() => setLoginModalOpen(true)}>Zaloguj</div>
            )}
        </div>

        <div style={{display:'flex',alignItems:'center',gap:10,marginBottom:10}}>
          <span style={{width:10,height:10,borderRadius:'50%',background:indicator.color,display:'inline-block'}} />
          <div style={{fontSize:12,opacity:.9,fontWeight:700,lineHeight:1.25}}>
            <div>{indicator.text}</div>
            <div style={{opacity:.7}}>{controllerLine}</div>
            {pollLine && <div style={{opacity:.6}}>{pollLine}</div>}
            {controllerState?.error && <div style={{color:'#ef4444',marginTop:6,fontWeight:600}}>{controllerState.error}</div>}
          </div>
        </div>
        <nav className="nav">
          <a className={route==='dashboard'?'active':''} onClick={()=>setRoute('dashboard')}>📊 Dashboard</a>
          <a className={route==='machines'?'active':''} onClick={()=>setRoute('machines')}>🖥 Maszyny</a>
          <a className={route==='settings'?'active':''} onClick={()=>setRoute('settings')}>⚙️ Ustawienia</a>
        </nav>
      </aside>
      <main className="content">
        {route==='dashboard' && <Dashboard/>}
        {route==='machines'  && <Machines/>}
        {route==='settings'  && <Settings/>}
      </main>

      {loginModalOpen && (
        <div className="modal-overlay">
            <div className="modal">
                <h3>Logowanie Operatora</h3>
                <input 
                    type="password" 
                    placeholder="PIN" 
                    value={pinInput} 
                    onChange={e => setPinInput(e.target.value)}
                    onKeyDown={e => e.key === 'Enter' && handleLogin()}
                    autoFocus
                />
                {loginError && <div className="error-msg">{loginError}</div>}
                <div className="modal-actions">
                    <button className="btn btn-secondary" onClick={() => { setLoginModalOpen(false); setPinInput(''); setLoginError(''); }}>Anuluj</button>
                    <button className="btn btn-primary" onClick={handleLogin}>Zaloguj</button>
                </div>
            </div>
        </div>
      )}
    </div>
  )
}
createRoot(document.getElementById('root')!).render(<App/>)
