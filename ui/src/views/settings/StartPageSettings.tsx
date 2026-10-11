import type { Settings } from '../../bridge/types';
import { Toggle } from '../../components/ui/primitives';
import { effectiveStartPage, START_PAGES, startPagePatch, type StartPage } from '../../lib/startPage';
import { useStore } from '../../state/store';
import { APP_NAME } from '../../lib/brand';
import { NewBadge } from '../../whatsnew/NewBadge';

/** Writes a start-page choice (both settings, so the older "Start in Immersive Mode" switch agrees). */
async function choose(page: StartPage) {
  const st = useStore.getState();
  if (!st.settings) return;
  const patch = startPagePatch(page, st.settings);
  // The page first: with Immersive turned off second, nothing in between asks for Immersive by accident.
  if (patch['startup.page'] !== undefined) await st.setSetting('startup.page', patch['startup.page']);
  if (patch['startup.immersive'] !== undefined) await st.setSetting('startup.immersive', patch['startup.immersive']);
}

function hintFor(page: StartPage, s: Settings): string {
  switch (page) {
    case 'last': return 'Arnav Games opens where you left off. A game’s page isn’t kept: you land on the page you opened it from.';
    case 'immersive': return 'The full-screen, controller-first layout. Leaving it takes you to the last page you were on.';
    case 'wishlist': return s['wishlist.sync'] ? 'Arnav Games opens on your Steam wishlist.' : 'Your Steam wishlist isn’t on yet. Until it is, the Wishlist page offers to turn it on.';
    default: return `${APP_NAME} opens on ${START_PAGES.find((p) => p.value === page)?.label ?? 'Home'}, whatever page you were on last.`;
  }
}

/**
 * Track E2a: Settings → Appearance → When Arnav Games opens. The first page you see on every start; the startup
 * snapshot keeps it instant whichever page you pick.
 */
export function StartPageSettings({ s }: { s: Settings }) {
  const page = effectiveStartPage(s);
  return (
    <section className="sgroup">
      <h2 className="sgroup__title">When Arnav Games opens</h2>
      <div className="sgroup__rows surface">
        <div className="srow" data-row="start-page">
          <div className="srow__text">
            <label className="srow__label" htmlFor="startup.page">Open on start<NewBadge k="settings.appearance.start-page" variant="pill" seenWhenVisible /></label>
            <div className="srow__hint" id="startup.page-hint">{hintFor(page, s)}</div>
          </div>
          <div className="srow__control">
            <select id="startup.page" className="input" value={page} aria-describedby="startup.page-hint" onChange={(e) => void choose(e.target.value as StartPage)}>
              {START_PAGES.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}
            </select>
          </div>
        </div>
      </div>
    </section>
  );
}

/**
 * Track E2a: the Controller section's "Start in Immersive Mode" switch, now the same choice as "Open on start":
 * on picks Immersive Mode, off goes back to the last page you were on.
 */
export function StartImmersiveRow({ s }: { s: Settings }) {
  const on = effectiveStartPage(s) === 'immersive';
  return (
    <div className="srow">
      <div className="srow__text">
        <label className="srow__label" htmlFor="startup.immersive">Start in Immersive Mode</label>
        <div className="srow__hint">The full-screen, controller-first layout. Press F11 to switch any time; in Immersive Mode the Menu button opens the guide. The same choice as Open on start in Appearance.</div>
      </div>
      <div className="srow__control">
        <Toggle id="startup.immersive" label="Start in Immersive Mode" checked={on} onChange={(v) => void choose(v ? 'immersive' : 'last')} />
      </div>
    </div>
  );
}
