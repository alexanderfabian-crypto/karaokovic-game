/* =============================================================================
 * MESSUNG: Traegt die Web-Audio-Kette unter file:// ueberhaupt Ton?
 *
 *   node Entwickler-Tests/klavierweg.js
 *
 * KEIN Test der Suite, sondern ein Messskript wie rueckwand.py — es beweist
 * nichts ueber den Spielcode, es misst eine Eigenschaft des Browsers. Es steht
 * hier, weil an seinem Ergebnis die ganze Architektur der Klavierbegleitung
 * haengt und weil das Ergebnis nachpruefbar sein muss, wenn Chrome sich
 * aendert.
 *
 * DIE FRAGE: Naheliegend waere <audio> -> createMediaElementSource -> zwei
 * Gain-Wege -> Ausgang. Chrome laesst MediaElementAudioSourceNode aber Stille
 * liefern, wenn die Medienquelle die CORS-Pruefung nicht besteht — und eine
 * `file://`-Datei besteht sie gegenueber einer `file://`-Seite nicht.
 * createMediaElementSource trennt das Element dabei vom Ausgang. Der naive Weg
 * macht das Klavier auf dem Show-Rechner also VOLLSTAENDIG unhoerbar, ohne
 * Fehler, ohne Meldung: das Element meldet weiter "spielt".
 *
 * GEMESSEN AM 27.08.2026 (Chrome headless, Seite und MP3 im selben Ordner):
 *
 *   Betrieb                              MP3 laedt      Web-Audio   Element
 *   Doppelklick (file://, die Show)      readyState 4   RMS 0       spielt
 *   mit --allow-file-access-from-files   readyState 4   RMS 0.027   spielt
 *
 * Daraus folgt Klavier.probeGraph(): das Spiel MISST den Weg zur Laufzeit,
 * statt ihn an `location.protocol` zu raten — die Vermutung waere falsch,
 * sobald der Rechner mit dem Flag startet oder die Seite doch von einem Server
 * kommt.
 * ========================================================================== */

'use strict';

const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const WURZEL = path.join(__dirname, '..');
const PROBE = path.join(WURZEL, '_klavierweg_probe.html');
const PROFIL = path.join(require('os').tmpdir(), 'karaokovic-klavierweg');
const schlaf = (ms) => new Promise((r) => setTimeout(r, ms));

/** @returns {string|null} */
function chromePfad() {
    const kandidaten = [
        '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
        '/Applications/Chromium.app/Contents/MacOS/Chromium',
        '/usr/bin/google-chrome', '/usr/bin/chromium-browser',
        'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    ];
    return kandidaten.find((p) => fs.existsSync(p)) || null;
}

/** Das Stueck, das gemessen wird — aus dem Spielcode gelesen. */
function ersteStueck() {
    const text = fs.readFileSync(path.join(WURZEL, 'app-arena.js'), 'utf8');
    const b = text.match(/Klavier\.STUECKE\s*=\s*\[([^\]]*)\]/);
    const n = b && b[1].match(/'([^']+\.mp3)'/);
    return n ? n[1] : 'Karaokovic_Klavier_1.mp3';
}

/**
 * Die Probeseite legt sich NEBEN die MP3 — das ist die Anordnung der
 * Auslieferung, und nur sie misst das Richtige. Eine Seite in /tmp scheitert
 * schon am Laden und nicht erst am Ton.
 */
function schreibeProbe(datei) {
    fs.writeFileSync(PROBE, `<!doctype html><meta charset="utf-8"><script>
window.miss = async function (mitKette) {
  const el = new Audio(${JSON.stringify(datei)});
  const ctx = new AudioContext({ sampleRate: 48000 });
  if (ctx.state === 'suspended') await ctx.resume();
  const an = ctx.createAnalyser(); an.fftSize = 2048;
  const buf = new Float32Array(an.fftSize);
  if (mitKette) {
    ctx.createMediaElementSource(el).connect(an);
    an.connect(ctx.destination);
  }
  try { await el.play(); } catch (e) { return { fehler: String(e) }; }
  let max = 0;
  for (let i = 0; i < 60; i++) {
    await new Promise(r => setTimeout(r, 25));
    an.getFloatTimeDomainData(buf);
    let s = 0; for (let k = 0; k < buf.length; k++) s += buf[k] * buf[k];
    max = Math.max(max, Math.sqrt(s / buf.length));
  }
  el.pause();
  return { rms: +max.toFixed(5), zeit: +el.currentTime.toFixed(2),
           readyState: el.readyState, dauer: Math.round(el.duration) };
};
</script>`);
}

async function lauf(exe, flags, nummer) {
    const profil = `${PROFIL}-${nummer}`;
    try { fs.rmSync(profil, { recursive: true, force: true }); } catch (_) { /* egal */ }
    const port = 9500 + nummer;
    const p = spawn(exe, ['--headless=new', `--remote-debugging-port=${port}`,
        '--autoplay-policy=no-user-gesture-required', '--no-first-run',
        '--no-default-browser-check', `--user-data-dir=${profil}`,
        ...flags, `file://${PROBE}`], { stdio: 'ignore' });

    let ziele = null;
    for (let i = 0; i < 60; i++) {
        try {
            ziele = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
            if (ziele.some((z) => z.type === 'page')) break;
        } catch (_) { /* Debugport noch nicht offen */ }
        await schlaf(250);
    }
    if (!ziele) { p.kill('SIGKILL'); return { fehler: 'kein Debugport' }; }

    const ws = new WebSocket(ziele.find((z) => z.type === 'page').webSocketDebuggerUrl);
    await new Promise((r) => { ws.onopen = r; });
    let id = 0; const offen = new Map();
    ws.onmessage = (e) => {
        const m = JSON.parse(e.data);
        if (m.id && offen.has(m.id)) { offen.get(m.id)(m); offen.delete(m.id); }
    };
    const werte = async (ausdruck) => {
        const i = ++id;
        ws.send(JSON.stringify({ id: i, method: 'Runtime.evaluate',
            params: { expression: ausdruck, returnByValue: true, awaitPromise: true } }));
        const m = await new Promise((r) => offen.set(i, r));
        return m.result?.result?.value;
    };

    const mitKette = await werte('window.miss(true)');
    const ohneKette = await werte('window.miss(false)');
    try { ws.close(); } catch (_) { /* egal */ }
    p.kill('SIGKILL');
    try { fs.rmSync(profil, { recursive: true, force: true }); } catch (_) { /* egal */ }
    return { mitKette, ohneKette };
}

(async () => {
    const exe = chromePfad();
    if (!exe) { console.log('ÜBERSPRUNGEN  Kein Chrome gefunden.'); return; }
    const datei = ersteStueck();
    if (!fs.existsSync(path.join(WURZEL, datei))) {
        console.log(`ÜBERSPRUNGEN  ${datei} liegt nicht im Projekt.`);
        return;
    }
    schreibeProbe(datei);
    console.log(`Gemessen an ${datei}\n`);
    try {
        const faelle = [
            [[], 'OHNE Flag  (Doppelklick — so laeuft die Show)'],
            [['--allow-file-access-from-files'], 'MIT Flag   (Testumgebung)'],
        ];
        for (let i = 0; i < faelle.length; i++) {
            const [flags, name] = faelle[i];
            const r = await lauf(exe, flags, i);
            const k = r.mitKette || {}; const o = r.ohneKette || {};
            console.log(`${name}`);
            console.log(`   Web-Audio-Kette : RMS ${k.rms ?? '—'}  `
                + `(readyState ${k.readyState ?? '—'}, `
                + `Zeit ${k.zeit ?? '—'} s, Dauer ${k.dauer ?? '—'} s)`);
            console.log(`   Element direkt  : Zeit ${o.zeit ?? '—'} s `
                + `(laeuft — der Pegel ist von aussen nicht messbar)\n`);
        }
    } finally {
        try { fs.rmSync(PROBE, { force: true }); } catch (_) { /* egal */ }
    }
    console.log('Ist die erste Zeile RMS 0 und die zweite groesser, gilt der '
        + 'Befund von ARENA-23:\nunter file:// ist die Kette stumm, und das '
        + 'Spiel muss den Weg messen statt ihn zu raten.');
})();
