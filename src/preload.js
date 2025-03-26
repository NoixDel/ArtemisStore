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

  // Handle install button click
  document.querySelectorAll('.btn-install').forEach(button => {
    button.addEventListener('click', event => {
      event.preventDefault();
      const appId = button.getAttribute('data-app-id');
      const appSource = button.getAttribute('data-app-source');
      const appArgument = button.getAttribute('data-app-argument');
      ipcRenderer.send('install-app', appId, appSource, appArgument);
    });
  });

  // Handle uninstall button click
  document.querySelectorAll('.btn-uninstall').forEach(button => {
    button.addEventListener('click', event => {
      event.preventDefault();
      const appId = button.getAttribute('data-app-id');
      const appArgument = button.getAttribute('data-app-argument');
      ipcRenderer.send('uninstall-app', appId, appArgument);
    });
  });
});