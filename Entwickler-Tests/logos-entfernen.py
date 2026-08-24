"""Logos und Schriftzuege aus dem Platzbild entfernen.

    python3 Entwickler-Tests/logos-entfernen.py

Liest Vorgabe_Platz_ORIGINAL.png (das unveraenderte Bild, wie geliefert) und
schreibt Vorgabe_Platz.png (das, was das Spiel benutzt). Immer aus dem
Original heraus, nie aus dem bereits bearbeiteten Bild — sonst wuerde jeder
Lauf die vorherige Retusche erneut verwaschen.

Braucht nur Python und `sips` (macOS-Bordmittel), keine Bibliotheken.

VERFAHREN 'glyph' (Regelfall)
    Maskiert werden nicht ganze Rechtecke, sondern nur die hellen Pixel der
    Schrift selbst, danach um ein paar Pixel geweitet. Gefuellt wird jedes
    Loch-Pixel aus seinen naechsten unmaskierten Nachbarn in acht Richtungen,
    gewichtet mit 1/Abstand^2.

    Der Trick liegt in der Maske: Buchstabenstriche sind duenn, die Strahlen
    treffen deshalb nach wenigen Pixeln auf den echten Untergrund direkt
    daneben. Auf der schraeg verlaufenden Bande kommt so exakt deren Farbe und
    Helligkeit an dieser Stelle heraus — ohne dass irgendwo eine Neigung
    angenommen werden muesste.

    Zwei Sackgassen davor, beide verworfen:
      - Rechteck + Randinterpolation: zieht ueber texturiertem Untergrund
        sternfoermige Schlieren, weil acht weit entfernte, sehr verschiedene
        Farben gemittelt werden.
      - Rechteck + automatisch gesuchter Ersatzausschnitt: der beste
        Rahmen-Treffer war stellenweise ein voellig anderer Bildinhalt (die
        Schiedsrichterbank landete auf der Bande).

VERFAHREN 'klon' (nur "us open")
    Dort ist das Logo eine grosse geschlossene Flaeche, keine duenne Schrift —
    eine Glyphenmaske waere fast so gross wie das Rechteck. Stattdessen wird
    ein fester, von Hand gepruefter Versatz kopiert.
"""
import struct, os, subprocess, tempfile

PROJEKT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
BASE = tempfile.mkdtemp(prefix="karaokovic-logos-")
QUELLE = os.path.join(PROJEKT, "Vorgabe_Platz_ORIGINAL.png")

TMP_IN = os.path.join(BASE, "platz.bmp")
TMP_OUT = os.path.join(BASE, "platz_clean.bmp")
ZIEL    = os.path.join(PROJEKT, "Vorgabe_Platz.png")

# name, x0, y0, x1, y1, Verfahren, Parameter
#   glyph: (Helligkeitsschwelle, Weitung in Pixeln)
#   klon:  (dx, dy)
LOECHER = [
    ('argenx',        1250, 420, 1428, 466, 'glyph', (150, 5)),
    ('wasserzeichen', 1426, 726, 1493, 792, 'glyph', (132, 5)),
    ('us open',       1430,  26, 1574, 123, 'klon',  (0, 205)),
    ('bande li 1',     100, 258,  160, 308, 'glyph', (138, 4)),
    ('bande li 2',      50, 318,  115, 366, 'glyph', (128, 4)),
    ('bande li 3',       0, 360,   52, 418, 'glyph', (128, 4)),
    ('bande re 1',    1358, 266, 1414, 304, 'glyph', (140, 4)),
    ('bande re 2',    1530, 423, 1598, 494, 'glyph', (140, 4)),
    ('bande li 4',     225, 126,  282, 190, 'glyph', (132, 4)),
    ('bande li 5',     194, 208,  224, 239, 'glyph', (132, 4)),
    ('bande re 3',    1243, 129, 1339, 184, 'glyph', (132, 4)),

    # Die IBM-Geschwindigkeitsanzeige an der Rueckwand wird als GANZES
    # entfernt, nicht nur ihr Schriftzug: bliebe der Kasten stehen, saehe man
    # eine leere Werbetafel — und eine Geschwindigkeitsanzeige, die die ganze
    # Sendung ueber "126 MPH" zeigt, waere ohnehin sinnlos. Der Untergrund ist
    # eine gleichmaessige blaue Wand, also 'rasen'.
    ('ibm-tafel',      483,  80,  560, 147, 'klon',  (-135, 0)),

    # "POLO" auf Schiedsrichterstuhl und Spielerbank. Beides weisse Schrift auf
    # dunklen Flaechen — die Glyphenmaske trifft nur die Buchstaben, das Moebel
    # selbst bleibt unangetastet.
    ('polo-stuhl',     330, 321,  366, 338, 'glyph', (150, 3)),
    ('polo-bank',      235, 440,  278, 458, 'glyph', (150, 3)),

    # Die Ergebnistafel "SINNER / ALCARAZ" unten links. Sie steht NUR in
    # diesem Bild (Sand und Rasen sind sauber) und ausgerechnet genau dort,
    # wo das Spiel seine eigene Bauchbinde zeichnet (HUD 84..446 / 742..818)
    # — im Match ist sie deshalb verdeckt, sichtbar wurde sie erst im
    # EINSPIELEN, seit die Bauchbinde dort nicht mehr gezeichnet wird.
    #
    # 'klon' wie bei "us open": eine grosse geschlossene Flaeche, keine
    # duenne Schrift. Eine Glyphenmaske waere fast so gross wie das Rechteck.
    #
    # Eingemessen im Original: der Kasten liegt bei x 83..446, y 741..818;
    # das Loch hat rundum rund sieben Pixel Luft. Nach oben ist das
    # unkritisch — die weisse Grundlinie endet bei y 704, also 30 px
    # entfernt. Nach links bleibt die dunkle Eckabschattung unangetastet:
    # sie reicht an dieser Hoehe bis etwa x 11, das Loch beginnt bei 76.
    #
    # Quelle 500 px weiter rechts, gleiche Zeilen: dort ist der
    # Aussenbereich frei und praktisch gleich hell (gemessen 98.5 gegen
    # 98.5 ueber die ganze Breite). Der Helligkeitsabgleich unten braucht
    # also kaum zu korrigieren.
    ('sinner-alcaraz',  76, 734,  454, 826, 'klon',  (500, 0)),
]

RICHTUNGEN = [(1, 0), (-1, 0), (0, 1), (0, -1),
              (1, 1), (1, -1), (-1, 1), (-1, -1)]
FEDER = 4


def lade():
    subprocess.run(["sips", "-s", "format", "bmp", QUELLE, "--out", TMP_IN],
                   capture_output=True, check=True)
    d = bytearray(open(TMP_IN, "rb").read())
    off = struct.unpack_from("<I", d, 10)[0]
    w = struct.unpack_from("<i", d, 18)[0]
    hraw = struct.unpack_from("<i", d, 22)[0]
    return d, off, w, abs(hraw), hraw < 0, ((32 * w + 31) // 32) * 4


def main():
    d, off, W, H, top_down, stride = lade()
    orig = bytes(d)

    def idx(x, y):
        row = y if top_down else (H - 1 - y)
        return off + row * stride + x * 4

    def hell(x, y):
        i = idx(x, y)
        return (orig[i] + orig[i+1] + orig[i+2]) / 3

    maske = bytearray(W * H)
    aufgaben = []

    # --- Masken bauen ---------------------------------------------------
    for name, x0, y0, x1, y1, art, par in LOECHER:
        if art == 'klon':
            for y in range(y0, y1 + 1):
                for x in range(x0, x1 + 1):
                    maske[y * W + x] = 1
            aufgaben.append((name, x0, y0, x1, y1, art, par, None))
            continue

        schwelle, weite = par
        roh = set()
        for y in range(y0, y1 + 1):
            for x in range(x0, x1 + 1):
                if hell(x, y) >= schwelle:
                    roh.add((x, y))
        # Weiten: die weichen Kanten eines Buchstabens liegen unter der
        # Schwelle, blieben sonst als grauer Saum stehen.
        punkte = set()
        for (x, y) in roh:
            for dy in range(-weite, weite + 1):
                for dx in range(-weite, weite + 1):
                    if dx * dx + dy * dy <= weite * weite:
                        px_, py_ = x + dx, y + dy
                        if 0 <= px_ < W and 0 <= py_ < H:
                            punkte.add((px_, py_))
        for (x, y) in punkte:
            maske[y * W + x] = 1
        aufgaben.append((name, x0, y0, x1, y1, art, par, punkte))

    # --- Fuellen --------------------------------------------------------
    gesamt = 0
    for (name, x0, y0, x1, y1, art, par, punkte) in aufgaben:
        n = 0
        if art == 'klon':
            dx, dy = par

            # Helligkeitsabgleich.
            # Der Untergrund hat oft einen sanften Verlauf. Ein 1:1 kopierter
            # Ausschnitt ist dann als Rechteck zu erkennen, auch wenn sein
            # Inhalt passt. Deshalb wird die mittlere Farbe des Rahmens um das
            # Loch mit der des Rahmens um die Quelle verglichen und die
            # Differenz auf die Kopie addiert.
            diff = [0.0, 0.0, 0.0]
            zaehler = 0
            for y in range(y0 - 6, y1 + 7):
                for x in range(x0 - 6, x1 + 7):
                    if x0 <= x <= x1 and y0 <= y <= y1:
                        continue
                    sx, sy = x + dx, y + dy
                    if not (0 <= x < W and 0 <= y < H):
                        continue
                    if not (0 <= sx < W and 0 <= sy < H):
                        continue
                    if maske[y * W + x] or maske[sy * W + sx]:
                        continue
                    i, j = idx(x, y), idx(sx, sy)
                    for k in range(3):
                        diff[k] += orig[i+k] - orig[j+k]
                    zaehler += 1
            if zaehler:
                diff = [v / zaehler for v in diff]

            for y in range(y0, y1 + 1):
                for x in range(x0, x1 + 1):
                    i, j = idx(x, y), idx(x + dx, y + dy)
                    rand = min(x - x0, x1 - x, y - y0, y1 - y)
                    a = 1.0 if rand >= FEDER else (rand + 1) / (FEDER + 1)
                    for k in range(3):
                        quelle = orig[j+k] + diff[k]
                        wert = quelle * a + orig[i+k] * (1 - a)
                        d[i+k] = max(0, min(255, int(round(wert))))
                    n += 1
        else:
            for (x, y) in punkte:
                sb = sg = sr = gw = 0.0
                for ddx, ddy in RICHTUNGEN:
                    cx, cy, s = x, y, 0
                    while True:
                        cx += ddx; cy += ddy; s += 1
                        if not (0 <= cx < W and 0 <= cy < H) or s > 120:
                            s = 0; break
                        if not maske[cy * W + cx]:
                            break
                    if not s:
                        continue
                    i = idx(cx, cy); g = 1.0 / (s * s)
                    sb += orig[i] * g; sg += orig[i+1] * g; sr += orig[i+2] * g
                    gw += g
                if gw <= 0:
                    continue
                i = idx(x, y)
                d[i] = int(round(sb/gw)); d[i+1] = int(round(sg/gw))
                d[i+2] = int(round(sr/gw)); n += 1
        print(f"  {name:15s} {art:6s} {n:6d} Pixel")
        gesamt += n

    open(TMP_OUT, "wb").write(bytes(d))
    subprocess.run(["sips", "-s", "format", "png", TMP_OUT, "--out", ZIEL],
                   capture_output=True, check=True)
    print(f"{gesamt} Pixel ersetzt -> {ZIEL}")


if __name__ == "__main__":
    main()
