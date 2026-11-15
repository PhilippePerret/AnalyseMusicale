export const EMAIL = 'philippe.perret@analyse-musicale.fr';

// Objets proposés dans le formulaire de contact (clé = paramètre ?objet=)
export const OBJETS_CONTACT = {
  renseignements: 'Renseignements',
  jeudis: 'Les Jeudis de l’analyse',
  cours: 'Les cours particuliers',
} as const;

export type ObjetContact = keyof typeof OBJETS_CONTACT;

// Table d'analyse (page /table-analyse/) : version (mise à jour par
// _scripts/publier.command de l'application), fichiers à télécharger
// (déposés dans public/telechargements par ce même script) et vidéo de
// démonstration. Un fichier local absent n'est pas proposé.
export const TABLE_ANALYSE_VERSION = '3.0.0';

export const TABLE_ANALYSE = {
  version: TABLE_ANALYSE_VERSION,
  telechargements: [
    { systeme: 'macOS',   fichier: `/telechargements/Table-d-analyse-${TABLE_ANALYSE_VERSION}-mac.dmg` },
    { systeme: 'Windows', fichier: `/telechargements/Table-d-analyse-Setup-${TABLE_ANALYSE_VERSION}.exe` },
    { systeme: 'Linux',   fichier: `/telechargements/Table-d-analyse-${TABLE_ANALYSE_VERSION}.AppImage` },
  ],
  demo: '/telechargements/demo-table-analyse.mp4',
};
