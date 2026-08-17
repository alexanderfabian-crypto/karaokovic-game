/* =============================================================================
 * TEST: Steht die Figur still, wenn ein Ton gehalten wird? (Arena-Fassung)
 *
 * Bühnenbefund: "Andrea wackelt zu sehr, sie schwimmt förmlich."
 *
 * Die Ursache lag NICHT in der Dämpfung — die ist kritisch gedämpft und
 * schwingt nicht über —, sondern im Ziel. Eine gehaltene Note ist nie exakt
 * konstant; jedes Vibrato verschiebt die errechnete Position um ein paar
 * Pixel, und die Figur folgte gehorsam jedem davon. Sie pendelte damit
 * dauerhaft um die errechnete Tonmitte, statt zur Ruhe zu kommen.
 *
 * Geprüft wird deshalb genau das, was auf der Bühne auffiel: die zurückgelegte
 * Strecke, WÄHREND ein Ton gehalten wird. Nicht die Zielposition — die war
 * nie das Problem.
 *
 * Gegenprobe im selben Lauf: ein wirklich anderer Ton muss die Figur weiterhin
 * bewegen. Eine Totzone, die zu weit greift, macht die Steuerung stumpf, und
 * das wäre schlimmer als das Wackeln.
 *
 * Start: node Entwickler-Tests/test-ruhige-figur.js
 * ========================================================================== */

'use strict';

const { loadGame, check, summary } = require('./dom-stub.js');
const game = loadGame('../app-arena.js');
const { physics, PLAYER } = game;
const Physics = physics.constructor;

game.setVoiceRange(PLAYER.ANDREA, 110, 330);

const HALBTON = Math.pow(2, 1 / 12);

/**
 * Einen Ton über mehrere Frames anlegen und die Figur laufen lassen.
 *
 * `vibratoHalbtoene` ist die Auslenkung um den Grundton — 0.15 entspricht
 * einem ruhigen, gehaltenen Ton, wie ihn auch geübte Sängerinnen liefern.
 *
 * @param   {number} hz      Grundton
 * @param   {number} frames
 * @param   {number} vibratoHalbtoene
 * @returns {{weg:number, ende:number}} zurückgelegte Strecke und Endposition
 */
function halte(hz, frames, vibratoHalbtoene) {
    let weg = 0;
    let vorher = physics.currentX;
    for (let f = 0; f < frames; f++) {
        /* Gleichmässiges Vibrato mit rund 5 Hz — der uebliche Bereich. */
        const schwing = Math.sin((f / 60) * 2 * Math.PI * 5) * vibratoHalbtoene;
        const ton = hz * Math.pow(HALBTON, schwing);
        physics.targetX = Physics.ruhigesZiel(
            physics.freqToQuantizedX(ton, PLAYER.ANDREA),
            physics.targetX, PLAYER.ANDREA);
        physics.glideToTarget();
        weg += Math.abs(physics.currentX - vorher);
        vorher = physics.currentX;
    }
    return { weg, ende: physics.currentX };
}

/* --- 1. Anlaufen und dann stillstehen ------------------------------------ */
physics.currentX = 800;
physics.velocityX = 0;
physics.targetX = 800;

halte(200, 90, 0.15);                       // ankommen lassen
const ruhe = halte(200, 180, 0.15);         // drei Sekunden halten

console.log(`Gehaltener Ton (200 Hz, Vibrato ±0.15 Halbtöne, 3 s):`);
console.log(`  zurückgelegte Strecke: ${ruhe.weg.toFixed(2)} px`);
console.log(`  Totzone bei diesem Umfang: ${Physics.zielTotzone(PLAYER.ANDREA).toFixed(1)} px`);

check('Die Figur kommt bei gehaltenem Ton zur Ruhe',
    ruhe.weg < 2, `${ruhe.weg.toFixed(2)} px in 3 s`);

/* --- 2. Auch bei kräftigerem Vibrato ------------------------------------- */
physics.currentX = 800; physics.velocityX = 0; physics.targetX = 800;
halte(200, 90, 0.3);
const stark = halte(200, 180, 0.3);
console.log(`\nKräftiges Vibrato (±0.3 Halbtöne): ${stark.weg.toFixed(2)} px in 3 s`);
check('Auch kräftiges Vibrato lässt sie stehen', stark.weg < 6,
    `${stark.weg.toFixed(2)} px`);

/* --- 3. Gegenprobe: ein anderer Ton muss weiterhin ziehen ---------------- *
 * Ohne diese Prüfung wäre der Test mit einer beliebig grossen Totzone zu
 * bestehen — und die Steuerung dabei unbrauchbar.
 * ------------------------------------------------------------------------ */
physics.currentX = 800; physics.velocityX = 0; physics.targetX = 800;
halte(200, 60, 0);
const vorSprung = physics.currentX;
halte(260, 90, 0);                          // gut vier Halbtöne höher
const gewandert = physics.currentX - vorSprung;

const erwartet = physics.freqToQuantizedX(260, PLAYER.ANDREA)
    - physics.freqToQuantizedX(200, PLAYER.ANDREA);
console.log(`\nTonwechsel 200 -> 260 Hz: Figur wandert ${gewandert.toFixed(1)} px`
    + ` (erwartet ${erwartet.toFixed(1)} px)`);
check('Ein anderer Ton bewegt die Figur weiterhin',
    Math.abs(gewandert - erwartet) < 4, `${gewandert.toFixed(1)} px`);

/* --- 4. Ein kleiner, aber gewollter Schritt darf nicht verschluckt werden - */
physics.currentX = 800; physics.velocityX = 0; physics.targetX = 800;
halte(200, 60, 0);
const vorHalbton = physics.currentX;
halte(200 * HALBTON, 90, 0);                // exakt ein Halbton hoeher
const halbtonWeg = physics.currentX - vorHalbton;
console.log(`Ein Halbton höher: Figur wandert ${halbtonWeg.toFixed(1)} px`);
check('Ein ganzer Halbton bewegt sie noch', halbtonWeg > 20,
    `${halbtonWeg.toFixed(1)} px`);

summary();
