/* =============================================================================
 * TEST: Der Ball prallt an der Kulisse ab — und sonst passiert nichts
 *
 * ARENA-17 gibt der Arena Tiefe: ein weit geschlagener Ball verschwindet
 * nicht mehr aus dem Bild, sondern trifft die Tribuene hinter Alex oder eine
 * der Seiten, kommt gedaempft zurueck und rollt aus.
 *
 * Der Effekt ist Deko, und genau das ist das Risiko: er sitzt mitten in der
 * geschuetzten Physik. Geprueft wird deshalb vor allem, was er NICHT tut —
 * die Leitplanken des Briefings, eine je Abschnitt:
 *
 *   1. Er prallt ueberhaupt ab, auf allen drei Plaetzen, an allen Waenden.
 *   2. Er kommt zur Ruhe, statt zwischen den Waenden zu pendeln.
 *   3. GEISTERBALL: waehrend er abprallt, kann ihn keine Figur mehr treffen.
 *   4. Keine Aufsprungmarken ausserhalb der Platzflaeche.
 *   5. Keine Protokollzeile.
 *   6. Im Ballwechsel ist die Physik unveraendert — der Punkt faellt in
 *      demselben Frame wie vorher.
 *   7. Die Grenzen sind je Platz eingemessen und nicht geraten.
 *
 * Start: node Entwickler-Tests/test-kulisse.js
 * ========================================================================== */

'use strict';

const { loadGame, check, summary } = require('./dom-stub.js');
const game = loadGame('../app-arena.js');
const { physics, ball, match, bounceMarks, PLAYER } = game;
const Ph = physics.constructor;
const P = game.Protokoll;

/**
 * Einen Ball nach dem Punkt losschicken und Frames fahren.
 * @param   {Object} start  {x, y, vx, vy}
 * @param   {number} frames
 * @returns {{minY:number, minX:number, maxX:number}} erreichte Extremwerte
 */
function fliegt(start, frames) {
    match.state = 'POINT_SCORED';
    match.lastWinner = PLAYER.ANDREA;
    bounceMarks.clear();
    ball.x = start.x; ball.y = start.y; ball.z = 40;
    ball.vx = start.vx; ball.vy = start.vy; ball.vz = 0;
    ball.gravity = 0.05; ball.bounces = 1; ball.firstBounceInside = true;

    let minY = Infinity, minX = Infinity, maxX = -Infinity;
    for (let f = 0; f < frames; f++) {
        physics.update();
        minY = Math.min(minY, ball.y);
        minX = Math.min(minX, ball.x);
        maxX = Math.max(maxX, ball.x);
    }
    return { minY, minX, maxX };
}

/* --- 1. Er prallt ab, auf jedem Platz ------------------------------------ */
console.log('Rueckwand (Welt-y) und wie weit der Ball tatsaechlich kommt:');
const jePlatz = [];
for (const name of Object.keys(game.PLAETZE)) {
    game.setzePlatz(name);
    const raum = game.PLAETZE[name].raum;
    const hinten = fliegt({ x: 800, y: 300, vx: 0, vy: -16 }, 400);
    const links = fliegt({ x: 800, y: 400, vx: -16, vy: 0 }, 400);
    const rechts = fliegt({ x: 800, y: 400, vx: 16, vy: 0 }, 400);
    jePlatz.push({ name, raum, hinten: hinten.minY, links: links.minX,
        rechts: rechts.maxX });
    console.log(`  ${name.padEnd(6)} hinten ${String(raum.hinten).padStart(4)}`
        + ` -> ${hinten.minY.toFixed(0).padStart(5)}`
        + ` | links ${String(raum.links).padStart(4)} -> ${links.minX.toFixed(0).padStart(5)}`
        + ` | rechts ${String(raum.rechts).padStart(4)} -> ${rechts.maxX.toFixed(0).padStart(5)}`);
}
game.setzePlatz('HART');

check('Jeder Platz hat eingemessene Raumgrenzen',
    jePlatz.every(x => x.raum && Number.isFinite(x.raum.hinten)
        && Number.isFinite(x.raum.links) && Number.isFinite(x.raum.rechts)));
check('Der Ball kommt nirgends hinter die Rueckwand',
    jePlatz.every(x => x.hinten >= x.raum.hinten - 1),
    jePlatz.map(x => `${x.name} ${x.hinten.toFixed(0)}/${x.raum.hinten}`).join(', '));
check('Und nirgends durch eine Seitenwand',
    jePlatz.every(x => x.links >= x.raum.links - 1 && x.rechts <= x.raum.rechts + 1));
check('Er erreicht die Waende auch wirklich, statt vorher liegenzubleiben',
    jePlatz.every(x => x.hinten < x.raum.hinten + 40),
    'sonst pruefte der Test nur, dass ein Ball irgendwo stehenbleibt');
check('Die drei Raeume sind VERSCHIEDEN — je Platz eingemessen',
    new Set(jePlatz.map(x => x.raum.hinten)).size === 3,
    jePlatz.map(x => `${x.name} ${x.raum.hinten}`).join(', '));

/* --- 2. Er kommt zur Ruhe ------------------------------------------------ */
fliegt({ x: 800, y: 300, vx: 9, vy: -14 }, 900);
const tempo = Math.hypot(ball.vx, ball.vy, ball.vz);
console.log(`\nNach 15 s: Tempo ${tempo.toFixed(3)} px/Frame, Hoehe `
    + `${ball.z.toFixed(2)} px`);
check('Der Ball kommt im Raum zur Ruhe', tempo < 0.5,
    `${tempo.toFixed(3)} px/Frame`);
check('Und huepft nicht ewig auf der Stelle', ball.z < 1,
    `${ball.z.toFixed(2)} px hoch`);

/* GEGENPROBE: im Ballwechsel gilt die Untergrenze der Absprunghoehe weiter —
   ein muede gewordener Ball muss dort spielbar in der Luft bleiben. */
match.state = 'PLAYING';
/* z so knapp ueber dem Boden, dass der Aufsprungblock in DIESEM Frame
   laeuft — sonst prueft die Gegenprobe einen Frame ohne Bodenkontakt. */
ball.x = 800; ball.y = 400; ball.z = 0.05; ball.vx = 0; ball.vy = 3;
ball.vz = -0.1; ball.gravity = 0.05; ball.bounces = 0;
physics.update();
check('GEGENPROBE: im Ballwechsel springt der Ball weiter ab',
    ball.vz >= Ph.BOUNCE_MIN_APEX_VZ * ball.gravity - 1e-9,
    `vz ${ball.vz.toFixed(3)} statt 0`);

/* --- 3. Geisterball: kein Treffer mehr ----------------------------------- */
let getroffen = 0;
const echterSchlag = physics.calculateHit.bind(physics);
physics.calculateHit = (...a) => { getroffen++; echterSchlag(...a); };

/* Genau durch Andreas Trefferzone, aber nach dem Punkt. */
match.state = 'POINT_SCORED';
physics.currentX = 800; physics.prevCurrentX = 800;
ball.x = 800; ball.y = game.paddleAndrea.y - 1; ball.z = 20;
ball.vx = 0; ball.vy = 6; ball.vz = 0; ball.gravity = 0;
ball.bounces = 1; ball.firstBounceInside = true;
for (let f = 0; f < 20; f++) physics.update();
const nachPunkt = getroffen;

/* Dieselbe Lage IM Ballwechsel — dort MUSS sie treffen, sonst prueft der
   Abschnitt nur, dass irgendetwas nicht passiert. */
match.state = 'PLAYING';
ball.x = 800; ball.y = game.paddleAndrea.y - 1; ball.z = 20;
ball.vx = 0; ball.vy = 6; ball.vz = 0; ball.gravity = 0;
ball.bounces = 1; ball.firstBounceInside = true;
physics.update();
const imBallwechsel = getroffen - nachPunkt;
physics.calculateHit = echterSchlag;

check('Ein abprallender Ball wird von keiner Figur mehr getroffen',
    nachPunkt === 0, `${nachPunkt} Treffer in 20 Frames`);
check('GEGENPROBE: dieselbe Lage im Ballwechsel trifft sehr wohl',
    imBallwechsel === 1, `${imBallwechsel} Treffer`);

/* --- 4. Keine Marken ausserhalb der Platzflaeche ------------------------- */
const g = game.grenzen;
bounceMarks.clear();
fliegt({ x: 800, y: 300, vx: 11, vy: -15 }, 900);
const draussen = bounceMarks.items.filter(m =>
    m.x < g.left || m.x > g.right || m.y < g.top || m.y > g.bottom);
console.log(`\nMarken nach dem Abpraller: ${bounceMarks.items.length}, `
    + `davon ausserhalb: ${draussen.length}`);
check('Ein abprallender Ball hinterlaesst keine Marken auf der Tribuene',
    draussen.length === 0, `${draussen.length} Marke(n) draussen`);
check('Und flutet den Markenspeicher nicht beim Ausrollen',
    bounceMarks.items.length < bounceMarks.max,
    `${bounceMarks.items.length} von ${bounceMarks.max}`);

/* Gegenprobe: IM Ballwechsel wird auch im Aus markiert — die Marke ist die
   Begruendung des Punktes und gehoert ins Bild. */
bounceMarks.clear();
match.state = 'PLAYING';
ball.x = g.right + 120; ball.y = g.top + 60; ball.z = 0.5;
ball.vx = 0; ball.vy = 0; ball.vz = -3; ball.gravity = 0.05; ball.bounces = 0;
physics.update();
check('GEGENPROBE: im Ballwechsel wird auch im Aus markiert',
    bounceMarks.items.length === 1, `${bounceMarks.items.length} Marke(n)`);

/* --- 5. Kein Protokoll-Rauschen ------------------------------------------ */
P.zeilen.length = 0;
fliegt({ x: 800, y: 300, vx: -13, vy: -15 }, 900);
console.log(`\nProtokollzeilen waehrend des Abprallers: ${P.zeilen.length}`);
check('Der Abpraller schreibt nichts ins Protokoll',
    P.zeilen.length === 0, P.zeilen.join(' / ') || 'leer');

/* --- 6. Der Ballwechsel selbst bleibt unberuehrt --------------------------
 * Die Kulisse darf erst drankommen, wenn der Punkt ENTSCHIEDEN ist. Das ist
 * frameGENAU zu pruefen und nicht nur "irgendwann danach": awardPoint()
 * schaltet MITTEN in update() um (siehe den Kommentar an der Methode), und
 * update() liest den Zustand nach jedem Block neu. In genau dem Frame, in
 * dem der Punkt faellt, ist der Ball also bereits Deko — das ist richtig so,
 * aber es muss dieser Frame sein und kein frueherer.
 * ------------------------------------------------------------------------ */
let frames = 0;
const kulisseBei = [];
const echteKulisse = physics.prallAnKulisse.bind(physics);
physics.prallAnKulisse = () => { kulisseBei.push(frames); echteKulisse(); };

match.state = 'PLAYING';
match.score.andrea = 0; match.score.alex = 0;
ball.x = 800; ball.y = 400; ball.z = 30;
ball.vx = 20; ball.vy = -18; ball.vz = 1; ball.gravity = 0.05;
ball.bounces = 0; ball.firstBounceInside = true;
let entschiedenBei = -1;
while (frames < 2000) {
    physics.update();
    frames++;
    if (match.state !== 'PLAYING') { entschiedenBei = frames; break; }
}
physics.prallAnKulisse = echteKulisse;

console.log(`\nPunkt entschieden in Frame ${entschiedenBei}; Kulisse gefragt in `
    + `Frame(s) ${kulisseBei.join(', ') || '—'}`);
check('Der Punkt faellt — die Kette laeuft durch',
    entschiedenBei > 0, `Zustand ${match.state} nach ${frames} Frames`);
check('Vor der Entscheidung wird die Kulisse nie gefragt',
    kulisseBei.every(f => f >= entschiedenBei - 1),
    `frueheste Frage in Frame ${kulisseBei[0]}`);
check('Und im offenen Ballwechsel bleibt es bei den Bildschirmraendern',
    kulisseBei.length <= 1, `${kulisseBei.length} Aufruf(e)`);

/* --- 7. Die Daempfung ist eine Daempfung --------------------------------- */
match.state = 'POINT_SCORED';
ball.x = 800; ball.y = 300; ball.z = 40;
ball.vx = 0; ball.vy = -20; ball.vz = 0; ball.gravity = 0;
ball.bounces = 1;
let vorher = 0;
for (let f = 0; f < 200; f++) {
    if (ball.vy < 0) vorher = ball.vy;
    physics.update();
    if (ball.vy > 0) break;
}
console.log(`\nAnflug ${vorher.toFixed(1)} -> Ruecklauf ${ball.vy.toFixed(1)} px/Frame`
    + ` (Daempfung ${Ph.KULISSE_DAEMPFUNG})`);
check('Der Ball kommt langsamer zurueck, als er hingeflogen ist',
    ball.vy > 0 && ball.vy < Math.abs(vorher),
    `${ball.vy.toFixed(1)} vs. ${Math.abs(vorher).toFixed(1)}`);
check('Und zwar um den eingestellten Faktor',
    Math.abs(ball.vy / Math.abs(vorher) - Ph.KULISSE_DAEMPFUNG) < 0.02,
    `${(ball.vy / Math.abs(vorher)).toFixed(3)} vs. ${Ph.KULISSE_DAEMPFUNG}`);

summary();
