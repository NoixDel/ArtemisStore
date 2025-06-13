/** CheckService.js
 * Vérifie si un service Windows est en cours d'exécution et gère les actions liées aux services.
 */
const { ipcMain, BrowserWindow, dialog, app } = require('electron');
const { exec, spawn } = require('child_process');
const logger = require('../bin/logger');
const path = require('path');

const servicepath = app.isPackaged
    ? path.join(process.resourcesPath, 'services', 'service_install.js')
    : path.join('services', 'service_install.js');

const nodepath = 'node.exe';

function checkServiceStatus(serviceName, callback) {
    const command = `sc query "${serviceName}"`;

    exec(command, (error, stdout, stderr) => {
        if (stdout.includes('1060')) {
            callback(null, `NOT_FOUND`);
            logger.debug(`[CheckService.js] - ${command} -> SERVICE NOT FOUND`);
        } else if (stdout.includes('RUNNING')) {
            callback(null, `RUNNING`);
            logger.debug(`[CheckService.js] - ${command} -> RUNNING`);
        } else if (stdout.includes('STOPPED')) {
            callback(null, `STOPPED`);
            logger.debug(`[CheckService.js] - ${command} -> STOPPED`);
        } else {
            callback(`ERROR ${stderr || stdout}`, null);
            logger.error(`[CheckService.js] - ${command} -> ERROR: ${stderr || stdout}`);
        }
    });
}

async function promptForPassword(parentWindow) {
    const passwordWindow = new BrowserWindow({
        parent: parentWindow,
        modal: true,
        show: false,
        width: 400,
        height: 250,
        frame: false, // Supprime la barre avec les boutons de contrôle
        webPreferences: {
            nodeIntegration: true,
            contextIsolation: false,
        },
    });

    passwordWindow.setMenu(null);
    passwordWindow.setResizable(false);
    passwordWindow.setAlwaysOnTop(true);
    passwordWindow.setTitle('Authentification Administrateur');

    passwordWindow.loadURL(
        'data:text/html;charset=utf-8,' +
            encodeURIComponent(`
        <html>
        <head>
            <title>Authentification Administrateur</title>
            <style>
                body {
                    font-family: Arial, sans-serif;
                    text-align: center;
                    padding: 20px;
                    background-color: #f4f4f9;
                    color: #333;
                }
                h3 {
                    margin-bottom: 20px;
                }
                p {
                    font-size: 14px;
                    color: #555;
                }
                input {
                    width: 100%;
                    padding: 10px;
                    margin: 10px 0;
                    border: 1px solid #ccc;
                    border-radius: 4px;
                }
                button {
                    padding: 10px 20px;
                    margin: 5px;
                    border: none;
                    border-radius: 4px;
                    cursor: pointer;
                }
                #submit {
                    background-color: #4CAF50;
                    color: white;
                }
                #cancel {
                    background-color: #f44336;
                    color: white;
                }
                button:hover {
                    opacity: 0.9;
                }
            </style>
        </head>
        <body>
            <h3>Authentification Requise</h3>
            <p>Veuillez entrer le mot de passe administrateur pour installer ou gérer les applications.</p>
            <input id="password" type="password" placeholder="Mot de passe administrateur" />
            <div>
                <button id="submit">Confirmer</button>
                <button id="cancel">Annuler</button>
            </div>
            <script>
                const { ipcRenderer } = require('electron');
                
                // Fonction pour envoyer le mot de passe
                function submitPassword() {
                    const password = document.getElementById('password').value;
                    ipcRenderer.send('password-submitted', password);
                }

                // Événement sur le bouton "Confirmer"
                document.getElementById('submit').addEventListener('click', submitPassword);

                // Événement sur le bouton "Annuler"
                document.getElementById('cancel').addEventListener('click', () => {
                    ipcRenderer.send('password-cancelled');
                    window.close(); // Ferme la fenêtre
                });

                // Envoi du mot de passe avec la touche "Entrée"
                document.getElementById('password').addEventListener('keydown', (event) => {
                    if (event.key === 'Enter') {
                        submitPassword();
                    }
                });
            </script>
        </body>
        </html>
    `)
    );

    passwordWindow.once('ready-to-show', () => {
        passwordWindow.show();
    });

    return new Promise((resolve, reject) => {
        ipcMain.once('password-submitted', (event, password) => {
            passwordWindow.close();
            resolve(password);
        });

        ipcMain.once('password-cancelled', () => {
            passwordWindow.close();
            reject(new Error('User cancelled password input'));
        });
    });
}

function setupServiceCheckListener(serviceName) {
    console.log(`[CheckService.js] - Execution status of service: ${serviceName}`);

    ipcMain.on('check-service-status', (event) => {
        //console.log(`[CheckService.js] - Checking status of service: ${serviceName}`);
        const win = BrowserWindow.getFocusedWindow();
        if (!win) {
            //logger.error('No focused window found to send progress updates.');
            return;
        }

        checkServiceStatus(serviceName, (error, status) => {
            if (error) {
                win.webContents.send('service-status', {
                    serviceName,
                    status: 'error',
                    message: error,
                });
            } else {
                win.webContents.send('service-status', { serviceName, status });
            }
        });
    });

    ipcMain.on('service-action-install', async (event) => {
        console.log(`[CheckService.js] - Installing service: ${serviceName}`);
        const win = BrowserWindow.getFocusedWindow();
        if (!win) {
            logger.error('No focused window found to send progress updates.');
            return;
        }

        try {
            const password = await promptForPassword(win);
            logger.info(`[CheckService.js] - Password received ${password}`);

            const command = `powershell -Command "Start-Process -FilePath 'node.exe' -ArgumentList '${servicepath} install -password ${password}' -Verb RunAs"`;
            logger.info(`[CheckService.js] - Command to install service: ${command}`);

            exec(command, (error, stdout, stderr) => {
                if (error) {
                    logger.error(
                        `[CheckService.js] - Service installation failed: ${stderr || error.message}`
                    );
                    win.webContents.send('service-action', {
                        serviceName,
                        action: 'install',
                        status: 'error',
                        message: stderr || error.message,
                    });
                } else {
                    logger.info(`[CheckService.js] - Service installed successfully: ${stdout}`);
                    win.webContents.send('service-action', {
                        serviceName,
                        action: 'install',
                        status: 'success',
                        message: stdout,
                    });
                }
            });
        } catch (error) {
            logger.info(
                "[CheckService.js] - Installation annulée par l'utilisateur. : " + error.message
            );
        }
    });

    // Uninstall service
    ipcMain.on('service-action-uninstall', async (event) => {
        logger.info(`[CheckService.js] - Uninstalling service: ${serviceName}`);
        const win = BrowserWindow.getFocusedWindow();
        if (!win) {
            logger.error('No focused window found to send progress updates.');
            return;
        }

        try {
            const command = `powershell -Command "Start-Process -FilePath 'node.exe' -ArgumentList '${servicepath} uninstall' -Verb RunAs"`;
            logger.info(`[CheckService.js] - Command to uninstall service: ${command}`);
            exec(command, (error, stdout, stderr) => {
                if (error) {
                    logger.error(
                        `[CheckService.js] - Service uninstallation failed: ${stderr || error.message}`
                    );
                    win.webContents.send('service-action', {
                        serviceName,
                        action: 'uninstall',
                        status: 'error',
                        message: stderr || error.message,
                    });
                } else {
                    logger.info(`[CheckService.js] - Service uninstalled successfully: ${stdout}`);
                    win.webContents.send('service-action', {
                        serviceName,
                        action: 'uninstall',
                        status: 'success',
                        message: stdout,
                    });
                }
            });
        } catch (error) {
            logger.info('[CheckService.js] - Uninstallation cancelled by user.');
        }
    });

    // Start service
    ipcMain.on('service-action-start', (event) => {
        console.log(`[CheckService.js] - Starting service: ${serviceName}`);
        const win = BrowserWindow.getFocusedWindow();
        if (!win) {
            logger.error('No focused window found to send progress updates.');
            return;
        }

        const command = `powershell -Command "Start-Process -FilePath 'node.exe' -ArgumentList 'services/service_install.js start' -Verb RunAs"`;

        exec(command, (error, stdout, stderr) => {
            if (error) {
                logger.error(
                    `[CheckService.js] - Service start failed: ${stderr || error.message}`
                );
                win.webContents.send('service-action', {
                    serviceName,
                    action: 'start',
                    status: 'error',
                    message: stderr || error.message,
                });
            } else {
                logger.info(`[CheckService.js] - Service started successfully: ${stdout}`);
                win.webContents.send('service-action', {
                    serviceName,
                    action: 'start',
                    status: 'success',
                    message: stdout,
                });
            }
        });
    });

    // Stop service
    ipcMain.on('service-action-stop', (event) => {
        console.log(`[CheckService.js] - Stopping service: ${serviceName}`);
        const win = BrowserWindow.getFocusedWindow();
        if (!win) {
            logger.error('No focused window found to send progress updates.');
            return;
        }

        const command = `powershell -Command "Start-Process -FilePath 'node.exe' -ArgumentList 'services/service_install.js stop' -Verb RunAs"`;

        exec(command, (error, stdout, stderr) => {
            if (error) {
                logger.error(`[CheckService.js] - Service stop failed: ${stderr || error.message}`);
                win.webContents.send('service-action', {
                    serviceName,
                    action: 'stop',
                    status: 'error',
                    message: stderr || error.message,
                });
            } else {
                logger.info(`[CheckService.js] - Service stopped successfully: ${stdout}`);
                win.webContents.send('service-action', {
                    serviceName,
                    action: 'stop',
                    status: 'success',
                    message: stdout,
                });
            }
        });
    });
}

module.exports = { checkServiceStatus, setupServiceCheckListener };
