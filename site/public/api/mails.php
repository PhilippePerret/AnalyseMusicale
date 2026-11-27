<?php
// Mails de l'administrateur depuis /contact/ (à n'importe quelle adresse, inscrite ou non).
// GET : mails-types {ok, types: [{id, titre, objet, corps}], variables}.
// POST JSON {email, objet, message} : envoi (Reply-To + copie à l'administrateur).
require __DIR__ . '/_cami.php';

if (!est_admin(user_courant())) repondre(['ok' => false, 'erreur' => 'admin'], 403);

if ($_SERVER['REQUEST_METHOD'] === 'GET') {
  // Mails-types : src/content/mails/types/<id>.txt (« Titre : », « Objet : », puis le corps ; lignes « // » ignorées)
  $types = [];
  foreach (glob(__DIR__ . '/mails/types/*.txt') as $f) {
    $lignes = array_values(array_filter(explode("\n", str_replace("\r", '', (string) file_get_contents($f))), function ($l) { return strpos(ltrim($l), '//') !== 0; }));
    $t = ['id' => basename($f, '.txt'), 'titre' => '', 'objet' => ''];
    while ($lignes && preg_match('/^(Titre|Objet)\s*:\s*(.*)$/u', $lignes[0], $m)) { $t[strtolower($m[1])] = trim($m[2]); array_shift($lignes); }
    $types[] = $t + ['corps' => rtrim(implode("\n", $lignes))];
  }
  repondre(['ok' => true, 'types' => $types, 'variables' => ['url-cours' => SITE . '/cours/']]);
}

$e = entree_post();
$email   = trim((string) ($e['email'] ?? ''));
$objet   = texte($e['objet'] ?? '', 200);
$message = trim(str_replace("\r", '', (string) ($e['message'] ?? '')));

if (!filter_var($email, FILTER_VALIDATE_EMAIL)) repondre(['ok' => false, 'erreur' => 'email'], 400);
if ($objet === '' || $message === '' || mb_strlen($message) > 20000) repondre(['ok' => false, 'erreur' => 'champs'], 400);

if (!envoyer_mail($email, $objet, $message . "\n", null, NOTIFICATIONS)) repondre(['ok' => false, 'erreur' => 'envoi'], 500);
[$objet_copie, $corps] = mail_modele('prof-copie-mail', ['objet' => $objet, 'email' => $email, 'message' => $message], null);
envoyer_mail(NOTIFICATIONS, $objet_copie, $corps);
repondre(['ok' => true]);
