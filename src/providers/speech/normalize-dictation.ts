type Rule = [spoken: RegExp, written: string];

// Recognisers differ: Web Speech in Chrome returns the spoken word ("Komma"), Whisper sometimes
// punctuates on its own and sometimes transcribes the command ("…, Komma, …"). Optional
// punctuation around the command word is swallowed so both end up the same.
const around = (words: string) => new RegExp(String.raw`[ \t]*[,.;:]?[ \t]*(?<![\p{L}\p{N}-])(?:${words})(?![\p{L}\p{N}-])[.,;:]?[ \t]*`, 'giu');

// Marks "a sentence starts here" behind punctuation we inserted ourselves. Capitalising after every
// period in the text would also hit abbreviations ("i.v. gegeben").
const CAP = '\u0001';

const RULES: Record<string, Rule[]> = {
  de: [
    [around('neuer Absatz|nächster Absatz|Absatz'), `\n\n${CAP}`],
    [around('neue Zeile|nächste Zeile|Zeilenumbruch'), `\n${CAP}`],
    [around('Doppelpunkt'), ': '],
    [around('Semikolon|Strichpunkt'), '; '],
    [around('Fragezeichen'), `? ${CAP}`],
    [around('Ausrufezeichen'), `! ${CAP}`],
    [around('Klammer auf'), ' ('],
    [around('Klammer zu'), ') '],
    [around('Schrägstrich'), '/'],
    [around('Bindestrich'), '-'],
    [around('Komma'), ', '],
    [around('Punkt'), `. ${CAP}`],
  ],
  en: [
    [around('new paragraph'), `\n\n${CAP}`],
    [around('new line'), `\n${CAP}`],
    [around('question mark'), `? ${CAP}`],
    [around('exclamation mark|exclamation point'), `! ${CAP}`],
    [around('open parenthesis'), ' ('],
    [around('close parenthesis'), ') '],
    [around('semicolon'), '; '],
    [around('colon'), ': '],
    [around('comma'), ', '],
    [around('full stop|period'), `. ${CAP}`],
  ],
  fr: [
    [around('nouveau paragraphe|nouvel alinéa'), `\n\n${CAP}`],
    [around('nouvelle ligne|à la ligne|retour à la ligne'), `\n${CAP}`],
    [around("point d'interrogation|point d’interrogation"), `? ${CAP}`],
    [around("point d'exclamation|point d’exclamation"), `! ${CAP}`],
    [around('ouvrir la parenthèse|ouvrez la parenthèse|parenthèse ouvrante'), ' ('],
    [around('fermer la parenthèse|fermez la parenthèse|parenthèse fermante'), ') '],
    [around('point-virgule|point virgule'), '; '],
    [around('deux-points|deux points'), ': '],
    [around('virgule'), ', '],
    [around('point'), `. ${CAP}`],
  ],
};

/**
 * Turns dictated punctuation and layout commands into characters ("Punkt" → ".", "neue Zeile" →
 * line break) and tidies spacing. Words after a sentence end inside the text are capitalised; the
 * first word is left as recognised, because only the editor knows whether the text continues a
 * sentence. Limitation: a literal use of a
 * command word ("McBurney-Punkt" is safe thanks to the hyphen, "der Punkt ist" is not) cannot be
 * told apart from the command.
 */
export function normalizeDictation(text: string, language = 'de'): string {
  const rules = RULES[language.toLowerCase().split('-')[0] ?? ''];
  if (!rules) return text.trim();
  let out = text;
  for (const [spoken, written] of rules) out = out.replace(spoken, written);
  return out
    .replace(/\u0001([\s\u0001]*)(\p{L})?/gu, (_m, gap: string, letter?: string) => gap.replaceAll(CAP, '') + (letter?.toUpperCase() ?? ''))
    .replace(/[ \t]+([.,;:?!)])/g, '$1')
    .replace(/\(\s+/g, '(')
    .replace(/([.,;:?!])\1+/g, '$1')
    .replace(/,([.;:?!])/g, '$1')
    .replace(/[ \t]*\n[ \t]*/g, '\n')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/^[ \t]+|[ \t]+$/g, '');
}
