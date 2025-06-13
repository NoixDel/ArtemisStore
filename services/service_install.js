// install-service.js
const { Service } = require('node-windows');
const path = require('path');
const os = require('os');
const { exec } = require('child_process');

// const logger = require('../src/bin/logger');

const SERVICE_NAME = 'ArtemisInstallerService';
const username = os.userInfo().username;
const domain = process.env.USERDOMAIN;

// === Récupération du mot de passe passé en argument ===
function getArgumentValue(argName) {
    const index = process.argv.indexOf(argName);
    if (index !== -1 && index + 1 < process.argv.length) {
        return process.argv[index + 1];
    }
    return null;
}

const password = getArgumentValue('-password');
const action = process.argv[2];

if (!action || !['install', 'uninstall', 'start', 'stop'].includes(action)) {
    console.log(
        'Usage: node install-service.js [install|uninstall|start|stop] -password <motdepasse>'
    );
    process.exit(1);
}

const svc = new Service({
    name: SERVICE_NAME,
    description: 'Service pour exécuter des commandes winget avec privilèges administrateurs',
    script: path.join(__dirname, 'service-core.js'),
    nodeOptions: ['--harmony', '--max_old_space_size=4096'],
});

svc.logOnAs.account = username; // Utilisateur courant
svc.logOnAs.domain = domain; // Domaine de l'utilisateur
svc.logOnAs.password = password; // Mot de passe passé en argument

svc.on('install', () => {
    console.log('[service_install.js] - Installation du service');
    svc.start();
});

svc.on('uninstall', () => {
    console.log('[service_install.js] - Désinstallation du service');
});

svc.on('start', () => {
    console.log('[service_install.js] - Démarrage du service');
});

svc.on('stop', () => {
    console.log('[service_install.js] - Arrêt du service');
});

svc.on('error', (err) => {
    console.log('[service_install.js] - Erreur du service :', err);
});

if (action === 'install') {
    if (!password) {
        console.log(
            '[service_install.js] - Mot de passe non fourni. Utilisez -password <motdepasse>'
        );
        process.exit(1);
    }
    svc.install();
} else if (action === 'uninstall') {
    svc.stop();
    svc.uninstall();
} else if (action === 'start') {
    svc.start();
} else if (action === 'stop') {
    svc.stop();
}
