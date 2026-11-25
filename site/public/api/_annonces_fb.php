<?php
// Annonce Facebook (page /admin/annonces/) : une annonce unique, des groupes, des échéances.
// La publication se fait sur le Mac de l'administrateur (scripts/informer-groupes-fb.command,
// Claude in Chrome), qui lit et renseigne l'annonce par api/annonces-fb.php (clé annonces-fb.key).
// Échéance arrivée (programmation ou répétition) : _taches.php envoie un mail d'avis.
require_once __DIR__ . '/_cami.php';

const ANNONCE_FB_AVIS = 'philippe.perret@analyse-musicale.fr';   // reçoit l'avis d'échéance
const ANNONCE_FB_UNITES = ['jours' => 'day', 'semaines' => 'week', 'mois' => 'month'];

function annonces_fb_schema(): void {
  static $fait = false;
  if ($fait) return;
  $fait = true;
  db()->exec(<<<SQL
CREATE TABLE IF NOT EXISTS annonce_fb (   -- une seule ligne (id = 1)
  id INTEGER PRIMARY KEY CHECK (id = 1),
  texte TEXT NOT NULL DEFAULT '',
  mode TEXT NOT NULL DEFAULT 'clic',          -- clic : au prochain clic ; date : programmé
  programmee_le TEXT,                         -- date choisie (mode date), « AAAA-MM-JJ HH:MM »
  repeter INTEGER NOT NULL DEFAULT 0,
  repeter_n INTEGER NOT NULL DEFAULT 1,
  repeter_unite TEXT NOT NULL DEFAULT 'semaines',
  repeter_fois INTEGER NOT NULL DEFAULT 2,
  echeance TEXT,                              -- échéance en cours (NULL : plus rien à envoyer)
  numero INTEGER NOT NULL DEFAULT 0,          -- numéro de l'envoi de l'échéance en cours (1…)
  avis_le TEXT,                               -- échéance pour laquelle le mail d'avis est parti
  dernier_envoi_le TEXT,
  dernier_envoi_groupes INTEGER NOT NULL DEFAULT 0,
  modifiee_le TEXT
);
CREATE TABLE IF NOT EXISTS groupes_fb (
  id INTEGER PRIMARY KEY,
  nom TEXT NOT NULL,
  url TEXT NOT NULL UNIQUE,
  etat TEXT NOT NULL DEFAULT 'a_verifier',    -- a_verifier | existant | introuvable
  coche INTEGER NOT NULL DEFAULT 1,
  verifie_le TEXT,
  cree_le TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS publications_fb (   -- résultat d'une publication : groupe et échéance
  groupe_id INTEGER NOT NULL REFERENCES groupes_fb(id) ON DELETE CASCADE,
  echeance TEXT NOT NULL,
  statut TEXT NOT NULL,                       -- ok | echec
  detail TEXT NOT NULL DEFAULT '',
  le TEXT NOT NULL,
  PRIMARY KEY (groupe_id, echeance)
);
INSERT OR IGNORE INTO annonce_fb (id) VALUES (1);
SQL);
}

function annonce_fb_maintenant(): string {
  return getenv('CAMI_MAINTENANT') ?: date('Y-m-d H:i');
}

function annonce_fb(): array {
  annonces_fb_schema();
  return db()->query('SELECT * FROM annonce_fb WHERE id = 1')->fetch();
}

function groupes_fb(): array {
  annonces_fb_schema();
  return db()->query('SELECT * FROM groupes_fb ORDER BY nom COLLATE NOCASE')->fetchAll();
}

// « https://facebook.com/groups/xyz?ref=… » → « https://www.facebook.com/groups/xyz/ » ; invalide : ''
function url_groupe_fb(string $url): string {
  if (!preg_match('~^(?:https?://)?(?:www\.|m\.|web\.)?facebook\.com/groups/([A-Za-z0-9._-]+)/?(?:[?#].*)?$~', trim($url), $m)) return '';
  return 'https://www.facebook.com/groups/' . $m[1] . '/';
}

// Groupes visés par l'échéance en cours (cochés, existants ou à vérifier) et leur publication
function cibles_fb(array $a): array {
  if (!$a['echeance']) return [];
  $st = db()->prepare("SELECT g.*, p.statut, p.detail FROM groupes_fb g
    LEFT JOIN publications_fb p ON p.groupe_id = g.id AND p.echeance = ?
    WHERE g.coche = 1 AND g.etat != 'introuvable' ORDER BY g.nom COLLATE NOCASE");
  $st->execute([$a['echeance']]);
  return $st->fetchAll();
}

// Échéance arrivée ?
function echeance_due(array $a): bool {
  return $a['echeance'] !== null && $a['echeance'] <= annonce_fb_maintenant();
}

// État complet pour la page d'administration
function etat_annonce_fb(): array {
  $a = annonce_fb();
  $cibles = cibles_fb($a);
  return [
    'annonce' => $a,
    'groupes' => groupes_fb(),
    'echecs' => array_values(array_map(fn($g) => ['nom' => $g['nom'], 'detail' => $g['detail']],
      array_filter($cibles, fn($g) => $g['statut'] === 'echec'))),
  ];
}

// Enregistrement : réglages d'envoi modifiés → nouveau cycle d'envois
function enregistrer_annonce_fb(array $e): array {
  $a = annonce_fb();
  $texte = trim(str_replace("\r\n", "\n", (string) ($e['texte'] ?? '')));
  if ($texte === '' || mb_strlen($texte) > 10000) return ['erreur' => 'texte'];
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
  if (!$repeter) { $n = (int) $a['repeter_n']; $unite = $a['repeter_unite']; $fois = (int) $a['repeter_fois']; }

  $maintenant = annonce_fb_maintenant();
  $memes = $mode === $a['mode'] && $programmee === $a['programmee_le'] && $repeter === (int) $a['repeter']
    && (!$repeter || ($n === (int) $a['repeter_n'] && $unite === $a['repeter_unite'] && $fois === (int) $a['repeter_fois']));
  $cycle = [$a['echeance'], (int) $a['numero'], $a['avis_le']];
  if (!$memes || ($mode === 'clic' && $a['echeance'] === null)) {
    if ($mode === 'date' && $programmee <= $maintenant) return ['erreur' => 'passe'];
    $echeance = $mode === 'date' ? $programmee : $maintenant;
    // Au prochain clic : l'administrateur est déjà au courant, pas de mail d'avis
    $cycle = [$echeance, 1, $mode === 'clic' ? $echeance : null];
  }
  db()->prepare('UPDATE annonce_fb SET texte = ?, mode = ?, programmee_le = ?, repeter = ?, repeter_n = ?, repeter_unite = ?,
    repeter_fois = ?, echeance = ?, numero = ?, avis_le = ?, modifiee_le = ? WHERE id = 1')
    ->execute([$texte, $mode, $programmee, $repeter, $n, $unite, $fois, $cycle[0], $cycle[1], $cycle[2], date('Y-m-d H:i:s')]);
  return [];
}

// Toutes les publications de l'échéance réussies → échéance suivante (répétition) ou fin
function cloturer_echeance_fb(): void {
  $a = annonce_fb();
  if (!echeance_due($a)) return;
  $cibles = cibles_fb($a);
  if (!$cibles || array_filter($cibles, fn($g) => $g['statut'] !== 'ok')) return;
  $suivante = null;
  if ($a['repeter'] && $a['numero'] < $a['repeter_fois']) {
    $d = new DateTime($a['echeance']);
    $d->modify('+' . $a['repeter_n'] . ' ' . ANNONCE_FB_UNITES[$a['repeter_unite']]);
    $suivante = $d->format('Y-m-d H:i');
  }
  db()->prepare('UPDATE annonce_fb SET echeance = ?, numero = ?, dernier_envoi_le = ?, dernier_envoi_groupes = ? WHERE id = 1')
    ->execute([$suivante, $suivante ? $a['numero'] + 1 : $a['numero'], date('Y-m-d H:i:s'), count($cibles)]);
}

// Travail du Mac : groupes à vérifier, publications à faire (échéance arrivée seulement)
function travail_fb(): array {
  $a = annonce_fb();
  $verifier = array_values(array_map(fn($g) => ['id' => (int) $g['id'], 'nom' => $g['nom'], 'url' => $g['url']],
    array_filter(groupes_fb(), fn($g) => $g['etat'] === 'a_verifier')));
  $publier = echeance_due($a) ? array_values(array_map(fn($g) => ['id' => (int) $g['id'], 'nom' => $g['nom'], 'url' => $g['url']],
    array_filter(cibles_fb($a), fn($g) => $g['statut'] !== 'ok'))) : [];
  return ['texte' => $a['texte'], 'verifier' => $verifier, 'publier' => $publier, 'a_faire' => count($verifier) + count($publier)];
}

// Résultat renvoyé par le Mac
function resultat_fb(array $e): bool {
  $id = (int) ($e['groupe'] ?? 0);
  $st = db()->prepare('SELECT * FROM groupes_fb WHERE id = ?');
  $st->execute([$id]);
  if (!$st->fetch()) return false;
  $maintenant = date('Y-m-d H:i:s');
  $verification = $e['verification'] ?? '';
  if ($verification === 'existant' || $verification === 'introuvable') {
    db()->prepare('UPDATE groupes_fb SET etat = ?, verifie_le = ? WHERE id = ?')->execute([$verification, $maintenant, $id]);
    if ($verification === 'introuvable') cloturer_echeance_fb();
    return true;
  }
  $publication = $e['publication'] ?? '';
  $a = annonce_fb();
  if (!in_array($publication, ['ok', 'echec'], true) || !echeance_due($a)) return false;
  db()->prepare('INSERT OR REPLACE INTO publications_fb (groupe_id, echeance, statut, detail, le) VALUES (?, ?, ?, ?, ?)')
    ->execute([$id, $a['echeance'], $publication, texte($e['detail'] ?? '', 300), $maintenant]);
  cloturer_echeance_fb();
  return true;
}

// Tâche périodique : mail d'avis quand une échéance arrive
function aviser_annonce_fb(): int {
  $a = annonce_fb();
  if (!echeance_due($a) || $a['avis_le'] === $a['echeance']) return 0;
  envoyer_mail(ANNONCE_FB_AVIS, 'CAMI • Annonce Facebook à envoyer',
    "Vous devez envoyer le message aux groupes Facebook. Bouton \"Informer les groupes FB\" sur SuperBoard\n");
  db()->prepare('UPDATE annonce_fb SET avis_le = ? WHERE id = 1')->execute([$a['echeance']]);
  return 1;
}

// Clé du Mac : <dossier des données>/annonces-fb.key
function cle_fb_valide(string $cle): bool {
  $fichier = dossier_donnees() . '/annonces-fb.key';
  $attendue = is_file($fichier) ? trim((string) file_get_contents($fichier)) : '';
  return strlen($attendue) >= 32 && hash_equals($attendue, $cle);
}
