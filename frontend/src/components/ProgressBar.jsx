import { useEffect, useRef, useState } from 'react';
import { onLoading } from '../lib/api';

/*  Full-width page-load progress bar pinned to the bottom of the screen.
    Driven by in-flight API calls (onLoading in lib/api): it appears the moment
    anything is loading, trickles toward 90% with an animated sliding stripe,
    then snaps to 100% and fades out once every request finishes. The % sits in
    the middle of the bar so users always see something is happening.         */
export default function ProgressBar() {
  const [pct, setPct]         = useState(0);
  const [visible, setVisible] = useState(false);
  const active = useRef(false);
  const timer  = useRef(null);

  useEffect(() => {
    const stop = () => { clearInterval(timer.current); timer.current = null; };
    const off = onLoading(pending => {
      if (pending > 0 && !active.current) {
        active.current = true;
        setVisible(true);
        setPct(8);
        stop();
        timer.current = setInterval(() => {
          setPct(p => (p < 90 ? p + Math.max(0.4, (90 - p) * 0.06) : p));
        }, 180);
      } else if (pending === 0 && active.current) {
        active.current = false;
        stop();
        setPct(100);
        setTimeout(() => { setVisible(false); setPct(0); }, 500);
      }
    });
    return () => { off(); stop(); };
  }, []);

  if (!visible && pct === 0) return null;

  return (
    <>
      <style>{`@keyframes ec-bar-slide { from { background-position: 0 0; } to { background-position: 36px 0; } }`}</style>
      <div style={{ position: 'fixed', left: 0, right: 0, bottom: 0, zIndex: 4000,
                    height: 22, pointerEvents: 'none',
                    opacity: visible ? 1 : 0, transition: 'opacity .4s ease' }}>
        {/* track */}
        <div style={{ position: 'relative', height: '100%', width: '100%',
                      background: 'rgba(10,100,80,.10)', overflow: 'hidden' }}>
          {/* animated sliding fill */}
          <div style={{
            height: '100%', width: `${pct}%`,
            transition: 'width .2s ease',
            backgroundColor: '#0a6450',
            backgroundImage: 'repeating-linear-gradient(45deg, rgba(255,255,255,.18) 0 10px, rgba(255,255,255,0) 10px 18px)',
            backgroundSize: '36px 36px',
            animation: 'ec-bar-slide .6s linear infinite',
            boxShadow: '0 0 10px rgba(10,100,80,.55)',
          }} />
          {/* percentage centred over the whole bar */}
          <div style={{
            position: 'absolute', inset: 0, display: 'flex',
            alignItems: 'center', justifyContent: 'center',
            fontSize: 11.5, fontWeight: 800, letterSpacing: '.04em',
            color: '#fff', textShadow: '0 1px 2px rgba(0,0,0,.45)',
          }}>
            {Math.round(pct)}%
          </div>
        </div>
      </div>
    </>
  );
}
