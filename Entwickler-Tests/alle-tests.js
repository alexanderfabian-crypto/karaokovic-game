/* =============================================================================
 * Alle Entwickler-Tests nacheinander ausführen.
 *
 *   node Entwickler-Tests/alle-tests.js
 *
 * Jeder Test läuft in einem eigenen Node-Prozess, weil jeder app.js frisch
 * lädt und dabei globale Browser-Attrappen setzt.
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
    ['test-ballwechsel.js', 'Ballwechseldauer / Sendeplatz']
];

let fehlgeschlagen = 0;

for (const [datei, titel] of TESTS) {
    console.log(`\n${'='.repeat(70)}\n  ${titel}  (${datei})\n${'='.repeat(70)}`);
    const res = spawnSync(process.execPath, [path.join(__dirname, datei)], { stdio: 'inherit' });
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
