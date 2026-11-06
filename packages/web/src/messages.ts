/** Every UI string, written once as an [English, French] pair so the two dictionaries cannot drift apart.
 *  English text comes from the existing app, French text from the OpenHangar mockup. `{name}` marks a placeholder; `.one`/`.other` suffixes are plural forms. */
const table = {
  'skip': ['Skip to content', 'Aller au contenu'],
  'nav.main': ['Main', 'Navigation principale'],
  'brand.tagline': ['Career and economy for Microsoft Flight Simulator', 'Carrière et économie pour Microsoft Flight Simulator'],
  'common.loading': ['Loading...', 'Chargement…'],
  'common.signOut': ['Sign out', 'Se déconnecter'],

  'key.esc': ['Esc', 'Échap'],
  'key.enter': ['Enter', 'Entrée'],
  'key.tab': ['Tab', 'Tab'],
  'key.space': ['Space', 'Espace'],
  'hint.back': ['Back', 'Retour'],
  'hint.select': ['Select', 'Sélectionner'],
  'hint.browse': ['Browse', 'Parcourir'],

  'tab.dashboard': ['Dashboard', 'Tableau de bord'],
  'tab.jobs': ['Jobs', 'Jobs'],
  'tab.fleet': ['Fleet', 'Flotte'],
  'tab.history': ['History', 'Historique'],
  'tab.leaderboard': ['Leaderboard', 'Classement'],
  'hud.prevTab': ['Previous tab', 'Onglet précédent'],
  'hud.nextTab': ['Next tab', 'Onglet suivant'],
  'hud.balance': ['Balance', 'Solde'],
  'hud.reputation': ['Reputation', 'Réputation'],
  'hud.company': ['Company', 'Compagnie'],
  'hud.settings': ['Settings', 'Réglages'],
  'hud.globalServer': ['Global server', 'Serveur global'],
  'hud.change': ['Change', 'Changer'],
  'hud.changeHint': ['Sign out to pick another server', 'Se déconnecter pour choisir un autre serveur'],
  'hud.rank': ['Rank {n} · {pct}', 'Rang {n} · {pct}'],
  'hud.season': ['{month} season', 'Saison de {month}'],
  'hud.daysLeft.one': ['{n} day left', 'encore {n} jour'],
  'hud.daysLeft.other': ['{n} days left', 'encore {n} jours'],
  'hud.lastDay': ['last day', 'dernier jour'],
  'hud.antiCheatOff': ['Anti-cheat: off', 'Anti-triche : désactivé'],
  'hud.antiCheatOffHint': ['This server does not check flights for cheating: time acceleration and the like are allowed.', "Ce serveur ne contrôle pas les vols : l'accélération du temps et autres sont permises."],

  'rank.0': ['Student pilot', 'Élève pilote'],
  'rank.1': ['Private pilot', 'Pilote privé'],
  'rank.2': ['Commercial pilot', 'Pilote professionnel'],
  'rank.3': ['First officer', 'Copilote'],
  'rank.4': ['Captain', 'Commandant'],
  'rank.5': ['Senior captain', 'Commandant senior'],
  'legacy.dashboard': ['Dashboard', 'Tableau de bord'],
  'legacy.jobs': ['Job board', 'Job board'],
  'legacy.fleet': ['Fleet', 'Flotte'],
  'legacy.flights': ['Flights', 'Vols'],
  'legacy.leaderboard': ['Leaderboard', 'Classement'],
  'legacy.settings': ['Settings', 'Réglages'],
  'session.ended': ['Your session ended, please sign in again.', 'Ta session a pris fin, reconnecte-toi.'],
  'error.title': ['Error', 'Erreur'],
  // @@ units append below
} as const satisfies Record<string, readonly [string, string]>;

export type Key = keyof typeof table;
const pick = (i: 0 | 1): Record<Key, string> => Object.fromEntries(Object.entries(table).map(([k, v]) => [k, v[i]])) as Record<Key, string>;
export const en = pick(0);
export const fr = pick(1);
