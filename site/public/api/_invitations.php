<?php
// Invitations de l'administrateur : enregistrement, envoi immédiat ou programmé.
// Envoi programmé : _taches.php, lancé par une tâche planifiée Alwaysdata.
require_once __DIR__ . '/_cami.php';

// Destinataires valides [{email, genre (H|F)}], adresses en minuscules, sans doublon ; null si l'un est invalide
function destinataires_valides($valeur): ?array {
  if (!is_array($valeur) || !$valeur) return null;
  $liste = [];
  foreach ($valeur as $d) {
    $email = strtolower(trim((string) ($d['email'] ?? '')));
    $genre = strtoupper(trim((string) ($d['genre'] ?? '')));
    if (!filter_var($email, FILTER_VALIDATE_EMAIL) || mb_strlen($email) > 200 || !in_array($genre, ['H', 'F'], true)) return null;
    $liste[$email] = ['email' => $email, 'genre' => $genre];
  }
  return array_values($liste);
}

// Dossier de sauvegarde des invitations envoyées (hors dossier web)
function dossier_sauvegarde_invitations(): string {
  $dossier = dossier_donnees() . '/sauvegardes/invitations';
  if (!is_dir($dossier)) mkdir($dossier, 0750, true);
  return $dossier;
}

function invitation(int $id): ?array {
  $st = db()->prepare('SELECT * FROM invitations WHERE id = ?');
  $st->execute([$id]);
  $i = $st->fetch();
  return $i ? invitation_publique($i) : null;
}

function invitation_publique(array $i): array {
  $i['id'] = (int) $i['id'];
  // Anciennes invitations : adresses seules, genre à préciser
  $i['adresses'] = array_map(function ($d) {
    return is_array($d) ? $d : ['email' => (string) $d, 'genre' => ''];
  }, json_decode($i['adresses'], true) ?: []);
  $i['echecs'] = $i['echecs'] === null ? [] : (json_decode($i['echecs'], true) ?: []);
  $i['envoyes'] = $i['envoyes'] === null ? null : (int) $i['envoyes'];
  return $i;
}

function invitations(): array {
  return array_map('invitation_publique', db()->query('SELECT * FROM invitations ORDER BY modifiee_le DESC')->fetchAll());
}

// Envoi d'une invitation enregistrée (une seule fois : marquée envoyée avant l'envoi).
// Texte genré [masculin|féminin] selon chaque destinataire ; invités consignés dans la table invites ;
// invitation sauvegardée dans dossier_sauvegarde_invitations() : <id>-<AAAA-MM-JJ-HHMMSS>.json
function envoyer_invitation(int $id): ?array {
  $maintenant = date('Y-m-d H:i:s');
  $st = db()->prepare('UPDATE invitations SET envoyee_le = ?, programmee_le = NULL WHERE id = ? AND envoyee_le IS NULL');
  $st->execute([$maintenant, $id]);
  if ($st->rowCount() !== 1) return null;
  $i = invitation($id);
  $echecs = [];
  $invite = db()->prepare('INSERT OR IGNORE INTO invites (email, genre, invitation_id, invite_le) VALUES (?, ?, ?, ?)');
  foreach ($i['adresses'] as $d) {
    if (envoyer_mail($d['email'], g($i['objet'], $d['genre']), g($i['message'], $d['genre']) . "\n", null, NOTIFICATIONS)) {
      $invite->execute([$d['email'], $d['genre'], $id, $maintenant]);
    } else {
      $echecs[] = $d['email'];
    }
  }
  db()->prepare('UPDATE invitations SET envoyes = ?, echecs = ? WHERE id = ?')
    ->execute([count($i['adresses']) - count($echecs), json_encode($echecs), $id]);
  $i = invitation($id);
  file_put_contents(
    dossier_sauvegarde_invitations() . '/' . $id . '-' . date('Y-m-d-His', strtotime($maintenant)) . '.json',
    json_encode($i, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES)
  );
  return $i;
}

// Invitations programmées arrivées à échéance
function envoyer_invitations_dues(): int {
  $st = db()->prepare('SELECT id FROM invitations WHERE envoyee_le IS NULL AND programmee_le IS NOT NULL AND programmee_le <= ?');
  $st->execute([date('Y-m-d H:i')]);
  $n = 0;
  foreach ($st->fetchAll(PDO::FETCH_COLUMN) as $id) {
    if (envoyer_invitation((int) $id)) $n++;
  }
  return $n;
}
