#!/usr/bin/env bash
# Rebuilds assets/hero.gif and assets/skills.gif from the website repo.
#
#   tools/make-gifs.sh [path/to/website]   (default: ../website)
#
# See CLAUDE.md for what each step does and why.
set -euo pipefail

REPO="$(cd "$(dirname "$0")/.." && pwd)"
SITE="$(cd "${1:-$REPO/../website}" && pwd)"
PORT="${PORT:-3871}"
CDP_PORT="${CDP_PORT:-9333}"
CHROME="${CHROME:-/Applications/Google Chrome.app/Contents/MacOS/Google Chrome}"
LIMIT=$((10 * 1024 * 1024)) # GitHub's limit for an uploaded image

for tool in node npx ffmpeg; do
  command -v "$tool" >/dev/null || { echo "missing: $tool" >&2; exit 1; }
done
[ -x "$CHROME" ] || { echo "Chrome not found; set CHROME" >&2; exit 1; }
for port in "$PORT" "$CDP_PORT"; do
  if lsof -i ":$port" >/dev/null 2>&1; then
    echo "port $port is in use; set PORT or CDP_PORT" >&2
    exit 1
  fi
done

WORK="$(mktemp -d)"
SERVER=""
BROWSER=""
cleanup() {
  [ -n "$SERVER" ] && kill "$SERVER" 2>/dev/null || true
  [ -n "$BROWSER" ] && kill "$BROWSER" 2>/dev/null || true
  rm -rf "$WORK"
}
trap cleanup EXIT

echo "building $SITE"
(cd "$SITE" && npm run build >"$WORK/build.log" 2>&1) || {
  cat "$WORK/build.log" >&2
  exit 1
}
(cd "$SITE" && exec npx next start -p "$PORT") >"$WORK/server.log" 2>&1 &
SERVER=$!
"$CHROME" --headless=new --hide-scrollbars --remote-debugging-port="$CDP_PORT" \
  --user-data-dir="$WORK/chrome" about:blank >"$WORK/chrome.log" 2>&1 &
BROWSER=$!
for _ in $(seq 1 60); do
  curl -sf "http://localhost:$PORT/" >/dev/null &&
    curl -sf "http://127.0.0.1:$CDP_PORT/json/version" >/dev/null && break
  sleep 0.5
done

export SITE_URL="http://localhost:$PORT/" CDP_PORT
node "$REPO/tools/record.mjs" hero "$WORK/hero"
node "$REPO/tools/record.mjs" skills "$WORK/skills"

# One palette for the whole GIF, so a pixel that stays still keeps its
# colour and GIF can skip it. The hero is mostly still, so it affords
# ordered dithering against banding in the sky. In skills every row moves
# on every frame, where dither noise costs megabytes, so it goes without,
# on fewer colours.
ffmpeg -v error -framerate 20 -i "$WORK/hero/f%04d.png" \
  -vf "palettegen=max_colors=256:stats_mode=full" -y "$WORK/hero.png"
ffmpeg -v error -framerate 20 -i "$WORK/hero/f%04d.png" -i "$WORK/hero.png" \
  -lavfi "[0:v][1:v]paletteuse=dither=bayer:bayer_scale=2:diff_mode=rectangle" \
  -loop 0 -y "$REPO/assets/hero.gif"
FPS="${SKILLS_FPS:-15}"
ffmpeg -v error -framerate "$FPS" -i "$WORK/skills/f%04d.png" \
  -vf "palettegen=max_colors=128:stats_mode=full" -y "$WORK/skills.png"
ffmpeg -v error -framerate "$FPS" -i "$WORK/skills/f%04d.png" -i "$WORK/skills.png" \
  -lavfi "[0:v][1:v]paletteuse=dither=none:diff_mode=rectangle" \
  -loop 0 -y "$REPO/assets/skills.gif"

for gif in hero skills; do
  size=$(stat -f %z "$REPO/assets/$gif.gif" 2>/dev/null || stat -c %s "$REPO/assets/$gif.gif")
  echo "assets/$gif.gif: $((size / 1024)) KB"
  if [ "$size" -gt "$LIMIT" ]; then
    echo "  over 10 MB: shorten SKILLS_LOOP or narrow SKILLS_WIDTH" >&2
  fi
done
