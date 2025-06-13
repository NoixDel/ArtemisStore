// service-core.js

const http = require('http');
const { spawn } = require('child_process');
const PORT = 63593; // 🔒 Port à utiliser pour la communication sécurisée
const KEY =
    'HMW1tRwIp4YV4JmzBTrqPl2Q8tXm6IiTvVItX3z32GJiCMciz5uafCHBMELCftSqjtY2O9k8qAI1akmQ8JYFuuXhOoeXI8kkRmrj'; // 🔑 Clé à partager avec ton app cliente

// ✅ Whitelist de commandes autorisées
const ALLOWED_COMMANDS = ['winget', 'whoami'];

let queue = [];
let isInstalling = false;

const server = http.createServer((req, res) => {
    if (req.method === 'POST' && req.url === '/run') {
        let body = '';

        req.on('data', (chunk) => {
            body += chunk.toString();
        });

        req.on('end', () => {
            try {
                const { command, key } = JSON.parse(body);

                // ✅ Vérification de la clé API
                if (key !== KEY) {
                    res.writeHead(401, { 'Content-Type': 'application/json' });
                    return res.end(JSON.stringify({ error: 'Clé API invalide' }));
                }

                if (!command) {
                    res.writeHead(400, { 'Content-Type': 'application/json' });
                    return res.end(JSON.stringify({ error: 'Commande manquante' }));
                }

                // ✅ Vérification contre la whitelist
                const baseCmd = command.trim().split(/\s+/)[0].toLowerCase();
                if (!ALLOWED_COMMANDS.includes(baseCmd)) {
                    res.writeHead(403, { 'Content-Type': 'application/json' });
                    return res.end(
                        JSON.stringify({ error: `Commande "${baseCmd}" non autorisée` })
                    );
                }

                console.log(`📥 Commande autorisée reçue : ${command}`);
                queue.push({ command, res });
                processQueue();
            } catch (err) {
                console.error('Erreur lors du traitement de la requête :', err);
                res.writeHead(400, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: 'Requête invalide' }));
            }
        });
    } else {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Route non trouvée' }));
    }
});

function processQueue() {
    if (isInstalling || queue.length === 0) return;

    const { command, res } = queue.shift();
    isInstalling = true;
    let output = '';

    console.log(`▶ Exécution de : ${command}`);
    const proc = spawn('cmd.exe', ['/c', command]);

    proc.stdout.on('data', (data) => {
        output += data.toString();
        process.stdout.write(data);
    });

    proc.stderr.on('data', (data) => {
        output += data.toString();
        process.stderr.write(data);
    });

    proc.on('close', (code) => {
        output += `\n✅ Terminé avec le code ${code}`;
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ output }));
        console.log(`Response sent: ${JSON.stringify({ output })}`);
        isInstalling = false;
        processQueue();
    });

    proc.on('error', (err) => {
        output += `\n❌ Erreur : ${err.message}`;
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: output }));
        isInstalling = false;
        processQueue();
    });
}

server.listen(PORT, '127.0.0.1', () => {
    console.log(`🔒 Service sécurisé lancé sur http://127.0.0.1:${PORT}`);
});
