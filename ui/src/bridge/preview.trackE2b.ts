/**
 * Track E2b preview switches (the living interface: theme from a cover, the Living Canvas):
 *   ?theme=light|oled|contrast    start in that theme
 *   ?canvasQuality=high|balanced|low   visual quality (the canvas's resolution, layers and parallax follow it)
 *   ?canvasOff                    Living Canvas off
 *   ?audioReact                   the canvas reacts to the ambient sound (also turns the ambient sound on)
 *   ?noParallax                   no pointer parallax
 *   ?dataSaver                    Data saver on (the canvas keeps to its lightest form)
 */
import type { Settings } from './types';

export function previewE2bSettings(params: URLSearchParams): Partial<Settings> {
  const out: Partial<Settings> = {};
  const theme = params.get('theme');
  if (theme === 'light' || theme === 'oled' || theme === 'contrast' || theme === 'obsidian') out['appearance.theme'] = theme;
  const q = params.get('canvasQuality');
  if (q === 'high' || q === 'balanced' || q === 'low' || q === 'auto') out['appearance.quality'] = q;
  if (params.has('canvasOff')) out['appearance.livingCanvas'] = false;
  if (params.has('audioReact')) {
    out['canvas.audioReact'] = true;
    out['sound.ambient'] = true;
    out['sounds.enabled'] = true;
  }
  if (params.has('noParallax')) out['canvas.parallax'] = false;
  if (params.has('dataSaver')) out['dataSaver.enabled'] = true;
  return out;
}
