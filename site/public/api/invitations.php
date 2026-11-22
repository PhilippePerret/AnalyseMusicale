<?php
// Invitations (administrateur).
// GET : liste.
// POST JSON {action: enregistrer | envoyer | supprimer, id?, nouvelle?, objet, message, adresses [{email, genre H|F}], programmee_le?}
//   enregistrer : création, ou modification de l'invitation id (envoyée ou non ; nouvelle = true : création) ;
//   adresses = adresses à inviter au prochain envoi (les personnes déjà invitées sont dans « invites ») ;
//   programmee_le « AAAA-MM-JJ HH:MM » (futur) ou vide ;
//   envoyer : enregistrement puis envoi immédiat aux adresses.
require __DIR__ . '/_invitations.php';

if (!est_admin(user_courant())) repondre(['ok' => false, 'erreur' => 'admin'], 403);
if ($_SERVER['REQUEST_METHOD'] === 'GET') repondre(['ok' => true, 'invitations' => invitations()]);

$e = entree_post();
$action = $e['action'] ?? '';
$id = (int) ($e['id'] ?? 0);

if ($action === 'supprimer') {
  db()->prepare('DELETE FROM invitations WHERE id = ?')->execute([$id]);
  repondre(['ok' => true]);
}

if ($action === 'enregistrer' || $action === 'envoyer') {
  $objet = texte($e['objet'] ?? '', 200);
  $message = trim(str_replace("\r\n", "\n", (string) ($e['message'] ?? '')));
  $adresses = destinataires_valides($e['adresses'] ?? null);
  if ($objet === '' || $message === '') repondre(['ok' => false, 'erreur' => 'message'], 422);
  $programmee = null;
  if ($action === 'enregistrer' && trim((string) ($e['programmee_le'] ?? '')) !== '') {
    $programmee = trim((string) $e['programmee_le']);
    $d = DateTime::createFromFormat('!Y-m-d H:i', $programmee);
    if (!$d || $d->format('Y-m-d H:i') !== $programmee) repondre(['ok' => false, 'erreur' => 'programmation'], 422);
    if ($programmee <= date('Y-m-d H:i')) repondre(['ok' => false, 'erreur' => 'passe'], 422);
  }
  // Adresses requises pour un envoi (immédiat ou programmé)
  if ($adresses === null || (!$adresses && ($action === 'envoyer' || $programmee !== null))) repondre(['ok' => false, 'erreur' => 'adresses'], 422);
  $maintenant = date('Y-m-d H:i:s');
  $existante = $id && empty($e['nouvelle']) ? invitation($id) : null;
  if ($existante) {
    db()->prepare('UPDATE invitations SET objet = ?, message = ?, adresses = ?, programmee_le = ?, modifiee_le = ? WHERE id = ?')
      ->execute([$objet, $message, json_encode($adresses), $programmee, $maintenant, $id]);
  } else {
    db()->prepare('INSERT INTO invitations (objet, message, adresses, programmee_le, cree_le, modifiee_le) VALUES (?, ?, ?, ?, ?, ?)')
      ->execute([$objet, $message, json_encode($adresses), $programmee, $maintenant, $maintenant]);
    $id = (int) db()->lastInsertId();
  }
  $invitation = ($action === 'envoyer' ? envoyer_invitation($id) : null) ?? invitation($id);
  repondre(['ok' => true, 'invitation' => $invitation]);
}

repondre(['ok' => false, 'erreur' => 'action'], 400);
