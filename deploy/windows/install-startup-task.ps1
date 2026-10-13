# Als Administrator ausführen. Erst C:\Bots\Bot\index.js manuell testen.
$ErrorActionPreference = 'Stop'
$TaskName = 'BlockBandeBot'
$ProjectPath = 'C:\Bots\Bot'
$NodePath = (Get-Command node.exe -ErrorAction Stop).Source
$ScriptPath = Join-Path $ProjectPath 'index.js'
$LogDir = Join-Path $ProjectPath 'logs'

if (-not (Test-Path $ScriptPath)) { throw "index.js nicht gefunden: $ScriptPath" }
New-Item -ItemType Directory -Force -Path $LogDir | Out-Null

# Die Aufgabe startet beim Systemstart unter dem Konto, das sie installiert.
# Secrets werden NICHT in Argumente oder die Aufgabenbeschreibung geschrieben.
$Action = New-ScheduledTaskAction -Execute $NodePath -Argument ('"' + $ScriptPath + '"') -WorkingDirectory $ProjectPath
$Trigger = New-ScheduledTaskTrigger -AtStartup
$Settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -RestartCount 5 -RestartInterval (New-TimeSpan -Minutes 1) -ExecutionTimeLimit ([TimeSpan]::Zero) -MultipleInstances IgnoreNew
$Principal = New-ScheduledTaskPrincipal -UserId "$env:USERDOMAIN\$env:USERNAME" -LogonType S4U -RunLevel Limited

Register-ScheduledTask -TaskName $TaskName -Action $Action -Trigger $Trigger -Settings $Settings -Principal $Principal -Description 'Startet den Block Bande Bot beim Windows-Start.' -Force | Out-Null
Write-Host "Aufgabe '$TaskName' erstellt. Starten mit: Start-ScheduledTask -TaskName '$TaskName'"
Write-Host "Hinweis: S4U-Aufgaben haben keinen Zugriff auf Netzwerkressourcen wie ein angemeldeter Benutzer. Für Cloudflare Tunnel eine eigene Dienstinstallation verwenden."
