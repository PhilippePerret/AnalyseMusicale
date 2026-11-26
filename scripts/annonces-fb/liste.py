#!/usr/bin/env python3
# Affiche le travail à faire (JSON de l'API sur l'entrée standard) avant l'envoi aux groupes Facebook.
import json, sys

t = json.load(sys.stdin)
verifier, publier = t.get('verifier', []), t.get('publier', [])
if verifier:
    print(f'Groupes à vérifier ({len(verifier)}) :')
    for g in verifier:
        print(f'  - {g["nom"]}')
if publier:
    print(f'Publications à faire ({len(publier)}) :')
    for p in publier:
        debut = ' '.join(p['texte'].split())[:50]
        print(f'  - {p["nom"]} — « {debut}… » (annonce {p["annonce"]})')
