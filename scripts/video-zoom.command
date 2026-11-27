#!/usr/bin/env bash
# Double-clic après une séance Zoom des « Jeudis de l'analyse » (vidéo retouchée) :
# 1. choix de la séance (séances Zoom passées sans vidéo) et de la vidéo ;
# 2. compositeur / œuvre demandés s'ils manquent ;
# 3. envoi sur la chaîne YouTube (titre « Analyses Musicales Improvisées — … », description
#    tirée de site/src/content/youtube/description-direct.txt), publication immédiate ou programmée ;
# 4. lien de la vidéo enregistré dans la séance (œil « Revoir l'analyse » du calendrier).
# Jeton YouTube lu sur le serveur (data/analyse_musicale/youtube.json), jamais gardé sur ce Mac.
cd "$(dirname "$0")/.." || exit 1
clear; clear
PROGRAMME=$(cat <<'PYTHON'
import json, os, re, subprocess, sys, urllib.parse, urllib.request, http.client
from datetime import datetime

SITE = 'https://www.analyse-musicale.fr'
SSH = 'icare@ssh-icare.alwaysdata.net'
MODELE = 'site/src/content/youtube/description-direct.txt'
MINIATURE = 'site/public/miniature-direct.jpg'
MORCEAU = 16 * 1024 * 1024
MOIS = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre']

def fin(msg, code=1):
    print('\n' + msg)
    sys.exit(code)

def date_longue(jour):
    d = datetime.strptime(jour, '%Y-%m-%d')
    return f"jeudi {'1er' if d.day == 1 else d.day} {MOIS[d.month - 1]} {d.year}"

brut = lambda t: re.sub(r'\^([^\^\s]+)\^', r'\1', t or '')

print("\033[34mCe script permet de déposer une vidéo Zoom (jeudis de l'analyse) sur YouTube. La vidéo ne doit être déposée qu'une fois achevée (corrigée).\033[0m\n")
if input('\033[33mProcéder à ce dépôt ? (Y/n)\033[0m ').strip().lower() in ('n', 'non'):
    fin('Dépôt abandonné.', 0)

# 1. Séance
etat =json.load(urllib.request.urlopen(SITE + '/api/etat.php'))
seances = [s for s in etat['seances'].values() if s.get('diffusion') == 'zoom' and s['etat'] != 'avant' and not s['youtube']]
seances.sort(key=lambda s: s['jour'], reverse=True)
if not seances:
    fin('Aucune séance Zoom passée en attente de vidéo.', 0)
if len(seances) == 1:
    s = seances[0]
else:
    for i, x in enumerate(seances, 1):
        print(f"{i}. {date_longue(x['jour'])} — {x['vignette']}")
    choix = input('Numéro de la séance : ').strip()
    if not choix.isdigit() or not 1 <= int(choix) <= len(seances):
        fin('Numéro invalide.')
    s = seances[int(choix) - 1]
print(f"Séance du {date_longue(s['jour'])}")

# 2. Compositeur / œuvre
compositeur = s['compositeur'] or input('Compositeur : ').strip()
oeuvre = s['oeuvre'] or input('Œuvre : ').strip()
piece = ', '.join(x for x in (brut(compositeur), brut(oeuvre)) if x)

# 3. Vidéo
dossier = os.path.expanduser('~/Documents/Zoom')
script = f'POSIX path of (choose file with prompt "Vidéo de la séance du {date_longue(s["jour"])}" of type {{"public.movie"}} default location (POSIX file "{dossier}"))'
r = subprocess.run(['osascript', '-e', script], capture_output=True, text=True)
video = r.stdout.strip()
if not video:
    fin('Aucune vidéo choisie.', 0)

# 4. Publication
quand = input('Publication (AAAA-MM-JJ HH:MM ; Entrée = tout de suite) : ').strip()
publier = None
if quand:
    try:
        publier = datetime.strptime(quand, '%Y-%m-%d %H:%M').astimezone()
    except ValueError:
        fin('Date invalide.')

titre = ('Analyses Musicales Improvisées' + (f' — {piece}' if piece else ''))[:100]
valeurs = {
    '{analyste}': 'Philippe Perret' if s['analyste'] == 'Ph. Perret' else brut(s['analyste']),
    '{oeuvre}': piece, '{partition}': s['partition'], '{site}': SITE,
}
lignes = []
for ligne in open(MODELE, encoding='utf-8').read().replace('\r', '').split('\n'):
    if any(v == '' and k in ligne for k, v in valeurs.items()):
        continue
    for k, v in valeurs.items():
        ligne = ligne.replace(k, v)
    lignes.append(ligne)
description = '\n'.join(lignes).strip()

taille = os.path.getsize(video)
print(f"\nTitre : {titre}\nVidéo : {video} ({taille / 1e6:.0f} Mo)")
print('Publication : ' + (publier.strftime('%d/%m/%Y %H:%M') if publier else 'immédiate (publique)'))
print('Description :\n' + description + '\n')
if input('Envoyer ? (o/n) ').strip().lower() != 'o':
    fin('Envoi abandonné.', 0)

# 5. Jeton
cles = json.loads(subprocess.run(['ssh', SSH, 'cat data/analyse_musicale/youtube.json'], capture_output=True, text=True, check=True).stdout)
jeton = json.load(urllib.request.urlopen('https://oauth2.googleapis.com/token', urllib.parse.urlencode({
    'client_id': cles['client_id'], 'client_secret': cles['client_secret'],
    'refresh_token': cles['refresh_token'], 'grant_type': 'refresh_token'}).encode()))['access_token']

# 6. Envoi (reprise possible par morceaux)
statut = {'privacyStatus': 'private', 'publishAt': publier.isoformat()} if publier else {'privacyStatus': 'public'}
statut['selfDeclaredMadeForKids'] = False
meta = json.dumps({'snippet': {'title': titre, 'description': description}, 'status': statut}).encode()
cx = http.client.HTTPSConnection('www.googleapis.com', timeout=300)
cx.request('POST', '/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status', meta, {
    'Authorization': f'Bearer {jeton}', 'Content-Type': 'application/json; charset=UTF-8',
    'X-Upload-Content-Length': str(taille), 'X-Upload-Content-Type': 'video/*'})
rep = cx.getresponse(); corps = rep.read()
if rep.status != 200:
    fin(f'YouTube a refusé l’envoi ({rep.status}) : {corps.decode(errors="replace")}')
adresse = urllib.parse.urlparse(rep.getheader('Location'))
chemin = adresse.path + '?' + adresse.query
with open(video, 'rb') as f:
    debut = 0
    while debut < taille:
        bloc = f.read(MORCEAU)
        fin_bloc = debut + len(bloc) - 1
        cx = http.client.HTTPSConnection(adresse.netloc, timeout=600)
        cx.request('PUT', chemin, bloc, {'Authorization': f'Bearer {jeton}', 'Content-Range': f'bytes {debut}-{fin_bloc}/{taille}'})
        rep = cx.getresponse(); corps = rep.read()
        if rep.status not in (200, 201, 308):
            fin(f'Envoi interrompu ({rep.status}) : {corps.decode(errors="replace")}')
        debut = fin_bloc + 1
        print(f'\rEnvoi : {debut * 100 // taille} %', end='', flush=True)
identifiant = json.loads(corps)['id']
lien = f'https://www.youtube.com/watch?v={identifiant}'
print(f'\nVidéo envoyée : {lien}')

# 7. Miniature (logo CAMI) ; un échec n'empêche rien
try:
    urllib.request.urlopen(urllib.request.Request(
        f'https://www.googleapis.com/upload/youtube/v3/thumbnails/set?videoId={identifiant}',
        open(MINIATURE, 'rb').read(), {'Authorization': f'Bearer {jeton}', 'Content-Type': 'image/jpeg'}))
except Exception as err:
    print(f'Miniature refusée : {err}')

# 8. Lien enregistré dans la séance
r = subprocess.run(['ssh', SSH, 'php www/analyse_musicale/api/_video_zoom.php'], input=json.dumps(
    {'jour': s['jour'], 'youtube': lien, 'compositeur': compositeur, 'oeuvre': oeuvre}), capture_output=True, text=True)
if r.returncode != 0:
    fin(f'Lien à ajouter à la main dans la séance : {lien}\n{r.stderr}')
print('Lien enregistré dans la séance.')
PYTHON
)
python3 -c "$PROGRAMME"
read -n 1 -s -r -p "Appuyer sur une touche pour fermer…"
