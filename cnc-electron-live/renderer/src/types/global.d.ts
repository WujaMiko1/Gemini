// renderer/src/types/global.d.ts
export type Snapshot = {
  ts: number;
  currentProgram?: string | null;
  status?: 'Ready' | 'NotReady' | 'FeedHold' | 'Start' | null;
  mode?: string | null;
  isDrilling?: boolean;
  isAlarm?: boolean;
  isEmergency?: boolean;
  progress?: number | null;
  feedrateOverride?: number | null;
  pos?: { x: number | null; y: number | null; z: number | null };
};

export type Runtime = {
  name: string | null;
  startTs: number;
  workSec: number;
  idleSec: number;
  emerSec: number;
  hadEmergency: boolean;
} | null;

export type Session = {
  programName: string;
  startTs: number;
  endTs: number | null;
  workSec: number;
  idleSec: number;
  emergencySec: number;
  finishType: 'zakończono_pomyślnie' | 'emergency' | 'w_trakcie' | string;
};

export type Stats = {
  totals: { workSec: number; idleSec: number; emergencySec: number };
  byDay: Array<{ day: string; programs: number; workSec: number; idleSec: number; emergencySec: number; ok: number; emergency: number }>;
  sessions: Session[];
};

declare global {
  interface Window {
    api: {
      // MQTT
      onMqttState: (cb: (s: any) => void) => () => void;
      getMqttState: () => Promise<any>;
      mqttConnect: (host: string, port: number, topicPrefix?: string) => Promise<any>;

      // Live
      getLive: () => Promise<{ snapshot: Snapshot; runtime: Runtime }>;
      onLive: (cb: (p: { snapshot: Snapshot; runtime: Runtime }) => void) => () => void;

      // Statystyki / CSV / sesje
      getStats: (fromIso: string, toIso: string) => Promise<Stats>;
      requestCsv: (fromIso: string, toIso: string) => Promise<{ path: string }>;
      getRecentSessions: (limit?: number) => Promise<any[]>;

      // Konfiguracja
      getConfig: () => Promise<any>;
      setConfig: (cfg: any) => Promise<any>;
    };
  }
}
