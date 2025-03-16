const { ipcRenderer } = require('electron');

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
});