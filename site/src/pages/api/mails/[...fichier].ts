// Modèles des mails (src/content/mails/, sous-dossiers compris) copiés dans dist/api/mails/
// pour les scripts PHP (lecture interdite depuis le Web : public/api/mails/.htaccess).
// Les modèles .html sont publiés en .html.txt (ce ne sont pas des pages du site).
import { readFileSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';

const RACINE = join(process.cwd(), 'src/content/mails');

function fichiers(dossier: string): string[] {
  return readdirSync(dossier, { withFileTypes: true }).flatMap((f) =>
    f.isDirectory() ? fichiers(join(dossier, f.name)) : /\.(txt|html)$/.test(f.name) ? [join(dossier, f.name)] : []);
}

export function getStaticPaths() {
  return fichiers(RACINE).map((f) => ({ params: { fichier: relative(RACINE, f).replace(/\.html$/, '.html.txt') } }));
}

export function GET({ params }: { params: { fichier: string } }) {
  return new Response(readFileSync(join(RACINE, params.fichier.replace(/\.html\.txt$/, '.html')), 'utf-8'));
}
