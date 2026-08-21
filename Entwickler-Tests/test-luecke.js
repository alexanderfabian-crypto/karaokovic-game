/* =============================================================================
 * TEST: Eine Pause der Bildkette verfaelscht die Zustandsuhren nicht (Arena)
 *
 * BEFUND: requestAnimationFrame steht, sobald das Fenster minimiert oder
 * vollstaendig verdeckt ist oder das Display schlaeft. Die PHYSIK uebersteht
 * das von selbst — sie zaehlt Aufrufe und kennt kein Delta. Die Zustandsuhren
 * laufen aber weiter, weil sie an performance.now() haengen:
 *
 *   - Nach der Luecke gilt die Ruhe als erbracht, obwohl in dieser Zeit
 *     NIEMAND gemessen hat. Der Countdown ist beim Zurueckholen einfach weg.
 *   - `elapsed()` ueberschreitet die acht Sekunden und protokolliert eine
 *     Haenger-Warnung, die es nie gab.
 *
 * Geprueft wird beides — und zwar mit GEGENPROBE: derselbe Sprung wird einmal
 * mit und einmal ohne Waechter gefahren (ueber Game.FRAME_LUECKE_MS). Ohne
 * ihn muss die Ruhe faelschlich fertig werden; sonst pruefte der Test nichts.
 *
 * Start: node Entwickler-Tests/test-luecke.js
 * ========================================================================== */

'use strict';

const { loadGame, check, summary } = require('./dom-stub.js');
const game = loadGame('../app-arena.js');
const match = game.match;

/* Kein Mikrofon im Test: analyse() wird ersetzt, der Raum ist still. */
game.audio.analyse = () => {
    game.audio.currentVolume = 0;
    game.audio.livePitch = 0;
    return { freq: -1, volume: 0 };
};
/* Gezeichnet wird nicht — geprueft wird der Waechter, nicht der Renderer. */
game.renderer.render = () => {};
game.running = true;

/**
 * Eine Pause der Bildkette von `ms` nachstellen und den ersten Frame danach
 * fahren.
 *
 * ENTSCHEIDEND: eine echte Luecke heisst, dass die UHR weitergelaufen ist,
 * waehrend die Zustandsuhren stehen blieben. Es genuegt deshalb NICHT, nur
 * den rAF-Zeitstempel zu erfinden — dann waere `Uhr.jetzt()` unveraendert,
 * die Ruhe koennte gar nicht faelschlich fertig werden, und der Test meldete
 * gruen, ohne etwas zu pruefen. (Genau so stand er hier zuerst.)
 * Anhalten laesst sich die Uhr nicht, also werden alle Anker um `ms`
 * zurueckdatiert — das ist dieselbe Lage.
 *
 * Ausgangslage jeweils: Ruhephase, es fehlten noch 100 ms.
 *
 * @param   {number} ms Dauer der Luecke
 * @returns {number} Zustandsanker VOR dem Frame
 */
function luecke(ms) {
    game.input.restartServe();
    const jetzt = game.uhr.jetzt();
    const vorDerLuecke = jetzt - ms - (game.TIMING.SILENCE_MS - 100);
    match.silenceTimerStart = vorDerLuecke;
    match.stateTimer = vorDerLuecke;
    /* Der letzte Frame liegt VOR der Luecke. Ihn zurueckzudatieren geht in
       Node nicht: dort ist `Uhr.jetzt()` wenige Millisekunden nach dem
       Prozessstart, `jetzt - 10000` waere negativ — und genau negative
       Zeitstempel ueberspringt der Waechter, weil er den allerersten Frame
       nicht als Luecke melden soll. Stattdessen wandert der rAF-Zeitstempel
       nach vorn; fuer `now - _lastFrameTime` ist das dieselbe Luecke. */
    game._lastFrameTime = jetzt;
    const anker = match.stateTimer;
    game.loop(jetzt + ms);
    return anker;
}

const zeilenAb = () => game.Protokoll.zeilen.length;
const seit = (n) => game.Protokoll.zeilen.slice(n).join('\n');

/* --- 1. Ein normaler Frame loest nichts aus ------------------------------ */
let ab = zeilenAb();
luecke(16);
check('Ein normaler Frame ist keine Luecke',
    !/Frame-Luecke/.test(seit(ab)));

/* --- 2. Zehn Sekunden Pause: die Ruhe beginnt NEU ------------------------ */
ab = zeilenAb();
const ankerVorher = luecke(10000);

check('Die Luecke steht im Protokoll', /Frame-Luecke/.test(seit(ab)),
    seit(ab).split('\n').filter((z) => /Luecke/.test(z)).join(''));
check('Der Zustandsanker wandert um die Luecke mit',
    match.stateTimer - ankerVorher > 9000,
    `${Math.round(match.stateTimer - ankerVorher)} ms`);
check('Die Ruhe gilt NICHT als erbracht — der Countdown laeuft neu',
    match.state === 'SILENCE_CHECK', match.state);
check('Und es gibt keine Geister-Warnung "Ruhe seit 8 s"',
    !/Ruhe seit 8 s/.test(seit(ab)));

/* --- 3. Gegenprobe: ohne Waechter faellt beides um ----------------------- */
/* Die Schwelle wird so hoch gesetzt, dass der Waechter nicht anspringt —
   damit verhaelt sich das Spiel exakt wie vor ARENA-13. */
const echteSchwelle = game.constructor.FRAME_LUECKE_MS;
game.constructor.FRAME_LUECKE_MS = 1e9;

ab = zeilenAb();
luecke(10000);

check('OHNE Waechter gilt die Ruhe faelschlich als erbracht',
    match.state === 'SERVE_WAIT', match.state);
check('OHNE Waechter steht zusaetzlich die Geister-Warnung im Protokoll',
    /Ruhe seit 8 s/.test(seit(ab)));

game.constructor.FRAME_LUECKE_MS = echteSchwelle;

/* --- 4. Waehrend des Onboardings greift der Waechter nicht --------------- */
/* Dort laeuft die Zustandsmaschine nicht, und eine Warnung waehrend des
   Einsingens waere schlicht Rauschen. */
game.running = false;
ab = zeilenAb();
luecke(10000);
check('Vor dem Spielstart wird keine Luecke gemeldet',
    !/Frame-Luecke/.test(seit(ab)));
game.running = true;

/* --- 5. Tastaturfokus ---------------------------------------------------- */
/* Die Tastatur folgt dem FOKUS, nicht der Sichtbarkeit: nach einem Klick in
   DevTools ist der Notausgang tot, und ohne diese Meldung sieht man es nicht. */
ab = zeilenAb();
game.input._onBlur();
check('Fokusverlust steht im Protokoll',
    /Tastaturfokus verloren/.test(seit(ab)), seit(ab));
check('Und die gedrueckten Tasten sind vergessen',
    game.input._down.size === 0);

ab = zeilenAb();
game.input._onFocus();
check('Die Rueckkehr des Fokus ebenfalls',
    /Tastaturfokus wieder/.test(seit(ab)));

/* --- 6. WakeLock: das Display darf die Bildkette nicht beenden ----------- */
/* Drei Stunden Standby ohne Eingabe heissen ohne Gegenmassnahme: Display
   schlaeft — und ein schlafendes Display ist die garantierte Pause aus
   Abschnitt 2. Im Test gibt es keine WakeLock-API; geprueft wird deshalb,
   dass das SICHTBAR wird statt still zu scheitern. Denn genau darauf
   verlaesst sich sonst die Betriebsregel im Runbook. */
ab = zeilenAb();
game.wachhalten();
check('Fehlende WakeLock-API steht im Protokoll',
    /WakeLock nicht verfuegbar/.test(seit(ab)), seit(ab));
check('Und nennt die Gegenmassnahme',
    /Display-Ruhezustand im System/.test(seit(ab)));

summary();
