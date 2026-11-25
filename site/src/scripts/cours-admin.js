// Gestion des cours (page /cours/admin/, issue #13) : demandes de cours, élèves (liste issue #20), groupes, lieux mémorisés.
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
  email_pris: 'Cette adresse appartient déjà à un autre compte.',
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

// --- Élèves (issue #20) : liste filtrable, cases à cocher, menu Action ---

const GENRES = { F: 'femme', H: 'homme', N: '—' };
const coches = new Set();   // ids des élèves cochés (conservés d'un rendu à l'autre)
let nouvelEleve = 0;        // id de l'élève qui vient d'être inscrit (mis en évidence)

// Filtre « fuzzy » : les caractères saisis apparaissent dans l'ordre
function positions(texte, q) {
  const t = texte.toLowerCase();
  const pos = [];
  let i = 0;
  for (const c of q.toLowerCase().replace(/\s+/g, '')) {
    i = t.indexOf(c, i);
    if (i < 0) return null;
    pos.push(i++);
  }
  return pos;
}
function surligner(texte, q) {
  const pos = q ? positions(texte, q) : null;
  if (!pos) return esc(texte);
  return [...texte].map((c, k) => pos.includes(k) ? `<mark>${esc(c)}</mark>` : esc(c)).join('');
}
const texteEleve = (e) => `${e.pseudo} ${e.email} ${GENRES[e.genre] || ''} ${e.actif ? 'actif' : 'inactif'}`;

function elevesVisibles() {
  const q = $('filtreEleves').value.trim();
  const statut = document.querySelector('#ongletsEleves input:checked').value;
  return etat.eleves.filter((e) => (!statut || (statut === 'actif') === e.actif) && (!q || positions(texteEleve(e), q)));
}

function rendreEleves() {
  const ids = new Set(etat.eleves.map((e) => e.id));
  [...coches].forEach((id) => { if (!ids.has(id)) coches.delete(id); });
  const q = $('filtreEleves').value.trim();
  const liste = elevesVisibles();
  $('eleves').innerHTML = liste.map((e) => `<li class="${e.actif ? '' : 'inactif'}${e.id === nouvelEleve ? ' nouveau' : ''}">
    <input type="checkbox" class="coche" value="${e.id}"${coches.has(e.id) ? ' checked' : ''}>
    <span>${surligner(e.pseudo || '—', q)}</span><span class="email">${surligner(e.email, q)}</span>
    <span class="genre">${GENRES[e.genre] || '—'}</span>
    <span class="statut ${e.actif ? 'actif' : 'inactif'}">${e.actif ? 'actif' : 'inactif'}</span></li>`).join('')
    || `<li class="vide">${etat.eleves.length ? 'Aucun élève ne correspond.' : 'Aucun élève pour le moment.'}</li>`;
  majCoches();
  $('elevesGroupe').innerHTML = etat.eleves.map((e) => `<label><input type="checkbox" name="eleves" value="${e.id}"> ${esc(e.pseudo || e.email)}</label>`).join('');
}

function majCoches() {
  const n = coches.size;
  $('nbCoches').textContent = n ? `${n} coché${n > 1 ? 's' : ''}` : '';
  const visibles = [...$('eleves').querySelectorAll('.coche')];
  $('toutCocher').checked = visibles.length > 0 && visibles.every((c) => c.checked);
  $('confirmerSuppression').hidden = true;
}

$('filtreEleves').addEventListener('input', rendreEleves);
$('ongletsEleves').addEventListener('change', rendreEleves);
$('eleves').addEventListener('change', (e) => {
  if (!e.target.classList.contains('coche')) return;
  const id = Number(e.target.value);
  if (e.target.checked) coches.add(id); else coches.delete(id);
  majCoches();
});
$('toutCocher').addEventListener('change', (e) => {
  $('eleves').querySelectorAll('.coche').forEach((c) => {
    c.checked = e.target.checked;
    if (c.checked) coches.add(Number(c.value)); else coches.delete(Number(c.value));
  });
  majCoches();
});

// Formulaire : nouvel élève, ou modification de l'élève choisi par « Modifier »
function editerEleve(el) {
  const f = $('formEleve');
  f.reset();
  f.elements.id.value = el ? el.id : 0;
  if (el) {
    f.elements.email.value = el.email;
    f.elements.pseudo.value = el.pseudo;
    f.elements.genre.value = el.genre || 'N';
  }
  $('titreFormEleve').textContent = el ? 'Modifier l’élève' : 'Nouvel élève';
  $('caseBienvenue').hidden = !!el;
  $('annulerEleve').hidden = !el;
  $('boutonEleve').textContent = el ? 'Enregistrer' : 'Inscrire comme élève';
  message(f, '');
  if (el) f.elements.email.focus();
}
$('annulerEleve').addEventListener('click', () => editerEleve(null));

$('formEleve').addEventListener('submit', async (e) => {
  e.preventDefault();
  const f = Object.fromEntries(new FormData(e.target));
  const id = Number(f.id);
  if (id) {
    const r = await api({ action: 'eleve_modifier', id, email: f.email, pseudo: f.pseudo, genre: f.genre });
    if (!r.ok) return message(e.target, ERREURS[r.erreur] || 'Enregistrement impossible.');
    editerEleve(null);
    await charger();
    return message(e.target, 'Élève modifié.', true);
  }
  f.bienvenue = e.target.elements.bienvenue.checked;
  const r = await api({ action: 'eleve_ajouter', ...f });
  if (!r.ok) return message(e.target, ERREURS[r.erreur] || 'Inscription impossible.');
  editerEleve(null);
  // L'élève inscrit apparaît tout de suite dans la liste
  $('filtreEleves').value = '';
  document.querySelector('#ongletsEleves input[value=actif]').checked = true;
  nouvelEleve = r.id;
  await charger();
  setTimeout(() => { nouvelEleve = 0; $('eleves').querySelector('.nouveau')?.classList.remove('nouveau'); }, 2500);
  message(e.target, `${f.email} est inscrit comme élève${f.bienvenue ? ' : un mail de bienvenue lui est envoyé' : ' (sans mail de bienvenue)'}.`, true);
});

// Menu « Action » appliqué aux élèves cochés
const barreActions = $('actionsEleves');
$('appliquerEleves').addEventListener('click', async () => {
  const action = $('actionEleves').value;
  const choisis = etat.eleves.filter((e) => coches.has(e.id));
  message(barreActions, '');
  if (!action) return message(barreActions, 'Choisir une action.');
  if (!choisis.length) return message(barreActions, 'Cocher au moins un élève.');
  if (action === 'modifier' || action === 'contacter') {
    if (choisis.length > 1) return message(barreActions, 'Cocher un seul élève pour cette action.');
    const el = choisis[0];
    if (action === 'modifier') return editerEleve(el);
    return window.open(`/contact/?email=${encodeURIComponent(el.email)}&nom=${encodeURIComponent(el.pseudo)}`, '_blank');
  }
  if (action === 'supprimer') {
    $('confirmerSuppression').textContent = `Confirmer la suppression de ${choisis.length > 1 ? `ces ${choisis.length} élèves` : 'cet élève'}`;
    $('confirmerSuppression').hidden = false;
    return;
  }
  const r = await api({ action: 'eleves_actif', ids: choisis.map((e) => e.id), actif: action === 'actif' });
  if (!r.ok) return message(barreActions, 'Modification impossible.');
  coches.clear();
  await charger();
  message(barreActions, `${choisis.length > 1 ? `${choisis.length} élèves rendus` : 'Élève rendu'} ${action}${choisis.length > 1 ? 's' : ''}.`, true);
});
$('confirmerSuppression').addEventListener('click', async () => {
  const ids = [...coches];
  for (const id of ids) await api({ action: 'eleve_retirer', id });
  coches.clear();
  await charger();
  message(barreActions, `${ids.length > 1 ? `${ids.length} élèves supprimés` : 'Élève supprimé'}.`, true);
});
$('actionEleves').addEventListener('change', () => { $('confirmerSuppression').hidden = true; });

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
    groupe: { action: 'groupe_supprimer', id },
    lieu: { action: 'lieu_supprimer', id },
    demande: { action: 'demande_cours_supprimer', id },
  };
  await api(actions[confirmer.dataset.confirmer]);
  await charger();
});

charger();
