<?php
// Téléchargement de la Table d'analyse (page /table-analyse/).
// Reçoit l'adresse mail et le fichier de la plateforme choisie (POST),
// enregistre la demande dans la base (table telechargements) et envoie à cette
// adresse un lien propre à la demande (api/telecharger.php?jeton=…) : son
// premier clic confirme l'adresse. Réponse JSON {ok, error}.
require __DIR__ . '/api/_cami.php';

// Commande Terminal sortant l'application de la quarantaine (macOS, application non signée)
const DEBLOCAGE_MAC = 'xattr -dr com.apple.quarantine "/Applications/Table Analyse.app"';

function reponse(bool $ok, string $error = ''): void {
  repondre(['ok' => $ok, 'error' => $error]);
}

if ($_SERVER['REQUEST_METHOD'] !== 'POST') reponse(false, 'methode');

// Champ piège rempli : robot. On fait mine d'avoir envoyé.
if (trim($_POST['site_web'] ?? '') !== '') reponse(true);

$email = strtolower(trim($_POST['email'] ?? ''));
if (mb_strlen($email) > 200 || !filter_var($email, FILTER_VALIDATE_EMAIL)) reponse(false, 'email');

// Fichier de la plateforme : déposé dans le dossier des données (cf. dossier_ta)
$fichier = (string) ($_POST['fichier'] ?? '');
$systeme = texte($_POST['systeme'] ?? '', 40);
if (!fichier_valide($fichier)) reponse(false, 'plateforme');
if (!fichier_disponible($fichier)) reponse(false, 'indisponible');
$jeton = bin2hex(random_bytes(16));

// --- Mail envoyé au demandeur (texte et HTML) ---
// Marche à suivre pour ouvrir l'application non signée : macOS (déblocage,
// juste sous le lien), Windows (antivirus)

const NOTE_APPLE = "Apple contraint à payer un abonnement annuel de développeur pour « autoriser » les applications, "
  . "même lorsqu’elles sont fournies gratuitement. Table d’analyse doit donc être débloquée, une seule fois, "
  . "après avoir été placée dans le dossier Applications.";
const NOTE_TERMINAL = "Lancez l’application Terminal.app avec Spotlight : Cmd + Espace, commencer à taper « Termi », choisir l’application Terminal.";
const PROBLEME = "Si vous rencontrez un problème, merci de nous en informer en répondant à ce message.";

function texte_deblocage_mac(): string {
  return "VOUS DEVEZ DÉBLOQUER L’APPLICATION pour pouvoir l’utiliser(1) :\n"
    . "- ouvrez une fenêtre Terminal (2),\n"
    . "- copiez-collez le code : " . DEBLOCAGE_MAC . "\n"
    . "- pressez la touche Entrée.\n\n"
    . "Vous pouvez maintenant ouvrir l’application et l'utiliser.\n\n"
    . "(1) " . NOTE_APPLE . "\n"
    . "(2) " . NOTE_TERMINAL . "\n\n";
}

function texte_deblocage_windows(): string {
  return "Table d’analyse n'étant pas « signée » (signature payante), Windows ou votre antivirus peuvent la bloquer "
    . "ou la placer en quarantaine (confinement). Dans ce cas :\n"
    . "- si Windows affiche « Windows a protégé votre ordinateur », cliquez sur « Informations complémentaires » puis sur « Exécuter quand même »,\n"
    . "- si votre antivirus a confiné l'application, ouvrez-le, rendez-vous dans sa zone de quarantaine (ou de confinement), "
    . "demandez-lui d'en sortir Table d’analyse (« Restaurer », « Autoriser ») et ajoutez-la à ses exceptions.\n\n"
    . "L'application devrait alors s'ouvrir sans problème.\n\n";
}

// Encadré ambre (déblocage, antivirus)
function html_encadre(string $contenu): string {
  return '<tr><td style="padding:0 36px;">'
    . '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#fff8e6;border-left:4px solid #d18700;border-radius:4px;">'
    . '<tr><td style="padding:18px 20px;font-size:15px;line-height:1.55;">' . $contenu . '</td></tr></table></td></tr>';
}

function html_deblocage_mac(): string {
  return html_encadre(
    '<p style="margin:0 0 10px;font-weight:bold;color:#8a5a00;">VOUS DEVEZ DÉBLOQUER L’APPLICATION pour pouvoir l’utiliser<sup>(1)</sup> :</p>'
    . '<ol style="margin:0 0 12px;padding-left:22px;"><li>ouvrez une fenêtre Terminal<sup>(2)</sup>,</li><li>copiez-collez le code :</li></ol>'
    . '<div style="background:#1e1e1e;color:#e6e6e6;font-family:Menlo,Monaco,Consolas,monospace;font-size:13px;padding:12px 14px;border-radius:5px;margin:0 0 12px 22px;">'
    . htmlspecialchars(DEBLOCAGE_MAC) . '</div>'
    . '<ol start="3" style="margin:0 0 12px;padding-left:22px;"><li>pressez la touche Entrée.</li></ol>'
    . '<p style="margin:0;">Vous pouvez maintenant ouvrir l’application et l\'utiliser.</p>'
  ) . '<tr><td style="padding:20px 36px 8px;font-size:12.5px;line-height:1.5;color:#777;">'
    . '<p style="margin:0 0 6px;">(1) ' . NOTE_APPLE . '</p>'
    . '<p style="margin:0;">(2) ' . NOTE_TERMINAL . '</p></td></tr>';
}

function html_deblocage_windows(): string {
  return html_encadre(
    '<p style="margin:0 0 10px;">Table d’analyse n\'étant pas « signée » (signature payante), Windows ou votre antivirus peuvent la bloquer ou la placer en quarantaine (confinement). Dans ce cas :</p>'
    . '<ul style="margin:0 0 12px;padding-left:22px;">'
    . '<li>si Windows affiche « Windows a protégé votre ordinateur », cliquez sur « Informations complémentaires » puis sur « Exécuter quand même »,</li>'
    . '<li>si votre antivirus a confiné l\'application, ouvrez-le, rendez-vous dans sa zone de quarantaine (ou de confinement), demandez-lui d\'en sortir Table d’analyse (« Restaurer », « Autoriser ») et ajoutez-la à ses exceptions.</li></ul>'
    . '<p style="margin:0;">L\'application devrait alors s\'ouvrir sans problème.</p>'
  );
}

function html_mail(string $lien, string $deblocage): string {
  return '<!DOCTYPE html><html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"></head>'
    . '<body style="margin:0;padding:24px 0;background:#f4f5f6;">'
    . '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f5f6;"><tr><td align="center">'
    . '<table role="presentation" width="560" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border-radius:8px;font-family:Helvetica,Arial,sans-serif;color:#222;">'
    . '<tr><td style="padding:32px 36px 8px;">'
    . '<p style="margin:0 0 18px;font-size:16px;">Bonjour,</p>'
    . '<p style="margin:0 0 24px;font-size:16px;line-height:1.5;">Vous avez demandé à télécharger l’application <b>Table d’analyse</b>, voici le lien de téléchargement. Merci de votre intérêt.</p>'
    . '<p style="margin:0 0 30px;text-align:center;"><a href="' . htmlspecialchars($lien) . '" style="display:inline-block;background:#48a45c;color:#ffffff;text-decoration:none;font-size:17px;font-weight:bold;padding:14px 34px;border-radius:6px;">Télécharger la Table d’analyse</a></p>'
    . '</td></tr>'
    . $deblocage
    . '<tr><td style="padding:20px 36px 32px;font-size:15px;line-height:1.5;">'
    . '<p style="margin:0 0 14px;">' . PROBLEME . '</p>'
    . '<p style="margin:0 0 14px;">Bonnes analyses !</p>'
    . '<p style="margin:0;color:#3e4a54;">Philippe Perret<br><span style="font-size:13px;color:#777;">Classe d’Analyse Musicale — <a href="' . SITE . '" style="color:#3d6a96;">' . preg_replace('#^https?://#', '', SITE) . '</a></span></p>'
    . '</td></tr></table></td></tr></table></body></html>';
}

$lien = SITE . '/api/telecharger.php?jeton=' . $jeton;
$mac = (bool) preg_match('/\.dmg$/', $fichier);
$windows = (bool) preg_match('/\.exe$/', $fichier);
$corps = "Bonjour,\n\n"
  . "Vous avez demandé à télécharger l’application Table d’analyse, voici le lien de téléchargement. Merci de votre intérêt.\n\n"
  . $lien . "\n\n"
  . ($mac ? texte_deblocage_mac() : '')
  . ($windows ? texte_deblocage_windows() : '')
  . PROBLEME . "\n\n"
  . "Bonnes analyses !\n\nPhilippe Perret\nClasse d’Analyse Musicale — " . SITE . "\n";
$html = html_mail($lien, $mac ? html_deblocage_mac() : ($windows ? html_deblocage_windows() : ''));
if (!envoyer_mail($email, 'Votre lien de téléchargement de la Table d’analyse', $corps, null, '', $html)) reponse(false, 'envoi');

$date = date('Y-m-d H:i:s');
$version = version_fichier($fichier);
db()->prepare('INSERT INTO telechargements (email, systeme, fichier, version, jeton, le) VALUES (?, ?, ?, ?, ?, ?)')
  ->execute([$email, $systeme, $fichier, $version, $jeton, $date]);
envoyer_mail(NOTIFICATIONS, 'CAMI • Demande de lien de la Table d’analyse', "Adresse : $email\nPlateforme : $systeme\nVersion : $version\nDate : $date\n");

reponse(true);
