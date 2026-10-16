import { useEffect, useRef, useState } from "react";
import { supabase } from "../lib/supabase";
import { Radio, ShieldCheck, Wifi, WifiOff } from "lucide-react";

export default function RiderLocationBroadcaster({
  deliveryId,
  riderId,
  enabled = true,
}) {
  const channelRef = useRef(null);
  const watchIdRef = useRef(null);

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
      const { error: updateError } = await supabase
        .from("deliveries")
        .update({
          rider_lat: location.lat,
          rider_lng: location.lng,
          rider_heading: location.heading,
          rider_speed: location.speed,
          rider_accuracy: location.accuracy,
          updated_at: new Date().toISOString(),
        })
        .eq("id", deliveryId)
        .eq("rider_id", riderId);

      if (updateError) {
        console.error("Rider location update error:", updateError);
        setError(updateError.message);
        return;
      }

      console.log("HOKADA GPS saved:", location);

      if (channelRef.current) {
        const { error: broadcastError } = await channelRef.current.send({
          type: "broadcast",
          event: "rider-location",
          payload: location,
        });

        if (broadcastError) {
          console.error("Rider location broadcast error:", broadcastError);
        }
      }
    };

    const startTracking = async () => {
      console.log("========== HOKADA GPS START ==========");
      console.log("Delivery ID:", deliveryId);
      console.log("GPS enabled:", enabled);
      console.log("Browser geolocation available:", !!navigator.geolocation);
      console.log("=======================================");

      setStatus("connecting");
      setError("");

      const channel = supabase.channel(`delivery:${deliveryId}`);

      channelRef.current = channel;

      channel.subscribe((subscriptionStatus) => {
        console.log("HOKADA GPS Realtime status:", subscriptionStatus);

        if (!active) {
          return;
        }

        if (subscriptionStatus === "SUBSCRIBED") {
          console.log("HOKADA GPS Realtime connected.");
        }

        if (subscriptionStatus === "CHANNEL_ERROR") {
          console.error("HOKADA GPS Realtime channel error.");
          setError("Realtime connection failed.");
        }
      });

      console.log("Starting browser GPS watch...");

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

          console.log("HOKADA GPS position received:", location);

          setLastLocation(location);
          setStatus("connected");
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

      console.log("HOKADA GPS cleanup:", deliveryId);

      if (watchIdRef.current !== null) {
        navigator.geolocation.clearWatch(watchIdRef.current);
        watchIdRef.current = null;
      }

      if (channelRef.current) {
        supabase.removeChannel(channelRef.current);
        channelRef.current = null;
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
