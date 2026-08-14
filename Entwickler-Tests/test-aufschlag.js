/* =============================================================================
 * TEST: Wann löst der Aufschlag aus — und wann nicht?
 *
 * Entstanden aus der Bühnenmeldung "manchmal funktioniert der Aufschlag nicht".
 * Die Frage dahinter: muss man lauter singen, oder liegt es an etwas anderem?
 *
 * Der Aufschlag hängt an ZWEI Bedingungen, die nacheinander erfüllt sein
 * müssen, und nur die zweite hat mit Lautstärke zu tun:
 *
 *   1. SILENCE_CHECK — 3 Sekunden ununterbrochen unter `volumeGate` (0.020).
 *      Jeder Ton darüber setzt die Uhr auf null zurück, auch Raumgeräusch.
 *   2. SERVE_WAIT    — drei Frames über `serveVolume` (0.022).
 *
 * Der Test misst beide Bedingungen getrennt, damit im Zweifel klar ist,
 * welche von beiden gerade blockiert.
 *
 * Start: node Entwickler-Tests/test-aufschlag.js
 * ========================================================================== */

'use strict';

const { loadGame, check, summary } = require('./dom-stub.js');
const game = loadGame();
const { audio, match, physics } = game;

const SAMPLE_RATE = 48000;
const FFT_SIZE = 2048;
audio._corr = new Float64Array(FFT_SIZE + 1);

/** Magnitudengang des Vorfilters (Biquad-Tiefpass, Q = 1). */
function lowpassGain(f, f0, q = 1) {
    const r = f / f0;
    return 1 / Math.sqrt((1 - r * r) ** 2 + (r / q) ** 2);
}

/** Grenzfrequenz, die applyCalibratedFilter() aus dem Umfang ableitet. */
function cutoffFor(maxFreq) {
    return Math.max(320, Math.min(4000, maxFreq * 1.6));
}

/**
 * Ein Frame singen (oder schweigen) und einen Logikschritt ausführen.
 * @param {number} freq  Hz, 0 = Stille
 * @param {number} amp   Amplitude des Signals VOR dem Vorfilter
 * @param {number} cut   Grenzfrequenz des Vorfilters
 */
function frame(freq, amp, cut) {
    const buf = new Float32Array(FFT_SIZE);
    if (freq > 0) {
        const g = amp * lowpassGain(freq, cut);
        for (let i = 0; i < FFT_SIZE; i++) {
            buf[i] = g * Math.sin(2 * Math.PI * freq * i / SAMPLE_RATE);
        }
    }
    const r = audio.autoCorrelate(buf, SAMPLE_RATE);
    audio.updateSmoothedPitch(r.freq, r.volume);
    game.step();
    return r;
}

/** Sauber in SERVE_WAIT stellen, ohne drei Sekunden echt zu warten. */
function bereitZumAufschlag() {
    match.state = 'SILENCE_CHECK';
    physics.prepareServe();
    physics.serveCharge = 0;
    match.silenceTimerStart = Date.now() - 5000;   // Ruhe bereits erfüllt
    frame(0, 0, 500);                              // ein Frame Stille
}

/**
 * Wie viele Frames braucht ein Ton der Amplitude `amp`, bis aufgeschlagen ist?
 * @returns {number} Frames, oder -1 wenn innerhalb von 60 Frames nichts kam
 */
function framesBisAufschlag(freq, amp, cut) {
    bereitZumAufschlag();
    if (match.state !== 'SERVE_WAIT') return -2;   // gar nicht erst bereit
    for (let f = 1; f <= 60; f++) {
        frame(freq, amp, cut);
        if (match.state === 'PLAYING') return f;
    }
    return -1;
}

/** Kleinste Amplitude, die den Aufschlag auslöst (Auflösung 0.001). */
function schwelle(freq, cut) {
    for (let a = 0.005; a <= 0.30; a += 0.001) {
        if (framesBisAufschlag(freq, a, cut) > 0) return a;
    }
    return null;
}

/* --- 1. Grundfall: löst ein normaler Ton überhaupt aus? ------------------- */
const CUT = cutoffFor(330);          // Kalibrierung 110–330 Hz
game.setVoiceRange(game.PLAYER.ANDREA, 110, 330);

const normal = framesBisAufschlag(220, 0.05, CUT);
check('Ein deutlich gesungener Ton löst den Aufschlag aus',
    normal > 0, `nach ${normal} Frames`);
check('Und zwar nach genau SERVE_CHARGE_FRAMES Frames',
    normal === 3, `${normal} Frames`);

/* --- 2. Wie laut muss es sein, über den Stimmumfang verteilt? ------------- */
console.log('\nNötige Amplitude über den Stimmumfang (Kalibrierung 110–330 Hz,'
    + ` Vorfilter ${Math.round(CUT)} Hz):`);
const schwellen = [];
for (const f of [110, 150, 200, 250, 300, 330, 400, 500, 660, 880]) {
    const a = schwelle(f, CUT);
    schwellen.push({ f, a });
    const g = lowpassGain(f, CUT);
    console.log(`  ${String(f).padStart(4)} Hz   Amplitude ${a === null ? '  —  ' : a.toFixed(3)}`
        + `   Filterverstärkung ${g.toFixed(2)}`);
}

const imUmfang = schwellen.filter(s => s.f >= 110 && s.f <= 330 && s.a !== null);
const min = Math.min(...imUmfang.map(s => s.a));
const max = Math.max(...imUmfang.map(s => s.a));
check('Innerhalb des kalibrierten Umfangs ist die nötige Lautstärke gleichmäßig',
    max / min <= 1.3, `${min.toFixed(3)} bis ${max.toFixed(3)} (Faktor ${(max / min).toFixed(2)})`);

const hoch = schwellen.find(s => s.f === 880);
check('Weit ÜBER dem Umfang schluckt der Vorfilter den Aufschlag',
    hoch.a === null || hoch.a > max * 1.8,
    hoch.a === null ? 'gar nicht auslösbar' : `${hoch.a.toFixed(3)} statt ${max.toFixed(3)}`);

/* --- 3. Die eigentliche Falle: die Ruhe davor ----------------------------- *
 * Wer den Ton hält oder zu früh einsetzt, setzt die 3-Sekunden-Uhr immer
 * wieder zurück. Auf der Bühne sieht das aus wie "der Aufschlag geht nicht",
 * obwohl die Lautstärke längst reicht.
 * ------------------------------------------------------------------------- */
match.state = 'SILENCE_CHECK';
match.resetSilenceTimer();
physics.prepareServe();
for (let i = 0; i < 30; i++) frame(220, 0.05, CUT);   // durchgehend singen
check('Wer durchsingt, kommt nie in den Aufschlag-Zustand',
    match.state === 'SILENCE_CHECK', `Zustand ${match.state}`);

/* Ein Pegel knapp ÜBER volumeGate, aber UNTER serveVolume, ist der
   unangenehmste Fall: zu laut für die Ruhe, zu leise für den Aufschlag. */
const dazwischen = [];
for (let a = 0.005; a <= 0.06; a += 0.0005) {
    const buf = new Float32Array(FFT_SIZE);
    const g = a * lowpassGain(220, CUT);
    for (let i = 0; i < FFT_SIZE; i++) buf[i] = g * Math.sin(2 * Math.PI * 220 * i / SAMPLE_RATE);
    const rms = audio.autoCorrelate(buf, SAMPLE_RATE).volume;
    if (rms >= 0.020 && rms < 0.022) dazwischen.push(a);
}
console.log(`\nTotes Band (bricht die Ruhe, löst aber nicht aus):`
    + ` Amplitude ${dazwischen.length ? dazwischen[0].toFixed(4) : '—'}`
    + ` bis ${dazwischen.length ? dazwischen[dazwischen.length - 1].toFixed(4) : '—'}`);
check('Zwischen "bricht die Ruhe" und "löst aus" liegt nur ein schmales Band',
    dazwischen.length > 0, `${dazwischen.length} Stufen à 0.0005`);

/* --- 4. Raumgeräusch ------------------------------------------------------ */
const RAUSCHEN = 0.021;   // knapp über volumeGate
match.state = 'SILENCE_CHECK';
match.resetSilenceTimer();
for (let i = 0; i < 30; i++) {
    const buf = new Float32Array(FFT_SIZE);
    for (let k = 0; k < FFT_SIZE; k++) buf[k] = (Math.random() * 2 - 1) * RAUSCHEN * 1.7;
    audio.autoCorrelate(buf, SAMPLE_RATE);
    game.step();
}
check('Dauerhaftes Raumgeräusch über volumeGate blockiert den Aufschlag komplett',
    match.state === 'SILENCE_CHECK', `Zustand ${match.state}`);

summary();
