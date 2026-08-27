/* =============================================================================
 * TEST: Das Sendebild traegt keine Diagnose mehr (ARENA-24)
 *
 * DER BEFUND: Der Canvas geht auf die LED-Wand, ins Programm und auf die
 * latenzfreien Spielermonitore. Bis ARENA-23 stand dort "AUDIOEINGANG TOT",
 * die Messanzeige mit PITCH und VOL, und im haengenden Countdown "RAUM ZU
 * LAUT — ES BRAUCHT RUHE" samt Raumpegel, Hotkey-Namen und Klavierverdacht.
 * Das liest das Publikum mit, und auf einer Aufzeichnung bleibt es stehen.
 *
 * Geprueft wird deshalb in dieser Reihenfolge:
 *   1. Im Canvas steht NICHTS Diagnostisches mehr — auch dann nicht, wenn
 *      gleichzeitig alles brennt.
 *   2. Stattdessen sagt die Wand einen Satz, den ein Schiedsrichter sagt.
 *   3. Die Diagnose ist nicht weg, sondern umgezogen: jede Lampe des
 *      Operator-Panels liest die Bedingung IHRES Ausloesers.
 *   4. Das Panel ist im Regelfall aus.
 *
 * Start: node Entwickler-Tests/test-sendebild.js
 * ========================================================================== */

'use strict';

const { loadGame, check, summary, zeichenprotokoll } = require('./dom-stub.js');
const game = loadGame('../app-arena.js');
const { renderer, match, physics, audio, audio2, config, MODE, PLAYER } = game;
const R = game.Renderer;

const szene = () => ({
    match, ball: game.ball, paddleAndrea: game.paddleAndrea,
    paddleAlex: game.paddleAlex, bounceMarks: game.bounceMarks,
    dvd: game.dvd, andreaX: physics.currentX,
    audio, audio2,
    stimme: physics.stimme, stimmen: physics.stimmen,
    abweisung: physics.abweisung,
    /* Alles, was frueher Diagnose ins Bild brachte, auf einmal an. */
    audioTot: true, ruheHaengt: true, klavierVerdacht: true,
    ruheSeitMs: R.QUIET_EINBLENDE_MS, raumpegel: 0.031,
});

/** Einen vollen Frame zeichnen und mitschreiben. */
function bild() {
    const { ctx, log } = zeichenprotokoll();
    const echt = renderer.ctx;
    renderer.ctx = ctx;
    try { renderer.render(szene()); } finally { renderer.ctx = echt; }
    return log;
}

/* --- 1. Kein Wort Diagnose im Canvas ------------------------------------- */
match.phase = 'MATCH';
match.satzAnzeigeBis = 0;
match.setState('SILENCE_CHECK');
config.mode = MODE.KLAVIER;
const log = bild();
const texte = log.texte.map(t => t.text);
console.log(`Im Bild: ${[...new Set(texte)].join(' | ')}`);

const verboten = [
    ['AUDIOEINGANG TOT', /AUDIOEINGANG/],
    ['RAUM ZU LAUT', /RAUM ZU LAUT/],
    ['Raumpegel', /Raumpegel/],
    ['Hotkey-Namen', /Ctrl\+Shift/],
    ['KLAVIER IM MIKROFON', /KLAVIER IM MIKROFON/],
    ['PITCH/VOL', /^(PITCH|VOL|P2 PITCH|P2 VOL):/],
];
const drin = verboten.filter(([, re]) => texte.some(t => re.test(t)));
check('Nichts Diagnostisches steht mehr im Bild',
    drin.length === 0, drin.map(v => v[0]).join(', ') || 'nichts davon');
/* GEGENPROBE, damit die Probe nicht bloss deshalb gruen ist, weil gar nichts
   gezeichnet wurde: der Platz und die Bauchbinde stehen sehr wohl im Bild. */
check('GEGENPROBE: das Spielbild selbst wird gezeichnet',
    texte.includes('ANDREA') && texte.includes('ALEX'),
    `${texte.length} Textstellen`);

/* --- 2. "Quiet, please." statt der Diagnose ------------------------------ */
check('Bei haengender Ruhe sagt die Wand einen Satz',
    texte.includes(R.QUIET_TEXT), R.QUIET_TEXT);
/* Serifen — der Bruch zu Courier und Impact macht ihn zur Einblendung der
   Uebertragung statt zu einem Teil des Spiels. */
const quiet = log.texte.find(t => t.text === R.QUIET_TEXT);
check('Und zwar in einer Serifenschrift',
    /Georgia|Times|serif/.test(quiet.font), quiet.font);
/* Auf der PLATZachse, nicht in der Bildmitte — dieselbe Regel wie beim
   Punkt-Banner. Auf dem Hartplatz faellt beides zusammen, deshalb Sand. */
game.setzePlatz('SAND');
const sandLog = bild();
const sandQuiet = sandLog.texte.find(t => t.text === R.QUIET_TEXT);
const achse = renderer.achseAuf(R.QUIET_WELT_Y, {});
console.log(`  Sandplatz: Satz bei x ${sandQuiet.x.toFixed(1)}, `
    + `Achse ${achse.x.toFixed(1)}, Bildmitte 800`);
check('Er steht auf der projizierten Platzachse',
    Math.abs(sandQuiet.x - achse.x) < 0.01);
check('GEGENPROBE: das ist nicht die Bildmitte',
    Math.abs(achse.x - 800) > 20, `${(achse.x - 800).toFixed(1)} px`);
/* Vor dem Netz — der Countdown steht darueber, sie duerfen sich nicht ins
   Gehege kommen. */
check('Und vor dem Netz, wo der Countdown nicht steht',
    R.QUIET_WELT_Y > game.grenzen.midY,
    `Welt-y ${R.QUIET_WELT_Y.toFixed(0)} > ${game.grenzen.midY}`);
game.setzePlatz('HART');

/* Er blendet ein, statt zu erscheinen: acht Sekunden ohne Ruhe sind ein
   schleichender Zustand, kein Ereignis. */
function alphaBei(ms) {
    const { ctx, log: l } = zeichenprotokoll();
    const echt = renderer.ctx;
    renderer.ctx = ctx;
    const s = szene(); s.ruheSeitMs = ms;
    try { renderer.drawQuietPlease(s); } finally { renderer.ctx = echt; }
    const t = l.texte.find(x => x.text === R.QUIET_TEXT);
    return t ? t.alpha : -1;
}
console.log(`  Einblende: 0 ms -> ${alphaBei(0)}, `
    + `${R.QUIET_EINBLENDE_MS / 2} ms -> ${alphaBei(R.QUIET_EINBLENDE_MS / 2)}, `
    + `${R.QUIET_EINBLENDE_MS} ms -> ${alphaBei(R.QUIET_EINBLENDE_MS)}`);
check('Er blendet ein statt aufzublitzen',
    alphaBei(0) === 0 && Math.abs(alphaBei(R.QUIET_EINBLENDE_MS / 2) - 0.5) < 0.01
    && alphaBei(R.QUIET_EINBLENDE_MS) === 1);
check('Und bleibt danach voll stehen',
    alphaBei(R.QUIET_EINBLENDE_MS * 10) === 1);

/* --- 3. Die Diagnose ist umgezogen, nicht verschwunden ------------------- *
 * Jede Lampe liest die Bedingung IHRES Ausloesers. Geprueft wird das, indem
 * genau diese Quelle gesetzt und die Lampe abgelesen wird — eine Lampe mit
 * eigener, aehnlicher Rechnung faellt hier durch. */
R.SHOW_AUDIO_METER = true;

/** Lage mit einem gesetzten Zustand holen. */
function lampe(nr) { return game.panelLage().e[nr - 1]; }

/** Alles auf unauffaellig stellen. */
function ruhig() {
    game.audioTot = false;
    game.ruheHaengt = false;
    game.klavierVerdacht = false;
    game._gesungen = false;
    game.input.fokus = true;
    game._letzteLuecke = 0;
    game._diag.hz = 60;
    game._kanaele = 2;
    game.klavier.bereit = true;
    config.mode = MODE.ARCADE;
}
ruhig();
const alleAus = game.panelLage().e.filter(z => z.an).length;
check('Im ruhigen Betrieb brennt keine einzige Lampe', alleAus === 0,
    `${alleAus} brennen`);

ruhig(); game.audioTot = true;
check('E-01 haengt am Audio-Waechter', lampe(1).an);
ruhig(); game.ruheHaengt = true;
check('E-02 haengt am Haenger-Merker der Ruhephase', lampe(2).an);

/* E-03 ist BREITER als der Klavier-Modus: ein Haenger bei anliegendem
   Grundton ist der Fingerabdruck eines Instruments im Mikrofon — die
   Stillegrenze lernt den Raum naemlich nur aus Frames OHNE Grundton. */
ruhig(); game.klavierVerdacht = true;
check('E-03 haengt am Klavierverdacht', lampe(3).an);
ruhig(); game.ruheHaengt = true; game._gesungen = true;
check('E-03 greift auch ohne Klavier-Modus, wenn ein Grundton anliegt',
    lampe(3).an);
ruhig(); game.ruheHaengt = true; game._gesungen = false;
check('GEGENPROBE: ohne Grundton ist es nur ein lauter Raum', !lampe(3).an);

ruhig(); game.input.fokus = false;
check('E-04 haengt am Tastaturfokus', lampe(4).an);
ruhig(); game._letzteLuecke = game.uhr.jetzt(); game._lueckeMs = 640;
check('E-05 haengt an der Frame-Luecke', lampe(5).an);
check('Und nennt ihre Dauer', /640 ms/.test(lampe(5).wert), lampe(5).wert);
ruhig(); game._letzteLuecke = game.uhr.jetzt() - game.constructor.LUECKE_ANZEIGE_MS - 1;
check('Sie verlischt nach dem Nachlauf', !lampe(5).an);

/* E-06 wird LIVE gelesen und nicht beim Start eingefroren: das Fenster kann
   im Betrieb auf einen anders skalierten Bildschirm wandern. */
ruhig(); window.devicePixelRatio = 1.5;
check('E-06 haengt an der Anzeigeskalierung', lampe(6).an, lampe(6).wert);
window.devicePixelRatio = 1;
check('Bei 100 % ist sie ruhig', !lampe(6).an, lampe(6).wert);

ruhig(); game._diag.hz = 120;
check('E-07 haengt an der gemessenen Bildrate', lampe(7).an, lampe(7).wert);

/* E-09 zaehlt nur die PFLICHT-Assets: die als optional gekennzeichneten
   fehlen planmaessig (Benni-Reaktionen, Blendenlogo) und duerfen keine Lampe
   ausloesen — sonst brennt sie vom ersten Tag an und niemand schaut mehr hin. */
ruhig();
const failedVorher = game.assets.failed.slice();
const optVorher = game.assets.failedOptional.slice();
game.assets.failed = ['Benni_Punkt_Alex.png'];
game.assets.failedOptional = ['Benni_Punkt_Alex.png'];
check('E-09 schweigt bei einem planmaessig fehlenden Bild', !lampe(9).an,
    lampe(9).wert);
game.assets.failed = ['Benni_Punkt_Alex.png', 'Platz_Sand.png'];
check('Und brennt beim ersten Pflicht-Asset', lampe(9).an, lampe(9).wert);
game.assets.failed = failedVorher;
game.assets.failedOptional = optVorher;

ruhig(); config.mode = MODE.VERSUS; game._kanaele = 1;
check('E-08 haengt an der Kanalzahl des Eingangs', lampe(8).an, lampe(8).wert);
ruhig();
check('Und RUHT ausserhalb des Duells — gruen waere gelogen',
    lampe(8).ruht && !lampe(8).an);

ruhig(); config.mode = MODE.KLAVIER; game.klavier.bereit = false;
game.klavier.grund = 'Datei fehlt';
check('E-10 haengt am Ladezustand des Stuecks', lampe(10).an, lampe(10).wert);
ruhig();
check('Und ruht ausserhalb des Klavier-Modus', lampe(10).ruht && !lampe(10).an);

/* --- 4. Die Messzeilen kommen aus derselben Ampel ------------------------ */
ruhig();
match.setState('SERVE_WAIT');
audio.currentVolume = 0.05;
audio.smoothedPitch = 200; audio.livePitch = 200;
audio.heldPitch = 200; audio.heldPitchAt = game.uhr.jetzt();
game.setVoiceRange(PLAYER.ANDREA, 100, 300);
let mess = game.panelLage().mess;
console.log(`\n  Messzeilen: ${mess.map(z => z.wert).join(' | ')}`);
check('Die Tonhoehe steht im Panel', /200 Hz/.test(mess[0].wert), mess[0].wert);
check('Im Aufschlag heisst laut genug "SINGEN"',
    mess[1].ok && /SINGEN/.test(mess[1].wert), mess[1].wert);
audio.currentVolume = 0.001;
mess = game.panelLage().mess;
check('Zu leise wird rot', !mess[1].ok, mess[1].wert);
match.setState('SILENCE_CHECK');
mess = game.panelLage().mess;
check('In der Ruhephase kehrt sich die Frage um — leise ist gut',
    mess[1].ok && /STILL/.test(mess[1].wert), mess[1].wert);

/* --- 5. Aus ist der Regelfall -------------------------------------------- */
R.SHOW_AUDIO_METER = false;
const aus = game.panelLage();
check('Das Panel ist im Regelfall aus', aus.sichtbar === false);
/* Und rechnet dann auch nichts: die Lampen bleiben stehen, wie sie waren.
   Ein Panel, das ausgeschaltet 60-mal je Sekunde Perzentile bildet, kostet
   dem Spiel Rechenzeit fuer nichts. */
game.audioTot = true;
check('Ausgeschaltet rechnet es nicht mehr mit',
    game.panelLage().e[0].an === false);
R.SHOW_AUDIO_METER = true;
check('Eingeschaltet steht der Wert sofort da', game.panelLage().e[0].an === true);
R.SHOW_AUDIO_METER = false;

/* --- 6. Ohne DOM bleibt es stumm, statt zu werfen ------------------------ */
check('Ohne echtes DOM baut es nichts und wirft nicht',
    game.panel.aktiv === false);
game.panel.zeichne(game.panelLage());
check('Und zeichnen ist dann folgenlos', true);

summary();
