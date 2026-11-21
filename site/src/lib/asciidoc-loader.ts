// Loader Astro maison : lit les fichiers .adoc d'un dossier et les convertit
// en HTML avec Asciidoctor.js. Les attributs d'en-tête du document
// (:description:, :objet-contact:, :bande:) deviennent les données de l'entrée.
import { readdir, readFile } from 'node:fs/promises';
import { join, resolve, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { load, convert } from '@asciidoctor/core';
import { marqueCami } from './site';
import type { Loader, LoaderContext } from 'astro/loaders';

export function asciidocLoader({ base }: { base: string }): Loader {
  return {
    name: 'asciidoc-loader',
    load: async (context: LoaderContext) => {
      const root = fileURLToPath(context.config.root);
      const dir = resolve(root, base);
      // Identifiant = chemin relatif sans extension : jeudis-analyse/detail.adoc → jeudis-analyse/detail
      const idDe = (path: string) => relative(dir, path).replace(/\.adoc$/, '').split(sep).join('/');

      const loadFile = async (path: string) => {
        const id = idDe(path);
        const source = await readFile(path, 'utf-8');
        const digest = context.generateDigest(source);
        const existing = context.store.get(id);
        if (existing && existing.digest === digest) return;

        const doc = await load(source, { safe: 'safe', attributes: { showtitle: false } });
        const attrs = doc.getAttributes() as Record<string, string>;
        const data = await context.parseData({
          id,
          filePath: relative(root, path),
          data: {
            title: (doc.getDocumentTitle({ sanitize: true }) as string | null) ?? id,
            description: attrs['description'],
            objetContact: attrs['objet-contact'],
            bande: attrs['bande'] && marqueCami((await convert(attrs['bande'], { doctype: 'inline' })) as string),
          },
        });
        context.store.set({
          id,
          data,
          body: source,
          filePath: relative(root, path),
          digest,
          rendered: { html: marqueCami(await doc.convert()) },
        });
      };

      context.store.clear();
      for (const name of await readdir(dir, { recursive: true })) {
        if (name.endsWith('.adoc')) await loadFile(join(dir, name));
      }

      // Rechargement à chaud en mode dev
      if (!context.watcher) return;
      context.watcher.add(dir);
      context.watcher.on('change', async (path) => {
        if (path.startsWith(dir) && path.endsWith('.adoc')) await loadFile(path);
      });
      context.watcher.on('add', async (path) => {
        if (path.startsWith(dir) && path.endsWith('.adoc')) await loadFile(path);
      });
      context.watcher.on('unlink', (path) => {
        if (path.startsWith(dir) && path.endsWith('.adoc')) context.store.delete(idDe(path));
      });
    },
  };
}
