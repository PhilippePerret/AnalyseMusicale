// Tests de l'API des jeudis (dist/api/*.php) avec une base SQLite temporaire.
// Ignorés si PHP n'est pas disponible.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync, mkdtempSync, writeFileSync, readdirSync } from 'node:fs';
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
  let r = await admin.post('invitations.php', { action: 'enregistrer', objet: 'Invitation', message: 'Venez !', adresses: [{ email: 'Invite1@Example.com', genre: 'f' }, { email: 'invite1@example.com', genre: 'F' }, { email: 'invite2@example.com', genre: 'H' }], programmee_le: futur });
  assert.equal(r.ok, true);
  assert.deepEqual(r.invitation.adresses, [{ email: 'invite1@example.com', genre: 'F' }, { email: 'invite2@example.com', genre: 'H' }]);
  assert.equal(r.invitation.programmee_le, futur);
  const id = r.invitation.id;
  assert.equal((await admin.post('invitations.php', { action: 'enregistrer', objet: 'X', message: 'Y', adresses: [{ email: 'a@example.com', genre: 'H' }], programmee_le: '2000-01-01 09:00' })).erreur, 'passe');
  assert.equal((await admin.post('invitations.php', { action: 'enregistrer', objet: 'X', message: 'Y', adresses: [{ email: 'a@example.com' }] })).erreur, 'adresses');
  assert.equal((await admin.post('invitations.php', { action: 'enregistrer', objet: 'X', message: 'Y', adresses: [{ email: 'pas-une-adresse', genre: 'H' }] })).erreur, 'adresses');

  // Modification : même invitation
  r = await admin.post('invitations.php', { action: 'enregistrer', id, objet: 'Invitation modifiée', message: 'Ch[er|ère] ami[|e], venez !', adresses: [{ email: 'invite1@example.com', genre: 'F' }], programmee_le: '' });
  assert.equal(r.invitation.id, id);
  assert.equal(r.invitation.programmee_le, null);

  // Envoi immédiat
  const avant = readFileSync(mailFile, 'utf-8').length;
  r = await admin.post('invitations.php', { action: 'envoyer', id, objet: 'Invitation modifiée', message: 'Ch[er|ère] ami[|e], venez !', adresses: [{ email: 'invite1@example.com', genre: 'F' }] });
  assert.equal(r.invitation.envoyes, 1);
  assert.ok(r.invitation.envoyee_le);
  assert.match(readFileSync(mailFile, 'utf-8').slice(avant), /To: invite1@example\.com/);
  assert.match(readFileSync(mailFile, 'utf-8').slice(avant), /Chère amie, venez !/);
  // Sauvegarde de l'invitation envoyée
  const sauvegardes = readdirSync(join(tmp, 'sauvegardes', 'invitations'));
  assert.ok(sauvegardes.some((f) => new RegExp(`^${id}-\\d{4}-\\d{2}-\\d{2}-\\d{6}\\.json$`).test(f)));
  // Copie systématique à l'administrateur
  assert.match(readFileSync(mailFile, 'utf-8').slice(avant), /To: philippe\.perret@analyse-musicale\.fr[\s\S]*\[Copie\]/);
  assert.deepEqual(r.invitation.adresses, []);
  assert.deepEqual(r.invitation.invites.map((d) => d.email), ['invite1@example.com']);

  // Invitation envoyée : même invitation, nouvelles adresses ; adresse administrateur jamais mémorisée
  r = await admin.post('invitations.php', { action: 'envoyer', id, objet: 'Invitation modifiée', message: 'Ch[er|ère] ami[|e], venez !', adresses: [{ email: 'invite3@example.com', genre: 'H' }, { email: 'Philippe.Perret@analyse-musicale.fr', genre: 'H' }] });
  assert.equal(r.invitation.id, id);
  assert.equal(r.invitation.envoyes, 1);
  assert.deepEqual(r.invitation.invites.map((d) => d.email).sort(), ['invite1@example.com', 'invite3@example.com']);
  // Envoi sans adresse : refusé ; enregistrement du seul texte : accepté
  assert.equal((await admin.post('invitations.php', { action: 'envoyer', id, objet: 'X', message: 'Y', adresses: [] })).erreur, 'adresses');
  assert.equal((await admin.post('invitations.php', { action: 'enregistrer', id, objet: 'Invitation modifiée', message: 'Ch[er|ère] ami[|e], venez !', adresses: [] })).invitation.id, id);
  // Nouvelle invitation demandée explicitement
  r = await admin.post('invitations.php', { action: 'enregistrer', id, nouvelle: true, objet: 'Copie', message: 'Venez !', adresses: [{ email: 'invite1@example.com', genre: 'F' }] });
  assert.notEqual(r.invitation.id, id);

  // Envoi programmé arrivé à échéance : script de la tâche planifiée
  const { DatabaseSync } = await import('node:sqlite').catch(() => ({}));
  if (DatabaseSync) {
    const bd = new DatabaseSync(join(tmp, 'cami.sqlite'));
    bd.prepare("UPDATE invitations SET programmee_le = '2000-01-01 09:00' WHERE id = ?").run(r.invitation.id);
    const sortie = spawnSync('php', ['-d', `sendmail_path=cat >> ${mailFile}`, join(DIST, 'api', '_taches.php')], { env: { ...process.env, CAMI_DB: join(tmp, 'cami.sqlite') }, encoding: 'utf-8' });
    assert.match(sortie.stdout, /invitations programmées : 1/);
    const l = (await (await admin.get('/api/invitations.php')).json()).invitations;
    assert.ok(l.find((i) => i.id === r.invitation.id).envoyee_le);
    // Invités consignés : une ligne par personne et par invitation envoyée
    const invites = bd.prepare('SELECT email, genre, invitation_id FROM invites WHERE email = ? ORDER BY invitation_id').all('invite1@example.com');
    assert.deepEqual(invites.map((x) => [x.genre, x.invitation_id]), [['F', id], ['F', r.invitation.id]]);
    bd.close();
  }

  r = await admin.post('invitations.php', { action: 'supprimer', id });
  assert.equal(r.ok, true);
  assert.equal((await (await admin.get('/api/invitations.php')).json()).invitations.some((i) => i.id === id), false);
  // Script de la tâche planifiée : inaccessible par le web
  assert.equal((await client().get('/api/_taches.php')).status, 404);
});

test('alertes des directs : 3 jours, 1 jour, 1 heure avant ; refus pour la session ou pour toujours', { skip }, async () => {
  const admin = await adminConnecte();
  const jour = jeudiFutur(6);
  let r = await admin.post('seance.php', { action: 'enregistrer', jour, compositeur: 'Bach', oeuvre: 'Prélude', analyste: '', debut: '19:00', fin: '22:00', youtube: '' });
  assert.equal(r.ok, true);
  await admin.post('personnes.php', { action: 'ajouter', comme: 'contact', email: 'contact-alerte@example.com', pseudo: 'Flo', genre: 'F' });
  const decale = (jours, heure) => { const d = new Date(`${jour}T12:00:00`); d.setDate(d.getDate() + jours); return `${d.toLocaleDateString('sv')} ${heure}`; };
  const taches = (maintenant) => spawnSync('php', ['-d', `sendmail_path=cat >> ${mailFile}`, join(DIST, 'api', '_taches.php')], {
    env: { ...process.env, CAMI_DB: join(tmp, 'cami.sqlite'), CAMI_MAINTENANT: maintenant }, encoding: 'utf-8',
  });
  // Mails reçus depuis `avant`, par destinataire
  const recus = (avant) => readFileSync(mailFile, 'utf-8').slice(avant).split(/(?=^To: )/m).filter((m) => m.startsWith('To: '));
  const pour = (mails, email) => mails.find((m) => m.startsWith(`To: ${email}\r\n`));

  // Rien une semaine avant
  let avant = readFileSync(mailFile, 'utf-8').length;
  taches(decale(-7, '12:00'));
  assert.equal(recus(avant).length, 0);

  // 3 jours avant : tout le monde (inscrits, contacts, invités, téléchargements)
  avant = readFileSync(mailFile, 'utf-8').length;
  taches(decale(-2, '12:00'));
  let mails = recus(avant);
  for (const e of ['membre@example.com', 'contact-alerte@example.com', 'invite1@example.com', 'lecteur@example.com']) assert.ok(pour(mails, e), e);
  const flo = pour(mails, 'contact-alerte@example.com');
  assert.match(flo, /Bonjour Flo,/);
  assert.match(flo, /de 19 h à 22 h/);
  assert.match(flo, /parmi les participantes/);
  assert.match(pour(mails, 'lecteur@example.com'), /Bonjour,\n/);
  // Une seule fois par palier
  avant = readFileSync(mailFile, 'utf-8').length;
  taches(decale(-2, '12:05'));
  assert.equal(recus(avant).length, 0);

  // Refus pour cette session (lien du mail)
  const lienSession = flo.match(/https:\/\/www\.analyse-musicale\.fr(\/api\/alertes\.php\?email=[^\s]+&jour=\d{4}-\d{2}-\d{2}&cle=[0-9a-f]+)/)[1];
  let rep = await client().get(lienSession);
  assert.equal(rep.headers.get('location'), '/jeudis-analyse/?alertes=session');
  assert.equal((await client().get(lienSession.replace(/cle=[0-9a-f]+/, 'cle=' + '0'.repeat(32)))).headers.get('location'), '/jeudis-analyse/?alertes=invalide');
  // Refus pour toujours
  const lienJamais = pour(mails, 'invite1@example.com').match(/https:\/\/www\.analyse-musicale\.fr(\/api\/alertes\.php\?email=[^\s]+&jour=&cle=[0-9a-f]+)/)[1];
  rep = await client().get(lienJamais);
  assert.equal(rep.headers.get('location'), '/jeudis-analyse/?alertes=jamais');

  // 1 jour avant : sans les refus
  avant = readFileSync(mailFile, 'utf-8').length;
  taches(decale(-1, '19:30'));
  mails = recus(avant);
  assert.ok(pour(mails, 'membre@example.com'));
  assert.equal(pour(mails, 'contact-alerte@example.com'), undefined);
  assert.equal(pour(mails, 'invite1@example.com'), undefined);

  // 1 heure avant : sans lien de refus pour la session
  avant = readFileSync(mailFile, 'utf-8').length;
  taches(decale(0, '18:10'));
  mails = recus(avant);
  const dernier = pour(mails, 'membre@example.com');
  assert.ok(dernier);
  assert.doesNotMatch(dernier, /pour cette session/);
  assert.match(dernier, /plus jamais recevoir/);
});

// --- Cours (issue #13) ---

test('cours : élèves, disponibilités, placement, demandes, rendez-vous régulier, délais, rappels', { skip }, async () => {
  const admin = await adminConnecte();
  const cours = async (c) => (await c.get('/api/cours.php')).json();
  const jourDans = (n) => { const d = new Date(); d.setDate(d.getDate() + n); return d.toLocaleDateString('sv'); };
  const J = jourDans(21);

  assert.equal((await cours(client())).acces, false);

  // Disponibilités générales : tous les jours de 9 h à 18 h
  let r = await admin.post('cours.php', { action: 'dispos_enregistrer', semaine: '', creneaux: [1, 2, 3, 4, 5, 6, 7].map((jour) => ({ jour, debut: '09:00', fin: '18:00' })) });
  assert.equal(r.ok, true);
  assert.equal((await admin.post('cours.php', { action: 'dispos_enregistrer', semaine: '', creneaux: [{ jour: 1, debut: '12:00', fin: '10:00' }] })).erreur, 'creneau');

  // Inscription d'un élève : mail avec lien de choix du mot de passe
  r = await admin.post('cours.php', { action: 'eleve_ajouter', email: 'Eleve1@example.com', pseudo: 'Léa', genre: 'F' });
  assert.equal(r.ok, true);
  assert.equal((await admin.post('cours.php', { action: 'eleve_ajouter', email: 'eleve1@example.com' })).erreur, 'existe');
  // Case « Envoyer le mail de bienvenue » décochée : aucun mail (issue #19)
  r = await admin.post('cours.php', { action: 'eleve_ajouter', email: 'sansmail@example.com', bienvenue: false });
  assert.equal(r.ok, true);
  assert.equal(readFileSync(mailFile, 'utf-8').includes('sansmail@example.com'), false);
  assert.equal((await admin.post('cours.php', { action: 'eleve_retirer', id: r.id })).ok, true);
  const jeton = [...readFileSync(mailFile, 'utf-8').matchAll(/cours\/student\/\?jeton=([0-9a-f]{32})/g)].pop()[1];
  assert.match(readFileSync(mailFile, 'utf-8'), /inscrite comme élève/);
  const eleve = client();
  assert.equal((await eleve.post('cours.php', { action: 'definir_mdp', jeton, mdp: 'court' })).erreur, 'mdp');
  assert.equal((await eleve.post('cours.php', { action: 'definir_mdp', jeton, mdp: 'motdepasse' })).ok, true);
  assert.equal((await eleve.post('cours.php', { action: 'definir_mdp', jeton, mdp: 'motdepasse' })).erreur, 'jeton');
  let e = await cours(eleve);
  assert.equal(e.acces, true);
  assert.equal(e.admin, false);
  assert.equal(e.groupes.length, 1);
  assert.deepEqual(e.rappels, [1440, 60]);
  const gid = e.groupes[0].id;

  // Un autre élève : ses cours apparaissent à Léa comme simples créneaux occupés
  await admin.post('cours.php', { action: 'eleve_ajouter', email: 'eleve2@example.com', pseudo: 'Max', genre: 'H' });
  const gMax = (await cours(admin)).groupes.find((g) => g.nom === 'Max').id;
  assert.equal((await admin.post('cours.php', { action: 'cours_enregistrer', groupe: gMax, debut: `${J} 15:00`, duree: 60, oeuvres: 'Secret' })).ok, true);
  e = await cours(eleve);
  assert.equal(e.cours.length, 0);
  assert.deepEqual(e.occupes, [{ debut: `${J} 15:00`, duree: 60 }]);
  assert.equal(JSON.stringify(e).includes('Secret'), false);

  // Case « Informer l'élève de ce cours » : cochée → mail avec lien vers le cours ; décochée → aucun mail
  let avantMail = readFileSync(mailFile, 'utf-8').length;
  r = await admin.post('cours.php', { action: 'cours_enregistrer', groupe: gid, debut: `${J} 09:00`, duree: 30, informer: true });
  assert.equal(r.ok, true);
  assert.match(readFileSync(mailFile, 'utf-8').slice(avantMail), new RegExp(`cours/student/\\?cours=${r.id}`));
  assert.equal((await admin.post('cours.php', { action: 'cours_supprimer', id: r.id })).ok, true);
  avantMail = readFileSync(mailFile, 'utf-8').length;
  r = await admin.post('cours.php', { action: 'cours_enregistrer', groupe: gid, debut: `${J} 09:00`, duree: 30, informer: false });
  assert.equal(r.ok, true);
  assert.equal(readFileSync(mailFile, 'utf-8').slice(avantMail).includes('Nouveau cours'), false);
  assert.equal((await admin.post('cours.php', { action: 'cours_supprimer', id: r.id })).ok, true);

  // Cours accordé (à placer par l'élève)
  r = await admin.post('cours.php', { action: 'cours_enregistrer', groupe: gid, a_placer: true, duree: 60 });
  assert.equal(r.ok, true);
  const accorde = r.id;
  assert.equal((await eleve.post('cours.php', { action: 'placer', id: accorde, debut: `${J} 18:00` })).erreur, 'indisponible');
  assert.equal((await eleve.post('cours.php', { action: 'placer', id: accorde, debut: `${J} 15:30` })).erreur, 'occupe');
  assert.equal((await eleve.post('cours.php', { action: 'placer', id: accorde, debut: `${J} 10:10` })).erreur, 'debut');
  assert.equal((await eleve.post('cours.php', { action: 'placer', id: accorde, debut: `${J} 10:00` })).ok, true);
  e = await cours(eleve);
  assert.equal(e.cours.find((c) => c.id === accorde).statut, 'place');

  // Demande de cours : refusée avec une raison, puis retirée
  r = await eleve.post('cours.php', { action: 'demander', groupe: gid, debut: `${J} 13:00`, duree: 90 });
  assert.equal(r.ok, true);
  assert.equal((await eleve.post('cours.php', { action: 'demander', groupe: gid, debut: `${J} 14:00`, duree: 30 })).erreur, 'occupe');
  assert.equal((await eleve.post('cours.php', { action: 'demander', groupe: gMax, debut: `${J} 16:00`, duree: 30 })).erreur, 'groupe');
  const demande = (await cours(admin)).cours.find((c) => c.statut === 'demande');
  assert.equal((await eleve.post('cours.php', { action: 'demande_repondre', id: demande.id, accepter: true })).erreur, 'action');
  assert.equal((await admin.post('cours.php', { action: 'demande_repondre', id: demande.id, accepter: false, raison: 'Concert ce jour-là' })).ok, true);
  assert.match(readFileSync(mailFile, 'utf-8'), /Raison : Concert ce jour-là/);
  e = await cours(eleve);
  assert.equal(e.cours.find((c) => c.id === demande.id).statut, 'refuse');
  assert.equal((await eleve.post('cours.php', { action: 'annuler', id: demande.id })).ok, true);

  // Demande acceptée
  await eleve.post('cours.php', { action: 'demander', groupe: gid, debut: `${J} 16:00`, duree: 60 });
  const d2 = (await cours(admin)).cours.find((c) => c.statut === 'demande');
  await admin.post('cours.php', { action: 'demande_repondre', id: d2.id, accepter: true });
  assert.equal((await cours(eleve)).cours.find((c) => c.id === d2.id).statut, 'place');

  // Rendez-vous régulier : toutes les semaines pendant 3 semaines → 4 cours ; suppression de la série
  const R = jourDans(40);
  r = await admin.post('cours.php', { action: 'cours_enregistrer', groupe: gid, debut: `${R} 11:00`, duree: 45, recurrence: { frequence: 1, unite: 'semaine', jusqu_au: jourDans(61) } });
  assert.equal(r.nombre, 4);
  const serie = (await cours(eleve)).cours.filter((c) => c.serie);
  assert.equal(serie.length, 4);
  assert.equal(serie[1].debut, `${jourDans(47)} 11:00`);
  assert.equal((await admin.post('cours.php', { action: 'cours_supprimer', id: serie[1].id, serie: true, prevenir: true })).nombre, 3);
  assert.equal((await cours(eleve)).cours.filter((c) => c.serie).length, 1);

  // Moins de 2 jours avant : ni déplacement ni annulation par l'élève
  const demain = (await admin.post('cours.php', { action: 'cours_enregistrer', groupe: gid, debut: `${jourDans(1)} 10:00`, duree: 60 })).id;
  assert.equal((await eleve.post('cours.php', { action: 'deplacer', id: demain, debut: `${J} 11:00` })).erreur, 'delai');
  assert.equal((await eleve.post('cours.php', { action: 'annuler', id: demain })).erreur, 'delai');
  // Plus de 2 jours avant : déplacement possible
  assert.equal((await eleve.post('cours.php', { action: 'deplacer', id: accorde, debut: `${J} 11:00` })).ok, true);

  // Rappels : 1 jour, puis 1 heure avant (une seule fois chacun) ; délais réglés par l'élève
  assert.equal((await eleve.post('cours.php', { action: 'rappels', delais: [60, 1440, 1440] })).ok, true);
  assert.deepEqual((await cours(eleve)).rappels, [1440, 60]);
  const taches = (maintenant) => spawnSync('php', ['-d', `sendmail_path=cat >> ${mailFile}`, join(DIST, 'api', '_taches.php')], {
    env: { ...process.env, CAMI_DB: join(tmp, 'cami.sqlite'), CAMI_MAINTENANT: maintenant }, encoding: 'utf-8',
  });
  const veille = new Date(`${J}T11:00`); veille.setDate(veille.getDate() - 1);
  const rappels = (avant) => readFileSync(mailFile, 'utf-8').slice(avant).split(/(?=^To: )/m)
    .filter((m) => m.startsWith('To: eleve1@example.com') && /Petit rappel/.test(m));
  let avant = readFileSync(mailFile, 'utf-8').length;
  taches(`${veille.toLocaleDateString('sv')} 12:00`);   // 1 jour avant le cours de 11 h
  let recus = rappels(avant);
  assert.ok(recus.length >= 1);
  assert.ok(recus.every((m) => /Bonjour Léa/.test(m)));
  avant = readFileSync(mailFile, 'utf-8').length;
  taches(`${veille.toLocaleDateString('sv')} 12:05`);
  assert.equal(rappels(avant).length, 0);
  avant = readFileSync(mailFile, 'utf-8').length;
  taches(`${J} 10:10`);   // 1 heure avant le cours de 11 h (et 1 jour avant celui de 16 h)
  recus = rappels(avant);
  assert.equal(recus.filter((m) => /de 11 h à 12 h/.test(m)).length, 1);
  assert.equal(recus.filter((m) => /de 16 h à 17 h/.test(m)).length, 1);

  // Liste des élèves (issue #20) : actif par défaut, modification, inactif = aucun accès
  const idLea = (await cours(admin)).eleves.find((x) => x.email === 'eleve1@example.com').id;
  const idMax = (await cours(admin)).eleves.find((x) => x.email === 'eleve2@example.com').id;
  assert.equal((await cours(admin)).eleves.find((x) => x.id === idLea).actif, true);
  assert.equal((await admin.post('cours.php', { action: 'eleve_modifier', id: idLea, email: 'eleve2@example.com', pseudo: 'Léa', genre: 'F' })).erreur, 'email_pris');
  assert.equal((await admin.post('cours.php', { action: 'eleve_modifier', id: idMax, email: 'eleve2@example.com', pseudo: 'Maxime', genre: 'N' })).ok, true);
  const max = (await cours(admin)).eleves.find((x) => x.id === idMax);
  assert.equal(max.pseudo, 'Maxime');
  assert.equal(max.genre, 'N');
  assert.equal((await admin.post('cours.php', { action: 'eleves_actif', ids: [idLea], actif: false })).ok, true);
  assert.equal((await cours(admin)).eleves.find((x) => x.id === idLea).actif, false);
  assert.equal((await cours(eleve)).acces, false);
  assert.equal((await admin.post('cours.php', { action: 'eleves_actif', ids: [idLea], actif: true })).ok, true);
  assert.equal((await cours(eleve)).acces, true);

  // Élève retiré : son groupe solo et ses cours supprimés
  assert.equal((await admin.post('cours.php', { action: 'eleve_retirer', id: idLea })).ok, true);
  const apres = await cours(admin);
  assert.equal(apres.groupes.some((g) => g.id === gid), false);
  assert.equal(apres.cours.some((c) => c.groupe === gid), false);
  assert.equal((await cours(eleve)).acces, false);
});

// --- Mails de l'administrateur depuis /contact/ (mails-types) ---

test('mails-types : refusés à un visiteur, servis à l’administrateur, envoi à une adresse inconnue', { skip }, async () => {
  assert.equal((await client().get('/api/mails.php')).status, 403);
  const admin = await adminConnecte();
  const d = await (await admin.get('/api/mails.php')).json();
  const t = d.types.find((x) => x.id === 'reponse-demande-cours');
  assert.ok(t && t.corps.includes('{if notions}'));
  assert.match(d.variables['url-cours'], /\/cours\/$/);
  assert.equal((await admin.post('mails.php', { email: 'pasuneadresse', objet: 'x', message: 'y' })).erreur, 'email');
  const r = await admin.post('mails.php', { email: 'inconnu@example.com', objet: 'Cours', message: 'Bonjour Paul,' });
  assert.equal(r.ok, true);
  const mails = readFileSync(mailFile, 'utf-8');
  assert.match(mails, /To: inconnu@example\.com/);
  assert.match(mails, /Envoyé à : inconnu@example\.com/);
});

// --- Demandes de cours (/cours/demande/) ---

test('demande de cours : enregistrée, transmise à l’administrateur seulement après confirmation de l’adresse', { skip }, async () => {
  const visiteur = client();
  const niveaux = { generales: 'bonnes', gammes: 'moyennes', harmonie: 'aucune', contrepoint: 'aucune', analyse: 'excellentes' };
  const creneaux = [{ jour: 2, debut: '08:00', fin: '13:00' }, { jour: 4, debut: '14:30', fin: '16:00' }];
  const base0 = { nom: 'Paul Martin', email: 'paul@example.com', frequence: 'quinzaine', creneaux, niveaux };
  assert.equal((await visiteur.post('demande-cours.php', { ...base0, creneaux: [] })).erreur, 'creneaux');
  assert.equal((await visiteur.post('demande-cours.php', { ...base0, creneaux: [{ jour: 2, debut: '07:00', fin: '09:00' }] })).erreur, 'creneau');
  assert.equal((await visiteur.post('demande-cours.php', { ...base0, niveaux: { generales: 'bonnes' } })).erreur, 'niveaux');
  assert.equal((await visiteur.post('demande-cours.php', { ...base0, frequence: 'x' })).erreur, 'frequence');

  const avant = readFileSync(mailFile, 'utf-8').length;
  assert.equal((await visiteur.post('demande-cours.php', base0)).ok, true);
  let mails = readFileSync(mailFile, 'utf-8').slice(avant);
  assert.match(mails, /To: paul@example\.com/);
  assert.match(mails, /seulement apr/);
  assert.doesNotMatch(mails, /To: philippe\.perret@/);
  const jeton = mails.match(/demande-cours\.php\?jeton=([0-9a-f]{32})/)[1];

  const admin = await adminConnecte();
  let d = (await (await admin.get('/api/cours.php')).json()).demandes.find((x) => x.email === 'paul@example.com');
  assert.equal(d.confirmee_le, null);
  assert.equal(d.creneaux.length, 2);

  const rep = await visiteur.get(`/api/demande-cours.php?jeton=${jeton}`);
  assert.match(rep.headers.get('location'), /confirmation=ok/);
  mails = readFileSync(mailFile, 'utf-8').slice(avant);
  assert.match(mails, /To: philippe\.perret@analyse-musicale\.fr[\s\S]*Reply-To: paul@example\.com/);
  assert.match(mails, /1\. le mardi entre 8 h et 13 h/);
  assert.match(mails, /en harmonie : Aucune/);
  assert.match((await visiteur.get(`/api/demande-cours.php?jeton=${jeton}`)).headers.get('location'), /confirmation=invalide/);

  d = (await (await admin.get('/api/cours.php')).json()).demandes.find((x) => x.email === 'paul@example.com');
  assert.ok(d.confirmee_le);
  assert.equal((await admin.post('cours.php', { action: 'demande_cours_supprimer', id: d.id })).ok, true);
  assert.equal((await (await admin.get('/api/cours.php')).json()).demandes.length, 0);
});

test('annonce Facebook : groupes, programmation, avis, clé du Mac, publications, répétition', { skip }, async () => {
  const cle = 'c'.repeat(40);
  writeFileSync(join(tmp, 'annonces-fb.key'), cle);
  const mac = async (donnees) => {
    const rep = await fetch(`${base}/api/annonces-fb.php`, donnees
      ? { method: 'POST', headers: { 'X-Cami-Cle': cle, 'Content-Type': 'application/json' }, body: JSON.stringify(donnees) }
      : { headers: { 'X-Cami-Cle': cle } });
    return rep.json();
  };
  const taches = (maintenant) => spawnSync('php', ['-d', `sendmail_path=cat >> ${mailFile}`, join(DIST, 'api', '_taches.php')], {
    env: { ...process.env, CAMI_DB: join(tmp, 'cami.sqlite'), CAMI_MAINTENANT: maintenant }, encoding: 'utf-8',
  });

  // Accès : administrateur ou clé du Mac
  assert.equal((await client().get('/api/annonces-fb.php')).status, 403);
  assert.equal((await fetch(`${base}/api/annonces-fb.php`, { headers: { 'X-Cami-Cle': 'x'.repeat(40) } })).status, 403);
  const admin = await adminConnecte();

  // Groupes : nom et URL requis, URL normalisée, pas de doublon
  assert.equal((await admin.post('annonces-fb.php', { action: 'ajouter', nom: '', url: 'https://www.facebook.com/groups/abc' })).erreur, 'nom');
  assert.equal((await admin.post('annonces-fb.php', { action: 'ajouter', nom: 'X', url: 'https://example.com/groups/abc' })).erreur, 'url');
  let r = await admin.post('annonces-fb.php', { action: 'ajouter', nom: 'Musiciens', url: 'facebook.com/groups/musiciens?ref=share' });
  assert.equal(r.groupes[0].url, 'https://www.facebook.com/groups/musiciens/');
  assert.equal(r.groupes[0].etat, 'a_verifier');
  assert.equal((await admin.post('annonces-fb.php', { action: 'ajouter', nom: 'Bis', url: 'https://m.facebook.com/groups/musiciens/' })).erreur, 'existe');
  r = await admin.post('annonces-fb.php', { action: 'ajouter', nom: 'Harmonie', url: 'https://www.facebook.com/groups/harmonie' });
  const [harmonie, musiciens] = r.groupes;

  // Rien de dû : le Mac n'a que des vérifications
  let t = await mac();
  assert.equal(t.publier.length, 0);
  assert.equal(t.verifier.length, 2);
  assert.equal((await mac({ groupe: harmonie.id, verification: 'existant' })).ok, true);
  assert.equal((await mac({ groupe: musiciens.id, verification: 'existant' })).ok, true);

  // Programmation : texte requis, date future, répétition valide
  const annonce = { action: 'enregistrer', texte: 'Jeudi : Bach.\nhttps://www.analyse-musicale.fr/', mode: 'date', programmee_le: '2099-01-05 10:00', repeter: true, repeter_n: 1, repeter_unite: 'semaines', repeter_fois: 2 };
  assert.equal((await admin.post('annonces-fb.php', { ...annonce, texte: ' ' })).erreur, 'texte');
  assert.equal((await admin.post('annonces-fb.php', { ...annonce, programmee_le: '2000-01-01 10:00' })).erreur, 'passe');
  assert.equal((await admin.post('annonces-fb.php', { ...annonce, repeter_fois: 1 })).erreur, 'repetition');
  r = await admin.post('annonces-fb.php', annonce);
  assert.equal(r.annonce.echeance, '2099-01-05 10:00');
  assert.equal((await mac()).a_faire, 0);

  // Échéance arrivée : un seul mail d'avis
  let avant = readFileSync(mailFile, 'utf-8').length;
  taches('2099-01-05 09:55');
  assert.doesNotMatch(readFileSync(mailFile, 'utf-8').slice(avant), /Annonce Facebook/);
  taches('2099-01-05 10:00');
  taches('2099-01-05 10:05');
  const avis = readFileSync(mailFile, 'utf-8').slice(avant).match(/To: philippe\.perret@analyse-musicale\.fr[^]*?SuperBoard/g);
  assert.equal(avis.length, 1);
  assert.match(avis[0], /Vous devez envoyer le message aux groupes Facebook\. Bouton "Informer les groupes FB" sur SuperBoard/);
});

test('annonce Facebook : au prochain clic, publications, échec retenté, répétition', { skip }, async () => {
  const cle = 'c'.repeat(40);
  const mac = async (donnees) => (await fetch(`${base}/api/annonces-fb.php`, donnees
    ? { method: 'POST', headers: { 'X-Cami-Cle': cle, 'Content-Type': 'application/json' }, body: JSON.stringify(donnees) }
    : { headers: { 'X-Cami-Cle': cle } })).json();
  const admin = await adminConnecte();
  let r = await (await admin.get('/api/annonces-fb.php')).json();
  const [harmonie, musiciens] = r.groupes;

  r = await admin.post('annonces-fb.php', { action: 'enregistrer', texte: 'Annonce', mode: 'clic', repeter: true, repeter_n: 2, repeter_unite: 'jours', repeter_fois: 2 });
  const echeance = r.annonce.echeance;
  assert.ok(echeance);
  let t = await mac();
  assert.equal(t.texte, 'Annonce');
  assert.deepEqual(t.publier.map((g) => g.id).sort(), [harmonie.id, musiciens.id].sort());

  // Échec : retenté au clic suivant, signalé sur la page
  await mac({ groupe: harmonie.id, publication: 'ok' });
  await mac({ groupe: musiciens.id, publication: 'echec', detail: 'bouton Publier absent' });
  t = await mac();
  assert.deepEqual(t.publier.map((g) => g.id), [musiciens.id]);
  r = await (await admin.get('/api/annonces-fb.php')).json();
  assert.equal(r.echecs[0].detail, 'bouton Publier absent');

  // Tout publié : échéance suivante (2 jours plus tard), envoi 2 sur 2
  await mac({ groupe: musiciens.id, publication: 'ok' });
  r = await (await admin.get('/api/annonces-fb.php')).json();
  const suivante = new Date(`${echeance.replace(' ', 'T')}:00`);
  suivante.setDate(suivante.getDate() + 2);
  assert.equal(r.annonce.echeance.slice(0, 10), suivante.toLocaleDateString('sv'));
  assert.equal(Number(r.annonce.numero), 2);
  assert.equal(Number(r.annonce.dernier_envoi_groupes), 2);
  assert.equal((await mac()).a_faire, 0);

  // Texte seul modifié : cycle conservé ; groupe décoché : hors envoi ; suppression
  r = await admin.post('annonces-fb.php', { action: 'enregistrer', texte: 'Annonce corrigée', mode: 'clic', repeter: true, repeter_n: 2, repeter_unite: 'jours', repeter_fois: 2 });
  assert.equal(Number(r.annonce.numero), 2);
  r = await admin.post('annonces-fb.php', { action: 'cocher', id: harmonie.id, coche: false });
  assert.equal(Number(r.groupes.find((g) => g.id === harmonie.id).coche), 0);
  r = await admin.post('annonces-fb.php', { action: 'supprimer', id: harmonie.id });
  assert.equal(r.groupes.length, 1);
  assert.equal((await mac({ groupe: harmonie.id, verification: 'existant' })).ok, false);
});
