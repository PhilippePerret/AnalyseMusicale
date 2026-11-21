<?php
// GET ?email=…&jour=…&cle=… : lien de refus des alertes des directs (mail d'alerte).
// jour = AAAA-MM-JJ → plus d'alerte pour cette séance ; jour vide → plus aucune alerte.
require __DIR__ . '/_alertes.php';

$email = strtolower(trim((string) ($_GET['email'] ?? '')));
$jour = (string) ($_GET['jour'] ?? '');
$cle = (string) ($_GET['cle'] ?? '');
$valide = filter_var($email, FILTER_VALIDATE_EMAIL) && ($jour === '' || jour_valide($jour))
  && hash_equals(cle_alerte($email, $jour), $cle);
if (!$valide) {
  header('Location: /jeudis-analyse/?alertes=invalide', true, 303);
  exit;
}
db()->prepare('INSERT OR IGNORE INTO alertes_refus (email, jour, le) VALUES (?, ?, ?)')->execute([$email, $jour, date('Y-m-d H:i:s')]);
header('Location: /jeudis-analyse/?alertes=' . ($jour === '' ? 'jamais' : 'session'), true, 303);
