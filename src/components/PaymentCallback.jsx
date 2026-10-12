import { useEffect, useState } from "react";
import { CheckCircle2, LoaderCircle, XCircle } from "lucide-react";
import { supabase } from "../lib/supabase";

export default function PaymentCallback({ onVerified }) {
  const [message, setMessage] = useState("Verifying your payment...");
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;

    async function verifyPayment() {
      const params = new URLSearchParams(window.location.search);
      const reference = params.get("reference") || params.get("trxref");

      if (!reference) {
        if (active) {
          setError("No payment reference was found.");
        }
        return;
      }

      try {
        const { data, error: functionError } = await supabase.functions.invoke(
          "verify-payment",
          {
            body: { reference },
          }
        );

        if (functionError) {
          throw new Error(functionError.message || "Could not verify payment.");
        }

        if (!data?.success || !data?.deliveryId) {
          throw new Error(
            data?.error || "Payment verification was unsuccessful."
          );
        }

        if (active) {
          setMessage("Payment confirmed! Opening your delivery...");
          await onVerified(data.deliveryId);
        }
      } catch (err) {
        if (active) {
          setError(
            err.message || "Something went wrong verifying your payment."
          );
        }
      }
    }

    verifyPayment();

    return () => {
      active = false;
    };
  }, [onVerified]);

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
          <button type="button" onClick={() => window.location.assign("/")}>
            Return to HOKADA
          </button>
        )}
      </div>
    </main>
  );
}
