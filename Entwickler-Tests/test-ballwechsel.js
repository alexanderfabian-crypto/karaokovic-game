/* =============================================================================
 * TEST: Dauer der Ballwechsel und Sendeplatz-Rechnung
 *
 * Prüft die beiden Bühnenzusagen:
 *   1. KEIN Ballwechsel läuft endlos (Segment ist auf 7 Minuten begrenzt).
 *   2. In 7 Minuten fallen mindestens 12 Punkte.
 *
 * Start: node Entwickler-Tests/test-ballwechsel.js
 * ========================================================================== */

'use strict';

const { loadGame, check, summary } = require('./dom-stub.js');
const DATEI = process.argv[2] || '../app.js';
const game = loadGame(DATEI);
const { physics, match, ball, audio } = game;

console.log(`Geprüfte Fassung: ${DATEI}   `
    + `(baseSpeed ${game.config.baseSpeed}, maxSpeed ${game.config.maxSpeed})`);

/**
 * Einen kompletten Ballwechsel simulieren.
 * Andrea folgt dem Ball (perfekte Spielerin) — so hängt das Ergebnis nur am
 * Verhalten des Gegners und nicht an einer erfundenen Stimme.
 * @param   {number} [maxF]
 * @returns {{frames:number, shots:number, apex:number, ended:boolean}}
 */
function rally(maxF = 5400) {
    match.state = 'SERVE_WAIT';
    match.lastWinner = '';
    audio.currentVolume = 0.06;
    audio.smoothedPitch = 200;
    physics.prepareServe();
    physics.currentX = 800;
    ball.x = 800;
    physics.triggerServe();

    let shots = 0, last = ball.lastHitter, apex = 0;
    for (let f = 0; f < maxF; f++) {
        physics.targetX = ball.x;
        physics.currentX += (physics.targetX - physics.currentX) * 0.15;
        physics.update();
        if (ball.z > apex) apex = ball.z;
        if (ball.lastHitter !== last) { shots++; last = ball.lastHitter; }
        if (match.state !== 'PLAYING') return { frames: f, shots, apex, ended: true };
    }
    return { frames: maxF, shots, apex, ended: false };
}

const runs = [];
for (let i = 0; i < 400; i++) { match.state = 'PLAYING'; runs.push(rally()); }

const ended = runs.filter(r => r.ended);
const secs = ended.map(r => r.frames / 60).sort((a, b) => a - b);
const avg = a => a.reduce((x, y) => x + y, 0) / a.length;
const pct = (a, p) => a[Math.min(a.length - 1, Math.floor(a.length * p))];
const apexMax = Math.max(...runs.map(r => r.apex));

console.log(`Stichprobe:            ${runs.length} Ballwechsel`);
console.log(`beendet:               ${ended.length} / ${runs.length}`);
console.log(`Scheitelhoehe max:     ${apexMax.toFixed(0)} px`);
console.log(`Dauer  Median:         ${pct(secs, 0.5).toFixed(1)} s`);
console.log(`Dauer  90. Perzentil:  ${pct(secs, 0.9).toFixed(1)} s`);
console.log(`Dauer  laengster:      ${secs[secs.length - 1].toFixed(1)} s`);
console.log(`Schlaege im Schnitt:   ${avg(ended.map(r => r.shots)).toFixed(1)}`);

/* Pause zwischen zwei Ballwechseln: Punktanzeige + Bumper + Ruhe vor dem
   Aufschlag. NICHT fest 9 s hinschreiben — die Ruhe wurde in der Arena-Fassung
   von 3 s auf 2 s verkuerzt, und mit einer geratenen Konstante haette diese
   Rechnung ab da still danebengelegen. Wo TIMING nicht auslesbar ist (V41
   exportiert es nicht), bleibt es beim bisherigen Wert. */
const T = game.TIMING;
const pauseS = T ? (T.POINT_MS + T.TRANSITION_MS + T.SILENCE_MS) / 1000 : 9;
const perPoint = avg(secs) + pauseS;
const punkte = Math.floor(420 / perPoint);
console.log(`\nZeit pro Punkt inkl. ${pauseS.toFixed(0)} s Pausen: ${perPoint.toFixed(1)} s`);
console.log(`Punkte in 7 Minuten:             ${punkte}   (Bedarf: >=12)\n`);

check('Kein endloser Ballwechsel', ended.length === runs.length,
    `${ended.length}/${runs.length} beendet`);
check('Ball bleibt im Bild (Scheitelhöhe < 300 px)', apexMax < 300, `${apexMax.toFixed(0)} px`);
check('Mindestens 12 Punkte in 7 Minuten', punkte >= 12, `${punkte} Punkte`);
summary();
