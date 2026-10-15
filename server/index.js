import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import crypto from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import WebSocket from "ws";

dotenv.config();

const app = express();
const PORT = process.env.PORT || 4242;
const PAYSTACK_SECRET_KEY = (process.env.PAYSTACK_SECRET_KEY || "").trim();
console.log(
  "Paystack key diagnostic:",
  JSON.stringify({
    configured: Boolean(PAYSTACK_SECRET_KEY),
    length: PAYSTACK_SECRET_KEY?.length ?? 0,
    fingerprint: PAYSTACK_SECRET_KEY
      ? crypto
          .createHash("sha256")
          .update(PAYSTACK_SECRET_KEY)
          .digest("hex")
          .slice(0, 12)
      : "missing",
  })
);
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

app.use(cors({ origin: allowedOrigins }));

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
    service: "HOKADA payments",
    supabaseUrlConfigured: Boolean(SUPABASE_URL),
    serviceRoleKeyConfigured: Boolean(SUPABASE_SERVICE_ROLE_KEY),
    publishableKeyConfigured: Boolean(SUPABASE_PUBLISHABLE_KEY),
    supabaseConfigured: Boolean(supabase && authClient),
    paystackConfigured: Boolean(PAYSTACK_SECRET_KEY),
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
  });

  const result = await response.json();

  if (!response.ok || !result.status) {
    throw new Error(result.message || "Paystack request failed.");
  }

  return result.data;
}

// Return true only for Paystack's explicit "reference not found" response.
// Network errors, authentication errors, and ambiguous responses throw.
async function paystackReferenceDefinitelyMissing(reference) {
  const response = await fetch(
    `https://api.paystack.co/transaction/verify/${encodeURIComponent(reference)}`,
    {
      method: "GET",
      headers: {
        Authorization: `Bearer ${PAYSTACK_SECRET_KEY}`,
      },
    }
  );

  let result;
  try {
    result = await response.json();
  } catch {
    throw new Error("Could not safely verify the existing Paystack reference.");
  }

  if (
    response.status === 404 &&
    result.status === false &&
    /transaction reference not found/i.test(result.message || "")
  ) {
    return true;
  }

  if (response.ok && result.status === true && result.data) {
    return false;
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
      "id, customer_id, delivery_fee, payment_status, payment_provider, payment_reference, payment_amount_kobo, paid_at"
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

  if (!valid) {
    return {
      verified: false,
      message:
        "Payment could not be matched to the expected delivery and amount.",
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

app.use(express.json({ limit: "32kb" }));

// Initialize payment for the authenticated owner of the delivery.
app.post(
  "/api/payments/initialize",
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

        const referenceMissing =
          await paystackReferenceDefinitelyMissing(
            delivery.payment_reference
          );

        if (!referenceMissing) {
          return res.status(409).json({
            error:
              "A payment is already pending for this delivery. Check your delivery history or contact support before retrying.",
          });
        }

        const oldReference = delivery.payment_reference;
        const oldAmount = delivery.payment_amount_kobo;

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
        .select("id")
        .maybeSingle();

      if (saveError) throw saveError;

      if (!saved) {
        return res.status(409).json({
          error:
            "Could not reserve payment for this delivery. Refresh and try again.",
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
        return res.status(400).json({
          success: false,
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
