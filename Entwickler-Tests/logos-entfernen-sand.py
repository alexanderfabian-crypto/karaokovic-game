"""Fremdlogos und die eingebackene Punkteanzeige aus dem Sandplatz entfernen.

    python3 Entwickler-Tests/logos-entfernen-sand.py

Liest Platz_Sand_ORIGINAL.png und schreibt Platz_Sand.png. Immer aus dem
Original, nie aus dem bereits bearbeiteten Bild.

Schwesterskript zu logos-entfernen.py (Hartplatz), mit denselben zwei
Grundverfahren und einem dritten fuer den schwierigen Fall:

  'glyph'  Nur die hellen Pixel der Schrift maskieren, geweitet, und aus der
           unmittelbaren Umgebung auffuellen. Fuer weisse Schrift auf dunklem
           Grund (Perrier, Haier, Lacoste, ROLEX).

  'klon'   Ein fester, von Hand geprueter Versatz, mit Helligkeitsabgleich am
           Rahmen. Fuer geschlossene Flaechen (Rolex-Tafel, Uhr,
           Roland-Garros-Logo) auf der gleichmaessigen gruenen Wand.

  'ecke'   Sonderfall Punkteanzeige unten links. Hinter ihr liegt die ECKE des
           Feldes — vordere Grundlinie und linke Seitenlinie treffen sich dort.
           Ein flaechiges Fuellen wuerde die Ecke loeschen, und die Bauchbinde
           des Spiels deckt sie nicht ab (sie endet bei y = 982, die Ecke liegt
           bei y = 988). Deshalb: Sandflaeche samt Grundlinie waagerecht
           klonen, die Grundlinie links der Ecke wieder wegnehmen und die
           Seitenlinie aus der gemessenen Geometrie neu ziehen.

KARAOKOVIC bleibt stehen — das ist unsere eigene Beschriftung, keine
Fremdwerbung.
"""
import struct, os, subprocess, tempfile

PROJEKT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
BASE = tempfile.mkdtemp(prefix="karaokovic-sand-")
QUELLE = os.path.join(PROJEKT, "Platz_Sand_ORIGINAL.png")
ZIEL = os.path.join(PROJEKT, "Platz_Sand.png")
TMP_IN = os.path.join(BASE, "in.bmp")
TMP_OUT = os.path.join(BASE, "out.bmp")

# --- Feldgeometrie, aus dem Bild gemessen (Bildkoordinaten 1920x1080) ------
#
# ACHTUNG: Die aufgemalte Seitenlinie ist NICHT exakt gerade. Gegen die
# Ausgleichsgerade des Spiels (753.24 - 0.659*y) weicht sie nach unten hin
# zunehmend nach rechts ab:
#
#     y = 900 -> +5.4 px      y = 930 -> +8.1 px
#     y = 915 -> +5.7 px      y = 945 -> +11.5 px
#
# Und die Feldecke selbst ist im Original ueberhaupt nicht zu sehen — die
# Punkteanzeige deckt genau sie ab. Rekonstruiert wird deshalb nicht nach der
# Spiel-Geraden, sondern als Fortsetzung der GEMALTEN Linie: lokale Steigung
# aus den letzten vier messbaren Zeilen. Nur so schliesst das Stueck sichtbar
# an den Rest der Linie an.
GRUNDLINIE_Y = 988.0
_STUETZ_Y, _STUETZ_X, _STEIGUNG = 945.0, 142.0, -0.5222


def seitenlinie_links(y):
    return _STUETZ_X + _STEIGUNG * (y - _STUETZ_Y)


ECKE_X = seitenlinie_links(GRUNDLINIE_Y)          # ~119.5

# name, x0, y0, x1, y1, Verfahren, Parameter
LOECHER = [
    ('perrier klein',   138, 394,  208, 430, 'glyph', (150, 4)),
    ('perrier gross',   128, 454,  250, 588, 'glyph', (150, 4)),
    ('bank links',       54, 514,  116, 606, 'glyph', (140, 4)),
    ('haier',          1706, 532, 1818, 580, 'glyph', (150, 4)),
    ('lacoste links',   956, 292, 1022, 324, 'glyph', (150, 3)),
    ('lacoste rechts', 1288, 288, 1352, 326, 'glyph', (150, 3)),

    # Von OBEN klonen, nicht von links: 150 px links steht ein Balljunge, der
    # dadurch ein zweites Mal im Bild stand.
    ('rolex tafel',    1662, 198, 1820, 300, 'klon',  (0, -125)),
    ('uhr links',        78,  90,  140, 156, 'klon',  (145, 0)),
    ('roland garros',  1840,  80, 1920, 172, 'klon',  (-160, 0)),

    # Box bewusst BREITER als die Tafel (bis x = 156 statt 134): sonst bliebe
    # das obere Stueck der gemalten Seitenlinie stehen, waehrend darunter schon
    # die rekonstruierte laeuft — beides zusammen ergab eine doppelte Linie.
    ('punkteanzeige',     0, 884,  156, 1050, 'ecke', (210, 0)),
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
    bpp = struct.unpack_from("<H", d, 28)[0]
    return d, off, w, abs(hraw), hraw < 0, ((bpp * w + 31) // 32) * 4, bpp // 8


def main():
    d, off, W, H, top_down, stride, nch = lade()
    orig = bytes(d)

    def idx(x, y):
        x = 0 if x < 0 else (W - 1 if x >= W else x)
        y = 0 if y < 0 else (H - 1 if y >= H else y)
        row = y if top_down else H - 1 - y
        return off + row * stride + x * nch

    def hell(x, y):
        i = idx(x, y)
        return (orig[i] + orig[i+1] + orig[i+2]) / 3

    maske = bytearray(W * H)
    aufgaben = []

    for name, x0, y0, x1, y1, art, par in LOECHER:
        if art in ('klon', 'ecke'):
            for y in range(y0, y1 + 1):
                for x in range(x0, x1 + 1):
                    maske[y * W + x] = 1
            aufgaben.append((name, x0, y0, x1, y1, art, par, None))
            continue
        schwelle, weite = par
        roh = {(x, y) for y in range(y0, y1 + 1) for x in range(x0, x1 + 1)
               if hell(x, y) >= schwelle}
        punkte = set()
        for (x, y) in roh:
            for dy in range(-weite, weite + 1):
                for dx in range(-weite, weite + 1):
                    if dx*dx + dy*dy <= weite*weite:
                        px_, py_ = x + dx, y + dy
                        if 0 <= px_ < W and 0 <= py_ < H:
                            punkte.add((px_, py_))
        for p in punkte:
            maske[p[1] * W + p[0]] = 1
        aufgaben.append((name, x0, y0, x1, y1, art, par, punkte))

    def setze(x, y, quelle_i, korr=(0, 0, 0), alpha=1.0):
        i = idx(x, y)
        for k in range(3):
            wert = (orig[quelle_i + k] + korr[k]) * alpha + orig[i + k] * (1 - alpha)
            d[i + k] = max(0, min(255, int(round(wert))))

    def randkorrektur(x0, y0, x1, y1, dx, dy):
        """Mittlere Farbdifferenz zwischen Loch- und Quellrahmen."""
        diff = [0.0, 0.0, 0.0]; n = 0
        for y in range(y0 - 6, y1 + 7):
            for x in range(x0 - 6, x1 + 7):
                if x0 <= x <= x1 and y0 <= y <= y1:
                    continue
                sx, sy = x + dx, y + dy
                if not (0 <= x < W and 0 <= y < H and 0 <= sx < W and 0 <= sy < H):
                    continue
                if maske[y*W + x] or maske[sy*W + sx]:
                    continue
                i, j = idx(x, y), idx(sx, sy)
                for k in range(3):
                    diff[k] += orig[i+k] - orig[j+k]
                n += 1
        return [v / n for v in diff] if n else [0.0, 0.0, 0.0]

    def klon(x0, y0, x1, y1, dx, dy):
        korr = randkorrektur(x0, y0, x1, y1, dx, dy)
        n = 0
        for y in range(y0, y1 + 1):
            for x in range(x0, x1 + 1):
                # Weiche Naht nur an Kanten, die IM Bild liegen. Am Bildrand
                # gibt es nichts zu ueberblenden — dort mischte das Original
                # (die Punkteanzeige) sonst als gruener Rest wieder durch.
                abstaende = []
                if x0 > 0: abstaende.append(x - x0)
                if x1 < W - 1: abstaende.append(x1 - x)
                if y0 > 0: abstaende.append(y - y0)
                if y1 < H - 1: abstaende.append(y1 - y)
                rand = min(abstaende) if abstaende else FEDER
                a = 1.0 if rand >= FEDER else (rand + 1) / (FEDER + 1)
                setze(x, y, idx(x + dx, y + dy), korr, a)
                n += 1
        return n

    def glyph(punkte):
        n = 0
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
                sb += orig[i]*g; sg += orig[i+1]*g; sr += orig[i+2]*g; gw += g
            if gw <= 0:
                continue
            i = idx(x, y)
            d[i] = int(round(sb/gw)); d[i+1] = int(round(sg/gw))
            d[i+2] = int(round(sr/gw)); n += 1
        return n

    def linienfarbe():
        """Farbe der aufgemalten Linien, aus der Grundlinie abgegriffen."""
        proben = [idx(x, int(GRUNDLINIE_Y)) for x in range(420, 640, 10)]
        return [sum(orig[p + k] for p in proben) // len(proben) for k in range(3)]

    def sandfarbe(x, y):
        """Reine Sandfarbe.

        WICHTIG: seitlich AUS DEM LOCH HERAUS greifen, nicht nur nach oben.
        45 px über der Punkteanzeige steht immer noch die Punkteanzeige — beim
        ersten Versuch wurden dadurch Reste der Tafel wieder eingesetzt.
        Der Versatz +210/-45 landet auf freiem Sand: rechts der Tafel und
        oberhalb der Grundlinie, unterhalb der Aufschlaglinie.
        """
        return idx(x + 210, y - 45)

    def ecke(x0, y0, x1, y1, dx):
        """Sonderfall: Flaeche klonen, Grundlinie links der Ecke wegnehmen,
           Seitenlinie neu ziehen."""
        n = klon(x0, y0, x1, y1, dx, 0)

        # 1. Grundlinie links der Feldecke gehoert dort nicht hin —
        #    der Klon hat sie mitgebracht.
        for y in range(int(GRUNDLINIE_Y) - 6, int(GRUNDLINIE_Y) + 7):
            for x in range(x0, min(x1, int(ECKE_X) - 3) + 1):
                setze(x, y, sandfarbe(x, y))

        # 2. Seitenlinie aus der gemessenen Geometrie neu ziehen.
        farbe = linienfarbe()
        for y in range(y0, int(GRUNDLINIE_Y) + 4):
            xm = seitenlinie_links(y)
            if not (x0 - 4 <= xm <= x1 + 4):
                continue
            for x in range(int(xm) - 3, int(xm) + 4):
                if not (x0 <= x <= x1):
                    continue
                rand = abs(x - xm)
                a = 1.0 if rand <= 1.6 else max(0.0, (3.2 - rand) / 1.6)
                if a <= 0:
                    continue
                i = idx(x, y)
                for k in range(3):
                    d[i+k] = int(round(farbe[k] * a + d[i+k] * (1 - a)))
        return n

    gesamt = 0
    for (name, x0, y0, x1, y1, art, par, punkte) in aufgaben:
        if art == 'glyph':
            n = glyph(punkte)
        elif art == 'klon':
            n = klon(x0, y0, x1, y1, par[0], par[1])
        else:
            n = ecke(x0, y0, x1, y1, par[0])
        print(f"  {name:16s} {art:6s} {n:6d} Pixel")
        gesamt += n

    open(TMP_OUT, "wb").write(bytes(d))
    subprocess.run(["sips", "-s", "format", "png", TMP_OUT, "--out", ZIEL],
                   capture_output=True, check=True)
    print(f"{gesamt} Pixel ersetzt -> {ZIEL}")


if __name__ == "__main__":
    main()
