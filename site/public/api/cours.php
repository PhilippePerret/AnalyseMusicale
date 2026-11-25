<?php
// Cours (issue #13) — pages /cours/student/ et /cours/admin/.
// GET : état visible par l'élève connecté (ses groupes et leurs cours, créneaux occupés, disponibilités)
//       ou par l'administrateur (tout).
// POST JSON {action, …} : actions de l'élève (placer, demander, deplacer, annuler, rappels, definir_mdp)
//       et de l'administrateur (eleve_ajouter, eleve_modifier, eleves_actif, eleve_retirer, groupe_enregistrer, groupe_supprimer,
//       cours_enregistrer, cours_supprimer, demande_repondre, demande_cours_supprimer, dispos_enregistrer, lieu_enregistrer, lieu_supprimer).
require __DIR__ . '/_cours.php';

$user = user_courant();
$admin = est_admin($user);
$student = student_de_user($user);
if ($student && !$student['actif'] && !$admin) $student = null;   // élève inactif : aucun accès (issue #20)

function erreur(string $code, int $http = 422): void { repondre(['ok' => false, 'erreur' => $code], $http); }

function groupe_public(array $g, bool $admin): array {
  return [
    'id' => (int) $g['id'],
    'nom' => nom_groupe($g),
    'solo' => (bool) $g['solo'],
    'lieu' => $g['lieu'],
    'eleves' => array_map(function ($e) use ($admin) {
      $r = ['id' => (int) $e['student_id'], 'nom' => nom_eleve($e)];
      if ($admin) $r['email'] = $e['email'];
      return $r;
    }, eleves_groupe((int) $g['id'])),
  ];
}

function cours_public(array $c): array {
  return [
    'id' => (int) $c['id'], 'groupe' => (int) $c['groupe_id'], 'debut' => $c['debut'], 'duree' => (int) $c['duree'],
    'statut' => $c['statut'], 'lieu' => $c['lieu'], 'oeuvres' => $c['oeuvres'], 'travail' => $c['travail'],
    'raison' => $c['raison'], 'serie' => $c['serie'],
  ];
}

// --- GET ---

if ($_SERVER['REQUEST_METHOD'] === 'GET') {
  if (!$admin && !$student) repondre(['ok' => true, 'acces' => false, 'connecte' => $user !== null]);
  // Groupes sans élève (compte d'un élève supprimé) : supprimés avec leurs cours
  if ($admin) db()->exec('DELETE FROM groupes WHERE id NOT IN (SELECT groupe_id FROM groupe_eleves)');
  $ids = $admin
    ? array_map('intval', db()->query('SELECT id FROM groupes')->fetchAll(PDO::FETCH_COLUMN))
    : groupes_du_student((int) $student['id']);
  $groupes = [];
  foreach ($ids as $gid) $groupes[] = groupe_public(groupe($gid), $admin);
  usort($groupes, function ($a, $b) { return strcasecmp($a['nom'], $b['nom']); });

  $cours = [];
  $occupes = [];
  foreach (db()->query('SELECT * FROM cours ORDER BY debut') as $c) {
    if (in_array((int) $c['groupe_id'], $ids, true)) $cours[] = cours_public($c);
    elseif (in_array($c['statut'], ['place', 'demande'], true)) $occupes[] = ['debut' => $c['debut'], 'duree' => (int) $c['duree']];
  }

  $dispos = ['generales' => [], 'semaines' => (object) []];
  $semaines = [];
  foreach (db()->query('SELECT semaine FROM semaines_reglees') as $r) $semaines[$r['semaine']] = [];
  foreach (db()->query('SELECT semaine, jour, debut, fin FROM dispos ORDER BY jour, debut') as $d) {
    $creneau = ['jour' => (int) $d['jour'], 'debut' => $d['debut'], 'fin' => $d['fin']];
    if ($d['semaine'] === '') $dispos['generales'][] = $creneau;
    elseif (isset($semaines[$d['semaine']])) $semaines[$d['semaine']][] = $creneau;
  }
  $dispos['semaines'] = (object) $semaines;

  $reponse = [
    'ok' => true, 'acces' => true, 'admin' => $admin,
    'maintenant' => date('Y-m-d H:i', maintenant_cours()),
    'user' => user_public($user),
    'groupes' => $groupes, 'cours' => $cours, 'occupes' => $occupes, 'dispos' => $dispos,
    'pas' => PAS_COURS, 'delai_eleve' => DELAI_ELEVE / 3600,
  ];
  if ($student) $reponse['rappels'] = rappels_student($student);
  if ($admin) {
    $reponse['lieux'] = db()->query('SELECT id, nom, valeur FROM lieux ORDER BY lower(nom)')->fetchAll();
    $reponse['eleves'] = array_map(function ($e) {
      return ['id' => (int) $e['id'], 'email' => $e['email'], 'pseudo' => (string) $e['pseudo'], 'genre' => $e['genre'], 'actif' => (bool) $e['actif'], 'cree_le' => $e['cree_le']];
    }, db()->query("SELECT s.id, u.email, u.pseudo, u.genre, s.actif, s.cree_le FROM students s JOIN users u ON u.id = s.user_id
      ORDER BY lower(COALESCE(NULLIF(u.pseudo, ''), u.email))")->fetchAll());
    $reponse['demandes'] = array_map('demande_publique', db()->query('SELECT * FROM demandes_cours ORDER BY cree_le DESC')->fetchAll());
    $reponse['connaissances'] = CONNAISSANCES;
    $reponse['niveaux'] = NIVEAUX;
  }
  repondre($reponse);
}

// --- POST ---

$e = entree_post();
$action = $e['action'] ?? '';

// Mot de passe défini depuis le lien du mail d'inscription comme élève (sans être connecté)
if ($action === 'definir_mdp') {
  $jeton = (string) ($e['jeton'] ?? '');
  $mdp = (string) ($e['mdp'] ?? '');
  if (!preg_match('/^[0-9a-f]{32}$/', $jeton)) erreur('jeton');
  if (mb_strlen($mdp) < 8) erreur('mdp');
  $st = db()->prepare('SELECT * FROM users WHERE jeton = ?');
  $st->execute([$jeton]);
  $u = $st->fetch();
  if (!$u) erreur('jeton');
  db()->prepare('UPDATE users SET mdp = ?, jeton = NULL, confirme = 1, vu_le = ? WHERE id = ?')
    ->execute([password_hash($mdp, PASSWORD_DEFAULT), date('Y-m-d H:i:s'), $u['id']]);
  connecter($u);
  repondre(['ok' => true]);
}

if (!$admin && !$student) erreur('acces', 403);

function entier($v): int { return is_numeric($v) ? (int) $v : 0; }

// Cours d'un groupe de l'élève connecté
function cours_de_l_eleve(array $student, $id): array {
  $c = cours_par_id(entier($id));
  if (!$c || !in_array((int) $c['groupe_id'], groupes_du_student((int) $student['id']), true)) erreur('cours', 404);
  return $c;
}

function nom_connecte(array $user): string { return $user['pseudo'] ?: $user['email']; }

// --- Actions de l'élève (l'administrateur passe par cours_enregistrer) ---

if (!$admin) {
  if ($action === 'rappels') {
    $delais = array_values(array_unique(array_filter(array_map('intval', (array) ($e['delais'] ?? [])), function ($m) { return $m > 0 && $m <= 30 * 1440; })));
    rsort($delais);
    db()->prepare('UPDATE students SET rappels = ? WHERE id = ?')->execute([json_encode(array_slice($delais, 0, 6)), $student['id']]);
    repondre(['ok' => true]);
  }

  if ($action === 'placer' || $action === 'deplacer') {
    $c = cours_de_l_eleve($student, $e['id'] ?? 0);
    $debut = $e['debut'] ?? null;
    if (!debut_valide($debut)) erreur('debut');
    if ($action === 'placer' && $c['statut'] !== 'a_placer') erreur('statut');
    if ($action === 'deplacer') {
      if ($c['statut'] !== 'place') erreur('statut');
      if (strtotime($c['debut']) - maintenant_cours() < DELAI_ELEVE) erreur('delai');
    }
    if ($pb = creneau_eleve($debut, (int) $c['duree'], (int) $c['id'])) erreur($pb);
    db()->prepare("UPDATE cours SET debut = ?, statut = 'place' WHERE id = ?")->execute([$debut, $c['id']]);
    armer_rappels((int) $c['id']);
    $nom = nom_connecte($user);
    mail_prof($action === 'placer' ? "CAMI • Cours placé par $nom" : "CAMI • Cours déplacé par $nom",
      ($action === 'placer' ? "$nom a placé son cours le " : "$nom a déplacé son cours du " . quand_fr($c['debut'], (int) $c['duree']) . ' au ')
      . quand_fr($debut, (int) $c['duree']) . '.', $user['email']);
    repondre(['ok' => true]);
  }

  if ($action === 'demander') {
    $gid = entier($e['groupe'] ?? 0);
    if (!in_array($gid, groupes_du_student((int) $student['id']), true)) erreur('groupe');
    $debut = $e['debut'] ?? null;
    $duree = $e['duree'] ?? null;
    if (!debut_valide($debut)) erreur('debut');
    if (!duree_valide($duree)) erreur('duree');
    if ($pb = creneau_eleve($debut, $duree)) erreur($pb);
    db()->prepare("INSERT INTO cours (groupe_id, debut, duree, statut, lieu, cree_le) VALUES (?, ?, ?, 'demande', ?, ?)")
      ->execute([$gid, $debut, $duree, groupe($gid)['lieu'], date('Y-m-d H:i:s')]);
    $nom = nom_connecte($user);
    mail_prof("CAMI • Demande de cours de $nom", "$nom demande un cours le " . quand_fr($debut, $duree) . ".\n\nPour l’accepter ou la refuser :", $user['email']);
    repondre(['ok' => true]);
  }

  if ($action === 'annuler') {
    $c = cours_de_l_eleve($student, $e['id'] ?? 0);
    if (!in_array($c['statut'], ['place', 'demande', 'refuse'], true)) erreur('statut');
    if ($c['statut'] === 'place' && strtotime($c['debut']) - maintenant_cours() < DELAI_ELEVE) erreur('delai');
    db()->prepare('DELETE FROM cours WHERE id = ?')->execute([$c['id']]);
    if ($c['statut'] !== 'refuse') {
      $nom = nom_connecte($user);
      mail_prof($c['statut'] === 'place' ? "CAMI • Cours annulé par $nom" : "CAMI • Demande de cours retirée par $nom",
        "$nom a annulé " . ($c['statut'] === 'place' ? 'son cours' : 'sa demande de cours') . ' du ' . quand_fr($c['debut'], (int) $c['duree']) . '.', $user['email']);
    }
    repondre(['ok' => true]);
  }

  erreur('action', 400);
}

// --- Actions de l'administrateur ---

if ($action === 'eleve_ajouter') {
  $email = strtolower(trim((string) ($e['email'] ?? '')));
  if (!filter_var($email, FILTER_VALIDATE_EMAIL) || mb_strlen($email) > 200) erreur('email');
  $genre = in_array($e['genre'] ?? '', ['F', 'H', 'N'], true) ? $e['genre'] : 'N';
  $pseudo = texte($e['pseudo'] ?? '', 60);
  $st = db()->prepare('SELECT * FROM users WHERE email = ?');
  $st->execute([$email]);
  $u = $st->fetch();
  $jeton = null;
  if (!$u) {
    $jeton = bin2hex(random_bytes(16));
    db()->prepare("INSERT INTO users (email, pseudo, mdp, genre, confirme, jeton, cree_le, source) VALUES (?, ?, ?, ?, 1, ?, ?, 'main')")
      ->execute([$email, $pseudo, password_hash(bin2hex(random_bytes(16)), PASSWORD_DEFAULT), $genre, $jeton, date('Y-m-d H:i:s')]);
    $st->execute([$email]);
    $u = $st->fetch();
  } else {
    if (!$u['confirme']) {   // inscription jamais confirmée : l'élève choisit son mot de passe
      $jeton = bin2hex(random_bytes(16));
      db()->prepare('UPDATE users SET confirme = 1, jeton = ? WHERE id = ?')->execute([$jeton, $u['id']]);
    }
    if ($pseudo !== '' && !$u['pseudo']) db()->prepare('UPDATE users SET pseudo = ? WHERE id = ?')->execute([$pseudo, $u['id']]);
    $u = array_merge($u, ['pseudo' => $u['pseudo'] ?: $pseudo]);
  }
  if (student_de_user($u)) erreur('existe', 409);
  $actif = !array_key_exists('actif', $e) || !empty($e['actif']);   // menu actif/inactif du formulaire
  db()->prepare('INSERT INTO students (user_id, rappels, actif, cree_le) VALUES (?, ?, ?, ?)')->execute([$u['id'], json_encode(RAPPELS_DEFAUT), $actif ? 1 : 0, date('Y-m-d H:i:s')]);
  $sid = (int) db()->lastInsertId();
  db()->prepare('INSERT INTO groupes (nom, solo, cree_le) VALUES (\'\', 1, ?)')->execute([date('Y-m-d H:i:s')]);
  db()->prepare('INSERT INTO groupe_eleves (groupe_id, student_id) VALUES (?, ?)')->execute([(int) db()->lastInsertId(), $sid]);

  $texte = bonjour($u) . "Vous êtes désormais inscrit[|e] comme élève des cours d’analyse musicale de Philippe Perret.\n\n"
    . "Votre calendrier de cours se trouve à l’adresse :\n" . SITE . "/cours/student/\n\n"
    . "Vous y trouverez vos cours, vous pourrez y placer les cours qui vous sont accordés et demander un cours sur un créneau libre.\n\n";
  $texte .= $jeton
    ? "Pour accéder à votre calendrier, choisissez d’abord votre mot de passe en cliquant sur ce lien :\n" . SITE . "/cours/student/?jeton=$jeton\n\n"
      . "Votre identifiant est votre adresse e-mail : $email\n"
    : "Identifiez-vous avec votre adresse e-mail ($email) et votre mot de passe habituel du site.\n";
  // Case « Envoyer le mail de bienvenue » (cochée par défaut, issue #19)
  if ($actif && (!array_key_exists('bienvenue', $e) || !empty($e['bienvenue']))) {   // élève inactif : aucun mail
    brevo_mail($email, 'CAMI • Bienvenue dans les cours d’analyse', g($texte . signature_cours(), $u['genre']), NOTIFICATIONS);
  }
  repondre(['ok' => true, 'id' => $sid]);
}

if ($action === 'eleve_modifier') {   // adresse, pseudo, genre de l'élève (issue #20)
  $sid = entier($e['id'] ?? 0);
  $st = db()->prepare('SELECT user_id FROM students WHERE id = ?');
  $st->execute([$sid]);
  $uid = (int) $st->fetchColumn();
  if (!$uid) erreur('eleve', 404);
  $email = strtolower(trim((string) ($e['email'] ?? '')));
  if (!filter_var($email, FILTER_VALIDATE_EMAIL) || mb_strlen($email) > 200) erreur('email');
  $st = db()->prepare('SELECT id FROM users WHERE email = ? AND id <> ?');
  $st->execute([$email, $uid]);
  if ($st->fetch()) erreur('email_pris', 409);
  $genre = in_array($e['genre'] ?? '', ['F', 'H', 'N'], true) ? $e['genre'] : 'N';
  db()->prepare('UPDATE users SET email = ?, pseudo = ?, genre = ? WHERE id = ?')->execute([$email, texte($e['pseudo'] ?? '', 60), $genre, $uid]);
  if (array_key_exists('actif', $e)) db()->prepare('UPDATE students SET actif = ? WHERE id = ?')->execute([empty($e['actif']) ? 0 : 1, $sid]);
  repondre(['ok' => true]);
}

if ($action === 'eleves_actif') {   // élèves rendus actifs ou inactifs (issue #20)
  $ids = array_values(array_filter(array_map('intval', (array) ($e['ids'] ?? []))));
  if (!$ids) erreur('eleves');
  $st = db()->prepare('UPDATE students SET actif = ? WHERE id = ?');
  foreach ($ids as $sid) $st->execute([empty($e['actif']) ? 0 : 1, $sid]);
  repondre(['ok' => true]);
}

if ($action === 'eleve_retirer') {
  $sid = entier($e['id'] ?? 0);
  // Groupes solo de l'élève (et leurs cours) supprimés ; groupes vidés supprimés
  $solos = db()->prepare('SELECT g.id FROM groupes g JOIN groupe_eleves ge ON ge.groupe_id = g.id WHERE g.solo = 1 AND ge.student_id = ?');
  $solos->execute([$sid]);
  foreach ($solos->fetchAll(PDO::FETCH_COLUMN) as $gid) db()->prepare('DELETE FROM groupes WHERE id = ?')->execute([$gid]);
  db()->prepare('DELETE FROM students WHERE id = ?')->execute([$sid]);
  db()->exec('DELETE FROM groupes WHERE id NOT IN (SELECT groupe_id FROM groupe_eleves)');
  repondre(['ok' => true]);
}

if ($action === 'groupe_enregistrer') {
  $id = entier($e['id'] ?? 0);
  $lieu = texte($e['lieu'] ?? '', 300);
  $g = $id ? groupe($id) : null;
  if ($id && !$g) erreur('groupe', 404);
  if ($g && $g['solo']) {   // groupe solo : seul le lieu habituel se règle
    db()->prepare('UPDATE groupes SET lieu = ? WHERE id = ?')->execute([$lieu, $id]);
    repondre(['ok' => true, 'id' => $id]);
  }
  $nom = texte($e['nom'] ?? '', 80);
  if ($nom === '') erreur('nom');
  $eleves = array_values(array_unique(array_map('intval', (array) ($e['eleves'] ?? []))));
  $existants = array_map('intval', db()->query('SELECT id FROM students')->fetchAll(PDO::FETCH_COLUMN));
  $eleves = array_values(array_intersect($eleves, $existants));
  if (count($eleves) < 1) erreur('eleves');
  if ($g) db()->prepare('UPDATE groupes SET nom = ?, lieu = ? WHERE id = ?')->execute([$nom, $lieu, $id]);
  else {
    db()->prepare('INSERT INTO groupes (nom, solo, lieu, cree_le) VALUES (?, 0, ?, ?)')->execute([$nom, $lieu, date('Y-m-d H:i:s')]);
    $id = (int) db()->lastInsertId();
  }
  db()->prepare('DELETE FROM groupe_eleves WHERE groupe_id = ?')->execute([$id]);
  $ins = db()->prepare('INSERT INTO groupe_eleves (groupe_id, student_id) VALUES (?, ?)');
  foreach ($eleves as $sid) $ins->execute([$id, $sid]);
  repondre(['ok' => true, 'id' => $id]);
}

if ($action === 'groupe_supprimer') {
  $g = groupe(entier($e['id'] ?? 0));
  if (!$g || $g['solo']) erreur('groupe');
  db()->prepare('DELETE FROM groupes WHERE id = ?')->execute([$g['id']]);
  repondre(['ok' => true]);
}

// Ajout de $n unités à une date
function decaler(string $debut, int $n, string $unite): string {
  $d = new DateTime($debut);
  $d->modify("+$n " . ['jour' => 'day', 'semaine' => 'week', 'mois' => 'month'][$unite]);
  return $d->format('Y-m-d H:i');
}

if ($action === 'cours_enregistrer') {
  $id = entier($e['id'] ?? 0);
  $ancien = $id ? cours_par_id($id) : null;
  if ($id && !$ancien) erreur('cours', 404);
  $gid = entier($e['groupe'] ?? 0);
  if (!groupe($gid)) erreur('groupe');
  $duree = $e['duree'] ?? null;
  if (!duree_valide($duree)) erreur('duree');
  $a_placer = !empty($e['a_placer']);
  $debut = $a_placer ? null : ($e['debut'] ?? null);
  if (!$a_placer && !debut_valide($debut)) erreur('debut');
  $lieu = texte($e['lieu'] ?? '', 300);
  $oeuvres = texte($e['oeuvres'] ?? '', 500);
  $travail = mb_substr(trim((string) ($e['travail'] ?? '')), 0, 5000);
  $statut = $a_placer ? 'a_placer' : 'place';

  // Rendez-vous régulier (création seulement) : tous les N jours / semaines / mois jusqu'au …
  $debuts = [$debut];
  $serie = null;
  $r = $e['recurrence'] ?? null;
  if (!$ancien && !$a_placer && is_array($r) && !empty($r['frequence'])) {
    $n = entier($r['frequence']);
    $unite = $r['unite'] ?? '';
    $jusqu = $r['jusqu_au'] ?? '';
    if ($n < 1 || $n > 365 || !in_array($unite, ['jour', 'semaine', 'mois'], true) || !preg_match('/^\d{4}-\d{2}-\d{2}$/', $jusqu) || $jusqu < substr($debut, 0, 10)) erreur('recurrence');
    $debuts = [];
    for ($k = 0, $d = $debut; substr($d, 0, 10) <= $jusqu && $k < 200; $k++, $d = decaler($debut, $n * $k, $unite)) $debuts[] = $d;
    $serie = bin2hex(random_bytes(8));
  }

  if ($ancien) {
    $statut = $a_placer ? 'a_placer' : ($ancien['statut'] === 'a_placer' || $ancien['statut'] === 'place' ? 'place' : $ancien['statut']);
    db()->prepare('UPDATE cours SET groupe_id = ?, debut = ?, duree = ?, statut = ?, lieu = ?, oeuvres = ?, travail = ? WHERE id = ?')
      ->execute([$gid, $debut, $duree, $statut, $lieu, $oeuvres, $travail, $id]);
    armer_rappels($id);
    $change = $ancien['debut'] !== $debut || (int) $ancien['duree'] !== $duree || $ancien['lieu'] !== $lieu || (int) $ancien['groupe_id'] !== $gid;
    if ($change && $statut === 'place' && strtotime($debut) > maintenant_cours()) {
      mail_groupe($gid, 'CAMI • Cours modifié', ($ancien['debut'] ? 'Votre cours du ' . quand_fr($ancien['debut'], (int) $ancien['duree']) . ' a été modifié.' : 'Votre cours a été fixé.')
        . "\n\nNouvel horaire : " . quand_fr($debut, $duree) . ".\n" . lieu_fr($lieu));
    }
    repondre(['ok' => true, 'id' => $id]);
  }

  $ins = db()->prepare('INSERT INTO cours (groupe_id, debut, duree, statut, lieu, oeuvres, travail, serie, cree_le) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)');
  $ids = [];
  foreach ($debuts as $d) {
    $ins->execute([$gid, $d, $duree, $statut, $lieu, $oeuvres, $travail, $serie, date('Y-m-d H:i:s')]);
    $ids[] = (int) db()->lastInsertId();
    armer_rappels(end($ids));
  }
  // Case « Informer l'élève de ce cours » (cochée par défaut) : mail avec lien vers le cours
  $informer = !array_key_exists('informer', $e) || !empty($e['informer']);
  $lien = "\nPour en prendre connaissance :\n" . SITE . '/cours/student/?cours=' . $ids[0] . "\n";
  if ($informer && $a_placer) {
    mail_groupe($gid, 'CAMI • Un cours vous est accordé', "Un cours d’analyse de " . heure_fr(hhmm($duree)) . " vous est accordé.\n\n"
      . "Vous pouvez dès maintenant le placer sur un créneau libre de votre calendrier de cours :\n" . SITE . '/cours/student/?cours=' . $ids[0] . "\n");
  } elseif ($informer && count($debuts) > 1) {
    mail_groupe($gid, 'CAMI • Vos prochains cours', "Vos prochains cours d’analyse sont fixés :\n\n"
      . implode("\n", array_map(function ($d) use ($duree) { return '- ' . quand_fr($d, $duree); }, $debuts)) . "\n" . lieu_fr($lieu) . $lien);
  } elseif ($informer) {
    mail_groupe($gid, 'CAMI • Nouveau cours', 'Votre prochain cours d’analyse est fixé le ' . quand_fr($debut, $duree) . ".\n" . lieu_fr($lieu) . $lien);
  }
  repondre(['ok' => true, 'id' => $ids[0], 'nombre' => count($ids)]);
}

if ($action === 'cours_supprimer') {
  $c = cours_par_id(entier($e['id'] ?? 0));
  if (!$c) erreur('cours', 404);
  $cibles = [$c];
  if (!empty($e['serie']) && $c['serie']) {   // ce cours et les suivants de la série
    $st = db()->prepare('SELECT * FROM cours WHERE serie = ? AND debut >= ?');
    $st->execute([$c['serie'], $c['debut']]);
    $cibles = $st->fetchAll();
  }
  $annonces = [];
  foreach ($cibles as $x) {
    db()->prepare('DELETE FROM cours WHERE id = ?')->execute([$x['id']]);
    if (in_array($x['statut'], ['place', 'demande'], true) && strtotime($x['debut']) > maintenant_cours()) $annonces[] = quand_fr($x['debut'], (int) $x['duree']);
  }
  if ($annonces && !empty($e['prevenir'])) {
    mail_groupe((int) $c['groupe_id'], 'CAMI • Cours annulé', (count($annonces) > 1 ? "Ces cours sont annulés :\n\n- " . implode("\n- ", $annonces) : 'Votre cours du ' . $annonces[0] . ' est annulé.') . "\n");
  }
  repondre(['ok' => true, 'nombre' => count($cibles)]);
}

if ($action === 'demande_repondre') {
  $c = cours_par_id(entier($e['id'] ?? 0));
  if (!$c || $c['statut'] !== 'demande') erreur('cours', 404);
  $raison = texte($e['raison'] ?? '', 500);
  if (!empty($e['accepter'])) {
    db()->prepare("UPDATE cours SET statut = 'place', raison = '' WHERE id = ?")->execute([$c['id']]);
    armer_rappels((int) $c['id']);
    mail_groupe((int) $c['groupe_id'], 'CAMI • Demande de cours acceptée', 'Votre demande de cours du ' . quand_fr($c['debut'], (int) $c['duree']) . " est acceptée.\n" . lieu_fr($c['lieu']));
  } else {
    db()->prepare("UPDATE cours SET statut = 'refuse', raison = ? WHERE id = ?")->execute([$raison, $c['id']]);
    mail_groupe((int) $c['groupe_id'], 'CAMI • Demande de cours refusée', 'Votre demande de cours du ' . quand_fr($c['debut'], (int) $c['duree']) . ' ne peut malheureusement pas être acceptée.'
      . ($raison !== '' ? "\n\nRaison : $raison" : '') . "\n\nVous pouvez demander un autre créneau sur votre calendrier de cours.\n");
  }
  repondre(['ok' => true]);
}

// Créneaux [{jour 1-7, debut, fin}] des disponibilités générales (semaine '') ou d'une semaine (lundi).
// Semaine avec generales: true → elle reprend les disponibilités générales.
if ($action === 'dispos_enregistrer') {
  $semaine = (string) ($e['semaine'] ?? '');
  if ($semaine !== '' && (!preg_match('/^\d{4}-\d{2}-\d{2}$/', $semaine) || lundi($semaine) !== $semaine)) erreur('semaine');
  $creneaux = [];
  foreach ((array) ($e['creneaux'] ?? []) as $c) {
    $jour = entier($c['jour'] ?? 0);
    $debut = $c['debut'] ?? null;
    $fin = $c['fin'] ?? null;
    if ($jour < 1 || $jour > 7 || !heure_valide($debut) || !(heure_valide($fin) || $fin === '24:00') || $fin <= $debut) erreur('creneau');
    $creneaux[] = [$jour, $debut, $fin];
  }
  db()->prepare('DELETE FROM dispos WHERE semaine = ?')->execute([$semaine]);
  if ($semaine !== '') {
    db()->prepare('DELETE FROM semaines_reglees WHERE semaine = ?')->execute([$semaine]);
    if (!empty($e['generales'])) repondre(['ok' => true]);
    db()->prepare('INSERT INTO semaines_reglees (semaine) VALUES (?)')->execute([$semaine]);
  }
  $ins = db()->prepare('INSERT INTO dispos (semaine, jour, debut, fin) VALUES (?, ?, ?, ?)');
  foreach ($creneaux as [$jour, $debut, $fin]) $ins->execute([$semaine, $jour, $debut, $fin]);
  repondre(['ok' => true]);
}

if ($action === 'lieu_enregistrer') {
  $nom = texte($e['nom'] ?? '', 60);
  $valeur = texte($e['valeur'] ?? '', 300);
  if ($nom === '' || $valeur === '') erreur('lieu');
  db()->prepare('INSERT INTO lieux (nom, valeur) VALUES (?, ?) ON CONFLICT(nom) DO UPDATE SET valeur = excluded.valeur')->execute([$nom, $valeur]);
  repondre(['ok' => true]);
}

if ($action === 'demande_cours_supprimer') {
  db()->prepare('DELETE FROM demandes_cours WHERE id = ?')->execute([entier($e['id'] ?? 0)]);
  repondre(['ok' => true]);
}

if ($action === 'lieu_supprimer') {
  db()->prepare('DELETE FROM lieux WHERE id = ?')->execute([entier($e['id'] ?? 0)]);
  repondre(['ok' => true]);
}

erreur('action', 400);
