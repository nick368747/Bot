# Discord-Anbindung für FrozenRun

Die Discord-Integration ist optional. Ohne `DISCORD_TOKEN` startet die Webseite weiterhin ohne Discord.

## Render-Umgebungsvariablen

In Render unter **Environment** setzen (Werte nicht in Dateien oder Chat-Nachrichten eintragen):

- `DISCORD_TOKEN`: Bot-Token aus dem Discord Developer Portal.
- `DISCORD_CLIENT_ID`: Application ID der Discord-App.
- `DISCORD_GUILD_ID` (optional): Server-ID. Wenn gesetzt, werden Slash-Befehle nur für diesen Server registriert und sind beim Testen schneller verfügbar.
- `DISCORD_CHAT_CHANNEL_ID` (optional): Textkanal für den Chat zwischen Discord und Minecraft.
- `DISCORD_LOG_CHANNEL_ID` (optional): Textkanal für Fehler, Warnungen und wichtige Statusmeldungen.
- `DISCORD_DASHBOARD_CHANNEL_ID` (empfohlen): Öffentlicher Textkanal, in dem FrozenRun automatisch genau eine dauerhafte Control-Center-Nachricht und eine Live-Uptime-Nachricht erstellt und nach Neustarts wiederfindet. Wenn nicht gesetzt, wird `DISCORD_LOG_CHANNEL_ID`, danach `DISCORD_CHAT_CHANNEL_ID` verwendet.
- `DISCORD_ALLOWED_USER_IDS` (optional): Kommagetrennte Discord-Benutzer-IDs, die den Bot steuern dürfen.
- `DISCORD_ALLOWED_ROLE_IDS` (optional): Kommagetrennte Rollen-IDs, die den Bot steuern dürfen.

Wenn keine Benutzer- oder Rollen-IDs konfiguriert sind, erfordern Steuerbefehle die Berechtigung **Server verwalten / Manage Server**. Wenn eine Allowlist konfiguriert ist, müssen Benutzer- oder Rollen-ID darin enthalten sein.

## Discord Developer Portal

1. Unter **Bot** den Bot anlegen und den Token nur in Render eintragen.
2. Für Nachrichten, die im konfigurierten Chat-Kanal geschrieben werden, unter **Privileged Gateway Intents** den **Message Content Intent** einschalten.
3. Den Bot mit den Scopes `bot` und `applications.commands` zum Server hinzufügen. Er braucht im Dashboard-Kanal mindestens **View Channel**, **Send Messages**, **Read Message History** und **Embed Links**. Für die Buttons gelten zusätzlich die konfigurierten Benutzer-/Rollenrechte.
4. Nach dem Eintragen der Variablen den Render-Service neu deployen.

## Slash-Befehle

- `/dashboard`: verweist auf das öffentliche, dauerhaft aktualisierte Control Center.
- `/uptime`: verweist auf die öffentliche Live-Uptime-Anzeige; beide Nachrichten werden beim Bot-Start automatisch wiedergefunden und bearbeitet, statt neu gepostet zu werden.
- `/bot-status`: Online-Status, Koordinaten, Uptime und Laufstatus
- `/bot-start`, `/bot-stop`, `/bot-reconnect`
- `/bot-home`, `/bot-run`, `/bot-stoprun`
- `/mc-chat nachricht:...`
- `/mc-command befehl:...`

Der Discord-Presence-Status zeigt Minecraft-Status und Koordinaten. Minecraft-Chat wird in den konfigurierten Discord-Chat-Kanal gespiegelt; Nachrichten aus diesem Kanal werden an Minecraft weitergeleitet. Fehler und Warnungen gehen an den Log-Kanal.

## Sicherheit

- Tokens werden ausschließlich über Umgebungsvariablen gelesen.
- Steuerbefehle und Dashboard-Buttons prüfen die Benutzer-/Rollen-Allowlist oder andernfalls die Server-Manage-Berechtigung. `/dashboard` und `/uptime` dürfen alle Servermitglieder aufrufen; die Statusnachrichten sind öffentlich lesbar.
- Der Chat-Relay ist auf den konfigurierten Kanal begrenzt; Bot-Nachrichten werden nicht zurückgeleitet.
- Keine Tokens in Logs, Screenshots, Quellcode oder Issues veröffentlichen. Falls ein Token versehentlich offengelegt wurde, im Developer Portal zurücksetzen.
