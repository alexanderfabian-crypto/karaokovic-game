/* =============================================================================
 * XPERION ARCADE — "KARAOKOVIC" / VOICE TENNIS
 * Version : V41  (Balltempo -20 %, staerkerer Gegner, Klaviatur nur noch
 *                 als leuchtende Taste, Gamification-Wort aus)
 * Build   : Single-File, kein ES6-Import, kein Bundler, kein Server.
 *           Startet offline per file:// (index.html -> <script src="app.js">).
 * Ziel    : Live-Bühne, Chrome Fullscreen, LED-Wand, 60 FPS, Segmentlänge <= 7 min
 *
 * -----------------------------------------------------------------------------
 * ARCHITEKTUR (Reihenfolge im File = Abhängigkeitsreihenfolge)
 *   1. CONFIG / FEATURES / Weltkonstanten
 *   2. Viewport      — Canvas-Größe, virtuelle Koordinaten -> Bildschirm
 *   3. Projection    — 2.5D-Projektion (ehem. to3D), Z-Skalierung
 *   4. AssetManager  — Bild-/Sprite-Registry inkl. Fallback-Logik
 *   5. AudioEngine   — Mikrofon, autoCorrelate (GESCHÜTZT), Pitch-Glättung
 *   6. MatchState    — Score, Sätze, Historie, State Machine, Timer
 *   7. Entities      — Ball, Paddle, BounceMarks, DvdLogo
 *   8. Physics       — Bewegung, Kollision, Tennisregeln (GESCHÜTZT)
 *   9. Renderer      — kompletter Zeichen-Pipeline in Layern
 *  10. InputHandler  — Operator-Hotkeys (GESCHÜTZT)
 *  11. Game          — Loop, Zustandsübergänge, Onboarding-Verdrahtung
 *
 * -----------------------------------------------------------------------------
 * GESCHÜTZTE LOGIK — NICHT VERÄNDERN (Bühnenfreigabe hängt daran):
 *   - AudioEngine.autoCorrelate()        : Mathematik 1:1 wie V36
 *     (Ausnahme: das Akzeptanzfenster steht jetzt in CONFIG.pitchFloor /
 *      CONFIG.pitchCeiling statt fest auf 60/500 Hz — die feste Obergrenze
 *      machte die Kalibrierung hoher Stimmen unmöglich. Die Korrelation
 *      selbst ist unverändert.)
 *   - MatchState.SILENCE_CHECK (3000 ms) : Timing & Reset-Verhalten wie V36
 *   - Physics: Aufsprung-/Aus-/Doppelaufsprung-Regeln wie V36
 *   - Physics.freqToQuantizedX()         : KEIN Clamping von `percentage` (Overdrive)
 *   - InputHandler: Alt+Shift+U / Alt+Shift+X
 * ========================================================================== */

(() => {
    'use strict';

    /* =========================================================================
     * 1. KONFIGURATION
     * ====================================================================== */

    /**
     * Laufzeit-Tuning. `minFreq`/`maxFreq` werden im Onboarding durch die
     * Kalibrierung überschrieben — deshalb bewusst kein `Object.freeze`.
     * @typedef  {Object} GameConfig
     * @property {number} minFreq      Kalibrierter tiefster Ton in Hz (= linker Rand)
     * @property {number} maxFreq      Kalibrierter höchster Ton in Hz (= rechter Rand)
     * @property {number} minFreq2     Dasselbe für Spieler 2 (nur im Versus-Modus)
     * @property {number} maxFreq2     Dasselbe für Spieler 2 (nur im Versus-Modus)
     * @property {number} volumeGate   RMS-Schwelle: darunter gilt "Stille"
     * @property {number} serveVolume  RMS-Schwelle für den Aufschlag
     * @property {number} baseSpeed    Grundgeschwindigkeit des Balls (px/Frame)
     * @property {number} maxSpeed     Maximalgeschwindigkeit bei voller Lautstärke
     * @property {number} lerpSpeed    Glättung der Spielerbewegung (0..1)
     * @property {number} pitchSmooth  Glättung der Tonhöhe (0..1)
     * @property {number} gravity      Fallbeschleunigung auf der Z-Achse (px/Frame²)
     */
    /** @type {GameConfig} */
    const CONFIG = {
        minFreq: 100,
        maxFreq: 300,

        /**
         * Stimmumfang von Spieler 2 (obere Figur), nur im Versus-Modus benutzt.
         *
         * BEWUSST EIN ZWEITES PAAR statt eines gemeinsamen Bereichs. Ein Bass
         * und ein Sopran auf einer gemeinsamen Skala hieße: einer von beiden
         * erreicht die Seitenlinien nie, der andere steht dauernd am Anschlag.
         * Jeder Spieler bekommt seinen eigenen Umfang, und beide bilden ihn
         * auf DIESELBE Feldbreite ab — die Steuerung fühlt sich dadurch für
         * beide gleich an, unabhängig von der Stimmlage.
         *
         * Im Arcade-Modus bleiben diese Werte unbenutzt; die KI hat keine
         * Stimme.
         */
        minFreq2: 100,
        maxFreq2: 300,

        /**
         * Gewählter Spielmodus (Wert aus MODE). Wird vor dem Onboarding
         * gesetzt und danach nicht mehr verändert. Default ist Arcade —
         * ohne Moduswahl verhält sich das Spiel wie bis V38.
         */
        mode: 'ARCADE',

        volumeGate: 0.02,

        /* ---------------------------------------------------------------------
         * Drei GETRENNTE Schwellen statt einer.
         *
         * Bisher hing alles an `volumeGate`: Tonerkennung, Bewegung, Aufschlag
         * und die 3-Sekunden-Stille. Das ist ein Zielkonflikt — die Stille
         * braucht eine HOHE Schwelle (sonst setzt jedes Raumgeräusch den
         * Countdown zurück), Erkennung und Aufschlag brauchen eine NIEDRIGE
         * (sonst muss man schreien).
         *
         * `volumeGate` bleibt deshalb unverändert bei 0.02 und bedient
         * weiterhin nur die Stille-Prüfung, die Freigabe der Aufschlagsperre
         * und die Schlagkraftkurve — an der eingespielten Bühnenabstimmung
         * ändert sich dort nichts.
         * ------------------------------------------------------------------ */

        /**
         * RMS-Schwelle der TONERKENNUNG. Darunter meldet autoCorrelate "kein
         * Ton". Bestimmt, wie leise man im Onboarding singen darf.
         * War an volumeGate gekoppelt (0.02) — ein gehauchter Kalibrierton
         * wurde damit gar nicht erst gemessen und der Knopf tat nichts.
         */
        pitchGate: 0.012,

        /**
         * RMS-Schwelle der BEWEGUNG. Darunter wird die geglättete Tonhöhe
         * nicht mehr nachgeführt, die Figur bleibt stehen.
         * Stand vorher als `volumeGate + 0.005` = 0.025 im Code — die höchste
         * aller Schwellen und der eigentliche Grund, warum sich anfangs nichts
         * bewegte.
         */
        moveGate: 0.015,

        /* War 0.04, dann 0.028 — beides musste zu laut angesetzt werden.
           0.022 liegt nur noch knapp über volumeGate: wer nach dem Countdown
           hörbar einsetzt, schlägt auf. Zusammen mit den auf 3 gesenkten
           SERVE_CHARGE_FRAMES ist der Aufschlag rund ein Fünftel leiser und
           halb so lang zu halten wie vorher. */
        serveVolume: 0.022,

        /* ---------------------------------------------------------------------
         * Ausreißerschutz der Tonhöhe (siehe updateSmoothedPitch).
         *
         * Die Autokorrelation verwechselt gelegentlich den Grundton mit seiner
         * Oktave — sie meldet für einen gehaltenen Ton plötzlich das Doppelte
         * oder die Hälfte. Weil die Tonhöhe direkt die Laufrichtung bestimmt,
         * schießt die Figur dann quer über den Platz, obwohl die Sängerin
         * denselben Ton hält. Genau der Befund "läuft manchmal in die falsche
         * Richtung".
         *
         * Seit CONFIG.pitchCeiling von 500 auf 1100 Hz steht, fällt eine
         * Oktavverwechslung nach oben nicht mehr aus dem Akzeptanzfenster —
         * vorher wurde sie stillschweigend verworfen.
         * ------------------------------------------------------------------ */

        /**
         * Wie weit ein Messwert von genau einer Oktave abweichen darf und noch
         * als Oktavverwechslung gilt (in Halbtönen).
         *
         * Nur DIESE Werte werden verworfen. Ein Sprung von neun oder fünfzehn
         * Halbtönen ist keine Verwechslung, sondern eine Sängerin, die springt
         * — der wird sofort gefolgt.
         */
        octaveTolerance: 1.5,

        /**
         * So viele Frames in Folge muss ein oktavverdächtiger Wert anliegen,
         * bevor er übernommen wird. 3 Frames = 50 ms: ein gewollter
         * Oktavsprung verzögert sich unmerklich, ein Messfehler fällt raus.
         */
        pitchJumpFrames: 3,

        /**
         * Ab wie vielen Halbtönen Abstand schneller nachgeführt wird.
         * Darunter zählt es als normales Singen, darüber als Sprung.
         */
        pitchJumpSemitones: 7,

        /**
         * Glättungsfaktor für große Sprünge. Nach drei Frames ist die Figur
         * zu 87 % am Ziel statt zu 39 % — sie folgt der Stimme sichtbar
         * sofort, ohne dass ein einzelner Ausreißer voll durchschlägt.
         */
        pitchSmoothFast: 0.5,
        /**
         * Ballgeschwindigkeit in px/Frame.
         *
         * Wegmarken: 4.5 / 10.0 ursprünglich, dann auf 3.4 / 7.2 gebremst
         * (zu langsam, Ballwechsel im Median 15 s), zurück auf 4.5 / 10.0
         * (zu schnell), jetzt 20 % darunter.
         *
         * Die Bogenhöhe hängt NICHT mehr an der Geschwindigkeit: sie wird pro
         * Schlag aus der gewünschten Scheitelhöhe abgeleitet (siehe
         * Physics.gravityForFlight). Diese beiden Werte lassen sich deshalb
         * frei verstellen, ohne dass der Ball aus dem Bild fliegt.
         *
         * ACHTUNG SENDEPLATZ: langsamer heißt längere Ballwechsel. Zusammen
         * mit `Physics.OPPONENT_MISS_CHANCE` bestimmt das, wie viele Punkte in
         * sieben Minuten fallen — test-ballwechsel.js prüft die Untergrenze.
         */
        baseSpeed: 3.6,
        maxSpeed: 8.0,
        /**
         * ENTFÄLLT als Bewegungsregler — siehe CONFIG.glideFrames.
         *
         * Der Wert steht nur noch als Bezugsgröße im Code: mit ihm legte die
         * Figur im ERSTEN Frame nach einem Tonwechsel 15 % der Strecke zurück,
         * also bis zu 90 px. Genau dieser Sprung von null auf volle
         * Geschwindigkeit ließ die Steuerung abgehackt wirken.
         */
        lerpSpeed: 0.15,

        /**
         * Dauer, in der die Figur eine neue Zielposition erreicht (in Frames).
         *
         * Ersetzt den einfachen Lerp durch eine kritisch gedämpfte Annäherung:
         * die Figur beschleunigt und bremst wieder ab, statt im ersten Frame
         * auf Höchstgeschwindigkeit zu springen. Sie hat damit eine Trägheit,
         * und genau die macht aus einem Sprung ein Gleiten — auch dann, wenn
         * die Töne abgehackt eingesungen werden und die Zielposition
         * schlagartig wechselt.
         *
         * Kleiner = direkter und härter, größer = weicher und träger.
         * 12 Frames sind rund 0.2 s.
         */
        glideFrames: 12,

        /**
         * Glättung der Tonhöhe (0..1). Größer = die Zielposition folgt der
         * Stimme direkter.
         *
         * War 0.15. Gemessen wurde der Zielkonflikt am echten Code: eine
         * Stimme springt von 280 Hz auf 120 Hz, danach wird gezählt, wie weit
         * die Figur noch in die ALTE Richtung läuft, bevor sie umkehrt.
         *
         *   pitchSmooth | Fehlweg | Zappeln bei Vibrato (±0.7 Halbton, 5.5 Hz)
         *   0.15        | 50.0 px | 1.1 px
         *   0.25        | 49.5 px | 1.7 px
         *   0.35        | 21.8 px | 2.3 px   <- hier
         *   0.50        | 21.0 px | 3.0 px
         *
         * 0.25 bringt praktisch nichts, weil die Zielposition erst einen Frame
         * später umkehrt als bei 0.35. Über 0.35 wird es nur noch nervöser,
         * ohne den Fehlweg weiter zu senken.
         *
         * Der Fehlweg entsteht NICHT hier allein: die Bewegung ist über
         * `glideFrames` ein zweites Mal gedämpft (siehe glideToTarget). Zwei
         * Verzögerungen hintereinander waren die Ursache der Meldung
         * "die Spielerin läuft in die falsche Richtung" — sie tritt
         * ausschließlich kurz nach einem Richtungswechsel auf, nie beim
         * gleichmäßigen Singen.
         */
        pitchSmooth: 0.35,
        /* War 0.25. Die Scheitelhöhe eines Schlages ergibt sich in dieser
           Physik zu etwa g·T²/8, wobei T die Flugzeit in Frames ist. Mit den
           langsameren Ballgeschwindigkeiten (T ≈ 145 Frames) ergab 0.25 eine
           Scheitelhöhe von 655 px bei 900 px Bildhöhe — der Ball verschwand
           oben aus dem Bild. 0.042 liefert bei gleicher Flugzeit rund 110 px.
           MERKE: gravity, baseSpeed und maxSpeed hängen zusammen. Wird der
           Ball wieder schneller gemacht (kleineres T), muss gravity STEIGEN,
           sonst wird der Bogen zu flach. Faustformel: g ≈ 8 · Wunschhöhe / T². */
        gravity: 0.042,

        /**
         * Gewünschte Scheitelhöhe eines Schlages in virtuellen Pixeln.
         *
         * Diese Größe ist der eigentliche Regler für die Ballflugbahn. Die
         * Gravitation wird pro Schlag daraus ABGELEITET (siehe
         * Physics.gravityForFlight), damit Bogenhöhe und Geschwindigkeit
         * unabhängig voneinander eingestellt werden können. Vorher hingen
         * beide zusammen: den Ball langsamer zu machen erzeugte automatisch
         * Mondbälle, weil die Steighöhe mit dem Quadrat der Flugzeit wuchs.
         * `gravity` oben dient nur noch als Startwert vor dem ersten Schlag.
         */
        arcHeight: 105,

        /* ---------------------------------------------------------------------
         * Tonhöhen-Fenster der Erkennung.
         *
         * Vorher standen 60 und 500 Hz fest in autoCorrelate(). Die Obergrenze
         * war der Grund, warum die Kalibrierung scheiterte: ein gemütlicher
         * HOHER Ton einer Frauenstimme liegt oft bei 450–650 Hz. Alles über
         * 500 Hz wurde verworfen, livePitch blieb 0 — und der Knopf "Hohen Ton
         * speichern" tat schlicht nichts, ohne jede Rückmeldung.
         *
         * Die Autokorrelation selbst ist unverändert; nur das Fenster, in dem
         * ihr Ergebnis akzeptiert wird, ist jetzt weit genug für echte Stimmen.
         * ------------------------------------------------------------------ */
        pitchFloor: 60,
        pitchCeiling: 1100,

        /**
         * Grenzfrequenz des Vorfilters während der Kalibrierung.
         *
         * Im Spiel wird der Filter aus dem kalibrierten Bereich abgeleitet
         * (siehe AudioEngine.applyCalibratedFilter). Für die Kalibrierung
         * selbst muss er weit offen sein, sonst dämpft er genau den hohen Ton
         * weg, den die Sängerin gerade speichern will.
         */
        filterCalibrationHz: 900,

        /**
         * Wie lange ein erkannter Ton nach dem Verstummen noch als "gerade
         * gesungen" gilt (Millisekunden).
         *
         * Ohne diesen Haltespeicher fiel livePitch in dem Moment auf 0, in dem
         * die Sängerin Luft holte — also genau dann, wenn sie den Knopf drückt.
         * Der Klick lief ins Leere und das Onboarding war blockiert.
         */
        pitchHoldMs: 2000
    };

    /**
     * Schalter für Verhalten, das sich gegenüber V36 unterscheiden KÖNNTE.
     * Alle Defaults sind so gesetzt, dass V37 sich wie V36 verhält —
     * mit einer bewusst dokumentierten Ausnahme: LEGACY_OVERLAY_LAYOUT.
     * @readonly
     */
    const FEATURES = {
        /**
         * false = Overlay-Texte (Countdown, vertikale Wörter) werden korrekt
         *         zentriert. true = exakt der V36-Zustand (auf jeder Auflösung
         *         != 1600x900 sichtbar nach rechts verschoben).
         * Siehe REVIEW-Befund #2.
         */
        LEGACY_OVERLAY_LAYOUT: false,

        /* HINWEIS: Der Schalter RULES_JUDGE_BY_FIRST_BOUNCE ist entfallen.
           Sein "false"-Pfad (V36: Punkt anhand der Ballposition beim Verlassen
           des Feldrechtecks) war die Ursache dafür, dass ein gültig
           aufgesprungener Ball Sekundenbruchteile später mitten im Feld als
           Punkt gewertet wurde, sobald er in der Luft die Seitenlinie
           überflog. Ein Rollback-Schalter auf ein defektes Verhalten hat
           keinen Nutzen. Die Regeln stehen jetzt an einer Stelle:
           Physics.update(), Block "Urteil am Aufsprung". */

        /**
         * true = getUserMedia ohne AGC/Noise Suppression/Echo Cancellation.
         * Pflicht für einen Dante-Clean-Feed, weil AGC sowohl das Volume-Gate
         * als auch die Schlagkraft verfälscht. Siehe REVIEW-Befund #3.
         * ACHTUNG: nach dem Umstellen einmal neu einpegeln.
         */
        RAW_AUDIO_CONSTRAINTS: true,

        /**
         * true = Physik läuft in festen 1/60-Schritten, unabhängig von der
         * Bildwiederholrate. Notnagel, falls die LED-Wand Chrome zu 120 Hz
         * zwingt (sonst läuft das Spiel doppelt so schnell).
         * Default false = bit-identisch zu V36.
         */
        FIXED_TIMESTEP: false,

        /**
         * true = das Gamification-Wort (BALL, NETZ, PUNKT, ...) wird gezeigt:
         * senkrecht links neben dem Platz während der Ruhe-Phase und
         * umherfliegend im Bumper zwischen den Punkten.
         *
         * Auf false gestellt, weil es die Aufmerksamkeit vom Tennis wegzieht.
         * Die Mechanik dahinter (Wortliste, Weiterschalten, Undo-Historie)
         * bleibt vollständig erhalten — das Wort wird nur nicht mehr
         * gezeichnet. Zum Zurückholen genügt dieser Schalter.
         */
        SHOW_GAMIFICATION_WORD: false
    };

    /** Interne Auflösung, auf die alle Weltkoordinaten bezogen sind. */
    const VIRTUAL_WIDTH = 1600;
    const VIRTUAL_HEIGHT = 900;

    /* -------------------------------------------------------------------------
     * KAMERAMODELL — echte Bodenebenen-Perspektive
     *
     * Die drei Konstanten unten beschreiben EINE Lochkamera, die schräg von
     * oben auf den Platz sieht. Sie sind aus `Vorgabe_Platz.png` gemessen und
     * nicht frei wählbar: sie müssen dieses Bild treffen, sonst liegen die
     * unsichtbaren Spielfeldgrenzen neben den aufgemalten Linien.
     *
     * Messung (Bild 1372x768, umgerechnet auf virtuelle 1600x900):
     *   hintere Grundlinie   Bild-y 183 -> 214.5   Feldbreite 510.8
     *   vordere Grundlinie   Bild-y 598 -> 701.4   Feldbreite 1012.2
     *
     * PROBE, dass es eine echte Perspektive ist: bei einer Bodenebene muss die
     * Breite exakt linear mit dem Abstand zum Fluchtpunkt wachsen. Über vier
     * sauber messbare Bildzeilen (186 / 300 / 446 / 594) stimmt das auf den
     * Pixel genau — Abweichung 0. Als unabhängige Gegenprobe fallen die beiden
     * Aufschlaglinien damit auf dy = -0.5357 und +0.5363, also symmetrisch und
     * auf dem regelkonformen Wert 0.2692 der Feldlänge. Das Bild ist eine
     * korrekt gerechnete Kamera, kein stilisierter Fake.
     *
     * KORREKTUR EINER FRÜHEREN MESSUNG: Hier stand zwischenzeitlich 0.08 mit
     * der Begründung, das Breitenverhältnis der Vorlage betrage 1.16. Das war
     * falsch — die 1.16 stammten aus zwei beliebigen Bildzeilen statt aus den
     * Grundlinien. An den Grundlinien gemessen beträgt es 1.98.
     * ---------------------------------------------------------------------- */

    /**
     * Projektiver Tiefenparameter k der Kamera.
     *
     * `scale3D = 1 / (1 - dy·k)` mit dy = -1 an der hinteren, +1 an der
     * vorderen Grundlinie. Das Breitenverhältnis vorn/hinten ist (1+k)/(1-k);
     * die gemessenen 1.9817 ergeben k = 0.3292.
     *
     * ACHTUNG: einzige Quelle der Tiefenwirkung. Physics.BASELINE_SCALE3D ist
     * daraus ABGELEITET, nicht abgeschrieben.
     */
    const DEPTH_STRENGTH = 0.3292;

    /**
     * Bildschirm-y des Fluchtpunkts in virtuellen Pixeln.
     *
     * Liegt über dem Bildrand (negativ) — die Kamera sieht steil genug nach
     * unten, dass der Horizont außerhalb des Bildes bleibt.
     */
    const HORIZON_Y = -281.5;

    /**
     * Abstand der Netzlinie vom Fluchtpunkt in virtuellen Pixeln.
     *
     * Zusammen mit HORIZON_Y die gesamte Vertikalabbildung:
     *   py = HORIZON_Y + DEPTH_SPAN · scale3D
     * Dass Bildschirm-y eine LINEARE Funktion des Tiefenfaktors ist, ist genau
     * die definierende Eigenschaft einer Bodenebenen-Projektion — beides
     * hängt an 1/Tiefe. Der frühere Term `(1 + dy·0.1)` war ein Polynom und
     * konnte das nicht leisten: er staucht die hintere Hälfte zu schwach,
     * weshalb das hintere Aufschlagfeld tiefer wirkte als das vordere.
     */
    const DEPTH_SPAN = 659.3;

    /**
     * Untergrenze des Nenners `1 - dy·k`.
     *
     * Hinter der vorderen Grundlinie wird der Nenner klein und bei dy = 3.04
     * null — dort kippt die Projektion ins Unendliche und danach ins Negative.
     * Genau dorthin fliegt der Ball, wenn er nach einem Punkt aus dem Bild
     * segelt (die Physik läuft während POINT_SCORED weiter). Das ist derselbe
     * Absturzweg, der am 10.08. die requestAnimationFrame-Kette beendet hat:
     * ein negativer Radius in ctx.ellipse() wirft einen IndexSizeError.
     * 0.25 deckelt scale3D bei 4 und py bei rund 2360 — längst außerhalb des
     * Bildes, aber endlich und positiv.
     */
    const DEPTH_MIN_DENOM = 0.25;

    /**
     * Zusätzliche Dämpfung der Perspektive für Spielerfiguren.
     *
     * Stammt aus der Zeit von DEPTH_STRENGTH = 0.35, als zwischen hinterer und
     * vorderer Spielerin Faktor 2.1 lag und die hintere optisch verschwand.
     * Bei der jetzt flachen Projektion ist der Unterschied ohnehin klein
     * (Faktor 1.17); der Wert bleibt als Feinregler stehen.
     *   1.0 = volle Perspektive, 0.0 = alle Figuren gleich groß.
     */
    const FIGURE_DEPTH_COMPRESSION = 0.42;

    /**
     * Zielrahmen für Foto-Köpfe in virtuellen Pixeln.
     *
     * Köpfe werden per "contain" in diese Box eingepasst (Seitenverhältnis
     * bleibt erhalten, das Bild füllt die Box maximal aus, ohne sie zu
     * verlassen). Wichtig, weil die gelieferten Ausschnitte unterschiedliche
     * Formate haben — ein reines Skalieren über die Bildhöhe lässt
     * Querformat-Crops gigantisch werden.
     */
    const HEAD_BOX = { width: 72, height: 76 };

    /**
     * Höhe der Schulterlinie, als Anteil der Körperhöhe über dem Boden.
     *
     * Der Foto-Kopf ERSETZT den gezeichneten Kopf der Spielfigur, er sitzt
     * nicht obendrauf. Deshalb wird seine Unterkante auf die Schulter gesetzt,
     * sodass er den ursprünglichen Kopf verdeckt. Vorher lag die Unterkante
     * am Scheitel der Figur — der gezeichnete Kopf blieb darunter sichtbar und
     * das Foto schwebte darüber.
     * 0.72 = Schulter auf 72 % der Körperhöhe. Sitzt der Kopf zu hoch, Wert
     * verkleinern; überdeckt er zu viel vom Oberkörper, vergrößern.
     */
    const SHOULDER_RATIO = 0.72;

    /* -------------------------------------------------------------------------
     * Feldmaße in der 2D-Physik-Logik (vor der 2.5D-Projektion)
     *
     * COURT_WIDTH bestimmt die Optik MIT: die Feldbreite auf dem Schirm ist
     * COURT_WIDTH · scale3D, und scale3D ist am Netz genau 1. Aus der Vorlage
     * folgt damit zwingend 679 — dann trifft die Physikgrenze die aufgemalte
     * Linie auf beiden Grundlinien pixelgenau (510.8 hinten, 1012.2 vorn).
     *
     * COURT_HEIGHT bestimmt die Optik dagegen NICHT MEHR. Seit die
     * Vertikalabbildung über HORIZON_Y und DEPTH_SPAN verankert ist, legt sie
     * nur noch fest, wie viel Weltstrecke der Ball von Grundlinie zu
     * Grundlinie zurücklegt — also das Tempo. 660 bleibt deshalb stehen: jede
     * Änderung würde die eingespielten Werte für baseSpeed, maxSpeed und
     * arcHeight verstellen, ohne am Bild etwas zu ändern.
     * ---------------------------------------------------------------------- */
    const COURT_WIDTH = 679;
    const COURT_HEIGHT = 660;
    const COURT_LEFT = (VIRTUAL_WIDTH - COURT_WIDTH) / 2;
    const COURT_RIGHT = COURT_LEFT + COURT_WIDTH;
    const COURT_TOP = (VIRTUAL_HEIGHT - COURT_HEIGHT) / 2 + 50;
    const COURT_BOTTOM = COURT_TOP + COURT_HEIGHT;
    const COURT_MID_Y = COURT_TOP + COURT_HEIGHT / 2;
    /**
     * Breite der Doppelgasse.
     *
     * In der Vorlage messen die Gassen 12.4 % und 12.6 % der Feldbreite (der
     * regelkonforme Wert ist 12.5 %). Bei COURT_WIDTH = 679 sind das 85 px.
     * Vorher standen hier 75 bei 700 Breite, also 10.7 % — die unsichtbare
     * Einzelfeldgrenze lag damit gut 10 px INNERHALB der aufgemalten
     * Einzellinie, und ein Ball konnte auf der Linie aufspringen und trotzdem
     * als "aus" gewertet werden.
     */
    const ALLEY_WIDTH = 85;

    /** Maße des (unsichtbaren) Schlägerbereichs beider Spieler. */
    const PADDLE = { width: 150, height: 30, hitPadding: 25, screenMargin: 20 };

    /** Dauer der Zustände in Millisekunden. GESCHÜTZT. */
    const TIMING = {
        SILENCE_MS: 3000,   // absolute Ruhe vor dem Aufschlag
        POINT_MS: 3000,     // Jubel-/Punkteanzeige
        TRANSITION_MS: 3000 // Karaokovic-Bumper + DVD-Wort
    };

    /** Gültige Zustände der State Machine. @enum {string} */
    const STATE = {
        SILENCE_CHECK: 'SILENCE_CHECK',
        SERVE_WAIT: 'SERVE_WAIT',
        PLAYING: 'PLAYING',
        POINT_SCORED: 'POINT_SCORED',
        TRANSITION: 'TRANSITION'
    };

    /** Spieler-IDs. @enum {string} */
    const PLAYER = { ANDREA: 'andrea', ALEX: 'alex' };

    /**
     * Spielmodus. @enum {string}
     *
     * `ARCADE`  — untere Figur wird gesungen, obere ist die KI (Stand bis V38).
     * `VERSUS`  — beide Figuren werden gesungen, je ein Mikrofon pro Spieler.
     *
     * Der Modus wird VOR dem Onboarding gewählt, weil er den gesamten weiteren
     * Ablauf bestimmt: im Versus-Modus wird das Mikrofon zweikanalig geöffnet
     * und zweimal kalibriert. Nachträglich umschalten geht deshalb nicht ohne
     * Neuladen — die Signalkette steht dann bereits.
     */
    const MODE = { ARCADE: 'ARCADE', VERSUS: 'VERSUS' };

    /**
     * Spielabschnitt — Einspielen oder Match. @enum {string}
     *
     * BEWUSST NEBEN `STATE`, NICHT DARIN. Angefragt war ein `STATE.WARMUP`,
     * das geht aber nicht: `STATE` ist die Zustandsmaschine EINES Ballwechsels
     * (Ruhe -> Aufschlag -> Spiel -> Punkt -> Bumper), und im Einspielen soll
     * genau dieser Zyklus ja weiterlaufen. Als Wert innerhalb von `STATE`
     * müsste er den kompletten Zyklus ein zweites Mal enthalten.
     *
     * `phase` liegt deshalb quer dazu: die Zustandsmaschine läuft unverändert,
     * die Phase entscheidet nur, ob ein Ballwechsel gezählt wird.
     */
    const PHASE = { WARMUP: 'WARMUP', MATCH: 'MATCH' };

    /** Wörter für die Gamification-Einblendung zwischen den Punkten. */
    const GAMIFICATION_WORDS = ['BALL', 'NETZ', 'PUNKT', 'SPIEL', 'SCHLAG'];

    /**
     * Farbwechsel des Bumper-Wortes (90er-Arcade-Look).
     *
     * Bewusst nur knallige Vollfarben und ein HARTER Wechsel im festen Takt
     * (siehe Renderer.WORD_COLOR_MS) — kein Verlauf. Ein weicher Übergang
     * liest sich auf der LED-Wand als Fehler im Signal, der harte Schnitt als
     * Absicht.
     */
    const RETRO_WORD_COLORS = ['#ff00ff', '#00ffcc', '#ffff00', '#66ff00'];

    /**
     * Farbpaletten pro Satz (Court-Wechsel als visuelle Satzanzeige).
     *
     * `outer` ist der Außenbereich (das gesamte Bild), `inner` das blaue
     * Spielfeld innerhalb der äußeren Linien. Der Belag ist ab jetzt in allen
     * drei Sätzen derselbe Hardcourt — der frühere Wechsel Gras/Sand/Hardcourt
     * ist entfallen, weil er den Platz dreimal völlig neu aussehen ließ.
     *
     * Satz 1 sind die aus `Vorgabe_Platz.png` gemessenen Werte (Median über
     * je vier Bildregionen: Außen #5e7855/#5f7956/#5f7a56/#5f7c56,
     * Innen #4d6189/#4e618a/#4d6089/#4d5f88). Satz 2 und 3 sind derselbe
     * Platz bei sinkendem Licht: 90 % bzw. 80 % Helligkeit mit leichtem
     * Blaustich, wie ihn Flutlicht erzeugt.
     */
    const COURT_PALETTES = [
        { outer: '#5f7a56', inner: '#4d6089' }, // Satz 1: Mittagslicht (gemessen)
        { outer: '#566e4d', inner: '#45567f' }, // Satz 2: Nachmittag
        { outer: '#4c624b', inner: '#3e4d7c' }  // Satz 3: Flutlicht
    ];

    /**
     * Linienfarbe.
     *
     * Kein reines Weiß: in der Vorlage messen die Linien #ebf1f0, #e2e7e3 und
     * #dddedc — ein leicht abgetöntes Weiß. Reines #ffffff wirkt auf der
     * LED-Wand gegenüber dem gedämpften Blau wie ein Fremdkörper.
     */
    const LINE_COLOR = '#e4e9e4';
    const ACCENT_PINK = '#ff007f';
    const ACCENT_CYAN = '#00ffcc';
    const ACCENT_YELLOW = '#ffff00';
    const ACCENT_PURPLE = '#aa00ff';

    /* =========================================================================
     * 2. VIEWPORT — virtuelle Koordinaten -> Bildschirmkoordinaten
     * ====================================================================== */

    /**
     * @typedef  {Object} ScreenPoint
     * @property {number} x        Bildschirm-X in Canvas-Pixeln
     * @property {number} y        Bildschirm-Y in Canvas-Pixeln
     * @property {number} scale    Globaler Letterbox-Faktor
     * @property {number} scale3D  Faktor inkl. Tiefenskalierung (nur aus Projection)
     */

    /**
     * Hält die Canvas-Größe und rechnet virtuelle 1600x900-Koordinaten auf den
     * tatsächlichen Canvas um (Letterboxing, Seitenverhältnis bleibt erhalten).
     *
     * Optimierung ggü. V36: `scale` und die Offsets werden nur bei `resize()`
     * berechnet, nicht mehr bei jedem der ~80 Aufrufe pro Frame.
     */
    class Viewport {
        /** @param {HTMLCanvasElement} canvas */
        constructor(canvas) {
            /** @type {HTMLCanvasElement} */
            this.canvas = canvas;
            /** @type {number} Letterbox-Skalierung */
            this.scale = 1;
            /** @type {number} */
            this.offsetX = 0;
            /** @type {number} */
            this.offsetY = 0;
            /** Wiederverwendetes Ergebnisobjekt — vermeidet Allokationen im Hot Path. */
            this._out = { x: 0, y: 0, scale: 1, scale3D: 1 };
        }

        /** Canvas an das Fenster anpassen und Skalierung neu berechnen. */
        resize() {
            this.canvas.width = window.innerWidth;
            this.canvas.height = window.innerHeight;
            this.scale = Math.min(
                this.canvas.width / VIRTUAL_WIDTH,
                this.canvas.height / VIRTUAL_HEIGHT
            );
            this.offsetX = (this.canvas.width - VIRTUAL_WIDTH * this.scale) / 2;
            this.offsetY = (this.canvas.height - VIRTUAL_HEIGHT * this.scale) / 2;
        }

        /**
         * Virtuelle Koordinate -> Bildschirmkoordinate.
         * @param   {number} vx
         * @param   {number} vy
         * @param   {ScreenPoint} [out] Optionales Zielobjekt (kein GC-Druck).
         * @returns {ScreenPoint}
         */
        toScreen(vx, vy, out) {
            const t = out || this._out;
            t.x = this.offsetX + vx * this.scale;
            t.y = this.offsetY + vy * this.scale;
            t.scale = this.scale;
            t.scale3D = this.scale;
            return t;
        }

        /** @returns {number} Canvasbreite in Pixeln. */
        get width() { return this.canvas.width; }
        /** @returns {number} Canvashöhe in Pixeln. */
        get height() { return this.canvas.height; }
    }

    /* =========================================================================
     * 3. PROJECTION — 2.5D (Pseudo-3D wie "Super Tennis", SNES 1991)
     * ====================================================================== */

    /**
     * Kapselt die komplette 2.5D-Mathematik (ehemals `to3D`). Diese Projektion
     * ist der Kern des Retro-Looks: Objekte weiter unten im Bild sind größer,
     * die Grundlinie unten ist breiter als die obere.
     *
     * Für den späteren Sprite-Austausch ist ausschließlich `scale3D` relevant:
     * jedes Pixel-Art-Sprite wird damit multipliziert und behält so automatisch
     * die korrekte Tiefenwirkung.
     */
    class Projection {
        /** @param {Viewport} viewport */
        constructor(viewport) {
            /** @type {Viewport} */
            this.viewport = viewport;
            /* Scratch-Objekte für verschachtelte Aufrufe (z. B. Linien mit 2 Punkten). */
            this._a = { x: 0, y: 0, scale: 1, scale3D: 1 };
            this._b = { x: 0, y: 0, scale: 1, scale3D: 1 };
            this._c = { x: 0, y: 0, scale: 1, scale3D: 1 };
        }

        /**
         * Weltkoordinate (x, y, z) -> Bildschirmpunkt inkl. Tiefenfaktor.
         * Mathematisch identisch zu `to3D()` aus V36.
         *
         * @param   {number} x  Weltkoordinate quer zum Feld
         * @param   {number} y  Weltkoordinate längs zum Feld (klein = hinten)
         * @param   {number} [z=0] Höhe über dem Boden
         * @param   {ScreenPoint} [out] Zielobjekt; ohne Angabe wird Scratch A benutzt.
         * @returns {ScreenPoint}
         */
        project(x, y, z, out) {
            const cx = VIRTUAL_WIDTH / 2;
            const dy = (y - COURT_MID_Y) / (COURT_HEIGHT / 2);

            /* Perspektivische Division. Der Nenner ist der Kameraabstand in
               normierten Einheiten; sein Kehrwert ist die Vergrößerung.
               Die Klemmung verhindert den Vorzeichenwechsel hinter der
               vorderen Grundlinie — siehe DEPTH_MIN_DENOM. */
            const denom = Math.max(DEPTH_MIN_DENOM, 1.0 - dy * DEPTH_STRENGTH);
            const scale3D = 1 / denom;

            /* Quer und längs folgen DEMSELBEN Faktor — das ist der Kern einer
               Bodenebenen-Perspektive und der Grund, warum beide Aufschlag-
               felder jetzt von selbst korrekt gestaucht erscheinen. */
            const px = cx + (x - cx) * scale3D;
            let py = HORIZON_Y + DEPTH_SPAN * scale3D;
            py -= (z || 0) * scale3D;

            const t = this.viewport.toScreen(px, py, out || this._a);
            t.scale3D = scale3D * t.scale;
            return t;
        }

        /** @returns {ScreenPoint} Scratch-Slot A (kurzlebig!). */
        get scratchA() { return this._a; }
        /** @returns {ScreenPoint} Scratch-Slot B (kurzlebig!). */
        get scratchB() { return this._b; }
        /** @returns {ScreenPoint} Scratch-Slot C (kurzlebig!). */
        get scratchC() { return this._c; }
    }

    /* =========================================================================
     * 4. ASSET MANAGER
     * ====================================================================== */

    /**
     * Zentrale Bild-Registry.
     *
     * SPRITE-MIGRATION (nächste Iteration, Ziel: SNES-"Super Tennis"-Look):
     * Es genügt, in `MANIFEST` die entsprechende Datei einzutragen. Der Renderer
     * fragt vor jeder prozeduralen Zeichenroutine `assets.isReady(key)` ab und
     * benutzt automatisch das Sprite, sobald es geladen ist. Es muss KEINE
     * Zeichenlogik gelöscht werden — die Canvas-Primitive bleiben als Fallback
     * stehen, falls eine Datei auf dem Show-Rechner fehlt.
     */
    class AssetManager {
        constructor() {
            /**
             * Schlüssel -> Dateiname. Ein leerer String bedeutet:
             * "Slot vorhanden, Sprite noch nicht geliefert -> prozedural zeichnen".
             * @type {Object<string,string>}
             */
            this.MANIFEST = {
                /* --- aktuell benutzte Foto-Assets --------------------------- */
                head_andrea_neutral: 'Andrea_Kopf_neutral.png',
                head_andrea_win: 'Andrea_Kopf_froh.png',
                /* Lag als .jpg im Manifest, auf der Platte liegt .png — die
                   Verlierer-Gesichter wurden deshalb nie geladen und still auf
                   'neutral' zurückgefallen. */
                head_andrea_lose: 'Andrea_Kopf_ernst.png',
                head_alex_neutral: 'Alex_Kopf_neutral.png',
                head_alex_win: 'Alex_Kopf_froh.png',
                head_alex_lose: 'Alex_Kopf_ernst.png',
                body_andrea: 'Beispiel Spieler unten.png',
                body_alex: 'Beispiel Spieler oben.png',

                /* --- Slots für die Pixel-Art-Iteration ---------------------- */
                /* Vollflächiger 1600x900-Hintergrund des kompletten Platzes
                   inkl. Tribünen, Schiedsrichterstuhl und Bank. Sobald hier
                   ein Dateiname steht, schaltet der Renderer das Paradigma um:
                   Hintergrund, Platzfläche und Publikum werden nicht mehr
                   gezeichnet, sondern kommen aus diesem Bild.
                   Siehe Renderer.hasCourtBackdrop(). */
                court_surface: 'Vorgabe_Platz.png',
                court_lines: '',    // ersetzt draw3DLine-Feldlinien (optional)
                crowd: '',          // ersetzt die gezeichnete Tribüne
                net: '',            // ersetzt das gezeichnete Netz
                ballboy: '',        // ersetzt die gezeichneten Ballkinder
                ball: '',           // ersetzt den gefüllten Kreis
                bounce_mark: ''     // ersetzt die Aufsprung-Ellipse
            };

            /** @type {Object<string, HTMLImageElement>} */
            this.images = {};
            /** @type {string[]} Dateien, die nicht geladen werden konnten. */
            this.failed = [];
        }

        /** Startet das Laden aller im Manifest eingetragenen Dateien. */
        loadAll() {
            for (const key in this.MANIFEST) {
                const src = this.MANIFEST[key];
                if (!src) continue;
                const img = new Image();
                img.onerror = () => {
                    this.failed.push(src);
                    console.warn(`[AssetManager] Datei fehlt oder ist defekt: ${src}`);
                };
                img.src = src;
                this.images[key] = img;
            }
        }

        /**
         * @param   {string} key
         * @returns {boolean} true, wenn das Bild vollständig und zeichenbar ist.
         */
        isReady(key) {
            const img = this.images[key];
            return !!img && img.complete && img.naturalHeight > 0;
        }

        /**
         * @param   {string} key
         * @returns {HTMLImageElement|null}
         */
        get(key) {
            return this.images[key] || null;
        }
    }

    /* =========================================================================
     * 5. AUDIO ENGINE
     * ====================================================================== */

    /**
     * Mikrofon-Eingang, Tonhöhen- und Lautstärkeerkennung.
     *
     * Signalkette: Dante Virtual Soundcard (Clean Feed / Mix-Minus)
     *   -> getUserMedia -> MediaStreamSource -> BiquadFilter (Lowpass)
     *   -> AnalyserNode (fftSize 2048) -> autoCorrelate()
     *
     * Die Grenzfrequenz des Lowpass ist nicht mehr fest: während der
     * Kalibrierung offen (CONFIG.filterCalibrationHz), im Spiel abgeleitet aus
     * dem gemessenen Stimmumfang (applyCalibratedFilter).
     */
    class AudioEngine {
        constructor() {
            /** @type {AudioContext|null} */
            this.audioCtx = null;
            /** @type {AnalyserNode|null} */
            this.analyser = null;
            /** @type {BiquadFilterNode|null} */
            this.biquadFilter = null;
            /** @type {Float32Array|null} Zeitbereichsdaten, einmal allokiert. */
            this.dataArray = null;

            /** @type {number} RMS des aktuellen Frames (0..~1). */
            this.currentVolume = 0;
            /** @type {number} Roh-Tonhöhe in Hz, 0 wenn nichts erkannt. */
            this.livePitch = 0;
            /** @type {number} Geglättete Tonhöhe in Hz, -1 = noch kein Wert. */
            this.smoothedPitch = -1;
            /**
             * @type {number} Frames in Folge, in denen ein verdächtig großer
             * Tonhöhensprung anlag. Siehe updateSmoothedPitch().
             */
            this._jumpFrames = 0;

            /**
             * @type {number} Zuletzt sicher erkannte Tonhöhe in Hz (0 = noch keine).
             * Wird NICHT gelöscht, wenn der Ton aufhört — siehe `stablePitch`.
             */
            this.heldPitch = 0;
            /** @type {number} Zeitpunkt (ms) von `heldPitch`. */
            this.heldPitchAt = 0;

            /** Wiederverwendetes Rückgabeobjekt — kein GC im Hot Path. */
            this._result = { freq: -1, volume: 0 };
            /**
             * Korrelationspuffer. V36 allokierte hier pro Frame ein neues Array
             * (`new Array(SIZE).fill(0)`) plus einen `buf.slice()`. Beides
             * entfällt; die Rechenschritte selbst sind unverändert.
             * Float64Array, weil das der Genauigkeit eines JS-Arrays entspricht.
             * @type {Float64Array|null}
             */
            this._corr = null;
        }

        /**
         * Mikrofon anfordern und Audiograph aufbauen.
         * @param   {MediaTrackConstraints|boolean} [constraints]
         * @returns {Promise<void>}
         */
        async init(constraints) {
            const audioConstraints = constraints !== undefined
                ? constraints
                : AudioEngine.constraintsFor(1);

            const stream = await navigator.mediaDevices.getUserMedia({ audio: audioConstraints });

            this.audioCtx = new AudioContext();
            this.attachTo(this.audioCtx, this.audioCtx.createMediaStreamSource(stream));

            if (this.audioCtx.state === 'suspended') await this.audioCtx.resume();
        }

        /**
         * Filter und Analyser an einen bereits bestehenden Knoten hängen.
         *
         * Herausgezogen aus `init()`, damit zwei Instanzen an EINEM Eingang
         * hängen können — im Versus-Modus an je einem Kanal desselben
         * Mikrofonsignals. Der Mono-Pfad geht durch dieselbe Methode und ist
         * dadurch nachweislich identisch zu vorher.
         *
         * @param {AudioContext} ctx
         * @param {AudioNode}    node    Quelle (MediaStreamSource oder Splitter)
         * @param {number}       [channel] Ausgangsindex an `node`; ohne Angabe
         *                                 der einzige Ausgang.
         */
        attachTo(ctx, node, channel) {
            this.audioCtx = ctx;

            this.biquadFilter = ctx.createBiquadFilter();
            this.biquadFilter.type = 'lowpass';
            /* Während der Kalibrierung weit offen — ein 320-Hz-Tiefpass dämpft
               einen hohen Kalibrierton bei 550 Hz auf 38 % und schiebt ihn
               damit unter das Volume-Gate. Nach der Kalibrierung wird die
               Grenzfrequenz aus dem gemessenen Stimmumfang gesetzt. */
            this.biquadFilter.frequency.value = CONFIG.filterCalibrationHz;
            this.biquadFilter.Q.value = 1;

            this.analyser = ctx.createAnalyser();
            this.analyser.fftSize = 2048;

            if (channel === undefined) node.connect(this.biquadFilter);
            else node.connect(this.biquadFilter, channel);
            this.biquadFilter.connect(this.analyser);

            this.dataArray = new Float32Array(this.analyser.fftSize);
            this._corr = new Float64Array(this.analyser.fftSize + 1);
        }

        /**
         * Beide Eingänge für den Versus-Modus öffnen.
         *
         * EIN Mikrofongerät, zwei Kanäle: so liefert die Dante Virtual
         * Soundcard die beiden Clean-Feeds. Ein `getUserMedia` pro Spieler
         * ginge nicht — der Browser kennt nur Geräte, keine Einzelkanäle.
         *
         * ACHTUNG BÜHNE: Liefert das Gerät nur einen Kanal, bekommt Spieler 2
         * Stille und seine Figur steht. Deshalb wird die tatsächliche
         * Kanalzahl zurückgegeben und vom Aufrufer geprüft — ein stiller
         * zweiter Kanal sieht sonst aus wie ein kaputtes Spiel.
         *
         * @param   {AudioEngine} eins Spieler 1 (untere Figur), Kanal 0
         * @param   {AudioEngine} zwei Spieler 2 (obere Figur), Kanal 1
         * @returns {Promise<number>} Tatsächliche Kanalzahl der Spur.
         */
        static async initPair(eins, zwei) {
            const stream = await navigator.mediaDevices.getUserMedia({
                audio: AudioEngine.constraintsFor(2)
            });

            const ctx = new AudioContext();
            const source = ctx.createMediaStreamSource(stream);
            const splitter = ctx.createChannelSplitter(2);
            source.connect(splitter);

            eins.attachTo(ctx, splitter, 0);
            zwei.attachTo(ctx, splitter, 1);

            if (ctx.state === 'suspended') await ctx.resume();

            const settings = stream.getAudioTracks()[0].getSettings();
            return settings.channelCount || 1;
        }

        /**
         * Aufnahme-Constraints für `kanaele` Kanäle.
         * @param   {number} kanaele
         * @returns {MediaTrackConstraints|boolean}
         */
        static constraintsFor(kanaele) {
            if (!FEATURES.RAW_AUDIO_CONSTRAINTS) return true;
            return {
                /* Dante-Clean-Feed: Chrome darf das Signal NICHT anfassen.
                   AGC würde die Lautstärke normalisieren und damit sowohl das
                   Volume-Gate als auch die Schlagkraft zerstören.
                   Zusätzlich im Versus-Modus entscheidend: Echo Cancellation
                   und Noise Suppression zwingen Chrome zu einem Mono-Downmix —
                   damit lägen beide Stimmen auf beiden Kanälen. */
                echoCancellation: false,
                noiseSuppression: false,
                autoGainControl: false,
                channelCount: kanaele
            };
        }

        /**
         * Grenzfrequenz des Vorfilters aus dem kalibrierten Stimmumfang setzen.
         *
         * Der Filter soll Störgeräusche und Obertöne dämpfen, aber niemals den
         * höchsten Ton, den die Sängerin bewusst eingemessen hat. Der Faktor
         * 1.6 lässt Grundton und Overdrive-Reserve durch und schneidet erst
         * darüber weg. Die Untergrenze ist der bisherige Bühnenwert von 320 Hz:
         * bis zu einem hohen Kalibrierton von 200 Hz filtert das Spiel exakt
         * wie bisher, darüber öffnet der Filter proportional mit.
         *
         * ACHTUNG BÜHNE: ein weiter geöffneter Filter lässt mehr Raumgeräusch
         * durch und hebt damit den RMS. Nach einer Kalibrierung deutlich über
         * 200 Hz `volumeGate` und `serveVolume` einmal gegenprüfen.
         */
        applyCalibratedFilter(player) {
            if (!this.biquadFilter) return;
            const cutoff = Math.max(320,
                Math.min(4000, Physics.voiceRange(player).max * 1.6));
            this.biquadFilter.frequency.value = cutoff;
            console.info(`[AudioEngine] Vorfilter auf ${Math.round(cutoff)} Hz gesetzt.`);
        }

        /**
         * Zuletzt erkannte Tonhöhe, solange sie nicht älter als
         * `CONFIG.pitchHoldMs` ist.
         *
         * Gedacht für das Onboarding: dort wird gesungen und ERST DANN geklickt.
         * `livePitch` ist in diesem Moment längst 0.
         * @returns {number} Hz, oder 0 wenn zu lange nichts erkannt wurde.
         */
        get stablePitch() {
            if (this.livePitch > 0) return this.livePitch;
            if (this.heldPitch > 0 && Date.now() - this.heldPitchAt <= CONFIG.pitchHoldMs) {
                return this.heldPitch;
            }
            return 0;
        }

        /**
         * Ein Frame analysieren.
         * @returns {{freq:number, volume:number}} freq = -1, wenn kein Ton erkannt.
         */
        analyse() {
            this.analyser.getFloatTimeDomainData(this.dataArray);
            return this.autoCorrelate(this.dataArray, this.audioCtx.sampleRate);
        }

        /**
         * ### GESCHÜTZT — Mathematik 1:1 aus V36 ###
         *
         * Autokorrelation zur Grundtonbestimmung. Die einzigen Änderungen sind
         * speicherseitig und rechnerisch neutral:
         *   - `buf.slice(r1, r2)` ersetzt durch einen Index-Offset auf denselben
         *     Puffer (identische Werte, identische Reihenfolge).
         *   - Korrelationsarray wird wiederverwendet statt neu allokiert. Die
         *     Position hinter dem Nutzbereich wird auf NaN gesetzt, damit die
         *     `while (c[d] > c[d + 1])`-Schleife exakt dort abbricht, wo sie in
         *     V36 auf `undefined` traf.
         *
         * @param   {Float32Array} buf
         * @param   {number} sampleRate
         * @returns {{freq:number, volume:number}}
         */
        autoCorrelate(buf, sampleRate) {
            let SIZE = buf.length;
            let rms = 0;
            for (let i = 0; i < SIZE; i++) rms += buf[i] * buf[i];
            rms = Math.sqrt(rms / SIZE);
            this.currentVolume = rms;

            /* Schwelle kommt aus CONFIG.pitchGate statt aus volumeGate (siehe
               dort). `currentVolume` wird oben bereits gesetzt und ist davon
               unberührt — Stille-Prüfung und Schlagkraft rechnen weiter mit
               dem Rohwert. Die Korrelation darunter ist unverändert. */
            if (rms < CONFIG.pitchGate) {
                this.livePitch = 0;
                this._result.freq = -1;
                this._result.volume = rms;
                return this._result;
            }

            let r1 = 0, r2 = SIZE - 1;
            const thres = 0.2;
            for (let i = 0; i < SIZE / 2; i++) if (Math.abs(buf[i]) < thres) { r1 = i; break; }
            for (let i = 1; i < SIZE / 2; i++) if (Math.abs(buf[SIZE - i]) < thres) { r2 = SIZE - i; break; }

            const offset = r1;
            SIZE = r2 - r1; // entspricht buf.slice(r1, r2).length

            const c = this._corr;
            for (let i = 0; i < SIZE; i++) {
                let sum = 0;
                for (let j = 0; j < SIZE - i; j++) sum += buf[offset + j] * buf[offset + j + i];
                c[i] = sum;
            }
            c[SIZE] = NaN; // Sentinel: reproduziert das `undefined` von V36

            let d = 0;
            while (c[d] > c[d + 1]) d++;

            let maxval = -1, maxpos = -1;
            for (let i = d; i < SIZE; i++) if (c[i] > maxval) { maxval = c[i]; maxpos = i; }

            const freq = sampleRate / maxpos;

            /* Fenster kommt jetzt aus CONFIG (vorher fest 60 / 500 Hz) — die
               Rechnung darüber ist unverändert. Siehe CONFIG.pitchCeiling. */
            if (freq > CONFIG.pitchCeiling || freq < CONFIG.pitchFloor) {
                this.livePitch = 0;
                this._result.freq = -1;
                this._result.volume = rms;
                return this._result;
            }

            this.livePitch = freq;
            this.heldPitch = freq;
            this.heldPitchAt = Date.now();
            this._result.freq = freq;
            this._result.volume = rms;
            return this._result;
        }

        /**
         * Exponentielle Glättung der Tonhöhe, mit Ausreißerschutz.
         *
         * Der Schutz ist der Grund, warum die Figur nicht mehr grundlos quer
         * über den Platz läuft. Die Autokorrelation verwechselt gelegentlich
         * den Grundton mit seiner Oktave; weil die Tonhöhe unmittelbar die
         * Laufrichtung bestimmt, wird aus einem Messfehler von einem Frame ein
         * sichtbarer Sprint in die falsche Richtung.
         *
         * Ein Sprung über `CONFIG.pitchJumpSemitones` wird deshalb erst
         * übernommen, wenn er `CONFIG.pitchJumpFrames` Frames lang anliegt.
         * Gewollte Sprünge verzögern sich dadurch um 50 ms, einzelne
         * Fehlmessungen fallen ganz heraus.
         *
         * Bewusst NICHT in autoCorrelate() eingebaut: die Korrelation bleibt
         * unangetastet, gefiltert wird erst ihr Ergebnis.
         *
         * @param {number} rawFreq Rohwert aus autoCorrelate (-1 = kein Ton)
         * @param {number} volume  RMS des Frames
         */
        updateSmoothedPitch(rawFreq, volume) {
            if (rawFreq === -1 || volume <= CONFIG.moveGate) return;

            if (this.smoothedPitch === -1) {
                this.smoothedPitch = rawFreq;
                this._jumpFrames = 0;
                return;
            }

            const semitones = 12 * Math.log2(rawFreq / this.smoothedPitch);
            const distance = Math.abs(semitones);

            /* --- Oktavfalle -----------------------------------------------
             * Verworfen wird NUR, was nach einer Oktavverwechslung aussieht:
             * ziemlich genau das Doppelte oder die Hälfte. Alles andere wird
             * sofort übernommen.
             *
             * Vorher stand hier "jeder Sprung über 7 Halbtöne ist verdächtig".
             * Das war zu grob und der Grund, warum die Figur bei einem echten
             * Sprung in die alte Richtung weiterlief: der Zähler brauchte drei
             * Frames IN FOLGE, und schon ein einziger Zwischenwert innerhalb
             * der 7 Halbtöne setzte ihn wieder auf null. Bei einer Stimme, die
             * über mehrere Frames in den Zielton hineingleitet, kam er nie an —
             * die Klaviatur zeigte den hohen Ton, `smoothedPitch` blieb unten.
             * -------------------------------------------------------------- */
            const looksLikeOctave =
                Math.abs(distance - 12) <= CONFIG.octaveTolerance;
            if (looksLikeOctave) {
                this._jumpFrames++;
                if (this._jumpFrames < CONFIG.pitchJumpFrames) return;
            }
            this._jumpFrames = 0;

            /* Große, aber unverdächtige Sprünge werden schnell nachgeführt.
               Mit der normalen Glättung bräuchte ein Oktavsprung über eine
               halbe Sekunde, bis die Figur ankommt — sie liefe sichtbar
               hinterher, statt der Stimme zu folgen. */
            const factor = distance > CONFIG.pitchJumpSemitones
                ? CONFIG.pitchSmoothFast
                : CONFIG.pitchSmooth;
            this.smoothedPitch += (rawFreq - this.smoothedPitch) * factor;
        }

        /** Glättungszustand zurücksetzen (z. B. beim Aufschlagaufbau). */
        resetSmoothing() {
            this.smoothedPitch = -1;
            this._jumpFrames = 0;
        }
    }

    /* =========================================================================
     * 6. MATCH STATE — Punkte, Sätze, Historie, State Machine
     * ====================================================================== */

    /**
     * Alles, was den Spielstand und den Ablauf betrifft, an genau einer Stelle.
     * Ersetzt die verstreuten Globals aus V36 (`score`, `sets`, `scoreHistory`,
     * `gameState`, `stateTimer`, `silenceTimerStart`, `lastWinner`, ...).
     */
    class MatchState {
        constructor() {
            /** @type {{andrea:number, alex:number}} Punkte im aktuellen Spiel. */
            this.score = { andrea: 0, alex: 0 };
            /** @type {{andrea:number, alex:number}} Gewonnene Sätze. */
            this.sets = { andrea: 0, alex: 0 };
            /**
             * Undo-Historie. Bewusst ein einfaches Array: das Segment dauert
             * maximal 7 Minuten, ein Ringpuffer wäre unnötige Komplexität.
             * @type {Array<{score:Object, sets:Object, currentWordIndex:number}>}
             */
            this.history = [];
            /** @type {string} Aktueller Zustand, siehe STATE. */
            this.state = STATE.SILENCE_CHECK;
            /** @type {number} Startzeitpunkt des aktuellen Zustands (ms). */
            this.stateTimer = 0;
            /** @type {number} Referenzzeit der 3-Sekunden-Stille (ms). */
            this.silenceTimerStart = 0;
            /** @type {string} Gewinner des letzten Punktes. */
            this.lastWinner = '';
            /** @type {boolean} Merker, damit prepareServe pro Transition nur 1x läuft. */
            this.transitionResetDone = false;
            /** @type {number} Index in GAMIFICATION_WORDS. */
            this.currentWordIndex = 0;
            /**
             * @type {string} Wer aufschlägt (PLAYER.*).
             *
             * Wechselt nach jedem gewonnenen Spiel, also genau dann, wenn die
             * Punkte auf 0 zurückfallen. Bestimmt zugleich die Reihenfolge in
             * scoreLine() — im Tennis wird der Stand immer aus Sicht des
             * Aufschlägers angesagt.
             */
            this.server = PLAYER.ANDREA;
            /**
             * @type {string} Wert aus PHASE. Das Spiel startet im Einspielen;
             * die Regie schaltet per Enter+Leertaste auf Match.
             */
            this.phase = PHASE.WARMUP;
        }

        /** @returns {boolean} true, solange nur eingespielt wird. */
        get isWarmup() { return this.phase === PHASE.WARMUP; }

        /**
         * Vom Einspielen ins Match wechseln (Regie-Trigger).
         *
         * Setzt den Stand hart auf 0:0 und beginnt einen sauberen Ballwechsel.
         * Was im Einspielen passiert ist, zählt nicht — auch nicht in der
         * Undo-Historie.
         */
        startMatch() {
            this.phase = PHASE.MATCH;
            this.score = { andrea: 0, alex: 0 };
            this.sets = { andrea: 0, alex: 0 };
            this.history.length = 0;
            this.server = PLAYER.ANDREA;
            this.lastWinner = '';
        }

        /**
         * Zustand wechseln und den zugehörigen Timer stellen.
         * @param {string} next Wert aus STATE.
         */
        setState(next) {
            this.state = next;
            this.stateTimer = Date.now();
        }

        /**
         * Millisekunden seit Beginn des aktuellen Zustands.
         * @returns {number}
         */
        elapsed() { return Date.now() - this.stateTimer; }

        /**
         * ### GESCHÜTZT — 3-Sekunden-Stille ###
         * Setzt die Stille-Referenzzeit zurück (jedes Geräusch über dem Gate).
         */
        resetSilenceTimer() { this.silenceTimerStart = Date.now(); }

        /**
         * @returns {boolean} true, wenn 3000 ms ununterbrochene Ruhe erreicht sind.
         */
        isSilenceComplete() {
            return Date.now() - this.silenceTimerStart >= TIMING.SILENCE_MS;
        }

        /**
         * Verbleibende Sekunden für die Countdown-Anzeige (mindestens 1).
         * @returns {number}
         */
        silenceCountdown() {
            const left = TIMING.SILENCE_MS - (Date.now() - this.silenceTimerStart);
            return Math.max(1, Math.ceil(left / 1000));
        }

        /** Aktuellen Stand für Undo sichern. */
        pushHistory() {
            this.history.push({
                score: { andrea: this.score.andrea, alex: this.score.alex },
                sets: { andrea: this.sets.andrea, alex: this.sets.alex },
                currentWordIndex: this.currentWordIndex,
                /* Muss mit: wird der Punkt zurückgenommen, der ein Spiel
                   entschieden hat, gehört auch das Aufschlagrecht zurück. */
                server: this.server
            });
        }

        /** Aufschlagrecht an die andere Seite geben. */
        switchServer() {
            this.server = (this.server === PLAYER.ANDREA) ? PLAYER.ALEX : PLAYER.ANDREA;
        }

        /**
         * Punkt vergeben, Satz auswerten, Zustand auf POINT_SCORED setzen.
         * @param {string} winner Wert aus PLAYER.
         */
        awardPoint(winner) {
            /* Einspielen: der Ballwechsel endet, aber nichts wird gezählt.
               Kein pushHistory, kein Satz, kein Aufschlagwechsel — sonst
               stünde beim Anpfiff ein Stand in der Historie, den es nie gab.
               Der Zyklus läuft weiter wie im Match, damit die Abläufe auf der
               Bühne dieselben sind. */
            if (this.isWarmup) {
                this.lastWinner = winner;
                this.setState(STATE.POINT_SCORED);
                return;
            }

            this.pushHistory();
            this.lastWinner = winner;

            if (winner === PLAYER.ANDREA) this.score.andrea++;
            else this.score.alex++;

            if (this.score.andrea >= 4 && this.score.andrea - this.score.alex >= 2) {
                this.sets.andrea++;
                this.score.andrea = 0; this.score.alex = 0;
                this.switchServer();
            } else if (this.score.alex >= 4 && this.score.alex - this.score.andrea >= 2) {
                this.sets.alex++;
                this.score.andrea = 0; this.score.alex = 0;
                this.switchServer();
            }

            this.currentWordIndex = (this.currentWordIndex + 1) % GAMIFICATION_WORDS.length;
            this.setState(STATE.POINT_SCORED);
        }

        /**
         * Letzten Punkt zurücknehmen (Operator-Hotkey Alt+Shift+U).
         * @returns {boolean} true, wenn etwas zurückgenommen wurde.
         */
        undo() {
            if (this.history.length === 0) return false;
            const last = this.history.pop();
            this.score = last.score;
            this.sets = last.sets;
            this.currentWordIndex = last.currentWordIndex;
            this.server = last.server;
            return true;
        }

        /** Kompletter Reset auf 0:0 (Operator-Hotkey Alt+Shift+X). */
        hardReset() {
            this.score = { andrea: 0, alex: 0 };
            this.sets = { andrea: 0, alex: 0 };
            this.history.length = 0;
            this.currentWordIndex = 0;
            this.server = PLAYER.ANDREA;
        }

        /**
         * Punktestand eines Spielers in Tennis-Schreibweise.
         * @param   {number} p1 Punkte des betrachteten Spielers
         * @param   {number} p2 Punkte des Gegners
         * @returns {string} "0" | "15" | "30" | "40" | "ADV" | "DEUCE"
         */
        static tennisScore(p1, p2) {
            if (p1 >= 3 && p2 >= 3) {
                if (p1 === p2) return 'DEUCE';
                if (p1 > p2) return 'ADV';
                return '40';
            }
            return ['0', '15', '30', '40'][p1] || '40';
        }

        /**
         * Zeile für die Großanzeige, IMMER aus Sicht des Aufschlägers: sein
         * Stand steht links. So wird im Tennis angesagt ("30 - 15" heißt
         * 30 für den Aufschläger), und nur so passt die Zeile zum Ball-Symbol
         * im Scoreboard.
         * @returns {string}
         */
        scoreLine() {
            const a = MatchState.tennisScore(this.score.andrea, this.score.alex);
            const al = MatchState.tennisScore(this.score.alex, this.score.andrea);
            if (a === 'DEUCE' && al === 'DEUCE') return 'DEUCE';
            return this.server === PLAYER.ANDREA ? `${a} - ${al}` : `${al} - ${a}`;
        }

        /**
         * Aktive Farbpalette, abhängig von der Zahl der gespielten Sätze.
         * @returns {{outer:string, inner:string}}
         */
        courtPalette() {
            const played = this.sets.andrea + this.sets.alex;
            return COURT_PALETTES[Math.min(played, COURT_PALETTES.length - 1)];
        }

        /** @returns {string} Aktuelles Gamification-Wort. */
        currentWord() { return GAMIFICATION_WORDS[this.currentWordIndex]; }
    }

    /* =========================================================================
     * 7. ENTITIES
     * ====================================================================== */

    /** Der Ball in Weltkoordinaten. Wird einmal erzeugt und nie ersetzt. */
    class Ball {
        constructor() {
            this.x = 0; this.y = 0; this.z = 0;
            this.vx = 0; this.vy = 0; this.vz = 0;
            this.radius = 12;
            /** @type {number} Aufsprünge seit dem letzten Schlag. */
            this.bounces = 0;
            /** @type {string} Wer zuletzt geschlagen hat (PLAYER.*). */
            this.lastHitter = PLAYER.ANDREA;
            /** @type {boolean} Reserviert für den Smash-Look (rot statt gelb). */
            this.isSmash = false;
            /**
             * @type {number} Für DIESEN Schlag gültige Gravitation. Wird bei
             * jedem Schlag neu aus der gewünschten Bogenhöhe abgeleitet.
             */
            this.gravity = CONFIG.gravity;
            /** @type {boolean} Lag der erste Aufsprung im Feld? (nur für Regel-Fix) */
            this.firstBounceInside = true;
        }
    }

    /** Schlagfläche eines Spielers. Die Breite ist zugleich die Trefferzone. */
    class Paddle {
        /** @param {number} y Feste Y-Position (Grundlinie). */
        constructor(y) {
            this.x = VIRTUAL_WIDTH / 2;
            this.y = y;
            this.width = PADDLE.width;
            this.height = PADDLE.height;
        }
    }

    /**
     * Aufsprungmarken auf dem Platz.
     *
     * Bewusst schlicht gehalten (Vorgabe: max. 7 Minuten Spielzeit). Statt
     * `splice()` wird per Swap-Remove entfernt — gleiche Optik, aber kein
     * Umkopieren des Arrays. Zusätzlich eine harte Obergrenze als Sicherheitsnetz.
     */
    class BounceMarks {
        constructor() {
            /** @type {Array<{x:number,y:number,alpha:number}>} */
            this.items = [];
            /** @type {number} */
            this.max = 64;
        }

        /**
         * @param {number} x
         * @param {number} y
         */
        add(x, y) {
            if (this.items.length >= this.max) this.items.shift();
            this.items.push({ x, y, alpha: 0.8 });
        }

        /**
         * Ausblenden. Wird bewusst NACH dem Zeichnen aufgerufen, exakt wie in
         * V36 (dort steckte die Alpha-Reduktion im Zeichencode).
         */
        fade() {
            for (let i = this.items.length - 1; i >= 0; i--) {
                const m = this.items[i];
                m.alpha -= 0.02;
                if (m.alpha <= 0) {
                    this.items[i] = this.items[this.items.length - 1];
                    this.items.pop();
                }
            }
        }

        /** Alle Marken löschen (beim Aufschlagaufbau). */
        clear() { this.items.length = 0; }
    }

    /** Das im Bumper umherfliegende Gamification-Wort ("DVD-Logo"). */
    class DvdLogo {
        constructor() { this.reset(); }

        /** Zurück in die Bildmitte, feste Startgeschwindigkeit. */
        reset() {
            this.x = VIRTUAL_WIDTH / 2;
            this.y = VIRTUAL_HEIGHT / 2;
            this.vx = 6;
            this.vy = 4;
        }

        /** Ein Bewegungsschritt inkl. Abprallen an den Bildrändern. */
        update() {
            this.x += this.vx;
            this.y += this.vy;
            const w = 200, h = 50;
            if (this.x < w || this.x > VIRTUAL_WIDTH - w) this.vx *= -1;
            if (this.y < h || this.y > VIRTUAL_HEIGHT - h) this.vy *= -1;
        }
    }

    /* =========================================================================
     * 8. PHYSICS — Bewegung, Kollision, Tennisregeln
     * ====================================================================== */

    /**
     * Die gesamte Spiellogik. Frame-basiert (ein Aufruf = ein 60-Hz-Schritt),
     * exakt wie V36. Es gibt bewusst KEIN Delta-Time-Scaling, weil das die
     * eingespielten Geschwindigkeiten verändern würde.
     */
    class Physics {
        /**
         * @param {MatchState}  match
         * @param {Ball}        ball
         * @param {Paddle}      paddleAndrea
         * @param {Paddle}      paddleAlex
         * @param {BounceMarks} bounceMarks
         * @param {AudioEngine} audio  Eingang Spieler 1 (untere Figur)
         * @param {AudioEngine} [audio2] Eingang Spieler 2 (obere Figur, Versus)
         */
        constructor(match, ball, paddleAndrea, paddleAlex, bounceMarks, audio, audio2) {
            this.match = match;
            this.ball = ball;
            this.paddleAndrea = paddleAndrea;
            this.paddleAlex = paddleAlex;
            this.bounceMarks = bounceMarks;
            this.audio = audio;
            /** @type {AudioEngine|null} Nur im Versus-Modus verkabelt. */
            this.audio2 = audio2 || null;

            /** @type {number} Gefilterte Ziel-X-Position von Andrea. */
            this.targetX = VIRTUAL_WIDTH / 2;
            /** @type {number} Tatsächliche X-Position von Andrea (geglättet). */
            this.currentX = VIRTUAL_WIDTH / 2;
            /**
             * @type {number} `currentX` aus dem VORIGEN Frame.
             *
             * Grundlage der mitwandernden Trefferzone (siehe update()). Muss
             * über Frames hinweg gehalten werden: Andreas Position wird in
             * Game.step() gesetzt, also bevor update() überhaupt läuft — zu
             * Beginn von update() ist `currentX` bereits der neue Wert.
             */
            this.prevCurrentX = VIRTUAL_WIDTH / 2;
            /**
             * @type {number} Aktuelle Seitwärtsgeschwindigkeit von Andrea in
             * px/Frame. Zustand der gedämpften Annäherung — siehe glideToTarget().
             * Muss überall dort auf 0, wo `currentX` hart gesetzt wird, sonst
             * schießt die Figur mit alter Geschwindigkeit weiter.
             */
            this.velocityX = 0;

            /**
             * @type {number} Ziel-X der OBEREN Figur im Versus-Modus.
             * Im Arcade-Modus unbenutzt — dort schiebt die KI `paddleAlex.x`
             * direkt, ohne Ziel und ohne Geschwindigkeit.
             */
            this.alexTargetX = VIRTUAL_WIDTH / 2;
            /** @type {number} Geschwindigkeit der oberen Figur (Versus-Modus). */
            this.alexVelocityX = 0;

            /** @type {boolean} KI-Merker: verfehlt Alex den nächsten Ball absichtlich? */
            this.pcWillMiss = false;
            /** @type {number} Aufgeladene Frames über der Aufschlagschwelle. */
            this.serveCharge = 0;

            /**
             * @type {boolean} Sperrt die Seitwärtsbewegung nach dem Aufschlag.
             *
             * Der Aufschlag wird durch den GESUNGENEN Ton ausgelöst — im Moment
             * des Schlages singt die Spielerin also noch. Ohne Sperre wandert
             * ihre Figur sofort dorthin, wo dieser Ton hinzeigt, und rennt
             * damit dem eigenen Aufschlag hinterher.
             *
             * Gesetzt wird die Sperre in triggerServe(), gelöst erst, wenn der
             * Ton aufhört (Volume unter dem Gate) — siehe Game.step(),
             * case STATE.PLAYING. Effekt auf der Bühne: aufschlagen, Luft
             * holen, dann erst laufen.
             */
            this.serveMovementLock = false;
            /** @type {number} Schläge von Andrea im laufenden Ballwechsel. */
            this.rallyShots = 0;

            /** @type {number} Fester Zielpunkt beim absichtlichen Fehler. */
            this.missTargetX = VIRTUAL_WIDTH / 2;
            /** @type {number} Reaktionsverzögerung in Frames vor dem Losgehen. */
            this.missDelay = 0;
            /** @type {number} Frames seit der Fehlentscheidung. */
            this.missFrames = 0;
        }

        /**
         * ### GESCHÜTZT — Overdrive-Bewegung ###
         *
         * Rechnet eine Frequenz auf eine X-Position um.
         *
         * Der kalibrierte Stimmumfang bildet EXAKT auf das Feld ab: tiefster
         * Ton = linke Außenlinie, höchster Ton = rechte Außenlinie. Damit ist
         * die Steuerung erklärbar, ohne dass jemand ein Wort verliert.
         *
         * `percentage` wird weiterhin NICHT auf 0..1 begrenzt (geschützt):
         * singt eine Spielerin über ihren kalibrierten Bereich hinaus, zieht
         * die Rechnung weiter nach außen. Begrenzt wird erst das ERGEBNIS, und
         * zwar an der äußeren Seitenlinie — die Figur bleibt dort stehen,
         * statt wie früher bis an den Bildschirmrand weiterzulaufen.
         *
         * Der Zielbereich lief vorher bis zur Gassenmitte, also eine halbe
         * Gassenbreite ÜBER die Außenlinie hinaus. Zusammen mit der neuen
         * Grenze wären die äußersten 42 px des Stimmumfangs tot gewesen: oben
         * und unten hätte sich nichts mehr bewegt. Deshalb spannt die Abbildung
         * jetzt genau von Linie zu Linie.
         *
         * @param   {number} freq Tonhöhe in Hz
         * @param   {string} [player] Wert aus PLAYER; ohne Angabe Andrea.
         * @returns {number} X-Position in Weltkoordinaten
         */
        freqToQuantizedX(freq, player) {
            const range = Physics.voiceRange(player);
            const minMidi = 12 * Math.log2(range.min / 440) + 69;
            const maxMidi = 12 * Math.log2(range.max / 440) + 69;
            const midiNote = 12 * Math.log2(freq / 440) + 69;

            const percentage = (midiNote - minMidi) / (maxMidi - minMidi);
            const target = COURT_LEFT + percentage * COURT_WIDTH;

            return Math.max(
                Physics.PLAYER_MIN_X,
                Math.min(Physics.PLAYER_MAX_X, target)
            );
        }

        /** Ball und Spieler für den nächsten Aufschlag vorbereiten. */
        prepareServe() {
            this.haltAt();
            /* Mit zurücksetzen, sonst spannt die Trefferzone im ersten Frame
               nach dem Sprung in die Feldmitte über das halbe Feld. */
            this.prevCurrentX = VIRTUAL_WIDTH / 2;
            /* Auch die obere Figur mit Geschwindigkeit auf null — im Duell
               trägt sie sonst ihren Schwung in den nächsten Aufschlag. */
            this.haltAlexAt();
            this.audio.resetSmoothing();
            if (this.audio2) this.audio2.resetSmoothing();

            const b = this.ball;
            b.x = this.currentX;
            b.y = this.serveRestY();
            b.z = 25;
            b.vx = 0; b.vy = 0; b.vz = 0;
            b.bounces = 0;
            b.lastHitter = this.match.server;
            b.isSmash = false;
            b.firstBounceInside = true;

            this.pcWillMiss = false;
            this.serveCharge = 0;
            /* Sicherheitsnetz: ein neuer Ballwechsel beginnt nie gesperrt.
               Gesetzt wird die Sperre ausschließlich beim Aufschlag selbst. */
            this.serveMovementLock = false;
            this.bounceMarks.clear();
        }

        /**
         * Kritisch gedämpfte Annäherung von `currentX` an `targetX`.
         *
         * Ersetzt `currentX += (targetX - currentX) * lerpSpeed`. Der
         * Unterschied ist die Geschwindigkeit als eigener Zustand: beim Lerp
         * ist sie proportional zur Restdistanz und springt deshalb im ersten
         * Frame nach einem Tonwechsel von 0 auf bis zu 90 px/Frame — das ist
         * das Abgehackte. Hier wird die Geschwindigkeit aufgebaut und wieder
         * abgebaut, die Figur gleitet an.
         *
         * "Kritisch gedämpft" heißt: schnellstmöglich am Ziel, aber ohne
         * Überschwingen. Für eine Spielfigur, die einer Stimme folgt, ist ein
         * Nachfedern unbrauchbar — sie stünde am Ende neben dem Ball.
         *
         * Verfahren nach Game Programming Gems 4 (Kapitel 1.10), dieselbe
         * Näherung, die Unity als SmoothDamp benutzt. Der Zeitschritt ist fest
         * ein Frame, passend zur übrigen Physik.
         */
        glideToTarget() {
            const r = Physics.glideStep(this.currentX, this.targetX, this.velocityX);
            this.currentX = r.x;
            this.velocityX = r.v;
        }

        /**
         * Dasselbe für die obere Figur (Versus-Modus).
         *
         * Sie benutzt bewusst DIESELBE Bewegungsroutine wie die untere. Zwei
         * unterschiedlich gedämpfte Figuren würden sich beim Zuschauen sofort
         * verraten, und der Vergleich zwischen den Spielern wäre unfair.
         */
        glideAlexToTarget() {
            const r = Physics.glideStep(
                this.paddleAlex.x, this.alexTargetX, this.alexVelocityX);
            this.paddleAlex.x = r.x;
            this.alexVelocityX = r.v;
        }

        /**
         * Obere Figur hart anhalten — Gegenstück zu `haltAt()`.
         * @param {number} [x] Zielposition, Default Bildmitte
         */
        haltAlexAt(x) {
            const px = (x === undefined) ? VIRTUAL_WIDTH / 2 : x;
            this.paddleAlex.x = px;
            this.alexTargetX = px;
            this.alexVelocityX = 0;
        }

        /**
         * X-Position der Figur, die gerade aufschlägt.
         * @returns {number} Weltkoordinate
         */
        serverX() {
            return this.match.server === PLAYER.ANDREA
                ? this.currentX
                : this.paddleAlex.x;
        }

        /**
         * Der Eingang, dessen Lautstärke den Aufschlag auslöst.
         *
         * Im Duell schlägt jeder mit der eigenen Stimme auf. Im Arcade-Modus
         * hat die KI keine — dort löst wie bisher die einzige Stimme im Raum
         * auch Alex' Aufschlag aus.
         *
         * @returns {AudioEngine}
         */
        serverAudio() {
            const zweiter = CONFIG.mode === MODE.VERSUS
                && this.match.server === PLAYER.ALEX
                && this.audio2;
            return zweiter ? this.audio2 : this.audio;
        }

        /**
         * `currentX` auf das Spielfeld klemmen (äußere Seitenlinien).
         *
         * Wird die Linie erreicht, muss auch die Geschwindigkeit auf 0 — sonst
         * baut die Feder weiter Schwung gegen die Wand auf und die Figur
         * schnellt beim Richtungswechsel los.
         */
        clampCurrentX() {
            const clamped = Math.max(
                Physics.PLAYER_MIN_X,
                Math.min(Physics.PLAYER_MAX_X, this.currentX)
            );
            if (clamped !== this.currentX) {
                this.currentX = clamped;
                this.velocityX = 0;
            }
        }

        /**
         * Figur und Geschwindigkeit hart in die Feldmitte setzen.
         * @param {number} [x] Zielposition, Default Bildmitte
         */
        haltAt(x) {
            const px = (x === undefined) ? VIRTUAL_WIDTH / 2 : x;
            this.currentX = px;
            this.targetX = px;
            this.velocityX = 0;
        }

        /**
         * Ruhelage des Balls vor dem Aufschlag: er klebt am Schläger der Seite,
         * die aufschlägt — bei Andrea oberhalb ihrer Grundlinie, bei Alex
         * unterhalb seiner.
         * @returns {number} Y-Position in Weltkoordinaten
         */
        serveRestY() {
            const b = this.ball;
            return this.match.server === PLAYER.ANDREA
                ? this.paddleAndrea.y - b.radius - 2
                : this.paddleAlex.y + b.radius + 2;
        }

        /**
         * Aufschlag ausführen. Zielpunkt folgt der aktuellen Tonhöhe.
         *
         * Die Richtung ergibt sich aus `match.server`: Andrea schlägt ins obere
         * Feld, Alex ins untere.
         */
        triggerServe() {
            const b = this.ball;
            const servedByAndrea = this.match.server === PLAYER.ANDREA;
            this.match.state = STATE.PLAYING;
            b.bounces = 0;
            b.lastHitter = this.match.server;

            /* Die Figur bleibt stehen, bis der Aufschlagton verklungen ist. */
            this.serveMovementLock = true;

            /* ACHTUNG: `tx` ist der Zielpunkt des BALLES und bewusst eine rein
               lokale Größe. Sie darf niemals nach `this.targetX` geschrieben
               werden — das ist die Zielposition der FIGUR. Beides aus derselben
               Tonhöhe abzuleiten ist richtig, sie zu koppeln nicht: der Ball
               soll dorthin fliegen, wohin gesungen wurde, die Aufschlägerin
               aber stehen bleiben. */
            let tx = (this.audio.smoothedPitch !== -1)
                ? this.freqToQuantizedX(this.audio.smoothedPitch)
                : (VIRTUAL_WIDTH / 2);

            /* Der Aufschlag selbst muss im Feld landen -> hier wird geklemmt. */
            tx = Math.max(
                COURT_LEFT + ALLEY_WIDTH + 20,
                Math.min(COURT_RIGHT - ALLEY_WIDTH - 20, tx)
            );
            /* Aufschlagrichtung: immer in die gegnerische Hälfte. */
            const ty = servedByAndrea
                ? COURT_TOP + (COURT_HEIGHT * 0.35)
                : COURT_BOTTOM - (COURT_HEIGHT * 0.35);

            const dx = tx - b.x;
            const dy = ty - b.y;
            const distance = Math.sqrt(dx * dx + dy * dy);

            b.vx = (dx / distance) * CONFIG.baseSpeed;
            b.vy = (dy / distance) * CONFIG.baseSpeed;

            const framesToTarget = Math.abs((ty - b.y) / b.vy);
            b.gravity = this.gravityForFlight(framesToTarget);
            b.vz = (-b.z / framesToTarget) + (b.gravity / 2) * framesToTarget;

            this.rallyShots = 0;
            this.rollOpponentMiss();
        }

        /**
         * Schätzt, an welcher X-Position der Ball eine bestimmte Y-Linie
         * kreuzen wird. Reine Geradeausrechnung ohne Aufsprung — für die
         * Laufwegplanung des Gegners völlig ausreichend, weil ein Aufsprung
         * die X-Geschwindigkeit nicht verändert.
         *
         * @param   {number} lineY Y-Position der Grundlinie
         * @returns {number} Erwartete X-Position beim Kreuzen
         */
        predictCrossingX(lineY) {
            const b = this.ball;
            /* Bewegt sich der Ball von der Linie weg, bleibt der Spieler
               einfach in der Feldmitte in Wartestellung. */
            const towards = (lineY - b.y) / (b.vy || 0.0001);
            if (towards <= 0) return VIRTUAL_WIDTH / 2;

            let x = b.x + b.vx * Math.min(towards, 600);
            /* Abpraller an den Bildrändern mitdenken, damit Alex bei
               Seitenwandbällen nicht in die falsche Richtung läuft. */
            const span = VIRTUAL_WIDTH;
            x = Math.abs(x % (2 * span));
            if (x > span) x = 2 * span - x;
            return x;
        }

        /**
         * Leitet die Gravitation für einen Schlag aus der gewünschten
         * Scheitelhöhe ab.
         *
         * Für einen Wurf, der nach T Frames wieder den Boden erreicht, gilt
         * näherungsweise Scheitelhöhe ≈ g · T² / 8. Nach g aufgelöst ergibt
         * das den Wert, der unabhängig von der Ballgeschwindigkeit immer
         * denselben Bogen liefert. Dadurch lassen sich `baseSpeed` und
         * `maxSpeed` künftig gefahrlos verstellen, ohne dass der Ball aus dem
         * Bild fliegt.
         *
         * @param   {number} frames Flugzeit bis zum Aufsprung in Frames
         * @returns {number} Gravitation in px/Frame²
         */
        gravityForFlight(frames) {
            const t = Math.max(1, frames);
            const g = (8 * CONFIG.arcHeight) / (t * t);
            /* Sicherheitsgrenzen: nie ganz schwerelos, nie bleischwer. */
            return Math.max(0.008, Math.min(0.6, g));
        }

        /**
         * Entscheidet, ob Alex den nächsten Ball absichtlich verfehlt.
         *
         * Zusätzlich zur Zufallsentscheidung gibt es eine harte Obergrenze:
         * Ab `MAX_RALLY_SHOTS` Schlägen verfehlt Alex garantiert. Ohne diese
         * Bremse endeten in der Simulation rund 3 % aller Ballwechsel nie —
         * bei einem Sendeplatz mit festem Zeitfenster ist ein Ballwechsel
         * ohne Ende das größte Ablaufrisiko.
         */
        rollOpponentMiss() {
            if (this.rallyShots >= Physics.MAX_RALLY_SHOTS) {
                this.pcWillMiss = true;
            } else {
                this.pcWillMiss = (Math.random() < Physics.OPPONENT_MISS_CHANCE);
            }
            if (this.pcWillMiss) this.planMiss();
        }

        /**
         * Den absichtlichen Fehler EINMAL festlegen, statt ihn Frame für Frame
         * aus der Ballposition abzuleiten.
         *
         * BEFUND (Simulation, 300 Ballwechsel): der alte Code setzte das Ziel
         * jedes Frame neu auf `ball.x ± 210`. Alex lief dadurch die komplette
         * Flugbahn im exakt gleichen Abstand NEBEN dem Ball her und ließ ihn am
         * Ende in konstant 210 px Abstand passieren — in jedem einzelnen Fall
         * derselbe Wert. Auf der Bühne liest sich das nicht als verpasster
         * Ball, sondern als Spieler, der neben dem Ball herläuft und ihn
         * absichtlich durchlässt. Genau der gemeldete Eindruck: "er könnte ihn
         * bekommen, erreicht ihn aber nicht."
         *
         * Jetzt tippt Alex im Moment des gegnerischen Schlages auf eine Ecke,
         * läuft dorthin und bleibt stehen. Er hat sich schlicht verschätzt —
         * mit jedes Mal anderem Abstand und wechselnder Seite.
         *
         * Der Fehler bleibt garantiert: die Flugbahn ist zwischen Schlag und
         * Grundlinie geradlinig, `predictCrossingX` also exakt. Der kleinste
         * mögliche Abstand (MISS_MARGIN_MIN) liegt sicher außerhalb der
         * Trefferzone von 100 px.
         */
        planMiss() {
            const aim = this.predictCrossingX(this.paddleAlex.y);
            const margin = Physics.MISS_MARGIN_MIN
                + Math.random() * (Physics.MISS_MARGIN_MAX - Physics.MISS_MARGIN_MIN);

            /* Er tippt auf die Feldmitte hin — der klassische Fehlgriff:
               der Ball geht in die Ecke, er deckt die Mitte ab. */
            const toCentre = aim < VIRTUAL_WIDTH / 2 ? 1 : -1;
            /* Muss dieselben Grenzen benutzen, in denen er sich auch bewegen
               darf — sonst plant er einen Ausweichpunkt, den er gar nicht
               erreicht, und steht am Ende doch im Weg. */
            const min = Physics.PLAYER_MIN_X;
            const max = Physics.PLAYER_MAX_X;

            let target = Math.max(min, Math.min(max, aim + toCentre * margin));
            /* Am Bildrand kann das Klemmen ihn zurück in die Trefferzone
               schieben — dann eben in die andere Richtung danebenlegen. */
            if (Math.abs(target - aim) < Physics.MISS_MARGIN_MIN) {
                target = Math.max(min, Math.min(max, aim - toCentre * margin));
            }
            this.missTargetX = target;

            /* Reaktionszeit: er startet nicht im selben Frame. Ein paar Frames
               Verzögerung nehmen der Bewegung das Maschinenhafte. */
            this.missDelay = Physics.MISS_REACTION_MIN
                + Math.floor(Math.random() * (Physics.MISS_REACTION_MAX - Physics.MISS_REACTION_MIN));
            this.missFrames = 0;
        }

        /**
         * Schlagberechnung. Der Auftreffpunkt auf dem Schläger bestimmt die
         * Richtung, die Lautstärke die Geschwindigkeit.
         *
         * @param {number}  paddleX  X-Position des schlagenden Schlägers
         * @param {boolean} isAndrea true = Andrea schlägt (Richtung nach oben)
         * @param {number}  volume   RMS-Lautstärke, die die Kraft bestimmt
         */
        calculateHit(paddleX, isAndrea, volume) {
            const b = this.ball;
            b.bounces = 0;
            b.lastHitter = isAndrea ? PLAYER.ANDREA : PLAYER.ALEX;

            let offset = (b.x - paddleX) / (PADDLE.width / 2);
            offset = Math.max(-1, Math.min(1, offset));

            /* ---------------------------------------------------------------
             * Gezielt wird auf den AUFSPRUNGPUNKT, nicht auf die Grundlinie.
             *
             * Vorher war das Ziel die gegnerische Grundlinie, der Ball sprang
             * aber schon nach 75 % der Flugzeit auf — er landete also kürzer
             * UND weiter außen als gezielt. Stand Andrea im Overdrive am
             * Bildrand, sprang ihr Ball messbar bei x=421 auf, während das
             * Einzelfeld erst bei x=525 beginnt: ein automatischer Fehler,
             * ohne dass der Gegner überhaupt eine Chance hatte. Genau das war
             * im Mitschnitt zu sehen ("maximaler Ton -> immer ein Punkt").
             *
             * Jetzt landet der Ball exakt dort, wohin gezielt wurde, und der
             * Aufsprungpunkt liegt konstruktionsbedingt immer im Feld.
             * ------------------------------------------------------------- */
            const halfPlayable = (COURT_WIDTH / 2) - ALLEY_WIDTH - Physics.SIDELINE_SAFETY;
            const bounceX = (VIRTUAL_WIDTH / 2) + offset * halfPlayable;
            const bounceY = isAndrea
                ? COURT_TOP + COURT_HEIGHT * Physics.BOUNCE_DEPTH
                : COURT_BOTTOM - COURT_HEIGHT * Physics.BOUNCE_DEPTH;

            const dx = bounceX - b.x;
            const dy = bounceY - b.y;
            const distance = Math.sqrt(dx * dx + dy * dy);

            const powerFactor = Math.max(0, Math.min(1, (volume - CONFIG.volumeGate) / 0.08));
            const finalSpeed = CONFIG.baseSpeed + powerFactor * (CONFIG.maxSpeed - CONFIG.baseSpeed);

            /* Flugzeit bis zum Aufsprung — daraus folgen alle drei Achsen. */
            const framesToBounce = Math.max(1, distance / finalSpeed);

            b.vx = dx / framesToBounce;
            b.vy = dy / framesToBounce;
            b.z = 15;

            b.gravity = this.gravityForFlight(framesToBounce);
            b.vz = (-b.z / framesToBounce) + (b.gravity / 2) * framesToBounce;
        }

        /**
         * ### GESCHÜTZT — ein Physik-/Regelschritt ###
         * Reihenfolge exakt wie V36: Bewegung -> Aufsprung -> KI -> Schläger
         * -> Seitenwände -> Aus-Prüfung. Der Zustand wird nach jedem Block neu
         * gelesen, weil `awardPoint()` mitten im Schritt umschalten kann.
         */
        update() {
            const b = this.ball;
            const match = this.match;

            /* --- Wegstrecke der Schläger in diesem Frame ----------------------
             * Grundlage der mitwandernden ("swept") Trefferzone weiter unten.
             *
             * Die beiden Seiten sind bewusst UNTERSCHIEDLICH gebaut, weil ihre
             * Positionen an verschiedenen Stellen entstehen:
             *   - Andrea wird in Game.step() bewegt, also VOR diesem Aufruf.
             *     Ihr voriger Wert muss deshalb über einen Frame hinweg
             *     gehalten werden (`prevCurrentX`); ein `const prev =
             *     this.currentX` an dieser Stelle läse bereits die neue
             *     Position und die Zone bliebe punktförmig.
             *   - Alex wird weiter unten in DIESEM Aufruf bewegt. Hier genügt
             *     es, den Wert vor dem KI-Block festzuhalten.
             * ---------------------------------------------------------------- */
            const prevAndreaX = this.prevCurrentX;
            this.prevCurrentX = this.currentX;
            const prevAlexX = this.paddleAlex.x;

            /* --- Aufschlagaufbau: Ball klebt am Schläger ----------------------
             * Am Schläger DES AUFSCHLÄGERS, nicht fest an Andreas Position.
             * Solange Alex eine KI war, fiel der Unterschied nicht auf: beide
             * standen im Aufbau in der Feldmitte. Mit einer zweiten Stimme
             * bewegt sich Alex im Aufbau aber selbst — der Ball hing sonst
             * sichtbar an der falschen Figur.
             * ------------------------------------------------------------- */
            if (match.state === STATE.SERVE_WAIT || match.state === STATE.SILENCE_CHECK) {
                b.x = this.serverX();
                b.y = this.serveRestY();

                if (match.state === STATE.SERVE_WAIT) {
                    if (this.serverAudio().currentVolume >= CONFIG.serveVolume) {
                        this.serveCharge++;
                        /* Siehe Physics.SERVE_CHARGE_FRAMES — nur eine Sperre
                           gegen einzelne Messspitzen, kein Durchhaltetest. */
                        if (this.serveCharge >= Physics.SERVE_CHARGE_FRAMES) {
                            this.triggerServe();
                            this.serveCharge = 0;
                        }
                    } else {
                        this.serveCharge = Math.max(0, this.serveCharge - 1);
                    }
                }
                return;
            }

            /* --- Integration -------------------------------------------------- */
            const prevY = b.y;
            b.x += b.vx;
            b.y += b.vy;
            b.z += b.vz;
            b.vz -= b.gravity;

            /* --- Aufsprung ---------------------------------------------------- */
            if (b.z <= 0) {
                b.z = 0;
                b.bounces++;
                /* Die feste Untergrenze von 4.0 stammte aus der Zeit mit
                   gravity 0.25. Bei der jetzigen Gravitation entspräche sie
                   einer Absprunghöhe von fast 200 px — der Ball wäre nach dem
                   Aufsprung HÖHER gesprungen als beim Schlag selbst. Die
                   Untergrenze ist deshalb an die Gravitation gekoppelt und
                   sorgt nur noch dafür, dass ein müder Ball nicht am Boden
                   klebt. Bestimmend ist jetzt der Rückprallfaktor. */
                b.vz = Math.max(
                    Math.abs(b.vz) * Physics.BOUNCE_RESTITUTION,
                    Physics.BOUNCE_MIN_APEX_VZ * b.gravity
                );

                if (b.bounces === 1) {
                    b.firstBounceInside = this.isInsideCourt(b.x, b.y);
                }

                if (match.state === STATE.PLAYING || match.state === STATE.POINT_SCORED) {
                    this.bounceMarks.add(b.x, b.y);
                }

                /* --- Urteil am Aufsprung ---------------------------------------
                 * Beide Entscheidungen fallen GENAU HIER, im Moment des
                 * Bodenkontakts, weil nur der Aufsprungpunkt zählt:
                 *   1. Erster Aufsprung im Aus -> Fehler der Schlägerin.
                 *   2. Zweiter Aufsprung       -> nicht zurückgeschlagen,
                 *                                 Punkt für die Schlägerin.
                 * Ein Ball IN DER LUFT ist niemals aus, egal wo er sich
                 * gerade befindet — siehe Aus-Prüfung am Ende von update().
                 * -------------------------------------------------------------- */
                if (match.state === STATE.PLAYING) {
                    if (b.bounces === 1 && !b.firstBounceInside) {
                        match.awardPoint(this.opponentOf(b.lastHitter));
                    } else if (b.bounces >= 2) {
                        match.awardPoint(b.lastHitter);
                    }
                }
            }

            if (match.state !== STATE.PLAYING) return;

            /* --- Gegner-KI (Alex) ---------------------------------------------
             * Der absichtliche Fehler zog Alex bisher zur FELDMITTE. Das
             * funktioniert nur, solange Andrea in die Ecken spielt. Singt sie
             * einen ruhigen mittleren Ton, landet ihr Schlag ebenfalls in der
             * Mitte — also genau dort, wohin Alex ausweicht. Er trifft den
             * Ball dann trotzdem, und der Ballwechsel endet nie. In der
             * Simulation lief so kein einziger von 60 Ballwechseln aus.
             *
             * Alex weicht jetzt vom BALL weg statt zur Mitte: er zielt eine
             * knappe Schlägerbreite neben den Ball, sichtbar als verpasster
             * Laufweg, aber garantiert außerhalb der Trefferzone.
             * ------------------------------------------------------------- */
            if (CONFIG.mode === MODE.VERSUS) {
                /* Im Duell gibt es keine KI. Die obere Figur folgt der zweiten
                   Stimme, gesetzt in Game.step() — hier wird sie nur noch
                   bewegt, mit derselben Dämpfung wie die untere. */
                this.glideAlexToTarget();
            } else if (!this.pcWillMiss) {
                /* Vorausschauend: Alex läuft dorthin, wo der Ball SEINE Linie
                   kreuzen wird, nicht dorthin, wo der Ball gerade ist. Das
                   frühere Nachziehen (Lerp auf die aktuelle Ballposition)
                   kam bei angeschnittenen Bällen grundsätzlich zu spät.
                   Die Bewegung ist auf eine Höchstgeschwindigkeit begrenzt —
                   dieselbe Größenordnung, die später auch eine zweite Stimme
                   erreichen kann, damit sich das Kräfteverhältnis beim
                   Umbau auf zwei Audio-Quellen nicht verschiebt. */
                const aim = this.predictCrossingX(this.paddleAlex.y);
                const delta = aim - this.paddleAlex.x;
                const step = Math.max(-Physics.OPPONENT_SPEED,
                    Math.min(Physics.OPPONENT_SPEED, delta));
                this.paddleAlex.x += step;
            } else if (b.vy < 0) {
                /* Fester, bei planMiss() gewählter Zielpunkt — er läuft einmal
                   dorthin und bleibt stehen, statt dem Ball im Gleichschritt
                   danebenherzulaufen. */
                this.missFrames++;
                if (this.missFrames > this.missDelay) {
                    const delta = this.missTargetX - this.paddleAlex.x;
                    const step = Math.max(-Physics.OPPONENT_SPEED * 0.8,
                        Math.min(Physics.OPPONENT_SPEED * 0.8, delta));
                    this.paddleAlex.x += step;
                }
            }
            /* Dieselbe Grenze wie für Andrea: die äußere Seitenlinie. Vorher
               lief Alex bis 95 bzw. 1505 und damit weit neben den Platz. */
            this.paddleAlex.x = Math.max(
                Physics.PLAYER_MIN_X,
                Math.min(Physics.PLAYER_MAX_X, this.paddleAlex.x)
            );

            /* --- Schläger Andrea (unten) ---------------------------------------
             * Die Trefferzone spannt über den GESAMTEN Weg dieses Frames, nicht
             * nur über die Endposition.
             *
             * Andrea legt bei einem Tonsprung bis zu ~24 px pro Frame zurück
             * (gedämpfte Annäherung, siehe glideToTarget(); mit dem früheren
             * Lerp waren es bis zu 90 px im ersten Frame). Kreuzte der Ball die
             * Grundlinie genau in der Lücke zwischen alter und neuer Position,
             * ging er durch den Schläger hindurch — sie lief sichtbar in den
             * Ball hinein und traf ihn trotzdem nicht. Der klassische
             * Tunneleffekt, hier nur waagerecht statt senkrecht.
             * ------------------------------------------------------------------ */
            const aLeft = Math.min(this.currentX, prevAndreaX) - PADDLE.width / 2 - PADDLE.hitPadding;
            const aRight = Math.max(this.currentX, prevAndreaX) + PADDLE.width / 2 + PADDLE.hitPadding;
            if (b.vy > 0 && prevY < this.paddleAndrea.y && b.y + b.radius > this.paddleAndrea.y) {
                if (b.x >= aLeft && b.x <= aRight) {
                    b.y = this.paddleAndrea.y - b.radius;
                    this.calculateHit(this.currentX, true, this.audio.currentVolume);
                    this.rallyShots++;
                    this.rollOpponentMiss();
                }
            }

            /* --- Schläger Alex (oben) ------------------------------------------
             * Dieselbe mitwandernde Zone wie bei Andrea. Alex bewegt sich mit
             * höchstens OPPONENT_SPEED (11 px/Frame) und tunnelt daher selten,
             * aber die Regel muss für beide Seiten gleich sein — sonst
             * entscheidet die Bildwiederholrate darüber, wer im Grenzfall
             * trifft. Der absichtliche Fehler bleibt davon unberührt: er hält
             * mit MISS_MARGIN_MIN = 135 px sicheren Abstand zur Zone.
             * ------------------------------------------------------------------ */
            const pLeft = Math.min(this.paddleAlex.x, prevAlexX) - this.paddleAlex.width / 2 - PADDLE.hitPadding;
            const pRight = Math.max(this.paddleAlex.x, prevAlexX) + this.paddleAlex.width / 2 + PADDLE.hitPadding;
            if (b.vy < 0 && prevY > this.paddleAlex.y && b.y - b.radius < this.paddleAlex.y) {
                if (b.x >= pLeft && b.x <= pRight) {
                    b.y = this.paddleAlex.y + b.radius;
                    /* Schlagkraft der oberen Figur. Im Duell kommt sie aus dem
                       zweiten Mikrofon — genauso wie Andreas Schlagkraft aus
                       dem ersten. Nur im Arcade-Modus wird sie gewürfelt:
                       V36 setzte dafür kurzzeitig die globale Lautstärke, jetzt
                       explizit übergeben — gleiche Werte, gleiche Wirkung,
                       keine versteckte Kopplung. */
                    const simulatedVolume = (CONFIG.mode === MODE.VERSUS && this.audio2)
                        ? this.audio2.currentVolume
                        : 0.04 + Math.random() * 0.03;
                    this.calculateHit(this.paddleAlex.x, false, simulatedVolume);
                }
            }

            /* --- Seitenwände (Bildschirmrand) ---------------------------------- */
            if (b.x - b.radius < 0) { b.x = b.radius; b.vx *= -1; }
            if (b.x + b.radius > VIRTUAL_WIDTH) { b.x = VIRTUAL_WIDTH - b.radius; b.vx *= -1; }

            /* --- Aus-Prüfung: Ball hinter der Grundlinie -------------------------
             * Der Ball ist gültig aufgesprungen und zieht jetzt hinter der
             * Rückschlägerin vorbei — sie hat ihn nicht erwischt, der Punkt
             * gehört der Schlägerin.
             *
             * WICHTIG (Befund: 28 von 300 Ballwechseln, Simulation):
             * Geprüft wird ausschließlich die Grundlinie der RÜCKSCHLÄGERIN,
             * nicht mehr das gesamte Feldrechteck. Vorher lief hier
             * `!isInsideCourt(x, y)` und damit auch die Seitenlinie mit — für
             * einen Ball, der noch in der LUFT ist. Ein scharf cross
             * geschlagener Ball sprang gültig auf, überflog Sekundenbruchteile
             * später in ~36 px Höhe die Seitenlinie und der Punkt fiel sofort:
             * mitten im Feld, 0,3 s nach dem Aufsprung, mit dem Gegner keine
             * 30 px daneben. Ein Ball in der Luft ist niemals aus. Wo er
             * aufspringt, entscheidet der Block weiter oben.
             * ------------------------------------------------------------------ */
            if (b.bounces >= 1 && b.firstBounceInside) {
                const returner = this.opponentOf(b.lastHitter);
                const passed = returner === PLAYER.ALEX
                    ? (b.y < COURT_TOP)
                    : (b.y > COURT_BOTTOM);
                if (passed) match.awardPoint(b.lastHitter);
            }
        }

        /**
         * @param   {string} player Wert aus PLAYER
         * @returns {string} Die jeweils andere Spielerin.
         */
        opponentOf(player) {
            return player === PLAYER.ANDREA ? PLAYER.ALEX : PLAYER.ANDREA;
        }

        /**
         * Liegt ein AUFSPRUNGPUNKT innerhalb des Einzelfeldes?
         *
         * Ausschließlich für Bodenkontakte gedacht. Auf einen fliegenden Ball
         * angewendet liefert die Funktion zwar eine Antwort, aber keine
         * regelkonforme — ein Ball über der Seitenlinie ist im Flug nicht aus.
         * @param   {number} x
         * @param   {number} y
         * @returns {boolean}
         */
        isInsideCourt(x, y) {
            const outX = (x < COURT_LEFT + ALLEY_WIDTH) || (x > COURT_RIGHT - ALLEY_WIDTH);
            const outY = (y < COURT_TOP) || (y > COURT_BOTTOM);
            return !outX && !outY;
        }
    }

    /**
     * Tiefenfaktor an Andreas Grundlinie.
     *
     * Entspricht `scale3D` aus Projection.project() bei y = COURT_BOTTOM:
     * dort ist dy = 1, also 1 / (1 - DEPTH_STRENGTH) = 1.491.
     *
     * Bewusst ABGELEITET statt abgeschrieben. Vorher stand hier die 1.35 als
     * eigene Zahl mit dem Hinweis, sie von Hand mitzuziehen — genau die Art
     * Kopplung, die beim nächsten Umbau der Projektion vergessen wird und
     * Andreas Bewegungsgrenzen still falsch werden lässt. Der Wechsel von der
     * linearen auf die projektive Formel hat sich hier von selbst mitgezogen.
     */
    Physics.BASELINE_SCALE3D = 1 / (1 - DEPTH_STRENGTH);

    /* -------------------------------------------------------------------------
     * Bewegungsgrenzen BEIDER Spieler (Weltkoordinaten).
     *
     * Die äußere Seitenlinie ist Schluss. Weiter läuft niemand — weder Andrea
     * über den Overdrive, noch Alex über seine KI.
     *
     * Vorgeschichte in zwei Schritten, weil beide Zwischenstände im Code noch
     * nachwirken könnten:
     *   1. Ursprünglich `PADDLE.width / 2 + PADDLE.screenMargin` bis
     *      `VIRTUAL_WIDTH - dasselbe`, also 95 bis 1505 — eine reine
     *      Bildschirmgrenze, die die Projektion nicht kannte. Welt-x 1505
     *      landet auf der vorderen Grundlinie bei Bildschirm-x 1752 und damit
     *      außerhalb des Bildes; die Aufschlägerin verschwand.
     *   2. Danach aus der Projektion zurückgerechnet, sodass der Overdrive
     *      exakt am Bildschirmrand endete. Optisch korrekt, spielerisch aber
     *      seltsam: die Figuren standen minutenlang weit neben dem Platz.
     *
     * Jetzt schlicht die Feldgrenze. Die Figurenmitte steht dann auf der
     * Linie, der Schläger ragt zur Hälfte darüber hinaus — genau wie bei einer
     * Spielerin, die auf der Linie steht. Dass alles im Bild bleibt, ergibt
     * sich von selbst: COURT_RIGHT liegt auf der vorderen Grundlinie bei
     * Bildschirm-x 1306, der Figurenrand bei 1418 von 1600.
     * ---------------------------------------------------------------------- */
    Physics.PLAYER_MIN_X = COURT_LEFT;
    Physics.PLAYER_MAX_X = COURT_RIGHT;

    /**
     * Kalibrierter Stimmumfang eines Spielers.
     *
     * Einzige Stelle, an der entschieden wird, welches Wertepaar aus CONFIG
     * gilt. Ohne Angabe kommt Andreas Umfang — dadurch verhalten sich alle
     * bestehenden Aufrufer (und die Entwickler-Tests) unverändert.
     *
     * @param   {string} [player] Wert aus PLAYER.
     * @returns {{min:number, max:number}} Frequenzen in Hz.
     */
    /**
     * Ein Schritt der kritisch gedämpften Annäherung.
     *
     * Herausgezogen aus `glideToTarget()`, damit die obere Figur im
     * Versus-Modus exakt dieselbe Bewegung bekommt. Die Rechnung selbst ist
     * unverändert: `velocity` wird aus dem ALTEN Wert und `temp` gebildet,
     * `x` aus `change` und `temp` — beide aus denselben Zwischenwerten, die
     * Reihenfolge der Zuweisungen ist deshalb ohne Bedeutung.
     *
     * @param   {number} current
     * @param   {number} target
     * @param   {number} velocity
     * @returns {{x:number, v:number}} Neue Position und Geschwindigkeit.
     */
    Physics.glideStep = function (current, target, velocity) {
        const omega = 2 / CONFIG.glideFrames;
        const exp = 1 / (1 + omega + 0.48 * omega * omega
            + 0.235 * omega * omega * omega);

        const change = current - target;
        const temp = velocity + omega * change;

        return {
            x: target + (change + temp) * exp,
            v: (velocity - omega * temp) * exp,
        };
    };

    Physics.voiceRange = function (player) {
        return player === PLAYER.ALEX
            ? { min: CONFIG.minFreq2, max: CONFIG.maxFreq2 }
            : { min: CONFIG.minFreq, max: CONFIG.maxFreq };
    };

    /**
     * Frames über der Aufschlagschwelle, bevor ausgelöst wird.
     *
     * War 8 (~133 ms), dann 5 (~83 ms), jetzt 3 (~50 ms). Der Zähler soll nur
     * einzelne Messspitzen ausfiltern, nicht ein Durchhalten erzwingen — dafür
     * genügen drei Frames. Zusammen mit CONFIG.serveVolume = 0.022 ist der
     * Aufschlag deutlich leichter auszulösen als bisher.
     * @readonly
     */
    Physics.SERVE_CHARGE_FRAMES = 3;

    /** Anteil der Vertikalgeschwindigkeit, der beim Aufsprung erhalten bleibt. */
    Physics.BOUNCE_RESTITUTION = 0.6;

    /**
     * Untergrenze der Absprunggeschwindigkeit, ausgedrückt als Vielfaches der
     * Gravitation — dadurch skaliert sie automatisch mit, wenn `CONFIG.gravity`
     * verstellt wird. 24 · g entspricht rund 12 px Absprunghöhe.
     */
    Physics.BOUNCE_MIN_APEX_VZ = 24;

    /**
     * Spanne, um die Alex bei einem absichtlichen Fehler danebentippt.
     *
     * MIN muss über der halben Trefferzone liegen
     * (PADDLE.width / 2 + PADDLE.hitPadding = 100), sonst trifft er zufällig
     * doch und der Ballwechsel läuft weiter. MAX bestimmt, wie deutlich der
     * Fehlgriff aussieht. Der konkrete Wert wird pro Fehler ausgewürfelt —
     * ein fester Abstand (früher 210) wirkte auf der Bühne wie Absicht.
     */
    Physics.MISS_MARGIN_MIN = 135;
    Physics.MISS_MARGIN_MAX = 320;

    /** Reaktionsverzögerung des Gegners beim Fehlgriff, in Frames (60 = 1 s). */
    Physics.MISS_REACTION_MIN = 6;
    Physics.MISS_REACTION_MAX = 26;

    /**
     * Wahrscheinlichkeit, dass Alex einen Ball absichtlich verfehlt.
     *
     * War 0.24 — damit war er zu leicht zu schlagen: fast jeder vierte Ball
     * kam gar nicht zurück. Bei 0.15 bringt er sechs von sieben Bällen
     * zurück, und der Ballwechsel endet häufiger daran, dass ANDREA ihn nicht
     * mehr erreicht, statt an einem geschenkten Punkt.
     *
     * Zusammen mit `MAX_RALLY_SHOTS` der Regler für die Spiellänge. Gemessen
     * (300 Ballwechsel je Kombination, perfekt spielende Andrea):
     *
     *   Fehlerquote / Deckel | Median | Schläge | Punkte in 7 min
     *   0.24 / 5  (vorher)   | 10.6 s |   4.7   |  20
     *   0.20 / 6             | 14.4 s |   6.4   |  17
     *   0.15 / 6  (jetzt)    | 15.0 s |   6.7   |  17
     *   0.10 / 8             | 22.8 s |  10.0   |  13
     *
     * Unter 0.13 wird der Ballwechsel spürbar zäh, ohne dass der Gegner
     * merklich stärker wirkt. Die echte Zahl liegt über der gemessenen: im
     * Test verfehlt Andrea nie, auf der Bühne schon.
     */
    Physics.OPPONENT_MISS_CHANCE = 0.15;

    /**
     * Höchstgeschwindigkeit des Gegners in px/Frame.
     *
     * Bezugsgröße: Andrea erreicht mit der gedämpften Annäherung eine
     * Spitzengeschwindigkeit von rund 24 px/Frame (früher, mit dem reinen
     * Lerp, kurzzeitig 90). 11 px/Frame reichen, damit Alex jeden regulären
     * Ball erreicht, ohne dass er wie festgenagelt wirkt. Wird Alex später
     * durch eine zweite Stimme ersetzt, ist dieser Wert der Vergleichsmaßstab
     * für ein faires Kräfteverhältnis.
     *
     * ACHTUNG: Das Kräfteverhältnis hat sich mit dem Gleiten verschoben —
     * Andrea ist nicht mehr das Vierfache, sondern nur noch gut das Doppelte
     * so schnell wie Alex. Wirkt er auf der Bühne zu stark, ist das hier der
     * Regler.
     */
    Physics.OPPONENT_SPEED = 11;

    /**
     * Nach so vielen Schlägen von Andrea verfehlt Alex garantiert. Bremse
     * gegen endlose Ballwechsel — siehe rollOpponentMiss().
     *
     * Von 5 auf 6 angehoben, damit ein längerer Schlagabtausch überhaupt
     * zustande kommen kann. Mit 5 endete jeder Ballwechsel spätestens beim
     * fünften Schlag durch einen erzwungenen Fehler — bei einem Gegner, der
     * jetzt sechs von sieben Bällen zurückbringt, wäre genau das die neue
     * Obergrenze gewesen und der Ballwechsel hätte sich künstlich angefühlt.
     * Höher als 6 verlängert vor allem die AUSREISSER (p90 von 26 s auf 33 s),
     * ohne den Median zu bewegen.
     */
    Physics.MAX_RALLY_SHOTS = 6;

    /**
     * Sicherheitsabstand des Aufsprungpunktes zur Einzel-Seitenlinie in
     * virtuellen Pixeln. Größer = der Ball landet konservativer im Feld,
     * kleiner = spitzere Winkel und schwerere Bälle für den Gegner.
     */
    Physics.SIDELINE_SAFETY = 45;

    /**
     * Wie tief im gegnerischen Feld der Ball aufspringt, als Anteil der
     * Feldlänge von dessen Grundlinie aus. 0.24 entspricht etwa dem
     * Aufschlagfeld-Bereich und lässt dem Gegner Laufweg bis zur Grundlinie.
     */
    Physics.BOUNCE_DEPTH = 0.24;

    /* =========================================================================
     * 9. RENDERER
     * ====================================================================== */

    /**
     * Kompletter Zeichencode, ein Durchgang pro Frame in voller Auflösung.
     * Die Aufrufreihenfolge in `render()` IST die Z-Sortierung:
     *
     *   Rasen -> Platzbelag -> Feldlinien -> Tribüne -> Personal -> Netz
     *   -> Aufsprungmarken -> Ballschatten -> Ball -> HUD -> Abdunkelung
     *   -> Punktanzeige -> SPIELER -> Bumper -> Countdown
     *
     * Die Spieler werden bewusst NACH der Abdunkelung gezeichnet, damit sie in
     * den Pausen hell vor dem dunklen Platz stehen.
     */
    class Renderer {
        /**
         * @param {CanvasRenderingContext2D} ctx
         * @param {Viewport}     viewport
         * @param {Projection}   projection
         * @param {AssetManager} assets
         */
        constructor(ctx, viewport, projection, assets) {
            this.ctx = ctx;
            this.viewport = viewport;
            this.proj = projection;
            this.assets = assets;

            /** Cache für Font-Strings — spart Stringbau in jedem Frame. */
            this._fontCache = new Map();
            /** Scratch für Punkte, die über einen Aufruf hinaus leben müssen. */
            this._p1 = { x: 0, y: 0, scale: 1, scale3D: 1 };
            this._p2 = { x: 0, y: 0, scale: 1, scale3D: 1 };

            /** Publikum: einmalig vorberechnet, kein GC-Druck im Hot Path. */
            this._crowd = this.buildCrowd();
        }

        /**
         * Gecachter Font-String.
         *
         * `style` ist alles, was in CSS VOR der Größe steht (`bold`,
         * `italic bold`, `normal`). Ohne Angabe bleibt es bei `bold` — damit
         * verhalten sich alle bestehenden Aufrufe unverändert.
         *
         * `family` weicht von der Retro-Schrift ab — gedacht für das
         * Scoreboard, das der Vorlage folgt und dort in einer serifenlosen
         * Groteske gesetzt ist, nicht in Courier.
         *
         * @param   {number} px       Schriftgröße in Bildschirmpixeln
         * @param   {string} [style]  CSS-Stilpräfix, Default 'bold'
         * @param   {string} [family] CSS-Schriftfamilie, Default Courier New
         * @returns {string}
         */
        font(px, style, family) {
            const size = Math.round(px);
            const prefix = style || 'bold';
            const fam = family || "'Courier New', monospace";
            const key = `${prefix}|${size}|${fam}`;
            let f = this._fontCache.get(key);
            if (f === undefined) {
                f = `${prefix} ${size}px ${fam}`;
                this._fontCache.set(key, f);
            }
            return f;
        }

        /**
         * Hauptaufruf für einen Frame. Zeichnet die komplette Szene in voller
         * Auflösung auf den sichtbaren Canvas.
         * @param {Object}      scene
         * @param {MatchState}  scene.match
         * @param {Ball}        scene.ball
         * @param {Paddle}      scene.paddleAndrea
         * @param {Paddle}      scene.paddleAlex
         * @param {BounceMarks} scene.bounceMarks
         * @param {DvdLogo}     scene.dvd
         * @param {number}      scene.andreaX
         * @param {AudioEngine} [scene.audio] Für die Live-Audiowerte unten links
         */
        render(scene) {
            const palette = scene.match.courtPalette();

            this.drawBackground(palette);
            this.drawCourtSurface(palette);
            this.drawCourtLines();
            this.drawPitchIndicators(scene.audio);
            this.drawCrowd();
            this.drawStaff();
            this.drawNet();
            this.drawBounceMarks(scene.bounceMarks);
            this.drawBall(scene.ball);

            const scoreLine = scene.match.scoreLine();
            this.drawHud(scene.match, scene.audio, scene.audio2);
            this.drawDimOverlay(scene.match);

            if (scene.match.state === STATE.POINT_SCORED) {
                if (scene.match.isWarmup) this.drawWarmupBanner(scene.match);
                else this.drawPointBanner(scene.match, scoreLine);
            }

            this.drawPlayers(scene);

            if (scene.match.state === STATE.TRANSITION) {
                this.drawTransition(scene.match, scene.dvd, scoreLine);
            }
            if (scene.match.state === STATE.SILENCE_CHECK) {
                this.drawSilenceCheck(scene.match, scene);
            }
            if (scene.match.state === STATE.SERVE_WAIT) {
                this.drawServePrompt(scene);
            }

            /* Ganz zuletzt, damit die Werte auch unter der Abdunkelung und
               unter dem Bumper lesbar bleiben — sie sind ein Kontrollmittel
               für den Operator, kein Teil der Show. */
            this.drawAudioDebug(scene.audio);

            /* Ausblenden bewusst NACH dem Zeichnen — identische Optik zu V36. */
            scene.bounceMarks.fade();
        }

        /* --------------------------------------------------------------------
         * Layer: Publikum
         * ----------------------------------------------------------------- */

        /**
         * Zuschauerreihen hinter der oberen Grundlinie.
         *
         * Ersetzt die frühere Punktwolke, die bei voller Auflösung nur wie
         * Farbrauschen aussah. Jetzt sind es angedeutete sitzende Figuren
         * (Kopf + Oberkörper) in dichten Reihen — bei der Betrachtungsdistanz
         * einer LED-Wand liest sich das als Publikum, nicht als Störung.
         *
         * Läuft einmalig im Konstruktor, nicht pro Frame: die Positionen und
         * Farben ändern sich nie, damit auf der Bühne nichts flackert.
         * @returns {Array<{x:number, y:number, shirt:string, skin:string, size:number}>}
         */
        buildCrowd() {
            const shirts = [
                '#c8442f', '#2f6cc8', '#d8b230', '#e0e0e0', '#4aa05a',
                '#8a4ac0', '#d06a30', '#2f9ca8', '#b03060', '#404a58'
            ];
            const skins = ['#f0c8a0', '#d8a878', '#a87848', '#7a5230'];

            const rows = Renderer.CROWD_ROWS;
            const left = COURT_LEFT - ALLEY_WIDTH - 260;
            const right = COURT_RIGHT + ALLEY_WIDTH + 260;
            const backY = COURT_TOP - Renderer.CROWD_DEPTH;
            const frontY = COURT_TOP - 30;

            const people = [];
            for (let r = 0; r < rows; r++) {
                const t = r / (rows - 1);
                const y = backY + t * (frontY - backY);
                /* Vordere Reihen leicht versetzt und minimal größer. */
                const spacing = 26;
                const stagger = (r % 2) * (spacing / 2);
                for (let x = left + stagger; x < right; x += spacing) {
                    people.push({
                        x: x + (Math.random() - 0.5) * 5,
                        y: y + (Math.random() - 0.5) * 4,
                        shirt: shirts[(Math.random() * shirts.length) | 0],
                        skin: skins[(Math.random() * skins.length) | 0],
                        size: 0.9 + Math.random() * 0.2
                    });
                }
            }
            return people;
        }

        /**
         * Tribüne und Publikum zeichnen.
         * SPRITE-HOOK: `crowd` im Manifest ersetzt die gesamte Routine.
         */
        drawCrowd() {
            const ctx = this.ctx;

            /* Das Hintergrundbild bringt Tribüne und Publikum bereits mit —
               die gezeichneten Figuren säßen sonst als zweite Reihe davor. */
            if (this.hasCourtBackdrop()) return;

            const left = COURT_LEFT - ALLEY_WIDTH - 300;
            const right = COURT_RIGHT + ALLEY_WIDTH + 300;
            const backY = COURT_TOP - Renderer.CROWD_DEPTH - 40;
            const frontY = COURT_TOP - 20;

            /* Dunkler Tribünenblock als Hintergrund, damit die Figuren
               Kontrast bekommen und der Rasen sauber abschließt. */
            const a = this.proj.project(left, backY, 0, this.proj.scratchA);
            const ax = a.x, ay = a.y;
            const b = this.proj.project(right, backY, 0, this.proj.scratchB);
            const bx = b.x, by = b.y;
            const c = this.proj.project(right, frontY, 0, this.proj.scratchC);
            const cx = c.x, cy = c.y;
            const d = this.proj.project(left, frontY, 0, this._p1);

            ctx.fillStyle = '#10241c';
            ctx.beginPath();
            ctx.moveTo(ax, ay);
            ctx.lineTo(bx, by);
            ctx.lineTo(cx, cy);
            ctx.lineTo(d.x, d.y);
            ctx.fill();

            if (this.assets.isReady('crowd')) {
                const img = this.assets.get('crowd');
                ctx.drawImage(img, ax, ay, bx - ax, cy - ay);
                return;
            }

            const people = this._crowd;
            for (let i = 0; i < people.length; i++) {
                const p = people[i];
                const s = this.proj.project(p.x, p.y, 0, this._p2);
                const unit = s.scale3D * p.size;

                /* Oberkörper */
                ctx.fillStyle = p.shirt;
                ctx.fillRect(s.x - 7 * unit, s.y - 14 * unit, 14 * unit, 15 * unit);
                /* Kopf */
                ctx.fillStyle = p.skin;
                ctx.beginPath();
                ctx.arc(s.x, s.y - 18 * unit, 5.5 * unit, 0, Math.PI * 2);
                ctx.fill();
            }
        }

        /* --------------------------------------------------------------------
         * Layer: Hintergrund und Platz
         * ----------------------------------------------------------------- */

        /**
         * Liegt ein fertiges Hintergrundbild des kompletten Platzes vor?
         *
         * Ist das der Fall, wechselt der Renderer das Paradigma: statt Rasen,
         * Platzfläche und Publikum einzeln zu zeichnen, wird EIN Bild flach
         * über den ganzen Canvas gelegt. Die Perspektive steckt dann im Bild,
         * nicht mehr in der Projektion.
         *
         * Bewusst als Methode und nicht als Feld: das Bild kann während der
         * ersten Frames noch laden, die Antwort darf sich also ändern.
         * @returns {boolean}
         */
        hasCourtBackdrop() {
            return this.assets.isReady('court_surface');
        }

        /**
         * Untergrund für das Onboarding — bewusst OHNE Tennisplatz.
         *
         * Bis V38 stand der fertige Platz schon hinter dem Onboarding-Kasten.
         * Das nimmt dem Übergang ins Einspielen seine Wirkung: wenn der Platz
         * von Anfang an da ist, passiert beim Start des Spiels optisch nichts
         * mehr. Jetzt ist während des Einsingens nur die Klaviatur zu sehen —
         * der Platz erscheint erst, wenn es losgeht.
         *
         * Dieselbe Fläche wie der Letterbox-Rand, damit der Übergang später
         * nur den Platz einblendet und nicht auch noch den Hintergrund wechselt.
         */
        drawOnboardingBackdrop() {
            const ctx = this.ctx;
            const w = this.viewport.width;
            const h = this.viewport.height;

            ctx.fillStyle = Renderer.ONBOARDING_BACKDROP_EDGE;
            ctx.fillRect(0, 0, w, h);

            /* Leichter Verlauf zur Mitte: eine völlig flache Fläche wirkt auf
               einer LED-Wand dieser Größe wie ein Ausfall des Zuspielers. */
            const g = ctx.createLinearGradient(0, 0, 0, h);
            g.addColorStop(0, Renderer.ONBOARDING_BACKDROP_EDGE);
            g.addColorStop(0.5, Renderer.ONBOARDING_BACKDROP_MID);
            g.addColorStop(1, Renderer.ONBOARDING_BACKDROP_EDGE);
            ctx.fillStyle = g;
            ctx.fillRect(0, 0, w, h);
        }

        /**
         * Untergrund: entweder das fertige Hintergrundbild oder die Farbfläche.
         *
         * Das Bild wird NICHT projiziert, sondern in das virtuelle 1600x900-
         * Rechteck gezogen — also GENAU in den Bereich, in dem auch alles
         * andere gezeichnet wird.
         *
         * WICHTIG: Es wird ausdrücklich NICHT über den ganzen Canvas gezogen.
         * Der Canvas hat die Fenstergröße, das Spiel läuft aber letterboxed in
         * einem 16:9-Rechteck darin. Ein über die volle Fensterfläche
         * gestrecktes Bild verschiebt und staucht sich gegenüber der
         * Feldgeometrie, sobald das Fenster nicht exakt 16:9 ist — bei einem
         * 1600x1000-Fenster wären das schon 50 px Versatz nach oben plus 11 %
         * Streckung. Da die Physikgrenzen jetzt pixelgenau auf den aufgemalten
         * Linien liegen, würde genau das den ganzen Abgleich zunichtemachen.
         *
         * Ohne Bild bleibt es bei der gemessenen US-Open-Farbe.
         * @param {{outer:string}} palette
         */
        drawBackground(palette) {
            const ctx = this.ctx;

            if (this.hasCourtBackdrop()) {
                /* Letterbox-Balken zuerst schwarz füllen: das Bild deckt nur
                   noch das 16:9-Rechteck ab, sonst stünde dort der Inhalt des
                   vorigen Frames. */
                ctx.fillStyle = '#000000';
                ctx.fillRect(0, 0, this.viewport.width, this.viewport.height);

                const tl = this.viewport.toScreen(0, 0, this._p1);
                ctx.drawImage(
                    this.assets.get('court_surface'),
                    tl.x, tl.y,
                    VIRTUAL_WIDTH * tl.scale, VIRTUAL_HEIGHT * tl.scale
                );
                return;
            }

            ctx.fillStyle = palette.outer;
            ctx.fillRect(0, 0, this.viewport.width, this.viewport.height);
        }

        /**
         * Das blaue Spielfeld als ein einziges 2.5D-Trapez.
         *
         * Ersetzt den gestreiften Rasen. In der Vorlage ist der Platz eine
         * geschlossene blaue Fläche, die exakt an den äußeren weißen Linien
         * endet — ein Zeilenscan des Bildes zeigt an jeder Höhe unmittelbar
         * hinter der Doppellinie Grün. Die vier Ecken sind deshalb genau die
         * Feldgrenzen; die Linien aus drawCourtLines() liegen anschließend
         * von selbst auf der Kante zwischen Blau und Grün.
         *
         * Bewusst OHNE Kontur: eine zusätzliche Umrandung läge einen halben
         * Strich neben den weißen Linien und ergäbe einen Doppelrand.
         *
         * Liegt ein Hintergrundbild vor, entfällt diese Ebene ersatzlos: die
         * Platzfläche ist dann Teil des Bildes, das drawBackground() bereits
         * gezeichnet hat.
         * @param {{inner:string}} palette
         */
        drawCourtSurface(palette) {
            const ctx = this.ctx;

            if (this.hasCourtBackdrop()) return;

            const tl = this.proj.project(COURT_LEFT, COURT_TOP, 0, this._p1);
            const tlx = tl.x, tly = tl.y;
            const tr = this.proj.project(COURT_RIGHT, COURT_TOP, 0, this.proj.scratchA);
            const trx = tr.x, try_ = tr.y;
            const br = this.proj.project(COURT_RIGHT, COURT_BOTTOM, 0, this.proj.scratchB);
            const brx = br.x, bry = br.y;
            const bl = this.proj.project(COURT_LEFT, COURT_BOTTOM, 0, this._p2);

            ctx.fillStyle = palette.inner;
            ctx.beginPath();
            ctx.moveTo(tlx, tly);
            ctx.lineTo(trx, try_);
            ctx.lineTo(brx, bry);
            ctx.lineTo(bl.x, bl.y);
            ctx.closePath();
            ctx.fill();
        }

        /**
         * Eine Linie in Weltkoordinaten, perspektivisch korrekt skaliert.
         * @param {number} x1
         * @param {number} y1
         * @param {number} x2
         * @param {number} y2
         * @param {string} color
         * @param {number} lineWidth Strichstärke in virtuellen Pixeln
         */
        drawWorldLine(x1, y1, x2, y2, color, lineWidth) {
            const ctx = this.ctx;
            const p1 = this.proj.project(x1, y1, 0, this._p1);
            const p2 = this.proj.project(x2, y2, 0, this._p2);
            ctx.strokeStyle = color;
            ctx.lineWidth = lineWidth * ((p1.scale3D + p2.scale3D) / 2);
            /* Stumpfes Ende, ausdrücklich gesetzt. Mit 'round' oder 'square'
               ragte jede Linie um ihre halbe Strichstärke über den angegebenen
               Endpunkt hinaus — bei der Aufschlaglinie wären das sichtbare
               Zapfen in der Doppelgasse. */
            ctx.lineCap = 'butt';
            ctx.beginPath();
            ctx.moveTo(p1.x, p1.y);
            ctx.lineTo(p2.x, p2.y);
            ctx.stroke();
        }

        /** Alle Feldlinien (Grund-, Seiten-, Aufschlag- und Mittellinie). */
        drawCourtLines() {
            /* Das Hintergrundbild bringt sämtliche Linien mit. Ein zweiter Satz
               darüber wäre selbst bei perfekter Deckung als Doppelkante
               sichtbar — und bei kleinster Abweichung als Geisterlinie. */
            if (this.hasCourtBackdrop()) return;
            if (this.assets.isReady('court_lines')) return; // Sprite übernimmt

            /* Innere Begrenzung des Einzelfeldes. Die Aufschlaglinien enden
               GENAU hier und keinen Pixel weiter — sonst ragt das T in die
               Doppelgasse. */
            const singlesLeft = COURT_LEFT + ALLEY_WIDTH;
            const singlesRight = COURT_RIGHT - ALLEY_WIDTH;

            const c = LINE_COLOR;
            this.drawWorldLine(COURT_LEFT, COURT_TOP, COURT_RIGHT, COURT_TOP, c, 5);
            this.drawWorldLine(COURT_LEFT, COURT_BOTTOM, COURT_RIGHT, COURT_BOTTOM, c, 5);
            this.drawWorldLine(COURT_LEFT, COURT_TOP, COURT_LEFT, COURT_BOTTOM, c, 5);
            this.drawWorldLine(COURT_RIGHT, COURT_TOP, COURT_RIGHT, COURT_BOTTOM, c, 5);
            this.drawWorldLine(singlesLeft, COURT_TOP, singlesLeft, COURT_BOTTOM, c, 5);
            this.drawWorldLine(singlesRight, COURT_TOP, singlesRight, COURT_BOTTOM, c, 5);

            /* Beide Aufschlaglinien liegen gleich weit vom Netz entfernt, wie
               auf einem echten Platz. Die perspektivische Stauchung der
               hinteren Hälfte übernimmt die Projektion. */
            const yTop = COURT_MID_Y - COURT_HEIGHT * Renderer.SERVICE_LINE_DEPTH;
            const yBot = COURT_MID_Y + COURT_HEIGHT * Renderer.SERVICE_LINE_DEPTH;
            this.drawWorldLine(singlesLeft, yTop, singlesRight, yTop, c, 3);
            this.drawWorldLine(singlesLeft, yBot, singlesRight, yBot, c, 3);
            this.drawWorldLine(VIRTUAL_WIDTH / 2, yTop, VIRTUAL_WIDTH / 2, yBot, c, 3);
        }

        /* --------------------------------------------------------------------
         * Layer: Tonhöhen-Markierungen
         * ----------------------------------------------------------------- */

        /**
         * Zwei Musiknoten links und rechts neben der unteren Feldhälfte.
         *
         * Sie beantworten die einzige Frage, die neue Spielerinnen vor dem
         * ersten Ballwechsel haben: welcher Ton schickt mich wohin. Links
         * (tiefer Ton) und rechts (hoher Ton) markieren die beiden Enden des
         * kalibrierten Stimmumfangs.
         *
         * PARADIGMENWECHSEL: Sie liegen NICHT mehr flach auf dem Platz. Früher
         * liefen alle Punkte durch `proj.project()` und wurden zusätzlich in
         * der Höhe gestaucht, damit sie wie aufgemalte Bodenmarkierungen
         * wirkten. Jetzt sind es Overlay-Elemente wie das HUD: unverzerrte,
         * aufrechte Noten, gezeichnet allein über `viewport.toScreen()`.
         *
         * Der Unterschied ist nicht nur optisch. Über toScreen() bleibt eine
         * Note bei jeder Auflösung an derselben Stelle im Bild; über project()
         * wanderte sie mit jeder Änderung der Projektionstiefe mit.
         */
        drawPitchIndicators(audio) {
            /* Feste Bildschirmposition, NICHT aus COURT_LEFT abgeleitet.
               Seit die Vertikale projektiv abgebildet wird, liegen Welt- und
               Bildschirmkoordinaten weit auseinander: Weltmitte y=500 erscheint
               bei y=378. Eine aus Weltmaßen berechnete Overlay-Position wandert
               dadurch in den Platz hinein.

               Die beiden Noten stehen auf UNTERSCHIEDLICHER Höhe, und das ist
               die eigentliche Aussage: TIEF steht vorn bei Andrea, HOCH hinten
               auf Alex' Hälfte. Wer die Tiefe des Platzes liest, liest damit
               zugleich die Tonhöhe — vorn tief, hinten hoch. Nebenbei geht die
               linke Note so der Pausenbank aus dem Weg. */
            /* X wird aus der PLATZKANTE in der jeweiligen Höhe abgeleitet, nicht
               fest gesetzt. Ein fester Abstand zur Bildmitte kann nicht
               stimmen: der Platz ist oben schmal (x 1099 an der rechten Kante
               bei y=300) und unten breit (x 1264 bei y=620). Die hohe Note
               stand mit festem Abstand bei x=1420 und damit mitten auf der
               Tribüne — das Grün endet dort bereits bei 1371. */
            const leftX = this.courtEdgeX(Renderer.PITCH_NOTE_Y_LOW, -1)
                - Renderer.PITCH_NOTE_MARGIN;

            /* Rechts reicht ein fester Abstand NICHT. Das Visual ist hoch
               (Notenkopf, Hals, Beschriftung), und der Grünstreifen rechts ist
               oben deutlich schmaler als unten: bei y=193 endet er bei x=1261,
               bei y=370 erst bei x=1437. Mit dem nominellen Abstand stand die
               Note oben in der Tribüne.

               Deshalb wird der Nennwert in einen Korridor geklemmt:
                 - innen  die Seitenlinie auf Höhe der UNTERKANTE des Visuals
                          (dort liegt sie am weitesten rechts),
                 - außen  die Bandenkante auf Höhe der OBERKANTE
                          (dort liegt sie am weitesten links).
               Beides sind die jeweils engsten Stellen — passt es dort, passt
               es überall dazwischen. */
            const rightX = this.pitchRightX();

            /* Wie nah der gesungene Ton am jeweiligen Kalibrierpunkt liegt. */
            const hz = audio ? audio.stablePitch : 0;
            const lowHit = Renderer.isNear(hz, CONFIG.minFreq);
            const highHit = Renderer.isNear(hz, CONFIG.maxFreq);

            /* Tiefer Ton, links: Kopf unten, Hals rechts am Kopf nach oben. */
            this.drawPitchNote(leftX, Renderer.PITCH_NOTE_Y_LOW, true, lowHit);
            /* Hoher Ton, rechts: Kopf oben, Hals links am Kopf nach unten. */
            this.drawPitchNote(rightX, Renderer.PITCH_NOTE_Y_HIGH, false, highHit);

            this.drawPitchLabel('TIEF', leftX, Renderer.PITCH_NOTE_Y_LOW, lowHit);
            this.drawPitchLabel('HOCH', rightX, Renderer.PITCH_NOTE_Y_HIGH, highHit);
        }

        /**
         * X-Position der Platzkante auf einer gegebenen BILDSCHIRM-Höhe.
         *
         * Umkehrung der Projektion: aus `py = HORIZON_Y + DEPTH_SPAN · scale3D`
         * folgt `scale3D = (py − HORIZON_Y) / DEPTH_SPAN`, und die halbe
         * Feldbreite ist COURT_WIDTH/2 mal diesem Faktor. Gilt für jede Höhe,
         * auch außerhalb der Grundlinien.
         *
         * @param   {number} screenY Virtuelle Y-Koordinate
         * @param   {number} side    -1 = linke Kante, +1 = rechte Kante
         * @returns {number} Virtuelle X-Koordinate
         */
        courtEdgeX(screenY, side) {
            const scale3D = (screenY - HORIZON_Y) / DEPTH_SPAN;
            return (VIRTUAL_WIDTH / 2) + side * (COURT_WIDTH / 2) * scale3D;
        }

        /**
         * X-Position des rechten Tonhöhen-Visuals ("HOCH").
         *
         * Eigene Methode, damit die Entwickler-Tests dieselbe Rechnung prüfen
         * können, die auch gezeichnet wird — eine nachgebaute Formel im Test
         * würde eine Verschiebung im Renderer nicht bemerken.
         *
         * @returns {number} Virtuelle X-Koordinate der Notenmitte
         */
        pitchRightX() {
            const mass = this.pitchVisualMetrics('HOCH');
            const oben = Renderer.PITCH_NOTE_Y_HIGH - mass.oben;
            const unten = Renderer.PITCH_NOTE_Y_HIGH + mass.unten;

            /* Innen die Seitenlinie an der UNTERKANTE (dort am weitesten
               rechts), außen die Bande an der OBERKANTE (dort am weitesten
               links). Beides die jeweils engste Stelle. */
            const innen = this.courtEdgeX(unten, 1) + mass.halbBreite
                + Renderer.PITCH_APRON_SAFETY;
            const aussen = Renderer.apronRightAt(oben) - mass.halbBreite
                - Renderer.PITCH_APRON_SAFETY;
            const nenn = this.courtEdgeX(Renderer.PITCH_NOTE_Y_HIGH, 1)
                + Renderer.PITCH_NOTE_MARGIN;
            return Math.max(innen, Math.min(aussen, nenn));
        }

        /**
         * Ausdehnung eines Tonhöhen-Visuals in virtuellen Pixeln.
         *
         * Gemessen wird gegen den Ankerpunkt (`baseY` der Note), weil die
         * Platzierung genau diesen Punkt setzt. Die Breite der Beschriftung
         * kommt aus `measureText` statt aus einer Schätzung — sie hängt an der
         * Schrift, und ob Impact geladen ist, entscheidet sich erst zur
         * Laufzeit.
         *
         * @param   {string} text Beschriftung ("TIEF" / "HOCH")
         * @returns {{oben:number, unten:number, halbBreite:number}}
         */
        pitchVisualMetrics(text) {
            const ctx = this.ctx;
            const gr = Renderer.PITCH_LABEL_SIZE;

            ctx.save();
            ctx.font = this.font(gr);
            const textBreite = ctx.measureText(text).width;
            ctx.restore();

            const ry = Renderer.PITCH_NOTE_RADIUS * Renderer.PITCH_NOTE_HEAD_RATIO;
            return {
                /* Oberkante: Halslänge plus halber Notenkopf. */
                oben: Renderer.PITCH_NOTE_STEM + ry,
                /* Unterkante: Beschriftung, mittig auf ihrer Grundlinie. */
                unten: Renderer.PITCH_LABEL_OFFSET + gr / 2,
                halbBreite: Math.max(Renderer.PITCH_NOTE_RADIUS, textBreite / 2),
            };
        }

        /**
         * Beschriftung unter einer Tonhöhen-Markierung.
         *
         * @param {string}  text
         * @param {number}  cx    Virtuelle X-Koordinate der Notenmitte
         * @param {number}  baseY Virtuelle Y-Koordinate der Glyphen-Unterkante
         * @param {boolean} [hit] true = der Kalibrierpunkt wird gerade getroffen
         */
        drawPitchLabel(text, cx, baseY, hit) {
            const ctx = this.ctx;
            const p = this.viewport.toScreen(cx, baseY + Renderer.PITCH_LABEL_OFFSET, this._p1);

            ctx.save();
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.font = this.font(Renderer.PITCH_LABEL_SIZE * p.scale);
            if (hit) {
                ctx.shadowColor = Renderer.PITCH_HIT_COLOR;
                ctx.shadowBlur = Renderer.PITCH_HIT_GLOW * p.scale;
                ctx.fillStyle = Renderer.PITCH_HIT_COLOR;
            } else {
                ctx.fillStyle = Renderer.PITCH_NOTE_COLOR;
            }
            ctx.fillText(text, p.x, p.y);
            ctx.restore();
        }

        /**
         * Eine aufrechte Viertelnote im Overlay-Stil.
         *
         * Keine Projektion, keine Stauchung, keine Neigung: die Note steht
         * senkrecht im Bild wie ein Notenkopf auf einem Notenblatt. Alle Maße
         * sind virtuelle Pixel und werden nur mit der Letterbox-Skalierung
         * multipliziert.
         *
         * Halsrichtung nach Notensatz-Regel: tiefe Note = Hals rechts nach
         * oben, hohe Note = Hals links nach unten.
         *
         * @param {number}  cx      Virtuelle X-Koordinate der Notenmitte
         * @param {number}  baseY   Virtuelle Y-Koordinate der Glyphen-UNTERKANTE
         * @param {boolean} stemUp  true = tiefer Ton (Hals rechts, nach oben)
         * @param {boolean} [hit]   true = der zugehörige Kalibrierton liegt an
         */
        drawPitchNote(cx, baseY, stemUp, hit) {
            const ctx = this.ctx;
            const p = this.viewport.toScreen(cx, baseY, this._p1);
            const s = p.scale;
            const r = Renderer.PITCH_NOTE_RADIUS * s;
            const ry = r * Renderer.PITCH_NOTE_HEAD_RATIO;
            const stemLen = Renderer.PITCH_NOTE_STEM * s;

            /* Beide Varianten füllen dasselbe Höhenband, nur spiegelverkehrt:
               beim tiefen Ton sitzt der Kopf unten, beim hohen oben. */
            const headY = stemUp ? p.y : p.y - stemLen;
            const tipY = stemUp ? p.y - stemLen : p.y;
            const stemX = stemUp ? p.x + r * 0.92 : p.x - r * 0.92;

            ctx.save();
            /* Getroffen = die Note leuchtet. Das ist die einzige Rückmeldung,
               an der die Sängerin ohne Zahlen erkennt, dass sie ihren
               kalibrierten Rand erreicht hat. */
            const color = hit ? Renderer.PITCH_HIT_COLOR : Renderer.PITCH_NOTE_COLOR;
            if (hit) {
                ctx.shadowColor = Renderer.PITCH_HIT_COLOR;
                ctx.shadowBlur = Renderer.PITCH_HIT_GLOW * s;
            }
            ctx.fillStyle = color;
            ctx.strokeStyle = color;

            /* --- Notenkopf ------------------------------------------------- */
            ctx.beginPath();
            ctx.ellipse(p.x, headY, r, ry, 0, 0, Math.PI * 2);
            ctx.fill();

            /* --- Notenhals: senkrecht an der Seite des Kopfes --------------- */
            ctx.lineWidth = Renderer.PITCH_NOTE_STEM_WIDTH * s;
            ctx.lineCap = 'round';
            ctx.beginPath();
            ctx.moveTo(stemX, headY);
            ctx.lineTo(stemX, tipY);
            ctx.stroke();

            ctx.restore();
        }

        /* --------------------------------------------------------------------
         * Layer: Personal (Schiedsrichter, Ballkinder)
         * ----------------------------------------------------------------- */

        /**
         * Vier Ballkinder in den Ecken.
         * SPRITE-HOOK: `ballboy` im Manifest ersetzt die Primitive.
         *
         * Der Schiedsrichterstuhl ist entfallen. Er stand links auf Netzhöhe —
         * genau dort, wo jetzt die Tonhöhen-Markierung liegt.
         */
        drawStaff() {
            const ctx = this.ctx;

            /* Ballkinder, Schiedsrichterstuhl und Bank stehen bereits im
               Hintergrundbild. */
            if (this.hasCourtBackdrop()) return;

            const cLeft = COURT_LEFT - ALLEY_WIDTH;
            const cRight = COURT_RIGHT + ALLEY_WIDTH;

            /* --- Ballkinder (vier Ecken, außerhalb der Doppelfeldlinien) --- */
            const spots = Renderer.BALLBOY_SPOTS;
            for (let i = 0; i < spots.length; i++) {
                const bx = spots[i].right ? cRight + 30 : cLeft - 30;
                const by = spots[i].top ? COURT_TOP - 30 : COURT_BOTTOM + 30;
                const p = this.proj.project(bx, by, 0, this._p1);

                if (this.assets.isReady('ballboy')) {
                    this.blitWorldSprite('ballboy', p, 45);
                    continue;
                }
                ctx.save();
                ctx.translate(p.x, p.y);
                ctx.scale(p.scale3D, p.scale3D);
                ctx.fillStyle = 'rgba(0,0,0,0.3)';
                ctx.beginPath(); ctx.ellipse(0, 5, 15, 5, 0, 0, Math.PI * 2); ctx.fill();
                ctx.fillStyle = '#0055ff'; ctx.fillRect(-10, -25, 20, 25);
                ctx.fillStyle = '#ffccaa';
                ctx.beginPath(); ctx.arc(0, -32, 8, 0, Math.PI * 2); ctx.fill();
                ctx.restore();
            }
        }

        /**
         * Netz inkl. Schatten, Bespannung und Pfosten.
         * SPRITE-HOOK: `net` im Manifest ersetzt die gesamte Routine.
         */
        drawNet() {
            const ctx = this.ctx;

            /* Das Netz ist Teil des Hintergrundbildes. */
            if (this.hasCourtBackdrop()) return;

            /* Die Pfosten stehen in der MITTE der Doppelgasse, nicht außerhalb
               des Platzes. Vorher lagen sie eine volle Gassenbreite plus 20 px
               jenseits der Doppellinie — das Netz war damit rund 190 px breiter
               als der Platz und schnitt optisch in den Außenbereich.
               Nachgemessen in der Vorlage: der rechte Pfosten sitzt dort bei
               x=958, zwischen Einzellinie (907) und Doppellinie (982). */
            const lx = COURT_LEFT + ALLEY_WIDTH / 2;
            const rx = COURT_RIGHT - ALLEY_WIDTH / 2;

            const nl = this.proj.project(lx, COURT_MID_Y, 0, this._p1);
            const nlx = nl.x, nly = nl.y, nlScale = nl.scale3D;
            const nr = this.proj.project(rx, COURT_MID_Y, 0, this._p2);
            const nrx = nr.x, nry = nr.y;
            const tl = this.proj.project(lx, COURT_MID_Y, 35, this.proj.scratchA);
            const tlx = tl.x, tly = tl.y, tlScale = tl.scale3D;
            const tr = this.proj.project(rx, COURT_MID_Y, 35, this.proj.scratchB);
            const trx = tr.x, try_ = tr.y, trScale = tr.scale3D;

            if (this.assets.isReady('net')) {
                const img = this.assets.get('net');
                ctx.drawImage(img, nlx, tly, nrx - nlx, nly - tly);
                return;
            }

            ctx.save();
            ctx.fillStyle = 'rgba(0,0,0,0.3)';
            ctx.beginPath();
            ctx.moveTo(nlx, nly); ctx.lineTo(nrx, nry);
            ctx.lineTo(nrx, nry + 10); ctx.lineTo(nlx, nly + 10);
            ctx.fill();

            /* Bespannung: dunkle Fläche statt heller — im Referenzbild ist das
               Netz ein dunkles Geflecht mit hellem Abschlussband oben. Die
               helle Variante zuvor wirkte auf dem Rasen wie ein Schleier. */
            ctx.fillStyle = 'rgba(18, 30, 24, 0.62)';
            ctx.beginPath();
            ctx.moveTo(nlx, nly); ctx.lineTo(nrx, nry);
            ctx.lineTo(trx, try_); ctx.lineTo(tlx, tly);
            ctx.fill();

            /* Geflecht: senkrechte + waagerechte Linien ergeben das typische
               Rautenmuster (siehe Referenzbild). */
            ctx.strokeStyle = 'rgba(210, 225, 215, 0.30)';
            ctx.lineWidth = Math.max(1, 0.9 * ((tlScale + trScale) / 2));
            const meshCols = 60;
            for (let i = 1; i < meshCols; i++) {
                const t = i / meshCols;
                ctx.beginPath();
                ctx.moveTo(nlx + (nrx - nlx) * t, nly + (nry - nly) * t);
                ctx.lineTo(tlx + (trx - tlx) * t, tly + (try_ - tly) * t);
                ctx.stroke();
            }
            const meshRows = 7;
            for (let j = 1; j < meshRows; j++) {
                const t = j / meshRows;
                ctx.beginPath();
                ctx.moveTo(nlx + (tlx - nlx) * t, nly + (tly - nly) * t);
                ctx.lineTo(nrx + (trx - nrx) * t, nry + (try_ - nry) * t);
                ctx.stroke();
            }

            /* Weißes Abschlussband oben — im Original das markanteste Merkmal. */
            ctx.strokeStyle = LINE_COLOR;
            ctx.lineWidth = 6 * ((tlScale + trScale) / 2);
            ctx.beginPath(); ctx.moveTo(tlx, tly); ctx.lineTo(trx, try_); ctx.stroke();

            ctx.strokeStyle = '#444';
            ctx.lineWidth = 6 * nlScale;
            ctx.beginPath(); ctx.moveTo(nlx, nly); ctx.lineTo(tlx, tly); ctx.stroke();
            ctx.beginPath(); ctx.moveTo(nrx, nry); ctx.lineTo(trx, try_); ctx.stroke();
            ctx.restore();
        }

        /* --------------------------------------------------------------------
         * Layer: Ball und Marken
         * ----------------------------------------------------------------- */

        /** @param {BounceMarks} marks */
        drawBounceMarks(marks) {
            const ctx = this.ctx;
            const items = marks.items;
            for (let i = 0; i < items.length; i++) {
                const m = items[i];
                const p = this.proj.project(m.x, m.y, 0, this._p1);
                ctx.fillStyle = `rgba(255, 255, 255, ${m.alpha * 0.4})`;
                ctx.beginPath();
                ctx.ellipse(p.x, p.y, 15 * p.scale3D, 5 * p.scale3D, 0, 0, Math.PI * 2);
                ctx.fill();
            }
        }

        /** @param {Ball} ball */
        drawBall(ball) {
            const ctx = this.ctx;

            /* Schatten am Boden — schrumpft mit zunehmender Flughöhe. */
            const ground = this.proj.project(ball.x, ball.y, 0, this._p1);
            const shadowRadius = Math.max(2, ball.radius - (ball.z * 0.15));
            ctx.fillStyle = 'rgba(0, 0, 0, 0.4)';
            ctx.beginPath();
            ctx.ellipse(
                ground.x, ground.y,
                shadowRadius * ground.scale3D,
                (shadowRadius * 0.5) * ground.scale3D,
                0, 0, Math.PI * 2
            );
            ctx.fill();

            /* Ball auf Flughöhe. */
            const air = this.proj.project(ball.x, ball.y, ball.z, this._p2);
            if (this.assets.isReady('ball')) {
                this.blitWorldSprite('ball', air, ball.radius * 2, true);
                return;
            }
            ctx.fillStyle = ball.isSmash ? '#ff3300' : ACCENT_YELLOW;
            ctx.beginPath();
            ctx.arc(air.x, air.y, ball.radius * air.scale3D, 0, Math.PI * 2);
            ctx.fill();
            ctx.strokeStyle = '#000';
            ctx.lineWidth = 2 * air.scale3D;
            ctx.stroke();
        }

        /* --------------------------------------------------------------------
         * Layer: Spielerfiguren
         * ----------------------------------------------------------------- */

        /** @param {Object} scene */
        drawPlayers(scene) {
            const match = scene.match;

            let andreaScale = 1, alexScale = 1;
            let andreaEmotion = 'neutral', alexEmotion = 'neutral';
            let andreaY = 0, alexY = 0;

            if (match.state === STATE.POINT_SCORED) {
                const elapsed = match.elapsed();
                const ease = Math.min(1, elapsed / 500);
                const showEmotion = elapsed > 300;
                if (match.lastWinner === PLAYER.ANDREA) {
                    andreaScale = 1 + (0.3 * ease);
                    alexScale = 1 - (0.15 * ease);
                    andreaEmotion = showEmotion ? 'win' : 'neutral';
                    alexEmotion = showEmotion ? 'lose' : 'neutral';
                    alexY = 20 * ease;
                } else {
                    alexScale = 1 + (0.3 * ease);
                    andreaScale = 1 - (0.15 * ease);
                    alexEmotion = showEmotion ? 'win' : 'neutral';
                    andreaEmotion = showEmotion ? 'lose' : 'neutral';
                    andreaY = 20 * ease;
                }
            }

            /* Im Bumper blinken die Figuren kurz weg. */
            if (match.state === STATE.TRANSITION) {
                const p = match.elapsed() / TIMING.TRANSITION_MS;
                if (p > 0.1 && p < 0.3) return;
            }

            /* Z-Sortierung: kleineres Y = weiter hinten = zuerst zeichnen. */
            if (scene.paddleAlex.y < scene.paddleAndrea.y) {
                this.drawPlayer(scene.paddleAlex.x, scene.paddleAlex.y, false, alexScale, alexEmotion, alexY);
                this.drawPlayer(scene.andreaX, scene.paddleAndrea.y, true, andreaScale, andreaEmotion, andreaY);
            } else {
                this.drawPlayer(scene.andreaX, scene.paddleAndrea.y, true, andreaScale, andreaEmotion, andreaY);
                this.drawPlayer(scene.paddleAlex.x, scene.paddleAlex.y, false, alexScale, alexEmotion, alexY);
            }
        }

        /**
         * Eine Spielerfigur: Bodenschatten, Körperbild, Foto-Kopf.
         *
         * Zwei Dinge unterscheiden sich bewusst von der Ursprungsfassung:
         *
         * 1. TIEFENDÄMPFUNG. Die Figurengröße folgt der Projektion nur zu
         *    `FIGURE_DEPTH_COMPRESSION`, nicht voll. Sonst ist die hintere
         *    Spielerin nur noch ein Drittel so groß wie die vordere und
         *    verschwindet optisch. Die POSITION bleibt voll perspektivisch —
         *    es verschiebt sich nichts, die Figuren stehen weiterhin exakt
         *    dort, wo die Physik sie verortet.
         *
         * 2. CONTAIN-FIT FÜR KÖPFE. Die Kopfgröße wird in eine feste Box
         *    eingepasst statt über die Bildhöhe berechnet. Die gelieferten
         *    Foto-Ausschnitte haben unterschiedliche Seitenverhältnisse; ein
         *    Querformat-Crop wurde nach der alten Formel absurd breit und
         *    schob sich neben den Körper.
         *
         * @param {number}  vx        Weltposition X
         * @param {number}  vy        Weltposition Y
         * @param {boolean} isAndrea  true = untere Spielerin
         * @param {number}  animScale Zusätzliche Skalierung (Jubel/Enttäuschung)
         * @param {string}  emotion   'neutral' | 'win' | 'lose'
         * @param {number}  animY     Vertikaler Versatz (Einsacken)
         */
        drawPlayer(vx, vy, isAndrea, animScale, emotion, animY) {
            const ctx = this.ctx;
            const p = this.proj.project(vx, vy, 0, this._p1);

            /* Reiner Tiefenfaktor ohne Fenster-Skalierung: 0.65 hinten,
               1.35 vorne. Wird gedämpft und danach wieder mit der
               Fenster-Skalierung multipliziert. */
            const depth = p.scale3D / this.viewport.scale;
            const damped = 1 + (depth - 1) * FIGURE_DEPTH_COMPRESSION;
            const s = damped * this.viewport.scale * animScale;

            ctx.save();
            ctx.translate(p.x, p.y);
            ctx.scale(s, s);

            /* --- Bodenschatten ------------------------------------------------
             * Sitzt EXAKT auf der physikalischen Position (lokal y = 0), also
             * dort, wo die Hitbox steht. Vorher lag er bei y = +8 und damit
             * acht Pixel UNTER den Füßen — der erste Teil des Schwebens.
             * Bewusst vor dem animY-Versatz: der Schatten bleibt am Boden,
             * auch wenn die Figur beim Punktverlust einsackt.
             * ---------------------------------------------------------------- */
            ctx.fillStyle = 'rgba(0, 0, 0, 0.4)';
            ctx.beginPath();
            ctx.ellipse(0, 0, 34, 9, 0, 0, Math.PI * 2);
            ctx.fill();

            ctx.translate(0, animY);

            /* --- Körper -------------------------------------------------------
             * Der zweite und größere Teil des Schwebens steckte in den Sprites
             * selbst: beide PNGs haben transparenten Rand UNTER den Füßen
             * (gemessen 8.5 % bei Andrea, 11.3 % bei Alex). Wer das Bild
             * schlicht mit seiner Unterkante auf y = 0 setzt, stellt die Figur
             * genau um diesen Rand zu hoch — bei BODY_HEIGHT = 118 sind das
             * 10 bzw. 13 px.
             *
             * Deshalb wird nicht das BILD, sondern der SICHTBARE Teil auf
             * BODY_HEIGHT normiert und so verschoben, dass die Füße auf y = 0
             * stehen. Nebeneffekt: beide Figuren sind jetzt tatsächlich gleich
             * groß, vorher unterschieden sie sich um den Anteil ihrer Ränder.
             * ---------------------------------------------------------------- */
            const bodyKey = isAndrea ? 'body_andrea' : 'body_alex';
            const shoulderY = -Renderer.BODY_HEIGHT * SHOULDER_RATIO;
            if (this.assets.isReady(bodyKey)) {
                const img = this.assets.get(bodyKey);
                const pad = Renderer.BODY_PADDING[bodyKey] || { top: 0, bottom: 0 };
                const visible = 1 - pad.top - pad.bottom;

                const h = Renderer.BODY_HEIGHT / visible;   // volle Bildhöhe
                const w = h * (img.naturalWidth / img.naturalHeight);
                /* Unterkante des BILDES liegt um den leeren Rand tiefer, damit
                   die Unterkante der FÜSSE bei y = 0 landet. */
                ctx.drawImage(img, -w / 2, -h + h * pad.bottom, w, h);
            }

            /* Kopf: in HEAD_BOX eingepasst, Unterkante auf der Schulter —
               verdeckt damit den gezeichneten Kopf der Figur. */
            const headKey = this.resolveHeadKey(isAndrea, emotion);
            if (this.assets.isReady(headKey)) {
                const img = this.assets.get(headKey);
                const fit = Math.min(
                    HEAD_BOX.width / img.naturalWidth,
                    HEAD_BOX.height / img.naturalHeight
                );
                const w = img.naturalWidth * fit;
                const h = img.naturalHeight * fit;
                ctx.drawImage(img, -w / 2, shoulderY - h, w, h);
            }

            ctx.restore();
        }

        /**
         * Passenden Kopf-Asset-Key ermitteln, mit Rückfall auf 'neutral',
         * falls die Emotionsdatei fehlt.
         * @param   {boolean} isAndrea
         * @param   {string}  emotion
         * @returns {string}
         */
        resolveHeadKey(isAndrea, emotion) {
            const base = isAndrea ? 'head_andrea_' : 'head_alex_';
            if (emotion !== 'neutral' && this.assets.isReady(base + emotion)) {
                return base + emotion;
            }
            return base + 'neutral';
        }

        /* --------------------------------------------------------------------
         * Layer: HUD und Overlays
         * ----------------------------------------------------------------- */

        /**
         * Scoreboard als TV-Bauchbinde unten links.
         *
         * Optik nach der Vorlage `Vorgabe_Platz.png`: dunkelblauer Kasten mit
         * abgerundeten Ecken, senkrechtem Verlauf, hellem Rahmen und einem
         * Glanzstrich an der Oberkante; zwei Zeilen, getrennt durch eine dünne
         * Linie. Die Maße sind aus der Vorlage übernommen und auf 1600x900
         * umgerechnet (dort 310x64 px bei 1372x768).
         *
         * Angepasst an UNSER Spiel: die Vorlage zeigt pro Zeile Setzliste,
         * Name, Länderkürzel, Flagge und EINE Zahl. Wir haben keine Nationen,
         * dafür zwei Zahlen — Sätze und Punkte. Übernommen ist deshalb die
         * Rhythmik der rechten Seite (Ball, dann Zahlen), nicht ihr Inhalt.
         *
         * Die Zahlenspalten sind rechtsbündig: nur so bleiben sie an
         * derselben Stelle stehen, wenn aus "0" ein "40" oder "ADV" wird.
         * @param {MatchState} match
         */
        drawHud(match, audio, audio2) {
            const ctx = this.ctx;
            const p = this.viewport.toScreen(Renderer.HUD_X, Renderer.HUD_Y, this._p1);
            const s = p.scale;
            const w = Renderer.HUD_WIDTH * s;
            const h = Renderer.HUD_HEIGHT * s;
            const rowH = h / 2;
            const pad = Renderer.HUD_PAD * s;
            const radius = Renderer.HUD_RADIUS * s;

            ctx.save();
            ctx.textBaseline = 'middle';

            /* --- Kasten ---------------------------------------------------- */
            const grad = ctx.createLinearGradient(p.x, p.y, p.x, p.y + h);
            grad.addColorStop(0, Renderer.HUD_BG_TOP);
            grad.addColorStop(1, Renderer.HUD_BG_BOTTOM);
            this.roundRectPath(p.x, p.y, w, h, radius);
            ctx.fillStyle = grad;
            ctx.fill();

            /* Rahmen. In der Vorlage ist er kein harter Strich, sondern ein
               heller Rand um einen sehr dunklen Kasten — er trennt die Grafik
               vom Rasen, ohne sie einzurahmen wie ein Fenster. */
            ctx.strokeStyle = Renderer.HUD_BORDER;
            ctx.lineWidth = Math.max(1, 1.5 * s);
            ctx.stroke();

            /* Glanzstrich an der Oberkante — in der Vorlage das Detail, das
               den Kasten aus Glas statt aus Pappe wirken lässt. */
            ctx.beginPath();
            ctx.moveTo(p.x + radius, p.y + 1.5 * s);
            ctx.lineTo(p.x + w - radius, p.y + 1.5 * s);
            ctx.strokeStyle = 'rgba(255, 255, 255, 0.22)';
            ctx.lineWidth = Math.max(1, 1.5 * s);
            ctx.stroke();

            /* Trennlinie zwischen den beiden Spielerzeilen. */
            ctx.fillStyle = 'rgba(255, 255, 255, 0.13)';
            ctx.fillRect(p.x + pad * 0.5, p.y + rowH, w - pad, Math.max(1, 1 * s));

            const nameX = p.x + pad;
            const pointsX = p.x + w - pad;
            const setsX = pointsX - Renderer.HUD_POINTS_COL * s;

            /* Alex oben, Andrea unten — dieselbe Reihenfolge wie in der
               Großanzeige (scoreLine liest sich "ALEX - ANDREA"). */
            const rows = [
                {
                    name: 'ALEX',
                    sets: match.sets.alex,
                    points: MatchState.tennisScore(match.score.alex, match.score.andrea),
                    isServing: match.server === PLAYER.ALEX
                },
                {
                    name: 'ANDREA',
                    sets: match.sets.andrea,
                    points: MatchState.tennisScore(match.score.andrea, match.score.alex),
                    isServing: match.server === PLAYER.ANDREA
                }
            ];

            for (let i = 0; i < rows.length; i++) {
                const row = rows[i];
                const cy = p.y + rowH * i + rowH / 2;

                /* Die Bauchbinde bleibt vollständig in der Groteske der
                   Vorlage. Der Gothic-Stil gilt nur für den Countdown. */
                ctx.textAlign = 'left';
                ctx.fillStyle = '#ffffff';
                ctx.font = this.font(Renderer.HUD_NAME_SIZE * s, 'bold', Renderer.HUD_FONT);
                ctx.fillText(row.name, nameX, cy);

                /* Aufschlagsymbol: der Ball steht in der Zeile dessen, der
                   aufschlägt — dieselbe Konvention wie in der Vorlage und in
                   jeder Fernsehübertragung. */
                if (row.isServing) {
                    this.drawTennisBallIcon(
                        setsX - Renderer.HUD_SERVE_DOT_OFFSET * s, cy,
                        Renderer.HUD_SERVE_DOT_R * s
                    );
                }

                ctx.textAlign = 'right';
                ctx.fillStyle = 'rgba(255, 255, 255, 0.72)';
                ctx.font = this.font(Renderer.HUD_SETS_SIZE * s, 'bold', Renderer.HUD_FONT);
                ctx.fillText(String(row.sets), setsX, cy);

                /* "DEUCE" ist ein Zustand beider Spielerinnen, kein Wert einer
                   einzelnen — in der Spaltendarstellung steht dort wie im
                   echten Tennis auf beiden Seiten 40, der Vorteil erscheint
                   als ADV in genau einer Zeile. */
                ctx.fillStyle = ACCENT_YELLOW;
                ctx.font = this.font(Renderer.HUD_POINTS_SIZE * s, 'bold', Renderer.HUD_FONT);
                ctx.fillText(row.points === 'DEUCE' ? '40' : row.points, pointsX, cy);
            }

            ctx.restore();

            if (match.isWarmup) this.drawKeyboards(audio, audio2);
        }

        /* --------------------------------------------------------------------
         * Layer: Klaviatur (nur im Einspielen)
         * ----------------------------------------------------------------- */

        /**
         * Tonhöhen-Rückmeldung im Spiel: NUR die getroffene Taste.
         *
         * Bis V40 stand hier eine vollständige Klaviatur über und unter dem
         * Platz. Sie erklärte die Steuerung gut, rückte das Bild aber weit weg
         * von einer Tennisübertragung — man sah zwei Instrumente und dazwischen
         * ein Spielfeld. Jetzt leuchtet nur die Taste auf, die gerade gesungen
         * wird; sie steht weiterhin exakt über der Feldposition, zu der dieser
         * Ton die Figur schickt.
         *
         * Die volle Klaviatur bleibt im Onboarding — dort ist sie das
         * Werkzeug, mit dem der Stimmumfang eingesungen und geprüft wird.
         *
         * Lage und Umfang kommen weiterhin aus dem kalibrierten Bereich, damit
         * die leuchtende Taste an der richtigen Stelle sitzt.
         *
         * BEWUSST GLEICH BREITE TASTEN statt echter Klaviaturgeometrie. Auf
         * einem Klavier sind die weißen Tasten ungleich verteilt (zwischen E/F
         * und H/C fehlt die schwarze). Unsere Steuerung bildet die Tonhöhe
         * aber LINEAR in Halbtönen auf die X-Position ab. Eine echte
         * Klaviaturgeometrie stünde deshalb neben der Position, zu der der Ton
         * die Figur schickt — die Tastatur würde in die Irre führen. So wie
         * jetzt liegt jede Taste exakt über "ihrer" Feldposition.
         *
         * @param {AudioEngine} [audio]
         */
        drawKeyboards(audio, audio2) {
            const liveMidi = Renderer.liveMidiOf(audio);
            const scale = this.viewport.scale;

            /* Jede Tastatur spannt über die Feldbreite in IHRER Tiefe — die
               vordere ist dadurch breiter als die hintere, wie der Platz. */
            const near = this.viewport.toScreen(0, Renderer.KEYS_Y_NEAR, this.proj.scratchA);
            const nl = this.proj.project(COURT_LEFT, COURT_BOTTOM, 0, this._p1).x;
            const nr = this.proj.project(COURT_RIGHT, COURT_BOTTOM, 0, this._p2).x;
            const unten = Renderer.keyboardSpan(PLAYER.ANDREA, nl, nr - nl);
            if (unten) {
                this.drawKeyboardStrip(unten.x, near.y, unten.w,
                    Renderer.KEYS_HEIGHT_NEAR * scale,
                    unten.minMidi, unten.maxMidi, liveMidi, null, true);
            }

            /* Die obere Tastatur gehört im Versus-Modus Spieler 2 und zeigt
               dessen Umfang und dessen Ton. Im Arcade-Modus hat die KI keine
               Stimme — dort bleibt es bei Andreas Umfang, wie bisher. */
            const versus = CONFIG.mode === MODE.VERSUS;
            const far = this.viewport.toScreen(0, Renderer.KEYS_Y_FAR, this.proj.scratchA);
            const fl = this.proj.project(COURT_LEFT, COURT_TOP, 0, this._p1).x;
            const fr = this.proj.project(COURT_RIGHT, COURT_TOP, 0, this._p2).x;
            const oben = Renderer.keyboardSpan(
                versus ? PLAYER.ALEX : PLAYER.ANDREA, fl, fr - fl);
            if (oben) {
                this.drawKeyboardStrip(oben.x, far.y, oben.w,
                    Renderer.KEYS_HEIGHT_FAR * scale, oben.minMidi, oben.maxMidi,
                    versus ? Renderer.liveMidiOf(audio2) : liveMidi, null, true);
            }
        }

        /**
         * Zwei Tastaturen über und unter dem Onboarding-Kasten.
         *
         * Anders als im Spiel zeigen sie NICHT den kalibrierten Bereich —
         * den gibt es hier ja noch nicht. Sie zeigen drei Oktaven und leuchten
         * bei jedem Ton, den die Sängerin trifft. Genau das fehlte bisher: im
         * Onboarding stand nur eine Zahl in Hertz, mit der niemand etwas
         * anfangen kann. Auf der Klaviatur sieht man sofort, wo man liegt und
         * wie viel Luft nach oben und unten bleibt.
         *
         * Ist ein Kalibrierton bereits gespeichert, wird seine Taste markiert.
         *
         * Die Lage wird aus dem HTML-Kasten gelesen statt fest gesetzt: der
         * Kasten wächst, sobald der zweite Knopf freigeschaltet wird, und die
         * Tastaturen sollen mitwandern. `getBoundingClientRect()` liefert
         * CSS-Pixel, der Canvas ist genauso groß wie das Fenster — die Werte
         * passen also unmittelbar.
         *
         * @param {AudioEngine} audio
         * @param {{top:number, bottom:number, left:number, width:number}} rect
         */
        drawOnboardingKeyboards(audio, rect, player) {
            const liveMidi = Renderer.liveMidiOf(audio);
            const range = Physics.voiceRange(player);

            /* Bereits gespeicherte Kalibriertöne markieren. Der Vergleich auf
               die Vorgabewerte verhindert, dass vor dem ersten Klick zwei
               beliebige Tasten als "gespeichert" markiert erscheinen. */
            const tiefGesetzt = range.min !== Renderer.ONBOARDING_DEFAULT_MIN;
            const hochGesetzt = range.max !== Renderer.ONBOARDING_DEFAULT_MAX;
            const marks = [];
            if (tiefGesetzt) marks.push(Math.round(Renderer.midiOf(range.min)));
            if (hochGesetzt) marks.push(Math.round(Renderer.midiOf(range.max)));

            /* Sobald BEIDE Töne stehen, zeigt die Klaviatur nicht mehr drei
               Oktaven, sondern genau den eingesungenen Bereich — mit zwei
               Tasten Luft links und rechts, damit seine Grenze sichtbar wird.
               Das ist die Visualisierung, gegen die im nächsten Schritt
               entschieden wird: "Range okay!" oder noch einmal. */
            let lo = Renderer.ONBOARDING_MIDI_LOW;
            let hi = Renderer.ONBOARDING_MIDI_HIGH;
            if (tiefGesetzt && hochGesetzt) {
                const span = Renderer.keyboardSpan(player, 0, 1);
                if (span) { lo = span.minMidi; hi = span.maxMidi; }
            }

            const gap = Renderer.KEYS_ONBOARDING_GAP;
            const h = Renderer.KEYS_ONBOARDING_HEIGHT;
            const w = Math.max(rect.width, Renderer.KEYS_ONBOARDING_MIN_WIDTH);
            const x = rect.left + rect.width / 2 - w / 2;

            /* Passt ein Streifen nicht mehr ins Fenster, entfällt er lieber
               ganz, als halb im Bildrand zu kleben. Bei einem niedrigen
               Browserfenster kann der Kasten selbst schon fast die volle Höhe
               brauchen. */
            const topY = rect.top - gap - h;
            const bottomY = rect.bottom + gap;
            if (topY >= gap) {
                this.drawKeyboardStrip(x, topY, w, h, lo, hi, liveMidi, marks);
            }
            if (bottomY + h <= this.viewport.height - gap) {
                this.drawKeyboardStrip(x, bottomY, w, h, lo, hi, liveMidi, marks);
            }
        }

        /**
         * Eine Tastatur als waagerechter Streifen, rein in Bildschirmpixeln.
         *
         * BEWUSST GLEICH BREITE TASTEN statt echter Klaviaturgeometrie. Auf
         * einem Klavier sind die weißen Tasten ungleich verteilt (zwischen E/F
         * und H/C fehlt die schwarze). Unsere Steuerung bildet die Tonhöhe
         * aber LINEAR in Halbtönen auf die X-Position ab. Eine echte
         * Klaviaturgeometrie stünde deshalb neben der Position, zu der der Ton
         * die Figur schickt — die Tastatur würde in die Irre führen. So wie
         * jetzt liegt jede Taste exakt über "ihrer" Feldposition.
         *
         * Zeichenreihenfolge wie bei einem echten Instrument: Korpus, dann
         * Filzstreifen, dann ALLE weißen Tasten, erst danach die schwarzen.
         * Andernfalls überdeckt die nächste weiße Taste den Schlagschatten
         * ihrer schwarzen Nachbarin und der Streifen wirkt flach.
         *
         * @param {number}        x        Linke Kante in Bildschirmpixeln
         * @param {number}        y        Oberkante in Bildschirmpixeln
         * @param {number}        w        Breite in Bildschirmpixeln
         * @param {number}        h        Höhe in Bildschirmpixeln
         * @param {number}        minMidi  Tiefste Taste
         * @param {number}        maxMidi  Höchste Taste
         * @param {number|null}   liveMidi Aktuell gesungener Ton, oder null
         * @param {number[]}      [marks]  MIDI-Noten, die markiert werden
         * @param {boolean} [nurLeuchtende] true = NUR die getroffene Taste,
         *        ohne Korpus, Filz und stumme Tasten (Ansicht im Spiel)
         */
        drawKeyboardStrip(x, y, w, h, minMidi, maxMidi, liveMidi, marks, nurLeuchtende) {
            const ctx = this.ctx;
            const count = maxMidi - minMidi + 1;
            if (count < 2 || w <= 0 || h <= 0) return;

            const keyW = w / count;
            const lit = liveMidi === null ? null : Math.round(liveMidi);
            const pad = h * 0.09;          // Rand des Korpus um die Tasten
            const feltH = h * 0.07;        // Filzstreifen wie am echten Klavier
            const keyTop = y + pad + feltH;
            const keyH = h - pad * 2 - feltH;

            ctx.save();

            /* --- Nur die leuchtende Taste -----------------------------------
             * Im Spiel steht kein Instrument neben dem Platz. Sichtbar ist nur
             * die Taste, die gerade getroffen wird — sie schwebt an ihrer
             * Position über der Grundlinie und zeigt damit weiterhin, wohin
             * der Ton die Figur schickt, ohne dass ein Klavier das Bild
             * dominiert. Korpus, Filz und alle stummen Tasten entfallen.
             * -------------------------------------------------------------- */
            if (nurLeuchtende) {
                if (lit !== null && lit >= minMidi && lit <= maxMidi) {
                    const i = lit - minMidi;
                    this.drawKey(x + i * keyW, keyTop, keyW, keyH,
                        Renderer.isBlackKey(lit), true, false);
                }
                ctx.restore();
                return;
            }

            /* --- Korpus ---------------------------------------------------- */
            this.roundRectPath(x, y, w, h, Math.min(h * 0.16, 10));
            const body = ctx.createLinearGradient(0, y, 0, y + h);
            body.addColorStop(0, '#3a3a4c');
            body.addColorStop(0.5, '#181822');
            body.addColorStop(1, '#0a0a10');
            ctx.fillStyle = body;
            ctx.fill();
            ctx.strokeStyle = 'rgba(255, 255, 255, 0.20)';
            ctx.lineWidth = Math.max(1, h * 0.018);
            ctx.stroke();

            /* Filzstreifen — das schmale farbige Band über den Tasten ist das
               Detail, an dem eine Klaviatur sofort als solche gelesen wird. */
            ctx.fillStyle = Renderer.KEYS_FELT;
            ctx.fillRect(x + pad, y + pad, w - pad * 2, feltH);

            /* --- weiße Tasten ---------------------------------------------- */
            for (let i = 0; i < count; i++) {
                const midi = minMidi + i;
                if (Renderer.isBlackKey(midi)) continue;
                this.drawKey(x + i * keyW, keyTop, keyW, keyH, false,
                    lit === midi, marks && marks.indexOf(midi) !== -1);
            }

            /* --- schwarze Tasten ------------------------------------------- */
            for (let i = 0; i < count; i++) {
                const midi = minMidi + i;
                if (!Renderer.isBlackKey(midi)) continue;
                this.drawKey(x + i * keyW, keyTop, keyW, keyH, true,
                    lit === midi, marks && marks.indexOf(midi) !== -1);
            }

            ctx.restore();
        }

        /**
         * Eine einzelne Taste.
         *
         * @param {number}  slotX  Linke Kante des Halbton-Feldes
         * @param {number}  y      Oberkante der Tasten
         * @param {number}  slotW  Breite des Halbton-Feldes
         * @param {number}  h      Volle Tastenhöhe
         * @param {boolean} black  true = schwarze Taste
         * @param {boolean} lit    true = wird gerade gesungen
         * @param {boolean} marked true = gespeicherter Kalibrierton
         */
        drawKey(slotX, y, slotW, h, black, lit, marked) {
            const ctx = this.ctx;
            const inset = slotW * (black ? 0.20 : 0.045);
            const kx = slotX + inset;
            const kw = slotW - inset * 2;
            const kh = black ? h * 0.62 : h;
            const r = Math.min(kw * 0.28, kh * 0.14);

            ctx.save();

            /* Schwarze Tasten stehen über den weißen und brauchen einen
               Schatten, sonst wirkt der Streifen flach. Bewusst als versetztes
               dunkles Rechteck und NICHT über shadowBlur: der Weichzeichner
               kostet pro Aufruf, und hier laufen bis zu 16 schwarze Tasten je
               Streifen mal 60 Bilder pro Sekunde. Der Schein bleibt der
               leuchtenden Taste vorbehalten, wo man ihn auch sieht. */
            if (black && !lit) {
                const o = Math.max(1, kh * 0.05);
                ctx.fillStyle = 'rgba(0, 0, 0, 0.45)';
                ctx.beginPath();
                ctx.moveTo(kx - o, y);
                ctx.lineTo(kx + kw + o, y);
                ctx.lineTo(kx + kw + o, y + kh + o);
                ctx.lineTo(kx - o, y + kh + o);
                ctx.closePath();
                ctx.fill();
            }
            if (lit) {
                ctx.shadowColor = Renderer.KEYS_LIT_GLOW;
                ctx.shadowBlur = Renderer.KEYS_GLOW * (kw / 18);
            }

            /* Nur unten gerundet — oben schließt die Taste bündig am Filz an. */
            ctx.beginPath();
            ctx.moveTo(kx, y);
            ctx.lineTo(kx + kw, y);
            ctx.lineTo(kx + kw, y + kh - r);
            ctx.arcTo(kx + kw, y + kh, kx + kw - r, y + kh, r);
            ctx.lineTo(kx + r, y + kh);
            ctx.arcTo(kx, y + kh, kx, y + kh - r, r);
            ctx.closePath();

            const g = ctx.createLinearGradient(0, y, 0, y + kh);
            if (lit) {
                g.addColorStop(0, '#ffffff');
                g.addColorStop(0.35, Renderer.KEYS_LIT_COLOR);
                g.addColorStop(1, Renderer.KEYS_LIT_DEEP);
            } else if (black) {
                g.addColorStop(0, '#4a4a5e');
                g.addColorStop(0.25, '#1a1a26');
                g.addColorStop(1, '#050508');
            } else {
                g.addColorStop(0, '#ffffff');
                g.addColorStop(0.75, '#f2f2f7');
                g.addColorStop(1, '#c9c9d8');
            }
            ctx.fillStyle = g;
            ctx.fill();

            ctx.shadowBlur = 0;
            ctx.shadowOffsetY = 0;
            ctx.shadowColor = 'transparent';

            /* Glanzkante an der Oberseite — bei weißen Tasten das, was sie
               plastisch statt wie ein Balken aussehen lässt. */
            if (!black) {
                ctx.strokeStyle = 'rgba(0, 0, 0, 0.16)';
                ctx.lineWidth = Math.max(1, kw * 0.05);
                ctx.stroke();
            }

            /* Markierung eines gespeicherten Kalibriertons. */
            if (marked) {
                ctx.fillStyle = ACCENT_PINK;
                ctx.beginPath();
                ctx.arc(kx + kw / 2, y + kh - kw * 0.55, kw * 0.22, 0, Math.PI * 2);
                ctx.fill();
            }

            ctx.restore();
        }

        /**
         * Pfad eines Rechtecks mit abgerundeten Ecken.
         *
         * Bewusst von Hand statt über ctx.roundRect(): das gibt es erst ab
         * Chrome 99. Auf dem Show-Rechner soll eine ältere Version nicht die
         * komplette Bauchbinde kosten. arcTo() gibt es seit jeher.
         *
         * @param {number} x
         * @param {number} y
         * @param {number} w
         * @param {number} h
         * @param {number} r Eckradius
         */
        roundRectPath(x, y, w, h, r) {
            const ctx = this.ctx;
            const rad = Math.min(r, w / 2, h / 2);
            ctx.beginPath();
            ctx.moveTo(x + rad, y);
            ctx.arcTo(x + w, y, x + w, y + h, rad);
            ctx.arcTo(x + w, y + h, x, y + h, rad);
            ctx.arcTo(x, y + h, x, y, rad);
            ctx.arcTo(x, y, x + w, y, rad);
            ctx.closePath();
        }

        /**
         * Tennisball als Symbol im Scoreboard.
         *
         * In der Vorlage ist es ein echter Ball mit Naht, kein gelber Punkt —
         * die geschwungene weiße Linie ist das, was ihn auf Distanz überhaupt
         * als Tennisball lesbar macht.
         *
         * @param {number} cx Bildschirmkoordinate
         * @param {number} cy Bildschirmkoordinate
         * @param {number} r  Radius in Bildschirmpixeln
         */
        drawTennisBallIcon(cx, cy, r) {
            const ctx = this.ctx;

            ctx.beginPath();
            ctx.arc(cx, cy, r, 0, Math.PI * 2);
            ctx.fillStyle = Renderer.HUD_BALL_COLOR;
            ctx.fill();
            ctx.strokeStyle = Renderer.HUD_BALL_EDGE;
            ctx.lineWidth = Math.max(1, r * 0.14);
            ctx.stroke();

            /* Naht: zwei nach innen gewölbte Bögen an den Seiten. */
            ctx.strokeStyle = 'rgba(255, 255, 255, 0.85)';
            ctx.lineWidth = Math.max(1, r * 0.18);
            ctx.beginPath();
            ctx.arc(cx - r * 1.25, cy, r * 1.05, -0.7, 0.7);
            ctx.stroke();
            ctx.beginPath();
            ctx.arc(cx + r * 1.25, cy, r * 1.05, Math.PI - 0.7, Math.PI + 0.7);
            ctx.stroke();
        }

        /**
         * Live-Audiowerte unten links im Bild.
         *
         * Im Onboarding stehen Tonhöhe und Pegel im HTML-Feld — sobald der
         * Canvas übernimmt, war beides unsichtbar. Genau dann braucht der
         * Operator sie aber: um im laufenden Betrieb zu sehen, ob das
         * Volume-Gate passt und ob überhaupt ein Ton erkannt wird.
         *
         * Angezeigt wird `stablePitch` (also inklusive Haltespeicher), damit
         * die Anzeige beim Luftholen nicht auf 0 zappelt.
         *
         * Steht seit dem Umbau des HUD unten RECHTS: unten links klebt jetzt
         * die Bauchbinde, beides übereinander wäre unlesbar gewesen.
         * @param {AudioEngine} [audio]
         */
        drawAudioDebug(audio) {
            if (!audio) return;

            const ctx = this.ctx;
            /* Bezugspunkt ist die untere rechte Ecke des VIRTUELLEN Bildes,
               nicht die des Canvas — sonst wandert der Text bei Letterboxing
               in den schwarzen Rand. */
            const p = this.viewport.toScreen(VIRTUAL_WIDTH, VIRTUAL_HEIGHT, this._p1);
            const pad = 24 * p.scale;
            const lineHeight = 26 * p.scale;
            const hz = audio.stablePitch;

            ctx.save();
            ctx.textAlign = 'right';
            ctx.textBaseline = 'alphabetic';
            ctx.fillStyle = ACCENT_CYAN;
            ctx.font = this.font(20 * p.scale, 'normal');
            ctx.fillText(
                `PITCH: ${hz > 0 ? Math.round(hz) : '--'} Hz`,
                p.x - pad, p.y - pad - lineHeight
            );
            ctx.fillText(
                `VOL: ${audio.currentVolume.toFixed(3)}`,
                p.x - pad, p.y - pad
            );
            ctx.restore();
        }

        /**
         * Abdunkelung in allen Nicht-Spiel-Zuständen.
         * @param {MatchState} match
         */
        drawDimOverlay(match) {
            let alpha = 0;
            switch (match.state) {
                case STATE.POINT_SCORED:
                    alpha = 0.6 * Math.min(1, match.elapsed() / 500);
                    break;
                case STATE.TRANSITION: {
                    const prog = match.elapsed() / TIMING.TRANSITION_MS;
                    if (prog < 0.2) alpha = 0.6 + (0.4 * (prog / 0.2));
                    else if (prog < 0.4) alpha = 1.0 - (0.4 * ((prog - 0.2) / 0.2));
                    else alpha = 0.6;
                    break;
                }
                /* Ab dem Countdown ist der Platz voll ausgeleuchtet.
                   Vorher lag hier 0.6 — das Bild blieb also die kompletten
                   drei Sekunden der Ruhephase UND den Aufschlag über
                   abgedunkelt und hellte erst mit dem ersten Ballkontakt auf.
                   Der Countdown ist aber der Moment, in dem das Publikum auf
                   den Platz schaut; er soll ihn beleuchtet vorfinden. */
                case STATE.SILENCE_CHECK:
                case STATE.SERVE_WAIT:
                    alpha = 0;
                    break;
                default:
                    alpha = 0;
            }
            if (alpha <= 0) return;
            this.ctx.fillStyle = `rgba(0, 0, 0, ${alpha})`;
            this.ctx.fillRect(0, 0, this.viewport.width, this.viewport.height);
        }

        /**
         * Aufforderung im Zustand SERVE_WAIT: jetzt darf aufgeschlagen werden.
         *
         * REGRESSIONSSCHUTZ FÜR EINE BÜHNENMELDUNG. Bis V40 wurde in diesem
         * Zustand NICHTS gezeichnet: der Countdown lief 3-2-1 und verschwand
         * dann einfach. Wer einen Sekundenbruchteil zu früh einsetzte, setzte
         * damit die Ruhe-Uhr zurück, der Countdown begann unbemerkt von vorn,
         * und es sah aus, als reagiere der Aufschlag nicht.
         *
         * Der Unterschied ist jetzt sichtbar: Countdown = still sein,
         * diese Aufforderung = singen.
         *
         * Sie pulsiert, damit sie sich vom stehenden Countdown unterscheidet,
         * und weicht denselben Köpfen aus wie er.
         *
         * @param {Object} scene
         */
        drawServePrompt(scene) {
            const ctx = this.ctx;
            const p = this.viewport.toScreen(VIRTUAL_WIDTH / 2, COURT_MID_Y, this._p1);
            const size = Renderer.SERVE_PROMPT_SIZE * p.scale;

            /* Puls aus der verstrichenen Zeit im Zustand — kein eigener
               Zähler, der bei einem Reset aus dem Tritt geraten könnte. */
            const t = (scene.match.elapsed() % Renderer.SERVE_PROMPT_PULSE_MS)
                / Renderer.SERVE_PROMPT_PULSE_MS;
            const puls = 0.72 + 0.28 * Math.sin(t * Math.PI * 2);

            ctx.save();
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.font = this.font(size, 'normal', Renderer.GOTHIC_FONT);

            const half = ctx.measureText(Renderer.SERVE_PROMPT_TEXT).width / 2;
            const box = {
                left: p.x - half, right: p.x + half,
                top: p.y - size * 0.5, bottom: p.y + size * 0.5
            };
            const offset = this.dodgeHeads(box, [
                this.headBox(scene.andreaX, scene.paddleAndrea.y),
                this.headBox(scene.paddleAlex.x, scene.paddleAlex.y)
            ], Renderer.COUNTDOWN_DODGE * p.scale);

            /* EIGENER Stil, nicht der des Countdowns. Dessen schwarze Füllung
               mit Schein funktioniert nur bei 400 px Höhe; bei 96 px auf dem
               blauen Platz wäre sie kaum zu lesen. Gelb auf dunklem Rand ist
               dieselbe Farbe wie die Punkte in der Bauchbinde und hebt sich
               von Platz UND Rasen ab. */
            ctx.globalAlpha = puls;
            ctx.lineWidth = size * 0.16;
            ctx.lineJoin = 'round';
            ctx.strokeStyle = 'rgba(0, 0, 0, 0.85)';
            ctx.strokeText(Renderer.SERVE_PROMPT_TEXT, p.x, p.y + offset);
            ctx.fillStyle = ACCENT_YELLOW;
            ctx.fillText(Renderer.SERVE_PROMPT_TEXT, p.x, p.y + offset);
            ctx.restore();
        }

        /**
         * Große Punktanzeige inkl. "X PUNKTET!".
         * @param {MatchState} match
         * @param {string}     scoreLine
         */
        drawPointBanner(match, scoreLine) {
            const ctx = this.ctx;
            const p = this.viewport.toScreen(VIRTUAL_WIDTH / 2, Renderer.BANNER_Y, this._p1);

            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';

            ctx.fillStyle = ACCENT_YELLOW;
            ctx.font = this.font(100 * p.scale);
            ctx.strokeStyle = '#000';
            ctx.lineWidth = 6 * p.scale;
            ctx.strokeText(scoreLine, p.x, p.y);
            ctx.fillText(scoreLine, p.x, p.y);

            ctx.fillStyle = '#ffffff';
            ctx.font = this.font(40 * p.scale);
            ctx.fillText(
                match.lastWinner === PLAYER.ANDREA ? 'ANDREA PUNKTET!' : 'ALEX PUNKTET!',
                p.x, p.y + (70 * p.scale)
            );
        }

        /**
         * Ersatz für die Punktanzeige im Einspielen.
         *
         * Dort wird nicht gezählt, also darf dort auch nicht "PUNKTET"
         * stehen — sonst diskutiert nach der Probe jemand über einen Stand,
         * den es nie gab.
         * @param {MatchState} match
         */
        drawWarmupBanner(match) {
            const ctx = this.ctx;
            const p = this.viewport.toScreen(VIRTUAL_WIDTH / 2, Renderer.BANNER_Y, this._p1);

            ctx.save();
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.font = this.font(72 * p.scale, 'normal', Renderer.GOTHIC_FONT);
            this.gothicText('EINSPIELEN', p.x, p.y, p.scale);

            ctx.fillStyle = 'rgba(255, 255, 255, 0.75)';
            ctx.font = this.font(28 * p.scale);
            ctx.fillText('ENTER + LEERTASTE STARTET DAS MATCH',
                p.x, p.y + (70 * p.scale));
            ctx.restore();
        }

        /**
         * Bumper zwischen den Punkten: "KARAOKOVIC"-Zoom, danach das
         * umherfliegende Gamification-Wort.
         * @param {MatchState} match
         * @param {DvdLogo}    dvd
         * @param {string}     scoreLine
         */
        drawTransition(match, dvd, scoreLine) {
            const ctx = this.ctx;
            const prog = match.elapsed() / TIMING.TRANSITION_MS;
            const center = this.viewport.toScreen(VIRTUAL_WIDTH / 2, VIRTUAL_HEIGHT / 2, this._p1);

            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';

            if (prog < 0.2) {
                const zoom = 1 + (prog / 0.2) * 2;
                ctx.save();
                ctx.translate(center.x, center.y);
                ctx.scale(zoom, zoom);
                ctx.fillStyle = `rgba(255, 0, 127, ${1 - (prog / 0.2)})`;
                ctx.font = this.font(110 * center.scale);
                ctx.fillText('KARAOKOVIC', 0, 0);
                ctx.restore();
                return;
            }

            if (FEATURES.SHOW_GAMIFICATION_WORD) {
                /* Harter Farbwechsel im festen 500-ms-Takt. Bezugsgröße ist
                   match.elapsed(), nicht die Framezahl — dadurch ist der Takt
                   unabhängig von der Bildwiederholrate der LED-Wand. */
                const colorIndex =
                    Math.floor(match.elapsed() / Renderer.WORD_COLOR_MS) % RETRO_WORD_COLORS.length;
                ctx.fillStyle = RETRO_WORD_COLORS[colorIndex];
                ctx.font = this.font(120 * center.scale, 'italic bold');
                const wordPos = this.viewport.toScreen(dvd.x, dvd.y, this._p2);
                ctx.fillText(`"${match.currentWord()}"`, wordPos.x, wordPos.y);
            }

            const scorePos = this.viewport.toScreen(VIRTUAL_WIDTH / 2, COURT_TOP + 120, this._p2);
            ctx.fillStyle = 'rgba(255, 255, 0, 0.5)';
            ctx.font = this.font(90 * scorePos.scale);
            ctx.fillText(scoreLine, scorePos.x, scorePos.y);
        }

        /**
         * Ruhe-Phase: das Gamification-Wort links, großer Countdown in der Mitte.
         *
         * Die rechte Seite bleibt bewusst leer. Der Satz "ABSOLUTE RUHE FÜR DEN
         * AUFSCHLAG" stand dort senkrecht über die volle Bildhöhe — 31
         * Buchstaben, die niemand liest, während in der Mitte eine dreistellige
         * Sekunde herunterzählt. Die Ruhe erklärt der Countdown selbst.
         *
         * HINWEIS: In V36 wurden hier bereits skalierte Werte an Funktionen
         * übergeben, die ein zweites Mal skalieren. Auf jeder Auflösung außer
         * exakt 1600x900 saß der Countdown deutlich rechts der Bildmitte.
         * Mit FEATURES.LEGACY_OVERLAY_LAYOUT = true lässt sich das alte
         * Verhalten wiederherstellen.
         * @param {MatchState} match
         */
        drawSilenceCheck(match, scene) {
            const ctx = this.ctx;
            const count = match.silenceCountdown();
            const legacyScale = FEATURES.LEGACY_OVERLAY_LAYOUT ? this.viewport.scale : 1;

            if (FEATURES.SHOW_GAMIFICATION_WORD) this.drawVerticalText(
                match.currentWord(),
                (COURT_LEFT / 2) * legacyScale,
                (VIRTUAL_HEIGHT / 2) * legacyScale,
                80, ACCENT_PURPLE
            );

            /* save/restore ist hier NICHT optional: ohne das Zurücksetzen
               liefe der Schein im nächsten Frame über Linien und Figuren
               weiter — jedes fill() und stroke() im Canvas erbt shadowBlur,
               bis er ausdrücklich gelöscht wird. */
            ctx.save();
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';

            const p = FEATURES.LEGACY_OVERLAY_LAYOUT
                ? { x: (VIRTUAL_WIDTH / 2) * this.viewport.scale,
                    y: COURT_MID_Y * this.viewport.scale,
                    scale: this.viewport.scale }
                : this.viewport.toScreen(VIRTUAL_WIDTH / 2, COURT_MID_Y, this._p1);

            const size = Renderer.COUNTDOWN_SIZE * p.scale;
            ctx.font = this.font(size, 'normal', Renderer.GOTHIC_FONT);

            /* --- Kopf-Kollision -----------------------------------------------
             * Die Ziffer ist rund 400 px hoch und steht in der Bildmitte —
             * genau dort, wo auch Andreas Kopf steht, wenn sie mittig singt.
             * Statt sie fest zu verschieben (und dann vielleicht Alex zu
             * treffen) wird geprüft und ausgewichen.
             * ------------------------------------------------------------------ */
            const half = size * 0.4;   // halbe Ziffernbreite, grob
            const box = {
                left: p.x - half, right: p.x + half,
                top: p.y - size * 0.4, bottom: p.y + size * 0.4
            };
            let offset = 0;
            if (scene) {
                offset = this.dodgeHeads(box, [
                    this.headBox(scene.andreaX, scene.paddleAndrea.y),
                    this.headBox(scene.paddleAlex.x, scene.paddleAlex.y)
                ], Renderer.COUNTDOWN_DODGE * p.scale);
            }

            this.gothicText(String(count), p.x, p.y + offset, p.scale);
            ctx.restore();
        }

        /**
         * Text im Gothic-Stil: schwarze Füllung, lila Kontur, lila Schein.
         *
         * Reihenfolge ist wesentlich. Erst wird MIT Schatten die Kontur
         * gezogen (der Schein entsteht am Rand, nicht in der Fläche), dann
         * ohne Schatten die Füllung darübergelegt. Umgekehrt läge der Schein
         * unter der Füllung und wäre unsichtbar, und die Kontur würde von der
         * Füllung zur Hälfte überdeckt.
         *
         * Räumt shadowBlur selbst auf.
         *
         * @param {string} text
         * @param {number} x     Bildschirmkoordinate
         * @param {number} y     Bildschirmkoordinate
         * @param {number} scale Letterbox-Skalierung
         */
        gothicText(text, x, y, scale) {
            const ctx = this.ctx;

            ctx.shadowColor = Renderer.GOTHIC_GLOW;
            ctx.shadowBlur = Renderer.GOTHIC_BLUR * scale;
            ctx.strokeStyle = Renderer.GOTHIC_STROKE;
            ctx.lineWidth = Renderer.GOTHIC_LINE_WIDTH * scale;
            ctx.lineJoin = 'round';
            for (let i = 0; i < Renderer.GOTHIC_PASSES; i++) {
                ctx.strokeText(text, x, y);
            }

            ctx.shadowBlur = 0;
            ctx.shadowColor = 'transparent';
            ctx.fillStyle = Renderer.GOTHIC_FILL;
            ctx.fillText(text, x, y);
        }

        /**
         * Bildschirm-Rechteck um den Kopf einer Figur.
         *
         * Grundlage des Ausweichens großer Texte. Rechnet mit derselben
         * Projektion und derselben Tiefendämpfung wie drawPlayer(), sonst
         * würde die Prüfbox neben dem tatsächlichen Kopf liegen.
         *
         * @param   {number} vx Weltposition X
         * @param   {number} vy Weltposition Y (Fußlinie)
         * @returns {{left:number, right:number, top:number, bottom:number}}
         */
        headBox(vx, vy) {
            const p = this.proj.project(vx, vy, 0, this._p2);
            const depth = p.scale3D / this.viewport.scale;
            const damped = 1 + (depth - 1) * FIGURE_DEPTH_COMPRESSION;
            const s = damped * this.viewport.scale;

            /* Der Kopf sitzt zwischen Schulter und Scheitel. */
            const shoulder = p.y - Renderer.BODY_HEIGHT * SHOULDER_RATIO * s;
            const half = (HEAD_BOX.width / 2) * s;
            return {
                left: p.x - half,
                right: p.x + half,
                top: shoulder - HEAD_BOX.height * s,
                bottom: shoulder
            };
        }

        /**
         * Senkrechter Versatz, mit dem ein Text allen Köpfen ausweicht.
         *
         * Bewusst simpel: probiert der Reihe nach "gar nicht", "nach oben",
         * "nach unten" und nimmt die erste kollisionsfreie Lage. Mehr braucht
         * es nicht — es gibt genau zwei Köpfe und einen großen Text.
         *
         * @param   {{left:number,right:number,top:number,bottom:number}} box
         * @param   {Array<Object>} heads
         * @param   {number} dodge Ausweichweite in Bildschirmpixeln
         * @returns {number} Versatz in Bildschirmpixeln (0 = keine Kollision)
         */
        dodgeHeads(box, heads, dodge) {
            const hits = (offset) => heads.some(h =>
                box.left < h.right && box.right > h.left
                && box.top + offset < h.bottom && box.bottom + offset > h.top);

            if (!hits(0)) return 0;
            if (!hits(-dodge)) return -dodge;
            if (!hits(dodge)) return dodge;
            /* Beide Richtungen belegt — nach oben ist das kleinere Übel, dort
               steht nur die hintere Figur und die ist deutlich kleiner. */
            return -dodge;
        }

        /**
         * Text mit Neon-Schein zeichnen.
         *
         * Ein einzelner `fillText` mit `shadowBlur` erzeugt nur einen matten
         * Hauch. Der Schein baut sich erst über mehrere Durchgänge auf demselben
         * Pfad auf — deshalb die Schleife. Zwei Durchgänge sind der Punkt, an
         * dem es leuchtet, ohne dass die Kanten der Ziffer verwaschen.
         *
         * Der Weichzeichner wird MIT der Auflösung skaliert. Ein fester Wert
         * von 30 px wäre auf einer 4K-Wand relativ zur Ziffer nur noch halb so
         * breit — der Effekt verschwände genau dort, wo er wirken soll.
         *
         * Setzt shadowBlur am Ende selbst zurück; der Aufrufer muss sich um den
         * Zustand nicht kümmern (in drawSilenceCheck sichert zusätzlich ein
         * save/restore ab).
         *
         * @param {string} text
         * @param {number} x     Bildschirmkoordinate
         * @param {number} y     Bildschirmkoordinate
         * @param {string} color Farbe des Scheins
         * @param {number} scale Letterbox-Skalierung
         */
        neonText(text, x, y, color, scale) {
            const ctx = this.ctx;
            ctx.shadowColor = color;
            ctx.shadowBlur = Renderer.NEON_BLUR * scale;
            for (let i = 0; i < Renderer.NEON_PASSES; i++) {
                ctx.fillText(text, x, y);
            }
            ctx.shadowBlur = 0;
            ctx.shadowColor = 'transparent';
        }

        /**
         * Buchstabe für Buchstabe untereinander gesetzter Text.
         * @param {string} text
         * @param {number} x     Weltkoordinate X
         * @param {number} y     Weltkoordinate Y (Mitte des Blocks)
         * @param {number} size  Schriftgröße in virtuellen Pixeln
         * @param {string} color
         */
        drawVerticalText(text, x, y, size, color) {
            const ctx = this.ctx;
            const p = this.viewport.toScreen(x, y, this._p2);
            ctx.save();
            ctx.fillStyle = color;
            ctx.font = this.font(size * p.scale);
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            const spacing = size * p.scale * 0.9;
            const startY = p.y - ((text.length - 1) * spacing) / 2;
            for (let i = 0; i < text.length; i++) {
                /* Buchstabe für Buchstabe leuchten lassen, in der Farbe des
                   Textes. neonText() räumt shadowBlur selbst auf, das
                   abschließende restore() ist der zweite Riegel. */
                this.neonText(text[i], p.x, startY + i * spacing, color, p.scale);
            }
            ctx.restore();
        }

        /* --------------------------------------------------------------------
         * Sprite-Helfer
         * ----------------------------------------------------------------- */

        /**
         * Zeichnet ein Sprite an einem bereits projizierten Punkt. Ankerpunkt
         * ist standardmäßig die Fußlinie (unten mittig) — so stehen Figuren
         * korrekt auf dem Platz.
         *
         * @param {string}      key       Manifest-Schlüssel
         * @param {ScreenPoint} p         Ergebnis von Projection.project()
         * @param {number}      height    Zielhöhe in virtuellen Pixeln
         * @param {boolean}     [centered=false] true = mittig statt Fußlinie
         */
        blitWorldSprite(key, p, height, centered) {
            const img = this.assets.get(key);
            if (!img) return;
            const aspect = img.naturalWidth / img.naturalHeight;
            const h = height * p.scale3D;
            const w = h * aspect;
            const x = p.x - w / 2;
            const y = centered ? p.y - h / 2 : p.y - h;
            this.ctx.drawImage(img, x, y, w, h);
        }
    }

    /** Positionen der Ballkinder (relativ zum Feld). @readonly */
    Renderer.BALLBOY_SPOTS = [
        { right: false, top: true },
        { right: true, top: true },
        { right: false, top: false },
        { right: true, top: false }
    ];

    /* --- Layout-Konstanten des Renderers ---------------------------------- */

    /* Die früheren GRASS_MARGIN_*-Konstanten sind entfallen: der Außenbereich
       ist keine begrenzte Rasenfläche mehr, sondern füllt in drawBackground()
       das gesamte Bild. */

    /**
     * Abstand beider Aufschlaglinien vom Netz, als Anteil der Feldlänge.
     *
     * Für beide Hälften derselbe Wert — auf einem echten Platz liegen sie
     * symmetrisch, und die perspektivische Stauchung der hinteren Hälfte
     * erledigt die Projektion.
     *
     * 0.268 ist aus der Vorlage zurückgerechnet: ihre beiden Aufschlaglinien
     * liegen unter dem gemessenen Kameramodell bei dy = -0.5357 und +0.5363,
     * also symmetrisch auf 0.268 der Feldlänge — praktisch exakt der
     * regelkonforme Wert 0.2692 (6.40 m von 11.885 m).
     *
     * Zwischenzeitlich standen hier zwei verschiedene Werte (0.15 / 0.22), um
     * das hintere Aufschlagfeld von Hand flacher zu bekommen. Das war ein
     * Symptom der falschen Vertikalabbildung; mit der echten Perspektive
     * erledigt sich die Stauchung von selbst.
     *
     * Rein optisch: keine Spielregel benutzt diese Linien, gewertet wird über
     * Physics.BOUNCE_DEPTH.
     */
    Renderer.SERVICE_LINE_DEPTH = 0.268;

    /** Tiefe des Zuschauerblocks in Weltkoordinaten. */
    Renderer.CROWD_DEPTH = 150;
    /** Anzahl der Zuschauerreihen. */
    Renderer.CROWD_ROWS = 6;
    /**
     * Einheitliche Körperhöhe beider Spielerfiguren in virtuellen Pixeln.
     * Gemeint ist die SICHTBARE Höhe, nicht die Bildhöhe — siehe BODY_PADDING.
     */
    Renderer.BODY_HEIGHT = 118;

    /**
     * Transparenter Rand der Körper-Sprites, als Anteil der Bildhöhe.
     *
     * Ausgemessen über den Alphakanal der gelieferten Dateien:
     *   Beispiel Spieler unten.png  1050x1024, sichtbar y 117..936
     *      -> oben 117/1024 = 11.4 %, unten 87/1024 = 8.5 %
     *   Beispiel Spieler oben.png    120x142,  sichtbar y  10..125
     *      -> oben  10/142 =  7.0 %, unten 16/142 = 11.3 %
     *
     * Die Werte stehen fest im Code statt zur Laufzeit gemessen zu werden:
     * getImageData() auf ein per file:// geladenes Bild wirft in Chrome eine
     * SecurityError, weil der Canvas dadurch als fremdherkünftig gilt. Das
     * Spiel startet aber ausdrücklich offline per Doppelklick.
     *
     * WERDEN NEUE SPRITES GELIEFERT, müssen diese Zahlen mit — sonst steht die
     * Figur wieder neben ihrem Schatten.
     */
    Renderer.BODY_PADDING = {
        body_andrea: { top: 0.114, bottom: 0.085 },
        body_alex: { top: 0.070, bottom: 0.113 }
    };

    /* -------------------------------------------------------------------------
     * Tonhöhen-Markierungen (siehe Renderer.drawPitchIndicators)
     *
     * Alle Werte sind virtuelle Pixel und werden NUR mit der Letterbox-
     * Skalierung multipliziert — die Noten liegen im Overlay, nicht auf dem
     * Platz. Die früheren Konstanten GROUND_FLATTEN (Höhenstauchung für
     * Bodenmarkierungen) und PITCH_NOTE_TILT (Neigung des Notenkopfes) sind
     * damit gegenstandslos und entfallen.
     * ---------------------------------------------------------------------- */

    /**
     * X-Radius des Notenkopfes in virtuellen Pixeln.
     *
     * War 39, zusammen mit Hals 118 und Beschriftung 48 ergab das ein Visual
     * von 243 px Höhe. So hoch passt es rechts NICHT zwischen Seitenlinie und
     * Bande: der Grünstreifen ist dort oben nur rund 194 px breit, und die
     * Note ragte oben in die Tribüne. Mit den jetzigen Maßen ist das Visual
     * 177 px hoch und hat auf beiden Seiten Luft.
     */
    Renderer.PITCH_NOTE_RADIUS = 28;
    /**
     * Höhe des Notenkopfes als Anteil seiner Breite. Ein Notenkopf ist im
     * Notensatz breiter als hoch; 1.0 ergäbe einen Kreis.
     */
    Renderer.PITCH_NOTE_HEAD_RATIO = 0.78;
    /** Halslänge in virtuellen Pixeln. */
    Renderer.PITCH_NOTE_STEM = 85;
    /** Strichstärke des Notenhalses in virtuellen Pixeln. */
    Renderer.PITCH_NOTE_STEM_WIDTH = 8;
    /** Schriftgröße der Beschriftung ("TIEF" / "HOCH") in virtuellen Pixeln. */
    Renderer.PITCH_LABEL_SIZE = 36;
    /** Abstand der Beschriftung unter der Notenmitte in virtuellen Pixeln. */
    Renderer.PITCH_LABEL_OFFSET = 52;
    /**
     * Position der Noten in BILDSCHIRMkoordinaten (Abstand von der Bildmitte
     * bzw. Höhe im Bild).
     *
     * Nicht mehr aus COURT_LEFT abgeleitet: die Overlay-Ebene kennt keine
     * Weltkoordinaten. Auf Höhe 555 erscheint der Platz zwischen x=369 und
     * x=1231 — die Note reicht von 191 bis 269 und hat damit 100 px Luft zur
     * Doppellinie, die Beschriftung darunter noch 45 px.
     */
    /**
     * Abstand der Noten zur äußeren Seitenlinie, in virtuellen Pixeln.
     *
     * Gemessen im Hintergrundbild: auf Höhe der hohen Note (y=300) reicht das
     * Grün rechts von x=1099 (Platzkante) bis x=1371 (Tribüne), also 272 px.
     * Auf Höhe der tiefen Note (y=620) von x=336 nach links bis zum Bildrand.
     * 140 setzt beide Noten in die Mitte ihres Grünstreifens.
     */
    Renderer.PITCH_NOTE_MARGIN = 140;

    /**
     * Rechte Kante des Grünstreifens (Beginn der Bande) in virtuellen Pixeln.
     *
     * Im Hintergrundbild Zeile für Zeile ausgemessen; zwischen y=150 und
     * y=330 verläuft sie geradlinig:
     *
     *     y=150 -> x=1216      y=250 -> x=1320
     *     y=190 -> x=1258      y=300 -> x=1372
     *
     * Das ergibt 1216 + 1.035·(y − 150), Abweichung unter 2 px.
     *
     * WARNUNG: Kommt ein anderes Hintergrundbild, gilt diese Gerade nicht mehr
     * und muss neu eingemessen werden — genauso wie die Kamerakonstanten.
     * Außerhalb von y = 150…330 ist sie nicht geprüft; dort knickt die
     * Tribünengeometrie im Bild ab.
     *
     * @param   {number} y Virtuelle Bildschirm-Y-Koordinate
     * @returns {number} Virtuelle X-Koordinate der Bandenkante
     */
    Renderer.apronRightAt = function (y) {
        const geklemmt = Math.max(150, Math.min(330, y));
        return 1216 + 1.035 * (geklemmt - 150);
    };

    /** Mindestabstand des Tonhöhen-Visuals zu Seitenlinie und Bande. */
    Renderer.PITCH_APRON_SAFETY = 12;
    /**
     * Höhen der beiden Noten. Bewusst UNTERSCHIEDLICH:
     *
     *   TIEF  unten  bei y = 620 — vorn, auf Andreas Höhe, und tief genug,
     *                dass die Note der Pausenbank im Hintergrundbild ausweicht.
     *   HOCH  oben   bei y = 300 — auf Alex' Hälfte (die reicht auf dem Schirm
     *                von 214 bis 378).
     *
     * Damit trägt die Anordnung selbst die Aussage: vorne tief, hinten hoch.
     * Die Tiefe des Platzes und die Tonhöhe erzählen dasselbe.
     */
    Renderer.PITCH_NOTE_Y_LOW = 620;
    Renderer.PITCH_NOTE_Y_HIGH = 300;
    /** Farbe der Markierung — dieselbe Anmutung wie die Feldlinien. */
    Renderer.PITCH_NOTE_COLOR = 'rgba(255, 255, 255, 0.4)';
    /** Farbe und Schein, wenn der zugehörige Kalibrierton getroffen ist. */
    Renderer.PITCH_HIT_COLOR = ACCENT_CYAN;
    Renderer.PITCH_HIT_GLOW = 28;
    /**
     * Toleranz in Halbtönen, ab der ein Kalibrierton als "getroffen" gilt.
     * 1.5 ist knapp mehr als ein Halbton — eng genug, dass es etwas bedeutet,
     * weit genug, dass ein leichtes Vibrato die Note nicht flackern lässt.
     */
    Renderer.PITCH_HIT_SEMITONES = 1.5;

    /**
     * @param   {number} hz
     * @returns {number} MIDI-Notennummer (69 = Kammerton a')
     */
    Renderer.midiOf = function (hz) {
        return 12 * Math.log2(hz / 440) + 69;
    };

    /**
     * Liegt `hz` innerhalb der Trefftoleranz um `target`?
     * @param   {number} hz
     * @param   {number} target
     * @returns {boolean}
     */
    /**
     * Tonname zu einer Frequenz, deutsche Schreibweise mit Oktavlage.
     *
     * Für den Bestätigungsschritt im Onboarding: "147 Hz" sagt niemandem
     * etwas, "D3" schon — und wer damit auch nichts anfängt, sieht daneben
     * die Klaviatur.
     *
     * @param   {number} hz
     * @returns {string} z. B. "A2"
     */
    Renderer.noteName = function (hz) {
        if (!(hz > 0)) return '—';
        const midi = Math.round(Renderer.midiOf(hz));
        const namen = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'H'];
        /* MIDI 60 = C4 in der hier üblichen Zählung. */
        return namen[((midi % 12) + 12) % 12] + (Math.floor(midi / 12) - 1);
    };

    Renderer.isNear = function (hz, target) {
        if (!(hz > 0) || !(target > 0)) return false;
        return Math.abs(Renderer.midiOf(hz) - Renderer.midiOf(target))
            <= Renderer.PITCH_HIT_SEMITONES;
    };

    /* -------------------------------------------------------------------------
     * Klaviatur im Einspielen (siehe Renderer.drawKeyboards)
     * ---------------------------------------------------------------------- */

    /**
     * Oberkante und Höhe der vorderen (Andrea) und hinteren (Alex) Tastatur.
     *
     * Beide Positionen sind gegen das gerechnet, was dort sonst schon steht:
     *   vorn  828..882 — unter der Bauchbinde (die endet bei 818) und über dem
     *                    Bildrand; die Tastatur reicht auf dem Schirm von
     *                    x 294 bis 1306, die Bauchbinde von 84 bis 446, sie
     *                    würden sich sonst überschneiden.
     *   hinten  10..48 — ÜBER Alex' Kopf. Sein Kopf belegt y 70 bis 138, das
     *                    Feld darunter beginnt bei 214. Zwischen Kopf und
     *                    Grundlinie ist kein Platz, also darüber.
     */
    Renderer.KEYS_Y_NEAR = 828;
    Renderer.KEYS_HEIGHT_NEAR = 54;
    Renderer.KEYS_Y_FAR = 10;
    Renderer.KEYS_HEIGHT_FAR = 38;

    /**
     * Zusätzliche Halbtöne links und rechts neben dem kalibrierten Umfang.
     *
     * Die Tastatur endet sonst exakt an den beiden Kalibriertönen, und dann
     * sieht sie aus wie ein Instrument, das genau dort aufhört, wo man gerade
     * singt — man sieht nicht, dass links und rechts Schluss ist, weil kein
     * Rand da ist, gegen den man es sehen könnte. Zwei Tasten Luft auf jeder
     * Seite machen die Grenze sichtbar.
     *
     * Symmetrisch, damit die Mitte des Stimmumfangs die Mitte der Tastatur
     * bleibt.
     */
    Renderer.KEYS_MARGIN_SEMITONES = 2;

    /** Hintergrund des Onboardings (siehe Renderer.drawOnboardingBackdrop). */
    Renderer.ONBOARDING_BACKDROP_EDGE = '#05050a';
    Renderer.ONBOARDING_BACKDROP_MID = '#101026';

    /**
     * Lage und Tonumfang einer Tastatur für einen Spieler.
     *
     * Der kalibrierte Umfang wird auf `courtW` abgebildet — genau die Breite,
     * über die auch `freqToQuantizedX()` die Figur schickt. Die Randtasten
     * kommen AUSSERHALB dazu: die Tastatur wird breiter, statt dieselbe Breite
     * auf mehr Tasten aufzuteilen. Nur so behält jede Taste des kalibrierten
     * Bereichs exakt die Position, die sie ohne den Rand hätte, und die
     * Tastatur bleibt gegen das Feld lesbar.
     *
     * @param   {string} player Wert aus PLAYER
     * @param   {number} courtX Linke Feldkante in Bildschirmpixeln
     * @param   {number} courtW Feldbreite in Bildschirmpixeln
     * @returns {{x:number, w:number, minMidi:number, maxMidi:number}|null}
     *          null, wenn der Umfang unbrauchbar ist (dann lieber nichts zeichnen).
     */
    Renderer.keyboardSpan = function (player, courtX, courtW) {
        const range = Physics.voiceRange(player);
        const minMidi = Math.round(Renderer.midiOf(range.min));
        const maxMidi = Math.round(Renderer.midiOf(range.max));
        if (!(maxMidi > minMidi) || !(courtW > 0)) return null;

        const rand = Renderer.KEYS_MARGIN_SEMITONES;
        const keyW = courtW / (maxMidi - minMidi + 1);
        return {
            x: courtX - rand * keyW,
            w: courtW + 2 * rand * keyW,
            minMidi: minMidi - rand,
            maxMidi: maxMidi + rand,
        };
    };

    /** Weichzeichnerradius der leuchtenden Taste, bezogen auf 18 px Tastenbreite. */
    Renderer.KEYS_GLOW = 22;
    /** Farbverlauf der leuchtenden Taste, von hell nach satt. */
    Renderer.KEYS_LIT_COLOR = ACCENT_CYAN;
    Renderer.KEYS_LIT_DEEP = '#00806a';
    Renderer.KEYS_LIT_GLOW = ACCENT_CYAN;
    /** Farbe des Filzstreifens über den Tasten. */
    Renderer.KEYS_FELT = '#7a1046';

    /**
     * Ist die MIDI-Note eine schwarze Taste?
     * Innerhalb der Oktave sind das die Halbtonschritte 1, 3, 6, 8 und 10
     * (cis, dis, fis, gis, ais).
     * @param   {number} midi
     * @returns {boolean}
     */
    Renderer.isBlackKey = function (midi) {
        const n = ((midi % 12) + 12) % 12;
        return n === 1 || n === 3 || n === 6 || n === 8 || n === 10;
    };

    /**
     * MIDI-Note des gerade gesungenen Tons, oder null.
     * @param   {AudioEngine} [audio]
     * @returns {number|null}
     */
    Renderer.liveMidiOf = function (audio) {
        const hz = audio ? audio.stablePitch : 0;
        return hz > 0 ? Renderer.midiOf(hz) : null;
    };

    /* -------------------------------------------------------------------------
     * Klaviatur im Onboarding
     * ---------------------------------------------------------------------- */

    /**
     * Tonumfang der Onboarding-Klaviatur.
     *
     * Fest und großzügig, NICHT der kalibrierte Bereich — den gibt es zu
     * diesem Zeitpunkt ja noch nicht. MIDI 36 bis 76 sind 65 Hz bis 659 Hz,
     * also gut drei Oktaven: tief genug für einen Bass, hoch genug für einen
     * hohen Kalibrierton einer Frauenstimme (die liegen oft bei 450–650 Hz).
     * Wäre der Umfang enger, fiele genau der Ton aus der Anzeige, den die
     * Sängerin gerade sucht.
     */
    Renderer.ONBOARDING_MIDI_LOW = 36;
    Renderer.ONBOARDING_MIDI_HIGH = 76;

    /**
     * Die Vorgabewerte aus CONFIG. Nur solange sie unverändert sind, gilt ein
     * Kalibrierton als "noch nicht gespeichert" und bekommt keine Markierung.
     */
    Renderer.ONBOARDING_DEFAULT_MIN = CONFIG.minFreq;
    Renderer.ONBOARDING_DEFAULT_MAX = CONFIG.maxFreq;

    /** Höhe und Abstand der Onboarding-Klaviaturen in CSS-Pixeln. */
    Renderer.KEYS_ONBOARDING_HEIGHT = 76;
    Renderer.KEYS_ONBOARDING_GAP = 26;
    /** Mindestbreite, damit 41 Tasten nicht zu Strichen werden. */
    Renderer.KEYS_ONBOARDING_MIN_WIDTH = 700;

    /* -------------------------------------------------------------------------
     * Typografie "Gothic" für Countdown und HUD-Namen
     * ---------------------------------------------------------------------- */

    /**
     * Schriftfamilie. Impact ist auf macOS und Windows vorinstalliert und
     * damit die einzige eckige Groteske, die offline sicher da ist — eine
     * Webfont-Datei wäre bei file:// ein zusätzliches Ladeproblem.
     */
    Renderer.GOTHIC_FONT = "'Impact', 'Haettenschweiler', sans-serif";
    Renderer.GOTHIC_FILL = '#000000';
    Renderer.GOTHIC_STROKE = '#b026ff';
    Renderer.GOTHIC_GLOW = '#b026ff';
    Renderer.GOTHIC_LINE_WIDTH = 3;
    Renderer.GOTHIC_BLUR = 15;
    /**
     * Durchgänge für die Kontur. Ein einzelner strokeText mit shadowBlur gibt
     * nur einen matten Hauch; zwei Durchgänge machen daraus ein sattes
     * Leuchten. Gleiche Begründung wie bei NEON_PASSES.
     */
    Renderer.GOTHIC_PASSES = 2;

    /**
     * Ausweichweite des Countdowns, wenn ein Kopf im Weg steht (virtuelle Px).
     *
     * Nachgerechnet statt geschätzt: die Ziffer belegt bei 400 px Schriftgröße
     * y 340 bis 660, Andreas Kopfbox liegt bei 507 bis 599, Alex' bei 70 bis
     * 138. Um Andrea zu räumen, muss die Unterkante über 507 — das verlangt
     * mindestens 153 px. Die zunächst angesetzten 150 hätten um drei Pixel
     * NICHT gereicht. 170 räumt beide Köpfe mit Abstand: die Ziffer steht dann
     * bei 170 bis 490, also unter Alex und über Andrea.
     */
    Renderer.COUNTDOWN_DODGE = 170;

    /* -------------------------------------------------------------------------
     * TV-Bauchbinde unten links (siehe Renderer.drawHud)
     * ---------------------------------------------------------------------- */

    /* Alle Maße stammen aus `Vorgabe_Platz.png` (dort 1372x768) und sind auf
       die virtuellen 1600x900 hochgerechnet: Kasten x 72..382 / y 633..697
       mal 1.166 bzw. 1.172. */

    /** Linke obere Ecke des Kastens in virtuellen Pixeln. */
    Renderer.HUD_X = 84;
    Renderer.HUD_Y = 742;
    /** Maße des Kastens in virtuellen Pixeln. */
    Renderer.HUD_WIDTH = 362;
    Renderer.HUD_HEIGHT = 76;
    /** Eckradius. In der Vorlage nur leicht gerundet, kein Pillenformat. */
    Renderer.HUD_RADIUS = 8;
    /** Innenabstand links und rechts. */
    Renderer.HUD_PAD = 18;
    /**
     * Breite der Punktespalte in virtuellen Pixeln — sie bestimmt zugleich,
     * wo die Sätzespalte endet. Muss das breiteste Punktekürzel ("ADV")
     * aufnehmen, sonst rücken die beiden Zahlenspalten zusammen.
     */
    Renderer.HUD_POINTS_COL = 72;
    /** Radius des Aufschlagballs in virtuellen Pixeln. */
    Renderer.HUD_SERVE_DOT_R = 10;
    /** Abstand des Aufschlagballs links der Sätzespalte. */
    Renderer.HUD_SERVE_DOT_OFFSET = 40;
    Renderer.HUD_NAME_SIZE = 30;
    Renderer.HUD_SETS_SIZE = 24;
    Renderer.HUD_POINTS_SIZE = 28;

    /**
     * Schrift des Scoreboards.
     *
     * Bewusst NICHT die Courier-Retroschrift des restlichen Spiels: die
     * Vorlage setzt das Scoreboard in einer serifenlosen Groteske, und genau
     * dieser Bruch macht es zur Fernsehgrafik, die über dem Spiel liegt,
     * statt zu einem Teil des Spiels.
     */
    Renderer.HUD_FONT = "'Helvetica Neue', Helvetica, Arial, sans-serif";

    /* Farben, aus der Vorlage abgegriffen. */
    Renderer.HUD_BG_TOP = '#1a2450';
    Renderer.HUD_BG_BOTTOM = '#070b24';
    Renderer.HUD_BORDER = '#36425f';
    Renderer.HUD_BALL_COLOR = '#d9dc54';
    Renderer.HUD_BALL_EDGE = '#8f9430';

    /* -------------------------------------------------------------------------
     * Ruhephase: Countdown und Neon-Schein
     * ---------------------------------------------------------------------- */

    /** Schriftgröße des Countdowns in virtuellen Pixeln. */
    Renderer.COUNTDOWN_SIZE = 400;

    /* -------------------------------------------------------------------------
     * Aufforderung im Zustand SERVE_WAIT (siehe Renderer.drawServePrompt)
     *
     * Deutlich kleiner als der Countdown: der Countdown ist der Moment, in dem
     * das Publikum auf den Platz schaut, die Aufforderung richtet sich an die
     * Spielerin. Der Strichstärke-Faktor in drawServePrompt hält das
     * Verhältnis von Kontur zu Schriftgröße gleich — sonst wirkt die kleinere
     * Schrift schwerer als die große.
     * ---------------------------------------------------------------------- */
    /**
     * Bildschirm-Y der Netzlinie — Ankerhöhe der Banner zwischen den Punkten.
     *
     * WARUM NICHT `COURT_MID_Y`: das ist eine WELTkoordinate (500) und wurde
     * hier als Bildschirmkoordinate benutzt. Auf dem Schirm liegt y=500 aber
     * deutlich VOR dem Netz, mitten in Andreas Hälfte — genau dort, wo sie
     * nach einem gewonnenen Punkt steht. Ihre Figur deckte den Text ab.
     *
     * Das Netz liegt bei scale3D = 1, also HORIZON_Y + DEPTH_SPAN = 377.8.
     * Dort steht keine der beiden Figuren: Alex' Kopf endet bei rund 140,
     * Andreas beginnt erst bei rund 500.
     */
    Renderer.BANNER_Y = HORIZON_Y + DEPTH_SPAN;

    Renderer.SERVE_PROMPT_TEXT = 'AUFSCHLAG!';
    Renderer.SERVE_PROMPT_SIZE = 96;
    /** Dauer eines Pulses in Millisekunden. */
    Renderer.SERVE_PROMPT_PULSE_MS = 900;
    /**
     * Radius des Neon-Scheins in virtuellen Pixeln, VOR der Letterbox-
     * Skalierung. Wird in neonText() mit `scale` multipliziert, damit der
     * Schein auf einer 4K-Wand im selben Verhältnis zur Schrift steht wie auf
     * 1600x900.
     */
    Renderer.NEON_BLUR = 30;
    /**
     * Durchgänge pro Textstelle. 1 = matter Hauch, 2 = leuchtet sauber,
     * ab 4 verwaschen die Kanten der Ziffer zu einem Klumpen.
     */
    Renderer.NEON_PASSES = 2;

    /**
     * Taktlänge des Farbwechsels beim Bumper-Wort in Millisekunden.
     * 500 ms ist der Arcade-Blinktakt der Vorlage: schnell genug, um zu
     * flackern, langsam genug, um jede Farbe wahrzunehmen.
     */
    Renderer.WORD_COLOR_MS = 500;

    /* =========================================================================
     * 10. INPUT HANDLER — Operator-Hotkeys
     * ====================================================================== */

    /**
     * ### GESCHÜTZT — Tastenkombinationen ###
     *
     * Es gibt bewusst nur zwei Eingaben, beide mit Alt+Shift, damit auf der
     * Bühne nichts versehentlich ausgelöst werden kann:
     *   Alt+Shift+U : letzten Punkt zurücknehmen
     *   Alt+Shift+X : kompletter Reset auf 0:0
     *
     * Beide Aktionen führen zurück in SILENCE_CHECK, damit der Ablauf sauber
     * neu startet.
     */
    class InputHandler {
        /**
         * @param {MatchState} match
         * @param {Physics}    physics
         */
        constructor(match, physics) {
            this.match = match;
            this.physics = physics;
            this._onKeyDown = this.handleKeyDown.bind(this);
            this._onKeyUp = this.handleKeyUp.bind(this);
            /**
             * Welche Tasten gerade gedrückt sind. Nötig, weil der Anpfiff auf
             * eine KOMBINATION reagiert und `keydown` immer nur eine Taste
             * meldet.
             * @type {Set<string>}
             */
            this._down = new Set();
        }

        /** Listener registrieren. */
        attach() {
            window.addEventListener('keydown', this._onKeyDown);
            window.addEventListener('keyup', this._onKeyUp);
            /* Beim Fokusverlust alles vergessen: sonst gilt eine Taste, die
               außerhalb des Fensters losgelassen wurde, ewig als gedrückt und
               ein späterer einzelner Tastendruck pfeift das Match an. */
            window.addEventListener('blur', () => this._down.clear());
        }

        /** Listener entfernen (für Tests / sauberen Teardown). */
        detach() {
            window.removeEventListener('keydown', this._onKeyDown);
            window.removeEventListener('keyup', this._onKeyUp);
        }

        /** @param {KeyboardEvent} e */
        handleKeyUp(e) { this._down.delete(e.code); }

        /** @param {KeyboardEvent} e */
        handleKeyDown(e) {
            this._down.add(e.code);

            /* --- Regie: Anpfiff (Enter + Leertaste gleichzeitig) -------------
             * Zwei Tasten, damit auf der Bühne kein Streifschuss das Match
             * startet. Beide sind groß und blind zu treffen.
             * ---------------------------------------------------------------- */
            if (this._down.has('Space')
                && (this._down.has('Enter') || this._down.has('NumpadEnter'))) {
                e.preventDefault();
                if (this.match.isWarmup) {
                    this.match.startMatch();
                    this.restartServe();
                    console.info('[Regie] Einspielen beendet — Match läuft, Stand 0:0.');
                }
                return;
            }

            if (!e.altKey || !e.shiftKey) return;

            if (e.code === 'KeyU') {
                e.preventDefault();
                if (this.match.undo()) {
                    this.restartServe();
                    console.info('[Operator] Undo — Stand:', this.match.scoreLine());
                }
                return;
            }

            if (e.code === 'KeyX') {
                e.preventDefault();
                this.match.hardReset();
                this.restartServe();
                console.info('[Operator] Hard Reset');
            }
        }

        /** Nach einem Eingriff sauber in die Ruhe-Phase zurückkehren. */
        restartServe() {
            this.physics.prepareServe();
            this.match.setState(STATE.SILENCE_CHECK);
            this.match.resetSilenceTimer();
        }
    }

    /* =========================================================================
     * 11. GAME — Loop, Zustandsübergänge, Onboarding
     * ====================================================================== */

    /**
     * Klammert alle Systeme zusammen und hält den Frame-Loop.
     */
    class Game {
        constructor() {
            /** @type {HTMLCanvasElement} Sichtbarer Canvas, füllt das Fenster. */
            this.canvas = /** @type {HTMLCanvasElement} */ (document.getElementById('gameCanvas'));
            /** @type {CanvasRenderingContext2D} */
            this.ctx = this.canvas.getContext('2d', { alpha: false });

            /* Präsentations-Seite: volle Fensterauflösung, für Letterboxing
               und für die scharf bleibenden Spielerfiguren. */
            this.viewport = new Viewport(this.canvas);
            this.projection = new Projection(this.viewport);

            this.assets = new AssetManager();
            this.audio = new AudioEngine();
            /**
             * Zweiter Eingang für Spieler 2 (obere Figur), nur im Versus-Modus
             * verkabelt. Im Arcade-Modus bleibt die Instanz bestehen, aber ohne
             * Audiograph — `analyse()` wird dort nie aufgerufen.
             * @type {AudioEngine}
             */
            this.audio2 = new AudioEngine();
            this.match = new MatchState();

            this.ball = new Ball();
            this.paddleAndrea = new Paddle(COURT_BOTTOM);
            this.paddleAlex = new Paddle(COURT_TOP);
            this.bounceMarks = new BounceMarks();
            this.dvd = new DvdLogo();

            this.physics = new Physics(
                this.match, this.ball, this.paddleAndrea,
                this.paddleAlex, this.bounceMarks, this.audio, this.audio2
            );
            this.renderer = new Renderer(this.ctx, this.viewport, this.projection, this.assets);
            this.input = new InputHandler(this.match, this.physics);

            /** @type {boolean} Läuft das Spiel (nach dem Onboarding)? */
            this.running = false;
            /** @type {boolean} Läuft die Kalibrierung (Onboarding Schritt 3)? */
            this.calibrating = false;
            /** @type {string} Wer singt gerade ein (Wert aus PLAYER). */
            this.calibPlayer = PLAYER.ANDREA;

            /** Wiederverwendetes Szenen-Objekt für den Renderer. */
            this._scene = {
                match: this.match,
                ball: this.ball,
                paddleAndrea: this.paddleAndrea,
                paddleAlex: this.paddleAlex,
                bounceMarks: this.bounceMarks,
                dvd: this.dvd,
                andreaX: 0,
                /* Für die Live-Anzeige von Tonhöhe und Pegel im Canvas. */
                audio: this.audio,
                audio2: this.audio2
            };

            /* Fixed-Timestep-Notnagel (nur aktiv, wenn FEATURES.FIXED_TIMESTEP) */
            this._lastFrameTime = 0;
            this._accumulator = 0;
            this._stepMs = 1000 / 60;

            /** @type {number} Anzahl abgefangener Frame-Fehler (Diagnose). */
            this._errorCount = 0;
            /** @type {Error|null} Zuletzt abgefangener Fehler (Diagnose). */
            this._lastError = null;

            /** @type {number} Bis wann eine Kalibrierungs-Rückmeldung stehen bleibt. */
            this._hintUntil = 0;

            this._loop = this.loop.bind(this);
            /** @type {HTMLElement|null} */
            this.livePitchDiv = document.getElementById('livePitch');
            /** @type {HTMLElement|null} Eigene Zeile für Rückmeldungen. */
            this.hintDiv = document.getElementById('calibHint');
        }

        /** Einmalige Initialisierung: Assets, Canvas, Hotkeys, UI. */
        boot() {
            this.assets.loadAll();
            this.input.attach();

            window.addEventListener('resize', () => this.handleResize());
            this.handleResize();

            this.bindOnboarding();
            console.info('[Karaokovic] V41 bereit. Hotkeys: Alt+Shift+U = Undo, Alt+Shift+X = Reset.');
        }

        /** Canvasgröße nachziehen; im Ruhezustand den Aufschlag neu aufbauen. */
        handleResize() {
            this.viewport.resize();
            if (!this.running) this.physics.prepareServe();
        }

        /* --------------------------------------------------------------------
         * Onboarding (Mikrofon + Stimmkalibrierung)
         * ----------------------------------------------------------------- */

        /**
         * Der Eingang des Spielers, der gerade einsingt.
         * @returns {AudioEngine}
         */
        calibAudio() {
            return this.calibPlayer === PLAYER.ALEX ? this.audio2 : this.audio;
        }

        /** Buttons aus index.html verdrahten. */
        bindOnboarding() {
            const btnLow = document.getElementById('btnLow');
            const btnHigh = document.getElementById('btnHigh');
            const btnStart = document.getElementById('btnStartGame');

            /* --- Schritt 1: Modus ------------------------------------------ */
            const waehleModus = (modus) => {
                CONFIG.mode = modus;
                document.getElementById('step0').classList.remove('active');
                document.getElementById('step1').classList.add('active');
                console.info(`[Karaokovic] Modus: ${modus}`);
            };
            document.getElementById('btnModeArcade')
                .addEventListener('click', () => waehleModus(MODE.ARCADE));
            document.getElementById('btnModeVersus')
                .addEventListener('click', () => waehleModus(MODE.VERSUS));

            /* --- Schritt 2: Mikrofon --------------------------------------- */
            document.getElementById('btnMic').addEventListener('click', async () => {
                try {
                    if (CONFIG.mode === MODE.VERSUS) {
                        const kanaele = await AudioEngine.initPair(this.audio, this.audio2);
                        if (kanaele < 2) {
                            /* Nicht stillschweigend weiterlaufen: Spieler 2
                               bekäme Stille und stünde die ganze Show über
                               regungslos in der Mitte. */
                            this.showCalibrationHint(
                                'Achtung: Eingang liefert nur einen Kanal — '
                                + 'Spieler 2 bekommt kein Signal.');
                            console.warn(
                                `[AudioEngine] Duell gewählt, Gerät liefert aber `
                                + `${kanaele} Kanal. Spieler 2 bleibt stumm.`);
                        }
                    } else {
                        await this.audio.init();
                    }
                    document.getElementById('step1').classList.remove('active');
                    document.getElementById('step2').classList.add('active');
                    this.beginCalibration(PLAYER.ANDREA);
                    this.calibrating = true;
                    this.start();
                } catch (err) {
                    alert('Mikrofonfehler: ' + err);
                    console.error('[AudioEngine] getUserMedia fehlgeschlagen', err);
                }
            });

            /* --- Schritt 3a: einsingen -------------------------------------
             * WICHTIG: `stablePitch` statt `livePitch`. Gesungen wird ZUERST,
             * geklickt DANACH — livePitch ist beim Klick schon wieder 0.
             * Und jeder abgelehnte Klick sagt jetzt, warum: vorher passierte
             * einfach nichts und das Onboarding wirkte kaputt.
             * -------------------------------------------------------------- */
            btnLow.addEventListener('click', () => {
                const hz = this.calibAudio().stablePitch;
                if (hz <= 0) {
                    this.showCalibrationHint('Kein Ton erkannt — singen und dabei klicken.');
                    return;
                }
                this.setVoiceRange(this.calibPlayer, hz, null);
                /* Der Knopf ist erledigt und sagt das auch. Ohne diese
                   Rückmeldung sah er aus wie einer, der noch gedrückt werden
                   will — und ein zweiter Klick überschrieb den Ton still mit
                   dem, was gerade zufällig im Haltespeicher lag. */
                Game.markDone(btnLow, `✓ Tiefer Ton: ${Math.round(hz)} Hz`);
                btnHigh.disabled = false;
                btnHigh.style.opacity = '1';
                this.showCalibrationHint(`Tiefer Ton gespeichert: ${Math.round(hz)} Hz`, true);
            });

            btnHigh.addEventListener('click', () => {
                const hz = this.calibAudio().stablePitch;
                if (hz <= 0) {
                    this.showCalibrationHint('Kein Ton erkannt — singen und dabei klicken.');
                    return;
                }
                const tief = Physics.voiceRange(this.calibPlayer).min;
                /* Mindestabstand statt "irgendwie höher": liegen beide Töne zu
                   dicht beieinander, wird die Spielfigur später hypernervös,
                   weil der halbe Platz auf wenige Hertz abgebildet wird. */
                if (hz < tief * Game.MIN_CALIBRATION_RATIO) {
                    this.showCalibrationHint(
                        `${Math.round(hz)} Hz ist zu nah am tiefen Ton `
                        + `(${Math.round(tief)} Hz) — bitte höher singen.`
                    );
                    return;
                }
                this.setVoiceRange(this.calibPlayer, null, hz);
                Game.markDone(btnHigh, `✓ Hoher Ton: ${Math.round(hz)} Hz`);
                this.showRangeConfirmation();
            });

            /* --- Schritt 3b: Bereich bestätigen oder verwerfen -------------- */
            document.getElementById('btnRangeOk').addEventListener('click', () => {
                if (CONFIG.mode === MODE.VERSUS && this.calibPlayer === PLAYER.ANDREA) {
                    this.beginCalibration(PLAYER.ALEX);
                    return;
                }
                document.getElementById('calibConfirm').style.display = 'none';
                document.getElementById('startWahl').style.display = 'block';
            });

            document.getElementById('btnRangeRedo').addEventListener('click', () => {
                this.beginCalibration(this.calibPlayer);
                this.showCalibrationHint('Bereich verworfen — bitte neu einsingen.');
            });

            /* --- Start ------------------------------------------------------
             * Zwei Wege ins Spiel. Das Einspielen zählt nichts und dient dem
             * Warmwerden; das Match beginnt sofort bei 0:0. Der Regie-Trigger
             * (Enter + Leertaste) bleibt daneben bestehen, um aus dem
             * Einspielen ins Match zu wechseln.
             * ---------------------------------------------------------------- */
            document.getElementById('btnStartWarmup')
                .addEventListener('click', () => this.enterGame(false));
            btnStart.addEventListener('click', () => this.enterGame(true));
        }

        /**
         * Onboarding verlassen und das Spiel starten.
         * @param {boolean} sofortMatch true = direkt ins Match, false = Einspielen
         */
        enterGame(sofortMatch) {
            this.calibrating = false;
            /* Vorfilter erst jetzt auf den gemessenen Stimmumfang setzen —
               während der Kalibrierung musste er offen sein. Jeder Eingang
               bekommt den Filter SEINES Spielers: ein Bass und ein Sopran
               brauchen unterschiedliche Grenzfrequenzen. */
            this.audio.applyCalibratedFilter(PLAYER.ANDREA);
            if (CONFIG.mode === MODE.VERSUS) {
                this.audio2.applyCalibratedFilter(PLAYER.ALEX);
            }
            document.getElementById('onboarding').style.display = 'none';
            this.canvas.style.display = 'block';

            /* Reihenfolge: erst die Phase setzen, dann den Aufschlag aufbauen.
               `startMatch()` setzt den Stand auf 0:0 und den Aufschlag auf
               Andrea zurück — danach muss der Ballwechsel neu beginnen, sonst
               steht der Ball noch beim vorigen Aufschläger. */
            if (sofortMatch) this.match.startMatch();

            this.physics.haltAt();
            this.physics.haltAlexAt();
            this.audio.resetSmoothing();
            this.audio2.resetSmoothing();
            this.handleResize();
            this.physics.prepareServe();
            this.match.setState(STATE.SILENCE_CHECK);
            this.match.resetSilenceTimer();
            this.running = true;

            console.info(
                `[Karaokovic] Start als ${sofortMatch ? 'MATCH' : 'EINSPIELEN'}`
                + ` | Spieler 1: ${CONFIG.minFreq.toFixed(1)}`
                + ` – ${CONFIG.maxFreq.toFixed(1)} Hz`
                + (CONFIG.mode === MODE.VERSUS
                    ? ` | Spieler 2: ${CONFIG.minFreq2.toFixed(1)}`
                      + ` – ${CONFIG.maxFreq2.toFixed(1)} Hz`
                    : ''));
        }

        /**
         * Kalibrierung für einen Spieler (neu) beginnen.
         *
         * Setzt den Umfang auf die Vorgabewerte zurück. Das ist nicht nur
         * Kosmetik: die Klaviatur erkennt an genau diesen Werten, dass noch
         * nichts eingesungen wurde, und zeigt dann drei Oktaven statt eines
         * Bereichs, den niemand bestätigt hat.
         *
         * @param {string} player Wert aus PLAYER
         */
        beginCalibration(player) {
            this.calibPlayer = player;
            this.setVoiceRange(player,
                Renderer.ONBOARDING_DEFAULT_MIN, Renderer.ONBOARDING_DEFAULT_MAX);

            Game.resetButton(document.getElementById('btnLow'), Game.LABEL_LOW, false);
            Game.resetButton(document.getElementById('btnHigh'), Game.LABEL_HIGH, true);

            document.getElementById('calibSing').style.display = 'block';
            document.getElementById('calibConfirm').style.display = 'none';
            document.getElementById('startWahl').style.display = 'none';

            const wer = document.getElementById('calibWho');
            if (wer) {
                wer.innerText = CONFIG.mode === MODE.VERSUS
                    ? (player === PLAYER.ALEX
                        ? 'SPIELER 2 — obere Figur (rechter Kanal)'
                        : 'SPIELER 1 — untere Figur (linker Kanal)')
                    : '';
            }
        }

        /**
         * Bestätigungsschritt anzeigen: Bereich in Hz, Umfang in Halbtönen.
         *
         * Die eigentliche Anschauung liefert die Klaviatur im Canvas — sie
         * zeigt ab jetzt genau diesen Bereich. Hier steht nur die Zahl dazu.
         */
        showRangeConfirmation() {
            const r = Physics.voiceRange(this.calibPlayer);
            const halbtoene = Math.round(
                Renderer.midiOf(r.max) - Renderer.midiOf(r.min));

            document.getElementById('calibSing').style.display = 'none';
            document.getElementById('calibConfirm').style.display = 'block';
            document.getElementById('calibRange').innerText =
                `${Math.round(r.min)} – ${Math.round(r.max)} Hz`;
            document.getElementById('calibRangeDetail').innerText =
                `${halbtoene} Halbtöne — ${Renderer.noteName(r.min)} bis ${Renderer.noteName(r.max)}`;
        }

        /**
         * Stimmumfang eines Spielers setzen. `null` lässt den Wert stehen.
         * @param {string}      player Wert aus PLAYER
         * @param {number|null} min
         * @param {number|null} max
         */
        setVoiceRange(player, min, max) {
            if (player === PLAYER.ALEX) {
                if (min !== null) CONFIG.minFreq2 = min;
                if (max !== null) CONFIG.maxFreq2 = max;
            } else {
                if (min !== null) CONFIG.minFreq = min;
                if (max !== null) CONFIG.maxFreq = max;
            }
        }

        /**
         * Lautester Eingang dieses Frames.
         *
         * Grundlage der 3-Sekunden-Ruhe: im Duell zählt der lautere der beiden
         * Kanäle, sonst könnte einer der beiden die Ruhe brechen, ohne dass es
         * jemand merkt. Im Arcade-Modus ist es schlicht der einzige Kanal.
         *
         * @returns {number} RMS
         */
        loudestVolume() {
            if (CONFIG.mode !== MODE.VERSUS || !this.audio2.analyser) {
                return this.audio.currentVolume;
            }
            return Math.max(this.audio.currentVolume, this.audio2.currentVolume);
        }

        /** Frame-Loop starten (einmalig nach der Mikrofonfreigabe). */
        start() {
            this._lastFrameTime = performance.now();
            requestAnimationFrame(this._loop);
        }

        /* --------------------------------------------------------------------
         * Frame
         * ----------------------------------------------------------------- */

        /**
         * Ein rAF-Durchlauf: Audio lesen -> Logik -> Zeichnen.
         *
         * ABSTURZSCHUTZ (Bühnenanforderung): Der gesamte Frame liegt in einem
         * try/catch, und `requestAnimationFrame` wird im `finally` neu
         * angefordert. Ohne das beendet EINE einzige Exception die komplette
         * rAF-Kette — das Bild friert ein und ist bis zum Neuladen der Seite
         * tot. Genau dieses Verhalten ist im Mitschnitt vom 10.08. zu sehen:
         * nach dem Punktstand 15-0 stand das Bild neun Sekunden still, ohne
         * dass sich auch nur der Ball bewegte.
         *
         * Fehler werden gezählt und einmalig ausführlich protokolliert; danach
         * läuft das Spiel weiter, damit die Show nicht stehenbleibt.
         * @param {number} now Zeitstempel von requestAnimationFrame
         */
        loop(now) {
            try {
                const result = this.audio.analyse();

                /* Zweiter Eingang nur im Duell — im Arcade-Modus hat diese
                   Instanz keinen Audiograph, `analyse()` würde werfen. */
                let result2 = null;
                if (CONFIG.mode === MODE.VERSUS && this.audio2.analyser) {
                    result2 = this.audio2.analyse();
                    if (this.running) {
                        this.audio2.updateSmoothedPitch(result2.freq, result2.volume);
                    }
                }

                if (this.calibrating) {
                    /* Angezeigt wird der Kanal DESSEN, der gerade einsingt —
                       sonst sieht Spieler 2 die Töne von Spieler 1. */
                    this.updateCalibrationReadout(
                        this.calibPlayer === PLAYER.ALEX ? (result2 || result) : result);
                    this.renderOnboarding();
                }

                if (this.running) {
                    this.audio.updateSmoothedPitch(result.freq, result.volume);

                    if (FEATURES.FIXED_TIMESTEP) {
                        let delta = now - this._lastFrameTime;
                        if (delta > 250) delta = 250; // Spirale nach einem Hänger vermeiden
                        this._accumulator += delta;
                        while (this._accumulator >= this._stepMs) {
                            this.step();
                            this._accumulator -= this._stepMs;
                        }
                    } else {
                        this.step();
                    }

                    this._scene.andreaX = this.physics.currentX;
                    this.renderer.render(this._scene);
                }
            } catch (err) {
                this.handleFrameError(err);
            } finally {
                this._lastFrameTime = now;
                requestAnimationFrame(this._loop);
            }
        }

        /**
         * Canvas während der Kalibrierung: Stadion plus zwei Klaviaturen.
         *
         * Über und unter dem Kasten liegt je eine Klaviatur, die den gesungenen
         * Ton zeigt. Der Tennisplatz bleibt hier bewusst weg — er erscheint
         * erst beim Wechsel ins Einspielen, siehe drawOnboardingBackdrop().
         *
         * Die Lage der Klaviaturen kommt aus dem HTML-Kasten selbst: er wächst,
         * sobald der zweite Knopf freigeschaltet wird.
         */
        renderOnboarding() {
            const el = document.getElementById('onboarding');
            if (!el || el.style.display === 'none') return;

            this.renderer.drawOnboardingBackdrop();

            const rect = el.getBoundingClientRect();
            /* Vor dem Layout (oder bei display:none) liefert der Rect Nullen —
               dann lieber gar keine Klaviatur als zwei am Bildrand. */
            if (rect.width <= 0) return;
            this.renderer.drawOnboardingKeyboards(
                this.calibAudio(), rect, this.calibPlayer);
        }

        /**
         * Fehler in einem Frame protokollieren, ohne die Show anzuhalten.
         * @param {Error} err
         */
        handleFrameError(err) {
            this._errorCount++;
            /* Nur die ersten Fehler vollständig ausgeben — sonst flutet ein
               Fehler, der in jedem Frame auftritt, die Konsole und kostet
               selbst Rechenzeit. */
            if (this._errorCount <= 5) {
                console.error(
                    `[Karaokovic] Fehler in Frame (#${this._errorCount}) — Spiel läuft weiter.`,
                    `Zustand: ${this.match.state}, Stand: ${this.match.scoreLine()}`,
                    err
                );
                this._lastError = err;
            } else if (this._errorCount === 6) {
                console.error('[Karaokovic] Weitere Frame-Fehler werden nicht mehr einzeln gemeldet.');
            }
        }

        /**
         * Ein Logikschritt: Zustandsmaschine, Spielerbewegung, Physik.
         * Reihenfolge identisch zu V36.
         */
        step() {
            const match = this.match;

            switch (match.state) {
                /* --- GESCHÜTZT: 3 Sekunden absolute Ruhe ---------------------- */
                case STATE.SILENCE_CHECK:
                    this.physics.haltAt();
                    this.physics.haltAlexAt();
                    /* Im Duell muss es an BEIDEN Mikrofonen still sein — sonst
                       hält der eine Spieler die Ruhe und der andere redet sie
                       kaputt, ohne dass man sähe, woran es liegt. */
                    if (this.loudestVolume() >= CONFIG.volumeGate) match.resetSilenceTimer();
                    if (match.isSilenceComplete()) {
                        match.state = STATE.SERVE_WAIT;
                        this.physics.serveCharge = 0;
                    }
                    break;

                case STATE.SERVE_WAIT:
                    this.physics.haltAt();
                    this.physics.haltAlexAt();
                    break;

                case STATE.PLAYING: {
                    /* --- Serve-Movement-Lock ---------------------------------
                     * Nach dem Aufschlag klingt der auslösende Ton noch nach.
                     * Solange er anliegt, steht die Figur strikt in der Mitte,
                     * sonst rennt sie ihrem eigenen Aufschlag hinterher.
                     * Gesetzt in Physics.triggerServe().
                     * -------------------------------------------------------- */
                    /* Die Sperre gilt NUR für den Aufschläger. Im Duell darf
                       der Rückschläger sich längst bewegen — er singt ja nicht
                       den Aufschlag. Im Arcade-Modus läuft es auf dasselbe
                       hinaus wie vorher: die einzige Stimme im Raum gehört dem
                       Aufschläger, also ist immer sie gesperrt. */
                    const versus = CONFIG.mode === MODE.VERSUS;
                    const alexSchlaegtAuf = match.server === PLAYER.ALEX;
                    const gesperrt = this.physics.serveMovementLock;
                    const untenGesperrt = gesperrt && !(versus && alexSchlaegtAuf);
                    const obenGesperrt = gesperrt && alexSchlaegtAuf;

                    if (gesperrt) {
                        /* Position, Ziel UND Geschwindigkeit werden gehalten.
                           Die Geschwindigkeit ist neu und zwingend: eine
                           gedämpfte Bewegung trägt ihren Schwung im Zustand
                           mit, die Figur würde sonst im Moment der Freigabe
                           mit der alten Geschwindigkeit weiterlaufen. */
                        if (untenGesperrt) this.physics.haltAt();
                        if (obenGesperrt) this.physics.haltAlexAt();

                        /* Schwelle ist CONFIG.moveGate, NICHT volumeGate.
                           Der Zusammenhang ist zwingend: die Sperre darf erst
                           fallen, wenn der Ton auch die Bewegung nicht mehr
                           antreibt. Solange hier volumeGate (0.02) stand,
                           moveGate aber bei 0.015 liegt, gab es ein Fenster
                           von 0.015 bis 0.020, in dem die Sperre bereits fiel
                           und der ausklingende Aufschlagton die Tonhöhe noch
                           nachführte — die Aufschlägerin lief also erneut
                           ihrem eigenen Aufschlag hinterher. Vor der Trennung
                           der Schwellen lag moveGate bei 0.025 und damit über
                           volumeGate; die Reihenfolge stimmte zufällig.
                           MERKE: Freigabeschwelle <= moveGate. */
                        const aufschlagTon = this.physics.serverAudio();
                        if (aufschlagTon.currentVolume < CONFIG.moveGate) {
                            this.physics.serveMovementLock = false;

                            /* KERN DES FEHLERS: `smoothedPitch` überlebt die
                               Stille. updateSmoothedPitch() schreibt nur bei
                               einem Ton ÜBER dem Gate — fällt die Lautstärke,
                               bleibt die Tonhöhe des Aufschlags stehen. Genau
                               in dem Frame, in dem die Sperre fällt, lieferte
                               dieser alte Wert wieder eine Zielposition weit
                               außen, und die Figur sprintete dorthin, wohin
                               der Aufschlag gesungen worden war.
                               Zurücksetzen auf -1 heißt: bis zum NÄCHSTEN
                               erkannten Ton bleibt targetX in der Mitte. */
                            aufschlagTon.resetSmoothing();
                        }
                    }

                    /* --- untere Figur (Spieler 1) ---------------------------- */
                    if (!untenGesperrt) {
                        if (this.audio.smoothedPitch !== -1) {
                            this.physics.targetX = this.physics.freqToQuantizedX(
                                this.audio.smoothedPitch, PLAYER.ANDREA);
                        }
                        /* Gedämpft statt linear interpoliert — siehe glideToTarget().
                           Wichtig: die Figur gleitet auch dann weiter, wenn gerade
                           KEIN Ton anliegt. Bei abgehackt gesungenen Tönen bleibt
                           targetX zwischen den Tönen einfach stehen, die Bewegung
                           läuft sauber aus statt mitten im Weg einzufrieren. */
                        this.physics.glideToTarget();
                    }

                    /* --- obere Figur (Spieler 2, nur im Duell) --------------- *
                     * Nur das ZIEL wird hier gesetzt. Bewegt wird sie in
                     * Physics.update(), an genau der Stelle, an der im
                     * Arcade-Modus die KI läuft — damit bleibt die
                     * Reihenfolge Bewegung -> Aufsprung -> Schläger für beide
                     * Modi dieselbe.
                     * -------------------------------------------------------- */
                    if (versus && !obenGesperrt && this.audio2.smoothedPitch !== -1) {
                        this.physics.alexTargetX = this.physics.freqToQuantizedX(
                            this.audio2.smoothedPitch, PLAYER.ALEX);
                    }
                    break;
                }

                case STATE.POINT_SCORED:
                    if (match.elapsed() > TIMING.POINT_MS) {
                        match.setState(STATE.TRANSITION);
                        match.transitionResetDone = false;
                        this.dvd.reset();
                    }
                    break;

                case STATE.TRANSITION: {
                    const prog = match.elapsed() / TIMING.TRANSITION_MS;
                    if (prog > 0.2 && !match.transitionResetDone) {
                        this.physics.prepareServe();
                        match.transitionResetDone = true;
                    }
                    if (prog > 0.2) this.dvd.update();
                    if (prog >= 1.0) {
                        match.setState(STATE.SILENCE_CHECK);
                        match.resetSilenceTimer();
                    }
                    break;
                }

                default:
                    break;
            }

            /* Feldgrenzen für Andrea: der Overdrive endet an der äußeren
               Seitenlinie — siehe Physics.PLAYER_MAX_X.
               clampCurrentX() nullt an der Linie zugleich die Geschwindigkeit. */
            this.physics.clampCurrentX();

            this.physics.update();
        }

        /**
         * Kurze Rückmeldung im Kalibrierungsfeld anzeigen.
         *
         * Blockiert die Live-Anzeige für ein paar Sekunden, sonst wäre der Text
         * im nächsten Frame wieder überschrieben und niemand hätte ihn gelesen.
         * @param {string}  text
         * @param {boolean} [ok=false] true = Erfolg (grün), false = Hinweis (rot)
         */
        showCalibrationHint(text, ok) {
            if (!this.hintDiv) return;
            this.hintDiv.innerText = text;
            /* Eigene Zeile statt der Hertz-Anzeige. Vorher überschrieb der
               Hinweis den Messwert und lief bei längeren Sätzen aus dem auf
               40 px fixierten Feld heraus, mitten in die Schrift darunter. */
            this.hintDiv.className = ok ? 'ok' : '';
            this._hintUntil = Date.now() + Game.HINT_MS;
        }

        /** Abgelaufenen Hinweis wieder wegnehmen. */
        expireCalibrationHint() {
            if (!this.hintDiv || !this._hintUntil) return;
            if (Date.now() < this._hintUntil) return;
            this.hintDiv.innerText = '';
            this._hintUntil = 0;
        }

        /**
         * Anzeige im Kalibrierungsschritt aktualisieren.
         * @param {{freq:number, volume:number}} result
         */
        updateCalibrationReadout(result) {
            this.expireCalibrationHint();
            if (!this.livePitchDiv) return;

            /* Auch der gehaltene Ton wird angezeigt: die Sängerin sieht so,
               dass ihr Ton noch "im Speicher" liegt, während sie zum Knopf
               greift. Genau dieses Fenster hat vorher gefehlt. */
            const held = this.calibAudio().stablePitch;
            if (result.freq !== -1) {
                this.livePitchDiv.innerText =
                    `${Math.round(result.freq)} Hz | VOL: ${result.volume.toFixed(3)}`;
                this.livePitchDiv.dataset.currentFreq = String(result.freq);
            } else if (held > 0) {
                this.livePitchDiv.innerText =
                    `(${Math.round(held)} Hz gehalten) | VOL: ${result.volume.toFixed(3)}`;
                this.livePitchDiv.dataset.currentFreq = String(held);
            } else {
                this.livePitchDiv.innerText = `-- Hz | VOL: ${result.volume.toFixed(3)}`;
                this.livePitchDiv.dataset.currentFreq = '0';
            }
        }
    }

    /** Anzeigedauer einer Kalibrierungs-Rückmeldung in Millisekunden. */
    Game.HINT_MS = 2500;

    /** Beschriftungen der Kalibrierknöpfe im unbenutzten Zustand. */
    Game.LABEL_LOW = 'Tiefen Ton (Links) speichern';
    Game.LABEL_HIGH = 'Hohen Ton (Rechts) speichern';

    /**
     * Einen Kalibrierknopf als erledigt kennzeichnen.
     *
     * Er zeigt ab jetzt den gespeicherten Ton und nimmt keine Klicks mehr an.
     * Beides gehört zusammen: ein Knopf, der noch klickbar aussieht, wird auch
     * geklickt — und der zweite Klick hätte den Ton mit dem überschrieben, was
     * gerade zufällig im Haltespeicher lag.
     *
     * @param {HTMLElement} btn
     * @param {string}      text
     */
    Game.markDone = function (btn, text) {
        if (!btn) return;
        btn.innerText = text;
        btn.disabled = true;
        btn.classList.add('erledigt');
        btn.style.opacity = '1';
    };

    /**
     * Kalibrierknopf in den Ausgangszustand zurückversetzen.
     * @param {HTMLElement} btn
     * @param {string}      text     Ursprüngliche Beschriftung
     * @param {boolean}     gesperrt true = noch nicht an der Reihe
     */
    Game.resetButton = function (btn, text, gesperrt) {
        if (!btn) return;
        btn.innerText = text;
        btn.disabled = gesperrt;
        btn.classList.remove('erledigt');
        btn.style.opacity = gesperrt ? '0.3' : '1';
    };

    /**
     * Mindestverhältnis zwischen hohem und tiefem Kalibrierton.
     * 1.25 entspricht knapp einer kleinen Terz — weniger Abstand macht die
     * Steuerung unspielbar zappelig.
     */
    Game.MIN_CALIBRATION_RATIO = 1.25;

    /* =========================================================================
     * BOOTSTRAP
     * ====================================================================== */

    const game = new Game();
    game.boot();

    /* Diagnosezugriff für die Live-Produktion (Chrome DevTools):
       window.KARAOKOVIC.match.scoreLine(), .physics.prepareServe(), ... */
    window.KARAOKOVIC = game;

    /* Die Stellschrauben aus der Übergabe (glideFrames, pitchSmooth,
       serveVolume, ...) liegen alle in CONFIG. Ohne diesen Zugriff müsste
       zum Nachjustieren auf der Bühne die Datei bearbeitet und neu geladen
       werden — mit ihm genügt eine Zeile in der Konsole. */
    game.config = CONFIG;
    game.PLAYER = PLAYER;
    game.MODE = MODE;
})();
