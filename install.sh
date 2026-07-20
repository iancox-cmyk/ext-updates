#!/usr/bin/env bash
# One-time installer for a new machine. Downloads the signed .xpi builds
# from this repo's GitHub Pages site and hands them to Firefox to install.
# You still have to click "Add" on Firefox's own install prompt once per
# extension — that confirmation can't be scripted around. After this,
# each extension's own update_url keeps it current automatically; you
# don't need to re-run this except on a machine that's never had it.
set -euo pipefail

BASE_URL="https://iancox-cmyk.github.io/ext-updates"
TMPDIR="$(mktemp -d)"
trap 'rm -rf "$TMPDIR"' EXIT

EXTENSIONS=(
  "modo-bot/modo-bot-1.16.xpi"
  "autoclicker/simple-autoclicker-2.0.xpi"
)

open_with_firefox() {
  local file="$1"
  case "$(uname -s)" in
    Darwin) open -a Firefox "$file" ;;
    Linux)  firefox "$file" & ;;
    *)
      echo "Unrecognized OS — open $file with Firefox manually (drag onto the window, or File > Open File)."
      return
      ;;
  esac
}

echo "Downloading extensions from $BASE_URL ..."
for path in "${EXTENSIONS[@]}"; do
  fname="$(basename "$path")"
  echo "  -> $fname"
  curl -fsSL "$BASE_URL/$path" -o "$TMPDIR/$fname"
  echo "     sha256: $(shasum -a 256 "$TMPDIR/$fname" | awk '{print $1}')"
done

echo
echo "Opening each in Firefox — click \"Add\" on the install prompt that pops up for each one."
for path in "${EXTENSIONS[@]}"; do
  fname="$(basename "$path")"
  open_with_firefox "$TMPDIR/$fname"
  sleep 2
done

echo
echo "Done. Nothing further to do on this machine — updates arrive automatically from here on."
