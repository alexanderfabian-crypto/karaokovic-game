/* =============================================================================
 * TEST: Sendebild ohne Diagnose, Operator-Panel als EINE Zeile (ARENA-24/26)
 *
 * ZWEI BEFUNDE, zwei Sprints:
 *
 * 1. Der Canvas geht auf die LED-Wand, ins Programm und auf die Spielermonitore.
 *    Bis ARENA-23 stand dort "AUDIOEINGANG TOT", die Messanzeige mit PITCH und
 *    VOL, und im haengenden Countdown "RAUM ZU LAUT" samt Raumpegel. Das liest
 *    das Publikum mit, und auf einer Aufzeichnung bleibt es stehen.
 *
 * 2. ARENA-24 stellte dafuer zehn Lampen und sieben Messzeilen ins DOM — 17
 *    Zeilen zum Absuchen. Das ist ein Werkzeug fuer den Soundcheck; waehrend
 *    der Sendung scannt es niemand. Seit ARENA-26 steht oben EINE Zeile: BEREIT
 *    oder die dringendste Stoerung mit der einen Handlung darunter.
 *
 * Geprueft wird deshalb beides: dass im Bild nichts Diagnostisches steht, und
 * dass die Statuszeile aus den Bedingungen ihrer Ausloeser entsteht.
 *
 * Start: node Entwickler-Tests/test-sendebild.js
 * ========================================================================== */

'use strict';

const { loadGame, check, summary, zeichenprotokoll } = require('./dom-stub.js');
const game = loadGame('../app-arena.js');
const { renderer, match, physics, audio, audio2, config, MODE, PLAYER } = game;
const R = game.Renderer;
const OP = game.OperatorPanel;

const szene = () => ({
    match, ball: game.ball, paddleAndrea: game.paddleAndrea,
    paddleAlex: game.paddleAlex, bounceMarks: game.bounceMarks,
    dvd: game.dvd, andreaX: physics.currentX,
    audio, audio2,
    stimme: physics.stimme, stimmen: physics.stimmen,
    abweisung: physics.abweisung,
    /* Alles, was frueher Diagnose ins Bild brachte, auf einmal an. */
    audioTot: true, ruheHaengt: true,
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
const log = bild();
const texte = log.texte.map(t => t.text);
console.log(`Im Bild: ${[...new Set(texte)].join(' | ')}`);

const verboten = [
    ['AUDIOEINGANG TOT', /AUDIOEINGANG/],
    ['RAUM ZU LAUT', /RAUM ZU LAUT/],
    ['Raumpegel', /Raumpegel/],
    ['Hotkey-Namen', /Ctrl\+Shift/],
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
const sandQuiet = bild().texte.find(t => t.text === R.QUIET_TEXT);
const achse = renderer.achseAuf(R.QUIET_WELT_Y, {});
console.log(`  Sandplatz: Satz bei x ${sandQuiet.x.toFixed(1)}, `
    + `Achse ${achse.x.toFixed(1)}, Bildmitte 800`);
check('Er steht auf der projizierten Platzachse',
    Math.abs(sandQuiet.x - achse.x) < 0.01);
check('GEGENPROBE: das ist nicht die Bildmitte',
    Math.abs(achse.x - 800) > 20, `${(achse.x - 800).toFixed(1)} px`);
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
check('Er blendet ein statt aufzublitzen',
    alphaBei(0) === 0 && Math.abs(alphaBei(R.QUIET_EINBLENDE_MS / 2) - 0.5) < 0.01
    && alphaBei(R.QUIET_EINBLENDE_MS) === 1);
check('Und bleibt danach voll stehen',
    alphaBei(R.QUIET_EINBLENDE_MS * 10) === 1);

/* --- 3. Die eine Zeile --------------------------------------------------- *
 * Jede Pruefung liest die Bedingung IHRES Ausloesers. Geprueft wird das,
 * indem genau diese Quelle gesetzt und die STATUSZEILE abgelesen wird. */
R.SHOW_AUDIO_METER = true;

/** Alles auf unauffaellig stellen. */
function ruhig() {
    game.audioTot = false;
    game.ruheHaengt = false;
    game._gesungen = false;
    game.input.fokus = true;
    game._letzteLuecke = 0;
    game._diag.hz = 60;
    game._kanaele = 2;
    config.mode = MODE.ARCADE;
    window.devicePixelRatio = 1;
}
const lage = () => game.panelLage();

ruhig();
let L = lage();
check('Im ruhigen Betrieb steht dort BEREIT',
    L.ok === true && L.lage === OP.BEREIT, L.lage);
check('Und Zeile 2 sagt, wo wir stehen',
    /ARCADE/.test(L.tun) && /MATCH|EINSPIELEN/.test(L.tun), L.tun);

/** Setzt eine Quelle, liest die Statuszeile. */
function meldung(setzen) { ruhig(); setzen(); return lage(); }

L = meldung(() => { game.audioTot = true; });
check('E-01 haengt am Audio-Waechter', /AUDIOEINGANG TOT/.test(L.lage), L.lage);
check('Und die Zeile darunter nennt die Handlung',
    /audioNeustart/.test(L.tun), L.tun);

/* E-02 und E-03 sind ZWEI URSACHEN DESSELBEN BEFUNDS und schliessen einander
   aus — der Haenger ist derselbe, den Unterschied macht der Grundton. */
L = meldung(() => { game.ruheHaengt = true; game._gesungen = false; });
check('E-02: Haenger OHNE Grundton heisst "Raum zu laut"',
    /RAUM ZU LAUT/.test(L.lage), L.lage);
check('Mit dem Notausgang als Handlung', /Ctrl\+Shift\+A/.test(L.tun), L.tun);

L = meldung(() => { game.ruheHaengt = true; game._gesungen = true; });
check('E-03: Haenger MIT Grundton heisst "Ton im Mikrofon"',
    /TON IM MIKROFON/.test(L.lage), L.lage);
check('Mit Mix-Minus als Handlung', /Mix-Minus/.test(L.tun), L.tun);
check('Und die beiden melden NIE zugleich — sonst waere eine Zeile gelogen',
    !/RAUM ZU LAUT/.test(L.lage), L.lage);

L = meldung(() => { game.input.fokus = false; });
check('E-04 haengt am Tastaturfokus', /TASTATURFOKUS/.test(L.lage), L.lage);

L = meldung(() => {
    game._letzteLuecke = game.uhr.jetzt(); game._lueckeMs = 640;
});
check('E-05 haengt an der Frame-Luecke', /BILDKETTE/.test(L.lage), L.lage);
check('Und nennt ihre Dauer', /640 ms/.test(L.lage), L.lage);
L = meldung(() => {
    game._letzteLuecke = game.uhr.jetzt() - game.constructor.LUECKE_ANZEIGE_MS - 1;
});
check('Sie verlischt nach dem Nachlauf', L.ok === true, L.lage);

L = meldung(() => { window.devicePixelRatio = 1.5; });
check('E-06 haengt an der Anzeigeskalierung — LIVE gelesen',
    /ANZEIGESKALIERUNG 150 %/.test(L.lage), L.lage);

L = meldung(() => { game._diag.hz = 120; });
check('E-07 haengt an der gemessenen Bildrate',
    /BILDRATE ZU HOCH 120 Hz/.test(L.lage), L.lage);

L = meldung(() => { config.mode = MODE.VERSUS; game._kanaele = 1; });
check('E-08 haengt an der Kanalzahl', /NUR EIN KANAL/.test(L.lage), L.lage);
L = meldung(() => { game._kanaele = 1; });
check('Und schweigt ausserhalb des Duells', L.ok === true, L.lage);

/* E-09 zaehlt nur die PFLICHT-Assets: die als optional gekennzeichneten
   fehlen planmaessig (Benni-Reaktionen, Blendenlogo) und duerfen nichts
   ausloesen — sonst brennt die Zeile vom ersten Tag an. */
const failedVorher = game.assets.failed.slice();
const optVorher = game.assets.failedOptional.slice();
L = meldung(() => {
    game.assets.failed = ['Benni_Punkt_Alex.png'];
    game.assets.failedOptional = ['Benni_Punkt_Alex.png'];
});
check('E-09 schweigt bei einem planmaessig fehlenden Bild', L.ok === true, L.lage);
L = meldung(() => {
    game.assets.failed = ['Benni_Punkt_Alex.png', 'Platz_Sand.png'];
    game.assets.failedOptional = ['Benni_Punkt_Alex.png'];
});
check('Und meldet das erste Pflicht-Asset',
    /PFLICHT-ASSET/.test(L.lage), L.lage);
game.assets.failed = failedVorher;
game.assets.failedOptional = optVorher;

/* --- 4. Mehrere Stoerungen: die dringendste, und der Rest gezaehlt ------- */
L = meldung(() => {
    game.audioTot = true;          // E-01
    game.input.fokus = false;      // E-04
    game._diag.hz = 120;           // E-07
});
check('Bei mehreren Stoerungen nennt die Zeile die DRINGENDSTE',
    /AUDIOEINGANG TOT/.test(L.lage), L.lage);
check('Und zaehlt den Rest, statt ihn zu verschweigen',
    /\+2 weitere/.test(L.lage), L.lage);
/* Die Reihenfolge in PRUEFUNGEN IST die Dringlichkeit — zuerst, was die Show
   anhaelt. */
check('E-01 steht vor E-04 und E-07',
    OP.PRUEFUNGEN[0].code === 'E-01' && OP.PRUEFUNGEN[3].code === 'E-04'
    && OP.PRUEFUNGEN[6].code === 'E-07');
check('Jede Pruefung hat eine HANDLUNG — eine Meldung ohne sie zwingt ins '
    + 'Handbuch', OP.PRUEFUNGEN.every(e => e.tun && e.tun.length > 5));
/* E-10 (Klavierstueck) ist mit ARENA-26 ersatzlos entfallen. Die Nummer
   bleibt FREI: auf der Buehne wird der Code gerufen, nicht der Wortlaut. */
check('E-10 wird nicht neu vergeben',
    OP.PRUEFUNGEN.every(e => e.code !== 'E-10'),
    OP.PRUEFUNGEN.map(e => e.code).join(' '));

/* --- 5. Die Messzeilen: Werkzeug fuer das Einpegeln ---------------------- */
ruhig();
match.setState('SERVE_WAIT');
audio.currentVolume = 0.05;
audio.smoothedPitch = 200; audio.livePitch = 200;
audio.heldPitch = 200; audio.heldPitchAt = game.uhr.jetzt();
game.setVoiceRange(PLAYER.ANDREA, 100, 300);
let mess = lage().mess;
console.log(`\n  Messzeilen: ${mess.map(z => z.wert).join(' | ')}`);
check('Die Tonhoehe steht im Panel', /200 Hz/.test(mess[0].wert), mess[0].wert);
check('Im Aufschlag heisst laut genug "SINGEN"',
    mess[1].ok && /SINGEN/.test(mess[1].wert), mess[1].wert);
audio.currentVolume = 0.001;
mess = lage().mess;
check('Zu leise wird rot', !mess[1].ok, mess[1].wert);
match.setState('SILENCE_CHECK');
mess = lage().mess;
check('In der Ruhephase kehrt sich die Frage um — leise ist gut',
    mess[1].ok && /STILL/.test(mess[1].wert), mess[1].wert);
check('Spieler 2 ruht ausserhalb des Duells',
    mess[2].ruht && mess[3].ruht);

/* --- 6. Aus ist der Regelfall -------------------------------------------- */
R.SHOW_AUDIO_METER = false;
check('Das Panel ist im Regelfall aus', lage().sichtbar === false);
/* Und rechnet dann auch nichts: ein Panel, das ausgeschaltet 60-mal je
   Sekunde Perzentile bildet, kostet dem Spiel Rechenzeit fuer nichts. */
game.audioTot = true;
check('Ausgeschaltet rechnet es nicht mehr mit', lage().lage !== 'AUDIOEINGANG TOT');
R.SHOW_AUDIO_METER = true;
check('Eingeschaltet steht die Meldung sofort da',
    /AUDIOEINGANG TOT/.test(lage().lage));
R.SHOW_AUDIO_METER = false;

/* --- 7. Ohne DOM bleibt es stumm, statt zu werfen ------------------------ */
check('Ohne echtes DOM baut es nichts und wirft nicht',
    game.panel.aktiv === false);
game.panel.zeichne(lage());
check('Und zeichnen ist dann folgenlos', true);

summary();
