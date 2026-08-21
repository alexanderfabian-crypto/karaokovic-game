/* =============================================================================
 * TEST: Das Protokoll ueberlebt einen langen Soundcheck (Arena-Fassung)
 *
 * BEFUND: Drei Stunden unruhiger Soundcheck mal bis zu zehn RUHE-Zeilen je
 * Sekunde — der 2000er-Ring haelt dann nur die letzten gut drei Minuten. Weg
 * sind ausgerechnet die Zeilen, fuer die die Startdiagnose gebaut wurde:
 * AUDIO (welcher Eingang?), UMFANG (welcher Stimmumfang?), DISPLAY (welcher
 * Takt?), MODUS. Kein Speicherproblem — der Ring ist gedeckelt — sondern ein
 * Diagnoseproblem: nach der Show steht genau das nicht mehr da, was die Show
 * erklaeren wuerde.
 *
 * Zwei Gegenmassnahmen, hier einzeln geprueft:
 *   1. Die ersten KOPF Zeilen ueberleben jede Rotation.
 *   2. Eine anhaltende Stoerung eskaliert zur Sammelzeile, statt zu fluten.
 *
 * Start: node Entwickler-Tests/test-protokoll.js
 * ========================================================================== */

'use strict';

const { loadGame, check, summary } = require('./dom-stub.js');
const game = loadGame('../app-arena.js');
const P = game.Protokoll;
const match = game.match;

/* --- 1. Der Boot-Block ueberlebt die Rotation ---------------------------- */
/* Der Boot-Block wird hier selbst gesetzt statt aus dem Start gelesen: in
   Node laedt das Spiel ohne Mikrofon und ohne Bilder, es gibt also kaum
   echte Startzeilen. Geprueft wird der Mechanismus, nicht der Startablauf. */
P.zeilen.length = 0;
for (let i = 0; i < 5; i++) P.schreib('AUDIO', `startzeile ${i}`);
const ersteZeile = P.zeilen[0];

for (let i = 0; i < P.MAX + 100; i++) P.schreib('TEST', `fuellzeile ${i}`);

check('Der Ring bleibt gedeckelt', P.zeilen.length === P.MAX,
    `${P.zeilen.length} Zeilen`);
check('Die erste Zeile ist immer noch die erste',
    P.zeilen[0] === ersteZeile, P.zeilen[0]);
check('Der ganze Startblock steht noch',
    P.zeilen.slice(0, 5).every((z) => /startzeile/.test(z)),
    P.zeilen.slice(0, 2).join(' | '));
check('Der geschuetzte Kopf reicht genau bis KOPF',
    P.zeilen.slice(0, P.KOPF).every((z) => /startzeile|fuellzeile/.test(z))
    && /fuellzeile/.test(P.zeilen[P.KOPF]), P.zeilen[P.KOPF]);
check('Dahinter wurde tatsaechlich rotiert',
    !P.zeilen.some((z) => / fuellzeile 100$/.test(z)),
    'fuellzeile 100 sollte herausrotiert sein');
check('Und die aelteste Zeile ist trotzdem noch da',
    P.zeilen.some((z) => / fuellzeile 0$/.test(z)));

/* --- 2. RUHE eskaliert, statt zu fluten ---------------------------------- */
/* Der Raum ist dauerhaft zu laut: jeder step() setzt die Ruhe-Uhr zurueck. */
/* Ab hier soll der Ring wieder WACHSEN: solange er voll ist, bleibt
   `zeilen.length` bei MAX stehen, und ein Helfer, der ab dieser Laenge
   schneidet, liefert immer die leere Menge. (Genau daran ist dieser Test
   zuerst gescheitert.) */
P.zeilen.length = 0;

game.audio.currentVolume = 0.5;
game.input.restartServe();
game._ruheResets = 0;
/* Zurueckdatiert statt auf 0: in Node ist `Uhr.jetzt()` wenige
   Millisekunden nach dem Prozessstart, gegen 0 greift die 100-ms-Drosselung
   und es wuerde gar nichts protokolliert. */
game._letzterRuheLog = game.uhr.jetzt() - 1000;

const zeilenAb = () => P.zeilen.length;
const seit = (n) => P.zeilen.slice(n).join('\n');

let ab = zeilenAb();
game.step();
check('Die erste Stoerung wird einzeln gemeldet',
    /RUHE.*zurueckgesetzt/.test(seit(ab)), seit(ab));

/* Weit ueber die Einzelgrenze hinaus stoeren. Die Drosselung auf zehn Zeilen
   je Sekunde greift dabei ohnehin — gezaehlt wird der Ruecksetzer, nicht die
   Zeile. */
for (let i = 0; i < Game_RUHE_EINZELN_BIS() + 10; i++) game.step();
check('Die Ruecksetzer werden gezaehlt',
    game._ruheResets > Game_RUHE_EINZELN_BIS(), `${game._ruheResets}`);

/* Die Sammelzeile kommt im Zehn-Sekunden-Takt. Statt zehn Sekunden zu warten
   wird der letzte Zeitstempel zurueckdatiert — dieselbe Lage. */
ab = zeilenAb();
game._letzterRuheLog = game.uhr.jetzt() - Game_RUHE_SAMMEL_MS() - 1;
game.step();
check('Danach kommt eine Sammelzeile statt einer Einzelmeldung',
    /weiterhin gestoert/.test(seit(ab)), seit(ab));
check('Sie nennt die Zahl der Ruecksetzer',
    /\d+ Ruecksetzer in Folge/.test(seit(ab)));

/* --- 3. Nach erreichter Ruhe wieder Einzelmeldungen ---------------------- */
game.audio.currentVolume = 0;
match.silenceTimerStart = game.uhr.jetzt() - game.TIMING.SILENCE_MS - 10;
game.step();
check('Bei Ruhe geht es weiter zum Aufschlag',
    match.state === 'SERVE_WAIT', match.state);
check('Und der Zaehler beginnt von vorn', game._ruheResets === 0,
    `${game._ruheResets}`);

game.audio.currentVolume = 0.5;
game.input.restartServe();
game._letzterRuheLog = game.uhr.jetzt() - 1000;
ab = zeilenAb();
game.step();
check('Die naechste Stoerung wird wieder einzeln gemeldet',
    /zurueckgesetzt/.test(seit(ab)) && !/weiterhin gestoert/.test(seit(ab)),
    seit(ab));

/* Die beiden Konstanten liegen an der Game-KLASSE, nicht an der Instanz. */
function Game_RUHE_EINZELN_BIS() { return game.constructor.RUHE_EINZELN_BIS; }
function Game_RUHE_SAMMEL_MS() { return game.constructor.RUHE_SAMMEL_MS; }

summary();
