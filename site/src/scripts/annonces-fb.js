// Page /admin/annonces/ : annonce Facebook aux groupes (API /api/annonces-fb.php, administrateur seulement).

const API = '/api/annonces-fb.php';
const $ = (id) => document.getElementById(id);
const ERREURS = {
  texte: 'Texte de l’annonce requis.',
  programmation: 'Date ET heure requises pour programmer l’envoi.',
  passe: 'L’envoi programmé doit être dans le futur.',
  repetition: 'Répétition invalide (au moins 2 fois).',
  nom: 'Nom du groupe requis.',
  url: 'URL invalide : adresse du type https://www.facebook.com/groups/…',
  existe: 'Ce groupe est déjà dans la liste.',
  admin: 'Session expirée : identifiez-vous de nouveau.',
};
const ETATS = { a_verifier: ['attente', 'à vérifier'], existant: ['ok', 'existant'], introuvable: ['ko', 'introuvable'] };

const formAnnonce = $('formAnnonce');
const formGroupe = $('formGroupe');
const panneauGroupes = formGroupe.closest('.panneau');
const panneauEnvoi = $('panneauEnvoi');
let etat = null;

// « 2026-11-20 14:05 » → « 20/11/2026 à 14:05 »
const dateHeure = (d) => `${d.slice(0, 10).split('-').reverse().join('/')} à ${d.slice(11, 16)}`;

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
    if (r.ok) { etat = r; afficherGroupes(); afficherEtat(); }
    return r;
  } catch {
    return { ok: false };
  }
}

// Ligne d'un groupe ; suppression : lien au bout de la ligne, puis confirmation
function ligne(g) {
  const tr = el('tr');
  const caseInput = el('input');
  caseInput.type = 'checkbox';
  caseInput.checked = +g.coche === 1 && g.etat !== 'introuvable';
  caseInput.disabled = g.etat === 'introuvable';
  caseInput.addEventListener('change', () => poster({ action: 'cocher', id: g.id, coche: caseInput.checked }));
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
  const cochables = etat.groupes.filter((g) => g.etat !== 'introuvable');
  $('tousGroupes').checked = cochables.length > 0 && cochables.every((g) => +g.coche === 1);
}

// Dernier envoi, prochain envoi, échecs à retenter
function afficherEtat() {
  const a = etat.annonce;
  const parties = [];
  if (a.dernier_envoi_le) parties.push(`Dernier envoi le ${dateHeure(a.dernier_envoi_le)} (${a.dernier_envoi_groupes} groupe${a.dernier_envoi_groupes > 1 ? 's' : ''})`);
  if (a.echeance) {
    const numero = +a.repeter ? ` (envoi ${a.numero} sur ${a.repeter_fois})` : '';
    parties.push(a.echeance <= maintenant()
      ? `envoi en attente du clic sur « Informer les groupes FB »${numero}`
      : `prochain envoi le ${dateHeure(a.echeance)}${numero}`);
  } else if (a.dernier_envoi_le) parties.push('envois terminés');
  let texte = parties.join(' — ');
  texte = texte.charAt(0).toUpperCase() + texte.slice(1);
  if (etat.echecs.length) texte += ` — à retenter : ${etat.echecs.map((e) => e.nom + (e.detail ? ` (${e.detail})` : '')).join(', ')}`;
  $('etatAnnonce').textContent = texte;
}

function maintenant() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

function remplir() {
  const a = etat.annonce;
  const el = formAnnonce.elements;
  el.texte.value = a.texte;
  el.mode.value = a.mode;
  el.date.value = a.programmee_le ? a.programmee_le.slice(0, 10) : '';
  el.heure.value = a.programmee_le ? a.programmee_le.slice(11, 16) : '';
  el.repeter.checked = +a.repeter === 1;
  el.repeter_n.value = a.repeter_n;
  el.repeter_unite.value = a.repeter_unite;
  el.repeter_fois.value = a.repeter_fois;
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
  remplir();
  afficherGroupes();
  afficherEtat();
}

formAnnonce.addEventListener('submit', async (e) => {
  e.preventDefault();
  const el = formAnnonce.elements;
  const mode = el.mode.value;
  if (mode === 'date' && (!el.date.value || !el.heure.value)) return message(panneauEnvoi, ERREURS.programmation);
  const r = await poster({
    action: 'enregistrer',
    texte: el.texte.value,
    mode,
    programmee_le: mode === 'date' ? `${el.date.value} ${el.heure.value}` : '',
    repeter: el.repeter.checked,
    repeter_n: Number(el.repeter_n.value),
    repeter_unite: el.repeter_unite.value,
    repeter_fois: Number(el.repeter_fois.value),
  });
  if (r.ok) message(panneauEnvoi, 'Annonce enregistrée.', true);
  else message(panneauEnvoi, ERREURS[r.erreur] || 'Enregistrement impossible.');
});

formGroupe.addEventListener('submit', async (e) => {
  e.preventDefault();
  const r = await poster({ action: 'ajouter', nom: formGroupe.elements.nom.value, url: formGroupe.elements.url.value });
  if (!r.ok) return message(panneauGroupes, ERREURS[r.erreur] || 'Ajout impossible.');
  formGroupe.reset();
  message(panneauGroupes, 'Groupe ajouté : son existence sera vérifiée au prochain clic sur « Informer les groupes FB ».', true);
});

$('tousGroupes').addEventListener('change', async (e) => {
  const coche = e.target.checked;
  for (const g of etat.groupes.filter((x) => x.etat !== 'introuvable' && (+x.coche === 1) !== coche)) {
    await poster({ action: 'cocher', id: g.id, coche });
  }
});

charger();
