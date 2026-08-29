/*  frontend/src/pages/ProjectsMap.jsx
    ----------------------------------------------------------------------------
    Replaces the hand-drawn SVG "map".

    The old version painted circles onto a static <svg viewBox="0 0 480 490">
    with two hardcoded lat/lng formulas and fake street lines. Nothing listened
    for scroll or drag, so there was no zoom or pan to work — pinching just
    scaled the whole browser page.

    This is a real Leaflet map: OpenStreetMap tiles, wheel/pinch zoom, drag pan,
    double-click zoom, keyboard arrows, and a "fit to all projects" button.
    Markers are drawn on a canvas layer so 1,500+ pins stay smooth.
--------------------------------------------------------------------------- */

import { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import api from '../lib/api';
import { useSheetSync } from '../hooks/useSheetSync';
import { useTheme } from '../hooks/useTheme';
import { matchesStatus, buildStatusChips, statusPin, statusLabel } from '../lib/status';

const BENGALURU = [12.9716, 77.5946];

/*  Colours, labels and grouping all come from lib/status.js, so a project
    saved as "Defaulted" and one saved as "Defaulted - Project Payment" share
    a single pin colour and a single legend chip. */
const colourFor = statusPin;

/*  Keyless OpenStreetMap tiles. CARTO's basemaps now stamp an "API KEY
    REQUIRED" watermark on anonymous tiles, so we use OSM directly. OSM has no
    dark style, so dark mode reuses the same tiles under a CSS invert filter
    (className 'map-tiles-dark' — see globals.css).                          */
const TILES = {
  light: {
    url: 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
    attribution: '&copy; OpenStreetMap contributors',
    subdomains: 'abc',
    className: '',
  },
  dark: {
    url: 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
    attribution: '&copy; OpenStreetMap contributors',
    subdomains: 'abc',
    className: 'map-tiles-dark',
  },
};

export default function ProjectsMap() {
  const navigate  = useNavigate();
  const { isDark } = useTheme();

  const hostRef   = useRef(null);   // the <div> Leaflet mounts into
  const mapRef    = useRef(null);   // the L.Map instance
  const tileRef   = useRef(null);
  const layerRef  = useRef(null);   // marker layer, cleared on every redraw
  const markerRef = useRef(new Map());  // project id -> circleMarker, for highlighting
  const fittedRef = useRef(false);  // only auto-fit once

  const [projects, setProjects] = useState([]);
  const [selected, setSelected] = useState(null);
  const [filter,   setFilter]   = useState('All');
  const [loading,  setLoading]  = useState(true);
  const [zoom,     setZoom]     = useState(11);
  const [locating, setLocating] = useState(false);

  /* ---------- data ---------- */
  const load = useCallback((silent = false) => {
    if (!silent) setLoading(true);
    return api.get('/api/projects?limit=5000')
      .then(res => {
        const rows = Array.isArray(res) ? res : (res?.data ?? []);
        setProjects(rows.filter(p =>
          Number.isFinite(Number(p.lat)) && Number.isFinite(Number(p.lng)) &&
          Number(p.lat) !== 0 && Number(p.lng) !== 0
        ));
      })
      .catch(() => { if (!silent) setProjects([]); })
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { load(); }, [load]);
  useSheetSync(() => load(true), 60000);

  /* ---------- create the map once ---------- */
  useEffect(() => {
    if (mapRef.current || !hostRef.current) return;

    const map = L.map(hostRef.current, {
      center: BENGALURU,
      zoom: 11,
      minZoom: 4,
      maxZoom: 19,
      zoomControl: true,
      scrollWheelZoom: true,     // ← the thing that was missing entirely
      doubleClickZoom: true,
      dragging: true,
      touchZoom: true,
      keyboard: true,
      zoomSnap: 0.5,
      wheelPxPerZoomLevel: 90,
      preferCanvas: true,        // 1,500 markers on canvas instead of SVG nodes
    });
    map.zoomControl.setPosition('bottomright');
    mapRef.current = map;

    map.on('zoomend', () => setZoom(map.getZoom()));

    /*  Some layouts swallow the wheel event before Leaflet sees it (a scroll
        container, a passive listener, or a stray overlay). Bind our own
        non-passive wheel handler on the container as a guaranteed fallback. */
    const host = hostRef.current;
    const onWheel = e => {
      if (!mapRef.current) return;
      e.preventDefault();
      e.stopPropagation();
      const delta = e.deltaY < 0 ? 1 : -1;
      mapRef.current.setZoomAround(
        mapRef.current.mouseEventToLatLng(e),
        mapRef.current.getZoom() + delta * 0.5
      );
    };
    host.addEventListener('wheel', onWheel, { passive: false });

    // the map is inside a flex layout, so its size is 0 on first paint
    const ro = new ResizeObserver(() => map.invalidateSize());
    ro.observe(hostRef.current);
    setTimeout(() => map.invalidateSize(), 120);

    return () => {
      host.removeEventListener('wheel', onWheel);
      ro.disconnect(); map.remove(); mapRef.current = null;
    };
  }, []);

  /* ---------- swap tiles when the theme changes ---------- */
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    if (tileRef.current) map.removeLayer(tileRef.current);
    const t = TILES[isDark ? 'dark' : 'light'];
    tileRef.current = L.tileLayer(t.url, {
      attribution: t.attribution, maxZoom: 19,
      subdomains: t.subdomains || 'abc', detectRetina: false,
      className: t.className || '',
    }).addTo(map);
  }, [isDark]);

  /* ---------- counts per status, from the data ---------- */
  const chips = useMemo(
    () => buildStatusChips(projects).map(c => ({ ...c, colour: c.pin })),
    [projects]
  );

  const visible = useMemo(
    () => projects.filter(p => matchesStatus(p.status, filter)),
    [projects, filter]
  );

  /* ---------- draw the markers ---------- */
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    if (layerRef.current) map.removeLayer(layerRef.current);
    const layer = L.layerGroup();
    markerRef.current = new Map();

    for (const p of visible) {
      const lat = Number(p.lat), lng = Number(p.lng);
      const colour = colourFor(p.status);

      const m = L.circleMarker([lat, lng], {
        radius: 6, color: '#fff', weight: 1.6,
        fillColor: colour, fillOpacity: 0.95,
      });

      m.bindTooltip(p.name || 'Project', { direction: 'top', offset: [0, -6] });
      m.on('click', () => selectProject(p, m));
      layer.addLayer(m);
      markerRef.current.set(String(p.id), m);
    }

    layer.addTo(map);
    layerRef.current = layer;

    // fit to the data the first time it arrives
    if (!fittedRef.current && visible.length) {
      const b = L.latLngBounds(visible.map(p => [Number(p.lat), Number(p.lng)]));
      if (b.isValid()) map.fitBounds(b, { padding: [40, 40], maxZoom: 14 });
      fittedRef.current = true;
    }
  }, [visible]);

  /*  Open the panel for a project, grow its marker, and shift the map left so
      the pin is not hidden underneath the 320px panel.                      */
  const selectProject = (p, marker) => {
    setSelected(p);

    // reset every marker, then grow the chosen one
    for (const m of markerRef.current.values()) {
      m.setStyle({ radius: 6, weight: 1.6, color: '#fff' });
    }
    const m = marker || markerRef.current.get(String(p.id));
    if (m) {
      m.setStyle({ radius: 10, weight: 3, color: '#0F1F35' });
      m.bringToFront?.();
    }

    const map = mapRef.current;
    if (map && m) {
      const pt = map.latLngToContainerPoint(m.getLatLng());
      const panelEdge = map.getSize().x - 320;
      if (pt.x > panelEdge - 30) map.panBy([pt.x - panelEdge + 60, 0], { animate: true });
    }
  };

  const closePanel = () => {
    setSelected(null);
    for (const m of markerRef.current.values()) {
      m.setStyle({ radius: 6, weight: 1.6, color: '#fff' });
    }
  };

  const zoomBy = d => {
    const map = mapRef.current;
    if (!map) return;
    map.setZoom(Math.min(19, Math.max(4, map.getZoom() + d)));
  };

  const locateMe = () => {
    const map = mapRef.current;
    if (!map || !navigator.geolocation) return;
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      pos => {
        map.flyTo([pos.coords.latitude, pos.coords.longitude], 15, { duration: 0.8 });
        L.circleMarker([pos.coords.latitude, pos.coords.longitude], {
          radius: 8, color: '#fff', weight: 3, fillColor: '#2563EB', fillOpacity: 1,
        }).addTo(map).bindTooltip('You are here', { permanent: false });
        setLocating(false);
      },
      () => setLocating(false),
      { enableHighAccuracy: true, timeout: 8000 }
    );
  };

  const fitAll = () => {
    const map = mapRef.current;
    if (!map || !visible.length) return;
    const b = L.latLngBounds(visible.map(p => [Number(p.lat), Number(p.lng)]));
    if (b.isValid()) map.fitBounds(b, { padding: [40, 40], maxZoom: 15 });
  };

  const withoutCoords = projects.length
    ? null
    : (loading ? null : 'No projects have location data');

  return (
    <div className={`map-full-wrap${selected ? ' panel-open' : ''}`} style={{ height: 'calc(100vh - 118px)' }}>
      <div ref={hostRef} style={{ position: 'absolute', inset: 0 }} />

      {/*  Large, always-visible zoom controls. Leaflet's own +/- sit bottom-right
          too, but these are guaranteed to work even if a browser extension or a
          parent scroll container eats the wheel event.                        */}
      <div className="map-zoom-stack">
        <button onClick={() => zoomBy(1)}  title="Zoom in"  aria-label="Zoom in">+</button>
        <div className="map-zoom-level" title="Current zoom level">{zoom.toFixed(1)}</div>
        <button onClick={() => zoomBy(-1)} title="Zoom out" aria-label="Zoom out">−</button>
      </div>

      {/* toolbar: status filters + fit button */}
      <div className="map-toolbar">
        {chips.map(c => (
          <button
            key={c.key}
            className={`map-chip${filter === c.key ? ' active' : ''}`}
            onClick={() => setFilter(c.key)}
            title={c.key}
          >
            {c.key !== 'All' && <span className="dot" style={{ background: c.colour }} />}
            {c.label}
            <span style={{ opacity: .7 }}>{c.count}</span>
          </button>
        ))}
        <button className="map-chip" onClick={fitAll} title="Zoom to fit all pins">Fit all</button>
        <button className="map-chip" onClick={locateMe} title="Centre on my location" disabled={locating}>
          {locating ? 'Locating…' : 'My location'}
        </button>
        {loading && <span className="map-count">Loading…</span>}
        {withoutCoords && <span className="map-count">{withoutCoords}</span>}
      </div>

      {/* detail panel */}
      <div className={`map-side-panel${selected ? ' open' : ''}`}>
        <button className="mp-close" onClick={closePanel} aria-label="Close">×</button>

        {selected && (() => {
          const c     = selected.clients || {};
          const name  = c.name || selected.client_name || null;
          const phone = c.phone ? String(c.phone).replace(/[^\d+]/g, '') : null;

          return (
            <div className="mp-body">
              {/* ---- customer ---- */}
              <div className="mp-customer">
                <div className="mp-avatar">
                  {(name || '?').trim()[0].toUpperCase()}
                </div>
                <div style={{ minWidth: 0 }}>
                  <div className="mp-cust-name">{name || 'No client linked'}</div>
                  {c.region && <div className="mp-cust-sub">{c.region}</div>}
                </div>
              </div>

              {/* ---- contact, tappable ---- */}
              {(phone || c.email) && (
                <div className="mp-contact">
                  {phone && (
                    <a className="mp-contact-btn" href={`tel:${phone}`} title={c.phone}>
                      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                        <path d="M22 16.9v3a2 2 0 01-2.2 2 19.8 19.8 0 01-8.6-3.1 19.5 19.5 0 01-6-6A19.8 19.8 0 012.1 4.2 2 2 0 014.1 2h3a2 2 0 012 1.7c.1 1 .4 1.9.7 2.8a2 2 0 01-.5 2.1L8.1 9.9a16 16 0 006 6l1.3-1.2a2 2 0 012.1-.5c.9.3 1.8.6 2.8.7a2 2 0 011.7 2z"/>
                      </svg>
                      Call
                    </a>
                  )}
                  {c.email && (
                    <a className="mp-contact-btn" href={`mailto:${c.email}`} title={c.email}>
                      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                        <rect x="2" y="4" width="20" height="16" rx="2"/><path d="M22 6l-10 7L2 6"/>
                      </svg>
                      Email
                    </a>
                  )}
                </div>
              )}

              {phone && <div className="mp-phone">{c.phone}</div>}

              {/* ---- project ---- */}
              <div className="mp-project" onClick={() => navigate(`/projects/${selected.id}`)}>
                {selected.name}
              </div>

              <div className="mp-rows">
                {[
                  ['Status',  statusLabel(selected.status)],
                  ['Size',    selected.size_kwp ? `${selected.size_kwp} kWp` : '—'],
                  ['Type',    selected.project_type || 'EPC'],
                  ['Business Model',  selected.scheme || '—'],
                  ['AMC',     selected.amc_type && selected.amc_type !== 'None' ? selected.amc_type : 'No AMC'],
                  ['Area',    selected.area || '—'],
                  ['Address', selected.site_address || '—'],
                ].map(([l, v]) => (
                  <div key={l} className="mp-row">
                    <span className="mp-row-label">{l}</span>
                    <span className="mp-row-value">{v}</span>
                  </div>
                ))}
              </div>

              <div className="mp-coords">
                {Number(selected.lat).toFixed(5)}, {Number(selected.lng).toFixed(5)}
              </div>

              {/* ---- actions ---- */}
              <button className="mp-btn primary" onClick={() => navigate(`/projects/${selected.id}`)}>
                View project
              </button>

              {(selected.client_id || c.id) && (
                <button className="mp-btn" onClick={() => navigate(`/clients/${selected.client_id || c.id}`)}>
                  View client
                </button>
              )}

              <a
                className="mp-btn"
                href={`https://www.google.com/maps/dir/?api=1&destination=${selected.lat},${selected.lng}`}
                target="_blank" rel="noreferrer"
              >Directions</a>
            </div>
          );
        })()}
      </div>

    </div>
  );
}