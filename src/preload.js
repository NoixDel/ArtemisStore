// preload.js
// This script is loaded into the renderer process and is used to expose Electron APIs to the window object.
/* global window, document */

const { contextBridge, ipcRenderer } = require('electron');

const allowedSendChannels = new Set([
    'activate-office',
    'apply-win-optimizations',
    'download-office',
    'get-settings',
    'get-asr-history',
    'get-asr-state',
    'get-win-optimizations',
    'install-app',
    'navigate-to-page',
    'open-external-url',
    'open-log-terminal',
    'refresh-win-office-info',
    'refresh-applications-db',
    'run-integrity-advanced-check',
    'run-integrity-check',
    'run-security-action',
    'set-asr-rules',
    'start-script',
    'uninstall-app',
    'update-all-apps',
    'update-setting',
    'winget-manager-action',
]);

const allowedReceiveChannels = new Set([
    'integrity-advanced-result',
    'integrity-result',
    'security-action-result',
    'applications-db-refresh-result',
    'asr-history-result',
    'asr-state-result',
    'asr-rules-result',
    'install-complete',
    'install-progress',
    'load-apps',
    'log-viewer-result',
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
    'winget-manager-result',
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
            const label = openLogBtn.querySelector('span:last-child');
            if (label) label.textContent = 'Ouverture...';
            openLogBtn.style.pointerEvents = 'none';
            const resetLogButton = (text) => {
                if (label) {
                    label.textContent = text;
                    setTimeout(() => {
                        label.textContent = 'Logs';
                    }, 1800);
                }
                openLogBtn.style.pointerEvents = '';
            };
            const responseTimeout = setTimeout(() => {
                resetLogButton('Erreur logs');
            }, 10000);
            ipcRenderer.once('log-viewer-result', (_ipcEvent, result) => {
                clearTimeout(responseTimeout);
                resetLogButton(result.success ? 'Logs ouverts' : 'Erreur logs');
            });
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
