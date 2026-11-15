#!/usr/bin/env bash
# Double-clic : publie les modifications du site (commit + push → déploiement automatique).
cd "$(dirname "$0")/.." || exit 1
if [ -z "$(git status --porcelain site)" ]; then
  echo "Aucune modification dans site/ : rien à publier."
  read -n 1 -s -r -p "Appuyer sur une touche pour fermer…"; exit 0
fi
git status --short site
echo
read -r -p "Description de la modification : " MESSAGE
[ -z "$MESSAGE" ] && MESSAGE="Mise à jour du site"
git add site && git commit -q -m "$MESSAGE" && git push -q origin main \
  && echo "Publié. Le site en ligne sera à jour dans une minute environ." \
  || echo "ÉCHEC de la publication."
read -n 1 -s -r -p "Appuyer sur une touche pour fermer…"
