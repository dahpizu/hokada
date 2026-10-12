import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import TrackingMap from "./components/TrackingMap";
import TrackingChat from "./components/TrackingChat";
import CustomerAuth from "./components/CustomerAuth";
import { supabase } from "./lib/supabase";

import {
  ArrowLeft,
  Bike,
  Check,
  CheckCircle2,
  ChevronRight,
  Clock3,
  Home,
  MapPin,
  Package,
  Phone,
  Search,
  User,
  Wallet,
  Zap,
  Navigation,
  Flag,
  LoaderCircle,
  XCircle,
} from "lucide-react";

import "./App.css";

const PACKAGE_FEES = {
  Small: 0,
  Medium: 300,
  Large: 700,
};

const BASE_FEE = 800;
const PRICE_PER_KM = 150;
const EXPRESS_FEE = 500;
const WAITING_FEE = 200;

const DEMO_RIDER = {
  name: "Chinedu Okafor",
  phone: "0803 456 7890",
  bike: "Honda Ace",
  plate: "KJA 482 XY",
  rating: "4.9",
};

const PAYMENT_API_URL = (
  import.meta.env.VITE_PAYMENT_API_URL || "http://localhost:4242"
).replace(/\/+$/, "");

const PAYMENT_ELIGIBLE_STATUSES = ["arrived_at_dropoff", "delivered"];

/*
 * =========================================================
 * ADDRESS GEOCODING
 * =========================================================
 */

async function geocodeAddress(address) {
  const query = `${address}, Lagos, Nigeria`;

  const response = await fetch(
    `https://nominatim.openstreetmap.org/search?format=json&limit=1&countrycodes=ng&q=${encodeURIComponent(
      query
    )}`,
    {
      headers: {
        Accept: "application/json",
      },
    }
  );

  if (!response.ok) {
    throw new Error("Unable to find this location.");
  }

  const results = await response.json();

  if (!results.length) {
    throw new Error(`Location not found: ${address}`);
  }

  return {
    lat: Number(results[0].lat),
    lng: Number(results[0].lon),
    displayName: results[0].display_name,
  };
}

/*
 * =========================================================
 * DELIVERY PRICING
 * =========================================================
 */

function estimateDistance(pickup, dropoff) {
  const locationText = `${pickup} ${dropoff}`.toLowerCase();

  const knownRoutes = [
    { keywords: ["ikeja", "yaba"], distance: 12 },
    { keywords: ["ikeja", "lekki"], distance: 24 },
    { keywords: ["ikeja", "ajah"], distance: 28 },
    { keywords: ["yaba", "lekki"], distance: 17 },
    { keywords: ["yaba", "ajah"], distance: 21 },
    { keywords: ["lekki", "ajah"], distance: 14 },
    { keywords: ["lekki", "victoria island"], distance: 9 },
    { keywords: ["ikeja", "victoria island"], distance: 20 },
    { keywords: ["surulere", "ikeja"], distance: 11 },
    { keywords: ["surulere", "yaba"], distance: 8 },
    { keywords: ["surulere", "lekki"], distance: 19 },
  ];

  const matchedRoute = knownRoutes.find(
    (route) =>
      locationText.includes(route.keywords[0]) &&
      locationText.includes(route.keywords[1])
  );

  if (matchedRoute) {
    return matchedRoute.distance;
  }

  const combinedLength = pickup.length + dropoff.length;

  return Math.max(5, Math.min(Math.round(combinedLength / 3), 30));
}

function calculateDeliveryFee(pickup, dropoff, packageSize, deliveryType) {
  const distance = estimateDistance(pickup, dropoff);
  const distanceFee = distance * PRICE_PER_KM;
  const packageFee = PACKAGE_FEES[packageSize] || 0;
  const expressFee = deliveryType === "Express" ? EXPRESS_FEE : 0;

  const total = BASE_FEE + distanceFee + packageFee + expressFee;

  return {
    distance,
    baseFee: BASE_FEE,
    distanceFee,
    packageFee,
    expressFee,
    total,
  };
}

function formatNaira(amount) {
  return `₦${Number(amount || 0).toLocaleString("en-NG")}`;
}

function mapDeliveryHistory(delivery) {
  return {
    id: delivery.id,
    pickup: delivery.pickup_address,
    dropoff: delivery.dropoff_address,
    deliveryType: delivery.delivery_type,
    packageSize: delivery.package_type,
    recipientName: delivery.recipient_name,
    recipientPhone: delivery.recipient_phone,
    notes: delivery.notes || "",
    status: delivery.status,
    deliveryFee: delivery.delivery_fee,
    paymentStatus: delivery.payment_status,
    pricing: {
      total: Number(delivery.delivery_fee || 0),
    },
    createdAt: delivery.created_at,
    riderName: delivery.rider_name,
  };
}

/*
 * =========================================================
 * AUTHENTICATED PAYMENT API
 * =========================================================
 */

async function paymentApiRequest(path, options = {}) {
  if (!supabase) {
    throw new Error("HOKADA could not connect to Supabase.");
  }

  const {
    data: { session },
    error: sessionError,
  } = await supabase.auth.getSession();

  if (sessionError || !session?.access_token) {
    throw new Error("Please sign in again before continuing.");
  }

  const response = await fetch(`${PAYMENT_API_URL}${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${session.access_token}`,
      ...options.headers,
    },
  });

  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(data.error || "The payment request failed.");
  }

  return data;
}

/*
 * =========================================================
 * PAYSTACK VERIFICATION REQUEST DEDUPLICATION
 * =========================================================
 */

const paymentVerificationRequests = new Map();

function verifyPaystackReference(reference) {
  if (paymentVerificationRequests.has(reference)) {
    return paymentVerificationRequests.get(reference);
  }

  const request = (async () => {
    const result = await paymentApiRequest(
      `/api/payments/verify/${encodeURIComponent(reference)}`
    );

    if (!result.verified || !result.delivery?.id) {
      throw new Error(result.error || "Your payment could not be confirmed.");
    }

    return {
      success: true,
      deliveryId: result.delivery.id,
    };
  })();

  paymentVerificationRequests.set(reference, request);

  request
    .finally(() => {
      if (paymentVerificationRequests.get(reference) === request) {
        paymentVerificationRequests.delete(reference);
      }
    })
    .catch(() => {});

  return request;
}

/*
 * =========================================================
 * PAYMENT CALLBACK PAGE
 * =========================================================
 */

function PaymentCallback({ onVerified, onReturnHome }) {
  const [message, setMessage] = useState("Verifying your payment...");
  const [error, setError] = useState("");
  const [retryKey, setRetryKey] = useState(0);
  const hasCompleted = useRef(false);

  useEffect(() => {
    let active = true;

    async function verifyPayment() {
      if (!supabase) {
        setError("HOKADA could not connect to Supabase.");
        return;
      }

      const params = new URLSearchParams(window.location.search);
      const reference = params.get("reference") || params.get("trxref");

      if (!reference) {
        setError(
          "No Paystack payment reference was found. Check your delivery history before attempting another payment."
        );
        return;
      }

      try {
        setError("");
        setMessage("Verifying your payment...");

        const payment = await verifyPaystackReference(reference);

        if (!active) return;

        setMessage("Payment confirmed! Opening your delivery...");

        await onVerified(payment.deliveryId);

        if (!active) return;

        hasCompleted.current = true;

        window.history.replaceState({}, "", "/");
      } catch (err) {
        if (!active) return;

        console.error("Payment callback error:", err);

        setError(
          err?.message || "Something went wrong verifying your payment."
        );
      }
    }

    if (!hasCompleted.current) {
      verifyPayment();
    }

    return () => {
      active = false;
    };
  }, [onVerified, retryKey]);

  return (
    <main className="payment-callback">
      <div className="payment-callback-card">
        {error ? (
          <XCircle size={54} color="#ef4444" />
        ) : message.startsWith("Payment confirmed") ? (
          <CheckCircle2 size={54} color="#16a34a" />
        ) : (
          <LoaderCircle size={54} color="#16a34a" className="payment-spinner" />
        )}

        <h1>{error ? "Payment verification failed" : "HOKADA Payment"}</h1>

        <p>{error || message}</p>

        {error && (
          <div className="payment-callback-actions">
            <button
              type="button"
              className="primary-button full-width"
              onClick={() => {
                setError("");
                setMessage("Retrying payment verification...");
                setRetryKey((value) => value + 1);
              }}
            >
              Try verification again
            </button>

            <button
              type="button"
              className="secondary-button full-width"
              onClick={onReturnHome}
            >
              Return to HOKADA
            </button>
          </div>
        )}
      </div>
    </main>
  );
}

/*
 * =========================================================
 * MAIN APP
 * =========================================================
 */

function App() {
  const [page, setPage] = useState(() =>
    window.location.pathname === "/payment-callback"
      ? "payment-callback"
      : "home"
  );

  const [customerUser, setCustomerUser] = useState(null);
  const [authLoading, setAuthLoading] = useState(true);

  const [booking, setBooking] = useState({
    pickup: "",
    dropoff: "",
    recipientName: "",
    recipientPhone: "",
    packageSize: "Small",
    deliveryType: "Standard",
    notes: "",
  });

  const [currentBooking, setCurrentBooking] = useState(null);
  const [deliveries, setDeliveries] = useState([]);
  const [isMatching, setIsMatching] = useState(false);
  const [isPaying, setIsPaying] = useState(false);
  const [assignedRider, setAssignedRider] = useState(null);

  /*
   * =========================================================
   * CUSTOMER AUTH SESSION
   * =========================================================
   */

  useEffect(() => {
    if (!supabase) {
      setAuthLoading(false);
      return;
    }

    let mounted = true;

    async function loadCustomerSession() {
      const {
        data: { session },
        error,
      } = await supabase.auth.getSession();

      if (!mounted) return;

      if (error) {
        console.error("Could not load session:", error);
      }

      setCustomerUser(session?.user || null);
      setAuthLoading(false);
    }

    loadCustomerSession();

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event, session) => {
      setCustomerUser(session?.user || null);
      setAuthLoading(false);
    });

    return () => {
      mounted = false;
      subscription.unsubscribe();
    };
  }, []);

  /*
   * =========================================================
   * LOAD CUSTOMER DELIVERY HISTORY
   * =========================================================
   */

  useEffect(() => {
    if (!supabase || !customerUser?.id) return;

    let active = true;

    async function loadCustomerDeliveries() {
      const { data, error } = await supabase
        .from("deliveries")
        .select("*")
        .eq("customer_id", customerUser.id)
        .order("created_at", {
          ascending: false,
        });

      if (!active) return;

      if (error) {
        console.error("Could not load customer deliveries:", error);
        return;
      }

      setDeliveries((data || []).map(mapDeliveryHistory));
    }

    loadCustomerDeliveries();

    return () => {
      active = false;
    };
  }, [customerUser?.id]);

  /*
   * =========================================================
   * PRICING
   * =========================================================
   */

  const pricing = useMemo(
    () =>
      calculateDeliveryFee(
        booking.pickup,
        booking.dropoff,
        booking.packageSize,
        booking.deliveryType
      ),
    [booking.pickup, booking.dropoff, booking.packageSize, booking.deliveryType]
  );

  /*
   * =========================================================
   * LIVE DELIVERY UPDATES
   * =========================================================
   */

  useEffect(() => {
    if (!supabase || !currentBooking?.id) return;

    const channel = supabase
      .channel(`customer-delivery:${currentBooking.id}`)
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "deliveries",
          filter: `id=eq.${currentBooking.id}`,
        },
        (payload) => {
          const updatedDelivery = payload.new;
          const riderName = updatedDelivery.rider_name;

          const updatedRider = riderName
            ? {
                ...DEMO_RIDER,
                name: riderName,
              }
            : null;

          setCurrentBooking((previous) => {
            if (!previous) return previous;

            return {
              ...previous,
              status: updatedDelivery.status,
              delivery: updatedDelivery,
              rider: updatedRider || previous.rider || null,
            };
          });

          if (updatedRider) {
            setAssignedRider(updatedRider);
          }

          setDeliveries((previous) =>
            previous.map((item) =>
              item.id === updatedDelivery.id
                ? {
                    ...item,
                    status: updatedDelivery.status,
                    paymentStatus: updatedDelivery.payment_status,
                    riderName: updatedDelivery.rider_name,
                    deliveryFee: updatedDelivery.delivery_fee,
                  }
                : item
            )
          );

          if (
            [
              "accepted",
              "in_transit",
              "arrived",
              "collected",
              "going_to_dropoff",
              "arrived_at_dropoff",
              "delivered",
            ].includes(updatedDelivery.status)
          ) {
            setIsMatching(false);
            setPage("tracking");
          }
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [currentBooking?.id]);

  /*
   * =========================================================
   * BOOKING HELPERS
   * =========================================================
   */

  function updateBooking(field, value) {
    setBooking((previous) => ({
      ...previous,
      [field]: value,
    }));
  }

  function goHome() {
    setPage("home");
  }

  function openBooking() {
    setPage("booking");
  }

  function handleContinueToReview() {
    if (
      !booking.pickup.trim() ||
      !booking.dropoff.trim() ||
      !booking.recipientName.trim() ||
      !booking.recipientPhone.trim()
    ) {
      alert("Please fill in all required delivery details.");
      return;
    }

    setPage("review");
  }

  /*
   * =========================================================
   * CREATE DELIVERY — NO PAYMENT YET
   * =========================================================
   */

  async function confirmBooking() {
    if (!supabase) {
      alert("HOKADA could not connect to Supabase.");
      return;
    }

    if (!customerUser?.id) {
      alert("Please log in before creating a delivery.");
      return;
    }

    if (isPaying) return;

    try {
      setIsPaying(true);
      setAssignedRider(null);
      setIsMatching(false);

      const pickupCoords = await geocodeAddress(booking.pickup.trim());
      const dropoffCoords = await geocodeAddress(booking.dropoff.trim());

      const deliveryPayload = {
        customer_id: customerUser.id,
        customer_name:
          customerUser.user_metadata?.full_name || "HOKADA Customer",

        rider_name: null,
        rider_id: null,

        pickup_address: booking.pickup.trim(),
        dropoff_address: booking.dropoff.trim(),

        pickup_lat: pickupCoords.lat,
        pickup_lng: pickupCoords.lng,
        dropoff_lat: dropoffCoords.lat,
        dropoff_lng: dropoffCoords.lng,

        rider_lat: null,
        rider_lng: null,
        rider_heading: null,
        rider_speed: null,
        rider_accuracy: null,

        recipient_name: booking.recipientName.trim(),
        recipient_phone: booking.recipientPhone.trim(),

        package_type: booking.packageSize,
        package_description: `${booking.packageSize} package`,
        delivery_type: booking.deliveryType,
        notes: booking.notes.trim() || null,

        delivery_fee: pricing.total,
        rider_earnings: 0,

        status: "searching",
        payment_status: "unpaid",
        payment_provider: null,
        payment_reference: null,
        paid_at: null,
      };

      const { data: delivery, error: insertError } = await supabase
        .from("deliveries")
        .insert(deliveryPayload)
        .select()
        .single();

      if (insertError) {
        throw new Error(`Could not create delivery: ${insertError.message}`);
      }

      const newBooking = {
        id: delivery.id,
        ...booking,
        pricing,
        status: "searching",
        createdAt: delivery.created_at,
        delivery: {
          ...delivery,
          status: "searching",
          payment_status: "unpaid",
        },
        rider: null,
      };

      setCurrentBooking(newBooking);

      setDeliveries((previous) => [
        mapDeliveryHistory({
          ...delivery,
          status: "searching",
          payment_status: "unpaid",
        }),
        ...previous.filter((item) => item.id !== delivery.id),
      ]);

      setIsMatching(true);
      setIsPaying(false);
      setPage("matching");
    } catch (error) {
      console.error("HOKADA booking error:", error);

      setIsPaying(false);
      setPage("review");

      alert(
        error?.message || "Could not create your delivery. Please try again."
      );
    }
  }

  /*
   * =========================================================
   * PAY ONLY WHEN RIDER REACHES THE DESTINATION
   * =========================================================
   */

  async function payForDelivery(deliveryId) {
    if (!supabase || !customerUser?.id) {
      alert("Please sign in before paying.");
      return;
    }

    if (isPaying) return;

    try {
      setIsPaying(true);

      const { data: delivery, error: deliveryError } = await supabase
        .from("deliveries")
        .select("id, customer_id, status, payment_status")
        .eq("id", deliveryId)
        .eq("customer_id", customerUser.id)
        .single();

      if (deliveryError || !delivery) {
        throw new Error("Could not find your delivery.");
      }

      if (!PAYMENT_ELIGIBLE_STATUSES.includes(delivery.status)) {
        throw new Error(
          "Payment becomes available when your rider reaches the drop-off location."
        );
      }

      if (delivery.payment_status === "paid") {
        throw new Error("This delivery has already been paid for.");
      }

      if (!customerUser.email) {
        throw new Error(
          "Your account has no email address for Paystack checkout."
        );
      }

      const payment = await paymentApiRequest("/api/payments/initialize", {
        method: "POST",
        body: JSON.stringify({
          email: customerUser.email,
          deliveryId: delivery.id,
        }),
      });

      if (!payment.authorizationUrl) {
        throw new Error("Paystack did not return a checkout URL.");
      }

      window.location.assign(payment.authorizationUrl);
    } catch (error) {
      console.error("HOKADA payment error:", error);

      setIsPaying(false);

      alert(error?.message || "Could not start payment. Please try again.");
    }
  }

  /*
   * =========================================================
   * HANDLE VERIFIED PAYMENT
   * =========================================================
   */

  const handlePaymentVerified = useCallback(
    async (deliveryId) => {
      if (!supabase || !customerUser?.id) {
        throw new Error("Please sign in to continue.");
      }

      const { data: delivery, error } = await supabase
        .from("deliveries")
        .select("*")
        .eq("id", deliveryId)
        .eq("customer_id", customerUser.id)
        .single();

      if (error || !delivery) {
        throw new Error(
          "Payment was verified, but the delivery could not be loaded."
        );
      }

      if (delivery.payment_status !== "paid") {
        throw new Error(
          "Payment is still being confirmed. Please retry verification shortly."
        );
      }

      const restoredPricing = {
        ...calculateDeliveryFee(
          delivery.pickup_address,
          delivery.dropoff_address,
          delivery.package_type,
          delivery.delivery_type
        ),
        total: Number(delivery.delivery_fee),
      };

      const restoredBooking = {
        id: delivery.id,
        pickup: delivery.pickup_address,
        dropoff: delivery.dropoff_address,
        recipientName: delivery.recipient_name,
        recipientPhone: delivery.recipient_phone,
        packageSize: delivery.package_type,
        deliveryType: delivery.delivery_type,
        notes: delivery.notes || "",
        pricing: restoredPricing,
        status: delivery.status,
        createdAt: delivery.created_at,
        delivery,
        rider: delivery.rider_name
          ? {
              ...DEMO_RIDER,
              name: delivery.rider_name,
            }
          : null,
      };

      setBooking({
        pickup: restoredBooking.pickup,
        dropoff: restoredBooking.dropoff,
        recipientName: restoredBooking.recipientName,
        recipientPhone: restoredBooking.recipientPhone,
        packageSize: restoredBooking.packageSize,
        deliveryType: restoredBooking.deliveryType,
        notes: restoredBooking.notes,
      });

      setCurrentBooking(restoredBooking);
      setAssignedRider(restoredBooking.rider);
      setIsPaying(false);
      setIsMatching(false);

      setDeliveries((previous) => [
        mapDeliveryHistory(delivery),
        ...previous.filter((item) => item.id !== delivery.id),
      ]);

      setPage("tracking");
    },
    [customerUser?.id]
  );

  function returnHomeFromPayment() {
    window.history.replaceState({}, "", "/");
    setIsPaying(false);
    setPage("home");
  }

  async function cancelBooking() {
    if (!supabase || !currentBooking?.id) {
      alert("Unable to cancel this delivery. Please try again.");
      return;
    }

    const { data, error } = await supabase
      .from("deliveries")
      .update({ status: "cancelled" })
      .eq("id", currentBooking.id)
      .is("rider_id", null)
      .in("status", ["searching", "pending"])
      .select("id")
      .maybeSingle();

    if (error) {
      console.error("Could not cancel delivery:", error);
      alert("Could not cancel this delivery. Please try again.");
      return;
    }

    if (!data) {
      alert(
        "This delivery may already be assigned to a rider or may already be cancelled. Please refresh and check its status."
      );
      return;
    }

    setCurrentBooking(null);
    setAssignedRider(null);
    setIsMatching(false);
    setPage("home");
  }

  /*
   * =========================================================
   * AUTH LOADING SCREEN
   * =========================================================
   */

  if (authLoading) {
    return (
      <div className="app-shell">
        <main className="auth-loading-page">
          <div className="matching-animation">
            <div className="matching-ring ring-one"></div>
            <div className="matching-ring ring-two"></div>

            <div className="matching-icon">
              <Bike size={45} />
            </div>
          </div>

          <span className="eyebrow">HOKADA</span>

          <h1 className="matching-title">Loading your account...</h1>
        </main>
      </div>
    );
  }

  /*
   * =========================================================
   * CUSTOMER LOGIN / SIGNUP
   * =========================================================
   */

  if (!customerUser) {
    return (
      <CustomerAuth
        onAuthenticated={(user) => {
          setCustomerUser(user);

          setPage(
            window.location.pathname === "/payment-callback"
              ? "payment-callback"
              : "home"
          );
        }}
      />
    );
  }

  /*
   * =========================================================
   * PAYMENT CALLBACK ROUTE
   * =========================================================
   */

  if (page === "payment-callback") {
    return (
      <div className="app-shell">
        <PaymentCallback
          onVerified={handlePaymentVerified}
          onReturnHome={returnHomeFromPayment}
        />
      </div>
    );
  }

  /*
   * =========================================================
   * MAIN HOKADA APP
   * =========================================================
   */

  return (
    <div className="app-shell">
      <header className="topbar">
        <button className="brand-button" onClick={goHome}>
          <div className="brand-icon">
            <Bike size={24} />
          </div>

          <div className="brand-text">
            <span>HOKADA</span>
            <small>FAST. SAFE. DELIVERED.</small>
          </div>
        </button>

        <button className="profile-button" onClick={() => setPage("profile")}>
          <User size={19} />
        </button>
      </header>

      <main className="main-content">
        {page === "home" && (
          <HomePage
            onBook={openBooking}
            onDeliveries={() => setPage("deliveries")}
            onProfile={() => setPage("profile")}
          />
        )}

        {page === "booking" && (
          <BookingPage
            booking={booking}
            updateBooking={updateBooking}
            pricing={pricing}
            onBack={goHome}
            onContinue={handleContinueToReview}
          />
        )}

        {page === "review" && (
          <ReviewPage
            booking={booking}
            pricing={pricing}
            isPaying={isPaying}
            onBack={() => setPage("booking")}
            onConfirm={confirmBooking}
          />
        )}

        {page === "matching" && (
          <MatchingPage
            booking={booking}
            pricing={currentBooking?.pricing || pricing}
            isMatching={isMatching}
            onCancel={cancelBooking}
          />
        )}

        {page === "tracking" && (
          <TrackingPage
            booking={currentBooking}
            rider={assignedRider}
            onViewDeliveries={() => setPage("deliveries")}
            onBackHome={goHome}
            onPayDelivery={payForDelivery}
            isPaying={isPaying}
          />
        )}

        {page === "deliveries" && (
          <DeliveriesPage
            deliveries={deliveries}
            onBack={goHome}
            onBook={openBooking}
          />
        )}

        {page === "profile" && (
          <ProfilePage
            customerUser={customerUser}
            onBack={goHome}
            onLogout={async () => {
              if (supabase) {
                await supabase.auth.signOut();
              }

              setCustomerUser(null);
              setDeliveries([]);
              setCurrentBooking(null);
              setAssignedRider(null);
              setIsMatching(false);
              setIsPaying(false);
              setPage("home");
            }}
          />
        )}
      </main>

      <BottomNav
        page={page}
        onHome={goHome}
        onBook={openBooking}
        onDeliveries={() => setPage("deliveries")}
        onProfile={() => setPage("profile")}
      />
    </div>
  );
}

/*
 * =========================================================
 * HOME PAGE
 * =========================================================
 */

function HomePage({ onBook, onDeliveries, onProfile }) {
  return (
    <div className="page">
      <section className="hero-section">
        <div className="hero-badge">
          <span className="live-dot"></span>
          RIDERS AVAILABLE
        </div>

        <h1>
          Send anything,
          <br />
          <span>anywhere.</span>
        </h1>

        <p>Fast and reliable dispatch delivery across Lagos.</p>
      </section>

      <section className="booking-card">
        <div className="booking-card-header">
          <div>
            <span className="eyebrow">BOOK A RIDER</span>
            <h2>Where should we deliver?</h2>
          </div>

          <div className="booking-card-icon">
            <Bike size={23} />
          </div>
        </div>

        <div className="location-stack">
          <div className="location-input">
            <div className="location-dot pickup-dot">
              <MapPin size={17} />
            </div>

            <div>
              <small>Pickup</small>
              <strong>Enter pickup location</strong>
            </div>
          </div>

          <div className="route-line"></div>

          <div className="location-input">
            <div className="location-dot dropoff-dot">
              <MapPin size={17} />
            </div>

            <div>
              <small>Drop-off</small>
              <strong>Enter delivery location</strong>
            </div>
          </div>
        </div>

        <button className="primary-button full-width" onClick={onBook}>
          Book a rider
          <ChevronRight size={19} />
        </button>
      </section>

      <section className="quick-section">
        <div className="section-heading">
          <h3>Quick actions</h3>
        </div>

        <div className="quick-grid">
          <button className="quick-card" onClick={onDeliveries}>
            <div className="quick-icon">
              <Package size={22} />
            </div>

            <span>My deliveries</span>
            <ChevronRight size={17} />
          </button>

          <button className="quick-card" onClick={onProfile}>
            <div className="quick-icon">
              <User size={22} />
            </div>

            <span>My profile</span>
            <ChevronRight size={17} />
          </button>
        </div>
      </section>

      <section className="promo-card">
        <div className="promo-content">
          <span className="promo-label">HOKADA EXPRESS</span>

          <h3>
            Need it there
            <br />
            <span>faster?</span>
          </h3>

          <p>Choose Express delivery for priority rider matching.</p>

          <button className="promo-button" onClick={onBook}>
            Try Express
            <Zap size={17} />
          </button>
        </div>

        <div className="promo-bike">
          <Bike size={88} />
        </div>
      </section>
    </div>
  );
}

/*
 * =========================================================
 * BOOKING PAGE
 * =========================================================
 */

function BookingPage({ booking, updateBooking, pricing, onBack, onContinue }) {
  return (
    <div className="page">
      <PageHeader
        title="Book a rider"
        subtitle="Tell us where your package is going."
        onBack={onBack}
      />

      <section className="form-card">
        <div className="form-section">
          <label>Pickup location</label>

          <div className="input-with-icon">
            <MapPin size={19} />

            <input
              value={booking.pickup}
              onChange={(event) => updateBooking("pickup", event.target.value)}
              placeholder="e.g. Ikeja City Mall"
            />
          </div>
        </div>

        <div className="form-section">
          <label>Drop-off location</label>

          <div className="input-with-icon">
            <MapPin size={19} />

            <input
              value={booking.dropoff}
              onChange={(event) => updateBooking("dropoff", event.target.value)}
              placeholder="e.g. Yaba"
            />
          </div>
        </div>

        <div className="form-divider"></div>

        <div className="form-section">
          <label>Recipient name</label>

          <div className="input-with-icon">
            <User size={19} />

            <input
              value={booking.recipientName}
              onChange={(event) =>
                updateBooking("recipientName", event.target.value)
              }
              placeholder="Who is receiving it?"
            />
          </div>
        </div>

        <div className="form-section">
          <label>Recipient phone</label>

          <div className="input-with-icon">
            <Phone size={19} />

            <input
              value={booking.recipientPhone}
              onChange={(event) =>
                updateBooking("recipientPhone", event.target.value)
              }
              placeholder="080..."
              type="tel"
            />
          </div>
        </div>
      </section>

      <section className="form-card">
        <div className="form-section">
          <label>Package size</label>

          <div className="choice-grid">
            {["Small", "Medium", "Large"].map((size) => (
              <button
                key={size}
                type="button"
                className={`choice-button ${
                  booking.packageSize === size ? "active" : ""
                }`}
                onClick={() => updateBooking("packageSize", size)}
              >
                <Package size={19} />
                <span>{size}</span>

                <small>
                  {PACKAGE_FEES[size] === 0
                    ? "No extra fee"
                    : `+${formatNaira(PACKAGE_FEES[size])}`}
                </small>
              </button>
            ))}
          </div>
        </div>

        <div className="form-section">
          <label>Delivery speed</label>

          <div className="delivery-type-grid">
            <button
              type="button"
              className={`delivery-type-card ${
                booking.deliveryType === "Standard" ? "active" : ""
              }`}
              onClick={() => updateBooking("deliveryType", "Standard")}
            >
              <div className="delivery-type-icon">
                <Clock3 size={20} />
              </div>

              <div>
                <strong>Standard</strong>
                <span>Regular delivery</span>
              </div>

              <small>Included</small>
            </button>

            <button
              type="button"
              className={`delivery-type-card ${
                booking.deliveryType === "Express" ? "active" : ""
              }`}
              onClick={() => updateBooking("deliveryType", "Express")}
            >
              <div className="delivery-type-icon express">
                <Zap size={20} />
              </div>

              <div>
                <strong>Express</strong>
                <span>Priority rider</span>
              </div>

              <small>+{formatNaira(EXPRESS_FEE)}</small>
            </button>
          </div>
        </div>

        <div className="form-section">
          <label>Delivery notes</label>

          <textarea
            value={booking.notes}
            onChange={(event) => updateBooking("notes", event.target.value)}
            placeholder="Any special instructions for the rider?"
            rows="4"
          />
        </div>
      </section>

      <section className="live-price-card">
        <div>
          <span>Estimated delivery fee</span>
          <strong>{formatNaira(pricing.total)}</strong>
        </div>

        <div className="live-price-distance">
          <MapPin size={15} />
          {pricing.distance} km estimated
        </div>
      </section>

      <button
        className="primary-button full-width bottom-action"
        onClick={onContinue}
      >
        Review delivery
        <ChevronRight size={19} />
      </button>
    </div>
  );
}

/*
 * =========================================================
 * REVIEW PAGE
 * =========================================================
 */

function ReviewPage({ booking, pricing, isPaying, onBack, onConfirm }) {
  return (
    <div className="page">
      <PageHeader
        title="Review delivery"
        subtitle="Check everything before booking."
        onBack={onBack}
      />

      <section className="review-card">
        <div className="review-route">
          <div className="review-location">
            <div className="review-dot pickup"></div>

            <div>
              <small>Pickup</small>
              <strong>{booking.pickup}</strong>
            </div>
          </div>

          <div className="review-route-line"></div>

          <div className="review-location">
            <div className="review-dot dropoff"></div>

            <div>
              <small>Drop-off</small>
              <strong>{booking.dropoff}</strong>
            </div>
          </div>
        </div>
      </section>

      <section className="review-card">
        <div className="review-row">
          <span>Recipient</span>
          <strong>{booking.recipientName}</strong>
        </div>

        <div className="review-row">
          <span>Phone</span>
          <strong>{booking.recipientPhone}</strong>
        </div>

        <div className="review-row">
          <span>Package</span>
          <strong>{booking.packageSize}</strong>
        </div>

        <div className="review-row">
          <span>Delivery type</span>
          <strong className="green-text">{booking.deliveryType}</strong>
        </div>

        <div className="review-row">
          <span>Estimated distance</span>
          <strong>{pricing.distance} km</strong>
        </div>

        {booking.notes.trim() && (
          <div className="review-row">
            <span>Notes</span>
            <strong>{booking.notes}</strong>
          </div>
        )}
      </section>

      <section className="price-breakdown-card">
        <div className="price-card-heading">
          <div>
            <span className="eyebrow">PRICE BREAKDOWN</span>
            <h3>Delivery fee</h3>
          </div>

          <Wallet size={21} />
        </div>

        <div className="price-line">
          <span>Base booking fee</span>
          <strong>{formatNaira(pricing.baseFee)}</strong>
        </div>

        <div className="price-line">
          <span>Distance ({pricing.distance} km)</span>
          <strong>{formatNaira(pricing.distanceFee)}</strong>
        </div>

        <div className="price-line">
          <span>{booking.packageSize} package</span>
          <strong>
            {pricing.packageFee === 0
              ? "Included"
              : formatNaira(pricing.packageFee)}
          </strong>
        </div>

        {pricing.expressFee > 0 && (
          <div className="price-line">
            <span>Express delivery</span>
            <strong>{formatNaira(pricing.expressFee)}</strong>
          </div>
        )}

        <div className="price-total">
          <span>Total</span>
          <strong>{formatNaira(pricing.total)}</strong>
        </div>

        <p className="price-note">
          You will pay when your rider reaches the drop-off location. Final
          price may change when HOKADA connects to live road-distance and
          traffic data.
        </p>
      </section>

      <button
        className="primary-button full-width bottom-action"
        onClick={onConfirm}
        disabled={isPaying}
      >
        {isPaying ? "Creating your booking..." : "Confirm booking"}
        {!isPaying && <Bike size={19} />}
      </button>
    </div>
  );
}

/*
 * =========================================================
 * MATCHING PAGE
 * =========================================================
 */

function MatchingPage({ booking, pricing, isMatching, onCancel }) {
  return (
    <div className="page centered-page">
      <div className="matching-animation">
        <div className="matching-ring ring-one"></div>
        <div className="matching-ring ring-two"></div>

        <div className="matching-icon">
          <Bike size={45} />
        </div>
      </div>

      <span className="eyebrow">
        {isMatching ? "FINDING A RIDER" : "DELIVERY UPDATE"}
      </span>

      <h1 className="matching-title">
        Looking for a rider
        <br />
        near you...
      </h1>

      <p className="matching-text">
        We're finding an available HOKADA rider. You will pay when your rider
        reaches the drop-off location.
      </p>

      <div className="matching-summary">
        <div>
          <span>Delivery fee due at destination</span>
          <strong>{formatNaira(pricing.total)}</strong>
        </div>

        <div>
          <span>Delivery type</span>
          <strong>{booking.deliveryType}</strong>
        </div>
      </div>

      <button className="secondary-button full-width" onClick={onCancel}>
        Back to home
      </button>
    </div>
  );
}

/*
 * =========================================================
 * TRACKING PAGE
 * =========================================================
 */

function TrackingPage({
  booking,
  rider,
  onViewDeliveries,
  onBackHome,
  onPayDelivery,
  isPaying,
}) {
  const delivery = booking?.delivery;
  const status = delivery?.status;
  const isDelivered = status === "delivered";
  const paymentIsPaid = delivery?.payment_status === "paid";
  const paymentIsAvailable =
    PAYMENT_ELIGIBLE_STATUSES.includes(status) && !paymentIsPaid;

  const pickup = {
    lat: delivery?.pickup_lat ?? 6.6018,
    lng: delivery?.pickup_lng ?? 3.3515,
    label: booking?.pickup || "Pickup location",
  };

  const dropoff = {
    lat: delivery?.dropoff_lat ?? 6.4474,
    lng: delivery?.dropoff_lng ?? 3.4722,
    label: booking?.dropoff || "Drop-off location",
  };

  const trackingStatus = {
    accepted: {
      title: "Rider accepted your delivery",
      description:
        "Your rider has accepted the delivery and is preparing to head to pickup.",
      icon: <CheckCircle2 size={22} />,
    },

    in_transit: {
      title: "Rider is heading to pickup",
      description: "Your rider is on the way to collect your package.",
      icon: <Navigation size={22} />,
    },

    arrived: {
      title: "Rider has arrived at pickup",
      description: "Your rider has arrived and is collecting your package.",
      icon: <MapPin size={22} />,
    },

    collected: {
      title: "Package collected",
      description:
        "Your package has been collected and the rider is ready for drop-off.",
      icon: <Package size={22} />,
    },

    going_to_dropoff: {
      title: "Rider is heading to you",
      description:
        "Your package is with the rider and is on the way to your location.",
      icon: <Navigation size={22} />,
    },

    arrived_at_dropoff: {
      title: "Rider has arrived at drop-off",
      description:
        "Your rider has reached the delivery location. You can now pay your delivery fee.",
      icon: <Flag size={22} />,
    },
  };

  const currentStatus = trackingStatus[status] || {
    title: "Finding your rider...",
    description: "We're waiting for a rider to accept your delivery.",
    icon: <Bike size={22} />,
  };

  if (isDelivered) {
    return (
      <div className="page centered-page">
        <div className="delivery-complete-icon">
          <CheckCircle2 size={58} />
        </div>

        <span className="eyebrow">
          {paymentIsPaid ? "DELIVERY COMPLETE" : "DELIVERY REACHED DESTINATION"}
        </span>

        <h1 className="matching-title">
          Your package
          <br />
          has been delivered!
        </h1>

        <p className="matching-text">
          Your HOKADA rider has completed this delivery.
        </p>

        <div className="delivery-complete-card">
          <div className="delivery-complete-header">
            <div className="delivery-complete-package">
              <Package size={23} />
            </div>

            <div>
              <span>DELIVERY</span>
              <strong>#{delivery?.id?.slice(0, 8)}</strong>
            </div>
          </div>

          <div className="delivery-complete-route">
            <div>
              <span>Pickup</span>
              <strong>{booking?.pickup || "Pickup location"}</strong>
            </div>

            <div className="delivery-complete-arrow">→</div>

            <div>
              <span>Drop-off</span>
              <strong>{booking?.dropoff || "Drop-off location"}</strong>
            </div>
          </div>

          <div className="delivery-complete-divider"></div>

          <div className="delivery-complete-rider">
            <div className="rider-avatar">
              <Bike size={23} />
            </div>

            <div>
              <span>Delivered by</span>
              <strong>{rider?.name || DEMO_RIDER.name}</strong>

              <small>
                {rider?.bike || DEMO_RIDER.bike} •{" "}
                {rider?.plate || DEMO_RIDER.plate}
              </small>
            </div>

            <div className="delivery-rating">
              <span>★</span>
              <strong>{rider?.rating || DEMO_RIDER.rating}</strong>
            </div>
          </div>
        </div>

        {paymentIsAvailable && (
          <section className="review-card">
            <span className="eyebrow">PAYMENT DUE</span>
            <h3>Complete your delivery payment</h3>
            <p>Your delivery fee is ready to be paid securely with Paystack.</p>

            <div className="review-row">
              <span>Delivery fee</span>
              <strong>{formatNaira(delivery?.delivery_fee)}</strong>
            </div>

            <button
              className="primary-button full-width"
              onClick={() => onPayDelivery(delivery.id)}
              disabled={isPaying}
            >
              <Wallet size={18} />
              {isPaying ? "Opening secure checkout..." : "Pay delivery fee"}
            </button>
          </section>
        )}

        {paymentIsPaid && (
          <div className="tracking-status-card">
            <CheckCircle2 size={22} color="#16a34a" />
            <div className="tracking-status-text">
              <strong>Payment completed</strong>
              <span>
                {formatNaira(delivery?.delivery_fee)} paid successfully.
              </span>
            </div>
          </div>
        )}

        <div className="delivery-complete-actions">
          <button
            className="primary-button full-width"
            onClick={onViewDeliveries}
          >
            <Package size={18} />
            View my deliveries
          </button>

          <button className="secondary-button full-width" onClick={onBackHome}>
            Book another delivery
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="page-shell">
      <div className="page-content">
        <div className="success-banner">
          <div className="success-icon">
            <Check size={20} />
          </div>

          <div>
            <strong>
              {rider ? "Rider assigned" : "Rider matching in progress"}
            </strong>
            <span>Your delivery status is being updated.</span>
          </div>
        </div>

        <div className="section-heading">
          <div>
            <span className="eyebrow">LIVE TRACKING</span>
            <h1>{currentStatus.title}</h1>
          </div>
        </div>

        <div className="tracking-map-wrapper">
          <TrackingMap
            deliveryId={delivery?.id}
            pickup={pickup}
            dropoff={dropoff}
            riderName={rider?.name || DEMO_RIDER.name}
            status={status}
          />
        </div>

        <div className="tracking-status-card">
          <div className="tracking-status-icon">{currentStatus.icon}</div>

          <div className="tracking-status-text">
            <strong>{currentStatus.title}</strong>
            <span>{currentStatus.description}</span>
          </div>

          <span className="live-dot">LIVE</span>
        </div>

        {paymentIsAvailable && (
          <section className="review-card">
            <span className="eyebrow">PAYMENT DUE</span>
            <h3>Your rider has reached the destination</h3>
            <p>
              Your delivery fee is now due. Complete payment securely through
              Paystack.
            </p>

            <div className="review-row">
              <span>Delivery fee</span>
              <strong>{formatNaira(delivery?.delivery_fee)}</strong>
            </div>

            <button
              className="primary-button full-width"
              onClick={() => onPayDelivery(delivery.id)}
              disabled={isPaying}
            >
              <Wallet size={18} />
              {isPaying ? "Opening secure checkout..." : "Pay delivery fee"}
            </button>
          </section>
        )}

        {paymentIsPaid && (
          <div className="tracking-status-card">
            <CheckCircle2 size={22} color="#16a34a" />
            <div className="tracking-status-text">
              <strong>Payment confirmed</strong>
              <span>Your delivery payment has been verified.</span>
            </div>
          </div>
        )}

        <div className="customer-journey-card">
          <div className="customer-journey-header">
            <span className="eyebrow">DELIVERY JOURNEY</span>

            <strong>
              {["going_to_dropoff", "arrived_at_dropoff"].includes(status)
                ? "DROP-OFF"
                : "PICKUP"}
            </strong>
          </div>

          <div className="customer-journey">
            {[
              {
                title: "Rider accepted",
                description: "Delivery accepted",
                icon: <CheckCircle2 size={16} />,
                statuses: [
                  "accepted",
                  "in_transit",
                  "arrived",
                  "collected",
                  "going_to_dropoff",
                  "arrived_at_dropoff",
                  "delivered",
                ],
              },
              {
                title: "Going to pickup",
                description: "Rider is travelling to pickup",
                icon: <Navigation size={16} />,
                statuses: [
                  "in_transit",
                  "arrived",
                  "collected",
                  "going_to_dropoff",
                  "arrived_at_dropoff",
                  "delivered",
                ],
              },
              {
                title: "Arrived at pickup",
                description: "Rider is collecting the package",
                icon: <MapPin size={16} />,
                statuses: [
                  "arrived",
                  "collected",
                  "going_to_dropoff",
                  "arrived_at_dropoff",
                  "delivered",
                ],
              },
              {
                title: "Package collected",
                description: "Package is with the rider",
                icon: <Package size={16} />,
                statuses: [
                  "collected",
                  "going_to_dropoff",
                  "arrived_at_dropoff",
                  "delivered",
                ],
              },
              {
                title: "Going to you",
                description: "Rider is heading to drop-off",
                icon: <Navigation size={16} />,
                statuses: [
                  "going_to_dropoff",
                  "arrived_at_dropoff",
                  "delivered",
                ],
                dropoff: true,
              },
              {
                title: "Arrived at drop-off",
                description: "Rider has reached your location",
                icon: <Flag size={16} />,
                statuses: ["arrived_at_dropoff", "delivered"],
                dropoff: true,
              },
            ].map((step) => (
              <div
                key={step.title}
                className={`customer-journey-step ${
                  step.statuses.includes(status) ? "complete" : ""
                } ${step.dropoff ? "dropoff" : ""}`}
              >
                <div className="customer-journey-icon">{step.icon}</div>

                <div>
                  <strong>{step.title}</strong>
                  <span>{step.description}</span>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="route-card">
          <div className="route-row">
            <div className="route-icon pickup">
              <MapPin size={18} />
            </div>

            <div>
              <span>Pickup</span>
              <strong>{booking?.pickup || "Pickup location"}</strong>
            </div>
          </div>

          <div className="route-line" />

          <div className="route-row">
            <div className="route-icon dropoff">
              <MapPin size={18} />
            </div>

            <div>
              <span>Drop-off</span>
              <strong>{booking?.dropoff || "Drop-off location"}</strong>
            </div>
          </div>
        </div>

        <div className="rider-card">
          <div className="rider-avatar">
            <Bike size={24} />
          </div>

          <div className="rider-details">
            <span>Your rider</span>
            <strong>{rider?.name || DEMO_RIDER.name}</strong>

            <small>
              {rider?.bike || DEMO_RIDER.bike} •{" "}
              {rider?.plate || DEMO_RIDER.plate}
            </small>
          </div>

          <a
            className="call-rider-button"
            href={`tel:${rider?.phone || DEMO_RIDER.phone}`}
          >
            <Phone size={18} />
          </a>
        </div>

        <TrackingChat deliveryId={delivery?.id} status={status} />

        <div className="tracking-actions">
          <button className="primary-button" onClick={onViewDeliveries}>
            <Clock3 size={18} />
            View deliveries
          </button>

          <button className="secondary-button" onClick={onBackHome}>
            Back to home
          </button>
        </div>
      </div>
    </div>
  );
}

/*
 * =========================================================
 * DELIVERIES PAGE
 * =========================================================
 */

function DeliveriesPage({ deliveries, onBack, onBook }) {
  return (
    <div className="page">
      <PageHeader
        title="My deliveries"
        subtitle="Track your HOKADA delivery history."
        onBack={onBack}
      />

      {deliveries.length === 0 ? (
        <div className="empty-card">
          <div className="empty-icon">
            <Package size={30} />
          </div>

          <h3>No deliveries yet</h3>

          <p>Your completed and active deliveries will appear here.</p>

          <button className="primary-button" onClick={onBook}>
            Book your first rider
            <Bike size={18} />
          </button>
        </div>
      ) : (
        <div className="booking-list">
          {deliveries.map((delivery) => (
            <div className="delivery-item" key={delivery.id}>
              <div className="delivery-icon">
                <Package size={21} />
              </div>

              <div className="delivery-info">
                <strong>{delivery.pickup}</strong>
                <span>→ {delivery.dropoff}</span>

                <small>
                  {delivery.deliveryType} · {delivery.packageSize}
                </small>
              </div>

              <div className="delivery-price">
                <strong>
                  {formatNaira(
                    delivery.deliveryFee ?? delivery.pricing?.total ?? 0
                  )}
                </strong>

                <span>
                  {delivery.paymentStatus === "paid"
                    ? "Paid"
                    : delivery.status === "arrived_at_dropoff" ||
                      delivery.status === "delivered"
                    ? "Payment due"
                    : delivery.paymentStatus === "pending" ||
                      delivery.paymentStatus === "unpaid"
                    ? "Pay at destination"
                    : delivery.status === "accepted"
                    ? "Assigned"
                    : delivery.status === "searching"
                    ? "Finding rider"
                    : delivery.status}
                </span>
              </div>
            </div>
          ))}
        </div>
      )}

      {deliveries.length > 0 && (
        <button
          className="primary-button full-width bottom-action"
          onClick={onBook}
        >
          Book another delivery
          <Bike size={18} />
        </button>
      )}
    </div>
  );
}

/*
 * =========================================================
 * PROFILE PAGE
 * =========================================================
 */

function ProfilePage({ customerUser, onBack, onLogout }) {
  const [profile, setProfile] = useState(null);

  useEffect(() => {
    if (!supabase || !customerUser?.id) return;

    let active = true;

    async function loadProfile() {
      const { data, error } = await supabase
        .from("customer_profiles")
        .select("full_name, phone")
        .eq("id", customerUser.id)
        .maybeSingle();

      if (!active) return;

      if (error) {
        console.error("Could not load customer profile:", error);
        return;
      }

      setProfile(data);
    }

    loadProfile();

    return () => {
      active = false;
    };
  }, [customerUser?.id]);

  const displayName =
    profile?.full_name ||
    customerUser?.user_metadata?.full_name ||
    "HOKADA Customer";

  return (
    <div className="page">
      <PageHeader
        title="My profile"
        subtitle="Manage your HOKADA account."
        onBack={onBack}
      />

      <section className="profile-hero">
        <div className="profile-large">
          <User size={32} />
        </div>

        <div>
          <span className="eyebrow">CUSTOMER ACCOUNT</span>
          <h2>{displayName}</h2>
          <p>{customerUser?.email}</p>
        </div>
      </section>

      <section className="profile-menu">
        <div className="profile-menu-item">
          <User size={20} />

          <div>
            <strong>Personal details</strong>
            <span>{profile?.phone || "Phone number not added"}</span>
          </div>
        </div>

        <div className="profile-menu-item">
          <Wallet size={20} />

          <div>
            <strong>Payment methods</strong>
            <span>Manage your payment options</span>
          </div>

          <ChevronRight size={18} />
        </div>

        <div className="profile-menu-item">
          <Search size={20} />

          <div>
            <strong>Help & support</strong>
            <span>Get help with your delivery</span>
          </div>

          <ChevronRight size={18} />
        </div>
      </section>

      <button
        className="secondary-button full-width bottom-action"
        onClick={onLogout}
      >
        Log out
      </button>
    </div>
  );
}

/*
 * =========================================================
 * PAGE HEADER
 * =========================================================
 */

function PageHeader({ title, subtitle, onBack }) {
  return (
    <div className="page-header">
      <button className="back-button" onClick={onBack}>
        <ArrowLeft size={19} />
      </button>

      <div>
        <h1>{title}</h1>
        <p>{subtitle}</p>
      </div>
    </div>
  );
}

/*
 * =========================================================
 * BOTTOM NAVIGATION
 * =========================================================
 */

function BottomNav({ page, onHome, onBook, onDeliveries, onProfile }) {
  return (
    <nav className="bottom-nav">
      <button className={page === "home" ? "active" : ""} onClick={onHome}>
        <Home size={20} />
        <span>Home</span>
      </button>

      <button
        className={
          ["booking", "review", "matching"].includes(page) ? "active" : ""
        }
        onClick={onBook}
      >
        <Bike size={20} />
        <span>Book</span>
      </button>

      <button
        className={["deliveries", "tracking"].includes(page) ? "active" : ""}
        onClick={onDeliveries}
      >
        <Package size={20} />
        <span>Deliveries</span>
      </button>

      <button
        className={page === "profile" ? "active" : ""}
        onClick={onProfile}
      >
        <User size={20} />
        <span>Profile</span>
      </button>
    </nav>
  );
}

export default App;
