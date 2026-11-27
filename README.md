# Kartenwert

Handy-App (installierbare Web-App) für Yu-Gi-Oh!-Karten: Vorder- und Rückseite fotografieren, Zustand nach Cardmarket-Skala bewerten, Set-Code lesen und direkt zum passend gefilterten Cardmarket-Angebot springen. Läuft komplett auf dem Handy, ohne Konto und ohne API-Schlüssel.

## Was die App macht

1. **Karte finden** (`js/vision.js`): Hebt die Karte vom dunklen Untergrund ab, passt eine Gerade an jede Seite an und richtet das Bild gerade aus. Die Ecken lassen sich von Hand nachziehen.
2. **Kanten und Ecken messen**: Auf dem dunkelbraunen Rand der Rückseite zählt sie helle, farblose Pixel (weißer Abrieb) im äußeren Streifen, getrennt nach vier Kanten und vier Ecken.
3. **Zentrierung** links/rechts über die Kanten des Bildrahmens auf der Vorderseite.
4. **Set-Code lesen** mit Tesseract (Texterkennung auf dem Handy), dann Abgleich mit der freien Kartendatenbank YGOPRODeck. Falsch gelesene Ziffern (0/6/8 …) werden über die Datenbank korrigiert.
5. **Fragen** zu Knick, Biegung, Kratzern und sonstigen Schäden.
6. **Zustand** (`js/grade.js`): Die schlechteste Einzelbewertung zählt. Grenzwerte in `LIMITS` sind erste Schätzungen und sollten mit Karten bekannten Zustands nachjustiert werden.
7. **Preis**: Links zu Cardmarket mit Filter (Sprache, Zustand oder besser, Verkäufer aus Deutschland, ggf. 1. Auflage). Den günstigsten Preis trägt man ein, er landet im Verlauf (IndexedDB auf dem Handy).

## Entwickeln

Statische Dateien in `docs/` (GitHub Pages), kein Build-Schritt. Lokal starten: `cd docs && python3 -m http.server 8090`.
Tests: `node --test` (Node 20+).

Fremde Dateien in `docs/vendor/`: tesseract.js 5.1.1 und tesseract.js-core (Apache 2.0), englische Sprachdaten (best_int).
