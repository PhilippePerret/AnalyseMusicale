import { defineCollection } from 'astro:content';
import { z } from 'astro/zod';
import { asciidocLoader } from './lib/asciidoc-loader';

// Pages de texte rédigées en AsciiDoc (src/content/pages/*.adoc).
// Le chemin du fichier donne l'adresse : pedagogue.adoc → /pedagogue/,
// jeudis-analyse/detail.adoc → /jeudis-analyse/detail/
const pages = defineCollection({
  loader: asciidocLoader({ base: 'src/content/pages' }),
  schema: z.object({
    title: z.string(),
    description: z.string().optional(),
    bande: z.string().optional(),
    objetContact: z.enum(['renseignements', 'jeudis', 'cours']).default('renseignements'),
  }),
});

export const collections = { pages };
