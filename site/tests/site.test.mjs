// Tests du site construit (dist/). Lancer avec : npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync, readdirSync, statSync, mkdtempSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { spawn, spawnSync } from 'node:child_process';

const DIST = join(dirname(fileURLToPath(import.meta.url)), '..', 'dist');

function htmlFiles(dir = DIST) {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return htmlFiles(path);
    return name.endsWith('.html') ? [path] : [];
  });
}

function resolveLocal(href) {
  const path = decodeURIComponent(href.split(/[?#]/)[0]);
  if (path.endsWith('/')) return join(DIST, path, 'index.html');
  return join(DIST, path);
}

const PAGES = ['/', '/jeudis-analyse/', '/jeudis-analyse/detail/', '/cours-particuliers/', '/pedagogue/', '/contact/', '/contact/merci/', '/contact/erreur/', '/table-analyse/'];

test('toutes les pages attendues sont construites', () => {
  for (const page of PAGES) assert.ok(existsSync(resolveLocal(page)), `page manquante : ${page}`);
  assert.ok(existsSync(join(DIST, '404.html')));
  assert.ok(existsSync(join(DIST, 'contact.php')));
  assert.ok(existsSync(join(DIST, 'telechargement.php')));
  assert.ok(existsSync(join(DIST, '.htaccess')));
  for (const api of ['_cami', 'moi', 'etat', 'compte', 'confirmer', 'presence', 'seance']) {
    assert.ok(existsSync(join(DIST, 'api', `${api}.php`)), `api manquante : ${api}`);
  }
});

test('aucun lien interne cassé', () => {
  const casses = [];
  for (const file of htmlFiles()) {
    const html = readFileSync(file, 'utf-8');
    for (const [, href] of html.matchAll(/(?:href|src|action)="(\/[^"]*)"/g)) {
      if (!existsSync(resolveLocal(href))) casses.push(`${file.replace(DIST, '')} → ${href}`);
    }
  }
  assert.deepEqual(casses, []);
});

test('chaque page a un titre, une langue et un pied de page', () => {
  for (const file of htmlFiles()) {
    const html = readFileSync(file, 'utf-8');
    assert.match(html, /<html lang="fr">/, file);
    assert.match(html, /<title>[^<]+<\/title>/, file);
    if (!file.endsWith(`${DIST}/index.html`)) assert.match(html, /<footer class="row site">/, file);
  }
});

test('aucun appel à Google Fonts', () => {
  for (const file of htmlFiles()) {
    assert.doesNotMatch(readFileSync(file, 'utf-8'), /fonts\.googleapis|fonts\.gstatic/, file);
  }
});

test('formulaire de contact : champs, cible et champ piège', () => {
  const html = readFileSync(resolveLocal('/contact/'), 'utf-8');
  assert.match(html, /<form class="contact-form" method="post" action="\/contact\.php">/);
  for (const name of ['nom', 'email', 'objet', 'message', 'site_web']) {
    assert.match(html, new RegExp(`name="${name}"`), `champ manquant : ${name}`);
  }
  for (const objet of ['renseignements', 'jeudis', 'cours']) {
    assert.match(html, new RegExp(`<option value="${objet}"`));
  }
  assert.match(html, /class="piege" aria-hidden="true"/);
});

test('les pages Jeudis et Cours préremplissent l’objet du contact', () => {
  assert.match(readFileSync(resolveLocal('/jeudis-analyse/'), 'utf-8'), /href="\/contact\/\?objet=jeudis"/);
  assert.match(readFileSync(resolveLocal('/jeudis-analyse/detail/'), 'utf-8'), /href="\/contact\/\?objet=jeudis"/);
  assert.match(readFileSync(resolveLocal('/cours-particuliers/'), 'utf-8'), /href="\/contact\/\?objet=cours"/);
});

test('le contenu AsciiDoc est converti (sous-dossier compris)', () => {
  const html = readFileSync(resolveLocal('/jeudis-analyse/detail/'), 'utf-8');
  assert.match(html, /<h1 class="row titre-page">Les Jeudis de l’Analyse \(musicale\)<\/h1>/);
  assert.match(html, /<h2 id="[^"]*">C’est quand \?<\/h2>/);
  assert.doesNotMatch(html, /^== /m);
});

test('accueil : contenu AsciiDoc, blocs, sans pied de page', () => {
  const html = readFileSync(resolveLocal('/'), 'utf-8');
  assert.match(html, /<h1 class="row titre-page">Cours d’Analyse Musicale<\/h1>/);
  assert.match(html, /class="ulist blocs"/);
  assert.match(html, /href="\/jeudis-analyse\/"/);
  assert.doesNotMatch(html, /<footer/);
  assert.ok(!existsSync(resolveLocal('/accueil/')));
});

test('page calendrier : structure et lien vers le détail', () => {
  const html = readFileSync(resolveLocal('/jeudis-analyse/'), 'utf-8');
  assert.match(html, /<h1 class="titre-page">Les jeudis de l’analyse<\/h1>/);
  assert.match(html, /Session d’analyses musicales en direct/);
  for (const id of ['cal', 'detail', 'barreCompte', 'formConnexion', 'formInscription']) assert.match(html, new RegExp(`id="${id}"`));
  assert.match(html, /<a href="\/jeudis-analyse\/detail\/">Détail des jeudis de l’analyse<\/a>/);
  assert.match(html, /<select name="genre">/);
  for (const g of ['F', 'H', 'N']) assert.match(html, new RegExp(`<option value="${g}"`));
});

// --- Script PHP du formulaire (ignoré si PHP n'est pas utilisable) ---

const phpOk = spawnSync('php', ['-v']).status === 0;

async function posterContact(champs) {
  const tmp = mkdtempSync(join(tmpdir(), 'cami-'));
  const mailFile = join(tmp, 'mail.txt');
  const port = 8800 + Math.floor(Math.random() * 100);
  const server = spawn('php', ['-d', `sendmail_path=cat >> ${mailFile}`, '-S', `127.0.0.1:${port}`, '-t', DIST], { stdio: 'ignore' });
  try {
    for (let i = 0; i < 50; i++) {
      try { await fetch(`http://127.0.0.1:${port}/robots.txt`); break; } catch { await new Promise((r) => setTimeout(r, 100)); }
    }
    const res = await fetch(`http://127.0.0.1:${port}/contact.php`, {
      method: 'POST',
      body: new URLSearchParams(champs),
      redirect: 'manual',
    });
    const mail = existsSync(mailFile) ? readFileSync(mailFile, 'utf-8') : '';
    return { status: res.status, location: res.headers.get('location'), mail };
  } finally {
    server.kill();
  }
}

const valide = { nom: 'Jean Test', email: 'jean@example.com', objet: 'jeudis', message: 'Bonjour', site_web: '' };

test('contact.php : message valide envoyé', { skip: !phpOk && 'PHP indisponible' }, async () => {
  const r = await posterContact(valide);
  assert.equal(r.status, 303);
  assert.equal(r.location, '/contact/merci/');
  assert.match(r.mail, /To: philippe\.perret@analyse-musicale\.fr/);
  assert.match(r.mail, /Reply-To: jean@example\.com/);
  assert.match(r.mail, /Bonjour/);
});

test('contact.php : champ piège rempli → rien envoyé', { skip: !phpOk && 'PHP indisponible' }, async () => {
  const r = await posterContact({ ...valide, site_web: 'http://spam' });
  assert.equal(r.location, '/contact/merci/');
  assert.equal(r.mail, '');
});

test('contact.php : e-mail invalide → erreur', { skip: !phpOk && 'PHP indisponible' }, async () => {
  const r = await posterContact({ ...valide, email: 'pas-un-mail\r\nBcc: x@y.z' });
  assert.equal(r.location, '/contact/erreur/');
  assert.equal(r.mail, '');
});
