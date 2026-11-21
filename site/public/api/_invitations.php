<?php
// Invitations de l'administrateur : enregistrement, envoi immédiat ou programmé.
// Envoi programmé : _taches.php, lancé par une tâche planifiée Alwaysdata.
require_once __DIR__ . '/_cami.php';

// Adresses valides, en minuscules, sans doublon
function adresses_valides($valeur): array {
  $adresses = is_array($valeur) ? $valeur : [];
  return array_values(array_unique(array_filter(array_map(function ($e) {
    return strtolower(trim((string) $e));
  }, $adresses), function ($e) {
    return filter_var($e, FILTER_VALIDATE_EMAIL) !== false;
  })));
}

function invitation(int $id): ?array {
  $st = db()->prepare('SELECT * FROM invitations WHERE id = ?');
  $st->execute([$id]);
  $i = $st->fetch();
  return $i ? invitation_publique($i) : null;
}

function invitation_publique(array $i): array {
  $i['id'] = (int) $i['id'];
  $i['adresses'] = json_decode($i['adresses'], true) ?: [];
  $i['echecs'] = $i['echecs'] === null ? [] : (json_decode($i['echecs'], true) ?: []);
  $i['envoyes'] = $i['envoyes'] === null ? null : (int) $i['envoyes'];
  return $i;
}

function invitations(): array {
  return array_map('invitation_publique', db()->query('SELECT * FROM invitations ORDER BY modifiee_le DESC')->fetchAll());
}

// Envoi d'une invitation enregistrée (une seule fois : marquée envoyée avant l'envoi)
function envoyer_invitation(int $id): ?array {
  $maintenant = date('Y-m-d H:i:s');
  $st = db()->prepare('UPDATE invitations SET envoyee_le = ?, programmee_le = NULL WHERE id = ? AND envoyee_le IS NULL');
  $st->execute([$maintenant, $id]);
  if ($st->rowCount() !== 1) return null;
  $i = invitation($id);
  $echecs = [];
  foreach ($i['adresses'] as $email) {
    if (!envoyer_mail($email, $i['objet'], $i['message'] . "\n", null, NOTIFICATIONS)) $echecs[] = $email;
  }
  db()->prepare('UPDATE invitations SET envoyes = ?, echecs = ? WHERE id = ?')
    ->execute([count($i['adresses']) - count($echecs), json_encode($echecs), $id]);
  return invitation($id);
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
