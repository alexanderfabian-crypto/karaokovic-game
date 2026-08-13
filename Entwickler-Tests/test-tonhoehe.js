/* =============================================================================
 * TEST: Welche Töne erkennt autoCorrelate()?
 *
 * REGRESSIONSSCHUTZ. Bis V37 stand in autoCorrelate() eine feste Obergrenze
 * von 500 Hz. Zusammen mit dem fest auf 320 Hz stehenden Vorfilter war damit
 * ein hoher Kalibrierton einer Frauenstimme (oft 450–650 Hz) unsichtbar:
 * livePitch blieb 0, der Knopf "Hohen Ton speichern" reagierte nicht, das
 * Onboarding war blockiert. Bricht jemand die Obergrenze wieder auf 500 oder
 * verengt den Kalibrierfilter, schlägt dieser Test an.
 *
 * Der Vorfilter ist ein Web-Audio-Knoten und existiert in Node nicht — seine
 * Dämpfung wird deshalb rechnerisch nachgebildet und auf das Testsignal
 * angewendet. Formel: Standard-Biquad-Tiefpass 2. Ordnung.
 *
 * Start: node Entwickler-Tests/test-tonhoehe.js
 * ========================================================================== */

'use strict';

const { loadGame, check, summary } = require('./dom-stub.js');
const game = loadGame();
const audio = game.audio;

/* Ohne init() gibt es keinen Analyser — Korrelationspuffer von Hand stellen. */
const SAMPLE_RATE = 48000;
const FFT_SIZE = 2048;
audio._corr = new Float64Array(FFT_SIZE + 1);

/** Grenzfrequenz des Vorfilters während der Kalibrierung (CONFIG). */
const FILTER_HZ = 900;

/**
 * Amplitudengang eines Tiefpasses 2. Ordnung.
 * @param   {number} f  Frequenz in Hz
 * @param   {number} f0 Grenzfrequenz in Hz
 * @param   {number} [q]
 * @returns {number} Faktor 0..~1.2
 */
function lowpassGain(f, f0, q = 1) {
    const r = f / f0;
    return 1 / Math.sqrt((1 - r * r) ** 2 + (r / q) ** 2);
}

/**
 * Einen gesungenen Ton nachbauen und durch die Erkennung schicken.
 * @param   {number} f       Grundfrequenz in Hz
 * @param   {number} filterHz Grenzfrequenz des Vorfilters
 * @returns {{freq:number, volume:number}}
 */
function sing(f, filterHz) {
    const amp = 0.14 * lowpassGain(f, filterHz);   // gemütliche Singlautstärke
    const buf = new Float32Array(FFT_SIZE);
    for (let i = 0; i < FFT_SIZE; i++) {
        buf[i] = amp * Math.sin(2 * Math.PI * f * i / SAMPLE_RATE);
    }
    return audio.autoCorrelate(buf, SAMPLE_RATE);
}

console.log(`Vorfilter bei der Kalibrierung: ${FILTER_HZ} Hz\n`);
console.log(' Ton     RMS n. Filter   erkannt        Abweichung');

/* Von tief (Männerstimme) bis hoch (Kopfstimme). */
const TOENE = [90, 110, 150, 200, 260, 320, 400, 450, 500, 560, 660, 780];
let alleErkannt = true;
let groessterFehler = 0;

for (const f of TOENE) {
    const res = sing(f, FILTER_HZ);
    const erkannt = res.freq !== -1;
    const fehler = erkannt ? Math.abs(res.freq - f) / f * 100 : NaN;
    if (!erkannt) alleErkannt = false;
    else groessterFehler = Math.max(groessterFehler, fehler);

    console.log(`${String(f).padStart(4)} Hz   ${res.volume.toFixed(4).padStart(8)}      `
        + `${(erkannt ? res.freq.toFixed(1) + ' Hz' : 'NICHTS').padEnd(12)}   `
        + `${erkannt ? fehler.toFixed(1) + ' %' : '—'}`);
}

console.log('');
check('Alle Töne von 90 bis 780 Hz werden erkannt', alleErkannt);
check('Tonhöhe stimmt auf besser als 2 %', groessterFehler < 2,
    `größte Abweichung ${groessterFehler.toFixed(1)} %`);

/* --- Die beiden Töne, an denen das Onboarding früher hängenblieb ---------- */
check('Hoher Kalibrierton 560 Hz wird erkannt', sing(560, FILTER_HZ).freq > 0);
check('Hoher Kalibrierton 660 Hz wird erkannt', sing(660, FILTER_HZ).freq > 0);

/* --- Gegenprobe: Unsinn wird weiterhin verworfen -------------------------- */
check('Stille liefert keinen Ton', sing(200, FILTER_HZ) && audio.autoCorrelate(
    new Float32Array(FFT_SIZE), SAMPLE_RATE).freq === -1);
check('Ton weit über dem Stimmumfang (2000 Hz) wird verworfen',
    sing(2000, FILTER_HZ).freq === -1);

summary();
