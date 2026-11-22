<?php
// Brevo (compte « Icare Éditions ») : adresses du site enregistrées comme contacts,
// une liste par source dans le dossier « CAMI ».
// Clé API : <dossier des données>/brevo.key (hors dossier web). Sans clé (tests, local) : rien n'est fait.
// Un échec de Brevo ne bloque jamais le site : il est consigné dans <dossier des données>/brevo.log.
require_once __DIR__ . '/_cami.php';

const BREVO_API = 'https://api.brevo.com/v3';
// Listes du dossier « CAMI » (id 21) sur Brevo
const BREVO_LISTES = [
  'inscrit'        => 22,   // Inscrits (à la confirmation de l'inscription)
  'telechargement' => 23,   // Téléchargements Table d’analyse (au premier téléchargement)
  'contact'        => 24,   // Contacts (saisis à la main dans /admin/)
];

function brevo_cle(): string {
  $fichier = dossier_donnees() . '/brevo.key';
  return is_readable($fichier) ? trim((string) file_get_contents($fichier)) : '';
}

function brevo_journal(string $texte): void {
  @file_put_contents(dossier_donnees() . '/brevo.log', date('Y-m-d H:i:s') . ' ' . $texte . "\n", FILE_APPEND);
}

// Appel de l'API ; renvoie le code HTTP (0 : pas de clé ou échec réseau)
function brevo_appel(string $methode, string $chemin, ?array $donnees = null): int {
  $cle = brevo_cle();
  if ($cle === '' || !function_exists('curl_init')) return 0;
  $c = curl_init(BREVO_API . $chemin);
  curl_setopt_array($c, [
    CURLOPT_CUSTOMREQUEST => $methode,
    CURLOPT_RETURNTRANSFER => true,
    CURLOPT_CONNECTTIMEOUT => 4,
    CURLOPT_TIMEOUT => 8,
    CURLOPT_HTTPHEADER => ['api-key: ' . $cle, 'accept: application/json', 'content-type: application/json'],
  ]);
  if ($donnees !== null) curl_setopt($c, CURLOPT_POSTFIELDS, json_encode($donnees, JSON_UNESCAPED_UNICODE));
  $reponse = curl_exec($c);
  $code = (int) curl_getinfo($c, CURLINFO_HTTP_CODE);
  if ($reponse === false || $code >= 300) {
    brevo_journal("$methode $chemin → " . ($reponse === false ? curl_error($c) : "$code $reponse"));
  }
  return $code;
}

// Enregistre (ou complète) le contact et l'ajoute à la liste de la source.
// Genre H|F → attribut SEXE.
function brevo_ajouter(string $email, string $source, string $genre = ''): bool {
  if (!isset(BREVO_LISTES[$source])) return false;
  $donnees = ['email' => strtolower(trim($email)), 'listIds' => [BREVO_LISTES[$source]], 'updateEnabled' => true];
  if (in_array($genre, ['H', 'F'], true)) $donnees['attributes'] = ['SEXE' => $genre];
  $code = brevo_appel('POST', '/contacts', $donnees);
  return $code >= 200 && $code < 300;
}

// Supprime le contact de Brevo
function brevo_supprimer(string $email): bool {
  $code = brevo_appel('DELETE', '/contacts/' . rawurlencode(strtolower(trim($email))) . '?identifierType=email_id');
  return ($code >= 200 && $code < 300) || $code === 404;
}
