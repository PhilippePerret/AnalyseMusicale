<?php
// POST {action: enregistrer | supprimer, jour, …} : édition d'une séance (administrateur).
// creer_direct: true → crée aussi le direct YouTube programmé (si pas encore de lien).
require __DIR__ . '/_cami.php';
require __DIR__ . '/_youtube.php';

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
// Lien de YouTube Studio collé : remplacé par l'adresse publique du direct
if (preg_match('#^https://studio\.youtube\.com/video/([\w-]+)#', $youtube, $m)) $youtube = 'https://www.youtube.com/watch?v=' . $m[1];
if (!$debut || !$fin || $fin <= $debut) repondre(['ok' => false, 'erreur' => 'heures'], 422);
if ($youtube !== '' && !preg_match('#^https://[^\s"<>]+$#', $youtube)) repondre(['ok' => false, 'erreur' => 'youtube'], 422);
$partition = trim((string) ($e['partition'] ?? ''));
if ($partition !== '' && !preg_match('#^https?://[^\s"<>]+$#', $partition)) repondre(['ok' => false, 'erreur' => 'partition'], 422);
$analyste = texte($e['analyste'] ?? '', 80) ?: 'Ph. Perret';
$vignette = texte($e['vignette'] ?? '', 40);
$diffusion = ($e['diffusion'] ?? '') === 'zoom' ? 'zoom' : 'youtube';
if ($vignette === '') repondre(['ok' => false, 'erreur' => 'vignette'], 422);

db()->prepare('INSERT INTO seances (jour, compositeur, oeuvre, analyste, debut, fin, youtube, partition, vignette, diffusion) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  ON CONFLICT(jour) DO UPDATE SET compositeur = excluded.compositeur, oeuvre = excluded.oeuvre,
  analyste = excluded.analyste, debut = excluded.debut, fin = excluded.fin, youtube = excluded.youtube, partition = excluded.partition, vignette = excluded.vignette, diffusion = excluded.diffusion')
  ->execute([$jour, texte($e['compositeur'] ?? '', 80), texte($e['oeuvre'] ?? '', 200), $analyste, $debut, $fin, mb_substr($youtube, 0, 300), mb_substr($partition, 0, 300), $vignette, $diffusion]);

if (empty($e['creer_direct']) || $youtube !== '' || $diffusion === 'zoom') repondre(['ok' => true]);

// Séance enregistrée ; création du direct (un échec n'annule pas l'enregistrement)
try {
  $lien = creer_direct(seance($jour));
  db()->prepare('UPDATE seances SET youtube = ? WHERE jour = ?')->execute([$lien, $jour]);
  repondre(['ok' => true, 'direct' => $lien, 'flux' => infos_flux()]);
} catch (ErreurYoutube $err) {
  repondre(['ok' => true, 'avertissement' => $err->getMessage()]);
}
