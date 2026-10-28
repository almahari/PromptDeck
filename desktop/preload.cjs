'use strict';
const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('promptDeck', {
  command: (command, args) => ipcRenderer.invoke('promptdeck:command', command, args),
  onState: callback => {
    const listener = (_event, state) => callback(state);
    ipcRenderer.on('promptdeck:state', listener);
    return () => ipcRenderer.removeListener('promptdeck:state', listener);
  }
});
