---
status: idea
sources: [cities/engine.js, mahjong/engine.js, games/table-do.js, cities/transport-mock.js]
updated: 2026-11-19
---
# DeetsBets — table bets for cities and mahjong

> **An idea, talked through in chat on 2026-11-19.** Nothing is built. "His
> words" and "His decisions" are his. Everything else is Claude's proposal
> until he passes over it. **The payout table is his to write** and is left
> blank on purpose.

## His words (chat, 2026-11-19)

- A new worker, **DeetsBets**, that integrates into DeetsCities and
  DeetsMahjong. It acts as the bet engine and the bet calculator, and sends
  results to those workers.
- **A bet against the engine:** "I bet the next roll is a 5, I'll put one wood
  on it." The engine works out the outcome and tells the cities worker to
  remove or give resources.
- **A private bet between two players**, not revealed to the table: "I bet
  John is going to steal from Jane", a bet between Deets and Shaun. Both put
  up resources, and the winner takes all.

## His decisions (chat, 2026-11-19)

- **Two primary routes of betting:** player vs. table, and player vs. player.
  Player vs. player comes **open** (the table sees it) or **secret** (only the
  two parties do).
- **The bet module runs inside each game's Durable Object**, vendored like
  `table-do.js` (fork 1, option a). A DeetsBets worker can come later as a
  ledger the games post settled bets to, the way they post results to
  DeetsAccounts.
- **Cities: staked cards stay in the hand for everything but spending**
  (fork 2, option a). They count in the public total and toward the 7-card
  limit, and the robber can steal one; a stolen or discarded staked card
  leaves the pot. Nothing leaks.
- **Mahjong bets are paid purely in betting points**, never in game score or
  anything else that changes the game. Mahjong is not a resource game the way
  cities is.
- **The house payout table is his**, written fresh after this doc, with no
  draft from Claude.

## What already exists

Cities has half of a betting system: spectator chips, a host toggle and one
bet type ([cities.md](cities.md), "Betting (server built, no client UI)").

- `settings.betting` (host, lobby). With it on, every spectator gets 100 chips
  on join and at Start.
- The `bet` verb rides `extraCommand`. It accepts spectators only, and only the
  `winner` type. The stake leaves `chips` at once and lands in `book`.
- `onGameOver()` pays 2× to whoever picked the winner.
- No page sends the verb. The spectator tile shows "lands in a later build".
- Mahjong has none of it.

**A token leak in it, fixed 2026-11-19.** The `over` view used to send `book`
and `chips` to every viewer, both keyed by device **token**, the identity a
seat is reclaimed with (and the same token at every cities table on that
device). Both fields are gone from the worker's and the mock's `over` view;
each viewer's own balance still rides `you.chips`, and no page read the
removed fields. Worker deployed as `13ff14cb`.

DeetsBets replaces this. Spectator chips become one currency of the new
system, and `winner` becomes one of its propositions.

## The pieces

1. **The bet logic is a pure contract module in this repo** (working name
   `games/bets.js`): the book, offers, acceptance, staking, odds lookup,
   settlement. DOM-free, dual-export, self-tested like every `engine.js`, and
   vendored byte-identical into each game worker (games.md, "Contract
   files"). The `?mock` table runs the same file in the page.
2. **Each game's propositions live in that game's `engine.js`**, the way bot
   brains do: what can be bet on, how an event resolves it, and who controls
   it. `games/bets.js` never learns what a road or a kong is.
3. **The game's Durable Object is the only authority on hands and scores.**
   Every resource a bet moves is an engine action in the game DO, logged like
   a trade and counted in the seat's stats. Because the bet module runs in the
   same DO, a bet settles in the same step as the event that decides it, and
   the payout rides the same broadcast as the roll.

## The two routes

### Player vs. table

One player bets against the engine. The engine pays from the bank (cities) or
the points pool (mahjong) at the return his payout table sets, fixed when the
bet locks. Only props with no controller and an outcome the engine can price
qualify: in cities, the dice. **The bank reserves the full payout when the
bet locks**, so a bank that cannot cover it refuses the bet (`empty`), and the
production rule for an empty bank never meets a hole a bet made.

### Player vs. player

Two parties, one on each side ("yes" and "no"), each naming a stake. On
resolution the winner takes both stakes. When the window closes with the
thing not having happened, "no" wins.

- **Open:** offered to the table or to one named seat. The offer, the
  acceptance and the result are in the log for everyone.
- **Secret:** offered to one named seat. Until settlement its existence and
  terms reach only the two parties (see "Secrecy" below).

### Shape

```
bet = {
  id,                       // per table, never a token
  route: "table" | "open" | "secret",
  prop: { type, params },   // from that game's engine: {type:"rollSum", params:{sum:5}}
  window,                   // "nextRoll", "thisTurn", "byTurn:N", "thisHand", "game"
  parties: [ { seat | spectator, side: "yes"|"no", stake } ],
  ret?,                     // route "table" only: the return, fixed at lock
  state: "offered" | "locked" | "won" | "lost" | "void"
}
```

**Currency.** Cities players stake resource cards. Mahjong players stake
betting points. Spectators stake chips. A bet never mixes currencies. **Never
real money**, and points or chips can never be bought.

## Rules that hold for every bet

**The control rule.** No one who decides a bet's outcome may be a party to it.
Each prop declares its controllers in the engine. "John steals from Jane" is
controlled by John, who picks the robber hex and the victim. "The next roll is
5" has none, because the DO draws the dice from `ctx.rand` at roll time, never
ahead. The engine refuses a bet whose parties include a controller (`perm`).
A non-party nudging an outcome for a friend stays allowed; that is table
politics, the same as kingmaking a trade.

**Lock time.** A bet locks in DO message order, like every other verb. One
that arrives after its event has happened is refused (`phase`), never moved to
the next one. **A bet never pauses a turn or touches `dlSig`**: a pending offer
does not hold the roll, and if the roll lands first the offer dies. Bets on the
roll open when the turn starts and close at `roll`.

**Bots.** Cities and mahjong bots read the whole table, so a bot accepting a
bet would leak what it read (games.md, "Bots"). In v1 bots never place, offer
or accept bets, and an offer to a bot seat is refused.

## Cities

**Props (proposal):** the roll's sum (exact numbers and ranges); who the
robber robs next ("A steals from B"); the robber's next hex; who takes Longest
Road or Largest Army first; who wins.

**Payout table for player vs. table: his to write.**

| Bet | Return per card staked |
| --- | --- |
| | |

Limits per seat and per roll are his to set with the table.

**Staked cards** are marked in the bettor's hand. They cannot be built with,
traded or sold to the bank; for everything else they are ordinary cards (his
decision above).

**Stats.** Bet wins and losses get their own ledger lines (`gained.bets`,
`lost.bets`) so `gained_*` and `spent` stay true. New counters mean new
`seatCounters` columns and an `ALTER TABLE` in DeetsAccounts
([stats.md](stats.md)).

## Mahjong

**Betting points only.** A seat's betting points are a balance of their own,
apart from `score`: they never enter the faan settlement, the standings or who
wins the match. A betting-points balance can't go below zero, so stakes are
held from the balance when a bet locks, as spectator chips are now.

**Props (proposal):** who wins this hand; self-draw or by discard; the hand
ends in an exhaustive draw; the winning hand scores at least N faan; who
deals in. Nearly every mahjong outcome is a player's choice, which the control
rule keeps out of that player's bets. Player vs. table needs an outcome the
engine can price; mahjong may have none in v1, so player vs. player is its
main route.

Bets may span hands ("by the end of this wind"). Open bets survive the
between-hands wait and the dealer repeat.

**For the design pass:** how many points a seat starts with, and whether each
seat's balance is public.

## Secrecy (secret bets only)

Until settlement, a secret bet's existence and terms reach **only its two
parties**:

- only their `you` carries it, and `maskEvent` strips its events for everyone
  else;
- spectators never see it;
- `trace()` never logs its terms, only `{ev:"bet", id, state}`;
- the event archive and the results POST hold it back until the game is over.

**At settlement in cities the payment is public** ("Shaun won a side bet from
Deets: 2 wood"): cards moving between hands can't be hidden. Mahjong's
betting points need not be. Whether the end screen reveals every secret bet,
like the hidden VP cards, is a question for the design pass.

## Bets when a seat changes hands

| Event | Open bets on that seat |
| --- | --- |
| Disconnect, grace runs out, a bot takes over | Kept. The player may reclaim the seat |
| Another human adopts the seat ("anyone" tables) | Void, both stakes back, so the newcomer never sees a secret bet |
| Concede | Void. The concede returns the hand to the bank, so stakes are released first |
| Host kick (seat becomes a bot, token dropped) | Void |
| Game over | Unresolved player-vs-player bets go to "no"; player-vs-table bets void |
| Rematch | Nothing carries over |

## First steps

1. ~~Fix the token leak in the cities `over` view.~~ Done 2026-11-19.
2. His payout table for cities' player-vs-table bets.
3. `games/bets.js` with its self-checks, and cities' props in
   `cities/engine.js`, against the mock.
4. Cities' UI: a bet panel in the hand tile for players, the spectator tile's
   panel for chips. All copy in `cities/strings.js` with `[ph]`.
5. Mahjong's betting points, props and panel.
6. Vendor into both workers and deploy.
