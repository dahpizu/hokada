import { useEffect, useMemo, useState } from "react";
import {
  MapContainer,
  TileLayer,
  Marker,
  Popup,
  Polyline,
  useMap,
} from "react-leaflet";
import L from "leaflet";
import { supabase } from "../lib/supabase";
import { Bike, MapPin, Flag, Radio, Wifi } from "lucide-react";
import "leaflet/dist/leaflet.css";

function validPoint(point) {
  if (!point) return null;
  const lat = Number(point.lat);
  const lng = Number(point.lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return null;
  if (lat === 0 && lng === 0) return null;
  return { lat, lng, label: point.label || "Location" };
}

function makeIcon(emoji, className) {
  return L.divIcon({
    className,
    html: `<div class="${className}">${emoji}</div>`,
    iconSize: [42, 42],
    iconAnchor: [21, 21],
  });
}

const riderIcon = makeIcon("🏍️", "hokada-rider-marker");
const pickupIcon = makeIcon("📍", "hokada-location-marker pickup-marker");
const dropoffIcon = makeIcon("🏁", "hokada-location-marker dropoff-marker");

function FitMap({ points }) {
  const map = useMap();

  useEffect(() => {
    if (!points.length) return;

    if (points.length === 1) {
      map.setView([points[0].lat, points[0].lng], 15);
      return;
    }

    map.fitBounds(
      points.map((point) => [point.lat, point.lng]),
      { padding: [40, 40], maxZoom: 15 }
    );
  }, [map, points]);

  return null;
}

function CenterMap({ position }) {
  const map = useMap();

  useEffect(() => {
    if (position) {
      map.flyTo([position.lat, position.lng], Math.max(map.getZoom(), 15), {
        duration: 0.7,
      });
    }
  }, [map, position]);

  return null;
}

function distanceKm(a, b) {
  if (!a || !b) return null;

  const rad = (value) => (value * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const value =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(rad(a.lat)) *
      Math.cos(rad(b.lat)) *
      Math.sin(dLng / 2) ** 2;

  return 6371 * 2 * Math.atan2(Math.sqrt(value), Math.sqrt(1 - value));
}

export default function TrackingMap({
  deliveryId,
  pickup: pickupInput,
  dropoff: dropoffInput,
  riderName = "HOKADA rider",
  status = "searching",
  paymentStatus,
}) {
  const pickup = useMemo(() => validPoint(pickupInput), [pickupInput]);
  const dropoff = useMemo(() => validPoint(dropoffInput), [dropoffInput]);

  const [riderPosition, setRiderPosition] = useState(null);
  const [lastUpdate, setLastUpdate] = useState(null);
  const [gpsError, setGpsError] = useState("");

  const deliveryCompleted = status === "delivered" || paymentStatus === "paid";
  const trackingEnded = deliveryCompleted || status === "cancelled";

  useEffect(() => {
    if (!supabase || !deliveryId || trackingEnded) {
      setRiderPosition(null);
      setLastUpdate(null);
      setGpsError("");
      return undefined;
    }

    let active = true;

    const clearGps = () => {
      setRiderPosition(null);
      setLastUpdate(null);
      setGpsError("");
    };

    const applyGps = (row) => {
      if (!active || !row) return;

      const point = validPoint({
        lat: row.latitude,
        lng: row.longitude,
      });

      if (!point) return;

      setRiderPosition(point);
      setLastUpdate(row.updated_at ? new Date(row.updated_at) : new Date());
      setGpsError("");
    };

    async function loadLatestGps() {
      const { data, error } = await supabase
        .from("delivery_live_locations")
        .select("latitude,longitude,updated_at")
        .eq("delivery_id", deliveryId)
        .maybeSingle();

      if (!active) return;

      if (error) {
        setGpsError("Unable to load the rider's location right now.");
        return;
      }

      if (data) applyGps(data);
    }

    loadLatestGps();

    const channel = supabase
      .channel(`customer-rider-gps:${deliveryId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "delivery_live_locations",
          filter: `delivery_id=eq.${deliveryId}`,
        },
        (payload) => {
          if (payload.eventType === "DELETE") {
            clearGps();
            return;
          }

          applyGps(payload.new);
        }
      )
      .subscribe((subscriptionStatus) => {
        if (!active) return;

        if (
          subscriptionStatus === "CHANNEL_ERROR" ||
          subscriptionStatus === "TIMED_OUT"
        ) {
          setGpsError("Live updates are temporarily unavailable.");
        }
      });

    return () => {
      active = false;
      supabase.removeChannel(channel);
    };
  }, [deliveryId, trackingEnded]);

  const isDropoffStage = [
    "collected",
    "going_to_dropoff",
    "arrived_at_dropoff",
  ].includes(status);

  const destination = isDropoffStage ? dropoff : pickup;
  const destinationLabel = isDropoffStage ? "drop-off" : "pickup";
  const distance = distanceKm(riderPosition, destination);

  const mapPoints = useMemo(
    () => [pickup, dropoff, trackingEnded ? null : riderPosition].filter(Boolean),
    [pickup, dropoff, riderPosition, trackingEnded]
  );

  const gpsIsRecent =
    !trackingEnded && Boolean(riderPosition && lastUpdate) &&
    Date.now() - lastUpdate.getTime() < 90000;

  const hasMapCoordinates = mapPoints.length > 0;

  return (
    <div className="hokada-tracking-map-shell">
      <div className="hokada-map-status-bar">
        <div className="hokada-map-status-left">
          <div className="hokada-map-status-icon">
            {gpsIsRecent ? <Radio size={17} /> : <Bike size={17} />}
          </div>
          <div>
            <strong>{trackingEnded ? "Rider tracking ended" : gpsIsRecent ? "Live rider tracking" : "Rider tracking"}</strong>
            <span>
              {trackingEnded
                ? deliveryCompleted
                  ? "Delivery completed. Rider location is no longer available."
                  : "Delivery cancelled. Rider location is no longer available."
                : gpsIsRecent
                  ? "Rider location received recently"
                  : "Waiting for the rider's real GPS location"}
            </span>
          </div>
        </div>

        <div className={`hokada-live-badge ${gpsIsRecent ? "is-live" : "is-demo"}`}>
          <span className="hokada-live-dot"></span>
          {trackingEnded ? "ENDED" : gpsIsRecent ? "LIVE" : "WAITING"}
        </div>
      </div>

      <div className={`hokada-map-stage ${isDropoffStage ? "hokada-map-stage-dropoff" : "hokada-map-stage-pickup"}`}>
        <div className="hokada-map-stage-icon">
          {isDropoffStage ? <Flag size={17} /> : <MapPin size={17} />}
        </div>
        <div>
          <span>{isDropoffStage ? "DROP-OFF STAGE" : "PICKUP STAGE"}</span>
          <strong>
            {isDropoffStage
              ? ["arrived_at_dropoff", "delivered"].includes(status)
                ? "Rider has arrived at drop-off"
                : "Rider is heading to drop-off"
              : "Rider is heading to pickup"}
          </strong>
        </div>
      </div>

      {hasMapCoordinates ? (
        <div className="hokada-map-wrapper">
          <MapContainer
            key={deliveryId}
            center={[
              (riderPosition || pickup || dropoff).lat,
              (riderPosition || pickup || dropoff).lng,
            ]}
            zoom={13}
            scrollWheelZoom
            className="hokada-map"
          >
            <TileLayer
              attribution='&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">OpenStreetMap</a> contributors'
              url="https://tile.openstreetmap.org/{z}/{x}/{y}.png"
            />

            <FitMap points={mapPoints} />
            <CenterMap position={riderPosition} />

            {!trackingEnded && riderPosition && (
              <Marker position={[riderPosition.lat, riderPosition.lng]} icon={riderIcon}>
                <Popup>
                  <strong>{riderName}</strong>
                  <br />
                  {gpsIsRecent ? "Recent GPS location" : "Last received GPS location"}
                </Popup>
              </Marker>
            )}

            {pickup && (
              <Marker position={[pickup.lat, pickup.lng]} icon={pickupIcon}>
                <Popup>Pickup: {pickup.label}</Popup>
              </Marker>
            )}

            {dropoff && (
              <Marker position={[dropoff.lat, dropoff.lng]} icon={dropoffIcon}>
                <Popup>Drop-off: {dropoff.label}</Popup>
              </Marker>
            )}

            {!trackingEnded && riderPosition && destination && (
              <Polyline
                positions={[
                  [riderPosition.lat, riderPosition.lng],
                  [destination.lat, destination.lng],
                ]}
                pathOptions={{ className: "hokada-route-line", weight: 5, opacity: 0.85 }}
              />
            )}
          </MapContainer>
        </div>
      ) : (
        <div className="hokada-map-wrapper" style={{ display: "grid", placeItems: "center", padding: 24 }}>
          <p>Location coordinates are not available for this delivery yet.</p>
        </div>
      )}

      <div className="hokada-map-info-grid">
        <div className="hokada-map-info-item">
          <div className="hokada-map-info-icon"><Bike size={18} /></div>
          <div><span>Rider</span><strong>{riderName}</strong></div>
        </div>

        <div className="hokada-map-info-item">
          <div className="hokada-map-info-icon"><MapPin size={18} /></div>
          <div>
            <span>Distance to {destinationLabel}</span>
            <strong>{trackingEnded ? "Tracking ended" : distance === null ? "Awaiting GPS" : `${distance.toFixed(1)} km`}</strong>
          </div>
        </div>

        <div className="hokada-map-info-item">
          <div className="hokada-map-info-icon"><Flag size={18} /></div>
          <div>
            <span>Destination</span>
            <strong>{destination?.label || "Awaiting coordinates"}</strong>
          </div>
        </div>
      </div>

      <div className="hokada-map-footer">
        <div>
          <span className="hokada-footer-status-dot"></span>
          <span>
            {trackingEnded
              ? "Rider location sharing has ended for this delivery."
              : gpsError ||
              (lastUpdate
                ? `Last GPS update: ${lastUpdate.toLocaleTimeString()}`
                : "Waiting for rider GPS")}
          </span>
        </div>

        {!trackingEnded && gpsIsRecent && (
          <div className="hokada-secure-location">
            <Wifi size={14} />
            Live connection
          </div>
        )}
      </div>
    </div>
  );
}
