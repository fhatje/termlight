// @vitest-environment node
import { describe, expect, it } from 'vitest';
import type { LlmProvider } from '../../core/types.ts';
import { analyzeQuestion, detectAspect, heuristicEntities } from './question.ts';

const llmThatFails: LlmProvider = {
  id: 'none',
  label: 'none',
  locality: 'local',
  complete: async () => {
    throw new Error('must not be called');
  },
};

describe('question analysis', () => {
  it('detects the aspect in German and English', () => {
    expect(detectAspect('Kontraindikationen für Metamizol')?.id).toBe('contraindication');
    expect(detectAspect('Gegenanzeigen von Novalgin')?.id).toBe('contraindication');
    expect(detectAspect('Indikationen für Metamizol')?.id).toBe('indication');
    expect(detectAspect('Dosierung Amoxicillin bei Kindern')?.id).toBe('dosage');
    expect(detectAspect('Wechselwirkungen von Metamizol und Methotrexat')?.id).toBe('interaction');
    expect(detectAspect('Metamizol in der Schwangerschaft')?.id).toBe('pregnancy');
    expect(detectAspect('adverse effects of metamizole')?.id).toBe('adverse');
    expect(detectAspect('Metamizol')).toBeUndefined();
  });

  it('extracts entities from simple questions without a model', async () => {
    expect(heuristicEntities('Kontraindikationen für Metamizol?', detectAspect('Kontraindikationen'))).toEqual(['Metamizol']);
    expect(heuristicEntities('Therapie der akuten Pankreatitis', detectAspect('Therapie'))).toEqual(['akuten Pankreatitis']);
    const a = await analyzeQuestion('Wechselwirkungen von Metamizol und Methotrexat', undefined, llmThatFails);
    expect(a).toMatchObject({ entities: ['Metamizol', 'Methotrexat'], via: 'heuristic' });
    expect(a.aspect?.id).toBe('interaction');
  });

  it('prefers the clicked concept', async () => {
    const a = await analyzeQuestion('Welche Kontraindikationen gibt es hier zu beachten und warum eigentlich genau?', 'Metamizol', llmThatFails);
    expect(a).toMatchObject({ entities: ['Metamizol'], via: 'concept' });
  });

  it('asks the model for complex questions and survives sloppy JSON', async () => {
    const llm: LlmProvider = {
      ...llmThatFails,
      complete: async () => ({ text: 'Gerne:\n```json\n{"begriffe": ["Metamizol", "Niereninsuffizienz"], "aspekt": "Dosierung"}\n```' }),
    };
    const a = await analyzeQuestion('Muss ich bei einem älteren Patienten mit eingeschränkter Nierenfunktion die Metamizol-Gabe anpassen', undefined, llm);
    expect(a.via).toBe('llm');
    expect(a.entities).toEqual(['Metamizol', 'Niereninsuffizienz']);
  });

  it('falls back to no entities when the model is unusable', async () => {
    const llm: LlmProvider = { ...llmThatFails, complete: async () => ({ text: 'keine Ahnung' }) };
    const a = await analyzeQuestion('Was mache ich wenn der Patient nach der Gabe plötzlich hohes Fieber und Halsschmerzen entwickelt', undefined, llm);
    expect(a).toMatchObject({ entities: [], via: 'fallback' });
  });
});
