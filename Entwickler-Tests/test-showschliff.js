/* =============================================================================
 * TEST: Der Showschliff aus ARENA-16
 *
 * Drei Aenderungen, die nur zusammen Sinn ergeben — alle drei drehen sich um
 * die Frage, WANN etwas im Bild passiert:
 *
 *   1. Benni reagiert auf den Punkt. Sein Kopf wechselt zum Sieger, aber
 *      erst nach ERGEBNIS_VERZUG — im selben Moment, in dem auch die Figuren
 *      ihre Miene aendern. Sonst weiss die Bildregie den Punktgewinner, bevor
 *      der Ball ausgespielt aussieht.
 *   2. Der Countdown federt staerker (Ueberschwinger 5.0 statt 3.2). Die
 *      Kollisionsbox muss deshalb gegen die SPITZE rechnen, nicht gegen die
 *      Ruhegroesse — sonst schiebt sich die Ziffer genau im Einsprung ueber
 *      einen Kopf.
 *   3. "AUFSCHLAG!" springt zweimal und ist dann weg, statt endlos zu
 *      pulsieren. Der Zielzonen-Meter darunter bleibt.
 *
 * Start: node Entwickler-Tests/test-showschliff.js
 * ========================================================================== */

'use strict';

const { loadGame, check, summary, zeichenprotokoll } = require('./dom-stub.js');
const game = loadGame('../app-arena.js');
const { renderer, match, physics, PLAYER } = game;
const R = renderer.constructor;

/**
 * Zeit im Zustand vorgeben.
 * @param {number} ms
 */
function alter(ms) { match.stateTimer = game.uhr.jetzt() - ms; }

/* --- 1. Bennis Reaktion auf den Punkt ------------------------------------ *
 * Im Node-Stub laedt kein einziges Bild. Genau deshalb wird hier ZWEIMAL
 * geprueft: einmal so, als lägen die Reaktionsbilder vor (isReady vorgegeben),
 * und einmal im echten Zustand ohne Dateien — das ist der Stand, mit dem die
 * Show notfalls auch laufen muss. */

/** Bilder vorgeben, ohne den AssetManager anzufassen. @param {string[]} da */
function mitBildern(da) {
    renderer.assets.isReady = (k) => da.indexOf(k) >= 0;
}
const echtesIsReady = renderer.assets.isReady.bind(renderer.assets);
const ALLE_KOEPFE = ['head_benni', 'head_benni_punkt_alex', 'head_benni_punkt_andrea'];

match.state = 'POINT_SCORED';
match.lastWinner = PLAYER.ANDREA;
mitBildern(ALLE_KOEPFE);

alter(0);
const sofort = renderer.resolveSchiriKopf(match);
alter(R.ERGEBNIS_VERZUG - 20);
const kurzDavor = renderer.resolveSchiriKopf(match);
alter(R.ERGEBNIS_VERZUG + 20);
const danachAndrea = renderer.resolveSchiriKopf(match);
match.lastWinner = PLAYER.ALEX;
const danachAlex = renderer.resolveSchiriKopf(match);

console.log(`Bennis Kopf: sofort "${sofort}", nach ${R.ERGEBNIS_VERZUG} ms `
    + `"${danachAndrea}" bzw. "${danachAlex}"`);

check('Im Spiel schaut Benni neutral', (() => {
    match.state = 'PLAYING';
    const k = renderer.resolveSchiriKopf(match);
    match.state = 'POINT_SCORED';
    return k === 'head_benni';
})());
check('Direkt nach dem Punkt noch nicht — der Ball ist optisch nicht durch',
    sofort === 'head_benni' && kurzDavor === 'head_benni',
    `${sofort} / ${kurzDavor}`);
check('Nach dem Verzug zeigt er den Gewinner an',
    danachAndrea === 'head_benni_punkt_andrea'
    && danachAlex === 'head_benni_punkt_alex',
    `${danachAndrea} / ${danachAlex}`);

/* Er benutzt dieselbe Quelle wie die Mienen der Figuren — nicht eine zweite
   Rechnung mit denselben Zahlen, die spaeter auseinanderlaufen kann. */
alter(R.ERGEBNIS_VERZUG + 20);
match.lastWinner = PLAYER.ANDREA;
check('Kopf und Mienen lesen aus derselben Quelle',
    R.ergebnisZeigt(match) === PLAYER.ANDREA
    && renderer.resolveSchiriKopf(match).endsWith('andrea'));
alter(R.ERGEBNIS_VERZUG - 20);
check('Und schalten damit im selben Frame um',
    R.ergebnisZeigt(match) === '' && renderer.resolveSchiriKopf(match) === 'head_benni');

/* Fehlt eine der beiden Dateien, bleibt der Standardkopf stehen. */
alter(R.ERGEBNIS_VERZUG + 20);
mitBildern(['head_benni']);
const ohneDatei = renderer.resolveSchiriKopf(match);
renderer.assets.isReady = echtesIsReady;

check('Fehlt das Reaktionsbild, bleibt der Standardkopf stehen',
    ohneDatei === 'head_benni', ohneDatei);
check('Die Reaktionsbilder sind als "darf fehlen" hinterlegt',
    game.assets.OPTIONAL.indexOf('head_benni_punkt_alex') >= 0
    && game.assets.OPTIONAL.indexOf('head_benni_punkt_andrea') >= 0
    && game.assets.OPTIONAL.indexOf('transition_logo') >= 0,
    game.assets.OPTIONAL.join(', '));
check('Und ohne jedes Bild zeichnet der Schiedsrichter, ohne zu werfen', (() => {
    const { ctx } = zeichenprotokoll();
    const echt = renderer.ctx;
    renderer.ctx = ctx;
    try { renderer.drawSchiedsrichter(match); return true; }
    catch (e) { return false; }
    finally { renderer.ctx = echt; }
})());

/* --- 2. Der Countdown federt staerker ------------------------------------ */
let gemesseneSpitze = 0, argMax = 0;
for (let ms = 0; ms <= R.COUNTDOWN_BOUNCE_MS; ms += 1) {
    const w = R.countdownBounce(ms);
    if (w > gemesseneSpitze) { gemesseneSpitze = w; argMax = ms; }
}
console.log(`\nCountdown: Ueberschwinger ${R.COUNTDOWN_OVERSHOOT}, `
    + `Spitze ${gemesseneSpitze.toFixed(3)} nach ${argMax} ms`);

check('Der Ueberschwinger steht auf 5.0', R.COUNTDOWN_OVERSHOOT === 5.0,
    `${R.COUNTDOWN_OVERSHOOT}`);
check('COUNTDOWN_SPITZE ist wirklich das Maximum der Kurve',
    Math.abs(R.COUNTDOWN_SPITZE - gemesseneSpitze) < 0.005,
    `${R.COUNTDOWN_SPITZE.toFixed(3)} vs. gemessen ${gemesseneSpitze.toFixed(3)}`);
check('Die Ziffer schiesst um mehr als die Haelfte hinaus',
    gemesseneSpitze > 1.5, `${(gemesseneSpitze * 100 - 100).toFixed(1)} % ueber Endgroesse`);
check('Sie faengt sich danach wieder auf genau 1',
    Math.abs(R.countdownBounce(R.COUNTDOWN_BOUNCE_MS) - 1) < 0.01
    && Math.abs(R.countdownBounce(99999) - 1) < 1e-9);
check('Und beginnt bei 0, statt aus dem Stand zu erscheinen',
    Math.abs(R.countdownBounce(0)) < 1e-9);

/* GEGENPROBE: mit dem alten Wert war der Ausschlag deutlich kleiner. Die
   Kurve wird dafuer aus derselben Formel nachgebaut — countdownBounce liest
   die Konstante beim Aufruf, ein temporaeres Ueberschreiben faelscht also
   nichts, sondern rechnet dieselbe Funktion mit dem alten Parameter. */
const NEU = R.COUNTDOWN_OVERSHOOT;
R.COUNTDOWN_OVERSHOOT = 3.2;
let altSpitze = 0;
for (let ms = 0; ms <= R.COUNTDOWN_BOUNCE_MS; ms += 1) {
    altSpitze = Math.max(altSpitze, R.countdownBounce(ms));
}
R.COUNTDOWN_OVERSHOOT = NEU;
console.log(`  zum Vergleich mit dem alten Wert 3.2: ${altSpitze.toFixed(3)}`);
check('GEGENPROBE: der alte Wert federte spuerbar schwaecher',
    gemesseneSpitze > altSpitze + 0.15,
    `${gemesseneSpitze.toFixed(3)} statt ${altSpitze.toFixed(3)}`);

/* --- 2b. Sie steht ueber dem Netz und verdeckt niemanden -----------------
 * BUEHNENBEFUND (Live-Test 25.08.2026): "Die Ziffer steht riesig in der
 * Bildmitte und verdeckt Alex fast vollstaendig."
 *
 * Sie hing an `COURT_MID_Y` — einer WELTkoordinate (500), die als
 * BILDkoordinate benutzt wurde. Die Netzlinie liegt auf dem Schirm je nach
 * Platz bei 378 / 512 / 464; 500 traf keine davon. Von dort wich die Ziffer
 * dem einen Kopf aus und landete auf dem anderen.
 *
 * Seit ARENA-20 haengt sie an der eingemessenen Oberkante des GEMALTEN
 * Netzes und ist so bemessen, dass sie zwischen Alex' Kopf und das Netz
 * passt. Vier Dinge muessen stimmen, und alle vier brauchen die echten
 * Bildmasse — der Node-Test kann das, weil headBox() rein geometrisch
 * rechnet:
 *
 *   - Sie steht auf der PLATZachse, nicht in der Bildmitte.
 *   - Ihre Unterkante bleibt ueber dem Netz, auch im groessten Moment.
 *   - Sie beruehrt auf keinem Platz eine Kopfbox, in Ruhe wie im Einsprung.
 *   - Ausweichen muss sie dafuer NICHT mehr. Die Logik bleibt als
 *     Sicherheitsnetz, aber sie schlaegt an dieser Position nicht mehr an.
 * ------------------------------------------------------------------------ */

/** Die Szene, die der Renderer fuer Kopf- und Figurboxen braucht. */
function boxenSzene() {
    return {
        match, andreaX: 800,
        paddleAndrea: game.paddleAndrea, paddleAlex: game.paddleAlex,
        stimme: physics.stimme, abweisung: physics.abweisung,
    };
}

/**
 * Die Lage der Ziffer auf dem aktuellen Platz durchrechnen.
 *
 * Rechnet Schritt fuer Schritt nach, was drawSilenceCheck() tut — Achse,
 * Netzanker, Kasten aus der Spitze, Ausweichweg.
 *
 * @param {number} faktor Groessenfaktor (1 = Ruhe, COUNTDOWN_SPITZE = Einsprung)
 */
function ziffernlage(faktor) {
    const achse = renderer.proj.project(800, game.grenzen.midY, 0, {});
    const size = R.COUNTDOWN_SIZE * achse.scale;
    const spitze = size * R.COUNTDOWN_SPITZE;
    const netzY = renderer.viewport.toScreen(0, R.NETZ_OBEN, {}).y;
    /* Unterkante im groessten Moment liegt COUNTDOWN_NETZ_ABSTAND ueber dem
       Netz — daraus die Mitte. */
    const cy = netzY - R.COUNTDOWN_NETZ_ABSTAND * achse.scale - spitze * 0.4;

    const kasten = (f) => {
        const gross = size * f;
        return {
            left: achse.x - gross * 0.4, right: achse.x + gross * 0.4,
            top: cy - gross * 0.4, bottom: cy + gross * 0.4,
            hoehe: gross * 0.8,
        };
    };
    /* Beide Figuren mittig — der unguenstigste Fall: dann stehen Ziffer und
       Kopf uebereinander. */
    const koepfe = renderer.kopfBoxen(boxenSzene());
    /* Gezeichnet wird IMMER mit dem aus der Spitze gerechneten Weg. */
    const weg = renderer.dodgeHeads(kasten(R.COUNTDOWN_SPITZE), koepfe,
        R.COUNTDOWN_DODGE_MAX * achse.scale);

    const box = kasten(faktor);
    const tiefe = (k) => {
        if (box.right < k.left || box.left > k.right) return 0;
        return Math.max(0, Math.min(box.bottom + weg, k.bottom)
            - Math.max(box.top + weg, k.top));
    };
    return {
        weg, hoehe: box.hoehe, achseX: achse.x, netzY,
        band: koepfe[0].top - koepfe[1].bottom,
        inAndrea: tiefe(koepfe[0]),
        inAlex: tiefe(koepfe[1]),
        unten: box.bottom + weg, oben: box.top + weg,
    };
}

const lageRuhe = ziffernlage(1);
const lageSpitze = ziffernlage(R.COUNTDOWN_SPITZE);

console.log(`\nZiffer: Ruhe ${lageRuhe.hoehe.toFixed(0)} px, Einsprung `
    + `${lageSpitze.hoehe.toFixed(0)} px, Netzoberkante ${lageRuhe.netzY.toFixed(0)}, `
    + `Ausweichen ${lageSpitze.weg.toFixed(0)} px`);

check('Sie muss keinem Kopf mehr ausweichen', lageSpitze.weg === 0,
    `${lageSpitze.weg.toFixed(0)} px`);
check('In Ruhe steht sie voellig frei',
    lageRuhe.inAndrea === 0 && lageRuhe.inAlex === 0,
    `${lageRuhe.inAndrea.toFixed(1)} / ${lageRuhe.inAlex.toFixed(1)} px`);
check('Und im Einsprung auf dem Referenzplatz ebenfalls',
    lageSpitze.inAndrea === 0 && lageSpitze.inAlex === 0,
    `${lageSpitze.inAndrea.toFixed(1)} / ${lageSpitze.inAlex.toFixed(1)} px`);
check('Sie bleibt dabei im Bild', lageSpitze.oben > 0,
    `Oberkante bei y ${lageSpitze.oben.toFixed(0)}`);

/* GEGENPROBE gegen den alten Anker — mit den ZAHLEN VON DAMALS und nicht mit
   den heutigen. Eine Gegenprobe, die aus aktuellen Konstanten rechnet, ist
   keine: sie wuerde beim naechsten Feintuning still ihre eigene Aussage
   verlieren. Damals: Schriftgrad 280, Mitte auf Bildkoordinate 500, fester
   Ausweichweg 170 px nach oben. Geprueft auf dem SANDplatz, wo der Befund
   herkommt. */
game.setzePlatz('SAND');
const altTiefe = (() => {
    const p = renderer.viewport.toScreen(800, game.grenzen.midY, {});
    const altWeg = -170 * p.scale;
    const gross = 280 * p.scale;
    const box = { top: p.y - gross * 0.4, bottom: p.y + gross * 0.4 };
    /* Kopfbox an der GRUNDlinie — die Figuren standen damals dort. */
    const k = renderer.headBox(800, game.paddleAlex.y);
    return Math.max(0, Math.min(box.bottom + altWeg, k.bottom)
        - Math.max(box.top + altWeg, k.top));
})();
const neuTiefe = ziffernlage(1).inAlex;
game.setzePlatz('HART');
console.log(`  Sandplatz, ruhende Ziffer auf der hinteren Figur: `
    + `alt ${altTiefe.toFixed(0)} px -> neu ${neuTiefe.toFixed(0)} px`);

/* --- Und auf allen drei Plaetzen ----------------------------------------- */
const jePlatz = [];
for (const name of Object.keys(game.PLAETZE)) {
    game.setzePlatz(name);
    const r = ziffernlage(1);
    const l = ziffernlage(R.COUNTDOWN_SPITZE);
    jePlatz.push({ name, ruhe: r.inAndrea + r.inAlex,
        spitze: l.inAndrea + l.inAlex, band: r.band, hoehe: l.hoehe,
        weg: l.weg, oben: l.oben, netzLuft: l.netzY - l.unten,
        achse: r.achseX, mitteX: game.PLAETZE[name].mitteX });
}
game.setzePlatz(Object.keys(game.PLAETZE)[0]);
console.log('  je Platz (Band Kopf..Netz / Ziffer im Einsprung / Ueberdeckung Ruhe + Spitze / Luft zum Netz):');
jePlatz.forEach(x => console.log(`    ${x.name.padEnd(6)} ${x.band.toFixed(0)} px / `
    + `${x.hoehe.toFixed(0)} px / ${x.ruhe.toFixed(0)} px + ${x.spitze.toFixed(0)} px / `
    + `${x.netzLuft.toFixed(0)} px  (Weg ${x.weg.toFixed(0)} px)`));

check('Auf KEINEM Platz verdeckt die ruhige Ziffer einen Kopf',
    jePlatz.every(x => x.ruhe === 0),
    jePlatz.map(x => `${x.name} ${x.ruhe.toFixed(0)} px`).join(', '));
check('Auch im Einsprung nicht — auf keinem der drei',
    jePlatz.every(x => x.spitze === 0),
    jePlatz.map(x => `${x.name} ${x.spitze.toFixed(0)} px`).join(', '));
check('Die Ziffer bleibt auf jedem Platz im Bild',
    jePlatz.every(x => x.oben > 0),
    jePlatz.map(x => `${x.name} y ${x.oben.toFixed(0)}`).join(', '));
/* Das Netz bleibt frei — sonst haenge die Ziffer darin statt darueber. */
check('Und sie verdeckt das Netz nicht, auch nicht im groessten Moment',
    jePlatz.every(x => Math.abs(x.netzLuft - R.COUNTDOWN_NETZ_ABSTAND) < 0.5),
    jePlatz.map(x => `${x.name} ${x.netzLuft.toFixed(0)} px`).join(', '));
/* Sie haengt an der PLATZachse. Auf dem Hartplatz faellt die mit der
   Bildmitte zusammen, auf den anderen beiden nicht — genau daran war der
   alte Anker nicht zu erkennen. */
check('Sie steht auf der Platzachse, nicht in der Bildmitte',
    jePlatz.every(x => Math.abs(x.achse - x.mitteX) < 0.01),
    jePlatz.map(x => `${x.name} ${x.achse.toFixed(1)} = ${x.mitteX}`).join(', '));
check('GEGENPROBE: der alte Anker lag auf Sand 42 px auf der hinteren Figur',
    altTiefe > 40 && altTiefe < 45, `${altTiefe.toFixed(0)} px`);
check('Und genau dieser Altbefund ist erledigt',
    neuTiefe === 0, `${neuTiefe.toFixed(0)} px`);

/* --- 3. "AUFSCHLAG!" springt zweimal und ist dann weg --------------------- *
 * Gemessen wird an dem, was gezeichnet wird: der Schriftgrad im Text-Log
 * gibt die gefederte Groesse, die Deckkraft den Ausblendteil. */
const BOUNCE = R.SERVE_PROMPT_BOUNCE_MS;
/* Der Zeitpunkt der Spitze DIESER Kurve — nicht der des Countdowns. Beide
   benutzen dieselbe Kurvenform, aber ueber verschiedene Dauern; mit argMax
   des Countdowns (169 ms) traefe die Probe die Aufforderung im Anstieg und
   nicht in ihrem groessten Moment. */
let promptMax = 0, promptArg = 0;
for (let ms = 0; ms <= BOUNCE; ms++) {
    /* pulse(), nicht bounce() — seit ARENA-20 zeichnet der Renderer damit.
       Mit der falschen Kurve traefe die Probe die Spitze um 100 ms daneben. */
    const v = R.pulse(ms, BOUNCE, R.COUNTDOWN_OVERSHOOT);
    if (v > promptMax) { promptMax = v; promptArg = ms; }
}
const szene = {
    match,
    andreaX: physics.currentX,
    paddleAndrea: game.paddleAndrea,
    paddleAlex: game.paddleAlex,
    stimme: { aktiv: true, zentriert: false, prozent: 0.72, frei: false },
    raumpegel: 0.01,
};

/**
 * Einen Frame der Aufforderung zeichnen.
 * @param {number} ms Zeit im Zustand
 * @returns {{sichtbar: boolean, groesse: number, alpha: number, texte: number}}
 */
function aufforderung(ms) {
    alter(ms);
    const { ctx, log } = zeichenprotokoll();
    const echt = renderer.ctx;
    renderer.ctx = ctx;
    try { renderer.drawServePrompt(szene); } finally { renderer.ctx = echt; }
    const treffer = log.texte.filter(t => t.text === R.SERVE_PROMPT_TEXT && !t.kontur);
    const px = treffer.length ? parseFloat(treffer[0].font.match(/([\d.]+)px/)[1]) : 0;
    return {
        sichtbar: treffer.length > 0,
        groesse: px,
        alpha: treffer.length ? treffer[0].alpha : 0,
        rechtecke: log.rechtecke.length,
    };
}

const ruheGroesse = R.SERVE_PROMPT_SIZE * renderer.viewport.scale;
const spitze1 = aufforderung(promptArg);
const tal = aufforderung(BOUNCE - 1);
const spitze2 = aufforderung(BOUNCE + promptArg);
const nachZwei = aufforderung(2 * BOUNCE + 10);
const weg = aufforderung(2 * BOUNCE + R.SERVE_PROMPT_FADE_MS + 10);
const spaeter = aufforderung(6000);

console.log(`\nAufforderung: 1. Sprung ${spitze1.groesse.toFixed(0)} px, `
    + `dazwischen ${tal.groesse.toFixed(0)} px, 2. Sprung `
    + `${spitze2.groesse.toFixed(0)} px, danach ${weg.sichtbar ? 'noch da' : 'weg'}`);

check('Sie springt genau zweimal', R.SERVE_PROMPT_BOUNCES === 2,
    `${R.SERVE_PROMPT_BOUNCES}`);
/* "Dieselbe Kurvenform" heisst: an derselben RELATIVEN Stelle derselbe Wert.
   Nur die Achse ist gestreckt. Das ist exakt pruefbar und sagt mehr als ein
   Vergleich der Spitzenwerte. */
let formAbweichung = 0;
for (let i = 0; i <= 20; i++) {
    const x = i / 20;
    formAbweichung = Math.max(formAbweichung, Math.abs(
        R.bounce(x * BOUNCE, BOUNCE, R.COUNTDOWN_OVERSHOOT)
        - R.bounce(x * R.COUNTDOWN_BOUNCE_MS, R.COUNTDOWN_BOUNCE_MS,
            R.COUNTDOWN_OVERSHOOT)));
}
check('Sie benutzt DIESELBE Kurvenform wie der Countdown',
    formAbweichung < 1e-12,
    `groesste Abweichung ${formAbweichung.toExponential(1)}`);

/* --- 3a. EIN Wort, zwei Schlaege ---------------------------------------- *
 * BUEHNENBEFUND (Live-Test 25.08.2026): "Das Wort blendet zweimal auf und
 * wirkt wie zwei getrennte Einblendungen desselben Worts."
 *
 * Die Ursache war NICHT die Deckkraft — die stand waehrend beider Schlaege
 * schon auf 1. Es war die GROESSE: bounce() beginnt bauartbedingt bei exakt
 * 0, und zwar bei jedem Schlag. Ein Wort mit Schriftgrad 0 ist unsichtbar.
 * Deshalb pulse(): dieselbe Kurve ohne den Anlauf.
 *
 * Geprueft wird an der Kurve UND an dem, was tatsaechlich gezeichnet wird. */
check('pulse() beginnt und endet bei voller Groesse',
    Math.abs(R.pulse(0, BOUNCE, R.COUNTDOWN_OVERSHOOT) - 1) < 1e-12
    && Math.abs(R.pulse(BOUNCE, BOUNCE, R.COUNTDOWN_OVERSHOOT) - 1) < 1e-12,
    `${R.pulse(0, BOUNCE, R.COUNTDOWN_OVERSHOOT).toFixed(3)} -> `
    + `${R.pulse(BOUNCE, BOUNCE, R.COUNTDOWN_OVERSHOOT).toFixed(3)}`);
let pulseMin = Infinity, pulseSpitze = 0;
for (let i = 0; i <= 400; i++) {
    const v = R.pulse(i / 400 * BOUNCE, BOUNCE, R.COUNTDOWN_OVERSHOOT);
    pulseMin = Math.min(pulseMin, v);
    pulseSpitze = Math.max(pulseSpitze, v);
}
check('Und faellt dazwischen nie darunter',
    pulseMin >= 1 - 1e-12, `kleinster Wert ${pulseMin.toFixed(4)}`);
check('GEGENPROBE: bounce() faellt genau dort auf null',
    Math.abs(R.bounce(0, BOUNCE, R.COUNTDOWN_OVERSHOOT)) < 1e-12,
    `${R.bounce(0, BOUNCE, R.COUNTDOWN_OVERSHOOT).toFixed(3)}`);
/* Die Spitze ist DIESELBE, weil pulse() nur die Zeitachse umparametrisiert
   und der Abschnitt die Spitze enthaelt. Verglichen werden zwei ABTASTUNGEN
   derselben Kurve (hier 400 Schritte, in spitzeVon 200) — sie treffen den
   Scheitel unterschiedlich genau. Die Toleranz deckt genau diesen
   Abtastfehler ab und nichts weiter: eine echte Abweichung der Kurven laege
   um Groessenordnungen darueber. */
check('Die Spitze bleibt dieselbe — spitzeVon() gilt fuer beide',
    Math.abs(pulseSpitze - R.SERVE_PROMPT_SPITZE) < 1e-3,
    `${pulseSpitze.toFixed(5)} vs. ${R.SERVE_PROMPT_SPITZE.toFixed(5)}`);
check('Aber ueber eine laengere Dauer — das war das Zucken',
    BOUNCE > R.COUNTDOWN_BOUNCE_MS,
    `${BOUNCE} ms je Schlag statt ${R.COUNTDOWN_BOUNCE_MS} ms`);
/* Sie erreicht ihre Spitze spaeter als der Countdown — aber nicht mehr um
   den vollen Dauerfaktor. Bis ARENA-19 stand hier `> argMax * 1.3`; seit die
   Aufforderung mit pulse() den Anlauf ueberspringt, sitzt ihr Scheitel
   FRUEHER im eigenen Schlag (207 von 620 ms statt 276), und der Faktor
   schrumpft von 1.6 auf 1.2. Die Aussage bleibt, ihre Schaerfe nicht —
   deshalb hier der schlichte Vergleich mit den Zahlen daneben. */
check('Und erreicht ihre Spitze entsprechend spaeter',
    promptArg > argMax,
    `nach ${promptArg} ms statt nach ${argMax} ms`);
/* Der technische Haken der Entkopplung: die Kurve muss die LAENGERE Dauer
   kennen. Waere sie weiter auf 380 ms normiert, stuende die Aufforderung
   nach 380 ms fertig da und die restlichen 240 ms still — ein Plateau
   statt eines satteren Schlags. */
const beiKurz = R.bounce(R.COUNTDOWN_BOUNCE_MS, BOUNCE, R.COUNTDOWN_OVERSHOOT);
check('Nach der Countdown-Dauer ist sie noch mitten in der Bewegung',
    Math.abs(beiKurz - 1) > 0.05, `Faktor ${beiKurz.toFixed(3)} statt 1.000`);
check('GEGENPROBE: der Countdown selbst ist dann exakt fertig',
    R.bounce(R.COUNTDOWN_BOUNCE_MS, R.COUNTDOWN_BOUNCE_MS,
        R.COUNTDOWN_OVERSHOOT) === 1);
check('Der erste Sprung geht ueber die Ruhegroesse hinaus',
    spitze1.groesse > ruheGroesse * 1.3,
    `${spitze1.groesse.toFixed(0)} vs. ${ruheGroesse.toFixed(0)} px`);
check('Zwischen den Spruengen steht sie ruhig',
    Math.abs(tal.groesse - ruheGroesse) < ruheGroesse * 0.02,
    `${tal.groesse.toFixed(1)} px`);
check('Der zweite Sprung ist genauso gross wie der erste',
    Math.abs(spitze2.groesse - spitze1.groesse) < 1,
    `${spitze2.groesse.toFixed(1)} vs. ${spitze1.groesse.toFixed(1)} px`);
check('Danach blendet sie aus, statt hart zu verschwinden',
    nachZwei.sichtbar && nachZwei.alpha > 0 && nachZwei.alpha < 1,
    `Deckkraft ${nachZwei.alpha.toFixed(2)}`);
check('Und ist nach der Ausblende endgueltig weg',
    !weg.sichtbar && !spaeter.sichtbar,
    `${R.SERVE_PROMPT_BOUNCES * BOUNCE + R.SERVE_PROMPT_FADE_MS} ms nach Beginn`);
check('Auch nach sechs Sekunden pulsiert nichts mehr nach',
    !spaeter.sichtbar);

/* Der Meter darunter darf davon NICHT betroffen sein — er ist die einzige
   Rueckmeldung, warum ein Ton nicht aufschlaegt, und muss stehen bleiben,
   solange auf den Aufschlag gewartet wird. */
check('Der Zielzonen-Meter laeuft auch dann noch weiter',
    spaeter.rechtecke > 0, `${spaeter.rechtecke} gezeichnete Flaeche(n)`);

/* Die alten Pulskonstanten sind wirklich weg und nicht nur unbenutzt — sonst
   sucht beim naechsten Mal jemand am falschen Regler. */
check('Die alten Pulskonstanten sind entfernt',
    R.SERVE_PROMPT_PULSE_MS === undefined && R.SERVE_PROMPT_PULSE_MAX === undefined);

/* --- 3b. Und sie steht auf keinem Platz in einem Gesicht ------------------
 * Die Aufforderung ruft DIESELBE Methode wie der Countdown (dodgeHeads), war
 * aber nie gegen die Koepfe VERMESSEN worden — geprueft wurde bisher nur ihr
 * Zeitverhalten. Genau so entsteht eine Luecke: der Countdown ist mit 280 px
 * die auffaellige Anzeige und hat seine Probe (2b), die Aufforderung ist mit
 * 96 px die unauffaellige und hatte keine. Wer spaeter an SERVE_PROMPT_SIZE
 * dreht, faellt durch kein Netz.
 *
 * Gerechnet wird wie in 2b, nur mit dem Kasten aus drawServePrompt(): Breite
 * aus measureText, Hoehe aus SERVE_PROMPT_SIZE, Ausweichweg immer aus der
 * Spitze.
 *
 * DIE BREITE IST IM STUB GROB (feste Zeichenbreite, unabhaengig vom Grad).
 * Das genuegt hier, weil sie nur entscheidet, OB ein Kopf ueberhaupt
 * waagerecht im Weg steht — und bei zwei mittig stehenden Figuren, dem
 * unguenstigsten Fall, steht er das in jeder Breite. Die Aussage der Probe
 * ist die SENKRECHTE Lage, und die haengt an SERVE_PROMPT_SIZE und an der
 * Spitze, nicht an der Schrift.
 * ------------------------------------------------------------------------ */

/**
 * Die Lage der Aufforderung auf dem aktuellen Platz durchrechnen.
 * @param {number} faktor Groessenfaktor (1 = Ruhe, SERVE_PROMPT_SPITZE = Sprung)
 */
function aufforderungslage(faktor) {
    const p = renderer.viewport.toScreen(800, game.grenzen.midY, {});
    const size = R.SERVE_PROMPT_SIZE * p.scale;
    /* measureText ueber denselben Stub, den auch das Zeichnen benutzt —
       eine getippte Breite waere eine zweite Quelle. */
    const halb = zeichenprotokoll().ctx.measureText(R.SERVE_PROMPT_TEXT).width
        * R.SERVE_PROMPT_SPITZE / 2;
    const kasten = (f) => ({
        left: p.x - halb, right: p.x + halb,
        top: p.y - size * f * 0.5, bottom: p.y + size * f * 0.5,
        hoehe: size * f,
    });
    const koepfe = [
        renderer.headBox(800, game.paddleAndrea.y),
        renderer.headBox(800, game.paddleAlex.y),
    ];
    /* Gezeichnet wird IMMER mit dem aus der Spitze gerechneten Weg. */
    const weg = renderer.dodgeHeads(kasten(R.SERVE_PROMPT_SPITZE), koepfe,
        R.COUNTDOWN_DODGE_MAX * p.scale);

    const box = kasten(faktor);
    const tiefe = (k) => (box.right < k.left || box.left > k.right) ? 0
        : Math.max(0, Math.min(box.bottom + weg, k.bottom)
            - Math.max(box.top + weg, k.top));
    return {
        weg, hoehe: box.hoehe, band: koepfe[0].top - koepfe[1].bottom,
        ueber: tiefe(koepfe[0]) + tiefe(koepfe[1]), oben: box.top + weg,
    };
}

const jePlatzPrompt = [];
for (const name of Object.keys(game.PLAETZE)) {
    game.setzePlatz(name);
    const r = aufforderungslage(1);
    const s = aufforderungslage(R.SERVE_PROMPT_SPITZE);
    jePlatzPrompt.push({ name, band: r.band, hoehe: s.hoehe, weg: s.weg,
        ruhe: r.ueber, spitze: s.ueber, oben: s.oben });
}
game.setzePlatz(Object.keys(game.PLAETZE)[0]);
console.log('  "AUFSCHLAG!" je Platz (Band / im Sprung / Ueberdeckung Ruhe + Spitze):');
jePlatzPrompt.forEach(x => console.log(`    ${x.name.padEnd(6)} ${x.band.toFixed(0)} px / `
    + `${x.hoehe.toFixed(0)} px / ${x.ruhe.toFixed(0)} px + ${x.spitze.toFixed(0)} px`
    + `  (Weg ${x.weg.toFixed(0)} px)`));

check('Auf KEINEM Platz verdeckt "AUFSCHLAG!" einen Kopf — auch im Sprung nicht',
    jePlatzPrompt.every(x => x.ruhe === 0 && x.spitze === 0),
    jePlatzPrompt.map(x => `${x.name} ${x.ruhe.toFixed(0)}+${x.spitze.toFixed(0)} px`)
        .join(', '));
/* Der Unterschied zur Ziffer, und der Grund, warum hier ueberall 0 steht: der
   Schriftzug ist selbst im Sprung nur gut ein Drittel so hoch wie das freie
   Band. Auf dem Rasen fehlen der Ziffer 19 px — ihm bleiben ueber 170 uebrig.
   Steht diese Probe eines Tages auf Rot, ist SERVE_PROMPT_SIZE gewachsen. */
check('Sie passt dabei mit deutlicher Reserve zwischen die Koepfe',
    jePlatzPrompt.every(x => x.hoehe < x.band),
    jePlatzPrompt.map(x => `${x.name} ${(x.band - x.hoehe).toFixed(0)} px frei`).join(', '));
check('Und bleibt auf jedem Platz im Bild',
    jePlatzPrompt.every(x => x.oben > 0),
    jePlatzPrompt.map(x => `${x.name} y ${x.oben.toFixed(0)}`).join(', '));

/* --- 4. Der Einspiel-Hinweis ist verschwunden ---------------------------- *
 * Er stand fest im Bild, obwohl der Operator die Taste ohnehin kennt — und
 * das Publikum sieht eine Tastenbelegung. */
const banner = (() => {
    const { ctx, log } = zeichenprotokoll();
    const echt = renderer.ctx;
    renderer.ctx = ctx;
    try { renderer.drawWarmupBanner(match); } finally { renderer.ctx = echt; }
    return log.texte.map(t => t.text).join(' | ');
})();
console.log(`\nEinspiel-Banner: "${banner}"`);
check('Im Einspielen steht keine Tastenbelegung mehr im Bild',
    banner.indexOf('LEERTASTE') < 0 && banner.indexOf('ENTER') < 0, banner);
check('Der Banner selbst ist aber noch da',
    banner.length > 0, banner);

summary();
