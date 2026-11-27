<?php
// Lien de téléchargement de la Table d'analyse → fichier envoyé (« Table Analyse.<ext> », cf. servir_fichier_ta).
// GET ?jeton=… : lien envoyé par mail ; le premier clic confirme l'adresse (telecharge_le), chaque clic est signalé.
// GET ?fichier=…&systeme=… : visiteur identifié (liens directs de /table-analyse/), téléchargement enregistré.
require __DIR__ . '/_brevo.php';

function aller(string $url): void {
  header('Location: ' . $url, true, 302);
  exit;
}

function signaler(array $t): void {
  brevo_ajouter($t['email'], 'telechargement');
  [$objet, $corps] = mail_modele('prof-telechargement', ['email' => $t['email'], 'systeme' => $t['systeme'], 'version' => $t['version'], 'date' => $t['telecharge_le']], null);
  envoyer_mail(NOTIFICATIONS, $objet, $corps);
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
  }
  // Chaque téléchargement est signalé, même par un lien déjà utilisé
  signaler(array_merge($t, ['telecharge_le' => $maintenant]));
  // Ancienne demande : lien d'une Release GitHub
  if (str_starts_with($t['fichier'], 'https://github.com/')) aller($t['fichier']);
  servir_fichier_ta($t['fichier']);
}

$fichier = (string) ($_GET['fichier'] ?? '');
$user = user_courant();
if (!$user || !fichier_disponible($fichier)) aller('/table-analyse/');
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
servir_fichier_ta($fichier);
