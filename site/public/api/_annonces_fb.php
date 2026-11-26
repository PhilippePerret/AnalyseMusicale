<?php
// Annonces Facebook (page /admin/annonces/) : plusieurs annonces, chacune avec ses groupes et ses échéances (issue #26).
// La publication se fait sur le Mac de l'administrateur (scripts/informer-groupes-fb.command,
// Claude in Chrome), qui lit et renseigne les annonces par api/annonces-fb.php (clé annonces-fb.key).
// Échéance arrivée (programmation ou répétition) : _taches.php envoie un mail d'avis.
// Annonce terminée (dernier envoi fait) ou supprimée : retirée de la liste, conservée dans annonces-fb-archive.jsonl.
require_once __DIR__ . '/_cami.php';

const ANNONCE_FB_AVIS = 'philippe.perret@analyse-musicale.fr';   // reçoit les avis
const ANNONCE_FB_UNITES = ['jours' => 'day', 'semaines' => 'week', 'mois' => 'month'];
const ANNONCE_FB_PAGE = 'https://www.analyse-musicale.fr/admin/annonces/';

function annonces_fb_schema(): void {
  static $fait = false;
  if ($fait) return;
  $fait = true;
  db()->exec(<<<SQL
CREATE TABLE IF NOT EXISTS annonces_fb (
  id INTEGER PRIMARY KEY,
  texte TEXT NOT NULL DEFAULT '',
  mode TEXT NOT NULL DEFAULT 'clic',          -- clic : au prochain clic ; date : programmé
  programmee_le TEXT,                         -- date choisie (mode date), « AAAA-MM-JJ HH:MM »
  repeter INTEGER NOT NULL DEFAULT 0,
  repeter_n INTEGER NOT NULL DEFAULT 1,
  repeter_unite TEXT NOT NULL DEFAULT 'semaines',
  repeter_fois INTEGER NOT NULL DEFAULT 2,
  echeance TEXT,                              -- échéance en cours (NULL : non programmée)
  numero INTEGER NOT NULL DEFAULT 0,          -- numéro de l'envoi de l'échéance en cours (1…)
  avis_le TEXT,                               -- échéance pour laquelle le mail d'avis est parti
  avis_fin_le TEXT,                           -- échéance pour laquelle le mail de fin de répétition est parti
  dernier_envoi_le TEXT,
  dernier_envoi_groupes INTEGER NOT NULL DEFAULT 0,
  cree_le TEXT NOT NULL,
  modifiee_le TEXT
);
CREATE TABLE IF NOT EXISTS groupes_fb (
  id INTEGER PRIMARY KEY,
  nom TEXT NOT NULL,
  url TEXT NOT NULL UNIQUE,
  etat TEXT NOT NULL DEFAULT 'a_verifier',    -- a_verifier | existant | introuvable
  coche INTEGER NOT NULL DEFAULT 1,           -- inutilisé depuis l'issue #26 (groupes propres à chaque annonce)
  verifie_le TEXT,
  cree_le TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS annonces_fb_groupes (   -- groupes visés par une annonce
  annonce_id INTEGER NOT NULL REFERENCES annonces_fb(id) ON DELETE CASCADE,
  groupe_id INTEGER NOT NULL REFERENCES groupes_fb(id) ON DELETE CASCADE,
  PRIMARY KEY (annonce_id, groupe_id)
);
CREATE TABLE IF NOT EXISTS publications_annonces_fb (   -- résultat d'une publication : annonce, groupe, échéance
  annonce_id INTEGER NOT NULL REFERENCES annonces_fb(id) ON DELETE CASCADE,
  groupe_id INTEGER NOT NULL REFERENCES groupes_fb(id) ON DELETE CASCADE,
  echeance TEXT NOT NULL,
  statut TEXT NOT NULL,                       -- ok | echec
  detail TEXT NOT NULL DEFAULT '',
  le TEXT NOT NULL,
  PRIMARY KEY (annonce_id, groupe_id, echeance)
);
SQL);
  migrer_annonce_fb_unique();
}

// Ancienne annonce unique (table annonce_fb) → première annonce de la liste, associée à TOUS les groupes
function migrer_annonce_fb_unique(): void {
  $existe = db()->query("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'annonce_fb'")->fetch();
  if (!$existe) return;
  $a = db()->query('SELECT * FROM annonce_fb WHERE id = 1')->fetch();
  db()->beginTransaction();
  if ($a && trim((string) $a['texte']) !== '') {
    $champs = ['texte', 'mode', 'programmee_le', 'repeter', 'repeter_n', 'repeter_unite', 'repeter_fois', 'echeance', 'numero',
      'avis_le', 'dernier_envoi_le', 'dernier_envoi_groupes', 'modifiee_le'];
    $valeurs = array_map(fn($c) => $a[$c] ?? null, $champs);
    db()->prepare('INSERT INTO annonces_fb (' . implode(', ', $champs) . ', avis_fin_le, cree_le) VALUES ('
      . implode(', ', array_fill(0, count($champs), '?')) . ', ?, ?)')
      ->execute([...$valeurs, $a['avis_fin_le'] ?? null, $a['modifiee_le'] ?: date('Y-m-d H:i:s')]);
    $id = (int) db()->lastInsertId();
    db()->prepare('INSERT INTO annonces_fb_groupes (annonce_id, groupe_id) SELECT ?, id FROM groupes_fb')->execute([$id]);
  }
  db()->exec('ALTER TABLE annonce_fb RENAME TO annonce_fb_ancienne');
  db()->commit();
}

function annonce_fb_maintenant(): string {
  return getenv('CAMI_MAINTENANT') ?: date('Y-m-d H:i');
}

function annonce_fb(int $id): ?array {
  annonces_fb_schema();
  $st = db()->prepare('SELECT * FROM annonces_fb WHERE id = ?');
  $st->execute([$id]);
  return $st->fetch() ?: null;
}

// Annonces : prochaine échéance d'abord, non programmées à la fin
function annonces_fb(): array {
  annonces_fb_schema();
  return db()->query('SELECT * FROM annonces_fb ORDER BY echeance IS NULL, echeance, id')->fetchAll();
}

function groupes_fb(): array {
  annonces_fb_schema();
  return db()->query('SELECT * FROM groupes_fb ORDER BY nom COLLATE NOCASE')->fetchAll();
}

// Groupes d'une annonce (tous états)
function groupes_annonce_fb(int $id): array {
  $st = db()->prepare('SELECT g.* FROM groupes_fb g JOIN annonces_fb_groupes l ON l.groupe_id = g.id
    WHERE l.annonce_id = ? ORDER BY g.nom COLLATE NOCASE');
  $st->execute([$id]);
  return $st->fetchAll();
}

// « https://facebook.com/groups/xyz?ref=… » → « https://www.facebook.com/groups/xyz/ » ; invalide : ''
function url_groupe_fb(string $url): string {
  if (!preg_match('~^(?:https?://)?(?:www\.|m\.|web\.)?facebook\.com/groups/([A-Za-z0-9._-]+)/?(?:[?#].*)?$~', trim($url), $m)) return '';
  return 'https://www.facebook.com/groups/' . $m[1] . '/';
}

// « {group} » → nom du groupe (issue #25)
function texte_pour_groupe_fb(string $texte, string $nom): string {
  return str_replace('{group}', $nom, $texte);
}

// Groupes visés par l'échéance en cours d'une annonce (sauf introuvables) et leur publication
function cibles_fb(array $a): array {
  if (!$a['echeance']) return [];
  $st = db()->prepare("SELECT g.*, p.statut, p.detail FROM groupes_fb g
    JOIN annonces_fb_groupes l ON l.groupe_id = g.id AND l.annonce_id = ?
    LEFT JOIN publications_annonces_fb p ON p.annonce_id = l.annonce_id AND p.groupe_id = g.id AND p.echeance = ?
    WHERE g.etat != 'introuvable' ORDER BY g.nom COLLATE NOCASE");
  $st->execute([$a['id'], $a['echeance']]);
  return $st->fetchAll();
}

function echeance_due(array $a): bool {
  return $a['echeance'] !== null && $a['echeance'] <= annonce_fb_maintenant();
}

// Début du texte d'une annonce, pour la désigner (mails)
function extrait_annonce_fb(array $a): string {
  $t = preg_replace('/\s+/u', ' ', trim($a['texte']));
  return mb_strlen($t) > 70 ? mb_substr($t, 0, 70) . '…' : $t;
}

// État complet pour la page d'administration
function etat_annonces_fb(): array {
  $annonces = [];
  foreach (annonces_fb() as $a) {
    $groupes = groupes_annonce_fb((int) $a['id']);
    $exemple = $groupes ? texte_pour_groupe_fb($a['texte'], $groupes[0]['nom']) : $a['texte'];
    $echecs = array_values(array_map(fn($g) => ['nom' => $g['nom'], 'detail' => $g['detail']],
      array_filter(cibles_fb($a), fn($g) => $g['statut'] === 'echec')));
    $annonces[] = $a + [
      'groupes' => array_map(fn($g) => (int) $g['id'], $groupes),
      'noms_groupes' => array_map(fn($g) => $g['nom'], $groupes),
      'exemple' => $exemple,
      'exemple_groupe' => $groupes[0]['nom'] ?? '',
      'echecs' => $echecs,
    ];
  }
  return ['annonces' => $annonces, 'groupes' => groupes_fb(), 'maintenant' => annonce_fb_maintenant()];
}

// Enregistrement (id 0 : nouvelle annonce) : réglages d'envoi modifiés (ou annonce non programmée) → nouveau cycle d'envois
function enregistrer_annonce_fb(array $e): array {
  annonces_fb_schema();
  $id = (int) ($e['id'] ?? 0);
  $a = $id ? annonce_fb($id) : null;
  if ($id && !$a) return ['erreur' => 'introuvable'];
  $texte = trim(str_replace("\r\n", "\n", (string) ($e['texte'] ?? '')));
  if ($texte === '' || mb_strlen($texte) > 10000) return ['erreur' => 'texte'];
  $ids = array_values(array_unique(array_map('intval', (array) ($e['groupes'] ?? []))));
  $existants = array_map(fn($g) => (int) $g['id'], groupes_fb());
  $ids = array_values(array_intersect($ids, $existants));
  if (!$ids) return ['erreur' => 'groupes'];
  $mode = ($e['mode'] ?? '') === 'date' ? 'date' : 'clic';
  $programmee = null;
  if ($mode === 'date') {
    $programmee = trim((string) ($e['programmee_le'] ?? ''));
    $d = DateTime::createFromFormat('!Y-m-d H:i', $programmee);
    if (!$d || $d->format('Y-m-d H:i') !== $programmee) return ['erreur' => 'programmation'];
  }
  $repeter = !empty($e['repeter']) ? 1 : 0;
  $n = (int) ($e['repeter_n'] ?? 1);
  $unite = (string) ($e['repeter_unite'] ?? 'semaines');
  $fois = (int) ($e['repeter_fois'] ?? 2);
  if ($repeter && ($n < 1 || $n > 365 || !isset(ANNONCE_FB_UNITES[$unite]) || $fois < 2 || $fois > 100)) return ['erreur' => 'repetition'];
  if (!$repeter) { $n = $a ? (int) $a['repeter_n'] : 1; $unite = $a ? $a['repeter_unite'] : 'semaines'; $fois = $a ? (int) $a['repeter_fois'] : 2; }

  $maintenant = annonce_fb_maintenant();
  $memes = $a && $mode === $a['mode'] && $programmee === $a['programmee_le'] && $repeter === (int) $a['repeter']
    && (!$repeter || ($n === (int) $a['repeter_n'] && $unite === $a['repeter_unite'] && $fois === (int) $a['repeter_fois']));
  $cycle = $a ? [$a['echeance'], (int) $a['numero'], $a['avis_le']] : [null, 0, null];
  if (!$memes || $cycle[0] === null) {
    if ($mode === 'date' && $programmee <= $maintenant) return ['erreur' => 'passe'];
    $echeance = $mode === 'date' ? $programmee : $maintenant;
    // Au prochain clic : l'administrateur est déjà au courant, pas de mail d'avis
    $cycle = [$echeance, 1, $mode === 'clic' ? $echeance : null];
  }
  $quand = date('Y-m-d H:i:s');
  db()->beginTransaction();
  if (!$a) {
    db()->prepare('INSERT INTO annonces_fb (cree_le) VALUES (?)')->execute([$quand]);
    $id = (int) db()->lastInsertId();
  }
  db()->prepare('UPDATE annonces_fb SET texte = ?, mode = ?, programmee_le = ?, repeter = ?, repeter_n = ?, repeter_unite = ?,
    repeter_fois = ?, echeance = ?, numero = ?, avis_le = ?, modifiee_le = ? WHERE id = ?')
    ->execute([$texte, $mode, $programmee, $repeter, $n, $unite, $fois, $cycle[0], $cycle[1], $cycle[2], $quand, $id]);
  db()->prepare('DELETE FROM annonces_fb_groupes WHERE annonce_id = ?')->execute([$id]);
  $lier = db()->prepare('INSERT INTO annonces_fb_groupes (annonce_id, groupe_id) VALUES (?, ?)');
  foreach ($ids as $g) $lier->execute([$id, $g]);
  db()->commit();
  cloturer_echeance_fb($id);   // groupes retirés : l'échéance peut être complète
  return ['id' => $id];
}

// Annonce retirée de la liste (terminée ou supprimée) : conservée dans l'archive
function archiver_annonce_fb(array $a, string $raison): void {
  $ligne = $a + ['groupes' => array_map(fn($g) => $g['nom'], groupes_annonce_fb((int) $a['id'])), 'archivee_le' => date('Y-m-d H:i:s'), 'raison' => $raison];
  file_put_contents(dossier_donnees() . '/annonces-fb-archive.jsonl', json_encode($ligne, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES) . "\n", FILE_APPEND | LOCK_EX);
  db()->prepare('DELETE FROM annonces_fb WHERE id = ?')->execute([$a['id']]);
}

function supprimer_annonce_fb(int $id): void {
  $a = annonce_fb($id);
  if ($a) archiver_annonce_fb($a, 'supprimée');
}

// Toutes les publications de l'échéance réussies → échéance suivante (répétition) ou fin (archive)
function cloturer_echeance_fb(int $id): void {
  $a = annonce_fb($id);
  if (!$a || !echeance_due($a)) return;
  $cibles = cibles_fb($a);
  if (!$cibles || array_filter($cibles, fn($g) => $g['statut'] !== 'ok')) return;
  $quand = date('Y-m-d H:i:s');
  if ($a['repeter'] && $a['numero'] < $a['repeter_fois']) {
    $d = new DateTime($a['echeance']);
    $d->modify('+' . $a['repeter_n'] . ' ' . ANNONCE_FB_UNITES[$a['repeter_unite']]);
    db()->prepare('UPDATE annonces_fb SET echeance = ?, numero = ?, dernier_envoi_le = ?, dernier_envoi_groupes = ? WHERE id = ?')
      ->execute([$d->format('Y-m-d H:i'), $a['numero'] + 1, $quand, count($cibles), $id]);
    return;
  }
  archiver_annonce_fb(['dernier_envoi_le' => $quand, 'dernier_envoi_groupes' => count($cibles)] + $a, 'terminée');
}

function cloturer_echeances_fb(): void {
  foreach (annonces_fb() as $a) cloturer_echeance_fb((int) $a['id']);
}

// Travail du Mac : groupes à vérifier, publications à faire (annonces échues, un texte par groupe)
function travail_fb(): array {
  annonces_fb_schema();
  $verifier = array_values(array_map(fn($g) => ['id' => (int) $g['id'], 'nom' => $g['nom'], 'url' => $g['url']],
    array_filter(groupes_fb(), fn($g) => $g['etat'] === 'a_verifier')));
  $publier = [];
  foreach (annonces_fb() as $a) {
    if (!echeance_due($a)) continue;
    foreach (cibles_fb($a) as $g) {
      if ($g['statut'] === 'ok') continue;
      $publier[] = ['annonce' => (int) $a['id'], 'id' => (int) $g['id'], 'nom' => $g['nom'], 'url' => $g['url'],
        'texte' => texte_pour_groupe_fb($a['texte'], $g['nom'])];
    }
  }
  return ['verifier' => $verifier, 'publier' => $publier, 'a_faire' => count($verifier) + count($publier)];
}

// Résultat renvoyé par le Mac
function resultat_fb(array $e): bool {
  annonces_fb_schema();
  $id = (int) ($e['groupe'] ?? 0);
  $st = db()->prepare('SELECT * FROM groupes_fb WHERE id = ?');
  $st->execute([$id]);
  if (!$st->fetch()) return false;
  $maintenant = date('Y-m-d H:i:s');
  $verification = $e['verification'] ?? '';
  if ($verification === 'existant' || $verification === 'introuvable') {
    db()->prepare('UPDATE groupes_fb SET etat = ?, verifie_le = ? WHERE id = ?')->execute([$verification, $maintenant, $id]);
    if ($verification === 'introuvable') cloturer_echeances_fb();
    return true;
  }
  $publication = $e['publication'] ?? '';
  $a = annonce_fb((int) ($e['annonce'] ?? 0));
  if (!$a || !in_array($publication, ['ok', 'echec'], true) || !echeance_due($a)) return false;
  db()->prepare('INSERT OR REPLACE INTO publications_annonces_fb (annonce_id, groupe_id, echeance, statut, detail, le) VALUES (?, ?, ?, ?, ?, ?)')
    ->execute([$a['id'], $id, $a['echeance'], $publication, texte($e['detail'] ?? '', 300), $maintenant]);
  cloturer_echeance_fb((int) $a['id']);
  return true;
}

// Tâche périodique : un mail d'avis quand des échéances arrivent
function aviser_annonce_fb(): int {
  $dues = array_filter(annonces_fb(), fn($a) => echeance_due($a) && $a['avis_le'] !== $a['echeance']);
  if (!$dues) return 0;
  $liste = implode('', array_map(fn($a) => '- « ' . extrait_annonce_fb($a) . " »\n", $dues));
  envoyer_mail(ANNONCE_FB_AVIS, 'CAMI • Annonce Facebook à envoyer',
    "Vous devez envoyer le message aux groupes Facebook. Bouton \"Informer les groupes FB\" sur SuperBoard\n\n$liste\n"
    . 'Annonces : ' . ANNONCE_FB_PAGE . "\n");
  $st = db()->prepare('UPDATE annonces_fb SET avis_le = ? WHERE id = ?');
  foreach ($dues as $a) $st->execute([$a['echeance'], $a['id']]);
  return count($dues);
}

// Tâche périodique : mail à l'avant-dernier et au dernier envoi d'une répétition (pour la prolonger)
function aviser_fin_annonce_fb(): int {
  $n = 0;
  foreach (annonces_fb() as $a) {
    $numero = (int) $a['numero'];
    $fois = (int) $a['repeter_fois'];
    if (!$a['repeter'] || !echeance_due($a) || $numero < $fois - 1 || $a['avis_fin_le'] === $a['echeance']) continue;
    $nom = '« ' . extrait_annonce_fb($a) . ' »';
    if ($numero < $fois) {
      $d = new DateTime($a['echeance']);
      $d->modify('+' . $a['repeter_n'] . ' ' . ANNONCE_FB_UNITES[$a['repeter_unite']]);
      $sujet = 'CAMI • Annonce Facebook : avant-dernier envoi';
      $corps = "Avant-dernier envoi de l'annonce Facebook (envoi $numero sur $fois) :\n$nom\n"
        . 'Dernier envoi prévu le ' . $d->format('d/m/Y à H:i') . ".\n\nPour prolonger la répétition : " . ANNONCE_FB_PAGE . "\n";
    } else {
      $sujet = 'CAMI • Annonce Facebook : dernier envoi';
      $corps = "Dernier envoi de l'annonce Facebook (envoi $numero sur $fois) : il termine la répétition.\n$nom\n\n"
        . 'Pour prolonger la répétition : ' . ANNONCE_FB_PAGE . "\n";
    }
    envoyer_mail(ANNONCE_FB_AVIS, $sujet, $corps);
    db()->prepare('UPDATE annonces_fb SET avis_fin_le = ? WHERE id = ?')->execute([$a['echeance'], $a['id']]);
    $n++;
  }
  return $n;
}

// Clé du Mac : <dossier des données>/annonces-fb.key
function cle_fb_valide(string $cle): bool {
  $fichier = dossier_donnees() . '/annonces-fb.key';
  $attendue = is_file($fichier) ? trim((string) file_get_contents($fichier)) : '';
  return strlen($attendue) >= 32 && hash_equals($attendue, $cle);
}
