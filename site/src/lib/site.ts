export const EMAIL = 'philippe.perret@analyse-musicale.fr';

// « Classe d’Analyse Musicale » dans un texte HTML : initiales C, A, M, i aux couleurs du logo (issue #11)
export function marqueCami(html: string): string {
  return html.replace(/Classe d([’'])Analyse Mus[iI]cale/g, (_, apos) =>
    `<span class="cami"><span class="c">C</span>lasse d${apos}<span class="a">A</span>nalyse <span class="m">M</span>us<span class="i">i</span>cale</span>`);
}

// Objets proposés dans le formulaire de contact (clé = paramètre ?objet=)
export const OBJETS_CONTACT = {
  renseignements: 'Renseignements',
  jeudis: 'Les Jeudis de l’analyse',
  cours: 'Les cours d’analyse',
} as const;

export type ObjetContact = keyof typeof OBJETS_CONTACT;

// Table d'analyse (page /table-analyse/) : version (mise à jour par
// _scripts/publier.command de l'application) et fichiers à télécharger,
// publiés dans la Release GitHub de cette version. Valeurs de secours :
// la page affiche la dernière Release lue sur GitHub à l'ouverture ; vidéo de
// démonstration (fichier local de public/, non proposée s'il est absent).
export const TABLE_ANALYSE_VERSION = '2.3.1';
const RELEASE = `https://github.com/PhilippePerret/TableAnalyse-nodejs/releases/download/v${TABLE_ANALYSE_VERSION}`;

export const TABLE_ANALYSE = {
  version: TABLE_ANALYSE_VERSION,
  telechargements: [
    { systeme: 'macOS',   fichier: `${RELEASE}/Table-Analyse-${TABLE_ANALYSE_VERSION}.dmg` },
    { systeme: 'Windows', fichier: `${RELEASE}/Table-Analyse-${TABLE_ANALYSE_VERSION}.exe` },
    { systeme: 'Linux',   fichier: `${RELEASE}/Table-Analyse-${TABLE_ANALYSE_VERSION}.AppImage` },
  ],
  demo: 'https://pub-232cc64dc0ba45a99cac609a6da2369e.r2.dev/table-analyse/premiere-utilisation.mp4',
  // Image affichée avant le lancement de la vidéo
  demoVignette: 'https://pub-232cc64dc0ba45a99cac609a6da2369e.r2.dev/table-analyse/premiere-utilisation.jpg',
  // Commande Terminal sortant l'application de la quarantaine (macOS, application non signée)
  deblocageMac: 'xattr -dr com.apple.quarantine /Applications/Table*analyse.app',
};

// Liens de l'administrateur vers les cours (pages /admin/ et /cours/, en haut à droite)
export const LIENS_COURS_ADMIN = [
  ['/cours/student/', 'Calendrier des cours'],
  ['/cours/admin/', 'Gestion des élèves'],
] as const;

// Liens des pages d'administration (en haut à droite)
export const LIENS_ADMIN: [string, string][] = [
  ['/admin/', 'Adresses'],
  ['/admin/annonces/', 'Annonce Facebook'],
  ...LIENS_COURS_ADMIN,
];
