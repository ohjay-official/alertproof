/**
 * Words on the verdict screens and the spoken result, in English and French.
 * The verdict is what a trader must understand at a glance, so it comes first.
 * French written by Claude; a native speaker's review is still to come.
 */
import { REASON_EN, type FailCode } from '../../../src/verify/index.ts';

export type Lang = 'en' | 'fr';

const REASON_FR: Record<FailCode, string> = {
  malformed: "Ce n'est pas un reçu valide.",
  wrong_unit: "Ce reçu n'est pas en sats.",
  untrusted_mint: 'Pas de votre mint.',
  mint_not_ready: 'Votre mint ne peut pas bloquer les paiements pour vous. Choisissez-en un autre.',
  unknown_keys: 'Impossible de confirmer ce reçu avec les clés enregistrées de votre mint.',
  missing_dleq: 'Ce reçu ne peut pas être vérifié hors ligne.',
  not_locked_to_you: "Cet argent n'est pas bloqué pour vous.",
  can_be_taken_back: 'Le payeur pourrait reprendre cet argent.',
  shared_lock: "Quelqu'un d'autre pourrait aussi dépenser cet argent.",
  unsupported_lock: "Ce reçu a des conditions que Sealpay n'accepte pas.",
  bad_signature: 'Pas signé par votre mint.',
  underpaid: 'Payé en partie. Cette partie est gardée ; demandez le reste.',
  already_received: 'Ne donnez pas de marchandise pour lui une deuxième fois.',
};

export function words(lang: Lang) {
  const fr = lang === 'fr';
  return {
    paid: fr ? 'Payé' : 'Paid',
    notPaid: fr ? 'Pas payé' : 'Not paid',
    used: fr ? 'Déjà utilisé' : 'Already used',
    part: fr ? 'Payé en partie' : 'Part paid',
    dontRelease: fr ? 'Ne donnez pas la marchandise.' : "Don't release the goods.",
    scannedBefore: fr ? 'Ce reçu a déjà été scanné.' : 'This receipt was scanned before.',
    lockedToYou: (s: string) => (fr ? `${s}, bloqués pour vous` : `${s}, locked to you`),
    moreThanAsked: (s: string) => (fr ? `${s} de plus que demandé.` : `${s} more than you asked.`),
    checkedOffline: fr ? "Vérifié sur ce téléphone. Pas besoin d'internet." : 'Checked on this phone. No internet needed.',
    screenSays: fr
      ? "Peu importe ce que montre l'écran du client, ce téléphone a vérifié le reçu lui-même."
      : 'Whatever the customer’s screen says, this phone checked the receipt itself.',
    cameOnce: fr ? "L'argent est arrivé une seule fois, au premier scan." : 'The money for it came in once, the first time it was scanned.',
    gotAskMore: (got: string, more: string) => (fr ? `Reçu ${got}. Demandez encore ${more}.` : `Got ${got}. Ask for ${more} more.`),
    partKept: fr
      ? "Cette partie est gardée et elle est à vous. Gardez la marchandise jusqu'au reste."
      : 'This part is kept and is yours. Hold the goods until the rest is paid.',
    nextSale: fr ? 'Vente suivante' : 'Next sale',
    scanAgain: fr ? 'Scanner encore' : 'Scan again',
    newSale: fr ? 'Nouvelle vente' : 'New sale',
    askRest: fr ? 'Demander le reste' : 'Ask for the rest',
    done: fr ? 'Terminé' : 'Done',
    restoredOnline: fr
      ? 'Ce téléphone a été restauré : connectez-vous une fois pour qu’il puisse confirmer les reçus.'
      : 'This phone was restored: go online so it can confirm this receipt with the mint.',
    reason: (code: FailCode) => (fr ? REASON_FR[code] : REASON_EN[code]),
    sayPaid: (amount: string) => (fr ? `Payé. ${amount}.` : `Paid. ${amount}.`),
    sayNotPaid: fr ? 'Pas payé. Ne donnez pas la marchandise.' : 'Not paid. Do not release the goods.',
    sayUsed: fr ? 'Déjà utilisé. Ne donnez pas la marchandise.' : 'Already used. Do not release the goods.',
    sayAskMore: (amount: string) => (fr ? `Payé en partie. Demandez encore ${amount}.` : `Part paid. Ask for ${amount} more.`),
    unitWord: (currency: 'NGN' | 'XOF') => (currency === 'XOF' ? 'francs' : 'naira'),
  };
}
