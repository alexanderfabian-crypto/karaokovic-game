/* =============================================================================
 * TEST: Tennisregeln (Aus, Doppelaufsprung, wer bekommt den Punkt)
 * Start: node Entwickler-Tests/test-regeln.js
 * ========================================================================== */

'use strict';

const { loadGame, check, summary } = require('./dom-stub.js');
const game = loadGame();
const { physics, match, ball, paddleAlex } = game;

const COURT_LEFT = 450, COURT_TOP = 170, ALLEY = 75;

/**
 * Lässt einen Ballwechsel laufen, bis ein Punkt fällt.
 * @param   {Function} setup      Ausgangslage herstellen
 * @param   {number}   [maxFrames]
 * @returns {{winner:string, frames:number, firstBounceInside:boolean}}
 */
function runUntilPoint(setup, maxFrames = 2000) {
    match.state = 'PLAYING';
    match.lastWinner = '';
    game.audio.currentVolume = 0;
    setup();
    for (let f = 0; f < maxFrames; f++) {
        physics.update();
        if (match.state !== 'PLAYING') {
            return { winner: match.lastWinner, frames: f, firstBounceInside: ball.firstBounceInside };
        }
    }
    return { winner: '(kein Punkt)', frames: maxFrames, firstBounceInside: ball.firstBounceInside };
}

let r;

/* --- Fall 1: Andrea schlägt gültig, Alex verfehlt, Ball fliegt hinter die
       Grundlinie (das ist der Fall, der in V36 falsch gewertet wurde) ------- */
r = runUntilPoint(() => {
    ball.x = 800; ball.y = 400; ball.z = 5;
    ball.vx = 0; ball.vy = -9; ball.vz = 0; ball.gravity = 0.042;
    ball.bounces = 0; ball.lastHitter = 'andrea';
    paddleAlex.x = 200;              // Alex steht weit weg
    physics.pcWillMiss = true;       // und bewegt sich nicht zum Ball
    physics.missTargetX = 200;       // fester Fehlgriff-Zielpunkt
    physics.missDelay = 0;
});
check('Aufsprung im Feld, Alex verfehlt -> Punkt Andrea', r.winner === 'andrea', r.winner);
console.log(`      (Aufsprünge: ${ball.bounces}, erster Aufsprung im Feld: ${r.firstBounceInside})`);

/* --- Fall 2: Andrea schlägt ins Seiten-Aus -------------------------------- */
r = runUntilPoint(() => {
    ball.x = COURT_LEFT + ALLEY + 5; ball.y = 600; ball.z = 10;
    ball.vx = -9; ball.vy = -4; ball.vz = 1; ball.gravity = 0.042;
    ball.bounces = 0; ball.lastHitter = 'andrea';
    paddleAlex.x = 800;
    physics.pcWillMiss = true;
    physics.missTargetX = 800;
    physics.missDelay = 0;
});
check('Erster Aufsprung im Aus -> Punkt Alex', r.winner === 'alex', r.winner);
console.log(`      (erster Aufsprung im Feld: ${r.firstBounceInside})`);

/* --- Fall 3: Alex schlägt gültig, Andrea verfehlt -------------------------- */
r = runUntilPoint(() => {
    ball.x = 800; ball.y = 600; ball.z = 5;
    ball.vx = 0; ball.vy = 9; ball.vz = 0; ball.gravity = 0.042;
    ball.bounces = 0; ball.lastHitter = 'alex';
    physics.currentX = 200;          // Andrea steht weit weg
    physics.pcWillMiss = true;
});
check('Aufsprung im Feld, Andrea verfehlt -> Punkt Alex', r.winner === 'alex', r.winner);

/* --- Fall 4: Doppelaufsprung im Feld -------------------------------------- */
r = runUntilPoint(() => {
    ball.x = 800; ball.y = COURT_TOP + 300; ball.z = 20;
    ball.vx = 0; ball.vy = -0.2; ball.vz = 0; ball.gravity = 0.042;   // fällt praktisch senkrecht
    ball.bounces = 0; ball.lastHitter = 'andrea';
    paddleAlex.x = 200;
    physics.pcWillMiss = true;
    physics.missTargetX = 200;
    physics.missDelay = 0;
});
check('Zweimal aufgesprungen -> Punkt letzte Schlägerin', r.winner === 'andrea', r.winner);

/* --- Fall 5: Ball in der Luft über der Seitenlinie ------------------------
   REGRESSIONSSCHUTZ. Ein scharf cross geschlagener Ball springt gültig auf
   und überfliegt danach die Seitenlinie, während er weiter zur Grundlinie
   zieht. Früher fiel der Punkt in diesem Moment — mitten im Feld, obwohl der
   Ball noch in der Luft war und der Gegner ihn hätte erreichen können.
   Ein Ball in der Luft ist niemals aus. ------------------------------------ */
const SEITENLINIE_R = 1075;
let seitenlinieBeiFrame = -1;
let aufsprungBeiFrame = -1;

r = (() => {
    match.state = 'PLAYING';
    match.lastWinner = '';
    game.audio.currentVolume = 0;
    /* Knapp über dem Boden und fallend: springt sofort bei (1000, 400) auf —
       klar im Einzelfeld. Danach zieht er quer über die Seitenlinie. */
    ball.x = 1000; ball.y = 400; ball.z = 0.5;
    ball.vx = 4; ball.vy = -2.5; ball.vz = -0.5; ball.gravity = 0.03;
    ball.bounces = 0; ball.lastHitter = 'andrea';
    paddleAlex.x = 1050;
    physics.pcWillMiss = true;
    physics.missTargetX = 1050;
    physics.missDelay = 0;

    for (let f = 0; f < 2000; f++) {
        const vorher = ball.bounces;
        physics.update();
        if (ball.bounces > vorher && aufsprungBeiFrame < 0) aufsprungBeiFrame = f;
        if (ball.x > SEITENLINIE_R && seitenlinieBeiFrame < 0) seitenlinieBeiFrame = f;
        if (match.state !== 'PLAYING') {
            return { winner: match.lastWinner, frames: f, firstBounceInside: ball.firstBounceInside };
        }
    }
    return { winner: '(kein Punkt)', frames: 2000, firstBounceInside: ball.firstBounceInside };
})();

console.log(`      (Aufsprung im Feld bei Frame ${aufsprungBeiFrame}, `
    + `Seitenlinie überflogen bei Frame ${seitenlinieBeiFrame}, `
    + `Punkt bei Frame ${r.frames})`);
check('Erster Aufsprung wurde als gültig erkannt', r.firstBounceInside === true);
check('Flug über die Seitenlinie beendet den Ballwechsel NICHT',
    r.frames > seitenlinieBeiFrame + 5,
    `Punkt fiel ${r.frames - seitenlinieBeiFrame} Frames nach dem Überflug`);
check('Nach gültigem Aufsprung gewinnt die Schlägerin', r.winner === 'andrea', r.winner);

/* --- Fall 6: erster Aufsprung im Seiten-Aus wird SOFORT gewertet ---------- */
r = runUntilPoint(() => {
    ball.x = 1200; ball.y = 400; ball.z = 3;       // weit außerhalb, kurz vor Boden
    ball.vx = 1; ball.vy = -1; ball.vz = -0.5; ball.gravity = 0.042;
    ball.bounces = 0; ball.lastHitter = 'andrea';
    paddleAlex.x = 800;
    physics.pcWillMiss = true;
    physics.missTargetX = 800;
    physics.missDelay = 0;
});
check('Aufsprung im Seiten-Aus -> sofort Punkt für die Gegnerin',
    r.winner === 'alex' && r.frames < 20, `${r.winner} nach ${r.frames} Frames`);

summary();
