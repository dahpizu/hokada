import { Bike, CheckCircle2, Phone, User } from "lucide-react";

function RiderMatching({ rider = null, onComplete }) {
  const hasAssignedRider = Boolean(rider?.name);

  if (!hasAssignedRider) {
    return (
      <div className="page centered-page">
        <div className="matching-card">
          <div className="matching-animation">
            <Bike size={48} />
          </div>

          <p className="eyebrow">HOKADA</p>
          <h1>Finding a rider...</h1>

          <p>
            We're looking for an available dispatch rider near your pickup
            location. We'll update you when a rider accepts your delivery.
          </p>

          <div className="loading-bar">
            <span></span>
          </div>

          <small>Waiting for a confirmed rider assignment.</small>
        </div>
      </div>
    );
  }

  return (
    <div className="page">
      <div className="success-page">
        <div className="success-icon">
          <CheckCircle2 size={44} />
        </div>

        <p className="eyebrow">RIDER ASSIGNED</p>
        <h1>Your rider has accepted the delivery.</h1>

        <div className="rider-card">
          <div className="rider-avatar">
            <User size={28} />
          </div>

          <div className="rider-info">
            <span>Your rider</span>
            <strong>{rider.name}</strong>
            <small>
              {rider.rating != null
                ? `HOKADA Rider • ${rider.rating} ★`
                : "HOKADA Rider"}
            </small>
            <small>
              {[rider.bike, rider.plate].filter(Boolean).join(" • ") ||
                "Motorcycle details unavailable"}
            </small>
          </div>

          <div className="bike-badge">
            <Bike size={22} />
          </div>
        </div>

        {rider.phone && (
          <div className="tracking-card">
            <div className="tracking-row">
              <Phone size={20} />
              <div>
                <span>Rider phone</span>
                <strong>{rider.phone}</strong>
              </div>
            </div>
          </div>
        )}

        {onComplete && (
          <button className="primary-button" onClick={onComplete}>
            Continue
            <Bike size={21} />
          </button>
        )}
      </div>
    </div>
  );
}

export default RiderMatching;
