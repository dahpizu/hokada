export function getDeliveryPaymentStatus(delivery) {
  return delivery?.payment_status ?? delivery?.paymentStatus ?? null;
}

export function getDisplayDeliveryStatus(delivery) {
  if (getDeliveryPaymentStatus(delivery) === "paid") return "delivered";
  return delivery?.status || "searching";
}

export function isDeliveryComplete(delivery) {
  return (
    delivery?.status === "delivered" ||
    getDeliveryPaymentStatus(delivery) === "paid"
  );
}

export function canPayDeliveryFee(delivery) {
  const fee = Number(delivery?.delivery_fee ?? delivery?.deliveryFee);
  return (
    ["arrived_at_dropoff", "delivered"].includes(delivery?.status) &&
    getDeliveryPaymentStatus(delivery) === "unpaid" &&
    Number.isFinite(fee) &&
    fee >= 1
  );
}

export function isChatAvailableStatus(status) {
  return ["arrived", "collected"].includes(status);
}
