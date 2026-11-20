<?php
// Téléchargement de la Table d'analyse (page /table-analyse/).
// Reçoit l'adresse mail et le fichier de la plateforme choisie (POST),
// enregistre la demande dans la base (table telechargements) et envoie à cette
// adresse un lien propre à la demande (api/telecharger.php?jeton=…) : son
// premier clic confirme l'adresse. Réponse JSON {ok, error}.
require __DIR__ . '/api/_cami.php';

// Commande Terminal sortant l'application de la quarantaine (macOS, application non signée)
const DEBLOCAGE_MAC = 'xattr -dr com.apple.quarantine /Applications/Table-d-analyse.app';

function reponse(bool $ok, string $error = ''): void {
  repondre(['ok' => $ok, 'error' => $error]);
}

if ($_SERVER['REQUEST_METHOD'] !== 'POST') reponse(false, 'methode');

// Champ piège rempli : robot. On fait mine d'avoir envoyé.
if (trim($_POST['site_web'] ?? '') !== '') reponse(true);

$email = strtolower(trim($_POST['email'] ?? ''));
if (mb_strlen($email) > 200 || !filter_var($email, FILTER_VALIDATE_EMAIL)) reponse(false, 'email');

// Fichier de la plateforme : dans une Release GitHub de l'application
$fichier = (string) ($_POST['fichier'] ?? '');
$systeme = texte($_POST['systeme'] ?? '', 40);
if (!fichier_valide($fichier)) reponse(false, 'plateforme');
$jeton = bin2hex(random_bytes(16));

// Marche à suivre pour ouvrir l'application non signée (mail macOS seulement)
function texte_deblocage_mac(): string {
  return "Apple contraignant de payer un abonnement annuel de développeur pour « autoriser » les applications, "
    . "même lorsqu'on les fournit gratuitement, il est nécessaire de débloquer Table d’analyse (une seule fois) "
    . "pour pouvoir l'utiliser. À cette fin :\n"
    . "- ouvrez votre application Terminal (Cmd+Espace puis tapez \"Termi\"),\n"
    . "- copiez-collez le code : " . DEBLOCAGE_MAC . "\n"
    . "- pressez la touche Entrée\n"
    . "- rejoignez le dossier /Applications\n"
    . "- control-cliquez sur l'application (ou clic-droit)\n"
    . "- choisissez le menu \"Ouvrir\"\n\n"
    . "L'application devrait s'ouvrir sans problème. Si cependant vous en rencontrez, "
    . "merci de nous en informer en répondant à ce message.\n\n";
}

// Lien de téléchargement envoyé au demandeur
$corps = "Bonjour,\n\n"
  . "Voici le lien pour télécharger la Table d’analyse ($systeme) :\n\n"
  . SITE . '/api/telecharger.php?jeton=' . $jeton . "\n\n"
  . (preg_match('/\.dmg$/', $fichier) ? texte_deblocage_mac() : '')
  . "Bonnes analyses !\n\nPhilippe Perret\nCours d’Analyse Musicale — " . SITE . "\n";
if (!envoyer_mail($email, 'Votre lien de téléchargement de la Table d’analyse', $corps)) reponse(false, 'envoi');

$date = date('Y-m-d H:i:s');
$version = version_fichier($fichier);
db()->prepare('INSERT INTO telechargements (email, systeme, fichier, version, jeton, le) VALUES (?, ?, ?, ?, ?, ?)')
  ->execute([$email, $systeme, $fichier, $version, $jeton, $date]);
envoyer_mail(NOTIFICATIONS, 'CAMI • Demande de lien de la Table d’analyse', "Adresse : $email\nPlateforme : $systeme\nVersion : $version\nDate : $date\n");

reponse(true);
