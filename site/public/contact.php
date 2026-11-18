<?php
// Formulaire de contact du Cours d'Analyse Musicale (CAMI).
// Reçoit le POST de /contact/, envoie le message par mail() puis redirige.

const DESTINATAIRE = 'philippe.perret@analyse-musicale.fr';
const EXPEDITEUR   = 'contact@analyse-musicale.fr';
const OBJETS = [
  'renseignements' => 'Renseignements',
  'jeudis'         => 'Les Jeudis de l’analyse',
  'cours'          => 'Les cours d’analyse',
];

function rediriger(string $page): void {
  header('Location: /contact/' . $page . '/', true, 303);
  exit;
}

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
  header('Location: /contact/', true, 303);
  exit;
}

// Champ piège rempli : robot. On fait mine d'avoir envoyé.
if (trim($_POST['site_web'] ?? '') !== '') rediriger('merci');

// Pas de retour à la ligne dans les champs d'en-tête (injection)
$nom     = trim(str_replace(["\r", "\n"], ' ', $_POST['nom'] ?? ''));
$email   = trim($_POST['email'] ?? '');
$cle     = $_POST['objet'] ?? 'renseignements';
$message = trim($_POST['message'] ?? '');

if ($nom === '' || $message === '' || mb_strlen($nom) > 120 || mb_strlen($message) > 5000) rediriger('erreur');
if (!filter_var($email, FILTER_VALIDATE_EMAIL)) rediriger('erreur');
$objet = OBJETS[$cle] ?? OBJETS['renseignements'];

$sujet = mb_encode_mimeheader('CAMI • ' . $objet, 'UTF-8');
$corps = "Nom : $nom\nE-mail : $email\nObjet : $objet\n\n$message\n";
$entetes = implode("\r\n", [
  'From: ' . mb_encode_mimeheader('CAMI — site', 'UTF-8') . ' <' . EXPEDITEUR . '>',
  'Reply-To: ' . $email,
  'MIME-Version: 1.0',
  'Content-Type: text/plain; charset=UTF-8',
  'Content-Transfer-Encoding: 8bit',
]);

rediriger(mail(DESTINATAIRE, $sujet, $corps, $entetes) ? 'merci' : 'erreur');
