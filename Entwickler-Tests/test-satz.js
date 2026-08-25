/* =============================================================================
 * TEST: Satzgewinn- und Satzbeginn-Anzeige (ARENA-22)
 *
 * Zwei neue Sichtbarkeiten aus dem Sprint vom 25.08.2026:
 *
 *   1. Der satzENTSCHEIDENDE Punkt bekommt eine eigene Zeile —
 *      "ANDREA GEWINNT DEN SATZ 40:15" statt "40 - 15" und "ANDREA PUNKTET!".
 *      Sie steht die volle Punktphase, erst danach beginnt die Blende.
 *   2. Zu Beginn JEDES Satzes steht "SATZ n" ueber dem Netz, an derselben
 *      Marke wie die Countdown-Ziffer.
 *
 * DIE HARTE REGEL bei 2: die Ansage ist Optik und blockiert nichts. Die
 * Ruhepruefung ist geschuetzt und laeuft darunter unveraendert weiter; waere
 * die Ruhe frueher fertig als die Ansage, faellt der Aufschlag trotzdem.
 *
 * Start: node Entwickler-Tests/test-satz.js
 * ========================================================================== */

'use strict';

const { loadGame, check, summary, zeichenprotokoll } = require('./dom-stub.js');
const game = loadGame('../app-arena.js');
const { renderer, match, physics, PLAYER } = game;
const R = game.Renderer;
const M = match.constructor;

/** Zeit im Zustand vorgeben. @param {number} ms */
function alter(ms) { match.stateTimer = game.uhr.jetzt() - ms; }

/** Einen Frame zeichnen und mitschreiben. @returns {Object} */
function zeichne(fn) {
    const { ctx, log } = zeichenprotokoll();
    const echt = renderer.ctx;
    renderer.ctx = ctx;
    try { fn(); } finally { renderer.ctx = echt; }
    return log;
}

const szene = () => ({
    match, ball: game.ball, paddleAndrea: game.paddleAndrea,
    paddleAlex: game.paddleAlex, bounceMarks: game.bounceMarks,
    dvd: game.dvd, andreaX: physics.currentX,
    audio: game.audio, audio2: game.audio2,
    stimme: physics.stimme, stimmen: physics.stimmen,
    abweisung: physics.abweisung,
});

/* --- 1. Der Endstand in Tennis-Schreibweise ------------------------------ */
console.log('Endstaende:');
const staende = [[4, 0], [4, 1], [4, 2], [5, 3], [6, 4]];
staende.forEach(([s, v]) => console.log(`  ${s}:${v} Punkte -> `
    + `"${M.satzEndstand(s, v)}"`));

check('Ein glatter Satz zeigt die Tennis-Zaehlweise',
    M.satzEndstand(4, 0) === '40:0' && M.satzEndstand(4, 1) === '40:15'
    && M.satzEndstand(4, 2) === '40:30',
    `${M.satzEndstand(4, 0)} / ${M.satzEndstand(4, 1)} / ${M.satzEndstand(4, 2)}`);
/* Nach Einstand gibt es KEIN Zahlenpaar: tennisScore() lieferte fuer den
   Sieger "ADV", und "ADV:40" als ENDstand ist Unsinn — ein Spiel endet nie
   im Vorteil. Eine Anzeigetafel schaltet dort auf "Spiel". */
check('Nach Einstand steht dort der Satz statt eines falschen Paares',
    M.satzEndstand(5, 3) === 'NACH EINSTAND'
    && M.satzEndstand(6, 4) === 'NACH EINSTAND',
    `${M.satzEndstand(5, 3)}`);
check('GEGENPROBE: die rohe Schreibweise haette "ADV" ergeben',
    M.tennisScore(5, 3) === 'ADV');

/* --- 2. Der satzentscheidende Punkt zeigt die eigene Zeile ---------------- */
match.phase = 'MATCH';
match.hardReset();
match.satzAngesagt = 0;

/* Drei Punkte fuer Andrea, einer fuer Alex — der vierte entscheidet. */
match.awardPoint(PLAYER.ANDREA);
match.awardPoint(PLAYER.ALEX);
match.awardPoint(PLAYER.ANDREA);
match.awardPoint(PLAYER.ANDREA);
const vorSatz = match.satzErgebnis;
check('Ein gewoehnlicher Punkt setzt KEIN Satzergebnis', vorSatz === '',
    `"${vorSatz}"`);

match.awardPoint(PLAYER.ANDREA);
console.log(`\nNach dem entscheidenden Punkt: Ergebnis "${match.satzErgebnis}", `
    + `Saetze ${match.sets.andrea}:${match.sets.alex}, `
    + `Stand ${match.score.andrea}:${match.score.alex}`);
check('Der satzentscheidende Punkt merkt sich den Endstand',
    match.satzErgebnis === '40:15', `"${match.satzErgebnis}"`);
check('Und der Punktestand faellt wie bisher auf 0:0',
    match.score.andrea === 0 && match.score.alex === 0);

alter(600);
const satzLog = zeichne(() => renderer.render(szene()));
const satzTexte = satzLog.texte.map(t => t.text);
console.log(`  gezeichnet: ${satzTexte.filter(t => /SATZ|PUNKTET|:/.test(t)).join(' | ')}`);
check('Im Bild steht die Satzgewinn-Zeile',
    satzTexte.some(t => t === 'ANDREA GEWINNT DEN SATZ 40:15'),
    satzTexte.join(' | '));
check('Und NICHT die gewoehnliche Punktanzeige',
    !satzTexte.some(t => /PUNKTET/.test(t)));
/* Schriftart wie "AUFSCHLAG!" — die Gothic-Familie des Countdowns. */
const satzZeile = satzLog.texte.find(t => /GEWINNT DEN SATZ/.test(t.text));
check('Sie steht in derselben Schrift wie "AUFSCHLAG!"',
    /Impact/.test(satzZeile.font), satzZeile.font);

/* Standzeit: die volle Punktphase. Daran wurde nichts geaendert — geprueft
   wird, dass es auch nichts VERKUERZT. */
alter(game.TIMING.POINT_MS - 50);
game.step();
const kurzDavor = match.state;
alter(game.TIMING.POINT_MS + 50);
game.step();
const danach = match.state;
check('Sie steht die volle Punktphase, dann erst kommt die Blende',
    kurzDavor === 'POINT_SCORED' && danach === 'TRANSITION',
    `${kurzDavor} -> ${danach}`);

/* Undo raeumt sie weg — sonst stuende der Satzgewinn im Bild, den der
   Operator gerade zurueckgenommen hat. */
match.undo();
check('Das Undo des Operators nimmt sie mit zurueck',
    match.satzErgebnis === '', `"${match.satzErgebnis}"`);

/* --- 3. "SATZ n" zu Beginn jedes Satzes ---------------------------------- */
match.startMatch();
match.setState('SILENCE_CHECK');
game.step();
console.log(`\nSatz 1: Nummer ${match.satzNummer()}, angesagt bis `
    + `+${Math.round(match.satzAnzeigeBis - game.uhr.jetzt())} ms`);
check('Auch Satz 1 wird angesagt, nicht erst Satz 2',
    R.satzAnsageLaeuft(match) && match.satzNummer() === 1,
    `Satz ${match.satzNummer()}`);
check('Und zwar fuer die festgelegte Dauer',
    Math.abs((match.satzAnzeigeBis - game.uhr.jetzt()) - R.SATZ_ANZEIGE_MS) < 50,
    `${Math.round(match.satzAnzeigeBis - game.uhr.jetzt())} von ${R.SATZ_ANZEIGE_MS} ms`);

/* Die Ziffer wird an ihrer SCHRIFT erkannt und nicht nur am Zeichen: in der
   Bauchbinde stehen ebenfalls einstellige Zahlen (Saetze und Punkte), und die
   haben mit dem Countdown nichts zu tun. */
const istZiffer = (t) => /^[0-9]$/.test(t.text) && /Impact/.test(t.font);

const startLog = zeichne(() => renderer.render(szene()));
const startTexte = startLog.texte.map(t => t.text);
check('Im Bild steht "SATZ 1"', startTexte.includes('SATZ 1'),
    startTexte.join(' | '));
/* Beide haengen an derselben Marke ueber dem Netz und duerfen sich deshalb
   nicht ueberlagern — solange die Ansage steht, ist die Ziffer weg. */
check('Und die Countdown-Ziffer ist solange NICHT im Bild',
    !startLog.texte.some(istZiffer),
    startLog.texte.filter(istZiffer).map(t => t.text).join(' | ') || 'keine');

match.satzAnzeigeBis = 0;
const zifferLog = zeichne(() => renderer.render(szene()));
const zifferTexte = zifferLog.texte.map(t => t.text);
check('Danach erscheint sie wieder',
    zifferLog.texte.some(istZiffer) && !zifferTexte.includes('SATZ 1'),
    zifferLog.texte.filter(istZiffer).map(t => t.text).join(' | '));

/* Position: dieselbe Marke wie die Ziffer. */
const satzY = startLog.texte.find(t => t.text === 'SATZ 1').y;
const zifferY = zifferLog.texte.find(istZiffer).y;
const ankerZiffer = renderer.netzAnker(
    R.COUNTDOWN_SIZE * renderer.viewport.scale * R.COUNTDOWN_SPITZE);
const ankerSatz = renderer.netzAnker(R.SATZ_START_SIZE * renderer.viewport.scale);
console.log(`  "SATZ 1" bei y ${satzY.toFixed(0)}, Ziffer bei y `
    + `${zifferY.toFixed(0)}, Netzoberkante ${R.NETZ_OBEN}`);
check('Beide stehen ueber dem Netz, an derselben Marke',
    Math.abs(satzY - ankerSatz.y) < 0.01
    && Math.abs(zifferY - ankerZiffer.y) < 0.01);
check('Und beide mit ihrer Unterkante ueber der Netzoberkante',
    ankerSatz.y + R.SATZ_START_SIZE * 0.4 <= R.NETZ_OBEN
    && ankerZiffer.y + R.COUNTDOWN_SIZE * R.COUNTDOWN_SPITZE * 0.4 <= R.NETZ_OBEN,
    `${(ankerSatz.y + R.SATZ_START_SIZE * 0.4).toFixed(0)} / `
    + `${(ankerZiffer.y + R.COUNTDOWN_SIZE * R.COUNTDOWN_SPITZE * 0.4).toFixed(0)} `
    + `vs. ${R.NETZ_OBEN}`);
/* "SATZ n" darf nicht groesser werden als die Ziffer im groessten Moment —
   sonst stoesst sie an Alex' Kopf, den die Ziffer gerade freigeraeumt hat. */
check('"SATZ n" bleibt unter der Spitze der Ziffer',
    R.SATZ_START_SIZE < R.COUNTDOWN_SIZE * R.COUNTDOWN_SPITZE,
    `${R.SATZ_START_SIZE} < ${(R.COUNTDOWN_SIZE * R.COUNTDOWN_SPITZE).toFixed(0)}`);

/* --- 4. Sie blockiert nichts --------------------------------------------- *
 * Der wichtigste Punkt: die Ruhepruefung ist geschuetzt. Ist die Ruhe frueher
 * fertig als die Ansage, faellt der Aufschlag trotzdem. */
match.setState('SILENCE_CHECK');
match.satzAnzeigeBis = game.uhr.jetzt() + 5000;   // Ansage laeuft noch lange
match.silenceTimerStart = game.uhr.jetzt() - game.TIMING.SILENCE_MS - 10;
game.audio.currentVolume = 0;
game.step();
check('Die Ruhe wird fertig, obwohl die Ansage noch steht',
    match.state === 'SERVE_WAIT' && R.satzAnsageLaeuft(match),
    `${match.state}, Ansage laeuft ${R.satzAnsageLaeuft(match)}`);

/* --- 5. Der Zeitpunkt: mit der Aufblende, nicht im Schwarz ---------------- */
match.startMatch();
match.sets.andrea = 1;                 // ein Satz ist entschieden
match.satzAngesagt = 1;                // Satz 1 war angesagt, Satz 2 noch nicht
match.setState('TRANSITION');
alter(game.TIMING.TRANSITION_MS * (R.TRANS_DREH_BIS - 0.1));
game.step();
const imSchwarz = R.satzAnsageLaeuft(match);
alter(game.TIMING.TRANSITION_MS * (R.TRANS_DREH_BIS + 0.05));
game.step();
const beiAufblende = R.satzAnsageLaeuft(match);
console.log(`\nBlende: im Schwarz angesagt ${imSchwarz}, `
    + `bei der Aufblende ${beiAufblende}`);
check('Im Schwarz der Blende wird nichts angesagt', !imSchwarz);
check('Mit der Aufblende schon', beiAufblende && match.satzNummer() === 2,
    `Satz ${match.satzNummer()}`);

summary();
