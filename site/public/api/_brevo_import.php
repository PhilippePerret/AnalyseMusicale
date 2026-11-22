<?php
// Enregistrement sur Brevo des adresses déjà présentes sur le site (ligne de commande seulement) :
//   php /home/icare/www/analyse_musicale/api/_brevo_import.php
// Inscrits confirmés (ou saisis à la main) → Inscrits ; téléchargements effectués → Téléchargements ;
// contacts → Contacts. Peut être relancé sans risque (contacts mis à jour, jamais dupliqués).
if (PHP_SAPI !== 'cli') { http_response_code(404); exit; }
require __DIR__ . '/_brevo.php';

if (brevo_cle() === '') { fwrite(STDERR, "Clé Brevo absente : " . dossier_donnees() . "/brevo.key\n"); exit(1); }

$sources = [
  'inscrit'        => "SELECT lower(email) AS email, genre FROM users WHERE confirme = 1 OR source = 'main'",
  'telechargement' => "SELECT DISTINCT lower(email) AS email, '' AS genre FROM telechargements WHERE telecharge_le IS NOT NULL",
  'contact'        => "SELECT lower(email) AS email, genre FROM contacts",
];
foreach ($sources as $source => $sql) {
  $ok = 0;
  $echecs = [];
  foreach (db()->query($sql)->fetchAll() as $d) {
    if (brevo_ajouter($d['email'], $source, (string) $d['genre'])) $ok++;
    else $echecs[] = $d['email'];
  }
  echo "$source : $ok enregistrée(s)" . ($echecs ? ', échec : ' . implode(', ', $echecs) : '') . "\n";
}
