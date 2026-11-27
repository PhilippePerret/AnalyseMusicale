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

// --- Mail envoyé au demandeur (modèles telechargement-lien.txt et .html, src/content/mails/) ---

$lien = SITE . '/api/telecharger.php?jeton=' . $jeton;
$v = [
  'lien' => $lien, 'commande-mac' => DEBLOCAGE_MAC,
  'mac' => preg_match('/\.dmg$/', $fichier) ? 'oui' : '', 'windows' => preg_match('/\.exe$/', $fichier) ? 'oui' : '',
];
[$objet, $corps] = mail_modele('telechargement-lien', $v, null);
[, $html] = mail_modele('telechargement-lien', array_map('htmlspecialchars', $v) + ['site-court' => preg_replace('#^https?://#', '', SITE)], null, 'html');
if (!envoyer_mail($email, $objet, $corps, null, '', $html)) reponse(false, 'envoi');

$date = date('Y-m-d H:i:s');
$version = version_fichier($fichier);
db()->prepare('INSERT INTO telechargements (email, systeme, fichier, version, jeton, le) VALUES (?, ?, ?, ?, ?, ?)')
  ->execute([$email, $systeme, $fichier, $version, $jeton, $date]);
[$objet, $corps] = mail_modele('prof-demande-lien-table', ['email' => $email, 'systeme' => $systeme, 'version' => $version, 'date' => $date], null);
envoyer_mail(NOTIFICATIONS, $objet, $corps);

reponse(true);
