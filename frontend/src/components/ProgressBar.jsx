import { useEffect, useRef, useState } from 'react';
import { onLoading } from '../lib/api';

/*  Slim page-load progress bar pinned to the bottom of the screen. It reacts to
    in-flight API calls (onLoading in lib/api): the moment anything is loading it
    appears and trickles toward 90%, then snaps to 100% and fades out once every
    request has finished. The % is shown so users can see something is happening. */
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
        setTimeout(() => { setVisible(false); setPct(0); }, 450);
      }
    });
    return () => { off(); stop(); };
  }, []);

  if (!visible && pct === 0) return null;

  return (
    <div style={{ position: 'fixed', left: 0, right: 0, bottom: 0, zIndex: 4000,
                  pointerEvents: 'none', opacity: visible ? 1 : 0,
                  transition: 'opacity .35s ease' }}>
      <div style={{ height: 3, background: 'rgba(10,100,80,.12)' }}>
        <div style={{ height: '100%', width: `${pct}%`, background: '#0a6450',
                      boxShadow: '0 0 8px rgba(10,100,80,.6)',
                      transition: 'width .18s ease' }} />
      </div>
      <div style={{ position: 'absolute', right: 12, bottom: 8, fontSize: 11,
                    fontWeight: 700, color: '#0a6450', background: '#fff',
                    padding: '1px 7px', borderRadius: 8,
                    border: '1px solid rgba(10,100,80,.25)' }}>
        {Math.round(pct)}%
      </div>
    </div>
  );
}
