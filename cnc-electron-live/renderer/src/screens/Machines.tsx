import React, { useEffect, useMemo, useState } from "react";

type Snapshot = {
  ts: number;
  currentProgram?: string | null;
  status?: "Ready" | "NotReady" | "FeedHold" | "Start" | string;
  mode?: string | null;
  progress?: number | null;
  feedrateOverride?: number | null;
  isAlarm?: boolean;
  isEmergency?: boolean;
  pos?: { x?: number | null; y?: number | null; z?: number | null };
  isDrilling?: boolean;
  currentAlarmMessages?: string;
  pointer?: number | null;
};

type Runtime = {
  name: string;
  startTs: number;
  workSec: number;
  idleSec: number;
  emerSec: number;
  hadEmergency: boolean;
  operator?: string;
} | null;

const MODE_PL: Record<string, string> = {
  CNCMODE_AUTO: "AUTO",
  CNCMODE_MDI: "PROGRAM",
  CNCMODE_JOG: "RĘCZNE",
  CNCMODE_INCJOG: "KROKI",
  CNCMODE_HOME: "DOMOWA",
  CNCMODE_MPG: "PILOT RĘCZNY",
};

const fmtSecs = (s: number) => {
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sc = s % 60;
  return `${h}h ${m}m ${sc}s`;
};

const fmtTs = (ts?: number | null) => ts ? new Date(ts).toLocaleString() : "—";

export default function Machines() {
  const [snap, setSnap] = useState<Snapshot | null>(null);
  const [rt, setRt] = useState<Runtime>(null);
  const [tools, setTools] = useState<number[]>([]);

  useEffect(() => {
    const off =
      (window as any).api.onLive?.(
        ({ snapshot, runtime, currentTools }: { snapshot: Snapshot; runtime: Runtime; currentTools: number[] }) => {
          setSnap(snapshot);
          setRt(runtime);
          if (currentTools) setTools(currentTools);
        }
      ) || null;

    (async () => {
      try {
        const first = await (window as any).api.getLive?.();
        if (first) {
          setSnap(first.snapshot as Snapshot);
          setRt(first.runtime as Runtime);
          if (first.currentTools) setTools(first.currentTools);
        }
      } catch {}
    })();

    return () => { if (typeof off === "function") off(); };
  }, []);

  const elapsed = useMemo(
    () => (rt ? rt.workSec + rt.idleSec + rt.emerSec : 0),
    [rt]
  );

  const badge = (() => {
    if (snap?.isAlarm || snap?.isEmergency)
      return { text: "Alarm / Emergency", bg: "#ef4444" };
    const s = (snap?.status || "").toLowerCase();
    if (s === "start") return { text: "Start", bg: "#3b82f6" };
    if (s === "ready") return { text: "Ready", bg: "#22c55e" };
    if (s === "feedhold") return { text: "FeedHold", bg: "#f59e0b" };
    if (s === "notready") return { text: "Not ready", bg: "rgba(255,255,255,.18)" };
    return { text: snap?.status ?? "—", bg: "rgba(255,255,255,.18)" };
  })();

  const pillStyle: React.CSSProperties = {
    padding: "4px 10px",
    borderRadius: 999,
    fontSize: 12,
    fontWeight: 600,
    background: badge.bg,
    color: "#fff",
  };

  const progress = Math.max(0, Math.min(100, snap?.progress ?? 0));

  return (
    <div className="content">
      <div className="banner"><img src="/top-banner.png" alt="NEXT CNC" /></div>
      
      <div className="card" style={{marginBottom: 16}}>
        <div style={{display:'flex', justifyContent:'space-between', alignItems:'center'}}>
            <div>
                <div className="title" style={{fontSize:20}}>Maszyna #1</div>
                <div style={{opacity:0.7, fontSize:14}}>Operator: <strong>{rt?.operator || '—'}</strong></div>
            </div>
            <div style={pillStyle}>{badge.text}</div>
        </div>
      </div>

      <div className="card" style={{ marginBottom: 12 }}>
        <div className="card__header">
          <div className="card__title">Podgląd na żywo</div>
          <div style={pillStyle}>{badge.text}</div>
        </div>
        <div className="stats-grid" style={{ gridTemplateColumns: "repeat(4,1fr)" }}>
          <div className="kv">
            <div className="kv__label">Program</div>
            <div className="kv__value">{snap?.currentProgram || "—"}</div>
          </div>
          <div className="kv">
            <div className="kv__label">Tryb</div>
            <div className="kv__value">{snap?.mode ? MODE_PL[snap.mode] ?? snap.mode : "—"}</div>
          </div>
          <div className="kv">
            <div className="kv__label">Progress</div>
            <div className="kv__value">{snap?.progress != null ? `${Math.round(progress)}%` : "—"}</div>
            <div style={{ marginTop: 6, height: 8, background: "rgba(255,255,255,.08)", borderRadius: 999, overflow: "hidden" }}>
              <div style={{ width: `${progress}%`, height: "100%", borderRadius: 999, background: "#3b82f6", transition: "width .2s linear" }}/>
            </div>
          </div>
          <div className="kv">
            <div className="kv__label">Feed override</div>
            <div className="kv__value">{snap?.feedrateOverride != null ? `${Math.round(snap.feedrateOverride)}%` : "—"}</div>
          </div>
          <div className="kv">
            <div className="kv__label">Alarm</div>
            <div className="kv__value">{snap?.isAlarm ? "TAK" : "NIE"}</div>
          </div>
          <div className="kv">
            <div className="kv__label">Emergency</div>
            <div className="kv__value">{snap?.isEmergency ? "TAK" : "NIE"}</div>
          </div>
          <div className="kv"><div className="kv__label">X</div><div className="kv__value">{snap?.pos?.x ?? "—"}</div></div>
          <div className="kv"><div className="kv__label">Y</div><div className="kv__value">{snap?.pos?.y ?? "—"}</div></div>
          <div className="kv"><div className="kv__label">Z</div><div className="kv__value">{snap?.pos?.z ?? "—"}</div></div>
          <div className="kv">
            <div className="kv__label">Pointer (linia)</div>
            <div className="kv__value">{snap?.pointer ?? "—"}</div>
          </div>
          <div className="kv">
            <div className="kv__label">Ostatni odczyt</div>
            <div className="kv__value" style={{fontSize:14}}>{fmtTs(snap?.ts)}</div>
          </div>
        </div>
      </div>

      <div className="grid" style={{ gridTemplateColumns: "1fr 380px", gap: 14 }}>
        <div className="card">
          <div className="card__title">Aktualne alarmy / wiadomości</div>
          {snap?.currentAlarmMessages ? (
            <pre style={{whiteSpace:'pre-wrap', marginTop:10, fontFamily:'inherit'}}>{snap.currentAlarmMessages}</pre>
          ) : (
            <div className="card__subtle" style={{ padding: 6 }}>Brak aktywnych alarmów.</div>
          )}
        </div>

        <div className="card">
          <div className="card__title">Narzędzia (G-Code)</div>
          {tools.length > 0 ? (
            <div style={{display:'flex', flexWrap:'wrap', gap:8, marginTop:10}}>
              {tools.map(t => (
                <div key={t} style={{
                  background: 'rgba(255,255,255,0.1)', 
                  padding: '6px 12px', 
                  borderRadius: 6, 
                  fontWeight: 600,
                  fontSize: 14,
                  border: '1px solid rgba(255,255,255,0.1)'
                }}>
                  T{t}
                </div>
              ))}
            </div>
          ) : (
            <div className="card__subtle" style={{ padding: 6 }}>Brak narzędzi w programie lub brak programu.</div>
          )}
        </div>

        <div className="card">
          <div className="card__title">Sesja bieżąca</div>
          {rt ? (
            <div className="kv-col">
              <div className="kv">
                <div className="kv__label">Start</div>
                <div className="kv__value">{new Date(rt.startTs).toLocaleString()}</div>
              </div>
              <div className="kv">
                <div className="kv__label">Upłynęło</div>
                <div className="kv__value">{fmtSecs(elapsed)}</div>
              </div>
              <div className="kv-sep" />
              <div className="kv"><div className="kv__label">Praca</div><div className="kv__value">{fmtSecs(rt.workSec)}</div></div>
              <div className="kv"><div className="kv__label">Postój</div><div className="kv__value">{fmtSecs(rt.idleSec)}</div></div>
              <div className="kv"><div className="kv__label">Awaria</div><div className="kv__value">{fmtSecs(rt.emerSec)}</div></div>
            </div>
          ) : (
            <div className="card__subtle">— brak aktywnej sesji —</div>
          )}
        </div>
      </div>
    </div>
  );
}
