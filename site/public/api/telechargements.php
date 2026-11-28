<?php
// GET : nombre de téléchargements de la Table d'analyse (page /table-analyse/, issue #29).
require __DIR__ . '/_cami.php';

$nombre = (int) db()->query('SELECT COALESCE(SUM(clics), 0) FROM telechargements')->fetchColumn();
repondre(['ok' => true, 'nombre' => $nombre]);
