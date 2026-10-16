import { useEffect, useRef, useState } from "react";
import RiderLocationBroadcaster from "../RiderLocationBroadcaster";
import { supabase } from "../../lib/supabase";
import RiderTrackingChat from "./RiderTrackingChat";
import RiderAuth from "./RiderAuth";
import {
  Bike,
  CheckCircle2,
  MapPin,
  Package,
  Phone,
  Power,
  RefreshCw,
  Truck,
  User,
  XCircle,
  Zap,
  Navigation,
  Flag,
  LogOut,
  History,
} from "lucide-react";

const RIDER = {
  name: "Chinedu Okafor",
  phone: "0803 456 7890",
  bike: "Honda Ace",
  plate: "KJA 482 XY",
  rating: "4.9",
};

const ACTIVE_STATUSES = [
  "accepted",
  "in_transit",
  "arrived",
  "collected",
  "going_to_dropoff",
  "arrived_at_dropoff",
];

const AVAILABLE_STATUSES = ["searching", "pending"];

export default function RiderApp() {
  const [session, setSession] = useState(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [riderProfile, setRiderProfile] = useState(null);
  const [profileLoading, setProfileLoading] = useState(false);
  const [deliveryHistory, setDeliveryHistory] = useState([]);
  const [historyLoading, setHistoryLoading] = useState(false);

  const [todayStats, setTodayStats] = useState({
    deliveries: 0,
    earnings: 0,
  });

  const [isOnline, setIsOnline] = useState(false);
  const [availableDelivery, setAvailableDelivery] = useState(null);
  const [activeDelivery, setActiveDelivery] = useState(null);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState(false);
  const [message, setMessage] = useState("");

  const activeDeliveryRef = useRef(null);
  const riderProfileRef = useRef(null);
  const finalizingDeliveryRef = useRef(new Set());

  useEffect(() => {
    activeDeliveryRef.current = activeDelivery;
  }, [activeDelivery]);

  useEffect(() => {
    riderProfileRef.current = riderProfile;
  }, [riderProfile]);

  /*
   * =========================================
   * RIDER PROFILE
   * =========================================
   */

  async function loadRiderProfile(userId) {
    if (!supabase || !userId) return null;

    try {
      setProfileLoading(true);

      const { data, error } = await supabase
        .from("rider_profiles")
        .select("*")
        .eq("id", userId)
        .maybeSingle();

      if (error) {
        console.error("Could not load rider profile:", error);
        return null;
      }

      setRiderProfile(data);
      riderProfileRef.current = data;

      const approved = data?.approval_status === "approved";
      setIsOnline(approved && Boolean(data?.is_online));

      if (!approved) {
        setMessage("Your rider account is awaiting approval.");
      }

      return data;
    } catch (error) {
      console.error("Rider profile error:", error);
      return null;
    } finally {
      setProfileLoading(false);
    }
  }

  /*
   * =========================================
   * DELIVERY HISTORY
   * =========================================
   */

  async function loadDeliveryHistory(riderId) {
    if (!supabase || !riderId) return;

    try {
      setHistoryLoading(true);

      const { data, error } = await supabase
        .from("deliveries")
        .select(
          "id, pickup_address, dropoff_address, rider_earnings, updated_at, status"
        )
        .eq("rider_id", riderId)
        .eq("status", "delivered")
        .order("updated_at", { ascending: false })
        .limit(20);

      if (error) {
        console.error("Could not load delivery history:", error);
        return;
      }

      setDeliveryHistory(data || []);
    } catch (error) {
      console.error("Delivery history error:", error);
    } finally {
      setHistoryLoading(false);
    }
  }

  /*
   * =========================================
   * TODAY'S STATS
   * =========================================
   */

  async function loadTodayStats(riderId) {
    if (!supabase || !riderId) return;

    try {
      const startOfToday = new Date();
      startOfToday.setHours(0, 0, 0, 0);

      const { data, error } = await supabase
        .from("deliveries")
        .select("rider_earnings, updated_at, status")
        .eq("rider_id", riderId)
        .eq("status", "delivered")
        .gte("updated_at", startOfToday.toISOString());

      if (error) {
        console.error("Could not load today's rider stats:", error);
        return;
      }

      const earnings = (data || []).reduce(
        (total, delivery) => total + Number(delivery.rider_earnings || 0),
        0
      );

      setTodayStats({
        deliveries: data?.length || 0,
        earnings,
      });
    } catch (error) {
      console.error("Today's rider stats error:", error);
    }
  }

  /*
   * =========================================
   * RIDER AUTHENTICATION
   * =========================================
   */

  useEffect(() => {
    let mounted = true;

    async function loadSession() {
      if (!supabase) {
        if (mounted) setAuthLoading(false);
        return;
      }

      const {
        data: { session },
        error,
      } = await supabase.auth.getSession();

      if (error) {
        console.error("Could not load rider session:", error);
      }

      if (mounted) {
        setSession(session || null);
        setAuthLoading(false);
      }
    }

    void loadSession();

    if (!supabase) {
      return () => {
        mounted = false;
      };
    }

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      if (mounted) setSession(session);
    });

    return () => {
      mounted = false;
      subscription.unsubscribe();
    };
  }, []);

  async function handleLogout() {
    if (!supabase) return;

    const { error } = await supabase.auth.signOut();

    if (error) {
      console.error("Logout error:", error);
      setMessage("Could not log out. Please try again.");
      return;
    }

    setSession(null);
    setRiderProfile(null);
    setAvailableDelivery(null);
    setActiveDelivery(null);
    setDeliveryHistory([]);
    setTodayStats({ deliveries: 0, earnings: 0 });
    setIsOnline(false);
    setMessage("");
  }

  /*
   * =========================================
   * LOAD DELIVERIES
   * =========================================
   */

  async function loadDelivery(showLoading = true, riderId = null) {
    if (!supabase) {
      setMessage("Supabase is not configured.");
      setLoading(false);
      return;
    }

    const currentRiderId =
      riderId || session?.user?.id || riderProfileRef.current?.id || null;

    if (!currentRiderId) {
      if (showLoading) setLoading(false);
      return;
    }

    try {
      if (showLoading) {
        setLoading(true);
        setMessage("");
      }

      const { data, error } = await supabase
        .from("deliveries")
        .select(
          "id, customer_id, customer_name, rider_id, rider_name, pickup_address, dropoff_address, recipient_name, recipient_phone, package_type, delivery_type, notes, status, payment_status, delivery_fee, rider_earnings, created_at, updated_at"
        )
        .order("created_at", { ascending: false })
        .limit(50);

      if (error) {
        console.error("Could not load deliveries:", error);

        if (showLoading) {
          setMessage(error.message);
          setLoading(false);
        }

        return;
      }
      console.log("HOKADA rider diagnostic:", {
        riderId: currentRiderId,
        deliveryCount: data?.length ?? 0,
        deliveries: (data || []).map((delivery) => ({
          id: delivery.id,
          status: delivery.status,
          payment_status: delivery.payment_status,
          rider_id: delivery.rider_id,
        })),
      });
      /*
       * Find a delivery already assigned to this rider.
       */

      const active = (data || []).find(
        (delivery) =>
          delivery.rider_id === currentRiderId &&
          ACTIVE_STATUSES.includes(delivery.status)
      );

      if (active) {
        setActiveDelivery((previous) => {
          if (
            previous?.id === active.id &&
            previous.status === active.status &&
            previous.payment_status === active.payment_status &&
            previous.updated_at === active.updated_at
          ) {
            return previous;
          }

          return active;
        });

        setAvailableDelivery(null);

        if (showLoading) setLoading(false);

        /*
         * A payment may have completed while the rider was offline.
         * Complete the delivery when the latest database row confirms
         * payment and the rider has reached the destination.
         */
        if (
          active.status === "arrived_at_dropoff" &&
          active.payment_status === "paid"
        ) {
          void finalizePaidDelivery(active, currentRiderId);
        }

        return;
      }

      /*
       * Find an unassigned delivery.
       *
       * Show eligible unassigned deliveries regardless of payment status.
       * Payment is collected at drop-off and verified by the backend.
       * Cancelled and already assigned deliveries are not available.
       */

      const { data: declinedRows, error: declinedError } = await supabase
        .from("rider_declined_deliveries")
        .select("delivery_id")
        .eq("rider_id", currentRiderId);

      if (declinedError) {
        console.error("Could not load declined requests:", declinedError);
        setMessage(declinedError.message);
        if (showLoading) setLoading(false);
        return;
      }

      const declinedIds = new Set(
        (declinedRows || []).map((row) => row.delivery_id)
      );

      const available = (data || []).find(
        (delivery) =>
          !delivery.rider_id &&
          AVAILABLE_STATUSES.includes(delivery.status) &&
          !declinedIds.has(delivery.id)
      );

      setAvailableDelivery((previous) => {
        if (
          previous?.id === available?.id &&
          previous?.status === available?.status &&
          previous?.updated_at === available?.updated_at
        ) {
          return previous;
        }

        return available || null;
      });

      setActiveDelivery(null);

      if (showLoading) setLoading(false);
    } catch (error) {
      console.error("Load delivery error:", error);

      if (showLoading) {
        setMessage("Something went wrong while loading deliveries.");
        setLoading(false);
      }
    }
  }

  /*
   * =========================================
   * INITIAL RIDER DATA + REALTIME
   * =========================================
   */

  useEffect(() => {
    if (!session || !supabase) return;

    let cancelled = false;
    const riderId = session.user.id;

    async function initializeRider() {
      await loadRiderProfile(riderId);

      if (cancelled) return;

      await Promise.all([
        loadDelivery(true, riderId),
        loadDeliveryHistory(riderId),
        loadTodayStats(riderId),
      ]);
    }

    void initializeRider();

    const channel = supabase
      .channel(`rider-delivery-updates-${riderId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "deliveries",
        },
        (payload) => {
          const updatedDelivery = payload.new;

          if (!updatedDelivery?.id) return;

          if (
            payload.eventType === "UPDATE" &&
            updatedDelivery.status === "cancelled"
          ) {
            setActiveDelivery((previous) =>
              previous?.id === updatedDelivery.id ? null : previous
            );

            setAvailableDelivery((previous) =>
              previous?.id === updatedDelivery.id ? null : previous
            );

            setMessage("This delivery has been cancelled.");

            void loadDelivery(false, riderId);
            return;
          }

          /*
           * Payment confirmation can happen without a status change.
           * Check payment_status as well as status.
           */
          if (
            payload.eventType === "UPDATE" &&
            updatedDelivery.rider_id === riderId &&
            updatedDelivery.status === "arrived_at_dropoff" &&
            updatedDelivery.payment_status === "paid"
          ) {
            setActiveDelivery(updatedDelivery);

            void finalizePaidDelivery(updatedDelivery, riderId);
            return;
          }

          /*
           * Refresh after other delivery changes.
           */
          void loadDelivery(false, riderId);
        }
      )
      .subscribe((status) => {
        if (status === "CHANNEL_ERROR") {
          console.error("Rider delivery realtime channel error.");
        }
      });

    return () => {
      cancelled = true;
      supabase.removeChannel(channel);
    };
  }, [session]);

  /*
   * =========================================
   * ACCEPT DELIVERY
   * =========================================
   */

  async function acceptDelivery() {
    if (!availableDelivery || !supabase || !session?.user?.id) {
      return;
    }

    if (riderProfileRef.current?.approval_status !== "approved") {
      setMessage(
        "Your rider account must be approved before accepting deliveries."
      );
      return;
    }

    try {
      setActionLoading(true);
      setMessage("");

      const riderId = session.user.id;
      const riderName = riderProfileRef.current?.full_name || RIDER.name;

      const { data, error } = await supabase
        .from("deliveries")
        .update({
          rider_id: riderId,
          rider_name: riderName,
          status: "accepted",
          updated_at: new Date().toISOString(),
        })
        .eq("id", availableDelivery.id)
        .is("rider_id", null)
        .in("status", AVAILABLE_STATUSES)
        .select(
          "id, customer_id, customer_name, rider_id, rider_name, pickup_address, dropoff_address, recipient_name, recipient_phone, package_type, delivery_type, notes, status, payment_status, delivery_fee, rider_earnings, created_at, updated_at"
        )
        .maybeSingle();

      if (error) {
        console.error("Accept delivery error:", error);
        setMessage(error.message);
        await loadDelivery(false, riderId);
        return;
      }

      if (!data) {
        setMessage(
          "This delivery is no longer available or its payment status has changed. Refresh to see the latest requests."
        );
        await loadDelivery(false, riderId);
        return;
      }

      setActiveDelivery(data);
      setAvailableDelivery(null);
      setMessage("Delivery accepted successfully.");
    } catch (error) {
      console.error("Accept delivery error:", error);
      setMessage("Could not accept this delivery.");
    } finally {
      setActionLoading(false);
    }
  }

  /*
   * =========================================
   * COMPLETE DELIVERY AFTER VERIFIED PAYMENT
   * =========================================
   *
   * IMPORTANT:
   * The backend must be the only trusted component that
   * sets payment_status = "paid" after verifying Paystack.
   *
   * This function reads that verified database value,
   * then attempts a conditional transition to delivered.
   */

  async function finalizePaidDelivery(delivery, riderId) {
    if (!supabase || !delivery?.id || !riderId) return;

    const deliveryId = delivery.id;

    if (finalizingDeliveryRef.current.has(deliveryId)) return;

    finalizingDeliveryRef.current.add(deliveryId);

    try {
      const { data: latest, error: readError } = await supabase
        .from("deliveries")
        .select(
          "id, rider_id, status, payment_status, delivery_fee, rider_earnings"
        )
        .eq("id", deliveryId)
        .eq("rider_id", riderId)
        .maybeSingle();

      if (readError) throw readError;

      if (!latest) {
        await loadDelivery(false, riderId);
        return;
      }

      /*
       * Payment must be confirmed by the backend.
       */
      if (latest.payment_status !== "paid") return;

      /*
       * Already completed: refresh the history and stats,
       * but do not add earnings again.
       */
      if (latest.status === "delivered") {
        await Promise.all([
          loadDeliveryHistory(riderId),
          loadTodayStats(riderId),
        ]);

        return;
      }

      /*
       * Only complete a delivery at the destination.
       */
      if (latest.status !== "arrived_at_dropoff") return;

      /*
       * Conditional update:
       * - assigned to this rider
       * - still at drop-off
       * - payment is confirmed
       *
       * Supabase will calculate rider earnings securely.
       */
      const { data: completed, error: completeError } = await supabase
        .from("deliveries")
        .update({
          status: "delivered",
          updated_at: new Date().toISOString(),
        })
        .eq("id", deliveryId)
        .eq("rider_id", riderId)
        .eq("status", "arrived_at_dropoff")
        .eq("payment_status", "paid")
        .select(
          "id, customer_id, customer_name, rider_id, rider_name, pickup_address, dropoff_address, recipient_name, recipient_phone, package_type, delivery_type, notes, status, payment_status, delivery_fee, rider_earnings, created_at, updated_at"
        )
        .maybeSingle();

      if (completeError) throw completeError;

      if (!completed) {
        await loadDelivery(false, riderId);
        return;
      }

      setActiveDelivery(completed);
      setAvailableDelivery(null);
      setMessage("Payment confirmed. Delivery completed successfully.");

      // Refresh history and today's statistics from the database.
      // Delivery earnings are calculated securely by the database.
      await Promise.all([
        loadDeliveryHistory(riderId),
        loadTodayStats(riderId),
      ]);
    } catch (error) {
      console.error("Could not complete paid delivery:", error);

      setMessage(
        "Payment may be confirmed, but completion failed. Refresh and try again."
      );
    } finally {
      finalizingDeliveryRef.current.delete(deliveryId);
    }
  }

  /*
   * =========================================
   * UPDATE DELIVERY STATUS
   * =========================================
   */

  async function updateDeliveryStatus(status) {
    if (!activeDelivery || !supabase || !session?.user?.id) {
      return;
    }

    /*
     * Never allow the rider interface to complete a delivery
     * before payment has been confirmed.
     */
    if (status === "delivered" && activeDelivery.payment_status !== "paid") {
      setMessage(
        "The delivery cannot be completed until the customer's payment is confirmed."
      );
      return;
    }

    try {
      setActionLoading(true);
      setMessage("");

      const riderId = session.user.id;

      const updatePayload = {
        status,
        updated_at: new Date().toISOString(),
      };

      let updateQuery = supabase
        .from("deliveries")
        .update(updatePayload)
        .eq("id", activeDelivery.id)
        .eq("rider_id", riderId);

      /*
       * If a delivered transition is requested, require paid
       * status in the database query as well.
       */
      if (status === "delivered") {
        updateQuery = updateQuery
          .eq("status", "arrived_at_dropoff")
          .eq("payment_status", "paid");
      }

      const { data, error } = await updateQuery
        .select(
          "id, customer_id, customer_name, rider_id, rider_name, pickup_address, dropoff_address, recipient_name, recipient_phone, package_type, delivery_type, notes, status, payment_status, delivery_fee, rider_earnings, created_at, updated_at"
        )
        .maybeSingle();

      if (error) {
        console.error("Status update error:", error);
        setMessage(error.message);
        return;
      }

      if (!data) {
        setMessage(
          status === "delivered"
            ? "Payment must be confirmed before completing this delivery."
            : "The delivery status has changed. Refresh and try again."
        );

        await loadDelivery(false, riderId);
        return;
      }

      setActiveDelivery(data);

      /*
       * Do not add earnings here for delivered transitions.
       * Automatic payment completion is handled by
       * finalizePaidDelivery(), which has a single guarded path.
       */
    } catch (error) {
      console.error("Status update error:", error);
      setMessage("Could not update delivery status.");
    } finally {
      setActionLoading(false);
    }
  }

  /*
   * =========================================
   * ONLINE / OFFLINE
   * =========================================
   */

  async function updateOnlineStatus(nextStatus) {
    if (!supabase || !session?.user?.id) return;

    if (nextStatus && riderProfileRef.current?.approval_status !== "approved") {
      setIsOnline(false);
      setMessage("Your rider account must be approved before going online.");
      return;
    }

    const previousStatus = isOnline;

    setIsOnline(nextStatus);
    setMessage("");

    const { error } = await supabase
      .from("rider_profiles")
      .update({
        is_online: nextStatus,
        updated_at: new Date().toISOString(),
      })
      .eq("id", session.user.id);

    if (error) {
      console.error("Could not update rider online status:", error);
      setIsOnline(previousStatus);
      setMessage("Could not update your online status.");
    }
  }

  /*
   * =========================================
   * STATUS LABEL
   * =========================================
   */

  function getStatusLabel(status) {
    switch (status) {
      case "accepted":
        return "Accepted";
      case "in_transit":
        return "Going to pickup";
      case "arrived":
        return "Arrived at pickup";
      case "collected":
        return "Package collected";
      case "going_to_dropoff":
        return "Going to drop-off";
      case "arrived_at_dropoff":
        return "Awaiting payment";
      case "delivered":
        return "Delivered";
      default:
        return status || "Unknown";
    }
  }

  /*
   * =========================================
   * AUTH LOADING SCREEN
   * =========================================
   */

  if (authLoading) {
    return (
      <div className="rider-auth-page">
        <div className="rider-auth-card">
          <div className="rider-auth-logo">
            <Bike size={28} />
          </div>

          <div className="rider-auth-header">
            <span className="eyebrow">HOKADA RIDER</span>
            <h1>Checking your account</h1>
            <p>Please wait while we securely sign you in.</p>
          </div>
        </div>
      </div>
    );
  }

  /*
   * =========================================
   * LOGIN / SIGNUP
   * =========================================
   */

  if (!session) {
    return (
      <RiderAuth
        onLogin={(user) => {
          setSession({ user });
        }}
      />
    );
  }

  /*
   * =========================================
   * DELIVERY STAGES
   * =========================================
   */

  const isPickupStage =
    activeDelivery &&
    ["accepted", "in_transit", "arrived", "collected"].includes(
      activeDelivery.status
    );

  const isDropoffStage =
    activeDelivery &&
    ["collected", "going_to_dropoff", "arrived_at_dropoff"].includes(
      activeDelivery.status
    );

  /*
   * =========================================
   * RIDER APP
   * =========================================
   */

  return (
    <div className="rider-app">
      <header className="rider-header">
        <div>
          <div className="rider-brand">
            HOKADA <span>RIDER</span>
          </div>
          <div className="rider-subtitle">Delivery partner dashboard</div>
        </div>

        <div className="rider-header-actions">
          <button
            className={`rider-online-toggle ${isOnline ? "online" : "offline"}`}
            onClick={() => updateOnlineStatus(!isOnline)}
          >
            <Power size={16} />
            {isOnline ? "Online" : "Offline"}
          </button>

          <button
            className="rider-logout-button"
            onClick={handleLogout}
            title="Log out"
          >
            <LogOut size={17} />
          </button>
        </div>
      </header>

      <main className="rider-content">
        <section className="rider-profile-card">
          <div className="rider-profile-avatar">
            <Bike size={28} />
          </div>

          <div className="rider-profile-info">
            <span>Welcome back</span>

            <strong>
              {profileLoading
                ? "Loading profile..."
                : riderProfile?.full_name || RIDER.name}
            </strong>

            <small>
              {riderProfile?.bike_model || RIDER.bike} •{" "}
              {riderProfile?.plate_number || RIDER.plate}
            </small>
          </div>

          <div className="rider-rating">
            ★ {riderProfile?.rating ?? RIDER.rating}
          </div>
        </section>

        {message && <div className="rider-message">{message}</div>}

        <section className="rider-section-heading">
          <div>
            <span className="rider-eyebrow">RIDER DASHBOARD</span>

            <h1>
              {activeDelivery ? "Your active delivery" : "Available deliveries"}
            </h1>
          </div>

          <button
            className="rider-refresh-button"
            onClick={() => loadDelivery(true, session.user.id)}
            disabled={loading}
          >
            <RefreshCw size={18} className={loading ? "rider-spin" : ""} />
          </button>
        </section>

        {loading ? (
          <div className="rider-empty-card">
            <RefreshCw size={28} className="rider-spin" />
            <strong>Checking for deliveries...</strong>
            <span>Please wait.</span>
          </div>
        ) : activeDelivery ? (
          <>
            <section className="rider-active-card">
              <div className="rider-active-top">
                <div className="rider-active-label">
                  <Truck size={19} />
                  <span>ACTIVE DELIVERY</span>
                </div>

                <span className="rider-status-pill">
                  {getStatusLabel(activeDelivery.status)}
                </span>
              </div>

              <div className="rider-delivery-id">
                Delivery #{activeDelivery.id.slice(0, 8)}
              </div>

              <div className="rider-route">
                <div className="rider-route-item">
                  <div className="rider-route-icon pickup">
                    <MapPin size={18} />
                  </div>

                  <div>
                    <span>Pickup</span>
                    <strong>
                      {activeDelivery.pickup_address || "Pickup location"}
                    </strong>
                  </div>
                </div>

                <div className="rider-route-line" />

                <div className="rider-route-item">
                  <div className="rider-route-icon dropoff">
                    <MapPin size={18} />
                  </div>

                  <div>
                    <span>Drop-off</span>
                    <strong>
                      {activeDelivery.dropoff_address || "Drop-off location"}
                    </strong>
                  </div>
                </div>
              </div>

              <div className="rider-customer">
                <div className="rider-customer-icon">
                  <User size={19} />
                </div>

                <div>
                  <span>Customer</span>
                  <strong>
                    {activeDelivery.customer_name || "HOKADA Customer"}
                  </strong>
                </div>

                <a
                  href={`tel:${activeDelivery.recipient_phone || RIDER.phone}`}
                  className="rider-call-button"
                  aria-label="Call customer"
                >
                  <Phone size={18} />
                </a>
              </div>
            </section>

            {/* PICKUP SECTION */}

            {isPickupStage && (
              <section className="rider-pickup-section">
                <div className="rider-pickup-header">
                  <div className="rider-pickup-icon">
                    <MapPin size={24} />
                  </div>

                  <div>
                    <span>PICKUP JOURNEY</span>
                    <h2>Get the package</h2>
                  </div>
                </div>

                <div className="rider-pickup-route">
                  <div className="rider-pickup-destination">
                    <div className="rider-pickup-dot">
                      <MapPin size={17} />
                    </div>

                    <div>
                      <span>PICKUP LOCATION</span>
                      <strong>
                        {activeDelivery.pickup_address || "Pickup location"}
                      </strong>
                    </div>
                  </div>
                </div>

                <div className="rider-pickup-progress">
                  {[
                    {
                      status: "accepted",
                      label: "Accepted",
                      icon: <CheckCircle2 size={18} />,
                      done: [
                        "accepted",
                        "in_transit",
                        "arrived",
                        "collected",
                      ].includes(activeDelivery.status),
                    },
                    {
                      status: "in_transit",
                      label: "Going to pickup",
                      icon: <Navigation size={18} />,
                      done: ["in_transit", "arrived", "collected"].includes(
                        activeDelivery.status
                      ),
                    },
                    {
                      status: "arrived",
                      label: "Arrived",
                      icon: <MapPin size={18} />,
                      done: ["arrived", "collected"].includes(
                        activeDelivery.status
                      ),
                    },
                    {
                      status: "collected",
                      label: "Package collected",
                      icon: <Package size={18} />,
                      done: activeDelivery.status === "collected",
                    },
                  ].map((step) => (
                    <div
                      className={`rider-pickup-step ${
                        step.done ? "completed" : ""
                      }`}
                      key={step.status}
                    >
                      <div className="rider-pickup-step-icon">{step.icon}</div>
                      <span>{step.label}</span>
                    </div>
                  ))}
                </div>

                <div className="rider-pickup-action">
                  {activeDelivery.status === "accepted" && (
                    <>
                      <div className="rider-pickup-action-icon">
                        <Zap size={25} />
                      </div>

                      <div className="rider-pickup-action-text">
                        <strong>Ready to go?</strong>
                        <span>Start your trip to the pickup location.</span>
                      </div>

                      <button
                        className="rider-pickup-button"
                        onClick={() => updateDeliveryStatus("in_transit")}
                        disabled={actionLoading}
                      >
                        <Bike size={18} />
                        Go to pickup
                      </button>
                    </>
                  )}

                  {activeDelivery.status === "in_transit" && (
                    <>
                      <div className="rider-pickup-action-icon">
                        <Navigation size={25} />
                      </div>

                      <div className="rider-pickup-action-text">
                        <strong>Heading to pickup</strong>
                        <span>
                          Your live location is being shared with the customer.
                        </span>
                      </div>

                      <button
                        className="rider-pickup-button"
                        onClick={() => updateDeliveryStatus("arrived")}
                        disabled={actionLoading}
                      >
                        <MapPin size={18} />I have arrived
                      </button>
                    </>
                  )}

                  {activeDelivery.status === "arrived" && (
                    <>
                      <div className="rider-pickup-action-icon">
                        <Package size={25} />
                      </div>

                      <div className="rider-pickup-action-text">
                        <strong>You're at pickup</strong>
                        <span>Collect the package from the customer.</span>
                      </div>

                      <button
                        className="rider-pickup-button"
                        onClick={() => updateDeliveryStatus("collected")}
                        disabled={actionLoading}
                      >
                        <Package size={18} />
                        Package collected
                      </button>
                    </>
                  )}

                  {activeDelivery.status === "collected" && (
                    <>
                      <div className="rider-pickup-action-icon success">
                        <CheckCircle2 size={25} />
                      </div>

                      <div className="rider-pickup-action-text">
                        <strong>Package collected</strong>
                        <span>
                          The package is now with you. Proceed to the drop-off.
                        </span>
                      </div>
                    </>
                  )}
                </div>
              </section>
            )}

            {/* DROP-OFF SECTION */}

            {isDropoffStage && (
              <section className="rider-dropoff-section">
                <div className="rider-dropoff-header">
                  <div className="rider-dropoff-icon">
                    <Flag size={24} />
                  </div>

                  <div>
                    <span>DROP-OFF JOURNEY</span>
                    <h2>Deliver the package</h2>
                  </div>
                </div>

                <div className="rider-dropoff-destination">
                  <div className="rider-dropoff-location-icon">
                    <Flag size={19} />
                  </div>

                  <div>
                    <span>DROP-OFF LOCATION</span>
                    <strong>
                      {activeDelivery.dropoff_address || "Drop-off location"}
                    </strong>
                  </div>
                </div>

                <div className="rider-dropoff-progress">
                  {[
                    {
                      status: "collected",
                      label: "Package collected",
                      icon: <Package size={18} />,
                      active: [
                        "collected",
                        "going_to_dropoff",
                        "arrived_at_dropoff",
                      ].includes(activeDelivery.status),
                    },
                    {
                      status: "going_to_dropoff",
                      label: "Going to drop-off",
                      icon: <Navigation size={18} />,
                      active: [
                        "going_to_dropoff",
                        "arrived_at_dropoff",
                      ].includes(activeDelivery.status),
                    },
                    {
                      status: "arrived_at_dropoff",
                      label: "Arrived",
                      icon: <MapPin size={18} />,
                      active: activeDelivery.status === "arrived_at_dropoff",
                    },
                    {
                      status: "delivered",
                      label: "Delivered",
                      icon: <CheckCircle2 size={18} />,
                      active: activeDelivery.status === "delivered",
                    },
                  ].map((step) => (
                    <div
                      className={`rider-dropoff-step ${
                        step.active ? "active" : ""
                      }`}
                      key={step.status}
                    >
                      <div className="rider-dropoff-step-icon">{step.icon}</div>
                      <span>{step.label}</span>
                    </div>
                  ))}
                </div>

                <div className="rider-dropoff-action">
                  {activeDelivery.status === "collected" && (
                    <>
                      <div className="rider-dropoff-action-icon">
                        <Navigation size={26} />
                      </div>

                      <div className="rider-dropoff-action-text">
                        <strong>Ready for drop-off</strong>
                        <span>
                          Start your trip to the customer's drop-off location.
                        </span>
                      </div>

                      <button
                        className="rider-dropoff-button"
                        onClick={() => updateDeliveryStatus("going_to_dropoff")}
                        disabled={actionLoading}
                      >
                        <Navigation size={18} />
                        Go to drop-off
                      </button>
                    </>
                  )}

                  {activeDelivery.status === "going_to_dropoff" && (
                    <>
                      <div className="rider-dropoff-action-icon">
                        <Navigation size={26} />
                      </div>

                      <div className="rider-dropoff-action-text">
                        <strong>Heading to drop-off</strong>
                        <span>
                          Your live location is being shared with the customer.
                        </span>
                      </div>

                      <button
                        className="rider-dropoff-button"
                        onClick={() =>
                          updateDeliveryStatus("arrived_at_dropoff")
                        }
                        disabled={actionLoading}
                      >
                        <MapPin size={18} />I have arrived
                      </button>
                    </>
                  )}

                  {activeDelivery.status === "arrived_at_dropoff" && (
                    <>
                      <div className="rider-dropoff-action-icon">
                        {activeDelivery.payment_status === "paid" ? (
                          <CheckCircle2 size={26} />
                        ) : (
                          <Package size={26} />
                        )}
                      </div>

                      <div className="rider-dropoff-action-text">
                        <strong>
                          {activeDelivery.payment_status === "paid"
                            ? "Payment confirmed"
                            : "Waiting for customer payment"}
                        </strong>

                        <span>
                          {activeDelivery.payment_status === "paid"
                            ? "HOKADA is completing this delivery automatically."
                            : "The delivery will be completed automatically after Paystack payment is verified."}
                        </span>
                      </div>

                      {activeDelivery.payment_status !== "paid" && (
                        <span className="rider-status-pill">
                          Payment pending
                        </span>
                      )}
                    </>
                  )}
                </div>
              </section>
            )}

            {/* GPS TRACKING */}

            <RiderLocationBroadcaster
              deliveryId={activeDelivery.id}
              riderId={riderProfile?.id}
              enabled={ACTIVE_STATUSES.includes(activeDelivery.status)}
            />

            <RiderTrackingChat
              deliveryId={activeDelivery.id}
              status={activeDelivery.status}
            />
          </>
        ) : availableDelivery && isOnline ? (
          <section className="rider-job-card">
            <div className="rider-job-header">
              <div className="rider-job-icon">
                <Package size={26} />
              </div>

              <div>
                <span>NEW DELIVERY REQUEST</span>
                <strong>Delivery #{availableDelivery.id.slice(0, 8)}</strong>
              </div>
            </div>

            <div className="rider-job-route">
              <div className="rider-route-item">
                <div className="rider-route-icon pickup">
                  <MapPin size={18} />
                </div>

                <div>
                  <span>Pickup</span>
                  <strong>
                    {availableDelivery.pickup_address || "Pickup location"}
                  </strong>
                </div>
              </div>

              <div className="rider-route-line" />

              <div className="rider-route-item">
                <div className="rider-route-icon dropoff">
                  <MapPin size={18} />
                </div>

                <div>
                  <span>Drop-off</span>
                  <strong>
                    {availableDelivery.dropoff_address || "Drop-off location"}
                  </strong>
                </div>
              </div>
            </div>

            <div className="rider-job-customer">
              <User size={18} />
              <span>
                {availableDelivery.customer_name || "HOKADA Customer"}
              </span>
            </div>

            <div className="rider-job-actions">
              <button
                className="rider-decline-button"
                onClick={async () => {
                  if (!availableDelivery?.id || !session?.user?.id) return;

                  const confirmed = window.confirm(
                    "Decline this delivery request?"
                  );

                  if (!confirmed) return;

                  const declinedId = availableDelivery.id;
                  const riderId = session.user.id;

                  setActionLoading(true);

                  try {
                    const { error } = await supabase
                      .from("rider_declined_deliveries")
                      .upsert(
                        {
                          rider_id: riderId,
                          delivery_id: declinedId,
                        },
                        {
                          onConflict: "rider_id,delivery_id",
                          ignoreDuplicates: true,
                        }
                      );

                    if (error) throw error;

                    setAvailableDelivery(null);
                    setMessage("Delivery request declined.");
                    await loadDelivery(false, riderId);
                  } catch (error) {
                    console.error("Could not decline delivery:", error);
                    setMessage(`Could not decline request: ${error.message}`);
                  } finally {
                    setActionLoading(false);
                  }
                }}
                disabled={actionLoading}
              >
                Decline
              </button>

              <button
                className="rider-accept-button"
                onClick={acceptDelivery}
                disabled={actionLoading}
              >
                <CheckCircle2 size={18} />
                {actionLoading ? "Accepting..." : "Accept delivery"}
              </button>
            </div>
          </section>
        ) : !isOnline ? (
          <div className="rider-empty-card">
            <Power size={32} />
            <strong>You are offline</strong>
            <span>Go online to start receiving delivery requests.</span>

            <button
              className="rider-primary-button"
              onClick={() => updateOnlineStatus(true)}
            >
              Go online
            </button>
          </div>
        ) : (
          <div className="rider-empty-card">
            <Bike size={34} />
            <strong>No deliveries yet</strong>
            <span>
              New delivery requests will appear here when they become available.
            </span>

            <button
              className="rider-primary-button"
              onClick={() => loadDelivery(true, session.user.id)}
            >
              <RefreshCw size={18} />
              Check again
            </button>
          </div>
        )}

        {/* TODAY'S STATS */}

        <section className="rider-bottom-info">
          <div>
            <span>Today's deliveries</span>
            <strong>{todayStats.deliveries}</strong>
          </div>

          <div>
            <span>Today's earnings</span>
            <strong>₦{todayStats.earnings.toLocaleString("en-NG")}</strong>
          </div>

          <div>
            <span>Rating</span>
            <strong>★ {riderProfile?.rating ?? RIDER.rating}</strong>
          </div>
        </section>

        {/* DELIVERY HISTORY */}

        <section className="rider-history-section">
          <div className="rider-history-header">
            <div>
              <span className="rider-eyebrow">DELIVERY HISTORY</span>
              <h3>Completed deliveries</h3>
            </div>

            <div className="rider-history-icon">
              <History size={20} />
            </div>
          </div>

          {historyLoading ? (
            <div className="rider-history-empty">
              <RefreshCw size={18} className="rider-history-spin" />
              <span>Loading delivery history...</span>
            </div>
          ) : deliveryHistory.length === 0 ? (
            <div className="rider-history-empty">
              <Package size={20} />

              <div>
                <strong>No completed deliveries yet</strong>
                <span>Your completed jobs will appear here.</span>
              </div>
            </div>
          ) : (
            <div className="rider-history-list">
              {deliveryHistory.map((delivery) => (
                <div className="rider-history-card" key={delivery.id}>
                  <div className="rider-history-card-top">
                    <div className="rider-history-status">
                      <CheckCircle2 size={16} />
                      Delivered
                    </div>

                    <strong>
                      ₦
                      {Number(delivery.rider_earnings || 0).toLocaleString(
                        "en-NG"
                      )}
                    </strong>
                  </div>

                  <div className="rider-history-route">
                    <div className="rider-history-location">
                      <span className="rider-history-dot pickup" />

                      <div>
                        <small>PICKUP</small>
                        <p>{delivery.pickup_address || "Pickup location"}</p>
                      </div>
                    </div>

                    <div className="rider-history-line" />

                    <div className="rider-history-location">
                      <span className="rider-history-dot dropoff" />

                      <div>
                        <small>DROP-OFF</small>
                        <p>{delivery.dropoff_address || "Drop-off location"}</p>
                      </div>
                    </div>
                  </div>

                  <div className="rider-history-footer">
                    <span>
                      {new Date(delivery.updated_at).toLocaleDateString(
                        "en-NG",
                        {
                          day: "numeric",
                          month: "short",
                          year: "numeric",
                        }
                      )}
                    </span>

                    <span>
                      {new Date(delivery.updated_at).toLocaleTimeString(
                        "en-NG",
                        {
                          hour: "numeric",
                          minute: "2-digit",
                        }
                      )}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>
      </main>
    </div>
  );
}
