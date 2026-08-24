/* =============================================================================
 * TEST: Die Uebergangsblende zwischen zwei Ballwechseln
 *
 * ARENA-16 ersetzt den alten "Bumper" (Zoom auf den Punktestand) durch eine
 * dreischrittige Choreografie in 2000 ms:
 *
 *   Schritt 1  0 .. 25 %   Logo wischt von links ein, Bild dunkelt auf schwarz
 *   Schritt 2  25 .. 75 %  Bild bleibt schwarz, Logo dreht sich EINMAL
 *   Schritt 3  75 .. 100 % Schwarz blendet auf, der Platz kommt zurueck
 *
 * Zwei Dinge daran sind nicht Optik, sondern Voraussetzung fuer das Spiel:
 *
 *   - Das Schwarz liegt UEBER den Figuren. Nur deshalb darf mitten in der
 *     Blende zurueckgesetzt und der Platz gewechselt werden (Game.step),
 *     ohne dass das Publikum einen Sprung sieht.
 *   - Die Raender passen an die Nachbarphasen an: die Punktanzeige davor
 *     steht auf 0.6 Abdunkelung, die Ruhepruefung danach auf 0. Ein Sprung
 *     an einer der beiden Nahtstellen faellt auf der LED-Wand sofort auf.
 *
 * Gezeichnet wird gegen den mitschreibenden Kontext aus dom-stub.js: geprueft
 * wird, was der Renderer TATSAECHLICH anweist, nicht was er anweisen sollte.
 *
 * Start: node Entwickler-Tests/test-blende.js
 * ========================================================================== */

'use strict';

const { loadGame, check, summary, zeichenprotokoll } = require('./dom-stub.js');
const game = loadGame('../app-arena.js');
const { renderer, match } = game;
const R = renderer.constructor;

const DAUER = 2000;                 // TIMING.TRANSITION_MS
const A = R.TRANS_WISCH_BIS;        // Ende Schritt 1
const B = R.TRANS_DREH_BIS;         // Ende Schritt 2

/**
 * Einen Frame der Blende zeichnen und mitschreiben.
 * @param {number} prog 0..1
 */
function blende(prog) {
    const { ctx, log } = zeichenprotokoll();
    const echt = renderer.ctx;
    renderer.ctx = ctx;
    match.stateTimer = game.uhr.jetzt() - prog * DAUER;
    try {
        renderer.drawTransition(match, game.dvd, '15 : 30');
    } finally {
        renderer.ctx = echt;
    }
    return log;
}

/**
 * Deckkraft des ganzflaechigen Schwarz in diesem Frame.
 * @param {Object} log
 * @returns {number}
 */
function schwarzwert(log) {
    const voll = log.rechtecke.filter(r =>
        r.x === 0 && r.y === 0 && r.w >= renderer.viewport.width
        && r.h >= renderer.viewport.height && /rgba\(0, 0, 0/.test(r.stil));
    if (!voll.length) return -1;
    return parseFloat(voll[voll.length - 1].stil.match(/,\s*([\d.]+)\)/)[1]);
}

/* --- 1. Das Bild wird wirklich vollflaechig zugedeckt -------------------- */
const mitte = blende((A + B) / 2);
check('Die Blende deckt die volle Flaeche ab, nicht nur den Platz',
    schwarzwert(mitte) >= 0, `${mitte.rechtecke.length} Rechteck(e)`);
check('In Schritt 2 ist das Bild vollstaendig schwarz',
    schwarzwert(mitte) === 1, `alpha ${schwarzwert(mitte)}`);

/* --- 2. Die Raender passen an die Nachbarphasen ------------------------- */
const anfang = schwarzwert(blende(0));
const ende = schwarzwert(blende(1));
console.log(`Deckkraft: Start ${anfang}, Mitte ${schwarzwert(mitte)}, Ende ${ende}`);

check('Am Anfang setzt sie die Abdunkelung der Punktanzeige fort (0.6)',
    Math.abs(anfang - 0.6) < 0.02, `${anfang}`);
check('Am Ende ist das Bild wieder frei (0)',
    Math.abs(ende) < 0.02, `${ende}`);

/* Kein Sprung dazwischen: in Schritt 1 nur steigend, in Schritt 3 nur fallend
   und beides in kleinen Schritten. 40 Stuetzstellen sind bei 2000 ms genau
   ein Wert je 50 ms — enger als jede sichtbare Stufe. */
let steigtDurchgehend = true, faelltDurchgehend = true, groessterSprung = 0;
let vorher = anfang;
for (let i = 1; i <= 40; i++) {
    const w = schwarzwert(blende((i / 40) * A));
    if (w < vorher - 1e-9) steigtDurchgehend = false;
    groessterSprung = Math.max(groessterSprung, Math.abs(w - vorher));
    vorher = w;
}
for (let i = 1; i <= 40; i++) {
    const w = schwarzwert(blende(B + (i / 40) * (1 - B)));
    if (w > vorher + 1e-9) faelltDurchgehend = false;
    groessterSprung = Math.max(groessterSprung, Math.abs(w - vorher));
    vorher = w;
}
check('Schritt 1 dunkelt nur ab, Schritt 3 blendet nur auf',
    steigtDurchgehend && faelltDurchgehend);
check('Und keiner der Schritte springt',
    groessterSprung < 0.1, `groesster Sprung ${groessterSprung.toFixed(3)}`);

/* --- 3. Der Wisch --------------------------------------------------------
 * Der Beschnitt beginnt an der linken Logokante und waechst nach rechts. */
const w0 = blende(0.001).schnitte[0];
const wHalb = blende(A / 2).schnitte[0];
const wVoll = blende(A * 0.999).schnitte[0];
console.log(`Wisch: ${w0.w.toFixed(0)} -> ${wHalb.w.toFixed(0)} -> `
    + `${wVoll.w.toFixed(0)} px breit`);

check('Zu Beginn ist vom Logo noch nichts freigegeben',
    w0.w < wVoll.w * 0.02, `${w0.w.toFixed(1)} px`);
check('Nach der halben Zeit die halbe Breite',
    Math.abs(wHalb.w - wVoll.w / 2) < wVoll.w * 0.02,
    `${wHalb.w.toFixed(0)} von ${wVoll.w.toFixed(0)} px`);
check('Er wischt von LINKS ein, die Kante bleibt stehen',
    w0.x === wHalb.x && wHalb.x === wVoll.x, `x = ${w0.x.toFixed(1)}`);

/* --- 4. Die Drehung ------------------------------------------------------
 * Genau eine volle Umdrehung, mit weichem An- und Auslauf (smoothstep).
 * Ohne den weichen Auslauf steht das Logo am Ende von Schritt 2 mit voller
 * Winkelgeschwindigkeit still — im Schwarz unsichtbar, aber die Kurve waere
 * dann eine andere als beschrieben. */
const drehStart = blende(A + 0.001).winkel[0];
const drehEnde = blende(B - 0.001).winkel[0];
const drehMitte = blende((A + B) / 2).winkel[0];
const drehFrueh = blende(A + (B - A) * 0.05).winkel[0];

console.log(`Drehung: ${(drehStart / Math.PI).toFixed(3)}pi -> `
    + `${(drehMitte / Math.PI).toFixed(3)}pi -> ${(drehEnde / Math.PI).toFixed(3)}pi`);

check('Im Wisch dreht sich noch nichts',
    Math.abs(blende(A / 2).winkel[0]) < 1e-9, `${blende(A / 2).winkel[0]}`);
check('Schritt 2 dreht genau eine volle Umdrehung',
    Math.abs(drehEnde - 2 * Math.PI) < 0.02,
    `${(drehEnde / Math.PI).toFixed(4)}pi statt 2pi`);
check('Auf halber Strecke steht es auf dem Kopf',
    Math.abs(drehMitte - Math.PI) < 0.02, `${(drehMitte / Math.PI).toFixed(4)}pi`);
check('Die Drehung laeuft weich an, statt sofort loszureissen',
    drehFrueh < 2 * Math.PI * 0.02,
    `nach 5 % der Strecke erst ${(drehFrueh / (2 * Math.PI) * 100).toFixed(1)} % `
    + `der Umdrehung (linear waeren es 5 %)`);

/* --- 5. In Schritt 3 ist das Logo weg ----------------------------------- */
const spaet = blende(B + (1 - B) / 2);
check('Waehrend der Platz aufblendet, wird kein Logo mehr gezeichnet',
    spaet.winkel.length === 0 && spaet.schnitte.length === 0,
    `${spaet.winkel.length} Drehung(en), ${spaet.schnitte.length} Beschnitt(e)`);
check('Ohne Logodatei springt der Schriftzug ein',
    blende(A / 2).texte.some(t => t.text === 'KARAOKOVIC'),
    blende(A / 2).texte.map(t => t.text).join(', ') || 'nichts gezeichnet');

/* --- 6. Die Abdunkelung liegt NICHT doppelt an --------------------------- *
 * Bis ARENA-15 legte drawDimOverlay() in der Blende ein eigenes Schwarz
 * darueber. Da die Blende jetzt selbst deckt, waere das ein zweites Schwarz
 * mit eigener Zeitfuehrung — und die Aufblende am Ende bliebe haengen. */
const dim = zeichenprotokoll();
const echt = renderer.ctx;
renderer.ctx = dim.ctx;
match.stateTimer = game.uhr.jetzt() - 0.5 * DAUER;
renderer.drawDimOverlay(match, { state: 'TRANSITION' });
renderer.ctx = echt;
check('drawDimOverlay haelt sich in der Blende vollstaendig heraus',
    dim.log.rechtecke.length === 0,
    `${dim.log.rechtecke.length} Rechteck(e)`);

/* --- 7. Zuruecksetzen und Platzwechsel liegen im schwarzen Bild ---------- *
 * Die eigentliche Absicherung: Game.step() setzt beide Figuren zurueck und
 * wechselt den Belag bei TRANS_SCHWARZ_AB. Dieser Moment MUSS vollstaendig
 * gedeckt sein, sonst sieht das Publikum die Figuren springen. */
check('Der Umbaupunkt liegt hinter dem Wisch und vor der Aufblende',
    R.TRANS_SCHWARZ_AB > A && R.TRANS_SCHWARZ_AB < B,
    `${R.TRANS_SCHWARZ_AB} zwischen ${A} und ${B}`);
check('Und das Bild ist dort restlos schwarz',
    schwarzwert(blende(R.TRANS_SCHWARZ_AB + 0.001)) === 1,
    `alpha ${schwarzwert(blende(R.TRANS_SCHWARZ_AB + 0.001))}`);

/* GEGENPROBE mit dem echten step(): vor dem Umbaupunkt darf nichts passieren,
   danach genau einmal. */
let umbauten = 0, wechsel = 0;
const echterUmbau = game.physics.prepareServe.bind(game.physics);
const echterWechsel = game.pruefePlatzwechsel.bind(game);
game.physics.prepareServe = () => { umbauten++; echterUmbau(); };
game.pruefePlatzwechsel = () => { wechsel++; echterWechsel(); };

match.setState('TRANSITION');
match.transitionResetDone = false;
const vorPunkt = [0.05, 0.15, 0.25, 0.34];
for (const prog of vorPunkt) {
    match.stateTimer = game.uhr.jetzt() - prog * DAUER;
    game.step();
}
const umbauVorher = umbauten;
for (const prog of [0.36, 0.5, 0.7, 0.9]) {
    match.stateTimer = game.uhr.jetzt() - prog * DAUER;
    game.step();
}
game.physics.prepareServe = echterUmbau;
game.pruefePlatzwechsel = echterWechsel;

check('Vor dem Umbaupunkt wird nichts zurueckgesetzt',
    umbauVorher === 0, `${umbauVorher} Mal in ${vorPunkt.length} Frames`);
check('Danach genau einmal — und nicht in jedem Frame erneut',
    umbauten === 1, `${umbauten} Mal in 4 Frames`);
check('Der Belagwechsel haengt am selben Moment',
    wechsel === 1, `${wechsel} Mal`);

summary();
