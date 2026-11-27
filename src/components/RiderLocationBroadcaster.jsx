import { useEffect, useRef, useState } from "react";
import { riderSupabase as supabase } from "../lib/supabase";
import { riderApiRequest } from "../lib/riderApi";
import { Radio, ShieldCheck, Wifi, WifiOff } from "lucide-react";

export default function RiderLocationBroadcaster({
  deliveryId,
  riderId,
  enabled = true,
}) {
  const watchIdRef = useRef(null);
  const lastSentAtRef = useRef(0);

  const [status, setStatus] = useState("waiting");
  const [lastLocation, setLastLocation] = useState(null);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!deliveryId || !riderId || !enabled) {
      setStatus("waiting");
      setError("");
      return;
    }

    if (!supabase) {
      setStatus("offline");
      setError("Supabase has not been configured.");
      return;
    }

    if (!navigator.geolocation) {
      setStatus("error");
      setError("This device does not support GPS location.");
      return;
    }

    let active = true;

    const updateRiderLocation = async (location) => {
      if (!active) return;

      try {
        await riderApiRequest(
          `/api/rider/deliveries/${encodeURIComponent(deliveryId)}/location`,
          {
            method: "POST",
            body: JSON.stringify({
              latitude: location.lat,
              longitude: location.lng,
              heading: location.heading,
              speed: location.speed,
              accuracy: location.accuracy,
            }),
          }
        );

        if (!active) return;
        setStatus("connected");
        setError("");
      } catch (updateError) {
        if (!active) return;
        console.error("Rider location update error:", updateError);
        setStatus("error");
        setError(updateError.message);
      }
    };

    const startTracking = async () => {
      setStatus("connecting");
      setError("");

      watchIdRef.current = navigator.geolocation.watchPosition(
        async (position) => {
          if (!active) {
            return;
          }

          const location = {
            lat: position.coords.latitude,
            lng: position.coords.longitude,
            heading: position.coords.heading ?? null,
            speed: position.coords.speed ?? null,
            accuracy: position.coords.accuracy ?? null,
            timestamp: new Date().toISOString(),
          };

          setLastLocation(location);
          if (Date.now() - lastSentAtRef.current < 10000) return;
          lastSentAtRef.current = Date.now();
          setStatus("connecting");
          setError("");

          await updateRiderLocation(location);
        },
        (locationError) => {
          if (!active) {
            return;
          }

          console.error(
            "HOKADA GPS error:",
            locationError.code,
            locationError.message
          );

          setStatus("error");
          setError(locationError.message);
        },
        {
          enableHighAccuracy: true,
          maximumAge: 5000,
          timeout: 15000,
        }
      );
    };

    startTracking();

    return () => {
      active = false;

      if (watchIdRef.current !== null) {
        navigator.geolocation.clearWatch(watchIdRef.current);
        watchIdRef.current = null;
      }

    };
  }, [deliveryId, riderId, enabled]);

  if (!deliveryId || !riderId || !enabled) {
    return null;
  }

  return (
    <div className="hokada-rider-gps-card">
      <div className="hokada-rider-gps-header">
        <div className="hokada-rider-gps-icon">
          <Radio size={18} />
        </div>

        <div>
          <strong>Live GPS tracking</strong>

          <span>
            {status === "connected"
              ? "Your location is being shared"
              : status === "error"
              ? "GPS connection problem"
              : status === "offline"
              ? "Supabase unavailable"
              : status === "connecting"
              ? "Starting GPS..."
              : "Connecting to GPS..."}
          </span>
        </div>

        <div className="hokada-rider-gps-status">
          {status === "connected" ? <Wifi size={17} /> : <WifiOff size={17} />}
        </div>
      </div>

      {lastLocation && (
        <div className="hokada-rider-gps-location">
          <div>
            <span>Latitude</span>
            <strong>{lastLocation.lat.toFixed(6)}</strong>
          </div>

          <div>
            <span>Longitude</span>
            <strong>{lastLocation.lng.toFixed(6)}</strong>
          </div>

          <div>
            <span>Accuracy</span>
            <strong>{Math.round(lastLocation.accuracy || 0)} m</strong>
          </div>
        </div>
      )}

      {status === "connected" && (
        <div className="hokada-rider-gps-secure">
          <ShieldCheck size={15} />
          <span>Location sharing is active</span>
        </div>
      )}

      {error && <div className="hokada-rider-gps-error">{error}</div>}
    </div>
  );
}
