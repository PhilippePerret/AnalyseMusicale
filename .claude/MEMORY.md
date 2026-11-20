# MEMORY — analyse_musicale


- URL du site (actuel et futur site Astro) : https://www.analyse-musicale.fr
- Projet : migrer l'embryon de site statique (4 pages .htm/.html + styles.css + .htaccess Apache) vers Astro. Site léger, statique, facile à déployer/actualiser.

## Décisions (2026-11-15)

1. Hébergement : Alwaysdata (conservé). Déploiement : push GitHub (git@github.com:PhilippePerret/AnalyseMusicale.git) → GitHub Action → build Astro → rsync/SSH vers Alwaysdata.
2. Contenu : mixte — AsciiDoc pour les pages de texte, .astro pour pages à mise en page spécifique (accueil). AsciiDoc via loader maison basé sur Asciidoctor.js officiel (pas de paquet communautaire).
3. Contenu actuel repris comme point de départ ; il évoluera vite.
4. Design : look actuel conservé (identité, logo, Quicksand) + responsive + ajustements de lisibilité (largeur de texte, tailles/espacements cohérents, blocs accueil empilés sur mobile). PAS de « modernisation » façon gabarit standard.
5. URL sans extension (/jeudis-analyse/). PAS de redirections 301. TODO Phil après mise en ligne : signaler les nouvelles adresses à Google (Search Console + sitemap).
6. Contact : formulaire avec petit script serveur (PHP Alwaysdata), simple.
7. Nom : « Cours d'Analyse Musicale », nom court « CAMI » (MI = MusIcale).
8. Police Quicksand hébergée sur le site (pas de Google Fonts).
9. Stats : celles d'Alwaysdata uniquement, aucun script.
11. ⚠️ Alwaysdata héberge TOUS les sites de Phil : aucune connexion/action sur le serveur sans accord explicite ; déploiement limité au seul dossier de ce site, jamais de --delete hors de ce dossier.
12. Dossier du site sur Alwaysdata : /home/icare/www/analyse_musicale/ (compte probable : icare). SEULE cible autorisée du déploiement.
13. Dossier distant ne contient rien d'autre que le site : le déploiement peut en remplacer tout le contenu (et seulement ce dossier).
14. Formulaire : anti-spam par champ piège invisible ; destinataire philippe.perret@analyse-musicale.fr.
15. Formulaire sur page unique /contact/, objet prérempli selon la page d'origine ; adresse e-mail reste aussi affichée/cliquable.
16. Tests (build, liens cassés, formulaire) : Claude AUTORISÉ à les écrire ET à les lancer sur ce projet.
10. Structure : projet Astro dans le sous-dossier `site/` (révisé 2026-11-15). Racine du dépôt garde d'autres fichiers à côté, notamment `scripts/` (scripts pratiques : ouvrir le site en local, actualiser…).
17. Scripts pour Phil : TOUJOURS des fichiers `.command` (double-clic), dans `scripts/`. Jamais de .sh.
18. Expéditeur des mails du formulaire : contact@analyse-musicale.fr (adresse créée par Phil). Reply-To = adresse du visiteur.
19. Base SQLite (inscrits + jeudis) : /home/icare/data/analyse_musicale/cami.sqlite — HORS dossier web, jamais touchée par le déploiement. Seul emplacement hors du dossier du site où le PHP écrit.
20. Saisie des jeudis : page /admin/ protégée par mot de passe.
21. Participation : « en général » (bit dans prefs), pas par jeudi.
22. Inscription : mail de confirmation (double opt-in) obligatoire.
23. Formulaire inscription page Jeudis : e-mail + « Pseudo (facultatif) » + ☐ m'avertir des prochains jeudis + ☐ je compte venir en auditeur libre.
24. Calendrier Jeudis : version A retenue (maquette scratchpad calendrier-jeudis-A.html) — année en titre séparé, mois capitalisés, « Jeudi 1^er^ / Jeudi 8 », compositeur dans la case, œil en bas à droite → direct YouTube, survol = couleurs inversées, horaire « direct YouTube de 19 h à 22 h ».
25. RÉVISE 21 : participation PAR JEUDI (bouton « Je serai présent » dans la fiche) → système d'identification complet (connexion e-mail + mot de passe, inscription depuis la fenêtre de connexion). Table de liaison inscrits ↔ jeudis.
26. Maquette calendrier v3 : survol = BLEU ; VERT = uniquement jour courant (si séance aujourd'hui). Œil seulement : passé (« Revoir l'analyse ») ou en cours (« Suivre l'analyse en direct »), couleur = teinte principale. Titre « Les jeudis de l'analyse », sous-titre « Session d'analyses musicales en direct », rubrique « CALENDRIER », mois en capitales.
27. Lien « Rejoindre l'analyse en direct » : grisé/inactif avant l'heure de début, actif pendant, remplacé par « Revoir l'analyse » après. Chaque séance a début/fin (défaut 19:00–22:00).
28. RÉVISE 20 : édition des jeudis directement depuis le calendrier quand Phil est connecté (lien « Éditer » en haut à droite de la fiche, aussi sur jeudis sans séance). Champs : compositeur, œuvre, analyste (défaut Ph. Perret), début, fin, lien YouTube.
29. Teinte principale du site : ARDOISE #3e4a54 (remplace le vert #306a30). Vert réservé au jour courant, bleu au survol.
30. Maquette calendrier VALIDÉE (2026-11-15) : scratchpad calendrier-jeudis-A.html. Formulaire d'édition : titre « Créer/Modifier la séance du jeudi N mois AAAA », compositeur petit, œuvre grand, analyste petit, début = menu SEUL 9:00→21:00, fin = menu SEUL 9:00→23:00 (pas de champ texte) ; analyste + début + fin sur une seule ligne ; titres des boîtes détail/édition en CAPITALES ; bouton « Supprimer » encadré, lien YouTube court en regard du libellé, « Enregistrer » à droite. ^xxx^ → exposant dans les textes affichés. Sous-titre en italique.
31. RÈGLE UI ABSOLUE : JAMAIS de bouton « Supprimer » à l'emplacement d'un bouton « Enregistrer » (ni à la place d'un autre bouton). Suppression toujours à l'écart + confirmation par clic. **Why:** Phil a détruit des données en cliquant au réflexe. **How to apply:** toute action destructrice = zone séparée + confirmation explicite.
32. Page Jeudis : « CALENDRIER » en gros à gauche ; à droite (50 %) : « Les **sessions d'analyses en direct** permettent d'assister, en auditeur ou auditrice libre ou actif•ve, à des analyses musicales rapides consistant principalement au chiffrage des partitions, à la recherche de forme et à l'analyse des principaux éléments. »
33. Genre des users (comme Label-de-qualite) : champ « Vous êtes… » une femme (F) / un homme (H) / discret (N). Textes genrés avec marqueur [masculin|féminin] (« inscrit[|e] », « audit[eur|rice] ») ; N → masculin. Colonne users.genre.
34. Texte page Jeudis : « …en auditeur ou auditrice libre ou active… l'analyse des éléments principaux. »
35. Formulaire édition : « Analyste principal [champ]  Début [menu]  Fin [menu] » sur UNE ligne, libellés en regard des champs.
36. Comptes-rendus : quand la tâche = exactement la demande → répondre « Fait. » sans liste.
37. Calendrier EN LIGNE (2026-11-15) : /jeudis-analyse/ = calendrier ; ancienne page = /jeudis-analyse/detail/ (src/content/pages/jeudis-analyse/detail.adoc, « à reprendre »). API PHP site/public/api/ (_cami.php lib, etat, compte, confirmer, presence, seance). Admin = compte confirmé avec philippe.perret@analyse-musicale.fr (constante ADMINS). Sessions PHP dans /home/icare/data/analyse_musicale/sessions.
38. Déploiement AUTOMATIQUE à chaque push sur main touchant site/ ; scripts/publier.command = commit + push. Clé GitHub bridée rrsync ajoutée dans ~/.ssh/authorized_keys du serveur (sauvegarde authorized_keys.bak-2026-11-15).
39. Une autre session travaille en parallèle dans site/ (page /table-analyse/, telechargement.php, public/donnees/ protégé du --delete).
40. Serveur Alwaysdata : site passé en type PHP par Phil ; PHP CLI 7.4 → code PHP compatible 7.4.
41. EXIGENCE PERMANENTE : travailler PROPREMENT et ESTHÉTIQUEMENT. Formulaires compacts (pas de champs/paddings énormes), libellés EN REGARD des champs (pas bêtement dessous), menus courts, regroupement en blocs. Vérifier visuellement (capture) avant de rendre.
42. Directs YouTube (2026-11-15) : case « Créer le direct YouTube » dans l'édition d'une séance → api/_youtube.php (liveBroadcasts.insert + bind sur un flux unique réutilisable « CAMI — Jeudis de l'analyse », id dans data/analyse_musicale/youtube-flux.json). Public, selfDeclaredMadeForKids=false, programmé au début de séance, titre « Analyses Musicales en Direct — <compositeur>, <œuvre> », description selon modèle de Phil. Jeton : data/analyse_musicale/youtube.json déposé par scripts/youtube-autoriser.command (client_secret : ~/Music/4 pour 2/4pour2/lib/module/api_youtube/modules/client_secret.json). PAS ENCORE TESTÉ contre YouTube.
43. COMMIT EXIGÉ (2026-11-16) : dès qu'une issue/demande est traitée, Claude commite (seulement ses fichiers). PAS de push (Phil s'en charge). **Why:** correctif non commité = jugé non fait.
44. Commit d'une issue traitée : message avec « Fixed #N » (une ligne par issue) → fermeture au push.
45. INTERDICTION FORMELLE des phrases négatives dans les réponses à Phil : toujours formuler positivement.
46. Jamais expliquer à Phil les gestes de base (Mac, fenêtres, logiciels courants) ni rien de non demandé : répondre STRICTEMENT à la question (2026-11-19, OBS : « arrête de me prendre pour un crétin »). Désigner chaque élément sans ambiguïté (nom complet de l'événement, « YouTube Studio » / « OBS Studio », jamais « l'autre », « Studio »). Indiquer explicitement si un fait est NORMAL ou un DANGER. RÉCIDIVE 2026-11-19 (YouTube Studio) : ne JAMAIS paraphraser un message que Phil vient de citer, ne jamais répéter une solution déjà donnée, ne jamais décrire des boutons qu'il voit (« Aperçu », « Enregistrer »). Ne donner que l'information nouvelle.
47. CHARTE : cases à cocher agrandies PARTOUT (règle globale dans global.css, taille relative au texte). Jamais de cases à la taille par défaut du navigateur.
