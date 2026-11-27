// Modèle de la description des directs YouTube (src/content/youtube/description-direct.txt),
// copié dans dist/api/ pour api/_youtube.php.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

export function GET() {
  return new Response(readFileSync(join(process.cwd(), 'src/content/youtube/description-direct.txt'), 'utf-8'));
}
