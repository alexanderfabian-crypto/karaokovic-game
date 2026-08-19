/* =============================================================================
 * TEST: Verdeckt das gemalte Netz den Ball? (Sandplatz)
 *
 * Buehnenbefund: "Beim Sandplatz stimmt die Optik nicht, wenn der Ball zu Alex
 * fliegt — der Ball ist zu sehen, obwohl ihn das Netz ein Stueckweit verdecken
 * muesste."
 *
 * Der Grund liegt im Aufbau: seit der Platz aus einem Bild kommt, zeichnet
 * drawNet() gar nichts mehr. Das Netz steckt im Hintergrund, der Ball wird
 * IMMER darueber gemalt — zwischen beiden laesst sich nichts einschieben.
 * Also muss der Ball an dieser Stelle weggelassen werden.
 *
 * Das Netzband ist im gerenderten Bild eingemessen (siehe PLAETZE.SAND.netz).
 *
 * WICHTIG und beim ersten Anlauf falsch erwartet: am BODEN verdeckt das Netz
 * nur den Streifen direkt dahinter. Weiter hinten liegt der Boden im Bild
 * ueber der Netzkante — dort sieht man den Ball uebers Netz hinweg, und genau
 * so gehoert es.
 *
 * Start: node Entwickler-Tests/test-netz-verdeckung.js
 * ========================================================================== */

'use strict';
const { loadGame, check, summary } = require('./dom-stub.js');
const game = loadGame('../app-arena.js');
game.setzePlatz('SAND'); game.handleResize();
const R = game.renderer, G = game.grenzen;
const proj = R.proj;

/** Hilfsfunktion: ist der Ball an (x,y,z) verdeckt? */
function verdeckt(x, y, z) {
    const p = proj.project(x, y, z, {});
    return R.netzVerdeckt(y, p);
}
const mitte = (G.top + G.bottom) / 2;

console.log('Sandplatz, Netzlinie bei Welt-y =', mitte);
const faelle = [
    ['knapp hinter dem Netz, flach (z=20)',  800, mitte - 40, 20,  true],
    ['knapp hinter dem Netz, hoch (z=140)',  800, mitte - 40, 140, false],
    /* Am Boden verdeckt das Netz nur den Streifen DIREKT dahinter. Weiter
       hinten liegt der Boden im Bild ueber der Netzkante — dort sieht man den
       Ball uebers Netz hinweg, und genau so gehoert es. */
    ['am Boden direkt hinter dem Netz',      800, mitte - 100, 0,  true],
    ['am Boden weit hinten (ueber dem Netz)', 800, mitte - 250, 0, false],
    ['weit hinten, hoch',                    800, mitte - 250, 200, false],
    ['DIESSEITS des Netzes, flach',          800, mitte + 40, 20,  false],
    ['diesseits, am Boden',                  800, mitte + 200, 0,  false],
];
for (const [name, x, y, z, erwartet] of faelle) {
    const ist = verdeckt(x, y, z);
    check(`${name}: ${erwartet ? 'verdeckt' : 'sichtbar'}`, ist === erwartet,
        ist ? 'verdeckt' : 'sichtbar');
}

/* Gegenprobe: auf dem Hartplatz ist kein Band eingemessen -> nie verdeckt. */
game.setzePlatz('HART'); game.handleResize();
check('Hartplatz: ohne eingemessenes Band wird nichts verdeckt',
    verdeckt(800, mitte - 40, 20) === false);
summary();
