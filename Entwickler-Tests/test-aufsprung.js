/* =============================================================================
 * TEST: Landet der Ball bei jedem Treffpunkt im Feld?
 *
 * Hintergrund: Steht Andrea im Overdrive am Bildrand und trifft den Ball außen
 * am Schläger, sprang der Ball früher außerhalb der Einzelfeldlinie auf — ein
 * automatischer Fehler, ohne dass der Gegner eine Chance hatte. Seit der Schlag
 * auf den AUFSPRUNGPUNKT zielt, muss jede Kombination im Feld landen.
 *
 * Start: node Entwickler-Tests/test-aufsprung.js
 * ========================================================================== */

'use strict';

const { loadGame, check, summary } = require('./dom-stub.js');
const game = loadGame();
const { physics, match, ball, paddleAlex } = game;

const COURT_LEFT = 450, COURT_RIGHT = 1150, ALLEY = 75;
const IN_L = COURT_LEFT + ALLEY, IN_R = COURT_RIGHT - ALLEY;

console.log(`Einzelfeld reicht von x=${IN_L} bis x=${IN_R}\n`);
console.log('Andrea  Treffpunkt   1. Aufsprung bei      Urteil');

let alleImFeld = true;

for (const ax of [800, 600, 400, 200, 95]) {
    for (const off of [0, -1, 1]) {
        match.state = 'PLAYING';
        physics.currentX = ax;
        ball.x = ax + off * 75; ball.y = 830; ball.z = 15; ball.bounces = 0;
        paddleAlex.x = 800; physics.pcWillMiss = false;
        physics.calculateHit(ax, true, 0.08);

        let bx = null, by = null;
        for (let f = 0; f < 600 && bx === null; f++) {
            const vorher = ball.bounces;
            physics.update();
            if (ball.bounces > vorher) { bx = Math.round(ball.x); by = Math.round(ball.y); }
        }
        const inside = bx >= IN_L && bx <= IN_R;
        if (!inside) alleImFeld = false;
        console.log(`x=${String(ax).padStart(4)}  off=${String(off).padStart(2)}      `
            + `x=${String(bx).padStart(5)} y=${String(by).padStart(4)}   `
            + `${inside ? 'im Feld' : '>>> AUS <<<'}`);
    }
}

console.log('');
check('Jeder Treffpunkt springt im Einzelfeld auf', alleImFeld);
summary();
