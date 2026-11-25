// Calendrier des cours (page /cours/student/, issue #13).
// Données et actions : /api/cours.php. Vues mois et semaine.
// Élève : ses cours ; clic sur un créneau libre → placer un cours accordé ou demander un cours ;
//   déplacer / annuler jusqu'à 2 jours avant ; profil = délais des rappels.
// Administrateur : tous les groupes ; clic sur un créneau → nouveau cours ; édition, réponse aux demandes.
// Lien du mail d'inscription comme élève : ?jeton=… → choix du mot de passe.

const MOIS = ['janvier','février','mars','avril','mai','juin','juillet','août','septembre','octobre','novembre','décembre'];
// Mois abrégés de la période affichée (issue #23)
const MOIS_COURTS = ['jan.','fév.','mars','avr.','mai','juin','juil.','aout','sept.','oct.','nov.','déc.'];
const JOURS = ['lundi','mardi','mercredi','jeudi','vendredi','samedi','dimanche'];
const HAUTEUR_HEURE = 2.1;   // rem par heure (vue semaine) — rem : même échelle pour libellés et cours

let etat = null;
let vue = 'semaine';
let ref = new Date();        // jour de référence de la période affichée
let filtreGroupe = '';       // administrateur : groupe affiché ('' : tous)
let choisi = null;           // id du cours affiché dans la fiche
let coursDemande = Number(new URLSearchParams(location.search).get('cours')) || 0;
let message = '';

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const deux = (n) => String(n).padStart(2, '0');
const cle = (d) => `${d.getFullYear()}-${deux(d.getMonth() + 1)}-${deux(d.getDate())}`;
const dateDe = (k) => new Date(`${k}T12:00`);
const minutes = (h) => { const [a, b] = h.split(':').map(Number); return a * 60 + b; };
const hhmm = (m) => `${deux(Math.floor(m / 60))}:${deux(m % 60)}`;
const heure = (h) => { const [hh, mm] = h.split(':'); return `${Number(hh)} h${mm !== '00' ? ' ' + mm : ''}`; };
const duree = (m) => m < 60 ? `${m} min` : `${Math.floor(m / 60)} h${m % 60 ? ' ' + deux(m % 60) : ''}`;
const jourIso = (d) => (d.getDay() + 6) % 7 + 1;   // 1 lundi … 7 dimanche
const lundiDe = (d) => { const l = new Date(d); l.setHours(12, 0, 0, 0); l.setDate(l.getDate() - jourIso(l) + 1); return l; };
const ajouterJours = (d, n) => { const r = new Date(d); r.setDate(r.getDate() + n); return r; };
const premier = (n) => n === 1 ? '1<sup>er</sup>' : String(n);
const dateLongue = (k) => { const d = dateDe(k); return `${JOURS[jourIso(d) - 1]} ${premier(d.getDate())} ${MOIS[d.getMonth()]} ${d.getFullYear()}`; };
const finDe = (debut, d) => { const t = new Date(debut.replace(' ', 'T')); t.setMinutes(t.getMinutes() + d); return `${cle(t)} ${deux(t.getHours())}:${deux(t.getMinutes())}`; };
const quand = (c) => `${dateLongue(c.debut.slice(0, 10))}, ${heure(c.debut.slice(11))} – ${heure(finDe(c.debut, c.duree).slice(11))}`;
const admin = () => !!etat?.admin;
const lien = (v) => /^https?:\/\//.test(v) ? `<a href="${esc(v)}" target="_blank" rel="noopener">${esc(v)}</a>` : esc(v);

async function api(donnees) {
  const options = donnees === undefined ? {} : { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Cami': '1' }, body: JSON.stringify(donnees) };
  const rep = await fetch('/api/cours.php', { credentials: 'same-origin', ...options });
  try { return await rep.json(); } catch { return { ok: false, erreur: 'serveur' }; }
}

const ERREURS = {
  passe: 'Ce créneau est déjà passé.',
  indisponible: 'Ce créneau sort des disponibilités de Philippe Perret.',
  occupe: 'Ce créneau chevauche un autre cours.',
  delai: `Déplacement et annulation sont possibles jusqu’à 2 jours avant le cours. Pour un changement plus tardif, merci d’écrire à Philippe Perret.`,
  debut: 'Date ou heure invalide.',
  duree: 'Durée invalide.',
  groupe: 'Groupe invalide.',
  statut: 'Action impossible pour ce cours.',
  recurrence: 'Rendez-vous régulier : fréquence ou date de fin invalide.',
  email: 'Adresse e-mail invalide.',
  mdp: 'Le mot de passe doit faire au moins 8 caractères.',
  jeton: 'Ce lien n’est pas (ou plus) valide.',
  identifiants: 'Adresse ou mot de passe incorrect.',
  non_confirme: 'Adresse pas encore confirmée : cliquez sur le lien du mail reçu.',
};

// --- Données dérivées ---

const groupe = (id) => etat.groupes.find((g) => g.id === id);
const nomGroupe = (id) => groupe(id)?.nom ?? '';
const maintenant = () => new Date(etat.maintenant.replace(' ', 'T'));

// Disponibilités d'un jour [[début, fin]] en minutes : celles de sa semaine si réglée, sinon générales
function dispos(k) {
  const d = dateDe(k);
  const propres = etat.dispos.semaines[cle(lundiDe(d))];
  const liste = (propres ?? etat.dispos.generales).filter((c) => c.jour === jourIso(d)).map((c) => [minutes(c.debut), minutes(c.fin)]);
  liste.sort((a, b) => a[0] - b[0]);
  return liste.reduce((out, [a, b]) => {
    if (out.length && a <= out[out.length - 1][1]) out[out.length - 1][1] = Math.max(out[out.length - 1][1], b);
    else out.push([a, b]);
    return out;
  }, []);
}

const visibles = () => etat.cours.filter((c) => c.debut && (!filtreGroupe || c.groupe === Number(filtreGroupe)));
const duJour = (k) => visibles().filter((c) => c.debut.startsWith(k) && c.statut !== 'refuse');
const occupesDuJour = (k) => etat.occupes.filter((o) => o.debut.startsWith(k));

// Problème d'un créneau pour l'élève (null : libre)
function probleme(debut, d, sauf = 0) {
  if (new Date(debut.replace(' ', 'T')) <= maintenant()) return 'passe';
  const s = minutes(debut.slice(11)), e = s + d;
  if (!dispos(debut.slice(0, 10)).some(([a, b]) => a <= s && e <= b)) return 'indisponible';
  const t0 = new Date(debut.replace(' ', 'T')).getTime(), t1 = t0 + d * 60000;
  const autres = [...etat.cours.filter((c) => c.id !== sauf && ['place', 'demande'].includes(c.statut) && c.debut), ...etat.occupes];
  if (autres.some((c) => { const a = new Date(c.debut.replace(' ', 'T')).getTime(); return a < t1 && t0 < a + c.duree * 60000; })) return 'occupe';
  return null;
}

// --- Chargement ---

async function charger() {
  const r = await api();
  $('chargement').hidden = true;
  if (!r.ok) { $('chargement').hidden = false; $('chargement').textContent = 'Le calendrier n’a pas pu être chargé.'; return; }
  if (!r.acces) {
    if (r.connecte) $('refus').hidden = false;
    else $('formConnexion').hidden = false;
    return;
  }
  etat = r;
  // Lien du mail « Informer l'élève » : /cours/student/?cours=ID ouvre la fiche du cours (une fois)
  if (coursDemande) {
    const c = etat.cours.find((x) => x.id === coursDemande);
    if (c) { choisi = c.id; if (c.debut) ref = dateDe(c.debut.slice(0, 10)); }
    coursDemande = 0;
  }
  $('contenu').hidden = false;
  rendreTout();
}

function rendreTout() {
  rendreCompte();
  rendreAnnonces();
  rendreOutils();
  rendreCalendrier();
  if (choisi && !etat.cours.find((c) => c.id === choisi)) choisi = null;
  if (choisi) afficherCours(choisi);
  else if (message) { $('detail').innerHTML = `<p class="message">${message}</p>`; message = ''; }
}

function rendreCompte() {
  const u = etat.user;
  $('barreCompte').innerHTML = `Identifié${u.genre === 'F' ? 'e' : ''}${u.pseudo ? ` : ${esc(u.pseudo)}` : ''}${u.admin ? ' (administration)' : ''} — <a href="#" id="deconnexion">Se déconnecter</a>`;
}

// Cours à placer, demandes en attente, demandes refusées
function rendreAnnonces() {
  const lignes = [];
  for (const c of etat.cours) {
    const g = admin() || etat.groupes.length > 1 ? ` (${esc(nomGroupe(c.groupe))})` : '';
    if (c.statut === 'a_placer') {
      lignes.push(admin()
        ? `<li>Cours de ${duree(c.duree)} accordé${g}, pas encore placé — <a href="#" data-cours="${c.id}">voir</a></li>`
        : `<li class="a-placer">Un cours de <strong>${duree(c.duree)}</strong> vous est accordé${g} : cliquez sur un créneau libre du calendrier (vue Semaine) pour le placer.</li>`);
    }
    if (c.statut === 'demande') {
      lignes.push(admin()
        ? `<li class="demande">Demande de cours${g} : ${quand(c)} — <a href="#" data-cours="${c.id}">répondre</a></li>`
        : `<li>Votre demande de cours du ${quand(c)} attend la réponse de Philippe Perret — <a href="#" data-cours="${c.id}">voir</a></li>`);
    }
    if (c.statut === 'refuse' && !admin()) {
      lignes.push(`<li class="refus">Votre demande du ${quand(c)} n’a pas pu être acceptée${c.raison ? ` : ${esc(c.raison)}` : ''} — <a href="#" data-retirer="${c.id}">retirer ce message</a></li>`);
    }
  }
  $('annonces').innerHTML = lignes.length ? `<ul>${lignes.join('')}</ul>` : '';
}

function rendreOutils() {
  if (admin()) {
    const options = etat.groupes.map((g) => `<option value="${g.id}"${String(g.id) === filtreGroupe ? ' selected' : ''}>${esc(g.nom)}</option>`).join('');
    $('outils').innerHTML = `<label>Groupe <select id="filtreGroupe"><option value="">tous</option>${options}</select></label>
      <button type="button" class="bouton" data-outil="nouveau">Nouveau cours…</button>
      <a href="/cours/admin/">Gestion des élèves</a>`;
  } else {
    $('outils').innerHTML = '<button type="button" class="bouton" data-outil="profil">Mon profil…</button>';
  }
  $('vueDispos').hidden = !admin();
  document.querySelectorAll('.bascule-vue').forEach((b) => b.classList.toggle('actif', b.dataset.vue === vue));
}

// --- Calendrier ---

function rendreCalendrier() {
  $('piedDispos').hidden = vue !== 'dispos';
  $('cal').classList.toggle('mode-dispos', vue === 'dispos');
  if (vue === 'dispos') {
    rendreModeDispos();
    $('legende').innerHTML = 'Mode « Dispos » : cliquer ou glisser sur une colonne pour ajouter des disponibilités ; cliquer sur une disponibilité pour en retirer la demi-heure ; tirer ses bords pour l’ajuster. Enregistrement immédiat.';
    return;
  }
  if (vue === 'semaine') rendreSemaine(); else rendreMois();
  $('legende').innerHTML = admin()
    ? 'Cliquer sur un créneau pour créer un cours, sur un cours pour le voir ou le modifier. Zones blanches : disponibilités.'
    : 'Zones blanches : créneaux où Philippe Perret est disponible. Cliquer sur un créneau libre pour placer ou demander un cours.';
}

function bloc(c) {
  const s = minutes(c.debut.slice(11));
  const cls = ['bloc', c.statut, c.id === choisi ? 'choisi' : ''].join(' ');
  const titre = admin() || etat.groupes.length > 1 ? esc(nomGroupe(c.groupe)) : 'Cours';
  return { s, html: `<div class="${cls}" data-cours="${c.id}" style="--debut:${s};--duree:${c.duree}" title="${heure(c.debut.slice(11))} – ${heure(finDe(c.debut, c.duree).slice(11))}">
    <span class="h">${heure(c.debut.slice(11))}</span> ${titre}${c.statut === 'demande' ? ' <em>(demande)</em>' : ''}${c.oeuvres ? `<span class="o">${esc(c.oeuvres)}</span>` : ''}</div>` };
}

function rendreSemaine() {
  const lundi = lundiDe(ref);
  const jours = Array.from({ length: 7 }, (_, i) => ajouterJours(lundi, i));
  const dim = jours[6];
  $('periode').textContent = lundi.getMonth() === dim.getMonth()
    ? `${lundi.getDate()} – ${dim.getDate()} ${MOIS_COURTS[dim.getMonth()]} ${dim.getFullYear()}`
    : `${lundi.getDate()} ${MOIS_COURTS[lundi.getMonth()]} – ${dim.getDate()} ${MOIS_COURTS[dim.getMonth()]} ${dim.getFullYear()}`;
  // Plage horaire : 8 h – 21 h, élargie aux disponibilités et aux cours de la semaine
  let h0 = 8 * 60, h1 = 21 * 60;
  for (const d of jours) {
    const k = cle(d);
    for (const [a, b] of dispos(k)) { h0 = Math.min(h0, a); h1 = Math.max(h1, b); }
    for (const c of [...duJour(k), ...occupesDuJour(k)]) { const s = minutes(c.debut.slice(11)); h0 = Math.min(h0, s); h1 = Math.max(h1, s + c.duree); }
  }
  h0 = Math.floor(h0 / 60) * 60; h1 = Math.min(24 * 60, Math.ceil(h1 / 60) * 60);
  const auj = etat.maintenant.slice(0, 10);
  const entetes = jours.map((d) => `<div class="jour-entete${cle(d) === auj ? ' aujourdhui' : ''}">${JOURS[jourIso(d) - 1].slice(0, 3)}. ${premier(d.getDate())}</div>`).join('');
  const heures = Array.from({ length: (h1 - h0) / 60 }, (_, i) => `<div class="heure">${(h0 / 60) + i} h</div>`).join('');
  const colonnes = jours.map((d) => {
    const k = cle(d);
    const zones = dispos(k).map(([a, b]) => `<div class="dispo" style="--debut:${a};--duree:${b - a}"></div>`).join('');
    const occ = admin() ? '' : occupesDuJour(k).map((o) => `<div class="bloc occupe" style="--debut:${minutes(o.debut.slice(11))};--duree:${o.duree}">occupé</div>`).join('');
    const blocs = duJour(k).map(bloc).map((b) => b.html).join('');
    return `<div class="col-jour${k < auj ? ' passe' : ''}${k === auj ? ' aujourdhui' : ''}" data-k="${k}">${zones}${occ}${blocs}</div>`;
  }).join('');
  $('cal').innerHTML = `<div class="semaine" style="--h0:${h0};--h1:${h1};--hh:${HAUTEUR_HEURE}rem">
    <div class="entetes"><div></div>${entetes}</div>
    <div class="corps"><div class="heures">${heures}</div>${colonnes}</div></div>`;
}

function rendreMois() {
  const a = ref.getFullYear(), m = ref.getMonth();
  $('periode').textContent = `${MOIS_COURTS[m]} ${a}`;
  const debut = lundiDe(new Date(a, m, 1, 12));
  const auj = etat.maintenant.slice(0, 10);
  let h = `<table class="mois"><thead><tr>${JOURS.map((j) => `<th>${j.slice(0, 3)}.</th>`).join('')}</tr></thead><tbody>`;
  for (let d = new Date(debut); d.getMonth() === m || d < new Date(a, m, 1); ) {
    h += '<tr>';
    for (let i = 0; i < 7; i++, d = ajouterJours(d, 1)) {
      const k = cle(d);
      const cls = [d.getMonth() !== m ? 'hors' : '', k === auj ? 'aujourdhui' : '', dispos(k).length ? 'dispo' : '', k < auj ? 'passe' : ''].join(' ');
      const puces = duJour(k).map((c) => `<a href="#" class="puce ${c.statut}" data-cours="${c.id}">${heure(c.debut.slice(11))}${admin() || etat.groupes.length > 1 ? ' ' + esc(nomGroupe(c.groupe)) : ''}</a>`).join('');
      h += `<td class="${cls}" data-k="${k}"><span class="num">${premier(d.getDate())}</span>${puces}</td>`;
    }
    h += '</tr>';
  }
  $('cal').innerHTML = h + '</tbody></table>';
}

// --- Mode « Dispos » (administrateur) : disponibilités de la semaine affichée, réglées dans le calendrier ---
// Repris de SmallCal : une semaine réglée remplace les disponibilités générales ; une semaine pas encore
// réglée part d'une copie des disponibilités générales. Clic : ajoute ou retire une demi-heure ;
// glisser : peint une plage ; tirer un bord : ajuste la plage.

const DISPO_PAS = 30;
const DISPO_H0 = 7 * 60, DISPO_H1 = 22 * 60;
let fileDispos = Promise.resolve();   // enregistrements à la suite (ordre des modifications conservé)

const semaineAffichee = () => cle(lundiDe(ref));
const semaineReglee = (sem) => Object.prototype.hasOwnProperty.call(etat.dispos.semaines, sem);

// Demi-heures disponibles de la semaine, par jour : { jour: Set(minute de début) }
function cellulesDispos(sem) {
  const source = semaineReglee(sem) ? etat.dispos.semaines[sem] : etat.dispos.generales;
  const cells = {};
  for (let j = 1; j <= 7; j++) cells[j] = new Set();
  for (const c of source) for (let t = minutes(c.debut); t < minutes(c.fin); t += DISPO_PAS) cells[c.jour].add(t);
  return cells;
}

// Demi-heures consécutives regroupées en plages [[début, fin], …]
function plages(set) {
  const out = [];
  for (const t of [...set].sort((a, b) => a - b)) {
    const der = out[out.length - 1];
    if (der && der[1] === t) der[1] = t + DISPO_PAS; else out.push([t, t + DISPO_PAS]);
  }
  return out;
}
const regler = (set, a, b, on) => { for (let t = a; t < b; t += DISPO_PAS) on ? set.add(t) : set.delete(t); };
const versCreneaux = (cells) => Object.keys(cells).flatMap((j) => plages(cells[j]).map(([a, b]) => ({ jour: Number(j), debut: hhmm(a), fin: b === 1440 ? '24:00' : hhmm(b) })));

function enregistrerDispos(sem, cells) {
  const creneaux = versCreneaux(cells);
  fileDispos = fileDispos.then(async () => {
    const r = await api({ action: 'dispos_enregistrer', semaine: sem, creneaux });
    if (!r.ok) { $('piedDispos').insertAdjacentHTML('beforeend', '<span class="erreur">Enregistrement impossible.</span>'); return; }
    etat.dispos.semaines[sem] = creneaux;
    if (vue === 'dispos' && semaineAffichee() === sem) rendrePiedDispos(sem);
  });
  return fileDispos;
}

function rendrePiedDispos(sem) {
  const reglee = semaineReglee(sem);
  $('piedDispos').innerHTML = `<button type="button" class="bouton" data-dispos="generales">Définir comme disponibilités générales</button>
    <span class="etat-dispos">${reglee ? 'Semaine réglée' : 'Copie des disponibilités générales'}</span>
    ${reglee ? `<span class="zone-retour"><button type="button" class="lien-supprimer" data-dispos="retour">Revenir aux disponibilités générales…</button>
      <button type="button" class="confirmer" data-dispos="retour-ok" hidden>Confirmer</button></span>` : ''}`;
}

function rendreModeDispos() {
  const lundi = lundiDe(ref);
  const sem = cle(lundi);
  const jours = Array.from({ length: 7 }, (_, i) => ajouterJours(lundi, i));
  const dim = jours[6];
  $('periode').textContent = lundi.getMonth() === dim.getMonth()
    ? `${lundi.getDate()} – ${dim.getDate()} ${MOIS_COURTS[dim.getMonth()]} ${dim.getFullYear()}`
    : `${lundi.getDate()} ${MOIS_COURTS[lundi.getMonth()]} – ${dim.getDate()} ${MOIS_COURTS[dim.getMonth()]} ${dim.getFullYear()}`;
  const cells = cellulesDispos(sem);
  let h0 = DISPO_H0, h1 = DISPO_H1;
  for (let j = 1; j <= 7; j++) for (const [a, b] of plages(cells[j])) { h0 = Math.min(h0, Math.floor(a / 60) * 60); h1 = Math.max(h1, Math.ceil(b / 60) * 60); }
  const auj = etat.maintenant.slice(0, 10);
  const entetes = jours.map((d) => `<div class="jour-entete${cle(d) === auj ? ' aujourdhui' : ''}">${JOURS[jourIso(d) - 1].slice(0, 3)}. ${premier(d.getDate())}</div>`).join('');
  const heures = Array.from({ length: (h1 - h0) / 60 }, (_, i) => `<div class="heure">${(h0 / 60) + i} h</div>`).join('');
  const colonnes = jours.map((d) => `<div class="col-jour col-dispos" data-jour="${jourIso(d)}"><div class="couche"></div><div class="fantome" hidden></div></div>`).join('');
  $('cal').innerHTML = `<div class="semaine" style="--h0:${h0};--h1:${h1};--hh:${HAUTEUR_HEURE}rem">
    <div class="entetes"><div></div>${entetes}</div>
    <div class="corps"><div class="heures">${heures}</div>${colonnes}</div></div>`;
  rendrePiedDispos(sem);

  const rangs = (h1 - h0) / DISPO_PAS;
  $('cal').querySelectorAll('.col-dispos').forEach((col) => {
    const j = Number(col.dataset.jour);
    const couche = col.querySelector('.couche');
    const fantome = col.querySelector('.fantome');
    const dessiner = () => {
      couche.innerHTML = plages(cells[j]).map(([a, b]) => `<div class="plage" data-a="${a}" data-b="${b}" style="--debut:${a};--duree:${b - a}">
        <span class="bord haut"></span><span class="lbl">${heure(hhmm(a))} – ${heure(b === 1440 ? '24:00' : hhmm(b))}</span><span class="bord bas"></span></div>`).join('');
    };
    dessiner();
    const sous = (ev) => {
      const r = col.getBoundingClientRect();
      const k = Math.floor((ev.clientY - r.top) / (r.height / rangs));
      return h0 + Math.max(0, Math.min(rangs - 1, k)) * DISPO_PAS;
    };
    const montrerFantome = (ev) => {
      if (glisse || ev.pointerType === 'touch') { fantome.hidden = true; return; }
      const t = sous(ev);
      fantome.textContent = `${heure(hhmm(t))} – ${heure(hhmm(t + DISPO_PAS))}`;
      fantome.style.setProperty('--debut', t);
      fantome.hidden = false;
    };
    let glisse = null;
    col.addEventListener('pointerleave', () => { fantome.hidden = true; });
    col.addEventListener('pointerdown', (ev) => {
      if (ev.button !== 0) return;
      ev.preventDefault();
      const t = sous(ev);
      const avant = new Set(cells[j]);
      const bord = ev.target.closest('.bord');
      if (bord) {
        const p = bord.closest('.plage');
        glisse = { sorte: bord.classList.contains('haut') ? 'haut' : 'bas', a: +p.dataset.a, b: +p.dataset.b, t, avant };
      } else if (avant.has(t)) {
        const [a, b] = plages(avant).find(([x, y]) => x <= t && t < y);
        glisse = { sorte: 'saisie', a, b, t, avant };
      } else {
        glisse = { sorte: 'peindre', t, avant };
      }
      glisse.bouge = false;
      fantome.hidden = true;
      try { col.setPointerCapture(ev.pointerId); } catch { /* pointeur déjà relâché */ }
    });
    col.addEventListener('pointermove', (ev) => {
      montrerFantome(ev);
      if (!glisse) return;
      const t = sous(ev);
      if (!glisse.bouge && t === glisse.t) return;
      glisse.bouge = true;
      if (glisse.sorte === 'saisie') glisse.sorte = t > glisse.t ? 'bas' : 'haut';
      const set = new Set(glisse.avant);
      if (glisse.sorte === 'peindre') regler(set, Math.min(t, glisse.t), Math.max(t, glisse.t) + DISPO_PAS, true);
      else if (glisse.sorte === 'haut') { regler(set, glisse.a, glisse.b, false); regler(set, Math.min(t, glisse.b - DISPO_PAS), glisse.b, true); }
      else { regler(set, glisse.a, glisse.b, false); regler(set, glisse.a, Math.max(t + DISPO_PAS, glisse.a + DISPO_PAS), true); }
      cells[j] = set;
      dessiner();
    });
    const finir = (annule) => {
      const g = glisse;
      glisse = null;
      if (!g) return;
      if (annule) { cells[j] = g.avant; dessiner(); return; }
      if (!g.bouge) { cells[j].has(g.t) ? cells[j].delete(g.t) : cells[j].add(g.t); dessiner(); }
      enregistrerDispos(sem, cells);
    };
    col.addEventListener('pointerup', (ev) => { finir(false); montrerFantome(ev); });
    col.addEventListener('pointercancel', () => finir(true));
  });
}

$('piedDispos').addEventListener('click', async (e) => {
  const b = e.target.closest('[data-dispos]');
  if (!b) return;
  const sem = semaineAffichee();
  await fileDispos;
  if (b.dataset.dispos === 'retour') { b.hidden = true; b.nextElementSibling.hidden = false; return; }
  if (b.dataset.dispos === 'retour-ok') {
    await api({ action: 'dispos_enregistrer', semaine: sem, creneaux: [], generales: true });
    delete etat.dispos.semaines[sem];
    rendreCalendrier();
    return;
  }
  if (b.dataset.dispos === 'generales') {
    if (!confirm('Remplacer les disponibilités générales par celles de cette semaine ?')) return;
    const creneaux = versCreneaux(cellulesDispos(sem));
    const r = await api({ action: 'dispos_enregistrer', semaine: '', creneaux });
    if (!r.ok) return;
    etat.dispos.generales = creneaux;
    await api({ action: 'dispos_enregistrer', semaine: sem, creneaux: [], generales: true });
    delete etat.dispos.semaines[sem];
    rendreCalendrier();
  }
});

// --- Menus des formulaires ---

const optionsDurees = (val) => Array.from({ length: 240 / etat.pas }, (_, i) => (i + 1) * etat.pas)
  .map((m) => `<option value="${m}"${m === val ? ' selected' : ''}>${duree(m)}</option>`).join('');
const optionsHeures = (val) => Array.from({ length: (24 * 60 - 7 * 60) / etat.pas }, (_, i) => hhmm(7 * 60 + i * etat.pas))
  .map((h) => `<option value="${h}"${h === val ? ' selected' : ''}>${h}</option>`).join('');
const optionsGroupes = (val) => etat.groupes.map((g) => `<option value="${g.id}"${g.id === val ? ' selected' : ''}>${esc(g.nom)}</option>`).join('');

function fiche(html) {
  $('detail').innerHTML = html;
  const r = $('detail').getBoundingClientRect();
  if (r.bottom > window.innerHeight) window.scrollBy({ top: Math.min(r.bottom - window.innerHeight + 30, r.top - 16), behavior: 'smooth' });
}

const erreurForm = (form, code) => {
  let p = form.querySelector('.erreur');
  if (!p) { p = document.createElement('p'); p.className = 'erreur'; form.querySelector('.boutons').before(p); }
  p.textContent = ERREURS[code] || 'Action impossible.';
};

// --- Fiche d'un cours ---

function afficherCours(id) {
  choisi = id;
  const c = etat.cours.find((x) => x.id === id);
  if (!c) return;
  rendreCalendrier();
  const msg = message ? `<p class="message">${message}</p>` : '';
  message = '';
  const editer = admin() ? '<a href="#" class="editer" data-action="editer">Éditer</a>' : '';
  const statut = { a_placer: 'Cours accordé, à placer', demande: 'Demande en attente de réponse', refuse: 'Demande refusée' }[c.statut];
  const infos = [
    c.debut ? `<div class="date">${quand(c)}</div>` : `<div class="date">Cours de ${duree(c.duree)} à placer</div>`,
    statut ? `<div class="statut ${c.statut}">${statut}${c.raison ? ` : ${esc(c.raison)}` : ''}</div>` : '',
    admin() || etat.groupes.length > 1 ? `<div>Groupe : ${esc(nomGroupe(c.groupe))}</div>` : '',
    c.debut ? `<div>Durée : ${duree(c.duree)}</div>` : '',
    c.lieu ? `<div>Lieu : ${lien(c.lieu)}</div>` : '',
    c.oeuvres ? `<div>Œuvre(s) : <strong>${esc(c.oeuvres)}</strong></div>` : '',
    c.travail ? `<div class="travail"><div class="titre">Travail effectué</div>${esc(c.travail)}</div>` : '',
  ].join('');
  let actions = '';
  if (admin() && c.statut === 'demande') {
    actions = `<div class="actions"><button class="bouton" data-action="accepter">Accepter la demande</button></div>
      <div class="zone-suppression" id="zoneRefus"><label class="en-ligne">Raison (facultative) <input name="raison" maxlength="500" size="30"></label><button type="button" class="supprimer" data-action="refuser">Refuser la demande</button></div>`;
  } else if (!admin()) {
    const loin = c.debut && new Date(c.debut.replace(' ', 'T')).getTime() - maintenant().getTime() >= etat.delai_eleve * 3600000;
    if (c.statut === 'place' && loin) {
      actions = `<div class="actions"><button class="bouton" data-action="deplacer">Déplacer ce cours…</button></div>
        <div class="zone-suppression" id="zoneSuppr"><button type="button" class="supprimer" data-action="demander-annulation">Annuler ce cours…</button></div>`;
    } else if (c.statut === 'place' && new Date(c.debut.replace(' ', 'T')) > maintenant()) {
      actions = `<p class="aide">${ERREURS.delai}</p>`;
    } else if (c.statut === 'demande' || c.statut === 'refuse') {
      actions = `<div class="zone-suppression" id="zoneSuppr"><button type="button" class="supprimer" data-action="demander-annulation">Retirer cette demande…</button></div>`;
    } else if (c.statut === 'a_placer') {
      actions = '<p class="aide">Pour le placer : vue Semaine, clic sur un créneau libre.</p>';
    }
  }
  fiche(`${editer}${infos}${actions}${msg}`);
}

// --- Administrateur : création / édition d'un cours ---

function formCours(c, preset = {}) {
  const nouveau = !c;
  const v = c || { groupe: Number(filtreGroupe) || etat.groupes[0]?.id, duree: 60, lieu: '', oeuvres: '', travail: '', statut: 'place', debut: preset.debut || null };
  if (nouveau && v.groupe) v.lieu = groupe(v.groupe)?.lieu || '';
  if (!etat.groupes.length) return fiche('<p class="erreur">Aucun élève : inscrire d’abord un élève dans <a href="/cours/admin/">Gestion des élèves</a>.</p>');
  const aPlacer = v.statut === 'a_placer';
  const jour = v.debut ? v.debut.slice(0, 10) : (preset.jour || cle(ref));
  const h = v.debut ? v.debut.slice(11) : '14:00';
  const lieux = etat.lieux.length ? `<select class="lieux" aria-label="Lieux mémorisés"><option value="">lieux mémorisés…</option>${etat.lieux.map((l) => `<option value="${esc(l.valeur)}">${esc(l.nom)}</option>`).join('')}</select>` : '';
  fiche(`<div class="date">${nouveau ? 'Nouveau cours' : 'Modifier le cours'}</div>
    <form class="edition" id="formCours">
      <div class="rang">
        <label class="en-ligne">Groupe <select name="groupe">${optionsGroupes(v.groupe)}</select></label>
        <label class="en-ligne">Durée <select name="duree">${optionsDurees(v.duree)}</select></label>
        <label class="case"><input type="checkbox" name="a_placer"${aPlacer ? ' checked' : ''}> Créneau à placer par l’élève</label>
      </div>
      <div class="rang horaire"${aPlacer ? ' hidden' : ''}>
        <label class="en-ligne">Date <input type="date" name="jour" value="${jour}"></label>
        <label class="en-ligne">Heure <select name="heure">${optionsHeures(h)}</select></label>
      </div>
      ${nouveau ? `<div class="rang recurrence"${aPlacer ? ' hidden' : ''}>
        <label class="case"><input type="checkbox" name="regulier"> Rendez-vous régulier : tous les</label>
        <input type="number" name="frequence" min="1" max="365" value="1" aria-label="Fréquence">
        <select name="unite" aria-label="Unité"><option value="jour">jours</option><option value="semaine" selected>semaines</option><option value="mois">mois</option></select>
        <label class="en-ligne">jusqu’au <input type="date" name="jusqu_au"></label>
      </div>` : ''}
      <div class="rang"><label class="en-ligne large">Lieu <input name="lieu" value="${esc(v.lieu)}" maxlength="300" placeholder="lien visio ou adresse"></label>${lieux}</div>
      <label class="en-ligne large">Œuvre(s) <input name="oeuvres" value="${esc(v.oeuvres)}" maxlength="500"></label>
      <label class="en-ligne large haut">Travail effectué <textarea name="travail" rows="4" maxlength="5000">${esc(v.travail)}</textarea></label>
      <div class="boutons">
        <button type="button" class="bouton annuler" data-action="annuler">Annuler</button>
        <span class="envoi">${nouveau ? '<label class="case"><input type="checkbox" name="informer" checked> Informer l’élève de ce cours</label>' : ''}
          <button class="bouton">Enregistrer</button></span>
      </div>
    </form>
    ${nouveau ? '' : '<div class="zone-suppression" id="zoneSuppr"><button type="button" class="supprimer" data-action="demander-suppression">Supprimer ce cours…</button></div>'}`);
}

async function enregistrerCours(form) {
  const f = Object.fromEntries(new FormData(form));
  const donnees = {
    action: 'cours_enregistrer', id: choisi || 0, groupe: Number(f.groupe), duree: Number(f.duree),
    a_placer: !!f.a_placer, debut: `${f.jour} ${f.heure}`, lieu: f.lieu, oeuvres: f.oeuvres, travail: f.travail,
  };
  if (form.elements.informer) donnees.informer = form.elements.informer.checked;
  if (f.regulier) donnees.recurrence = { frequence: Number(f.frequence), unite: f.unite, jusqu_au: f.jusqu_au };
  const r = await api(donnees);
  if (!r.ok) return erreurForm(form, r.erreur);
  message = r.nombre > 1 ? `${r.nombre} cours enregistrés.` : 'Cours enregistré.';
  choisi = r.id;
  if (!f.a_placer) ref = dateDe(f.jour);
  await charger();
}

function demanderSuppression(c) {
  $('zoneSuppr').innerHTML = `<span class="confirmer">Supprimer définitivement ce cours ?</span>
    ${c.serie ? '<label class="case"><input type="checkbox" id="supprSerie"> et les cours suivants de la série</label>' : ''}
    ${c.debut ? '<label class="case"><input type="checkbox" id="supprPrevenir" checked> prévenir par mail</label>' : ''}
    <button type="button" data-action="supprimer">Oui, supprimer</button>
    <button type="button" class="non" data-action="annuler">Non</button>`;
}

// --- Élève : créneau cliqué, déplacement, annulation, profil ---

function formCreneau(debut) {
  const k = debut.slice(0, 10);
  const aPlacer = etat.cours.filter((c) => c.statut === 'a_placer');
  const placer = aPlacer.map((c) => {
    const pb = probleme(debut, c.duree);
    return `<div class="rang"><button type="button" class="bouton" data-action="placer" data-id="${c.id}"${pb ? ' disabled' : ''}>Placer ici mon cours accordé (${duree(c.duree)})</button>${pb ? ` <span class="aide">${ERREURS[pb]}</span>` : ''}</div>`;
  }).join('');
  const groupes = etat.groupes.length > 1 ? `<label class="en-ligne">Groupe <select name="groupe">${optionsGroupes(etat.groupes[0].id)}</select></label>` : `<input type="hidden" name="groupe" value="${etat.groupes[0]?.id}">`;
  fiche(`<div class="date">Créneau du ${dateLongue(k)} à ${heure(debut.slice(11))}</div>
    ${placer}
    <form class="edition" id="formDemande">
      <input type="hidden" name="debut" value="${debut}">
      <div class="rang"><span class="titre-rang">Demander un cours</span>
        <label class="en-ligne">Durée <select name="duree">${optionsDurees(60)}</select></label>${groupes}</div>
      <p class="aide">La demande est envoyée à Philippe Perret, qui l’accepte ou la refuse.</p>
      <div class="boutons">
        <button type="button" class="bouton annuler" data-action="annuler">Annuler</button>
        <button class="bouton">Demander ce cours</button>
      </div>
    </form>`);
}

function formDeplacer(c) {
  fiche(`<div class="date">Déplacer le cours du ${quand(c)}</div>
    <form class="edition" id="formDeplacer">
      <div class="rang">
        <label class="en-ligne">Date <input type="date" name="jour" value="${c.debut.slice(0, 10)}" required></label>
        <label class="en-ligne">Heure <select name="heure">${optionsHeures(c.debut.slice(11))}</select></label>
      </div>
      <p class="aide">Le nouveau créneau doit tomber dans les disponibilités (zones blanches de la vue Semaine).</p>
      <div class="boutons">
        <button type="button" class="bouton annuler" data-action="annuler">Annuler</button>
        <button class="bouton">Déplacer</button>
      </div>
    </form>`);
}

const UNITES = [[1440, 'jour(s)'], [60, 'heure(s)'], [1, 'minute(s)']];
function ligneRappel(m) {
  const [u] = UNITES.find(([n]) => m % n === 0);
  return `<div class="rang rappel"><input type="number" name="n" min="1" max="999" value="${m / u}" aria-label="Nombre">
    <select name="u" aria-label="Unité">${UNITES.map(([n, l]) => `<option value="${n}"${n === u ? ' selected' : ''}>${l}</option>`).join('')}</select>
    <span>avant le cours</span> <button type="button" class="retirer" data-action="retirer-rappel" title="Retirer ce rappel">×</button></div>`;
}

function formProfil() {
  choisi = null;
  rendreCalendrier();
  fiche(`<div class="date">Mon profil</div>
    <form class="edition" id="formProfil">
      <div class="titre-rang">Rappels par mail avant chaque cours</div>
      <div id="rappels">${etat.rappels.map(ligneRappel).join('')}</div>
      <div><a href="#" data-action="ajouter-rappel">+ Ajouter un rappel</a></div>
      <div class="boutons">
        <button type="button" class="bouton annuler" data-action="annuler">Annuler</button>
        <button class="bouton">Enregistrer</button>
      </div>
    </form>`);
}

// --- Événements ---

async function agir(donnees, texte) {
  const r = await api(donnees);
  if (!r.ok) { message = `<span class="erreur">${ERREURS[r.erreur] || 'Action impossible.'}</span>`; if (choisi) afficherCours(choisi); else fiche(`<p>${message}</p>`); message = ''; return r; }
  message = texte;
  await charger();
  return r;
}

// Minute cliquée dans une colonne de la vue semaine (arrondie au pas)
function minuteCliquee(colonne, e) {
  const s = getComputedStyle($('cal').querySelector('.semaine'));
  const h0 = Number(s.getPropertyValue('--h0')), h1 = Number(s.getPropertyValue('--h1'));
  const y = e.clientY - colonne.getBoundingClientRect().top;
  const m = h0 + Math.floor((y / colonne.offsetHeight) * (h1 - h0) / etat.pas) * etat.pas;
  return Math.max(h0, Math.min(h1 - etat.pas, m));
}

$('cal').addEventListener('click', (e) => {
  if (vue === 'dispos') return;   // mode « Dispos » : gestes propres (pointerdown…)
  const b = e.target.closest('[data-cours]');
  if (b) { e.preventDefault(); afficherCours(Number(b.dataset.cours)); return; }
  if (e.target.closest('.occupe')) return;
  const col = e.target.closest('.col-jour');
  if (col) {
    const debut = `${col.dataset.k} ${hhmm(minuteCliquee(col, e))}`;
    choisi = null;
    rendreCalendrier();
    if (admin()) formCours(null, { debut });
    else if (!probleme(debut, etat.pas) || etat.cours.some((c) => c.statut === 'a_placer')) formCreneau(debut);
    else fiche(`<p class="erreur">${ERREURS[probleme(debut, etat.pas)]}</p>`);
    return;
  }
  const td = e.target.closest('td[data-k]');
  if (td) { ref = dateDe(td.dataset.k); vue = 'semaine'; rendreOutils(); rendreCalendrier(); }
});

$('annonces').addEventListener('click', async (e) => {
  const a = e.target.closest('[data-cours], [data-retirer]');
  if (!a) return;
  e.preventDefault();
  if (a.dataset.retirer) return agir({ action: 'annuler', id: Number(a.dataset.retirer) }, '');
  const c = etat.cours.find((x) => x.id === Number(a.dataset.cours));
  if (c?.debut) { ref = dateDe(c.debut.slice(0, 10)); vue = 'semaine'; rendreOutils(); }
  afficherCours(Number(a.dataset.cours));
});

document.querySelector('.barre').addEventListener('click', (e) => {
  const b = e.target.closest('button');
  if (!b) return;
  if (b.dataset.vue) { vue = b.dataset.vue; rendreOutils(); rendreCalendrier(); }
  if (b.dataset.pas !== undefined) {
    const pas = Number(b.dataset.pas);
    if (pas === 0) ref = maintenant();
    else if (vue === 'semaine' || vue === 'dispos') ref = ajouterJours(ref, 7 * pas);
    else ref = new Date(ref.getFullYear(), ref.getMonth() + pas, 1, 12);
    rendreCalendrier();
  }
  if (b.dataset.outil === 'nouveau') { choisi = null; rendreCalendrier(); formCours(null); }
  if (b.dataset.outil === 'profil') formProfil();
});
$('outils').addEventListener('change', (e) => { if (e.target.id === 'filtreGroupe') { filtreGroupe = e.target.value; rendreCalendrier(); } });

$('detail').addEventListener('click', async (e) => {
  const a = e.target.closest('[data-action]');
  if (!a || a.disabled) return;
  e.preventDefault();
  const c = etat.cours.find((x) => x.id === choisi);
  const actions = {
    editer: () => formCours(c),
    annuler: () => (choisi ? afficherCours(choisi) : ($('detail').innerHTML = '')),
    accepter: () => agir({ action: 'demande_repondre', id: c.id, accepter: true }, 'Demande acceptée : l’élève est prévenu par mail.'),
    refuser: () => agir({ action: 'demande_repondre', id: c.id, accepter: false, raison: $('zoneRefus').querySelector('input').value }, 'Demande refusée : l’élève est prévenu par mail.'),
    'demander-suppression': () => demanderSuppression(c),
    supprimer: async () => {
      const r = await agir({ action: 'cours_supprimer', id: c.id, serie: !!$('supprSerie')?.checked, prevenir: !!$('supprPrevenir')?.checked }, '');
      if (r.ok) { message = r.nombre > 1 ? `${r.nombre} cours supprimés.` : 'Cours supprimé.'; choisi = null; rendreTout(); }
    },
    'demander-annulation': () => {
      $('zoneSuppr').innerHTML = `<span class="confirmer">${c.statut === 'place' ? 'Annuler ce cours ? Philippe Perret sera prévenu par mail.' : 'Retirer cette demande ?'}</span>
        <button type="button" data-action="confirmer-annulation">Oui</button><button type="button" class="non" data-action="annuler">Non</button>`;
    },
    'confirmer-annulation': async () => { choisi = null; await agir({ action: 'annuler', id: c.id }, c.statut === 'place' ? 'Cours annulé.' : 'Demande retirée.'); },
    deplacer: () => formDeplacer(c),
    placer: async () => {
      const debut = $('detail').querySelector('[name=debut]').value;
      choisi = Number(a.dataset.id);
      await agir({ action: 'placer', id: choisi, debut }, 'Cours placé : Philippe Perret est prévenu par mail.');
    },
    'ajouter-rappel': () => $('rappels').insertAdjacentHTML('beforeend', ligneRappel(1440)),
    'retirer-rappel': () => a.closest('.rappel').remove(),
  };
  await actions[a.dataset.action]?.();
});

$('detail').addEventListener('change', (e) => {
  const form = e.target.form;
  if (!form || form.id !== 'formCours') return;
  if (e.target.name === 'a_placer') form.querySelectorAll('.horaire, .recurrence').forEach((r) => { r.hidden = e.target.checked; });
  if (e.target.classList.contains('lieux') && e.target.value) { form.elements.lieu.value = e.target.value; e.target.value = ''; }
  if (e.target.name === 'groupe' && !choisi) form.elements.lieu.value = groupe(Number(e.target.value))?.lieu || '';
});

$('detail').addEventListener('submit', async (e) => {
  e.preventDefault();
  const form = e.target;
  const f = Object.fromEntries(new FormData(form));
  if (form.id === 'formCours') return enregistrerCours(form);
  if (form.id === 'formDemande') {
    const r = await api({ action: 'demander', groupe: Number(f.groupe), debut: f.debut, duree: Number(f.duree) });
    if (!r.ok) return erreurForm(form, r.erreur);
    message = 'Demande envoyée à Philippe Perret.';
    choisi = null;
    return charger();
  }
  if (form.id === 'formDeplacer') {
    const r = await api({ action: 'deplacer', id: choisi, debut: `${f.jour} ${f.heure}` });
    if (!r.ok) return erreurForm(form, r.erreur);
    message = 'Cours déplacé : Philippe Perret est prévenu par mail.';
    ref = dateDe(f.jour);
    return charger();
  }
  if (form.id === 'formProfil') {
    const delais = [...form.querySelectorAll('.rappel')].map((l) => Number(l.querySelector('[name=n]').value) * Number(l.querySelector('[name=u]').value));
    const r = await api({ action: 'rappels', delais });
    if (!r.ok) return erreurForm(form, r.erreur);
    message = 'Rappels enregistrés.';
    return charger();
  }
});

$('barreCompte').addEventListener('click', async (e) => {
  if (e.target.id !== 'deconnexion') return;
  e.preventDefault();
  await fetch('/api/compte.php', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json', 'X-Cami': '1' }, body: JSON.stringify({ action: 'deconnexion' }) });
  location.reload();
});

function messagePanneau(form, texte) { const m = form.querySelector('.message'); m.textContent = texte; m.hidden = false; }

$('formConnexion').addEventListener('submit', async (e) => {
  e.preventDefault();
  const f = Object.fromEntries(new FormData(e.target));
  const rep = await fetch('/api/compte.php', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json', 'X-Cami': '1' }, body: JSON.stringify({ action: 'connexion', email: f.email, mdp: f.mdp }) });
  const r = await rep.json().catch(() => ({ ok: false }));
  if (!r.ok) return messagePanneau(e.target, ERREURS[r.erreur] || 'Identification impossible.');
  location.reload();
});

const jeton = new URLSearchParams(location.search).get('jeton');
$('formMdp').addEventListener('submit', async (e) => {
  e.preventDefault();
  const f = Object.fromEntries(new FormData(e.target));
  if (f.mdp !== f.mdp2) return messagePanneau(e.target, 'Les deux mots de passe diffèrent.');
  const r = await api({ action: 'definir_mdp', jeton, mdp: f.mdp });
  if (!r.ok) return messagePanneau(e.target, ERREURS[r.erreur] || 'Enregistrement impossible.');
  location.replace(location.pathname);
});

if (jeton) { $('chargement').hidden = true; $('formMdp').hidden = false; }
else charger();
