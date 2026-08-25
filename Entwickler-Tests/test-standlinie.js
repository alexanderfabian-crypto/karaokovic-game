/* =============================================================================
 * TEST: Standlinie, Zielzonen-Meter und Platzachse (ARENA-20)
 *
 * Drei Befunde aus dem Live-Test vom 25.08.2026, die alle an derselben Frage
 * haengen: WO im Bild steht etwas eigentlich?
 *
 *   1. "Andrea steht sichtbar im Feld." Die Fuesse standen exakt auf der
 *      gemalten Grundlinie — nachgemessen trifft die Projektion sie auf allen
 *      drei Plaetzen auf einen Pixel. Im Feld stand der KOERPER, der von den
 *      Fuessen aus nach oben gezeichnet wird. Der Bodenkontakt wandert
 *      deshalb hinter die Linie (Renderer.standY).
 *   2. Dort lag bisher der Zielzonen-Meter. Er weicht der Figur jetzt mit
 *      demselben Verfahren aus, das seit ARENA-18 die Countdown-Ziffer aus
 *      den Gesichtern haelt — und dem Bildrand gleich mit.
 *   3. "0 – 30 sitzt links der Mittelachse." Alle mittigen Anzeigen hingen an
 *      der Mitte des BILDES (800). Die Mitte des FELDES liegt auf Sand und
 *      Rasen 31 px weiter rechts.
 *
 * DIE HARTE REGEL: die Schlaegerlinie der Physik bleibt unberuehrt. Es
 * aendert sich, wo die Figur STEHT, nicht, wo der Ball getroffen wird.
 *
 * Start: node Entwickler-Tests/test-standlinie.js
 * ========================================================================== */

'use strict';

const { loadGame, check, summary, zeichenprotokoll } = require('./dom-stub.js');
const game = loadGame('../app-arena.js');
const { renderer, projection, match, physics, PLAYER } = game;
const R = game.Renderer;
const g = game.grenzen;

const szene = () => ({
    match, andreaX: 800,
    paddleAndrea: game.paddleAndrea, paddleAlex: game.paddleAlex,
    stimme: physics.stimme, abweisung: physics.abweisung,
    ball: game.ball, bounceMarks: game.bounceMarks, dvd: game.dvd,
});
const py = (wy) => projection.project(800, wy, 0, {}).y;

/* --- 1. Die Schlaegerlinie ist unangetastet ------------------------------ *
 * Zuerst, und nicht nebenbei: an dieser Linie haengt die gesamte
 * Treffererkennung. Waere sie mitgewandert, waere aus einer Bildkorrektur
 * eine Regelaenderung geworden. */
check('Andreas Schlaegerlinie liegt weiter auf der Grundlinie',
    game.paddleAndrea.y === g.bottom, `${game.paddleAndrea.y} = ${g.bottom}`);
check('Alex’ ebenso',
    game.paddleAlex.y === g.top, `${game.paddleAlex.y} = ${g.top}`);

/* Und sie wirkt auch: ein Ball, der die Linie kreuzt, wird geschlagen. */
match.state = 'PLAYING';
const b = game.ball;
b.x = 800; b.y = g.bottom - 6; b.z = 20;
b.vx = 0; b.vy = 8; b.vz = 0; b.bounces = 0;
b.lastHitter = PLAYER.ALEX;
physics.currentX = 800; physics.prevCurrentX = 800;
game.audio.currentVolume = 0.05;
physics.update();
check('Ein Ball an der Grundlinie wird weiterhin geschlagen',
    b.vy < 0, `vy ${b.vy.toFixed(2)}`);

/* --- 2. Die Figuren stehen hinter ihrer Linie ---------------------------- */
console.log('\nStandlinie je Platz (Welt -> Bild):');
const stand = [];
for (const name of game.PLATZ_NAMEN) {
    game.setzePlatz(name);
    const P = game.PLAETZE[name];
    const aG = py(g.bottom), aS = py(R.standY(g.bottom, true));
    const xG = py(g.top), xS = py(R.standY(g.top, false));
    stand.push({ name, aG, aS, xG, xS, hinten: P.raum.hinten,
        standAlex: R.standY(g.top, false) });
    console.log(`  ${name.padEnd(6)} Andrea ${aG.toFixed(0)} -> ${aS.toFixed(0)} `
        + `(+${(aS - aG).toFixed(0)} px, ${(900 - aS).toFixed(0)} px bis zur Bildkante)`
        + `   Alex ${xG.toFixed(0)} -> ${xS.toFixed(0)} (${(xS - xG).toFixed(0)} px)`);
}
game.setzePlatz(game.PLATZ_NAMEN[0]);

check('Andrea steht auf jedem Platz HINTER ihrer Grundlinie',
    stand.every(s => s.aS > s.aG),
    stand.map(s => `${s.name} +${(s.aS - s.aG).toFixed(0)} px`).join(', '));
check('Alex ebenso — bei ihm heisst das weiter nach hinten',
    stand.every(s => s.xS < s.xG),
    stand.map(s => `${s.name} ${(s.xS - s.xG).toFixed(0)} px`).join(', '));
check('Und beide bleiben dabei vollstaendig im Bild',
    stand.every(s => s.aS < 900 && s.xS > 0),
    stand.map(s => `${s.name} ${s.aS.toFixed(0)} / ${s.xS.toFixed(0)}`).join(', '));
/* Hinter Alex faengt irgendwann die gemalte Tribuene an. `raum.hinten` ist
   die eingemessene Zeile, ab der Boden ist — dahinter darf er nicht stehen,
   sonst schwebt er in der Kulisse. */
check('Alex steht auf dem gemalten Boden, nicht in der Tribuene',
    stand.every(s => s.standAlex > s.hinten),
    stand.map(s => `${s.name} Welt ${s.standAlex} > ${s.hinten}`).join(', '));

/* --- 3. Kopfboxen wandern mit -------------------------------------------- *
 * Sonst weicht die Countdown-Ziffer einer Stelle aus, an der niemand mehr
 * steht — lautlos, denn im Bild sieht man nur, dass sie irgendwo hingeht. */
const kb = renderer.kopfBoxen(szene());
const alt = [renderer.headBox(800, game.paddleAndrea.y),
             renderer.headBox(800, game.paddleAlex.y)];
check('Die Kopfboxen sitzen auf der Standlinie, nicht auf der Grundlinie',
    Math.abs(kb[0].bottom - alt[0].bottom) > 10
    && Math.abs(kb[1].bottom - alt[1].bottom) > 5,
    `Andrea ${(kb[0].bottom - alt[0].bottom).toFixed(0)} px, `
    + `Alex ${(kb[1].bottom - alt[1].bottom).toFixed(0)} px verschoben`);

/* --- 4. Der Meter weicht der Figur aus ----------------------------------- */
console.log('\nZielzonen-Meter, alle sechs Aufschlagsituationen:');
match.state = 'SERVE_WAIT';
const meter = [];
for (const name of game.PLATZ_NAMEN) {
    game.setzePlatz(name);
    for (const srv of [PLAYER.ANDREA, PLAYER.ALEX]) {
        match.server = srv;
        const s = szene();
        const hindernisse = renderer.figurBoxen(s).concat(renderer.randBoxen());
        const grundY = srv === PLAYER.ALEX ? game.paddleAlex.y : game.paddleAndrea.y;
        const linie = projection.project(800, grundY, 0, {});
        const vorn = projection.project(800, g.bottom, 0, {});
        const tf = linie.scale3D / vorn.scale3D;
        const nenn = linie.y + R.ZIELZONE_LINIENABSTAND * linie.scale * tf;
        const barW = R.ZIELZONE_BREITE * linie.scale;
        const gruppe = {
            left: linie.x - barW / 2, right: linie.x + barW / 2,
            top: nenn - R.ZIELZONE_PFEIL * linie.scale,
            bottom: nenn + R.ZIELZONE_HOEHE * linie.scale
                + R.ZIELZONE_HINWEIS * linie.scale,
        };
        const weg = renderer.dodgeHeads(gruppe, hindernisse,
            R.ZIELZONE_AUSWEICHWEG * linie.scale);
        const ueber = renderer.figurBoxen(s).reduce((a, f) => a + Math.max(0,
            Math.min(gruppe.bottom + weg, f.bottom)
            - Math.max(gruppe.top + weg, f.top)), 0);
        meter.push({ name, srv, weg, ueber, achse: linie.x,
            mitteX: game.PLAETZE[name].mitteX,
            oben: gruppe.top + weg, unten: gruppe.bottom + weg });
        console.log(`  ${name.padEnd(6)} ${srv.padEnd(7)} y `
            + `${(gruppe.top + weg).toFixed(0)}..${(gruppe.bottom + weg).toFixed(0)}  `
            + `Ausweichweg ${weg.toFixed(0)} px  Ueberdeckung ${ueber.toFixed(0)} px`);
    }
}
game.setzePlatz(game.PLATZ_NAMEN[0]);
match.server = PLAYER.ANDREA;

check('Der Meter liegt in KEINER Situation auf einer Figur',
    meter.every(m => m.ueber === 0),
    meter.map(m => `${m.name}/${m.srv} ${m.ueber.toFixed(0)}`).join(', '));
check('Und in keiner ausserhalb des Bildes',
    meter.every(m => m.oben >= 0 && m.unten <= 900),
    meter.map(m => `${m.name}/${m.srv} ${m.oben.toFixed(0)}..${m.unten.toFixed(0)}`).join(', '));
check('Er steht auf der Platzachse, nicht in der Bildmitte',
    meter.every(m => Math.abs(m.achse - m.mitteX) < 0.01),
    meter.map(m => `${m.name} ${m.achse.toFixed(1)}`).join(', '));
/* Wo Platz ist, bleibt er an seiner eingemessenen Stelle — das Ausweichen ist
   die Ausnahme und nicht die Regel. Bei Alex' Aufschlag liegt zwischen seiner
   Standlinie und dem Netz auf allen drei Plaetzen genug Raum. */
check('Wo er nicht muss, bewegt er sich nicht',
    meter.filter(m => m.srv === PLAYER.ALEX).every(m => m.weg === 0),
    meter.filter(m => m.srv === PLAYER.ALEX)
        .map(m => `${m.name} ${m.weg.toFixed(0)} px`).join(', '));

/* --- 5. Das Punkt-Banner sitzt auf der Mittelachse ----------------------- */
console.log('\nPunkt-Banner:');
match.state = 'POINT_SCORED';
match.lastWinner = PLAYER.ANDREA;
match.phase = 'MATCH';
const banner = [];
for (const name of game.PLATZ_NAMEN) {
    game.setzePlatz(name);
    const { ctx, log } = zeichenprotokoll();
    const echt = renderer.ctx;
    renderer.ctx = ctx;
    try { renderer.drawPointBanner(match, '0 - 30'); } finally { renderer.ctx = echt; }
    const achse = projection.project(800, g.midY, 0, {}).x;
    const xs = log.texte.map(t => t.x);
    banner.push({ name, achse, mitteX: game.PLAETZE[name].mitteX,
        abweichung: Math.max(...xs.map(x => Math.abs(x - achse))) });
    console.log(`  ${name.padEnd(6)} Achse ${achse.toFixed(1)} (Bildmitte 800), `
        + `Texte bei ${xs.map(x => x.toFixed(1)).join(', ')}`);
}
game.setzePlatz(game.PLATZ_NAMEN[0]);

check('Beide Zeilen stehen exakt auf der projizierten Platzachse',
    banner.every(x => x.abweichung < 0.01),
    banner.map(x => `${x.name} ${x.abweichung.toFixed(2)} px`).join(', '));
/* GEGENPROBE: auf dem Hartplatz faellt die Achse mit der Bildmitte zusammen —
   genau deshalb ist der Fehler dort nie aufgefallen. Auf den anderen beiden
   sind es 31 px, und die wechseln mit jedem Satz. */
check('GEGENPROBE: nur auf dem Hartplatz war die alte Mitte richtig',
    banner.filter(x => Math.abs(x.achse - 800) < 0.01).length === 1,
    banner.map(x => `${x.name} ${(x.achse - 800).toFixed(1)} px`).join(', '));

summary();
