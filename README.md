# Classroom Quest – erster Prototyp

Ein browserbasierter Lautstärke-Monitor mit Timer, Arbeitsauftrag, Klassen-XP und Dino-Challenge.

## Enthalten

- Klassen lokal speichern
- Klassen-XP
- Stillarbeit / Partnerarbeit / Gruppenarbeit / Freiarbeit
- Arbeitsauftrag gleichzeitig sichtbar
- Timer
- Mikrofon-Lautstärke via Web Audio API
- Toleranz für kurze Lautstärkespitzen
- Fortschritt an die Arbeitszeit gekoppelt
- 100 % frühestens in den letzten 3 Minuten
- Dino-Ei mit CSS-Animationen
- Vollbildmodus

## Lokal starten

Mikrofonzugriff funktioniert zuverlässig über `localhost` oder HTTPS.

### Mit Python

```bash
cd classroom-quest
python3 -m http.server 8080
```

Dann im Browser öffnen:

`http://localhost:8080`

## GitHub Pages

Das Projekt ist absichtlich ohne Build-Schritt gebaut. Dadurch kann es später sehr einfach über GitHub Pages veröffentlicht werden.
