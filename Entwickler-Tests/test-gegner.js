/* =============================================================================
 * TEST: Verhalten des Gegners (Alex)
 *
 * REGRESSIONSSCHUTZ. Der absichtliche Fehler wurde früher in JEDEM Frame neu
 * aus der Ballposition abgeleitet (`ball.x ± 210`). Alex lief dadurch die
 * gesamte Flugbahn im exakt gleichen Abstand neben dem Ball her und ließ ihn
 * am Ende in immer demselben Abstand passieren. Auf der Bühne sah das nicht
 * nach einem verpassten Ball aus, sondern nach einem Spieler, der den Ball
 * absichtlich durchwinkt.
 *
 * Geprüft wird deshalb dreierlei:
 *   1. Wenn Alex treffen WILL, trifft er auch (sonst wirkt das Spiel kaputt).
 *   2. Wenn er verfehlt, ist der Abstand jedes Mal ein anderer.
 *   3. Der Fehler bleibt garantiert — sonst laufen Ballwechsel endlos.
 *
 * Start: node Entwickler-Tests/test-gegner.js
 * ========================================================================== */

'use strict';

const { loadGame, check, summary } = require('./dom-stub.js');
const game = loadGame();
const { physics, match, ball, paddleAlex, audio } = game;

/* Wert der EINGEFRORENEN Fassung V41 (PADDLE.width / 2 + hitPadding), die
   dieser Test prueft — loadGame() ohne Argument laedt app.js. Die
   Arena-Fassung hat die Zone mit ARENA-16 auf 71 verkleinert und die beiden
   Bedeutungen getrennt; dort deckt test-ballwechsel.js den Ballwechsel ab. */
const HIT_ZONE = 100;
const ALEX_FENSTER_Y = 182;    // Grundlinie 170 + Ballradius 12

let absichtlich = 0, unabsichtlich = 0;
const abstaende = [];
const punkte = { andrea: 0, alex: 0 };

for (let r = 0; r < 300; r++) {
    match.state = 'SERVE_WAIT';
    let pitch = 100 + Math.random() * 200;
    audio.currentVolume = 0.05;
    audio.smoothedPitch = pitch;
    physics.prepareServe();
    physics.triggerServe();

    let prevY = ball.y;
    for (let f = 0; f < 3000 && match.state === 'PLAYING'; f++) {
        /* Stimme wandert langsam — so entstehen echte Winkel statt lauter
           Bälle in die Feldmitte. */
        pitch = Math.max(90, Math.min(330, pitch + (Math.random() - 0.5) * 6));
        audio.smoothedPitch = pitch;
        audio.currentVolume = 0.04 + Math.random() * 0.05;
        physics.targetX = physics.freqToQuantizedX(pitch);
        physics.currentX += (physics.targetX - physics.currentX) * 0.15;

        const wollteTreffen = !physics.pcWillMiss;
        physics.update();

        /* Der Ball erreicht Alex' Trefferfenster — hat er ihn erwischt? */
        if (prevY > ALEX_FENSTER_Y && ball.y <= ALEX_FENSTER_Y && ball.vy < 0) {
            const dx = Math.abs(ball.x - paddleAlex.x);
            abstaende.push(dx);
            if (dx > HIT_ZONE) { wollteTreffen ? unabsichtlich++ : absichtlich++; }
        }
        prevY = ball.y;
    }
    if (match.lastWinner) punkte[match.lastWinner]++;
}

const sortiert = abstaende.slice().sort((a, b) => a - b);
const q = p => sortiert[Math.floor(sortiert.length * p)];
const einzigartig = new Set(abstaende.map(d => Math.round(d))).size;

console.log(`Punkte: Andrea ${punkte.andrea}, Alex ${punkte.alex}`);
console.log(`Alex verfehlt absichtlich:   ${absichtlich}`);
console.log(`Alex verfehlt UNabsichtlich: ${unabsichtlich}`);
console.log(`Abstand beim Fehlgriff: Median ${q(0.5)?.toFixed(0)} px, `
    + `p90 ${q(0.9)?.toFixed(0)} px, max ${Math.max(...abstaende).toFixed(0)} px`);
console.log(`verschiedene Abstände:  ${einzigartig} von ${abstaende.length}\n`);

check('Alex trifft jeden Ball, den er treffen will', unabsichtlich === 0,
    `${unabsichtlich} ungewollte Fehlschläge`);
check('Fehlgriffe sehen nicht jedes Mal gleich aus', einzigartig > abstaende.length * 0.5,
    `${einzigartig} verschiedene Abstände bei ${abstaende.length} Fehlgriffen`);
check('Fehlgriff liegt immer sicher außerhalb der Trefferzone',
    Math.min(...abstaende) > HIT_ZONE, `kleinster Abstand ${Math.min(...abstaende).toFixed(0)} px`);
check('Beide Seiten gewinnen Punkte', punkte.andrea > 0 && punkte.alex > 0);

summary();
