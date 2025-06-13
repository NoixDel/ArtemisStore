const { Service } = require('node-windows');
const { spawn, exec } = require('child_process');
const net = require('net');
const os = require('os');

const SERVICE_NAME = 'ArtemisInstallerService';
const PIPE_NAME = '\\\\.\\pipe\\ArtemisInstallerPipe';
const queue = [];
let isInstalling = false;
const clients = new Set();
const username = os.userInfo().username;

// === Fonction pour extraire les arguments de la ligne de commande ===
function getArgumentValue(argName) {
    const index = process.argv.indexOf(argName);
    if (index !== -1 && index + 1 < process.argv.length) {
        return process.argv[index + 1];
    }
    return null;
}

// === Vérification droits utilisateur ===
// Vérification élévation des droits
function checkAdminPrivileges(callback) {
    exec('whoami /groups', (error, stdout) => {
        if (error) {
            console.error('Erreur lors de la vérification des privilèges administratifs :', error);
            callback(false);
            return;
        }
        // Vérifie si l'utilisateur appartient au groupe Administrateurs
        const isAdmin = stdout.includes('S-1-5-32-544'); // SID du groupe Administrateurs
        callback(isAdmin);
    });
}
// Remplacement de wincmd.isAdminUser
checkAdminPrivileges(function (isAdmin) {
    if (isAdmin) {
        console.log('The user has administrative privileges.');
    } else {
        console.log('NOT AN ADMIN');
    }
});

/*/:GetUserName
exec("whoami", (error, stdout) => {
  if (error) {
    console.error("Erreur lors de la récupération du nom d'utilisateur :", error);
    return;
  }

  const username = stdout.trim();
  console.log(`Nom d'utilisateur : ${username}`);   
});*/

// Récupération du mot de passe depuis les arguments
const password = getArgumentValue('-password');
// Fonction pour vérifier si le mot de passe est correct
function verifyPassword(username, password, callback) {
    // Utilisation de wincmd pour vérifier le mot de passe
    const command = `net user ${username} ${password}`;
    exec(command, (error, stdout, stderr) => {
        if (error) {
            console.error('Erreur lors de la vérification du mot de passe :', error);
            callback(false);
            return;
        }
        // Vérifie si le mot de passe est correct
        const isValid = !stderr.includes('incorrect');
        callback(isValid);
    });
}

// === Gestion du service Windows ===
const svc = new Service({
    name: SERVICE_NAME,
    description: 'Service pour exécuter des commandes winget avec privilèges administrateurs',
    script: __filename,
    nodeOptions: ['--harmony', '--max_old_space_size=4096'],
});

svc.logOnAs.account = username; // Utilisateur courant
svc.logOnAs.password = password; // Mot de passe passé en argument

svc.on('install', () => {
    console.log('✅ Service installé !');
    svc.start();
});

svc.on('uninstall', () => {
    console.log('🗑 Service désinstallé.');
});

svc.on('start', () => {
    console.log('🚀 Service démarré !');
});

svc.on('stop', () => {
    console.log('🛑 Service arrêté.');
});

svc.on('error', (err) => {
    console.error('❌ Erreur du service :', err);
});

// Vérifie si on doit installer/désinstaller le service
const action = process.argv[2];
if (action === 'install') {
    if (password && password.length > 0) {
        verifyPassword(username, password, (isValid) => {
            if (!isValid) {
                console.error('❌ Mot de passe incorrect. Veuillez réessayer.');
                process.exit(1);
            } else {
                console.log('✅ Mot de passe valide.');
                svc.install();
            }
        });
    } else {
        console.error("❌ Mot de passe non fourni. Utilisez l'argument -password <password>.");
        process.exit(1);
    }
    return;
} else if (action === 'uninstall') {
    svc.stop();
    svc.uninstall();
    return;
} else if (action === 'start') {
    svc.start();
    return;
} else if (action === 'stop') {
    svc.stop();
    return;
}

// === Serveur IPC pour recevoir les commandes d'installation ===
const server = net.createServer((stream) => {
    clients.add(stream);

    stream.on('data', (data) => {
        const command = data.toString().trim();
        console.log(`📥 Demande reçue : ${command}`);
        queue.push({ command, client: stream });
        processQueue();
    });

    stream.on('end', () => {
        clients.delete(stream);
    });
});

// === Vérification si le pipe est déjà en cours d'utilisation ===
server.once('error', (err) => {
    if (err.code === 'EADDRINUSE') {
        console.error("⚠️ Le service est déjà en cours d'exécution !");
        process.exit(1); // Ajoutez cette ligne pour arrêter le processus
    } else {
        console.error('❌ Erreur inattendue :', err);
        process.exit(1);
    }
});

server.listen(PIPE_NAME, () => {
    console.log("🚀 Service d'installation Winget en écoute...");
});

// === Fonction de traitement de la file d'attente ===
function processQueue() {
    if (isInstalling || queue.length === 0) {
        return;
    }

    const { command, client } = queue.shift();
    isInstalling = true;
    console.log(`📦 Exécution de : ${command}`);

    // Utilisation de cmd.exe pour exécuter winget avec les variables d'environnement
    const wingetProcess = spawn('cmd.exe', ['/c', command], {});

    wingetProcess.stdout.on('data', (data) => {
        console.log(`[Winget] ${data}`);
        if (client) client.write(data.toString());
    });

    wingetProcess.stderr.on('data', (data) => {
        console.error(`[Winget Error] ${data}`);
        if (client) client.write(`Erreur: ${data.toString()}`);
    });

    wingetProcess.on('close', (code) => {
        isInstalling = false;
        if (client) client.write(`✅ Commande terminée avec code ${code}\n`);
        processQueue(); // Traite la prochaine commande en file d'attente
    });
}
