<?php
// POST {action: enregistrer | supprimer, jour, …} : édition d'une séance (administrateur).
require __DIR__ . '/_cami.php';

$e = entree_post();
if (!est_admin(user_courant())) repondre(['ok' => false, 'erreur' => 'admin'], 403);
$jour = $e['jour'] ?? null;
if (!jour_valide($jour)) repondre(['ok' => false, 'erreur' => 'jour'], 422);

if (($e['action'] ?? '') === 'supprimer') {
  db()->prepare('DELETE FROM seances WHERE jour = ?')->execute([$jour]);
  repondre(['ok' => true]);
}

$heure = function ($h, string $min, string $max) {
  return is_string($h) && preg_match('/^\d{2}:00$/', $h) && $h >= $min && $h <= $max ? $h : null;
};
$debut = $heure($e['debut'] ?? null, '09:00', '21:00');
$fin = $heure($e['fin'] ?? null, '09:00', '23:00');
$youtube = trim((string) ($e['youtube'] ?? ''));
if (!$debut || !$fin || $fin <= $debut) repondre(['ok' => false, 'erreur' => 'heures'], 422);
if ($youtube !== '' && !preg_match('#^https://[^\s"<>]+$#', $youtube)) repondre(['ok' => false, 'erreur' => 'youtube'], 422);
$partition = trim((string) ($e['partition'] ?? ''));
if ($partition !== '' && !preg_match('#^https?://[^\s"<>]+$#', $partition)) repondre(['ok' => false, 'erreur' => 'partition'], 422);
$analyste = texte($e['analyste'] ?? '', 80) ?: 'Ph. Perret';

db()->prepare('INSERT INTO seances (jour, compositeur, oeuvre, analyste, debut, fin, youtube, partition) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  ON CONFLICT(jour) DO UPDATE SET compositeur = excluded.compositeur, oeuvre = excluded.oeuvre,
  analyste = excluded.analyste, debut = excluded.debut, fin = excluded.fin, youtube = excluded.youtube, partition = excluded.partition')
  ->execute([$jour, texte($e['compositeur'] ?? '', 80), texte($e['oeuvre'] ?? '', 200), $analyste, $debut, $fin, mb_substr($youtube, 0, 300), mb_substr($partition, 0, 300)]);
repondre(['ok' => true]);
