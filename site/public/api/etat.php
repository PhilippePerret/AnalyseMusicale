<?php
// GET : séances, visiteur identifié et ses présences (page /jeudis-analyse/).
require __DIR__ . '/_cami.php';

$user = user_courant();
$maintenant = new DateTime();

$presences = [];
if ($user) {
  $st = db()->prepare('SELECT jour FROM presences WHERE user_id = ?');
  $st->execute([$user['id']]);
  $presences = $st->fetchAll(PDO::FETCH_COLUMN);
}

// Lien Zoom : seulement pour les présents annoncés (et l'administration)
$seances = [];
foreach (db()->query('SELECT * FROM seances ORDER BY jour') as $s) {
  $s['etat'] = etat_seance($s, $maintenant);
  if ($s['diffusion'] === 'zoom' && (in_array($s['jour'], $presences, true) || est_admin($user))) $s['zoom'] = ZOOM_LIEN;
  $seances[$s['jour']] = $s;
}

repondre([
  'ok' => true,
  'maintenant' => $maintenant->format('Y-m-d H:i'),
  'seances' => (object) $seances,
  'user' => user_public($user),
  'presences' => $presences,
]);
