/* =============================================================================
 * TEST: Onboarding Schritt 2 (Stimm-Profiler)
 *
 * REGRESSIONSSCHUTZ. Die Knöpfe lasen früher `livePitch` — den Ton des
 * AKTUELLEN Frames. Auf der Bühne singt man aber erst und greift DANN zum
 * Knopf; in diesem Moment ist livePitch längst wieder 0. Der Klick lief ins
 * Leere, ohne jede Rückmeldung, und man kam nie zu "MATCH STARTEN".
 *
 * Der Test spielt genau diesen Ablauf durch: singen -> aufhören -> klicken.
 *
 * Start: node Entwickler-Tests/test-kalibrierung.js
 * ========================================================================== */

'use strict';

const { loadGame, el, check, summary } = require('./dom-stub.js');
const game = loadGame();
const audio = game.audio;

const SAMPLE_RATE = 48000;
const FFT_SIZE = 2048;
const FILTER_HZ = 900;   // CONFIG.filterCalibrationHz
audio._corr = new Float64Array(FFT_SIZE + 1);

function lowpassGain(f, f0, q = 1) {
    const r = f / f0;
    return 1 / Math.sqrt((1 - r * r) ** 2 + (r / q) ** 2);
}

/** Einen Ton für ein Frame singen. */
function sing(f) {
    const amp = 0.14 * lowpassGain(f, FILTER_HZ);
    const buf = new Float32Array(FFT_SIZE);
    for (let i = 0; i < FFT_SIZE; i++) buf[i] = amp * Math.sin(2 * Math.PI * f * i / SAMPLE_RATE);
    return audio.autoCorrelate(buf, SAMPLE_RATE);
}

/** Ein paar Frames Stille — die Sängerin holt Luft und greift zum Knopf. */
function pause(frames = 3) {
    for (let i = 0; i < frames; i++) audio.autoCorrelate(new Float32Array(FFT_SIZE), SAMPLE_RATE);
}

const btnLow = el('btnLow');
const btnHigh = el('btnHigh');
const btnStart = el('btnStartGame');
const anzeige = el('livePitch');

/* --- Schritt 1: tiefer Ton, dann loslassen, dann klicken ------------------ */
sing(120);
pause();
check('Nach dem Singen ist livePitch erwartungsgemäß 0', audio.livePitch === 0);
check('stablePitch hält den Ton fest', Math.round(audio.stablePitch) === 120,
    `${audio.stablePitch.toFixed(1)} Hz`);

btnLow.click();
check('Tiefer Ton wird trotz Pause gespeichert', Math.round(audio.stablePitch) === 120,
    anzeige.innerText);
check('"Hohen Ton speichern" ist freigeschaltet', btnHigh.disabled === false);

/* --- Schritt 2: hoher Ton über der alten 500-Hz-Grenze -------------------- */
sing(560);
pause();
btnHigh.click();
check('Hoher Ton (560 Hz) wird angenommen', btnStart.style.display === 'block',
    anzeige.innerText);

/* --- Gegenprobe: Klick ohne Ton sagt jetzt, was fehlt --------------------- */
audio.heldPitchAt = Date.now() - 999999;   // Haltefenster abgelaufen
audio.livePitch = 0;
btnHigh.click();
check('Klick ohne Ton erklärt sich', /Kein Ton erkannt/.test(anzeige.innerText),
    anzeige.innerText);

/* --- Gegenprobe: zu kleiner Stimmumfang wird abgelehnt -------------------- */
sing(130);
btnHigh.click();
check('Zu enger Stimmumfang wird abgelehnt', /zu nah/.test(anzeige.innerText),
    anzeige.innerText);

/* --- Vorfilter folgt der Kalibrierung ------------------------------------- */
sing(560);
btnHigh.click();
audio.biquadFilter = { frequency: { value: FILTER_HZ }, Q: { value: 1 } };
audio.applyCalibratedFilter();
const cutoff = audio.biquadFilter.frequency.value;
check('Vorfilter lässt den höchsten Kalibrierton durch', cutoff > 560,
    `${Math.round(cutoff)} Hz`);

/* Klassische Einstellung: 100–200 Hz muss den alten Bühnenwert behalten. */
audio.heldPitch = 180; audio.heldPitchAt = Date.now(); audio.livePitch = 0;
btnHigh.click();
audio.applyCalibratedFilter();
check('Tiefe Kalibrierung behält den bisherigen 320-Hz-Filter',
    audio.biquadFilter.frequency.value === 320,
    `${audio.biquadFilter.frequency.value} Hz`);

summary();
