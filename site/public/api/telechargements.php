<?php
// GET : nombre de téléchargements de la Table d'analyse (page /table-analyse/, issue #29).
require __DIR__ . '/_cami.php';

$nombre = (int) db()->query('SELECT COUNT(*) FROM telechargements WHERE telecharge_le IS NOT NULL')->fetchColumn();
repondre(['ok' => true, 'nombre' => $nombre]);
