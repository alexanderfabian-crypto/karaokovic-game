/* =============================================================================
 * Alle Entwickler-Tests nacheinander ausführen.
 *
 *   node Entwickler-Tests/alle-tests.js
 *
 * Jeder Test läuft in einem eigenen Node-Prozess, weil jeder den Spielcode
 * frisch lädt und dabei globale Browser-Attrappen setzt. Welche Fassung das
 * ist, entscheidet der einzelne Test über loadGame() — die Arena-Tests laden
 * app-arena.js, alle übrigen weiterhin app.js.
 * ========================================================================== */

'use strict';

const { spawnSync } = require('child_process');
const path = require('path');

const TESTS = [
    ['test-tonhoehe.js', 'Tonhöhenerkennung'],
    ['test-kalibrierung.js', 'Onboarding / Stimm-Profiler'],
    ['test-regeln.js', 'Tennisregeln'],
    ['test-aufsprung.js', 'Aufsprungpunkte'],
    ['test-gegner.js', 'Verhalten des Gegners'],
    ['test-aufschlag.js', 'Auslösen des Aufschlags'],
    ['test-duell-aufschlag.js', 'Aufschlag im Duell (Arena-Fassung)'],
    ['test-ruhige-figur.js', 'Figur steht still bei gehaltenem Ton (Arena)'],
    ['test-ruhe-im-laerm.js', 'Ruhepruefung im lauten Raum (Arena)'],
    ['test-notausgang.js', 'Notausgang und Haenger-Erkennung (Arena)'],
    ['test-hotkeys.js', 'Operator-Hotkeys, Ctrl und Alt (Arena)'],
    ['test-luecke.js', 'Pause der Bildkette (Arena)'],
    ['test-audio-waechter.js', 'Toter Audioeingang wird erkannt (Arena)'],
    ['test-protokoll.js', 'Protokoll-Kopf und RUHE-Eskalation (Arena)'],
    ['test-kalibrierung-haerte.js', 'Kalibrierung gegen Oktavfehler (Arena)'],
    ['test-einspielen.js', 'Einspielen zaehlt getrennt vom Match (Arena)'],
    ['test-aufschlag-mitte.js', 'Aufschlag nur aus der Stimmmitte (Arena)'],
    ['test-netz-verdeckung.js', 'Netz verdeckt den Ball (Sandplatz)'],
    ['test-trefferzone.js', 'Breite der Trefferzone (Arena)'],
    ['test-blende.js', 'Uebergangsblende zwischen Ballwechseln (Arena)'],
    ['test-ballwechsel.js', 'Ballwechseldauer / Sendeplatz: V41'],
    /* Das Balltempo weicht seit ARENA-3 zwischen den Fassungen ab. Die
       Sendeplatz-Rechnung muss deshalb fuer beide gelten, nicht nur fuer die
       eingefrorene. */
    ['test-ballwechsel.js', 'Ballwechseldauer / Sendeplatz: ARENA', '../app-arena.js'],
    /* Der Browsertest läuft ZWEIMAL — einmal je Fassung. Bis ARENA-1 prüfte er
       nur index.html; die Fassung, an der gebaut wird, hatte damit kein Netz. */
    ['test-browser.js', 'Start im echten Browser: V41 (index.html)', 'index.html'],
    ['test-browser.js', 'Start im echten Browser: ARENA-1 (arena.html)', 'arena.html']
];

let fehlgeschlagen = 0;

for (const [datei, titel, ...argumente] of TESTS) {
    console.log(`\n${'='.repeat(70)}\n  ${titel}  (${datei})\n${'='.repeat(70)}`);
    const res = spawnSync(process.execPath,
        [path.join(__dirname, datei), ...argumente], { stdio: 'inherit' });
    if (res.status !== 0) fehlgeschlagen++;
}

console.log(`\n${'='.repeat(70)}`);
if (fehlgeschlagen === 0) {
    console.log('  ALLE TESTS BESTANDEN');
} else {
    console.log(`  ${fehlgeschlagen} von ${TESTS.length} Testdateien fehlgeschlagen`);
    process.exitCode = 1;
}
console.log('='.repeat(70));
