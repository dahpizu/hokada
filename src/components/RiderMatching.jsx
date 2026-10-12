import { useEffect, useState } from "react";
import { Bike, CheckCircle2, MapPin, Phone, User } from "lucide-react";

function RiderMatching({ onComplete }) {
  const [status, setStatus] = useState("searching");

  useEffect(() => {
    const timer = setTimeout(() => {
      setStatus("found");
    }, 2500);

    return () => clearTimeout(timer);
  }, []);

  if (status === "searching") {
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
            location.
          </p>

          <div className="loading-bar">
            <span></span>
          </div>

          <small>This usually takes a few seconds.</small>
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

        <p className="eyebrow">RIDER FOUND</p>

        <h1>Your rider is on the way.</h1>

        <p className="success-text">
          Your delivery has been accepted by a HOKADA rider.
        </p>

        <div className="rider-card">
          <div className="rider-avatar">
            <User size={28} />
          </div>

          <div className="rider-info">
            <span>Your rider</span>
            <strong>Chinedu Okafor</strong>
            <small>HOKADA Rider • 4.9 ★</small>
          </div>

          <div className="bike-badge">
            <Bike size={22} />
          </div>
        </div>

        <div className="tracking-card">
          <div className="tracking-row">
            <MapPin size={20} />

            <div>
              <span>Status</span>
              <strong>Rider heading to pickup</strong>
            </div>
          </div>

          <div className="tracking-row">
            <Phone size={20} />

            <div>
              <span>Rider phone</span>
              <strong>0803 456 7890</strong>
            </div>
          </div>
        </div>

        <button className="primary-button" onClick={onComplete}>
          Back to Home
          <Bike size={21} />
        </button>
      </div>
    </div>
  );
}

export default RiderMatching;
