const { URL } = require('url');

const WINGET_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const ALLOWED_WINGET_ARGS = new Set([
    '--silent',
    '--scope',
    'user',
    'machine',
    '--interactive',
    '--accept-package-agreements',
    '--accept-source-agreements',
]);

function isSafePageName(page) {
    return /^[A-Za-z0-9_-]+$/.test(String(page || ''));
}

function normalizeHttpsUrl(rawUrl, allowedHosts) {
    const parsed = new URL(rawUrl);
    if (parsed.protocol !== 'https:') {
        throw new Error(`URL non HTTPS refusee : ${rawUrl}`);
    }

    const hostname = parsed.hostname.toLowerCase();
    const allowed = allowedHosts.some((host) => {
        const normalized = host.toLowerCase();
        return hostname === normalized || hostname.endsWith(`.${normalized}`);
    });

    if (!allowed) {
        throw new Error(`Hote non autorise : ${parsed.hostname}`);
    }

    return parsed.toString();
}

function validateWingetId(appId) {
    const normalized = String(appId || '').trim();
    if (!WINGET_ID_PATTERN.test(normalized)) {
        throw new Error(`Identifiant winget invalide : ${appId}`);
    }
    return normalized;
}

function normalizeWingetArguments(rawArgument) {
    const raw = String(rawArgument || '').trim();
    if (!raw) return '';

    const parts = raw.match(/"[^"]+"|'[^']+'|\S+/g) || [];
    const safeParts = [];

    for (const part of parts) {
        const clean = part.replace(/^['"]|['"]$/g, '');
        if (!ALLOWED_WINGET_ARGS.has(clean)) {
            throw new Error(`Argument winget refuse : ${clean}`);
        }
        safeParts.push(clean);
    }

    return safeParts.join(' ');
}

function redactSecrets(message) {
    return String(message || '')
        .replace(/(token|password|secret|apikey|api_key)=([^&\s]+)/gi, '$1=[REDACTED]')
        .replace(/(Authorization:\s*Bearer\s+)[A-Za-z0-9._~+/=-]+/gi, '$1[REDACTED]');
}

module.exports = {
    isSafePageName,
    normalizeHttpsUrl,
    normalizeWingetArguments,
    redactSecrets,
    validateWingetId,
};
