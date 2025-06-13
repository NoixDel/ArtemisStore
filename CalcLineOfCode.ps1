$folderPath = Split-Path -Path $PSCommandPath -Parent
$fileExtensions = @("*.js", "*.ejs")  # Extensions à analyser
$excludedFolders = @("dist", "node_modules", "logs")  # Dossiers à exclure

$totalLinesByFolder = @{}  # Stocke le total par dossier
$totalLinesGlobal = 0

Get-ChildItem -Path $folderPath -Recurse -File | Where-Object {
    ($fileExtensions -contains "*$($_.Extension)") -and
    (-not ($_.FullName -match [string]::Join("|", $excludedFolders)))  # Vérifie si le chemin contient un dossier exclu
} | ForEach-Object {
    $filePath = $_.FullName
    $folderName = $_.DirectoryName
    $lineCount = (Get-Content $filePath).Count

    # Affiche le nombre de lignes par fichier
    Write-Output "[$folderName] $_ : $lineCount lignes"

    # Ajoute au total du dossier
    if ($totalLinesByFolder.ContainsKey($folderName)) {
        $totalLinesByFolder[$folderName] += $lineCount
    } else {
        $totalLinesByFolder[$folderName] = $lineCount
    }

    # Ajoute au total global
    $totalLinesGlobal += $lineCount
}

# Affiche le total par dossier
Write-Output "`n--- Résumé par dossier ---"
$totalLinesByFolder.GetEnumerator() | ForEach-Object {
    Write-Output "$($_.Key) : $($_.Value) lignes"
}

# Affiche le total global
Write-Output "`nNombre total de lignes de code dans le projet : $totalLinesGlobal"