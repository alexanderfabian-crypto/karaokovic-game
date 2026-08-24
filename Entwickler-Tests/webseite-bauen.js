/* =============================================================================
 * Die Webseite bauen: aus dem Projekt wird der Ordner `docs/`.
 *
 *   node Entwickler-Tests/webseite-bauen.js
 *
 * GitHub Pages liefert genau diesen Ordner aus (Einstellung: Branch `main`,
 * Ordner `/docs`). Alles, was NICHT hier landet, ist auch nicht im Netz.
 *
 * Warum ein eigener Ordner und nicht einfach das Projektverzeichnis?
 *
 *   1. Die Startseite soll ARENA-1 sein. Pages liefert unter `/` immer
 *      `index.html` aus — und `index.html` ist im Projekt die eingefrorene
 *      Fassung V41, an der laut Vorgabe nicht gebaut wird. Hier wird sie
 *      deshalb KOPIERT und umbenannt, im Projekt bleibt sie unangetastet.
 *   2. Es kommt nur ins Netz, was das Spiel wirklich braucht. Die
 *      Übergabeprotokolle, die Entwickler-Tests, die Retusche-Skripte, die
 *      `*_ORIGINAL.png` und `Benni_Kopf.png` bleiben draußen — sie werden
 *      nicht geladen, und Produktionsdetails gehören nicht auf eine
 *      öffentliche Seite.
 *
 * Die Bilderliste wird aus dem Spielcode GELESEN, nicht gepflegt. Eine
 * getippte Liste wäre nach dem ersten neuen Bild falsch, und der Fehler fiele
 * erst dem Tester auf.
 *
 * Der Ordner wird bei jedem Lauf frisch erzeugt. Nie von Hand darin ändern:
 * der nächste Lauf wirft es weg.
 * ========================================================================== */

'use strict';

const fs = require('fs');
const path = require('path');

const WURZEL = path.join(__dirname, '..');
const ZIEL = path.join(WURZEL, 'docs');

/**
 * Alle Bilddateien, die ein Skript zur Laufzeit lädt.
 * @param   {string} datei Dateiname im Projektstamm
 * @returns {string[]}
 */
function assetsAus(datei) {
    const text = fs.readFileSync(path.join(WURZEL, datei), 'utf8');
    const treffer = text.match(/'[^']*\.(?:png|jpg)'|"[^"]*\.(?:png|jpg)"/g) || [];
    return treffer.map((s) => s.slice(1, -1));
}

/* --- Was ausgeliefert wird ------------------------------------------------ *
 * Beide Fassungen kommen mit: ARENA-1 als Startseite, V41 daneben zum
 * Vergleich. `arena.html` liegt zusätzlich unter seinem eigenen Namen, damit
 * ein bereits verschickter Link darauf nicht ins Leere läuft.
 * ------------------------------------------------------------------------- */
const SEITEN = [
    ['arena.html', 'index.html'],   // Startseite = ARENA-1
    ['arena.html', 'arena.html'],
    ['index.html', 'v41.html'],     // die eingefrorene Fassung V41
];
const SKRIPTE = ['app-arena.js', 'app.js'];

const bilder = [...new Set([...assetsAus('app-arena.js'), ...assetsAus('app.js')])].sort();

/**
 * Bilder, deren Datei fehlen DARF.
 *
 * Gelesen aus derselben Quelle, die auch das Spiel benutzt: der Liste
 * `OPTIONAL` im AssetManager. Eine zweite, hier gepflegte Liste waere genau
 * die Art Kopie, die beim naechsten Nachliefern auseinanderlaeuft.
 * @returns {string[]} Dateinamen
 */
function optionaleAssets() {
    const text = fs.readFileSync(path.join(WURZEL, 'app-arena.js'), 'utf8');
    const block = text.match(/this\.OPTIONAL\s*=\s*\[([^\]]*)\]/);
    if (!block) return [];
    const schluessel = block[1].match(/'([^']+)'/g) || [];
    return schluessel.map((s) => {
        const key = s.slice(1, -1);
        const zeile = text.match(
            new RegExp(key + "\\s*:\\s*'([^']+\\.(?:png|jpg))'"));
        return zeile ? zeile[1] : null;
    }).filter(Boolean);
}
const optionaleBilder = optionaleAssets();

/* --- Bauen ---------------------------------------------------------------- */
fs.rmSync(ZIEL, { recursive: true, force: true });
fs.mkdirSync(ZIEL, { recursive: true });

for (const [quelle, name] of SEITEN) {
    fs.copyFileSync(path.join(WURZEL, quelle), path.join(ZIEL, name));
}
for (const datei of [...SKRIPTE, ...bilder]) {
    const von = path.join(WURZEL, datei);
    /* Noch nicht gelieferte Bilder halten den Bau nicht auf — siehe
       `optionaleBilder` oben. Gemeldet werden sie unten trotzdem. */
    if (!fs.existsSync(von)) continue;
    fs.copyFileSync(von, path.join(ZIEL, datei));
}

/* Ohne diese Datei schickt GitHub Pages alles durch Jekyll. Das braucht hier
   niemand, kostet bei jedem Push Zeit und schluckt Dateien mit Unterstrich. */
fs.writeFileSync(path.join(ZIEL, '.nojekyll'), '');

/* --- Bericht -------------------------------------------------------------- */

let summe = 0;
for (const d of fs.readdirSync(ZIEL)) summe += fs.statSync(path.join(ZIEL, d)).size;

console.log(`docs/ neu gebaut — ${fs.readdirSync(ZIEL).length} Dateien, `
    + `${(summe / 1024 / 1024).toFixed(1)} MB`);
console.log(`  Startseite  index.html  -> ARENA-1 (drei Plätze)`);
console.log(`  daneben     v41.html    -> V41 (nur Hartplatz)`);
console.log(`  Bilder      ${bilder.length} aus dem Spielcode gelesen`);

/* Gegenprobe: fehlt ein PFLICHTbild, ist die Seite im Netz kaputt — und zwar
   erst sichtbar beim Tester. Deshalb hier hart abbrechen statt nur warnen.
   Die als optional gefuehrten Dateien sind davon ausgenommen: fuer sie hat
   der Spielcode einen Rueckfall, und ein Abbruch wuerde die ganze Seite
   blockieren, bis die Grafik liefert. */
const fehlend = bilder.filter((b) =>
    !optionaleBilder.includes(b) && !fs.existsSync(path.join(ZIEL, b)));
const offen = optionaleBilder.filter((b) => !fs.existsSync(path.join(ZIEL, b)));
if (offen.length) {
    console.log(`  noch nicht geliefert (Rückfall greift): ${offen.join(', ')}`);
}
if (fehlend.length) {
    console.error(`FEHLER: ${fehlend.length} Bild(er) fehlen: ${fehlend.join(', ')}`);
    process.exitCode = 1;
}
