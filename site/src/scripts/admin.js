// Page /admin/ : adresses connues du site (API /api/personnes.php, administrateur seulement).

const API = '/api/personnes.php';
const $ = (id) => document.getElementById(id);
const GENRES = { F: 'femme', H: 'homme', N: 'discret' };
const ERREURS = {
  email: 'Adresse e-mail invalide.',
  existe: 'Cette adresse est déjà inscrite.',
  version: 'Version invalide (ex. 2.1.6).',
  date: 'Date invalide.',
  systeme: 'Plateforme invalide.',
  message: 'Objet et message requis.',
  piece: 'Pièce jointe refusée (15 Mo au plus).',
  admin: 'Session expirée : identifiez-vous de nouveau.',
};

let personnes = [];
let aSupprimer = [];

// « 2026-11-20 14:05:00 » → « 20/11/2026 »
const date = (d) => (d ? d.slice(0, 10).split('-').reverse().join('/') : '');

function el(tag, classe, texte) {
  const e = document.createElement(tag);
  if (classe) e.className = classe;
  if (texte != null) e.textContent = texte;
  return e;
}

function origines(p) {
  const o = [];
  if (p.telechargements.some((t) => t.telecharge_le)) o.push('telechargement');
  if (p.inscription && p.inscription.source === 'site') o.push('inscrit');
  if (p.inscription?.source === 'main' || p.telechargements.some((t) => t.source === 'main')) o.push('main');
  return o;
}

function ligne(p) {
  const tr = el('tr');
  const caseTd = el('td', 'case');
  const caseInput = el('input');
  caseInput.type = 'checkbox';
  caseInput.value = p.email;
  caseTd.append(caseInput);
  tr.append(caseTd, el('td', 'email', p.email));

  const tdOrigine = el('td', 'origine');
  const telechargees = p.telechargements.filter((t) => t.telecharge_le);
  if (telechargees.length) tdOrigine.append(el('span', 'badge ta', 'Table d’analyse'));
  else if (p.telechargements.length) tdOrigine.append(el('span', 'badge attente', 'lien non utilisé'));
  if (p.inscription) {
    const i = p.inscription;
    if (i.source === 'main') tdOrigine.append(el('span', 'badge main', 'inscrit (saisie)'));
    else tdOrigine.append(el('span', i.confirme ? 'badge inscrit' : 'badge attente', i.confirme ? 'inscrit' : 'inscription non confirmée'));
  }
  tr.append(tdOrigine);

  const tdDetail = el('td', 'detail');
  p.telechargements.forEach((t) => {
    const texte = `${t.systeme} ${t.version}`.trim() + ' — ' + (t.telecharge_le ? date(t.telecharge_le) : `demandé le ${date(t.le)}`) + (t.source === 'main' ? ' (saisie)' : '');
    tdDetail.append(el('div', t.telecharge_le ? '' : 'attente', texte));
  });
  if (p.inscription) {
    const i = p.inscription;
    const parties = [i.pseudo, GENRES[i.genre], i.avertir && 'à avertir', i.auditeur && 'auditeur libre', `depuis le ${date(i.le)}`].filter(Boolean);
    tdDetail.append(el('div', '', parties.join(' · ')));
  }
  tr.append(tdDetail);
  return tr;
}

function afficher() {
  const filtre = $('filtre').value;
  const visibles = personnes.filter((p) => !filtre || origines(p).includes(filtre));
  $('lignes').replaceChildren(...visibles.map(ligne));
  $('compte').textContent = `${visibles.length} adresse${visibles.length > 1 ? 's' : ''}`;
  $('toutes').checked = false;
  majSelection();
}

const selection = () => [...document.querySelectorAll('#lignes input:checked')].map((c) => c.value);

function majSelection() {
  const n = selection().length;
  $('ouvrirMessage').disabled = n === 0;
  $('ouvrirSuppression').disabled = n === 0;
  fermerPanneaux();
}

function fermerPanneaux() {
  $('formMessage').hidden = true;
  $('panneauSuppression').hidden = true;
}

function message(zone, texte, ok = false) {
  const m = zone.querySelector('.message');
  m.textContent = texte;
  m.classList.toggle('ok', ok);
  m.hidden = !texte;
}

const nombre = (n) => `${n} adresse${n > 1 ? 's' : ''}`;

async function charger() {
  const r = await fetch(API, { credentials: 'same-origin' });
  if (r.status === 403) {
    $('acces').hidden = false;
    $('contenu').hidden = true;
    return;
  }
  personnes = (await r.json()).personnes;
  $('contenu').hidden = false;
  afficher();
}

async function poster(donnees) {
  const r = await fetch(API, {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'X-Cami': '1', ...(donnees instanceof FormData ? {} : { 'Content-Type': 'application/json' }) },
    body: donnees instanceof FormData ? donnees : JSON.stringify(donnees),
  });
  return r.json();
}

$('filtre').addEventListener('change', afficher);
$('toutes').addEventListener('change', (e) => {
  document.querySelectorAll('#lignes input[type=checkbox]').forEach((c) => { c.checked = e.target.checked; });
  majSelection();
});
$('lignes').addEventListener('change', majSelection);
document.querySelectorAll('.panneau .annuler').forEach((b) => b.addEventListener('click', fermerPanneaux));

// Message à la sélection
$('ouvrirMessage').addEventListener('click', () => {
  fermerPanneaux();
  const f = $('formMessage');
  f.querySelector('.nombre').textContent = nombre(selection().length);
  message(f, '');
  f.hidden = false;
  f.elements.objet.focus();
});
$('formMessage').addEventListener('submit', async (e) => {
  e.preventDefault();
  const f = e.target;
  const donnees = new FormData(f);
  donnees.append('action', 'envoyer');
  donnees.append('emails', JSON.stringify(selection()));
  const bouton = f.querySelector('button:not(.annuler)');
  bouton.disabled = true;
  try {
    const r = await poster(donnees);
    if (!r.ok) return message(f, ERREURS[r.erreur] || 'Envoi impossible.');
    message(f, `Message envoyé à ${nombre(r.envoyes)}.` + (r.echecs.length ? ` Échec : ${r.echecs.join(', ')}.` : ''), r.echecs.length === 0);
    if (!r.echecs.length) f.reset();
  } catch {
    message(f, 'Envoi impossible (pièce jointe trop lourde ?).');
  } finally {
    bouton.disabled = false;
  }
});

// Suppression : panneau de confirmation séparé
$('ouvrirSuppression').addEventListener('click', () => {
  fermerPanneaux();
  const p = $('panneauSuppression');
  // Adresses administrateur exclues (jamais supprimées)
  const admins = personnes.filter((x) => x.admin).map((x) => x.email);
  aSupprimer = selection().filter((e) => !admins.includes(e));
  p.querySelector('.nombre').textContent = nombre(aSupprimer.length);
  p.querySelector('.liste').textContent = aSupprimer.join(', ');
  p.querySelector('.confirmer').hidden = aSupprimer.length === 0;
  message(p, '');
  p.hidden = false;
});
$('panneauSuppression').querySelector('.confirmer').addEventListener('click', async () => {
  const r = await poster({ action: 'supprimer', emails: aSupprimer });
  if (!r.ok) return message($('panneauSuppression'), ERREURS[r.erreur] || 'Suppression impossible.');
  await charger();
});

// Ajout à la main : champs selon « Enregistrer comme… »
const formAjout = $('formAjout');
function majComme() {
  formAjout.querySelectorAll('fieldset').forEach((f) => { f.hidden = f.dataset.comme !== formAjout.elements.comme.value; });
}
formAjout.elements.comme.addEventListener('change', majComme);
formAjout.elements.date.value = new Date().toLocaleDateString('sv');
formAjout.elements.date.max = formAjout.elements.date.value;
formAjout.addEventListener('submit', async (e) => {
  e.preventDefault();
  const el = formAjout.elements;
  const donnees = { action: 'ajouter', comme: el.comme.value, email: el.email.value };
  if (el.comme.value === 'telechargement') Object.assign(donnees, { systeme: el.systeme.value, version: el.version.value, date: el.date.value });
  else Object.assign(donnees, { pseudo: el.pseudo.value, genre: el.genre.value, avertir: el.avertir.checked, auditeur: el.auditeur.checked });
  const r = await poster(donnees);
  if (!r.ok) return message(formAjout, ERREURS[r.erreur] || 'Enregistrement impossible.');
  message(formAjout, `${donnees.email} enregistrée.`, true);
  el.email.value = '';
  el.pseudo.value = '';
  await charger();
});

charger();
