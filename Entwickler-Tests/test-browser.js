/* =============================================================================
 * TEST: Start im echten Browser (Chrome headless)
 *
 * Die übrigen Tests prüfen die Logik in Node gegen einen DOM-Stub. Sie können
 * naturgemäß NICHT sehen, ob das Spiel im Browser überhaupt hochkommt: ob die
 * Bilder von Platte geladen werden, ob `Renderer.hasCourtBackdrop()` umschaltet,
 * ob eine Exception aus einer Zeichenroutine fliegt, ob Impact vorhanden ist.
 * Genau das war der blinde Fleck vor V38 — der gesamte Renderpfad lief bis
 * dahin kein einziges Mal.
 *
 * Dieser Test startet Chrome headless und spricht das DevTools-Protokoll direkt
 * über Nodes eingebautes `WebSocket` an. BEWUSST ohne Puppeteer/Playwright:
 * das Projekt hat keine Abhängigkeiten und soll keine bekommen. Voraussetzung
 * ist Node >= 22 (globales `fetch` und `WebSocket`).
 *
 * Ist kein Chrome installiert, wird der Test ÜBERSPRUNGEN und meldet Erfolg —
 * er soll die Suite auf einer fremden Maschine nicht rot färben.
 *
 * Start: node Entwickler-Tests/test-browser.js
 * ========================================================================== */

'use strict';

const { check, summary } = require('./dom-stub.js');
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const PORT = 9411;
const SEITE = 'file://' + path.join(__dirname, '..', 'index.html');
const PROFIL = path.join(os.tmpdir(), 'karaokovic-testprofil');

const schlafe = (ms) => new Promise((r) => setTimeout(r, ms));

/** @returns {string|null} Pfad zu Chrome, oder null wenn keiner gefunden wurde. */
function chromePfad() {
    const kandidaten = [
        '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
        '/Applications/Chromium.app/Contents/MacOS/Chromium',
        '/usr/bin/google-chrome',
        '/usr/bin/chromium',
        '/usr/bin/chromium-browser',
        'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    ];
    return kandidaten.find((p) => fs.existsSync(p)) || null;
}

/* -------------------------------------------------------------------------
 * Minimaler CDP-Client
 * ---------------------------------------------------------------------- */

class Browser {
    constructor() {
        this.naechsteId = 0;
        this.offen = new Map();
        this.ws = null;
        this.prozess = null;
        /** @type {string[]} Alles, was die Seite an Fehlern von sich gibt. */
        this.fehler = [];
    }

    async start(exe) {
        this.prozess = spawn(exe, [
            '--headless=new',
            `--remote-debugging-port=${PORT}`,
            '--window-size=1600,900',
            /* Synthetisches Mikrofon, Berechtigung automatisch erteilt —
               sonst bleibt das Onboarding in Schritt 1 stehen. */
            '--use-fake-device-for-media-stream',
            '--use-fake-ui-for-media-stream',
            '--autoplay-policy=no-user-gesture-required',
            '--allow-file-access-from-files',
            '--no-first-run', '--no-default-browser-check',
            `--user-data-dir=${PROFIL}`,
            SEITE,
        ], { stdio: 'ignore' });

        let ziele = null;
        for (let i = 0; i < 80; i++) {
            try {
                const res = await fetch(`http://127.0.0.1:${PORT}/json/list`);
                ziele = await res.json();
                if (ziele.some((z) => z.type === 'page')) break;
            } catch (_) { /* Debugport noch nicht offen */ }
            await schlafe(250);
        }
        if (!ziele || !ziele.some((z) => z.type === 'page')) {
            throw new Error('Chrome-Debugport nicht erreichbar');
        }

        this.ws = new WebSocket(ziele.find((z) => z.type === 'page').webSocketDebuggerUrl);
        await new Promise((res, rej) => { this.ws.onopen = res; this.ws.onerror = rej; });
        this.ws.onmessage = (e) => this._empfang(JSON.parse(e.data));

        await this.sende('Runtime.enable');
        await this.sende('Page.enable');
    }

    _empfang(m) {
        if (m.id && this.offen.has(m.id)) {
            const { res, rej } = this.offen.get(m.id);
            this.offen.delete(m.id);
            if (m.error) rej(new Error(JSON.stringify(m.error))); else res(m.result);
            return;
        }
        if (m.method === 'Runtime.exceptionThrown') {
            const d = m.params.exceptionDetails;
            this.fehler.push(d.exception?.description || d.text);
        } else if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') {
            this.fehler.push('console.error: ' + m.params.args
                .map((a) => a.value ?? a.description ?? a.type).join(' '));
        }
    }

    sende(method, params = {}) {
        const id = ++this.naechsteId;
        this.ws.send(JSON.stringify({ id, method, params }));
        return new Promise((res, rej) => this.offen.set(id, { res, rej }));
    }

    /** JS in der Seite auswerten. Wirft, wenn die Seite eine Exception meldet. */
    async werteAus(ausdruck) {
        const r = await this.sende('Runtime.evaluate', {
            expression: ausdruck, returnByValue: true, awaitPromise: true,
        });
        if (r.exceptionDetails) {
            throw new Error(r.exceptionDetails.exception?.description
                || r.exceptionDetails.text);
        }
        return r.result.value;
    }

    stopp() {
        try { this.ws && this.ws.close(); } catch (_) { /* egal */ }
        try { this.prozess && this.prozess.kill(); } catch (_) { /* egal */ }
    }
}

/* -------------------------------------------------------------------------
 * Der eigentliche Test
 * ---------------------------------------------------------------------- */

(async () => {
    const exe = chromePfad();
    if (!exe) {
        console.log('ÜBERSPRUNGEN  Kein Chrome gefunden — Browsertest entfällt.');
        console.log('\nAlles in Ordnung.');
        return;
    }
    if (typeof WebSocket === 'undefined') {
        console.log(`ÜBERSPRUNGEN  Node ${process.version} hat kein globales WebSocket (>= 22 nötig).`);
        console.log('\nAlles in Ordnung.');
        return;
    }

    const b = new Browser();
    try {
        await b.start(exe);
        await schlafe(3000);   // Bilder von Platte laden lassen

        /* --- 1. Kommt das Spiel überhaupt hoch? ------------------------- */
        const boot = await b.werteAus(`({
            typ: typeof window.KARAOKOVIC,
            canvas: !!document.getElementById('gameCanvas'),
        })`);
        check('Spiel bootet und meldet sich an window.KARAOKOVIC',
            boot.typ === 'object' && boot.canvas);

        /* --- 2. Assets ------------------------------------------------- */
        const assets = await b.werteAus(`(() => {
            const K = window.KARAOKOVIC;
            const alle = Object.keys(K.assets.images);
            return { fehlend: K.assets.failed,
                     geladen: alle.filter(k => K.assets.isReady(k)).length,
                     gesamt: alle.length };
        })()`);
        check('Kein Asset ist fehlgeschlagen', assets.fehlend.length === 0,
            assets.fehlend.join(', ') || 'assets.failed ist leer');
        check('Alle Bilder sind geladen', assets.geladen === assets.gesamt,
            `${assets.geladen}/${assets.gesamt}`);

        /* --- 3. Hintergrundbild schaltet den Zeichenpfad um ------------- */
        const backdrop = await b.werteAus(
            'window.KARAOKOVIC.renderer.hasCourtBackdrop()');
        check('hasCourtBackdrop() ist true (Platz kommt aus dem Bild)', backdrop === true);

        /* --- 4. Impact ------------------------------------------------- */
        const schrift = await b.werteAus(`(() => {
            const c = document.createElement('canvas').getContext('2d');
            const breite = (f) => { c.font = '40px ' + f; return c.measureText('EINSPIELEN').width; };
            const imp = breite('Impact');
            return { imp, fallback: breite('sans-serif'), mono: breite('monospace') };
        })()`);
        check('Impact ist vorhanden (sonst fällt der Look auf sans-serif zurück)',
            Math.abs(schrift.imp - schrift.fallback) > 0.5
            || Math.abs(schrift.imp - schrift.mono) > 0.5,
            `Impact ${schrift.imp.toFixed(1)} px vs. sans-serif ${schrift.fallback.toFixed(1)} px`);

        /* --- 5. Laufrichtung ------------------------------------------- *
         * REGRESSIONSSCHUTZ für die Meldung "läuft in die falsche Richtung".
         * Bei gleichmäßig steigender Stimme darf die Figur NIE nach links
         * gehen (und umgekehrt). Wichtig: die Figur startet dort, wo der
         * erste Ton sie hinstellt — sonst misst man ihren legitimen Weg zur
         * Startposition als Fehler.                                        */
        const richtung = await b.werteAus(`(() => {
            const K = window.KARAOKOVIC, P = K.physics, A = K.audio;
            const lauf = (freqs) => {
                A.resetSmoothing();
                A.updateSmoothedPitch(freqs[0], 0.05);
                P.targetX = P.freqToQuantizedX(A.smoothedPitch);
                P.haltAt(P.targetX);
                const xs = [];
                for (const f of freqs) {
                    A.updateSmoothedPitch(f, 0.05);
                    P.targetX = P.freqToQuantizedX(A.smoothedPitch);
                    P.glideToTarget();
                    xs.push(P.currentX);
                }
                return xs;
            };
            const rampe = (a, b, n) =>
                Array.from({length: n}, (_, i) => a * Math.pow(b / a, i / (n - 1)));
            const zaehle = (xs, richtung) => {
                let n = 0;
                for (let i = 1; i < xs.length; i++) {
                    const d = xs[i] - xs[i-1];
                    if (richtung > 0 ? d < -0.01 : d > 0.01) n++;
                }
                return n;
            };
            const auf = lauf(rampe(100, 300, 60));
            const ab  = lauf(rampe(300, 100, 60));

            /* Richtungswechsel: wie weit läuft sie noch in die alte Richtung? */
            const N = 40;
            const w = lauf([...rampe(100, 280, N), ...Array(60).fill(120)]);
            let fehlweg = 0;
            for (let i = N; i < w.length; i++) {
                const d = w[i] - w[i-1];
                if (d > 0.01) fehlweg += d; else break;
            }
            return { aufFehler: zaehle(auf, +1), abFehler: zaehle(ab, -1),
                     fehlweg: +fehlweg.toFixed(1) };
        })()`);
        check('Steigende Stimme bewegt die Figur ausschließlich nach rechts',
            richtung.aufFehler === 0, `${richtung.aufFehler} Fehlframes von 59`);
        check('Fallende Stimme bewegt die Figur ausschließlich nach links',
            richtung.abFehler === 0, `${richtung.abFehler} Fehlframes von 59`);
        check('Fehlweg nach einem Richtungswechsel bleibt unter 30 px',
            richtung.fehlweg < 30, `${richtung.fehlweg} px (war 50 px bei pitchSmooth 0.15)`);

        /* --- 6. Onboarding bis ins Einspielen --------------------------- */
        const einspielen = await b.werteAus(`(async () => {
            const K = window.KARAOKOVIC;
            /* Der Haltespeicher wird direkt gefüllt: das Fake-Mikrofon von
               Chrome liefert nur einen festen Ton, wir brauchen aber zwei
               verschiedene für tief und hoch. */
            const singe = (hz) => { K.audio.livePitch = 0; K.audio.heldPitch = hz;
                                    K.audio.heldPitchAt = Date.now(); };
            document.getElementById('btnMic').click();
            await new Promise(r => setTimeout(r, 1500));
            singe(110); document.getElementById('btnLow').click();
            singe(330); document.getElementById('btnHigh').click();
            await new Promise(r => setTimeout(r, 200));
            document.getElementById('btnStartGame').click();
            await new Promise(r => setTimeout(r, 1200));

            const t = []; let vorher = performance.now();
            await new Promise(fertig => {
                let n = 0;
                const takt = () => {
                    const jetzt = performance.now();
                    t.push(jetzt - vorher); vorher = jetzt;
                    if (++n < 180) requestAnimationFrame(takt); else fertig();
                };
                requestAnimationFrame(takt);
            });
            t.sort((a, b) => a - b);
            return { phase: String(K.match.phase),
                     onboarding: document.getElementById('onboarding').style.display,
                     medianMs: +t[Math.floor(t.length / 2)].toFixed(2) };
        })()`);
        check('Onboarding läuft bis ins Einspielen durch',
            einspielen.phase === 'WARMUP', `phase = ${einspielen.phase}`);
        check('Onboarding ist danach ausgeblendet', einspielen.onboarding === 'none');
        check('Bildrate im Einspielen bleibt unter 20 ms pro Frame',
            einspielen.medianMs < 20, `${einspielen.medianMs} ms Median`);

        /* --- 7. Nichts ist unterwegs geflogen --------------------------- */
        check('Keine Exception und kein console.error während des Laufs',
            b.fehler.length === 0, b.fehler.join(' | ') || 'sauber');

    } catch (err) {
        check('Browsertest läuft ohne Abbruch durch', false, err.message);
    } finally {
        b.stopp();
    }

    summary();
})();
