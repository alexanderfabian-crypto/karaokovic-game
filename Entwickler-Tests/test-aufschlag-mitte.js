/* =============================================================================
 * TEST: Der Aufschlag verlangt die Mitte der eigenen Stimme (Arena-Fassung)
 *
 * SPRINT "RELATIVE PITCH" (ARENA-14). Tonhoehen-Wahrnehmung ist relativ, nicht
 * absolut: nach einem extremen Zielton verschiebt sich der innere Nullpunkt
 * kurzzeitig, und der naechste Return misslingt, obwohl "richtig" gesungen
 * wurde. Der Aufschlag zielt deshalb nicht mehr — er verlangt die MITTE des
 * eigenen Umfangs und setzt den inneren Kompass vor jedem Ballwechsel
 * zwangsweise zurueck. Die Richtung wird gewuerfelt.
 *
 * DIESE DATEI ERSETZT test-aufschlag-tonhoehe.js. Jene prueft
 * `Physics.aufschlagTonPasst()` samt `CONFIG.aufschlagToleranzHalbtoene` —
 * beides hat seit ARENA-14 KEINEN AUFRUFER mehr. Ein Test, der toten Code
 * gruen meldet, ist schlimmer als kein Test: er behauptet eine Absicherung,
 * die es nicht gibt. Die alte Garantie ("ein Ton weit ausserhalb des Umfangs
 * loest nicht aus") ist in der Zuendzone ohnehin enthalten und dort strenger.
 *
 * Start: node Entwickler-Tests/test-aufschlag-mitte.js
 * ========================================================================== */

'use strict';

const { loadGame, check, summary } = require('./dom-stub.js');
const game = loadGame('../app-arena.js');
const { physics, audio, match, PLAYER } = game;
const Physics = game.Physics;

game.setVoiceRange(PLAYER.ANDREA, 110, 330);
const breite = Physics.AUFSCHLAG_MITTE_BREITE;
const halb = breite / 2;

/** Die Frequenz, die bei Anteil `p` des Umfangs liegt. */
function tonBei(p) {
    const r = Physics.voiceRange(PLAYER.ANDREA);
    const minMidi = 12 * Math.log2(r.min / 440) + 69;
    const maxMidi = 12 * Math.log2(r.max / 440) + 69;
    return 440 * Math.pow(2, (minMidi + p * (maxMidi - minMidi) - 69) / 12);
}

console.log(`Umfang 110–330 Hz, Zuendzone ${(breite * 100).toFixed(0)} %`
    + ` (${((0.5 - halb) * 100).toFixed(0)}–${((0.5 + halb) * 100).toFixed(0)} %)`
    + ` = ${tonBei(0.5 - halb).toFixed(0)}–${tonBei(0.5 + halb).toFixed(0)} Hz`);

/**
 * Einen Frame in der Aufschlagphase fahren.
 * @param   {number} hz     Tonhoehe, 0 = kein Ton erkannt
 * @param   {number} volume Pegel
 * @returns {Object} die Stimmlage (siehe Physics.stimme)
 */
function frame(hz, volume) {
    audio.smoothedPitch = hz > 0 ? hz : -1;
    audio.currentVolume = volume;
    match.state = 'SERVE_WAIT';
    physics.update();
    return physics.stimme;
}

/** Zuruecksetzen zwischen den Abschnitten. */
function neu() {
    match.server = PLAYER.ANDREA;
    match.state = 'SERVE_WAIT';
    physics.serveCharge = 0;
    physics.abweisung.bis = 0;
}

/* --- 1. Die Zone ist die Mitte, nicht der ganze Umfang ------------------- */
neu();
check('Genau die Mitte liegt in der Zone', frame(tonBei(0.5), 0).zentriert === true);
check('Knapp innerhalb des unteren Randes noch',
    frame(tonBei(0.5 - halb + 0.01), 0).zentriert === true);
check('Knapp ausserhalb des unteren Randes nicht mehr',
    frame(tonBei(0.5 - halb - 0.01), 0).zentriert === false);
check('Knapp ausserhalb des oberen Randes ebenso wenig',
    frame(tonBei(0.5 + halb + 0.01), 0).zentriert === false);
check('Der tiefste kalibrierte Ton gibt NICHT frei — anders als vor ARENA-14',
    frame(110, 0).zentriert === false);
check('Der hoechste ebenso wenig', frame(330, 0).zentriert === false);

/* --- 2. Die Anzeige laeuft auch ohne Lautstaerke mit -------------------- */
/* Das ist der Kern gegen die UI-Falle: die Zone ist sichtbar, BEVOR man laut
   genug ist, um es zu versuchen. */
neu();
const leise = frame(tonBei(0.5), 0);
check('Ohne Lautstaerke laeuft die Anzeige trotzdem mit',
    leise.aktiv === true && Math.abs(leise.prozent - 0.5) < 0.01,
    `${(leise.prozent * 100).toFixed(1)} %`);
check('Aber ausgeloest wird nichts', match.state === 'SERVE_WAIT'
    && physics.serveCharge === 0);

const stumm = frame(0, 0);
check('Ohne erkannten Ton ist die Anzeige inaktiv',
    stumm.aktiv === false && stumm.zentriert === false);

/* --- 3. Auslösen: zentriert UND laut genug ------------------------------- */
neu();
const laut = game.config.serveVolume + 0.01;
frame(tonBei(0.5 + halb + 0.2), laut);
frame(tonBei(0.5 + halb + 0.2), laut);
frame(tonBei(0.5 + halb + 0.2), laut);
frame(tonBei(0.5 + halb + 0.2), laut);
check('Laut, aber daneben: kein Aufschlag', match.state === 'SERVE_WAIT');
check('Der Grund steht fuer die Anzeige bereit',
    physics.abweisung.bis > 0 && physics.abweisung.richtung === 'hoch',
    physics.abweisung.richtung);

neu();
for (let i = 0; i < Physics.SERVE_CHARGE_FRAMES; i++) frame(tonBei(0.5), laut);
check('Zentriert und laut: der Aufschlag loest aus', match.state === 'PLAYING',
    match.state);
check('Und die Protokollzeile weist ihn als zentriert aus',
    /\(zentriert\)/.test(game.protokoll()));

/* --- 4. Zu tief meldet die andere Richtung ------------------------------- */
neu();
for (let i = 0; i < 4; i++) frame(tonBei(0.5 - halb - 0.2), laut);
check('Zu tief meldet "tief"', physics.abweisung.richtung === 'tief');

neu();
for (let i = 0; i < 4; i++) frame(0, laut);
check('Kein erkannter Ton meldet "kein"', physics.abweisung.richtung === 'kein');

/* --- 5. Die Richtung wird gewuerfelt, nicht gezielt ---------------------- */
/* Gegenprobe zum alten Verhalten: bei IMMER demselben Ton muessen trotzdem
   beide Feldhaelften vorkommen. Vor ARENA-14 waere das Ziel konstant
   gewesen. */
const G = game.grenzen;
const mitte = (G.left + G.alley + 20 + (G.right - G.alley - 20)) / 2;
const seiten = { links: 0, rechts: 0 };
let gleichWieZuvor = 0;
let zuvor = 0;

for (let i = 0; i < 400; i++) {
    match.server = PLAYER.ANDREA;
    match.state = 'SERVE_WAIT';
    audio.smoothedPitch = tonBei(0.5);
    physics.prepareServe();
    physics.triggerServe();
    const b = game.ball;
    /* Zielpunkt aus der Flugrichtung zurueckrechnen. */
    const ty = G.top + (G.bottom - G.top) * 0.35;
    const ziel = b.x + (b.vx / b.vy) * (ty - b.y);
    const seite = ziel < mitte ? -1 : 1;
    if (seite < 0) seiten.links++; else seiten.rechts++;
    if (i > 0 && seite === zuvor) gleichWieZuvor++;
    zuvor = seite;
}

const anteilGleich = gleichWieZuvor / 399;
console.log(`\n400 Aufschlaege mit IDENTISCHEM Ton: ${seiten.links} links,`
    + ` ${seiten.rechts} rechts, ${(anteilGleich * 100).toFixed(0)} % wie der vorige`);

check('Derselbe Ton schlaegt in beide Haelften auf',
    seiten.links > 100 && seiten.rechts > 100,
    `${seiten.links} / ${seiten.rechts}`);
check('Die Anti-Wiederholung wirkt (erwartet rund 20 %)',
    anteilGleich < 0.35, `${(anteilGleich * 100).toFixed(0)} %`);
check('Sie schliesst die Wiederholung aber nicht aus',
    gleichWieZuvor > 0, `${gleichWieZuvor} Mal`);

summary();
