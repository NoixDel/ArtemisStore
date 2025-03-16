const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const { autoUpdater } = require("electron-updater");
const path = require('path');
const ejs = require('ejs');
const fs = require('fs');
const sqlite3 = require('sqlite3').verbose();

const createWindow = () => {
  const win = new BrowserWindow({
    width: 1200,
    height: 800,
    icon: path.join(__dirname, 'renderer', 'static', 'img','logo.png'),
    frame: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true
    }
  });

  win.setMenu(null);

  const loadPage = (page, data = {}) => {
    const viewsPath = path.join(__dirname, 'renderer/views');
    const templatePath = path.join(viewsPath, `${page}.ejs`);
    const outputPath = path.join(app.getPath('temp'), `${page}.html`);

    fs.readFile(templatePath, 'utf-8', (err, template) => {
      if (err) {
        console.error('Error reading the template file:', err);
        return;
      }
      const html = ejs.render(template, data, { views: [viewsPath] });
      fs.writeFile(outputPath, html, (err) => {
        if (err) {
          console.error('Error writing the HTML file:', err);
          return;
        }
        win.loadFile(outputPath);
      });
    });
  };

  const loadApplications = (callback) => {
    const dbPath = path.join(__dirname, '..', 'applications.db');
    const db = new sqlite3.Database(dbPath);

    db.all("SELECT * FROM applications", (err, rows) => {
      if (err) {
        console.error('Error reading the database:', err);
        callback([]);
        return;
      }
      callback(rows);
    });

    db.close();
  };

  loadApplications((apps) => {
    loadPage('index', { apps });
  });

  ipcMain.on('navigate-to-page', (event, page) => {
    loadApplications((apps) => {
      loadPage(page, { apps });
    });
  });
};

app.whenReady().then(() => {
  // Vérifier les mises à jour au lancement
  autoUpdater.checkForUpdatesAndNotify();
  setInterval(() => {
    autoUpdater.checkForUpdatesAndNotify();
  }, 60000);

  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

// Événements de mise à jour
autoUpdater.on("update-available", () => {
  dialog.showMessageBox({
    type: "info",
    title: "Mise à jour disponible",
    message: "Une nouvelle version est disponible. Téléchargement en cours...",
  });
});

autoUpdater.on("update-downloaded", () => {
  dialog.showMessageBox({
    type: "info",
    title: "Mise à jour prête",
    message: "La mise à jour a été téléchargée. L'application va redémarrer.",
  }).then(() => {
    autoUpdater.quitAndInstall();
  });
});

autoUpdater.on('checking-for-update', () => {
  dialog.showMessageBox({
    type: 'info',
    title: 'Vérification des mises à jour',
    message: 'Vérification des mises à jour en cours...',
  });
});

autoUpdater.on('update-available', (info) => {
  dialog.showMessageBox({
    type: 'info',
    title: 'Mise à jour disponible',
    message: `Mise à jour disponible : ${info.version}`,
  });
});

autoUpdater.on('update-not-available', () => {
  dialog.showMessageBox({
    type: 'info',
    title: 'Aucune mise à jour disponible',
    message: 'Aucune mise à jour disponible.',
  });
});

autoUpdater.on('error', (err) => {
  dialog.showErrorBox('Erreur de mise à jour', `Erreur : ${err.message}`);
});
