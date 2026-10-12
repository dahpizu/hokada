import { useState } from "react";
import { ArrowLeft, Bike, MapPin, Package, Phone, User } from "lucide-react";

function BookingForm({ onBack, onContinue }) {
  const [form, setForm] = useState({
    pickup: "",
    dropoff: "",
    packageType: "",
    packageDescription: "",
    recipientName: "",
    recipientPhone: "",
  });

  const updateField = (field, value) => {
    setForm((current) => ({
      ...current,
      [field]: value,
    }));
  };

  const handleSubmit = (event) => {
    event.preventDefault();

    if (
      !form.pickup ||
      !form.dropoff ||
      !form.packageType ||
      !form.recipientName ||
      !form.recipientPhone
    ) {
      alert("Please fill in all required fields.");
      return;
    }

    onContinue(form);
  };

  return (
    <div className="page">
      <div className="form-page">
        <button className="back-button" onClick={onBack}>
          <ArrowLeft size={20} />
          Back
        </button>

        <div className="page-heading">
          <div className="heading-icon">
            <Bike size={25} />
          </div>

          <div>
            <p className="eyebrow">HOKADA DELIVERY</p>
            <h1>Book a Rider</h1>
            <p>Tell us where your package is going.</p>
          </div>
        </div>

        <form className="booking-form" onSubmit={handleSubmit}>
          <div className="form-section">
            <h2>Delivery route</h2>

            <div className="form-group">
              <label>Pickup location *</label>

              <div className="input-wrapper">
                <MapPin size={19} />

                <input
                  type="text"
                  placeholder="Enter pickup address"
                  value={form.pickup}
                  onChange={(event) =>
                    updateField("pickup", event.target.value)
                  }
                />
              </div>
            </div>

            <div className="route-connector">
              <span></span>
            </div>

            <div className="form-group">
              <label>Drop-off location *</label>

              <div className="input-wrapper">
                <MapPin size={19} />

                <input
                  type="text"
                  placeholder="Enter delivery address"
                  value={form.dropoff}
                  onChange={(event) =>
                    updateField("dropoff", event.target.value)
                  }
                />
              </div>
            </div>
          </div>

          <div className="form-section">
            <h2>Package details</h2>

            <div className="form-group">
              <label>Package type *</label>

              <div className="input-wrapper">
                <Package size={19} />

                <select
                  value={form.packageType}
                  onChange={(event) =>
                    updateField("packageType", event.target.value)
                  }
                >
                  <option value="">Select package type</option>
                  <option value="Document">Document</option>
                  <option value="Small package">Small package</option>
                  <option value="Medium package">Medium package</option>
                  <option value="Large package">Large package</option>
                  <option value="Food">Food</option>
                  <option value="Clothing">Clothing</option>
                  <option value="Electronics">Electronics</option>
                  <option value="Other">Other</option>
                </select>
              </div>
            </div>

            <div className="form-group">
              <label>Package description</label>

              <textarea
                placeholder="What is inside the package?"
                value={form.packageDescription}
                onChange={(event) =>
                  updateField("packageDescription", event.target.value)
                }
              />
            </div>
          </div>

          <div className="form-section">
            <h2>Recipient details</h2>

            <div className="form-group">
              <label>Recipient name *</label>

              <div className="input-wrapper">
                <User size={19} />

                <input
                  type="text"
                  placeholder="Full name"
                  value={form.recipientName}
                  onChange={(event) =>
                    updateField("recipientName", event.target.value)
                  }
                />
              </div>
            </div>

            <div className="form-group">
              <label>Recipient phone *</label>

              <div className="input-wrapper">
                <Phone size={19} />

                <input
                  type="tel"
                  placeholder="08012345678"
                  value={form.recipientPhone}
                  onChange={(event) =>
                    updateField("recipientPhone", event.target.value)
                  }
                />
              </div>
            </div>
          </div>

          <button className="primary-button" type="submit">
            Get Delivery Price
            <Bike size={21} />
          </button>
        </form>
      </div>
    </div>
  );
}

export default BookingForm;
