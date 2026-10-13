# Windows-PC-Hosting (HTTPS, Autostart und Sicherheit)

Diese Anleitung ergänzt das bestehende Botportal, ohne das Design oder die Minecraft-/Discord-Funktionen umzubauen. Sie gilt für das Repository `nick368747/Bot` und startet `index.js` auf einem Windows-PC. Sie speichert **keine Passwörter, Tokens oder Tunnel-Credentials in GitHub**.

## Zielaufbau

Browser (PC/iPad) → HTTPS-Adresse über Cloudflare Tunnel → `cloudflared` → Node.js nur auf `127.0.0.1:10000`.

- Keine Router-Portweiterleitung auf den Windows-PC.
- Der Node-Port ist nur lokal erreichbar; nach außen ist nur HTTPS über den Tunnel sichtbar.
- Windows-Aufgabenplanung startet den Bot beim Systemstart und startet ihn nach einem Fehler neu.
- Verwende ein separates, nicht-administratives Windows-Konto für den Bot, soweit möglich.
- Falls du weiterhin Render verwendest, ist diese PC-Installation eine alternative Hosting-Variante. Render benötigt weiterhin seinen eigenen Port und seine eigenen Umgebungsvariablen.

## 1. Voraussetzungen

1. Installiere eine aktuelle unterstützte Node.js-LTS-Version von <https://nodejs.org/>.
2. Installiere Git für Windows von <https://git-scm.com/download/win/>.
3. Öffne PowerShell als das Windows-Konto, unter dem der Bot laufen soll.
4. Klone das Repository in einen festen Pfad, zum Beispiel:

   ```powershell
   New-Item -ItemType Directory -Force C:\Bots | Out-Null
   Set-Location C:\Bots
   git clone https://github.com/nick368747/Bot.git
   Set-Location C:\Bots\Bot
   ```

5. Installiere Abhängigkeiten nur mit der im Repository gepflegten Paketdatei. Falls `package.json` im Repository fehlt, muss sie vor dem Start ergänzt werden; nicht blind `npm install` ohne geprüfte Abhängigkeitsliste ausführen. Der aktuelle Servercode verwendet unter anderem `bedrock-protocol`, `prismarine-auth`, `prismarine-chunk`, `prismarine-registry`, `vec3` und `discord.js`. Verwende möglichst ein geprüftes `package-lock.json` und danach `npm ci`.

## 2. Geheimnisse lokal setzen – niemals committen

Die Anwendung beendet sich, wenn `WEB_PASSWORD` nicht gesetzt ist. Setze Geheimnisse in Windows-Umgebungsvariablen oder über eine geschützte lokale Konfiguration außerhalb des Repositorys. Beispiel (PowerShell, aktuelle Benutzer-Umgebung):

```powershell
[Environment]::SetEnvironmentVariable('WEB_PASSWORD', 'HIER_EIN_LANGES_EINZIGARTIGES_PASSWORT', 'User')
[Environment]::SetEnvironmentVariable('APP_VERSION', '2.1.2', 'User')
[Environment]::SetEnvironmentVariable('PORT', '10000', 'User')
[Environment]::SetEnvironmentVariable('HOST', '127.0.0.1', 'User')
```

Ersetze den Beispielwert sofort durch ein eigenes Passwort. Danach PowerShell neu öffnen, damit die neuen Variablen geladen werden. Für optionale Funktionen setze weitere Variablen nach Bedarf, zum Beispiel `DISCORD_TOKEN`, `DISCORD_CLIENT_ID`, `DISCORD_GUILD_ID`, `DISCORD_ALLOWED_USER_IDS` und Minecraft-Konfiguration. Token nur lokal oder in einem Secret-Manager speichern.

**Wichtig:** Bereits in GitHub veröffentlichte Passwörter/Tokens gelten als kompromittiert: im jeweiligen Anbieter widerrufen/rotieren und anschließend lokal neu setzen. Nur Löschen aus einer Datei macht ein altes Secret nicht wieder sicher.

## 3. Bot einmal manuell testen

In einer neu geöffneten PowerShell:

```powershell
Set-Location C:\Bots\Bot
node .\index.js
```

Öffne auf demselben PC zunächst `http://127.0.0.1:10000/login`. Prüfe Login, Abmelden, Status und Minecraft-Anmeldung. Beende den Test mit `Ctrl+C`. Bei einem fehlenden Paket oder einer fehlenden `package.json` erst die Abhängigkeiten im Repository korrekt vervollständigen, nicht durch zufällige globale Installationen umgehen.

## 4. Automatischer Start mit Windows-Aufgabenplanung

Führe die folgende Datei aus einer PowerShell **als Administrator** aus, nachdem der Bot manuell startet. Sie erstellt eine Aufgabe beim Systemstart. Die Aufgabe verwendet das Windows-Konto, unter dem du sie installierst; wenn die Aufgabenplanung nach einem Kennwort fragt, gib es nur im Windows-Dialog ein und schreibe es nicht in ein Skript.

```powershell
powershell.exe -ExecutionPolicy Bypass -File C:\Bots\Bot\deploy\windows\install-startup-task.ps1
```

Wenn Windows-Aufgabenplanung unter deinem Sicherheitsmodell kein geeignetes Startkonto ermöglicht, verwende einen dedizierten Windows-Dienst-Wrapper wie WinSW/NSSM. Lege dessen Konfiguration und Logs außerhalb des Git-Repositories ab und gib dem Dienstkonto nur Schreibrechte auf den Minecraft-Profil- und Log-Ordner.

## 5. Öffentlicher HTTPS-Zugriff ohne Portweiterleitung

Empfohlener einfacher Weg: Cloudflare Tunnel mit einer eigenen Domain. Richte in Cloudflare einen Tunnel ein, installiere `cloudflared` auf dem PC und konfiguriere den öffentlichen Hostnamen auf `http://127.0.0.1:10000`. Installiere den Tunnel anschließend als Windows-Dienst nach der offiziellen Cloudflare-Anleitung: <https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/>.

- TLS endet am Cloudflare-Edge; die Verbindung vom Tunnel zum lokalen Bot bleibt auf Loopback.
- Öffne am Router keine eingehenden Ports für den Bot.
- Nutze Cloudflare Access oder eine vergleichbare vorgeschaltete Zugriffskontrolle zusätzlich zum Bot-Login, falls nur bestimmte Personen Zugriff haben sollen.
- Setze `PUBLIC_URL` auf die öffentliche HTTPS-Adresse, damit Links konsistent sind.
- Verwende nicht direkt die IP-Adresse des PCs als öffentliche Bot-URL.

## 6. Firewall und Netzwerk

Da der Node-Prozess auf `127.0.0.1` lauschen soll, braucht Port 10000 keine eingehende Windows-Firewall-Freigabe. Erlaube `cloudflared` ausgehend ins Internet. Öffne keine eingehende Regel für `node.exe` oder Port 10000. Wenn du später absichtlich direkt im LAN hostest, beschränke die Freigabe auf das private LAN und veröffentliche den Port trotzdem nicht direkt im Internet.

## 7. Starten, stoppen und prüfen

```powershell
Start-ScheduledTask -TaskName 'BlockBandeBot'
Get-ScheduledTask -TaskName 'BlockBandeBot' | Get-ScheduledTaskInfo
Stop-ScheduledTask -TaskName 'BlockBandeBot'
```

Logs werden unter `C:\Bots\Bot\logs\` abgelegt. Logs können Nutzernamen oder technische Details enthalten; gib sie nicht öffentlich weiter und rotiere sie regelmäßig. Der Minecraft-Login-Cache liegt standardmäßig im Arbeitsverzeichnis unter `.minecraft`; sichere diesen Ordner privat und kopiere ihn nicht nach GitHub.

## 8. Updates

```powershell
Set-Location C:\Bots\Bot
Stop-ScheduledTask -TaskName 'BlockBandeBot' -ErrorAction SilentlyContinue
git pull --ff-only
npm ci
Start-ScheduledTask -TaskName 'BlockBandeBot'
```

Vor einem Update kontrolliere die Änderungen und sichere nur nicht-geheime Daten. Committe niemals `.env`, `.minecraft`, Tokens, Passwortdateien, private Zertifikate oder Tunnel-Credentials.

## 9. Sicherheits-Checkliste

- [ ] Ein langes, einzigartiges `WEB_PASSWORD`, das nirgendwo im Quellcode steht.
- [ ] Secrets wurden nicht eingecheckt; gegebenenfalls alte Werte widerrufen.
- [ ] HTTPS mit gültigem Zertifikat und zusätzlicher Zugriffskontrolle, wenn die Seite privat bleiben soll.
- [ ] Keine Router-Portweiterleitung und kein öffentlich erreichbarer Node-Port.
- [ ] Windows und Node.js werden aktualisiert; Bot läuft mit minimalen Rechten.
- [ ] `.minecraft`-Profil und Logs sind nicht öffentlich.
- [ ] Login, Abmelden, falsches Passwort und Ablauf einer Sitzung wurden auf PC und iPad getestet.
- [ ] Backups enthalten keine öffentlich geteilten Geheimnisse.

## Hinweise zum aktuellen Projektstand

Der vorhandene `index.js` bindet derzeit an `0.0.0.0` und liest `PORT` aus der Umgebung. Render kann diese Standardbindung benötigen. Für den PC-Betrieb sollte `HOST` konfigurierbar sein und lokal auf `127.0.0.1` gesetzt werden. Teste die Änderung getrennt von Render, bevor du sie produktiv verwendest. Dieses Dokument richtet den Windows-Start ein; es ersetzt keinen echten End-to-End-Test von Login, Abmelden und allen Bot-Funktionen.
