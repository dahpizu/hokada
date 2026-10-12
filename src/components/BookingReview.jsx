import {
  ArrowLeft,
  Bike,
  Check,
  MapPin,
  Package,
  Phone,
  User,
} from "lucide-react";

function BookingReview({ booking, onBack, onConfirm }) {
  const deliveryFee = 2500;

  return (
    <div className="page">
      <div className="review-page">
        <button className="back-button" onClick={onBack}>
          <ArrowLeft size={20} />
          Back
        </button>

        <div className="page-heading">
          <div className="heading-icon">
            <Check size={25} />
          </div>

          <div>
            <p className="eyebrow">DELIVERY QUOTE</p>
            <h1>Review your booking</h1>
            <p>Check everything before you request a rider.</p>
          </div>
        </div>

        <div className="review-card">
          <div className="review-route">
            <div className="review-location">
              <div className="review-dot pickup-dot">
                <MapPin size={17} />
              </div>

              <div>
                <span>Pickup</span>
                <strong>{booking.pickup}</strong>
              </div>
            </div>

            <div className="review-line"></div>

            <div className="review-location">
              <div className="review-dot dropoff-dot">
                <MapPin size={17} />
              </div>

              <div>
                <span>Drop-off</span>
                <strong>{booking.dropoff}</strong>
              </div>
            </div>
          </div>

          <div className="review-divider"></div>

          <div className="detail-row">
            <div className="detail-icon">
              <Package size={19} />
            </div>

            <div>
              <span>Package</span>
              <strong>{booking.packageType}</strong>

              {booking.packageDescription && (
                <small>{booking.packageDescription}</small>
              )}
            </div>
          </div>

          <div className="detail-row">
            <div className="detail-icon">
              <User size={19} />
            </div>

            <div>
              <span>Recipient</span>
              <strong>{booking.recipientName}</strong>
            </div>
          </div>

          <div className="detail-row">
            <div className="detail-icon">
              <Phone size={19} />
            </div>

            <div>
              <span>Phone</span>
              <strong>{booking.recipientPhone}</strong>
            </div>
          </div>
        </div>

        <div className="price-card">
          <div>
            <span>Estimated delivery fee</span>
            <strong>₦{deliveryFee.toLocaleString()}</strong>
          </div>

          <p>
            Final pricing may vary slightly depending on the route and rider
            availability.
          </p>
        </div>

        <button className="primary-button" onClick={onConfirm}>
          Confirm & Find Rider
          <Bike size={21} />
        </button>
      </div>
    </div>
  );
}

export default BookingReview;
