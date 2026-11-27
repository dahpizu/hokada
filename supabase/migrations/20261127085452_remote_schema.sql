SET local check_function_bodies = off;

REVOKE ALL ON FUNCTION "public"."accept_delivery"(uuid) FROM "anon";

REVOKE ALL ON FUNCTION "public"."enforce_delivery_status_transitions"() FROM "anon";

REVOKE ALL ON FUNCTION "public"."enforce_delivery_status_transitions"() FROM "authenticated";

REVOKE ALL ON FUNCTION "public"."get_available_deliveries"() FROM "anon";

REVOKE ALL ON FUNCTION "public"."get_delivery_rider_profile"(uuid) FROM "anon";

REVOKE ALL ON FUNCTION "public"."guard_delivery_completion_and_earnings"() FROM "anon";

REVOKE ALL ON FUNCTION "public"."guard_delivery_completion_and_earnings"() FROM "authenticated";

REVOKE ALL ON FUNCTION "public"."handle_new_customer"() FROM "anon";

REVOKE ALL ON FUNCTION "public"."handle_new_customer"() FROM "authenticated";

REVOKE ALL ON FUNCTION "public"."prevent_rider_self_approval"() FROM "anon";

REVOKE ALL ON FUNCTION "public"."prevent_rider_self_approval"() FROM "authenticated";

REVOKE ALL ON FUNCTION "public"."remove_ended_delivery_live_location"() FROM "anon";

REVOKE ALL ON FUNCTION "public"."remove_ended_delivery_live_location"() FROM "authenticated";

REVOKE ALL ON TABLE "public"."customer_profiles" FROM "anon";

REVOKE ALL ON TABLE "public"."deliveries" FROM "anon";

REVOKE ALL ON TABLE "public"."delivery_live_locations" FROM "anon";

REVOKE ALL ON TABLE "public"."delivery_messages" FROM "anon";

REVOKE ALL ON TABLE "public"."rider_declined_deliveries" FROM "anon";

REVOKE ALL ON TABLE "public"."rider_profiles" FROM "anon";

CREATE TRIGGER on_auth_user_created_customer
  AFTER INSERT ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_new_customer();

ALTER PUBLICATION "supabase_realtime" ADD TABLE "public"."deliveries";

ALTER PUBLICATION "supabase_realtime" ADD TABLE "public"."delivery_live_locations";

ALTER PUBLICATION "supabase_realtime" ADD TABLE "public"."delivery_messages";

REVOKE ALL ON TABLE "public"."customer_profiles" FROM "authenticated";

GRANT INSERT, MAINTAIN, SELECT, UPDATE ON TABLE "public"."customer_profiles" TO "authenticated";

REVOKE ALL ON TABLE "public"."deliveries" FROM "authenticated";

REVOKE ALL ("created_at") ON TABLE "public"."deliveries" FROM "authenticated";

GRANT SELECT ("created_at") ON TABLE "public"."deliveries" TO "authenticated";

REVOKE ALL ("customer_id") ON TABLE "public"."deliveries" FROM "authenticated";

GRANT SELECT ("customer_id") ON TABLE "public"."deliveries" TO "authenticated";

REVOKE ALL ("customer_name") ON TABLE "public"."deliveries" FROM "authenticated";

GRANT SELECT ("customer_name") ON TABLE "public"."deliveries" TO "authenticated";

REVOKE ALL ("delivery_fee") ON TABLE "public"."deliveries" FROM "authenticated";

GRANT SELECT ("delivery_fee") ON TABLE "public"."deliveries" TO "authenticated";

REVOKE ALL ("delivery_type") ON TABLE "public"."deliveries" FROM "authenticated";

GRANT SELECT ("delivery_type") ON TABLE "public"."deliveries" TO "authenticated";

REVOKE ALL ("dropoff_address") ON TABLE "public"."deliveries" FROM "authenticated";

GRANT SELECT ("dropoff_address") ON TABLE "public"."deliveries" TO "authenticated";

REVOKE ALL ("dropoff_lat") ON TABLE "public"."deliveries" FROM "authenticated";

GRANT SELECT ("dropoff_lat") ON TABLE "public"."deliveries" TO "authenticated";

REVOKE ALL ("dropoff_lng") ON TABLE "public"."deliveries" FROM "authenticated";

GRANT SELECT ("dropoff_lng") ON TABLE "public"."deliveries" TO "authenticated";

REVOKE ALL ("id") ON TABLE "public"."deliveries" FROM "authenticated";

GRANT SELECT ("id") ON TABLE "public"."deliveries" TO "authenticated";

REVOKE ALL ("notes") ON TABLE "public"."deliveries" FROM "authenticated";

GRANT SELECT ("notes") ON TABLE "public"."deliveries" TO "authenticated";

REVOKE ALL ("package_description") ON TABLE "public"."deliveries" FROM "authenticated";

GRANT SELECT ("package_description") ON TABLE "public"."deliveries" TO "authenticated";

REVOKE ALL ("package_type") ON TABLE "public"."deliveries" FROM "authenticated";

GRANT SELECT ("package_type") ON TABLE "public"."deliveries" TO "authenticated";

REVOKE ALL ("paid_at") ON TABLE "public"."deliveries" FROM "authenticated";

GRANT SELECT ("paid_at") ON TABLE "public"."deliveries" TO "authenticated";

REVOKE ALL ("payment_amount_kobo") ON TABLE "public"."deliveries" FROM "authenticated";

GRANT SELECT ("payment_amount_kobo") ON TABLE "public"."deliveries" TO "authenticated";

REVOKE ALL ("payment_provider") ON TABLE "public"."deliveries" FROM "authenticated";

GRANT SELECT ("payment_provider") ON TABLE "public"."deliveries" TO "authenticated";

REVOKE ALL ("payment_reference") ON TABLE "public"."deliveries" FROM "authenticated";

GRANT SELECT ("payment_reference") ON TABLE "public"."deliveries" TO "authenticated";

REVOKE ALL ("payment_status") ON TABLE "public"."deliveries" FROM "authenticated";

GRANT SELECT ("payment_status") ON TABLE "public"."deliveries" TO "authenticated";

REVOKE ALL ("pickup_address") ON TABLE "public"."deliveries" FROM "authenticated";

GRANT SELECT ("pickup_address") ON TABLE "public"."deliveries" TO "authenticated";

REVOKE ALL ("pickup_lat") ON TABLE "public"."deliveries" FROM "authenticated";

GRANT SELECT ("pickup_lat") ON TABLE "public"."deliveries" TO "authenticated";

REVOKE ALL ("pickup_lng") ON TABLE "public"."deliveries" FROM "authenticated";

GRANT SELECT ("pickup_lng") ON TABLE "public"."deliveries" TO "authenticated";

REVOKE ALL ("recipient_name") ON TABLE "public"."deliveries" FROM "authenticated";

GRANT SELECT ("recipient_name") ON TABLE "public"."deliveries" TO "authenticated";

REVOKE ALL ("recipient_phone") ON TABLE "public"."deliveries" FROM "authenticated";

GRANT SELECT ("recipient_phone") ON TABLE "public"."deliveries" TO "authenticated";

REVOKE ALL ("rider_earnings") ON TABLE "public"."deliveries" FROM "authenticated";

GRANT SELECT ("rider_earnings") ON TABLE "public"."deliveries" TO "authenticated";

REVOKE ALL ("rider_id") ON TABLE "public"."deliveries" FROM "authenticated";

GRANT SELECT ("rider_id") ON TABLE "public"."deliveries" TO "authenticated";

REVOKE ALL ("rider_name") ON TABLE "public"."deliveries" FROM "authenticated";

GRANT SELECT ("rider_name") ON TABLE "public"."deliveries" TO "authenticated";

REVOKE ALL ("status") ON TABLE "public"."deliveries" FROM "authenticated";

GRANT SELECT ("status") ON TABLE "public"."deliveries" TO "authenticated";

REVOKE ALL ("updated_at") ON TABLE "public"."deliveries" FROM "authenticated";

GRANT SELECT ("updated_at") ON TABLE "public"."deliveries" TO "authenticated";

GRANT MAINTAIN, REFERENCES ON TABLE "public"."deliveries" TO "authenticated";

REVOKE ALL ON TABLE "public"."delivery_live_locations" FROM "authenticated";

GRANT INSERT, MAINTAIN, SELECT, UPDATE ON TABLE "public"."delivery_live_locations" TO "authenticated";

REVOKE ALL ON TABLE "public"."delivery_messages" FROM "authenticated";

GRANT INSERT, MAINTAIN, SELECT ON TABLE "public"."delivery_messages" TO "authenticated";

REVOKE ALL ON TABLE "public"."rider_declined_deliveries" FROM "authenticated";

GRANT INSERT, MAINTAIN, SELECT ON TABLE "public"."rider_declined_deliveries" TO "authenticated";

REVOKE ALL ON TABLE "public"."rider_profiles" FROM "authenticated";

GRANT MAINTAIN, REFERENCES, SELECT ON TABLE "public"."rider_profiles" TO "authenticated";

