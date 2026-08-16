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
const net = require('net');
const os = require('os');
const path = require('path');

/* Welche Seite geprüft wird, entscheidet das erste Argument.
 *
 *   node Entwickler-Tests/test-browser.js              -> index.html  (V41)
 *   node Entwickler-Tests/test-browser.js arena.html   -> arena.html  (ARENA-1)
 *
 * Bis ARENA-1 stand hier fest index.html. Die Arena-Fassung hatte damit kein
 * automatisches Netz — ausgerechnet die Fassung, an der weitergebaut wird. */
const DATEI = process.argv[2] || 'index.html';
const SEITE = 'file://' + path.join(__dirname, '..', DATEI);

/* Port UND Profil pro Lauf eindeutig.
 *
 * Vorher stand hier der feste Port 9411 und ein fester Profilpfad. Beides ging
 * schief, sobald ein früherer Lauf abgebrochen wurde und sein Chrome
 * weiterlief: der neue Lauf fand den Debugport besetzt vor, `fetch` landete
 * beim ALTEN Browser, und der Test steuerte eine Zombie-Seite, die nie
 * antwortete — er hing dann ohne Zeitlimit. Auf dieser Maschine hatten sich so
 * 17 Waisen angesammelt, die älteste über zwei Tage alt.
 *
 * Ein vom Betriebssystem vergebener freier Port kann per Definition nicht dem
 * Browser eines anderen Laufs gehören. */
const PROFIL = path.join(os.tmpdir(), `karaokovic-testprofil-${process.pid}`);

const schlafe = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Einen freien TCP-Port vom Betriebssystem erfragen.
 * @returns {Promise<number>}
 */
function freierPort() {
    return new Promise((res, rej) => {
        const srv = net.createServer();
        srv.on('error', rej);
        srv.listen(0, '127.0.0.1', () => {
            const p = srv.address().port;
            srv.close(() => res(p));
        });
    });
}

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
        const port = await freierPort();
        this.prozess = spawn(exe, [
            '--headless=new',
            `--remote-debugging-port=${port}`,
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
                const res = await fetch(`http://127.0.0.1:${port}/json/list`);
                ziele = await res.json();
                if (ziele.some((z) => z.type === 'page')) break;
            } catch (_) { /* Debugport noch nicht offen */ }
            await schlafe(250);
        }
        if (!ziele || !ziele.some((z) => z.type === 'page')) {
            throw new Error('Chrome-Debugport nicht erreichbar');
        }

        /* Zeitlimit auch hier: ohne das wartet der Test unbegrenzt, wenn der
           Browser den Aufbau annimmt und dann verstummt. Genau so entstand der
           Hänger, der die Suite blockierte. */
        this.ws = new WebSocket(ziele.find((z) => z.type === 'page').webSocketDebuggerUrl);
        await new Promise((res, rej) => {
            const uhr = setTimeout(() => rej(new Error('WebSocket zum Browser kam nicht zustande')), 15000);
            this.ws.onopen = () => { clearTimeout(uhr); res(); };
            this.ws.onerror = (e) => { clearTimeout(uhr); rej(new Error(`WebSocket-Fehler: ${e.message || e.type}`)); };
        });
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

    /**
     * Browser beenden und das Profil wegräumen.
     *
     * `kill()` schickt nur SIGTERM, und das nimmt Chrome nicht zuverlässig an —
     * genau daran sind die Waisen entstanden. Der Nachschlag mit SIGKILL folgt
     * deshalb sofort und nicht nach einer Schonfrist: ein Timer würde nicht
     * mehr feuern, wenn Node vorher aussteigt, und ein Testprofil hat nichts zu
     * sichern.
     *
     * Muss mehrfach aufrufbar sein — der Aufruf kommt auch aus den
     * Signalhandlern.
     */
    stopp() {
        try { this.ws && this.ws.close(); } catch (_) { /* egal */ }
        const p = this.prozess;
        this.prozess = null;
        if (p) {
            try { p.kill(); } catch (_) { /* egal */ }
            try { p.kill('SIGKILL'); } catch (_) { /* egal */ }
        }
        try { fs.rmSync(PROFIL, { recursive: true, force: true }); } catch (_) { /* egal */ }
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

    console.log(`Geprüfte Seite: ${DATEI}`);

    const b = new Browser();

    /* Aufräumen auch dann, wenn der Test NICHT normal endet.
     *
     * Das `finally` unten greift nur beim geordneten Durchlauf. Wird der Lauf
     * abgebrochen — Strg+C, Zeitlimit eines Runners, `kill` von außen — lief
     * es nie, und der Browser blieb stehen. Auf Port und Profil wartete er
     * dann auf den nächsten Lauf und brachte ihn zum Hängen. */
    let beendet = false;
    const aufraeumen = () => { if (!beendet) { beendet = true; b.stopp(); } };
    process.on('exit', aufraeumen);
    for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP']) {
        process.on(signal, () => { aufraeumen(); process.exit(130); });
    }

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

        /* --- 6. Onboarding bis ins Einspielen ---------------------------- *
         * BEWUSST über die echten Knöpfe in ihrer echten Reihenfolge:
         * Modus -> Mikrofon -> tief -> hoch -> Bereich bestätigen -> Start.
         * `.click()` feuert auch auf unsichtbaren Knöpfen — ein Test, der
         * Schritte überspringt, würde ein kaputtes Onboarding nicht bemerken.
         * ---------------------------------------------------------------- */
        const einspielen = await b.werteAus(`(async () => {
            const K = window.KARAOKOVIC;
            /* Der Haltespeicher wird direkt gefüllt: das Fake-Mikrofon von
               Chrome liefert nur einen festen Ton, wir brauchen aber zwei
               verschiedene für tief und hoch. */
            const singe = (hz) => { K.audio.livePitch = 0; K.audio.heldPitch = hz;
                                    K.audio.heldPitchAt = Date.now(); };
            const sichtbar = (id) => {
                const e = document.getElementById(id);
                return !!e && e.offsetParent !== null;
            };
            const schritte = {};

            schritte.modusZuerst = sichtbar('btnModeArcade') && !sichtbar('btnMic');
            document.getElementById('btnModeArcade').click();

            /* ARENA-1 schiebt zwischen Modus und Mikrofon die Platzwahl ein.
               Ob es den Schritt gibt, entscheidet die geprüfte SEITE — deshalb
               wird er hier erkannt und nicht vorausgesetzt. So prüft dieselbe
               Testdatei beide Fassungen, statt zu einer Kopie zu zerfallen. */
            const platzKnopf = document.getElementById('btnPlatzSand');
            schritte.hatPlatzwahl = !!platzKnopf;
            if (platzKnopf) {
                schritte.platzVorMikrofon = sichtbar('btnPlatzSand') && !sichtbar('btnMic');
                platzKnopf.click();
                schritte.platzName = K.platz ? String(K.platz.name) : '';
                schritte.platzFolge = Array.isArray(K.platzFolge)
                    ? K.platzFolge.join(' -> ') : '';
            }

            schritte.dannMikrofon = sichtbar('btnMic');

            document.getElementById('btnMic').click();
            await new Promise(r => setTimeout(r, 1500));
            schritte.dannEinsingen = sichtbar('btnLow');

            singe(110); document.getElementById('btnLow').click();
            singe(330); document.getElementById('btnHigh').click();
            await new Promise(r => setTimeout(r, 100));

            /* Erst der Bestätigungsschritt, DANN der Start. */
            schritte.bestaetigungKommt = sichtbar('btnRangeOk');
            schritte.startNochVersteckt = !sichtbar('btnStartGame');
            schritte.bereichText = document.getElementById('calibRange').innerText;

            /* Der gespeicherte Ton muss auf seinem Knopf stehen. */
            schritte.tiefErledigt = /Hz/.test(document.getElementById('btnLow').innerText)
                && document.getElementById('btnLow').disabled;

            /* Die beiden Bestätigungsknöpfe müssen gleich breit sein. */
            const rOk = document.getElementById('btnRangeOk').getBoundingClientRect();
            const rRedo = document.getElementById('btnRangeRedo').getBoundingClientRect();
            schritte.knoepfeGleichBreit = Math.abs(rOk.width - rRedo.width) < 1;
            schritte.knopfAbstand = +(rRedo.left - rOk.right).toFixed(1);

            /* Der Hinweistext darf nichts überlagern: eigene Zeile, und die
               Hertz-Anzeige darüber bleibt sichtbar. */
            K.showCalibrationHint('Bereich verworfen — bitte neu einsingen.');
            const rHint = document.getElementById('calibHint').getBoundingClientRect();
            const rPitch = document.getElementById('livePitch').getBoundingClientRect();
            schritte.hinweisUeberlagertNicht = rHint.top >= rPitch.bottom - 0.5;
            schritte.hinweisEinzeilig = rHint.height < 40;

            document.getElementById('btnRangeOk').click();
            schritte.startWahlFrei = sichtbar('btnStartWarmup') && sichtbar('btnStartGame');

            /* Einspielen starten -> Phase WARMUP, keine Zählung. */
            document.getElementById('btnStartWarmup').click();
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
            return { ...schritte, phase: String(K.match.phase),
                     onboarding: document.getElementById('onboarding').style.display,
                     medianMs: +t[Math.floor(t.length / 2)].toFixed(2) };
        })()`);
        check('Die Moduswahl steht vor dem Mikrofon', einspielen.modusZuerst);
        if (einspielen.hatPlatzwahl) {
            check('Die Platzwahl steht zwischen Modus und Mikrofon',
                einspielen.platzVorMikrofon);
            check('Der gewählte Belag ist gesetzt und eröffnet die Satzfolge',
                /Sand/i.test(einspielen.platzName)
                && einspielen.platzFolge.startsWith('SAND'),
                `Platz "${einspielen.platzName}", Folge ${einspielen.platzFolge}`);
        }
        check('Vor dem Einsingen steht der Mikrofon-Check', einspielen.dannMikrofon);
        check('Nach der Mikrofonfreigabe kommt das Einsingen', einspielen.dannEinsingen);
        check('Nach dem hohen Ton wird der Bereich zur Bestätigung gezeigt',
            einspielen.bestaetigungKommt, einspielen.bereichText);
        check('Der Start erscheint NICHT vor der Bestätigung',
            einspielen.startNochVersteckt);
        check('Der gespeicherte tiefe Ton steht auf seinem Knopf und sperrt ihn',
            einspielen.tiefErledigt);
        check('Die beiden Bestätigungsknöpfe sind gleich breit',
            einspielen.knoepfeGleichBreit);
        check('Zwischen den Bestätigungsknöpfen ist Abstand',
            einspielen.knopfAbstand >= 16, `${einspielen.knopfAbstand} px`);
        check('Der Hinweistext überlagert die Hertz-Anzeige nicht',
            einspielen.hinweisUeberlagertNicht && einspielen.hinweisEinzeilig);
        check('"Range okay!" führt zur Auswahl Einspielen / Match',
            einspielen.startWahlFrei);
        check('"Einspielen starten" landet in der Phase WARMUP',
            einspielen.phase === 'WARMUP', `phase = ${einspielen.phase}`);
        check('Onboarding ist danach ausgeblendet', einspielen.onboarding === 'none');
        check('Bildrate im Einspielen bleibt unter 20 ms pro Frame',
            einspielen.medianMs < 20, `${einspielen.medianMs} ms Median`);

        /* --- 7. Klaviatur folgt dem Stimmumfang -------------------------- *
         * Die Randtasten kommen AUSSERHALB dazu. Verteilte man dieselbe
         * Breite auf mehr Tasten, verschöbe sich jede Taste des kalibrierten
         * Bereichs gegen die Feldposition, zu der ihr Ton die Figur schickt —
         * die Klaviatur würde in die Irre führen.
         * ---------------------------------------------------------------- */
        const klaviatur = await b.werteAus(`(() => {
            const K = window.KARAOKOVIC, R = K.renderer.constructor;
            K.setVoiceRange(K.PLAYER.ANDREA, 110, 330);
            const feldL = 460.5, feldB = 679;
            const span = R.keyboardSpan(K.PLAYER.ANDREA, feldL, feldB);
            const minMidi = Math.round(R.midiOf(110));
            const maxMidi = Math.round(R.midiOf(330));
            const keyW = feldB / (maxMidi - minMidi + 1);
            return {
                randLinks: +(feldL - span.x).toFixed(2),
                randRechts: +((span.x + span.w) - (feldL + feldB)).toFixed(2),
                zweiTasten: +(2 * keyW).toFixed(2),
                tastenGesamt: span.maxMidi - span.minMidi + 1,
                tastenImUmfang: maxMidi - minMidi + 1,
                mitteUmfang: (minMidi + maxMidi) / 2,
                mitteKlaviatur: (span.minMidi + span.maxMidi) / 2,
                keyWimUmfang: +keyW.toFixed(4),
                keyWgesamt: +(span.w / (span.maxMidi - span.minMidi + 1)).toFixed(4),
            };
        })()`);
        check('Die Mitte des Stimmumfangs ist die Mitte der Klaviatur',
            klaviatur.mitteUmfang === klaviatur.mitteKlaviatur,
            `MIDI ${klaviatur.mitteUmfang} = ${klaviatur.mitteKlaviatur}`);
        check('Links und rechts kommen genau zwei Tasten dazu',
            klaviatur.tastenGesamt === klaviatur.tastenImUmfang + 4,
            `${klaviatur.tastenImUmfang} im Umfang, ${klaviatur.tastenGesamt} gesamt`);
        check('Die Randtasten liegen AUSSERHALB des Feldes',
            Math.abs(klaviatur.randLinks - klaviatur.zweiTasten) < 0.01
            && Math.abs(klaviatur.randRechts - klaviatur.zweiTasten) < 0.01,
            `${klaviatur.randLinks} px / ${klaviatur.randRechts} px = 2 Tasten (${klaviatur.zweiTasten} px)`);
        check('Die Tastenbreite bleibt dadurch unverändert',
            Math.abs(klaviatur.keyWimUmfang - klaviatur.keyWgesamt) < 0.0001,
            `${klaviatur.keyWimUmfang} px`);

        /* --- 8. Steuerung der oberen Figur (Duell) ----------------------- *
         * Die ganze Kette für Spieler 2: eigener Stimmumfang -> Zielposition
         * -> gedämpfte Bewegung. Ohne Mikrofon geprüft, indem `smoothedPitch`
         * des zweiten Eingangs direkt gesetzt wird.
         * ---------------------------------------------------------------- */
        const duell = await b.werteAus(`(() => {
            const K = window.KARAOKOVIC, P = K.physics;
            K.config.mode = K.MODE.VERSUS;
            K.setVoiceRange(K.PLAYER.ALEX, 200, 600);   // andere Lage als Spieler 1

            const laufe = (hz) => {
                P.haltAlexAt(800);
                for (let i = 0; i < 90; i++) {
                    P.alexTargetX = P.freqToQuantizedX(hz, K.PLAYER.ALEX);
                    P.glideAlexToTarget();
                }
                return +P.paddleAlex.x.toFixed(1);
            };
            const links = laufe(200);      // tiefster Ton von Spieler 2
            const rechts = laufe(600);     // höchster Ton von Spieler 2

            /* Gegenprobe: derselbe Ton bei Spieler 1 landet woanders, weil
               dessen Umfang ein anderer ist. */
            K.setVoiceRange(K.PLAYER.ANDREA, 100, 300);
            const gleicherTonSpieler1 = +P.freqToQuantizedX(200, K.PLAYER.ANDREA).toFixed(1);
            const gleicherTonSpieler2 = +P.freqToQuantizedX(200, K.PLAYER.ALEX).toFixed(1);

            K.config.mode = K.MODE.ARCADE;   // Testzustand zurückgeben
            return { links, rechts, gleicherTonSpieler1, gleicherTonSpieler2,
                     linkeLinie: P.constructor.PLAYER_MIN_X,
                     rechteLinie: P.constructor.PLAYER_MAX_X };
        })()`);
        check('Spieler 2 erreicht mit seinem tiefsten Ton die linke Linie',
            Math.abs(duell.links - duell.linkeLinie) < 1,
            `${duell.links} vs. ${duell.linkeLinie}`);
        check('Spieler 2 erreicht mit seinem höchsten Ton die rechte Linie',
            Math.abs(duell.rechts - duell.rechteLinie) < 1,
            `${duell.rechts} vs. ${duell.rechteLinie}`);
        check('Derselbe Ton bedeutet für beide Spieler eine andere Position',
            Math.abs(duell.gleicherTonSpieler1 - duell.gleicherTonSpieler2) > 100,
            `200 Hz: Spieler 1 bei ${duell.gleicherTonSpieler1}, Spieler 2 bei ${duell.gleicherTonSpieler2}`);

        /* --- 9. "HOCH"-Visual bleibt im Grünstreifen --------------------- *
         * Es darf weder über die äußere Seitenlinie ins Feld ragen noch die
         * Bande berühren. Beide Grenzen laufen schräg: die Seitenlinie
         * wandert nach unten nach rechts, die Bandenkante nach oben nach
         * links. Geprüft werden deshalb Ober- UND Unterkante des Visuals.
         * ---------------------------------------------------------------- */
        const note = await b.werteAus(`(() => {
            const K = window.KARAOKOVIC, R = K.renderer.constructor;
            const r = K.renderer;
            const cx = r.pitchRightX();
            const m = r.pitchVisualMetrics('HOCH');
            const oben = R.PITCH_NOTE_Y_HIGH - m.oben;
            const unten = R.PITCH_NOTE_Y_HIGH + m.unten;
            return {
                links: +(cx - m.halbBreite).toFixed(1),
                rechts: +(cx + m.halbBreite).toFixed(1),
                oben: +oben.toFixed(1),
                unten: +unten.toFixed(1),
                hoehe: +(unten - oben).toFixed(1),
                /* Seitenlinie an der Unterkante = ihre rechteste Stelle */
                seitenlinie: +r.courtEdgeX(unten, 1).toFixed(1),
                /* Bandenkante an der Oberkante = ihre linkeste Stelle */
                bande: +R.apronRightAt(oben).toFixed(1),
            };
        })()`);
        check('"HOCH" ragt nicht über die äußere Seitenlinie ins Feld',
            note.links > note.seitenlinie,
            `linke Kante ${note.links} vs. Seitenlinie ${note.seitenlinie}`);
        check('"HOCH" berührt die Bande nicht',
            note.rechts < note.bande,
            `rechte Kante ${note.rechts} vs. Bande ${note.bande}`);
        check('Zu beiden Seiten bleibt Luft',
            (note.links - note.seitenlinie) >= 10 && (note.bande - note.rechts) >= 10,
            `${(note.links - note.seitenlinie).toFixed(1)} px innen, `
            + `${(note.bande - note.rechts).toFixed(1)} px außen`);

        /* --- 10. Nichts ist unterwegs geflogen -------------------------- */
        check('Keine Exception und kein console.error während des Laufs',
            b.fehler.length === 0, b.fehler.join(' | ') || 'sauber');

    } catch (err) {
        check('Browsertest läuft ohne Abbruch durch', false, err.message);
    } finally {
        aufraeumen();
    }

    summary();
})();
