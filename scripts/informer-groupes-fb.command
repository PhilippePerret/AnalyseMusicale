#!/usr/bin/env bash
# Double-clic (bouton « Informer les groupes FB ») : publie les annonces Facebook dues de /admin/annonces/.
# 1. Lit sur le site les groupes à vérifier et les publications dues (clé ~/.cami/annonces-fb.key).
# 2. Lance Claude Code avec Claude in Chrome (Chrome ouvert, session Facebook active) :
#    vérifie l'existence des nouveaux groupes, publie les annonces dues en texte seul dans leurs groupes,
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

# Terminal de cette fenêtre : rapporter.py y affiche chaque résultat (le Bash de Claude n'a pas de terminal)
export CAMI_TTY_FB="$(tty)"

# Travail gardé pour rapporter.py (noms des groupes et des annonces dans le suivi affiché)
printf '%s' "$TRAVAIL" > "$HOME/.cami/travail-fb.json"
printf '%s' "$TRAVAIL" | python3 "$DOSSIER/liste.py"

# Chrome ouvert (sinon l'extension Claude in Chrome est absente), le temps qu'elle se connecte
CHROME_OUVERT_ICI=0
if ! pgrep -xq "Google Chrome"; then
  CHROME_OUVERT_ICI=1
  echo "Ouverture de Chrome…"
  open -ga "Google Chrome"
  sleep 8
fi

IFS= read -r -d '' PROMPT <<EOF || true
Tu publies des annonces dans des groupes Facebook avec Claude in Chrome (session Facebook de l'utilisateur déjà ouverte).
Données (JSON) :
$TRAVAIL

1. Pour chaque groupe de « verifier » : ouvre son URL dans un nouvel onglet.
   La page du groupe s'affiche (nom du groupe visible) → lance : python3 $DOSSIER/rapporter.py <id> verification existant
   Sinon (contenu indisponible, page introuvable, lien cassé) → lance : python3 $DOSSIER/rapporter.py <id> verification introuvable
2. Pour chaque élément de « publier » (annonce + groupe ; sauf groupes rapportés introuvables à l'étape 1) :
   Méthode IMPOSÉE (outil javascript_tool, pas de recherche à l'œil ni de captures répétées) :
   2.1. ouvre son URL (navigate). La page s'affiche tout de suite : AUCUNE attente supplémentaire.
   2.2. javascript_tool : clic sur l'invite de rédaction, repérée par son texte :
        const b = [...document.querySelectorAll('[role="button"]')].find(e => /Exprimez-vous|Écrivez quelque chose/.test(e.textContent)); if (b) { b.click(); 'ok' } else 'absent'
        « absent » : fais défiler d'un écran (scroll) et relance une fois ; toujours absent → échec « invite de rédaction absente ».
   2.3. javascript_tool : zone de texte de la fenêtre de publication (relance jusqu'à 5 fois, 1 seconde d'écart, le temps que la fenêtre s'ouvre) :
        const t = document.querySelector('[role="dialog"] [contenteditable="true"][role="textbox"]'); if (t) { t.focus(); 'ok' } else 'absent'
   2.4. saisis EXACTEMENT le texte « texte » de CET élément (computer, action type ; retour à la ligne = touche Entrée ; Maj+Entrée si Entrée publie), sans rien ajouter ni retirer ;
   2.5. javascript_tool : vérification : document.querySelector('[role="dialog"] [contenteditable="true"][role="textbox"]').innerText
        Le texte doit correspondre (aux espaces près). Sinon : vide la zone (Cmd+A puis Suppr), relance 2.3 et 2.4 (2 essais au plus, puis échec) ;
   2.6. publication en TEXTE SEUL : si un aperçu de lien apparaît, supprime-le (croix de l'aperçu). Puis javascript_tool :
        const p = [...document.querySelectorAll('[role="dialog"] [role="button"]')].find(e => e.getAttribute('aria-label') === 'Publier' || e.textContent.trim() === 'Publier'); if (p) { p.click(); 'ok' } else 'absent'
        Vérifie ensuite (javascript_tool : la fenêtre [role="dialog"] de publication a disparu, ou message d'approbation) que la publication est faite ;
   2.7. AUSSITÔT après (<id> : id du groupe ; <annonce> : champ « annonce » de l’élément) : python3 $DOSSIER/rapporter.py <id> publication <annonce> ok   (ajoute « en attente d'approbation » si c'est le cas)
        En cas d'échec : python3 $DOSSIER/rapporter.py <id> publication <annonce> echec <raison courte>
3. Un échec n'arrête JAMAIS le travail : rapporte-le, puis passe à l'élément suivant, jusqu'au dernier.
4. Une seule publication par élément de « publier » (un même groupe peut recevoir plusieurs annonces différentes). Aucune autre action sur Facebook (ni mention J'aime, ni commentaire, ni message).
5. Termine par un compte rendu d'une ligne par élément : groupe, début de l'annonce — résultat.
EOF

echo
echo "Envoi en cours (Chrome) — résultats au fur et à mesure :"
# Consigne par l'entrée standard : --allowedTools prend tous les arguments qui le suivent
cd .. || exit 1   # racine du projet (MEMORY.md du projet)
JOURNAL="$HOME/.cami/informer-groupes-fb.log"
{ echo; echo "=== $(date '+%d/%m/%Y %H:%M')"; } >> "$JOURNAL"
# Actions de Claude affichées en direct (suivi.py)
printf '%s' "$PROMPT" | claude -p --chrome --output-format stream-json --verbose \
  --allowedTools "mcp__claude-in-chrome" "Bash(python3 $DOSSIER/rapporter.py:*)" \
  | python3 -u "$DOSSIER/suivi.py" | tee -a "$JOURNAL"
CODE="${PIPESTATUS[1]}"

# Chrome refermé s'il était fermé au départ
[ "$CHROME_OUVERT_ICI" = "1" ] && osascript -e 'quit app "Google Chrome"' >/dev/null 2>&1

# Bilan d'après le site : ce qui reste à faire (échecs compris)
RESTE=$(curl -s -f -H "X-Cami-Cle: $(cat "$CLE_FICHIER")" -A "CAMI-annonces-fb" "$API")
BILAN=$(printf '%s' "$RESTE" | python3 -c '
import json, sys
try:
    t = json.load(sys.stdin)
except Exception:
    print("Bilan indisponible (le site ne répond pas)."); sys.exit()
v, p = len(t.get("verifier", [])), len(t.get("publier", []))
print("Tout est publié." if v + p == 0 else f"Reste à faire : {p} publication(s), {v} vérification(s) de groupe (relancer « Informer les groupes FB »).")
')
echo
echo "BILAN : $BILAN" | tee -a "$JOURNAL"
echo "Journal : $JOURNAL"
osascript -e "display notification \"$BILAN\" with title \"Annonces Facebook\" sound name \"Glass\"" >/dev/null 2>&1
fin "$CODE"
