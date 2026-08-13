# Entwickler-Tests

Prüfen die Spiellogik von `app.js` ohne Browser, Mikrofon und Bühne.
Voraussetzung: Node (getestet mit Node 24). Keine Abhängigkeiten, kein `npm install`.

## Ausführen

Immer aus dem **Projektordner** heraus:

```
node Entwickler-Tests/alle-tests.js      # alles nacheinander
node Entwickler-Tests/test-gegner.js     # einzeln
```

Ein fehlgeschlagener Test meldet sich mit `FAIL` und einem Exitcode ungleich 0.

## Was die Tests abdecken

| Datei | Prüft | Entstanden aus |
|---|---|---|
| `test-tonhoehe.js` | Welche gesungenen Töne die Erkennung akzeptiert (90–780 Hz) | Feste 500-Hz-Obergrenze blockierte hohe Stimmen |
| `test-kalibrierung.js` | Onboarding Schritt 2: singen → aufhören → klicken | Knopf reagierte nicht, weil der Ton beim Klick schon weg war |
| `test-regeln.js` | Aus, Doppelaufsprung, wer den Punkt bekommt | Punkt ging an die Falsche, wenn der Aufsprung im Feld lag |
| `test-aufsprung.js` | Jeder Treffpunkt landet im Einzelfeld | Overdrive am Bildrand erzeugte automatische Fehler |
| `test-gegner.js` | Alex trifft, wenn er will; Fehlgriffe sehen verschieden aus | Alex lief in konstantem Abstand neben dem Ball her |
| `test-ballwechsel.js` | Kein endloser Ballwechsel, ≥12 Punkte in 7 Minuten | Ballwechsel ohne Ende ist das größte Ablaufrisiko |

## Wie das technisch geht

`app.js` ist bewusst ein einziges Browser-File ohne Exporte — es soll offline
per `file://` starten. `dom-stub.js` baut deshalb gerade so viel Browser nach
(Canvas, `document`, `window`, `Image`), dass `app.js` durchläuft, und reicht
danach `window.KARAOKOVIC` weiter:

```js
const { loadGame, el, check, summary } = require('./dom-stub.js');
const game = loadGame();
game.physics.update();          // ein Frame Physik
el('btnLow').click();           // Onboarding-Knopf auslösen
```

Elemente werden pro ID zwischengespeichert, deshalb lösen `click()`-Aufrufe
genau die Handler aus, die `app.js` registriert hat.

Zwei Dinge, die es in Node nicht gibt und die nachgerechnet statt nachgebaut
werden:

* **Der Vorfilter** (Web-Audio-Biquad). Seine Dämpfung steckt in den Tests als
  Formel und wird auf das Testsignal angewendet. Ändert sich die Grenzfrequenz
  in `CONFIG`, muss die Konstante `FILTER_HZ` in `test-tonhoehe.js` und
  `test-kalibrierung.js` mitgezogen werden.
* **Das Mikrofon.** Töne werden als Sinus erzeugt und direkt an
  `audio.autoCorrelate()` übergeben.

## Neuen Test anlegen

1. Datei `test-<thema>.js` anlegen, `dom-stub.js` einbinden.
2. Mit `check('Beschreibung', bedingung, 'Detail')` prüfen.
3. Am Ende `summary()` aufrufen — sonst meldet der Runner fälschlich Erfolg.
4. In `alle-tests.js` in die Liste `TESTS` eintragen.
