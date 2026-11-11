---
game: Throw Football
gameSlug: throw-football
canDie: false
hasScore: true
rewards: true
roomSize: 15
hosting: boxity
partyPlay: automatic (case A)
playWithFriends: automatic (case A)
gems: false
---

# Throw Football - Bloxity integration notes

## Answers from the developer

- **canDie: false.** Sacks, tackles, interceptions and failed drives are football outcomes, not deaths. No one respawns, so there is no death screen.
- **hasScore: true.** One board: `touchdowns` (label "Touchdowns", higher wins, `sum` +1 per touchdown, resets weekly and keeps All Time). The browser declares it; the server reports it from its own state.
- **rewards: true.** One rewarded placement: `double-earnings`, offered on the win screen. The server verifies the reward token with Boxity and doubles the cash from that game, once.
- **gems: false.** The game has no purchases of any kind.

## Where things live

| Feature | Files |
| --- | --- |
| SDK bridge (init, auth, settings, emotes, chat, ads, leaderboard define) | `client/src/bloxity/Bloxity.ts`, started first in `client/src/main.ts` |
| Environment helper | `client/src/bloxity/environment.ts`, `server/src/config/boxityEnv.ts` |
| Matchmaker join, retry, `?roomId=` | `client/src/net/Net.ts`, `RoomLocator.ts`, `deepLink.ts` |
| Rejoin after an unexpected disconnect | `client/src/game/Game.ts` (`reconnect`) |
| Screen ads and banner-safe layout | `client/src/ui/AdLayout.ts`, `.hud` / `.modal` insets in `client/src/ui/styles.css` |
| Rewarded ad | `client/src/game/Game.ts` (`doubleOffer`), `server/src/bloxity/adRewards.ts`, `FootballRoom.adReward` |
| Stats and leaderboard reporting | `server/src/bloxity/reporting.ts` |
| Open Rooms reporter | `server/src/legion-room-reporter.ts` |
| Token verify and guest carry-over | `server/src/auth/BloxityAuth.ts`, `FootballRoom.resolve` |
| Deploy (prod + optional stage) | `.github/workflows/deploy.yml` |
