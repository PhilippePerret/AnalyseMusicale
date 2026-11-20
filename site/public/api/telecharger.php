<?php
// Lien de téléchargement de la Table d'analyse → redirection vers le fichier (Release GitHub).
// GET ?jeton=… : lien envoyé par mail ; le premier clic confirme l'adresse (telecharge_le).
// GET ?fichier=…&systeme=… : visiteur identifié (liens directs de /table-analyse/), téléchargement enregistré.
require __DIR__ . '/_cami.php';

function aller(string $url): void {
  header('Location: ' . $url, true, 302);
  exit;
}

function signaler(array $t): void {
  envoyer_mail(NOTIFICATIONS, 'CAMI • Table d’analyse téléchargée',
    "Adresse : {$t['email']}\nPlateforme : {$t['systeme']}\nVersion : {$t['version']}\nDate : {$t['telecharge_le']}\n");
}

$maintenant = date('Y-m-d H:i:s');
$jeton = (string) ($_GET['jeton'] ?? '');

if ($jeton !== '') {
  $st = db()->prepare('SELECT * FROM telechargements WHERE jeton = ?');
  $st->execute([$jeton]);
  $t = preg_match('/^[0-9a-f]{32}$/', $jeton) ? ($st->fetch() ?: null) : null;
  if (!$t) aller('/table-analyse/');
  if (!$t['telecharge_le']) {
    db()->prepare('UPDATE telechargements SET telecharge_le = ? WHERE id = ?')->execute([$maintenant, $t['id']]);
    signaler(array_merge($t, ['telecharge_le' => $maintenant]));
  }
  aller($t['fichier']);
}

$fichier = (string) ($_GET['fichier'] ?? '');
$user = user_courant();
if (!$user || !fichier_valide($fichier)) aller('/table-analyse/');
$t = [
  'email' => strtolower($user['email']),
  'systeme' => texte($_GET['systeme'] ?? '', 40),
  'fichier' => $fichier,
  'version' => version_fichier($fichier),
  'telecharge_le' => $maintenant,
];
db()->prepare('INSERT INTO telechargements (email, systeme, fichier, version, le, telecharge_le) VALUES (?, ?, ?, ?, ?, ?)')
  ->execute([$t['email'], $t['systeme'], $fichier, $t['version'], $maintenant, $maintenant]);
signaler($t);
aller($fichier);
