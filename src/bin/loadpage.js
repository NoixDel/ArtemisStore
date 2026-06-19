// loadPage.js
// Description: Fonction qui charge une page HTML dans une fenêtre Electron.

const { app } = require('electron');
const path = require('path');
const { pathToFileURL } = require('url');
const ejs = require('ejs');
const fs = require('fs/promises');
const logger = require('../bin/logger');
const packageJson = require('../../package.json');

const appData = {
    version: packageJson.version,
    author: packageJson.author,
    githubLink: packageJson.homepage,
};

const templateCache = new Map();

async function readTemplate(templatePath) {
    const stat = await fs.stat(templatePath);
    const cached = templateCache.get(templatePath);
    if (cached && cached.mtimeMs === stat.mtimeMs) {
        return cached.template;
    }

    const template = await fs.readFile(templatePath, 'utf-8');
    templateCache.set(templatePath, { template, mtimeMs: stat.mtimeMs });
    return template;
}

const loadPage = async (win, page, data = {}) => {
    const viewsPath = path.join(app.getAppPath(), 'src', 'renderer', 'views');
    const templatePath = path.join(viewsPath, `${page}.ejs`);
    logger.info(`Loading page: ${templatePath}`);

    try {
        const template = await readTemplate(templatePath);
        const html = ejs.render(template, { ...data, ...appData }, { views: [viewsPath] });
        await win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`, {
            baseURLForDataURL: `${pathToFileURL(viewsPath).toString()}/`,
        });
    } catch (err) {
        logger.error(`Error loading page ${page}: ${err.message}`);
    }
};

module.exports = loadPage;
