/* =============================================================================
 * TEST: Klavier-Modus (ARENA-23)
 *
 * Das Spiel bekommt seine ERSTE EIGENE TONQUELLE. Bis hierher hat es nur
 * zugehoert. Geprueft wird deshalb in dieser Reihenfolge:
 *
 *   1. Der vierte Modus aendert keine Spielregel — er faellt ueberall in den
 *      Arcade-Zweig. Das ist keine Behauptung, sondern nachgezaehlt.
 *   2. Der Weg zum Ausgang wird GEMESSEN, nicht geraten: unter file://
 *      liefert die Web-Audio-Kette Stille, und zwar ohne Fehler. Beide
 *      Ausgaenge der Messung muessen zu einem hoerbaren Klavier fuehren.
 *   3. Die Verzahnung mit der Zustandsmaschine: Start mit der Match-Phase,
 *      nie im Einspielen, durchlaufend, Ende am letzten Satz.
 *   4. Fehlt die MP3, laeuft das Spiel weiter und sagt es im Protokoll.
 *   5. Haengt der Countdown, nennt die Warnung den Klavier-Verdacht.
 *
 * Start: node Entwickler-Tests/test-klavier.js
 * ========================================================================== */

'use strict';

const fs = require('fs');
const path = require('path');
const { loadGame, check, summary, klavierAttrappe } = require('./dom-stub.js');
const game = loadGame('../app-arena.js');
const { physics, match, audio, audio2, config, MODE, PLAYER } = game;
const K = game.Klavier;
const klavier = game.klavier;

/** Protokollzeilen seit einer Marke. @returns {string[]} */
function seit(marke) { return game.Protokoll.zeilen.slice(marke); }
/** @returns {number} */
function marke() { return game.Protokoll.zeilen.length; }

(async () => {

/* --- 1. Der vierte Modus spielt wie Arcade ------------------------------- *
 * Der Klavier-Modus fuegt eine Tonquelle hinzu und einen Menuepunkt. Wuerde
 * er nebenbei eine Spielregel aendern, waere das der teuerste denkbare
 * Nebeneffekt — und der unauffaelligste. */
const quelle = fs.readFileSync(
    path.join(__dirname, '..', 'app-arena.js'), 'utf8');
const positivArcade = (quelle.match(/===\s*MODE\.ARCADE/g) || []).length;
console.log(`Modusabfragen im Spielcode: `
    + `${(quelle.match(/===\s*MODE\.VERSUS/g) || []).length}x auf VERSUS, `
    + `${positivArcade}x positiv auf ARCADE`);
check('Es gibt keine positive Abfrage auf ARCADE — deshalb ist ein vierter '
    + 'Wert gefahrlos', positivArcade === 0, `${positivArcade} Treffer`);
check('MODE.KLAVIER existiert', MODE.KLAVIER === 'KLAVIER');

config.mode = MODE.KLAVIER;
game.setVoiceRange(PLAYER.ANDREA, 100, 300);
match.server = PLAYER.ALEX;
const quelleAlexKlavier = physics.tonquelle(PLAYER.ALEX);
const serverKlavier = physics.serverAudio();
config.mode = MODE.ARCADE;
const quelleAlexArcade = physics.tonquelle(PLAYER.ALEX);
const serverArcade = physics.serverAudio();
config.mode = MODE.KLAVIER;

check('Alex bleibt die KI, wie im Arcade-Modus',
    quelleAlexKlavier === quelleAlexArcade && quelleAlexKlavier !== audio2);
check('Der Aufschlag liest denselben Eingang wie im Arcade-Modus',
    serverKlavier === serverArcade && serverKlavier === audio);
check('Und die Ruhepruefung hoert auf EIN Mikrofon',
    game.loudestVolume() === audio.currentVolume);

/* --- 2. Stuecke und Laden ------------------------------------------------ */
console.log(`\nStuecke: ${K.STUECKE.join(', ')}`);
check('Es gibt genau zwei Stuecke', K.STUECKE.length === 2);
check('Und die Dateinamen stehen ausgeschrieben im Code — das Bauskript '
    + 'liest sie von dort', K.STUECKE.every(s => /^Karaokovic_Klavier_[12]\.mp3$/.test(s)));
check('dateiFuer() greift auf dieselbe Tabelle zu',
    K.dateiFuer(1) === K.STUECKE[0] && K.dateiFuer(2) === K.STUECKE[1]);

klavierAttrappe.laden = 'ok';
let m = marke();
const geladen = await klavier.laden(1);
check('Ein vorhandenes Stueck wird geladen', geladen && klavier.bereit);
check('Und der Ladezustand steht im Protokoll',
    seit(m).some(z => /KLAVIER.*geladen/.test(z)), seit(m).join(' / '));
check('Das Element laeuft im Rundlauf', klavier.el.loop === true);

/* FEHLT DIE DATEI, laeuft das Spiel weiter — Hausordnung. */
klavierAttrappe.laden = 'fehler';
m = marke();
const fehlt = await klavier.laden(2);
check('Eine fehlende MP3 macht nur die Begleitung stumm, nicht das Spiel',
    fehlt === false && klavier.bereit === false);
check('Und sie steht als ASSET-Zeile im Protokoll',
    seit(m).some(z => /ASSET.*Klavierstueck fehlt/.test(z)), seit(m).join(' / '));
/* Ein stummes Klavier darf niemanden aufhalten: start() tut dann nichts. */
klavier.start();
check('Ohne Datei startet nichts, und es wirft auch nichts', !klavier.laeuft);

klavierAttrappe.laden = 'ok';
await klavier.laden(1);

/* --- 3. Der Weg zum Ausgang wird GEMESSEN -------------------------------- *
 * DER BEFUND DIESES SPRINTS: unter file:// liefert
 * createMediaElementSource() Stille — das Element meldet dabei "spielt". Wer
 * den Weg an `location.protocol` festmacht, raet; wer misst, weiss es. */
const ctx = new AudioContext({ sampleRate: 48000 });

klavierAttrappe.probeRms = 0;            // die Kette ist stumm (file://)
m = marke();
await klavier.verbinden(ctx);
check('Stille Kette -> das Klavier laeuft direkt ueber das Element',
    klavier.ueberGraph === false);
check('Und der Grund steht im Protokoll, samt gemessenem Wert',
    seit(m).some(z => /Web-Audio-Kette liefert Stille/.test(z)),
    seit(m).join(' / '));
/* Im Direktweg traegt `element.volume` den Pegel — und zwar wirklich, nicht
   nur der Form nach. Der Blendfaktor steht dabei auf 1, sonst pruefte der
   Vergleich zwei Nullen gegeneinander. */
klavier._blendfaktor = 1;
klavier.setzePegel(0.5, 0.9);
check('Im Direktweg traegt das Element den Pegel',
    Math.abs(klavier.el.volume - 0.5) < 1e-9, `${klavier.el.volume}`);

klavierAttrappe.probeRms = 0.03;         // die Kette klingt (https)
await klavier.laden(1);
m = marke();
await klavier.verbinden(ctx);
check('Klingende Kette -> zwei getrennt regelbare Wege',
    klavier.ueberGraph === true
    && !!klavier.kopfGain && !!klavier.publikumGain);
check('Und auch das steht im Protokoll',
    seit(m).some(z => /Web-Audio-Kette steht/.test(z)), seit(m).join(' / '));

klavier._blendfaktor = 1;
klavier.setzePegel(0.4, 0.9);
check('Kopfhoerer- und Publikumsweg sind getrennt einstellbar',
    Math.abs(klavier.kopfGain.gain.value - 0.4) < 1e-9
    && Math.abs(klavier.publikumGain.gain.value - 0.9) < 1e-9,
    `${klavier.kopfGain.gain.value} / ${klavier.publikumGain.gain.value}`);
klavier.setzePegel(K.PEGEL_KOPF, K.PEGEL_PUBLIKUM);

/* --- 4. Verzahnung mit der Zustandsmaschine ------------------------------ */
match.phase = 'WARMUP';
match.matchLauf = 0;
game._klavierLauf = 0;
game._klavierBeendet = false;
klavier.laeuft = false;
game.klavierNachfuehren();
check('Im Einspielen spielt kein Klavier', !klavier.laeuft);

m = marke();
match.startMatch();
game.klavierNachfuehren();
check('Mit dem Wechsel in die Match-Phase startet es — ohne zweiten Cue',
    klavier.laeuft && !klavier.el.paused);
check('Und der Start steht im Protokoll',
    seit(m).some(z => /KLAVIER.*Start/.test(z)), seit(m).join(' / '));
check('Es beginnt am Anfang des Stuecks', klavier.el.currentTime === 0);

/* Eingeblendet statt hart eingeschaltet: eine MP3 beginnt selten exakt bei
   null, und ein Knacks im ersten Moment des Auftritts ist der Moment, in dem
   alle hinhoeren. */
check('Und es wird kurz eingeblendet, statt hart einzusetzen',
    klavier._blendfaktor === 0 && klavier._blende
    && klavier._blende.nach === 1 && klavier._blende.dauer === K.EINBLENDE_MS,
    `${K.EINBLENDE_MS} ms`);
klavier._blende.start = game.uhr.jetzt() - K.EINBLENDE_MS - 10;
klavier.tick();
check('Nach der Einblende steht der volle Pegel',
    klavier._blendfaktor === 1 && !klavier._blende);

/* DURCHLAUFEND: Punkte, Blenden, Satzwechsel halten es nicht an. */
const zustaende = ['POINT_SCORED', 'TRANSITION', 'SILENCE_CHECK',
    'SERVE_WAIT', 'PLAYING'];
let unterbrochen = 0;
for (const z of zustaende) {
    match.setState(z);
    game.klavierNachfuehren();
    if (!klavier.laeuft || klavier.el.paused) unterbrochen++;
}
check('Es laeuft ueber Punkte, Blenden und Countdowns durch',
    unterbrochen === 0, `${unterbrochen} Unterbrechungen in ${zustaende.length} Zustaenden`);

/* Auch ein Satzgewinn haelt es nicht an — nur das MATCH-Ende tut das. */
match.sets.andrea = 1;
game._gespielteSaetze = 1;
game.klavierNachfuehren();
check('Ein Satzwechsel unterbricht es nicht', klavier.laeuft);

/* --- 5. Ende: der letzte Satz ------------------------------------------- *
 * Das Spiel kennt keinen Sieger-Zustand. Was es kennt, ist die Platzfolge:
 * drei Plaetze, jeder genau einmal. Sind alle gespielt, ist der letzte Satz
 * vorbei. */
m = marke();
game._gespielteSaetze = game.platzFolge.length;
game.klavierNachfuehren();
check('Nach dem letzten Satz beginnt die Ausblende',
    !!klavier._blende && klavier._blende.nach === 0);
check('Sie dauert die festgelegten zwei Sekunden',
    klavier._blende.dauer === K.AUSBLENDE_MS, `${klavier._blende.dauer} ms`);
check('Und sie steht im Protokoll',
    seit(m).some(z => /Ausblende/.test(z)), seit(m).join(' / '));

/* Die Blende laeuft ueber tick(), nicht ueber eine Uhr im Audiograph — damit
   ist sie im Test fahrbar und im Spiel an dieselbe Bildkette gebunden wie
   alles andere. */
klavier._blende.start = game.uhr.jetzt() - K.AUSBLENDE_MS / 2;
klavier.tick();
const halb = klavier._blendfaktor;
klavier._blende.start = game.uhr.jetzt() - K.AUSBLENDE_MS - 10;
klavier.tick();
console.log(`\nAusblende: nach der Haelfte ${halb.toFixed(2)}, am Ende `
    + `${klavier._blendfaktor.toFixed(2)}, Element `
    + `${klavier.el.paused ? 'angehalten' : 'laeuft'}`);
check('Auf halbem Weg liegt sie in der Mitte',
    Math.abs(halb - 0.5) < 0.1, `${halb.toFixed(2)}`);
check('Am Ende ist der Pegel null und das Element haelt an',
    klavier._blendfaktor === 0 && klavier.el.paused && !klavier.laeuft);

/* --- 6. Der Reset ist ein frischer Anlauf -------------------------------- *
 * Ihn nur zu beenden waere eine Sackgasse: nach dem Reset steht die Phase
 * bereits auf MATCH, der Regie-Cue greift nicht mehr, und die Show haette
 * keinen Weg zurueck zur Musik. */
match.hardReset();
game._gespielteSaetze = 0;
game.klavierNachfuehren();
check('Ein Reset des Operators startet die Begleitung neu',
    klavier.laeuft && klavier.el.currentTime === 0);

/* --- 7. Rundlauf ---------------------------------------------------------- *
 * `ended` feuert bei loop = true nicht — erkannt wird der zurueckspringende
 * Zeitstempel. Die Zeile ist der einzige Weg, einen hoerbaren Bruch spaeter
 * im Mitschnitt wiederzufinden. */
klavier.el.currentTime = 500;
klavier.tick();
m = marke();
klavier.el.currentTime = 0.2;
klavier.tick();
check('Der Rundlauf wird erkannt und protokolliert',
    klavier.rundlaeufe === 1 && seit(m).some(z => /Rundlauf 1/.test(z)),
    seit(m).join(' / '));
/* Ein normaler Fortschritt darf ihn NICHT ausloesen. */
const vorher = klavier.rundlaeufe;
klavier.el.currentTime = 0.4;
klavier.tick();
check('Ein normaler Fortschritt loest ihn nicht aus',
    klavier.rundlaeufe === vorher);

/* --- 8. Die Diagnose bei haengendem Countdown ---------------------------- *
 * Klavier im Mikrofon blockiert die Ruhepruefung GARANTIERT: die adaptive
 * Stillegrenze lernt den Raumpegel nur aus Frames ohne Grundton, und Klavier
 * hat einen. Ohne den Verdacht in der Warnung muesste die Ursache hinterher
 * wieder aus Pegeln zurueckgerechnet werden. */
match.phase = 'MATCH';
match.setState('SILENCE_CHECK');
match.stateTimer = game.uhr.jetzt() - 9000;      // laenger als die Schwelle
game._ruheGemeldet = false;
audio.currentVolume = 0.2;                        // laut: Ruhe wird nie fertig
m = marke();
game.step();
const warnung = seit(m).filter(z => /WARNUNG/.test(z)).join(' / ');
console.log(`\nWarnung: ${warnung}`);
check('Die Warnung nennt den Klavier-Verdacht',
    /KLAVIER IM MIKROFON/.test(warnung), warnung);
check('Und den Griff, der ihn behebt', /Mix-Minus/.test(warnung));

/* GEGENPROBE: ohne Klavier-Modus steht der Verdacht NICHT dabei — sonst
   raetselt im Arcade-Betrieb jemand ueber ein Klavier, das es nicht gibt. */
config.mode = MODE.ARCADE;
match.setState('SILENCE_CHECK');
match.stateTimer = game.uhr.jetzt() - 9000;
game._ruheGemeldet = false;
m = marke();
game.step();
const ohne = seit(m).filter(z => /WARNUNG/.test(z)).join(' / ');
check('GEGENPROBE: im Arcade-Modus steht er nicht dabei',
    ohne.length > 0 && !/KLAVIER IM MIKROFON/.test(ohne), ohne);
config.mode = MODE.KLAVIER;

/* --- 9. Ausserhalb des Klavier-Modus passiert gar nichts ----------------- */
config.mode = MODE.ARCADE;
klavier.laeuft = false;
game._klavierLauf = -1;
game.klavierNachfuehren();
check('Ausserhalb des Klavier-Modus startet nichts', !klavier.laeuft);
config.mode = MODE.KLAVIER;

summary();

})();
