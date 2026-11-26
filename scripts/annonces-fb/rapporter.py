#!/usr/bin/env python3
# Renvoie au site le résultat d'un groupe Facebook (utilisé par Claude, lancé par informer-groupes-fb.command).
#   rapporter.py <groupe> verification existant|introuvable
#   rapporter.py <groupe> publication <annonce> ok|echec [détail]
import json, os, sys, urllib.request

API = os.environ.get('CAMI_API_FB', 'https://www.analyse-musicale.fr/api/annonces-fb.php')
CLE = os.path.expanduser('~/.cami/annonces-fb.key')

if len(sys.argv) < 4 or sys.argv[2] not in ('verification', 'publication'):
    sys.exit('Usage : rapporter.py <groupe> verification|publication <valeur> [détail]')
donnees = {'groupe': int(sys.argv[1])}
reste = sys.argv[3:]
if sys.argv[2] == 'publication':
    if len(reste) < 2:
        sys.exit('Usage : rapporter.py <groupe> publication <annonce> ok|echec [détail]')
    donnees['annonce'] = int(reste.pop(0))
donnees[sys.argv[2]] = reste[0]
if len(reste) > 1:
    donnees['detail'] = ' '.join(reste[1:])
requete = urllib.request.Request(API, data=json.dumps(donnees).encode(), method='POST', headers={
    'Content-Type': 'application/json',
    'X-Cami-Cle': open(CLE).read().strip(),
    'User-Agent': 'CAMI-annonces-fb',
})
reponse = json.load(urllib.request.urlopen(requete, timeout=30))
print('enregistré' if reponse.get('ok') else 'REFUSÉ PAR LE SITE')
sys.exit(0 if reponse.get('ok') else 1)
