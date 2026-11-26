#!/usr/bin/env python3
# Affiche en direct les actions de Claude (claude -p --output-format stream-json --verbose sur l'entrée standard).
import json, sys

def court(nom, entree):
    nom = nom.replace('mcp__claude-in-chrome__', '')
    if nom == 'Bash':
        return 'commande : ' + entree.get('command', '').split('rapporter.py')[-1].strip()
    if nom == 'navigate':
        return 'ouvre ' + str(entree.get('url', ''))
    if nom == 'computer':
        action = entree.get('action', '')
        detail = entree.get('text') or entree.get('coordinate') or entree.get('ref') or ''
        detail = ' '.join(str(detail).split())[:60]
        return f'{action} {detail}'.strip()
    if nom == 'find':
        return 'cherche : ' + str(entree.get('query', ''))[:60]
    return nom

for ligne in sys.stdin:
    try:
        d = json.loads(ligne)
    except ValueError:
        continue
    if d.get('type') == 'assistant':
        for c in d.get('message', {}).get('content', []):
            if c.get('type') == 'tool_use':
                print('  · ' + court(c.get('name', ''), c.get('input') or {}), flush=True)
            elif c.get('type') == 'text' and c.get('text', '').strip():
                print('  » ' + ' '.join(c['text'].split())[:200], flush=True)
    elif d.get('type') == 'result':
        print('\n' + (d.get('result') or d.get('subtype') or ''), flush=True)
