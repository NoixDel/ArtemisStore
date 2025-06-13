const net = require('net');
const { exec } = require('child_process');

const PIPE_NAME = '\\\\.\\pipe\\ArtemisInstallerPipe';
const client = net.createConnection(PIPE_NAME, () => {
    console.log(`📤 Vérification de l'emplacement de winget...`);
    executeWhereWinget();
});

// Fonction pour exécuter la commande "where winget"
function executeWhereWinget() {
    exec('where winget', (error, stdout, stderr) => {
        if (error) {
            console.error(`❌ Erreur lors de l'exécution de 'where winget': ${error.message}`);
            client.end(); // Fermer la connexion en cas d'erreur
            return;
        }
        if (stderr) {
            console.error(`⚠️ Erreur standard: ${stderr}`);
        }
        console.log(`📍 Emplacement de winget:\n${stdout}`);
        client.write(`where winget: ${stdout.trim()}\n`);

        console.log(`📦 Envoi de la commande d'installation...`);
        // Envoi de la commande d'installation
        client.write(
            `winget install -e --id Zoom.Zoom --accept-source-agreements --accept-package-agreements --silent --scope machine`
        );
    });
}

// Fonction pour envoyer la commande d'installation
function sendInstallCommand() {
    console.log(`📤 Envoi de la demande d'installation`);
    client.write(
        'winget install -e --id Zoom.Zoom --accept-source-agreements --accept-package-agreements --silent --scope machine'
    );
}

// Affichage des logs en direct
client.on('data', (data) => {
    console.log(`📥 ${data.toString()}`);
});

// Fermeture propre de la connexion
client.on('end', () => {
    console.log('✅ Fin de la connexion avec le service.');
});
