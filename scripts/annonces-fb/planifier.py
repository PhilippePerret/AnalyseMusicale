#!/usr/bin/env python3
# Au démarrage de la session (LaunchAgent fr.analyse-musicale.annonces-fb, installé par annonces-fb-demarrage.command) :
# 1. publications déjà dues → informer-groupes-fb.command lancé tout de suite ;
# 2. échéances d'aujourd'hui encore à venir → un LaunchAgent par heure (fr.analyse-musicale.annonces-fb.AAAAMMJJ-HHMM)
#    qui lance informer-groupes-fb.command à l'heure dite, puis se retire.
# Les agents des jours passés sont retirés. Journal : ~/.cami/annonces-fb-planification.log
import datetime, json, os, plistlib, subprocess, time, urllib.request

ICI = os.path.dirname(os.path.abspath(__file__))
COMMANDE = os.path.join(os.path.dirname(ICI), 'informer-groupes-fb.command')
API = os.environ.get('CAMI_API_FB', 'https://www.analyse-musicale.fr/api/annonces-fb.php')
CLE = os.path.expanduser('~/.cami/annonces-fb.key')
AGENTS = os.path.expanduser('~/Library/LaunchAgents')
PREFIXE = 'fr.analyse-musicale.annonces-fb.'
JOURNAL = os.path.expanduser('~/.cami/annonces-fb-planification.log')
UID = os.getuid()


def noter(texte):
    with open(JOURNAL, 'a') as j:
        j.write(f"{datetime.datetime.now():%d/%m/%Y %H:%M} : {texte}\n")


def travail():
    requete = urllib.request.Request(API, headers={'X-Cami-Cle': open(CLE).read().strip(), 'User-Agent': 'CAMI-annonces-fb'})
    for essai in range(10):   # réseau parfois absent juste après le démarrage
        try:
            return json.load(urllib.request.urlopen(requete, timeout=30))
        except Exception as e:
            erreur = e
            time.sleep(30)
    raise erreur


def retirer(label):
    subprocess.run(['launchctl', 'bootout', f'gui/{UID}/{label}'], capture_output=True)
    chemin = os.path.join(AGENTS, label + '.plist')
    if os.path.exists(chemin):
        os.remove(chemin)


def programmer(quand):
    label = PREFIXE + quand.strftime('%Y%m%d-%H%M')
    chemin = os.path.join(AGENTS, label + '.plist')
    if os.path.exists(chemin):
        return False
    # À l'heure dite : lance la commande (fenêtre du Terminal), puis retire l'agent
    script = (f'open "{COMMANDE}"; rm -f "{chemin}"; launchctl bootout gui/{UID}/{label}')
    with open(chemin, 'wb') as f:
        plistlib.dump({
            'Label': label,
            'ProgramArguments': ['/bin/bash', '-c', script],
            'StartCalendarInterval': {'Hour': quand.hour, 'Minute': quand.minute},
        }, f)
    subprocess.run(['launchctl', 'bootstrap', f'gui/{UID}', chemin], capture_output=True)
    return True


def main():
    aujourdhui = datetime.date.today()
    # Agents des jours passés (Mac éteint à l'heure dite) : retirés
    for nom in os.listdir(AGENTS):
        if nom.startswith(PREFIXE) and nom.endswith('.plist'):
            jour = nom[len(PREFIXE):len(PREFIXE) + 8]
            if jour.isdigit() and jour < aujourdhui.strftime('%Y%m%d'):
                retirer(nom[:-len('.plist')])
    t = travail()
    if t.get('publier'):
        noter(f"{len(t['publier'])} publication(s) déjà due(s) : envoi lancé")
        subprocess.run(['open', COMMANDE])
    maintenant = datetime.datetime.now()
    for e in t.get('prochaines', []):
        quand = datetime.datetime.strptime(e, '%Y-%m-%d %H:%M')
        if quand.date() == aujourdhui and quand > maintenant and programmer(quand):
            noter(f"envoi programmé à {quand:%H:%M}")


if __name__ == '__main__':
    try:
        main()
    except Exception as e:
        noter(f'ERREUR : {e}')
        subprocess.run(['osascript', '-e', f'display notification "Programmation impossible : {str(e)[:80]}" with title "Annonces Facebook"'])
