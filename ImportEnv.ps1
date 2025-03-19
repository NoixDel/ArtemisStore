Get-Content .env | ForEach-Object {
    $name, $value = $_ -split '=', 2
    $value = $value -replace '^"|"$', ''  # Supprime les guillemets s'ils existent
    Set-Item -Path "Env:$name" -Value $value
}