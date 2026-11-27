<?php
// Invitations de l'administrateur : enregistrement, envoi immédiat ou programmé.
// Envoi programmé : _taches.php, lancé par une tâche planifiée Alwaysdata.
require_once __DIR__ . '/_cami.php';

// Destinataires valides [{email, genre (H|F)}], adresses en minuscules, sans doublon,
// adresses administrateur retirées (l'administrateur reçoit toujours une copie à part) ;
// null si l'un est invalide
function destinataires_valides($valeur): ?array {
  if (!is_array($valeur)) return null;
  $liste = [];
  foreach ($valeur as $d) {
    $email = strtolower(trim((string) ($d['email'] ?? '')));
    $genre = strtoupper(trim((string) ($d['genre'] ?? '')));
    if (!filter_var($email, FILTER_VALIDATE_EMAIL) || mb_strlen($email) > 200 || !in_array($genre, ['H', 'F'], true)) return null;
    if (in_array($email, ADMINS, true)) continue;
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
  // Personnes déjà invitées par cette invitation (tous envois confondus)
  $st = db()->prepare('SELECT email, genre, invite_le FROM invites WHERE invitation_id = ? ORDER BY invite_le DESC, email');
  $st->execute([$i['id']]);
  $i['invites'] = $st->fetchAll();
  return $i;
}

function invitations(): array {
  return array_map('invitation_publique', db()->query('SELECT * FROM invitations ORDER BY modifiee_le DESC')->fetchAll());
}

// Envoi d'une invitation enregistrée à ses adresses en attente (colonne adresses), vidées par l'envoi.
// Une invitation peut être envoyée plusieurs fois (nouvelles adresses à chaque fois).
// Prise en charge atomique : un envoi n'est jamais fait deux fois (clic + tâche planifiée).
// Texte genré [masculin|féminin] selon chaque destinataire ; invités consignés dans la table invites ;
// copie systématique à l'administrateur (NOTIFICATIONS) ;
// envoi sauvegardé dans dossier_sauvegarde_invitations() : <id>-<AAAA-MM-JJ-HHMMSS>.json
function envoyer_invitation(int $id): ?array {
  $st = db()->prepare('SELECT adresses FROM invitations WHERE id = ?');
  $st->execute([$id]);
  $brut = $st->fetchColumn();
  if ($brut === false) return null;
  $i = invitation($id);
  $adresses = array_values(array_filter($i['adresses'], function ($d) {
    return in_array($d['genre'], ['H', 'F'], true) && !in_array(strtolower($d['email']), ADMINS, true);
  }));
  if (!$adresses) return null;
  $maintenant = date('Y-m-d H:i:s');
  $st = db()->prepare("UPDATE invitations SET adresses = '[]', programmee_le = NULL, envoyee_le = ? WHERE id = ? AND adresses = ?");
  $st->execute([$maintenant, $id, $brut]);
  if ($st->rowCount() !== 1) return null;
  $echecs = [];
  $invite = db()->prepare('INSERT INTO invites (email, genre, invitation_id, invite_le) VALUES (?, ?, ?, ?)
    ON CONFLICT (email, invitation_id) DO UPDATE SET genre = excluded.genre, invite_le = excluded.invite_le');
  foreach ($adresses as $d) {
    if (envoyer_mail($d['email'], g($i['objet'], $d['genre']), g($i['message'], $d['genre']) . "\n", null, NOTIFICATIONS)) {
      $invite->execute([$d['email'], $d['genre'], $id, $maintenant]);
    } else {
      $echecs[] = $d['email'];
    }
  }
  $envoyes = count($adresses) - count($echecs);
  db()->prepare('UPDATE invitations SET envoyes = ?, echecs = ? WHERE id = ?')
    ->execute([$envoyes, json_encode($echecs), $id]);
  // Copie à l'administrateur
  $liste = implode("\n", array_map(function ($d) use ($echecs) {
    return '  ' . $d['email'] . ' (' . $d['genre'] . ')' . (in_array($d['email'], $echecs, true) ? ' — ÉCHEC' : '');
  }, $adresses));
  [$objet, $corps] = mail_modele('prof-copie-invitation', [
    'objet' => g($i['objet'], 'H'), 'date' => date('d/m/Y à H:i', strtotime($maintenant)),
    'nombre' => $envoyes . ' personne' . ($envoyes > 1 ? 's' : ''), 'liste' => $liste, 'message' => g($i['message'], 'H'),
  ], null);
  envoyer_mail(NOTIFICATIONS, $objet, $corps);
  $i = invitation($id);
  file_put_contents(
    dossier_sauvegarde_invitations() . '/' . $id . '-' . date('Y-m-d-His', strtotime($maintenant)) . '.json',
    json_encode($i + ['envoi' => $adresses], JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES)
  );
  return $i;
}

// Invitations programmées arrivées à échéance
function envoyer_invitations_dues(): int {
  $st = db()->prepare('SELECT id FROM invitations WHERE programmee_le IS NOT NULL AND programmee_le <= ?');
  $st->execute([date('Y-m-d H:i')]);
  $n = 0;
  foreach ($st->fetchAll(PDO::FETCH_COLUMN) as $id) {
    if (envoyer_invitation((int) $id)) $n++;
  }
  return $n;
}
