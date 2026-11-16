# FrozenRun 3.0 – erster Integrationsstand

## Was neu ist

- Neues responsives Dark-Gaming-Control-Center unter `/v3`.
- Die neue Seite wird nur nach erfolgreicher Anmeldung mit der bestehenden FrozenRun-Sitzung ausgeliefert.
- Status, Uptime, Kontostand, Koordinaten, Spieler, Server und Blickrichtung werden aus `/api/status` gelesen.
- Steuerung verwendet die vorhandenen Endpunkte für Start, Stopp, Reconnect, Home/AFK und Laufmodus.
- Chat, Minecraft-Befehle und Geld senden verwenden die bereits vorhandenen API-Endpunkte.
- Die bisherige Startseite und der bestehende Dashboard-Aufruf bleiben unverändert.

## Aufruf

Nach dem Deployment und Login: `https://DEINE-BOT-URL/v3`

## Discord

Die vorhandene Discord-Integration bleibt erhalten. Sie registriert unter anderem `/dashboard`, `/bot-status`, `/bot-start`, `/bot-stop`, `/bot-reconnect`, `/bot-home`, `/bot-run`, `/bot-stoprun`, `/mc-chat` und `/mc-command`. Das Discord-Dashboard besitzt bereits interaktive Buttons. Secrets werden weiterhin ausschließlich über Umgebungsvariablen verwaltet.

## Sicherheitsverhalten

- `/v3` prüft dieselbe Server-Session wie die bestehende Weboberfläche.
- Es werden keine Discord- oder Microsoft-Tokens an den Browser übertragen.
- Schreibaktionen gehen ausschließlich an die bereits vorhandenen, sitzungsgeschützten API-Routen.

## Noch offen

Dies ist ein erster integrierter UI-Schritt und noch kein vollständiges Release. Vor dem produktiven Einsatz müssen Syntax-/Starttests sowie Browser- und Minecraft-End-to-End-Tests ausgeführt werden. Insbesondere sind Microsoft-Login, Chat, Kommandos, Geld senden, Discord-Berechtigungen und Render-Deployment mit den echten Umgebungsvariablen zu prüfen.
