<?php
// Envoi des invitations programmées arrivées à échéance.
// Ligne de commande seulement (tâche planifiée Alwaysdata, toutes les 5 minutes) :
//   php /home/icare/www/analyse_musicale/api/_envoi_invitations.php
if (PHP_SAPI !== 'cli') { http_response_code(404); exit; }
require __DIR__ . '/_invitations.php';
$n = envoyer_invitations_dues();
if ($n) echo date('Y-m-d H:i') . " : $n invitation(s) envoyée(s)\n";
