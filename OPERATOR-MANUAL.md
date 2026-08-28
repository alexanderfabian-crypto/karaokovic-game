# OPERATOR-MANUAL — Karaokovic / Voice Tennis

Für den Menschen am Rechner, nicht für den, der den Code liest. Was hier steht,
ist im Betrieb erreichbar; alles Weitere in `HANDOVER-ARENA.md`.

**Stand: ARENA-26 (28.08.2026).**

---

## 1. Die drei Regeln

1. **Was im Canvas steht, sieht das Publikum.** Der Canvas geht auf die
   LED-Wand, ins Programm und auf die Spielermonitore. Seit ARENA-24 steht dort
   keine Diagnose mehr — sie lebt im Operator-Panel.
2. **Das Panel ist im Regelfall aus.** Auf Sendung ist es nicht bloß
   unauffällig, sondern gar nicht da.
3. **Lautloses Fehlverhalten ist der teuerste Fehler.** Geht etwas nicht, steht
   der Grund im Protokoll (`Ctrl+Shift+L` sichert es als Datei).

---

## 2. Die Griffe

Alle mit **`Ctrl+Shift`** *oder* **`Alt+Shift`**. Auf dem Mac ist Ctrl der
zuverlässige Weg — die Option-Taste wird je nach Layout vom System abgefangen.

| Griff | Wirkung |
|---|---|
| `U` | Letzten Punkt zurücknehmen |
| `X` | Kompletter Reset auf 0:0 |
| `A` | **Notausgang:** Aufschlag erzwingen |
| `M` | Operator-Panel ein/aus |
| `L` | Protokoll als Datei sichern |

**Regie-Cue:** `Enter` + `Leertaste` gleichzeitig = Einspielen → Match.

> **Wenn kein Griff ankommt:** der Tastaturfokus liegt nicht im Spielfenster.
> Einmal ins Bild klicken. Das Panel meldet es als **E-04**.

---

## 3. Das Panel

`Ctrl+Shift+M`. Es hat **zwei Teile, und die gehören zu zwei verschiedenen
Situationen:**

```
┌──────────────────────────────┐
│ ● BEREIT                     │   ← im Betrieb lesen Sie NUR diese Zeile
│   ARCADE · MATCH · PLAYING   │
├──────────────────────────────┤
│ P1 PITCH            198 Hz   │   ← beim Einpegeln, vor der Show
│ P1 VOL       0.094  SINGEN   │
│ P2 PITCH                 —   │
│ P2 VOL                   —   │
│ RAUM                 0.006   │
│ GRENZE               0.020   │
└──────────────────────────────┘
```

**Zeile 1 ist die einzige, die im laufenden Betrieb zählt.** Steht dort
`BEREIT`, ist alles geprüft. Steht dort etwas anderes, sagt die Zeile darunter,
was zu tun ist — kein Nachschlagen nötig.

Brennen mehrere Störungen, nennt die Zeile die **dringendste** und zählt den
Rest (`+2 weitere`). Zuerst steht, was die Show anhält.

---

## 4. Die Meldungen

| | Bedeutung | Was tun |
|---|---|---|
| **E-01** | Audioeingang tot | In der Konsole `KARAOKOVIC.audioNeustart()`. Spielstand und Kalibrierung bleiben. |
| **E-02** | Raum zu laut | Die Ruheprüfung wird nicht fertig. Notausgang: `Ctrl+Shift+A`. Auf der Wand steht dann „Quiet, please." |
| **E-03** | Ton im Mikrofon | **Wichtiger als E-02** — siehe unten. |
| **E-04** | Tastaturfokus weg | Ins Spielfenster klicken, sonst kommt kein Hotkey an. |
| **E-05** | Bildkette unterbrochen | Fenster war verdeckt oder das Display schlief. Leuchtet 10 s nach. |
| **E-06** | Anzeigeskalierung | Systemskalierung auf 100 % stellen, sonst ist das Bild auf der Wand weich. |
| **E-07** | Bildrate zu hoch | Über 75 Hz läuft das Spiel zu schnell. `FEATURES.FIXED_TIMESTEP` aktivieren (Entwicklung). |
| **E-08** | Nur ein Kanal | Nur im Duell: Spieler 2 bekommt kein Signal. Dante-Konfiguration prüfen. |
| **E-09** | Pflicht-Asset fehlt | Ein Platzbild oder Kopf fehlt. Dateiname im Protokoll (`ASSET`). |

*(E-10 gab es einmal für den Klavier-Modus. Die Nummer bleibt frei — auf der
Bühne wird der Code gerufen, nicht der Wortlaut.)*

### E-02 und E-03 sind zwei Ursachen desselben Befunds

Der Countdown bleibt stehen. **Den Unterschied macht der Grundton:**

- **Ohne Grundton → E-02, der Raum ist zu laut.** Kann sich von selbst legen.
- **Mit Grundton → E-03, etwas Klingendes liegt auf dem Mikrofon** (ein
  Zuspieler, ein Instrument, ein offener Monitor).

**E-03 geht nie von selbst weg.** Die adaptive Stillegrenze lernt den Raumpegel
ausdrücklich **nur aus Frames ohne erkennbaren Grundton** — damit Gesang sie
nicht anhebt. Liegt ein Ton an, wächst die Grenze also *nicht* mit, während der
Pegel dauerhaft darüber liegt. Der Countdown wird nie fertig, jedes Mal,
reproduzierbar. Abhilfe ist **Mix-Minus**, nicht Warten.

---

## 5. Einpegeln vor der Aufzeichnung

Panel an (`Ctrl+Shift+M`), untere vier Zeilen lesen.

| Zeile | Grün heißt |
|---|---|
| `P1 PITCH` / `P2 PITCH` | Ton liegt im eingesungenen Umfang |
| `P1 VOL` / `P2 VOL` | **Die Frage wechselt mit dem Zustand:** Ruhephase → leise genug (`STILL`); Aufschlag → laut genug (`SINGEN`); Ballwechsel → hörbar |
| `RAUM` | Raumpegel unter `volumeGate` (0,020) |
| `GRENZE` | Die Stillegrenze musste **nicht** mitwachsen. Rot heißt: der Raum hat sie hochgezogen — das rettet vor dem Stillstand, ist aber kein guter Zustand. |

**Zielwert für gesungene Töne: 0,08–0,15.** Im Mitschnitt vom 24.08. lagen
Gesang (0,025) und Raum (0,027) gleichauf — das ist die Ursache des historischen
Bühnenausfalls. Liegt der Gesang auf dem Pegel des Raums, kann **keine**
Schwelle beides trennen.

---

## 6. Vor der ersten Probe einmal durchgehen

Auf dem **Show-Rechner**, per Doppelklick gestartet — genau so wie in der Show:

1. **Anzeigeskalierung.** Panel an. Steht dort `ANZEIGESKALIERUNG`? Dann im
   System auf 100 % stellen und neu laden.
2. **Bildrate.** Nach ~2 s steht sie im Protokoll (`DISPLAY`). Über 75 Hz →
   Meldung an die Entwicklung, `FIXED_TIMESTEP` muss dann an.
3. **Vollbild.** Chrome: `Ctrl+Cmd+F`. Bleibt das Bild sauber letterboxed?
4. **Lesbarkeit auf der Wand** — das kann niemand am Schreibtisch prüfen:
   Countdown-Ziffer, „AUFSCHLAG!", „Quiet, please.", die Bauchbinde.
5. **Einpegeln** nach Abschnitt 5, am echten Dante-Feed.

---

## 7. Wenn gar nichts mehr geht

1. `Ctrl+Shift+A` — Aufschlag erzwingen. Ein Aufschlag zur Unzeit ist billiger
   als ein Stillstand.
2. `Ctrl+Shift+X` — Reset auf 0:0.
3. `Ctrl+Shift+L` — Protokoll sichern, **bevor** der Browser geschlossen wird.
   Danach ist es weg.
4. Seite neu laden. Spielstand ist weg, die Kalibrierung auch — dafür sind es
   nur vier Klicks bis zurück ins Match.
