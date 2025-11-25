process.env.EDGE_USE_CORECLR = '0';
let edge;
try {
  edge = require('electron-edge-js');
} catch (e) {
  console.error('[Syntec Connector] Failed to load electron-edge-js. Running in MOCK mode.', e.message);
}
const path = require('path');
const fs = require('fs');

// Dodaj katalog SyntecRemoteAgent do PATH, aby DLL były widoczne dla .NET
const dllDir = path.join(__dirname, '..', 'Dokumentacja Syntec + DLL', 'SyntecRemoteAgent');
if (fs.existsSync(dllDir)) {
  process.env.PATH = dllDir + path.delimiter + process.env.PATH;
  console.log('[Syntec Connector] Added DLL dir to PATH:', dllDir);
} else {
  console.warn('[Syntec Connector] DLL directory missing:', dllDir);
}

// Ścieżka do projektu C#
const csProjectFile = path.join(__dirname, 'native', 'syntec-bridge', 'SyntecBridge.csproj');
console.log('[Syntec Connector] Loading C# bridge from:', csProjectFile);

let syntecInvoke;

if (edge) {
  try {
    syntecInvoke = edge.func({
      projectFile: csProjectFile,
      typeName: 'SyntecBridge',
      methodName: 'Invoke'
    });
    console.log('[Syntec Connector] C# bridge loaded successfully.');
  } catch (e) {
    console.error('[Syntec Connector] Failed to load C# bridge:', e);
    syntecInvoke = null;
  }
}

/**
 * Pobiera dane "snapshot" ze sterownika.
 * @param {string} ip - Adres IP sterownika.
 * @returns {Promise<object>} Obiekt z danymi lub obiekt błędu.
 */
function getData(ip) {
  if (!syntecInvoke) {
    // MOCK DATA
    return Promise.resolve({
      ts: Date.now(),
      currentProgram: 'MOCK_PROG.NC',
      status: 'Start',
      mode: 'AUTO',
      progress: (Date.now() % 10000) / 100,
      feedrateOverride: 100,
      actualFeedrate: 1500,
      currentAlarmMessages: '',
      isAlarm: false,
      isEmergency: false,
      pos: { x: 123.456, y: 78.90, z: -10.5 },
      pointer: 100
    });
  }
  return new Promise((resolve, reject) => {
    const options = { ip, command: 'getData' };
    syntecInvoke(options, (error, result) => {
      if (error) {
        console.error('[Syntec Connector] Error calling getData:', error);
        return reject(error);
      }
      resolve(result);
    });
  });
}

/**
 * Pobiera zawartość pliku G-code ze sterownika.
 * @param {string} ip - Adres IP sterownika.
 * @returns {Promise<string>} Zawartość pliku G-code jako string.
 */
function getGCode(ip) {
  if (!syntecInvoke) {
    return Promise.resolve('MOCK GCODE\nG0 X0 Y0\nG1 X100 F1000\nM30');
  }
  return new Promise((resolve, reject) => {
    const options = { ip, command: 'getGCode' };
    syntecInvoke(options, (error, result) => {
      if (error) {
        console.error('[Syntec Connector] Error calling getGCode:', error);
        return reject(error);
      }
      resolve(result);
    });
  });
}

module.exports = {
  getData,
  getGCode,
};
