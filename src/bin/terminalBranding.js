const TERMINAL_BANNER_CONTENT = [
    String.raw`    _    ____ _____ _____ __  __ ___ ____  ____ _____ ___  ____  _____`,
    String.raw`   / \  |  _ \_   _| ____|  \/  |_ _/ ___/ ___|_   _/ _ \|  _ \| ____|`,
    String.raw`  / _ \ | |_) || | |  _| | |\/| || |\___ \___ \ | || | | | |_) |  _|`,
    String.raw` / ___ \|  _ < | | | |___| |  | || | ___) |__) || || |_| |  _ <| |___`,
    String.raw`/_/   \_\_| \_\|_| |_____|_|  |_|___|____/____/ |_| \___/|_| \_\_____|`,
    '',
    'Merci de ne pas toucher, nous nous occupons de tout.',
];

function powershellSingleQuote(value) {
    return `'${String(value).replace(/'/g, "''")}'`;
}

function getTerminalBannerLines() {
    const contentWidth = Math.max(...TERMINAL_BANNER_CONTENT.map((line) => line.length)) + 4;
    const border = `+${'-'.repeat(contentWidth)}+`;
    return [
        border,
        ...TERMINAL_BANNER_CONTENT.map((line) => `|  ${line.padEnd(contentWidth - 4)}  |`),
        border,
    ];
}

function buildPowerShellBannerScript() {
    const lines = getTerminalBannerLines().map(powershellSingleQuote).join(',');
    return [
        `$artemisStoreBanner = @(${lines})`,
        '$artemisStoreBanner | ForEach-Object { Write-Host $_ -ForegroundColor Cyan }',
        "Write-Host ''",
    ].join('; ');
}

function brandPowerShellCommand(command) {
    return `${buildPowerShellBannerScript()}; ${command}`;
}

function encodePowerShellCommand(command) {
    return Buffer.from(String(command), 'utf16le').toString('base64');
}

module.exports = {
    buildPowerShellBannerScript,
    brandPowerShellCommand,
    encodePowerShellCommand,
    getTerminalBannerLines,
};
