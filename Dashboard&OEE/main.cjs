// main.cjs
const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const syntec = require('./syntec-connector.cjs');

const isDev = process.env.NODE_ENV !== 'production';

let win;
let controllerState = { state: 'disconnected', error: null, lastOkTs: null, pollMs: 0, targetIp: null };
let cfg = {
  deviceId: os.hostname(),
  controller: { ip: '192.168.1.97', pollMs: 100 },
};

// ====== OPERATORS ======
let operators = [];
let currentOperator = null;
try {
  const opsPath = path.join(__dirname, 'operators.json');
  if (fs.existsSync(opsPath)) {
    operators = JSON.parse(fs.readFileSync(opsPath, 'utf8'));
  }
} catch (e) {
  console.error('Failed to load operators.json', e);
}

// ====== STORAGE / IO ======
const userDir = app ? app.getPath('userData') : path.join(process.cwd(), '.data');
const SESS_PREFIX = 'sessions';

const nowTs = () => Date.now();
const clamp = (n, a, b) => Math.max(a, Math.min(b, n));
const ensureDir = (d) => { try { fs.mkdirSync(d, { recursive: true }); } catch {} };
const isoDay = (t = Date.now()) => new Date(t).toISOString().slice(0, 10);
const todayFile = () => path.join(userDir, `${SESS_PREFIX}_${isoDay()}.jsonl`);
const listSessionFiles = () => {
  try {
    return fs.readdirSync(userDir)
      .filter(f => f === `${SESS_PREFIX}.jsonl` || /^sessions_\d{4}-\d{2}-\d{2}\.jsonl$/.test(f))
      .map(f => path.join(userDir, f));
  } catch { return []; }
};
const readAllSessionLines = () => {
  const out = [];
  for (const f of listSessionFiles()) {
    try {
      const txt = fs.readFileSync(f, 'utf8');
      for (const line of txt.split('\n')) if (line.trim()) out.push(line);
    } catch {}
  }
  return out;
};
const toHHMMSS = (sec) => {
  const s = Math.max(0, Math.floor(sec || 0));
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), ss = s % 60;
  const pad = (n) => (n < 10 ? '0' + n : '' + n);
  return `${pad(h)}:${pad(m)}:${pad(ss)}`;
};
const cleanStr = (v) => String(v ?? '').trim();

// rotacja dzienna
let sessionsPathCurrent = null;
let pollTimer = null;
let pollInFlight = false;
let lastPollOkTs = null;

const pollIntervalMs = () => clamp(cfg.controller?.pollMs || 100, 50, 2000);
const initSessionsFile = () => {
  ensureDir(userDir);
  sessionsPathCurrent = todayFile();
  try { if (!fs.existsSync(sessionsPathCurrent)) fs.writeFileSync(sessionsPathCurrent, ''); } catch {}
};

const startPolling = () => {
  if (pollTimer) clearInterval(pollTimer);
  pollTimer = setInterval(pollController, pollIntervalMs());
};

function createWindow() {
  win = new BrowserWindow({
    width: 1280,
    height: 800,
    webPreferences: { preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true },
  });
  if (isDev) win.loadURL('http://localhost:5173');
  else win.loadFile(path.join(__dirname, 'renderer/index.html'));
}

app.whenReady().then(() => {
  initSessionsFile();
  createWindow();
  setControllerState('connecting', null, { targetIp: cfg.controller.ip, pollMs: pollIntervalMs() });
  startPolling();
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });

// ====== Syntec Controller ======
let snapshot = {
  ts: 0,
  currentProgram: null,
  status: null,              // Ready / NotReady / FeedHold / Start
  mode: null,                // CNCMODE_*
  progress: null,            // 0..100
  feedrateOverride: null,    // 0..150
  actualFeedrate: null,
  currentAlarmMessages: '',
  isAlarm: false,
  isEmergency: false,
  pos: { x: null, y: null, z: null },
  pointer: null,             // do fallback progresu
};

// Do fallback progresu z pointer + gcode
let currentProgramName = null;
let currentGcodeTotalLines = null; // liczba linii g-code do progresu
let currentTools = []; // Lista narzędzi znalezionych w G-code

// SESJE
let runtime = null; // { name, startTs, workSec, idleSec, emerSec, hadEmergency, hadAlarm }
let lastTickTs = null;
let programGoneSince = null;
let readySince = null;

const MIN_PERSIST_SEC = 1;

function setControllerState(state, error = null, extra = {}) {
  controllerState = { state, error, lastOkTs: lastPollOkTs, pollMs: pollIntervalMs(), targetIp: cfg.controller?.ip, ...extra };
  if (win && !win.isDestroyed()) {
    win.webContents.send('controller:state', controllerState);
  }
}

async function pollController() {
  if (pollInFlight) return;
  pollInFlight = true;
  try {
    const data = await syntec.getData(cfg.controller.ip);
    if (data && !data.error) {
      // Success
      snapshot = { ...snapshot, ...data };
      lastPollOkTs = Date.now();
      if (controllerState.state !== 'connected') {
        setControllerState('connected');
      } else {
        setControllerState('connected', null);
      }
      // Process data
      await handleProgramChange();
      startSessionIfNeeded();
      updateDerivedProgressIfNeeded();
      maybeCloseSession();
    } else {
      // Error from C# bridge
      const errorMsg = data?.error || 'Unknown error from bridge';
      if (controllerState.state !== 'error' || controllerState.error !== errorMsg) {
        setControllerState('error', errorMsg);
      }
    }
  } catch (e) {
    // JS-level error
    const errorMsg = e.message || String(e);
    if (controllerState.state !== 'error' || controllerState.error !== errorMsg) {
      setControllerState('error', errorMsg);
    }
    console.error('Poll controller error:', e);
  } finally {
    pollInFlight = false;
  }
}

function isWorking() {
  const status = cleanStr(snapshot.status).toLowerCase();
  return status === 'start';
}

function startSessionIfNeeded() {
  const name = snapshot.currentProgram ? cleanStr(snapshot.currentProgram) : '';
  if (!runtime && name) {
    if (isWorking() || snapshot.isAlarm || snapshot.isEmergency) {
      runtime = {
        name,
        startTs: nowTs(),
        workSec: 0,
        idleSec: 0,
        emerSec: 0,
        hadEmergency: !!snapshot.isEmergency,
        hadAlarm: !!snapshot.isAlarm,
        operator: currentOperator ? currentOperator.name : null,
      };
      programGoneSince = null;
      readySince = null;
    }
  }
}

async function handleProgramChange() {
  const snapName = snapshot.currentProgram ? cleanStr(snapshot.currentProgram) : null;
  if (snapName !== currentProgramName) {
    // zmiana załadowanego programu — wyzeruj dane do progresu z gcode
    currentProgramName = snapName;
    currentGcodeTotalLines = null;
    currentTools = [];
    if (snapName) {
      try {
        const gcode = await syntec.getGCode(cfg.controller.ip);
        if (gcode && typeof gcode === 'string') {
          const lines = gcode.split(/\r?\n/).filter(l => l.trim().length > 0);
          currentGcodeTotalLines = Math.max(1, lines.length);

          // Parsowanie narzędzi (T1, T02, etc.)
          const foundTools = new Set();
          const tRegex = /T(\d+)/gi;
          for (const line of lines) {
            let match;
            while ((match = tRegex.exec(line)) !== null) {
              foundTools.add(parseInt(match[1], 10));
            }
          }
          currentTools = Array.from(foundTools).sort((a, b) => a - b);
          console.log(`[GCode] Found tools for ${snapName}:`, currentTools);
        }
      } catch (e) {
        console.error("Failed to get G-Code:", e);
      }
    }
  }

  if (runtime && snapName && snapName !== runtime.name) {
    closeAndPersistSession('przerwano');
    startSessionIfNeeded();
  }
}

function maybeCloseSession() {
  if (!runtime) return;
  if (typeof snapshot.progress === 'number' && snapshot.progress >= 99.9) {
    return closeAndPersistSession('zakończono_pomyślnie');
  }

  if (!snapshot.currentProgram) {
    if (programGoneSince == null) programGoneSince = nowTs();
    const calm = !isWorking() && !snapshot.isAlarm && !snapshot.isEmergency;
    if (calm && nowTs() - programGoneSince >= 3000) {
      if (runtime.hadEmergency) return closeAndPersistSession('emergency');
      if (runtime.hadAlarm)     return closeAndPersistSession('alarm');
      return closeAndPersistSession('przerwano');
    }
  } else {
    programGoneSince = null;
  }

  const isReady = cleanStr(snapshot.status).toLowerCase() === 'ready'
    && !snapshot.isAlarm && !snapshot.isEmergency && !isWorking();
  if (isReady) {
    if (readySince == null) readySince = nowTs();
    if (nowTs() - readySince >= 300000) {
      return closeAndPersistSession(runtime.hadEmergency ? 'emergency' : (runtime.hadAlarm ? 'alarm' : 'przerwano'));
    }
  } else {
    readySince = null;
  }
}

function tickCounters(ts) {
  if (!runtime) return;
  const t = ts || nowTs();
  if (lastTickTs == null) { lastTickTs = t; return; }
  const dtSec = clamp(Math.floor((t - lastTickTs) / 1000), 0, 5);
  if (dtSec <= 0) return;
  lastTickTs = t;

  const emerg = !!(snapshot.isEmergency);
  const alarm = !!(snapshot.isAlarm);
  if (emerg) { runtime.emerSec += dtSec; runtime.hadEmergency = true; }
  else if (isWorking()) { runtime.workSec += dtSec; }
  else { runtime.idleSec += dtSec; if (alarm) runtime.hadAlarm = true; }
}

function closeAndPersistSession(reason) {
  if (!runtime) return;

  const durationSec = (runtime.workSec | 0) + (runtime.idleSec | 0) + (runtime.emerSec | 0);
  if (durationSec < MIN_PERSIST_SEC) {
    runtime = null; lastTickTs = null; programGoneSince = null; readySince = null;
    return;
  }

  const today = todayFile();
  if (sessionsPathCurrent !== today) {
    sessionsPathCurrent = today;
    try { if (!fs.existsSync(sessionsPathCurrent)) fs.writeFileSync(sessionsPathCurrent, ''); } catch {}
  }
  const endTs = nowTs();

  let finishType = reason;
  if (!finishType) {
    if (runtime.hadEmergency) finishType = 'emergency';
    else if (runtime.hadAlarm) finishType = 'alarm';
    else finishType = 'zakończono_pomyślnie';
  }

  const rec = {
    programName: runtime.name,
    startTs: runtime.startTs,
    endTs,
    workSec: runtime.workSec,
    idleSec: runtime.idleSec,
    emergencySec: runtime.emerSec,
    finishType,
  };
  try { fs.appendFileSync(sessionsPathCurrent, JSON.stringify(rec) + '\n'); } catch(e) { console.error('Write sessions error:', e); }
  runtime = null; lastTickTs = null; programGoneSince = null; readySince = null;
}

// === FALLBACK PROGRESU ===
function updateDerivedProgressIfNeeded() {
  // Progress jest obliczany tylko z pointera i G-code
  if (typeof snapshot.pointer === 'number' && typeof currentGcodeTotalLines === 'number' && currentGcodeTotalLines > 0) {
    const prog = clamp((snapshot.pointer / currentGcodeTotalLines) * 100, 0, 100);
    snapshot.progress = prog;
  } else {
    snapshot.progress = null; // Nie mamy jak policzyć progresu
  }
}

// 1 Hz — zliczanie sekund + odświeżanie live
setInterval(() => {
  tickCounters(nowTs());
  // stan jest wysyłany przez pollController, ale to zapewnia regularną aktualizację czasu
  win?.webContents.send('live:update', { snapshot, runtime });
}, 1000);

// ====== IPC ======
ipcMain.handle('ping', () => true);

ipcMain.handle('operator:list', async () => operators.map(o => ({ id: o.id, name: o.name }))); // Don't send PINs
ipcMain.handle('operator:login', async (_e, pin) => {
  const op = operators.find(o => o.pin === pin);
  if (op) {
    currentOperator = op;
    // If a session is running, maybe we should split it? For now, just update future sessions or current runtime if mutable.
    // Let's just set it for now. Ideally, we'd log an event.
    return { success: true, operator: { id: op.id, name: op.name } };
  }
  return { success: false, error: 'Invalid PIN' };
});
ipcMain.handle('operator:logout', async () => {
  currentOperator = null;
  return { success: true };
});
ipcMain.handle('operator:current', async () => currentOperator ? { id: currentOperator.id, name: currentOperator.name } : null);

ipcMain.handle('cfg:get', async () => cfg);
ipcMain.handle('cfg:set', async (_e, next) => {
  cfg = { ...cfg, ...next, controller: { ...cfg.controller, ...(next?.controller || {}) } };
  // Nowa konfiguracja zostanie automatycznie użyta przez pętlę odpytywania
  setControllerState('reconnecting', null, { targetIp: cfg.controller.ip, pollMs: pollIntervalMs() });
  startPolling();
  return true;
});

// czyszczenie historii (do testów)
ipcMain.handle('sessions:clear', async () => {
  try {
    for (const f of listSessionFiles()) { try { fs.unlinkSync(f); } catch {} }
    initSessionsFile(); runtime = null; lastTickTs = null; programGoneSince = null; readySince = null;
    return { ok: true, dir: userDir };
  } catch (e) { return { ok: false, error: String(e) }; }
});

ipcMain.handle('stats:get', async (_e, fromIso, toIso) => {
  const from = new Date(fromIso).getTime();
  const to = new Date(toIso).getTime();
  const res = { totals: { workSec: 0, idleSec: 0, emergencySec: 0 }, byDay: [], sessions: [] };
  const lines = readAllSessionLines();
  const dayMap = new Map();

  for (const line of lines) {
    let rec; try { rec = JSON.parse(line); } catch { continue; }
    if (rec.endTs < from || rec.startTs > to) continue;

    res.sessions.push(rec);
    res.totals.workSec += rec.workSec | 0;
    res.totals.idleSec += rec.idleSec | 0;
    res.totals.emergencySec += rec.emergencySec | 0;

    const day = new Date(rec.startTs).toISOString().slice(0, 10);
    const a = dayMap.get(day) || { day, programs: 0, workSec: 0, idleSec: 0, emergencySec: 0, ok: 0, emergency: 0 };
    a.programs += 1; a.workSec += rec.workSec | 0; a.idleSec += rec.idleSec | 0; a.emergencySec += rec.emergencySec | 0;
    if (rec.finishType === 'emergency') a.emergency += 1; else a.ok += 1;
    dayMap.set(day, a);
  }

  res.byDay = Array.from(dayMap.values()).sort((a, b) => a.day.localeCompare(b.day));
  return res;
});

ipcMain.handle('live:get', async () => ({
  snapshot,
  runtime,
  controllerState,
  currentOperator: currentOperator ? { name: currentOperator.name } : null,
  currentTools
}));

// TODO: User requested PDF export, this is a temporary CSV implementation.
ipcMain.handle('csv:request', async (e, fromIso, toIso, opts = {}) => {
  try {
    const from = new Date(fromIso).getTime();
    const to = new Date(toIso).getTime();

    const rows = [];
    for (const line of readAllSessionLines()) {
      let rec; try { rec = JSON.parse(line); } catch { continue; }
      if (rec.endTs < from || rec.startTs > to) continue;
      rows.push([
        rec.programName,
        new Date(rec.startTs).toISOString(),
        new Date(rec.endTs).toISOString(),
        rec.workSec, toHHMMSS(rec.workSec),
        rec.idleSec, toHHMMSS(rec.idleSec),
        rec.finishType,
      ]);
    }

    const defaultName = `report_${new Date(from).toISOString().slice(0,10)}_${new Date(to).toISOString().slice(0,10)}.csv`;
    let outPath;

    if (opts && opts.saveAs) {
      const parent = BrowserWindow.fromWebContents(e.sender);
      const { filePath, canceled } = await dialog.showSaveDialog(parent, {
        title: 'Zapisz raport CSV',
        defaultPath: path.join(app.getPath('documents'), defaultName),
        filters: [{ name: 'CSV', extensions: ['csv'] }],
      });
      if (canceled || !filePath) return { canceled: true };
      outPath = filePath.endsWith('.csv') ? filePath : `${filePath}.csv`;
    } else {
      outPath = path.join(userDir, defaultName);
    }

    const header = [
      'Nazwa Programu','Data Rozpoczęcia','Data Zakończenia',
      'Czas Pracy [s]','Czas Pracy [hh:mm:ss]',
      'Czas Postoju [s]','Czas Postoju [hh:mm:ss]',
      'Rodzaj Zakończenia'
    ].join(',');

    const csv = header + '\n' + rows.map(r =>
      r.map(v => {
        const s = String(v);
        return (s.includes(',') || s.includes('"') || s.includes('\n')) ? `"${s.replace(/"/g,'""')}"` : s;
      }).join(',')
    ).join('\n');

    fs.writeFileSync(outPath, csv);
    return { path: outPath };
  } catch (err) {
    return { error: String(err) };
  }
});
