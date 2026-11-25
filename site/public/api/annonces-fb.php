<?php
// Annonce Facebook.
// Mac de l'administrateur (en-tête X-Cami-Cle) :
//   GET : travail à faire {texte, verifier [{id, nom, url}], publier [{id, nom, url}], a_faire} ;
//   POST JSON {groupe, verification: existant | introuvable} ou {groupe, publication: ok | echec, detail?}.
// Administrateur (session) :
//   GET : état {annonce, groupes, echecs} ;
//   POST JSON {action: enregistrer (texte, mode clic | date, programmee_le, repeter, repeter_n, repeter_unite, repeter_fois)
//              | ajouter (nom, url) | cocher (id, coche) | supprimer (id)}.
require __DIR__ . '/_annonces_fb.php';

$cle = (string) ($_SERVER['HTTP_X_CAMI_CLE'] ?? '');
if ($cle !== '') {
  if (!cle_fb_valide($cle)) repondre(['ok' => false, 'erreur' => 'cle'], 403);
  if ($_SERVER['REQUEST_METHOD'] === 'GET') repondre(['ok' => true] + travail_fb());
  $e = json_decode((string) file_get_contents('php://input'), true);
  repondre(['ok' => is_array($e) && resultat_fb($e)]);
}

if (!est_admin(user_courant())) repondre(['ok' => false, 'erreur' => 'admin'], 403);
if ($_SERVER['REQUEST_METHOD'] === 'GET') repondre(['ok' => true] + etat_annonce_fb());

$e = entree_post();
$action = $e['action'] ?? '';
$id = (int) ($e['id'] ?? 0);

switch ($action) {
  case 'enregistrer':
    $r = enregistrer_annonce_fb($e);
    if ($r) repondre(['ok' => false] + $r, 422);
    break;
  case 'ajouter':
    $nom = texte($e['nom'] ?? '', 120);
    $url = url_groupe_fb((string) ($e['url'] ?? ''));
    if ($nom === '') repondre(['ok' => false, 'erreur' => 'nom'], 422);
    if ($url === '') repondre(['ok' => false, 'erreur' => 'url'], 422);
    $st = db()->prepare('SELECT 1 FROM groupes_fb WHERE url = ?');
    $st->execute([$url]);
    if ($st->fetch()) repondre(['ok' => false, 'erreur' => 'existe'], 422);
    db()->prepare('INSERT INTO groupes_fb (nom, url, cree_le) VALUES (?, ?, ?)')->execute([$nom, $url, date('Y-m-d H:i:s')]);
    break;
  case 'cocher':
    db()->prepare('UPDATE groupes_fb SET coche = ? WHERE id = ?')->execute([empty($e['coche']) ? 0 : 1, $id]);
    cloturer_echeance_fb();
    break;
  case 'supprimer':
    db()->prepare('DELETE FROM groupes_fb WHERE id = ?')->execute([$id]);
    cloturer_echeance_fb();
    break;
  default:
    repondre(['ok' => false, 'erreur' => 'action'], 400);
}
repondre(['ok' => true] + etat_annonce_fb());
