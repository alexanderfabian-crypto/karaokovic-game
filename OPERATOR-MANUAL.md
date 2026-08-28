# OPERATOR-MANUAL — Karaokovic / Voice Tennis

Für den Menschen am Rechner, nicht für den, der den Code liest. Was hier steht,
ist im Betrieb erreichbar; alles Weitere in `HANDOVER-ARENA.md`.

**Stand: ARENA-25 (28.08.2026).**

---

## 1. Die drei Regeln

1. **Was im Canvas steht, sieht das Publikum.** Der Canvas geht auf die
   LED-Wand, ins Programm und auf die Spielermonitore. Seit ARENA-24 steht dort
   keine Diagnose mehr — sie lebt im Operator-Panel.
2. **Das Panel ist im Regelfall aus.** Auf Sendung ist es nicht bloß
   unauffällig, sondern gar nicht da.
3. **Lautloses Fehlverhalten ist der teuerste Fehler.** Wenn etwas nicht geht,
   steht der Grund im Protokoll (`Ctrl+Shift+L` sichert es als Datei).

---

## 2. Die Griffe

Alle mit **`Ctrl+Shift`** *oder* **`Alt+Shift`**. Auf dem Mac ist Ctrl der
zuverlässige Weg — die Option-Taste wird je nach Layout vom System abgefangen.

| Griff | Wirkung |
|---|---|
| `U` | Letzten Punkt zurücknehmen |
| `X` | Kompletter Reset auf 0:0 |
| `A` | **Notausgang:** Aufschlag erzwingen |
| `M` | Operator-Panel im Spielfenster ein/aus |
| `O` | Operator-Panel in ein **eigenes Fenster** |
| `L` | Protokoll als Datei sichern |

**Regie-Cue:** `Enter` + `Leertaste` gleichzeitig = Einspielen → Match.

> **Wenn kein Griff ankommt:** der Tastaturfokus liegt nicht im Spielfenster.
> Einmal ins Bild klicken. Das Panel meldet es als **E-04**.

---

## 3. Das Operator-Fenster

`Ctrl+Shift+M` schaltet das Panel **im Spielfenster** ein — und das ist der
Bildschirm, der im Vollbild auf die Wand geht. Für den Betrieb mit zwei
Bildschirmen gibt es deshalb seit ARENA-25 ein eigenes Fenster.

### 3.1 Öffnen

**Im Onboarding, Schritt 3 (Mikrofon-Check):** Knopf „Operator-Fenster öffnen".

**Das ist die richtige Stelle, und zwar aus einem harten Grund:** Chrome
verlässt den Vollbildmodus, sobald ein neues Fenster geöffnet wird. Wer das
Fenster erst auf der Bühne aufmacht, reißt damit das Sendebild aus dem Vollbild
— vor Publikum, mitten im Auftritt.

Danach: Fenster auf den zweiten Bildschirm ziehen, Spielfenster in den
Vollbildmodus. `Ctrl+Shift+O` öffnet es später erneut, falls es zugeklappt
wurde.

Solange das Fenster steht, bleibt das Panel im Spielfenster **aus** — auch wenn
`Ctrl+Shift+M` gedrückt wird. Wird das Fenster geschlossen, gilt der Schalter
wieder.

### 3.2 Probe auf dem Show-Rechner — **steht noch aus**

Ob ein Popup durchkommt, ist Browserpolitik und hängt an Version, Profil und
Startflags. Der Testlauf in headless Chrome **blockiert es** (geprüft ist dort
nur, dass das Scheitern im Protokoll steht, nicht im Nichts). **Auf dem
Show-Mac ist es nicht gemessen.** Vor der ersten Probe einmal durchgehen:

1. `arena.html` per **Doppelklick** starten — genau so, wie in der Show.
2. Bis Schritt 3 klicken, **„Operator-Fenster öffnen"** drücken.
3. **Erwartet:** ein eigenes Fenster, ~420×760, Titel „KARAOKOVIC — Operator",
   dunkler Kasten mit zehn Lampen `E-01`…`E-10` und den Messzeilen darunter.
4. Kommt stattdessen ein Hinweis „Fenster wurde blockiert" → **3.3**.
5. Fenster auf den zweiten Bildschirm ziehen. Spielfenster in den Vollbildmodus
   (Chrome: `Ctrl+Cmd+F`).
6. **Gegenprobe Sendebild:** `Ctrl+Shift+M` drücken. Im Spielfenster darf
   **nichts** erscheinen, solange das Operator-Fenster offen ist.
7. **Gegenprobe Lebenszeichen:** Spielfenster neu laden (`Cmd+R`). Das
   Operator-Fenster muss nach spätestens 1,5 s **„KEINE DATEN VOM SPIEL"**
   zeigen und die alten Zahlen ausgrauen — und danach, sobald das Spiel wieder
   läuft, von selbst weiterlaufen. Es darf **kein zweites** Fenster aufgehen.
8. Ergebnis in `HANDOVER-ARENA.md` eintragen und diesen Absatz ersetzen.

### 3.3 Wenn es nicht aufgeht

Das Spiel läuft in jedem Fall weiter — der Rückfall ist das Panel im
Spielfenster (`Ctrl+Shift+M`). Der Grund steht im Protokoll:

| Protokollzeile | Was tun |
|---|---|
| `Operator-Fenster blockiert (Popup-Sperre?)` | In Chrome für diese Seite Popups erlauben (Symbol rechts in der Adresszeile), erneut drücken. |
| `Operator-Fenster abgelehnt (…)` | Browser lässt `window.open` nicht zu. Mit `Ctrl+Shift+M` im Spielfenster arbeiten. |
| `Operator-Fenster nicht beschreibbar (…)` | Chrome vererbt die Herkunft nicht mehr. **Meldung an die Entwicklung** — das ist eine Verhaltensänderung des Browsers, kein Bedienfehler. |

---

## 4. Die Lampen

Grün = geprüft und in Ordnung. Rot = Alarm. Grau = gilt in diesem Modus nicht.

| | Bedeutung | Was tun |
|---|---|---|
| **E-01** | Audioeingang tot | In der Konsole `KARAOKOVIC.audioNeustart()`. Spielstand und Kalibrierung bleiben. |
| **E-02** | Ruheprüfung hängt | Der Raum ist zu laut oder der Eingang zu leise. Notausgang: `Ctrl+Shift+A`. Auf der Wand steht dann „Quiet, please." |
| **E-03** | Klavier im Mikrofon? | **Mix-Minus prüfen.** Siehe unten. |
| **E-04** | Tastaturfokus weg | Ins Spielfenster klicken — sonst kommt kein Hotkey an, auch nicht der Notausgang. |
| **E-05** | Bildkette unterbrochen | Fenster war verdeckt oder das Display schlief. Leuchtet 10 s nach. |
| **E-06** | Anzeigeskalierung | Systemskalierung auf 100 % stellen, sonst ist das Bild auf der Wand weich. |
| **E-07** | Bildrate | Über 75 Hz läuft das Spiel zu schnell. `FEATURES.FIXED_TIMESTEP` aktivieren (Entwicklung). |
| **E-08** | Nur ein Kanal | Nur im Duell: Spieler 2 bekommt kein Signal. Dante-Konfiguration prüfen. |
| **E-09** | Pflicht-Asset fehlt | Ein Platzbild oder Kopf fehlt. Dateinamen im Protokoll (`ASSET`). |
| **E-10** | Klavierstück fehlt | Nur im Klavier-Modus: MP3 liegt nicht neben `arena.html`. Das Spiel läuft ohne Begleitung weiter. |

### E-03 ist der wichtigste — und er gilt nicht nur im Klavier-Modus

Die adaptive Stillegrenze lernt den Raumpegel **nur aus Frames ohne erkennbaren
Grundton** (damit Gesang sie nicht anhebt). Ein Instrument im Mikrofon hat einen
Grundton — die Grenze wächst also *nicht* mit, während der Pegel dauerhaft
darüber liegt. **Der Countdown wird nie fertig, jedes Mal, reproduzierbar.**

Die Lampe greift deshalb bei jedem Hänger, bei dem gleichzeitig ein Grundton
anliegt — auch wenn im Arcade- oder Duell-Betrieb ein Klavier live daneben
steht.

**Abhilfe: Mix-Minus.** Das Klavier darf nicht im Gesangsmikrofon liegen. Im
Klavier-Modus läuft es auf die Kopfhörer der Sängerin; in der Show kommt der
Publikumston vom Pult, nicht aus dem Browser.

---

## 5. Die Messzeilen

| Zeile | Grün heißt |
|---|---|
| `P1 PITCH` / `P2 PITCH` | Ton liegt im eingesungenen Umfang |
| `P1 VOL` / `P2 VOL` | **Die Frage wechselt mit dem Zustand:** Ruhephase → leise genug (`STILL`); Aufschlag → laut genug (`SINGEN`); Ballwechsel → hörbar |
| `RAUM` | Raumpegel unter `volumeGate` |
| `GRENZE` | Die Stillegrenze musste **nicht** mitwachsen. Rot heißt: der Raum hat sie hochgezogen — das rettet vor dem Stillstand, ist aber kein guter Zustand. |
| `RUHE REST` | Wie lange noch still sein, bis der Aufschlag freigegeben wird |

### Einpegeln vor der Aufzeichnung

Zielwert für gesungene Töne: **0,08–0,15**. Im Mitschnitt vom 24.08. lagen
Gesang (0,025) und Raum (0,027) gleichauf — das ist die Ursache des historischen
Bühnenausfalls. Liegt der Gesang auf dem Pegel des Raums, kann **keine**
Schwelle beides trennen.

---

## 6. Wenn gar nichts mehr geht

1. `Ctrl+Shift+A` — Aufschlag erzwingen. Ein Aufschlag zur Unzeit ist billiger
   als ein Stillstand.
2. `Ctrl+Shift+X` — Reset auf 0:0.
3. `Ctrl+Shift+L` — Protokoll sichern, **bevor** der Browser geschlossen wird.
   Danach ist es weg.
4. Seite neu laden. Das Operator-Fenster bleibt offen und wird neu beschrieben.
