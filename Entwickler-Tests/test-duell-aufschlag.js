/* =============================================================================
 * TEST: Wessen Stimme lenkt den Aufschlag? (nur Arena-Fassung)
 *
 * Der Fehler, der diesen Test veranlasst hat: `triggerServe()` las die Tonhöhe
 * fest aus Spieler 1s Eingang. Solange Alex eine KI war, gab es nur eine Stimme
 * im Raum und das fiel nicht auf. Im Duell schlug Alex dagegen mit ANDREAS
 * letztem Ton auf — sein Ball flog dorthin, wohin sie zuletzt gesungen hatte.
 *
 * Der Fehler hatte zwei Hälften, und dieser Test prüft beide getrennt:
 *
 *   1. Falscher EINGANG    — `audio` statt `audio2`.
 *   2. Falscher STIMMUMFANG — die Abbildung Ton -> Feldposition ist je Spieler
 *      kalibriert. Ohne den zweiten Parameter wurde Alex' Tonhöhe durch Andreas
 *      Umfang gerechnet; der Ball wäre selbst bei richtigem Eingang schief
 *      geflogen.
 *
 * Damit beide Hälften sichtbar werden, bekommen die Spieler ABSICHTLICH
 * verschiedene Stimmumfänge UND verschiedene anliegende Töne. Jede der vier
 * Kombinationen (richtiger/falscher Eingang x richtiger/falscher Umfang) ergibt
 * dann eine andere Zielposition.
 *
 * Geprüft wird die tatsächliche Flugrichtung des Balles, nicht ein Zwischen-
 * wert: aus `vx`/`vy` lässt sich der Zielpunkt exakt zurückrechnen, weil
 * triggerServe() die Geschwindigkeit genau auf diesen Punkt ausrichtet.
 *
 * Start: node Entwickler-Tests/test-duell-aufschlag.js
 * ========================================================================== */

'use strict';

const { loadGame, check, summary } = require('./dom-stub.js');
const game = loadGame('../app-arena.js');
const { audio, audio2, match, physics, PLAYER, MODE } = game;

const G = game.grenzen;
const COURT_HEIGHT = G.bottom - G.top;

/* Duell-Modus: nur so greift die Fallunterscheidung in serverAudio(). */
game.config.mode = MODE.VERSUS;

/* Deutlich verschiedene Umfänge. Derselbe Ton landet dadurch je nach
   Kalibrierung an ganz anderer Stelle im Feld. */
game.setVoiceRange(PLAYER.ANDREA, 110, 330);
game.setVoiceRange(PLAYER.ALEX, 80, 240);

const TON_ANDREA = 190;   // liegt an Spieler 1s Eingang
const TON_ALEX = 150;     // liegt an Spieler 2s Eingang

/**
 * Zielpunkt des Aufschlags, wie ihn triggerServe() berechnen SOLLTE.
 * Spiegelt die Klemmung auf das Feld aus triggerServe() wider.
 * @param   {number} freq
 * @param   {string} player Wert aus PLAYER
 * @returns {number} X in Weltkoordinaten
 */
function erwartetesZiel(freq, player) {
    const tx = physics.freqToQuantizedX(freq, player);
    return Math.max(G.left + G.alley + 20, Math.min(G.right - G.alley - 20, tx));
}

/**
 * Einen Aufschlag ausführen und den Zielpunkt aus der Flugrichtung zurück-
 * rechnen.
 *
 * `triggerServe()` richtet (vx, vy) exakt auf (tx, ty) aus, also gilt
 * tx = x + (vx / vy) * (ty - y). Die Rückrechnung ist damit exakt und nicht
 * etwa eine Näherung über simulierte Frames.
 *
 * @param   {string} server Wert aus PLAYER
 * @returns {number} Tatsächlicher Zielpunkt in X
 */
function aufschlagZiel(server) {
    match.server = server;
    physics.prepareServe();          // setzt beide smoothedPitch auf -1

    /* ERST danach die Töne anlegen — prepareServe() räumt sie weg. */
    audio.smoothedPitch = TON_ANDREA;
    audio2.smoothedPitch = TON_ALEX;

    physics.triggerServe();

    const b = physics.ball;
    const ty = server === PLAYER.ANDREA
        ? G.top + COURT_HEIGHT * 0.35
        : G.bottom - COURT_HEIGHT * 0.35;
    return b.x + (b.vx / b.vy) * (ty - b.y);
}

/* --- 1. Spieler 2 schlägt auf — der eigentliche Fehlerfall ---------------- */
const zielAlex = aufschlagZiel(PLAYER.ALEX);

const richtig = erwartetesZiel(TON_ALEX, PLAYER.ALEX);
const falscherEingang = erwartetesZiel(TON_ANDREA, PLAYER.ALEX);
const falscherUmfang = erwartetesZiel(TON_ALEX, PLAYER.ANDREA);
const beidesFalsch = erwartetesZiel(TON_ANDREA, PLAYER.ANDREA);   // Stand vor dem Fix

console.log('\nAufschlag Spieler 2 (Alex), Ziel-X im Feld:');
console.log(`  richtig (Ton ${TON_ALEX} Hz, Umfang Alex)        ${richtig.toFixed(1)}`);
console.log(`  nur Eingang falsch                              ${falscherEingang.toFixed(1)}`);
console.log(`  nur Umfang falsch                               ${falscherUmfang.toFixed(1)}`);
console.log(`  beides falsch (Stand vor dem Fix)               ${beidesFalsch.toFixed(1)}`);
console.log(`  TATSÄCHLICH geflogen                            ${zielAlex.toFixed(1)}`);

/* Vorbedingung des Tests: die vier Fälle müssen unterscheidbar sein, sonst
   bewiese ein grüner Lauf gar nichts. */
const spanne = [richtig, falscherEingang, falscherUmfang, beidesFalsch];
const alleVerschieden = new Set(spanne.map(v => v.toFixed(1))).size === 4;
check('Testaufbau taugt: alle vier Fälle liegen an verschiedenen Stellen',
    alleVerschieden, spanne.map(v => v.toFixed(1)).join(' / '));

check('Spieler 2 schlägt mit der EIGENEN Stimme auf',
    Math.abs(zielAlex - richtig) < 0.5,
    `${zielAlex.toFixed(1)} statt ${richtig.toFixed(1)}`);
check('Nicht mehr mit Spieler 1s Ton (der ursprüngliche Fehler)',
    Math.abs(zielAlex - beidesFalsch) > 1,
    `Abstand ${Math.abs(zielAlex - beidesFalsch).toFixed(1)} px`);
check('Und durch den eigenen Stimmumfang gerechnet',
    Math.abs(zielAlex - falscherUmfang) > 1,
    `Abstand ${Math.abs(zielAlex - falscherUmfang).toFixed(1)} px`);

/* --- 2. Spieler 1 schlägt auf — darf sich nicht verändert haben ----------- */
const zielAndrea = aufschlagZiel(PLAYER.ANDREA);
const richtigAndrea = erwartetesZiel(TON_ANDREA, PLAYER.ANDREA);

console.log('\nAufschlag Spieler 1 (Andrea), Ziel-X im Feld:');
console.log(`  richtig (Ton ${TON_ANDREA} Hz, Umfang Andrea)    ${richtigAndrea.toFixed(1)}`);
console.log(`  TATSÄCHLICH geflogen                            ${zielAndrea.toFixed(1)}`);

check('Spieler 1 schlägt unverändert mit der eigenen Stimme auf',
    Math.abs(zielAndrea - richtigAndrea) < 0.5,
    `${zielAndrea.toFixed(1)} statt ${richtigAndrea.toFixed(1)}`);

/* --- 3. Arcade-Modus: die KI hat keine Stimme ----------------------------- *
 * Schlägt Alex im Arcade-Modus auf, muss weiterhin die einzige Stimme im Raum
 * den Ball lenken — sonst stünde der Aufschlag still, weil an audio2 nie etwas
 * anliegt. Genau diese Ausnahme steht in serverAudio().
 *
 * Und sie zieht den Stimmumfang mit: gelesen wird Andreas Mikrofon, also muss
 * auch ANDREAS Kalibrierung gelten, obwohl Alex aufschlägt. Alex' Umfang wird
 * im Arcade-Modus nie eingesungen und stünde auf seinen Vorgabewerten.
 * ------------------------------------------------------------------------- */
game.config.mode = MODE.ARCADE;
const zielArcade = aufschlagZiel(PLAYER.ALEX);
const arcadeErwartet = erwartetesZiel(TON_ANDREA, PLAYER.ANDREA);
const arcadeFalscherUmfang = erwartetesZiel(TON_ANDREA, PLAYER.ALEX);

console.log('\nAufschlag Alex im Arcade-Modus (KI, keine eigene Stimme):');
console.log(`  erwartet (Stimme im Raum, Umfang Andrea)        ${arcadeErwartet.toFixed(1)}`);
console.log(`  falsch (Umfang des Aufschlägers)                ${arcadeFalscherUmfang.toFixed(1)}`);
console.log(`  TATSÄCHLICH geflogen                            ${zielArcade.toFixed(1)}`);

check('Im Arcade-Modus lenkt weiterhin die einzige Stimme den Aufschlag',
    Math.abs(zielArcade - arcadeErwartet) < 0.5,
    `${zielArcade.toFixed(1)} statt ${arcadeErwartet.toFixed(1)}`);
check('Und wird durch DEREN Umfang gerechnet, nicht durch den des Aufschlägers',
    Math.abs(zielArcade - arcadeFalscherUmfang) > 1,
    `Abstand ${Math.abs(zielArcade - arcadeFalscherUmfang).toFixed(1)} px`);

summary();
