<?php
// Tâches périodiques du site : chaque vérification ou envoi automatique s'ajoute à TACHES.
// Ligne de commande seulement (tâche planifiée Alwaysdata, toutes les 5 minutes) :
//   php /home/icare/www/analyse_musicale/api/_taches.php
if (PHP_SAPI !== 'cli') { http_response_code(404); exit; }
require_once __DIR__ . '/_cami.php';
require_once __DIR__ . '/_invitations.php';
require_once __DIR__ . '/_alertes.php';
require_once __DIR__ . '/_cours.php';
require_once __DIR__ . '/_annonces_fb.php';

// nom => fonction renvoyant le nombre d'éléments traités
const TACHES = [
  'invitations programmées' => 'envoyer_invitations_dues',
  'alertes des directs' => 'envoyer_alertes_directs',
  'rappels des cours' => 'envoyer_rappels_cours',
  'avis d’annonce Facebook' => 'aviser_annonce_fb',
];

foreach (TACHES as $nom => $tache) {
  try {
    $n = $tache();
    if ($n) echo date('Y-m-d H:i') . " : $nom : $n\n";
  } catch (Throwable $e) {
    error_log("_taches.php : $nom : " . $e->getMessage());
    echo date('Y-m-d H:i') . " : $nom : ERREUR " . $e->getMessage() . "\n";
  }
}
