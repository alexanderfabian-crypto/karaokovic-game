/* =============================================================================
 * TEST: Operator-Hotkeys nehmen Ctrl UND Alt (Arena-Fassung)
 *
 * BUEHNENBEFUND: Auf dem Mac-Show-Rechner ist ⌥⇧M nicht zuverlaessig — die
 * Option-Taste ist fuer Sonderzeichen belegt und wird je nach Tastaturlayout
 * vom System abgefangen. Damit war ausgerechnet der NOTAUSGANG (Aufschlag
 * erzwingen) auf der Buehne nicht sicher erreichbar.
 *
 * Seit ARENA-12 gilt `Ctrl+Shift` ODER `Alt+Shift`. Die Tastenkombinationen
 * sind im Kopf der Datei als GESCHUETZT markiert; geprueft wird deshalb
 * BEIDES: dass der neue Weg geht und dass der alte nicht weggefallen ist.
 *
 * Ebenso geprueft: eine einzelne Zusatztaste loest weiterhin NICHTS aus. Genau
 * dafuer gibt es die zwei Modifier — auf einer Buehne darf kein Streifschuss
 * den Punktestand zuruecksetzen.
 *
 * Der Stub kennt keine echten Tastaturereignisse (window.addEventListener ist
 * dort ein noop), deshalb wird der Handler unmittelbar aufgerufen. Geprueft
 * wird damit die Entscheidung, nicht die Ereignisverteilung des Browsers.
 *
 * Start: node Entwickler-Tests/test-hotkeys.js
 * ========================================================================== */

'use strict';

const { loadGame, check, summary } = require('./dom-stub.js');
const game = loadGame('../app-arena.js');
/* Ueber die Instanz statt ueber den Export `game.Renderer`: den gibt es
   erst seit dem Diagnose-Commit, und dieser Test soll unabhaengig davon
   laufen. */
const R = game.renderer.constructor;

/**
 * Einen Tastendruck zustellen.
 * @param   {string} code  KeyboardEvent.code
 * @param   {Object} mod   {ctrl, alt, shift}
 * @returns {boolean} true, wenn der Handler preventDefault() gerufen hat
 */
function taste(code, mod) {
    let verhindert = false;
    game.input.handleKeyDown({
        code,
        ctrlKey: !!mod.ctrl, altKey: !!mod.alt, shiftKey: !!mod.shift,
        preventDefault() { verhindert = true; },
    });
    game.input.handleKeyUp({ code });
    return verhindert;
}

/* --- 1. Beide Wege schalten das Operator-Panel --------------------------- *
 * Der Schalter heisst weiter SHOW_AUDIO_METER — er steckt in den Tests und im
 * Uebergabeprotokoll, und umbenennen waere reine Beschriftungskosmetik mit
 * Bruchrisiko. Geschaltet wird seit ARENA-24 das DOM-Panel; im Canvas steht
 * ohnehin nichts Diagnostisches mehr. */
const vorher = R.SHOW_AUDIO_METER;

taste('KeyM', { ctrl: true, shift: true });
check('Ctrl+Shift+M schaltet das Operator-Panel um',
    R.SHOW_AUDIO_METER !== vorher, `${vorher} -> ${R.SHOW_AUDIO_METER}`);

taste('KeyM', { alt: true, shift: true });
check('Alt+Shift+M schaltet sie zurueck — der alte Griff geht weiter',
    R.SHOW_AUDIO_METER === vorher, `${R.SHOW_AUDIO_METER}`);

/* --- 2. Eine Zusatztaste allein loest nichts aus ------------------------- */
taste('KeyM', { shift: true });
check('Shift allein schaltet nichts', R.SHOW_AUDIO_METER === vorher);
taste('KeyM', { ctrl: true });
check('Ctrl ohne Shift schaltet nichts', R.SHOW_AUDIO_METER === vorher);
taste('KeyM', { alt: true });
check('Alt ohne Shift schaltet nichts', R.SHOW_AUDIO_METER === vorher);
check('Und ohne Modifier meldet der Handler kein preventDefault',
    taste('KeyM', {}) === false);

/* --- 3. Reset ----------------------------------------------------------- */
game.match.startMatch();
game.match.score.andrea = 2;
game.match.sets.alex = 1;
taste('KeyX', { ctrl: true, shift: true });
check('Ctrl+Shift+X setzt den Stand zurueck',
    game.match.score.andrea === 0 && game.match.sets.alex === 0,
    game.match.scoreLine());

/* --- 4. Notausgang, der eigentliche Grund der Aenderung ------------------ */
game.input.restartServe();
check('Ausgangslage ist die Ruhephase', game.match.state === 'SILENCE_CHECK',
    game.match.state);
taste('KeyA', { ctrl: true, shift: true });
check('Ctrl+Shift+A erzwingt den Aufschlag', game.match.state === 'PLAYING',
    game.match.state);

game.input.restartServe();
taste('KeyA', { alt: true, shift: true });
check('Alt+Shift+A tut es weiterhin auch', game.match.state === 'PLAYING',
    game.match.state);

/* --- 5. Der Anpfiff haengt NICHT an den Modifiern ------------------------ */
/* Enter+Leertaste wird vor der Modifier-Pruefung ausgewertet. Waere das
   einmal verrutscht, liesse sich das Match auf der Buehne nicht mehr
   starten — deshalb steht es hier mit im Test. */
game.match.phase = 'WARMUP';
game.input.handleKeyDown({ code: 'Enter', preventDefault() {} });
game.input.handleKeyDown({ code: 'Space', preventDefault() {} });
check('Enter + Leertaste startet das Match ohne Zusatztasten',
    game.match.phase === 'MATCH', game.match.phase);
game.input.handleKeyUp({ code: 'Enter' });
game.input.handleKeyUp({ code: 'Space' });

/* --- 6. Die Eingriffe stehen im Protokoll -------------------------------- */
check('Die Panel-Umschaltung ist protokolliert',
    /OPERATOR.*Operator-Panel/.test(game.protokoll()));
check('Der erzwungene Aufschlag ebenso',
    /OPERATOR.*von Hand erzwungen/.test(game.protokoll()));

/* --- 7. Der Bootstext bewirbt GENAU die Griffe, die es gibt -------------- *
 * ARENA-26 hat Ctrl+Shift+O entfernt — die Konsolenzeile beim Start pries ihn
 * trotzdem weiter an, und zwar lautlos: kein Test hat sie gelesen. Auf der
 * Buehne schickt so eine Zeile den Operator auf einen Griff, der nichts tut,
 * und im Zweifel sucht er den Fehler bei sich.
 *
 * Geprueft wird deshalb gegen die QUELLE und nicht gegen eine getippte Liste:
 * welche Tasten der Handler tatsaechlich auswertet, steht in den
 * `e.code === 'KeyX'`-Vergleichen. Beide Richtungen — kein beworbener Griff
 * ohne Code, kein Griff ohne Werbung. */
const quelle = require('fs').readFileSync(
    require('path').join(__dirname, '..', 'app-arena.js'), 'utf8');

const bootZeile = (quelle.match(/\[Karaokovic\] ARENA-\d+ bereit\.[^']*/) || [''])[0];
check('Der Bootstext nennt die aktuelle Fassung',
    /ARENA-26 bereit/.test(bootZeile), bootZeile.slice(0, 34));

/* Nur die Hotkeys aus handleKeyDown, nicht der Enter+Leertaste-Cue. */
const behandelt = [...new Set(
    (quelle.match(/e\.code === 'Key([A-Z])'/g) || [])
        .map((s) => s.slice(-2, -1)))].sort();
const beworben = [...new Set(
    (bootZeile.match(/\b([A-Z]) = /g) || []).map((s) => s[0]))].sort();
console.log(`  Code: ${behandelt.join(' ')}   |   Bootstext: ${beworben.join(' ')}`);

check('Jeder beworbene Griff existiert auch im Code',
    beworben.every((k) => behandelt.includes(k)),
    beworben.filter((k) => !behandelt.includes(k)).join(' ') || 'keiner uebrig');
check('Und jeder Griff im Code wird auch beworben',
    behandelt.every((k) => beworben.includes(k)),
    behandelt.filter((k) => !beworben.includes(k)).join(' ') || 'keiner fehlt');

summary();
