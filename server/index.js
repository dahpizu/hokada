import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import crypto from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import WebSocket from "ws";
import helmet from "helmet";
import { rateLimit } from "express-rate-limit";

dotenv.config();

const app = express();
const PORT = process.env.PORT || 4242;
const PAYSTACK_SECRET_KEY = (process.env.PAYSTACK_SECRET_KEY || "").trim();
const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const SUPABASE_PUBLISHABLE_KEY =
  process.env.SUPABASE_PUBLISHABLE_KEY ||
  process.env.VITE_SUPABASE_PUBLISHABLE_KEY;

const allowedOrigins = (process.env.CLIENT_ORIGIN || "http://localhost:5173")
  .split(",")
  .map((origin) => origin.trim());

const supabase =
  SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY
    ? createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
        auth: {
          persistSession: false,
          autoRefreshToken: false,
        },
        realtime: {
          transport: WebSocket,
        },
      })
    : null;

const authClient =
  SUPABASE_URL && SUPABASE_PUBLISHABLE_KEY
    ? createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
        auth: {
          persistSession: false,
          autoRefreshToken: false,
        },
      })
    : null;

app.use(helmet());
app.use(cors({ origin: allowedOrigins }));
app.use("/api", (_req, res, next) => {
  res.setHeader("Cache-Control", "no-store");
  next();
});

const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 900,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  message: { error: "Too many requests. Please try again later." },
});

const quoteLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 30,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  message: { error: "Too many quote requests. Please try again later." },
});

const deliveryLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  message: { error: "Too many delivery requests. Please try again later." },
});

const paymentLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  message: { error: "Too many payment requests. Please try again later." },
});

const verificationLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 30,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  message: { error: "Too many verification requests. Please try again later." },
});

const riderLocationLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 120,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  message: { error: "Location updates are arriving too quickly. Try again shortly." },
});

const chatLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 600,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  message: { error: "Chat is receiving requests too quickly." },
});

const webhookLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 120,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  message: { error: "Too many webhook requests." },
});

async function requireCustomer(req, res, next) {
  const authorization = req.headers.authorization || "";
  const match = authorization.match(/^Bearer\s+(.+)$/i);

  if (!authClient || !match) {
    return res.status(401).json({ error: "Please sign in again." });
  }

  try {
    const { data, error } = await authClient.auth.getUser(match[1]);

    if (error || !data?.user) {
      return res.status(401).json({
        error: "Your session is invalid or expired.",
      });
    }

    req.customer = data.user;
    return next();
  } catch (error) {
    console.error("Customer authentication failed:", error.message);
    return res.status(401).json({
      error: "Could not validate your session.",
    });
  }
}

async function requireRider(req, res, next) {
  const authorization = req.headers.authorization || "";
  const match = authorization.match(/^Bearer\s+(.+)$/i);

  if (!supabase || !authClient || !match) {
    return res.status(401).json({ error: "Please sign in with a rider account." });
  }

  try {
    const { data, error } = await authClient.auth.getUser(match[1]);

    if (error || !data?.user) {
      return res.status(401).json({ error: "Your session is invalid or expired." });
    }

    const { data: profile, error: profileError } = await supabase
      .from("rider_profiles")
      .select("id, full_name, approval_status, is_online, rating")
      .eq("id", data.user.id)
      .maybeSingle();

    if (profileError) throw profileError;
    if (!profile) {
      return res.status(403).json({ error: "No rider profile exists for this account." });
    }

    req.rider = data.user;
    req.riderProfile = profile;
    return next();
  } catch (error) {
    console.error("Rider authentication failed:", error.message);
    return res.status(401).json({ error: "Could not verify this rider account." });
  }
}

function requireConfiguration(_req, res, next) {
  if (!supabase || !PAYSTACK_SECRET_KEY) {
    return res.status(500).json({
      error: "Payment server configuration is incomplete.",
    });
  }

  return next();
}

app.get("/api/health", (_req, res) => {
  res.json({
    ok: true,
    service: "HOKADA API",
  });
});

async function paystackRequest(path, body) {
  const response = await fetch(`https://api.paystack.co${path}`, {
    method: body ? "POST" : "GET",
    headers: {
      Authorization: `Bearer ${PAYSTACK_SECRET_KEY}`,
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
    signal: AbortSignal.timeout(20000),
  });

  const result = await response.json();

  if (!response.ok || !result.status) {
    throw new Error(result.message || "Paystack request failed.");
  }

  return result.data;
}

// Inspect Paystack's authoritative status before releasing a pending payment.
// Only a missing, abandoned, or failed transaction may be retried.
async function inspectPaystackReference(reference) {
  const response = await fetch(
    `https://api.paystack.co/transaction/verify/${encodeURIComponent(reference)}`,
    {
      method: "GET",
      headers: {
        Authorization: `Bearer ${PAYSTACK_SECRET_KEY}`,
      },
      signal: AbortSignal.timeout(20000),
    }
  );

  let result;
  try {
    result = await response.json();
  } catch {
    throw new Error("Could not safely verify the existing Paystack reference.");
  }

  if (
    response.status === 400 &&
    result.status === false &&
    /^transaction reference not found\.?$/i.test(
      String(result.message || "").trim()
    )
  ) {
    return "missing";
  }

  if (response.ok && result.status === true && result.data) {
    const status = String(result.data.status || "").toLowerCase();

    if (["abandoned", "failed"].includes(status)) {
      return status;
    }

    if (status === "success") {
      return "success";
    }

    // Ongoing, pending, processing, queued, and unknown states are
    // conservatively treated as potentially active transactions.
    return "active";
  }

  throw new Error(
    `Paystack reference check inconclusive (HTTP ${response.status}): ${
      String(result.message || "No response message").slice(0, 180)
    }`
  );
}

// Read the delivery fee from Supabase, never from the browser.
async function getDelivery(deliveryId) {
  const { data, error } = await supabase
    .from("deliveries")
    .select(
      "id, customer_id, status, delivery_fee, payment_status, payment_provider, payment_reference, payment_amount_kobo, paid_at"
    )
    .eq("id", deliveryId)
    .maybeSingle();

  if (error) throw error;
  return data;
}

// Verify directly with Paystack before recording a payment as paid.
async function verifyAndRecordPayment(reference) {
  const { data: delivery, error } = await supabase
    .from("deliveries")
    .select(
      "id, customer_id, payment_status, payment_provider, payment_reference, payment_amount_kobo, paid_at"
    )
    .eq("payment_reference", reference)
    .maybeSingle();

  if (error) throw error;

  if (!delivery) {
    return {
      verified: false,
      message: "Payment reference not found.",
    };
  }

  const payment = await paystackRequest(
    `/transaction/verify/${encodeURIComponent(reference)}`
  );

  // PostgreSQL BIGINT values may arrive as strings, so convert explicitly.
  const expectedAmountKobo = Number(delivery.payment_amount_kobo);

  const valid =
    payment.status === "success" &&
    payment.currency === "NGN" &&
    payment.reference === reference &&
    Number.isSafeInteger(expectedAmountKobo) &&
    expectedAmountKobo >= 100 &&
    payment.amount === expectedAmountKobo &&
    String(payment.metadata?.delivery_id || "") === String(delivery.id);

  const transactionStatus = String(payment.status || "").toLowerCase();

  if (transactionStatus !== "success") {
    if (
      ["pending", "ongoing", "processing", "queued"].includes(
        transactionStatus
      )
    ) {
      return {
        verified: false,
        status: "pending",
        message:
          "Paystack has not confirmed this payment yet. Your delivery remains protected. Check the payment status again shortly.",
      };
    }

    if (["abandoned", "failed"].includes(transactionStatus)) {
      return {
        verified: false,
        status: transactionStatus,
        message:
          "Paystack reports that this payment was not completed. HOKADA will check the previous transaction before allowing another checkout.",
      };
    }
  }

  if (!valid) {
    return {
      verified: false,
      status: "unverified",
      message:
        "Payment could not be matched to the expected delivery and amount. Do not pay again until this transaction has been checked.",
    };
  }

  // Repeated callbacks/webhooks must not reset the original paid timestamp.
  if (
    delivery.payment_status === "paid" &&
    delivery.payment_reference === reference
  ) {
    return { verified: true, delivery };
  }

  const { data: updated, error: updateError } = await supabase
    .from("deliveries")
    .update({
      payment_status: "paid",
      payment_provider: "paystack",
      paid_at: new Date().toISOString(),
    })
    .eq("id", delivery.id)
    .eq("payment_reference", reference)
    .eq("payment_amount_kobo", expectedAmountKobo)
    .in("payment_status", ["unpaid", "pending"])
    .select("id, customer_id, payment_status, payment_reference, paid_at")
    .maybeSingle();

  if (updateError) throw updateError;

  if (updated) {
    return { verified: true, delivery: updated };
  }

  // Another callback/webhook may have recorded this payment concurrently.
  const { data: current, error: readError } = await supabase
    .from("deliveries")
    .select("id, customer_id, payment_status, payment_reference, paid_at")
    .eq("id", delivery.id)
    .maybeSingle();

  if (readError) throw readError;

  if (
    current?.payment_status === "paid" &&
    current?.payment_reference === reference
  ) {
    return { verified: true, delivery: current };
  }

  return {
    verified: false,
    message: "Could not record payment.",
  };
}

// Register the raw-body webhook before express.json().
app.post(
  "/api/payments/webhook",
  webhookLimiter,
  express.raw({ type: "application/json" }),
  requireConfiguration,
  async (req, res) => {
    const signature = req.headers["x-paystack-signature"];

    if (!Buffer.isBuffer(req.body) || typeof signature !== "string") {
      return res.sendStatus(401);
    }

    const expected = crypto
      .createHmac("sha512", PAYSTACK_SECRET_KEY)
      .update(req.body)
      .digest("hex");

    const suppliedBuffer = Buffer.from(signature, "utf8");
    const expectedBuffer = Buffer.from(expected, "utf8");

    if (
      suppliedBuffer.length !== expectedBuffer.length ||
      !crypto.timingSafeEqual(suppliedBuffer, expectedBuffer)
    ) {
      return res.sendStatus(401);
    }

    try {
      const event = JSON.parse(req.body.toString("utf8"));

      if (event.event === "charge.success" && event.data?.reference) {
        const result = await verifyAndRecordPayment(event.data.reference);

        if (!result.verified) {
          console.error("Payment webhook not matched:", result.message);
          return res.sendStatus(400);
        }
      }

      return res.sendStatus(200);
    } catch (error) {
      console.error("Webhook processing failed:", error.message);
      return res.sendStatus(500);
    }
  }
);

app.use("/api", apiLimiter);

app.use(express.json({ limit: "32kb" }));

app.post("/api/rider/profile", requireCustomer, async (req, res) => {
  if (!supabase) {
    return res.status(500).json({ error: "Rider service configuration is incomplete." });
  }

  const requestedName = req.body?.fullName;
  const fullName = String(
    requestedName || req.customer.user_metadata?.full_name || "HOKADA Rider"
  ).trim().slice(0, 150);

  try {
    const { data: existing, error: readError } = await supabase
      .from("rider_profiles")
      .select("id, full_name, approval_status, is_online, rating")
      .eq("id", req.customer.id)
      .maybeSingle();

    if (readError) throw readError;
    if (existing) return res.json({ profile: existing });

    const { data: profile, error: insertError } = await supabase
      .from("rider_profiles")
      .insert({
        id: req.customer.id,
        full_name: fullName || "HOKADA Rider",
        approval_status: "pending",
        rating: 5,
        total_deliveries: 0,
        total_earnings: 0,
        is_online: false,
      })
      .select("id, full_name, approval_status, is_online, rating")
      .single();

    if (insertError) throw insertError;
    return res.status(201).json({ profile });
  } catch (error) {
    console.error("Could not ensure rider profile:", error.message);
    return res.status(500).json({ error: "Could not prepare the rider profile." });
  }
});


// Server-owned delivery pricing. Keep these estimates aligned with the
// current customer-facing pricing rules in src/App.jsx.
async function calculateServerDeliveryFee(
  pickupLat,
  pickupLng,
  dropoffLat,
  dropoffLng,
  packageType,
  deliveryType
) {
  const coordinates =
    `${pickupLng},${pickupLat};${dropoffLng},${dropoffLat}`;

  const routingUrl =
    `https://router.project-osrm.org/route/v1/driving/${coordinates}` +
    "?overview=false&alternatives=false&steps=false";

  const response = await fetch(routingUrl, {
    headers: { Accept: "application/json" },
    signal: AbortSignal.timeout(15000),
  });

  if (!response.ok) {
    throw new Error("Road routing service is unavailable.");
  }

  const result = await response.json();
  const route = result.routes?.[0];

  if (
    result.code !== "Ok" ||
    !route ||
    !Number.isFinite(route.distance) ||
    route.distance <= 0 ||
    !Number.isFinite(route.duration)
  ) {
    throw new Error("Could not calculate a road route for these addresses.");
  }

  const distanceKm = route.distance / 1000;
  const durationMinutes = Math.ceil(route.duration / 60);
  const packageFees = { Small: 0, Medium: 300, Large: 700 };

  const baseFee = 800;
  const distanceFee = Math.round(distanceKm * 150);
  const packageFee = packageFees[packageType];
  const expressFee = deliveryType === "Express" ? 500 : 0;

  return {
    distanceKm: Math.round(distanceKm * 10) / 10,
    durationMinutes,
    baseFee,
    distanceFee,
    packageFee,
    expressFee,
    total: baseFee + distanceFee + packageFee + expressFee,
  };
}

const RIDER_ACTIVE_STATUSES = [
  "accepted",
  "in_transit",
  "arrived",
  "collected",
  "going_to_dropoff",
  "arrived_at_dropoff",
];
const RIDER_AVAILABLE_STATUSES = ["searching", "pending"];
const CHAT_ENABLED_STATUSES = ["arrived", "collected", "arrived_at_dropoff"];
const DELIVERY_SELECT =
  "id, customer_id, customer_name, rider_id, rider_name, pickup_address, dropoff_address, recipient_name, recipient_phone, package_type, delivery_type, notes, status, payment_status, delivery_fee, rider_earnings, created_at, updated_at";

function isUuid(value) {
  return typeof value === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function normalizeChatMessage(value) {
  if (typeof value !== "string") return null;
  const message = value.trim();
  return message.length > 0 && message.length <= 1000 ? message : null;
}

app.get("/api/rider/deliveries", requireRider, async (req, res) => {
  try {
    if (req.riderProfile.approval_status !== "approved") {
      return res.status(403).json({ error: "Your rider account is awaiting approval." });
    }

    const { data: assignedRows, error: assignedError } = await supabase
      .from("deliveries")
      .select(DELIVERY_SELECT)
      .eq("rider_id", req.rider.id)
      .in("status", RIDER_ACTIVE_STATUSES)
      .order("updated_at", { ascending: false })
      .limit(1);

    if (assignedError) throw assignedError;
    const activeDelivery = assignedRows?.[0] || null;

    if (activeDelivery || !req.riderProfile.is_online) {
      return res.json({ activeDelivery, availableDelivery: null });
    }

    const { data: declinedRows, error: declinedError } = await supabase
      .from("rider_declined_deliveries")
      .select("delivery_id")
      .eq("rider_id", req.rider.id);

    if (declinedError) throw declinedError;

    const declinedIds = new Set((declinedRows || []).map((row) => row.delivery_id));
    const { data: availableRows, error: availableError } = await supabase
      .from("deliveries")
      .select(DELIVERY_SELECT)
      .is("rider_id", null)
      .in("status", RIDER_AVAILABLE_STATUSES)
      .order("created_at", { ascending: false })
      .limit(50);

    if (availableError) throw availableError;
    const availableDelivery = (availableRows || []).find(
      (delivery) => !declinedIds.has(delivery.id)
    ) || null;

    return res.json({
      activeDelivery: null,
      availableDelivery,
    });
  } catch (error) {
    console.error("Could not load rider deliveries:", error.message);
    return res.status(500).json({ error: "Could not load rider deliveries." });
  }
});

app.get("/api/rider/profile", requireRider, (req, res) => {
  res.json({ profile: req.riderProfile });
});

app.get("/api/rider/history", requireRider, async (req, res) => {
  try {
    const { data, error } = await supabase
      .from("deliveries")
      .select("id, pickup_address, dropoff_address, rider_earnings, updated_at, status")
      .eq("rider_id", req.rider.id)
      .eq("status", "delivered")
      .order("updated_at", { ascending: false })
      .limit(20);

    if (error) throw error;
    return res.json({ deliveries: data || [] });
  } catch (error) {
    console.error("Could not load rider history:", error.message);
    return res.status(500).json({ error: "Could not load delivery history." });
  }
});

app.get("/api/rider/today-stats", requireRider, async (req, res) => {
  const start = req.query.start;
  const startDate = typeof start === "string" ? new Date(start) : null;
  if (!startDate || !Number.isFinite(startDate.getTime())) {
    return res.status(400).json({ error: "A valid start of day is required." });
  }

  try {
    const { data, error } = await supabase
      .from("deliveries")
      .select("rider_earnings")
      .eq("rider_id", req.rider.id)
      .eq("status", "delivered")
      .gte("updated_at", startDate.toISOString());

    if (error) throw error;
    const deliveries = data || [];
    const earnings = deliveries.reduce(
      (total, delivery) => total + Number(delivery.rider_earnings || 0),
      0
    );

    return res.json({ deliveries: deliveries.length, earnings });
  } catch (error) {
    console.error("Could not load rider stats:", error.message);
    return res.status(500).json({ error: "Could not load today's rider stats." });
  }
});

app.get("/api/rider/deliveries/:deliveryId/messages", chatLimiter, requireRider, async (req, res) => {
  if (!isUuid(req.params.deliveryId)) {
    return res.status(400).json({ error: "Invalid delivery ID." });
  }

  try {
    const { data: delivery, error: deliveryError } = await supabase
      .from("deliveries")
      .select("id, status")
      .eq("id", req.params.deliveryId)
      .eq("rider_id", req.rider.id)
      .maybeSingle();

    if (deliveryError) throw deliveryError;
    if (!delivery || !CHAT_ENABLED_STATUSES.includes(delivery.status)) {
      return res.status(403).json({ error: "Chat is unavailable for this delivery." });
    }

    const { data: messages, error } = await supabase
      .from("delivery_messages")
      .select("id, delivery_id, sender_id, sender_type, message, created_at")
      .eq("delivery_id", delivery.id)
      .order("created_at", { ascending: false })
      .limit(100);

    if (error) throw error;
    return res.json({ messages: (messages || []).reverse() });
  } catch (error) {
    console.error("Could not load rider chat:", error.message);
    return res.status(500).json({ error: "Could not load chat messages." });
  }
});

app.post("/api/rider/deliveries/:deliveryId/messages", chatLimiter, requireRider, async (req, res) => {
  const message = normalizeChatMessage(req.body?.message);
  if (!message) {
    return res.status(400).json({ error: "Messages must be between 1 and 1,000 characters." });
  }
  if (!isUuid(req.params.deliveryId)) {
    return res.status(400).json({ error: "Invalid delivery ID." });
  }

  try {
    const { data: delivery, error: deliveryError } = await supabase
      .from("deliveries")
      .select("id, status")
      .eq("id", req.params.deliveryId)
      .eq("rider_id", req.rider.id)
      .maybeSingle();

    if (deliveryError) throw deliveryError;
    if (!delivery || !CHAT_ENABLED_STATUSES.includes(delivery.status)) {
      return res.status(403).json({ error: "Chat is unavailable for this delivery." });
    }

    const { data, error } = await supabase
      .from("delivery_messages")
      .insert({
        delivery_id: delivery.id,
        sender_id: req.rider.id,
        sender_type: "rider",
        message,
      })
      .select("id, delivery_id, sender_id, sender_type, message, created_at")
      .single();

    if (error) throw error;
    return res.status(201).json({ message: data });
  } catch (error) {
    console.error("Could not send rider chat message:", error.message);
    return res.status(500).json({ error: "Could not send your message." });
  }
});

app.post("/api/rider/online-status", requireRider, async (req, res) => {
  const { isOnline } = req.body ?? {};
  if (typeof isOnline !== "boolean") {
    return res.status(400).json({ error: "Online status must be true or false." });
  }

  if (isOnline && req.riderProfile.approval_status !== "approved") {
    return res.status(403).json({ error: "Your rider account must be approved before going online." });
  }

  try {
    let update = supabase
      .from("rider_profiles")
      .update({ is_online: isOnline, updated_at: new Date().toISOString() })
      .eq("id", req.rider.id);

    if (isOnline) update = update.eq("approval_status", "approved");

    const { data, error } = await update
      .select("id, is_online, approval_status")
      .maybeSingle();

    if (error) throw error;
    if (!data) {
      return res.status(409).json({ error: "Rider approval changed. Refresh and try again." });
    }

    return res.json({ isOnline: data.is_online });
  } catch (error) {
    console.error("Could not update rider online status:", error.message);
    return res.status(500).json({ error: "Could not update your online status." });
  }
});

app.post("/api/rider/deliveries/:deliveryId/accept", requireRider, async (req, res) => {
  if (req.riderProfile.approval_status !== "approved") {
    return res.status(403).json({ error: "Your rider account must be approved before accepting deliveries." });
  }
  if (!req.riderProfile.is_online) {
    return res.status(409).json({ error: "Go online before accepting a delivery." });
  }
  if (!isUuid(req.params.deliveryId)) {
    return res.status(400).json({ error: "Invalid delivery ID." });
  }

  try {
    const riderName = String(
      req.riderProfile.full_name || req.rider.user_metadata?.full_name || "HOKADA Rider"
    ).trim().slice(0, 150);
    const { data, error } = await supabase
      .from("deliveries")
      .update({
        rider_id: req.rider.id,
        rider_name: riderName,
        status: "accepted",
        updated_at: new Date().toISOString(),
      })
      .eq("id", req.params.deliveryId)
      .is("rider_id", null)
      .in("status", RIDER_AVAILABLE_STATUSES)
      .select(DELIVERY_SELECT)
      .maybeSingle();

    if (error) throw error;
    if (!data) {
      return res.status(409).json({ error: "This delivery is no longer available." });
    }

    return res.json({ delivery: data });
  } catch (error) {
    console.error("Could not accept delivery:", error.message);
    return res.status(500).json({ error: "Could not accept this delivery." });
  }
});

app.post("/api/rider/deliveries/:deliveryId/status", requireRider, async (req, res) => {
  if (req.riderProfile.approval_status !== "approved") {
    return res.status(403).json({ error: "Your rider account is not approved." });
  }
  if (!isUuid(req.params.deliveryId)) {
    return res.status(400).json({ error: "Invalid delivery ID." });
  }

  const nextStatus = req.body?.status;
  const previousStatusByNext = {
    in_transit: "accepted",
    arrived: "in_transit",
    collected: "arrived",
    going_to_dropoff: "collected",
    arrived_at_dropoff: "going_to_dropoff",
    delivered: "arrived_at_dropoff",
  };
  const expectedStatus = previousStatusByNext[nextStatus];
  if (!expectedStatus) {
    return res.status(400).json({ error: "Invalid delivery status transition." });
  }

  try {
    const { data: current, error: readError } = await supabase
      .from("deliveries")
      .select("id, rider_id, status, payment_status")
      .eq("id", req.params.deliveryId)
      .eq("rider_id", req.rider.id)
      .maybeSingle();

    if (readError) throw readError;
    if (!current) return res.status(404).json({ error: "Assigned delivery not found." });
    if (current.status !== expectedStatus) {
      return res.status(409).json({ error: "The delivery has changed. Refresh and try again." });
    }
    if (nextStatus === "delivered" && current.payment_status !== "paid") {
      return res.status(409).json({ error: "Payment must be confirmed before completing this delivery." });
    }

    let update = supabase
      .from("deliveries")
      .update({ status: nextStatus, updated_at: new Date().toISOString() })
      .eq("id", current.id)
      .eq("rider_id", req.rider.id)
      .eq("status", expectedStatus);

    if (nextStatus === "delivered") update = update.eq("payment_status", "paid");

    const { data, error } = await update
      .select(DELIVERY_SELECT)
      .maybeSingle();

    if (error) throw error;
    if (!data) return res.status(409).json({ error: "The delivery changed while updating. Refresh and try again." });

    return res.json({ delivery: data });
  } catch (error) {
    console.error("Could not update delivery status:", error.message);
    return res.status(500).json({ error: "Could not update delivery status." });
  }
});

app.post("/api/rider/deliveries/:deliveryId/decline", requireRider, async (req, res) => {
  if (req.riderProfile.approval_status !== "approved") {
    return res.status(403).json({ error: "Your rider account is not approved." });
  }
  if (!isUuid(req.params.deliveryId)) {
    return res.status(400).json({ error: "Invalid delivery ID." });
  }

  try {
    const { data: delivery, error: readError } = await supabase
      .from("deliveries")
      .select("id, rider_id, status")
      .eq("id", req.params.deliveryId)
      .maybeSingle();

    if (readError) throw readError;
    if (!delivery || delivery.rider_id || !RIDER_AVAILABLE_STATUSES.includes(delivery.status)) {
      return res.status(409).json({ error: "This delivery is no longer available." });
    }

    const { error } = await supabase
      .from("rider_declined_deliveries")
      .upsert(
        { rider_id: req.rider.id, delivery_id: delivery.id },
        { onConflict: "rider_id,delivery_id", ignoreDuplicates: true }
      );

    if (error) throw error;
    return res.json({ success: true });
  } catch (error) {
    console.error("Could not decline delivery:", error.message);
    return res.status(500).json({ error: "Could not decline this delivery." });
  }
});

app.post("/api/rider/deliveries/:deliveryId/location", riderLocationLimiter, requireRider, async (req, res) => {
  if (req.riderProfile.approval_status !== "approved") {
    return res.status(403).json({ error: "Your rider account is not approved." });
  }
  if (!isUuid(req.params.deliveryId)) {
    return res.status(400).json({ error: "Invalid delivery ID." });
  }

  const { latitude, longitude, heading, speed, accuracy } = req.body ?? {};
  if (
    !Number.isFinite(latitude) || latitude < -90 || latitude > 90 ||
    !Number.isFinite(longitude) || longitude < -180 || longitude > 180 ||
    (heading !== null && heading !== undefined && !Number.isFinite(heading)) ||
    (speed !== null && speed !== undefined && !Number.isFinite(speed)) ||
    (accuracy !== null && accuracy !== undefined && !Number.isFinite(accuracy))
  ) {
    return res.status(400).json({ error: "Invalid rider location." });
  }

  try {
    const { data: delivery, error: readError } = await supabase
      .from("deliveries")
      .select("id, rider_id, status")
      .eq("id", req.params.deliveryId)
      .eq("rider_id", req.rider.id)
      .in("status", RIDER_ACTIVE_STATUSES)
      .maybeSingle();

    if (readError) throw readError;
    if (!delivery) return res.status(403).json({ error: "This rider is not assigned to an active delivery." });

    const { error } = await supabase.from("delivery_live_locations").upsert(
      {
        delivery_id: delivery.id,
        rider_id: req.rider.id,
        latitude,
        longitude,
        heading: heading ?? null,
        speed: speed ?? null,
        accuracy: accuracy ?? null,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "delivery_id" }
    );

    if (error) throw error;
    return res.json({ success: true });
  } catch (error) {
    console.error("Could not save rider location:", error.message);
    return res.status(500).json({ error: "Could not save rider location." });
  }
});

// Calculate a customer-facing quote without creating a delivery.
app.post("/api/delivery-quote", quoteLimiter, requireCustomer, async (req, res) => {
  try {
    const body = req.body ?? {};
    const {
      pickup_lat,
      pickup_lng,
      dropoff_lat,
      dropoff_lng,
      package_type,
      delivery_type,
    } = body;

    const validCoordinate = (value, min, max) =>
      typeof value === "number" &&
      Number.isFinite(value) &&
      value >= min &&
      value <= max;

    if (
      !validCoordinate(pickup_lat, -90, 90) ||
      !validCoordinate(dropoff_lat, -90, 90) ||
      !validCoordinate(pickup_lng, -180, 180) ||
      !validCoordinate(dropoff_lng, -180, 180)
    ) {
      return res.status(400).json({
        error: "Select valid pickup and drop-off addresses before requesting a quote.",
      });
    }

    if (
      !["Small", "Medium", "Large"].includes(package_type) ||
      !["Standard", "Express"].includes(delivery_type)
    ) {
      return res.status(400).json({
        error: "Select a valid package size and delivery speed.",
      });
    }

    const pricing = await calculateServerDeliveryFee(
      pickup_lat,
      pickup_lng,
      dropoff_lat,
      dropoff_lng,
      package_type,
      delivery_type
    );

    return res.json({ pricing });
  } catch (error) {
    console.error("Delivery quote failed:", error.message);

    return res.status(503).json({
      error: "We could not calculate the road route right now. Please try again.",
    });
  }
});

// Create deliveries through the authenticated backend instead of allowing
// the browser to choose the saved price, payment state, rider, or earnings.
app.post("/api/deliveries", deliveryLimiter, requireCustomer, async (req, res) => {
  try {
    if (!supabase) {
      return res.status(500).json({
        error: "Delivery service configuration is incomplete.",
      });
    }

    const body = req.body ?? {};
    const {
      pickup_address,
      dropoff_address,
      pickup_lat,
      pickup_lng,
      dropoff_lat,
      dropoff_lng,
      recipient_name,
      recipient_phone,
      package_type,
      delivery_type,
      notes,
    } = body;

    const isText = (value, maxLength) =>
      typeof value === "string" &&
      value.trim().length > 0 &&
      value.trim().length <= maxLength;

    const normalizeNigerianPhone = (value) => {
      const digits = String(value ?? "").replace(/\D/g, "");
      const local = digits.startsWith("234")
        ? `0${digits.slice(3)}`
        : digits;

      return /^0[789]\d{9}$/.test(local) ? local : null;
    };

    if (
      !isText(pickup_address, 500) ||
      !isText(dropoff_address, 500) ||
      !isText(recipient_name, 150) ||
      !isText(recipient_phone, 50)
    ) {
      return res.status(400).json({
        error: "Enter valid pickup, drop-off, recipient name, and phone details.",
      });
    }

    const normalizedPhone = normalizeNigerianPhone(recipient_phone);

    if (!normalizedPhone) {
      return res.status(400).json({
        error: "Enter a valid Nigerian phone number, such as 08012345678.",
      });
    }

    const coordinates = [
      pickup_lat,
      pickup_lng,
      dropoff_lat,
      dropoff_lng,
    ];

    if (
      !coordinates.every(
        (value) => typeof value === "number" && Number.isFinite(value)
      ) ||
      Math.abs(pickup_lat) > 90 ||
      Math.abs(dropoff_lat) > 90 ||
      Math.abs(pickup_lng) > 180 ||
      Math.abs(dropoff_lng) > 180
    ) {
      return res.status(400).json({
        error: "The pickup or drop-off location is invalid. Please try again.",
      });
    }

    if (!["Small", "Medium", "Large"].includes(package_type)) {
      return res.status(400).json({
        error: "Choose a valid package size.",
      });
    }

    if (!["Standard", "Express"].includes(delivery_type)) {
      return res.status(400).json({
        error: "Choose a valid delivery type.",
      });
    }

    if (
      notes !== null &&
      notes !== undefined &&
      (typeof notes !== "string" || notes.length > 2000)
    ) {
      return res.status(400).json({
        error: "Delivery notes must be 2,000 characters or fewer.",
      });
    }

    const routePricing = await calculateServerDeliveryFee(
      pickup_lat,
      pickup_lng,
      dropoff_lat,
      dropoff_lng,
      package_type,
      delivery_type
    );

    const deliveryFee = routePricing.total;

    const payload = {
      customer_id: req.customer.id,
      customer_name:
        req.customer.user_metadata?.full_name || "HOKADA Customer",

      pickup_address: pickup_address.trim(),
      dropoff_address: dropoff_address.trim(),
      pickup_lat,
      pickup_lng,
      dropoff_lat,
      dropoff_lng,

      recipient_name: recipient_name.trim(),
      recipient_phone: normalizedPhone,

      package_type,
      package_description: `${package_type} package`,
      delivery_type,
      notes: typeof notes === "string" && notes.trim() ? notes.trim() : null,

      // Never accept the delivery fee from the browser.
      delivery_fee: deliveryFee,

      // Initial state is controlled by the server.
      rider_earnings: 0,
      status: "searching",
      payment_status: "unpaid",
      payment_provider: null,
      payment_reference: null,
      payment_amount_kobo: null,
      paid_at: null,
    };

    const { data: delivery, error } = await supabase
      .from("deliveries")
      .insert(payload)
      .select("*")
      .single();

    if (error) throw error;

    return res.status(201).json({
      delivery,
      route: {
        distanceKm: routePricing.distanceKm,
        durationMinutes: routePricing.durationMinutes,
      },
    });
  } catch (error) {
    console.error("Delivery creation failed:", error.message);
    return res.status(500).json({
      error: "Could not create your delivery. Please try again.",
    });
  }
});

app.post("/api/deliveries/:deliveryId/cancel", requireCustomer, async (req, res) => {
  if (!supabase) {
    return res.status(500).json({ error: "Delivery service configuration is incomplete." });
  }
  if (!isUuid(req.params.deliveryId)) {
    return res.status(400).json({ error: "Invalid delivery ID." });
  }

  try {
    const { data, error } = await supabase
      .from("deliveries")
      .update({ status: "cancelled", updated_at: new Date().toISOString() })
      .eq("id", req.params.deliveryId)
      .eq("customer_id", req.customer.id)
      .eq("payment_status", "unpaid")
      .in("status", [
        "searching",
        "pending",
        "accepted",
        "in_transit",
        "arrived",
        "collected",
        "going_to_dropoff",
        "arrived_at_dropoff",
      ])
      .select("id, status")
      .maybeSingle();

    if (error) throw error;
    if (!data) {
      return res.status(409).json({
        error: "Cancellation is unavailable because payment or delivery status has changed.",
      });
    }
    return res.json({ delivery: data });
  } catch (error) {
    console.error("Could not cancel delivery:", error.message);
    return res.status(500).json({ error: "Could not cancel this delivery." });
  }
});

app.get("/api/deliveries/:deliveryId/messages", chatLimiter, requireCustomer, async (req, res) => {
  if (!isUuid(req.params.deliveryId)) {
    return res.status(400).json({ error: "Invalid delivery ID." });
  }

  try {
    const { data: delivery, error: deliveryError } = await supabase
      .from("deliveries")
      .select("id, status")
      .eq("id", req.params.deliveryId)
      .eq("customer_id", req.customer.id)
      .maybeSingle();

    if (deliveryError) throw deliveryError;
    if (!delivery || !CHAT_ENABLED_STATUSES.includes(delivery.status)) {
      return res.status(403).json({ error: "Chat is unavailable for this delivery." });
    }

    const { data: messages, error } = await supabase
      .from("delivery_messages")
      .select("id, delivery_id, sender_id, sender_type, message, created_at")
      .eq("delivery_id", delivery.id)
      .order("created_at", { ascending: false })
      .limit(100);

    if (error) throw error;
    return res.json({ messages: (messages || []).reverse() });
  } catch (error) {
    console.error("Could not load customer chat:", error.message);
    return res.status(500).json({ error: "Could not load chat messages." });
  }
});

app.post("/api/deliveries/:deliveryId/messages", chatLimiter, requireCustomer, async (req, res) => {
  const message = normalizeChatMessage(req.body?.message);
  if (!message) {
    return res.status(400).json({ error: "Messages must be between 1 and 1,000 characters." });
  }
  if (!isUuid(req.params.deliveryId)) {
    return res.status(400).json({ error: "Invalid delivery ID." });
  }

  try {
    const { data: delivery, error: deliveryError } = await supabase
      .from("deliveries")
      .select("id, status")
      .eq("id", req.params.deliveryId)
      .eq("customer_id", req.customer.id)
      .maybeSingle();

    if (deliveryError) throw deliveryError;
    if (!delivery || !CHAT_ENABLED_STATUSES.includes(delivery.status)) {
      return res.status(403).json({ error: "Chat is unavailable for this delivery." });
    }

    const { data, error } = await supabase
      .from("delivery_messages")
      .insert({
        delivery_id: delivery.id,
        sender_id: req.customer.id,
        sender_type: "customer",
        message,
      })
      .select("id, delivery_id, sender_id, sender_type, message, created_at")
      .single();

    if (error) throw error;
    return res.status(201).json({ message: data });
  } catch (error) {
    console.error("Could not send customer chat message:", error.message);
    return res.status(500).json({ error: "Could not send your message." });
  }
});

// Initialize payment for the authenticated owner of the delivery.
app.post(
  "/api/payments/initialize",
  paymentLimiter,
  requireConfiguration,
  requireCustomer,
  async (req, res) => {
    try {
      const { deliveryId } = req.body ?? {};

      if (typeof deliveryId !== "string" || !deliveryId.trim()) {
        return res.status(400).json({
          error: "A delivery ID is required.",
        });
      }

      // Use the email verified by the Supabase session, not browser input.
      if (!req.customer.email) {
        return res.status(400).json({
          error: "Your account needs a valid email address.",
        });
      }

      const delivery = await getDelivery(deliveryId);

      if (!delivery) {
        return res.status(404).json({
          error: "Delivery not found.",
        });
      }

      if (delivery.customer_id !== req.customer.id) {
        return res.status(403).json({
          error: "You are not authorized to pay for this delivery.",
        });
      }

      if (!["arrived_at_dropoff", "delivered"].includes(delivery.status)) {
        return res.status(409).json({
          error:
            "Payment becomes available when your rider reaches the drop-off location.",
        });
      }

      if (delivery.payment_status === "paid") {
        return res.status(409).json({
          error: "This delivery has already been paid for.",
        });
      }

      // Recover a stale reservation only when Paystack explicitly
      // confirms that its reference does not exist.
      if (delivery.payment_status === "pending") {
        if (
          delivery.payment_provider !== "paystack" ||
          !delivery.payment_reference ||
          delivery.paid_at
        ) {
          return res.status(409).json({
            error: "This payment needs verification before retrying.",
          });
        }

        const oldReference = delivery.payment_reference;
        const oldAmount = delivery.payment_amount_kobo;
        const referenceStatus =
          await inspectPaystackReference(oldReference);

        if (referenceStatus === "success") {
          // A successful transaction must be verified against the delivery,
          // amount, currency, reference, and metadata before retry is blocked.
          const verification = await verifyAndRecordPayment(oldReference);

          if (verification.verified) {
            return res.status(409).json({
              error:
                "This delivery has already been paid for. Refresh your delivery history to see the confirmed payment.",
            });
          }

          return res.status(409).json({
            error:
              "Paystack reports a successful transaction, but it could not be safely matched to this delivery. Do not pay again; contact support to check the payment.",
          });
        }

        if (!["missing", "abandoned", "failed"].includes(referenceStatus)) {
          return res.status(409).json({
            error:
              "Your previous payment may still be processing. HOKADA has kept it protected from duplicate charges. Please retry verification or check again shortly.",
          });
        }

        const { data: released, error: releaseError } = await supabase
          .from("deliveries")
          .update({
            payment_status: "unpaid",
            payment_provider: null,
            payment_reference: null,
            payment_amount_kobo: null,
          })
          .eq("id", delivery.id)
          .eq("customer_id", req.customer.id)
          .eq("payment_status", "pending")
          .eq("payment_provider", "paystack")
          .eq("payment_reference", oldReference)
          .eq("payment_amount_kobo", oldAmount)
          .is("paid_at", null)
          .select("id")
          .maybeSingle();

        if (releaseError) throw releaseError;

        if (!released) {
          return res.status(409).json({
            error:
              "The payment changed while being checked. Refresh your delivery and try again.",
          });
        }

        // Continue through the normal flow below to create a fresh
        // reference and initialize a new Paystack checkout.
        delivery.payment_status = "unpaid";
      }

      if (delivery.payment_status !== "unpaid") {
        return res.status(409).json({
          error: "This delivery cannot be paid in its current state.",
        });
      }

      const amountNaira = Number(delivery.delivery_fee);
      const amountKobo = Math.round(amountNaira * 100);

      if (
        !Number.isFinite(amountNaira) ||
        !Number.isSafeInteger(amountKobo) ||
        amountKobo < 100
      ) {
        return res.status(400).json({
          error: "The saved delivery fee is invalid.",
        });
      }

      const reference = `hokada_${crypto.randomUUID()}`;

      // Reserve the delivery only if it is still unpaid and owned by this user.
      const { data: saved, error: saveError } = await supabase
        .from("deliveries")
        .update({
          payment_status: "pending",
          payment_provider: "paystack",
          payment_reference: reference,
          payment_amount_kobo: amountKobo,
        })
        .eq("id", delivery.id)
        .eq("customer_id", req.customer.id)
        .eq("payment_status", "unpaid")
        .in("status", ["arrived_at_dropoff", "delivered"])
        .select("id")
        .maybeSingle();

      if (saveError) throw saveError;

      if (!saved) {
        return res.status(409).json({
          error:
            "Payment or delivery status changed. Refresh and try again.",
        });
      }

      const callbackOrigin = allowedOrigins[0];

      const transaction = await paystackRequest("/transaction/initialize", {
        email: req.customer.email,
        amount: amountKobo,
        currency: "NGN",
        reference,
        metadata: {
          delivery_id: String(delivery.id),
        },
        callback_url:
          process.env.PAYSTACK_CALLBACK_URL ||
          `${callbackOrigin}/hokada/payment-callback`,
      });

      return res.json({
        authorizationUrl: transaction.authorization_url,
        reference: transaction.reference,
      });
    } catch (error) {
      console.error("Payment initialization failed:", error.message);

      // Keep a pending reference if the Paystack response is uncertain.
      // Clearing it could orphan a transaction that Paystack initialized.
      return res.status(500).json({
        error: "Could not start payment. Please try again.",
      });
    }
  }
);

// Verify only references belonging to the authenticated customer.
app.get(
  "/api/payments/verify/:reference",
  verificationLimiter,
  requireConfiguration,
  requireCustomer,
  async (req, res) => {
    try {
      const reference = req.params.reference;

      if (
        typeof reference !== "string" ||
        !/^hokada_[0-9a-f-]{36}$/i.test(reference)
      ) {
        return res.status(400).json({
          error: "Invalid payment reference.",
        });
      }

      const { data: ownedDelivery, error: ownershipError } = await supabase
        .from("deliveries")
        .select("id")
        .eq("payment_reference", reference)
        .eq("customer_id", req.customer.id)
        .maybeSingle();

      if (ownershipError) throw ownershipError;

      if (!ownedDelivery) {
        return res.status(404).json({
          error: "Payment not found for your account.",
        });
      }

      const result = await verifyAndRecordPayment(reference);

      if (!result.verified) {
        const pending = result.status === "pending";

        return res.status(pending ? 202 : 400).json({
          success: false,
          status: result.status || "unverified",
          error: result.message,
        });
      }

      // This response shape matches the current React callback.
      return res.json({
        success: true,
        deliveryId: result.delivery.id,
      });
    } catch (error) {
      console.error("Payment verification failed:", error.message);

      return res.status(500).json({
        error: "Could not verify payment. Please try again.",
      });
    }
  }
);

app.listen(PORT, () => {
  console.log(`HOKADA payment API listening on port ${PORT}`);
});
