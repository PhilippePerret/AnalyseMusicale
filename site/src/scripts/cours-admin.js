// Gestion des cours (page /cours/admin/, issue #13) : demandes de cours, élèves, groupes, lieux mémorisés.
// Données et actions : /api/cours.php (administrateur).

const JOURS = ['lundi','mardi','mercredi','jeudi','vendredi','samedi','dimanche'];
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const deux = (n) => String(n).padStart(2, '0');
const cle = (d) => `${d.getFullYear()}-${deux(d.getMonth() + 1)}-${deux(d.getDate())}`;
const date = (s) => s ? `${s.slice(8, 10)}/${s.slice(5, 7)}/${s.slice(2, 4)}` : '';

let etat = null;

const ERREURS = {
  email: 'Adresse e-mail invalide.',
  existe: 'Cette personne est déjà élève.',
  nom: 'Le nom du groupe est obligatoire.',
  eleves: 'Choisir au moins un élève.',
  lieu: 'Nom et lien (ou adresse) obligatoires.',
};

async function api(donnees) {
  const options = donnees === undefined ? {} : { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Cami': '1' }, body: JSON.stringify(donnees) };
  const rep = await fetch('/api/cours.php', { credentials: 'same-origin', ...options });
  try { return await rep.json(); } catch { return { ok: false, erreur: 'serveur' }; }
}

function message(form, texte, ok = false) {
  const m = form.querySelector('.message');
  m.textContent = texte;
  m.classList.toggle('ok', ok);
  m.hidden = !texte;
}

async function charger() {
  const r = await api();
  $('chargement').hidden = true;
  if (!r.ok || !r.acces || !r.admin) { $('refus').hidden = false; return; }
  etat = r;
  $('contenu').hidden = false;
  rendreDemandes();
  rendreEleves();
  rendreGroupes();
  rendreLieux();
}

// Bouton de suppression en deux temps (clic, puis confirmation)
const supprimer = (quoi, id, libelle) => `<button type="button" class="lien-supprimer" data-demander="${quoi}" data-id="${id}">${libelle}…</button>
  <button type="button" class="confirmer" data-confirmer="${quoi}" data-id="${id}" hidden>Confirmer</button>`;

// --- Demandes de cours (formulaire /cours/demande/) ---

const heureFr = (h) => `${Number(h.slice(0, 2))} h${h.slice(3) === '30' ? ' 30' : ''}`;

function rendreDemandes() {
  const niveaux = etat.niveaux;
  $('demandes').innerHTML = etat.demandes.map((d) => {
    // Tranches par ordre de préférence
    const creneaux = d.creneaux.map((c, i) => `${i + 1}. ${JOURS[c.jour - 1]} ${heureFr(c.debut)} – ${heureFr(c.fin)}`).join('<br>');
    const connaissances = Object.entries(etat.connaissances).map(([cle, libelle]) =>
      `${esc(libelle.replace(/^Connaissances (théoriques |des |en )?/, ''))} : <b>${esc(niveaux[d.niveaux[cle]] || '—')}</b>`).join('<br>');
    return `<tr${d.confirmee_le ? '' : ' class="attente"'}>
      <td>${esc(d.nom)}<br><span class="email">${esc(d.email)}</span></td>
      <td>${date(d.cree_le)}<br>${d.confirmee_le ? 'confirmée' : '<span class="vide">adresse à confirmer</span>'}</td>
      <td>${esc(d.frequence)}<br>${creneaux}</td>
      <td class="connaissances">${connaissances}</td>
      <td class="action">${supprimer('demande', d.id, 'Supprimer')}</td></tr>`;
  }).join('') || '<tr><td colspan="5" class="vide">Aucune demande pour le moment.</td></tr>';
}

// --- Élèves ---

function rendreEleves() {
  $('eleves').innerHTML = etat.eleves.map((e) => `<tr>
    <td>${esc(e.pseudo || '—')}</td><td class="email">${esc(e.email)}</td><td>${date(e.cree_le)}</td>
    <td class="action">${supprimer('eleve', e.id, 'Retirer des élèves')}</td></tr>`).join('')
    || '<tr><td colspan="4" class="vide">Aucun élève pour le moment.</td></tr>';
  $('elevesGroupe').innerHTML = etat.eleves.map((e) => `<label><input type="checkbox" name="eleves" value="${e.id}"> ${esc(e.pseudo || e.email)}</label>`).join('');
}

$('formEleve').addEventListener('submit', async (e) => {
  e.preventDefault();
  const f = Object.fromEntries(new FormData(e.target));
  const r = await api({ action: 'eleve_ajouter', ...f });
  if (!r.ok) return message(e.target, ERREURS[r.erreur] || 'Inscription impossible.');
  e.target.reset();
  await charger();
  message(e.target, `${f.email} est inscrit comme élève : un mail de bienvenue lui est envoyé.`, true);
});

// --- Groupes ---

function rendreGroupes() {
  $('groupes').innerHTML = etat.groupes.map((g) => `<tr>
    <td>${g.solo ? '<span class="vide">solo</span> ' : ''}${esc(g.nom)}</td>
    <td>${g.eleves.map((e) => esc(e.nom)).join(', ')}</td>
    <td>${esc(g.lieu)}</td>
    <td class="action"><a href="#" data-modifier="${g.id}">Modifier</a>${g.solo ? '' : ' · ' + supprimer('groupe', g.id, 'Supprimer')}</td></tr>`).join('')
    || '<tr><td colspan="4" class="vide">Chaque élève inscrit a son groupe solo.</td></tr>';
}

function editerGroupe(g) {
  const f = $('formGroupe');
  f.reset();
  f.elements.id.value = g ? g.id : 0;
  f.elements.nom.value = g && !g.solo ? g.nom : '';
  f.elements.lieu.value = g ? g.lieu : '';
  f.elements.nom.disabled = !!g?.solo;
  const ids = g ? g.eleves.map((e) => e.id) : [];
  f.querySelectorAll('[name=eleves]').forEach((c) => { c.checked = ids.includes(Number(c.value)); c.disabled = !!g?.solo; });
  $('boutonGroupe').textContent = g ? 'Enregistrer le groupe' : 'Créer le groupe';
  $('annulerGroupe').hidden = !g;
  message(f, '');
  if (g) f.scrollIntoView({ behavior: 'smooth', block: 'center' });
}

$('groupes').addEventListener('click', (e) => {
  const a = e.target.closest('[data-modifier]');
  if (!a) return;
  e.preventDefault();
  editerGroupe(etat.groupes.find((g) => g.id === Number(a.dataset.modifier)));
});
$('annulerGroupe').addEventListener('click', () => editerGroupe(null));

$('formGroupe').addEventListener('submit', async (e) => {
  e.preventDefault();
  const f = e.target;
  const eleves = [...f.querySelectorAll('[name=eleves]:checked')].map((c) => Number(c.value));
  const r = await api({ action: 'groupe_enregistrer', id: Number(f.elements.id.value), nom: f.elements.nom.value, lieu: f.elements.lieu.value, eleves });
  if (!r.ok) return message(f, ERREURS[r.erreur] || 'Enregistrement impossible.');
  await charger();
  editerGroupe(null);
  message(f, 'Groupe enregistré.', true);
});

// --- Lieux mémorisés ---

function rendreLieux() {
  $('lieux').innerHTML = etat.lieux.map((l) => `<tr><td>${esc(l.nom)}</td><td class="email">${esc(l.valeur)}</td>
    <td class="action">${supprimer('lieu', l.id, 'Supprimer')}</td></tr>`).join('')
    || '<tr><td colspan="3" class="vide">Aucun lieu mémorisé.</td></tr>';
}

$('formLieu').addEventListener('submit', async (e) => {
  e.preventDefault();
  const r = await api({ action: 'lieu_enregistrer', ...Object.fromEntries(new FormData(e.target)) });
  if (!r.ok) return message(e.target, ERREURS[r.erreur] || 'Enregistrement impossible.');
  e.target.reset();
  await charger();
});

// --- Suppressions en deux temps ---

$('contenu').addEventListener('click', async (e) => {
  const demander = e.target.closest('[data-demander]');
  if (demander) {
    demander.hidden = true;
    demander.nextElementSibling.hidden = false;
    return;
  }
  const confirmer = e.target.closest('[data-confirmer]');
  if (!confirmer) return;
  const id = Number(confirmer.dataset.id);
  const actions = {
    eleve: { action: 'eleve_retirer', id },
    groupe: { action: 'groupe_supprimer', id },
    lieu: { action: 'lieu_supprimer', id },
    demande: { action: 'demande_cours_supprimer', id },
  };
  await api(actions[confirmer.dataset.confirmer]);
  await charger();
});

charger();
