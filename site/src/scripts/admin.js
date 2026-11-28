// Page /admin/ : adresses connues du site (API /api/personnes.php, administrateur seulement).

const API = '/api/personnes.php';
const $ = (id) => document.getElementById(id);
const ERREURS = {
  email: 'Adresse e-mail invalide.',
  existe: 'Cette adresse est déjà enregistrée.',
  genre: 'Genre à préciser.',
  version: 'Version invalide (ex. 2.1.6).',
  date: 'Date invalide.',
  systeme: 'Plateforme invalide.',
  message: 'Objet et message requis.',
  piece: 'Pièce jointe refusée (15 Mo au plus).',
  admin: 'Session expirée : identifiez-vous de nouveau.',
};

let personnes = [];
let aSupprimer = [];

// « 2026-11-20 14:05:00 » → « 20/11/26 »
const date = (d) => (d ? d.slice(2, 10).split('-').reverse().join('/') : '');

function el(tag, classe, texte) {
  const e = document.createElement(tag);
  if (classe) e.className = classe;
  if (texte != null) e.textContent = texte;
  return e;
}

// « Pseudo : flo (F) » ; genre non précisé : non indiqué
function qui(x) {
  return [x.pseudo && `Pseudo : ${x.pseudo}`, x.genre !== 'N' && `(${x.genre})`].filter(Boolean).join(' ');
}

function origines(p) {
  const o = [];
  if (p.telechargements.some((t) => t.telecharge_le)) o.push('telechargement');
  if (p.inscription && p.inscription.source === 'site') o.push('inscrit');
  if (p.contact) o.push('contact');
  if (p.contact || p.inscription?.source === 'main' || p.telechargements.some((t) => t.source === 'main')) o.push('main');
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
  if (telechargees.length) tdOrigine.append(el('span', 'badge ta', 'TbA'));
  else if (p.telechargements.length) tdOrigine.append(el('span', 'badge attente', 'lien non utilisé'));
  if (p.inscription) {
    const i = p.inscription;
    if (i.source === 'main') tdOrigine.append(el('span', 'badge main', 'Ajouté'));
    else tdOrigine.append(el('span', i.confirme ? 'badge inscrit' : 'badge attente', i.confirme ? 'inscrit' : 'inscription non confirmée'));
  }
  if (p.contact) tdOrigine.append(el('span', 'badge main', 'email seul'));
  tr.append(tdOrigine);

  const tdDetail = el('td', 'detail');
  p.telechargements.forEach((t) => {
    const texte = [t.version && `version ${t.version}`, t.systeme, t.telecharge_le ? date(t.telecharge_le) : `demandé le ${date(t.le)}`].filter(Boolean).join(' — ');
    tdDetail.append(el('div', t.telecharge_le ? '' : 'attente', texte));
  });
  if (p.inscription) {
    const i = p.inscription;
    const parties = [qui(i), i.avertir && 'à avertir', i.auditeur && 'auditeur libre', date(i.le)].filter(Boolean);
    tdDetail.append(el('div', '', parties.join(' · ')));
  }
  if (p.contact) tdDetail.append(el('div', '', [qui(p.contact), date(p.contact.le)].filter(Boolean).join(' · ')));
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

// Liste affichée seulement pour l'administrateur identifié ; sinon (ou sans PHP) : message d'accès
async function charger() {
  let reponse = null;
  try {
    const r = await fetch(API, { credentials: 'same-origin' });
    if (r.ok) reponse = await r.json();
  } catch {}
  if (!reponse?.ok) {
    $('acces').hidden = false;
    $('contenu').hidden = true;
    return;
  }
  personnes = reponse.personnes;
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

// Invitations : enregistrées, envoyées tout de suite ou programmées (API /api/invitations.php)
const API_INVITATIONS = '/api/invitations.php';
const dialogInvitation = $('dialogInvitation');
const formInvitation = $('formInvitation');
const choixInvitation = $('choixInvitation');
let invitations = [];
Object.assign(ERREURS, {
  adresses: 'Au moins une ligne « adresse H » ou « adresse F ».',
  programmation: 'Date ou heure d’envoi invalide.',
  passe: 'L’envoi programmé doit être dans le futur.',
});

// « 2026-11-22 09:00 » → « 22/11/26 à 09:00 »
const dateHeure = (d) => `${date(d)} à ${d.slice(11, 16)}`;

function etatInvitation(i) {
  if (!i) return '';
  const etats = [];
  if (i.envoyee_le) etats.push(`Dernier envoi le ${dateHeure(i.envoyee_le)} à ${nombre(i.envoyes ?? 0)}` + (i.echecs.length ? ` (échec : ${i.echecs.join(', ')})` : ''));
  if (i.programmee_le) etats.push(`Prochain envoi programmé le ${dateHeure(i.programmee_le)}`);
  return etats.join(' — ') || 'Enregistrée';
}

function libelleInvitation(i) {
  const quand = i.programmee_le ? `programmée ${dateHeure(i.programmee_le)}` : i.envoyee_le ? `envoyée ${date(i.envoyee_le)}` : 'enregistrée';
  return `${i.objet} — ${quand}`;
}

// Texte d'une invitation (comparaison : même texte = même invitation)
const texteInvitation = (objet, message) => `${objet.trim()}\n${message.trim().replace(/\r\n/g, '\n')}`;
let texteOrigine = '';

async function chargerInvitations(idChoisi = '') {
  const r = await (await fetch(API_INVITATIONS, { credentials: 'same-origin' })).json();
  invitations = r.ok ? r.invitations : [];
  choixInvitation.replaceChildren(new Option('nouvelle invitation', ''), ...invitations.map((i) => new Option(libelleInvitation(i), i.id)));
  choixInvitation.value = String(idChoisi);
  remplirInvitation();
}

const invitationChoisie = () => invitations.find((i) => String(i.id) === choixInvitation.value);

function remplirInvitation() {
  const i = invitationChoisie();
  const el = formInvitation.elements;
  el.objet.value = i?.objet ?? '';
  el.message.value = i?.message ?? '';
  el.adresses.value = (i?.adresses ?? []).map((d) => `${d.email} ${d.genre}`.trim()).join('\n');
  el.date.value = i?.programmee_le ? i.programmee_le.slice(0, 10) : '';
  el.heure.value = i?.programmee_le ? i.programmee_le.slice(11, 16) : '';
  texteOrigine = i ? texteInvitation(i.objet, i.message) : '';
  // Personnes déjà invitées (liste à part)
  const invites = i?.invites ?? [];
  $('invitesInvitation').hidden = !invites.length;
  $('invitesInvitation').querySelector('.titre').textContent = `Déjà invité·es (${invites.length})`;
  $('invitesInvitation').querySelector('ul').replaceChildren(...invites.map((d) => Object.assign(document.createElement('li'), { textContent: `${d.email} ${d.genre}` })));
  $('etatInvitation').textContent = etatInvitation(i);
  $('supprimerInvitation').hidden = !i;
  $('confirmerSuppressionInvitation').hidden = true;
  message(formInvitation, '');
}

// Destinataires saisis : une ligne par personne, « adresse H » ou « adresse F »
function destinatairesSaisis() {
  const destinataires = [];
  const erreurs = [];
  formInvitation.elements.adresses.value.split('\n').map((l) => l.trim()).filter(Boolean).forEach((ligne) => {
    const [email, genre, ...reste] = ligne.split(/\s+/);
    if (reste.length || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email) || !/^[HF]$/i.test(genre || '')) erreurs.push(ligne);
    else if (!destinataires.some((d) => d.email === email.toLowerCase())) destinataires.push({ email: email.toLowerCase(), genre: genre.toUpperCase() });
  });
  return { destinataires, erreurs };
}

async function posterInvitation(action) {
  const el = formInvitation.elements;
  let { destinataires: adresses, erreurs } = destinatairesSaisis();
  if (!el.objet.value.trim() || !el.message.value.trim()) return message(formInvitation, ERREURS.message);
  if (erreurs.length) return message(formInvitation, `Ligne${erreurs.length > 1 ? 's' : ''} invalide${erreurs.length > 1 ? 's' : ''} (format « adresse H » ou « adresse F ») : ${erreurs.join(' ; ')}`);
  if (action === 'enregistrer' && (!el.date.value !== !el.heure.value)) return message(formInvitation, 'Date ET heure requises pour programmer l’envoi.');
  const programmee = action === 'enregistrer' && el.date.value ? `${el.date.value} ${el.heure.value}` : '';
  const envoi = action === 'envoyer' || programmee !== '';
  if (envoi && !adresses.length) return message(formInvitation, ERREURS.adresses);
  // Même invitation ? Invitation choisie dont le texte a changé : modification ou nouvelle invitation ;
  // « nouvelle invitation » au texte identique à une invitation enregistrée : cette invitation.
  const texte = texteInvitation(el.objet.value, el.message.value);
  let cible = invitationChoisie();
  let nouvelle = false;
  if (cible && texte !== texteOrigine) {
    nouvelle = !confirm('Le texte de l’invitation a été modifié.\n\nOK : modifier le texte de cette invitation.\nAnnuler : créer une nouvelle invitation.');
  } else if (!cible) {
    cible = invitations.find((i) => texteInvitation(i.objet, i.message) === texte);
  }
  // Personnes déjà invitées par cette invitation
  if (envoi && cible && !nouvelle) {
    const deja = adresses.filter((d) => cible.invites.some((x) => x.email === d.email));
    if (deja.length && !confirm(`Déjà invité·es par cette invitation :\n${deja.map((d) => d.email).join('\n')}\n\nOK : les inviter de nouveau.\nAnnuler : les retirer de l’envoi.`)) {
      adresses = adresses.filter((d) => !deja.includes(d));
      if (!adresses.length) return message(formInvitation, 'Toutes ces adresses sont déjà invitées : envoi annulé.');
    }
  }
  const donnees = {
    action,
    id: cible?.id,
    nouvelle,
    objet: el.objet.value,
    message: el.message.value,
    adresses,
    programmee_le: programmee,
  };
  const boutons = formInvitation.querySelectorAll('.envois button');
  boutons.forEach((b) => { b.disabled = true; });
  try {
    const r = await (await fetch(API_INVITATIONS, {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'X-Cami': '1', 'Content-Type': 'application/json' },
      body: JSON.stringify(donnees),
    })).json();
    if (!r.ok) return message(formInvitation, ERREURS[r.erreur] || 'Opération impossible.');
    await chargerInvitations(r.invitation.id);
    const i = r.invitation;
    if (action === 'envoyer') message(formInvitation, `Invitation envoyée à ${nombre(i.envoyes ?? 0)}.` + (i.echecs.length ? ` Échec : ${i.echecs.join(', ')}.` : ''), i.echecs.length === 0);
    else message(formInvitation, i.programmee_le ? `Invitation enregistrée, envoi programmé le ${dateHeure(i.programmee_le)}.` : 'Invitation enregistrée.', true);
    return true;
  } catch {
    message(formInvitation, 'Opération impossible.');
  } finally {
    boutons.forEach((b) => { b.disabled = false; });
  }
}

$('ouvrirInvitation').addEventListener('click', async () => {
  await chargerInvitations(choixInvitation.value);
  dialogInvitation.showModal();
  formInvitation.elements.objet.focus();
});
// Fermeture seulement par le bouton « Fermer »
dialogInvitation.addEventListener('cancel', (e) => e.preventDefault());
formInvitation.querySelector('.annuler').addEventListener('click', () => dialogInvitation.close());
choixInvitation.addEventListener('change', remplirInvitation);
$('enregistrerInvitation').addEventListener('click', () => posterInvitation('enregistrer'));
// « Programmer l'envoi le » : contrôle de la date, confirmation, enregistrement et fermeture
$('programmerInvitation').addEventListener('click', async () => {
  const el = formInvitation.elements;
  if (!el.date.value || !el.heure.value) return message(formInvitation, 'Date ET heure requises pour programmer l’envoi.');
  const quand = `${el.date.value} ${el.heure.value}`;
  if (new Date(`${el.date.value}T${el.heure.value}`) <= new Date()) return message(formInvitation, ERREURS.passe);
  if (!confirm(`Programmer l’envoi de cette invitation le ${dateHeure(quand)} ?`)) return;
  if (await posterInvitation('enregistrer')) dialogInvitation.close();
});
formInvitation.addEventListener('submit', (e) => {
  e.preventDefault();
  posterInvitation('envoyer');
});
// Suppression : lien à l'écart, puis confirmation explicite
$('supprimerInvitation').addEventListener('click', () => { $('confirmerSuppressionInvitation').hidden = false; });
$('confirmerSuppressionInvitation').addEventListener('click', async () => {
  const r = await (await fetch(API_INVITATIONS, {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'X-Cami': '1', 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'supprimer', id: choixInvitation.value }),
  })).json();
  if (!r.ok) return message(formInvitation, ERREURS[r.erreur] || 'Suppression impossible.');
  await chargerInvitations();
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
  const comme = formAjout.elements.comme.value;
  formAjout.querySelectorAll('fieldset').forEach((f) => { f.hidden = !f.dataset.comme.split(' ').includes(comme); });
  formAjout.elements.genre.required = comme !== 'telechargement';
}
formAjout.elements.comme.addEventListener('change', majComme);
formAjout.elements.date.value = new Date().toLocaleDateString('sv');
formAjout.elements.date.max = formAjout.elements.date.value;
formAjout.addEventListener('submit', async (e) => {
  e.preventDefault();
  const el = formAjout.elements;
  const donnees = { action: 'ajouter', comme: el.comme.value, email: el.email.value };
  if (el.comme.value === 'telechargement') Object.assign(donnees, { systeme: el.systeme.value, version: el.version.value, date: el.date.value });
  else if (el.comme.value === 'contact') Object.assign(donnees, { pseudo: el.pseudo.value, genre: el.genre.value });
  else Object.assign(donnees, { pseudo: el.pseudo.value, genre: el.genre.value, avertir: el.avertir.checked, auditeur: el.auditeur.checked });
  const r = await poster(donnees);
  if (!r.ok) return message(formAjout, ERREURS[r.erreur] || 'Enregistrement impossible.');
  message(formAjout, `${donnees.email} enregistrée.`, true);
  el.email.value = '';
  el.pseudo.value = '';
  await charger();
});

charger();

// Menu « Copier l’adresse d’une page » : l’URL choisie va dans le presse-papier.
// Copie synchrone par un champ temporaire placé DANS la boîte (seule zone active
// d’un <dialog> modal), puis API Clipboard en secours.
function copierTexte(texte) {
  const champ = document.createElement('textarea');
  champ.value = texte;
  champ.setAttribute('readonly', '');
  champ.style.cssText = 'position:fixed;top:0;left:0;width:1px;height:1px;opacity:0;';
  dialogInvitation.appendChild(champ);
  champ.focus();
  champ.select();
  champ.setSelectionRange(0, texte.length);
  let ok = false;
  try { ok = document.execCommand('copy'); } catch { ok = false; }
  champ.remove();
  if (ok) return Promise.resolve();
  return navigator.clipboard.writeText(texte);
}

const copierUrl = $('copierUrl');
copierUrl.addEventListener('change', async () => {
  const url = copierUrl.value;
  if (!url) return;
  const invite = copierUrl.options[0];
  const texte = invite.textContent;
  try {
    await copierTexte(url);
    invite.textContent = 'adresse copiée ✓';
  } catch {
    invite.textContent = 'copie impossible';
  }
  copierUrl.value = '';
  setTimeout(() => { invite.textContent = texte; }, 1800);
});
