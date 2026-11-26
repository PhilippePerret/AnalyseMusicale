#!/usr/bin/env bash
# Double-clic (bouton « Informer les groupes FB ») : publie les annonces Facebook dues de /admin/annonces/.
# 1. Lit sur le site les groupes à vérifier et les publications dues (clé ~/.cami/annonces-fb.key).
# 2. Pilote Chrome par AppleScript (annonces-fb/publier.py ; session Facebook active dans Chrome) :
#    vérifie l'existence des nouveaux groupes, publie les annonces dues en texte seul dans leurs groupes,
#    renvoie chaque résultat au site (annonces-fb/rapporter.py). Échec : retenté au clic suivant.
#    Chrome (une fois) : Affichage > Développeur > « Autoriser JavaScript à partir des Apple Events ».
cd "$(dirname "$0")" || exit 1
DOSSIER="$(pwd)/annonces-fb"
API="${CAMI_API_FB:-https://www.analyse-musicale.fr/api/annonces-fb.php}"
CLE_FICHIER="$HOME/.cami/annonces-fb.key"

fin() { echo; read -n 1 -s -r -p "Appuyer sur une touche pour fermer…"; exit "${1:-0}"; }

[ -f "$CLE_FICHIER" ] || { echo "Clé introuvable : $CLE_FICHIER"; fin 1; }
TRAVAIL=$(curl -s -f -H "X-Cami-Cle: $(cat "$CLE_FICHIER")" -A "CAMI-annonces-fb" "$API") || { echo "Le site ne répond pas (ou clé refusée)."; fin 1; }
A_FAIRE=$(printf '%s' "$TRAVAIL" | python3 -c 'import json,sys; print(json.load(sys.stdin).get("a_faire", 0))')
if [ "$A_FAIRE" = "0" ]; then echo "Rien à envoyer aux groupes Facebook pour le moment."; fin 0; fi

# Travail gardé pour rapporter.py (noms des groupes et des annonces dans le suivi affiché)
printf '%s' "$TRAVAIL" > "$HOME/.cami/travail-fb.json"
printf '%s' "$TRAVAIL" | python3 "$DOSSIER/liste.py"

# Chrome ouvert (publier.py le pilote)
CHROME_OUVERT_ICI=0
if ! pgrep -xq "Google Chrome"; then
  CHROME_OUVERT_ICI=1
  echo "Ouverture de Chrome…"
  open -ga "Google Chrome"
  sleep 3
fi

echo
echo "Envoi en cours (Chrome, piloté par AppleScript) — résultats au fur et à mesure :"
mkdir -p ../journaux   # journaux du projet (hors git)
JOURNAL="$(cd .. && pwd)/journaux/annonces-fb-envois.log"
{ echo; echo "=== $(date '+%d/%m/%Y %H:%M')"; } >> "$JOURNAL"
python3 -u "$DOSSIER/publier.py" | tee -a "$JOURNAL"
CODE="${PIPESTATUS[0]}"

# Chrome refermé s'il était fermé au départ, ou s'il ne reste aucune fenêtre ouverte
FENETRES=$(osascript -e 'tell application "Google Chrome" to count windows' 2>/dev/null)
if [ "$CHROME_OUVERT_ICI" = "1" ] || [ "$FENETRES" = "0" ]; then
  osascript -e 'quit app "Google Chrome"' >/dev/null 2>&1
fi

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
