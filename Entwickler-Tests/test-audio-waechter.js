/* =============================================================================
 * TEST: Ein toter Audioeingang wird erkannt (Arena-Fassung)
 *
 * BEFUND: `getFloatTimeDomainData()` wirft NIE. Bei suspendiertem Context
 * liefert sie den eingefrorenen letzten Puffer, bei beendetem Track Stille.
 * Ein toter Dante-Feed sieht deshalb aus wie ein heiles Spiel, in dem niemand
 * singt — von aussen exakt das Symptom des Oktavfehler-Ausfalls, nur ohne
 * jede Protokollzeile.
 *
 * Die Erkennung ist physikalisch begruendet: ein lebendes Mikrofon liefert nie
 * ueber Sekunden bit-identisches RMS, das Grundrauschen zittert immer in den
 * hinteren Nachkommastellen. Drei Pruefungen in Folge exakt derselbe Wert
 * heisst: der Graph verarbeitet nichts mehr.
 *
 * Start: node Entwickler-Tests/test-audio-waechter.js
 * ========================================================================== */

'use strict';

const { loadGame, check, summary } = require('./dom-stub.js');
const game = loadGame('../app-arena.js');

/* Der Waechter laeuft erst mit geoeffnetem Eingang — ohne Mikrofon gibt es
   nichts zu ueberwachen. Im Test wird der Analyser deshalb angedeutet;
   `audioCtx` bleibt null, damit der resume()-Zweig ausser Betracht bleibt. */
game.audio.analyser = {};
game.renderer.render = () => {};
game.running = true;

/** @type {number} Wert, den das gefaelschte Mikrofon meldet. */
let pegel = 0.0123;
game.audio.analyse = () => {
    game.audio.currentVolume = pegel;
    game.audio.livePitch = 0;
    return { freq: -1, volume: pegel };
};

/**
 * Einen Frame zum Zeitpunkt `now` fahren.
 *
 * `_lastFrameTime` wird vorher gleichgesetzt, damit der Luecken-Waechter aus
 * ARENA-13 nicht dazwischenfunkt: geprueft wird hier der AUDIO-Waechter, und
 * der haengt an seiner eigenen Uhr (`_audioCheck`), nicht am Frameabstand.
 */
function frame(now) {
    game._lastFrameTime = now;
    game.loop(now);
}

const zeilenAb = () => game.Protokoll.zeilen.length;
const seit = (n) => game.Protokoll.zeilen.slice(n).join('\n');

const T = game.uhr.jetzt() + 5000;
let ab = zeilenAb();

/* --- 1. Drei Sekunden bit-identisches RMS = tot -------------------------- */
frame(T);            // erste Pruefung, noch kein Vergleichswert
check('Nach der ersten Pruefung gilt der Eingang als lebendig',
    game.audioTot === false);

frame(T + 1100);
frame(T + 2200);
check('Auch nach zwei gleichen Werten noch nicht',
    game.audioTot === false, `${game._pulsGleich} gleiche`);

frame(T + 3300);
check('Beim dritten gleichen Wert gilt der Eingang als eingefroren',
    game.audioTot === true, `${game._pulsGleich} gleiche`);
check('Und es steht im Protokoll',
    /AUDIOEINGANG EINGEFROREN/.test(seit(ab)));
check('Mit dem Rettungsgriff in derselben Zeile',
    /audioNeustart\(\)/.test(seit(ab)));

/* --- 2. Die Warnung erreicht den Operator -------------------------------- *
 * SEIT ARENA-24 NICHT MEHR IM BILD. Sie stand als "AUDIOEINGANG TOT" gross
 * unten rechts im Canvas — und der geht auf die Wand, ins Programm und auf
 * die Spielermonitore. Jetzt brennt Lampe E-01 im Operator-Panel, das im DOM
 * liegt und im Regelfall aus ist. */
game.Renderer.SHOW_AUDIO_METER = true;
const lage = game.panelLage();
check('Lampe E-01 brennt', lage.e[0].an === true);
check('Und nennt den Rettungsgriff', /audioNeustart/.test(lage.e[0].wert),
    lage.e[0].wert);
game.Renderer.SHOW_AUDIO_METER = false;
/* Der Szenenwert bleibt gesetzt — er ist die Quelle, aus der das Panel liest.
   Gezeichnet wird er nicht mehr; das prueft test-sendebild.js. */
check('Die Quelle steht weiterhin in der Szene',
    game._scene.audioTot === true);

/* --- 3. Ein zitternder Pegel gilt sofort wieder als lebendig ------------- */
ab = zeilenAb();
pegel = 0.0124;
frame(T + 4400);
check('Ein anderer Messwert beendet den Alarm',
    game.audioTot === false);
check('Die Rueckkehr steht ebenfalls im Protokoll',
    /liefert wieder Daten/.test(seit(ab)));

/* --- 4. Ein lebendiges Mikrofon loest nie aus ---------------------------- */
/* Gegenprobe: mit zitterndem Grundrauschen darf der Waechter ueber viele
   Pruefungen hinweg stumm bleiben. Sonst waere er auf der Buehne ein
   Dauerfehlalarm. */
ab = zeilenAb();
for (let i = 0; i < 12; i++) {
    pegel = 0.012 + i * 1e-6;
    frame(T + 5500 + i * 1100);
}
check('Zitterndes Grundrauschen loest keinen Alarm aus',
    game.audioTot === false && !/EINGEFROREN/.test(seit(ab)));

/* --- 5. Der Heissstart meldet seinen Ausgang ----------------------------- */
/* Ohne Mikrofon muss er scheitern — und das sagen. Ein stiller Fehlschlag
   waere auf der Buehne das Schlimmste: der Operator glaubt, es laeuft. */
ab = zeilenAb();
game.audioNeustart().then((ok) => {
    check('Ohne Mikrofon meldet der Heissstart einen Fehlschlag', ok === false);
    check('Der Versuch steht im Protokoll',
        /Neuverbindung angefordert/.test(seit(ab)));
    check('Und sein Scheitern ebenfalls',
        /Neuverbindung fehlgeschlagen/.test(seit(ab)));
    summary();
});
