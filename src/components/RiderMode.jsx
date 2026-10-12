import { useState } from "react";
import {
  ArrowLeft,
  Bike,
  CheckCircle2,
  MapPin,
  Navigation,
  Radio,
  ShieldCheck,
} from "lucide-react";
import RiderLocationBroadcaster from "./RiderLocationBroadcaster";

export default function RiderMode({
  deliveryId,
  riderName = "Chinedu Okafor",
  onBack,
}) {
  const [tracking, setTracking] = useState(false);

  return (
    <div className="rider-mode-page">
      <div className="rider-mode-header">
        <button className="rider-back-button" onClick={onBack}>
          <ArrowLeft size={19} />
        </button>

        <div>
          <span>HOKADA RIDER</span>
          <h1>Rider Mode</h1>
        </div>

        <div className="rider-online-badge">
          <span />
          Online
        </div>
      </div>

      <div className="rider-profile-card">
        <div className="rider-mode-avatar">
          <Bike size={28} />
        </div>

        <div>
          <span>Rider</span>
          <strong>{riderName}</strong>
          <small>Honda Ace • KJA 482 XY</small>
        </div>
      </div>

      <div className="rider-delivery-card">
        <div className="rider-delivery-heading">
          <div>
            <span>ACTIVE DELIVERY</span>
            <h2>Delivery #{deliveryId || "Waiting"}</h2>
          </div>

          <div className="delivery-active-icon">
            <Navigation size={20} />
          </div>
        </div>

        <div className="rider-location-row">
          <div className="rider-location-icon pickup">
            <MapPin size={17} />
          </div>

          <div>
            <span>Pickup</span>
            <strong>Customer pickup location</strong>
          </div>
        </div>

        <div className="rider-location-line" />

        <div className="rider-location-row">
          <div className="rider-location-icon dropoff">
            <MapPin size={17} />
          </div>

          <div>
            <span>Drop-off</span>
            <strong>Customer delivery location</strong>
          </div>
        </div>
      </div>

      <div className="gps-card">
        <div className="gps-card-header">
          <div className="gps-icon">
            <Radio size={21} />
          </div>

          <div>
            <strong>GPS location sharing</strong>
            <span>
              Your location will be shared with the customer while you are
              delivering.
            </span>
          </div>
        </div>

        <RiderLocationBroadcaster deliveryId={deliveryId} enabled={tracking} />

        <button
          className={`gps-toggle-button ${tracking ? "tracking-active" : ""}`}
          onClick={() => setTracking((current) => !current)}
        >
          {tracking ? (
            <>
              <CheckCircle2 size={19} />
              Stop sharing location
            </>
          ) : (
            <>
              <Navigation size={19} />
              Start sharing location
            </>
          )}
        </button>
      </div>

      <div className="rider-safety-card">
        <ShieldCheck size={19} />

        <div>
          <strong>Your location is protected</strong>
          <span>
            Location sharing is only active while you are on a delivery.
          </span>
        </div>
      </div>
    </div>
  );
}
