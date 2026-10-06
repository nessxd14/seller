#!/bin/sh
# Genera los iconos de la app instalable (public/icons) desde src/assets/logo-cation.png.
# Uso único: requiere ImageMagick (`convert`). No agrega dependencias al proyecto.
set -eu
SRC="src/assets/logo-cation.png"
OUT="public/icons"
BG="#ffffff"
mkdir -p "$OUT"
# "any": logo al 80 % sobre fondo blanco.
for size in 192 512; do
  inner=$((size * 80 / 100))
  convert "$SRC" -trim +repage -background none -resize "${inner}x${inner}" -gravity center -background "$BG" -extent "${size}x${size}" -flatten "$OUT/icon-${size}.png"
done
# "maskable": el contenido importante dentro del 60 % central (zona segura), fondo a sangre.
for size in 192 512; do
  inner=$((size * 60 / 100))
  convert "$SRC" -trim +repage -background none -resize "${inner}x${inner}" -gravity center -background "$BG" -extent "${size}x${size}" -flatten "$OUT/icon-maskable-${size}.png"
done
convert "$SRC" -trim +repage -background none -resize 144x144 -gravity center -background "$BG" -extent 180x180 -flatten "$OUT/apple-touch-icon.png"
