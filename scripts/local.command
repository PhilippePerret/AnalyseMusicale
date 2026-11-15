#!/usr/bin/env bash
# Double-clic : ouvre le site en local (serveur de dev Astro, rechargement à chaud).
# Laisser cette fenêtre ouverte ; ⌃C pour arrêter.
cd "$(dirname "$0")/../site" || exit 1
[ -d node_modules ] || npm install
URL="http://localhost:4321/"
# Ouvre le navigateur dès que le serveur répond
( for i in $(seq 1 60); do curl -s -o /dev/null "$URL" && { open "$URL"; exit; }; sleep 0.5; done ) &
npx astro dev stop >/dev/null 2>&1   # serveur précédent éventuellement resté actif
npx astro dev --port 4321
