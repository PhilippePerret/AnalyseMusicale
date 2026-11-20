export const EMAIL = 'philippe.perret@analyse-musicale.fr';

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
export const TABLE_ANALYSE_VERSION = '2.1.6';
const RELEASE = `https://github.com/PhilippePerret/TableAnalyse-nodejs/releases/download/v${TABLE_ANALYSE_VERSION}`;

export const TABLE_ANALYSE = {
  version: TABLE_ANALYSE_VERSION,
  telechargements: [
    { systeme: 'macOS',   fichier: `${RELEASE}/Table-Analyse-${TABLE_ANALYSE_VERSION}.dmg` },
    { systeme: 'Windows', fichier: `${RELEASE}/Table-Analyse-${TABLE_ANALYSE_VERSION}.exe` },
    { systeme: 'Linux',   fichier: `${RELEASE}/Table-Analyse-${TABLE_ANALYSE_VERSION}.AppImage` },
  ],
  demo: 'https://pub-5a52415c078f488e91f8d3fdc8d51585.r2.dev/table-analyse/premiere-utilisation.mp4',
  // Commande Terminal sortant l'application de la quarantaine (macOS, application non signée)
  deblocageMac: 'xattr -dr com.apple.quarantine /Applications/Table-d-analyse.app',
};
