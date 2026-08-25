# Karaokovic — Status quo

**Stand: 20.08.2026, ARENA-10 (`65cf507`), `main`, Arbeitsverzeichnis sauber.**
Aufzeichnung: Aufbau 19.10., Proben 20.10., Aufzeichnung 21.10.

Dieses Dokument ersetzt die Fassung vom 16.08. (Stand ARENA-1) und ist so
geschrieben, dass es allein steht: wer nur diese Datei liest, kann den Code
beurteilen, ohne die Vorgeschichte zu kennen.

---

## 1. Was das Projekt ist

Ein sprachgesteuertes 2.5D-Tennisspiel für eine Bühnen-/TV-Aufzeichnung
(„Xperion Arcade"). Die Tonhöhe der Stimme steuert die Figur quer über den
Platz, die Lautstärke die Schlagkraft. Zwei Betriebsarten sind spielbar:
**Arcade** (eine Stimme gegen die KI) und **1:1 Bühne** (zwei Stimmen, zwei
Kanäle, ein Rechner).

Es ist **keine Web-App**: kein Bundler, kein Paketmanager, keine Abhängigkeit,
kein Server. Zwei HTML-Dateien, zwei Skriptdateien, ein Ordner Bilder. Startet
offline per Doppelklick (`file://`) und ebenso über HTTP.

Der Auftraggeber ist Produzent und Eigentümer, nicht Entwickler. Alles
Nachjustierbare gehört deshalb an eine Stelle, die ohne Werkzeug erreichbar
ist (`CONFIG`, über `window.KARAOKOVIC.config` in der Konsole).

---

## 2. Harte Randbedingungen

Diese fünf Punkte sind nicht verhandelbar; ein Vorschlag, der einen davon
verletzt, ist unbrauchbar, egal wie gut er sonst ist.

1. **Am Ursprungscode wird nicht gebaut.** `app.js`, `index.html` und
   `Vorgabe_Platz.png` sind eingefroren (Stand V41). `git status` auf diese
   drei Dateien muss leer bleiben. Neues kommt ausschließlich nach
   `app-arena.js` / `arena.html`.
2. **Kein Build-Schritt.** Kein Bundler, kein Transpiler, kein npm. Was im
   Browser läuft, ist die Datei, die auf der Platte liegt.
3. **Offlinefähig.** Muss per `file://` starten. Das schließt ES-Module aus
   (CORS) und ebenso `getImageData()` auf geladene Bilder (SecurityError) —
   deshalb stehen z. B. die Sprite-Ränder als gemessene Zahlen im Code.
4. **60 Hz.** Die Physik zählt Frames, nicht Sekunden
   (`FEATURES.FIXED_TIMESTEP: false`). Bei 120 Hz läuft das Spiel doppelt so
   schnell. Der Notnagel existiert, ist aber nie im Betrieb gelaufen.
5. **Live-on-Tape.** Ein Absturz oder ein Hänger kostet einen Take. Deshalb
   liegt der komplette Frame in einem `try/catch` mit `requestAnimationFrame`
   im `finally` — eine Exception darf die Bildkette nicht beenden.

---

## 3. Landkarte

| Datei | Zeilen | Rolle |
|---|---:|---|
| `app-arena.js` | 6927 | **Die Arbeitsfassung.** Drei Plätze, alles Neue. |
| `arena.html` | 157 | Einstieg dazu; Onboarding-Formular und CSS. |
| `app.js` | 5720 | **Eingefroren**, Stand V41, nur Hartplatz. |
| `index.html` | 125 | Einstieg dazu, eingefroren. |
| `Entwickler-Tests/` | 14 Testdateien | Prüfstand, siehe Abschnitt 8. |
| `docs/` | 18 Dateien, 10.7 MB | **Generiert**, nie von Hand ändern. |
| `.github/workflows/webseite.yml` | | Auslieferung nach GitHub Pages. |
| `*_ORIGINAL.png` | | Unbearbeitete Platzbilder, Quelle der Retusche. |

`app-arena.js` ist ein Ableger von `app.js` und zu grob geschätzt 85 %
identisch. Die beiden Fassungen driften seit ARENA-1 auseinander — siehe
Abschnitt 11, das ist der größte offene Strukturpunkt.

Aufbau von `app-arena.js`, eine einzige IIFE, Reihenfolge = Abhängigkeits-
reihenfolge:

```
  1. CONFIG / FEATURES / PLAETZE / Weltkonstanten     Z.   75 –  800
  2. Viewport        virtuelle 1600x900 -> Canvas     Z.  813
  3. Projection      2.5D-Bodenebene                  Z.  875
  4. AssetManager    Bild-Registry + Fallback         Z.  944
  5. AudioEngine     Mikrofon, Autokorrelation        Z. 1047
  6. MatchState      Punkte, Sätze, Zustandsmaschine  Z. 1401
  7. Entities        Ball, Paddle, BounceMarks, Dvd   Z. 1657
  8. Physics         Bewegung, Kollision, Regeln      Z. 1770
  9. Renderer        kompletter Zeichencode           Z. 2863 – 5720
 10. InputHandler    Operator-Hotkeys                 Z. 5727
 11. Game            Loop, Übergänge, Onboarding      Z. 5876
     setzePlatz(), Protokoll, Bootstrap               Z. 6818 – 6927
```

---

## 4. Der Kernumbau: Welt und Kamera sind getrennt

In `app.js` fallen Weltmaß und Bildschirmmaß am Netz zusammen — `COURT_WIDTH`
ist beides zugleich. Das trägt bei genau einem Platzbild. Bei dreien, die den
Platz unterschiedlich groß zeigen, würde mit dem Belag auch
Ballgeschwindigkeit, Schlägerbreite und Laufweg wechseln.

In `app-arena.js` ist die **Welt fest** (`COURT_WIDTH = 679`, `COURT_HEIGHT =
660`), und jeder Platz bringt seine eigene **Kamera** mit (`PLAETZE`):

| Platz | horizont | spanne | tiefe | mitteX | skala | figur |
|---|---:|---:|---:|---:|---:|---:|
| HART | −281,5 | 659,3 | 0,3292 | 800 | 1,00 | 1,00 |
| SAND | −308,1 | 820,1 | 0,2752 | 830,75 | 1,59 | 0,80 |
| RASEN | −319,1 | 783,1 | 0,2888 | 831,2 | 1,44 | 1,00 |

Dazu je Platz: Höhe der beiden Notenmarken, Höhe der beiden Klaviaturen, Lage
der Bauchbinde (`hudX/hudY`), die Ränder der bespielbaren Fläche
(`randLinks/randRechts` als Funktionen von y), das Netzband (`netz`, nur Sand)
und die Besetzung des Schiedsrichterstuhls.

`setzePlatz(schlüssel)` schaltet um und zieht alles Abhängige nach.
**Wird ein Bild ausgetauscht, müssen alle Werte neu eingemessen werden** — sie
sind Zeile für Zeile am gerenderten Bild gemessen, nicht geschätzt.

`PLATZ.figur` ist ein **rein optischer** Faktor auf die Figurengröße (Sand
0,80, weil dort Leute ins Bild gemalt sind, gegen die unsere Figuren sonst zu
groß wirken). Trefferzonen hängen an `PADDLE` und bleiben in Weltmaß — eine
Kosmetikänderung darf das Spielgefühl nicht verstellen.

**Perspektive der Bilder, gemessen:** Hartplatz und Rasen sind in sich stimmig
(alle Linien unter 1 px bzw. 0,8 px). **Sand ist es nicht** — die Seitenlinien
laufen bei −370 zusammen, die Tiefe verlangt −108. Verankert ist auf Seiten-
und Grundlinien; dadurch liegen die Aufschlaglinien 9 bzw. 24 px und die
Netzlinie 28 px neben dem Gemalten. Folgenlos für die Regeln: geurteilt wird
gegen Einzel-Seitenlinien und Grundlinien, über das Netz wird nicht simuliert.

---

## 5. Signalkette und Aufschlag

**Audio:** ein Gerät, zwei Kanäle, `ChannelSplitter`, zwei `AudioEngine`-
Instanzen (`AudioEngine.initPair`). `channelCount: 2` und AGC / Noise
Suppression / Echo Cancellation **aus** — sonst erzwingt Chrome einen
Mono-Downmix und beide Stimmen lägen auf beiden Kanälen. Eigener Stimmumfang
je Spieler (`minFreq/maxFreq` und `minFreq2/maxFreq2`).

Tonhöhe per Autokorrelation im Zeitbereich (`AudioEngine.autoCorrelate`,
als GESCHÜTZT markiert), danach geglättet mit Oktavfalle
(`updateSmoothedPitch`).

**Drei getrennte Schwellen**, und die Trennung ist der Punkt — vorher hing
alles an einer:

| Schwelle | Wert | Wofür |
|---|---:|---|
| `pitchGate` | 0,012 | ab hier wird überhaupt eine Tonhöhe gemessen |
| `moveGate` | 0,015 | ab hier folgt die Figur der Stimme |
| `volumeGate` | 0,020 | darunter gilt „Ruhe"; außerdem Schlagkraftkurve |
| `serveVolume` | 0,022 | ab hier lädt der Aufschlag |

**Ein Aufschlag kommt zustande, wenn drei Bedingungen erfüllt sind:**

1. **2000 ms** ununterbrochen unter der Ruhegrenze. Die ist seit ARENA-6
   adaptiv: `max(volumeGate, Raumpegel × 1,6)`, wobei der Raumpegel das
   20. Perzentil der letzten drei Sekunden ist. Sie sinkt nie unter 0,020.
2. **3 Frames** (`SERVE_CHARGE_FRAMES`) über `serveVolume`.
3. **Seit ARENA-9:** die Tonhöhe liegt höchstens 5 Halbtöne außerhalb des
   eingesungenen Umfangs (`aufschlagTonPasst`). Ohne erkennbare Tonhöhe gilt
   der Aufschlag weiterhin — ein percussiver Einsatz soll auslösen dürfen.

Zwischen „bricht die Ruhe" und „löst aus" liegt ein totes Band von rund 7 %
Amplitude. **Dauerhaftes Raumgeräusch auf Gesangspegel blockiert vollständig**
— der Mix-Minus-Cleanfeed ist damit belegt nicht optional, siehe Abschnitt 10.

---

## 6. Zustandsmaschine

```
SILENCE_CHECK ──2 s Ruhe──> SERVE_WAIT ──Aufschlag──> PLAYING
      ^                                                   │
      │                                                Punkt
      └── TRANSITION <──3 s──── POINT_SCORED <────────────┘
              (Jingle-Blende, 3 s)      (Banner, 3 s)
```

Quer dazu liegt `MatchState.phase` (`WARMUP` / `MATCH`). Bewusst **nicht** als
weiterer `STATE`: im Einspielen soll genau derselbe Zyklus laufen, die Phase
entscheidet nur, ob gezählt wird. `Enter + Leertaste` schaltet auf Match.

Zwei Dinge, die im Ablauf leicht übersehen werden:

- **Das Zurücksetzen in die Feldmitte liegt im dunkelsten Frame der
  Jingle-Blende** (`prog > 0.2`, `transitionResetDone`). Dort ist es doppelt
  unsichtbar: `drawPlayers()` zeichnet die Figuren zwischen `prog` 0,1 und 0,3
  gar nicht, und `drawDimOverlay()` steht bei 0,2 auf `alpha = 1.0`.
  **Reihenfolge zwingend:** erst versetzen, dann `prepareServe()` — das legt
  den Ball an `currentX` ab, umgekehrt klebte er an der alten Position.
- **`serveMovementLock`:** der Aufschlag wird durch den gesungenen Ton
  ausgelöst, im Moment des Schlags singt die Spielerin also noch. Ohne Sperre
  rennt sie ihrem eigenen Aufschlag hinterher. Freigabeschwelle ist
  `moveGate`, **nicht** `volumeGate` — sonst öffnet sich ein Fenster, in dem
  die Sperre schon fällt und der ausklingende Ton noch die Position zieht.
  Beim Lösen wird zusätzlich `resetSmoothing()` gerufen, weil
  `smoothedPitch` die Stille überlebt.

---

## 7. Was seit ARENA-1 dazugekommen ist

Chronik mit dem jeweiligen *Warum* — nützlicher als eine reine Liste, weil
mehrere Punkte Korrekturen an vorherigen Punkten sind.

- **ARENA-2** — Duell-Aufschlag repariert. Der Fehler hatte zwei Hälften:
  falscher Eingang *und* falscher Stimmumfang. **Die Falle:** der Umfang
  gehört zur *Stimme*, nicht zum Aufschläger. Eine Reparatur über
  `match.server` sieht richtig aus, bricht aber Arcade — dort schlägt die KI
  auf, `serverAudio()` liefert Andreas Mikrofon (die KI hat keine Stimme), und
  ihr Ton wäre durch Alex' nie eingesungene Kalibrierung gerechnet worden.
  Der Umfang wird deshalb aus dem *gewählten Eingang* abgeleitet.
  Außerdem: `dom-stub.js` lud fest `app.js` — die gesamte Node-Suite hatte
  `app-arena.js` bis dahin **nie angefasst**.
- **ARENA-3** — Countdown 30 % kleiner, beginnt bei 2 statt 3, mit übertriebe-
  nem Einsprung; Ball optisch aufgefrischt und 10 % kleiner; Messanzeige mit
  Ampel; Onboarding-Schritt aufgeräumt.
- **ARENA-4** — Moduswahl dreigeteilt; Sandretusche; Benni auf allen drei
  Stühlen; Balltempo zurück auf 4,3/9,5; Figuren springen nicht mehr in die
  Mitte; **Totzone gegen das „Schwimmen"** (0,35 Halbtöne, musikalisch
  bemessen — gemessen 29,3 px Wandern in 3 s vorher, 0,00 px nachher, während
  ein Halbton weiterhin 35,7 px bewegt).
- **ARENA-5** — Ampel zustandsabhängig. **Das war die Korrektur meines eigenen
  Fehlers aus ARENA-3:** sie zeigte immer „das Spiel hört dich" (ab
  `moveGate`), während der Aufschlag zuerst zwei Sekunden *unter* `volumeGate`
  verlangt. Sie forderte auf zu tun, was den Aufschlag verhindert.
  Dazu: Bennis Kopf ×1,5, und das **Protokoll** — es gab bis dahin keine Logs.
- **ARENA-6** — Ruhegrenze wächst mit dem Raum, Warnung im Bild nach 8 s,
  Notausgang `Alt+Shift+A`. Aus dem ersten echten Bühnenprotokoll gerechnet,
  siehe Abschnitt 10.
- **ARENA-7** — Kopfgröße fest auf 1,3 (der Wert, mit dem bisher der Gewinner
  kurz aufblies); die Größenanimation entfällt ersatzlos, auf einen Punkt
  reagiert nur noch der Gesichtsausdruck. Zurücksetzen in die Jingle-Blende.
- **ARENA-8** — Punktestand im Einspielen; keiner mehr in der Blende; keiner
  mehr unten rechts (Messanzeige aus, `Alt+Shift+M` holt sie zurück).
- **ARENA-9** — Sand-Schriftzug repariert (Helligkeitsabgleich abschaltbar);
  **Ball steckt hinter dem gemalten Netz**; Bauchbinde je Platz; Aufschlag nur
  im Tonumfang.
- **ARENA-10** — Bauchbinde **nur noch im Match**, auf allen drei Plätzen.
  Nimmt Punkt 1 aus ARENA-8 wieder zurück; `warmupScore` läuft weiter mit.
- **ARENA-11** — Ergebnis der externen Durchsicht, sechs Punkte. Zwei davon
  sind echte Fehler, und beide waren **Nachwirkungen von ARENA-6**:
  - *Der Notausgang hinterließ einen falschen Alarm.* `Alt+Shift+A` verließ
    die Ruhephase an der Hänger-Erkennung vorbei; deren eigene Uhr wurde nur
    im regulären Ausstieg genullt. Ab dem nächsten Ballwechsel stand
    „RAUM ZU LAUT" im Bild — **auch im stillen Studio**. Die Erkennung misst
    jetzt `match.elapsed()`, also die Zeit *im Zustand*, und überlebt damit
    jeden Ausstiegsweg. Voraussetzung dafür ist, dass alle Übergänge über
    `setState()` laufen — das erledigt zugleich die technische Schuld Nr. 3
    der alten Liste, und die zwei fehlenden Protokollzeilen rund um den
    Aufschlag sind da.
  - *Die mitwachsende Ruhegrenze lernte vom Gesang.* Der Pegelspeicher bekam
    in **jedem** Frame einen Wert. Drei Sekunden gehaltener Ton ziehen das
    20. Perzentil auf Gesangsniveau — und stures Summen zählte als Ruhe. Die
    Prüfung „absolute Ruhe" hebelte sich selbst aus. Gemessen wird jetzt nur
    noch in Frames **ohne erkannten Grundton**; Jubel und Klatschen haben
    keinen stabilen Grundton und zählen weiter als Raum, der Zweck der Grenze
    bleibt also erhalten.

  Dazu vier Punkte ohne Bühnenbefund: **monotone Uhr** (`Uhr.jetzt()` statt
  `Date.now()`, 16 Stellen — ein NTP-Abgleich mitten in der Show sprang sonst
  durch Countdown, Haltespeicher und Blende), **Startdiagnose ins Protokoll**
  (geöffneter Eingang samt AGC/NS/EC, fehlende Bilddateien, gemessene
  Bildwiederholrate, Spitzenlast der Tonerkennung), **Ringpuffer für den
  Raumpegel** (die letzte Allokation je Frame) und Kleinvieh (Blur-Listener
  wieder abhängbar, zweiter Kanal in der Messanzeige).
- **ARENA-12** — der Bühnenausfall vom Mac-Rechner, in vier Teilen.
  - *Hotkeys nehmen jetzt `Ctrl+Shift` **oder** `Alt+Shift`.* Auf dem Mac ist
    die Option-Taste für Sonderzeichen belegt und wird je nach Layout vom
    System abgefangen — ausgerechnet der **Notausgang** war damit auf der
    Bühne nicht sicher erreichbar. Die Änderung berührt eine als GESCHÜTZT
    markierte Stelle, **erweitert** aber nur: keine eingeübte Kombination
    fällt weg. `test-hotkeys.js` prüft beide Wege *und* dass eine einzelne
    Zusatztaste weiterhin nichts auslöst.
  - *Die Kalibrierung hält einem Oktavfehler stand.* **Das war die Ursache
    des Ausfalls.** Gespeichert war ein Umfang von ~95–125 Hz — knapp fünf
    Halbtöne, eine ganze Oktave unter der Stimme, die tatsächlich sang.
    Abgewiesene und akzeptierte Aufschläge standen im Protokoll durchweg im
    Verhältnis **2:1** (155/87, 311/155, 220/100): die Handschrift einer
    Oktavverwechslung der Autokorrelation. Die Kalibrierung übernahm eine
    **einzelne Messung** — ein oktavfalscher Frame im Klickmoment legte den
    Umfang für die ganze Show fest. Jetzt wird der **Median der letzten
    600 ms** gespeichert, oktavverdächtige Ausreißer fliegen vorher heraus
    (`AudioEngine.calibrationPitch`). Dazu `MIN_CALIBRATION_RATIO` von 1,25
    auf 1,5 — knapp vier Halbtöne ließen den unbrauchbaren Bereich vorher
    anstandslos durch; sieben sind die Untergrenze der Spielbarkeit.
  - *Der Abweisungsgrund steht im Bild.* Unter „AUFSCHLAG!" erscheint
    „TON ZU HOCH/TIEF" — eine Tonhöhen-Abweisung sah bis dahin exakt so aus
    wie ein Spiel, das nicht reagiert. Im Protokoll dazu die **Oktav-
    Diagnose**: läge der Ton eine Oktave versetzt im Umfang, steht der
    Hinweis auf eine oktavfalsche Kalibrierung als Klartext da, statt aus
    2:1-Verhältnissen hergeleitet werden zu müssen.
  - *Der benutzte Stimmumfang steht im Protokoll* (`UMFANG`, mit Tonnamen und
    Halbtönen), samt zwei Warnmarken: **VORGABEWERT** (gar nicht eingesungen —
    19 Halbtöne sehen sonst wie ein gesunder Umfang aus) und **eng** (unter
    zwölf Halbtönen). Dazu eine `WARNUNG` beim Start, wenn die
    Anzeigeskalierung nicht auf 100 % steht.
- **ARENA-13** — Stresstest gegen die verbleibende Fehlerklasse: **lautloses
  Weiterlaufen im falschen Zustand.** Vier Bausteine, alle nach demselben
  Muster — erkennen, ins Protokoll, dem Operator ins Bild, und ein
  Rettungsgriff, der die Show weiterlaufen lässt.
  - *Lücken-Wächter.* Bei Minimieren, vollständiger Verdeckung oder
    schlafendem Display steht `requestAnimationFrame`. Die **Physik** übersteht
    das von selbst — sie zählt Aufrufe, nicht Zeit. Die Zustandsuhren nicht:
    nach der Lücke galt die Ruhe als erbracht, obwohl niemand gemessen hatte,
    und `elapsed()` protokollierte eine Hänger-Warnung, die es nie gab. Der
    Zustandsanker wandert jetzt um die Lücke mit, die Ruhe beginnt neu.
    Dazu `visibilitychange` (markiert den **Anfang** der Unterbrechung — der
    Wächter im Loop sieht nur ihr Ende) und der **Tastaturfokus**: die Tastatur
    folgt dem Fokus, nicht der Sichtbarkeit, nach einem Klick in DevTools ist
    der Notausgang tot und bisher zeigte das nichts.
  - *Audio-Wächter.* `getFloatTimeDomainData()` wirft nie — bei suspendiertem
    Context liefert sie den eingefrorenen letzten Puffer, bei beendetem Track
    Stille. Ein toter Dante-Feed sah deshalb aus wie ein heiles Spiel, in dem
    niemand singt: von außen exakt das Symptom des Oktavfehler-Ausfalls, nur
    ohne jede Protokollzeile. Erkannt wird über **bit-identisches RMS** — ein
    lebendes Mikrofon liefert das nie über Sekunden, das Grundrauschen zittert
    immer in den hinteren Nachkommastellen. Dazu Track-Ereignisse, ein
    `resume()` zur Selbstheilung und **`KARAOKOVIC.audioNeustart()`**: baut die
    Signalkette neu auf, Spielstand und Kalibrierung bleiben stehen. Die
    Warnung steht **immer** im Bild, unabhängig von der Messanzeige.
  - *Protokoll hält drei Stunden durch.* Die ersten 50 Zeilen überleben jede
    Rotation (Boot und Soundcheck), und eine anhaltende Störung eskaliert zur
    Sammelzeile statt zu fluten. Vorher hätte ein unruhiger Soundcheck genau
    die `AUDIO`- und `UMFANG`-Zeilen ausrotiert, für die ARENA-12 gebaut wurde.
  - *WakeLock ab Spielstart*, neu angefordert bei jeder Rückkehr der
    Sichtbarkeit — das System gibt ihn bei Verdeckung frei.
- **ARENA-14** — Sprint „Relative Pitch". **Der Aufschlag zielt nicht mehr.**
  Tonhöhen-Wahrnehmung ist relativ, nicht absolut: nach einem extremen Zielton
  verschiebt sich der innere Nullpunkt kurzzeitig, und der nächste Return
  misslingt, obwohl „richtig" gesungen wurde. Ausgelöst wird jetzt nur noch aus
  der **Mitte des eigenen Umfangs** (mittlere 20 %,
  `Physics.AUFSCHLAG_MITTE_BREITE`) — das setzt den inneren Kompass vor jedem
  Ballwechsel zwangsweise zurück. Die Richtung wird **gewürfelt**, mit leichter
  Anti-Wiederholung (dieselbe Hälfte wie zuletzt zu 60 % verworfen, nicht
  ausgeschlossen — sonst wäre „nie zweimal rechts" selbst wieder ein Muster).
  Gemessen: 400 Aufschläge mit identischem Ton ergeben 200/200 und 23 %
  Wiederholung bei erwarteten 20 %.
  - *Gegen die UI-Falle* läuft ein **Zielzonen-Meter** unter „AUFSCHLAG!"
    durchgehend mit, nicht erst bei einem misslungenen Versuch. Ohne ihn sähe
    ein knapp danebenliegender Ton exakt so aus wie ein Aufschlag, der nicht
    reagiert.
  - *`Physics.aufschlagProzent()`* ist herausgezogen und die **einzige** Stelle,
    die „wo im Umfang liegt dieser Ton" rechnet — Anzeige und Auslöser können
    nicht auseinanderlaufen. `freqToQuantizedX()` liefert bit-identische
    Ergebnisse; die geschützte Stelle ist ein reiner Refaktor.
  - *Zwei Tests sind mitgezogen statt zu verschwinden.* `test-duell-aufschlag`
    prüft beide Hälften des alten Duell-Fehlers weiterhin — sie sind nicht
    erledigt, sondern **umgezogen**: sie entscheiden jetzt, wessen Umfang die
    Zündzone misst. `test-aufschlag-tonhoehe` ist `test-aufschlag-mitte`
    gewichen; der alte hätte ab diesem Commit toten Code grün gemeldet.
- **ARENA-15** — Showschliff. Fünf Stellen, die im Bild störten:
  „AUFSCHLAG!" blendet nach zwei Pulsen aus (**der Zielzonen-Meter bleibt** —
  er wird gerade dann gebraucht, wenn jemand länger sucht); der Meter hängt
  nicht mehr am Textblock, sondern klebt an der **projizierten Grundlinie des
  Aufschlägers** (feste Bildkoordinaten wären auf Sand und Rasen daneben);
  Sieger- und Verlierergesicht halten bis in den Countdown statt mitten in der
  Blende auf neutral zu fallen; die Blende dauert 2 s statt 3 s und der
  Schriftzug federt mit derselben Kurve wie der Countdown.
  - *Ein echter Sprung ist weg:* die Aufschlagsperre rief `haltAt()` **ohne
    Argument** — das versetzt in die Bildmitte, statt festzuhalten. Im
    Arcade-Modus sprang Andrea ab Satz 2 bei jedem Aufschlag von Alex sichtbar.
    Gleiche Ursache wie damals im Bumper, siehe `haltWoSieSind()`.
  - *Messbare Folge der kürzeren Blende:* die Pause zwischen zwei Ballwechseln
    sinkt von 8 s auf 7 s, 20 Punkte in sieben Minuten (Bedarf ≥ 12).
  - *Bennis Kopf* kommt aus `HEAD_BOX` statt aus drei eingemessenen
    Absolutwerten — **mit einem Anteil je Platz**: 0,43 (Hart), 0,87 (Sand),
    0,67 (Rasen). Ein gemeinsames Verhältnis konnte nicht stimmen, weil der
    Stuhl auf den drei Bildern unterschiedlich weit weg steht, die
    Spielerfiguren aber nicht — mit einheitlich 0,8 wäre sein Kopf auf dem
    Hartplatz 62 px breit geworden, bei einem 36 px breiten Pult. Die drei
    Anteile reproduzieren die von Hand gefundenen Größen aufs Pixel (42,5 /
    68,8 / 66,2 px) und behalten den Gewinn der Kopplung: `HEAD_BOX` trägt
    `PLATZ.figur` und `HEAD_SCALE` bereits, eine spätere Änderung der
    Spielerköpfe zieht Benni automatisch mit. `Renderer.umpireKopfHoehe()`
    ist die einzige Stelle, die das rechnet — auch der Browsertest zielt
    darüber ins Gesicht, statt die Formel nachzubauen.
  - *„SINNER / ALCARAZ" ist aus dem Hartplatzbild retuschiert.* Sie stand nur
    dort, und ausgerechnet genau unter der eigenen Bauchbinde — im Match
    verdeckt, sichtbar nur im Einspielen. Die Retusche steht **im Skript**
    (`logos-entfernen.py`, Verfahren `klon`), nicht im Bild: das Skript
    erzeugt `Vorgabe_Platz.png` bei jedem Lauf neu aus dem Original, eine
    Retusche am Bild wäre spurlos verschwunden. Nachgeprüft: 34 947 geänderte
    Pixel, Bounding-Box exakt das vorgesehene Loch, sonst nichts im Bild.
- **ARENA-16** — Korrektursprint nach dem Mitschnitt vom 24.08. Das Briefing
  **ersetzt Teile von ARENA-15**: der endlose Puls, die bis in den Countdown
  haltenden Gesichter und der Bumper sind damit Geschichte.
  - *Die Trefferzone ist von 100 auf 71 Weltpixel halbiert worden* — die
    eigentliche Bühnenmeldung („Bälle, die klar neben der Figur vorbeiziehen,
    gelten als Treffer"). Nachgemessen aus dem Alphakanal der Sprites: die
    sichtbare Figur ist auf dem Hartplatz 84 px breit, die Zone war 100 px
    halb — **58 px leere Fläche je Seite**. Jetzt sind es 29 px, und ein Rest
    bleibt bewusst: pixelgenaues Treffen wäre auf der Bühne frustrierend.
    Dafür ist `PADDLE.hitPadding` in **`PADDLE.hitHalf`** umbenannt und von
    `PADDLE.width` getrennt worden. `width` normiert den **Schlagwinkel** und
    bleibt bei 150 — beide Bedeutungen steckten vorher in einer Zahl, und die
    Zone ließ sich nicht verkleinern, ohne die Ballrichtung mitzuverstellen.
    `test-trefferzone.js` prüft beides gegeneinander.
  - *Benni reagiert auf den Punkt* (`Benni_Punkt_Alex.png` /
    `Benni_Punkt_Andrea.png`) — aber erst nach `ERGEBNIS_VERZUG = 300 ms`,
    aus **derselben Quelle** wie die Mienen der Figuren
    (`Renderer.ergebnisZeigt()`). Ohne den Verzug verrät die Bildregie den
    Punktgewinner, bevor der Ball ausgespielt aussieht.
  - *Die Blende ist neu choreografiert:* Logo wischt von links ein (0–25 %),
    dreht sich im schwarzen Bild **genau einmal** (25–75 %), Platz blendet auf
    (75–100 %). Das Schwarz liegt jetzt **über** den Figuren — nur deshalb
    darf bei 35 % zurückgesetzt **und der Belag gewechselt** werden, ohne dass
    jemand einen Sprung sieht. Die Ränder schließen an die Nachbarphasen an
    (0,6 aus der Punktanzeige, 0 in die Ruheprüfung).
  - *Der Countdown federt wuchtiger:* Überschwinger 5,0 statt 3,2, Spitze
    **151 %** statt 128 %. `Renderer.COUNTDOWN_SPITZE` rechnet das Maximum
    **einmal beim Laden** aus der Kurve aus, statt es als zweite Zahl zu
    pflegen; die Kollisionsbox nutzt es, damit der Ausweichweg während der
    Federung konstant bleibt. Warum nicht mehr: bei 6,0 schöbe sich die Ziffer
    im Einsprung 30 % statt 17 % über Andreas Kopfbox.
  - *„AUFSCHLAG!" springt zweimal und ist dann weg* (2 × 380 ms, 150 ms
    Ausblende) statt endlos zu pulsieren. Der Zielzonen-Meter bleibt.
  - *Der Einspiel-Untertitel („ENTER + LEERTASTE") ist raus* — der Operator
    kennt die Taste, das Publikum sieht sonst eine Tastenbelegung.
  - *Zwei Entscheidungen aus dem Briefing:* die Abdunkelung im Countdown
    entfällt (volles Licht) — sie war bereits vorher entfernt worden; Stille
    bleibt bei 2 s und der Countdown bei „2…1".
  - *Fehlende Bilddateien sind jetzt zweierlei.* Der AssetManager führt eine
    Liste `OPTIONAL`: für diese Schlüssel gibt es einen Rückfall im
    Zeichencode, ihr Fehlen steht als Terminstand im Protokoll
    („noch nicht geliefert") und blockiert weder Browsertest noch
    `webseite-bauen.js`. Alles andere bleibt ein harter Fehler. Vorher sah ein
    fehlendes Platzbild aus wie ein noch nicht geliefertes Reaktionsbild.
  - *Nebenbefund, NICHT aus diesem Sprint:* auf dem **Sandplatz** liegt die
    ruhige Countdown-Ziffer 42 px auf der Kopfbox der hinteren Figur.
    Nachgerechnet mit dem alten Überschwinger 3,2 kommt derselbe Wert heraus —
    Ursache ist der **feste** Ausweichweg `COUNTDOWN_DODGE = 170 px`:
    `dodgeHeads()` probiert nur „gar nicht / hoch / runter" und nimmt bei zwei
    belegten Richtungen „hoch". Ein Ausweichen um das *nötige* Maß statt um
    einen festen Betrag würde es lösen. `test-showschliff.js` führt den Wert
    als Messmarke mit, damit er nicht unbemerkt wächst.
- **ARENA-17** — Korrektursprint 2. Vier diagnostizierte Fehler und zwei
  Neubauten.
  - *Der Aufschlag-Bumper war zu hektisch.* „AUFSCHLAG!" federte mit **380 ms
    je Schlag** — demselben Wert wie der Countdown, laut Kommentar bewusst.
    Der Schriftzug ist aber nur ein Viertel so hoch wie die Ziffer und legt in
    derselben Zeit einen viel kürzeren Weg zurück: zwei Schläge in 760 ms
    lesen sich als Zucken. Jetzt **620 ms**, bei **unveränderter Kurvenform**.
    Dafür ist `countdownBounce()` in `Renderer.bounce(alterMs, dauerMs,
    ueberschwinger)` verallgemeinert; die alte Funktion normierte intern auf
    `COUNTDOWN_BOUNCE_MS` und wäre nach 380 ms fertig gewesen — ein Plateau
    statt eines satteren Schlags. `spitzeVon()` leitet die Spitze jeder Kurve
    daraus ab.
  - *Das Blendenlogo wurde bei der Rotation beschnitten* — und die Ursache war
    eine andere als vermutet: **der Beschnitt des Wischs blieb während der
    ganzen Drehung stehen.** Ein Band von doppelter Logohöhe um die Bildmitte;
    das quer stehende Logo ragte oben und unten heraus. Nachgemessen: Maske
    620×273 px bei einem 620 px breiten Logo, das sich um 90° dreht. Die Maske
    endet jetzt mit dem Wisch. Zusätzlich eine **Größenklemme** über das
    achsenparallele Umrechteck des gedrehten Logos (5 % Rand zu jeder Kante) —
    sie greift beim Ersatzschriftzug nie, ist aber die Versicherung für die
    noch ausstehende Logodatei und als solche geprüft.
  - *Die Ergebnisgesichter kippten im ersten Blendenframe auf neutral.*
    `ergebnisZeigt()` lieferte ab dem Zustandswechsel '' — sichtbar, weil der
    Wisch dort erst zu 60 % deckt. Jetzt hält die Mimik (Spieler **und**
    Benni) bis `TRANS_WISCH_BIS`, also bis zum vollen Schwarz. Zweiter Teil
    derselben Ursache: das Einsacken der Verliererin rechnet mit `elapsed()`,
    und das beginnt in der Blende neu — ohne feste 1 sackte sie im Wisch ein
    zweites Mal ein.
  - *Während des vollen Schwarz wird die Welt gar nicht mehr gezeichnet.*
    `render()` steigt in diesem Fenster vorzeitig aus (`blendeDecktAlles`).
    Die Isolation ist damit **strukturell statt rechnerisch**: sie hängt nicht
    mehr daran, dass die Deckkraft wirklich 1,0 ist und dass niemand nach der
    Blende zeichnet. Gemessen: 1 Rechteck und 1 Text je Frame statt 326.
    Nebeneffekt: gespart wird die Rechenzeit ausgerechnet in dem Moment, in
    dem im Hintergrund der Platz gewechselt wird.
  - *Der Zielzonen-Meter hing bei Alex im Raum.* `ZIELZONE_LINIENABSTAND`
    wurde als **fester Bildabstand** angewandt — an der fernen Grundlinie ist
    derselbe Bildabstand perspektivisch das Doppelte. Jetzt skaliert er mit
    dem **Verhältnis der Tiefenmaßstäbe** zur vorderen Linie: Andrea behält
    auf allen drei Plätzen ihre eingemessenen 34 px, Alex bekommt 17 / 19 /
    19 px. Bewusst nicht der rohe `scale3D`: der hätte Andreas Abstand auf
    51 / 75 / 69 px gezogen, also je Platz einen anderen — der Meter selbst
    skaliert ja auch nicht mit der Tiefe, er ist eine Anzeige und kein
    Gegenstand auf dem Platz.
  - *NEU: die Stimm-Anzeige unten rechts.* Ein gestaltetes Show-Element in der
    Sprache der Bauchbinde: wessen Stimme gerade zählt, welcher Ton anliegt
    (Hertz und Notenname), wie laut, und ob das gerade etwas auslöst.
    **Nicht zu verwechseln mit dem Operator-Messgerät** (`Ctrl+Shift+M`), das
    unverändert daneben besteht.
    Die eigentliche Arbeit steckt nicht in der Grafik, sondern in der
    **einen Quelle**: `Physics.stimme`, geschrieben ausschließlich von
    `stimmeSetzen()`, gelesen von Auslöser, Zielzonen-Meter und Anzeige. Die
    Auslösebedingung des Aufschlags stand vorher zweimal ausgeschrieben im
    Code; jetzt entscheidet `stimme.frei` an genau einer Stelle. Der Balken
    läuft **logarithmisch** wie jede Aussteuerungsanzeige — linear läge der
    interessante Bereich (Raumgeräusch bis Schwelle) im linken Zehntel.
    Die Ecke unten rechts ist damit gestapelt: Anzeige unten (796–880),
    Audio-tot-Warnung darüber (772), Messanzeige über allem.
  - *NEU: der Ball prallt an der Kulisse ab.* Nach einem entschiedenen Punkt
    trifft ein weit geschlagener Ball die Tribüne hinter Alex oder eine der
    Seiten, kommt mit halber Geschwindigkeit zurück und rollt aus. **Reine
    Deko**, und die Leitplanken sind einzeln geprüft: kein Einfluss auf
    Wertung oder Zeitpunkte, kein Treffer mehr möglich, keine eigene Uhr,
    keine Marken außerhalb der Platzfläche, keine Protokollzeile.
    Die Grenzen sind **je Platz am Bild eingemessen** (25.08.2026,
    `Entwickler-Tests/rueckwand.py`, selbstkalibrierend über die Bodenfarbe)
    und mit der jeweiligen Kamera in Weltmaß zurückgerechnet: Rückwand bei
    Welt-y −54 (Hart), −2 (Sand), −75 (Rasen), also 224 / 172 / 245 px hinter
    der Grundlinie. Dazu zwei Dämpfungen, beide nur nach dem Punkt: 0,5 an der
    Wand und 0,82 Rollreibung je Bodenkontakt — ohne sie pendelte der Ball
    für immer zwischen den Wänden.
- **ARENA-18** — `dodgeHeads()` weicht um das nötige Maß aus.
  Der Ausweichweg großer Texte war ein FESTER Betrag (170 px), eingemessen für
  die Geometrie des Hartplatzes. Auf den anderen beiden konnte er nicht
  stimmen: auf Sand schob er die ruhende Countdown-Ziffer 42 px auf die
  Kopfbox der hinteren Figur — in jedem Satz neu, weil der Platz mit dem Satz
  wechselt.
  - Jetzt werden die freien **Bänder** zwischen den Köpfen bestimmt und darin
    die Lage gesucht, die der Ruhelage am nächsten liegt. Das Optimum sitzt
    immer bei 0 oder bündig an einer Kopfkante — dazwischen wird es nicht
    besser, deshalb genügen diese Kandidaten.
  - *Ein zweiter Fehler kam dabei heraus, und er war der gefährlichere:* die
    alte Methode nahm die **erste freie** Lage. Mit dem Deckel von 170 px
    blieb auf dem Hartplatz im Einsprung gar keine übrig (nötig sind 190 px) —
    sie fiel dann auf 0 zurück, also ausgerechnet auf die Lage, in der die
    Ziffer den Kopf **vollständig** verdeckt. Jetzt wird jeder Kandidat
    bewertet: Überdeckung zuerst, bei Gleichstand der kürzere Weg. Der Deckel
    steht auf 220 px (`COUNTDOWN_DODGE_MAX`), die Ziffer bleibt damit auf
    jedem Platz im Bild.
  - *Ergebnis, gemessen:* Überdeckung in Ruhe **0 px auf allen drei Plätzen**
    (vorher 42 px auf Sand), im Einsprung 0 px auf Hart und Sand. Auf Rasen
    bleiben 20 px auf zwei Köpfe verteilt — siehe die Notiz unter
    „Technische Schuld", das ist Geometrie und kein Fehler.
  - Gilt für Countdown **und** „AUFSCHLAG!" — beide rufen dieselbe Methode.

---

## 8. Prüfstand

```
node Entwickler-Tests/alle-tests.js       # ~2 min
```

**Stand 25.08.2026: 407 Zusicherungen, alle grün, Exit 0.** 25 Testdateien in
27 Läufen (zwei laufen doppelt, einmal je Fassung).

| Zusicherungen | Test |
|---:|---|
| 48 | `test-browser.js` — ARENA (`arena.html`) |
| 32 | `test-browser.js` — V41 (`index.html`) |
| 24 | `test-kalibrierung.js` — Onboarding / Stimm-Profiler |
| 12 | `test-einspielen.js` — Einspielen zählt getrennt vom Match |
| 18 | `test-aufschlag-mitte.js` — Zündzone und gewürfelte Richtung |
| 8 | `test-regeln.js` — Tennisregeln |
| 8 | `test-netz-verdeckung.js` — Netz verdeckt den Ball (Sand) |
| 33 | `test-showschliff.js` — Bennis Reaktion, Countdown, Aufforderung |
| 36 | `test-blende.js` — Übergangsblende zwischen Ballwechseln |
| 16 | `test-trefferzone.js` — Breite der Trefferzone |
| 24 | `test-stimme.js` — Stimm-Anzeige und ihre eine Quelle |
| 19 | `test-kulisse.js` — Abpraller an der Kulisse |
| 7 | `test-aufschlag.js` — Auslösen des Aufschlags |
| 7 | `test-duell-aufschlag.js` — Aufschlag im Duell |
| 6 | `test-tonhoehe.js` — Tonhöhenerkennung |
| 10 | `test-ruhe-im-laerm.js` — Ruheprüfung im lauten Raum |
| 14 | `test-kalibrierung-haerte.js` — Kalibrierung gegen Oktavfehler |
| 13 | `test-hotkeys.js` — Operator-Hotkeys, Ctrl und Alt |
| 13 | `test-luecke.js` — Pause der Bildkette |
| 13 | `test-audio-waechter.js` — toter Audioeingang wird erkannt |
| 13 | `test-protokoll.js` — Protokoll-Kopf und RUHE-Eskalation |
| 10 | `test-notausgang.js` — Notausgang und Hänger-Erkennung |
| 4 | `test-gegner.js` — Verhalten des Gegners |
| 4 | `test-ruhige-figur.js` — Figur steht still bei gehaltenem Ton |
| 3+3 | `test-ballwechsel.js` — Ballwechseldauer, beide Fassungen |
| 1 | `test-aufsprung.js` — Aufsprungpunkte |

**Wie er gebaut ist.** Zwei Sorten, beide von Hand, ohne Framework:

- **Node mit DOM-Attrappe** (`dom-stub.js`, `loadGame(datei)`): lädt den
  Spielcode in einen Prozess mit gefälschten Browser-Globals und greift über
  `window.KARAOKOVIC` auf die inneren Objekte zu. Seit ARENA-16 liefert
  `dom-stub.js` zusätzlich `zeichenprotokoll()` — einen **mitschreibenden**
  Canvas-Kontext. Damit lässt sich auch in Node prüfen, *was* gezeichnet
  wurde (Deckkraft der Blende, Drehwinkel des Logos, Schriftgrad der
  federnden Aufforderung), ohne ein echtes Chrome zu starten.
- **Echtes Chrome über CDP** (`test-browser.js`, 43 KB, ohne Puppeteer):
  startet Headless-Chrome auf einem freien Port mit eigenem Profil, spricht
  das DevTools-Protokoll direkt und wertet aus. Nimmt die Seite als Argument,
  auch eine vollständige URL:
  `node Entwickler-Tests/test-browser.js http://127.0.0.1:8000/index.html`

**Der wichtigste Testgrundsatz in diesem Projekt:** wo es um Sichtbares geht,
wird das **gezeichnete Bild** geprüft, nicht der Zustand. Zwei Befunde haben
das erzwungen — Bennis Kopf landete bei `y = NaN` (Konfiguration korrekt,
Bild geladen, kein Fehler, nur unsichtbar), und die Bauchbinde im Einspielen.
Beides wäre bei einer reinen Wertprüfung grün geblieben. Gemessen werden
deshalb einzelne Bildpunkte, z. B. Hautton RGB 233,202,183 gegen Platzgrün
RGB 96,122,85.

**Was der Prüfstand ausdrücklich NICHT abdeckt:**

- **Zwei echte Mikrofone.** Chromes Testgerät ist einkanalig. Geprüft ist der
  Signalweg mit synthetischem Zweikanal-Stream (200 Hz links, 400 Hz rechts,
  sauber getrennt) und die Spiellogik über direkt gesetzte Tonhöhen. **Nie mit
  Hardware.**
- **Die Bühnenmaschine.** Alle Bildraten sind headless gemessen
  (Software-Rendering, kein Vsync). 8,3 ms Median sagt über die LED-Wand
  nichts.
- **Alles Klangliche.** Ob ein Ton *sich richtig anfühlt*, prüft kein Test.

---

## 9. Auslieferung

Live: **https://alexanderfabian-crypto.github.io/karaokovic-game/**
(`/` = ARENA, `/arena.html` = dieselbe Fassung, `/v41.html` = V41.)

`docs/` wird **nicht von Hand gepflegt**, sondern gebaut:

```
node Entwickler-Tests/webseite-bauen.js   # -> 18 Dateien, 10.7 MB
```

Danach `docs/` mitcommitten. Der Workflow `.github/workflows/webseite.yml`
liefert aus und hat eine **Gegenprobe**: er baut `docs/` neu und bricht ab,
wenn `git diff --quiet -- docs` etwas meldet. Damit kann keine Seite ins Netz,
die einen älteren Stand zeigt als der Code — die teuerste Sorte Fehler, weil
die Seite erreichbar ist und niemand danach sucht.

Zwei bewusste Eigenheiten: die Startseite ist eine **Kopie** von `arena.html`
(Pages liefert unter `/` immer `index.html`, und die ist im Projekt die
eingefrorene V41), und die Bilderliste wird per Regex **aus dem Spielcode
gelesen** statt gepflegt.

**Ladezeit gemessen:** 11 Bilder nach 6,3 s bei kaltem Cache, 2,8 s mit Cache
— die drei Platzbilder sind je rund 2,5 MB. Wer die Seite zum ersten Mal
aufruft, sieht den Platz mit einigen Sekunden Verzug.

---

## 10. Der Befund, der noch offen ist: der Eingangspegel

Aus dem ersten echten Bühnenprotokoll gerechnet. Die Session hing **42
Sekunden** fest, ohne dass ein Aufschlag zustande kam.

```
Aufschläge (gelungen):   0.023 / 0.027 / 0.027
Raumgeräusch danach:     Median 0.025, Mittel 0.029, Spitzen bis 0.070
längste ruhige Strecke:  1.6 s   (gebraucht werden 2.0 s)
```

Rauschen und Gesang lagen auf **derselben Höhe**. AGC scheidet als Ursache
aus, die ist über `RAW_AUDIO_CONSTRAINTS` abgeschaltet.

ARENA-6 hat verhindert, dass daraus ein *Stillstand* wird (adaptive Grenze:
gegen dieselben Messwerte gerechnet galten vorher 0 % der Frames als ruhig,
danach 80 %). **Gelöst ist das Problem damit nicht.** Keine Schwelle trennt
0,025 von 0,027. Vor der Aufzeichnung muss neu eingepegelt werden, Zielwert
für gesungene Töne **0,08–0,15**. `Ctrl+Shift+M` blendet die Messanzeige dafür
ein.

---

## 11. Offene Punkte

### Technische Schuld

- **`app.js` und `app-arena.js` driften auseinander.** Rund 85 % identischer
  Code in zwei Dateien, die getrennt gepflegt werden. Jede Korrektur an einer
  geschützten Stelle muss zweimal gedacht werden. Solange V41 eingefroren
  bleibt, ist das beherrschbar — es ist aber der Punkt, an dem später ein
  Fehler doppelt gesucht wird.
- **`app-arena.js` sind 9163 Zeilen in einer IIFE.** Eine Aufteilung ohne
  Build-Schritt wäre möglich (mehrere `<script>`-Tags, gemeinsames Namensraum-
  objekt), kostet aber die Kapselung, die die IIFE heute liefert.
- **Kein `localStorage`, keine Wiederaufnahme.** Ein versehentlicher Reload
  mitten in der Aufzeichnung kostet Spielstand *und* Kalibrierung. Bei
  Live-on-Tape der teuerste denkbare Hänger. Nie beauftragt.
- **Kein Umgang mit einem verschwindenden Eingabegerät.** Wird das
  Audio-Interface während der Show umgesteckt, endet der Stream stillschweigend
  und die Figuren stehen.
- **10,7 MB Bilder**, davon 7,5 MB für drei Platzbilder. Für einen Ferntester
  spürbar (siehe Abschnitt 9).
- **`Physics.aufschlagTonPasst()` und `CONFIG.aufschlagToleranzHalbtoene` sind
  seit ARENA-14 ohne Aufrufer.** Nachgeprüft, nicht vermutet: der einzige
  Lesezugriff auf die Konstante steht *innerhalb* der Funktion, und die ruft
  niemand mehr. Beide sind im Code ausdrücklich als wirkungslos markiert —
  sonst dreht irgendwann jemand an einer Zahl, die nichts mehr tut. Das
  Entfernen ist ein eigener Durchgang mit eigenem Testlauf; der lebende Regler
  heißt `Physics.AUFSCHLAG_MITTE_BREITE`.
- **Die Countdown-Ziffer passt auf dem Rasenplatz nicht zwischen die Köpfe.**
  Kein Fehler mehr, sondern eine gemessene Enge: das freie Band zwischen den
  beiden Kopfboxen misst dort 320 px, die Ziffer im Einsprung 339 px — 19 px
  zu viel. `dodgeHeads()` teilt die Störung seit ARENA-18 gleichmäßig auf
  beide Köpfe auf (je rund 10 px am Scheitel, für die ~170 ms des
  Überschwingers); in Ruhe steht sie auf allen drei Plätzen frei. Ganz zu
  beseitigen wäre es nur über die Ziffer selbst: `COUNTDOWN_SIZE` 264 statt
  280, oder `COUNTDOWN_OVERSHOOT` 4,3 statt 5,0. Beides sind bewusst gewählte
  Bühnenwerte — deshalb steht hier die Zahl und nicht eine stille Korrektur.
- **Zwei Optimierungen sind bewusst zurückgestellt, bis gemessen ist.** Beide
  aus der Durchsicht zu ARENA-11, beide mit einem klaren Auslöser:
  - *Countdown-Glow vorrendern.* `gothicText()` zeichnet in jedem Frame der
    Ruhephase mit `shadowBlur` und zwei Stroke-Durchgängen — die teuerste
    Canvas-Operation überhaupt. Es gibt nur drei Ziffern; einmal pro Resize in
    ein Offscreen-Canvas und dann `drawImage` wäre deutlich billiger. **Nicht
    gemacht, weil** ein verrutschter Skalierungsfaktor den Countdown auf der
    LED-Wand matschig macht und das teurer wäre als die gesparte Rechenzeit.
    *Auslöser:* messbare Framedrops **durch den Countdown** auf dem
    Show-Rechner.
  - *Lag-Deckel in `autoCorrelate`.* Die äußere Schleife bei
    `sampleRate / CONFIG.pitchFloor` zu deckeln spart rund ein Drittel. **Nicht
    verhaltensneutral:** liegt das globale Maximum heute jenseits des Deckels,
    wird es als „unter 60 Hz" verworfen; gedeckelt käme stattdessen der beste
    Peak *im* Fenster. Die Änderung kann also Erkennungen *hinzufügen*, wo
    heute keine gemeldet wird. Die Funktion ist geschützt — das braucht einen
    A/B-Vergleich gegen aufgezeichnete Takes und eine ausdrückliche Freigabe.
    *Auslöser:* `PERF`-Zeilen im Protokoll (Spitze über 4 ms).

### Inhaltlich offen

- **Sand-Schriftzug:** an einer Kastengrenze bleibt eine 2–3 px feine Linie im
  „R" von KARAOKOVIC. Vier gescheiterte Anläufe stehen im Kopf von
  `logos-entfernen-sand.py`.
- **Netzverdeckung gibt es nur auf Sand.** Der Mechanismus ist da
  (`Renderer.netzVerdeckt`), Hart und Rasen haben `netz: null` und damit
  unverändertes Verhalten. Je eine Messung nötig, wenn es dort auch gewünscht
  ist.
- **Bennis weitere Gesichtsausdrücke.** Die Slots `head_benni_punkt` und
  `head_benni_ernst` stehen leer im Manifest; `resolveSchiriKopf()` greift sie
  von selbst ab, sobald Dateinamen eingetragen sind. **Es fehlen die Bilder**
  und die Ansage, welcher Ausdruck wann kommt.
- **WIMBLEDON-Schriftzug** unten rechts im Rasenbild steht noch, ebenso die
  kleine **Uhr auf der Rückwand** im Sandbild und eine zweite **Uhr oben
  rechts im Rasenbild**. Alle drei wären mit `logos-entfernen.py` in derselben
  Art zu erledigen wie „SINNER / ALCARAZ" — für Sand und Rasen bräuchte es
  dafür je ein eigenes Skript, es gibt bisher nur eines für den Hartplatz
  (`logos-entfernen-sand.py` und `-rasen.py` liegen daneben und decken andere
  Stellen ab).
- **`MODE.ONLINE` ist reserviert und wird nirgends gesetzt.** Es gibt keinen
  Netzwerkcode. Ein Fernduell bräuchte einen vermittelnden Server (die Seite
  ist statisch), *einen* rechnenden Rechner statt zwei (die Physik zählt
  Frames und liefe sonst auseinander) und einen Umgang mit Latenz. Der Knopf
  bleibt anklickbar und erklärt das — ein toter Knopf lässt den Bediener
  zweifeln, ob er kaputt ist.

### Betriebsregeln Show-Rechner (Mac)

Bewusst **hier und nicht im Code**: das sind Einstellungen der Maschine, kein
Verhalten des Spiels. Seit ARENA-13 meldet das Spiel jeden Verstoß im
Protokoll — die Regeln verhindern ihn.

1. **Chrome mit Flags starten** (Automator-App oder Terminal-Alias):
   `open -na "Google Chrome" --args --disable-backgrounding-occluded-windows
   --disable-background-timer-throttling --disable-renderer-backgrounding`
2. **Energie:** Display-Ruhezustand „Nie", automatisches Sperren aus, aktive
   Ecken aus, **Netzteil dran** (Chromes Energiesparmodus drosselt auf Akku).
   Gürtel zum Hosenträger: `caffeinate -dims` in einem offenen Terminal.
   Der WakeLock aus ARENA-13 ist die dritte Sicherung, nicht die einzige.
3. **Vor jedem Cue einmal ins Spielfenster klicken.** Die Tastatur folgt dem
   **Fokus**, nicht der Sichtbarkeit; nach einem Klick in DevTools oder auf den
   zweiten Monitor kommt `Ctrl+Shift+A` nicht mehr an. Das Protokoll meldet den
   Verlust — die Regel verhindert ihn.
4. **Kein Fenster vollflächig über das Spielfenster legen**, auch nicht kurz.
   Vollständige Verdeckung stoppt die Bildkette; der Lücken-Wächter rettet die
   Timer, aber die Wand zeigt in dieser Zeit ein stehendes Bild.

### Vor der Aufzeichnung zu erledigen

1. **Eingangspegel neu einstellen** (Abschnitt 10). Das ist der wichtigste
   Punkt der Liste.
2. **Auf der Bühnenmaschine starten**, 60 Hz zwingend, Background-Throttling
   in Chrome aus, über `http://localhost` statt `file://` — sonst fragt Chrome
   bei jedem Reload neu nach dem Mikrofon.
   Die Bildwiederholrate muss man nicht mehr raten: nach rund zwei Sekunden
   steht eine `DISPLAY`-Zeile im Protokoll, über 75 Hz zusätzlich eine
   `WARNUNG` mit der Angabe, um wie viel Prozent das Spiel zu schnell läuft.
3. **Windows-Anzeigeskalierung auf 100 % stellen.** Der Canvas rechnet in
   CSS-Pixeln; bei 125 % oder 150 % rendert Chrome intern kleiner und
   skaliert hoch, was auf der LED-Wand sichtbar weich wird.
   **Bewusst nicht über `devicePixelRatio` gelöst:** die Arena-Wand wird mit
   9216×1296 bespielt, und den Canvas dort um Faktor 1,25 oder 1,5 mehr Pixel
   rechnen zu lassen, kostet Füllrate in einer Größenordnung, die die 60 FPS
   sofort kosten kann.
   Seit ARENA-12 muss man daran nicht mehr denken: steht die Skalierung nicht
   auf 100 %, schreibt das Spiel beim Start eine `WARNUNG` ins Protokoll und
   auf die Konsole (`Game.pruefeSkalierung`). Behoben wird es weiterhin in der
   Systemeinstellung, nicht im Code.
4. **Zwei echte Mikrofone testen.** Prüfen: liegt Spieler 1 links, Spieler 2
   rechts? Die `AUDIO`-Zeile im Protokoll nennt seit ARENA-11 Gerätenamen,
   Abtastrate, Kanalzahl und ob AGC/NS/EC wirklich aus sind — bei einem
   stummen Spieler 2 ist das die erste Zeile, die man liest.
5. **Verdeckungstest.** Fenster mitten im Match minimieren, 10 s warten,
   zurückholen: Protokoll zeigt Anfang (`WARNUNG` verdeckt), Lücke (`WARNUNG`
   Frame-Lücke) und Ende (`INFO` sichtbar); der Countdown läuft danach
   **vollständig neu**, und es steht keine Geister-Warnung „Ruhe seit 8 s" da.
6. **Dante-Test.** DVS im Countdown beenden: binnen rund drei Sekunden rote
   Zeile im Bild — **ohne** dass die Messanzeige an ist — und `WARNUNG`-Zeilen
   im Protokoll. DVS starten, `KARAOKOVIC.audioNeustart()` in der Konsole:
   „Neuverbindung erfolgreich", Spielstand und Kalibrierung unverändert,
   danach normaler Aufschlag. Suspension isoliert prüfen:
   `KARAOKOVIC.audio.audioCtx.suspend()` → binnen einer Sekunde Protokollzeile
   und Selbstheilung per `resume()`.
7. **Standby-Test.** 30 Minuten Leerlauf in der Aufschlagphase mit laufender
   PA-Grundlast: Display bleibt an, das Protokoll enthält am **Anfang**
   weiterhin die Boot- und Soundcheck-Zeilen, der RUHE-Bereich zeigt
   Sammelzeilen statt einer Flut.
8. **Die drei ausstehenden Bilddateien einspielen**, sobald die Grafik
   liefert: `Benni_Punkt_Alex.png`, `Benni_Punkt_Andrea.png`,
   `Transitionlogo_Karaokovic.png`. Sie liegen bereits im Manifest und in
   `AssetManager.OPTIONAL` — einfach in den Projektstamm legen,
   `node Entwickler-Tests/webseite-bauen.js` laufen lassen, fertig; **kein
   Codeeingriff**. Solange sie fehlen, zeigt Benni den Standardkopf und die
   Blende den KARAOKOVIC-Schriftzug, und das Protokoll führt je eine
   `ASSET`-Zeile „noch nicht geliefert". Zur Abnahme gehört, dass diese drei
   Zeilen dann verschwunden sind.

---

## 12. Für einen Code-Review: was absichtlich so ist

Diese Stellen sehen nach Fehlern aus, sind aber begründete Entscheidungen.
Ein Vorschlag, der sie „repariert", ist ein Rückschritt.

- **`autoCorrelate()` ist O(n²) und läuft 60-mal pro Sekunde.** Mathematik 1:1
  aus V36, als GESCHÜTZT markiert, Bühnenfreigabe hängt daran. Eine
  FFT-basierte Tonhöhenerkennung wäre schneller und würde die eingespielte
  Abstimmung sämtlicher Schwellen ungültig machen. Die einzigen Änderungen
  waren speicherseitig und rechnerisch neutral (Puffer statt Allokation je
  Frame, Index-Offset statt `slice()`).
- **`freqToQuantizedX()` klemmt `percentage` nicht auf 0..1.** Der Overdrive
  über den kalibrierten Umfang hinaus ist ausdrücklich erwünscht. Geklemmt
  wird erst das *Ergebnis*, an der äußeren Seitenlinie.
- **Frame-basierte Physik ohne Delta-Time.** Siehe Randbedingung 4. Ein
  „modernes" `dt`-Scaling würde alle eingespielten Geschwindigkeiten
  verstellen. Seit ARENA-11 *meldet* das Spiel eine zu hohe Bildwiederholrate
  (`DISPLAY`/`WARNUNG` im Protokoll), schaltet aber ausdrücklich **nicht**
  selbst auf `FIXED_TIMESTEP` um: eine Show, die ihre eigene Physik heimlich
  umstellt, ist das größere Risiko.
- **Der Canvas rechnet in CSS-Pixeln, `devicePixelRatio` wird ignoriert.**
  Kein Versehen, sondern gegen die Arena-Wand gerechnet (9216×1296) — siehe
  Abschnitt 11, „Vor der Aufzeichnung", Punkt 3. Die Skalierung ist eine
  Zeile in der Checkliste, kein Codeweg.
- **Zwei Dämpfungen hintereinander** (`pitchSmooth` 0,35 auf die Tonhöhe,
  `glideFrames` 12 auf die Bewegung). Beides ist gemessen; die Tabelle mit
  Fehlweg gegen Zappeln steht im Kommentar bei `CONFIG.pitchSmooth`.
- **Die Totzone sitzt im Ziel, nicht in der Dämpfung** (`Physics.ruhigesZiel`).
  Die Dämpfung ist kritisch gedämpft und schwingt nicht über — das
  „Schwimmen" kam vom Ziel, nicht von der Bewegung.
- **`CONFIG.lerpSpeed` wird nicht mehr benutzt** und steht als Bezugsgröße im
  Code. Ebenso ist **`CONFIG.gravity` nur der Startwert** vor dem ersten
  Schlag; danach wird sie pro Schlag aus `arcHeight` abgeleitet
  (`gravityForFlight`), damit Bogenhöhe und Tempo unabhängig einstellbar sind.
- **Der gesamte prozedurale Zeichencode für Platz, Netz, Tribüne und
  Ballkinder ist toter Fallback.** Sobald ein Platzbild geladen ist, steigen
  `drawCourtSurface()`, `drawCourtLines()`, `drawNet()`, `drawCrowd()` und
  `drawStaff()` sofort aus. Er bleibt stehen, damit eine fehlende Bilddatei
  auf dem Show-Rechner kein schwarzes Bild ergibt.
- **`COURT_HEIGHT = 660` beeinflusst die Optik nicht mehr**, nur noch das
  Tempo. Die Vertikalabbildung hängt an `horizont` und `spanne`.
- **`BODY_PADDING` steht als gemessene Zahl im Code**, statt zur Laufzeit
  gemessen zu werden — `getImageData()` wirft bei `file://` einen
  SecurityError.
- **`roundRectPath()` von Hand statt `ctx.roundRect()`** — letzteres gibt es
  erst ab Chrome 99.
- **`warmupScore` wird gezählt, aber nirgends angezeigt** (ARENA-10). Absicht:
  der Zähler kostet nichts, ist geprüft und wäre die Stelle, an der eine
  Einspiel-Anzeige wieder anzusetzen hätte.
- **Die Klaviatur hängt am selben Aufruf wie die Bauchbinde**
  (`drawHud()` → `drawKeyboards()`) und wird vor dem frühen Ausstieg im
  Einspielen gezeichnet. Sieht nach einem Versehen aus, ist der Grund für zwei
  eigene Prüfungen: ein naives „im Einspielen nichts zeichnen" hätte die
  Tonhöhen-Rückmeldung stillschweigend mit entfernt.

### Wo ein Review vermutlich am meisten bringt

1. **Der `Renderer`** — rund 2900 Zeilen in einer Klasse, dazu etwa 80
   statische Konstanten, die über 500 Zeilen unter der Klasse verstreut sind.
   Hier ist am ehesten Struktur zu gewinnen, ohne Verhalten anzufassen.
2. **`Physics.update()`** — ein Schritt, in dem Zustandswechsel mitten im
   Ablauf passieren können (`awardPoint()`), weshalb der Zustand nach jedem
   Block neu gelesen wird. Fehleranfällig, aber empfindlich.
3. **Die Robustheit im Betrieb** — Punkt 3 bis 6 der technischen Schuld
   (Zustandsübergänge am Protokoll vorbei, kein `localStorage`, kein Umgang
   mit verschwindendem Gerät). Das ist der Bereich mit dem größten Risiko
   gemessen am Aufwand.
4. **Der Prüfstand selbst** — `test-browser.js` ist mit 43 KB die zweitgrößte
   Datei des Projekts und von Hand gegen das CDP geschrieben.

---

## 13. Bedienung

`arena.html` in Chrome öffnen.
Schritt 1 Modus → Schritt 2 Platz → Schritt 3 Mikrofon → Schritt 4 einsingen
(**singen, dann klicken** — der Ton liegt 2 s im Haltespeicher) → „Range
okay!" → „Einspielen starten" oder „Match starten".

| Taste | Wirkung |
|---|---|
| `Enter` + `Leertaste` | beendet das Einspielen, Match ab 0:0 |
| `Ctrl+Shift+U` | letzten Punkt zurücknehmen (nimmt auch den Platz zurück) |
| `Ctrl+Shift+X` | kompletter Reset auf 0:0 |
| `Ctrl+Shift+A` | **Aufschlag von Hand erzwingen** (Notausgang) |
| `Ctrl+Shift+M` | Messanzeige unten rechts ein/aus |
| `Ctrl+Shift+L` | Protokoll als Datei sichern |

**Der Schriftzug „AUFSCHLAG!" blendet nach 1,8 s aus — der Balken darunter
nicht.** Das ist Absicht: wer länger als zwei Sekunden sucht, braucht den
Meter, nicht die Aufforderung.

**Aufschlagen seit ARENA-14:** nicht mehr dorthin singen, wo der Ball hin
soll — der Ball fliegt zufällig. Verlangt wird die **Mitte der eigenen
Stimme**; der Balken unter „AUFSCHLAG!" zeigt sie durchgehend an, die Zone
leuchtet cyan, sobald der Ton darin liegt. Ist sie zu eng oder zu weit, ist
`Physics.AUFSCHLAG_MITTE_BREITE` der Regler — die gedrosselten
`AUFSCHLAG nicht zentriert`-Zeilen im Protokoll sind die Grundlage dafür.

`Alt+Shift` tut seit ARENA-12 **dasselbe** — beide Modifier gelten. Auf dem
Mac ist `Ctrl` der zuverlässige Weg: die Option-Taste ist dort für
Sonderzeichen belegt und wird je nach Layout vom System abgefangen. Auf
Windows sind beide gleichwertig.

In der Konsole: `window.KARAOKOVIC` — `.config` (alle Stellschrauben, ohne
Neuladen wirksam), `.protokoll()`, `.umfang()`, **`.audioNeustart()`**
(Signalkette neu aufbauen, Spielstand und Kalibrierung bleiben),
`.setzePlatz('SAND')`, `.grenzen`,
`.match.scoreLine()`.

Das **Protokoll** ist ein Ringspeicher im Arbeitsspeicher (2000 Zeilen),
bewusst kein `localStorage`. Aufgezeichnet werden Zustandswechsel, jeder
Rücksetzer der Ruhe-Uhr samt Pegel, Aufschläge, abgewiesene Aufschlagtöne und
Operator-Eingriffe — nicht jeder Frame.

Die Kürzel am Zeilenanfang, in der Reihenfolge, in der man sie nach einer
Session liest:

| Kürzel | Was dort steht |
|---|---|
| `AUDIO` | geöffneter Eingang: Name, Abtastrate, Kanalzahl, AGC/NS/EC |
| `DISPLAY` | gemessene Bildwiederholrate (nach ~2 s, einmalig) |
| `ASSET` | Bilddatei fehlt oder ist defekt — sonst still im Fallback. Seit ARENA-16 unterscheidet die Zeile „fehlt oder ist defekt" (Ausfall) von „noch nicht geliefert" (Terminstand, `AssetManager.OPTIONAL`) |
| `WARNUNG` | Ruhe seit 8 s nicht erreicht; Display über 75 Hz |
| `RUHE` | jeder Rücksetzer der Ruhe-Uhr samt Pegel und Grenze |
| `AUFSCHLAG` | ausgelöst (mit Pegel und Ton) oder wegen Tonhöhe abgewiesen |
| `ZUSTAND` | jeder Übergang der Zustandsmaschine |
| `MODUS` | gewählter Modus und ob als Einspielen oder Match gestartet wurde |
| `UMFANG` | benutzter Stimmumfang je Spieler, mit Tonnamen und Halbtönen |
| `PERF` | Spitzenlast von `analyse()` über 4 ms im 10-s-Fenster |
| `OPERATOR` | Eingriffe über die Hotkeys |
| `INFO` | Fenster wieder sichtbar, Fokus zurück, WakeLock aktiv |

Seit ARENA-13 melden zusätzlich `WARNUNG`-Zeilen die Fehlerklasse
„läuft lautlos falsch weiter": Frame-Lücke, verdecktes Fenster, verlorener
Tastaturfokus, eingefrorener oder beendeter Audioeingang, fehlgeschlagener
WakeLock. Der Ring rotiert dabei **hinter** den ersten 50 Zeilen — Boot und
Soundcheck stehen nach der Show noch da.

`AUDIO`, `DISPLAY`, `ASSET` und `PERF` sind seit ARENA-11 dabei — die ersten
drei stehen nach dem Start und beantworten die drei Fragen, die bisher nur
mündlich zu klären waren: Ist es der richtige Eingang? Läuft die Wand mit
60 Hz? Fehlt eine Datei? `MODUS` und `UMFANG` kamen mit ARENA-12 dazu und
beantworten die vierte: **mit welchem Stimmumfang lief die Session
eigentlich.** Genau die musste nach dem letzten Ausfall aus abgewiesenen
Aufschlägen zurückgerechnet werden.
