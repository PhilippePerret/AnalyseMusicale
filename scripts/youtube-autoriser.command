#!/usr/bin/env bash
# Double-clic, une seule fois : autorise le site à créer des directs YouTube sur la chaîne.
# 1. Ouvre la page d'autorisation de Google dans le navigateur (choisir la chaîne, accepter).
# 2. Récupère le jeton de rafraîchissement et le dépose sur le serveur, hors du dossier web :
#    /home/icare/data/analyse_musicale/youtube.json (lisible par le seul compte icare).
# Aucun secret n'est gardé sur ce Mac en dehors du fichier client_secret.json d'origine.
cd "$(dirname "$0")" || exit 1

CLIENT_SECRET="/Users/philippeperret/Music/4 pour 2/4pour2/lib/module/api_youtube/modules/client_secret.json"
DESTINATION="icare@ssh-icare.alwaysdata.net:data/analyse_musicale/youtube.json"

TMP=$(mktemp -d) || exit 1
trap 'rm -rf "$TMP"' EXIT

python3 - "$CLIENT_SECRET" "$TMP/youtube.json" <<'PYTHON' || { echo "ÉCHEC de l'autorisation."; read -n 1 -s -r -p "Appuyer sur une touche pour fermer…"; exit 1; }
import json, sys, secrets, urllib.parse, urllib.request, webbrowser
from http.server import BaseHTTPRequestHandler, HTTPServer

source, sortie = sys.argv[1], sys.argv[2]
client = json.load(open(source))['installed']
etat = secrets.token_urlsafe(16)
recu = {}

class Retour(BaseHTTPRequestHandler):
    def do_GET(self):
        recu.update(urllib.parse.parse_qs(urllib.parse.urlparse(self.path).query))
        self.send_response(200)
        self.send_header('Content-Type', 'text/html; charset=utf-8')
        self.end_headers()
        self.wfile.write('<p style="font-family:sans-serif">Autorisation reçue. Cette page peut être fermée.</p>'.encode())
    def log_message(self, *args):
        pass

serveur = HTTPServer(('127.0.0.1', 0), Retour)
retour = f'http://localhost:{serveur.server_port}'
webbrowser.open('https://accounts.google.com/o/oauth2/v2/auth?' + urllib.parse.urlencode({
    'client_id': client['client_id'], 'redirect_uri': retour, 'response_type': 'code',
    'scope': 'https://www.googleapis.com/auth/youtube', 'access_type': 'offline',
    'prompt': 'consent', 'state': etat,
}))
print('Autorisation à donner dans le navigateur…')
while 'code' not in recu and 'error' not in recu:
    serveur.handle_request()
if recu.get('state', [''])[0] != etat or 'code' not in recu:
    sys.exit('Autorisation refusée ou invalide : ' + str(recu.get('error', '')))

reponse = json.load(urllib.request.urlopen(urllib.request.Request(
    'https://oauth2.googleapis.com/token',
    data=urllib.parse.urlencode({
        'code': recu['code'][0], 'client_id': client['client_id'], 'client_secret': client['client_secret'],
        'redirect_uri': retour, 'grant_type': 'authorization_code',
    }).encode())))
if 'refresh_token' not in reponse:
    sys.exit('Google n’a pas fourni de jeton de rafraîchissement.')
with open(sortie, 'w') as f:
    json.dump({'client_id': client['client_id'], 'client_secret': client['client_secret'], 'refresh_token': reponse['refresh_token']}, f)
PYTHON

chmod 600 "$TMP/youtube.json"
ssh icare@ssh-icare.alwaysdata.net 'mkdir -p data/analyse_musicale && chmod 700 data/analyse_musicale' \
  && scp -q -p "$TMP/youtube.json" "$DESTINATION" \
  && echo "Fait : le site peut créer des directs YouTube." \
  || echo "ÉCHEC de l'envoi sur le serveur."
read -n 1 -s -r -p "Appuyer sur une touche pour fermer…"
