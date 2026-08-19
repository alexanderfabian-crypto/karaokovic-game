/* =============================================================================
 * TEST: Loest ein Ton weit ausserhalb der Range den Aufschlag aus?
 *
 * Buehnenwunsch: "Ein Aufschlag, der viel zu hoch oder viel zu niedrig als die
 * Range gesungen wird, darf den Aufschlag nicht ausloesen."
 *
 * Bisher zaehlte allein die LAUTSTAERKE. Ein Quietschen weit ueber dem Umfang
 * oder ein Brummen weit darunter loeste genauso aus wie ein sauber gesungener
 * Ton — der Ball flog dann an die geklemmte Feldkante.
 *
 * Die Toleranz ist bewusst grosszuegig (CONFIG.aufschlagToleranzHalbtoene):
 * der Overdrive ueber den Umfang hinaus ist ausdruecklich erwuenscht, und wer
 * knapp daneben liegt, soll aufschlagen koennen. Abgewiesen wird nur, was
 * offensichtlich nicht gemeint war.
 *
 * Start: node Entwickler-Tests/test-aufschlag-tonhoehe.js
 * ========================================================================== */

'use strict';

const { loadGame, check, summary } = require('./dom-stub.js');
const game = loadGame('../app-arena.js');
const { physics, audio, PLAYER } = game;

game.setVoiceRange(PLAYER.ANDREA, 110, 330);
const tol = game.config.aufschlagToleranzHalbtoene;
const halbton = (n) => Math.pow(2, n / 12);

console.log(`Umfang 110–330 Hz, Toleranz ${tol} Halbtoene`);
console.log(`  erlaubt also rund ${(110 / halbton(tol)).toFixed(0)}`
    + ` bis ${(330 * halbton(tol)).toFixed(0)} Hz`);

/**
 * @param {number} hz
 * @returns {boolean}
 */
function passt(hz) {
    audio.smoothedPitch = hz;
    return physics.aufschlagTonPasst(audio);
}

/* --- 1. Mitten im Umfang ------------------------------------------------- */
check('Ein Ton mitten im Umfang loest aus', passt(200) === true);
check('Der tiefste kalibrierte Ton loest aus', passt(110) === true);
check('Der hoechste kalibrierte Ton loest aus', passt(330) === true);

/* --- 2. Knapp daneben bleibt erlaubt (Overdrive) ------------------------- */
check('Zwei Halbtoene unter dem Umfang loesen noch aus',
    passt(110 / halbton(2)) === true);
check('Zwei Halbtoene ueber dem Umfang loesen noch aus',
    passt(330 * halbton(2)) === true);
check('Genau an der Toleranzgrenze loest noch aus',
    passt(330 * halbton(tol) - 1) === true);

/* --- 3. Weit daneben wird abgewiesen ------------------------------------- */
check('Eine Oktave ueber dem Umfang loest NICHT aus',
    passt(330 * 2) === false, `${Math.round(330 * 2)} Hz`);
check('Eine Oktave unter dem Umfang loest NICHT aus',
    passt(110 / 2) === false, `${Math.round(110 / 2)} Hz`);
check('Acht Halbtoene darueber loesen NICHT aus',
    passt(330 * halbton(8)) === false);

/* --- 4. Ohne erkannten Ton bleibt es wie bisher --------------------------- */
audio.smoothedPitch = -1;
check('Ohne erkannte Tonhoehe bleibt der Aufschlag moeglich',
    physics.aufschlagTonPasst(audio) === true);

/* --- 5. Der Umfang des EINGANGS zaehlt, nicht der des Aufschlaegers ------ *
 * Dieselbe Unterscheidung wie in triggerServe(): im Arcade-Modus liest
 * serverAudio() bei Alex' Aufschlag Andreas Mikrofon.
 * ------------------------------------------------------------------------ */
game.setVoiceRange(PLAYER.ALEX, 400, 900);
game.config.mode = game.MODE.VERSUS;
physics.audio2.smoothedPitch = 600;
check('Spieler 2 wird an SEINEM Umfang gemessen',
    physics.aufschlagTonPasst(physics.audio2) === true, '600 Hz bei 400–900');
physics.audio2.smoothedPitch = 150;
check('Und 150 Hz liegt fuer ihn weit darunter',
    physics.aufschlagTonPasst(physics.audio2) === false);

summary();
