// function/WingetManager.js
const runCommand = require("../bin/runcmd");
const logger = require("../bin/logger");

/**
 * Réinitialise et met à jour les sources Winget
 */
async function fixWingetSources() {
  try {
    logger.info("[WingetManager] Reset des sources...");
    await runCommand("winget source reset --force", true, true);

    logger.info("[WingetManager] Mise à jour des sources...");
    await runCommand("winget source update", true, true);

    logger.info("[WingetManager] Sources mises à jour !");
  } catch (err) {
    logger.error("[WingetManager] Erreur maj sources:", err);
  }
}

/**
 * Met à jour Winget (DesktopAppInstaller)
 */
async function updateWingetClient() {
  try {
    logger.info("[WingetManager] Mise à jour de Winget (App Installer)...");
    await runCommand(
      "winget upgrade --id Microsoft.DesktopAppInstaller -e --accept-package-agreements",
      true, // uac
      true  // showTerminal
    );
    logger.info("[WingetManager] Winget mis à jour !");
  } catch (err) {
    logger.error("[WingetManager] Erreur maj client:", err);
  }
}

module.exports = {
  fixWingetSources,
  updateWingetClient,
};
