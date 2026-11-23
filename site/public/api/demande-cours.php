<?php
// Formulaire « Je veux prendre des cours d'analyse musicale » (/cours/demande/).
// POST JSON {nom, email, frequence, creneaux, niveaux, site_web (piège)} : demande enregistrée,
//   mail de confirmation de l'adresse au demandeur.
// GET ?jeton=… : lien du mail → adresse confirmée, demande transmise à l'administrateur.
require __DIR__ . '/_cours.php';

if ($_SERVER['REQUEST_METHOD'] === 'GET') {
  $jeton = (string) ($_GET['jeton'] ?? '');
  $d = null;
  if (preg_match('/^[0-9a-f]{32}$/', $jeton)) {
    $st = db()->prepare('SELECT * FROM demandes_cours WHERE jeton = ?');
    $st->execute([$jeton]);
    $d = $st->fetch() ?: null;
  }
  if (!$d) {
    header('Location: /cours/demande/?confirmation=invalide', true, 303);
    exit;
  }
  db()->prepare('UPDATE demandes_cours SET jeton = NULL, confirmee_le = ? WHERE id = ?')->execute([date('Y-m-d H:i:s'), $d['id']]);
  brevo_mail(NOTIFICATIONS, 'CAMI • Demande de cours — ' . $d['nom'], demande_texte($d) . "\nDemandes de cours : " . SITE . "/cours/admin/\n", $d['email']);
  header('Location: /cours/demande/?confirmation=ok', true, 303);
  exit;
}

function refus(string $code): void { repondre(['ok' => false, 'erreur' => $code], 422); }

$e = entree_post();
if (trim((string) ($e['site_web'] ?? '')) !== '') repondre(['ok' => true]);   // robot : on fait mine d'avoir reçu

$nom = texte($e['nom'] ?? '', 120);
$email = trim((string) ($e['email'] ?? ''));
$frequence = (string) ($e['frequence'] ?? '');
if ($nom === '') refus('nom');
if (!filter_var($email, FILTER_VALIDATE_EMAIL) || mb_strlen($email) > 200) refus('email');
if (!isset(FREQUENCES[$frequence])) refus('frequence');

$creneaux = [];
foreach (array_slice(is_array($e['creneaux'] ?? null) ? $e['creneaux'] : [], 0, 50) as $c) {
  $jour = (int) ($c['jour'] ?? 0);
  $debut = (string) ($c['debut'] ?? '');
  $fin = (string) ($c['fin'] ?? '');
  $ok = isset(JOURS_FR[$jour]) && preg_match('/^\d\d:[03]0$/', $debut) && preg_match('/^\d\d:[03]0$/', $fin)
    && $debut >= DEMANDE_HEURE_MIN && $fin <= DEMANDE_HEURE_MAX && $debut < $fin;
  if (!$ok) refus('creneau');
  $creneaux[] = ['jour' => $jour, 'debut' => $debut, 'fin' => $fin];
}
if (!$creneaux) refus('creneaux');

$niveaux = [];
foreach (CONNAISSANCES as $cle => $libelle) {
  $n = (string) ($e['niveaux'][$cle] ?? '');
  if (!isset(NIVEAUX[$n])) refus('niveaux');
  $niveaux[$cle] = $n;
}

$jeton = bin2hex(random_bytes(16));
db()->prepare('INSERT INTO demandes_cours (nom, email, frequence, creneaux, niveaux, jeton, cree_le) VALUES (?, ?, ?, ?, ?, ?, ?)')
  ->execute([$nom, $email, $frequence, json_encode($creneaux), json_encode($niveaux), $jeton, date('Y-m-d H:i:s')]);

$lien = SITE . '/api/demande-cours.php?jeton=' . $jeton;
brevo_mail($email, 'CAMI • Confirmez votre demande de cours', "Bonjour $nom,\n\n"
  . "Merci pour votre demande de cours d’analyse musicale.\n\n"
  . "Pour confirmer votre adresse, cliquez sur ce lien :\n\n$lien\n\n"
  . "Votre demande me sera transmise seulement après ce clic de confirmation.\n\n"
  . "Si vous n’êtes pas à l’origine de cette demande, ignorez simplement ce message.\n\n"
  . "Philippe Perret\nCours d’Analyse Musicale — " . SITE . "\n");
repondre(['ok' => true]);
