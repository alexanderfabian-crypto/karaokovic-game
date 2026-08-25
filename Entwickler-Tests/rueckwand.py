# -*- coding: utf-8 -*-
"""Ruecklaufkante des BODENS je Platzbild.

Selbstkalibrierend: die Referenzfarbe wird unten aus dem Aussenbereich
genommen (dort ist sicher Boden), dann von oben nach unten die erste Zeile
gesucht, die ueberwiegend dieselbe Farbe zeigt. Damit funktioniert dasselbe
Verfahren fuer Rasen, Sand und Hartplatz.
"""
import subprocess, struct, sys, os
TMP = "/tmp/_rw.bmp"

def lies(pfad):
    subprocess.run(["sips", "-s", "format", "bmp", pfad, "--out", TMP],
                   check=True, capture_output=True)
    d = open(TMP, "rb").read()
    off = struct.unpack_from("<i", d, 10)[0]
    w = struct.unpack_from("<i", d, 18)[0]
    hraw = struct.unpack_from("<i", d, 22)[0]
    h = abs(hraw); flip = hraw < 0
    bits = struct.unpack_from("<H", d, 28)[0]
    bpp = bits // 8
    stride = ((bits * w + 31) // 32) * 4
    def px(x, y):
        row = y if flip else (h - 1 - y)
        i = off + row * stride + x * bpp
        return d[i+2], d[i+1], d[i]
    return w, h, px

def med(vals):
    return sorted(vals)[len(vals)//2]

for pfad in sys.argv[1:]:
    w, h, px = lies(pfad)
    # Referenz: Aussenbereich unten, links und rechts der Mitte
    ref = [med([px(int(w*fx), int(h*fy))[k]
                for fx in (0.08, 0.15, 0.85, 0.92) for fy in (0.93, 0.96)])
           for k in range(3)]
    def bodenanteil(y, n=40):
        treffer = 0
        for i in range(n):
            x = int(w * (0.25 + 0.5 * i / (n - 1)))
            r, g, b = px(x, y)
            if (r-ref[0])**2 + (g-ref[1])**2 + (b-ref[2])**2 < 55**2: treffer += 1
        return treffer / n
    kante = None
    for y in range(0, int(h * 0.5)):
        if bodenanteil(y) >= 0.6:
            if all(bodenanteil(y+d) >= 0.5 for d in (3, 6, 9, 12)):
                kante = y; break
    print(f"\n=== {os.path.basename(pfad)}  {w}x{h} ===")
    print(f"  Referenzfarbe Boden: RGB {ref[0]},{ref[1]},{ref[2]}")
    print(f"  Bodenkante hinten: Bildzeile {kante} -> virtuell y = "
          f"{kante * 900 / h:.1f}")
    for y in range(max(0, kante-9), kante+10, 3):
        r, g, b = px(w//2, y)
        print(f"    y={y:4d}  Bodenanteil {bodenanteil(y)*100:3.0f} %  RGB {r:3d},{g:3d},{b:3d}")
