// Tests de l'API des jeudis (dist/api/*.php) avec une base SQLite temporaire.
// Ignorés si PHP n'est pas disponible.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync, mkdtempSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { spawn, spawnSync } from 'node:child_process';

const DIST = join(dirname(fileURLToPath(import.meta.url)), '..', 'dist');
const phpOk = spawnSync('php', ['-v']).status === 0;
const skip = !phpOk && 'PHP indisponible';

let serveur, base, mailFile;
const tmp = mkdtempSync(join(tmpdir(), 'cami-api-'));

before(async () => {
  if (!phpOk) return;
  mailFile = join(tmp, 'mails.txt');
  writeFileSync(mailFile, '');
  const port = 8900 + Math.floor(Math.random() * 100);
  base = `http://127.0.0.1:${port}`;
  serveur = spawn('php', ['-d', `sendmail_path=cat >> ${mailFile}`, '-S', `127.0.0.1:${port}`, '-t', DIST], {
    stdio: 'ignore',
    env: { ...process.env, CAMI_DB: join(tmp, 'cami.sqlite') },
  });
  for (let i = 0; i < 50; i++) {
    try { await fetch(`${base}/robots.txt`); break; } catch { await new Promise((r) => setTimeout(r, 100)); }
  }
});
after(() => serveur?.kill());

// Client avec son propre cookie de session
function client() {
  let cookie = '';
  const garder = (rep) => { const c = rep.headers.get('set-cookie'); if (c) cookie = c.split(';')[0]; return rep; };
  return {
    get: async (chemin) => garder(await fetch(base + chemin, { headers: { cookie }, redirect: 'manual' })),
    post: async (script, donnees, entete = true) => {
      const rep = garder(await fetch(`${base}/api/${script}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', cookie, ...(entete ? { 'X-Cami': '1' } : {}) },
        body: JSON.stringify(donnees),
      }));
      return { status: rep.status, ...(await rep.json()) };
    },
    etat: async () => (await fetch(`${base}/api/etat.php`, { headers: { cookie } })).json(),
    multipart: async (script, form) => {
      const rep = await fetch(`${base}/api/${script}`, { method: 'POST', headers: { cookie, 'X-Cami': '1' }, body: form });
      return { status: rep.status, ...(await rep.json()) };
    },
  };
}

const dernierLien = () => [...readFileSync(mailFile, 'utf-8').matchAll(/confirmer\.php\?jeton=([0-9a-f]{32})/g)].pop()?.[1];

// Un jeudi futur
function jeudiFutur(semaines = 3) {
  const d = new Date();
  d.setDate(d.getDate() + ((4 - d.getDay() + 7) % 7) + 7 * semaines);
  return d.toISOString().slice(0, 10);
}
const JOUR = jeudiFutur();

async function inscrireEtConfirmer(c, email, extra = {}) {
  const r = await c.post('compte.php', { action: 'inscription', email, mdp: 'motdepasse', genre: 'F', avertir: true, cgu: true, ...extra });
  assert.equal(r.ok, true);
  const rep = await c.get(`/api/confirmer.php?jeton=${dernierLien()}`);
  assert.equal(rep.status, 303);
  assert.equal(rep.headers.get('location'), '/jeudis-analyse/?confirmation=ok');
}

test('fichier interne _cami.php : jamais exécuté seul, rien en sortie', { skip }, async () => {
  const rep = await fetch(`${base}/api/_cami.php`);
  assert.equal((await rep.text()).trim(), '');
});

test('POST sans en-tête X-Cami refusé', { skip }, async () => {
  const r = await client().post('compte.php', { action: 'connexion', email: 'a@b.fr', mdp: 'x' }, false);
  assert.equal(r.status, 400);
});

test('état initial : aucune séance, visiteur anonyme', { skip }, async () => {
  const e = await client().etat();
  assert.equal(e.ok, true);
  assert.deepEqual(e.seances, {});
  assert.equal(e.user, null);
  assert.match(e.maintenant, /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/);
});

test('édition de séance refusée à un visiteur non administrateur', { skip }, async () => {
  const c = client();
  await inscrireEtConfirmer(c, 'membre@example.com');
  const r = await c.post('seance.php', { action: 'enregistrer', jour: JOUR, debut: '19:00', fin: '22:00' });
  assert.equal(r.status, 403);
});

test('administrateur : création, modification, contrôles, suppression', { skip }, async () => {
  const admin = client();
  await inscrireEtConfirmer(admin, 'philippe.perret@analyse-musicale.fr');
  assert.equal((await admin.etat()).user.admin, true);

  let r = await admin.post('seance.php', { action: 'enregistrer', jour: JOUR, compositeur: 'Chopin', oeuvre: 'Prélude op. 28 n° 4', analyste: '', debut: '19:00', fin: '22:00', youtube: '' });
  assert.equal(r.ok, true);
  let s = (await admin.etat()).seances[JOUR];
  assert.equal(s.compositeur, 'Chopin');
  assert.equal(s.analyste, 'Ph. Perret');
  assert.equal(s.etat, 'avant');

  r = await admin.post('seance.php', { action: 'enregistrer', jour: JOUR, compositeur: 'Chopin', oeuvre: 'x', analyste: 'M. Dupont', debut: '20:00', fin: '23:00', youtube: 'https://youtube.com/live/abc' });
  assert.equal(r.ok, true);
  s = (await admin.etat()).seances[JOUR];
  assert.equal(s.analyste, 'M. Dupont');
  assert.equal(s.fin, '23:00');

  r = await admin.post('seance.php', { action: 'enregistrer', jour: JOUR, debut: '19:00', fin: '22:00', partition: 'https://imslp.org/partition.pdf' });
  assert.equal((await admin.etat()).seances[JOUR].partition, 'https://imslp.org/partition.pdf');
  assert.equal((await admin.post('seance.php', { action: 'enregistrer', jour: JOUR, debut: '19:00', fin: '22:00', partition: 'javascript:x' })).erreur, 'partition');

  assert.equal((await admin.post('seance.php', { action: 'enregistrer', jour: JOUR, debut: '22:00', fin: '20:00' })).erreur, 'heures');
  assert.equal((await admin.post('seance.php', { action: 'enregistrer', jour: JOUR, debut: '19:00', fin: '22:00', youtube: 'javascript:alert(1)' })).erreur, 'youtube');
  assert.equal((await admin.post('seance.php', { action: 'enregistrer', jour: '2026-11-18', debut: '19:00', fin: '22:00' })).erreur, 'jour');   // un mercredi

  // Direct YouTube demandé sans autorisation : séance enregistrée, avertissement
  const avecDirect = jeudiFutur(6);
  r = await admin.post('seance.php', { action: 'enregistrer', jour: avecDirect, compositeur: 'Bach', debut: '19:00', fin: '22:00', creer_direct: true });
  assert.equal(r.ok, true);
  assert.equal(r.avertissement, 'youtube_non_autorise');
  assert.equal((await admin.etat()).seances[avecDirect].compositeur, 'Bach');

  const autre = jeudiFutur(5);
  await admin.post('seance.php', { action: 'enregistrer', jour: autre, debut: '19:00', fin: '22:00' });
  r = await admin.post('seance.php', { action: 'supprimer', jour: autre });
  assert.equal(r.ok, true);
  assert.equal((await admin.etat()).seances[autre], undefined);
});

test('inscription avec présence en attente → présence enregistrée à la confirmation', { skip }, async () => {
  const c = client();
  const r = await c.post('compte.php', { action: 'inscription', email: 'auditrice@example.com', mdp: 'motdepasse', genre: 'F', cgu: true, jour: JOUR });
  assert.equal(r.attente, true);
  const mails = readFileSync(mailFile, 'utf-8');
  assert.match(mails, /To: auditrice@example\.com/);
  // Pas d'identification avant confirmation
  const avant = await c.post('compte.php', { action: 'connexion', email: 'auditrice@example.com', mdp: 'motdepasse' });
  assert.equal(avant.erreur, 'non_confirme');
  await c.get(`/api/confirmer.php?jeton=${dernierLien()}`);
  const e = await c.etat();
  assert.equal(e.user.genre, 'F');
  assert.deepEqual(e.presences, [JOUR]);
});

test('jeton invalide ou déjà utilisé', { skip }, async () => {
  const rep = await client().get('/api/confirmer.php?jeton=' + '0'.repeat(32));
  assert.equal(rep.headers.get('location'), '/jeudis-analyse/?confirmation=invalide');
});

test('connexion, présence, déconnexion', { skip }, async () => {
  const c = client();
  assert.equal((await c.post('compte.php', { action: 'connexion', email: 'membre@example.com', mdp: 'mauvais' })).erreur, 'identifiants');
  assert.equal((await c.post('compte.php', { action: 'connexion', email: 'membre@example.com', mdp: 'motdepasse' })).ok, true);
  assert.equal((await c.post('presence.php', { jour: JOUR, present: true })).ok, true);
  assert.deepEqual((await c.etat()).presences, [JOUR]);
  await c.post('compte.php', { action: 'deconnexion' });
  assert.equal((await c.etat()).user, null);
  assert.equal((await c.post('presence.php', { jour: JOUR, present: true })).status, 401);
});

test('adresse déjà confirmée : nouvelle inscription refusée ; piège à robots', { skip }, async () => {
  const c = client();
  assert.equal((await c.post('compte.php', { action: 'inscription', email: 'membre@example.com', mdp: 'motdepasse', genre: 'N', cgu: true })).erreur, 'existe');
  assert.equal((await c.post('compte.php', { action: 'inscription', email: 'sansgenre@example.com', mdp: 'motdepasse', cgu: true })).erreur, 'genre');
  assert.equal((await c.post('compte.php', { action: 'inscription', email: 'sanscgu@example.com', mdp: 'motdepasse', genre: 'H' })).erreur, 'cgu');
  const avant = readFileSync(mailFile, 'utf-8').length;
  assert.equal((await c.post('compte.php', { action: 'inscription', email: 'robot@example.com', mdp: 'motdepasse', site_web: 'x' })).ok, true);
  assert.equal(readFileSync(mailFile, 'utf-8').length, avant);
});

// --- Table d'analyse : lien de téléchargement suivi, page /admin/ ---

const FICHIER_TA = 'https://github.com/PhilippePerret/TableAnalyse-nodejs/releases/download/v2.1.6/Table-Analyse-2.1.6.dmg';
const dernierLienTA = () => [...readFileSync(mailFile, 'utf-8').matchAll(/telecharger\.php\?jeton=([0-9a-f]{32})/g)].pop()?.[1];

async function adminConnecte() {
  const admin = client();
  const r = await admin.post('compte.php', { action: 'connexion', email: 'philippe.perret@analyse-musicale.fr', mdp: 'motdepasse' });
  assert.equal(r.ok, true);
  return admin;
}
const liste = async (c) => (await c.get('/api/personnes.php')).json();
const personne = (l, email) => l.personnes.find((p) => p.email === email);

test('téléchargement : adresse confirmée au premier clic sur le lien du mail', { skip }, async () => {
  const demande = new URLSearchParams({ email: 'Lecteur@Example.com', fichier: FICHIER_TA, systeme: 'macOS' });
  const r = await (await fetch(`${base}/telechargement.php`, { method: 'POST', body: demande })).json();
  assert.equal(r.ok, true);
  const admin = await adminConnecte();
  let t = personne(await liste(admin), 'lecteur@example.com').telechargements[0];
  assert.equal(t.telecharge_le, null);
  assert.equal(t.version, '2.1.6');

  const jeton = dernierLienTA();
  const rep = await client().get(`/api/telecharger.php?jeton=${jeton}`);
  assert.equal(rep.status, 302);
  assert.equal(rep.headers.get('location'), FICHIER_TA);
  t = personne(await liste(admin), 'lecteur@example.com').telechargements[0];
  assert.match(t.telecharge_le, /^\d{4}-\d{2}-\d{2} /);
  assert.equal(readFileSync(mailFile, 'utf-8').match(/Version : 2\.1\.6/g).length, 2);   // avis de demande + avis de téléchargement

  assert.equal((await client().get('/api/telecharger.php?jeton=' + '0'.repeat(32))).headers.get('location'), '/table-analyse/');
});

test('téléchargement direct d’un visiteur identifié enregistré', { skip }, async () => {
  const c = client();
  await c.post('compte.php', { action: 'connexion', email: 'membre@example.com', mdp: 'motdepasse' });
  const rep = await c.get(`/api/telecharger.php?fichier=${encodeURIComponent(FICHIER_TA)}&systeme=macOS`);
  assert.equal(rep.headers.get('location'), FICHIER_TA);
  const p = personne(await liste(await adminConnecte()), 'membre@example.com');
  assert.equal(p.telechargements[0].systeme, 'macOS');
  assert.ok(p.telechargements[0].telecharge_le);
  assert.equal(p.inscription.confirme, true);
  // Anonyme : rien d'enregistré
  assert.equal((await client().get(`/api/telecharger.php?fichier=${encodeURIComponent(FICHIER_TA)}`)).headers.get('location'), '/table-analyse/');
});

test('liste des adresses refusée à un non-administrateur', { skip }, async () => {
  assert.equal((await client().get('/api/personnes.php')).status, 403);
  const c = client();
  await c.post('compte.php', { action: 'connexion', email: 'membre@example.com', mdp: 'motdepasse' });
  assert.equal((await c.post('personnes.php', { action: 'supprimer', emails: ['lecteur@example.com'] })).status, 403);
});

test('administrateur : ajout à la main, message avec pièce jointe, suppression', { skip }, async () => {
  const admin = await adminConnecte();
  let r = await admin.post('personnes.php', { action: 'ajouter', comme: 'telechargement', email: 'main@example.com', systeme: 'Linux', version: '2.0', date: '2026-11-01' });
  assert.equal(r.ok, true);
  assert.equal((await admin.post('personnes.php', { action: 'ajouter', comme: 'telechargement', email: 'x@example.com', systeme: 'Linux', version: 'v2', date: '2026-11-01' })).erreur, 'version');
  assert.equal((await admin.post('personnes.php', { action: 'ajouter', comme: 'telechargement', email: 'x@example.com', systeme: 'Linux', version: '2', date: '2999-01-01' })).erreur, 'date');
  r = await admin.post('personnes.php', { action: 'ajouter', comme: 'inscrit', email: 'ami@example.com', pseudo: 'Ami', genre: 'F', avertir: true });
  assert.equal(r.ok, true);
  assert.equal((await admin.post('personnes.php', { action: 'ajouter', comme: 'inscrit', email: 'ami@example.com', genre: 'N' })).erreur, 'existe');
  assert.equal((await admin.post('personnes.php', { action: 'ajouter', comme: 'inscrit', email: 'autre@example.com' })).erreur, 'genre');

  r = await admin.post('personnes.php', { action: 'ajouter', comme: 'contact', email: 'seul@example.com', pseudo: 'Seul', genre: 'H' });
  assert.equal(r.ok, true);
  assert.equal((await admin.post('personnes.php', { action: 'ajouter', comme: 'contact', email: 'seul@example.com', genre: 'H' })).erreur, 'existe');
  assert.equal((await admin.post('personnes.php', { action: 'ajouter', comme: 'contact', email: 'seul2@example.com' })).erreur, 'genre');

  let l = await liste(admin);
  assert.deepEqual([personne(l, 'seul@example.com').contact.pseudo, personne(l, 'seul@example.com').contact.genre], ['Seul', 'H']);
  const t = personne(l, 'main@example.com').telechargements[0];
  assert.deepEqual([t.systeme, t.version, t.telecharge_le, t.source], ['Linux', '2.0', '2026-11-01', 'main']);
  assert.equal(personne(l, 'ami@example.com').inscription.source, 'main');
  assert.equal(personne(l, 'ami@example.com').inscription.avertir, true);

  // Personne saisie à la main : peut ensuite s'inscrire elle-même
  assert.equal((await client().post('compte.php', { action: 'inscription', email: 'ami@example.com', mdp: 'motdepasse', genre: 'F', cgu: true })).ok, true);

  const form = new FormData();
  form.append('action', 'envoyer');
  form.append('emails', JSON.stringify(['main@example.com', 'ami@example.com']));
  form.append('objet', 'Nouvelle version');
  form.append('message', 'Bonjour,\nLa version 2.2 est sortie.');
  form.append('piece', new Blob(['contenu joint']), 'notes.txt');
  const avant = readFileSync(mailFile, 'utf-8').length;
  r = await admin.multipart('personnes.php', form);
  assert.equal(r.ok, true);
  assert.equal(r.envoyes, 2);
  const mails = readFileSync(mailFile, 'utf-8').slice(avant);
  assert.equal(mails.match(/filename\*=UTF-8''notes\.txt/g).length, 2);
  assert.match(mails, /Reply-To: philippe\.perret@analyse-musicale\.fr/);
  assert.match(mails, /La version 2\.2 est sortie/);
  assert.match(mails, new RegExp(Buffer.from('contenu joint').toString('base64')));

  r = await admin.post('personnes.php', { action: 'supprimer', emails: ['main@example.com', 'ami@example.com', 'seul@example.com', 'philippe.perret@analyse-musicale.fr'] });
  assert.equal(r.supprimees, 3);
  l = await liste(admin);
  assert.equal(personne(l, 'main@example.com'), undefined);
  assert.equal(personne(l, 'ami@example.com'), undefined);
  assert.equal(personne(l, 'seul@example.com'), undefined);
  assert.ok(personne(l, 'philippe.perret@analyse-musicale.fr'));
});

test('conservation : données sans contact depuis 3 ans supprimées à la connexion', { skip }, async () => {
  const { DatabaseSync } = await import('node:sqlite');
  const admin = await adminConnecte();
  await admin.post('personnes.php', { action: 'ajouter', comme: 'contact', email: 'vieux@example.com', genre: 'N' });
  await admin.post('personnes.php', { action: 'ajouter', comme: 'contact', email: 'recent@example.com', genre: 'N' });
  const db = new DatabaseSync(join(tmp, 'cami.sqlite'));
  db.prepare("UPDATE contacts SET cree_le = '2020-01-01 00:00:00' WHERE email = 'vieux@example.com'").run();
  db.close();
  await adminConnecte();
  const l = await liste(admin);
  assert.equal(personne(l, 'vieux@example.com'), undefined);
  assert.ok(personne(l, 'recent@example.com'));
});

test('invitations : enregistrement, programmation, envoi immédiat, envoi programmé, suppression', { skip }, async () => {
  assert.equal((await client().get('/api/invitations.php')).status, 403);
  const admin = await adminConnecte();
  const futur = new Date(Date.now() + 86400000).toLocaleDateString('sv') + ' 09:00';
  let r = await admin.post('invitations.php', { action: 'enregistrer', objet: 'Invitation', message: 'Venez !', adresses: ['Invite1@Example.com', 'invite1@example.com', 'invite2@example.com'], programmee_le: futur });
  assert.equal(r.ok, true);
  assert.deepEqual(r.invitation.adresses, ['invite1@example.com', 'invite2@example.com']);
  assert.equal(r.invitation.programmee_le, futur);
  const id = r.invitation.id;
  assert.equal((await admin.post('invitations.php', { action: 'enregistrer', objet: 'X', message: 'Y', adresses: ['a@example.com'], programmee_le: '2000-01-01 09:00' })).erreur, 'passe');
  assert.equal((await admin.post('invitations.php', { action: 'enregistrer', objet: 'X', message: 'Y', adresses: ['pas-une-adresse'] })).erreur, 'adresses');

  // Modification : même invitation
  r = await admin.post('invitations.php', { action: 'enregistrer', id, objet: 'Invitation modifiée', message: 'Venez !', adresses: ['invite1@example.com'], programmee_le: '' });
  assert.equal(r.invitation.id, id);
  assert.equal(r.invitation.programmee_le, null);

  // Envoi immédiat
  const avant = readFileSync(mailFile, 'utf-8').length;
  r = await admin.post('invitations.php', { action: 'envoyer', id, objet: 'Invitation modifiée', message: 'Venez !', adresses: ['invite1@example.com'] });
  assert.equal(r.invitation.envoyes, 1);
  assert.ok(r.invitation.envoyee_le);
  assert.match(readFileSync(mailFile, 'utf-8').slice(avant), /To: invite1@example\.com/);
  // Invitation envoyée : une modification crée une nouvelle invitation
  r = await admin.post('invitations.php', { action: 'enregistrer', id, objet: 'Copie', message: 'Venez !', adresses: ['invite1@example.com'] });
  assert.notEqual(r.invitation.id, id);

  // Envoi programmé arrivé à échéance : script de la tâche planifiée
  const { DatabaseSync } = await import('node:sqlite').catch(() => ({}));
  if (DatabaseSync) {
    const bd = new DatabaseSync(join(tmp, 'cami.sqlite'));
    bd.prepare("UPDATE invitations SET programmee_le = '2000-01-01 09:00' WHERE id = ?").run(r.invitation.id);
    bd.close();
    const sortie = spawnSync('php', ['-d', `sendmail_path=cat >> ${mailFile}`, join(DIST, 'api', '_taches.php')], { env: { ...process.env, CAMI_DB: join(tmp, 'cami.sqlite') }, encoding: 'utf-8' });
    assert.match(sortie.stdout, /invitations programmées : 1/);
    const l = (await (await admin.get('/api/invitations.php')).json()).invitations;
    assert.ok(l.find((i) => i.id === r.invitation.id).envoyee_le);
  }

  r = await admin.post('invitations.php', { action: 'supprimer', id });
  assert.equal(r.ok, true);
  assert.equal((await (await admin.get('/api/invitations.php')).json()).invitations.some((i) => i.id === id), false);
  // Script de la tâche planifiée : inaccessible par le web
  assert.equal((await client().get('/api/_taches.php')).status, 404);
});
