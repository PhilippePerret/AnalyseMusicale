<?php
// Création des directs YouTube (API YouTube Data v3) pour les séances des jeudis.
// Inaccessible directement (voir .htaccess). Compatible PHP 7.4.
//
// Identifiants : youtube.json dans le dossier des données (hors dossier web),
// déposé par scripts/youtube-autoriser.command :
//   {"client_id": …, "client_secret": …, "refresh_token": …}
// Flux réutilisé par tous les directs (clé unique pour le logiciel de diffusion) :
// son identifiant est gardé dans youtube-flux.json, dans le même dossier.

const YT_API = 'https://www.googleapis.com/youtube/v3';
const YT_TITRE_FLUX = 'CAMI — Jeudis de l’analyse';

class ErreurYoutube extends Exception {}

function yt_identifiants(): array {
  $fichier = dossier_donnees() . '/youtube.json';
  $id = is_file($fichier) ? json_decode((string) file_get_contents($fichier), true) : null;
  if (!is_array($id) || empty($id['refresh_token'])) throw new ErreurYoutube('youtube_non_autorise');
  return $id;
}

function yt_http(string $methode, string $url, ?array $corps = null, array $entetes = [], bool $formulaire = false): array {
  $ch = curl_init($url);
  $options = [CURLOPT_CUSTOMREQUEST => $methode, CURLOPT_RETURNTRANSFER => true, CURLOPT_TIMEOUT => 20, CURLOPT_HTTPHEADER => $entetes];
  if ($corps !== null) {
    $options[CURLOPT_POSTFIELDS] = $formulaire ? http_build_query($corps) : json_encode($corps, JSON_UNESCAPED_UNICODE);
    if (!$formulaire) $options[CURLOPT_HTTPHEADER][] = 'Content-Type: application/json';
  }
  curl_setopt_array($ch, $options);
  $reponse = curl_exec($ch);
  $code = (int) curl_getinfo($ch, CURLINFO_HTTP_CODE);
  $donnees = json_decode((string) $reponse, true) ?: [];
  if ($code < 200 || $code >= 300) {
    error_log("YouTube $methode $url → $code : $reponse");
    throw new ErreurYoutube('youtube_api');
  }
  return $donnees;
}

function yt_jeton(): string {
  static $jeton = null;
  if ($jeton) return $jeton;
  $id = yt_identifiants();
  $r = yt_http('POST', 'https://oauth2.googleapis.com/token', [
    'client_id' => $id['client_id'], 'client_secret' => $id['client_secret'],
    'refresh_token' => $id['refresh_token'], 'grant_type' => 'refresh_token',
  ], [], true);
  return $jeton = $r['access_token'];
}

function yt(string $methode, string $chemin, ?array $corps = null): array {
  return yt_http($methode, YT_API . $chemin, $corps, ['Authorization: Bearer ' . yt_jeton()]);
}

// Flux unique : retrouvé (fichier, puis par son titre sur la chaîne) ou créé
function yt_flux(): array {
  $fichier = dossier_donnees() . '/youtube-flux.json';
  $connu = is_file($fichier) ? json_decode((string) file_get_contents($fichier), true) : null;
  $liste = yt('GET', '/liveStreams?part=id,snippet,cdn&mine=true&maxResults=50')['items'] ?? [];
  foreach ($liste as $flux) {
    if (($connu && $flux['id'] === $connu['id']) || (!$connu && ($flux['snippet']['title'] ?? '') === YT_TITRE_FLUX)) {
      file_put_contents($fichier, json_encode(['id' => $flux['id']]));
      return $flux;
    }
  }
  $flux = yt('POST', '/liveStreams?part=snippet,cdn,contentDetails', [
    'snippet' => ['title' => YT_TITRE_FLUX],
    'cdn' => ['ingestionType' => 'rtmp', 'resolution' => 'variable', 'frameRate' => 'variable'],
    'contentDetails' => ['isReusable' => true],
  ]);
  file_put_contents($fichier, json_encode(['id' => $flux['id']]));
  return $flux;
}

// Texte de saisie → texte brut (^xxx^ : exposant AsciiDoc, sans les marques)
function yt_brut(string $texte): string {
  return preg_replace('/\^([^\^\s]+)\^/', '$1', $texte);
}

function yt_description(array $s): string {
  $analyste = $s['analyste'] === 'Ph. Perret' ? 'Philippe Perret' : yt_brut($s['analyste']);
  $oeuvre = trim(yt_brut($s['compositeur']) . ($s['compositeur'] !== '' && $s['oeuvre'] !== '' ? ', ' : '') . yt_brut($s['oeuvre']));
  $lignes = [
    "Chaque jeudi (les « Jeudis de l'analyse ») est analysée en direct, par $analyste, une pièce de musique principalement classique.",
    '',
    'Détails : ' . SITE . '/jeudis-analyse/',
  ];
  if ($oeuvre !== '') $lignes[] = "Œuvre présente : $oeuvre";
  if ($s['partition'] !== '') $lignes[] = 'Partition : ' . $s['partition'];
  $lignes[] = 'Philippe Perret : ' . SITE . '/pedagogue/';
  return implode("\n", $lignes);
}

// Crée le direct programmé de la séance ; renvoie son adresse permanente
function creer_direct(array $s): string {
  if (empty($s['debut'])) throw new ErreurYoutube('debut');
  $piece = trim(yt_brut($s['compositeur']) . ($s['compositeur'] !== '' && $s['oeuvre'] !== '' ? ', ' : '') . yt_brut($s['oeuvre']));
  $titre = mb_substr('Analyses Musicales en Direct' . ($piece !== '' ? " — $piece" : ''), 0, 100);
  $heure = function (string $h) use ($s) { return (new DateTime($s['jour'] . ' ' . $h))->format(DateTime::RFC3339); };

  $emission = yt('POST', '/liveBroadcasts?part=snippet,status,contentDetails', [
    'snippet' => [
      'title' => $titre,
      'description' => yt_description($s),
      'scheduledStartTime' => $heure($s['debut']),
      'scheduledEndTime' => $heure($s['fin']),
    ],
    'status' => ['privacyStatus' => 'public', 'selfDeclaredMadeForKids' => false],
    'contentDetails' => ['enableAutoStart' => false, 'enableAutoStop' => true, 'recordFromStart' => true, 'enableDvr' => true],
  ]);
  $flux = yt_flux();
  yt('POST', '/liveBroadcasts/bind?part=id,contentDetails&id=' . urlencode($emission['id']) . '&streamId=' . urlencode($flux['id']));
  yt_miniature($emission['id']);
  return 'https://www.youtube.com/watch?v=' . $emission['id'];
}

// Miniature : logo CAMI (public/miniature-direct.jpg). Un échec n'empêche pas le direct.
function yt_miniature(string $id): void {
  $image = __DIR__ . '/../miniature-direct.jpg';
  if (!is_file($image)) return;
  $ch = curl_init('https://www.googleapis.com/upload/youtube/v3/thumbnails/set?videoId=' . urlencode($id));
  curl_setopt_array($ch, [
    CURLOPT_POST => true, CURLOPT_RETURNTRANSFER => true, CURLOPT_TIMEOUT => 30,
    CURLOPT_HTTPHEADER => ['Authorization: Bearer ' . yt_jeton(), 'Content-Type: image/jpeg'],
    CURLOPT_POSTFIELDS => file_get_contents($image),
  ]);
  $reponse = curl_exec($ch);
  $code = (int) curl_getinfo($ch, CURLINFO_HTTP_CODE);
  if ($code < 200 || $code >= 300) error_log("YouTube miniature $id → $code : $reponse");
}

// Adresse et clé du flux, pour le logiciel de diffusion (administrateur)
function infos_flux(): array {
  $flux = yt_flux();
  return ['serveur' => $flux['cdn']['ingestionInfo']['ingestionAddress'] ?? '', 'cle' => $flux['cdn']['ingestionInfo']['streamName'] ?? ''];
}
