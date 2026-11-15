// Calendrier des jeudis de l'analyse (page /jeudis-analyse/).
// Données : /api/etat.php — séances, visiteur identifié, présences.
// Liens directs : ?compte=connexion, ?compte=inscription (ouvrent la fenêtre),
// avec &retour=/chemin/ : page où revenir une fois identifié (ou inscription confirmée).
// Actions : /api/compte.php, /api/presence.php, /api/seance.php (administrateur).

const MOIS = ['janvier','février','mars','avril','mai','juin','juillet','août','septembre','octobre','novembre','décembre'];
const OEIL = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7S1 12 1 12z"/><circle cx="12" cy="12" r="3"/></svg>';
const DEFAUT = { compositeur: '', oeuvre: '', analyste: 'Ph. Perret', debut: '19:00', fin: '22:00', youtube: '', partition: '' };
const HEURES = Array.from({ length: 15 }, (_, i) => `${String(9 + i).padStart(2, '0')}:00`);
const MOIS_AVANT = 1, MOIS_APRES = 4;   // période affichée autour du mois courant

let etat = { maintenant: '', seances: {}, user: null, presences: [] };
let choisi = null, enAttente = null, message = '';
let genre = 'N';   // genre courant pour les textes : celui du visiteur, ou choisi à l'inscription

const $ = (id) => document.getElementById(id);

// --- Utilitaires ---

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
// Texte affiché : échappé, puis ^xxx^ (syntaxe AsciiDoc) → exposant
const txt = (s) => esc(s).replace(/\^([^\^\s]+)\^/g, '<sup>$1</sup>');
// Texte genré : [masculin|féminin] ; discret → masculin
const g = (s) => s.replace(/\[([^\[\]|]*)\|([^\[\]|]*)\]/g, (_, m, f) => genre === 'F' ? f : m);
const cle = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const jour = (n) => n === 1 ? '1<sup>er</sup>' : String(n);
const heure = (h) => { const [hh, mm] = h.split(':'); return `${Number(hh)} h${mm !== '00' ? ' ' + mm : ''}`; };
const dateLongue = (k) => { const d = new Date(k + 'T12:00'); return `Jeudi ${jour(d.getDate())} ${MOIS[d.getMonth()]} ${d.getFullYear()}`; };
const jeudisDuMois = (a, m) => { const r = []; const d = new Date(a, m, 1); while (d.getDay() !== 4) d.setDate(d.getDate() + 1); while (d.getMonth() === m) { r.push(new Date(d)); d.setDate(d.getDate() + 7); } return r; };
const aujourdhui = () => etat.maintenant.slice(0, 10);
const admin = () => !!etat.user?.admin;
const prochain = () => Object.keys(etat.seances).sort().find((k) => etat.seances[k].etat !== 'apres' && k !== aujourdhui());

async function api(script, donnees) {
  const options = donnees === undefined ? {} : { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Cami': '1' }, body: JSON.stringify(donnees) };
  const rep = await fetch(`/api/${script}`, { credentials: 'same-origin', ...options });
  try { return await rep.json(); } catch { return { ok: false, erreur: 'serveur' }; }
}

async function charger() {
  const r = await api('etat.php');
  if (!r.ok) { $('cal').innerHTML = '<p class="vide">Le calendrier n’a pas pu être chargé.</p>'; return; }
  etat = r;
  if (r.user) genre = r.user.genre;
  appliquerGenre();
  rendreCompte();
  choisi ? afficherDetail(choisi) : rendreCalendrier();
}

function appliquerGenre() {
  document.querySelectorAll('[data-g]').forEach((e) => { e.innerHTML = g(e.dataset.g); });
}

// --- Barre du compte ---

function rendreCompte() {
  const u = etat.user;
  $('barreCompte').innerHTML = u
    ? `${g('Identifié[|e]')}${u.pseudo ? ` : ${esc(u.pseudo)}` : ''}${u.admin ? ' (administration)' : ''} — <a href="#" id="deconnexion">Se déconnecter</a>`
    : '<a href="#" id="identification">S’identifier</a>';
}

// --- Calendrier ---

function periode() {
  const [a, m] = etat.maintenant.split('-').map(Number);
  return Array.from({ length: MOIS_AVANT + MOIS_APRES + 1 }, (_, i) => {
    const d = new Date(a, m - 1 - MOIS_AVANT + i, 1);
    return [d.getFullYear(), d.getMonth()];
  });
}

function caseJeudi(d) {
  const k = cle(d), s = etat.seances[k];
  const libelle = `<span class="num">Jeudi ${jour(d.getDate())}</span>`;
  if (!s) return admin() ? `<div class="jeudi editable" role="button" tabindex="0" data-k="${k}">${libelle}</div>` : `<div class="jeudi">${libelle}</div>`;
  const cls = ['jeudi', 'seance', s.etat === 'apres' ? 'passe' : '', k === aujourdhui() ? 'courant' : '', k === prochain() ? 'prochain' : ''].join(' ');
  let oeil = '';
  if (s.youtube && s.etat === 'apres') oeil = `<a class="oeil" href="${esc(s.youtube)}" target="_blank" rel="noopener" title="Revoir l’analyse">${OEIL}</a>`;
  if (s.youtube && s.etat === 'direct') oeil = `<a class="oeil" href="${esc(s.youtube)}" target="_blank" rel="noopener" title="Suivre l’analyse en direct">${OEIL}</a>`;
  return `<div class="${cls}" role="button" tabindex="0" data-k="${k}">${libelle}<span class="piece">${txt(s.compositeur || 'à venir')}</span>${oeil}</div>`;
}

function rendreCalendrier() {
  let h = '', annee = null;
  for (const [a, m] of periode()) {
    if (a !== annee) {
      if (annee !== null) h += '</table>';
      h += `<h2 class="annee">${a}</h2><table class="grille">`;
      annee = a;
    }
    const js = jeudisDuMois(a, m);
    h += `<tr><th class="mois">${MOIS[m].toUpperCase()}</th>` + [0, 1, 2, 3, 4].map((i) => `<td>${js[i] ? caseJeudi(js[i]) : ''}</td>`).join('') + '</tr>';
  }
  $('cal').innerHTML = h + '</table>';
  if (choisi) document.querySelector(`.jeudi[data-k="${choisi}"]`)?.classList.add('choisi');
}

// --- Fiche d'un jeudi ---

function afficherDetail(k) {
  choisi = k;
  rendreCalendrier();
  const s = etat.seances[k];
  const lienEditer = admin() ? '<a href="#" class="editer" data-action="editer">Éditer</a>' : '';
  const msg = message ? `<p class="message">${message}</p>` : '';
  message = '';
  if (!s) {
    $('detail').innerHTML = `${lienEditer}<div class="date">${dateLongue(k)}</div><div class="vide">Pas de séance prévue ce jeudi.</div>${msg}`;
    return;
  }
  const actions = [];
  if (s.etat === 'avant') {
    actions.push(etat.presences.includes(k)
      ? `<span class="inscrit-ok">${g('✓ Vous serez présent[|e]')}</span>`
      : `<button class="bouton" data-action="present">${g('Je serai présent[|e]')}</button>`);
    actions.push('<span class="direct inactif" title="Disponible le jour et à l’heure de la séance">Rejoindre l’analyse en direct</span>');
  } else if (s.etat === 'direct') {
    actions.push(s.youtube
      ? `<a class="direct actif" href="${esc(s.youtube)}" target="_blank" rel="noopener">Rejoindre l’analyse en direct</a>`
      : '<span class="direct inactif">Lien du direct non encore défini</span>');
  } else if (s.youtube) {
    actions.push(`<a href="${esc(s.youtube)}" target="_blank" rel="noopener">▶ Revoir l’analyse</a>`);
  }
  const piece = s.compositeur || s.oeuvre
    ? `<strong>${txt(s.compositeur)}</strong>${s.compositeur && s.oeuvre ? ' — ' : ''}${txt(s.oeuvre)}`
    : '<span class="vide">Pièce à venir</span>';
  $('detail').innerHTML =
    `${lienEditer}<div class="date">${dateLongue(k)}, ${heure(s.debut)} – ${heure(s.fin)}</div>
     <div>${piece}</div>
     <div>Analyste principal : ${txt(s.analyste)}</div>
     ${s.partition ? `<div><a href="${esc(s.partition)}" target="_blank" rel="noopener">Télécharger la partition</a></div>` : ''}
     <div class="actions">${actions.join('')}</div>${msg}`;
}

// --- Édition (administrateur) ---

function menuHeures(nom, libelle, valeur, derniere) {
  const options = HEURES.filter((h) => h <= derniere).map((h) => `<option value="${h}"${h === valeur ? ' selected' : ''}>${h}</option>`).join('');
  return `<label class="en-ligne">${libelle}<select name="${nom}" required>${options}</select></label>`;
}

function editer(k, erreur = '') {
  const existe = !!etat.seances[k];
  const s = etat.seances[k] || DEFAUT;
  const d = new Date(k + 'T12:00');
  $('detail').innerHTML =
    `<div class="date">${existe ? 'Modifier' : 'Créer'} la séance du jeudi ${jour(d.getDate())} ${MOIS[d.getMonth()]} ${d.getFullYear()}</div>
     <form class="edition" id="formEdition">
       <div class="rang">
         <label class="petit">Compositeur <input name="compositeur" value="${esc(s.compositeur)}" maxlength="80" placeholder="Chopin"></label>
         <label class="grand">Œuvre <input name="oeuvre" value="${esc(s.oeuvre)}" maxlength="200" placeholder="Sonate K. 545, 1^er^ mouvement"></label>
       </div>
       <div class="rang une-ligne">
         <label class="en-ligne">Analyste principal <input class="analyste" name="analyste" value="${esc(s.analyste)}" maxlength="80" required></label>
         ${menuHeures('debut', 'Début', s.debut, '21:00')}
         ${menuHeures('fin', 'Fin', s.fin, '23:00')}
       </div>
       <label class="en-ligne lien">Lien du direct YouTube <input type="url" name="youtube" value="${esc(s.youtube)}" maxlength="300" placeholder="https://www.youtube.com/live/…"></label>
       <label class="en-ligne lien">URL de la partition <input type="url" name="partition" value="${esc(s.partition)}" maxlength="300" placeholder="https://…"></label>
       <div class="aide">^texte^ = exposant (ex. 1^er^)</div>
       ${erreur ? `<p class="erreur">${erreur}</p>` : ''}
       <div class="boutons">
         <a href="#" data-action="annuler">Annuler</a>
         <button class="bouton">Enregistrer</button>
       </div>
     </form>
     ${existe ? '<div class="zone-suppression" id="zoneSuppr"><button type="button" class="supprimer" data-action="demander-suppression">Supprimer cette séance…</button></div>' : ''}`;
}

const ERREURS_SEANCE = {
  heures: 'L’heure de fin doit être après l’heure de début.',
  youtube: 'Le lien YouTube doit commencer par https://',
  partition: 'L’URL de la partition doit commencer par https:// (ou http://)',
  admin: 'Action réservée à l’administration.',
};

async function enregistrer(k, form) {
  const r = await api('seance.php', { action: 'enregistrer', jour: k, ...Object.fromEntries(new FormData(form)) });
  if (!r.ok) return editer(k, ERREURS_SEANCE[r.erreur] || 'Enregistrement impossible.');
  message = 'Séance enregistrée.';
  await charger();
}

function demanderSuppression(k) {
  $('zoneSuppr').innerHTML =
    `<span class="confirmer">Supprimer définitivement la séance du ${dateLongue(k).toLowerCase()} ?</span>
     <button type="button" data-action="supprimer">Oui, supprimer</button>
     <button type="button" class="non" data-action="editer">Non</button>`;
}

async function supprimer(k) {
  await api('seance.php', { action: 'supprimer', jour: k });
  message = 'Séance supprimée.';
  await charger();
}

// --- Présence / identification ---

async function jeSeraiPresent(k) {
  if (!etat.user) { enAttente = k; ouvrir('connexion'); return; }
  await api('presence.php', { jour: k, present: true });
  await charger();
}

function ouvrir(quoi) {
  $('fConnexion').hidden = quoi !== 'connexion';
  $('fInscription').hidden = quoi !== 'inscription';
  document.querySelectorAll('.fenetre .message').forEach((m) => { m.hidden = true; });
  $('voile').classList.add('ouvert');
}
function fermer() { $('voile').classList.remove('ouvert'); enAttente = null; }

function messageFenetre(form, texte, ok = false) {
  const m = form.querySelector('.message');
  m.innerHTML = texte;
  m.classList.toggle('ok', ok);
  m.hidden = false;
}

const ERREURS_COMPTE = {
  email: 'Adresse e-mail invalide.',
  mdp: 'Le mot de passe doit faire au moins 8 caractères.',
  identifiants: 'Adresse ou mot de passe incorrect.',
  non_confirme: 'Adresse pas encore confirmée : cliquez sur le lien du mail reçu à l’inscription (ou inscrivez-vous de nouveau pour le recevoir encore).',
  existe: 'Cette adresse est déjà inscrite : identifiez-vous.',
};

async function seConnecter(form) {
  const f = Object.fromEntries(new FormData(form));
  const r = await api('compte.php', { action: 'connexion', email: f.email, mdp: f.mdp, jour: enAttente });
  if (!r.ok) return messageFenetre(form, ERREURS_COMPTE[r.erreur] || 'Identification impossible.');
  if (retour) { location.href = retour; return; }
  if (enAttente) choisi = enAttente;
  fermer();
  await charger();
}

async function sInscrire(form) {
  const f = Object.fromEntries(new FormData(form));
  const r = await api('compte.php', {
    action: 'inscription', email: f.email, mdp: f.mdp, pseudo: f.pseudo, genre: f.genre,
    avertir: !!f.avertir, auditeur: !!f.auditeur, site_web: f.site_web, jour: enAttente,
  });
  if (!r.ok) return messageFenetre(form, ERREURS_COMPTE[r.erreur] || 'Inscription impossible.');
  const presence = enAttente ? ` et votre présence au ${dateLongue(enAttente).toLowerCase()}` : '';
  messageFenetre(form, `Un mail vient de vous être envoyé à <strong>${esc(f.email)}</strong>. Cliquez sur le lien qu’il contient pour confirmer votre inscription${presence}.`, true);
  form.querySelector('button.bouton').disabled = true;
  // Page où revenir après le clic sur le lien de confirmation (ouvert depuis le mail)
  try { if (retour) localStorage.setItem('cami-retour', retour); } catch {}
}

// --- Événements ---

$('cal').addEventListener('click', (e) => {
  if (e.target.closest('.oeil')) return;
  const j = e.target.closest('.jeudi[data-k]');
  if (j) afficherDetail(j.dataset.k);
});
$('cal').addEventListener('keydown', (e) => {
  const j = e.target.closest('.jeudi[data-k]');
  if (j && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); afficherDetail(j.dataset.k); }
});

$('detail').addEventListener('click', (e) => {
  const a = e.target.closest('[data-action]');
  if (!a) return;
  e.preventDefault();
  const actions = {
    editer: () => editer(choisi),
    annuler: () => afficherDetail(choisi),
    present: () => jeSeraiPresent(choisi),
    'demander-suppression': () => demanderSuppression(choisi),
    supprimer: () => supprimer(choisi),
  };
  actions[a.dataset.action]?.();
});
$('detail').addEventListener('submit', (e) => { e.preventDefault(); enregistrer(choisi, e.target); });

$('barreCompte').addEventListener('click', async (e) => {
  if (e.target.id === 'identification') { e.preventDefault(); ouvrir('connexion'); }
  if (e.target.id === 'deconnexion') { e.preventDefault(); await api('compte.php', { action: 'deconnexion' }); genre = 'N'; await charger(); }
});

$('formConnexion').addEventListener('submit', (e) => { e.preventDefault(); seConnecter(e.target); });
$('formInscription').addEventListener('submit', (e) => { e.preventDefault(); sInscrire(e.target); });
$('formInscription').addEventListener('change', (e) => { if (e.target.name === 'genre') { genre = e.target.value; appliquerGenre(); } });
// Passage connexion ↔ inscription : l'adresse et le mot de passe déjà saisis sont repris
document.querySelectorAll('.fenetre .bascule').forEach((a) => a.addEventListener('click', (e) => {
  e.preventDefault();
  const [de, vers] = a.dataset.vers === 'inscription' ? [$('formConnexion'), $('formInscription')] : [$('formInscription'), $('formConnexion')];
  for (const champ of ['email', 'mdp']) if (de.elements[champ].value) vers.elements[champ].value = de.elements[champ].value;
  ouvrir(a.dataset.vers);
}));
$('fermer').addEventListener('click', fermer);

// Lien direct vers la fenêtre : /jeudis-analyse/?compte=connexion ou ?compte=inscription
const params = new URLSearchParams(location.search);
const compte = params.get('compte');
const retourDemande = params.get('retour');
// Seulement une page de ce site
let retour = retourDemande && /^\/(?!\/)/.test(retourDemande) ? retourDemande : null;
if (compte === 'connexion' || compte === 'inscription') {
  history.replaceState(null, '', location.pathname);
  ouvrir(compte);
}

// Retour du lien de confirmation
const confirmation = new URLSearchParams(location.search).get('confirmation');
if (confirmation) {
  history.replaceState(null, '', location.pathname);
  let apres = null;
  try { apres = localStorage.getItem('cami-retour'); localStorage.removeItem('cami-retour'); } catch {}
  if (confirmation === 'ok' && apres) location.replace(apres);
  $('detail').innerHTML = confirmation === 'ok'
    ? '<p class="message">Inscription confirmée, bienvenue !</p>'
    : '<p class="erreur">Ce lien de confirmation n’est pas (ou plus) valide.</p>';
}

appliquerGenre();
charger();
