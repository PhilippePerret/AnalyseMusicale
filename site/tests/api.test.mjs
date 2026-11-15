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
  const r = await c.post('compte.php', { action: 'inscription', email, mdp: 'motdepasse', genre: 'F', avertir: true, ...extra });
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

  const autre = jeudiFutur(5);
  await admin.post('seance.php', { action: 'enregistrer', jour: autre, debut: '19:00', fin: '22:00' });
  r = await admin.post('seance.php', { action: 'supprimer', jour: autre });
  assert.equal(r.ok, true);
  assert.equal((await admin.etat()).seances[autre], undefined);
});

test('inscription avec présence en attente → présence enregistrée à la confirmation', { skip }, async () => {
  const c = client();
  const r = await c.post('compte.php', { action: 'inscription', email: 'auditrice@example.com', mdp: 'motdepasse', genre: 'F', jour: JOUR });
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
  assert.equal((await c.post('compte.php', { action: 'inscription', email: 'membre@example.com', mdp: 'motdepasse' })).erreur, 'existe');
  const avant = readFileSync(mailFile, 'utf-8').length;
  assert.equal((await c.post('compte.php', { action: 'inscription', email: 'robot@example.com', mdp: 'motdepasse', site_web: 'x' })).ok, true);
  assert.equal(readFileSync(mailFile, 'utf-8').length, avant);
});
