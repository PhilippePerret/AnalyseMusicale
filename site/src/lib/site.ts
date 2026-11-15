export const EMAIL = 'philippe.perret@analyse-musicale.fr';

// Objets proposés dans le formulaire de contact (clé = paramètre ?objet=)
export const OBJETS_CONTACT = {
  renseignements: 'Renseignements',
  jeudis: 'Les Jeudis de l’analyse',
  cours: 'Les cours particuliers',
} as const;

export type ObjetContact = keyof typeof OBJETS_CONTACT;

// Table d'analyse (page /table-analyse/) : version (mise à jour par
// _scripts/publier.command de l'application) et fichiers à télécharger,
// publiés dans la Release GitHub de cette version. Valeurs de secours :
// la page affiche la dernière Release lue sur GitHub à l'ouverture ; vidéo de
// démonstration (fichier local de public/, non proposée s'il est absent).
export const TABLE_ANALYSE_VERSION = '3.0.0';
const RELEASE = `https://github.com/PhilippePerret/TableAnalyse-nodejs/releases/download/v${TABLE_ANALYSE_VERSION}`;

export const TABLE_ANALYSE = {
  version: TABLE_ANALYSE_VERSION,
  telechargements: [
    { systeme: 'macOS',   fichier: `${RELEASE}/Table-d-analyse-${TABLE_ANALYSE_VERSION}-mac.dmg` },
    { systeme: 'Windows', fichier: `${RELEASE}/Table-d-analyse-Setup-${TABLE_ANALYSE_VERSION}.exe` },
    { systeme: 'Linux',   fichier: `${RELEASE}/Table-d-analyse-${TABLE_ANALYSE_VERSION}.AppImage` },
  ],
  demo: '/telechargements/demo-table-analyse.mp4',
};
