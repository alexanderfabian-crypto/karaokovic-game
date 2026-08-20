/* =============================================================================
 * TEST: Die Kalibrierung haelt einem Oktavfehler stand (Arena-Fassung)
 *
 * DER BUEHNENAUSFALL, aus dem Protokoll zurueckgerechnet:
 *
 *   gespeicherter Umfang     ~95–125 Hz   (knapp 5 Halbtoene, G2–H2)
 *   tatsaechlich gesungen    eine Oktave hoeher
 *   abgewiesene Aufschlaege  155/87, 311/155, 220/100 …  — durchweg 2:1
 *
 * Das Verhaeltnis 2:1 ist die Handschrift einer Oktavverwechslung der
 * Autokorrelation. Die Kalibrierung uebernahm eine EINZELNE Messung: ein
 * oktavfalscher Frame im Klickmoment legte den Umfang fuer die ganze Show
 * fest. Und `MIN_CALIBRATION_RATIO` liess mit 1.25 (knapp 4 Halbtoene) den
 * unbrauchbar engen Bereich anstandslos durch.
 *
 * Zwei Aenderungen, hier einzeln geprueft:
 *   1. Gespeichert wird der MEDIAN der letzten 600 ms, oktavverdaechtige
 *      Ausreisser fliegen vorher heraus (AudioEngine.calibrationPitch).
 *   2. Der Mindestumfang steht auf sieben Halbtoenen.
 * Dazu die Diagnose, die den Ausfall beim naechsten Mal sofort erklaert:
 *   3. Der benutzte Umfang steht im Protokoll (UMFANG-Zeile).
 *
 * Start: node Entwickler-Tests/test-kalibrierung-haerte.js
 * ========================================================================== */

'use strict';

const { loadGame, el, check, summary } = require('./dom-stub.js');
const game = loadGame('../app-arena.js');
const audio = game.audio;

/**
 * Eine Folge von Messungen in die Kalibrier-Historie legen.
 * @param {Array<[number, number]>} paare [Hz, Anzahl]
 */
function messungen(paare) {
    audio.vergissKalibriertoene();
    for (const [hz, anzahl] of paare) {
        for (let i = 0; i < anzahl; i++) audio.merkeKalibrierton(hz);
    }
}

/* --- 1. Der Median schlaegt den Oktav-Ausreisser ------------------------- */
/* Zehn saubere Messungen bei 220 Hz, sechs Oktavverwechslungen bei 110 —
   ein realistisches Mischungsverhaeltnis fuer eine tiefe Stimme, bei der die
   Autokorrelation gelegentlich abrutscht. */
messungen([[220, 10], [110, 6]]);

/* Und der ALLERLETZTE Messwert ist der falsche: genau die Lage, in der die
   Momentaufnahme den Oktavfehler uebernommen haette. */
audio.livePitch = 0;
audio.heldPitch = 110;
audio.heldPitchAt = game.uhr.jetzt();

const median = audio.calibrationPitch();
console.log(`Momentaufnahme: ${Math.round(audio.stablePitch)} Hz, `
    + `Median: ${Math.round(median)} Hz`);
check('Die Momentaufnahme haette den Oktavfehler uebernommen',
    Math.round(audio.stablePitch) === 110, `${audio.stablePitch}`);
check('Der Median nimmt den tatsaechlich gesungenen Ton',
    Math.round(median) === 220, `${Math.round(median)} Hz`);

/* --- 2. Ohne genug Messungen bleibt es bei der Momentaufnahme ------------ */
/* Der Knopf darf nicht stummer werden als vorher: wer nur kurz ansingt, muss
   trotzdem speichern koennen. */
messungen([[300, 3]]);
check('Unter fuenf Messungen faellt es auf stablePitch zurueck',
    audio.calibrationPitch() === audio.stablePitch,
    `${Math.round(audio.calibrationPitch())} Hz`);

/* --- 3. Das Zeitfenster wirkt ------------------------------------------- */
messungen([[220, 10]]);
check('Ein zu altes Fenster liefert nichts und faellt zurueck',
    audio.calibrationPitch(-1) === audio.stablePitch);

/* --- 4. Ein zu enger Umfang wird abgewiesen ----------------------------- */
const btnLow = el('btnLow');
const btnHigh = el('btnHigh');
const hinweis = el('calibHint');

game.beginCalibration(game.PLAYER.ANDREA);
messungen([[100, 10]]);
btnLow.click();
check('Der tiefe Ton wird gespeichert',
    Math.round(game.config.minFreq) === 100, `${game.config.minFreq}`);

/* 125 Hz sind 3.9 Halbtoene — exakt der Umfang aus dem Buehnenausfall. */
messungen([[125, 10]]);
btnHigh.click();
check('Der Umfang des Buehnenausfalls wird jetzt abgewiesen',
    Math.round(game.config.maxFreq) !== 125, `${game.config.maxFreq}`);
check('Und die Meldung sagt es in Halbtoenen, nicht in Hertz',
    /3\.9 Halbtöne/.test(hinweis.innerText), hinweis.innerText);
check('Der Knopf bleibt dabei offen', btnHigh.disabled === false);

/* 160 Hz sind 8.1 Halbtoene — knapp ueber der neuen Grenze. */
messungen([[160, 10]]);
btnHigh.click();
check('Sieben Halbtoene und mehr gehen durch',
    Math.round(game.config.maxFreq) === 160, `${game.config.maxFreq}`);

summary();
