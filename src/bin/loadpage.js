// loadPage.js
// Description: Fonction qui charge une page HTML dans une fenêtre Electron.

const { app } = require('electron');
const path = require('path');
const { pathToFileURL } = require('url');
const ejs = require('ejs');
const fs = require('fs/promises');
const logger = require('../bin/logger');
const packageJson = require('../../package.json');
const { isSafePageName } = require('./security');

const appData = {
    version: packageJson.version,
    author: packageJson.author,
    githubLink: packageJson.homepage,
};

const templateCache = new Map();

function injectBaseHref(html, viewsPath) {
    const baseHref = `<base href="${pathToFileURL(viewsPath).toString()}/">`;
    if (/<base\s/i.test(html)) return html;
    return html.replace(/<head>/i, `<head>\n    ${baseHref}`);
}

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
    if (!isSafePageName(page)) {
        logger.warn(`Page refusee : ${page}`);
        return;
    }

    const viewsPath = path.join(app.getAppPath(), 'src', 'renderer', 'views');
    const templatePath = path.resolve(viewsPath, `${page}.ejs`);
    if (!templatePath.startsWith(path.resolve(viewsPath) + path.sep)) {
        logger.warn(`Chemin template refuse : ${templatePath}`);
        return;
    }
    logger.info(`Loading page: ${templatePath}`);

    try {
        const template = await readTemplate(templatePath);
        const html = injectBaseHref(
            ejs.render(template, { ...data, ...appData }, { views: [viewsPath] }),
            viewsPath
        );
        const renderDir = path.join(app.getPath('userData'), 'rendered-pages');
        await fs.mkdir(renderDir, { recursive: true });
        const renderPath = path.join(renderDir, `${page}.html`);
        await fs.writeFile(renderPath, html, 'utf8');
        await win.loadURL(pathToFileURL(renderPath).toString());
    } catch (err) {
        logger.error(`Error loading page ${page}: ${err.message}`);
    }
};

module.exports = loadPage;
