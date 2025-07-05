// preload.js
// This script is loaded into the renderer process and is used to expose Electron APIs to the window object.

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electron', {
    send: (channel, ...args) => ipcRenderer.send(channel, ...args),
    on: (channel, listener) => ipcRenderer.on(channel, (_event, ...args) => listener(...args)),
    once: (channel, listener) => ipcRenderer.once(channel, (_event, ...args) => listener(...args)),
});

window.addEventListener('DOMContentLoaded', () => {
    document.getElementById('applicationsLink').addEventListener('click', () => {
        ipcRenderer.send('navigate-to-page', 'index');
    });

    document.getElementById('winofficeLink').addEventListener('click', () => {
        ipcRenderer.send('navigate-to-page', 'winoffice');
    });

    document.getElementById('updatesLink').addEventListener('click', () => {
        ipcRenderer.send('navigate-to-page', 'updates');
    });

    document.getElementById('settingsLink').addEventListener('click', () => {
        ipcRenderer.send('navigate-to-page', 'settings');
    });

    document.getElementById('WinOptimisationsLink').addEventListener('click', () => {
        ipcRenderer.send('navigate-to-page', 'WinOptimisationsLink');
    });

    document.getElementById('openLogBtn').addEventListener('click', () => {
        ipcRenderer.send('open-log-terminal');
    });
});
