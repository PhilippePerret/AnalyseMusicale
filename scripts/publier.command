#!/usr/bin/env bash
# Double-clic : publie les modifications du site (commit + push → déploiement automatique).
cd "$(dirname "$0")/.." || exit 1
if [ -z "$(git status --porcelain site)" ]; then
  echo "Aucune modification dans site/ : rien à publier."
  read -n 1 -s -r -p "Appuyer sur une touche pour fermer…"; exit 0
fi
git status --short site
# Garde-fou : GitHub refuse les fichiers de plus de 100 Mo
GROS=$(git status --porcelain -uall site | awk '{print $NF}' | while read -r f; do [ -f "$f" ] && [ "$(stat -f%z "$f")" -gt 50000000 ] && echo "$f"; done)
if [ -n "$GROS" ]; then
  echo; echo "Fichiers trop gros pour GitHub (> 50 Mo), publication annulée :"; echo "$GROS"
  read -n 1 -s -r -p "Appuyer sur une touche pour fermer…"; exit 1
fi
echo
read -r -p "Description de la modification : " MESSAGE
[ -z "$MESSAGE" ] && MESSAGE="Mise à jour du site"
git add site && git commit -q -m "$MESSAGE" && git push -q origin main \
  && echo "Publié. Le site en ligne sera à jour dans une minute environ." \
  || echo "ÉCHEC de la publication."
read -n 1 -s -r -p "Appuyer sur une touche pour fermer…"
