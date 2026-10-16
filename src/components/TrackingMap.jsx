import { useEffect, useMemo, useState } from "react";
import {
  MapContainer,
  TileLayer,
  Marker,
  Popup,
  Polyline,
  CircleMarker,
  useMap,
} from "react-leaflet";
import L from "leaflet";
import { supabase } from "../lib/supabase";
import { Bike, MapPin, Flag, Navigation, Radio, Wifi } from "lucide-react";

import "leaflet/dist/leaflet.css";

const DEMO_PICKUP = {
  lat: 6.6018,
  lng: 3.3515,
  label: "Pickup location",
};

const DEMO_DROPOFF = {
  lat: 6.4474,
  lng: 3.4722,
  label: "Drop-off location",
};

const DEMO_START = {
  lat: 6.5705,
  lng: 3.3605,
};

const riderIcon = L.divIcon({
  className: "hokada-rider-marker-wrapper",
  html: `
    <div class="hokada-rider-marker">
      <div class="hokada-rider-pulse"></div>
      <div class="hokada-rider-icon">🏍️</div>
    </div>
  `,
  iconSize: [54, 54],
  iconAnchor: [27, 27],
});

const pickupIcon = L.divIcon({
  className: "hokada-map-marker-wrapper",
  html: `
    <div class="hokada-location-marker pickup-marker">
      <span>📍</span>
    </div>
  `,
  iconSize: [42, 42],
  iconAnchor: [21, 42],
});

const dropoffIcon = L.divIcon({
  className: "hokada-map-marker-wrapper",
  html: `
    <div class="hokada-location-marker dropoff-marker">
      <span>🏁</span>
    </div>
  `,
  iconSize: [42, 42],
  iconAnchor: [21, 42],
});

function FitMap({ riderPosition, pickup, dropoff }) {
  const map = useMap();

  useEffect(() => {
    const bounds = L.latLngBounds([
      [pickup.lat, pickup.lng],
      [dropoff.lat, dropoff.lng],
      [riderPosition.lat, riderPosition.lng],
    ]);

    map.fitBounds(bounds, {
      padding: [45, 45],
      maxZoom: 14,
    });
  }, [map, riderPosition, pickup, dropoff]);

  return null;
}

function CenterRider({ riderPosition }) {
  const map = useMap();

  useEffect(() => {
    const handleCenter = () => {
      map.flyTo(
        [riderPosition.lat, riderPosition.lng],
        Math.max(map.getZoom(), 14),
        {
          duration: 0.8,
        }
      );
    };

    window.addEventListener("hokada-center-rider", handleCenter);

    return () => {
      window.removeEventListener("hokada-center-rider", handleCenter);
    };
  }, [map, riderPosition]);

  return null;
}

function interpolatePosition(start, end, progress) {
  return {
    lat: start.lat + (end.lat - start.lat) * progress,
    lng: start.lng + (end.lng - start.lng) * progress,
  };
}

function calculateProgress(position, start, destination) {
  const totalDistance =
    Math.abs(destination.lat - start.lat) +
    Math.abs(destination.lng - start.lng);

  const currentDistance =
    Math.abs(destination.lat - position.lat) +
    Math.abs(destination.lng - position.lng);

  if (!totalDistance) {
    return 0;
  }

  return Math.max(0, Math.min(1, 1 - currentDistance / totalDistance));
}

function calculateDistanceKm(a, b) {
  const R = 6371;

  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLng = ((b.lng - a.lng) * Math.PI) / 180;

  const lat1 = (a.lat * Math.PI) / 180;
  const lat2 = (b.lat * Math.PI) / 180;

  const value =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) * Math.sin(dLng / 2);

  const distance = 2 * Math.atan2(Math.sqrt(value), Math.sqrt(1 - value));

  return R * distance;
}

export default function TrackingMap({
  deliveryId = "demo-delivery",
  pickup = DEMO_PICKUP,
  dropoff = DEMO_DROPOFF,
  riderName = "Chinedu Okafor",
  status = "in_transit",
}) {
  const [riderPosition, setRiderPosition] = useState(DEMO_START);
  const [isLive, setIsLive] = useState(false);
  const [lastUpdate, setLastUpdate] = useState(null);

  const isDropoffStage =
    status === "collected" ||
    status === "going_to_dropoff" ||
    status === "arrived_at_dropoff";

  const destination = isDropoffStage ? dropoff : pickup;

  const destinationLabel = isDropoffStage ? "drop-off" : "pickup";

  const route = useMemo(() => {
    return [
      [riderPosition.lat, riderPosition.lng],
      [destination.lat, destination.lng],
    ];
  }, [riderPosition, destination]);

  const remainingDistance = useMemo(() => {
    return calculateDistanceKm(riderPosition, destination);
  }, [riderPosition, destination]);

  /*
   * REAL RIDER GPS
   *
   * First load the latest rider coordinates directly
   * from the deliveries table.
   *
   * Then listen for live GPS broadcasts.
   */

  useEffect(() => {
    if (!supabase || !deliveryId || deliveryId === "demo-delivery" || status === "delivered") {
      return;
    }

    let active = true;
    let channel = null;

    const loadCurrentRiderLocation = async () => {
      console.log("HOKADA TRACKING: Loading rider location...");

      const { data, error } = await supabase
        .from("deliveries")
        .select(
          `
            rider_lat,
            rider_lng,
            rider_heading,
            rider_speed,
            rider_accuracy,
            updated_at
          `
        )
        .eq("id", deliveryId)
        .single();

      if (error) {
        console.error("HOKADA TRACKING: Could not load rider location:", error);
        return;
      }

      if (!active) {
        return;
      }

      if (
        typeof data?.rider_lat === "number" &&
        typeof data?.rider_lng === "number"
      ) {
        const position = {
          lat: data.rider_lat,
          lng: data.rider_lng,
        };

        console.log("HOKADA TRACKING: Initial rider location:", position);

        setRiderPosition(position);
        setIsLive(true);

        setLastUpdate(data.updated_at ? new Date(data.updated_at) : new Date());
      } else {
        console.log("HOKADA TRACKING: Rider GPS is not available yet.");
      }
    };

    const connectRealtime = () => {
      console.log("HOKADA TRACKING: Connecting to rider GPS...");

      channel = supabase
        .channel(`delivery:${deliveryId}`)
        .on("broadcast", { event: "rider-location" }, (payload) => {
          if (!active) {
            return;
          }

          const location = payload?.payload;

          if (
            typeof location?.lat !== "number" ||
            typeof location?.lng !== "number"
          ) {
            return;
          }

          console.log("HOKADA TRACKING: Live rider location:", location);

          setRiderPosition({
            lat: location.lat,
            lng: location.lng,
          });

          setLastUpdate(
            location.timestamp ? new Date(location.timestamp) : new Date()
          );

          setIsLive(true);
        })
        .subscribe((subscriptionStatus) => {
          console.log("HOKADA TRACKING Realtime status:", subscriptionStatus);
        });
    };

    loadCurrentRiderLocation();
    connectRealtime();

    return () => {
      active = false;

      if (channel) {
        supabase.removeChannel(channel);
        channel = null;
      }
    };
  }, [deliveryId, status]);

  /*
   * REALTIME DATABASE FALLBACK
   *
   * If the broadcast is missed, listen for database
   * changes to the delivery's rider coordinates.
   */

  useEffect(() => {
    if (!supabase || !deliveryId || deliveryId === "demo-delivery" || status === "delivered") {
      return;
    }

    let active = true;

    const channel = supabase
      .channel(`delivery-db:${deliveryId}`)
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "deliveries",
          filter: `id=eq.${deliveryId}`,
        },
        (payload) => {
          if (!active) {
            return;
          }

          const delivery = payload.new;

          if (
            typeof delivery?.rider_lat !== "number" ||
            typeof delivery?.rider_lng !== "number"
          ) {
            return;
          }

          console.log(
            "HOKADA TRACKING: Database rider location:",
            delivery.rider_lat,
            delivery.rider_lng
          );

          setRiderPosition({
            lat: delivery.rider_lat,
            lng: delivery.rider_lng,
          });

          setLastUpdate(
            delivery.updated_at ? new Date(delivery.updated_at) : new Date()
          );

          setIsLive(true);
        }
      )
      .subscribe((subscriptionStatus) => {
        console.log("HOKADA TRACKING DB status:", subscriptionStatus);
      });

    return () => {
      active = false;
      supabase.removeChannel(channel);
    };
  }, [deliveryId, status]);

  /*
   * DEMO MODE
   *
   * Only use simulated movement when Supabase is not
   * configured or when this is the demo delivery.
   */

  useEffect(() => {
    if (supabase && deliveryId && deliveryId !== "demo-delivery") {
      return;
    }

    setIsLive(false);

    const interval = setInterval(() => {
      setRiderPosition((current) => {
        const startPoint = isDropoffStage ? pickup : DEMO_START;

        const nextProgress = Math.min(
          1,
          calculateProgress(current, startPoint, destination) + 0.015
        );

        const nextPosition = interpolatePosition(
          startPoint,
          destination,
          nextProgress
        );

        setLastUpdate(new Date());

        return nextPosition;
      });
    }, 1500);

    return () => clearInterval(interval);
  }, [deliveryId, destination, pickup, isDropoffStage]);

  const estimatedMinutes = Math.max(
    1,
    Math.round((remainingDistance / 25) * 60)
  );

  return (
    <div className="hokada-tracking-map-shell">
      <div className="hokada-map-status-bar">
        <div className="hokada-map-status-left">
          <div className="hokada-map-status-icon">
            {isLive ? <Radio size={17} /> : <Bike size={17} />}
          </div>

          <div>
            <strong>{isLive ? "Live rider tracking" : "Rider tracking"}</strong>

            <span>
              {isLive
                ? "Rider location is updating live"
                : "Waiting for rider GPS"}
            </span>
          </div>
        </div>

        <div className={`hokada-live-badge ${isLive ? "is-live" : "is-demo"}`}>
          <span className="hokada-live-dot"></span>

          {isLive ? "LIVE" : "WAITING"}
        </div>
      </div>

      <div
        className={`hokada-map-stage ${
          isDropoffStage
            ? "hokada-map-stage-dropoff"
            : "hokada-map-stage-pickup"
        }`}
      >
        <div className="hokada-map-stage-icon">
          {isDropoffStage ? <Flag size={17} /> : <MapPin size={17} />}
        </div>

        <div>
          <span>{isDropoffStage ? "DROP-OFF STAGE" : "PICKUP STAGE"}</span>

          <strong>
            {isDropoffStage
              ? "Rider is heading to drop-off"
              : "Rider is heading to pickup"}
          </strong>
        </div>
      </div>

      <div className="hokada-map-wrapper">
        <MapContainer
          center={[pickup.lat, pickup.lng]}
          zoom={13}
          scrollWheelZoom={true}
          className="hokada-map"
        >
          <TileLayer
            attribution='&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">OpenStreetMap</a> contributors'
            url="https://tile.openstreetmap.org/{z}/{x}/{y}.png"
          />

          <FitMap
            riderPosition={riderPosition}
            pickup={pickup}
            dropoff={dropoff}
          />

          <CenterRider riderPosition={riderPosition} />

          <Marker
            position={[riderPosition.lat, riderPosition.lng]}
            icon={riderIcon}
          >
            <Popup>
              <strong>{riderName}</strong>
              <br />
              HOKADA rider
              <br />
              {isLive ? "Live location" : "Waiting for live location"}
            </Popup>
          </Marker>

          <Marker position={[pickup.lat, pickup.lng]} icon={pickupIcon}>
            <Popup>
              <strong>Pickup</strong>
              <br />
              {pickup.label}
            </Popup>
          </Marker>

          <Marker position={[dropoff.lat, dropoff.lng]} icon={dropoffIcon}>
            <Popup>
              <strong>Drop-off</strong>
              <br />
              {dropoff.label}
            </Popup>
          </Marker>

          <Polyline
            positions={route}
            pathOptions={{
              className: "hokada-route-line",
              weight: 5,
              opacity: 0.85,
            }}
          />

          <CircleMarker
            center={[riderPosition.lat, riderPosition.lng]}
            radius={24}
            pathOptions={{
              fillOpacity: 0,
              opacity: 0.18,
              weight: 2,
            }}
          />
        </MapContainer>

        <div className="hokada-map-floating-card">
          <div className="hokada-map-rider-mini">
            <div className="hokada-map-rider-avatar">🏍️</div>

            <div>
              <strong>{riderName}</strong>

              <span>Honda Ace • KJA 482 XY</span>
            </div>
          </div>

          <div className="hokada-map-arrival">
            <strong>{estimatedMinutes} min</strong>

            <span>to {destinationLabel}</span>
          </div>
        </div>

        <button
          className="hokada-map-location-button"
          type="button"
          title="Center map on rider"
          onClick={() => {
            window.dispatchEvent(new CustomEvent("hokada-center-rider"));
          }}
        >
          <Navigation size={18} />
        </button>
      </div>

      <div className="hokada-map-info-grid">
        <div className="hokada-map-info-item">
          <div className="hokada-map-info-icon">
            <Bike size={18} />
          </div>

          <div>
            <span>Rider</span>

            <strong>{riderName}</strong>
          </div>
        </div>

        <div className="hokada-map-info-item">
          <div className="hokada-map-info-icon">
            <MapPin size={18} />
          </div>

          <div>
            <span>Distance to {destinationLabel}</span>

            <strong>{remainingDistance.toFixed(1)} km</strong>
          </div>
        </div>

        <div className="hokada-map-info-item">
          <div className="hokada-map-info-icon">
            <Flag size={18} />
          </div>

          <div>
            <span>Destination</span>

            <strong>{destination.label}</strong>
          </div>
        </div>
      </div>

      <div className="hokada-map-footer">
        <div>
          <span className="hokada-footer-status-dot"></span>

          {isLive ? (
            <span>
              GPS updated{" "}
              {lastUpdate
                ? lastUpdate.toLocaleTimeString([], {
                    hour: "2-digit",
                    minute: "2-digit",
                    second: "2-digit",
                  })
                : "just now"}
            </span>
          ) : (
            <span>Waiting for rider GPS</span>
          )}
        </div>

        {isLive && (
          <div className="hokada-secure-location">
            <Wifi size={14} />
            Live connection
          </div>
        )}
      </div>
    </div>
  );
}
