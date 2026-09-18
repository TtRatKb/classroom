# Classroom Quest

Ein kleiner, lokaler Classroom-Noise-Monitor mit Timer, Arbeitsauftrag, Klassen-XP und animierter Dino-Challenge.

## Aktueller Stand: v0.2

- Mikrofon-Lautstärkemessung direkt im Browser
- Arbeitsformen: Stillarbeit, Partnerarbeit, Gruppenarbeit und Freiarbeit
- Mic-Sensitivity und Lärm-Toleranz können **während einer laufenden Challenge** angepasst werden
- 9 Dino-Eier erscheinen und entwickeln sich zeitversetzt und überlappend in derselben Szene
- bei 30 Minuten kann die Challenge frühestens nach 27 Minuten vollständig abgeschlossen werden
- Arbeitsauftrag und Challenge gleichzeitig sichtbar
- Klassen und XP werden lokal im Browser gespeichert
- Vollbildmodus

## Lokal starten

Da Browser Mikrofonzugriff bei `file://` einschränken, die Dateien über einen lokalen Webserver öffnen:

```bash
cd classroom-quest
python3 -m http.server 8080
```

Dann im Browser öffnen:

```text
http://localhost:8080
```

## Hinweis

Die Lautstärke ist ein relativer Mikrofonwert und kein kalibrierter dB-Messwert.
