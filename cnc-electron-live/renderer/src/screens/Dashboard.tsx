import React, { useEffect, useMemo, useState } from "react";

type Session = {
  programName: string;
  startTs: number;
  endTs: number;
  workSec: number;
  idleSec: number;
  emergencySec: number;
  finishType: string;
  operator?: string;
};

type DayAgg = {
  day: string;
  programs: number;
  workSec: number;
  idleSec: number;
  emergencySec: number;
  ok: number;
  emergency: number;
};

type Stats = {
  totals: { workSec: number; idleSec: number; emergencySec: number };
  byDay: DayAgg[];
  sessions: Session[];
};

type Runtime = {
  name: string;
  startTs: number;
  workSec: number;
  idleSec: number;
  emerSec: number;
  operator?: string;
} | null;

type Snapshot = { ts?: number; progress?: number | null; status?: string | null; currentProgram?: string | null; mode?: string | null; tool?: number | null; };

const DEFAULT_STATS: Stats = {
  totals: { workSec: 0, idleSec: 0, emergencySec: 0 },
  byDay: [],
  sessions: [],
};

const pad = (n: number) => String(n).padStart(2, "0");
const toLocalInputValue = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
const fromLocalInputValue = (v: string) => {
  const d = new Date(v);
  if (!Number.isNaN(d.getTime())) return d;
  const [date, time] = v.split("T");
  const [y, m, dd] = date.split("-").map(Number);
  const [hh, mi] = (time || "").split(":").map(Number);
  return new Date(y, (m || 1) - 1, dd || 1, hh || 0, mi || 0, 0);
};
const startOfDay = (d: Date) => { const x = new Date(d); x.setHours(0,0,0,0); return x; };
const endOfDay = (d: Date) => { const x = new Date(d); x.setHours(23,59,59,999); return x; };
const fmtH = (sec: number) => (sec / 3600).toFixed(2);
const fmtSec = (s: number) => { const h=Math.floor(s/3600), m=Math.floor((s%3600)/60), sc=s%60; return `${h}h ${m}m ${sc}s`; };
const pct = (part: number, whole: number) => whole <= 0 ? 0 : Math.round((part/whole)*100);
const fmtTs = (ts?: number) => ts ? new Date(ts).toLocaleTimeString() : "—";

// Donut
type DonutProps = { size?: number; thickness?: number; work: number; idle: number; emer: number; colors?: { work: string; idle: string; emer: string; track: string }; };
function Donut({ size = 140, thickness = 18, work, idle, emer, colors }: DonutProps) {
  const C = size; const R = C/2 - thickness/2; const len = 2*Math.PI*R;
  const sum = Math.max(1, work + idle + emer);
  const seg = { w: len*(work/sum), i: len*(idle/sum), e: len*(emer/sum) };
  const col = colors ?? { work: "#3b82f6", idle: "#f59e0b", emer: "#ef4444", track: "rgba(255,255,255,0.08)" };
  return (
    <svg width={C} height={C} viewBox={`0 0 ${C} ${C}`}>
      <circle cx={C/2} cy={C/2} r={R} fill="none" stroke={col.track} strokeWidth={thickness}/>
      <g transform={`rotate(-90 ${C/2} ${C/2})`}>
        {seg.w>0 && <circle cx={C/2} cy={C/2} r={R} fill="none" stroke={col.work} strokeWidth={thickness} strokeDasharray={`${seg.w} ${len-seg.w}`} strokeDashoffset={0}/>}
        {seg.i>0 && <circle cx={C/2} cy={C/2} r={R} fill="none" stroke={col.idle} strokeWidth={thickness} strokeDasharray={`${seg.i} ${len-seg.i}`} strokeDashoffset={-seg.w}/>}
        {seg.e>0 && <circle cx={C/2} cy={C/2} r={R} fill="none" stroke={col.emer} strokeWidth={thickness} strokeDasharray={`${seg.e} ${len-seg.e}`} strokeDashoffset={-(seg.w+seg.i)}/>}
      </g>
    </svg>
  );
}

export default function Dashboard() {
  const [from, setFrom] = useState<Date>(startOfDay(new Date()));
  const [to, setTo] = useState<Date>(endOfDay(new Date()));
  const [stats, setStats] = useState<Stats>(DEFAULT_STATS);
  const [busy, setBusy] = useState(false);

  // LIVE
  const [live, setLive] = useState<Runtime>(null);
  const [snap, setSnap] = useState<Snapshot | null>(null);

  useEffect(() => {
    const off =
      (window as any).api.onLive?.(
        ({ snapshot, runtime }: { snapshot: Snapshot; runtime: Runtime }) => {
          setLive(runtime);
          setSnap(snapshot);
        }
      ) || null;
    (async () => {
      try { const first = await (window as any).api.getLive?.(); if (first) { setLive(first.runtime as Runtime); setSnap(first.snapshot as Snapshot); } } catch {}
    })();
    return () => { if (typeof off === "function") off(); };
  }, []);

  async function load() {
    setBusy(true);
    try {
      const payload = await (window as any).api.getStats(from.toISOString(), to.toISOString());
      setStats({
        totals: payload?.totals ?? DEFAULT_STATS.totals,
        byDay: Array.isArray(payload?.byDay) ? payload.byDay : [],
        sessions: Array.isArray(payload?.sessions) ? payload.sessions : [],
      });
    } finally { setBusy(false); }
  }
  useEffect(() => { load(); }, [from, to]);

  // ===== Nakładka LIVE na dane z plików =====
  const mergedTotals = useMemo(() => {
    const t = { ...stats.totals };
    if (live) { t.workSec += live.workSec; t.idleSec += live.idleSec; t.emergencySec += live.emerSec; }
    return t;
  }, [stats, live]);

  const mergedByDay = useMemo(() => {
    const list = [...(stats.byDay || [])];
    if (live) {
      const today = new Date().toISOString().slice(0,10);
      const row = list.find(r => r.day === today) || { day: today, programs: 0, workSec: 0, idleSec: 0, emergencySec: 0, ok: 0, emergency: 0 };
      row.workSec += live.workSec; row.idleSec += live.idleSec; row.emergencySec += live.emerSec;
      if (!list.find(r => r.day === today)) list.push(row);
      list.sort((a,b)=>a.day.localeCompare(b.day));
    }
    return list;
  }, [stats, live]);

  const mergedSessions = useMemo(() => {
    const done = [...(stats.sessions || [])];
    if (live) {
      done.unshift({
        programName: live ? (live as any).name || "(bieżący)" : "(bieżący)",
        startTs: live.startTs,
        endTs: Date.now(),
        workSec: live.workSec,
        idleSec: live.idleSec,
        emergencySec: live.emerSec,
        finishType: "w_trakcie",
        operator: live.operator,
      } as Session);
    }
    return done;
  }, [stats, live]);

  const pie = useMemo(
    () => ({ work: mergedTotals.workSec, idle: mergedTotals.idleSec, emer: mergedTotals.emergencySec }),
    [mergedTotals]
  );

  const elapsed = (live ? live.workSec + live.idleSec + live.emerSec : 0) || 0;
  const liveP = {
    work: pct(live?.workSec || 0, elapsed),
    idle: pct(live?.idleSec || 0, elapsed),
    emer: pct(live?.emerSec || 0, elapsed),
    progress: Math.max(0, Math.min(100, snap?.progress ?? 0)),
  };

  const totalSec = pie.work + pie.idle + pie.emer;
  const oee = totalSec > 0 ? Math.round((pie.work / totalSec) * 100) : 0;

  async function exportCsv() {
    try {
      const { path } = await (window as any).api.requestCsv(from.toISOString(), to.toISOString(), { saveAs: true });
      if (path) alert(`CSV zapisany: ${path}`);
    } catch { alert("Export CSV nie powiódł się"); }
  }

  return (
    <div className="content db">
      <div className="banner"><img src="/top-banner.png" alt="NEXT CNC" /></div>

      <div className="toolbar card">
        <div className="toolbar__group">
          <div className="title">Zakres od</div>
          <input type="datetime-local" value={toLocalInputValue(from)} onChange={(e) => setFrom(fromLocalInputValue(e.target.value))}/>
        </div>
        <div className="toolbar__group">
          <div className="title">do</div>
          <input type="datetime-local" value={toLocalInputValue(to)} onChange={(e) => setTo(fromLocalInputValue(e.target.value))}/>
        </div>
        <div className="toolbar__spacer"/>
        <button className="btn" onClick={load} disabled={busy}>{busy ? "Ładowanie…" : "Odśwież"}</button>
        <button className="btn btn--ghost" onClick={exportCsv}>Eksport CSV</button>
      </div>

      <div className="dashboard-grid" style={{marginBottom:12}}>
        <article className="card col-3 stat">
          <div className="stat__label">Praca</div>
          <div className="stat__value">{fmtH(pie.work)}</div>
          <div className="stat__unit">h</div>
        </article>
        <article className="card col-3 stat">
          <div className="stat__label">Postój</div>
          <div className="stat__value">{fmtH(pie.idle)}</div>
          <div className="stat__unit">h</div>
        </article>
        <article className="card col-3 stat">
          <div className="stat__label">Awaria</div>
          <div className="stat__value">{fmtH(pie.emer)}</div>
          <div className="stat__unit">h</div>
        </article>
        <article className="card col-3 stat">
          <div className="stat__label">OEE (praca / całość)</div>
          <div className="stat__value">{oee}%</div>
          <div className="stat__unit">+ {mergedSessions.length} sesji</div>
        </article>
      </div>

      {/* OEE i narzędzia */}
      <div className="card" style={{ marginTop: 12 }}>
        <div className="card__header">
          <div className="title">Efektywność i narzędzia</div>
        </div>
        <div className="grid" style={{ gridTemplateColumns: "repeat(2,1fr)", gap: 12 }}>
          <div className="kv">
            <div className="kv__label">OEE (Całkowita Efektywność Sprzętu)</div>
            <div className="kv__value">{oee}%</div>
          </div>
          <div className="kv">
            <div className="kv__label">Aktualne narzędzie</div>
            <div className="kv__value">{snap?.tool ?? "—"}</div>
          </div>
        </div>
      </div>

      {/* LIVE % i progress */}
      <div className="card" style={{ marginTop: 12 }}>
        <div className="card__header">
          <div>
            <div className="title">LIVE (bieżąca sesja)</div>
            <div style={{fontWeight:700}}>{snap?.currentProgram || "Brak wczytanego programu"}</div>
          </div>
          <div style={{fontSize:12,opacity:.7}}>Ostatni odczyt: {fmtTs(snap?.ts)}</div>
        </div>
        {!live ? (
          <div className="card__subtle" style={{ padding: 10 }}>— brak aktywnej sesji —</div>
        ) : (
          <div className="grid" style={{ gridTemplateColumns: "repeat(5,1fr)", gap: 12 }}>
            <div className="kv"><div className="kv__label">Status</div><div className="kv__value">{snap?.status ?? "—"}</div></div>
            <div className="kv"><div className="kv__label">Praca [%]</div><div className="kv__value">{liveP.work}%</div></div>
            <div className="kv"><div className="kv__label">Postój [%]</div><div className="kv__value">{liveP.idle}%</div></div>
            <div className="kv"><div className="kv__label">Awaria [%]</div><div className="kv__value">{liveP.emer}%</div></div>
            <div className="kv">
              <div className="kv__label">Progress</div>
              <div className="kv__value">{Math.round(liveP.progress)}%</div>
              <div style={{ marginTop: 6, height: 8, background: "rgba(255,255,255,.08)", borderRadius: 999, overflow: "hidden" }}>
                <div style={{ width: `${liveP.progress}%`, height: "100%", borderRadius: 999, background: "#3b82f6", transition: "width .2s linear" }}/>
              </div>
            </div>
            <div className="kv">
              <div className="kv__label">Czas całkowity</div>
              <div className="kv__value">{fmtSec(elapsed)}</div>
            </div>
          </div>
        )}
      </div>

      {/* Donut LIVE + agregaty */}
      <div className="dashboard-grid">
        <article className="card col-4">
          <header className="title">Rozkład czasu (LIVE + zapisane)</header>
          <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
            <Donut size={150} thickness={18} work={pie.work} idle={pie.idle} emer={pie.emer} />
            <ul className="legend">
              <li><span className="dot dot--work" /> Praca: {fmtSec(pie.work)}</li>
              <li><span className="dot dot--idle" /> Postój: {fmtSec(pie.idle)}</li>
              <li><span className="dot dot--emer" /> Awaria: {fmtSec(pie.emer)}</li>
            </ul>
          </div>
        </article>

        <section className="card col-8">
          <header className="card__header"><div className="title">Zestawienie dzienne (LIVE + zapisane)</div></header>
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Dzień</th>
                  <th>Programy</th>
                  <th>Praca [h]</th>
                  <th>Postój [h]</th>
                  <th>Awaria [h]</th>
                  <th>OK</th>
                  <th>Emergency</th>
                </tr>
              </thead>
              <tbody>
                {(mergedByDay ?? []).length === 0 && (
                  <tr><td colSpan={7}>Brak danych</td></tr>
                )}
                {(mergedByDay ?? []).map((d, i) => (
                  <tr key={i}>
                    <td>{d.day}</td>
                    <td>{d.programs}</td>
                    <td>{fmtH(d.workSec)}</td>
                    <td>{fmtH(d.idleSec)}</td>
                    <td>{fmtH(d.emergencySec)}</td>
                    <td>{d.ok}</td>
                    <td>{d.emergency}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <section className="card col-12">
          <header className="card__header"><div className="title">Sesje (LIVE + zakończone)</div></header>
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Nazwa Programu</th>
                  <th>Operator</th>
                  <th>Start</th>
                  <th>Koniec</th>
                  <th>Praca [s]</th>
                  <th>Postój [s]</th>
                  <th>Awaria [s]</th>
                  <th>Zakończenie</th>
                </tr>
              </thead>
              <tbody>
                {(mergedSessions ?? []).length === 0 && (
                  <tr><td colSpan={8}>Brak sesji w zakresie</td></tr>
                )}
                {(mergedSessions ?? []).map((s, i) => (
                  <tr key={i}>
                    <td>{s.programName}</td>
                    <td>{s.operator || '—'}</td>
                    <td>{new Date(s.startTs).toLocaleString()}</td>
                    <td>{new Date(s.endTs).toLocaleString()}</td>
                    <td>{s.workSec}</td>
                    <td>{s.idleSec}</td>
                    <td>{s.emergencySec}</td>
                    <td>{s.finishType}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </div>
  );
}
