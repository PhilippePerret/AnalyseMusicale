<?php
// Téléchargement de la Table d'analyse (page /table-analyse/).
// Reçoit l'adresse mail et le fichier de la plateforme choisie (POST),
// enregistre la demande dans la base (table telechargements) et envoie à cette
// adresse un lien propre à la demande (api/telecharger.php?jeton=…) : son
// premier clic confirme l'adresse. Réponse JSON {ok, error}.
require __DIR__ . '/api/_cami.php';

// Commande Terminal sortant l'application de la quarantaine (macOS, application non signée)
const DEBLOCAGE_MAC = 'xattr -dr com.apple.quarantine "/Applications/Table Analyse.app"';

function reponse(bool $ok, string $error = ''): void {
  repondre(['ok' => $ok, 'error' => $error]);
}

if ($_SERVER['REQUEST_METHOD'] !== 'POST') reponse(false, 'methode');

// Champ piège rempli : robot. On fait mine d'avoir envoyé.
if (trim($_POST['site_web'] ?? '') !== '') reponse(true);

$email = strtolower(trim($_POST['email'] ?? ''));
if (mb_strlen($email) > 200 || !filter_var($email, FILTER_VALIDATE_EMAIL)) reponse(false, 'email');

// Fichier de la plateforme : déposé dans le dossier des données (cf. dossier_ta)
$fichier = (string) ($_POST['fichier'] ?? '');
$systeme = texte($_POST['systeme'] ?? '', 40);
if (!fichier_valide($fichier)) reponse(false, 'plateforme');
if (!fichier_disponible($fichier)) reponse(false, 'indisponible');
$jeton = bin2hex(random_bytes(16));

// Marche à suivre pour ouvrir l'application non signée (mail macOS seulement),
// placée juste sous le lien de téléchargement
function texte_deblocage_mac(): string {
  return "VOUS DEVEZ DÉBLOQUER L’APPLICATION pour pouvoir l’utiliser(1) :\n"
    . "- ouvrez une fenêtre Terminal (2),\n"
    . "- copiez-collez le code : " . DEBLOCAGE_MAC . "\n"
    . "- pressez la touche Entrée.\n\n"
    . "Vous pouvez maintenant ouvrir l’application et l'utiliser.\n\n"
    . "(1) Apple contraint à payer un abonnement annuel de développeur pour « autoriser » les applications, "
    . "même lorsqu’elles sont fournies gratuitement. Table d’analyse doit donc être débloquée, une seule fois, "
    . "après avoir été placée dans le dossier Applications.\n"
    . "(2) Trouvez l’application avec Spotlight : Cmd + Espace, commencer à taper « Termi », choisir l’application Terminal.\n\n"
    . "Si vous rencontrez un problème, merci de nous en informer en répondant à ce message.\n\n";
}

// Marche à suivre quand l'antivirus bloque l'application non signée (mail Windows seulement)
function texte_deblocage_windows(): string {
  return "Table d’analyse n'étant pas « signée » (signature payante), Windows ou votre antivirus peuvent la bloquer "
    . "ou la placer en quarantaine (confinement). Dans ce cas :\n"
    . "- si Windows affiche « Windows a protégé votre ordinateur », cliquez sur « Informations complémentaires » puis sur « Exécuter quand même »,\n"
    . "- si votre antivirus a confiné l'application, ouvrez-le, rendez-vous dans sa zone de quarantaine (ou de confinement), "
    . "demandez-lui d'en sortir Table d’analyse (« Restaurer », « Autoriser ») et ajoutez-la à ses exceptions.\n\n"
    . "L'application devrait alors s'ouvrir sans problème. Si cependant vous en rencontrez, "
    . "merci de nous en informer en répondant à ce message.\n\n";
}

// Lien de téléchargement envoyé au demandeur
$corps = "Bonjour,\n\n"
  . "Voici le lien pour télécharger la Table d’analyse ($systeme) :\n\n"
  . SITE . '/api/telecharger.php?jeton=' . $jeton . "\n\n"
  . (preg_match('/\.dmg$/', $fichier) ? texte_deblocage_mac() : '')
  . (preg_match('/\.exe$/', $fichier) ? texte_deblocage_windows() : '')
  . "Bonnes analyses !\n\nPhilippe Perret\nClasse d’Analyse Musicale — " . SITE . "\n";
if (!envoyer_mail($email, 'Votre lien de téléchargement de la Table d’analyse', $corps)) reponse(false, 'envoi');

$date = date('Y-m-d H:i:s');
$version = version_fichier($fichier);
db()->prepare('INSERT INTO telechargements (email, systeme, fichier, version, jeton, le) VALUES (?, ?, ?, ?, ?, ?)')
  ->execute([$email, $systeme, $fichier, $version, $jeton, $date]);
envoyer_mail(NOTIFICATIONS, 'CAMI • Demande de lien de la Table d’analyse', "Adresse : $email\nPlateforme : $systeme\nVersion : $version\nDate : $date\n");

reponse(true);
