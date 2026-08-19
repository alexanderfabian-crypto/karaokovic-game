/* =============================================================================
 * TEST: Kommt die Ruhepruefung in einem lauten Raum jemals zum Ende?
 *
 * Aus einem echten Buehnenprotokoll gerechnet. Die Session hing 42 Sekunden
 * fest, ohne dass ein Aufschlag zustande kam. Die Zahlen daraus:
 *
 *   Aufschlaege (gelungen):  0.023 / 0.027 / 0.027
 *   Raumgeraeusch danach:    Median 0.025, Mittel 0.029, Spitzen bis 0.070
 *   laengste ruhige Strecke: 1.6 s   (gebraucht werden 2.0 s)
 *
 * Rauschen und Gesang lagen also auf DERSELBEN Hoehe. Gegen die feste Grenze
 * von 0.020 konnte die Ruhepruefung nicht fertig werden — das Spiel stand.
 *
 * Geprueft wird beides:
 *   1. In diesem Laerm kommt die Ruhe jetzt zustande.
 *   2. In einem ruhigen Studio aendert sich NICHTS. Eine Grenze, die
 *      mitwaechst, darf keine Hintertuer zu einer lascheren Pruefung sein.
 *
 * Start: node Entwickler-Tests/test-ruhe-im-laerm.js
 * ========================================================================== */

'use strict';

const { loadGame, check, summary } = require('./dom-stub.js');
const game = loadGame('../app-arena.js');

/* Gemessene Verteilung aus dem Protokoll, in der beobachteten Reihenfolge. */
const LAERM = [
    0.029, 0.035, 0.021, 0.032, 0.048, 0.029, 0.021, 0.020, 0.021, 0.020,
    0.024, 0.020, 0.021, 0.024, 0.030, 0.021, 0.021, 0.024, 0.031, 0.023,
    0.039, 0.056, 0.032, 0.043, 0.032, 0.039, 0.037, 0.039, 0.023, 0.027,
    0.023, 0.022, 0.031, 0.020, 0.031, 0.025, 0.020, 0.022, 0.021, 0.022,
];
const STUDIO = [0.004, 0.006, 0.005, 0.007, 0.004, 0.005, 0.006, 0.004];

/**
 * Den Pegelspeicher des Spiels mit einer Verteilung fuellen.
 * @param {number[]} werte
 */
function fuelle(werte) {
    game._pegelRing = [];
    for (let i = 0; i < 180; i++) game._pegelRing.push(werte[i % werte.length]);
}

/* --- 1. Lauter Raum ------------------------------------------------------ */
fuelle(LAERM);
const raumLaut = game.raumpegel();
const grenzeLaut = game.stilleGrenze();
const ruhigeAnteil = LAERM.filter(v => v < grenzeLaut).length / LAERM.length;

console.log('Lauter Raum (Messwerte aus dem Buehnenprotokoll):');
console.log(`  gemessener Raumpegel: ${raumLaut.toFixed(3)}`);
console.log(`  Ruhegrenze:           ${grenzeLaut.toFixed(3)}  (fest waeren ${game.config.volumeGate})`);
console.log(`  Anteil Frames unter der Grenze: ${(ruhigeAnteil * 100).toFixed(0)} %`);

check('Die Grenze waechst mit dem Raum mit',
    grenzeLaut > game.config.volumeGate,
    `${grenzeLaut.toFixed(3)} statt ${game.config.volumeGate}`);
check('Und liegt ueber dem Raumgeraeusch, nicht darin',
    grenzeLaut > raumLaut, `${grenzeLaut.toFixed(3)} vs. ${raumLaut.toFixed(3)}`);
check('Damit gilt die Mehrheit der Frames als ruhig — die Ruhe kann enden',
    ruhigeAnteil > 0.5, `${(ruhigeAnteil * 100).toFixed(0)} %`);

/* Gegenprobe gegen den ALTEN Stand: mit fester Grenze war fast nichts ruhig. */
const altAnteil = LAERM.filter(v => v < game.config.volumeGate).length / LAERM.length;
console.log(`  zum Vergleich mit fester Grenze: ${(altAnteil * 100).toFixed(0)} % ruhig`);
check('Mit fester Grenze waere praktisch kein Frame ruhig gewesen',
    altAnteil < 0.05, `${(altAnteil * 100).toFixed(0)} %`);

/* --- 2. Ruhiges Studio: nichts darf sich aendern ------------------------- */
fuelle(STUDIO);
const grenzeStudio = game.stilleGrenze();
console.log(`\nRuhiges Studio: Raumpegel ${game.raumpegel().toFixed(3)},`
    + ` Grenze ${grenzeStudio.toFixed(3)}`);
check('Im ruhigen Raum bleibt die Grenze exakt die eingestellte',
    grenzeStudio === game.config.volumeGate,
    `${grenzeStudio} vs. ${game.config.volumeGate}`);

/* --- 3. Ohne Messwerte darf nichts passieren ----------------------------- */
game._pegelRing = [];
check('Ohne genug Messwerte bleibt es bei der festen Grenze',
    game.stilleGrenze() === game.config.volumeGate);

summary();
