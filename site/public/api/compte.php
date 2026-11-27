<?php
// POST {action: connexion | inscription | deconnexion}
require __DIR__ . '/_cami.php';

$e = entree_post();
$action = $e['action'] ?? '';

if ($action === 'deconnexion') {
  demarrer_session();
  $_SESSION = [];
  session_destroy();
  repondre(['ok' => true]);
}

$email = strtolower(trim((string) ($e['email'] ?? '')));
$mdp = (string) ($e['mdp'] ?? '');
$jour = jour_valide($e['jour'] ?? null) ? $e['jour'] : null;   // jeudi « Je serai présent »

if (!filter_var($email, FILTER_VALIDATE_EMAIL) || mb_strlen($email) > 200) repondre(['ok' => false, 'erreur' => 'email'], 422);

$st = db()->prepare('SELECT * FROM users WHERE email = ?');
$st->execute([$email]);
$existant = $st->fetch() ?: null;

if ($action === 'connexion') {
  if (!$existant || !password_verify($mdp, $existant['mdp'])) repondre(['ok' => false, 'erreur' => 'identifiants'], 401);
  if (!$existant['confirme']) repondre(['ok' => false, 'erreur' => 'non_confirme'], 403);
  connecter($existant);
  db()->prepare('UPDATE users SET vu_le = ? WHERE id = ?')->execute([date('Y-m-d H:i:s'), $existant['id']]);
  purger_anciens();
  if ($jour) ajouter_presence((int) $existant['id'], $jour);
  repondre(['ok' => true]);
}

if ($action === 'inscription') {
  if (trim((string) ($e['site_web'] ?? '')) !== '') repondre(['ok' => true, 'attente' => true]);   // piège à robots
  if (mb_strlen($mdp) < 8) repondre(['ok' => false, 'erreur' => 'mdp'], 422);
  if (empty($e['cgu'])) repondre(['ok' => false, 'erreur' => 'cgu'], 422);
  if ($existant && $existant['confirme']) repondre(['ok' => false, 'erreur' => 'existe'], 409);

  if (!in_array($e['genre'] ?? '', ['F', 'H', 'N'], true)) repondre(['ok' => false, 'erreur' => 'genre'], 422);
  $genre = $e['genre'];
  $prefs = (!empty($e['avertir']) ? PREF_AVERTIR : 0) | (!empty($e['auditeur']) ? PREF_AUDITEUR : 0);
  $pseudo = texte($e['pseudo'] ?? '', 60);
  $jeton = bin2hex(random_bytes(16));
  $champs = [$pseudo, password_hash($mdp, PASSWORD_DEFAULT), $genre, $prefs, $jeton, $jour, date('Y-m-d H:i:s')];

  if ($existant) {   // inscription non confirmée : mise à jour et nouvel envoi
    db()->prepare('UPDATE users SET pseudo = ?, mdp = ?, genre = ?, prefs = ?, jeton = ?, presence_attente = ?, cgu_le = ? WHERE id = ?')
      ->execute(array_merge($champs, [$existant['id']]));
  } else {
    db()->prepare('INSERT INTO users (pseudo, mdp, genre, prefs, jeton, presence_attente, cgu_le, email, cree_le) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
      ->execute(array_merge($champs, [$email, date('Y-m-d H:i:s')]));
  }

  $lien = SITE . '/api/confirmer.php?jeton=' . $jeton;
  [$objet, $corps] = mail_modele('inscription-confirmation', ['pseudo' => $pseudo, 'lien' => $lien], $genre);
  envoyer_mail($email, $objet, $corps);
  repondre(['ok' => true, 'attente' => true]);
}

repondre(['ok' => false, 'erreur' => 'action'], 400);
