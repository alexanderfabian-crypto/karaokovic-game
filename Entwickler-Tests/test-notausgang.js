/* =============================================================================
 * TEST: Der Notausgang hinterlaesst keinen falschen Alarm (Arena-Fassung)
 *
 * Alt+Shift+A erzwingt einen Aufschlag, wenn der Raum zu laut ist und die
 * Ruhepruefung nicht fertig wird. Auf einer Aufzeichnung ist ein Aufschlag zur
 * Unzeit billiger als ein Stillstand.
 *
 * BEFUND: Der Notausgang verliess SILENCE_CHECK an der Haenger-Erkennung
 * vorbei. Deren eigene Uhr (`_ruheSeit`) wurde nur im REGULAEREN Ausstieg
 * zurueckgesetzt — nach einem erzwungenen Aufschlag blieb ihr Zeitstempel
 * stehen, und die NAECHSTE Ruhephase zeigte ab dem ersten Frame
 * "RAUM ZU LAUT — ES BRAUCHT RUHE". Auch in einem vollkommen stillen Studio.
 * Genau die Sorte falscher Alarm, die auf der Buehne das Vertrauen in die
 * Anzeige kostet.
 *
 * Seit ARENA-11 misst die Erkennung die Zeit IM ZUSTAND (`match.elapsed()`)
 * statt auf einer eigenen Uhr. Das setzt voraus, dass alle Uebergaenge ueber
 * setState() laufen — deshalb wird beides hier geprueft:
 *
 *   1. Nach dem Notausgang ist die naechste Ruhephase wieder unbelastet.
 *      (Der Punkt, an dem die Fassung vor ARENA-11 faellt.)
 *   2. Die Haenger-Erkennung schlaegt bei echtem Laerm weiterhin an.
 *   3. Die Uebergaenge rund um den Aufschlag stehen im Protokoll.
 *
 * Punkt 3 ist kein Selbstzweck: aus genau diesem Protokoll wurde die Session
 * ausgewertet, die 42 Sekunden festhing — und ausgerechnet die zwei Wechsel
 * um den Aufschlag herum fehlten darin.
 *
 * Start: node Entwickler-Tests/test-notausgang.js
 * ========================================================================== */

'use strict';

const { loadGame, check, summary } = require('./dom-stub.js');
const game = loadGame('../app-arena.js');

const match = game.match;
const STILLE = 'SILENCE_CHECK';

/**
 * Die Warnschwelle herunterdrehen, damit ECHTE Zeit vergehen kann.
 *
 * Wesentlich fuer die Aussagekraft dieses Tests. Ein kuenstliches Altern
 * (`match.stateTimer` zurueckdatieren) wuerde nur die Uhr treffen, die die
 * heutige Fassung benutzt — eine wiedereingefuehrte Nebenuhr bliebe davon
 * unberuehrt, und der Test waere gruen, obwohl der Fehler zurueck ist.
 * Nachgemessen: gegen die Fassung vor ARENA-11 faellt er mit echter Zeit,
 * mit gestellter nicht.
 *
 * 40 ms statt acht Sekunden: geprueft wird das Verhalten der Erkennung, nicht
 * die Zahl. Die steht bei Game.RUHE_WARNUNG_MS und wird anderswo nicht
 * gelesen.
 */
game.constructor.RUHE_WARNUNG_MS = 40;
const SCHWELLE = game.constructor.RUHE_WARNUNG_MS;

/** Den Raum dauerhaft zu laut machen: die Ruhe-Uhr wird nie fertig. */
function laut() { game.audio.currentVolume = 0.5; }
/** Und wieder still. */
function still() { game.audio.currentVolume = 0; }

/**
 * In die Ruhephase gehen, als sei sie gerade erst betreten worden.
 * Geht ueber restartServe() — denselben Weg, den Undo und Reset nehmen.
 */
function ruhephaseBeginnen() {
    game.input.restartServe();
}

/**
 * Echt warten, auf der Uhr des Spiels.
 *
 * Busy-wait und kein setTimeout: der Test bleibt dadurch synchron und liest
 * sich von oben nach unten. Es geht um Millisekunden, nicht um Sekunden.
 * @param {number} ms
 */
function warte(ms) {
    const bis = game.uhr.jetzt() + ms;
    while (game.uhr.jetzt() < bis) { /* absichtlich leer */ }
}

/* --- 1. Bei echtem Laerm schlaegt die Erkennung an ----------------------- */
laut();
ruhephaseBeginnen();
game.step();                 // erster Frame der Ruhephase
warte(SCHWELLE * 1.5);
game.step();                 // und einer, nachdem die Schwelle ueberschritten ist

check('Zustand bleibt in der Ruhephase, solange es laut ist',
    match.state === STILLE, match.state);
check('Nach anhaltendem Laerm meldet die Anzeige den Haenger',
    game.ruheHaengt === true, `ruheHaengt=${game.ruheHaengt}`);

const warnungen = game.Protokoll.zeilen.filter(z => /WARNUNG/.test(z)).length;
check('Und das Protokoll haelt es fest', warnungen >= 1, `${warnungen} Zeile(n)`);

/* --- 2. Der Notausgang -------------------------------------------------- */
game.input.erzwingeAufschlag();
check('Alt+Shift+A verlaesst die Ruhephase sofort',
    match.state === 'PLAYING', match.state);

/* --- 3. Die naechste Ruhephase ist unbelastet ---------------------------- */
/* Der Raum bleibt absichtlich LAUT. Genau das war der Fehlerfall: die
   Erkennung darf erst nach ihren acht Sekunden anschlagen, nicht sofort —
   und schon gar nicht wegen einer Uhr aus der vorigen Ruhephase. */
ruhephaseBeginnen();
game.step();

check('Nach dem Notausgang meldet die naechste Ruhephase keinen Haenger',
    game.ruheHaengt === false, `ruheHaengt=${game.ruheHaengt}`);
check('Die Uhr der Ruhephase beginnt tatsaechlich neu',
    match.elapsed() < 1000, `${Math.round(match.elapsed())} ms`);

/* --- 4. Und sie schlaegt danach wieder an -------------------------------- */
/* Ein Merker, der nur einmal je Sitzung feuert, waere die naechste Falle:
   der zweite Haenger des Abends bliebe stumm. */
warte(SCHWELLE * 1.5);
game.step();
check('Ein spaeterer Haenger wird erneut gemeldet',
    game.ruheHaengt === true, `ruheHaengt=${game.ruheHaengt}`);

/* --- 5. Die Uebergaenge stehen im Protokoll ------------------------------ */
still();
ruhephaseBeginnen();
/* Die Ruhe-Uhr auf "erfuellt" stellen, statt zwei Sekunden echt zu warten. */
match.silenceTimerStart = game.uhr.jetzt() - game.TIMING.SILENCE_MS - 10;
game.step();
check('Bei Ruhe geht es weiter zum Aufschlag',
    match.state === 'SERVE_WAIT', match.state);

const protokoll = game.Protokoll.text();
check('Der Wechsel in den Aufschlag steht im Protokoll',
    /SILENCE_CHECK -> SERVE_WAIT/.test(protokoll));

game.physics.triggerServe();
check('Der Aufschlag selbst wechselt ebenfalls ueber setState()',
    /SERVE_WAIT -> PLAYING/.test(game.Protokoll.text()), match.state);

summary();
