/**
 * The cloud layer's plug: world/cloud-deck.js and its field come with the
 * features, after the menu, so the first load does not carry them. Every
 * world gets one (clouds.js attachLayer), and a new flight takes the sky as it
 * is rather than easing into it.
 */
import { registerExtension } from '../game/extensions.js';
import { CloudDeck } from '../world/cloud-deck.js';

registerExtension({
  id: 'cloud-layer',
  buildWorld(sim, group) {
    if (sim.clouds) sim.clouds.attachLayer(new CloudDeck(group, sim.clouds.quality));
  },
  startMode(sim) {
    if (sim.clouds && sim.clouds.layer) sim.clouds.layer.snap();
    sim.weather.immersion = 0;
  },
  // The menu's sky is not in cloud, whatever the flight was.
  stop(sim) {
    sim.weather.immersion = 0;
  },
});
