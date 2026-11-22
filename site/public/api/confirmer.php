<?php
// GET ?jeton=… : lien du mail de confirmation → compte confirmé, visiteur identifié.
require __DIR__ . '/_brevo.php';

$jeton = (string) ($_GET['jeton'] ?? '');
$st = db()->prepare('SELECT * FROM users WHERE jeton = ? AND jeton IS NOT NULL');
$st->execute([$jeton]);
$user = preg_match('/^[0-9a-f]{32}$/', $jeton) ? ($st->fetch() ?: null) : null;

if (!$user) {
  header('Location: /jeudis-analyse/?confirmation=invalide', true, 303);
  exit;
}

db()->prepare('UPDATE users SET confirme = 1, jeton = NULL, presence_attente = NULL, vu_le = ? WHERE id = ?')->execute([date('Y-m-d H:i:s'), $user['id']]);
brevo_ajouter($user['email'], 'inscrit', (string) $user['genre']);
if ($user['presence_attente']) ajouter_presence((int) $user['id'], $user['presence_attente']);
connecter($user);
header('Location: /jeudis-analyse/?confirmation=ok', true, 303);
