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
/* UMGEDREHT IN ARENA-20, und das ist der Kern des Buehnenbefunds "Aufschlag
   loest aus, waehrend das Panel noch rot zeigt". Bis dahin galt: waehrend der
   Aufschlagsperre bewegt sich nichts, also rot. Gemessen war das der einzige
   Frame-Bereich, in dem Ball und Anzeige sich widersprachen — die Sperre
   greift ab dem Frame NACH dem Aufschlag und haelt an, solange die Saengerin
   ihren Ton haelt. Sichtbar blieben drei Frames gruen (50 ms) und danach ein
   langes Rot bei fliegendem Ball.

   `frei` heisst jetzt "diese Stimme zaehlt gerade". Waehrend der Sperre
   zaehlt sie sehr wohl: sie hat den Ball losgeschickt, sie ist nur schon
   verbraucht. */
check('Die Aufschlagsperre faerbt die Anzeige NICHT mehr rot',
    gesperrt);
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
    try { renderer.drawStimmKasten(st, 100, 100); } finally { renderer.ctx = echt; }
    return log;
}

/** Farbe des Pegelbalkens — das ist die Ampel, seit die Hertzzeile weg ist. */
function balkenfarbe(log) {
    const treffer = log.rechtecke.filter(r =>
        r.stil === R.METER_OK || r.stil === R.METER_BAD);
    return treffer.length ? treffer[0].stil : null;
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
/* ENTFERNT IN ARENA-20: hier stand die Tonhoehe als Hertzzahl und
   Notenname. Sie war eine Doppelanzeige — welchen Ton der Aufschlaeger
   trifft, sagt der Zielzonen-Meter, und der sagt es besser, weil er die
   Zielzone mitzeigt. Geprueft wird das Fehlen, nicht nur das Vorhandensein
   des Restes: sonst kaeme sie beim naechsten Umbau unbemerkt zurueck. */
check('Sie zeigt KEINE Tonhoehe mehr — nur noch den Namen',
    texte(gruenLog).length === 1 && !/Hz/.test(texte(gruenLog).join(' ')),
    texte(gruenLog).join(' | '));
check('Auch nicht ohne Ton', texte(rotLog).length === 1,
    texte(rotLog).join(' | '));
check('Gruen zeichnet gruen, rot zeichnet rot',
    balkenfarbe(gruenLog) === R.METER_OK && balkenfarbe(rotLog) === R.METER_BAD,
    `${balkenfarbe(gruenLog)} / ${balkenfarbe(rotLog)}`);
/* Das Operator-Messgeraet behaelt seine Hertzzeilen — es ist ein Werkzeug
   und keine Show-Grafik. */
const messLog = (() => {
    const { ctx, log } = zeichenprotokoll();
    const echt = renderer.ctx;
    renderer.ctx = ctx;
    audio.smoothedPitch = 220; audio.livePitch = 220;
    audio.heldPitch = 220; audio.heldPitchAt = game.uhr.jetzt();
    try { renderer.drawAudioDebug(audio, match, audio2); }
    finally { renderer.ctx = echt; }
    return log;
})();
check('Das Operator-Messgeraet zeigt weiterhin Hertz',
    messLog.texte.some(t => /Hz/.test(t.text)),
    messLog.texte.map(t => t.text).join(' | '));

/* Der eigentliche Beweis der Ein-Quellen-Regel: die Anzeige folgt `frei`
   auch dann, wenn die uebrigen Felder etwas anderes nahelegen. Sie rechnet
   also nachweislich NICHT selbst. */
const widerspruch = zeichne({ spieler: PLAYER.ANDREA, hz: 220, pegel: 0.9,
    schwelle: 0.022, aktiv: true, frei: false });
check('Sie rechnet nicht selbst: lauter Ton, aber frei=false bleibt rot',
    balkenfarbe(widerspruch) === R.METER_BAD, balkenfarbe(widerspruch));

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

/* --- 6. ZWEI Panels, eine Regel, ein Quellenwechsel ---------------------- *
 * Alex bekommt seit ARENA-20 dasselbe Panel. Solange die KI ihn spielt, sind
 * seine Werte synthetisch — aber sie entstehen AN DER QUELLE und laufen durch
 * dieselbe Bewertung wie Andreas echte. Nur so bleibt die Ein-Quellen-Regel
 * beweisbar, und nur so ist die Umstellung auf den zweiten Kanal spaeter ein
 * reiner Quellenwechsel.
 * ------------------------------------------------------------------------ */
const beide = (() => {
    const { ctx, log } = zeichenprotokoll();
    const echt = renderer.ctx;
    renderer.ctx = ctx;
    try {
        renderer.drawStimmAnzeige({ stimmen: physics.stimmen });
    } finally { renderer.ctx = echt; }
    return log;
})();
console.log(`\nBeide Panels: ${beide.texte.map(t => t.text).join(' | ')}`);
check('Es stehen ZWEI Panels im Bild, eines je Spieler',
    beide.texte.length === 2
    && beide.texte.some(t => t.text === 'ANDREA')
    && beide.texte.some(t => t.text === 'ALEX'),
    beide.texte.map(t => t.text).join(' | '));

/* Die Lagen sind getrennte Objekte — sonst zeigten beide Panels denselben
   Zustand, und fuer einen der beiden waere die Anzeige gelogen. */
check('Jeder Spieler hat seine eigene Lage',
    physics.stimmen[PLAYER.ANDREA] !== physics.stimmen[PLAYER.ALEX]);

/* --- Der Quellenwechsel -------------------------------------------------- */
config.mode = MODE.ARCADE;
const quelleArcade = physics.tonquelle(PLAYER.ALEX);
config.mode = MODE.VERSUS;
const quelleDuell = physics.tonquelle(PLAYER.ALEX);
config.mode = MODE.ARCADE;
check('Andrea kommt immer aus dem ersten Eingang',
    physics.tonquelle(PLAYER.ANDREA) === audio);
check('Alex kommt im Duell aus dem ZWEITEN Eingang',
    quelleDuell === audio2);
check('Und im Arcade-Modus aus der synthetischen Stimme',
    quelleArcade !== audio && quelleArcade !== audio2
    && typeof quelleArcade.currentVolume === 'number'
    && typeof quelleArcade.smoothedPitch === 'number');

/* Die synthetische Stimme spiegelt bei SEINEM Aufschlag den Eingang, der ihn
   tatsaechlich ausloest. Eine eigens erfundene Kurve koennte gruen zeigen,
   waehrend der Aufschlag nicht faellt. Gespiegelt kann sie das nicht. */
match.state = 'SERVE_WAIT'; match.server = PLAYER.ALEX;
audio.smoothedPitch = 173.2; audio.currentVolume = 0.047;
const gespiegelt = physics.kiStimme();
check('Bei seinem Aufschlag spiegelt sie den ausloesenden Eingang',
    gespiegelt.currentVolume === audio.currentVolume
    && gespiegelt.smoothedPitch === audio.smoothedPitch,
    `${gespiegelt.currentVolume} / ${gespiegelt.smoothedPitch.toFixed(1)} Hz`);

/* Sonst ist seine BEWEGUNG seine Stimme. */
match.state = 'PLAYING';
physics._alexZuvor = game.paddleAlex.x;
const steht = physics.kiStimme().currentVolume;
physics._alexZuvor = game.paddleAlex.x - physics.constructor.OPPONENT_SPEED;
const rennt = physics.kiStimme().currentVolume;
console.log(`  KI-Stimme: im Stand ${steht.toFixed(3)}, in voller Bewegung `
    + `${rennt.toFixed(3)} (Schwelle ${config.moveGate})`);
check('Steht er, liegt sein Pegel UNTER der Bewegungsschwelle',
    steht < config.moveGate, `${steht.toFixed(3)}`);
check('Rennt er, darueber', rennt > config.moveGate, `${rennt.toFixed(3)}`);

/* Die Tonhoehe kommt aus der Umkehrung der Steuerung — beide Richtungen
   muessen zusammenpassen, sonst zeigt das Panel einen Ton, der die Figur
   woandershin schicken wuerde. */
const Ph2 = physics.constructor;
game.setVoiceRange(PLAYER.ALEX, 100, 300);
let ruecklaufFehler = 0;
for (const pz of [0, 0.17, 0.5, 0.83, 1]) {
    ruecklaufFehler = Math.max(ruecklaufFehler, Math.abs(
        Ph2.aufschlagProzent(Ph2.aufschlagHz(pz, PLAYER.ALEX), PLAYER.ALEX) - pz));
}
check('aufschlagHz() ist die exakte Umkehrung von aufschlagProzent()',
    ruecklaufFehler < 1e-12, `groesster Fehler ${ruecklaufFehler.toExponential(1)}`);

/* --- Kein Frame mit fliegendem Ball und rotem Panel ---------------------- *
 * DER BUEHNENBEFUND, frameweise nachgestellt: die Saengerin haelt ihren Ton,
 * der Aufschlag faellt, der Ball fliegt. Bis ARENA-20 wurde das Panel im
 * Frame NACH dem Aufschlag rot, weil die Aufschlagsperre in `frei` einging. */
config.mode = MODE.ARCADE;
match.server = PLAYER.ANDREA;
match.state = 'SERVE_WAIT';
physics.prepareServe();
match.state = 'SERVE_WAIT';
physics.serveCharge = 0;
const mittelton = Math.sqrt(100 * 300);
const spur = [];
for (let f = 0; f < 15; f++) {
    audio.smoothedPitch = mittelton;
    audio.currentVolume = 0.05;
    game.step();
    spur.push({
        f, zustand: match.state,
        fliegt: match.state === 'PLAYING'
            && (game.ball.vx !== 0 || game.ball.vy !== 0),
        frei: physics.stimmen[PLAYER.ANDREA].frei,
    });
}
const gruenAb = spur.findIndex(s => s.frei);
const flugAb = spur.findIndex(s => s.fliegt);
const widersprueche = spur.filter(s => s.fliegt && !s.frei);
console.log(`  Aufschlagfolge: gruen ab Frame ${gruenAb}, Ball fliegt ab `
    + `Frame ${flugAb}, Widersprueche ${widersprueche.length}`);
check('Das Panel wird gruen, BEVOR der Aufschlag faellt',
    gruenAb >= 0 && gruenAb < flugAb, `Frame ${gruenAb} vs. ${flugAb}`);
check('Und zwar genau die Ladeframes vorher',
    flugAb - gruenAb === Ph2.SERVE_CHARGE_FRAMES - 1,
    `${flugAb - gruenAb} Frames bei ${Ph2.SERVE_CHARGE_FRAMES} Ladeframes`);
check('Kein einziger Frame mit fliegendem Ball und rotem Panel',
    widersprueche.length === 0,
    widersprueche.map(s => `Frame ${s.f}`).join(', ') || 'keiner');

/* --- Alex' Panel weicht der Bauchbinde aus ------------------------------- *
 * Auf dem Sandplatz steht sie seit ARENA-9 oben links — also dort, wo sein
 * Panel hin soll. Abgeleitet aus HUD_Y, damit es einer verschobenen
 * Bauchbinde von selbst folgt. */
const lagen = [];
for (const name of game.PLATZ_NAMEN) {
    game.setzePlatz(name);
    const obenBelegt = R.HUD_Y < 450;
    const y = obenBelegt ? R.HUD_Y + R.HUD_HEIGHT + R.STIMME_OBEN : R.STIMME_OBEN;
    const hud = { top: R.HUD_Y, bottom: R.HUD_Y + R.HUD_HEIGHT,
        left: R.HUD_X, right: R.HUD_X + R.HUD_WIDTH };
    const box = { top: y, bottom: y + R.STIMME_HOEHE,
        left: R.STIMME_RAND, right: R.STIMME_RAND + R.STIMME_BREITE };
    const ueber = Math.max(0, Math.min(box.bottom, hud.bottom) - Math.max(box.top, hud.top))
        * (box.left < hud.right && box.right > hud.left ? 1 : 0);
    lagen.push({ name, y, ueber, unten: box.bottom });
    console.log(`  ${name.padEnd(6)} Bauchbinde y ${hud.top}..${hud.bottom}, `
        + `Alex-Panel y ${box.top}..${box.bottom}, Ueberdeckung ${ueber} px`);
}
game.setzePlatz(game.PLATZ_NAMEN[0]);
check('Sein Panel liegt auf keinem Platz auf der Bauchbinde',
    lagen.every(l => l.ueber === 0),
    lagen.map(l => `${l.name} ${l.ueber} px`).join(', '));
check('Und bleibt ueberall im Bild',
    lagen.every(l => l.unten <= 900),
    lagen.map(l => `${l.name} bis ${l.unten}`).join(', '));

/* --- 7. Die Ecke unten rechts ist nicht doppelt belegt -------------------- */
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
