#!/usr/bin/env bash
# Double-clic (bouton « Informer les groupes FB ») : publie l'annonce Facebook de /admin/annonces/.
# 1. Lit sur le site les groupes à vérifier et les publications dues (clé ~/.cami/annonces-fb.key).
# 2. Lance Claude Code avec Claude in Chrome (Chrome ouvert, session Facebook active) :
#    vérifie l'existence des nouveaux groupes, publie l'annonce en texte seul dans chaque groupe visé,
#    renvoie chaque résultat au site (annonces-fb/rapporter.py). Échec : retenté au clic suivant.
cd "$(dirname "$0")" || exit 1
DOSSIER="$(pwd)/annonces-fb"
API="${CAMI_API_FB:-https://www.analyse-musicale.fr/api/annonces-fb.php}"
CLE_FICHIER="$HOME/.cami/annonces-fb.key"

fin() { echo; read -n 1 -s -r -p "Appuyer sur une touche pour fermer…"; exit "${1:-0}"; }

[ -f "$CLE_FICHIER" ] || { echo "Clé introuvable : $CLE_FICHIER"; fin 1; }
TRAVAIL=$(curl -s -f -H "X-Cami-Cle: $(cat "$CLE_FICHIER")" -A "CAMI-annonces-fb" "$API") || { echo "Le site ne répond pas (ou clé refusée)."; fin 1; }
A_FAIRE=$(printf '%s' "$TRAVAIL" | python3 -c 'import json,sys; print(json.load(sys.stdin).get("a_faire", 0))')
if [ "$A_FAIRE" = "0" ]; then echo "Rien à envoyer aux groupes Facebook pour le moment."; fin 0; fi

PROMPT=$(cat <<EOF
Tu publies une annonce dans des groupes Facebook avec Claude in Chrome (session Facebook de l'utilisateur déjà ouverte).
Données (JSON) :
$TRAVAIL

1. Pour chaque groupe de « verifier » : ouvre son URL dans un nouvel onglet.
   La page du groupe s'affiche (nom du groupe visible) → lance : python3 $DOSSIER/rapporter.py <id> verification existant
   Sinon (contenu indisponible, page introuvable, lien cassé) → lance : python3 $DOSSIER/rapporter.py <id> verification introuvable
2. Pour chaque groupe de « publier » (sauf ceux rapportés introuvables à l'étape 1) :
   2.1. ouvre son URL, clique dans la zone de rédaction (« Écrivez quelque chose… », « Exprimez-vous… ») ;
   2.2. saisis EXACTEMENT le texte « texte » de CE groupe (propre à chaque groupe), retours à la ligne compris, sans rien ajouter ni retirer ;
   2.3. publication en TEXTE SEUL : si Facebook ajoute un aperçu de lien ou une image, supprime-le (croix de l'aperçu) ;
   2.4. clique sur « Publier » et vérifie que la publication est faite (ou soumise à l'approbation des administrateurs du groupe) ;
   2.5. AUSSITÔT après : python3 $DOSSIER/rapporter.py <id> publication ok   (ajoute « en attente d'approbation » si c'est le cas)
        En cas d'échec : python3 $DOSSIER/rapporter.py <id> publication echec <raison courte>
3. Une seule publication par groupe. Aucune autre action sur Facebook (ni mention J'aime, ni commentaire, ni message).
4. Termine par un compte rendu d'une ligne par groupe : nom — résultat.
EOF
)

echo "Envoi aux groupes Facebook en cours (Chrome)…"
echo
claude -p --chrome \
  --allowedTools "mcp__claude-in-chrome" "Bash(python3 $DOSSIER/rapporter.py:*)" \
  "$PROMPT"
fin $?
