import test from "node:test";
import assert from "node:assert/strict";
import {
  canPayDeliveryFee,
  getDisplayDeliveryStatus,
  getDeliveryPaymentStatus,
  isChatAvailableStatus,
  isDeliveryComplete,
} from "../shared/deliveryState.js";

test("paid delivery is displayed as delivered for both API and history shapes", () => {
  for (const delivery of [
    { status: "arrived_at_dropoff", payment_status: "paid" },
    { status: "arrived_at_dropoff", paymentStatus: "paid" },
  ]) {
    assert.equal(getDeliveryPaymentStatus(delivery), "paid");
    assert.equal(getDisplayDeliveryStatus(delivery), "delivered");
    assert.equal(isDeliveryComplete(delivery), true);
  }
});

test("unpaid arrival remains at drop-off and can be paid only with a valid fee", () => {
  const payable = {
    status: "arrived_at_dropoff",
    payment_status: "unpaid",
    delivery_fee: 2632,
  };
  assert.equal(getDisplayDeliveryStatus(payable), "arrived_at_dropoff");
  assert.equal(canPayDeliveryFee(payable), true);
  assert.equal(canPayDeliveryFee({ ...payable, delivery_fee: 0 }), false);
  assert.equal(canPayDeliveryFee({ ...payable, payment_status: "pending" }), false);
});

test("chat is available only during pickup and package collection stages", () => {
  assert.equal(isChatAvailableStatus("arrived"), true);
  assert.equal(isChatAvailableStatus("collected"), true);
  assert.equal(isChatAvailableStatus("arrived_at_dropoff"), false);
  assert.equal(isChatAvailableStatus("delivered"), false);
});

test("delivered status remains complete", () => {
  assert.equal(
    isDeliveryComplete({ status: "delivered", payment_status: "paid" }),
    true
  );
});
