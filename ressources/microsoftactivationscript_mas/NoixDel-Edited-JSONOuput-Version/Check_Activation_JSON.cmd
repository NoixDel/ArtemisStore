@echo off
setlocal EnableExtensions

set "SysPath=%SystemRoot%\System32"
set "ps=%SysPath%\WindowsPowerShell\v1.0\powershell.exe"
set "_psc=%ps% -NoProfile -ExecutionPolicy Bypass -Command"

%_psc% "iex ([IO.File]::ReadAllText('%~f0') -split ':jsonstart:' | Select-Object -Last 1)"
goto :eof

:jsonstart:
$root = @{}

# -------------------------------------------------------------------
# WINDOWS INFO
# -------------------------------------------------------------------
$windows = @{}

$osInfo = Get-ComputerInfo | Select-Object -Property OsName, OSDisplayVersion, WindowsEditionId, OsVersion
$windows.osName = $osInfo.OsName
$windows.osDisplayVersion = $osInfo.OSDisplayVersion
$windows.windowsEditionId = $osInfo.WindowsEditionId
$windows.osVersion = $osInfo.OsVersion

$license = Get-CimInstance -ClassName SoftwareLicensingProduct | Where-Object { $_.PartialProductKey -and $_.Name -like "*Windows*" } | Select-Object -First 1
if ($null -ne $license) {
    $windows.name = $license.Name
    $windows.description = $license.Description
    $windows.activationId = $license.ApplicationID.Guid
    $windows.productKeyChannel = if ($license.Description -match 'OEM_DM') { "OEM:DM" } elseif ($license.Description -match 'RETAIL') { "RETAIL" } else { "UNKNOWN" }
    $windows.partialProductKey = $license.PartialProductKey
    $windows.licenseStatus = switch ($license.LicenseStatus) {
        0 { "Unlicensed" }
        1 { "Licensed" }
        2 { "Initial Grace Period" }
        3 { "Additional Grace Period" }
        4 { "Non-genuine Grace Period" }
        5 { "Notification" }
        6 { "Extended Grace" }
        default { "Unknown" }
    }
    $windows.isLicensed = ($license.LicenseStatus -eq 1)
} else {
    $windows.name = "N/A"
    $windows.description = "N/A"
    $windows.activationId = "N/A"
    $windows.productKeyChannel = "N/A"
    $windows.partialProductKey = "N/A"
    $windows.licenseStatus = "Unknown"
    $windows.isLicensed = $false
}

try {
    $obj = New-Object -ComObject "EditionUpgradeManagerObj.EditionUpgradeManager"
    $params = 1, $null
    $obj.AcquireModernLicenseForWindows.Invoke($obj, $params)
    $windows.isDigitalLicense = ($params[1] -ge 0 -and $params[1] -ne 1)
} catch {
    $windows.isDigitalLicense = $null
}

$root.windows = $windows

# -------------------------------------------------------------------
# OFFICE INFO
# -------------------------------------------------------------------
$office = @{}
$officeApps = @()
$officeInstalled = $false
$officeVersion = "Unknown"
$officeActivated = $false

$officePaths = @(
    "$env:ProgramFiles\Microsoft Office\root\Office16",
    "$env:ProgramFiles(x86)\Microsoft Office\root\Office16",
    "$env:ProgramFiles\Microsoft Office\Office16",
    "$env:ProgramFiles(x86)\Microsoft Office\Office16"
)

$knownApps = @{
    "WINWORD.EXE" = "Word"
    "EXCEL.EXE" = "Excel"
    "POWERPNT.EXE" = "PowerPoint"
    "OUTLOOK.EXE" = "Outlook"
    "ONENOTE.EXE" = "OneNote"
    "MSACCESS.EXE" = "Access"
    "MSPUB.EXE" = "Publisher"
}

foreach ($basePath in $officePaths) {
    foreach ($exe in $knownApps.Keys) {
        $fullPath = Join-Path $basePath $exe
        if (Test-Path $fullPath) {
            if (-not $officeApps.Contains($knownApps[$exe])) {
                $officeApps += $knownApps[$exe]
                $officeInstalled = $true
            }
        }
    }
}

if ($officeInstalled) {
    if (Test-Path "$env:ProgramFiles\Microsoft Office\ClickToRun\officec2rclient.exe") {
        $officeVersion = "Microsoft 365"
    } else {
        $officeVersion = "Office 2016/2019/2021"
    }
}

try {
    $officeLic = Get-CimInstance -ClassName SoftwareLicensingProduct | Where-Object { $_.PartialProductKey -and $_.Name -like "*Office*" } | Select-Object -First 1
    if ($officeLic.LicenseStatus -eq 1) {
        $officeActivated = $true
    }
} catch {
    $officeActivated = $false
}

$office.officeInstalled = $officeInstalled
$office.officeVersion = $officeVersion
$office.officeActivated = $officeActivated
$office.officeApps = $officeApps

# -------------------------------------------------------------------
# OFFICE LICENSES (vNext)
# -------------------------------------------------------------------
$officeLicenses = @()

$licensePath = "$env:LOCALAPPDATA\Microsoft\Office\Licenses"
if (Test-Path $licensePath) {
    $licenseFiles = Get-ChildItem -Path $licensePath -Recurse | Where-Object { !$_.PSIsContainer }

    foreach ($file in $licenseFiles) {
        try {
            $content = Get-Content -Encoding Unicode -Path $file.FullName | ConvertFrom-Json
            $license = $content.License
            $decoded = [System.Text.Encoding]::UTF8.GetString([System.Convert]::FromBase64String($license)) | ConvertFrom-Json

            $entry = [ordered]@{
                Product            = $decoded.ProductReleaseId
                LicenseType        = $decoded.LicenseType
                Acid               = $decoded.Acid
                LicenseState       = "Licensed"
                EntitlementStatus  = $decoded.Status
                EntitlementExpiry  = $decoded.ExpiresOn
                NotBefore          = $decoded.Metadata.NotBefore
                NotAfter           = $decoded.Metadata.NotAfter
                NextRenewal        = $decoded.Metadata.RenewAfter
                TenantId           = $decoded.Metadata.TenantId
            }

            $officeLicenses += $entry
        } catch {
            continue
        }
    }
}

$office.officeLicenses = $officeLicenses
$root.office = $office

# -------------------------------------------------------------------
# OUTPUT JSON
# -------------------------------------------------------------------
$root | ConvertTo-Json -Depth 5 -Compress
