'use client';

import 'leaflet/dist/leaflet.css';
import { useEffect, useMemo, useRef, useState } from 'react';
import L, { type LatLngExpression } from 'leaflet';
import Link from 'next/link';
import { MapContainer, Marker, Popup, TileLayer, useMap, useMapEvents } from 'react-leaflet';
import type { ApiMapMarker } from '@/lib/api-types';
import { formatPrice } from '@/lib/relative-time';

/**
 * §1: в бандлере пути к marker-icon.png ломаются, поэтому иконки лежат в /public/leaflet
 * и заданы явно через L.Icon.Default.
 */
delete (L.Icon.Default.prototype as unknown as { _getIconUrl?: unknown })._getIconUrl;
L.Icon.Default.mergeOptions({
  iconUrl: '/leaflet/marker-icon.png',
  iconRetinaUrl: '/leaflet/marker-icon-2x.png',
  shadowUrl: '/leaflet/marker-shadow.png',
});

const OSM_ATTRIBUTION =
  '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors';
const OSM_TILE_URL = 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png';

/** Меньше этого числа магазинов не группируем: на маленьком наборе точки нагляднее. */
const CLUSTER_MIN_STORES = 12;

type Group = { key: string; lat: number; lng: number; items: ApiMapMarker[] };

function singles(markers: ApiMapMarker[]): Group[] {
  return markers.map((marker) => ({
    key: `store-${marker.storeId}`,
    lat: marker.lat,
    lng: marker.lng,
    items: [marker],
  }));
}

/** Своя группировка по сетке, размер ячейки зависит от зума (§6.2). */
function gridClusters(markers: ApiMapMarker[], zoom: number): Group[] {
  const cell = 0.012 * Math.pow(2, 13 - zoom);
  const buckets = new Map<string, ApiMapMarker[]>();
  for (const marker of markers) {
    const key = `${Math.floor(marker.lat / cell)}:${Math.floor(marker.lng / cell)}`;
    const bucket = buckets.get(key) ?? [];
    bucket.push(marker);
    buckets.set(key, bucket);
  }
  return [...buckets.entries()].map(([key, items]) => ({
    key,
    lat: items.reduce((sum, item) => sum + item.lat, 0) / items.length,
    lng: items.reduce((sum, item) => sum + item.lng, 0) / items.length,
    items,
  }));
}

function clusterIcon(count: number): L.DivIcon {
  const size = count > 50 ? 44 : count > 20 ? 38 : 32;
  return L.divIcon({
    className: '',
    html: `<div class="cluster-icon" style="width:${size}px;height:${size}px">${count}</div>`,
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2],
  });
}

function boundsOf(items: ApiMapMarker[]): L.LatLngBounds {
  return L.latLngBounds(items.map((item) => [item.lat, item.lng] as LatLngExpression));
}

function FitBounds({ groups, center }: { groups: Group[]; center: [number, number] }) {
  const map = useMap();
  const applied = useRef('');
  useEffect(() => {
    const signature = `${center.join(',')}:${groups.length}:${groups
      .map((g) => g.items.length)
      .join('')}`;
    if (applied.current === signature) return;
    applied.current = signature;
    const points = groups.flatMap((group) => group.items);
    if (!points.length) {
      map.setView(center, 12);
      return;
    }
    map.fitBounds(boundsOf(points).pad(0.18), { animate: false });
  }, [groups, center, map]);
  return null;
}

function ZoomWatcher({ onChange }: { onChange: (zoom: number) => void }) {
  const map = useMap();
  useMapEvents({ zoomend: () => onChange(map.getZoom()) });
  useEffect(() => {
    onChange(map.getZoom());
  }, [map, onChange]);
  return null;
}

function MarkerLayer({
  groups,
  citySlug,
}: {
  groups: Group[];
  citySlug: string;
}) {
  const map = useMap();
  return (
    <>
      {groups.map((group) =>
        group.items.length > 1 ? (
          <Marker
            key={group.key}
            position={[group.lat, group.lng]}
            icon={clusterIcon(group.items.length)}
            title={`${group.items.length} магазинов`}
            eventHandlers={{
              click: () => map.fitBounds(boundsOf(group.items).pad(0.25)),
            }}
          />
        ) : (
          <Marker key={group.key} position={[group.lat, group.lng]}>
            <Popup>
              <div className="space-y-1.5 text-sm" data-qa={`popup-${group.items[0].storeId}`}>
                <p className="font-semibold">{group.items[0].name}</p>
                <p className="text-muted" data-qa="popup-address">
                  {group.items[0].address}
                </p>
                <p>
                  Акций: <b>{group.items[0].promos}</b>
                </p>
                {group.items[0].preview.length > 0 && (
                  <ul className="space-y-0.5">
                    {group.items[0].preview.map((item, index) => (
                      <li key={index} className="flex justify-between gap-3">
                        <span className="max-w-[16rem] truncate">{item.name}</span>
                        <span className="shrink-0 tabular-nums">{formatPrice(item.priceNew)}</span>
                      </li>
                    ))}
                  </ul>
                )}
                <Link
                  href={`/${citySlug}/stores/${group.items[0].storeId}`}
                  className="inline-block font-medium text-brand underline underline-offset-2"
                  data-qa="popup-store-link"
                >
                  Все акции магазина
                </Link>
              </div>
            </Popup>
          </Marker>
        ),
      )}
    </>
  );
}

export default function MapView({
  citySlug,
  markers,
  center,
}: {
  citySlug: string;
  markers: ApiMapMarker[];
  center: [number, number];
}) {
  const [zoom, setZoom] = useState(13);
  const groups = useMemo(
    () => (markers.length < CLUSTER_MIN_STORES ? singles(markers) : gridClusters(markers, zoom)),
    [markers, zoom],
  );

  // §6.2: пустой город — сообщение, а не пустая карта.
  if (!markers.length) {
    return (
      <div
        className="grid h-[320px] place-items-center rounded-[12px] border border-dashed border-line bg-surface px-6 text-center"
        data-qa="map-empty"
      >
        <div className="max-w-sm">
          <p className="font-semibold">Нет данных, запусти синхронизацию</p>
          <p className="mt-1 text-sm text-muted">
            В этом городе пока нет магазинов с координатами. Выполните{' '}
            <code className="rounded bg-canvas px-1">npm run sync:all</code> — карта заполнится
            после импорта OSM и акций.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded-[12px] border border-line shadow-[var(--shadow-card)]" data-qa="map">
      <MapContainer center={center} zoom={13} scrollWheelZoom className="h-[380px] w-full">
        <TileLayer url={OSM_TILE_URL} attribution={OSM_ATTRIBUTION} />
        <ZoomWatcher onChange={setZoom} />
        <FitBounds groups={groups} center={center} />
        <MarkerLayer groups={groups} citySlug={citySlug} />
      </MapContainer>
    </div>
  );
}
