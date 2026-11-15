<?php
// Bibliothèque commune des scripts /api/ (inaccessible directement : voir .htaccess).
// Compatible PHP 7.4.
//
// Base SQLite hors du dossier web : /home/icare/data/analyse_musicale/cami.sqlite
// (variable d'environnement CAMI_DB pour les tests).

declare(strict_types=1);
date_default_timezone_set('Europe/Paris');

const ADMINS     = ['philippe.perret@analyse-musicale.fr'];
const EXPEDITEUR = 'contact@analyse-musicale.fr';
const SITE       = 'https://www.analyse-musicale.fr';

// Préférences (users.prefs, champ de bits)
const PREF_AVERTIR  = 1;   // être averti des prochains jeudis
const PREF_AUDITEUR = 2;   // compte venir en auditeur/auditrice libre

const SCHEMA = <<<SQL
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  pseudo TEXT,
  mdp TEXT NOT NULL,                -- password_hash()
  genre TEXT NOT NULL DEFAULT 'N',  -- F, H ou N (discret)
  prefs INTEGER NOT NULL DEFAULT 0,
  confirme INTEGER NOT NULL DEFAULT 0,
  jeton TEXT,                       -- jeton de confirmation de l'adresse
  presence_attente TEXT,            -- jeudi à enregistrer à la confirmation
  cree_le TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS seances (
  jour TEXT PRIMARY KEY,            -- AAAA-MM-JJ (un jeudi)
  compositeur TEXT NOT NULL DEFAULT '',
  oeuvre TEXT NOT NULL DEFAULT '',
  analyste TEXT NOT NULL DEFAULT 'Ph. Perret',
  debut TEXT NOT NULL DEFAULT '19:00',
  fin TEXT NOT NULL DEFAULT '22:00',
  youtube TEXT NOT NULL DEFAULT '',
  partition TEXT NOT NULL DEFAULT ''   -- URL de la partition
);
CREATE TABLE IF NOT EXISTS telechargements (   -- demandes de lien de la Table d'analyse
  id INTEGER PRIMARY KEY,
  email TEXT NOT NULL,
  systeme TEXT NOT NULL,
  fichier TEXT NOT NULL,
  le TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS presences (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  jour TEXT NOT NULL REFERENCES seances(jour) ON DELETE CASCADE,
  PRIMARY KEY (user_id, jour)
);
SQL;

function dossier_donnees(): string {
  return dirname(getenv('CAMI_DB') ?: '/home/icare/data/analyse_musicale/cami.sqlite');
}

function db(): PDO {
  static $pdo = null;
  if ($pdo) return $pdo;
  $fichier = getenv('CAMI_DB') ?: '/home/icare/data/analyse_musicale/cami.sqlite';
  if (!is_dir(dirname($fichier))) mkdir(dirname($fichier), 0750, true);
  $pdo = new PDO('sqlite:' . $fichier, null, null, [
    PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
    PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
  ]);
  $pdo->exec('PRAGMA foreign_keys = ON');
  $pdo->exec(SCHEMA);
  migrer($pdo);
  return $pdo;
}

// Colonnes ajoutées après la création de la base
function migrer(PDO $pdo): void {
  $colonnes = $pdo->query('PRAGMA table_info(seances)')->fetchAll(PDO::FETCH_COLUMN, 1);
  if (!in_array('partition', $colonnes, true)) $pdo->exec("ALTER TABLE seances ADD COLUMN partition TEXT NOT NULL DEFAULT ''");
}

// --- Session (fichiers dans le dossier des données, 90 jours) ---

function demarrer_session(): void {
  if (session_status() === PHP_SESSION_ACTIVE) return;
  $duree = 60 * 60 * 24 * 90;
  $dossier = dossier_donnees() . '/sessions';
  if (!is_dir($dossier)) mkdir($dossier, 0700, true);
  ini_set('session.gc_maxlifetime', (string) $duree);
  session_save_path($dossier);
  session_name('cami');
  $https = ($_SERVER['HTTPS'] ?? '') === 'on' || ($_SERVER['HTTP_X_FORWARDED_PROTO'] ?? '') === 'https';
  session_set_cookie_params(['lifetime' => $duree, 'path' => '/', 'secure' => $https, 'httponly' => true, 'samesite' => 'Lax']);
  session_start();
}

function user_courant(): ?array {
  if (!isset($_COOKIE['cami'])) return null;   // pas de session ouverte pour un simple visiteur
  demarrer_session();
  if (empty($_SESSION['uid'])) return null;
  $st = db()->prepare('SELECT * FROM users WHERE id = ? AND confirme = 1');
  $st->execute([$_SESSION['uid']]);
  return $st->fetch() ?: null;
}

function connecter(array $user): void {
  demarrer_session();
  session_regenerate_id(true);
  $_SESSION['uid'] = (int) $user['id'];
}

function est_admin(?array $user): bool {
  return $user !== null && in_array(strtolower($user['email']), ADMINS, true);
}

function user_public(?array $user): ?array {
  if ($user === null) return null;
  return ['pseudo' => $user['pseudo'] ?: '', 'genre' => $user['genre'], 'admin' => est_admin($user)];
}

// --- Requêtes / réponses ---

function repondre(array $donnees, int $code = 200): void {
  http_response_code($code);
  header('Content-Type: application/json; charset=utf-8');
  header('Cache-Control: no-store');
  echo json_encode($donnees, JSON_UNESCAPED_UNICODE);
  exit;
}

// POST JSON avec l'en-tête X-Cami (un autre site ne peut pas l'envoyer sans autorisation CORS)
function entree_post(): array {
  if ($_SERVER['REQUEST_METHOD'] !== 'POST' || ($_SERVER['HTTP_X_CAMI'] ?? '') !== '1') {
    repondre(['ok' => false, 'erreur' => 'requete'], 400);
  }
  $donnees = json_decode((string) file_get_contents('php://input'), true);
  return is_array($donnees) ? $donnees : [];
}

function texte($valeur, int $max): string {
  return mb_substr(trim(str_replace(["\r", "\n"], ' ', (string) $valeur)), 0, $max);
}

// --- Séances ---

function jour_valide($jour): bool {
  if (!is_string($jour) || !preg_match('/^\d{4}-\d{2}-\d{2}$/', $jour)) return false;
  $d = DateTime::createFromFormat('!Y-m-d', $jour);
  return $d && $d->format('Y-m-d') === $jour && $d->format('N') === '4';
}

// 'avant' | 'direct' | 'apres'
function etat_seance(array $s, ?DateTime $maintenant = null): string {
  $maintenant = $maintenant ?: new DateTime();
  if ($maintenant < new DateTime($s['jour'] . ' ' . $s['debut'])) return 'avant';
  if ($maintenant < new DateTime($s['jour'] . ' ' . $s['fin'])) return 'direct';
  return 'apres';
}

function seance(string $jour): ?array {
  $st = db()->prepare('SELECT * FROM seances WHERE jour = ?');
  $st->execute([$jour]);
  return $st->fetch() ?: null;
}

function ajouter_presence(int $uid, string $jour): bool {
  $s = seance($jour);
  if (!$s || etat_seance($s) === 'apres') return false;
  db()->prepare('INSERT OR IGNORE INTO presences (user_id, jour) VALUES (?, ?)')->execute([$uid, $jour]);
  return true;
}

// --- Mails ---

// Texte genré : [masculin|féminin] — « inscrit[|e] » ; N (discret) → masculin
function g(string $texte, string $genre): string {
  return preg_replace_callback('/\[([^\[\]|]*)\|([^\[\]|]*)\]/u', function ($m) use ($genre) {
    return $genre === 'F' ? $m[2] : $m[1];
  }, $texte);
}

function envoyer_mail(string $a, string $sujet, string $corps): bool {
  $entetes = implode("\r\n", [
    'From: ' . mb_encode_mimeheader('CAMI — Cours d’Analyse Musicale', 'UTF-8') . ' <' . EXPEDITEUR . '>',
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset=UTF-8',
    'Content-Transfer-Encoding: 8bit',
  ]);
  return mail($a, mb_encode_mimeheader($sujet, 'UTF-8'), $corps, $entetes);
}
