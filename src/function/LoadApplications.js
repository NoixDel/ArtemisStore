const sqlite3 = require('sqlite3').verbose();
const { checkIfInstalled, getInstalledApps } = require('./CheckIfAppIsInstalled');
const { ensureApplicationDatabase } = require('./ApplicationDatabaseManager');
const logger = require('../bin/logger');

function mapApplication(row, installedApps) {
    const isInstalled = checkIfInstalled(row.appid, row.name, installedApps);
    logger.debug(`${row.name} ${isInstalled}`);

    return {
        id: row.id,
        name: row.name,
        editor: row.editor,
        description: row.description,
        icon: row.icon,
        is_cracked: row.is_cracked,
        source: row.source,
        category: row.category,
        argument: row.argument,
        is_installed: isInstalled,
        popularity: row.popularity,
        appid: row.appid,
        needadm: row.needadm,
    };
}

const loadApplications = async (callback) => {
    const userDbPath = await ensureApplicationDatabase();
    logger.info(`Reading the database: ${userDbPath}`);

    const db = new sqlite3.Database(userDbPath, sqlite3.OPEN_READONLY, (err) => {
        if (err) {
            logger.error(`Erreur ouverture DB: ${err.message}`);
            callback([]);
        }
    });

    db.all('SELECT * FROM applications', (err, rows) => {
        if (err) {
            logger.error(`Error reading the database: ${err}. ${userDbPath}`);
            callback([]);
            db.close();
            return;
        }

        const installedApps = getInstalledApps();
        const allApps = rows
            .map((row) => mapApplication(row, installedApps))
            .sort((a, b) => a.popularity - b.popularity);

        callback(allApps);
        db.close((closeErr) => {
            if (closeErr) {
                logger.error(`Error closing the database: ${closeErr}`);
            }
        });
    });
};

module.exports = loadApplications;
