// Page /admin/annonces/ : annonces Facebook aux groupes (API /api/annonces-fb.php, administrateur seulement).
// Liste des annonces → clic : détail (informations, exemple personnalisé, groupes) → Éditer : formulaire.

const API = '/api/annonces-fb.php';
const $ = (id) => document.getElementById(id);
const ERREURS = {
  texte: 'Texte de l’annonce requis.',
  groupes: 'Au moins un groupe requis.',
  programmation: 'Date ET heure requises pour programmer l’envoi.',
  passe: 'L’envoi programmé doit être dans le futur.',
  repetition: 'Répétition invalide (au moins 2 fois).',
  introuvable: 'Annonce introuvable (terminée ou supprimée entre-temps).',
  nom: 'Nom du groupe requis.',
  url: 'URL invalide : adresse du type https://www.facebook.com/groups/…',
  existe: 'Ce groupe est déjà dans la liste.',
  admin: 'Session expirée : identifiez-vous de nouveau.',
};
const ETATS = { a_verifier: ['attente', 'à vérifier'], existant: ['ok', 'existant'], introuvable: ['ko', 'introuvable'] };

const formAnnonce = $('formAnnonce');
const formGroupe = $('formGroupe');
const panneauGroupes = formGroupe.closest('.panneau');
let etat = null;
let choisie = 0;     // annonce affichée en détail
let editee = null;   // null : formulaire fermé ; 0 : nouvelle annonce ; n : annonce n
let selection = new Set();   // groupes cochés pour l'annonce éditée

// « 2026-11-20 14:05 » → « 20/11/2026 à 14:05 »
const dateHeure = (d) => `${d.slice(0, 10).split('-').reverse().join('/')} à ${d.slice(11, 16)}`;
const pluriel = (n, mot) => `${n} ${mot}${n > 1 ? 's' : ''}`;

function el(tag, classe, texte) {
  const e = document.createElement(tag);
  if (classe) e.className = classe;
  if (texte != null) e.textContent = texte;
  return e;
}

function message(zone, texte, ok = false) {
  const m = zone.querySelector('.message');
  m.textContent = texte;
  m.classList.toggle('ok', ok);
  m.hidden = !texte;
}

async function poster(donnees) {
  try {
    const r = await (await fetch(API, {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'X-Cami': '1', 'Content-Type': 'application/json' },
      body: JSON.stringify(donnees),
    })).json();
    if (r.ok) { etat = r; afficher(); }
    return r;
  } catch {
    return { ok: false };
  }
}

const annonce = (id) => etat.annonces.find((a) => +a.id === +id);

function prochainEnvoi(a) {
  if (!a.echeance) return 'non programmée';
  return a.echeance <= etat.maintenant ? 'à envoyer (en attente de « Informer les groupes FB »)' : dateHeure(a.echeance);
}

function repetition(a) {
  if (!+a.repeter) return 'aucune';
  return `tous les ${+a.repeter_n > 1 ? a.repeter_n + ' ' : ''}${a.repeter_unite}, envoi ${a.numero || 1} sur ${a.repeter_fois}`;
}

function extrait(a) {
  const t = a.texte.replace(/\s+/g, ' ').trim();
  return t.length > 80 ? `${t.slice(0, 80)}…` : t;
}

// Liste des annonces
function afficherAnnonces() {
  const corps = $('annonces');
  corps.replaceChildren(...etat.annonces.map((a) => {
    const tr = el('tr', +a.id === choisie ? 'choisie' : '');
    tr.append(el('td', 'date', prochainEnvoi(a)), el('td', 'extrait', extrait(a)), el('td', 'repetition', repetition(a)),
      el('td', 'nb', String(a.groupes.length)));
    if (a.echecs.length) tr.classList.add('echec');
    tr.addEventListener('click', () => { choisie = +a.id; fermerForm(); afficher(); });
    return tr;
  }));
  if (!etat.annonces.length) {
    const tr = el('tr');
    const td = el('td', 'vide', 'Aucune annonce programmée.');
    td.colSpan = 4;
    tr.append(td);
    corps.append(tr);
  }
}

function info(dl, terme, valeur) {
  const dd = el('dd');
  if (valeur instanceof Node) dd.append(valeur); else dd.textContent = valeur;
  dl.append(el('dt', '', terme), dd);
}

// Détail de l'annonce choisie
function afficherDetail() {
  const a = annonce(choisie);
  $('detail').hidden = !a || editee !== null;
  if (!a) return;
  const dl = $('infos');
  dl.replaceChildren();
  info(dl, 'Prochain envoi', prochainEnvoi(a));
  info(dl, 'Programmation', a.mode === 'date' ? `le ${dateHeure(a.programmee_le)}` : 'au prochain clic sur « Informer les groupes FB »');
  info(dl, 'Répétition', repetition(a));
  if (a.dernier_envoi_le) info(dl, 'Dernier envoi', `le ${dateHeure(a.dernier_envoi_le)} (${pluriel(+a.dernier_envoi_groupes, 'groupe')})`);
  info(dl, `Groupes (${a.groupes.length})`, a.noms_groupes.join(', '));
  if (a.echecs.length) info(dl, 'À retenter', a.echecs.map((e) => e.nom + (e.detail ? ` (${e.detail})` : '')).join(', '));
  info(dl, a.exemple_groupe ? `Exemple (${a.exemple_groupe})` : 'Exemple', el('div', 'exemple', a.exemple));
  $('supprimerAnnonce').hidden = false;
  $('confirmerSuppression').hidden = true;
}

// Cases de la liste « Groupes » : groupes de l'annonce éditée (visibles pendant l'édition seulement)
function majTous() {
  const cases = [...$('groupes').querySelectorAll('input.choix:not(:disabled)')];
  $('tousGroupes').checked = cases.length > 0 && cases.every((c) => c.checked);
}

function ouvrirForm(id) {
  editee = id;
  const a = id ? annonce(id) : null;
  const f = formAnnonce.elements;
  $('titreForm').textContent = a ? 'MODIFIER L’ANNONCE' : 'NOUVELLE ANNONCE';
  f.texte.value = a ? a.texte : '';
  f.mode.value = a ? a.mode : 'clic';
  f.date.value = a?.programmee_le ? a.programmee_le.slice(0, 10) : '';
  f.heure.value = a?.programmee_le ? a.programmee_le.slice(11, 16) : '';
  f.repeter.checked = a ? +a.repeter === 1 : false;
  f.repeter_n.value = a ? a.repeter_n : 1;
  f.repeter_unite.value = a ? a.repeter_unite : 'semaines';
  f.repeter_fois.value = a ? a.repeter_fois : 2;
  selection = new Set(a ? a.groupes.map(Number) : etat.groupes.filter((g) => g.etat !== 'introuvable').map((g) => +g.id));
  message(formAnnonce, '');
  formAnnonce.hidden = false;
  afficherGroupes();
  afficherDetail();
  f.texte.focus();
}

function fermerForm() {
  editee = null;
  formAnnonce.hidden = true;
  afficherGroupes();
}

// Ligne d'un groupe ; suppression : lien au bout de la ligne, puis confirmation
function ligne(g) {
  const tr = el('tr');
  const caseInput = el('input', 'choix');
  caseInput.type = 'checkbox';
  caseInput.checked = selection.has(+g.id);
  caseInput.disabled = editee === null;
  caseInput.addEventListener('change', () => {
    if (caseInput.checked) selection.add(+g.id); else selection.delete(+g.id);
    majTous();
  });
  const caseTd = el('td', 'case');
  caseTd.append(caseInput);
  const tdNom = el('td', 'nom', g.nom);
  const lien = el('a', 'url', g.url.replace(/^https:\/\/www\./, ''));
  lien.href = g.url;
  lien.target = '_blank';
  lien.rel = 'noopener';
  tdNom.append(el('br'), lien);

  const [classe, libelle] = ETATS[g.etat] || ETATS.a_verifier;
  const tdEtat = el('td', 'etat');
  tdEtat.append(el('span', `pastille ${classe}`, libelle));

  const tdSuppr = el('td', 'suppr');
  const supprimer = el('button', 'lien-supprimer', 'Supprimer…');
  supprimer.type = 'button';
  const confirmer = el('button', 'bouton confirmer', 'Confirmer la suppression');
  confirmer.type = 'button';
  confirmer.hidden = true;
  supprimer.addEventListener('click', () => { supprimer.hidden = true; confirmer.hidden = false; });
  confirmer.addEventListener('click', () => poster({ action: 'supprimer', id: g.id }));
  tdSuppr.append(supprimer, confirmer);

  tr.dataset.id = g.id;
  tr.append(caseTd, tdNom, tdEtat, tdSuppr);
  return tr;
}

function afficherGroupes() {
  const corps = $('groupes');
  corps.replaceChildren(...etat.groupes.map(ligne));
  if (!etat.groupes.length) {
    const tr = el('tr');
    const td = el('td', 'vide', 'Aucun groupe pour le moment.');
    td.colSpan = 4;
    tr.append(td);
    corps.append(tr);
  }
  corps.closest('table').classList.toggle('edition', editee !== null);
  $('tousGroupes').disabled = editee === null;
  majTous();
}

function afficher() {
  if (choisie && !annonce(choisie)) choisie = 0;
  afficherAnnonces();
  afficherDetail();
  afficherGroupes();
}

// Page affichée seulement pour l'administrateur identifié ; sinon (ou sans PHP) : message d'accès
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
  etat = reponse;
  $('contenu').hidden = false;
  afficher();
}

$('nouvelleAnnonce').addEventListener('click', () => { choisie = 0; ouvrirForm(0); afficherAnnonces(); });
$('editer').addEventListener('click', () => ouvrirForm(choisie));
$('annuler').addEventListener('click', () => { fermerForm(); afficherDetail(); });
$('supprimerAnnonce').addEventListener('click', () => { $('supprimerAnnonce').hidden = true; $('confirmerSuppression').hidden = false; });
$('confirmerSuppression').addEventListener('click', () => poster({ action: 'supprimer_annonce', id: choisie }));
$('tousGroupes').addEventListener('change', (e) => {
  for (const c of $('groupes').querySelectorAll('input.choix')) {
    c.checked = e.target.checked;
    if (c.checked) selection.add(+c.closest('tr').dataset.id); else selection.delete(+c.closest('tr').dataset.id);
  }
});

formAnnonce.addEventListener('submit', async (e) => {
  e.preventDefault();
  const f = formAnnonce.elements;
  const mode = f.mode.value;
  if (mode === 'date' && (!f.date.value || !f.heure.value)) return message(formAnnonce, ERREURS.programmation);
  const groupes = [...selection].filter((id) => etat.groupes.some((g) => +g.id === id));
  if (!groupes.length) return message(formAnnonce, ERREURS.groupes);
  const r = await poster({
    action: 'enregistrer',
    id: editee || 0,
    texte: f.texte.value,
    groupes,
    mode,
    programmee_le: mode === 'date' ? `${f.date.value} ${f.heure.value}` : '',
    repeter: f.repeter.checked,
    repeter_n: Number(f.repeter_n.value),
    repeter_unite: f.repeter_unite.value,
    repeter_fois: Number(f.repeter_fois.value),
  });
  if (!r.ok) return message(formAnnonce, ERREURS[r.erreur] || 'Enregistrement impossible.');
  choisie = +r.id;
  fermerForm();
  afficher();
});

formGroupe.addEventListener('submit', async (e) => {
  e.preventDefault();
  const r = await poster({ action: 'ajouter', nom: formGroupe.elements.nom.value, url: formGroupe.elements.url.value });
  if (!r.ok) return message(panneauGroupes, ERREURS[r.erreur] || 'Ajout impossible.');
  formGroupe.reset();
  message(panneauGroupes, 'Groupe ajouté : son existence sera vérifiée au prochain clic sur « Informer les groupes FB ».', true);
});

charger();
