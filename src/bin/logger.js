const winston = require('winston');
const DailyRotateFile = require('winston-daily-rotate-file');
const { app } = require('electron');
const path = require('path');
const { redactSecrets } = require('./security');

// Créez un répertoire de logs s'il n'existe pas
let logDir = path.join(process.env.APPDATA, 'artemisstore', 'logs');

if (app) {
    // Si l'application Electron n'est pas disponible, utilisez un chemin de répertoire par défaut
    logDir = path.join(app.getPath('userData'), 'logs');
}
const fs = require('fs');
if (!fs.existsSync(logDir)) {
    fs.mkdirSync(logDir, { recursive: true });
}

const logger = winston.createLogger({
    level: 'info',
    format: winston.format.combine(
        winston.format.timestamp({ format: 'YYYY/MM/DDT-HH:mm:ss.SSS' }),
        winston.format.errors({ stack: true }),
        winston.format.splat(),
        winston.format.printf((info) => {
            const details = info.stack || info.message;
            return `${info.timestamp} [${info.level.toUpperCase()}] : ${redactSecrets(details)}`;
        })
    ),
    transports: [
        new winston.transports.Console({
            format: winston.format.combine(
                winston.format.colorize({ all: false }),
                winston.format.simple(),
                winston.format.printf((info) =>
                    Buffer.from(redactSecrets(info.message), 'utf8').toString()
                )
            ),
        }),
        new DailyRotateFile({
            filename: logDir + '\\' + 'app-%DATE%.log',
            datePattern: 'YYYY-MM-DD',
            maxSize: '20m',
            maxFiles: '14d',
            encoding: 'utf8',
        }),
    ],
});

module.exports = logger;
