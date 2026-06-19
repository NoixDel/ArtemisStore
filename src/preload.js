// preload.js
// This script is loaded into the renderer process and is used to expose Electron APIs to the window object.

const { contextBridge, ipcRenderer } = require('electron');

const allowedSendChannels = new Set([
    'activate-office',
    'apply-win-optimizations',
    'download-office',
    'get-settings',
    'get-win-optimizations',
    'install-app',
    'navigate-to-page',
    'open-external-url',
    'open-log-terminal',
    'refresh-win-office-info',
    'refresh-applications-db',
    'run-integrity-advanced-check',
    'run-integrity-check',
    'start-script',
    'uninstall-app',
    'update-all-apps',
    'update-setting',
]);

const allowedReceiveChannels = new Set([
    'integrity-advanced-result',
    'integrity-result',
    'applications-db-refresh-result',
    'install-complete',
    'install-progress',
    'load-apps',
    'office-activation-result',
    'office-activation-status',
    'office-download-complete',
    'office-download-progress',
    'setting-updated',
    'settings-data',
    'uninstall-complete',
    'updates-list',
    'win-office-info',
    'win-optimizations-data',
    'win-optimizations-result',
]);

contextBridge.exposeInMainWorld('electron', {
    send: (channel, ...args) => {
        if (allowedSendChannels.has(channel)) {
            ipcRenderer.send(channel, ...args);
        }
    },
    on: (channel, listener) => {
        if (allowedReceiveChannels.has(channel)) {
            ipcRenderer.on(channel, (_event, ...args) => listener(...args));
        }
    },
    once: (channel, listener) => {
        if (allowedReceiveChannels.has(channel)) {
            ipcRenderer.once(channel, (_event, ...args) => listener(...args));
        }
    },
});

window.addEventListener('DOMContentLoaded', () => {
    const bindNavigation = (elementId, page) => {
        const element = document.getElementById(elementId);
        if (!element) return;

        element.addEventListener('click', (event) => {
            event.preventDefault();
            ipcRenderer.send('navigate-to-page', page);
        });
    };

    bindNavigation('applicationsLink', 'index');
    bindNavigation('winofficeLink', 'winoffice');
    bindNavigation('updatesLink', 'updates');
    bindNavigation('settingsLink', 'settings');
    bindNavigation('WinOptimisationsLink', 'WinOptimisationsLink');
    bindNavigation('IntegrityLink', 'IntegrityLink');

    const openLogBtn = document.getElementById('openLogBtn');
    if (openLogBtn) {
        openLogBtn.addEventListener('click', (event) => {
            event.preventDefault();
            ipcRenderer.send('open-log-terminal');
        });
    }

    const githubExternalLink = document.getElementById('githubExternalLink');
    if (githubExternalLink) {
        githubExternalLink.addEventListener('click', (event) => {
            event.preventDefault();
            ipcRenderer.send('open-external-url', githubExternalLink.href);
        });
    }
});
