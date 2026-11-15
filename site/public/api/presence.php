<?php
// POST {jour, present: true|false} : « Je serai présent·e » (visiteur identifié).
require __DIR__ . '/_cami.php';

$e = entree_post();
$user = user_courant();
if (!$user) repondre(['ok' => false, 'erreur' => 'identification'], 401);
$jour = $e['jour'] ?? null;
if (!jour_valide($jour)) repondre(['ok' => false, 'erreur' => 'jour'], 422);

if (empty($e['present'])) {
  db()->prepare('DELETE FROM presences WHERE user_id = ? AND jour = ?')->execute([$user['id'], $jour]);
} elseif (!ajouter_presence((int) $user['id'], $jour)) {
  repondre(['ok' => false, 'erreur' => 'seance'], 422);
}
repondre(['ok' => true]);
