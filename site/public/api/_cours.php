<?php
// Cours (issue #13) : élèves, groupes, cours, disponibilités du professeur, rappels.
// Un groupe = un ou plusieurs élèves + le professeur (l'administrateur). Chaque élève a son groupe solo.
// Mails : par Brevo (brevo_mail), envoi direct en secours.
require_once __DIR__ . '/_cami.php';
require_once __DIR__ . '/_brevo.php';
require_once __DIR__ . '/_alertes.php';   // date_fr, heure_fr, maintenant_alertes

const PAS_COURS = 15;                 // minutes : pas des horaires et des durées
const DUREE_MAX = 240;
const DELAI_ELEVE = 2 * 86400;        // l'élève déplace ou annule jusqu'à 2 jours avant le cours
const RAPPELS_DEFAUT = [1440, 60];    // 1 jour et 1 heure avant

function maintenant_cours(): int { return maintenant_alertes(); }

// --- Élèves et groupes ---

function student_de_user(?array $user): ?array {
  if (!$user) return null;
  $st = db()->prepare('SELECT * FROM students WHERE user_id = ?');
  $st->execute([$user['id']]);
  return $st->fetch() ?: null;
}

function groupe(int $id): ?array {
  $st = db()->prepare('SELECT * FROM groupes WHERE id = ?');
  $st->execute([$id]);
  return $st->fetch() ?: null;
}

// Élèves d'un groupe : [{student_id, user_id, email, pseudo, genre, rappels}]
function eleves_groupe(int $gid): array {
  $st = db()->prepare('SELECT s.id AS student_id, u.id AS user_id, u.email, u.pseudo, u.genre, s.rappels
    FROM groupe_eleves ge JOIN students s ON s.id = ge.student_id JOIN users u ON u.id = s.user_id
    WHERE ge.groupe_id = ? ORDER BY lower(COALESCE(NULLIF(u.pseudo, \'\'), u.email))');
  $st->execute([$gid]);
  return $st->fetchAll();
}

function nom_eleve(array $e): string { return $e['pseudo'] !== '' && $e['pseudo'] !== null ? $e['pseudo'] : $e['email']; }

function nom_groupe(array $g): string {
  if ($g['nom'] !== '') return $g['nom'];
  return implode(', ', array_map('nom_eleve', eleves_groupe((int) $g['id']))) ?: 'Groupe ' . $g['id'];
}

function groupes_du_student(int $sid): array {
  $st = db()->prepare('SELECT groupe_id FROM groupe_eleves WHERE student_id = ?');
  $st->execute([$sid]);
  return array_map('intval', $st->fetchAll(PDO::FETCH_COLUMN));
}

function rappels_student(array $s): array {
  $r = json_decode((string) $s['rappels'], true);
  return is_array($r) ? array_values(array_filter(array_map('intval', $r), function ($m) { return $m > 0; })) : RAPPELS_DEFAUT;
}

// --- Horaires ---

function minutes(string $hhmm): int { [$h, $m] = array_map('intval', explode(':', $hhmm)); return $h * 60 + $m; }
function hhmm(int $min): string { return sprintf('%02d:%02d', intdiv($min, 60), $min % 60); }

// « AAAA-MM-JJ HH:MM » valide, au pas de PAS_COURS
function debut_valide($debut): bool {
  if (!is_string($debut) || !preg_match('/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/', $debut)) return false;
  $d = DateTime::createFromFormat('!Y-m-d H:i', $debut);
  return $d && $d->format('Y-m-d H:i') === $debut && ((int) $d->format('i')) % PAS_COURS === 0;
}

function duree_valide($duree): bool {
  return is_int($duree) && $duree >= PAS_COURS && $duree <= DUREE_MAX && $duree % PAS_COURS === 0;
}

function heure_valide($h): bool {
  return is_string($h) && preg_match('/^([01]\d|2[0-3]):[0-5]\d$/', $h) && minutes($h) % PAS_COURS === 0;
}

function lundi(string $jour): string {
  $t = strtotime($jour . ' 12:00');
  return date('Y-m-d', $t - ((int) date('N', $t) - 1) * 86400);
}

function fin_cours(string $debut, int $duree): string { return date('Y-m-d H:i', strtotime($debut) + $duree * 60); }

// « lundi 30 novembre 2026, de 14 h à 15 h 30 »
function quand_fr(string $debut, int $duree): string {
  return date_fr(substr($debut, 0, 10)) . ', de ' . heure_fr(substr($debut, 11)) . ' à ' . heure_fr(substr(fin_cours($debut, $duree), 11));
}

// --- Disponibilités du professeur ---

function fusionner(array $creneaux): array {
  usort($creneaux, function ($a, $b) { return $a[0] <=> $b[0]; });
  $out = [];
  foreach ($creneaux as [$a, $b]) {
    if ($out && $a <= $out[count($out) - 1][1]) $out[count($out) - 1][1] = max($out[count($out) - 1][1], $b);
    else $out[] = [$a, $b];
  }
  return $out;
}

// Créneaux disponibles d'un jour, en minutes : ceux de sa semaine si elle est réglée, sinon les généraux
function dispos_du_jour(string $jour): array {
  $semaine = lundi($jour);
  $st = db()->prepare('SELECT 1 FROM semaines_reglees WHERE semaine = ?');
  $st->execute([$semaine]);
  $cle = $st->fetchColumn() ? $semaine : '';
  $st = db()->prepare('SELECT debut, fin FROM dispos WHERE semaine = ? AND jour = ?');
  $st->execute([$cle, (int) date('N', strtotime($jour . ' 12:00'))]);
  return fusionner(array_map(function ($r) { return [minutes($r['debut']), minutes($r['fin'])]; }, $st->fetchAll()));
}

function dans_dispos(string $debut, int $duree): bool {
  $s = minutes(substr($debut, 11));
  $e = $s + $duree;
  foreach (dispos_du_jour(substr($debut, 0, 10)) as [$a, $b]) if ($a <= $s && $e <= $b) return true;
  return false;
}

// Aucun autre cours placé ou demandé ne chevauche ce créneau
function creneau_libre(string $debut, int $duree, int $sauf = 0): bool {
  $s = strtotime($debut);
  $e = $s + $duree * 60;
  $st = db()->prepare("SELECT debut, duree FROM cours WHERE statut IN ('place', 'demande') AND id != ? AND debut >= ? AND debut < ?");
  $st->execute([$sauf, date('Y-m-d', $s - 86400), date('Y-m-d', $e + 86400)]);
  foreach ($st->fetchAll() as $c) {
    $cs = strtotime($c['debut']);
    if ($cs < $e && $s < $cs + $c['duree'] * 60) return false;
  }
  return true;
}

// Créneau que l'élève peut prendre : à venir, dans les disponibilités, libre
function creneau_eleve(string $debut, int $duree, int $sauf = 0): ?string {
  if (strtotime($debut) <= maintenant_cours()) return 'passe';
  if (!dans_dispos($debut, $duree)) return 'indisponible';
  if (!creneau_libre($debut, $duree, $sauf)) return 'occupe';
  return null;
}

// --- Cours ---

function cours_par_id(int $id): ?array {
  $st = db()->prepare('SELECT * FROM cours WHERE id = ?');
  $st->execute([$id]);
  return $st->fetch() ?: null;
}

// Rappels dont l'échéance est déjà passée : marqués sautés (jamais envoyés après coup)
function armer_rappels(int $cid): void {
  $c = cours_par_id($cid);
  if (!$c || $c['statut'] !== 'place' || !$c['debut']) return;
  $debut = strtotime($c['debut']);
  $ins = db()->prepare('INSERT OR IGNORE INTO rappels_cours (cours_id, user_id, delai, debut, envoye) VALUES (?, ?, ?, ?, 0)');
  foreach (eleves_groupe((int) $c['groupe_id']) as $e) {
    foreach (rappels_student(['rappels' => $e['rappels']]) as $delai) {
      if (maintenant_cours() >= $debut - $delai * 60) $ins->execute([$cid, $e['user_id'], $delai, $c['debut']]);
    }
  }
}

// --- Mails ---

function signature_cours(): string {
  return "\nPhilippe Perret\nCours d’Analyse Musicale — " . SITE . "\nVos cours : " . SITE . "/cours/student/\n";
}

function bonjour(array $e): string { return 'Bonjour' . ($e['pseudo'] ? ' ' . $e['pseudo'] : '') . ",\n\n"; }

// Mail à chaque élève du groupe ; $texte peut contenir des marques genrées [m|f]
function mail_groupe(int $gid, string $sujet, string $texte): void {
  foreach (eleves_groupe($gid) as $e) {
    brevo_mail($e['email'], $sujet, g(bonjour($e) . $texte . "\n" . signature_cours(), $e['genre']), NOTIFICATIONS);
  }
}

function mail_prof(string $sujet, string $texte, string $repondre_a = ''): void {
  brevo_mail(NOTIFICATIONS, $sujet, $texte . "\n\n" . SITE . "/cours/student/\n", $repondre_a);
}

function lieu_fr(string $lieu): string { return $lieu !== '' ? "\nLieu : $lieu\n" : ''; }

// --- Rappels (tâche périodique, _taches.php) ---

function mail_rappel(array $c, array $e): array {
  $texte = 'Petit rappel : votre cours d’analyse aura lieu le ' . quand_fr($c['debut'], (int) $c['duree']) . ".\n" . lieu_fr($c['lieu']);
  if ($c['oeuvres'] !== '') $texte .= "\nŒuvre(s) : {$c['oeuvres']}\n";
  $texte .= "\nVous pouvez modifier les délais de ces rappels dans votre profil, sur la page de vos cours.\n";
  return ['CAMI • Rappel : cours du ' . date_fr(substr($c['debut'], 0, 10)), g(bonjour($e) . $texte . signature_cours(), $e['genre'])];
}

function envoyer_rappels_cours(): int {
  $maintenant = maintenant_cours();
  $st = db()->prepare("SELECT * FROM cours WHERE statut = 'place' AND debut > ? AND debut <= ?");
  $st->execute([date('Y-m-d H:i', $maintenant), date('Y-m-d H:i', $maintenant + 30 * 86400)]);
  $traite = db()->prepare('INSERT OR IGNORE INTO rappels_cours (cours_id, user_id, delai, debut, envoye) VALUES (?, ?, ?, ?, ?)');
  $envoyes = 0;
  foreach ($st->fetchAll() as $c) {
    $debut = strtotime($c['debut']);
    foreach (eleves_groupe((int) $c['groupe_id']) as $e) {
      $dus = array_filter(rappels_student(['rappels' => $e['rappels']]), function ($d) use ($maintenant, $debut) { return $maintenant >= $debut - $d * 60; });
      if (!$dus) continue;
      sort($dus);   // le plus proche d'abord : lui seul est envoyé, les plus lointains sont sautés
      $a_envoyer = null;
      foreach ($dus as $i => $delai) {
        $traite->execute([$c['id'], $e['user_id'], $delai, $c['debut'], $i === 0 ? 1 : 0]);
        if ($i === 0 && $traite->rowCount() === 1) $a_envoyer = $delai;
      }
      if ($a_envoyer === null) continue;
      [$sujet, $corps] = mail_rappel($c, $e);
      if (brevo_mail($e['email'], $sujet, $corps, NOTIFICATIONS)) $envoyes++;
    }
  }
  return $envoyes;
}

// --- Demandes de cours (formulaire /cours/demande/) ---

const FREQUENCES = [
  'semaine'  => 'Un par semaine',
  'quinzaine' => 'Un tous les 15 jours',
  'mois'     => 'Un par mois',
  'ponctuel' => 'Au coup par coup',
];
const CONNAISSANCES = [
  'generales'   => 'Connaissances théoriques générales',
  'gammes'      => 'Connaissances des gammes, accords et chiffrages',
  'harmonie'    => 'Connaissances en harmonie',
  'contrepoint' => 'Connaissances en contrepoint',
  'analyse'     => 'Connaissances en analyse musicale',
];
const NIVEAUX = ['excellentes' => 'Excellentes', 'bonnes' => 'Bonnes', 'moyennes' => 'Moyennes', 'aucune' => 'Aucune'];
const JOURS_FR = [1 => 'lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi', 'dimanche'];
const DEMANDE_HEURE_MIN = '08:00';
const DEMANDE_HEURE_MAX = '20:00';

function demande_publique(array $d): array {
  return [
    'id' => (int) $d['id'], 'nom' => $d['nom'], 'email' => $d['email'], 'frequence' => FREQUENCES[$d['frequence']] ?? $d['frequence'],
    'creneaux' => json_decode($d['creneaux'], true), 'niveaux' => json_decode($d['niveaux'], true),
    'confirmee_le' => $d['confirmee_le'], 'cree_le' => $d['cree_le'],
  ];
}

// Texte de la demande (mail à l'administrateur)
function demande_texte(array $d): string {
  $creneaux = json_decode($d['creneaux'], true);
  $lignes = [];
  foreach ($creneaux as $c) $lignes[] = '  - le ' . JOURS_FR[$c['jour']] . ' entre ' . heure_fr($c['debut']) . ' et ' . heure_fr($c['fin']);
  $niveaux = json_decode($d['niveaux'], true);
  $conn = [];
  foreach (CONNAISSANCES as $cle => $libelle) $conn[] = "  - $libelle : " . (NIVEAUX[$niveaux[$cle] ?? ''] ?? '—');
  return "Nom : {$d['nom']}\nAdresse : {$d['email']}\n\nCOURS (1 heure)\nFréquence : " . (FREQUENCES[$d['frequence']] ?? $d['frequence'])
    . "\nCréneaux :\n" . implode("\n", $lignes) . "\n\nCONNAISSANCES\n" . implode("\n", $conn) . "\n";
}
