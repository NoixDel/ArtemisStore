# Execute-ElevatedCommand.ps1
# Ce script est destiné à être exécuté par le Planificateur de tâches avec des privilèges élevés.

Param(
    [Parameter(Mandatory=$true)]
    [string]$Command,
    [Parameter(Mandatory=$true)]
    [string]$OutputFile
)

# Chemin pour les logs internes de ce script élevé
$LogFile = "C:\Temp\ElevatedCommandExecution.log" 

# --- Fonction d'aide pour le log ---
function Write-ElevatedLog {
    Param([string]$Message)
    $Timestamp = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
    Add-Content -Path $LogFile -Value "[$Timestamp] $Message" -ErrorAction SilentlyContinue # Gérer les erreurs si le fichier est inaccessible
}

Write-ElevatedLog "Démarrage de l'exécution pour : $Command"

$result = ""
try {
    # Exécute la commande et capture la sortie
    # Utilisez Invoke-Expression pour exécuter des strings comme des commandes
    $commandResult = Invoke-Expression $Command | Out-String 
    $result = "Output:`n$commandResult`nExitCode: 0"
    Write-ElevatedLog "Commande exécutée avec succès. Sortie écrite dans $OutputFile"
} catch {
    # Capture les erreurs
    $errorMessage = $_.Exception.Message
    $result = "Error:`n$errorMessage`nExitCode: 1"
    Write-ElevatedLog "Erreur lors de l'exécution de la commande: $errorMessage"
} finally {
    # Écrit le résultat (sortie ou erreur) dans le fichier de sortie spécifié
    try {
        Set-Content -Path $OutputFile -Value $result -Encoding UTF8 -Force
    } catch {
        Write-ElevatedLog "Erreur lors de l'écriture dans le fichier de sortie $OutputFile : $($_.Exception.Message)"
    }
}