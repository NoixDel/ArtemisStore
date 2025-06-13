# Invoke-AdminCommand.ps1
# Lance une commande avec des privilèges administrateur via le Planificateur de tâches.

Param(
    [Parameter(Mandatory=$true)]
    [string]$CommandToExecute,
    [Parameter(Mandatory=$false)]
    [int]$TimeoutSeconds = 60 # Temps maximum d'attente pour la commande (en secondes)
)

# --- Chemin vers le script élevé ---
$ElevatedScriptPath = Join-Path (Split-Path $MyInvocation.MyCommand.Path) "Execute-ElevatedCommand.ps1"

# --- Chemins des fichiers temporaires et de log ---
$TempDir = "C:\Temp"
$LogFile = Join-Path $TempDir "InvokeAdminCommand.log"

# --- Fonctions d'aide ---
function Write-Log {
    Param([string]$Message)
    $Timestamp = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
    Add-Content -Path $LogFile -Value "[$Timestamp] $Message" -ErrorAction SilentlyContinue
}

# No longer strictly needed as schtasks.exe handles elevation, but good for user info
function Test-IsAdministrator {
    $currentUser = New-Object Security.Principal.WindowsPrincipal([Security.Principal.WindowsIdentity]::GetCurrent())
    return $currentUser.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
}

# --- Vérification initiale et préparation ---
if (-not (Test-Path $TempDir)) {
    try {
        New-Item -ItemType Directory -Path $TempDir -Force | Out-Null
        Write-Log "Dossier temporaire créé : $TempDir"
    } catch {
        Write-Log "Erreur lors de la création du dossier temporaire $TempDir : $($_.Exception.Message)"
        Write-Error "Impossible de créer le dossier temporaire. Vérifiez les permissions : $TempDir"
        exit 1
    }
}

# Assurez-vous que le script élevé existe
if (-not (Test-Path $ElevatedScriptPath)) {
    Write-Log "Erreur : Le script 'Execute-ElevatedCommand.ps1' est introuvable à l'emplacement attendu : $ElevatedScriptPath"
    Write-Error "Le script 'Execute-ElevatedCommand.ps1' est manquant. Veuillez le placer dans le même dossier que 'Invoke-AdminCommand.ps1'."
    exit 1
}

# --- Fonction principale pour l'exécution de la commande ---
function Invoke-ElevatedCommand {
    Param(
        [string]$Command,
        [string]$ElevatedScript,
        [string]$TempDirectory,
        [int]$Timeout
    )

    $TaskName = "PowershellAdminCommand_" + (Get-Random).ToString() + (Get-Date -Format "yyyyMMddHHmmss")
    $TempOutputFile = Join-Path $TempDirectory ("ElevatedOutput_" + (Get-Random).ToString() + ".txt")

    Write-Log "Préparation de la tâche planifiée '$TaskName' pour la commande : $Command"
    Write-Log "Fichier de sortie temporaire : $TempOutputFile"

    try {
        # --- Utilisation de schtasks.exe pour créer la tâche ---
        # /create : Crée une nouvelle tâche
        # /tn <TaskName> : Nom de la tâche
        # /tr <RunCommand> : Commande à exécuter (Task Run)
        # /sc ONCE : Déclencheur unique (Schedule Once)
        # /st <HH:MM> : Heure de début (Start Time) - doit être dans le futur immédiat
        # /sd <MM/DD/YYYY> : Date de début (Start Date)
        # /ru SYSTEM : Exécuter en tant que SYSTEM (Run As User)
        # /rl HIGHEST : Exécuter avec les privilèges les plus élevés (Run Level)
        # /f : Force la création (Force)
        # /IT : Exécuter la tâche uniquement si l'utilisateur est connecté (Interactive Task) - peut être omis si non nécessaire
        # /Z : Supprime la tâche après exécution (Delete after completion) - C'est la clé pour le nettoyage automatique!

        $ExecutionTime = (Get-Date).AddSeconds(5).ToString("HH:mm") # Exécution dans 5 secondes
        $ExecutionDate = (Get-Date).ToString("MM/dd/yyyy")

        # La commande passée à /tr doit être une chaîne unique, avec les guillemets internes échappés.
        # En PowerShell, pour échapper un guillemet double à l'intérieur d'une chaîne délimitée par des guillemets doubles, on le double.
        # Donc, "powershell.exe -File ""C:\path\script.ps1"" -Command ""my command"""
        $TaskAction = "powershell.exe -NoProfile -ExecutionPolicy Bypass -File `"`"$ElevatedScript`"`" -Command `"`"$Command`"`" -OutputFile `"`"$TempOutputFile`"`""

        $SchTasksArgs = @(
            "/create",
            "/tn", $TaskName,
            "/tr", "`"$TaskAction`"", # Garder les guillemets autour de $TaskAction pour schtasks.exe
            "/sc", "ONCE",
            "/st", $ExecutionTime,
            "/sd", $ExecutionDate,
            "/ru", "SYSTEM",
            "/rl", "HIGHEST",
            "/f",
            "/Z" # Supprime la tâche après exécution
        )

        Write-Log "Exécution de schtasks.exe avec les arguments : $($SchTasksArgs -join ' ')"
        $schtasksOutput = & schtasks.exe $SchTasksArgs 2>&1
        Write-Log "Sortie de schtasks.exe : $schtasksOutput"

        if ($LASTEXITCODE -ne 0) {
            throw "La création de la tâche planifiée a échoué avec schtasks.exe. Erreur: $schtasksOutput"
        }

        Write-Log "Tâche planifiée '$TaskName' créée et lancée via schtasks.exe."

        # Attendre la fin de l'exécution de la tâche et la création du fichier de sortie
        $elapsedTime = 0
        while (-not (Test-Path $TempOutputFile) -and $elapsedTime -lt $Timeout) {
            Start-Sleep -Seconds 1
            $elapsedTime++
        }

        $commandOutput = ""
        if (Test-Path $TempOutputFile) {
            $commandOutput = Get-Content -Path $TempOutputFile -Raw -Encoding UTF8
            Write-Log "Sortie de la commande récupérée."
            Remove-Item -Path $TempOutputFile -Force -ErrorAction SilentlyContinue | Out-Null # Nettoyer le fichier temporaire
        } else {
            $commandOutput = "Erreur : La commande n'a pas produit de sortie à temps ou la tâche a échoué. Timeout: $Timeout s."
            Write-Log "Erreur : Commande timeout ou échec de production de sortie."
        }

        return $commandOutput

    } catch {
        $errorMessage = "Erreur lors de la création/exécution de la tâche planifiée '$TaskName' : $($_.Exception.Message)"
        Write-Log $errorMessage
        Write-Error $errorMessage
        return $errorMessage
    } finally {
        # Avec "/Z", la tâche devrait se supprimer seule.
        # Mais pour plus de sécurité et pour le débogage, on peut tenter une suppression explicite si elle existe encore.
        # On ne veut pas que cette suppression échoue et provoque une erreur dans le script principal.
        try {
            if ( (schtasks.exe /query /tn $TaskName 2>$null) ) { # Vérifier si la tâche existe toujours
                Write-Log "La tâche '$TaskName' existe toujours. Tentative de suppression explicite."
                & schtasks.exe /delete /tn $TaskName /f >$null 2>&1 # Supprimer silencieusement
            }
        } catch {}
    }
}

# --- Début de l'exécution du script principal ---
Write-Host "Tentative d'exécution de la commande '$CommandToExecute' avec privilèges administrateur..."

# Lancement de la commande élevée
$result = Invoke-ElevatedCommand -Command $CommandToExecute `
                                 -ElevatedScript $ElevatedScriptPath `
                                 -TempDirectory $TempDir `
                                 -Timeout $TimeoutSeconds

Write-Host "--- Résultat de la commande ---"
Write-Host $result
Write-Host "-----------------------------"

Write-Log "Fin de l'exécution pour la commande : $CommandToExecute"
