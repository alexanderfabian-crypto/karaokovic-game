/* =============================================================================
 * TEST: Das Operator-Panel im eigenen Fenster (ARENA-25)
 *
 * DER BEFUND HINTER DEM SPRINT: ARENA-24 hat die Diagnose aus dem Canvas ins
 * DOM geholt. Das nimmt sie aus dem BILD — aber nicht vom AUSGANG. Ein <div>
 * im Spielfenster liegt auf demselben Bildschirm, und der geht im Vollbild auf
 * die LED-Wand. Wer das Panel dort einschaltet, zeigt es dem Saal.
 *
 * Geprueft wird:
 *   1. Beide Fehlwege (Popup-Sperre, nicht beschreibbares Dokument) enden im
 *      Protokoll und im Rueckfall — nie im Nichts.
 *   2. Das Fenster traegt einen NAMEN, damit ein Neuladen dasselbe Fenster neu
 *      beschreibt statt ein zweites zu oeffnen.
 *   3. Solange es steht, bleibt das eingebettete Panel aus — auch bei
 *      Ctrl+Shift+M. Wird es geschlossen, gilt der Schalter wieder.
 *   4. Beide Panels bekommen DENSELBEN Schnappschuss.
 *   5. Der Waechter im Fenster meldet, wenn das Spiel nicht mehr sendet.
 *
 * Der Stub kennt kein window.open und kein zweites Dokument — beides wird hier
 * gebaut. Geprueft wird damit die ENTSCHEIDUNG, nicht Chromes Popup-Politik;
 * die gehoert auf den Show-Rechner (OPERATOR-MANUAL.md, 3.2).
 *
 * Start: node Entwickler-Tests/test-operatorfenster.js
 * ========================================================================== */

'use strict';

const { loadGame, check, summary } = require('./dom-stub.js');
const game = loadGame('../app-arena.js');
const OP = game.OperatorPanel;
const R = game.Renderer;

/* --- Ein Zweitfenster aus Pappe ------------------------------------------ */

/** Ein Knoten, der genug kann fuer das, was OperatorPanel mit ihm tut. */
function knoten(doc, tag) {
    return {
        tag, id: '', className: '', textContent: '', style: {},
        attribute: {}, kinder: [], ownerDocument: doc,
        appendChild(k) { this.kinder.push(k); k.eltern = this; return k; },
        removeChild(k) { this.kinder.splice(this.kinder.indexOf(k), 1); return k; },
        setAttribute(n, v) { this.attribute[n] = v; },
        getAttribute(n) { return n in this.attribute ? this.attribute[n] : null; },
        get firstChild() { return this.kinder[0] || null; },
    };
}

/** Ein Dokument aus Pappe. `beschreibbar: false` spielt den SecurityError. */
function pappDokument(beschreibbar) {
    const doc = { title: '', erzeugt: [] };
    doc.createElement = (tag) => {
        if (!beschreibbar) { const e = new Error('blockiert'); e.name = 'SecurityError'; throw e; }
        const n = knoten(doc, tag);
        doc.erzeugt.push(n);
        return n;
    };
    doc.head = knoten(doc, 'head');
    doc.body = knoten(doc, 'body');
    doc.getElementById = (id) => doc.erzeugt.find((n) => n.id === id) || null;
    /** Alle Knoten mit einer Klasse — reicht fuer den Waechter. */
    doc.querySelector = (sel) => {
        const klasse = sel.replace('.', '');
        return doc.erzeugt.find((n) => (n.className || '').split(' ').includes(klasse)) || null;
    };
    return doc;
}

let letztesFenster = null;
/** window.open ersetzen. `art`: 'ok' | 'blockiert' | 'wirft' | 'stumm'. */
function fensterAttrappe(art) {
    global.window.open = (url, name, masse) => {
        if (art === 'wirft') { const e = new Error('nope'); e.name = 'SecurityError'; throw e; }
        if (art === 'blockiert') return null;
        letztesFenster = {
            url, name, masse, closed: false,
            document: pappDokument(art !== 'stumm'),
            fokussiert: 0,
            focus() { this.fokussiert++; },
            close() { this.closed = true; },
        };
        return letztesFenster;
    };
}

/** Protokollzeilen seit einer Marke. */
const marke = () => game.Protokoll.zeilen.length;
const seit = (n) => game.Protokoll.zeilen.slice(n).join('\n');

/* --- 1. Die Popup-Sperre endet nicht im Nichts --------------------------- */
let ab = marke();
fensterAttrappe('blockiert');
check('Eine Popup-Sperre liefert kein Fenster',
    game.operatorFensterOeffnen() === false);
check('Und steht im Protokoll', /OPERATOR.*blockiert/.test(seit(ab)), 
    seit(ab).split('\n').pop());
check('Der Rueckfall ist das Panel im Spielfenster — es bleibt schaltbar',
    game.operatorFensterOffen() === false);

ab = marke();
fensterAttrappe('wirft');
check('Ein werfendes window.open ebenso',
    game.operatorFensterOeffnen() === false);
check('Auch das steht im Protokoll', /OPERATOR.*abgelehnt/.test(seit(ab)));

/* Der Fall, den about:blank verhindern SOLL: Chrome vererbt die Herkunft
   doch nicht, das Dokument ist fremd und nicht beschreibbar. */
ab = marke();
fensterAttrappe('stumm');
check('Ein nicht beschreibbares Dokument gilt als Fehlschlag',
    game.operatorFensterOeffnen() === false);
check('Mit Grund im Protokoll',
    /OPERATOR.*nicht beschreibbar/.test(seit(ab)));
check('Und das halb offene Fenster wird wieder geschlossen',
    letztesFenster.closed === true);

/* --- 2. Der gute Fall ---------------------------------------------------- */
ab = marke();
fensterAttrappe('ok');
check('Mit erlaubtem Popup steht das Fenster',
    game.operatorFensterOeffnen() === true);
check('Und es ist offen', game.operatorFensterOffen() === true);
check('Das Oeffnen ist protokolliert', /OPERATOR.*Fenster offen/.test(seit(ab)));

/* DER NAME ist der Punkt: ohne ihn oeffnet jedes Neuladen des Spiels ein
   weiteres Fenster, und nach drei Ladungen stehen vier herum — drei davon
   eingefroren. */
check('Das Fenster traegt einen festen Namen',
    letztesFenster.name === OP.FENSTER_NAME, letztesFenster.name);
check('Und Masse — ohne sie macht Chrome einen Reiter statt eines Fensters',
    /width=\d+/.test(letztesFenster.masse), letztesFenster.masse);
check('Geoeffnet wird about:blank, nicht eine zweite Datei',
    letztesFenster.url === 'about:blank', letztesFenster.url);
check('Das Dokument bekommt einen Titel',
    letztesFenster.document.title === OP.FENSTER_TITEL);

/* --- 3. Stylesheet: EINE Quelle, je Dokument einmal ---------------------- */
const stile = letztesFenster.document.erzeugt.filter((n) => n.tag === 'style');
check('Das Stylesheet liegt im Zweitfenster', stile.length === 1,
    `${stile.length} <style>`);
check('Und es ist dasselbe wie im Spielfenster',
    stile[0].textContent === OP.CSS);
OP.stilEinfuegen(letztesFenster.document);
check('Ein zweiter Aufruf legt kein zweites daneben',
    letztesFenster.document.erzeugt.filter((n) => n.tag === 'style').length === 1);

/* --- 4. Der Waechter liegt IM Fenster ------------------------------------ */
const skripte = letztesFenster.document.erzeugt.filter((n) => n.tag === 'script');
check('Ein Waechter-Skript liegt im Zweitfenster', skripte.length === 1);
check('Es traegt die Grenze mit', 
    skripte[0].textContent.includes(String(OP.TICK_GRENZE_MS)));
/* Er muss IM Fenster laufen: ein Timer, den der Oeffner stellt, stirbt mit
   dem Oeffner — und schwiege ausgerechnet dann, wenn das Spiel weg ist. */
check('Und haengt am Dokument des Fensters, nicht am Spiel',
    letztesFenster.document.body.kinder.includes(skripte[0]));

/* --- 5. Die Verriegelung ------------------------------------------------- */
R.SHOW_AUDIO_METER = true;
let lage = game.panelLage();
check('Bei offenem Fenster bleibt das eingebettete Panel aus — trotz Schalter',
    lage.sichtbar === false);
/* Aber es wird trotzdem gerechnet: das Fenster zeigt immer etwas. */
check('Die Lampen werden dennoch gefuellt', lage.e[0].wert !== '',
    `E-01: "${lage.e[0].wert}"`);

letztesFenster.closed = true;
check('Ein geschlossenes Fenster gibt den Schalter wieder frei',
    game.panelLage().sichtbar === true);
letztesFenster.closed = false;

/* Zweites Oeffnen holt nach vorn, statt ein zweites Fenster aufzumachen. */
const vorher = letztesFenster;
check('Ein zweiter Aufruf oeffnet kein zweites Fenster',
    game.operatorFensterOeffnen() === true && letztesFenster === vorher);
check('Sondern holt das vorhandene nach vorn', vorher.fokussiert >= 1,
    `${vorher.fokussiert}x focus()`);

/* --- 6. Das Fenster-Panel zeigt IMMER etwas ------------------------------ */
const fensterPanel = game.panelFenster;
check('Das Panel im Fenster wurde wirklich gebaut', fensterPanel.aktiv === true);
check('Es ignoriert den Schalter', fensterPanel.immerSichtbar === true);
R.SHOW_AUDIO_METER = false;
lage = game.panelLage();
fensterPanel.zeichne(lage);
check('Und steht auch bei ausgeschaltetem Panel sichtbar da',
    /\ban\b/.test(fensterPanel.el.className), fensterPanel.el.className);
check('Es traegt seine eigene Grundklasse',
    /fenster/.test(fensterPanel.el.className));

/* --- 7. Lebenszeichen ---------------------------------------------------- */
fensterPanel.el.setAttribute('data-tick', '');
for (let i = 0; i < OP.TICK_FRAMES; i++) fensterPanel.zeichne(lage);
const tick1 = fensterPanel.el.getAttribute('data-tick');
check('Nach TICK_FRAMES Frames steht ein Lebenszeichen im Element',
    tick1 !== '' && tick1 !== null, `data-tick="${tick1}"`);
for (let i = 0; i < OP.TICK_FRAMES; i++) fensterPanel.zeichne(lage);
check('Und es zaehlt weiter', fensterPanel.el.getAttribute('data-tick') !== tick1,
    `${tick1} -> ${fensterPanel.el.getAttribute('data-tick')}`);

/* --- 8. Der Waechter selbst --------------------------------------------- *
 * Er wird als Text in ein fremdes Dokument gelegt; hier laeuft er gegen ein
 * Pappdokument mit einer Uhr, die der Test stellt. */
{
    const doc = pappDokument(true);
    const panel = doc.createElement('div');
    panel.className = 'op-panel fenster';
    const meldung = doc.createElement('div');
    meldung.id = 'op-tot';
    meldung.style.display = 'none';
    /* Der Waechter liest die Umgebung seines Fensters. */
    let jetzt = 1000;
    let takt = null;
    const echteUhr = globalThis.performance;
    const echtesDoc = globalThis.document;
    const echterTakt = globalThis.setInterval;
    Object.defineProperty(globalThis, 'performance',
        { value: { now: () => jetzt }, configurable: true });
    Object.defineProperty(globalThis, 'document',
        { value: doc, configurable: true });
    Object.defineProperty(globalThis, 'setInterval',
        { value: (fn) => { takt = fn; }, configurable: true });

    OP.WAECHTER(OP.TICK_GRENZE_MS);

    /* Vor dem ersten Puls ist nichts tot — das Fenster kann offen sein,
       bevor der Loop laeuft (Onboarding). */
    jetzt += OP.TICK_GRENZE_MS * 5;
    takt();
    check('Vor dem ersten Lebenszeichen meldet der Waechter nichts',
        meldung.style.display === 'none', meldung.style.display);

    panel.setAttribute('data-tick', '1');
    takt();
    check('Nach dem ersten Puls ist er ruhig', meldung.style.display === 'none');

    jetzt += OP.TICK_GRENZE_MS + 1;
    takt();
    check('Bleibt der Puls aus, meldet er es',
        meldung.style.display === 'block', meldung.style.display);
    check('Und graut die alten Zahlen aus, statt sie zu loeschen',
        /\btot\b/.test(panel.className) && panel.className.includes('fenster'),
        panel.className);

    panel.setAttribute('data-tick', '2');
    takt();
    check('Ein neuer Puls hebt die Meldung wieder auf',
        meldung.style.display === 'none' && !/\btot\b/.test(panel.className));

    Object.defineProperty(globalThis, 'performance', { value: echteUhr, configurable: true });
    Object.defineProperty(globalThis, 'document', { value: echtesDoc, configurable: true });
    Object.defineProperty(globalThis, 'setInterval', { value: echterTakt, configurable: true });
}

/* --- 9. Der Hotkey ------------------------------------------------------- */
letztesFenster.closed = true;
game.panelFenster = null;
fensterAttrappe('ok');
game.input.handleKeyDown({ code: 'KeyO', ctrlKey: true, shiftKey: true,
    preventDefault() {} });
game.input.handleKeyUp({ code: 'KeyO' });
check('Ctrl+Shift+O oeffnet das Fenster', game.operatorFensterOffen() === true);

summary();
