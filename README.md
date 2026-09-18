# Classroom Quest

Gamifizierter Lautstärke-Monitor für Unterrichtsphasen mit Timer, Arbeitsauftrag, Klassen-XP und Dino-Valley-Challenge.

## Aktueller Stand: v0.3 – Dino Valley V2

Neu in dieser Version:

- eigene gezeichnete SVG-Dinos statt Emoji-Dinos
- drei Dino-Typen und mehrere Farbvarianten
- neun feste Dino-Plätze in der Landschaft
- Eier erscheinen zeitversetzt und überlappend
- Ei wackelt sanft, bekommt Risse, Dino kommt langsam heraus und wächst noch etwas
- geschlüpfte Dinos bewegen sich nur sehr leicht auf und ab
- ruhige Hintergrundbewegungen bei Wolken, Rauch und Pflanzen
- Mic-Sensitivity und Lärm-Toleranz bleiben während der Challenge direkt verstellbar
- Sensitivity hat jetzt einen deutlich größeren Regelbereich; 100 % ist spürbar strenger
- vollständiger Abschluss weiterhin frühestens drei Minuten vor Ende
- Arbeitsauftrag und Challenge gleichzeitig sichtbar
- Klassen und XP werden lokal im Browser gespeichert

## Lokal starten

Da Browser Mikrofonzugriff bei `file://` einschränken, die Dateien am besten über einen lokalen Webserver öffnen:

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
