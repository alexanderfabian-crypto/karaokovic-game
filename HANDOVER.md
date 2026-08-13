# Karaokovic — Übergabeprotokoll

Stand: 13.08.2026. Datei: `app.js` (Single-File, kein Bundler, startet offline per
`file://` über `index.html`). Kein Git-Repo — es gibt keine Historie und kein
Rollback. **Vor der nächsten größeren Änderung eine Kopie von `app.js` anlegen.**

---

## 1. Aktueller Stand

### Die wichtigste Einschränkung zuerst

**Nichts davon ist im Browser verifiziert.** Geprüft wurde ausschließlich:

- `node --check app.js` (Syntax) nach jeder Änderung
- einzelne Klassen aus der Datei geschnitten und in Node ausgeführt
  (`MatchState`, `AudioEngine.updateSmoothedPitch`)
- Geometrie gegen `Vorgabe_Platz.png` nachgemessen und gerechnet

Es gab in dieser Sitzung **keinen einzigen Testlauf mit Mikrofon oder Bildschirm**.
Was unten als „funktioniert" steht, heißt: die Logik ist nachgerechnet oder in Node
durchgespielt — nicht, dass es auf der Bühne lief.

### Nachweislich korrekt (in Node ausgeführt)

- **Punkte-, Satz- und Aufschlaglogik** inkl. Aufschlagwechsel bei Spielgewinn,
  `undo()` stellt auch `server` wieder her, `scoreLine()` gibt aufschlägerzentriert aus
- **Oktavfilter** in `AudioEngine.updateSmoothedPitch()` — Oktavausreißer werden
  verworfen, echte Sprünge sofort übernommen (vier Testfälle durchgespielt)
- **Bewegungskurve** der gedämpften Annäherung (`glideToTarget`), kein Überschwingen

### Nachgerechnet, aber ungeprüft

- **Kameramodell trifft die Vorlage auf ≤ 1,6 px** an allen sechs Feldlinien.
  Overlay-Test: Physikgrenzen in Magenta über `Vorgabe_Platz.png` gelegt, sie liegen
  auf den aufgemalten Linien.
- Alle Overlay-Positionen (Bauchbinde, Noten, Klaviaturen, Countdown-Ausweichen)
  gegen die im Bild gemessenen Freiflächen gerechnet

### Offene Meldungen vom Nutzer

- „**Manchmal läuft die Spielerin in die falsche Richtung**" — zweimal behandelt,
  zuletzt durch Umbau des Sprungfilters. **Ob es weg ist, ist unbestätigt.**
  Diagnosehilfe: die Klaviatur zeigt `stablePitch` (roh), die Bewegung folgt
  `smoothedPitch`. Weichen beide sichtbar voneinander ab, liegt es am Filter oder
  an der Verzögerung, nicht an der Erkennung.

---

## 2. Architektur-Entscheidungen

### Kameramodell — echte Bodenebenen-Perspektive

Die alte Projektion war ein Polynom und konnte die Vorlage nicht treffen. Jetzt:

```
denom   = max(0.25, 1 − dy · DEPTH_STRENGTH)
scale3D = 1 / denom
px      = 800 + (x − 800) · scale3D
py      = HORIZON_Y + DEPTH_SPAN · scale3D
```

Dass Bildschirm-y **linear** vom Tiefenfaktor abhängt, ist die definierende
Eigenschaft einer Bodenebenen-Projektion. Werte aus `Vorgabe_Platz.png` gemessen:

| Konstante | Wert | Herkunft |
|---|---|---|
| `DEPTH_STRENGTH` | 0.3292 | Breitenverhältnis vorn/hinten = 1.98 |
| `HORIZON_Y` | −281.5 | Fluchtpunkt, aus beiden Grundlinien |
| `DEPTH_SPAN` | 659.3 | dito |
| `COURT_WIDTH` | 679 | Feldbreite am Netz (dort ist `scale3D` = 1) |
| `ALLEY_WIDTH` | 85 | 12,5 % der Feldbreite, wie im Bild gemessen |

**`COURT_HEIGHT` (660) beeinflusst das Bild NICHT mehr** — nur noch das Tempo, weil
die Vertikale über `HORIZON_Y`/`DEPTH_SPAN` verankert ist.

**Warnung:** Kommt ein Hintergrundbild in anderer Kadrierung, müssen alle fünf
Werte neu eingemessen werden. Das aktuelle Bild ist 1372×768 statt 1600×900 — das
staucht es beim Einpassen um 0,49 %, rund 5 px an der vorderen Grundlinie. Ein
Export in exakt 1600×900 würde das beheben.

### Hintergrundbild als Paradigma

Liegt `court_surface` im Manifest (aktuell `Vorgabe_Platz.png`), schaltet
`Renderer.hasCourtBackdrop()` um: Hintergrund, Platzfläche, Feldlinien, Netz,
Publikum und Personal werden **nicht** gezeichnet. Ball, Ballschatten,
Aufsprungmarken, Figuren und alle Overlays weiterhin schon.

Das Bild wird in das **virtuelle 16:9-Rechteck** gezeichnet, nicht über den ganzen
Canvas — sonst verschiebt es sich gegen die Feldgeometrie, sobald das Fenster nicht
exakt 16:9 ist.

### Vier getrennte Lautstärkeschwellen

Vorher hing alles an `volumeGate`, was ein Zielkonflikt war. Jetzt, aufsteigend:

| Schwelle | Wert | Wofür |
|---|---|---|
| `pitchGate` | 0.012 | Tonerkennung (autoCorrelate) |
| `moveGate` | 0.015 | Bewegung **und** Freigabe der Aufschlagsperre |
| `volumeGate` | 0.020 | 3-Sekunden-Stille, Schlagkraftkurve |
| `serveVolume` | 0.022 | Aufschlag (3 Frames) |

**Invariante: Freigabeschwelle der Aufschlagsperre ≤ `moveGate`.** Als das verletzt
war, lief die Aufschlägerin ihrem eigenen Aufschlag hinterher.

### Bewegung: gedämpfte Annäherung statt Lerp

`Physics.glideToTarget()` (kritisch gedämpft, `CONFIG.glideFrames = 12`).
Geschwindigkeit ist eigener Zustand (`velocityX`) — **muss überall auf 0, wo
`currentX` hart gesetzt wird**. Dafür gibt es `haltAt()` und `clampCurrentX()`.
Spitze 24 px/Frame statt vorher 60 im ersten Frame.

Laufgrenzen beider Figuren: `Physics.PLAYER_MIN_X`/`MAX_X` = `COURT_LEFT`/
`COURT_RIGHT`. Der kalibrierte Stimmumfang bildet exakt von Linie zu Linie ab.

### Tonhöhenfilter: Oktavfalle statt Sprungsperre

Verworfen wird nur, was ±12 Halbtöne ±`octaveTolerance` (1.5) vom aktuellen Wert
entfernt liegt, und auch das erst nach `pitchJumpFrames` (3) Frames. Alles andere
wird sofort übernommen, große Sprünge mit `pitchSmoothFast` (0.5).

Die **erste** Fassung sperrte jeden Sprung über 7 Halbtöne — das blockierte echte
Tonsprünge und war die Ursache der zweiten „falsche Richtung"-Meldung.

### Einspielen als Phase, nicht als State

`MatchState.phase` ∈ `PHASE.WARMUP` / `PHASE.MATCH`, **quer zu `STATE`**.
Angefragt war `STATE.WARMUP`; das geht nicht, weil `STATE` die Maschine *eines
Ballwechsels* ist und im Einspielen genau dieser Zyklus weiterlaufen soll.

`awardPoint()` steigt im Einspielen sofort aus — kein Punkt, kein Satz, kein
Aufschlagwechsel, kein Historieneintrag. Regie-Trigger: **Enter + Leertaste
gleichzeitig** → `startMatch()`.

### Sprite-Anker

`Renderer.BODY_PADDING` hält den gemessenen transparenten Rand der Körper-Sprites
(Andrea oben 11,4 % / unten 8,5 %; Alex 7,0 % / 11,3 %). Normiert wird die
**sichtbare** Höhe auf `BODY_HEIGHT`, das Bild so verschoben, dass die Füße auf
y = 0 stehen.

**Werden neue Sprites geliefert, müssen diese Zahlen mit.** Zur Laufzeit messen
geht nicht: `getImageData()` auf ein per `file://` geladenes Bild wirft in Chrome
eine SecurityError.

### Geschützte Logik — Stand der Abweichungen

Der Datei-Header listet geschützte Bereiche. Zwei davon wurden bewusst geändert:

1. `autoCorrelate()` benutzt jetzt `CONFIG.pitchGate` statt `volumeGate` als
   RMS-Schwelle. **Die Korrelationsmathematik selbst ist unverändert.**
2. `freqToQuantizedX()`: `percentage` wird weiterhin nicht geklemmt (Overdrive
   bleibt), aber das **Ergebnis** endet jetzt an der Seitenlinie statt am
   Bildschirmrand. Der Header-Kommentar ist an dieser Stelle veraltet.

---

## 3. Nächster Schritt

### Zuerst: einmal im Browser starten

Das ist der einzige sinnvolle nächste Schritt. Konkret zu prüfen, in dieser
Reihenfolge:

1. **Lädt das Hintergrundbild?** In der Konsole:
   `window.KARAOKOVIC.renderer.hasCourtBackdrop()` muss `true` sein,
   `window.KARAOKOVIC.assets.failed` muss leer sein.
2. **Deckt sich die Physik mit den aufgemalten Linien?** Ein Ball, der sichtbar
   auf der Linie aufspringt, muss „drin" sein.
3. **Läuft die Figur in die richtige Richtung?** Die Klaviatur im Einspielen ist
   das Diagnosewerkzeug: leuchtet die richtige Taste, aber die Figur geht woanders
   hin, liegt es zwischen `smoothedPitch` und der Bewegung.
4. **Ist Impact vorhanden?** Countdown und „EINSPIELEN"-Banner fallen sonst auf
   `sans-serif` zurück und der eckige Look ist weg.
5. **Hält die Bildrate im Einspielen?** Zwei Klaviaturen mit Verläufen laufen dort
   neben dem Spiel. Erste Bremse: `Renderer.KEYS_GLOW = 0`.

### Bekannte Stellschrauben, falls es sich falsch anfühlt

| Symptom | Regler |
|---|---|
| Steuerung träge | `CONFIG.glideFrames` runter (12) |
| Figur folgt der Stimme verzögert | `CONFIG.pitchSmooth` hoch (0.15 → 0.25) — **siehe unten** |
| Aufschlag zu leicht / zu schwer | `CONFIG.serveVolume` (0.022) |
| Alex zu stark | `Physics.OPPONENT_SPEED` (11) |
| Countdown springt beim Ausweichen | Versatz über Frames glätten, `Renderer.COUNTDOWN_DODGE` |

**Ein bekanntes, nicht behobenes Problem:** Beim langsamen Hineingleiten in einen
Ton liegen zwei Verzögerungen hintereinander — Tonglättung (`pitchSmooth = 0.15`)
und Figurenglättung (`glideFrames = 12`). Nach 7 Frames hängt `smoothedPitch` noch
rund 4 Halbtöne hinter der Stimme. Kurz nach einem Richtungswechsel kann das
aussehen wie „läuft falsch". Der Hebel ist `pitchSmooth` — die Glättung der
*Bewegung* macht das Gleiten ohnehin schon, die Tonglättung verzögert nur zusätzlich
das Ziel. Ich habe es nicht angefasst, um während des Testens nicht zwei Dinge
gleichzeitig zu ändern.

### Danach offen (vom Nutzer angekündigt, nicht begonnen)

**Zwei-Spieler-Audio.** Alex ist heute KI. Vorbereitet ist:
`Physics.OPPONENT_SPEED` als Vergleichsmaßstab, die hintere Klaviatur, und
`match.server` steuert Ballposition und Schlagrichtung bereits beidseitig.

Eine bekannte Stelle muss dabei mit: in `Physics.update()` klebt der Ball im
Aufschlagaufbau mit `b.x = this.currentX` an **Andreas** X-Position, auch wenn Alex
aufschlägt. Heute folgenlos, weil beide während des Aufbaus in der Feldmitte
stehen — mit echtem zweiten Eingang sofort ein sichtbarer Fehler.
