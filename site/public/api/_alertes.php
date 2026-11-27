<?php
// Alertes des directs (issue #9) : mail 3 jours, 1 jour et 1 heure avant chaque séance,
// à toutes les adresses connues (inscrits, contacts, téléchargements, invités), sauf refus.
// Lancé par _taches.php. Liens de refus : /api/alertes.php (signés par cle_alerte()).
require_once __DIR__ . '/_cami.php';

const PALIERS_ALERTE = ['3j' => 3 * 86400, '1j' => 86400, '1h' => 3600];   // du plus lointain au plus proche
const MOIS_FR = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];
const JOURS_FR = ['dimanche', 'lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi'];

// Clé secrète des liens (créée au premier besoin, hors dossier web)
function secret_site(): string {
  $fichier = dossier_donnees() . '/secret.key';
  if (!is_file($fichier)) {
    file_put_contents($fichier, bin2hex(random_bytes(32)));
    chmod($fichier, 0600);
  }
  return trim((string) file_get_contents($fichier));
}

function cle_alerte(string $email, string $jour): string {
  return substr(hash_hmac('sha256', strtolower($email) . '|' . $jour, secret_site()), 0, 32);
}

function lien_refus(string $email, string $jour): string {
  return SITE . '/api/alertes.php?' . http_build_query(['email' => $email, 'jour' => $jour, 'cle' => cle_alerte($email, $jour)]);
}

// « jeudi 26 novembre 2026 »
function date_fr(string $jour): string {
  $t = strtotime($jour);
  $j = (int) date('j', $t);
  return JOURS_FR[(int) date('w', $t)] . ' ' . ($j === 1 ? '1er' : $j) . ' ' . MOIS_FR[(int) date('n', $t) - 1] . ' ' . date('Y', $t);
}

// « 19:00 » → « 19 h » ; « 19:30 » → « 19 h 30 »
function heure_fr(string $h): string {
  [$hh, $mm] = array_map('intval', explode(':', $h));
  return $hh . ' h' . ($mm ? ' ' . sprintf('%02d', $mm) : '');
}

// Toutes les adresses connues : email => [pseudo, genre] (inscrits, puis contacts, invités, téléchargements)
function destinataires_alertes(string $jour): array {
  $liste = [];
  $ajouter = function (string $email, string $pseudo, string $genre) use (&$liste) {
    $email = strtolower(trim($email));
    if ($email === '' || isset($liste[$email])) return;
    $liste[$email] = ['pseudo' => $pseudo, 'genre' => $genre];
  };
  foreach (db()->query('SELECT email, pseudo, genre FROM users') as $r) $ajouter($r['email'], (string) $r['pseudo'], $r['genre']);
  foreach (db()->query('SELECT email, pseudo, genre FROM contacts') as $r) $ajouter($r['email'], (string) $r['pseudo'], $r['genre']);
  foreach (db()->query('SELECT email, genre FROM invites ORDER BY invite_le DESC') as $r) $ajouter($r['email'], '', $r['genre']);
  foreach (db()->query('SELECT email FROM telechargements') as $r) $ajouter($r['email'], '', 'N');
  $st = db()->prepare("SELECT lower(email) FROM alertes_refus WHERE jour = '' OR jour = ?");
  $st->execute([$jour]);
  foreach ($st->fetchAll(PDO::FETCH_COLUMN) as $refus) unset($liste[$refus]);
  return $liste;
}

// Modèle : alerte-direct (direct YouTube) ou alerte-zoom (séance Zoom), dans src/content/mails/
function mail_alerte(array $seance, string $palier, string $email, array $d): array {
  $jour = $seance['jour'];
  return mail_modele(($seance['diffusion'] ?? '') === 'zoom' ? 'alerte-zoom' : 'alerte-direct', [
    'pseudo' => $d['pseudo'],
    'date' => date_fr($jour),
    'debut' => heure_fr($seance['debut']),
    'fin' => heure_fr($seance['fin']),
    'refus-session' => $palier !== '1h' ? lien_refus($email, $jour) : '',
    'refus-tout' => lien_refus($email, ''),
  ], $d['genre']);
}

// Séances à venir : palier le plus proche arrivé à échéance et pas encore traité (les plus lointains sont sautés)
// Heure courante (CAMI_MAINTENANT « AAAA-MM-JJ HH:MM » : tests seulement)
function maintenant_alertes(): int {
  return getenv('CAMI_MAINTENANT') ? (int) strtotime((string) getenv('CAMI_MAINTENANT')) : time();
}

function envoyer_alertes_directs(): int {
  $maintenant = maintenant_alertes();
  $traite = db()->prepare('INSERT OR IGNORE INTO alertes_envoyees (jour, palier, envoyee_le, envoyes) VALUES (?, ?, ?, ?)');
  $compte = db()->prepare('UPDATE alertes_envoyees SET envoyes = ? WHERE jour = ? AND palier = ?');
  $st = db()->prepare('SELECT * FROM seances WHERE jour >= ? ORDER BY jour');
  $st->execute([date('Y-m-d', $maintenant)]);
  $envoyes = 0;
  foreach ($st->fetchAll() as $seance) {
    $debut = strtotime($seance['jour'] . ' ' . $seance['debut']);
    if ($debut === false || $maintenant >= $debut) continue;
    $dus = array_keys(array_filter(PALIERS_ALERTE, function ($delai) use ($maintenant, $debut) { return $maintenant >= $debut - $delai; }));
    $a_envoyer = null;
    foreach ($dus as $palier) {   // marqué avant l'envoi : jamais envoyé deux fois
      $traite->execute([$seance['jour'], $palier, date('Y-m-d H:i:s'), null]);
      if ($traite->rowCount() === 1) $a_envoyer = $palier;
    }
    if ($a_envoyer === null || $a_envoyer !== end($dus)) continue;
    $n = 0;
    foreach (destinataires_alertes($seance['jour']) as $email => $d) {
      [$objet, $corps] = mail_alerte($seance, $a_envoyer, $email, $d);
      if (envoyer_mail($email, $objet, $corps)) $n++;
    }
    $compte->execute([$n, $seance['jour'], $a_envoyer]);
    $envoyes += $n;
  }
  return $envoyes;
}
