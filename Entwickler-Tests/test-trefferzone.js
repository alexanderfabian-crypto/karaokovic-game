/* =============================================================================
 * TEST: Wie weit darf ein Ball neben der Figur liegen und trotzdem zaehlen?
 *
 * BUEHNENBEFUND (Mitschnitt 24.08.): "Baelle, die klar neben der Figur
 * vorbeiziehen, gelten als Treffer." Die Zone war 100 Weltpixel halb, die
 * sichtbare Figur auf dem Referenzplatz aber nur 84 px breit — also 58 px
 * LEERE FLAECHE je Seite, mehr als eine halbe Figurenbreite. ARENA-16 setzt
 * die Zone auf 71 und halbiert das Polster damit auf 29 px.
 *
 * Geprueft wird viererlei:
 *   1. Die beiden Abnahmefaelle aus dem Briefing: eine halbe Figurenbreite
 *      daneben ist KEIN Treffer, die Schlaegerkante ist einer.
 *   2. Die Grenze liegt wirklich bei 71 und ist nach beiden Seiten gleich.
 *   3. GEGENPROBE: mit der alten 100 waere derselbe Ball ein Treffer
 *      gewesen. Ohne diesen Schritt wuerde der Test nur bestaetigen, dass
 *      irgendetwas trifft — nicht, dass sich etwas geaendert hat.
 *   4. Der SCHLAGWINKEL bleibt unangetastet. Trefferzone und Winkelnormierung
 *      steckten bis ARENA-16 in derselben Zahl; wer sie wieder zusammenlegt,
 *      verstellt unbemerkt die Ballrichtung.
 *
 * Start: node Entwickler-Tests/test-trefferzone.js
 * ========================================================================== */

'use strict';

const { loadGame, check, summary } = require('./dom-stub.js');
const game = loadGame('../app-arena.js');
const { physics, match, ball, paddleAndrea, audio, PADDLE } = game;

const MITTE = 800;                 // VIRTUAL_WIDTH / 2

/* Gemessen im Browser aus dem Alphakanal der Sprites, zurueckgerechnet in
   Weltpixel (siehe Kommentar an PADDLE.hitHalf). Hartplatz = Referenzplatz. */
const FIGUR_BREITE_HART = 84.1;

/**
 * Einen Ball mit festem Abstand zur Figur auf Andreas Grundlinie schicken.
 *
 * Aufgebaut wird der Frame so, dass NUR der Abstand entscheidet: die Figur
 * steht still (currentX = prevCurrentX = targetX, sonst spannte die
 * mitwandernde Zone ueber eine Wegstrecke), der Ball fliegt senkrecht und
 * schwebt in fester Hoehe, damit kein Aufsprung dazwischenkommt.
 *
 * @param {number} abstand Mittenabstand Ball/Figur in Weltpixeln
 * @returns {boolean} true, wenn der Ball zurueckgeschlagen wurde
 */
function trifft(abstand) {
    match.state = 'PLAYING';
    physics.currentX = MITTE;
    physics.prevCurrentX = MITTE;
    physics.targetX = MITTE;
    audio.currentVolume = 0.05;

    ball.x = MITTE + abstand;
    ball.y = paddleAndrea.y - 1;       // noch VOR der Linie
    ball.vx = 0;
    ball.vy = 6;                       // im naechsten Frame dahinter
    ball.z = 30;
    ball.vz = 0;
    ball.gravity = 0;                  // kein Aufsprung im Testframe
    ball.bounces = 0;

    physics.update();
    return ball.vy < 0;                // zurueckgeschlagen = getroffen
}

/* --- 1. Die beiden Abnahmefaelle aus dem Briefing ------------------------ */
const HALBE_FIGUR = FIGUR_BREITE_HART;      // Mittenabstand = eine Figurbreite
const SCHLAEGERKANTE = FIGUR_BREITE_HART / 2;

console.log(`Trefferzone: ${PADDLE.hitHalf} px halb`);
console.log(`Sichtbare Figur (Hartplatz): ${FIGUR_BREITE_HART} px breit`);
console.log(`Polster je Seite: ${(PADDLE.hitHalf - FIGUR_BREITE_HART / 2).toFixed(1)} px\n`);

check('Eine halbe Figurenbreite daneben ist kein Treffer',
    trifft(HALBE_FIGUR) === false, `Mittenabstand ${HALBE_FIGUR} px`);
check('Auch nach links nicht',
    trifft(-HALBE_FIGUR) === false, `Mittenabstand -${HALBE_FIGUR} px`);
check('An der Schlaegerkante trifft sie',
    trifft(SCHLAEGERKANTE) === true, `Mittenabstand ${SCHLAEGERKANTE} px`);
check('Und mittig sowieso', trifft(0) === true);

/* --- 2. Die Grenze liegt genau bei hitHalf, auf beiden Seiten ------------ */
check('Genau auf der Grenze zaehlt noch als Treffer',
    trifft(PADDLE.hitHalf) === true, `${PADDLE.hitHalf} px`);
check('Einen Pixel dahinter nicht mehr',
    trifft(PADDLE.hitHalf + 1) === false, `${PADDLE.hitHalf + 1} px`);
check('Die Zone ist symmetrisch',
    trifft(-PADDLE.hitHalf) === true && trifft(-PADDLE.hitHalf - 1) === false);

/* --- 3. Gegenprobe gegen den alten Stand --------------------------------- *
 * Dieselbe Codestelle, nur die alte Zahl. Faellt dieser Block durch, misst
 * der Test oben nicht die Zone, sondern irgendetwas anderes. */
const NEU = PADDLE.hitHalf;
PADDLE.hitHalf = 100;
const altTraf = trifft(HALBE_FIGUR);
PADDLE.hitHalf = NEU;

check('GEGENPROBE: mit der alten Zone (100) war derselbe Ball ein Treffer',
    altTraf === true, `${HALBE_FIGUR} px lagen innerhalb von 100 px`);
check('Die Zone steht danach wieder auf dem neuen Wert',
    PADDLE.hitHalf === 71, `${PADDLE.hitHalf}`);

/* --- 4. Der Schlagwinkel haengt weiter an PADDLE.width ------------------- *
 * `offset` in calculateHit() normiert auf width/2 = 75 und bestimmt den
 * ZIELPUNKT des Schlages. Gemessen wird deshalb nicht die Geschwindigkeit
 * (die haengt auch am Abstand), sondern der Zielpunkt selbst: er folgt aus
 * vx/vy und der festen Tiefe des Aufsprungs.
 *
 * Entscheidend ist die Saettigung. Mit width/2 = 75 ist ein Ball an der
 * Zonenkante (71) noch NICHT am Anschlag; waeren beide Zahlen wieder
 * dieselbe, laege dort bereits das Maximum und jeder Randtreffer floege in
 * die Ecke. Deshalb wird gegen einen Ball WEIT ausserhalb der Zone (100)
 * verglichen: bei einer Normierung auf 71 zielten beide auf denselben Punkt.
 * ------------------------------------------------------------------------ */
check('PADDLE.width ist unveraendert 150', PADDLE.width === 150);

const Ph = physics.constructor;
const halbSpielbar = (game.grenzen.right - game.grenzen.left) / 2
    - game.grenzen.alley - Ph.SIDELINE_SAFETY;
const aufsprungY = game.grenzen.top
    + (game.grenzen.bottom - game.grenzen.top) * Ph.BOUNCE_DEPTH;

/**
 * Zielpunkt eines Schlages aus gegebenem Abstand zur Schlaegermitte.
 * Ruft calculateHit() direkt auf — der Winkel ist auch dann definiert, wenn
 * der Abstand ausserhalb der Trefferzone liegt.
 * @param {number} abstand
 * @returns {number} Ziel-x des Aufsprungs in Weltkoordinaten
 */
function zielt(abstand) {
    ball.x = MITTE + abstand;
    ball.y = paddleAndrea.y;
    physics.calculateHit(MITTE, true, 0.05);
    return ball.x + (ball.vx / ball.vy) * (aufsprungY - ball.y);
}

const zielKante = zielt(PADDLE.hitHalf);
const zielWeit = zielt(100);
const zielMax = zielt(PADDLE.width / 2);

console.log(`\nZielpunkt: Mitte ${zielt(0).toFixed(1)}, `
    + `Zonenkante ${zielKante.toFixed(1)}, Anschlag ${zielMax.toFixed(1)}`);

check('Mittig geschlagen zielt der Ball in die Mitte',
    Math.abs(zielt(0) - MITTE) < 0.5, `${zielt(0).toFixed(2)}`);
check('Am Zonenrand ist der Winkel noch nicht am Anschlag',
    zielKante < zielMax - 1,
    `${zielKante.toFixed(1)} vs. ${zielMax.toFixed(1)}`);
check('Er entspricht 71/75 des Anschlags',
    Math.abs(zielKante - MITTE - (PADDLE.hitHalf / (PADDLE.width / 2)) * halbSpielbar) < 0.5,
    `${(zielKante - MITTE).toFixed(1)} px aus der Mitte`);
check('GEGENPROBE: bei einer Normierung auf 71 zielten Rand und 100 px gleich',
    Math.abs(zielWeit - zielKante) > 1,
    `71 px -> ${zielKante.toFixed(1)}, 100 px -> ${zielWeit.toFixed(1)}`);
check('Ab width/2 ist Schluss — weiter aussen aendert sich der Zielpunkt nicht',
    Math.abs(zielWeit - zielMax) < 0.5,
    `${zielWeit.toFixed(1)} vs. ${zielMax.toFixed(1)}`);

/* --- 5. Der absichtliche Fehler des Gegners haelt weiter Abstand --------- *
 * MISS_MARGIN_MIN ist der kleinste Abstand, mit dem Alex bewusst danebenlaeuft.
 * Er muss GROESSER als die Zone bleiben, sonst trifft der Gegner beim
 * Verfehlen — und der Ballwechsel endet nie. Beim Verkleinern der Zone wurde
 * der Abstand groesser, nicht kleiner; die Regel gilt trotzdem weiter. */
const rand = game.physics.constructor.MISS_MARGIN_MIN;
check('Der absichtliche Fehler bleibt ausserhalb der Trefferzone',
    rand > PADDLE.hitHalf, `${rand} px Abstand vs. ${PADDLE.hitHalf} px Zone`);

summary();
