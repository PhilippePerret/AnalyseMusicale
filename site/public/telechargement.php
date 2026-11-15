<?php
// Téléchargement de la Table d'analyse (page /table-analyse/).
// Reçoit l'adresse mail (POST), l'enregistre (donnees/inscrits.csv) et la
// signale par mail ; réponse JSON {ok, error}.

const DESTINATAIRE = 'philippe.perret@analyse-musicale.fr';
const EXPEDITEUR   = 'contact@analyse-musicale.fr';
const FICHIER      = __DIR__ . '/donnees/inscrits.csv';

header('Content-Type: application/json; charset=utf-8');

function repondre(bool $ok, string $error = ''): void {
  echo json_encode(['ok' => $ok, 'error' => $error]);
  exit;
}

if ($_SERVER['REQUEST_METHOD'] !== 'POST') repondre(false, 'methode');

// Champ piège rempli : robot. On fait mine d'avoir enregistré.
if (trim($_POST['site_web'] ?? '') !== '') repondre(true);

$email = trim($_POST['email'] ?? '');
if (mb_strlen($email) > 200 || !filter_var($email, FILTER_VALIDATE_EMAIL)) repondre(false, 'email');

$date = date('Y-m-d H:i:s');
if (!is_dir(dirname(FICHIER))) mkdir(dirname(FICHIER), 0750, true);
$f = fopen(FICHIER, 'a');
if ($f) {
  flock($f, LOCK_EX);
  fputcsv($f, [$date, $email], ',', '"', '');
  flock($f, LOCK_UN);
  fclose($f);
}

$sujet = mb_encode_mimeheader('CAMI • Téléchargement de la Table d’analyse', 'UTF-8');
$entetes = implode("\r\n", [
  'From: ' . mb_encode_mimeheader('CAMI — site', 'UTF-8') . ' <' . EXPEDITEUR . '>',
  'MIME-Version: 1.0',
  'Content-Type: text/plain; charset=UTF-8',
  'Content-Transfer-Encoding: 8bit',
]);
mail(DESTINATAIRE, $sujet, "Adresse : $email\nDate : $date\n", $entetes);

repondre(true);
