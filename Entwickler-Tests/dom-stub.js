/* =============================================================================
 * DOM-STUB — gemeinsame Grundlage aller Entwickler-Tests
 *
 * app.js ist bewusst ein einziges Browser-File ohne Exporte. Um die Physik und
 * die Audio-Auswertung trotzdem in Node prüfen zu können, wird hier gerade so
 * viel Browser nachgebaut, dass app.js durchläuft und sich über
 * `window.KARAOKOVIC` ansprechen lässt.
 *
 * Benutzung in einem Test:
 *
 *     const { loadGame, el } = require('./dom-stub.js');
 *     const game = loadGame();
 *
 * Elemente werden pro ID zwischengespeichert. `el('btnLow').click()` löst
 * deshalb genau den Handler aus, den app.js registriert hat — damit lässt sich
 * auch das Onboarding testen.
 * ========================================================================== */

'use strict';

const noop = () => {};

/** Canvas-Kontext, der jeden Zeichenbefehl schluckt. */
const fakeCtx = new Proxy({}, {
    get: (t, p) => (p === 'canvas' ? {} : (typeof p === 'string' ? noop : undefined)),
    set: () => true
});

/** @type {Map<string, Object>} ID -> Element, damit Handler auffindbar bleiben. */
const elements = new Map();

/**
 * Ein (zwischengespeichertes) Pseudo-Element.
 * @param   {string} id
 * @returns {Object}
 */
function el(id) {
    let node = elements.get(id);
    if (node) return node;
    node = {
        id,
        handlers: {},
        addEventListener(ev, fn) { this.handlers[ev] = fn; },
        removeEventListener(ev) { delete this.handlers[ev]; },
        /** Registrierten Click-Handler auslösen. @returns {boolean} */
        click() {
            if (!this.handlers.click) return false;
            this.handlers.click();
            return true;
        },
        classList: { add: noop, remove: noop, contains: () => false },
        dataset: {},
        style: {},
        getContext: () => fakeCtx,
        width: 1600,
        height: 900,
        innerText: '',
        disabled: false
    };
    elements.set(id, node);
    return node;
}

/**
 * Globale Variable setzen — auch dann, wenn Node sie bereits als
 * schreibgeschützte Eigenschaft mitbringt (`navigator` und `performance` sind
 * ab Node 21 nur noch Getter; eine einfache Zuweisung wirft in strict mode).
 * @param {string} name
 * @param {*}      value
 */
function defineGlobal(name, value) {
    Object.defineProperty(globalThis, name, {
        value, writable: true, configurable: true, enumerable: true
    });
}

defineGlobal('document', {
    getElementById: el,
    createElement: (tag) => el(`<${tag}>`)
});
defineGlobal('window', {
    addEventListener: noop,
    removeEventListener: noop,
    innerWidth: 1600,
    innerHeight: 900
});
defineGlobal('Image', class {
    constructor() { this.complete = false; this.naturalHeight = 0; }
    set src(v) { this._src = v; }
    get src() { return this._src; }
});
defineGlobal('navigator', {
    mediaDevices: { getUserMedia: async () => { throw new Error('kein Mikrofon im Test'); } }
});
defineGlobal('requestAnimationFrame', noop);
defineGlobal('alert', noop);
if (typeof globalThis.performance === 'undefined') {
    defineGlobal('performance', { now: () => Date.now() });
}

/**
 * Spielcode laden und die Spielinstanz zurückgeben.
 *
 * Seit ARENA-1 gibt es zwei Fassungen nebeneinander: app.js (V41, eingefroren)
 * und app-arena.js (drei Plätze, hier wird weitergebaut). Ohne Argument wird
 * weiterhin app.js geladen — alle bestehenden Tests bleiben damit unverändert,
 * neue Tests für die Arena-Fassung geben die Datei ausdrücklich an.
 *
 * @param   {string} [datei] Pfad relativ zu diesem Verzeichnis.
 * @returns {Object} window.KARAOKOVIC
 */
function loadGame(datei = '../app.js') {
    require(require('path').join(__dirname, datei));
    return global.window.KARAOKOVIC;
}

/* --- kleine Testhilfen, damit jeder Test gleich aussieht ------------------ */

let failures = 0;

/**
 * Eine Bedingung prüfen und das Ergebnis ausgeben.
 * @param   {string}  name
 * @param   {boolean} ok
 * @param   {string}  [detail] Zusatzinfo, wird immer mit ausgegeben.
 * @returns {boolean}
 */
function check(name, ok, detail) {
    if (!ok) failures++;
    console.log(`${ok ? 'OK  ' : 'FAIL'}  ${name}${detail ? `: ${detail}` : ''}`);
    return ok;
}

/**
 * Abschlusszeile ausgeben und den Prozess-Exitcode setzen.
 * Ohne das meldet ein fehlgeschlagener Test dem Runner trotzdem Erfolg.
 */
function summary() {
    if (failures === 0) {
        console.log('\nAlles in Ordnung.');
    } else {
        console.log(`\n${failures} Prüfung(en) fehlgeschlagen.`);
        process.exitCode = 1;
    }
}

module.exports = { el, loadGame, check, summary, fakeCtx };
