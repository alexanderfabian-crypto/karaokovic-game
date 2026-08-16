# Karaokovic — Übergabe (Stand 16.08.2026)

Ersetzt `HANDOVER.md` (Stand V37, inhaltlich überholt).
Aufzeichnung: Aufbau 19.10., Proben 20.10., Aufzeichnung 21.10.

---

## 1. Aktueller Stand

### Zwei Fassungen, die nebeneinander laufen

| Einstieg | Skript | Inhalt |
|---|---|---|
| `index.html` | `app.js` | **V41**, nur Hartplatz. Seit V41 unverändert. |
| `arena.html` | `app-arena.js` | **ARENA-1**, drei Plätze. Hier wird weitergebaut. |

Ausdrückliche Vorgabe des Auftraggebers: **am Ursprungscode (`app.js`,
`index.html`, `Vorgabe_Platz.png`) wird nicht gebaut.** Neues kommt in die
Arena-Fassung. `git status` auf diese drei Dateien muss leer bleiben.

### Nachweislich korrekt

**Node-Suite, 9 Dateien / 10 Läufe, 126 Zusicherungen, alle grün**
(`node Entwickler-Tests/alle-tests.js`, Dauer ~1 min): Tonhöhenerkennung,
Onboarding/Kalibrierung, Tennisregeln, Aufsprungpunkte, Gegnerverhalten,
Aufschlag-Auslösung, **Duell-Aufschlag (Arena)**, Ballwechseldauer,
Browserstart **für beide Fassungen**.

**Im echten Chrome (headless, CDP) geprüft — jetzt automatisch, nicht mehr per
Einmalskript:**

- Alle drei Plätze rendern fehlerfrei, 11/11 Assets, keine Seitenexception.
- Onboarding läuft bis `phase = WARMUP` durch, inklusive des Arena-eigenen
  Schritts Platzwahl (Sand gewählt → Folge `SAND -> HART -> RASEN`).
- Physikgrenzen als Overlay über die aufgemalten Linien gelegt: Doppel- und
  Einzelfeld liegen auf allen drei Plätzen auf den Linien.
- Satzfolge geprüft: Sand gewählt → Satz 1 Sand, nach Satz 1 Hartplatz, nach
  Satz 2 Rasen. Undo des Operators nimmt den Platz korrekt zurück.
- Laufrichtung: 0 Fehlframes auf monotonen Rampen, Fehlweg nach
  Richtungswechsel 21,8 px (war 50 px).

### Ungeprüft — bitte nicht als erledigt lesen

- **Der Duell-Modus mit zwei echten Mikrofonen.** Chromes Testgerät ist
  einkanalig. Geprüft ist der Signalweg mit synthetischem Zweikanal-Stream
  (200 Hz links, 400 Hz rechts, sauber getrennt) und die Spiellogik über
  direkt gesetzte Tonhöhen. Nie mit Hardware.
- **Nie auf der Bühnenmaschine gelaufen.** Alle Bildraten sind headless
  gemessen (Software-Rendering, kein Vsync).

---

## 2. Architektur-Entscheidungen

### Welt und Kamera sind getrennt (der Kernumbau)

In `app.js` fallen Weltmaß und Bildschirmmaß am Netz zusammen — `COURT_WIDTH`
ist beides zugleich. Das trägt bei einem Platzbild. Bei dreien, die den Platz
unterschiedlich groß zeigen, würde mit dem Belag auch Ballgeschwindigkeit,
Schlägerbreite und Laufweg wechseln.

In `app-arena.js` ist die **Welt fest** (`COURT_WIDTH = 679` wie immer), und
jeder Platz bringt seine eigene **Kamera** mit — siehe `PLAETZE`:

| Platz | Horizont | Spanne | Tiefe | Bildmitte | Maßstab |
|---|---|---|---|---|---|
| HART | −281,5 | 659,3 | 0,3292 | 800 | 1,00 |
| SAND | −308,1 | 820,1 | 0,2752 | 830,75 | 1,59 |
| RASEN | −319,1 | 783,1 | 0,2888 | 831,2 | 1,44 |

`setzePlatz(schlüssel)` schaltet um und zieht alles Abhängige nach: `BANNER_Y`,
Notenhöhen, Klaviaturhöhen, Figurengröße. **Wird ein Bild ausgetauscht, müssen
alle fünf Werte neu eingemessen werden** — Messskripte in `Entwickler-Tests/`.

`PLATZ.figur` ist ein *rein optischer* Faktor auf die Figurengröße (Sand 0.80,
weil dort Leute ins Bild gemalt sind). Trefferzonen hängen an `PADDLE` und
bleiben in Weltmaß — eine Kosmetikänderung darf das Spielgefühl nicht
verstellen.

### Perspektive der Bilder

- **Rasen** ist in sich stimmig: Seitenlinien-Fluchtpunkt −319, Tiefe verlangt
  −331, Aufschlaglinien treffen auf 0,8 px.
- **Hartplatz** ebenso, alle vier Linien unter 1 px.
- **Sand ist es nicht:** Seitenlinien laufen bei −370 zusammen, die Tiefe
  verlangt −108. Verankert ist auf Seitenlinien und Grundlinien; dadurch
  liegen Aufschlaglinien 9 bzw. 24 px und die Netzlinie 28 px neben dem
  Gemalten. Folgenlos für die Regeln — geurteilt wird gegen Einzel-Seitenlinien
  und Grundlinien, über das Netz wird nicht simuliert.

### Bildretusche

Drei Skripte, jeweils aus dem `*_ORIGINAL.png` heraus, nie aus dem bereits
bearbeiteten Bild:

    Entwickler-Tests/logos-entfernen.py         (Hartplatz)
    Entwickler-Tests/logos-entfernen-sand.py    (Sand)
    Entwickler-Tests/logos-entfernen-rasen.py   (Rasen)

Vier Verfahren, jedes für einen Untergrundtyp. Die Auswahl ist im Kopf jedes
Skripts begründet, samt der verworfenen Ansätze — bitte lesen, bevor ein
weiteres Logo entfernt wird, sonst werden dieselben Sackgassen wiederholt:
Strahlen erzeugen über Textur Rauten, Interpolation zieht Nachbarobjekte quer
durchs Bild, der Zeilenmedian trifft Buchstaben statt Untergrund.

**Wiederkehrende Falle:** die weiche Naht (`FEDER`) mischt am Lochrand das
Original zurück. Liegt dort noch eine Buchstabenkante, bleibt sie als Schatten
stehen. Boxen immer großzügiger als das Logo wählen.

### Audio

Ein Gerät, zwei Kanäle, `ChannelSplitter`, zwei `AudioEngine`-Instanzen
(`AudioEngine.initPair`). `channelCount: 2` und AGC/Noise-Suppression aus —
sonst erzwingt Chrome einen Mono-Downmix und beide Stimmen lägen auf beiden
Kanälen. Eigener Stimmumfang je Spieler (`minFreq`/`minFreq2`).

### Aufschlag

Er hängt an zwei Bedingungen, nur die zweite ist Lautstärke:
1. 3 s ununterbrochen unter `volumeGate` (0.020) — jeder Ton setzt zurück.
2. 3 Frames über `serveVolume` (0.022).

Innerhalb des kalibrierten Umfangs ist die nötige Lautstärke konstant
(Faktor 1,11). Zwischen „bricht die Ruhe" und „löst aus" liegt ein totes Band
von ~7 % Amplitude. Dauerhaftes Raumgeräusch über 0.020 blockiert vollständig
— der Mix-Minus-Cleanfeed ist damit belegt nicht optional.

---

## 3. Nächster Schritt

### Erledigt seit dem letzten Protokoll

**Der Duell-Aufschlag ist repariert** (`app-arena.js`, `triggerServe()`). Der
Fehler hatte *zwei* Hälften, nicht eine:

1. **Falscher Eingang** — fest `this.audio` statt des Eingangs des
   Aufschlägers. Das war der bekannte Teil.
2. **Falscher Stimmumfang** — `freqToQuantizedX()` wurde ohne Spieler-Parameter
   gerufen, rechnete also immer mit Andreas Kalibrierung. Auch mit richtigem
   Eingang wäre Alex' Ball schief geflogen.

**Die Falle dabei, bitte nicht erneut hineinlaufen:** der Umfang gehört zur
STIMME, nicht zum Aufschläger. Ein Fix über `match.server` sieht richtig aus,
bricht aber den Arcade-Modus — dort schlägt die KI auf, `serverAudio()` liefert
Andreas Mikrofon (die KI hat keine Stimme), und mit `match.server` würde ihr Ton
durch Alex' Kalibrierung gerechnet, die im Arcade-Modus nie eingesungen wird.
Der Umfang wird deshalb aus dem *gewählten Eingang* abgeleitet. Genau dieser
Zwischenfehler ist bei der Reparatur passiert und nur aufgefallen, weil der
Arcade-Fall mit im Test steht.

Abgesichert durch `Entwickler-Tests/test-duell-aufschlag.js`. Gegen den alten
Stand laufen genau die zwei Duell-Prüfungen rot, Andrea und Arcade bleiben grün.

**Zwei Lücken im Prüfstand, die das letzte Protokoll nicht kannte:**

- `dom-stub.js` lud fest `require('../app.js')`. Die „7 Dateien grün" haben
  `app-arena.js` **nie angefasst** — nicht nur der Browsertest zeigte auf die
  alte Fassung, die gesamte Node-Suite tat es. `loadGame(datei)` nimmt jetzt
  einen Dateinamen, Vorgabe unverändert `app.js`.
- `test-browser.js` benutzte den festen Debugport 9411 und räumte bei Abbruch
  nicht auf. Ein abgebrochener Lauf ließ Chrome stehen, der nächste Lauf
  verband sich per IPv4 mit dieser Waise statt mit dem eigenen Browser und hing
  dann ohne Zeitlimit. Auf der Entwicklungsmaschine hatten sich 17 Waisen
  angesammelt, die älteste über zwei Tage alt. Jetzt: freier Port vom
  Betriebssystem, eindeutiges Profil je Lauf, Zeitlimit auf den
  WebSocket-Aufbau, SIGKILL-Nachschlag und Signalhandler.

`test-browser.js` nimmt die zu prüfende Seite jetzt als Argument
(`node Entwickler-Tests/test-browser.js arena.html`) und läuft in der Suite
zweimal — einmal je Fassung. Den Arena-eigenen Schritt Platzwahl erkennt die
Datei selbst, statt in eine Kopie zu zerfallen.

### Danach

1. **Auf der Bühnenmaschine starten.** 60 Hz zwingend einstellen —
   `FEATURES.FIXED_TIMESTEP` steht auf `false`, die Physik zählt Frames.
   Background-Throttling in Chrome aus. Über `http://localhost` starten, nicht
   `file://`: sonst fragt Chrome bei jedem Reload neu nach dem Mikrofon.
2. **Zwei echte Mikrofone testen** (Dante Virtual Soundcard, zwei Cleanfeeds).
   Prüfen: liegt Spieler 1 links, Spieler 2 rechts?

### Offen, vom Auftraggeber noch nicht beauftragt

- **Refresh-Button mit Erhalt des Spielstands** existiert nicht (kein
  `localStorage`). Bei einer Live-on-Tape-Aufzeichnung der teuerste Hänger.
- **WIMBLEDON-Schriftzug** unten rechts im Rasenbild steht noch.
- Die kleine **Uhr auf der Rückwand** im Sandbild steht noch.

### Die Seite im Netz

Ausgeliefert wird der Ordner `docs/` über GitHub Pages (Einstellung: Branch
`main`, Ordner `/docs`). **Der Ordner wird nicht von Hand gepflegt**, sondern
gebaut:

    node Entwickler-Tests/webseite-bauen.js

Danach `docs/` mit committen und pushen — was gepusht ist, ist im Netz.

| Adresse | Fassung |
|---|---|
| `/` bzw. `/index.html` | **ARENA-1** (drei Plätze) — die Startseite |
| `/arena.html` | dieselbe Fassung unter ihrem eigenen Namen |
| `/v41.html` | V41 (nur Hartplatz), zum Vergleich |

Zwei Dinge, die dabei bewusst so sind:

- Die Startseite ist eine **Kopie** von `arena.html`. Pages liefert unter `/`
  immer `index.html` aus, und `index.html` ist im Projekt die eingefrorene
  Fassung V41, an der nicht gebaut wird. Deshalb kopieren statt umbenennen.
- Es kommt nur ins Netz, was das Spiel lädt. Die Übergabeprotokolle, die
  Entwickler-Tests, die Retusche-Skripte, die `*_ORIGINAL.png` und
  `Benni_Kopf.png` bleiben draußen. Die Bilderliste liest das Skript aus dem
  Spielcode — eine getippte Liste wäre nach dem ersten neuen Bild falsch, und
  der Fehler fiele erst dem Tester auf.

**Belegt** (Browsertest gegen den laufenden HTTP-Server, nicht gegen `file://`):
Startseite 34/34 Prüfungen grün mit 11/11 Bildern, `/v41.html` grün mit 9/9.
Der Unterschied ist nicht kosmetisch — unter `https://` haengt die
Mikrofonfreigabe am sicheren Kontext, unter `file://` gelten andere Regeln.
`test-browser.js` nimmt dafür auch eine vollständige URL als Argument:

    node Entwickler-Tests/test-browser.js http://127.0.0.1:8000/index.html

**Was der Tester braucht:** Chrome, ein Mikrofon, und die Bereitschaft, die
Mikrofonfreigabe zu erteilen. Ohne Freigabe bleibt das Onboarding in Schritt 3
stehen. Für belastbare Aussagen zur Bildrate gilt weiter: nur auf einem Rechner
mit 60 Hz.

### Bedienung

`arena.html` in Chrome. Schritt 1 Modus → Schritt 2 Platz → Schritt 3 Mikrofon
→ Schritt 4 einsingen (singen, **dann** klicken) → „Range okay!" →
„Einspielen starten" oder „Match starten".
Operator: `Alt+Shift+U` Undo, `Alt+Shift+X` Reset, `Enter+Leertaste` beendet
das Einspielen. `window.KARAOKOVIC.config` erlaubt Nachjustieren aus der
Konsole ohne Neuladen.
