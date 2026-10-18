import type { CallOptions, CodeRef, ConceptLookup, ConceptRef } from '../../core/types.ts';
import type { RemoteOptions } from '../shared/http.ts';
import { fold, unique } from '../shared/text.ts';
import { createTermResolver } from './resolve.ts';
import type { TermResolver, TermVariants } from './resolve.ts';

export interface LookupOptions extends RemoteOptions {
  /** Language of concept labels when the call does not pass one. Default `de`. */
  language?: string;
  /** Term bridge used by English-only APIs; defaults to the Wikidata based `resolveTermVariants`. */
  resolve?: TermResolver;
}

/** A `ConceptLookup` that also tells the integrator whether browsers need a proxy. */
export interface RemoteConceptLookup extends ConceptLookup {
  readonly locality: 'remote';
  readonly needsProxy: boolean;
}

export function languageOf(opts: CallOptions | undefined, fallback: string | undefined): string {
  return (opts?.language ?? fallback ?? 'de').split('-')[0]!.toLowerCase();
}

export function codeOf(codes: CodeRef[] | undefined, system: string): string | undefined {
  const wanted = fold(system);
  return codes?.find((c) => fold(c.system) === wanted)?.code;
}

export function resolverOf(opts: LookupOptions): TermResolver {
  return opts.resolve ?? createTermResolver(opts);
}

/** English search names for a concept, best first: resolved English name, the label itself, aliases. */
export function searchNames(concept: ConceptRef, variants: TermVariants | null, max = 4): string[] {
  const names = [variants?.english, concept.label, ...(variants?.aliases ?? [])].filter((n): n is string => !!n);
  return unique(names, fold).slice(0, max);
}

export function isDrugType(concept: ConceptRef): boolean {
  return concept.type === 'medication' || concept.type === 'substance';
}
