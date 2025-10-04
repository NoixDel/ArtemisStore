/* Mini serveur dev, autonome, pour gérer applications.db
   - AUCUN lien avec l’app Electron.
   - Utilise sqlite3 déjà présent.
   - Sert une page HTML et expose une petite API CRUD.
*/

const http = require('http');
const url = require('url');
const fs = require('fs');
const path = require('path');
const sqlite3 = require('sqlite3');

const PORT = process.env.PORT || 3300;
const ROOT = path.resolve(__dirname);
const DB_PATH = path.resolve(process.cwd(), 'applications.db'); // à la racine du projet

// ===== DB init =====
const db = new sqlite3.Database(DB_PATH);
db.serialize(() => {
  db.run(`
    CREATE TABLE IF NOT EXISTS applications (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      editor TEXT NOT NULL,
      icon TEXT NOT NULL,
      description TEXT NOT NULL,
      is_cracked BOOLEAN NOT NULL,
      source TEXT NOT NULL,
      category TEXT NOT NULL,
      appid TEXT NOT NULL,
      argument TEXT NOT NULL,
      popularity INTEGER NOT NULL DEFAULT 0,
      needadm BOOLEAN NOT NULL DEFAULT 0
    )
  `);
});

function json(res, status, data) {
  const body = JSON.stringify(data ?? {});
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(body)
  });
  res.end(body);
}

function notFound(res) {
  res.writeHead(404);
  res.end('Not Found');
}

function parseBody(req) {
  return new Promise((resolve, reject) => {
    let raw = '';
    req.on('data', chunk => raw += chunk);
    req.on('end', () => {
      if (!raw) return resolve({});
      try {
        resolve(JSON.parse(raw));
      } catch (e) {
        reject(e);
      }
    });
  });
}

// ===== API handlers =====
async function handleApi(req, res, pathname, query) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.end();

  if (pathname === '/api/list' && req.method === 'GET') {
    db.all('SELECT * FROM applications ORDER BY popularity ASC, id DESC', (err, rows) =>
      err ? json(res, 500, { error: err.message }) : json(res, 200, rows)
    );
    return;
  }

  if (pathname === '/api/add' && req.method === 'POST') {
    const body = await parseBody(req).catch(e => ({ __err: e }));
    if (body.__err) return json(res, 400, { error: 'Invalid JSON' });

    const {
      name, editor, icon = '', description,
      is_cracked = false, source, category, appid,
      argument = '', popularity = 0, needadm = false
    } = body;

    db.run(
      `INSERT INTO applications (name, editor, icon, description, is_cracked, source, category, appid, argument, popularity, needadm)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [name, editor, icon, description, is_cracked ? 1 : 0, source, category, appid, argument, Number(popularity) || 0, needadm ? 1 : 0],
      function (err) {
        if (err) return json(res, 500, { error: err.message });
        json(res, 200, { id: this.lastID });
      }
    );
    return;
  }

  if (pathname === '/api/update' && req.method === 'POST') {
    const body = await parseBody(req).catch(e => ({ __err: e }));
    if (body.__err) return json(res, 400, { error: 'Invalid JSON' });

    const { id } = body;
    if (!id) return json(res, 400, { error: 'Missing id' });

    const {
      name, editor, icon, description,
      is_cracked = false, source, category, appid,
      argument = '', popularity = 0, needadm = false
    } = body;

    const update = (iconValue) => db.run(
      `UPDATE applications
         SET name=?, editor=?, icon=?, description=?, is_cracked=?, source=?, category=?, appid=?, argument=?, popularity=?, needadm=?
       WHERE id=?`,
      [name, editor, iconValue, description, is_cracked ? 1 : 0, source, category, appid,
       argument, Number(popularity) || 0, needadm ? 1 : 0, id],
      function (err) {
        if (err) return json(res, 500, { error: err.message });
        json(res, 200, { changed: this.changes });
      }
    );

    if (icon == null) {
      db.get('SELECT icon FROM applications WHERE id=?', [id], (err, row) => {
        if (err) return json(res, 500, { error: err.message });
        update(row?.icon || '');
      });
    } else {
      update(icon);
    }
    return;
  }

  if (pathname === '/api/delete' && req.method === 'POST') {
    const body = await parseBody(req).catch(e => ({ __err: e }));
    if (body.__err) return json(res, 400, { error: 'Invalid JSON' });

    const { id } = body;
    if (!id) return json(res, 400, { error: 'Missing id' });

    db.run('DELETE FROM applications WHERE id=?', [id], function (err) {
      if (err) return json(res, 500, { error: err.message });
      json(res, 200, { deleted: this.changes });
    });
    return;
  }

  if (pathname === '/api/msstore' && req.method === 'GET') {
    const q = (query.q || '').trim();
    if (!q) return json(res, 400, { error: 'Missing q' });

    const endpoint = `https://storeedgefd.dsx.mp.microsoft.com/v9.0/pages/searchResults?appVersion=22203.1401.0.0&market=FR&locale=fr-fr&deviceFamily=windows.desktop&query=${encodeURIComponent(q)}`;
    try {
      const r = await fetch(endpoint, { headers: { Accept: 'application/json' } });
      const data = await r.json();
      const s = data?.[1]?.Payload?.SearchResults?.[0];
      if (!s) return json(res, 200, null);
      return json(res, 200, {
        name: s.Title,
        editor: s.PublisherName,
        icon: (s.Images && s.Images[0]?.Url) || 'https://example.com/default-icon.png',
        description: s.LongDescription,
        source: 'msstore',
        appid: s.ProductId,
        category: s.Categories,
        argument: '',
        popularity: 0,
        is_cracked: false
      });
    } catch (e) {
      return json(res, 500, { error: String(e) });
    }
  }

  return notFound(res);
}

// ===== Static (index.html) =====
function serveIndex(res) {
  const file = path.join(ROOT, 'index.html');
  fs.readFile(file, (err, buf) => {
    if (err) return notFound(res);
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end(buf);
  });
}

const server = http.createServer(async (req, res) => {
  const { pathname, query } = url.parse(req.url, true);

  if (pathname === '/' && req.method === 'GET') return serveIndex(res);
  if (pathname.startsWith('/api/')) return handleApi(req, res, pathname, query);

  return notFound(res);
});

server.listen(PORT, () => {
  console.log(`Apps admin running at http://localhost:${PORT}`);
  console.log(`DB: ${DB_PATH}`);
});
