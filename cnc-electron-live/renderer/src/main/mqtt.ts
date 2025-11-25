// src/main/mqtt.ts
import { BrowserWindow } from 'electron'
import { connect, MqttClient } from 'mqtt'

type Snapshot = {
  ts: number
  currentProgram?: string | null
  status?: string | null
  mode?: string | null
  isDrilling?: boolean
  isAlarm?: boolean
  isEmergency?: boolean
  progress?: number | null
  feedrateOverride?: number | null
  pos?: { x?: number; y?: number; z?: number }
}

type Runtime = {
  startTs: number
  workSec: number
  idleSec: number
  emerSec: number
  hadEmergency: boolean
} | null

const DEBUG = false

export class MqttBridge {
  private win: BrowserWindow
  private client: MqttClient | null = null
  private snap: Snapshot = { ts: Date.now() }
  private rt: Runtime = null
  private lastActivity = Date.now()

  constructor(win: BrowserWindow) { this.win = win }

  private emitState(state: string, info?: any) {
    try { this.win.webContents.send('mqtt:state', { state, info }) } catch {}
    if (DEBUG) console.log('[MQTT state]', state, info ?? '')
  }
  private emitLive() {
    try { this.win.webContents.send('live:update', { snapshot: this.snap, runtime: this.rt }) } catch {}
  }

  connect(host: string, port = 1883) {
    if (this.client) { try { this.client.end(true) } catch {} ; this.client = null }
    const url = `mqtt://${host}:${port}`
    const client = connect(url, { reconnectPeriod: 1500 })
    this.client = client

    client.on('connect', () => {
      client.subscribe('nextcnc/#')
      client.subscribe('Nextcnc/#')
      this.emitState('connected', { url })
    })
    client.on('reconnect', () => this.emitState('reconnecting'))
    client.on('close', () => this.emitState('closed'))
    client.on('offline', () => this.emitState('offline'))
    client.on('error', (err) => this.emitState('error', err?.message ?? String(err)))

    client.on('message', (topic, payload) => {
      const s = payload.toString()
      const low = topic.toLowerCase()
      const now = Date.now()
      if (DEBUG) console.log('[MQTT]', topic, s)

      this.snap.ts = now

      // prosta akumulacja czasu sesji
      if (!this.rt) {
        this.rt = { startTs: now, workSec: 0, idleSec: 0, emerSec: 0, hadEmergency: false }
        this.lastActivity = now
      } else {
        const dt = Math.max(0, Math.floor((now - this.lastActivity) / 1000))
        this.lastActivity = now
        const isWork = this.snap.status === 'Start'
        const isEmer = !!this.snap.isEmergency
        if (isEmer) this.rt.emerSec += dt
        else if (isWork) this.rt.workSec += dt
        else this.rt.idleSec += dt
      }

      // pozycje
      if (low.endsWith('/position/x')) { this.snap.pos = this.snap.pos || {}; this.snap.pos.x = Number(s) }
      if (low.endsWith('/position/y')) { this.snap.pos = this.snap.pos || {}; this.snap.pos.y = Number(s) }
      if (low.endsWith('/position/z')) { this.snap.pos = this.snap.pos || {}; this.snap.pos.z = Number(s) }
      if (low.endsWith('/position')) {
        const obj = safeJson(s)
        if (obj && typeof obj === 'object') {
          this.snap.pos = this.snap.pos || {}
          if (isNum(obj.x)) this.snap.pos.x = Number(obj.x)
          if (isNum(obj.y)) this.snap.pos.y = Number(obj.y)
          if (isNum(obj.z)) this.snap.pos.z = Number(obj.z)
        }
      }

      // statusy
      if (low.endsWith('/status/currentprogram')) this.snap.currentProgram = s
      if (low.endsWith('/status/status')) this.snap.status = s
      if (low.endsWith('/status/mode')) this.snap.mode = s
      if (low.endsWith('/status/isdrilling')) this.snap.isDrilling = toBool(s)
      if (low.endsWith('/status/isalarm')) this.snap.isAlarm = toBool(s)
      if (low.endsWith('/status/isemergency')) {
        this.snap.isEmergency = toBool(s)
        if (this.rt && this.snap.isEmergency) this.rt.hadEmergency = true
      }

      // progress
      if (low.endsWith('/current/program/progress') || low.endsWith('/program/progress')) {
        const n = Number(s); if (isFinite(n)) this.snap.progress = n
      }

      // feed override
      if (low.endsWith('/spindle/feedrateoverride')) {
        const n = Number(s); if (isFinite(n)) this.snap.feedrateOverride = n
      }

      this.emitLive()
    })
  }
}

function safeJson(x: string){ try { return JSON.parse(x) } catch { return null } }
function isNum(v:any){ return v!==null && v!==undefined && !isNaN(Number(v)) }
function toBool(s:string){ const t = s.trim().toLowerCase(); return t==='1'||t==='true'||t==='yes' }
