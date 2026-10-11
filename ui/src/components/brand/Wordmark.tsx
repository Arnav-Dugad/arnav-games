import type { CSSProperties } from 'react';
import './brand.css';

/**
 * The Arnav Games wordmark set live: ARNAV heavier, GAMES lighter, all caps and tracked
 * (docs/BRAND.md › Wordmark). The source text stays "Arnav Games", so screen readers say the
 * name rather than spelling capitals, and copying it gives the name.
 */
export function Wordmark({ className, style }: { className?: string; style?: CSSProperties }) {
  return (
    <span className={className ? `wordmark ${className}` : 'wordmark'} style={style}>
      <span className="wordmark__bold">Arnav</span><span className="wordmark__space"> </span><span className="wordmark__light">Games</span>
    </span>
  );
}
