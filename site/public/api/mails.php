<?php
// Mails de l'administrateur depuis /contact/ (à n'importe quelle adresse, inscrite ou non).
// GET : mails-types {ok, types: [{id, titre, objet, corps}], variables}.
// POST JSON {email, objet, message} : envoi (Reply-To + copie à l'administrateur).
require __DIR__ . '/_cami.php';
require __DIR__ . '/_mails_types.php';

if (!est_admin(user_courant())) repondre(['ok' => false, 'erreur' => 'admin'], 403);

if ($_SERVER['REQUEST_METHOD'] === 'GET') {
  $types = [];
  foreach (MAILS_TYPES as $id => $t) $types[] = ['id' => $id, 'titre' => $t['titre'], 'objet' => $t['objet'], 'corps' => $t['corps']];
  repondre(['ok' => true, 'types' => $types, 'variables' => ['url-cours' => SITE . '/cours/']]);
}

$e = entree_post();
$email   = trim((string) ($e['email'] ?? ''));
$objet   = texte($e['objet'] ?? '', 200);
$message = trim(str_replace("\r", '', (string) ($e['message'] ?? '')));

if (!filter_var($email, FILTER_VALIDATE_EMAIL)) repondre(['ok' => false, 'erreur' => 'email'], 400);
if ($objet === '' || $message === '' || mb_strlen($message) > 20000) repondre(['ok' => false, 'erreur' => 'champs'], 400);

if (!envoyer_mail($email, $objet, $message . "\n", null, NOTIFICATIONS)) repondre(['ok' => false, 'erreur' => 'envoi'], 500);
envoyer_mail(NOTIFICATIONS, 'Copie • ' . $objet, "Envoyé à : $email\n\n$message\n");
repondre(['ok' => true]);
