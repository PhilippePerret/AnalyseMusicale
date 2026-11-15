#!/usr/bin/env bash
# Double-clic : ouvre le site en local (serveur de dev Astro, rechargement à chaud).
cd "$(dirname "$0")/../site" || exit 1
[ -d node_modules ] || npm install
(sleep 2 && open "http://localhost:4321/") &
npm run dev
