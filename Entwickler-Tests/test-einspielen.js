/* =============================================================================
 * TEST: Zaehlt das Einspielen — und bleibt der Matchstand unberuehrt?
 *
 * Im Einspielen steht in der Bauchbinde jetzt ein Zaehler. Ohne ihn sah man
 * dort dauerhaft 0:0, weil das Einspielen den Matchstand bewusst nicht
 * anfasst — es war also nicht zu erkennen, ob ein Ballwechsel gewonnen wurde.
 *
 * Die eigentliche Zusage ist die TRENNUNG. Das Einspielen darf unter keinen
 * Umstaenden in den Matchstand durchschlagen:
 *   - keine Punkte, keine Saetze
 *   - kein Aufschlagwechsel
 *   - kein Eintrag in der Undo-Historie
 *
 * Sonst stuende beim Anpfiff ein Stand da, den es nie gab, und ein Undo
 * koennte in die Probe zurueckspringen.
 *
 * Start: node Entwickler-Tests/test-einspielen.js
 * ========================================================================== */

'use strict';

const { loadGame, check, summary } = require('./dom-stub.js');
const game = loadGame('../app-arena.js');
const { match, PLAYER } = game;

/* --- 1. Im Einspielen zaehlt der eigene Zaehler -------------------------- */
check('Das Spiel startet im Einspielen', match.isWarmup === true, String(match.phase));

match.awardPoint(PLAYER.ANDREA);
match.awardPoint(PLAYER.ANDREA);
match.awardPoint(PLAYER.ALEX);

console.log(`Nach 3 Ballwechseln im Einspielen:`);
console.log(`  Einspiel-Zaehler: Andrea ${match.warmupScore.andrea},`
    + ` Alex ${match.warmupScore.alex}`);
console.log(`  Matchstand:       Andrea ${match.score.andrea},`
    + ` Alex ${match.score.alex}`);
console.log(`  Saetze:           Andrea ${match.sets.andrea},`
    + ` Alex ${match.sets.alex}`);
console.log(`  Historie:         ${match.history.length} Eintraege`);
console.log(`  Aufschlag:        ${match.server}`);

check('Der Einspiel-Zaehler zaehlt mit',
    match.warmupScore.andrea === 2 && match.warmupScore.alex === 1,
    `${match.warmupScore.andrea}:${match.warmupScore.alex}`);

/* --- 2. Und der Matchstand bleibt unberuehrt ----------------------------- */
check('Der Matchstand bleibt bei 0:0',
    match.score.andrea === 0 && match.score.alex === 0,
    `${match.score.andrea}:${match.score.alex}`);
check('Keine Saetze',
    match.sets.andrea === 0 && match.sets.alex === 0);
check('Kein Eintrag in der Undo-Historie',
    match.history.length === 0, `${match.history.length}`);
check('Kein Aufschlagwechsel', match.server === PLAYER.ANDREA, match.server);
check('Undo findet nichts zum Zuruecknehmen', match.undo() === false);

/* --- 3. Der Anpfiff raeumt den Zaehler weg ------------------------------- */
match.startMatch();
console.log(`\nNach dem Anpfiff: Einspiel-Zaehler`
    + ` ${match.warmupScore.andrea}:${match.warmupScore.alex},`
    + ` Matchstand ${match.score.andrea}:${match.score.alex}`);
check('Der Anpfiff setzt den Einspiel-Zaehler zurueck',
    match.warmupScore.andrea === 0 && match.warmupScore.alex === 0);
check('Und es laeuft ab jetzt das Match', match.isWarmup === false);

/* --- 4. Im Match zaehlt wieder der Matchstand ---------------------------- */
match.awardPoint(PLAYER.ANDREA);
check('Im Match zaehlt der Matchstand',
    match.score.andrea === 1, `${match.score.andrea}`);
check('Und der Einspiel-Zaehler bleibt stehen',
    match.warmupScore.andrea === 0, `${match.warmupScore.andrea}`);

/* --- 5. Hard Reset raeumt beides ----------------------------------------- */
match.hardReset();
check('Hard Reset raeumt Matchstand UND Einspiel-Zaehler',
    match.score.andrea === 0 && match.warmupScore.andrea === 0);

summary();
