<?php
// Ligne de commande seulement (scripts/video-zoom.command, par ssh) : après l'envoi sur
// YouTube de la vidéo d'une séance Zoom, enregistre son lien (et compositeur / œuvre).
// Entrée standard : {"jour": "AAAA-MM-JJ", "youtube": "https://…", "compositeur": "…", "oeuvre": "…"}
if (PHP_SAPI !== 'cli') exit;
require __DIR__ . '/_cami.php';

$e = json_decode((string) stream_get_contents(STDIN), true);
$s = is_array($e) && jour_valide($e['jour'] ?? null) ? seance($e['jour']) : null;
if (!$s || !preg_match('#^https://[^\s"<>]+$#', (string) ($e['youtube'] ?? ''))) {
  fwrite(STDERR, "Séance ou lien invalide\n");
  exit(1);
}
db()->prepare('UPDATE seances SET youtube = ?, compositeur = ?, oeuvre = ? WHERE jour = ?')
  ->execute([$e['youtube'], texte($e['compositeur'] ?? $s['compositeur'], 80), texte($e['oeuvre'] ?? $s['oeuvre'], 200), $e['jour']]);
echo "ok\n";
