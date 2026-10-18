/**
 * Words that are never highlighted when a pack offers them as a single-word term, because in
 * running text they are almost always the ordinary word and not the drug / gene / place that
 * happens to share the spelling. An ALL-CAPS dictionary form (e.g. "WAS") survives, but only as
 * an exact-case match. Multi-word terms are unaffected.
 */
const DE = `
ab aber alle allem allen aller alles als also am an ander andere anderem anderen anderer anderes
auch auf aus bei beim bin bis bist da dabei dadurch dafür dagegen daher damit danach dann daran
darauf daraus darf darin darum das dass davon davor dazu dein deine dem den denn der deren des
dessen deshalb die dies diese diesem diesen dieser dieses doch dort du durch eben ein eine einem
einen einer eines einige einmal er es etwa etwas euch euer für ganz gar gegen gehabt geht gibt
gut hab habe haben hat hatte hatten hier hin hinter ich ihm ihn ihnen ihr ihre ihrem ihren ihrer
im immer in ins ist ja je jede jedem jeden jeder jedes jedoch jene jetzt kann kein keine keinem
keinen keiner können könnte lang machen mal man mehr mein meine mich mir mit muss müssen nach
nein nicht nichts noch nun nur ob oder ohne schon sehr sein seine seinem seinen seiner seit sich
sie sind so soll sollen sollte sondern sonst über um und uns unser unter viel viele vom von vor
war waren warum was weg weil weiter welche welcher wenn wer werde werden wie wieder will wir wird
wo wohl wurde wurden zu zum zur zwar zwischen
gross groß klein neu alt hoch tief frei voll leer links rechts oben unten vorn hinten
eins zwei drei vier fünf sechs sieben acht neun zehn erste zweite dritte
tag tage tagen woche wochen monat monate jahr jahre jahren uhr zeit mann frau herr kind fall
fälle art teil ende anfang seite bild zahl wert grad form lage zustand zeichen hinweis
verlauf befund beurteilung indikation technik vergleich untersuchung patient patientin
`;

const EN = `
a about above after again all also am an and any are as at be because been before being below
between both but by can could did do does doing down during each few for from further had has
have having he her here hers him his how i if in into is it its just me more most my no nor not
now of off on once one only or other our out over own same she should so some such than that the
their them then there these they this those through to too two under until up very was we were
what when where which while who whom why will with would you your
back side part case time day days week weeks year years man woman set end may well new old
`;

const FR = `
a au aux avec ce ces cet cette dans de des du elle elles en et eux il ils je la le les leur leurs
lui ma mais me mes moi mon ne nos notre nous on ou où par pas pour qu que qui sa se ses son sur
ta te tes toi ton tu un une vos votre vous y à été être est sont était ont avait fait faire plus
moins très bien tout tous toute toutes autre autres comme donc si ni car sans sous entre vers chez
après avant depuis pendant lors ainsi aussi encore déjà peu trop non oui ici là dont cela ceci
jour jours semaine semaines mois an ans année années heure heures temps fois cas côté part partie
homme femme enfant monsieur madame fin début nombre forme type état signe examen patient patiente
grand grande petit petite nouveau nouvelle ancien haut bas droit droite gauche
un deux trois quatre cinq six sept huit neuf dix premier première second seconde
`;

function words(list: string): string[] {
  return list.split(/\s+/).filter(Boolean);
}

export const GERMAN_STOPWORDS: readonly string[] = words(DE);
export const ENGLISH_STOPWORDS: readonly string[] = words(EN);
export const FRENCH_STOPWORDS: readonly string[] = words(FR);
export const DEFAULT_STOPWORDS: readonly string[] = [...GERMAN_STOPWORDS, ...ENGLISH_STOPWORDS];
