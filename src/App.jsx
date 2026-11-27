import { lazy, Suspense, useCallback, useEffect, useRef, useState } from "react";

import GoogleAddressInput from "./components/GoogleAddressInput";
import AddressLocationSection from "./components/AddressLocationSection";
import TrackingChat from "./components/TrackingChat";
import CustomerAuth from "./components/CustomerAuth";
import { supabase } from "./lib/supabase";
import { customerApiRequest as paymentApiRequest } from "./lib/customerApi";

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


const TrackingMap = lazy(() => import("./components/TrackingMap"));

const PACKAGE_FEES = {
  Small: 0,
  Medium: 300,
  Large: 700,
};

const BASE_FEE = 800;
const PRICE_PER_KM = 150;
const EXPRESS_FEE = 500;
const WAITING_FEE = 200;
const APP_BASE_PATH = import.meta.env.BASE_URL.replace(/\/+$/, "");
const APP_HOME_PATH = `${APP_BASE_PATH}/`;
const PAYMENT_CALLBACK_PATH = `${APP_BASE_PATH}/payment-callback`;

const PAYMENT_ELIGIBLE_STATUSES = ["arrived_at_dropoff", "delivered"];

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
  const paymentIsPaid = delivery.payment_status === "paid";

  return {
    id: delivery.id,
    pickup: delivery.pickup_address,
    dropoff: delivery.dropoff_address,
    deliveryType: delivery.delivery_type,
    packageSize: delivery.package_type,
    recipientName: delivery.recipient_name,
    recipientPhone: delivery.recipient_phone,
    notes: delivery.notes || "",
    status: paymentIsPaid ? "delivered" : delivery.status,
    deliveryFee: delivery.delivery_fee,
    paymentStatus: delivery.payment_status,
    pricing: {
      total: Number(delivery.delivery_fee || 0),
    },
    createdAt: delivery.created_at,
    riderName: delivery.rider_name,
    pickupLat: delivery.pickup_lat,
    pickupLng: delivery.pickup_lng,
    dropoffLat: delivery.dropoff_lat,
    dropoffLng: delivery.dropoff_lng,
  };
}


async function fetchAssignedRiderProfile(deliveryId) {
  if (!supabase || !deliveryId) return null;

  const { data, error } = await supabase.rpc(
    "get_delivery_rider_profile",
    { p_delivery_id: deliveryId }
  );

  if (error) {
    console.error("Could not load assigned rider profile:", error);
    return null;
  }

  const profile = Array.isArray(data) ? data[0] : data;

  if (!profile) return null;

  return {
    name: profile.full_name || null,
    phone: profile.phone || null,
    bike: profile.bike_model || null,
    plate: profile.plate_number || null,
    rating: profile.rating ?? null,
  };
}

/*
 * =========================================================
 * AUTHENTICATED PAYMENT API
 * =========================================================
 */

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

    if (!result.success || !result.deliveryId) {
      const error = new Error(
        result.error || "Your payment could not be confirmed."
      );
      error.paymentStatus = result.status || "unverified";
      throw error;
    }

    return {
      success: true,
      deliveryId: result.deliveryId,
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
  const [isPending, setIsPending] = useState(false);
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
        setIsPending(false);
        setMessage("Verifying your payment...");

        const payment = await verifyPaystackReference(reference);

        if (!active) return;

        setMessage("Payment confirmed! Opening your delivery...");

        await onVerified(payment.deliveryId);

        if (!active) return;

        hasCompleted.current = true;

        window.history.replaceState({}, "", APP_HOME_PATH);
      } catch (err) {
        if (!active) return;

        console.error("Payment callback error:", err);

        setIsPending(err?.paymentStatus === "pending");
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
        {isPending ? (
          <LoaderCircle size={54} color="#d97706" className="payment-spinner" />
        ) : error ? (
          <XCircle size={54} color="#ef4444" />
        ) : message.startsWith("Payment confirmed") ? (
          <CheckCircle2 size={54} color="#16a34a" />
        ) : (
          <LoaderCircle size={54} color="#16a34a" className="payment-spinner" />
        )}

        <h1>
          {isPending
            ? "Payment still processing"
            : error
              ? "Payment verification failed"
              : "HOKADA Payment"}
        </h1>

        <p>{error || message}</p>

        {error && (
          <div className="payment-callback-actions">
            <button
              type="button"
              className="primary-button full-width"
              onClick={() => {
                setError("");
                setIsPending(false);
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
    window.location.pathname === PAYMENT_CALLBACK_PATH
      ? "payment-callback"
      : "home"
  );

  useEffect(() => {
    window.scrollTo({ top: 0, left: 0, behavior: "instant" });
  }, [page]);

  const [customerUser, setCustomerUser] = useState(null);
  const [authLoading, setAuthLoading] = useState(true);

  const [booking, setBooking] = useState({
    pickup: "",
    dropoff: "",
    pickupCoords: null,
    dropoffCoords: null,
    recipientName: "",
    recipientPhone: "",
    packageSize: "Small",
    deliveryType: "Standard",
    notes: "",
  });

  const [currentBooking, setCurrentBooking] = useState(null);
  const [selectedDelivery, setSelectedDelivery] = useState(null);
  const [deliveries, setDeliveries] = useState([]);
  const [serverQuote, setServerQuote] = useState(null);
  const [quoteLoading, setQuoteLoading] = useState(false);
  const [quoteError, setQuoteError] = useState("");
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
        .select("id, pickup_address, dropoff_address, pickup_lat, pickup_lng, dropoff_lat, dropoff_lng, delivery_type, package_type, recipient_name, recipient_phone, notes, status, delivery_fee, payment_status, created_at, rider_name")
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

  const pricing = serverQuote?.pricing || null;

  useEffect(() => {
    let active = true;

    setServerQuote(null);
    setQuoteError("");

    const pickup = booking.pickupCoords;
    const dropoff = booking.dropoffCoords;

    if (!pickup || !dropoff) {
      setQuoteLoading(false);
      return () => {
        active = false;
      };
    }

    async function loadQuote() {
      setQuoteLoading(true);

      try {
        const result = await paymentApiRequest("/api/delivery-quote", {
          method: "POST",
          body: JSON.stringify({
            pickup_lat: Number(pickup.lat),
            pickup_lng: Number(pickup.lng),
            dropoff_lat: Number(dropoff.lat),
            dropoff_lng: Number(dropoff.lng),
            package_type: booking.packageSize,
            delivery_type: booking.deliveryType,
          }),
        });

        if (active) {
          setServerQuote({
            ...result,
            pricing: {
              ...result.pricing,
              distance: result.pricing.distanceKm,
            },
          });
        }
      } catch (error) {
        if (active) {
          setQuoteError(
            error?.message || "Could not calculate the road-route price."
          );
        }
      } finally {
        if (active) setQuoteLoading(false);
      }
    }

    loadQuote();

    return () => {
      active = false;
    };
  }, [
    booking.pickupCoords,
    booking.dropoffCoords,
    booking.packageSize,
    booking.deliveryType,
    customerUser?.id,
  ]);

  /*
   * =========================================================
   * LIVE DELIVERY UPDATES
   * =========================================================
   */

  useEffect(() => {
    if (!supabase || !currentBooking?.id) return;

    let active = true;
    let lastFetchedRiderId = null;

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
          const riderId = updatedDelivery.rider_id || null;
          const riderChanged = riderId !== lastFetchedRiderId;

          if (riderChanged) {
            lastFetchedRiderId = riderId;
            setAssignedRider(null);
          }

          setCurrentBooking((previous) => {
            if (!previous) return previous;

            return {
              ...previous,
              status: updatedDelivery.status,
              delivery: {
                ...previous.delivery,
                id: updatedDelivery.id,
                status: updatedDelivery.status,
                payment_status: updatedDelivery.payment_status,
                delivery_fee: updatedDelivery.delivery_fee,
                rider_name: updatedDelivery.rider_name,
              },
              rider: riderChanged ? null : previous.rider,
            };
          });

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

          setSelectedDelivery((previous) =>
            previous?.id === updatedDelivery.id
              ? {
                  ...previous,
                  status: updatedDelivery.status,
                  paymentStatus: updatedDelivery.payment_status,
                  payment_status: updatedDelivery.payment_status,
                  riderName: updatedDelivery.rider_name,
                  deliveryFee: updatedDelivery.delivery_fee,
                }
              : previous
          );

          if (riderId && riderChanged) {
            fetchAssignedRiderProfile(updatedDelivery.id).then((profile) => {
              if (!active || lastFetchedRiderId !== riderId || !profile) {
                return;
              }

              setAssignedRider(profile);
              setCurrentBooking((previous) =>
                previous?.id === updatedDelivery.id
                  ? { ...previous, rider: profile }
                  : previous
              );
            });
          }

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
      active = false;
      supabase.removeChannel(channel);
    };
  }, [currentBooking?.id]);

  /*
   * =========================================================
   * BOOKING HELPERS
   * =========================================================
   */

  function updateBooking(field, value) {
    setBooking((previous) => {
      const next = { ...previous, [field]: value };

      // Typing a new address invalidates its previously selected coordinates.
      if (field === "pickup") next.pickupCoords = null;
      if (field === "dropoff") next.dropoffCoords = null;

      return next;
    });
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

    const digits = booking.recipientPhone.replace(/\D/g, "");
    const localPhone = digits.startsWith("234")
      ? `0${digits.slice(3)}`
      : digits;

    if (!/^0[789]\d{9}$/.test(localPhone)) {
      alert("Enter a valid Nigerian mobile number, for example 08012345678.");
      return;
    }

    if (!booking.pickupCoords || !booking.dropoffCoords) {
      alert("Please confirm both pickup and drop-off locations using map search or GPS.");
      return;
    }

    if (quoteLoading) {
      alert("Please wait while HOKADA calculates the road-route price.");
      return;
    }

    if (!serverQuote?.pricing) {
      alert(quoteError || "HOKADA could not confirm the road-route price. Please try selecting your locations again.");
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

      const pickupCoords = booking.pickupCoords;
      const dropoffCoords = booking.dropoffCoords;

      if (!pickupCoords || !dropoffCoords || !serverQuote?.pricing) {
        throw new Error("Please confirm both locations and wait for the road-route quote before booking.");
      }

      const { delivery } = await paymentApiRequest("/api/deliveries", {
        method: "POST",
        body: JSON.stringify({
          pickup_address: booking.pickup.trim(),
          dropoff_address: booking.dropoff.trim(),

          pickup_lat: pickupCoords.lat,
          pickup_lng: pickupCoords.lng,
          dropoff_lat: dropoffCoords.lat,
          dropoff_lng: dropoffCoords.lng,

          recipient_name: booking.recipientName.trim(),
          recipient_phone: booking.recipientPhone.trim(),

          package_type: booking.packageSize,
          package_description: `${booking.packageSize} package`,
          delivery_type: booking.deliveryType,
          notes: booking.notes.trim() || null,
        }),
      });

      const newBooking = {
        id: delivery.id,
        ...booking,
        pricing: {
          ...serverQuote.pricing,
          total: Number(delivery.delivery_fee),
        },
        status: "searching",
        createdAt: delivery.created_at,
        delivery: {
          id: delivery.id,
          status: "searching",
          payment_status: "unpaid",
          delivery_fee: delivery.delivery_fee,
          rider_name: delivery.rider_name ?? null,
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
      const payment = await paymentApiRequest("/api/payments/initialize", {
        method: "POST",
        body: JSON.stringify({
          deliveryId,
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
        .select("id, pickup_address, dropoff_address, pickup_lat, pickup_lng, dropoff_lat, dropoff_lng, recipient_name, recipient_phone, package_type, delivery_type, notes, status, created_at, delivery_fee, payment_status, rider_name")
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

      const restoredRider = await fetchAssignedRiderProfile(delivery.id);

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
        pickupLat: delivery.pickup_lat,
        pickupLng: delivery.pickup_lng,
        dropoffLat: delivery.dropoff_lat,
        dropoffLng: delivery.dropoff_lng,
        delivery: {
          id: delivery.id,
          status: delivery.status,
          payment_status: delivery.payment_status,
          delivery_fee: delivery.delivery_fee,
          rider_name: delivery.rider_name,
          pickup_lat: delivery.pickup_lat,
          pickup_lng: delivery.pickup_lng,
          dropoff_lat: delivery.dropoff_lat,
          dropoff_lng: delivery.dropoff_lng,
        },
        rider: restoredRider,
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
    window.history.replaceState({}, "", APP_HOME_PATH);
    setIsPaying(false);
    setPage("home");
  }

  async function cancelBooking() {
    if (!supabase || !customerUser?.id || !currentBooking?.id) {
      alert("Unable to cancel this delivery. Please try again.");
      return;
    }

    const confirmed = window.confirm(
      "Are you sure you want to cancel this delivery? This is only allowed while payment is unpaid."
    );

    if (!confirmed) return;

    try {
      const { delivery } = await paymentApiRequest(
        `/api/deliveries/${encodeURIComponent(currentBooking.id)}/cancel`,
        { method: "POST", body: "{}" }
      );

      setDeliveries((previous) =>
        previous.map((item) =>
          item.id === delivery.id
            ? { ...item, status: "cancelled", paymentStatus: "unpaid" }
            : item
        )
      );

      setCurrentBooking(null);
      setAssignedRider(null);
      setIsMatching(false);
      setIsPaying(false);
      setPage("home");
    } catch (error) {
      console.error("Could not cancel delivery:", error);
      alert(`Could not cancel delivery: ${error.message}`);
    }
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
            window.location.pathname === PAYMENT_CALLBACK_PATH
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
            quoteLoading={quoteLoading}
            quoteError={quoteError}
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
            onCancel={cancelBooking}
            isPaying={isPaying}
          />
        )}

        {page === "deliveries" && (
          <DeliveriesPage
            deliveries={deliveries}
            onBack={goHome}
            onBook={openBooking}
            onSelectDelivery={async (delivery) => {
              try {
                if (!supabase || !customerUser?.id) {
                  throw new Error("Please sign in again to refresh this delivery.");
                }

                const { data, error } = await supabase
                  .from("deliveries")
                  .select("id, pickup_address, dropoff_address, pickup_lat, pickup_lng, dropoff_lat, dropoff_lng, delivery_type, package_type, recipient_name, recipient_phone, notes, status, delivery_fee, payment_status, created_at, rider_name")
                  .eq("id", delivery.id)
                  .eq("customer_id", customerUser.id)
                  .single();

                if (error) throw error;

                const latestDelivery = mapDeliveryHistory(data);
                setDeliveries((previous) =>
                  previous.map((item) =>
                    item.id === latestDelivery.id ? latestDelivery : item
                  )
                );
                setSelectedDelivery(latestDelivery);
                setPage("delivery-details");
              } catch (error) {
                console.error("Could not refresh delivery details:", error);
                alert(error?.message || "Could not refresh this delivery. Please try again.");
              }
            }}
          />
        )}

        {page === "delivery-details" && selectedDelivery && (
          <DeliveryDetailsPage
            delivery={selectedDelivery}
            onBack={() => setPage("deliveries")}
            onPay={() => payForDelivery(selectedDelivery.id)}
            isPaying={isPaying}
            onTrack={() => {
              setCurrentBooking(selectedDelivery);
              setPage("tracking");
            }}
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

function BookingPage({ booking, updateBooking, pricing, quoteLoading, quoteError, onBack, onContinue }) {
  const packageSizes = ["Small", "Medium", "Large"];

  return (
    <div className="page">
      <PageHeader
        title="New delivery"
        subtitle="Add your route and recipient to get a delivery quote."
        onBack={onBack}
      />

      <section className="simple-booking-card">
        <div className="simple-booking-route">
          <div className="simple-booking-field">
            <label htmlFor="booking-pickup">Pickup</label>
            <div className="simple-booking-address">
              <span className="simple-booking-dot pickup" aria-hidden="true" />
              <GoogleAddressInput
                id="booking-pickup"
                value={booking.pickup}
                placeholder="Search pickup address"
                onChange={(value) => updateBooking("pickup", value)}
                onSelect={({ address, coords }) => {
                  updateBooking("pickup", address);
                  updateBooking("pickupCoords", coords);
                }}
              />
            </div>
          </div>

          <div className="simple-booking-field">
            <label htmlFor="booking-dropoff">Drop-off</label>
            <div className="simple-booking-address">
              <span className="simple-booking-dot dropoff" aria-hidden="true" />
              <GoogleAddressInput
                id="booking-dropoff"
                value={booking.dropoff}
                placeholder="Search drop-off address"
                onChange={(value) => updateBooking("dropoff", value)}
                onSelect={({ address, coords }) => {
                  updateBooking("dropoff", address);
                  updateBooking("dropoffCoords", coords);
                }}
              />
            </div>
          </div>
          <p className="simple-booking-help">Choose a search result to confirm each location.</p>
        </div>

        <div className="simple-booking-fields-grid">
          <label className="simple-booking-field">
            <span>Recipient name</span>
            <input
              value={booking.recipientName}
              onChange={(event) => updateBooking("recipientName", event.target.value)}
              placeholder="Who will receive it?"
              autoComplete="name"
            />
          </label>

          <label className="simple-booking-field">
            <span>Recipient phone</span>
            <input
              value={booking.recipientPhone}
              onChange={(event) => updateBooking("recipientPhone", event.target.value)}
              placeholder="08012345678"
              type="tel"
              inputMode="tel"
              autoComplete="tel"
              maxLength={14}
            />
          </label>
        </div>

        <div className="simple-booking-options">
          <label className="simple-booking-field">
            <span>Package size</span>
            <select
              value={booking.packageSize}
              onChange={(event) => updateBooking("packageSize", event.target.value)}
            >
              {packageSizes.map((size) => (
                <option key={size} value={size}>
                  {size}{PACKAGE_FEES[size] ? ` · +${formatNaira(PACKAGE_FEES[size])}` : " · included"}
                </option>
              ))}
            </select>
          </label>

          <div className="simple-booking-field">
            <span>Delivery speed</span>
            <div className="simple-booking-speed" role="group" aria-label="Delivery speed">
              {["Standard", "Express"].map((speed) => (
                <button
                  key={speed}
                  type="button"
                  className={booking.deliveryType === speed ? "active" : ""}
                  onClick={() => updateBooking("deliveryType", speed)}
                  aria-pressed={booking.deliveryType === speed}
                >
                  {speed}
                  <small>{speed === "Standard" ? "Included" : `+${formatNaira(EXPRESS_FEE)}`}</small>
                </button>
              ))}
            </div>
          </div>
        </div>

        <details className="simple-booking-notes">
          <summary>Add delivery note <span>Optional</span></summary>
          <textarea
            value={booking.notes}
            onChange={(event) => updateBooking("notes", event.target.value)}
            placeholder="Anything the rider should know?"
            rows="3"
          />
        </details>
      </section>

      <section className="live-price-card" aria-live="polite">
        <div>
          <span>Delivery fee</span>
          <strong>
            {quoteLoading
              ? "Calculating..."
              : pricing
                ? formatNaira(pricing.total)
                : "Select both locations"}
          </strong>
        </div>

        {pricing && !quoteLoading && (
          <div className="live-price-distance">
            <MapPin size={15} />
            {pricing.distance} km by road
          </div>
        )}

        {!pricing && !quoteLoading && !quoteError && (
          <p className="live-price-hint">
            Select both locations to see your delivery fee.
          </p>
        )}

        {quoteError && (
          <p className="live-price-hint live-price-error">
            {quoteError}
          </p>
        )}
      </section>

      <button
        className="primary-button full-width bottom-action"
        onClick={onContinue}
        disabled={quoteLoading || !pricing}
      >
        Review booking
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
  const delivery = booking?.delivery || booking;
  const status = delivery?.status;
  const paymentStatus = delivery?.payment_status ?? delivery?.paymentStatus;
  const paymentIsPaid = paymentStatus === "paid";
  // Payment confirmation completes the customer-facing delivery even if a
  // delayed realtime status update still says arrived_at_dropoff.
  const isDelivered = status === "delivered" || paymentIsPaid;
  const riderAtDestination = ["arrived_at_dropoff", "delivered"].includes(status);
  const paymentIsPending = paymentStatus === "pending";
  const deliveryFee = Number(delivery?.delivery_fee);
  const hasPayableDeliveryFee = Number.isFinite(deliveryFee) && deliveryFee >= 1;
  const isMatchingRider = ["searching", "pending"].includes(status) && !rider;
  const liveTrackingActive = !riderAtDestination && !paymentIsPaid;
  const paymentIsAvailable =
    PAYMENT_ELIGIBLE_STATUSES.includes(status) &&
    paymentStatus === "unpaid" &&
    !paymentIsPaid &&
    hasPayableDeliveryFee;

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
      title: "Delivery reached drop-off",
      description: paymentIsPending
        ? "Your delivery is at the destination. We’re confirming the payment status."
        : hasPayableDeliveryFee && paymentStatus === "unpaid"
          ? "Your rider has reached the delivery location. You can now pay your delivery fee."
          : "Your rider has reached the destination. The final delivery status is being confirmed.",
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
              <strong>{rider?.name || "HOKADA rider"}</strong>

              <small>
                {[rider?.bike, rider?.plate].filter(Boolean).join(" • ") ||
                  "Vehicle details unavailable"}
              </small>
            </div>

            <div className="delivery-rating">
              <span>★</span>
              <strong>{rider?.rating ?? "Not rated yet"}</strong>
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
        {isMatchingRider && (
          <div className="success-banner">
            <div className="success-icon">
              <Check size={20} />
            </div>
            <div>
              <strong>Rider matching in progress</strong>
              <span>We’re finding an available rider for your delivery.</span>
            </div>
          </div>
        )}

        <div className="section-heading">
          <div>
            <span className="eyebrow">
              {isDelivered || paymentIsPaid
                ? "DELIVERY COMPLETE"
                : riderAtDestination
                  ? "AT DROP-OFF"
                  : "LIVE TRACKING"}
            </span>
            <h1>{currentStatus.title}</h1>
          </div>
        </div>


        {delivery?.id && liveTrackingActive && (
          <Suspense fallback={<div className="tracking-map-loading">Loading map…</div>}>
          <TrackingMap
            deliveryId={delivery.id}
            pickup={{
              lat: delivery.pickup_lat ?? booking?.pickupLat ?? booking?.pickupCoords?.lat,
              lng: delivery.pickup_lng ?? booking?.pickupLng ?? booking?.pickupCoords?.lng,
              label: booking?.pickup || delivery.pickup_address || "Pickup location",
            }}
            dropoff={{
              lat: delivery.dropoff_lat ?? booking?.dropoffLat ?? booking?.dropoffCoords?.lat,
              lng: delivery.dropoff_lng ?? booking?.dropoffLng ?? booking?.dropoffCoords?.lng,
              label: booking?.dropoff || delivery.dropoff_address || "Drop-off location",
            }}
            riderName={rider?.name || booking?.riderName || delivery.rider_name || "HOKADA rider"}
            status={status}
            paymentStatus={delivery.payment_status}
          />
          </Suspense>
        )}

        <div className="tracking-status-card">
          <div className="tracking-status-icon">{currentStatus.icon}</div>

          <div className="tracking-status-text">
            <strong>{currentStatus.title}</strong>
            <span>{currentStatus.description}</span>
          </div>

          {liveTrackingActive && <span className="live-dot">LIVE</span>}
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
            <strong>{rider?.name || "HOKADA rider"}</strong>

            <small>
              {[rider?.bike, rider?.plate].filter(Boolean).join(" • ") ||
                "Vehicle details unavailable"}
            </small>
          </div>

          {rider?.phone ? (
            <a
              className="call-rider-button"
              href={`tel:${rider.phone}`}
              aria-label="Call rider"
            >
              <Phone size={18} />
            </a>
          ) : (
            <span
              className="call-rider-button"
              aria-label="Rider phone number unavailable"
              title="Rider phone number unavailable"
            >
              <Phone size={18} />
            </span>
          )}
        </div>

        {liveTrackingActive && (
          <TrackingChat
            deliveryId={delivery?.id}
            status={status}
            paymentStatus={delivery?.payment_status}
          />
        )}

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

function DeliveriesPage({ deliveries, onBack, onBook, onSelectDelivery }) {
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
            <button
              type="button"
              className="delivery-item"
              key={delivery.id}
              onClick={() => onSelectDelivery(delivery)}
            >
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
            </button>
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

function DeliveryDetailsPage({ delivery, onBack, onTrack, onPay, isPaying }) {
  const paymentStatus = delivery.paymentStatus ?? delivery.payment_status;
  const deliveryStatus = paymentStatus === "paid" ? "delivered" : delivery.status;
  const status = String(deliveryStatus || "searching")
    .replaceAll("_", " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());

  const price =
    delivery.deliveryFee ??
    delivery.pricing?.total ??
    delivery.rider_earnings ??
    0;

  return (
    <div className="page">
      <PageHeader
        title="Delivery details"
        subtitle="Review your delivery information."
        onBack={onBack}
      />

      <div className="empty-card">
        <div className="empty-icon">
          <Package size={30} />
        </div>

        <h3>{delivery.pickup}</h3>
        <p>To: {delivery.dropoff}</p>

        <hr />

        <p>
          <strong>Status:</strong> {status}
        </p>
        <p>
          <strong>Delivery type:</strong> {delivery.deliveryType || "Standard"}
        </p>
        <p>
          <strong>Package size:</strong> {delivery.packageSize || "Small"}
        </p>
        <p>
          <strong>Delivery fee:</strong> {formatNaira(price)}
        </p>
        <p>
          <strong>Payment:</strong>{" "}
          {(
            paymentStatus ||
            "Not confirmed"
          )
            .toString()
            .replaceAll("_", " ")}
        </p>

        {paymentStatus !== "paid" &&
          ["arrived_at_dropoff", "delivered"].includes(delivery.status) && (
            <button
              className="primary-button full-width"
              onClick={onPay}
              disabled={isPaying}
            >
              {isPaying ? "Opening secure checkout..." : "Pay Now"}
            </button>
          )}

        <button className="primary-button full-width" onClick={onTrack}>
          <MapPin size={18} />
          Track delivery
        </button>

        <button className="secondary-button full-width" onClick={onBack}>
          Back to deliveries
        </button>
      </div>
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
