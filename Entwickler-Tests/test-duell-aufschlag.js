/* =============================================================================
 * TEST: Wessen Stimme gibt den Aufschlag frei? (nur Arena-Fassung)
 *
 * Der Fehler, der diesen Test veranlasst hat: die Aufschlagslogik las die
 * Tonhoehe fest aus Spieler 1s Eingang. Solange Alex eine KI war, gab es nur
 * eine Stimme im Raum und das fiel nicht auf. Im Duell wurde Alex' Aufschlag
 * dagegen von ANDREAS Ton gesteuert.
 *
 * Der Fehler hatte zwei Haelften, und dieser Test prueft beide:
 *
 *   1. Falscher EINGANG    — `audio` statt `audio2`.
 *   2. Falscher STIMMUMFANG — die Abbildung Ton -> Anteil ist je Spieler
 *      kalibriert. Ohne den zweiten Parameter wurde Alex' Tonhoehe durch
 *      Andreas Umfang gerechnet.
 *
 * WAS SICH MIT ARENA-14 GEAENDERT HAT: Bis dahin lenkte der Ton die
 * FLUGRICHTUNG des Aufschlags, und der Test rechnete sie aus `vx`/`vy`
 * zurueck. Seit "Relative Pitch" wird die Richtung gewuerfelt — der Ton
 * entscheidet stattdessen, OB ueberhaupt aufgeschlagen wird (er muss in der
 * mittleren Zuendzone des eigenen Umfangs liegen).
 *
 * Die beiden Haelften des alten Fehlers sind damit NICHT erledigt, sie sind
 * umgezogen: sie entscheiden jetzt, wessen Umfang die Zuendzone misst. Genau
 * dort prueft dieser Test sie — und zwar schaerfer als zuvor, weil ein
 * einziges Flag beide Haelften zugleich beantwortet: die Toene sind so
 * gewaehlt, dass `zentriert` nur bei richtigem Eingang UND richtigem Umfang
 * wahr werden kann.
 *
 * Start: node Entwickler-Tests/test-duell-aufschlag.js
 * ========================================================================== */

'use strict';

const { loadGame, check, summary } = require('./dom-stub.js');
const game = loadGame('../app-arena.js');
const { audio, audio2, match, physics, PLAYER, MODE } = game;
const Physics = game.Physics;

/* Absichtlich WEIT auseinanderliegende Umfaenge: nur so ergibt jede
   Verwechslung von Eingang oder Umfang ein anderes Ergebnis. */
game.config.minFreq = 100;  game.config.maxFreq = 300;   // Andrea
game.config.minFreq2 = 400; game.config.maxFreq2 = 900;  // Alex

/**
 * Die Frequenz, die fuer `player` genau bei Anteil `p` liegt.
 * Umkehrung von Physics.aufschlagProzent().
 */
function tonBei(p, player) {
    const r = Physics.voiceRange(player);
    const minMidi = 12 * Math.log2(r.min / 440) + 69;
    const maxMidi = 12 * Math.log2(r.max / 440) + 69;
    return 440 * Math.pow(2, (minMidi + p * (maxMidi - minMidi) - 69) / 12);
}

/* Jeder Eingang liegt in der MITTE SEINES EIGENEN Umfangs — und damit weit
   ausserhalb des jeweils anderen. */
const TON_ANDREA = tonBei(0.5, PLAYER.ANDREA);
const TON_ALEX = tonBei(0.5, PLAYER.ALEX);
audio.smoothedPitch = TON_ANDREA;
audio2.smoothedPitch = TON_ALEX;
audio.currentVolume = 0;
audio2.currentVolume = 0;

console.log(`Toene: Andrea ${TON_ANDREA.toFixed(1)} Hz (Mitte 100–300),`
    + ` Alex ${TON_ALEX.toFixed(1)} Hz (Mitte 400–900)`);

/**
 * Einen Frame in der Aufschlagphase fahren und die Anzeige zurueckgeben.
 * @param   {string} server Wert aus PLAYER
 * @returns {{prozent:number, zentriert:boolean}}
 */
function aufschlagAnzeige(server) {
    match.server = server;
    match.state = 'SERVE_WAIT';
    physics.update();
    return physics.stimme;
}

/* Vorbedingung: der jeweils FALSCHE Umfang muss ein deutlich anderes
   Ergebnis liefern, sonst bewiese ein gruener Lauf nichts. */
const falschUmfang = Physics.aufschlagProzent(TON_ALEX, PLAYER.ANDREA);
const falschEingang = Physics.aufschlagProzent(TON_ANDREA, PLAYER.ALEX);
console.log(`Gegenrechnung: Alex' Ton durch Andreas Umfang = `
    + `${(falschUmfang * 100).toFixed(0)} %, Andreas Ton durch Alex' Umfang = `
    + `${(falschEingang * 100).toFixed(0)} %`);
check('Testaufbau taugt: beide Verwechslungen liegen weit ausserhalb der Zone',
    Math.abs(falschUmfang - 0.5) > 0.4 && Math.abs(falschEingang - 0.5) > 0.4,
    `${(falschUmfang * 100).toFixed(0)} % / ${(falschEingang * 100).toFixed(0)} %`);

/* --- 1. Spieler 2 schlaegt auf — der eigentliche Fehlerfall -------------- */
game.config.mode = MODE.VERSUS;
const alex = aufschlagAnzeige(PLAYER.ALEX);
console.log(`\nAufschlag Spieler 2 (Alex): ${(alex.prozent * 100).toFixed(1)} %`);

check('Spieler 2 wird an der EIGENEN Stimme gemessen — Eingang UND Umfang',
    alex.zentriert === true, `${(alex.prozent * 100).toFixed(1)} %`);
check('Und liegt damit genau in der Mitte',
    Math.abs(alex.prozent - 0.5) < 0.01, `${alex.prozent.toFixed(4)}`);

/* --- 2. Spieler 1 schlaegt auf — darf sich nicht veraendert haben -------- */
const andrea = aufschlagAnzeige(PLAYER.ANDREA);
console.log(`Aufschlag Spieler 1 (Andrea): ${(andrea.prozent * 100).toFixed(1)} %`);
check('Spieler 1 unveraendert an der eigenen Stimme',
    andrea.zentriert === true && Math.abs(andrea.prozent - 0.5) < 0.01,
    `${(andrea.prozent * 100).toFixed(1)} %`);

/* --- 3. Arcade-Modus: die KI hat keine Stimme ---------------------------- *
 * Schlaegt Alex im Arcade-Modus auf, muss weiterhin die einzige Stimme im
 * Raum zaehlen — sonst stuende der Aufschlag still, weil an audio2 nie etwas
 * anliegt. Und sie zieht den Umfang mit: gelesen wird Andreas Mikrofon, also
 * gilt auch ANDREAS Kalibrierung, obwohl Alex aufschlaegt. Alex' Umfang wird
 * im Arcade-Modus nie eingesungen.
 * ------------------------------------------------------------------------ */
game.config.mode = MODE.ARCADE;
const arcade = aufschlagAnzeige(PLAYER.ALEX);
console.log(`Aufschlag Alex im Arcade-Modus: ${(arcade.prozent * 100).toFixed(1)} %`);
check('Im Arcade-Modus zaehlt die einzige Stimme im Raum',
    arcade.zentriert === true, `${(arcade.prozent * 100).toFixed(1)} %`);
check('Und wird durch DEREN Umfang gerechnet, nicht durch den des Aufschlaegers',
    Math.abs(arcade.prozent - 0.5) < 0.01
    && Math.abs(arcade.prozent - falschEingang) > 0.4,
    `${arcade.prozent.toFixed(4)} vs. falsch ${falschEingang.toFixed(4)}`);

/* --- 4. Ein Ton ausserhalb der Zone gibt NICHT frei ---------------------- */
game.config.mode = MODE.VERSUS;
audio2.smoothedPitch = tonBei(0.85, PLAYER.ALEX);
const daneben = aufschlagAnzeige(PLAYER.ALEX);
check('Ein Ton am oberen Rand des eigenen Umfangs gibt nicht frei',
    daneben.zentriert === false, `${(daneben.prozent * 100).toFixed(1)} %`);
audio2.smoothedPitch = TON_ALEX;

summary();
