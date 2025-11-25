import { app, BrowserWindow, ipcMain } from 'electron'
import path from 'node:path'
import fs from 'node:fs'
import net from 'node:net'
import { MqttBridge } from './mqtt'

let win: BrowserWindow | null = null
let mqtt: MqttBridge | null = null

type AppConfig = { deviceId: string; mqtt: { host: string; port: number } }

const cfgPath = () => path.join(app.getPath('userData'), 'config.json')
function readConfig(): AppConfig {
  try { return JSON.parse(fs.readFileSync(cfgPath(), 'utf8')) }
  catch { return { deviceId: 'CNC-01', mqtt: { host: '192.168.50.140', port: 1883 } } }
}
function writeConfig(c: AppConfig) {
  fs.mkdirSync(app.getPath('userData'), { recursive: true })
  fs.writeFileSync(cfgPath(), JSON.stringify(c, null, 2), 'utf8')
}

function resolvePreload() {
  const pCjs = path.join(__dirname, '../preload.cjs')
  const pMjs = path.join(__dirname, '../preload.mjs')
  const chosen = fs.existsSync(pCjs) ? pCjs : pMjs
  console.log('[MAIN] using preload:', chosen)
  return chosen
}

function createWindow() {
  console.log('[MAIN] STARTED')
  win = new BrowserWindow({
    width: 1400,
    height: 900,
    webPreferences: {
      preload: resolvePreload(),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  })

  const url = process.env.ELECTRON_RENDERER_URL
  if (url) win.loadURL(url)
  else win.loadFile(path.join(__dirname, '../../dist/renderer/index.html'))

  mqtt = new MqttBridge(win)

  // auto-connect po starcie (niezależnie od renderera)
  const cfg = readConfig()
  console.log('[MAIN] auto-connect to MQTT', cfg.mqtt)
  mqtt.connect(cfg.mqtt.host, Number(cfg.mqtt.port) || 1883)

  // self-test
  ipcMain.handle('ping', () => 'pong')

  // config
  ipcMain.handle('cfg:get', () => readConfig())
  ipcMain.handle('cfg:set', (_e, newCfg: AppConfig) => {
    writeConfig(newCfg)
    console.log('[MAIN] cfg:set -> reconnect', newCfg.mqtt)
    mqtt?.connect(newCfg.mqtt.host, Number(newCfg.mqtt.port) || 1883)
    return true
  })

  // ręczne połączenie z UI
  ipcMain.handle('mqtt:connect', (_e, { host, port }: { host: string; port: number }) => {
    console.log('[MAIN] mqtt:connect IPC received', host, port)
    mqtt?.connect(host, Number(port) || 1883)
    return true
  })

  // PROBE: surowy TCP ping, żeby sprawdzić czy port jest osiągalny
  ipcMain.handle('mqtt:probe', async (_e, { host, port }: { host: string; port: number }) => {
    const p = Number(port) || 1883
    console.log('[MAIN] mqtt:probe', host, p)
    return new Promise<{ ok: boolean; ms?: number; error?: string }>((resolve) => {
      const sock = new net.Socket()
      const start = Date.now()
      let done = false

      const finish = (res: { ok: boolean; ms?: number; error?: string }) => {
        if (done) return
        done = true
        try { sock.destroy() } catch {}
        resolve(res)
      }

      sock.setTimeout(3500)
      sock.once('connect', () => finish({ ok: true, ms: Date.now() - start }))
      sock.once('timeout', () => finish({ ok: false, error: 'timeout' }))
      sock.once('error', (err) => finish({ ok: false, error: err?.message || String(err) }))
      sock.connect(p, host)
    })
  })
}

process.on('uncaughtException', (e) => console.error('[MAIN] uncaughtException', e))
process.on('unhandledRejection', (e) => console.error('[MAIN] unhandledRejection', e))

app.whenReady().then(createWindow)
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit() })
app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow() })
