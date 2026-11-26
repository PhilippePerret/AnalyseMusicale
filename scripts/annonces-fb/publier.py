#!/usr/bin/env python3
# Publication des annonces Facebook dans Chrome, piloté par AppleScript (sans Claude).
# Lit le travail (~/.cami/travail-fb.json, écrit par informer-groupes-fb.command) : groupes à vérifier, publications dues.
# Chaque résultat est renvoyé AUSSITÔT au site (rapporter.py) : une publication réussie n'est jamais refaite.
# Chrome travaille masqué : on peut utiliser le Mac pendant l'envoi.
# Prérequis Chrome (une fois) : Affichage > Développeur > « Autoriser JavaScript à partir des Apple Events ».
# Sécurité anti-doublon : dès que « Publier » a été cliqué, le résultat est « ok » (au pire « non confirmée »), jamais « échec ».
import json, os, subprocess, sys, time

DOSSIER = os.path.dirname(os.path.abspath(__file__))
TRAVAIL = os.path.expanduser('~/.cami/travail-fb.json')

APPLESCRIPT = '''
on run argv
  set action to item 1 of argv
  tell application "Google Chrome"
    if action is "fenetre" then
      set w to make new window
      return (id of w) as text
    end if
    set w to window id ((item 2 of argv) as integer)
    if action is "ouvrir" then
      set URL of active tab of w to (item 3 of argv)
      return "ok"
    else if action is "js" then
      return (execute active tab of w javascript (item 3 of argv)) as text
    else if action is "fermer" then
      close w
      return "ok"
    end if
  end tell
end run
'''


class ErreurChrome(Exception):
    pass


def osa(*args):
    r = subprocess.run(['osascript', '-e', APPLESCRIPT, *args], capture_output=True, text=True)
    if r.returncode != 0:
        erreur = r.stderr.strip()
        if 'JavaScript' in erreur and ('Apple' in erreur or 'désactivé' in erreur or 'turned off' in erreur):
            raise ErreurChrome('Dans Chrome : Affichage > Développeur > cocher « Autoriser JavaScript à partir des Apple Events », puis relancer.')
        raise ErreurChrome(erreur)
    return r.stdout.strip()


def js(fenetre, code):
    return osa('js', fenetre, code)


def attendre(fenetre, code, delai, pas=0.5):
    """Exécute code (qui renvoie '' tant que ce n'est pas prêt) jusqu'à un résultat non vide, ou '' au bout de delai."""
    fin = time.time() + delai
    while time.time() < fin:
        r = js(fenetre, code)
        if r and r != 'missing value':
            return r
        time.sleep(pas)
    return ''


def rapporter(*args):
    env = dict(os.environ, CAMI_SANS_SUIVI='1')
    r = subprocess.run([sys.executable, os.path.join(DOSSIER, 'rapporter.py'), *map(str, args)], capture_output=True, text=True, env=env)
    if r.returncode != 0:
        print(f'   ⚠ RÉSULTAT NON ENREGISTRÉ SUR LE SITE ({" ".join(map(str, args))}) : {(r.stdout + r.stderr).strip()[-200:]}', flush=True)


# --- Scripts exécutés dans la page ---

ETAT_PAGE = r'''(() => {
  if (document.readyState !== 'complete') return '';
  if (location.pathname.startsWith('/login') || document.querySelector('input[name="pass"]')) return 'connexion';
  const t = document.body ? document.body.innerText : '';
  if (/Ce contenu n.est pas disponible|This content isn.t available|Page introuvable/.test(t)) return 'introuvable';
  const invite = [...document.querySelectorAll('[role="button"]')].find(e => /Exprimez-vous|Écrivez quelque chose|Write something/.test(e.textContent));
  return invite ? 'invite' : (t.length > 500 ? 'chargee' : '');
})()'''

CLIC_INVITE = r'''(() => {
  const b = [...document.querySelectorAll('[role="button"]')].find(e => /Exprimez-vous|Écrivez quelque chose|Write something/.test(e.textContent));
  if (!b) return 'absent';
  b.click();
  return 'ok';
})()'''

ZONE = r'''(() => {
  const t = document.querySelector('[role="dialog"] [contenteditable="true"][role="textbox"]');
  if (!t) return '';
  t.focus();
  return 'ok';
})()'''

def coller(texte):
    # Collage simulé (l'éditeur de Facebook traite les retours à la ligne du collage)
    return r'''(() => {
  const t = document.querySelector('[role="dialog"] [contenteditable="true"][role="textbox"]');
  if (!t) return 'absent';
  t.focus();
  const d = new DataTransfer();
  d.setData('text/plain', %s);
  t.dispatchEvent(new ClipboardEvent('paste', { clipboardData: d, bubbles: true, cancelable: true }));
  return 'ok';
})()''' % json.dumps(texte)

def saisir_insert(texte):
    # Secours : saisie ligne à ligne
    return r'''(() => {
  const t = document.querySelector('[role="dialog"] [contenteditable="true"][role="textbox"]');
  if (!t) return 'absent';
  t.focus();
  const lignes = %s;
  lignes.forEach((l, i) => { if (i) document.execCommand('insertParagraph'); if (l) document.execCommand('insertText', false, l); });
  return 'ok';
})()''' % json.dumps(texte.split('\n'))

TEXTE_SAISI = r'''(() => {
  const t = document.querySelector('[role="dialog"] [contenteditable="true"][role="textbox"]');
  return t ? t.innerText : '';
})()'''

VIDER = r'''(() => {
  const t = document.querySelector('[role="dialog"] [contenteditable="true"][role="textbox"]');
  if (!t) return 'absent';
  t.focus();
  document.execCommand('selectAll');
  document.execCommand('delete');
  return 'ok';
})()'''

RETIRER_APERCU = r'''(() => {
  const d = [...document.querySelectorAll('[role="dialog"]')].find(x => x.querySelector('[contenteditable="true"][role="textbox"]'));
  if (!d) return '';
  // « Supprimer l’aperçu du lien… » (et surtout pas « Modifier l’aperçu »)
  const b = [...d.querySelectorAll('[role="button"][aria-label]')].find(e => /^Supprimer l.aperçu du lien|^Remove link preview/i.test(e.getAttribute('aria-label')));
  if (!b) return '';
  b.click();
  return 'retiré';
})()'''

APERCU_PRESENT = r'''(() => {
  const d = [...document.querySelectorAll('[role="dialog"]')].find(x => x.querySelector('[contenteditable="true"][role="textbox"]'));
  return d && [...d.querySelectorAll('[role="button"][aria-label]')].some(e => /^Supprimer l.aperçu du lien|^Remove link preview/i.test(e.getAttribute('aria-label'))) ? 'oui' : 'non';
})()'''

CLIC_PUBLIER = r'''(() => {
  const d = [...document.querySelectorAll('[role="dialog"]')].find(x => x.querySelector('[contenteditable="true"][role="textbox"]'));
  if (!d) return 'absent';
  const p = [...d.querySelectorAll('[role="button"]')].find(e => e.getAttribute('aria-label') === 'Publier' || e.textContent.trim() === 'Publier' || e.textContent.trim() === 'Post');
  if (!p) return 'absent';
  if (p.getAttribute('aria-disabled') === 'true') return 'inactif';
  p.click();
  return 'ok';
})()'''

FENETRE_FERMEE = r'''(() => {
  const ouverte = [...document.querySelectorAll('[role="dialog"]')].some(x => x.querySelector('[contenteditable="true"][role="textbox"]'));
  return ouverte ? '' : 'ok';
})()'''


def normal(t):
    return ' '.join(t.split())


def masquer_chrome():
    subprocess.run(['osascript', '-e', 'tell application "System Events" to set visible of process "Google Chrome" to false'],
                   capture_output=True)


def ouvrir(fenetre, url):
    # Navigation par la page elle-même : Chrome reste masqué (« set URL » d'AppleScript le ramène au premier plan)
    js(fenetre, 'location.href = %s; "ok"' % json.dumps(url))
    time.sleep(1.5)
    return attendre(fenetre, ETAT_PAGE, 20)


def verifier(fenetre, g):
    etat = ouvrir(fenetre, g['url'])
    if etat == 'connexion':
        raise ErreurChrome('Chrome n’est pas connecté à Facebook : se connecter une fois dans Chrome (« Se souvenir de moi »), puis relancer.')
    resultat = 'introuvable' if etat == 'introuvable' else 'existant'
    rapporter(g['id'], 'verification', resultat)
    return resultat


def publier(fenetre, p):
    """Renvoie (statut, détail). Statut « ok » dès que « Publier » a été cliqué."""
    etat = ouvrir(fenetre, p['url'])
    if etat == 'connexion':
        raise ErreurChrome('Chrome n’est pas connecté à Facebook : se connecter une fois dans Chrome (« Se souvenir de moi »), puis relancer.')
    if etat != 'invite':
        time.sleep(2)
    if js(fenetre, CLIC_INVITE) != 'ok':
        return 'echec', 'invite de rédaction absente'
    if not attendre(fenetre, ZONE, 10):
        return 'echec', 'fenêtre de publication absente'
    voulu = normal(p['texte'])
    for saisie in (coller, saisir_insert):
        js(fenetre, VIDER)
        js(fenetre, saisie(p['texte']))
        time.sleep(1)
        if normal(js(fenetre, TEXTE_SAISI)) == voulu:
            break
    else:
        js(fenetre, VIDER)
        return 'echec', 'texte non saisi correctement'
    # Aperçu de lien : apparaît quelques secondes après la saisie d'une adresse ; publication en texte seul
    if 'http' in p['texte']:
        if attendre(fenetre, RETIRER_APERCU, 8):
            time.sleep(1)
            if js(fenetre, APERCU_PRESENT) == 'oui':
                js(fenetre, RETIRER_APERCU)
                time.sleep(1)
        if js(fenetre, APERCU_PRESENT) == 'oui':
            js(fenetre, VIDER)
            return 'echec', 'aperçu du lien impossible à supprimer'
    clic = js(fenetre, CLIC_PUBLIER)
    if clic != 'ok':
        js(fenetre, VIDER)
        return 'echec', f'bouton Publier {clic}'
    # « Publier » cliqué : plus jamais « échec » (risque de doublon)
    if attendre(fenetre, FENETRE_FERMEE, 20):
        return 'ok', ''
    return 'ok', 'publication non confirmée — à vérifier dans le groupe'


def main():
    travail = json.load(open(TRAVAIL))
    verifier_liste, publier_liste = travail.get('verifier', []), travail.get('publier', [])
    fenetre = osa('fenetre')
    osa('ouvrir', fenetre, 'https://www.facebook.com/')   # seule ouverture par AppleScript, puis Chrome masqué
    time.sleep(2)
    masquer_chrome()
    introuvables = set()
    try:
        for i, g in enumerate(verifier_liste, 1):
            debut = time.time()
            r = verifier(fenetre, g)
            if r == 'introuvable':
                introuvables.add(g['id'])
            print(f"{'✓' if r == 'existant' else '✗'} [{i}/{len(verifier_liste)}] {g['nom']} : groupe {r} ({time.time() - debut:.0f} s)", flush=True)
        for i, p in enumerate(publier_liste, 1):
            if p['id'] in introuvables:
                continue
            debut = time.time()
            statut, detail = publier(fenetre, p)
            rapporter(p['id'], 'publication', p['annonce'], statut, *([detail] if detail else []))
            print(f"{'✓' if statut == 'ok' else '✗'} [{i}/{len(publier_liste)}] {p['nom']} (annonce {p['annonce']}) : "
                  f"{'publiée' if statut == 'ok' else 'ÉCHEC'}{' — ' + detail if detail else ''} ({time.time() - debut:.0f} s)", flush=True)
    except ErreurChrome as e:
        print(f'ARRÊT : {e}', flush=True)
        return 1
    finally:
        try:
            osa('fermer', fenetre)
        except ErreurChrome:
            pass
    return 0


if __name__ == '__main__':
    sys.exit(main())
