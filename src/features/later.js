/**
 * The second bundle: features a first flight can do without.
 *
 * features/index.js is what startMode waits for, so every module in it is
 * time a player spends on a loading screen: on the class-demo path at school
 * wifi speed these took the first flight from 14.4 s to 17.2 s. A player's
 * browser fetches this on the menu instead and joins it off the flight
 * (main.js loadLater): a first flight never waits for it, and a second one has
 * it. The automated browsers take it with the first bundle, before the menu.
 * Nothing here wraps startMode, so loading-screens.js stays the outermost.
 */

// Passengers on every airliner flight: boarding at the gate (always skippable), the comfort meter, the PA, the
// Cabin view and the faces in the windows. eject.js shares only passengers/state.js with it, never this file.
import './passengers.js';
// On foot out of your aircraft: Reset (a fresh one at a class spawn, through spawns.js's startAt) and rides
// (get into a parked aeroplane, where it stands). Its startMode places a ride after spawns has had its say.
import './rides.js';
// After rides and achievements: the secret planes in hidden hangars on every map — find one on foot and it
// is in your Hangar for good; every hiding place opens and closes; Air Force One for 80+ on Under Attack.
import './secrets.js';
// Every airport hangar opens and closes by hand (lights come on, a spare Courier in the empty ones), the
// fuel pump, the tower door and the car park barrier: the airfield's things you can use on foot.
import './airfield-use.js';
// The missions' fun pass: medals, twists, finales, "Try again from" (game/fun-kit.js) and the new
// missions, laid over the defs when this joins (game/more/), never while one is being flown.
import './fun-missions.js';
