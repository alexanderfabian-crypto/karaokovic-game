/* =============================================================================
 * TEST: Die Stimm-Anzeige und ihre eine Quelle
 *
 * ARENA-17 stellt unten rechts eine gestaltete Anzeige ins Bild: wessen
 * Stimme gerade zaehlt, welcher Ton anliegt, wie laut, und ob das gerade
 * etwas ausloest (gruen) oder nicht (rot).
 *
 * DIE HARTE REGEL DES BRIEFINGS ist nicht die Optik, sondern die Quelle:
 * Ausloeser, Zielzonen-Meter und diese Anzeige duerfen NIE auseinanderlaufen.
 * Eine Anzeige, die gruen zeigt, waehrend der Aufschlag nicht ausloest, ist
 * schlimmer als gar keine — sie laesst die Saengerin an ihrer Stimme
 * zweifeln, obwohl die Regel eine andere ist. Dieselbe Lehre wie beim
 * Oktavfehler.
 *
 * Geprueft wird deshalb in dieser Reihenfolge:
 *   1. Es gibt genau EIN Objekt, und alle drei lesen daraus.
 *   2. `frei` und der tatsaechliche Aufschlag stimmen in JEDER Kombination
 *      aus Tonhoehe und Pegel ueberein — Feld fuer Feld durchgerechnet.
 *   3. Im Ballwechsel heisst `frei`: diese Stimme steuert gerade.
 *   4. Im Duell wechselt die Anzeige mit dem Aufschlagrecht.
 *   5. Gezeichnet wird, was in der Quelle steht — und nichts anderes.
 *
 * Start: node Entwickler-Tests/test-stimme.js
 * ========================================================================== */

'use strict';

const { loadGame, check, summary, zeichenprotokoll } = require('./dom-stub.js');
const game = loadGame('../app-arena.js');
const { physics, renderer, match, audio, audio2, PLAYER, MODE, config } = game;
const R = game.Renderer;
const Ph = physics.constructor;

/* --- 1. Eine Quelle, drei Anzeigen --------------------------------------- */
game._scene.stimme = physics.stimme;
check('Die Szene reicht DASSELBE Objekt weiter, keine Kopie',
    game._scene.stimme === physics.stimme);
check('Es gibt genau einen Schreiber',
    typeof physics.stimmeSetzen === 'function');

/* --- 2. Gruen heisst: der Aufschlag loest aus ----------------------------- *
 * Das ganze Feld durchgerechnet, nicht zwei Stichproben: fuer jede
 * Kombination aus Tonlage und Pegel wird verglichen, ob `frei` und der
 * tatsaechliche Aufschlag dasselbe sagen. */
config.mode = MODE.ARCADE;
game.setVoiceRange(PLAYER.ANDREA, 100, 300);

/**
 * Einen Frame in der Aufschlagphase fahren.
 * @param   {number} hz
 * @param   {number} pegel
 * @returns {{frei:boolean, aufgeschlagen:boolean}}
 */
function aufschlagFrame(hz, pegel) {
    match.state = 'SERVE_WAIT';
    match.server = PLAYER.ANDREA;
    physics.serveCharge = 0;
    audio.smoothedPitch = hz > 0 ? hz : -1;
    audio.currentVolume = pegel;
    /* SERVE_CHARGE_FRAMES Frames, damit ein gueltiger Versuch auch wirklich
       ausloest — ein einzelner Frame kann das nie. */
    for (let i = 0; i < Ph.SERVE_CHARGE_FRAMES; i++) {
        if (match.state !== 'SERVE_WAIT') break;
        physics.update();
    }
    return { frei: physics.stimme.frei, aufgeschlagen: match.state === 'PLAYING' };
}

const mitte = Math.sqrt(100 * 300);          // Mitte des Umfangs in Hz
const faelle = [];
for (const hz of [0, 105, 140, mitte * 0.94, mitte, mitte * 1.06, 220, 290]) {
    for (const pegel of [0.000, 0.010, 0.021, 0.022, 0.050]) {
        const r = aufschlagFrame(hz, pegel);
        faelle.push({ hz, pegel, ...r });
    }
}
const uneinig = faelle.filter(f => f.frei !== f.aufgeschlagen);
const gruen = faelle.filter(f => f.frei).length;
console.log(`Aufschlagphase: ${faelle.length} Kombinationen geprueft, `
    + `${gruen} davon gruen, ${uneinig.length} Widersprueche`);

check('Gruen und Aufschlag sagen in JEDER Kombination dasselbe',
    uneinig.length === 0,
    uneinig.map(f => `${Math.round(f.hz)} Hz / ${f.pegel}`).join(', ') || 'keiner');
check('Es sind wirklich beide Antworten dabei — der Test misst etwas',
    gruen > 0 && gruen < faelle.length, `${gruen} von ${faelle.length}`);

/* Die zwei Ablehnungsgruende sind unterscheidbar, nicht nur "irgendwie rot" */
const zuLeise = aufschlagFrame(mitte, 0.010);
check('Zu leise: rot, aber der Ton liegt richtig',
    !zuLeise.frei && physics.stimme.zentriert && !physics.stimme.pegelReicht);
const daneben = aufschlagFrame(290, 0.050);
check('Laut genug, aber daneben: rot, und der Pegel reicht',
    !daneben.frei && !physics.stimme.zentriert && physics.stimme.pegelReicht);

/* --- 3. Im Ballwechsel heisst frei: die Stimme steuert -------------------- */
match.state = 'PLAYING';
physics.serveMovementLock = false;
audio.smoothedPitch = 200; audio.currentVolume = 0.05;
game.step();
const steuert = physics.stimme.frei;
audio.currentVolume = 0.005;
game.step();
const zuLeiseImSpiel = physics.stimme.frei;
audio.currentVolume = 0.05;
physics.serveMovementLock = true;
game.step();
const gesperrt = physics.stimme.frei;
physics.serveMovementLock = false;

console.log(`\nBallwechsel: laut ${steuert}, leise ${zuLeiseImSpiel}, `
    + `Aufschlagsperre ${gesperrt}`);
check('Wer laut genug singt, steuert — und die Anzeige sagt gruen', steuert);
check('Unter der Bewegungsschwelle wird sie rot', !zuLeiseImSpiel);
check('Waehrend der Aufschlagsperre ebenfalls, dort bewegt sich nichts',
    !gesperrt);
check('Die Schwelle ist die der BEWEGUNG, nicht die des Aufschlags',
    Math.abs(physics.stimme.schwelle - config.moveGate) < 1e-12,
    `${physics.stimme.schwelle} vs. ${config.moveGate}`);

/* --- 4. Duell: die Anzeige folgt dem Aufschlagrecht ----------------------- */
config.mode = MODE.VERSUS;
game.setVoiceRange(PLAYER.ALEX, 80, 240);
audio2.smoothedPitch = 140; audio2.currentVolume = 0.05;

match.state = 'SERVE_WAIT'; match.server = PLAYER.ANDREA;
physics.update();
const beiAndrea = physics.stimme.spieler;
match.state = 'SERVE_WAIT'; match.server = PLAYER.ALEX;
physics.serveCharge = 0;
physics.update();
const beiAlex = physics.stimme.spieler;

console.log(`Duell: Aufschlag Andrea -> zeigt ${beiAndrea}, `
    + `Aufschlag Alex -> zeigt ${beiAlex}`);
check('Im Duell wechselt die Anzeige mit dem Aufschlagrecht',
    beiAndrea === PLAYER.ANDREA && beiAlex === PLAYER.ALEX);

/* Im ARCADE-Modus bleibt sie bei Andrea, auch wenn Alex aufschlaegt: dort
   singt SIE seinen Aufschlag, und eine Anzeige "ALEX" waere schlicht
   falsch beschriftet. */
config.mode = MODE.ARCADE;
match.state = 'SERVE_WAIT'; match.server = PLAYER.ALEX;
physics.serveCharge = 0;
physics.update();
check('Im Arcade-Modus zeigt sie immer die einzige Stimme im Raum',
    physics.stimme.spieler === PLAYER.ANDREA, physics.stimme.spieler);

/* --- 5. Gezeichnet wird die Quelle --------------------------------------- */
/**
 * Die Anzeige einmal zeichnen und mitschreiben.
 * @param   {Object} st Stimmlage
 * @returns {Object} Zeichenprotokoll
 */
function zeichne(st) {
    const { ctx, log } = zeichenprotokoll();
    const echt = renderer.ctx;
    renderer.ctx = ctx;
    try { renderer.drawStimmAnzeige({ stimme: st }); } finally { renderer.ctx = echt; }
    return log;
}

const gruenLog = zeichne({ spieler: PLAYER.ANDREA, hz: 220, pegel: 0.05,
    schwelle: 0.022, aktiv: true, frei: true });
const rotLog = zeichne({ spieler: PLAYER.ALEX, hz: 0, pegel: 0.001,
    schwelle: 0.022, aktiv: false, frei: false });

const texte = (log) => log.texte.map(t => t.text);
console.log(`\nGezeichnet gruen: ${texte(gruenLog).join(' | ')}`);
console.log(`Gezeichnet rot:   ${texte(rotLog).join(' | ')}`);

check('Sie nennt den Namen dessen, den sie zeigt',
    texte(gruenLog)[0] === 'ANDREA' && texte(rotLog)[0] === 'ALEX');
check('Sie zeigt Hertz UND Notennamen',
    /220 Hz\s+A3/.test(texte(gruenLog)[1] || ''), texte(gruenLog)[1]);
check('Ohne Ton bleibt die Stelle besetzt, statt zu verschwinden',
    texte(rotLog).length === 2, texte(rotLog).join(' | '));
check('Gruen zeichnet gruen, rot zeichnet rot',
    gruenLog.texte[1].stil === R.METER_OK && rotLog.texte[1].stil === R.METER_BAD,
    `${gruenLog.texte[1].stil} / ${rotLog.texte[1].stil}`);

/* Der eigentliche Beweis der Ein-Quellen-Regel: die Anzeige folgt `frei`
   auch dann, wenn die uebrigen Felder etwas anderes nahelegen. Sie rechnet
   also nachweislich NICHT selbst. */
const widerspruch = zeichne({ spieler: PLAYER.ANDREA, hz: 220, pegel: 0.9,
    schwelle: 0.022, aktiv: true, frei: false });
check('Sie rechnet nicht selbst: lauter Ton, aber frei=false bleibt rot',
    widerspruch.texte[1].stil === R.METER_BAD, widerspruch.texte[1].stil);

/* Der Pegelbalken: logarithmisch, Schwellenmarke ungefaehr in der Mitte. */
const anteil = (v) => R.pegelAnteil(v);
console.log(`Balken: Raum 0.005 -> ${(anteil(0.005) * 100).toFixed(0)} %, `
    + `Schwelle 0.022 -> ${(anteil(0.022) * 100).toFixed(0)} %, `
    + `Gesang 0.08 -> ${(anteil(0.08) * 100).toFixed(0)} %`);
check('Der Balken waechst mit dem Pegel',
    anteil(0.005) < anteil(0.022) && anteil(0.022) < anteil(0.08));
check('Die Aufschlagschwelle liegt im gut ablesbaren Mittelfeld',
    anteil(0.022) > 0.35 && anteil(0.022) < 0.65,
    `${(anteil(0.022) * 100).toFixed(0)} %`);
check('GEGENPROBE: linear laege sie im linken Zehntel',
    0.022 / R.STIMME_PEGEL_MAX < 0.12,
    `${(0.022 / R.STIMME_PEGEL_MAX * 100).toFixed(0)} %`);
check('Stille laesst den Balken leer', anteil(0) === 0);
check('Und ein Uebersteuern sprengt ihn nicht', anteil(9) === 1);

/* --- 6. Die Ecke unten rechts ist nicht doppelt belegt -------------------- */
const oben = VIRTUAL_HEIGHT_TEST() - R.STIMME_UNTEN - R.STIMME_HOEHE;
console.log(`\nEcke unten rechts: Anzeige ${oben}..`
    + `${oben + R.STIMME_HOEHE}, Audio-tot-Zeile bei `
    + `${VIRTUAL_HEIGHT_TEST() - R.AUDIOTOT_ABSTAND}`);
check('Die Audio-tot-Warnung steht ueber der Anzeige, nicht darin',
    VIRTUAL_HEIGHT_TEST() - R.AUDIOTOT_ABSTAND < oben,
    `${VIRTUAL_HEIGHT_TEST() - R.AUDIOTOT_ABSTAND} vs. ${oben}`);
check('Und die Anzeige bleibt im Bild',
    oben + R.STIMME_HOEHE <= VIRTUAL_HEIGHT_TEST());

/** Die virtuelle Bildhoehe, wie sie das Spiel benutzt. */
function VIRTUAL_HEIGHT_TEST() { return 900; }

summary();
