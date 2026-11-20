<?php
// Adresses connues du site (administrateur) : inscrits, téléchargements de la Table d'analyse,
// adresses seules (contacts).
// GET : liste, une entrée par adresse.
// POST JSON {action: ajouter | supprimer, …}
// POST multipart (en-tête X-Cami) {action: envoyer, emails (JSON), objet, message, piece?} : message à chaque adresse.
require __DIR__ . '/_cami.php';

const PIECE_MAX = 15 * 1024 * 1024;   // taille maximale de la pièce jointe

function liste(): array {
  $personnes = [];
  $personne = function (string $email) use (&$personnes): array {
    $cle = strtolower($email);
    return $personnes[$cle] ?? ['email' => $cle, 'admin' => in_array($cle, ADMINS, true), 'inscription' => null, 'contact' => null, 'telechargements' => [], 'derniere' => ''];
  };
  foreach (db()->query('SELECT email, pseudo, genre, prefs, confirme, source, cree_le FROM users') as $u) {
    $p = $personne($u['email']);
    $p['inscription'] = [
      'pseudo' => $u['pseudo'] ?: '',
      'genre' => $u['genre'],
      'avertir' => ($u['prefs'] & PREF_AVERTIR) !== 0,
      'auditeur' => ($u['prefs'] & PREF_AUDITEUR) !== 0,
      'confirme' => (bool) $u['confirme'],
      'source' => $u['source'],
      'le' => $u['cree_le'],
    ];
    $p['derniere'] = max($p['derniere'], $u['cree_le']);
    $personnes[$p['email']] = $p;
  }
  foreach (db()->query('SELECT email, systeme, version, le, telecharge_le, source FROM telechargements ORDER BY le') as $t) {
    $p = $personne($t['email']);
    $p['telechargements'][] = $t;
    $p['derniere'] = max($p['derniere'], $t['telecharge_le'] ?: $t['le']);
    $personnes[$p['email']] = $p;
  }
  foreach (db()->query('SELECT email, pseudo, genre, cree_le FROM contacts') as $c) {
    $p = $personne($c['email']);
    $p['contact'] = ['pseudo' => $c['pseudo'], 'genre' => $c['genre'], 'le' => $c['cree_le']];
    $p['derniere'] = max($p['derniere'], $c['cree_le']);
    $personnes[$p['email']] = $p;
  }
  usort($personnes, function ($a, $b) { return strcmp($b['derniere'], $a['derniere']); });
  return $personnes;
}

function emails_recus($valeur): array {
  $emails = is_array($valeur) ? $valeur : [];
  return array_values(array_unique(array_filter(array_map(function ($e) {
    return strtolower(trim((string) $e));
  }, $emails), function ($e) {
    return filter_var($e, FILTER_VALIDATE_EMAIL) !== false;
  })));
}

if ($_SERVER['REQUEST_METHOD'] === 'GET') {
  if (!est_admin(user_courant())) repondre(['ok' => false, 'erreur' => 'admin'], 403);
  repondre(['ok' => true, 'personnes' => liste()]);
}

$multipart = strpos($_SERVER['CONTENT_TYPE'] ?? '', 'multipart/form-data') === 0;
if ($multipart) {
  if ($_SERVER['REQUEST_METHOD'] !== 'POST' || ($_SERVER['HTTP_X_CAMI'] ?? '') !== '1') repondre(['ok' => false, 'erreur' => 'requete'], 400);
  $e = $_POST;
  $e['emails'] = json_decode((string) ($e['emails'] ?? ''), true);
} else {
  $e = entree_post();
}
if (!est_admin(user_courant())) repondre(['ok' => false, 'erreur' => 'admin'], 403);
$action = $e['action'] ?? '';

if ($action === 'supprimer') {
  // Adresses administrateur jamais supprimées
  $emails = array_diff(emails_recus($e['emails'] ?? null), ADMINS);
  foreach ($emails as $email) {
    db()->prepare('DELETE FROM users WHERE lower(email) = ?')->execute([$email]);
    db()->prepare('DELETE FROM telechargements WHERE lower(email) = ?')->execute([$email]);
    db()->prepare('DELETE FROM contacts WHERE lower(email) = ?')->execute([$email]);
  }
  repondre(['ok' => true, 'supprimees' => count($emails)]);
}

if ($action === 'envoyer') {
  $emails = emails_recus($e['emails'] ?? null);
  $objet = texte($e['objet'] ?? '', 200);
  $message = trim(str_replace("\r\n", "\n", (string) ($e['message'] ?? '')));
  if (!$emails) repondre(['ok' => false, 'erreur' => 'emails'], 422);
  if ($objet === '' || $message === '') repondre(['ok' => false, 'erreur' => 'message'], 422);
  $piece = null;
  $fichier = $_FILES['piece'] ?? null;
  if ($fichier && $fichier['error'] !== UPLOAD_ERR_NO_FILE) {
    if ($fichier['error'] !== UPLOAD_ERR_OK || $fichier['size'] > PIECE_MAX) repondre(['ok' => false, 'erreur' => 'piece'], 422);
    $type = preg_match('#^[\w.+-]+/[\w.+-]+$#', (string) $fichier['type']) ? $fichier['type'] : 'application/octet-stream';
    $piece = ['nom' => basename((string) $fichier['name']), 'type' => $type, 'contenu' => file_get_contents($fichier['tmp_name'])];
  }
  // Un envoi par adresse : les destinataires ne se voient pas
  $echecs = [];
  foreach ($emails as $email) {
    if (!envoyer_mail($email, $objet, $message . "\n", $piece, NOTIFICATIONS)) $echecs[] = $email;
  }
  repondre(['ok' => true, 'envoyes' => count($emails) - count($echecs), 'echecs' => $echecs]);
}

if ($action === 'ajouter') {
  $email = strtolower(trim((string) ($e['email'] ?? '')));
  if (!filter_var($email, FILTER_VALIDATE_EMAIL) || mb_strlen($email) > 200) repondre(['ok' => false, 'erreur' => 'email'], 422);
  $maintenant = date('Y-m-d H:i:s');

  if (($e['comme'] ?? '') === 'telechargement') {
    $systeme = $e['systeme'] ?? '';
    $version = trim((string) ($e['version'] ?? ''));
    $date = (string) ($e['date'] ?? '');
    $d = DateTime::createFromFormat('!Y-m-d', $date);
    if (!in_array($systeme, SYSTEMES, true)) repondre(['ok' => false, 'erreur' => 'systeme'], 422);
    if (!preg_match('/^\d+(\.\d+){0,3}$/', $version)) repondre(['ok' => false, 'erreur' => 'version'], 422);
    if (!$d || $d->format('Y-m-d') !== $date || $date > date('Y-m-d')) repondre(['ok' => false, 'erreur' => 'date'], 422);
    db()->prepare("INSERT INTO telechargements (email, systeme, fichier, version, le, telecharge_le, source) VALUES (?, ?, '', ?, ?, ?, 'main')")
      ->execute([$email, $systeme, $version, $maintenant, $date]);
    repondre(['ok' => true]);
  }

  if (($e['comme'] ?? '') === 'inscrit') {
    $st = db()->prepare('SELECT 1 FROM users WHERE email = ?');
    $st->execute([$email]);
    if ($st->fetch()) repondre(['ok' => false, 'erreur' => 'existe'], 409);
    if (!in_array($e['genre'] ?? '', ['F', 'H', 'N'], true)) repondre(['ok' => false, 'erreur' => 'genre'], 422);
    $genre = $e['genre'];
    $prefs = (!empty($e['avertir']) ? PREF_AVERTIR : 0) | (!empty($e['auditeur']) ? PREF_AUDITEUR : 0);
    // Sans mot de passe connu ni confirmation : la personne peut ensuite s'inscrire elle-même
    db()->prepare("INSERT INTO users (email, pseudo, mdp, genre, prefs, confirme, cree_le, source) VALUES (?, ?, ?, ?, ?, 0, ?, 'main')")
      ->execute([$email, texte($e['pseudo'] ?? '', 60), password_hash(bin2hex(random_bytes(16)), PASSWORD_DEFAULT), $genre, $prefs, $maintenant]);
    repondre(['ok' => true]);
  }

  if (($e['comme'] ?? '') === 'contact') {
    if (!in_array($e['genre'] ?? '', ['F', 'H', 'N'], true)) repondre(['ok' => false, 'erreur' => 'genre'], 422);
    $st = db()->prepare('SELECT 1 FROM contacts WHERE email = ?');
    $st->execute([$email]);
    if ($st->fetch()) repondre(['ok' => false, 'erreur' => 'existe'], 409);
    db()->prepare('INSERT INTO contacts (email, pseudo, genre, cree_le) VALUES (?, ?, ?, ?)')
      ->execute([$email, texte($e['pseudo'] ?? '', 60), $e['genre'], $maintenant]);
    repondre(['ok' => true]);
  }

  repondre(['ok' => false, 'erreur' => 'comme'], 422);
}

repondre(['ok' => false, 'erreur' => 'action'], 400);
