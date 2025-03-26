// LoadApplications.js
// Ce script lit la base de données SQLite des applications et exécute un traitement sur chaque ligne.
// Il est utilisé dans le fichier main.js pour charger les applications dans la page principale de l'application.
// Il est également possible de l'utiliser dans d'autres fichiers pour charger les applications dans d'autres pages.
// Pour cela, il suffit d'importer la fonction loadApplications et de l'appeler avec un callback qui traitera les applications.
// Exemple d'utilisation:
// loadApplications((apps) => {
//   console.log(apps); // Affiche les applications dans la console

const path = require('path');
const fs = require('fs');
const sqlite3 = require('sqlite3').verbose();
const { app } = require('electron');
const { checkIfInstalled, getInstalledApps } = require('./CheckIfAppIsInstalled');
const logger = require('../bin/logger');

const loadApplications = (callback) => {
    const userDbPath = path.join(app.getPath('userData'), 'applications.db');
    const defaultDbPath = path.join(process.resourcesPath, 'applications.db');
    logger.info(`Reading the database: ${userDbPath}`);

    // Copier la base de données si elle n'existe pas encore dans userData
    if (!fs.existsSync(userDbPath)) {
      if (fs.existsSync(defaultDbPath) && fs.statSync(defaultDbPath).size > 0) {
        fs.copyFileSync(defaultDbPath, userDbPath);
        logger.info(`Database copied to ${userDbPath}`);
      } else {
        logger.error(`ERROR: Default database is missing or empty at ${defaultDbPath}`);
      }
    }
    if (fs.existsSync(userDbPath) && fs.statSync(userDbPath).size === 0) {
      logger.warn(`WARNING: Database is empty! Replacing with default database.`);
      fs.unlinkSync(userDbPath);  // Supprimer la base vide
      fs.copyFileSync(defaultDbPath, userDbPath); // Recopier la base originale
    }

    try {
      const db = new sqlite3.Database(userDbPath, sqlite3.OPEN_READWRITE, (err) => {
        if (err) {
          logger.error(`Erreur ouverture DB: ${err.message}`);
        }
      });
      db.all("SELECT * FROM applications", (err, rows) => {
        if (err) {
          logger.error(`Error reading the database: ${err}. ${userDbPath}`);
          callback([]);
          return;
        }

        // Traitement des éléments de la base de données
        const AllApps = [];
        const InstalledApps = getInstalledApps();
        rows.forEach(row => {
            const APPID = row.argument.includes('--id ') ? row.argument.split('--id ')[1] : null;
            AllApps.push({
                id: row.id,
                name: row.name,
                editor: row.editor,
                description: row.description,
                icon: row.icon,
                is_cracked: row.is_cracked,
                source: row.source,
                category: row.category,
                argument: row.argument,
                is_installed: checkIfInstalled(APPID, row.name, InstalledApps)
            });
            logger.debug(row.name + ' ' + checkIfInstalled(APPID, row.name, InstalledApps));
        });

        callback(AllApps);
      });

      db.close((err) => {
        if (err) {
          logger.error(`Error closing the database: ${err}`);
        }
      });
    } catch (err) {
      logger.error(`Unexpected error: ${err}`);
      callback([]);
    }
};

module.exports = loadApplications;