import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import crypto from "node:crypto";
import { createClient } from "@supabase/supabase-js";

dotenv.config();

const app = express();
const PORT = process.env.PORT || 4242;

const PAYSTACK_SECRET_KEY = process.env.PAYSTACK_SECRET_KEY;
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const CLIENT_ORIGIN = (process.env.CLIENT_ORIGIN || "http://localhost:5173")
  .split(",")[0]
  .trim()
  .replace(/\/+$/, "");

const PAYSTACK_CALLBACK_URL =
  process.env.PAYSTACK_CALLBACK_URL || `${CLIENT_ORIGIN}/?payment=return`;

const supabase =
  SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY
    ? createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
        auth: {
          autoRefreshToken: false,
          persistSession: false,
        },
      })
    : null;

app.use(
  cors({
    origin: (process.env.CLIENT_ORIGIN || "http://localhost:5173")
      .split(",")
      .map((url) => url.trim().replace(/\/+$/, "")),
  })
);

// IMPORTANT: Webhooks need the raw request body for signature verification.
// Register this route BEFORE express.json().
app.post(
  "/api/payments/webhook",
  express.raw({ type: "application/json" }),
  async (req, res) => {
    try {
      if (!PAYSTACK_SECRET_KEY) {
        return res.sendStatus(500);
      }

      const signature = req.headers["x-paystack-signature"];

      if (typeof signature !== "string" || !Buffer.isBuffer(req.body)) {
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

      const event = JSON.parse(req.body.toString("utf8"));

      if (event.event !== "charge.success") {
        return res.sendStatus(200);
      }

      const reference = event.data?.reference;

      if (!reference) {
        return res.sendStatus(200);
      }

      const verification = await verifyWithPaystack(reference);

      if (!verification.ok || !verification.payment) {
        console.error("Webhook transaction verification failed:", reference);
        return res.sendStatus(200);
      }

      const payment = verification.payment;
      const deliveryId = payment.metadata?.delivery_id;

      if (
        payment.status !== "success" ||
        payment.currency !== "NGN" ||
        !deliveryId ||
        !Number.isSafeInteger(payment.amount)
      ) {
        return res.sendStatus(200);
      }

      const { data: delivery, error: deliveryError } = await supabase
        .from("deliveries")
        .select(
          "id,customer_id,delivery_fee,payment_status,payment_reference,payment_amount_kobo"
        )
        .eq("id", deliveryId)
        .maybeSingle();

      if (deliveryError || !delivery) {
        console.error("Webhook delivery not found:", deliveryError?.message);
        return res.sendStatus(200);
      }

      const expectedAmount = Math.round(Number(delivery.delivery_fee) * 100);

      if (
        payment.amount !== expectedAmount ||
        payment.reference !== delivery.payment_reference ||
        payment.amount !== Number(delivery.payment_amount_kobo)
      ) {
        console.error(
          "Webhook payment details do not match delivery:",
          deliveryId
        );
        return res.sendStatus(200);
      }

      await markDeliveryPaid(delivery, payment);

      return res.sendStatus(200);
    } catch (error) {
      console.error("Paystack webhook error:", error.message);
      return res.sendStatus(500);
    }
  }
);

app.use(express.json());

function requirePaystackKey(req, res, next) {
  if (!PAYSTACK_SECRET_KEY) {
    return res.status(500).json({
      error: "Payment provider is not configured.",
    });
  }

  next();
}

function requireSupabase(res) {
  if (!supabase) {
    res.status(500).json({
      error: "Supabase is not configured on the payment server.",
    });
    return false;
  }

  return true;
}

async function getAuthenticatedCustomer(req, res) {
  if (!requireSupabase(res)) return null;

  const authorization = req.headers.authorization || "";
  const match = authorization.match(/^Bearer\s+(.+)$/i);

  if (!match) {
    res.status(401).json({ error: "Please sign in before paying." });
    return null;
  }

  const { data, error } = await supabase.auth.getUser(match[1]);

  if (error || !data?.user) {
    res.status(401).json({
      error: "Your session has expired. Please sign in again.",
    });
    return null;
  }

  return data.user;
}

async function verifyWithPaystack(reference) {
  const response = await fetch(
    `https://api.paystack.co/transaction/verify/${encodeURIComponent(
      reference
    )}`,
    {
      headers: {
        Authorization: `Bearer ${PAYSTACK_SECRET_KEY}`,
      },
    }
  );

  const result = await response.json();

  if (!response.ok || !result.status) {
    return {
      ok: false,
      message: result.message || "Paystack verification failed.",
      payment: null,
    };
  }

  return {
    ok: true,
    message: result.message,
    payment: result.data,
  };
}

async function markDeliveryPaid(delivery, payment) {
  const paidAt = payment.paid_at || new Date().toISOString();

  // Avoid writing the same payment repeatedly.
  if (
    delivery.payment_status === "paid" &&
    delivery.payment_reference === payment.reference
  ) {
    return { ok: true, alreadyPaid: true };
  }

  const { data, error } = await supabase
    .from("deliveries")
    .update({
      payment_status: "paid",
      payment_reference: payment.reference,
      payment_amount_kobo: payment.amount,
      paid_at: paidAt,
    })
    .eq("id", delivery.id)
    .eq("payment_reference", payment.reference)
    .select("id,payment_status,payment_reference,paid_at")
    .maybeSingle();

  if (error) {
    console.error("Could not save paid status:", error.message);
    return { ok: false };
  }

  // If RLS or a concurrent update prevented the write, don't claim success.
  if (!data) {
    const { data: latest, error: latestError } = await supabase
      .from("deliveries")
      .select("id,payment_status,payment_reference,paid_at")
      .eq("id", delivery.id)
      .maybeSingle();

    if (
      !latestError &&
      latest?.payment_status === "paid" &&
      latest?.payment_reference === payment.reference
    ) {
      return { ok: true, alreadyPaid: true };
    }

    return { ok: false };
  }

  return { ok: true, alreadyPaid: false };
}

// Initialize a payment using the delivery fee stored in Supabase.
// Never trust the payment amount supplied by the browser.
app.post("/api/payments/initialize", requirePaystackKey, async (req, res) => {
  try {
    const customer = await getAuthenticatedCustomer(req, res);
    if (!customer) return;

    const { email, deliveryId } = req.body;

    if (
      typeof email !== "string" ||
      !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ||
      typeof deliveryId !== "string" ||
      !deliveryId.trim()
    ) {
      return res.status(400).json({
        error: "A valid email and delivery ID are required.",
      });
    }

    const { data: delivery, error } = await supabase
      .from("deliveries")
      .select(
        "id,customer_id,status,delivery_fee,payment_status,payment_reference,payment_amount_kobo"
      )
      .eq("id", deliveryId)
      .maybeSingle();

    if (error || !delivery) {
      return res.status(404).json({ error: "Delivery not found." });
    }

    if (delivery.customer_id !== customer.id) {
      return res.status(403).json({
        error: "You are not allowed to pay for this delivery.",
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

    const amountNaira = Number(delivery.delivery_fee);
    const amountKobo = Math.round(amountNaira * 100);

    if (
      !Number.isFinite(amountNaira) ||
      amountNaira < 100 ||
      !Number.isSafeInteger(amountKobo)
    ) {
      return res.status(400).json({
        error: "The delivery fee is invalid.",
      });
    }

    const reference = `hokada_${crypto.randomUUID()}`;

    // Save the new reference before initialization so webhook/verification
    // can match the transaction to this exact delivery.
    const { error: updateError } = await supabase
      .from("deliveries")
      .update({
        payment_status: "pending",
        payment_reference: reference,
        payment_amount_kobo: amountKobo,
      })
      .eq("id", delivery.id)
      .eq("customer_id", customer.id);

    if (updateError) {
      console.error("Could not prepare payment:", updateError.message);
      return res.status(500).json({
        error: "Could not prepare this payment.",
      });
    }

    const response = await fetch(
      "https://api.paystack.co/transaction/initialize",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${PAYSTACK_SECRET_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          email,
          amount: amountKobo,
          reference,
          currency: "NGN",
          callback_url: PAYSTACK_CALLBACK_URL,
          metadata: {
            delivery_id: delivery.id,
            customer_id: customer.id,
          },
        }),
      }
    );

    const result = await response.json();

    if (!response.ok || !result.status) {
      console.error("Paystack initialization failed:", result.message);

      await supabase
        .from("deliveries")
        .update({ payment_status: "unpaid" })
        .eq("id", delivery.id)
        .eq("payment_reference", reference);

      return res.status(502).json({
        error: result.message || "Could not initialize payment.",
      });
    }

    return res.json({
      authorizationUrl: result.data.authorization_url,
      reference: result.data.reference,
      amountKobo,
      callbackUrl: PAYSTACK_CALLBACK_URL,
    });
  } catch (error) {
    console.error("Payment initialization failed:", error.message);
    return res.status(500).json({
      error: "Could not start payment.",
    });
  }
});

// Verify a payment and update Supabase before returning success.
app.get(
  "/api/payments/verify/:reference",
  requirePaystackKey,
  async (req, res) => {
    try {
      const customer = await getAuthenticatedCustomer(req, res);
      if (!customer) return;

      const reference = req.params.reference;

      const verification = await verifyWithPaystack(reference);

      if (!verification.ok || !verification.payment) {
        return res.status(502).json({
          error: verification.message || "Payment verification failed.",
        });
      }

      const payment = verification.payment;
      const deliveryId = payment.metadata?.delivery_id;

      if (!deliveryId) {
        return res.status(400).json({
          error: "This payment is not linked to a delivery.",
        });
      }

      const { data: delivery, error } = await supabase
        .from("deliveries")
        .select(
          "id,customer_id,delivery_fee,payment_status,payment_reference,payment_amount_kobo"
        )
        .eq("id", deliveryId)
        .maybeSingle();

      if (error || !delivery) {
        return res.status(404).json({
          error: "The delivery linked to this payment was not found.",
        });
      }

      if (delivery.customer_id !== customer.id) {
        return res.status(403).json({
          error: "You are not allowed to verify this delivery's payment.",
        });
      }

      if (delivery.payment_reference !== payment.reference) {
        return res.status(409).json({
          error: "The payment reference does not match this delivery.",
        });
      }

      const expectedAmount = Math.round(Number(delivery.delivery_fee) * 100);

      if (
        payment.status !== "success" ||
        payment.currency !== "NGN" ||
        payment.amount !== expectedAmount ||
        payment.amount !== Number(delivery.payment_amount_kobo)
      ) {
        return res.status(402).json({
          verified: false,
          status: payment.status,
          error: "Payment has not been confirmed for the expected amount.",
        });
      }

      const saved = await markDeliveryPaid(delivery, payment);

      if (!saved.ok) {
        return res.status(500).json({
          error:
            "Payment was verified, but its status could not be saved. Please retry verification.",
        });
      }

      return res.json({
        verified: true,
        status: "success",
        reference: payment.reference,
        amountKobo: payment.amount,
        deliveryId: delivery.id,
        paymentStatus: "paid",
      });
    } catch (error) {
      console.error("Payment verification failed:", error.message);
      return res.status(500).json({
        error: "Could not verify payment.",
      });
    }
  }
);

app.get("/api/health", (req, res) => {
  res.json({
    ok: true,
    service: "HOKADA payments",
    supabaseConfigured: Boolean(supabase),
    paystackConfigured: Boolean(PAYSTACK_SECRET_KEY),
  });
});

app.listen(PORT, () => {
  console.log(`HOKADA payment API listening on port ${PORT}`);
});
