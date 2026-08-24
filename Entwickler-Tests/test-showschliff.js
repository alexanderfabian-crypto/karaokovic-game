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

/* --- 2b. Und bleibt trotzdem von den Gesichtern weg ----------------------
 * Die Ziffer steht in der Bildmitte — genau dort, wo auch Andreas Kopf steht,
 * wenn sie mittig singt. Sie weicht deshalb aus (dodgeHeads). Der staerkere
 * Ueberschwinger aendert daran drei Dinge, die alle stimmen muessen:
 *
 *   - Der Ausweichweg wird aus der SPITZE gerechnet, nicht aus der jeweiligen
 *     Groesse. Nur so ist er waehrend der ganzen Federung derselbe; sonst
 *     spraenge die Ziffer genau im Einsprung zur Seite.
 *   - In Ruhe — also fast die gesamte Anzeigedauer — steht sie frei.
 *   - Im groessten Moment darf sie die Kopfbox oben streifen. Das ist der
 *     Preis der Wucht und ausdruecklich gewollt; er ist hier beziffert,
 *     damit ein weiteres Aufdrehen auffaellt und nicht durchrutscht.
 *
 * headBox() und dodgeHeads() rechnen rein geometrisch und brauchen kein
 * geladenes Bild — deshalb geht diese Probe in Node, mit Skalierung 1 und
 * ohne die Streuung eines echten Browserfensters.
 * ------------------------------------------------------------------------ */

/**
 * Die Lage der Ziffer auf dem aktuellen Platz durchrechnen.
 * @param {number} faktor Groessenfaktor (1 = Ruhe, COUNTDOWN_SPITZE = Einsprung)
 */
function ziffernlage(faktor) {
    const p = renderer.viewport.toScreen(800, game.grenzen.midY, {});
    const gross = R.COUNTDOWN_SIZE * p.scale * faktor;
    const box = {
        left: p.x - gross * 0.4, right: p.x + gross * 0.4,
        top: p.y - gross * 0.4, bottom: p.y + gross * 0.4,
    };
    /* Beide Figuren mittig — der unguenstigste Fall: dann stehen Ziffer und
       Kopf uebereinander. */
    const koepfe = [
        renderer.headBox(800, game.paddleAndrea.y),
        renderer.headBox(800, game.paddleAlex.y),
    ];
    /* Gezeichnet wird IMMER mit dem aus der Spitze gerechneten Weg. */
    const spitzeGross = R.COUNTDOWN_SIZE * p.scale * R.COUNTDOWN_SPITZE;
    const weg = renderer.dodgeHeads({
        left: p.x - spitzeGross * 0.4, right: p.x + spitzeGross * 0.4,
        top: p.y - spitzeGross * 0.4, bottom: p.y + spitzeGross * 0.4,
    }, koepfe, R.COUNTDOWN_DODGE * p.scale);

    /* Wie tief ragt die verschobene Box in einen Kopf hinein? */
    const tiefe = (k) => {
        if (box.right < k.left || box.left > k.right) return 0;
        const oben = Math.max(box.top + weg, k.top);
        const unten = Math.min(box.bottom + weg, k.bottom);
        return Math.max(0, unten - oben);
    };
    return {
        weg, hoehe: gross * 0.8,
        kopfhoehe: koepfe[0].bottom - koepfe[0].top,
        inAndrea: tiefe(koepfe[0]),
        inAlex: tiefe(koepfe[1]),
    };
}

const lageRuhe = ziffernlage(1);
const lageSpitze = ziffernlage(R.COUNTDOWN_SPITZE);
const anteil = lageSpitze.inAndrea / lageSpitze.kopfhoehe;

console.log(`\nZiffer: Ruhe ${lageRuhe.hoehe.toFixed(0)} px, Einsprung `
    + `${lageSpitze.hoehe.toFixed(0)} px, Ausweichen ${lageSpitze.weg} px`);
console.log(`  Ueberdeckung der Kopfbox: Ruhe ${lageRuhe.inAndrea.toFixed(0)} px, `
    + `Einsprung ${lageSpitze.inAndrea.toFixed(0)} px `
    + `(${(anteil * 100).toFixed(0)} % der Kopfhoehe)`);

check('Sie weicht Andreas Kopf ueberhaupt aus', lageSpitze.weg !== 0,
    `${lageSpitze.weg} px`);
check('In Ruhe steht sie voellig frei',
    lageRuhe.inAndrea === 0 && lageRuhe.inAlex === 0,
    `${lageRuhe.inAndrea.toFixed(1)} / ${lageRuhe.inAlex.toFixed(1)} px`);
check('Im Einsprung streift sie hoechstens den Scheitel',
    anteil < 0.25, `${(anteil * 100).toFixed(0)} % der Kopfhoehe`);
check('Die hintere Figur bleibt dabei unberuehrt',
    lageSpitze.inAlex === 0, `${lageSpitze.inAlex.toFixed(1)} px`);

/* GEGENPROBE: warum 5.0 und nicht mehr. Bei 6.0 waechst genau diese
   Ueberdeckung ueber das Vertretbare — das ist die Grenze, an der die
   Entscheidung haengt. */
R.COUNTDOWN_OVERSHOOT = 6.0;
let spitze6 = 1;
for (let ms = 0; ms <= R.COUNTDOWN_BOUNCE_MS; ms += 1) {
    spitze6 = Math.max(spitze6, R.countdownBounce(ms));
}
const echteSpitze = R.COUNTDOWN_SPITZE;
R.COUNTDOWN_SPITZE = spitze6;
const lage6 = ziffernlage(spitze6);
R.COUNTDOWN_SPITZE = echteSpitze;
R.COUNTDOWN_OVERSHOOT = NEU;
const anteil6 = lage6.inAndrea / lage6.kopfhoehe;
console.log(`  zum Vergleich bei 6.0: ${lage6.inAndrea.toFixed(0)} px `
    + `(${(anteil6 * 100).toFixed(0)} %)`);
check('GEGENPROBE: bei 6.0 schoebe sie sich spuerbar weiter ins Gesicht',
    anteil6 > anteil * 1.4,
    `${(anteil6 * 100).toFixed(0)} % statt ${(anteil * 100).toFixed(0)} %`);

/* Und auf allen drei Plaetzen — die Kameras unterscheiden sich, die Regel
 * darf es nicht.
 *
 * ALTBEFUND, NICHT AUS DIESEM SPRINT: auf dem Sandplatz liegt die ruhige
 * Ziffer 42 px auf der Kopfbox der HINTEREN Figur. Nachgerechnet mit dem
 * alten Ueberschwinger 3.2 kommt exakt derselbe Wert heraus — der Grund ist
 * nicht die Wucht, sondern der feste Ausweichweg COUNTDOWN_DODGE = 170 px:
 * dodgeHeads() probiert nur "gar nicht / hoch / runter" und nimmt bei zwei
 * belegten Richtungen "hoch" als kleineres Uebel. Auf Sand steht die hintere
 * Figur genau dort. Ein Ausweichen um das noetige Mass statt um einen festen
 * Betrag wuerde es loesen; das ist eine eigene Entscheidung und steht hier
 * nur als Messwert, damit es nicht unbemerkt schlimmer wird.
 * ------------------------------------------------------------------------ */
const jePlatz = [];
for (const name of Object.keys(game.PLAETZE)) {
    game.setzePlatz(name);
    const l = ziffernlage(R.COUNTDOWN_SPITZE);
    const r = ziffernlage(1);
    jePlatz.push({ name, ruheAndrea: r.inAndrea, ruheAlex: r.inAlex,
        anteil: l.inAndrea / l.kopfhoehe });
}
game.setzePlatz(Object.keys(game.PLAETZE)[0]);
console.log('  je Platz (Ruhe: Andrea/Alex, Einsprung: Anteil Kopf): '
    + jePlatz.map(x => `${x.name} ${x.ruheAndrea.toFixed(0)}/`
        + `${x.ruheAlex.toFixed(0)} px, ${(x.anteil * 100).toFixed(0)} %`).join('; '));

check('Auf keinem Platz verdeckt die ruhige Ziffer Andreas Gesicht',
    jePlatz.every(x => x.ruheAndrea === 0),
    jePlatz.filter(x => x.ruheAndrea > 0).map(x => x.name).join(', ') || 'alle frei');
check('Und nirgends verdeckt der Einsprung mehr als ein Viertel ihres Kopfes',
    jePlatz.every(x => x.anteil < 0.25),
    jePlatz.map(x => `${x.name} ${(x.anteil * 100).toFixed(0)} %`).join(', '));
check('Der Altbefund auf Sand wird nicht groesser (Messmarke, kein Soll)',
    jePlatz.every(x => x.ruheAlex <= 45),
    jePlatz.map(x => `${x.name} ${x.ruheAlex.toFixed(0)} px`).join(', '));

/* --- 3. "AUFSCHLAG!" springt zweimal und ist dann weg --------------------- *
 * Gemessen wird an dem, was gezeichnet wird: der Schriftgrad im Text-Log
 * gibt die gefederte Groesse, die Deckkraft den Ausblendteil. */
const BOUNCE = R.SERVE_PROMPT_BOUNCE_MS;
const szene = {
    match,
    andreaX: physics.currentX,
    paddleAndrea: game.paddleAndrea,
    paddleAlex: game.paddleAlex,
    aufschlagAnzeige: { aktiv: true, zentriert: false, prozent: 0.72 },
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
const spitze1 = aufforderung(argMax);
const tal = aufforderung(BOUNCE - 1);
const spitze2 = aufforderung(BOUNCE + argMax);
const nachZwei = aufforderung(2 * BOUNCE + 10);
const weg = aufforderung(2 * BOUNCE + R.SERVE_PROMPT_FADE_MS + 10);
const spaeter = aufforderung(6000);

console.log(`\nAufforderung: 1. Sprung ${spitze1.groesse.toFixed(0)} px, `
    + `dazwischen ${tal.groesse.toFixed(0)} px, 2. Sprung `
    + `${spitze2.groesse.toFixed(0)} px, danach ${weg.sichtbar ? 'noch da' : 'weg'}`);

check('Sie springt genau zweimal', R.SERVE_PROMPT_BOUNCES === 2,
    `${R.SERVE_PROMPT_BOUNCES}`);
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
