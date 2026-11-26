<?php
// Annonces Facebook.
// Mac de l'administrateur (en-tête X-Cami-Cle) :
//   GET : travail à faire {verifier [{id, nom, url}], publier [{annonce, id, nom, url, texte}], a_faire} ;
//   POST JSON {groupe, verification: existant | introuvable} ou {annonce, groupe, publication: ok | echec, detail?}.
// Administrateur (session) :
//   GET : état {annonces, groupes, maintenant} ;
//   POST JSON {action: enregistrer (id 0 = nouvelle, texte, groupes [ids], mode clic | date, programmee_le,
//              repeter, repeter_n, repeter_unite, repeter_fois) | supprimer_annonce (id)
//              | ajouter (nom, url) | supprimer (id : groupe)}.
require __DIR__ . '/_annonces_fb.php';

$cle = (string) ($_SERVER['HTTP_X_CAMI_CLE'] ?? '');
if ($cle !== '') {
  if (!cle_fb_valide($cle)) repondre(['ok' => false, 'erreur' => 'cle'], 403);
  if ($_SERVER['REQUEST_METHOD'] === 'GET') repondre(['ok' => true] + travail_fb());
  $e = json_decode((string) file_get_contents('php://input'), true);
  repondre(['ok' => is_array($e) && resultat_fb($e)]);
}

if (!est_admin(user_courant())) repondre(['ok' => false, 'erreur' => 'admin'], 403);
if ($_SERVER['REQUEST_METHOD'] === 'GET') repondre(['ok' => true] + etat_annonces_fb());

$e = entree_post();
$action = $e['action'] ?? '';
$id = (int) ($e['id'] ?? 0);

switch ($action) {
  case 'enregistrer':
    $r = enregistrer_annonce_fb($e);
    if (isset($r['erreur'])) repondre(['ok' => false] + $r, 422);
    repondre(['ok' => true, 'id' => $r['id']] + etat_annonces_fb());
  case 'supprimer_annonce':
    supprimer_annonce_fb($id);
    break;
  case 'ajouter':
    $nom = texte($e['nom'] ?? '', 120);
    $url = url_groupe_fb((string) ($e['url'] ?? ''));
    if ($nom === '') repondre(['ok' => false, 'erreur' => 'nom'], 422);
    if ($url === '') repondre(['ok' => false, 'erreur' => 'url'], 422);
    annonces_fb_schema();
    $st = db()->prepare('SELECT 1 FROM groupes_fb WHERE url = ?');
    $st->execute([$url]);
    if ($st->fetch()) repondre(['ok' => false, 'erreur' => 'existe'], 422);
    db()->prepare('INSERT INTO groupes_fb (nom, url, cree_le) VALUES (?, ?, ?)')->execute([$nom, $url, date('Y-m-d H:i:s')]);
    break;
  case 'supprimer':
    annonces_fb_schema();
    db()->prepare('DELETE FROM groupes_fb WHERE id = ?')->execute([$id]);
    cloturer_echeances_fb();
    break;
  default:
    repondre(['ok' => false, 'erreur' => 'action'], 400);
}
repondre(['ok' => true] + etat_annonces_fb());
