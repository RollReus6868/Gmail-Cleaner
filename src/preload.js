// Cau noi giao dien <-> tien trinh chinh.
const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('gc', {
  call: (cmd, payload) => ipcRenderer.invoke('call', cmd, payload),
  onState: (cb) => ipcRenderer.on('state', (_e, state) => cb(state)),
})
