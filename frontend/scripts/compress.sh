#!/bin/bash
# Brotli L9 + Gzip pre-compression pipeline for Next.js SSG output.
# Run after `npm run build`.
set -euo pipefail

OUT_DIR="out"

if [ ! -d "$OUT_DIR" ]; then
    echo "Error: $OUT_DIR not found. Run 'npm run build' first."
    exit 1
fi

echo "Compressing static assets..."

# Brotli L9 (compression ratio vs L11 < 3%, speed 5-10x faster)
find "$OUT_DIR" -type f \( -name "*.html" -o -name "*.js" -o -name "*.css" \) | while read -r file; do
    brotli -9 -k "$file" 2>/dev/null || true
    gzip -9 -k "$file" 2>/dev/null || true
done

echo "Done: .br and .gz files created alongside originals."