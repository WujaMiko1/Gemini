import { contextBridge, ipcRenderer, IpcRendererEvent } from 'electron';

type MqttState =
  | { state: 'disconnected'; error: string | null }
  | { state: 'connecting';   error: string | null }
  | { state: 'connected';    error: string | null }
  | { state: 'error';        error: string | null };

type Snapshot = {
  ts: number;
  currentProgram: string | null;
  status: string | null;
  mode: string | null;
  progress: number | null;
  feedrateOverride: number | null;
  actualFeedrate: number | null;
  actualSpindleFeedrate: number | null;
  currentAlarmMessages: string;
  isAlarm: boolean;
  isEmergency: boolean;
  pos: { x: number | null; y: number | null; z: number | null };
  isDrilling: boolean;
};

type Runtime = {
  name: string;
  startTs: number;
  workSec: number;
  idleSec: number;
  emerSec: number;
  hadEmergency: boolean;
} | null;

type LivePayload = { snapshot: Snapshot; runtime: Runtime };

type DayAgg = { day:string; programs:number; workSec:number; idleSec:number; emergencySec:number; ok:number; emergency:number };
type SessionRow = { programName:string; startTs:number; endTs:number; workSec:number; idleSec:number; emergencySec:number; finishType:'zakończono_pomyślnie'|'emergency' };
type StatsResponse = { totals:{workSec:number;idleSec:number;emergencySec:number}; byDay:DayAgg[]; sessions:SessionRow[] };
type CsvOptions = { saveAs?: boolean };
type CsvResult  = { path?: string; canceled?: boolean; error?: string };

type Api = {
  onMqttState: (cb: (s: MqttState) => void) => () => void;
  onLive: (cb: (p: LivePayload) => void) => () => void;
  getLive: () => Promise<LivePayload>;
  getStats: (fromIso:string, toIso:string) => Promise<StatsResponse>;
  requestCsv: (fromIso:string, toIso:string, opts?:CsvOptions) => Promise<CsvResult>;
  getConfig: () => Promise<any>;
  setConfig: (cfg:any) => Promise<boolean>;
  connect(host:string, port?:number): Promise<boolean>;
  connect(opts:{host:string; port?:number}): Promise<boolean>;
  ping: () => Promise<true>;
};

const api: any = {
  ping: () => ipcRenderer.invoke('ping'),

  onMqttState: (cb: (s:MqttState)=>void) => {
    const h = (_:IpcRendererEvent, s:MqttState) => cb(s);
    ipcRenderer.on('mqtt:state', h);
    return () => ipcRenderer.removeListener('mqtt:state', h);
  },

  onLive: (cb:(p:LivePayload)=>void) => {
    const h = (_:IpcRendererEvent, p:LivePayload) => cb(p);
    ipcRenderer.on('live:update', h);
    return () => ipcRenderer.removeListener('live:update', h);
  },

  getLive: () => ipcRenderer.invoke('live:get'),
  getStats: (a,b) => ipcRenderer.invoke('stats:get', a, b),
  requestCsv: (a,b,opts?:CsvOptions) => ipcRenderer.invoke('csv:request', a, b, opts || {}),

  getConfig: () => ipcRenderer.invoke('cfg:get'),
  setConfig: (cfg:any) => ipcRenderer.invoke('cfg:set', cfg),

  connect: (hostOrObj:string|{host:string;port?:number}, maybePort?:number) =>
    typeof hostOrObj === 'object'
      ? ipcRenderer.invoke('mqtt:connect', hostOrObj)
      : ipcRenderer.invoke('mqtt:connect', hostOrObj, maybePort),
};

contextBridge.exposeInMainWorld('api', api);
export {};
declare global { interface Window { api: Api } }
