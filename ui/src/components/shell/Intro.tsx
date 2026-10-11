import { useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { on } from '../../bridge/bridge';
import { ease } from '../../lib/motion';
import { APP_NAME, WORDMARK } from '../../lib/brand';
import { ASCENT } from '../brand/BrandMark';

const PREF_KEY = 'vystral.introPref';
const PLAYED_KEY = 'vystral.introPlayed';

/**
 * Remembers whether the intro should play, so the decision can be made on the very first
 * frame (settings arrive from the native side a moment later — too late to start an intro).
 */
export function rememberIntroPreference(play: boolean) {
  try {
    localStorage.setItem(PREF_KEY, play ? '1' : '0');
  } catch {
    // storage unavailable: the default (play) applies
  }
}

function shouldPlay(): boolean {
  try {
    if (sessionStorage.getItem(PLAYED_KEY) === '1') return false;
    if (localStorage.getItem(PREF_KEY) === '0') return false;
  } catch {
    // fall through
  }
  if (typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches) return false;
  // Automated test runs set this to start from a settled interface.
  return !new URLSearchParams(location.search).has('nointro');
}

/** The wordmark, letter by letter: ARNAV in the heavier weight, GAMES in the lighter one (docs/BRAND.md › Wordmark). */
const LETTERS = [
  ...[...WORDMARK.bold].map((ch) => ({ ch, light: false, first: false })),
  ...[...WORDMARK.light].map((ch, i) => ({ ch, light: true, first: i === 0 })),
];
const STAR = ASCENT.starCenter;

/**
 * Startup sequence (~1.6s): a light bloom, the two blades of the Ascent mark rise in from either side
 * and meet at the apex, the star ignites with a flare in the A's counter, and the wordmark resolves
 * letter by letter. Played once per app start,
 * skipped instantly by any key, click or controller button, and never delays the app — the
 * interface keeps loading underneath.
 */
export function Intro() {
  const [show, setShow] = useState(shouldPlay);

  useEffect(() => {
    if (!show) return;
    try {
      sessionStorage.setItem(PLAYED_KEY, '1');
    } catch {
      // ignore
    }
    const done = () => setShow(false);
    // Safety cap: the sequence normally ends from the tagline's onAnimationComplete (below),
    // which keeps the timing right even when startup work delays animation frames.
    const t = window.setTimeout(done, 4500);
    const off = on('gamepad.button', (e) => e.pressed && done());
    window.addEventListener('keydown', done);
    window.addEventListener('pointerdown', done);
    return () => {
      window.clearTimeout(t);
      off();
      window.removeEventListener('keydown', done);
      window.removeEventListener('pointerdown', done);
    };
  }, [show]);

  return (
    <AnimatePresence>
      {show && (
        <motion.div
          className="intro"
          aria-hidden
          initial={{ opacity: 1 }}
          exit={{ opacity: 0, transition: { duration: 0.55, ease: ease.out } }}
        >
          <motion.div
            className="intro__bloom"
            initial={{ opacity: 0, scale: 0.6 }}
            animate={{ opacity: [0, 1, 0.7], scale: [0.6, 1.05, 1] }}
            exit={{ opacity: 0, scale: 2.4, transition: { duration: 0.6, ease: ease.out } }}
            transition={{ duration: 1.4, ease: ease.cinematic, times: [0, 0.55, 1] }}
          />
          <motion.div className="intro__stage" exit={{ scale: 1.08, filter: 'blur(6px)', transition: { duration: 0.5, ease: ease.in } }}>
            <svg className="intro__mark" viewBox="0 0 512 512">
              <defs>
                {/* The brand's own paints (docs/BRAND.md › Colour): light from the upper left. */}
                <linearGradient id="iL" gradientUnits="userSpaceOnUse" x1="256" y1="96" x2="138" y2="404">
                  <stop offset="0" stopColor="#F5F2FF" />
                  <stop offset="0.48" stopColor="#BBA8FF" />
                  <stop offset="1" stopColor="#8466FF" />
                </linearGradient>
                <linearGradient id="iR" gradientUnits="userSpaceOnUse" x1="256" y1="96" x2="374" y2="404">
                  <stop offset="0" stopColor="#C9D5FF" />
                  <stop offset="0.48" stopColor="#7F9CFF" />
                  <stop offset="1" stopColor="#3F5FEA" />
                </linearGradient>
                <radialGradient id="iStar" cx="0.5" cy="0.5" r="0.5">
                  <stop offset="0" stopColor="#FFFFFF" />
                  <stop offset="1" stopColor="#EEE8FF" />
                </radialGradient>
                <filter id="iGlow" x="-60%" y="-60%" width="220%" height="220%">
                  <feGaussianBlur stdDeviation="14" />
                </filter>
              </defs>
              {/* Blade glow underlay */}
              <motion.g
                filter="url(#iGlow)"
                initial={{ opacity: 0 }}
                animate={{ opacity: 0.6 }}
                transition={{ delay: 0.35, duration: 0.8 }}
              >
                <path d={ASCENT.lit} fill="#7C5CFF" />
                <path d={ASCENT.shaded} fill="#3D63FF" />
              </motion.g>
              {/* Once both blades land, the whole A in the lit paint fills in under them, so the facet seam
                  never shows a hairline (the brand paints the mark the same way). */}
              <motion.path
                d={ASCENT.silhouette}
                fill="url(#iL)"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ delay: 0.9, duration: 0.12 }}
              />
              {/* The lit blade rises in from the lower left, the shaded one from the lower right. */}
              <motion.path
                d={ASCENT.lit}
                fill="url(#iL)"
                initial={{ x: -70, y: 34, opacity: 0, filter: 'blur(10px)' }}
                animate={{ x: 0, y: 0, opacity: 1, filter: 'blur(0px)' }}
                transition={{ duration: 0.75, ease: ease.cinematic, delay: 0.08 }}
              />
              <motion.path
                d={ASCENT.shaded}
                fill="url(#iR)"
                initial={{ x: 70, y: 34, opacity: 0, filter: 'blur(10px)' }}
                animate={{ x: 0, y: 0, opacity: 1, filter: 'blur(0px)' }}
                transition={{ duration: 0.75, ease: ease.cinematic, delay: 0.16 }}
              />
              {/* Specular sweep down the lit blade's outer edge once it lands */}
              <motion.polygon
                points="256,96 256,122 108,404 96,404"
                fill="#FFFFFF"
                initial={{ opacity: 0 }}
                animate={{ opacity: [0, 0.5, 0.16] }}
                transition={{ delay: 0.7, duration: 0.6 }}
              />
              {/* Star flare in the A's counter: ring burst, glow, then the four-point star that forms the bar */}
              <motion.circle
                cx={STAR.x}
                cy={STAR.y}
                r="30"
                fill="none"
                stroke="#D9CCFF"
                strokeWidth="3"
                initial={{ scale: 0.2, opacity: 0 }}
                animate={{ scale: [0.2, 2.6], opacity: [0, 0.9, 0] }}
                style={{ transformOrigin: `${STAR.x}px ${STAR.y}px` }}
                transition={{ delay: 0.62, duration: 0.7, ease: ease.out, times: [0, 0.2, 1] }}
              />
              <motion.circle
                cx={STAR.x}
                cy={STAR.y}
                r="32"
                fill="#C8B6FF"
                filter="url(#iGlow)"
                initial={{ opacity: 0 }}
                animate={{ opacity: [0, 0.9, 0.5] }}
                transition={{ delay: 0.6, duration: 0.8 }}
              />
              <motion.path
                d={ASCENT.star}
                fill="url(#iStar)"
                initial={{ scale: 0, opacity: 0, rotate: -90 }}
                animate={{ scale: [0, 1.35, 1], opacity: 1, rotate: 0 }}
                style={{ transformOrigin: `${STAR.x}px ${STAR.y}px` }}
                transition={{ duration: 0.65, ease: ease.emph, delay: 0.58, times: [0, 0.6, 1] }}
              />
            </svg>
            <div className="intro__word" aria-label={APP_NAME}>
              {LETTERS.map((l, i) => (
                <motion.span
                  key={i}
                  className={l.light ? (l.first ? 'intro__light intro__light--first' : 'intro__light') : undefined}
                  initial={{ opacity: 0, y: 14, filter: 'blur(8px)' }}
                  animate={{ opacity: 1, y: 0, filter: 'blur(0px)' }}
                  transition={{ delay: 0.78 + i * 0.04, duration: 0.55, ease: ease.cinematic }}
                >
                  {l.ch}
                </motion.span>
              ))}
            </div>
            <motion.div
              className="intro__tag"
              initial={{ opacity: 0, letterSpacing: '0.42em' }}
              animate={{ opacity: 1, letterSpacing: '0.28em' }}
              transition={{ delay: 1.15, duration: 0.7, ease: ease.out }}
              onAnimationComplete={() => window.setTimeout(() => setShow(false), 650)}
            >
              YOUR UNIVERSE OF PLAY
            </motion.div>
          </motion.div>
          <motion.div className="intro__skip" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.9 }}>
            Press any key to skip
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
