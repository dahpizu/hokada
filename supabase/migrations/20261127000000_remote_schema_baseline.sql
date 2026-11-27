-- Schema-only baseline exported from HOKADA production on 2026-11-27.
-- The following migration records the delivery-completion change already applied remotely.



SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;


CREATE SCHEMA IF NOT EXISTS "public";


ALTER SCHEMA "public" OWNER TO "pg_database_owner";


COMMENT ON SCHEMA "public" IS 'standard public schema';



CREATE OR REPLACE FUNCTION "public"."accept_delivery"("p_delivery_id" "uuid") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
DECLARE
  v_rider_id uuid := auth.uid();
  v_rider_name text;
  v_delivery jsonb;
BEGIN
  IF v_rider_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  SELECT rp.full_name
  INTO v_rider_name
  FROM public.rider_profiles rp
  WHERE rp.id = v_rider_id
    AND rp.approval_status = 'approved';

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Approved rider account required';
  END IF;

  UPDATE public.deliveries d
  SET
    rider_id = v_rider_id,
    rider_name = COALESCE(NULLIF(v_rider_name, ''), 'HOKADA Rider'),
    status = 'accepted',
    updated_at = now()
  WHERE d.id = p_delivery_id
    AND d.rider_id IS NULL
    AND d.status IN ('searching', 'pending')
  RETURNING jsonb_build_object(
    'id', d.id,
    'customer_id', d.customer_id,
    'customer_name', d.customer_name,
    'rider_id', d.rider_id,
    'rider_name', d.rider_name,
    'pickup_address', d.pickup_address,
    'dropoff_address', d.dropoff_address,
    'recipient_name', d.recipient_name,
    'recipient_phone', d.recipient_phone,
    'package_type', d.package_type,
    'delivery_type', d.delivery_type,
    'notes', d.notes,
    'status', d.status,
    'payment_status', d.payment_status,
    'delivery_fee', d.delivery_fee,
    'rider_earnings', d.rider_earnings,
    'created_at', d.created_at,
    'updated_at', d.updated_at
  )
  INTO v_delivery;

  IF v_delivery IS NULL THEN
    RAISE EXCEPTION 'This delivery is no longer available';
  END IF;

  RETURN v_delivery;
END;
$$;


ALTER FUNCTION "public"."accept_delivery"("p_delivery_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."complete_paid_delivery"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO ''
    AS $$
BEGIN
  IF NEW.payment_status = 'paid' AND NEW.status = 'arrived_at_dropoff' THEN
    NEW.status := 'delivered';
    NEW.updated_at := now();
  END IF;

  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."complete_paid_delivery"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."enforce_delivery_status_transitions"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO ''
    AS $$
DECLARE
  actor_id uuid := auth.uid();
BEGIN
  -- Protect rider assignment on every delivery update.
  IF NEW.rider_id IS DISTINCT FROM OLD.rider_id THEN

    -- An assigned rider cannot be replaced or removed.
    IF OLD.rider_id IS NOT NULL THEN
      RAISE EXCEPTION
        'The assigned rider cannot be changed during delivery';
    END IF;

    -- A new assignment must happen with acceptance.
    IF NEW.rider_id IS NOT NULL THEN
      IF NEW.status IS DISTINCT FROM 'accepted' THEN
        RAISE EXCEPTION
          'A rider must accept a delivery when claiming it';
      END IF;

      IF actor_id IS NOT NULL
         AND actor_id IS DISTINCT FROM NEW.rider_id THEN
        RAISE EXCEPTION
          'Only the assigned rider can accept this delivery';
      END IF;
    END IF;
  END IF;

  -- Ignore updates that do not change the status.
  IF NEW.status IS NOT DISTINCT FROM OLD.status THEN
    RETURN NEW;
  END IF;

  -- Customer cancellation: only before package collection.
  IF NEW.status = 'cancelled' THEN
    IF OLD.status NOT IN (
      'searching', 'pending', 'accepted', 'in_transit', 'arrived'
    ) OR OLD.payment_status IS DISTINCT FROM 'unpaid' THEN
      RAISE EXCEPTION
        'This delivery cannot be cancelled at its current stage';
    END IF;

    IF actor_id IS NOT NULL
       AND actor_id IS DISTINCT FROM OLD.customer_id THEN
      RAISE EXCEPTION
        'Only the customer can cancel this delivery';
    END IF;

    IF actor_id IS NOT NULL
       AND actor_id = OLD.customer_id
       AND (
         NEW.rider_id IS DISTINCT FROM OLD.rider_id
         OR NEW.rider_name IS DISTINCT FROM OLD.rider_name
         OR NEW.rider_lat IS DISTINCT FROM OLD.rider_lat
         OR NEW.rider_lng IS DISTINCT FROM OLD.rider_lng
         OR NEW.rider_accuracy IS DISTINCT FROM OLD.rider_accuracy
         OR NEW.rider_heading IS DISTINCT FROM OLD.rider_heading
         OR NEW.rider_speed IS DISTINCT FROM OLD.rider_speed
       ) THEN
      RAISE EXCEPTION
        'Customers cannot modify rider information';
    END IF;

    RETURN NEW;
  END IF;

  -- Rider claims an unassigned delivery.
  IF OLD.status IN ('searching', 'pending')
     AND NEW.status = 'accepted' THEN
    IF OLD.rider_id IS NOT NULL OR NEW.rider_id IS NULL THEN
      RAISE EXCEPTION
        'This delivery is already assigned or cannot be claimed';
    END IF;

    IF actor_id IS NOT NULL
       AND actor_id IS DISTINCT FROM NEW.rider_id THEN
      RAISE EXCEPTION
        'Only the assigned rider can accept this delivery';
    END IF;

    RETURN NEW;
  END IF;

  -- Subsequent transitions must retain the assigned rider.
  IF OLD.rider_id IS NULL
     OR NEW.rider_id IS DISTINCT FROM OLD.rider_id THEN
    RAISE EXCEPTION
      'The assigned rider cannot be changed during delivery';
  END IF;

  IF actor_id IS NOT NULL
     AND actor_id IS DISTINCT FROM OLD.rider_id THEN
    RAISE EXCEPTION
      'Only the assigned rider can update delivery progress';
  END IF;

  IF NOT (
    (OLD.status = 'accepted' AND NEW.status = 'in_transit')
    OR (OLD.status = 'in_transit' AND NEW.status = 'arrived')
    OR (OLD.status = 'arrived' AND NEW.status = 'collected')
    OR (OLD.status = 'collected' AND NEW.status = 'going_to_dropoff')
    OR (OLD.status = 'going_to_dropoff' AND NEW.status = 'arrived_at_dropoff')
    OR (
      OLD.status = 'arrived_at_dropoff'
      AND NEW.status = 'delivered'
      AND OLD.payment_status = 'paid'
    )
  ) THEN
    RAISE EXCEPTION
      'Invalid delivery status transition: % to %',
      OLD.status, NEW.status;
  END IF;

  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."enforce_delivery_status_transitions"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_available_deliveries"() RETURNS SETOF "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
DECLARE
  v_rider_id uuid := auth.uid();
BEGIN
  IF v_rider_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.rider_profiles rp
    WHERE rp.id = v_rider_id
      AND rp.approval_status = 'approved'
  ) THEN
    RAISE EXCEPTION 'Approved rider account required';
  END IF;

  RETURN QUERY
  SELECT jsonb_build_object(
    'id', d.id,
    'package_type', d.package_type,
    'delivery_type', d.delivery_type,
    'delivery_fee', d.delivery_fee,
    'created_at', d.created_at,
    'status', d.status,
    'updated_at', d.updated_at
  )
  FROM public.deliveries d
  WHERE d.rider_id IS NULL
    AND d.status IN ('searching', 'pending')
    AND NOT EXISTS (
      SELECT 1
      FROM public.rider_declined_deliveries rd
      WHERE rd.delivery_id = d.id
        AND rd.rider_id = v_rider_id
    )
  ORDER BY d.created_at DESC
  LIMIT 50;
END;
$$;


ALTER FUNCTION "public"."get_available_deliveries"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_delivery_rider_profile"("p_delivery_id" "uuid") RETURNS TABLE("full_name" "text", "phone" "text", "bike_model" "text", "plate_number" "text", "rating" numeric)
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
    SELECT
        rp.full_name,
        rp.phone,
        rp.bike_model,
        rp.plate_number,
        rp.rating
    FROM public.deliveries AS d
    JOIN public.rider_profiles AS rp
        ON rp.id = d.rider_id
    WHERE d.id = p_delivery_id
      AND d.customer_id = auth.uid()
      AND rp.approval_status = 'approved'
    LIMIT 1;
$$;


ALTER FUNCTION "public"."get_delivery_rider_profile"("p_delivery_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."guard_delivery_completion_and_earnings"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO ''
    AS $$
BEGIN
  IF NEW.status = 'delivered'
     AND OLD.status IS DISTINCT FROM 'delivered' THEN

    IF OLD.status IS DISTINCT FROM 'arrived_at_dropoff'
       OR OLD.payment_status IS DISTINCT FROM 'paid' THEN
      RAISE EXCEPTION
        'A delivery can only be completed at drop-off after confirmed payment';
    END IF;

    NEW.rider_earnings :=
      ROUND(COALESCE(OLD.delivery_fee, 0) * 0.8);

  ELSIF auth.uid() IS NOT NULL
        AND NEW.rider_earnings IS DISTINCT FROM OLD.rider_earnings THEN

    RAISE EXCEPTION
      'Rider earnings are calculated automatically';
  END IF;

  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."guard_delivery_completion_and_earnings"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."handle_new_customer"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
BEGIN
    INSERT INTO public.customer_profiles (
        id,
        full_name,
        phone
    )
    VALUES (
        NEW.id,
        COALESCE(
            NEW.raw_user_meta_data ->> 'full_name',
            ''
        ),
        COALESCE(
            NEW.raw_user_meta_data ->> 'phone',
            ''
        )
    )
    ON CONFLICT (id) DO NOTHING;

    RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."handle_new_customer"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."prevent_rider_self_approval"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public'
    AS $$
BEGIN
  IF auth.uid() IS NOT NULL THEN
    IF TG_OP = 'INSERT'
       AND NEW.approval_status IS DISTINCT FROM 'pending' THEN
      RAISE EXCEPTION 'Rider approval requires administrator approval';
    END IF;

    IF TG_OP = 'UPDATE'
       AND NEW.approval_status IS DISTINCT FROM OLD.approval_status THEN
      RAISE EXCEPTION 'Only an administrator can change rider approval status';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."prevent_rider_self_approval"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."remove_ended_delivery_live_location"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
BEGIN
  IF NEW.status IN ('delivered', 'cancelled')
     AND OLD.status IS DISTINCT FROM NEW.status THEN

    DELETE FROM public.delivery_live_locations
    WHERE delivery_id = NEW.id;

  END IF;

  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."remove_ended_delivery_live_location"() OWNER TO "postgres";

SET default_tablespace = '';

SET default_table_access_method = "heap";


CREATE TABLE IF NOT EXISTS "public"."customer_profiles" (
    "id" "uuid" NOT NULL,
    "full_name" "text",
    "phone" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."customer_profiles" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."deliveries" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "customer_name" "text",
    "rider_name" "text",
    "pickup_address" "text",
    "dropoff_address" "text",
    "pickup_lat" double precision,
    "pickup_lng" double precision,
    "dropoff_lat" double precision,
    "dropoff_lng" double precision,
    "rider_lat" double precision,
    "rider_lng" double precision,
    "rider_heading" double precision,
    "rider_speed" double precision,
    "rider_accuracy" double precision,
    "status" "text" DEFAULT 'searching'::"text",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    "rider_earnings" numeric DEFAULT 0,
    "recipient_name" "text",
    "recipient_phone" "text",
    "package_type" "text",
    "package_description" "text",
    "delivery_type" "text" DEFAULT 'Standard'::"text",
    "notes" "text",
    "delivery_fee" numeric,
    "rider_id" "uuid",
    "customer_id" "uuid",
    "payment_status" "text" DEFAULT 'unpaid'::"text",
    "payment_provider" "text",
    "payment_reference" "text",
    "paid_at" timestamp with time zone,
    "payment_amount_kobo" bigint,
    CONSTRAINT "deliveries_delivery_fee_check" CHECK ((("delivery_fee" IS NULL) OR ("delivery_fee" >= (0)::numeric))),
    CONSTRAINT "deliveries_payment_provider_check" CHECK ((("payment_provider" IS NULL) OR ("payment_provider" = 'paystack'::"text"))),
    CONSTRAINT "deliveries_payment_status_check" CHECK (("payment_status" = ANY (ARRAY['unpaid'::"text", 'pending'::"text", 'paid'::"text", 'failed'::"text", 'refunded'::"text"]))),
    CONSTRAINT "deliveries_rider_earnings_check" CHECK (("rider_earnings" >= (0)::numeric)),
    CONSTRAINT "deliveries_status_check" CHECK (("status" = ANY (ARRAY['searching'::"text", 'pending'::"text", 'accepted'::"text", 'in_transit'::"text", 'arrived'::"text", 'collected'::"text", 'going_to_dropoff'::"text", 'arrived_at_dropoff'::"text", 'delivered'::"text", 'cancelled'::"text"])))
);


ALTER TABLE "public"."deliveries" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."delivery_live_locations" (
    "delivery_id" "uuid" NOT NULL,
    "rider_id" "uuid" NOT NULL,
    "latitude" double precision NOT NULL,
    "longitude" double precision NOT NULL,
    "heading" double precision,
    "speed" double precision,
    "accuracy" double precision,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "delivery_live_locations_latitude_check" CHECK ((("latitude" >= ('-90'::integer)::double precision) AND ("latitude" <= (90)::double precision))),
    CONSTRAINT "delivery_live_locations_longitude_check" CHECK ((("longitude" >= ('-180'::integer)::double precision) AND ("longitude" <= (180)::double precision)))
);


ALTER TABLE "public"."delivery_live_locations" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."delivery_messages" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "delivery_id" "uuid" NOT NULL,
    "sender_id" "uuid",
    "sender_type" "text" NOT NULL,
    "message" "text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "delivery_messages_message_length" CHECK (("length"("message") <= 500)),
    CONSTRAINT "delivery_messages_message_not_empty" CHECK (("length"(TRIM(BOTH FROM "message")) > 0)),
    CONSTRAINT "delivery_messages_sender_type_check" CHECK (("sender_type" = ANY (ARRAY['customer'::"text", 'rider'::"text"])))
);


ALTER TABLE "public"."delivery_messages" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."rider_declined_deliveries" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "rider_id" "uuid" NOT NULL,
    "delivery_id" "uuid" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."rider_declined_deliveries" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."rider_profiles" (
    "id" "uuid" NOT NULL,
    "full_name" "text",
    "phone" "text",
    "bike_model" "text",
    "plate_number" "text",
    "rating" numeric DEFAULT 5.0,
    "total_deliveries" integer DEFAULT 0,
    "total_earnings" numeric DEFAULT 0,
    "is_online" boolean DEFAULT false,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    "approval_status" "text" DEFAULT 'pending'::"text" NOT NULL,
    CONSTRAINT "rider_profiles_approval_status_check" CHECK (("approval_status" = ANY (ARRAY['pending'::"text", 'approved'::"text", 'rejected'::"text"]))),
    CONSTRAINT "rider_profiles_rating_check" CHECK ((("rating" >= (0)::numeric) AND ("rating" <= (5)::numeric))),
    CONSTRAINT "rider_profiles_total_deliveries_check" CHECK (("total_deliveries" >= 0)),
    CONSTRAINT "rider_profiles_total_earnings_check" CHECK (("total_earnings" >= (0)::numeric))
);


ALTER TABLE "public"."rider_profiles" OWNER TO "postgres";


ALTER TABLE ONLY "public"."customer_profiles"
    ADD CONSTRAINT "customer_profiles_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."deliveries"
    ADD CONSTRAINT "deliveries_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."delivery_live_locations"
    ADD CONSTRAINT "delivery_live_locations_pkey" PRIMARY KEY ("delivery_id");



ALTER TABLE ONLY "public"."delivery_messages"
    ADD CONSTRAINT "delivery_messages_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."rider_declined_deliveries"
    ADD CONSTRAINT "rider_declined_deliveries_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."rider_declined_deliveries"
    ADD CONSTRAINT "rider_declined_deliveries_rider_id_delivery_id_key" UNIQUE ("rider_id", "delivery_id");



ALTER TABLE ONLY "public"."rider_profiles"
    ADD CONSTRAINT "rider_profiles_pkey" PRIMARY KEY ("id");



CREATE INDEX "customer_profiles_created_at_idx" ON "public"."customer_profiles" USING "btree" ("created_at" DESC);



CREATE INDEX "customer_profiles_phone_idx" ON "public"."customer_profiles" USING "btree" ("phone");



CREATE INDEX "deliveries_created_at_idx" ON "public"."deliveries" USING "btree" ("created_at" DESC);



CREATE INDEX "deliveries_customer_id_idx" ON "public"."deliveries" USING "btree" ("customer_id");



CREATE INDEX "deliveries_payment_reference_idx" ON "public"."deliveries" USING "btree" ("payment_reference");



CREATE UNIQUE INDEX "deliveries_payment_reference_unique" ON "public"."deliveries" USING "btree" ("payment_reference") WHERE ("payment_reference" IS NOT NULL);



CREATE INDEX "deliveries_payment_status_idx" ON "public"."deliveries" USING "btree" ("payment_status");



CREATE INDEX "deliveries_rider_id_idx" ON "public"."deliveries" USING "btree" ("rider_id");



CREATE INDEX "deliveries_status_idx" ON "public"."deliveries" USING "btree" ("status");



CREATE INDEX "deliveries_updated_at_idx" ON "public"."deliveries" USING "btree" ("updated_at" DESC);



CREATE INDEX "delivery_messages_created_at_idx" ON "public"."delivery_messages" USING "btree" ("created_at");



CREATE INDEX "delivery_messages_delivery_id_idx" ON "public"."delivery_messages" USING "btree" ("delivery_id");



CREATE INDEX "rider_profiles_is_online_idx" ON "public"."rider_profiles" USING "btree" ("is_online");



CREATE OR REPLACE TRIGGER "complete_paid_delivery" BEFORE INSERT OR UPDATE OF "payment_status", "status" ON "public"."deliveries" FOR EACH ROW EXECUTE FUNCTION "public"."complete_paid_delivery"();



CREATE OR REPLACE TRIGGER "enforce_delivery_status_transitions" BEFORE UPDATE ON "public"."deliveries" FOR EACH ROW EXECUTE FUNCTION "public"."enforce_delivery_status_transitions"();



CREATE OR REPLACE TRIGGER "guard_delivery_completion_and_earnings" BEFORE UPDATE OF "status", "rider_earnings" ON "public"."deliveries" FOR EACH ROW EXECUTE FUNCTION "public"."guard_delivery_completion_and_earnings"();



CREATE OR REPLACE TRIGGER "protect_rider_approval_status" BEFORE INSERT OR UPDATE ON "public"."rider_profiles" FOR EACH ROW EXECUTE FUNCTION "public"."prevent_rider_self_approval"();



CREATE OR REPLACE TRIGGER "remove_ended_delivery_live_location" AFTER UPDATE OF "status" ON "public"."deliveries" FOR EACH ROW EXECUTE FUNCTION "public"."remove_ended_delivery_live_location"();



ALTER TABLE ONLY "public"."customer_profiles"
    ADD CONSTRAINT "customer_profiles_id_fkey" FOREIGN KEY ("id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."deliveries"
    ADD CONSTRAINT "deliveries_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "public"."customer_profiles"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."deliveries"
    ADD CONSTRAINT "deliveries_rider_id_fkey" FOREIGN KEY ("rider_id") REFERENCES "public"."rider_profiles"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."delivery_live_locations"
    ADD CONSTRAINT "delivery_live_locations_delivery_id_fkey" FOREIGN KEY ("delivery_id") REFERENCES "public"."deliveries"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."delivery_live_locations"
    ADD CONSTRAINT "delivery_live_locations_rider_id_fkey" FOREIGN KEY ("rider_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."delivery_messages"
    ADD CONSTRAINT "delivery_messages_delivery_id_fkey" FOREIGN KEY ("delivery_id") REFERENCES "public"."deliveries"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."delivery_messages"
    ADD CONSTRAINT "delivery_messages_sender_id_fkey" FOREIGN KEY ("sender_id") REFERENCES "auth"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."rider_declined_deliveries"
    ADD CONSTRAINT "rider_declined_deliveries_delivery_id_fkey" FOREIGN KEY ("delivery_id") REFERENCES "public"."deliveries"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."rider_declined_deliveries"
    ADD CONSTRAINT "rider_declined_deliveries_rider_id_fkey" FOREIGN KEY ("rider_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."rider_profiles"
    ADD CONSTRAINT "rider_profiles_id_fkey" FOREIGN KEY ("id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



CREATE POLICY "Approved riders can decline available requests" ON "public"."rider_declined_deliveries" FOR INSERT TO "authenticated" WITH CHECK ((("rider_id" = ( SELECT "auth"."uid"() AS "uid")) AND (EXISTS ( SELECT 1
   FROM "public"."rider_profiles" "rp"
  WHERE (("rp"."id" = ( SELECT "auth"."uid"() AS "uid")) AND ("rp"."approval_status" = 'approved'::"text")))) AND (EXISTS ( SELECT 1
   FROM "public"."deliveries" "d"
  WHERE (("d"."id" = "rider_declined_deliveries"."delivery_id") AND ("d"."rider_id" IS NULL) AND ("d"."status" = ANY (ARRAY['searching'::"text", 'pending'::"text"])))))));



CREATE POLICY "Approved riders can insert own live locations" ON "public"."delivery_live_locations" FOR INSERT TO "authenticated" WITH CHECK ((("rider_id" = "auth"."uid"()) AND (EXISTS ( SELECT 1
   FROM ("public"."deliveries" "d"
     JOIN "public"."rider_profiles" "rp" ON (("rp"."id" = "auth"."uid"())))
  WHERE (("d"."id" = "delivery_live_locations"."delivery_id") AND ("d"."rider_id" = "auth"."uid"()) AND ("d"."status" = ANY (ARRAY['accepted'::"text", 'in_transit'::"text", 'arrived'::"text", 'collected'::"text", 'going_to_dropoff'::"text", 'arrived_at_dropoff'::"text"])) AND ("rp"."approval_status" = 'approved'::"text"))))));



CREATE POLICY "Approved riders can read assigned deliveries" ON "public"."deliveries" FOR SELECT TO "authenticated" USING ((("rider_id" = "auth"."uid"()) AND (EXISTS ( SELECT 1
   FROM "public"."rider_profiles" "rp"
  WHERE (("rp"."id" = "auth"."uid"()) AND ("rp"."approval_status" = 'approved'::"text"))))));



CREATE POLICY "Approved riders can read own live locations" ON "public"."delivery_live_locations" FOR SELECT TO "authenticated" USING ((("rider_id" = "auth"."uid"()) AND (EXISTS ( SELECT 1
   FROM ("public"."deliveries" "d"
     JOIN "public"."rider_profiles" "rp" ON (("rp"."id" = "auth"."uid"())))
  WHERE (("d"."id" = "delivery_live_locations"."delivery_id") AND ("d"."rider_id" = "auth"."uid"()) AND ("d"."status" = ANY (ARRAY['accepted'::"text", 'in_transit'::"text", 'arrived'::"text", 'collected'::"text", 'going_to_dropoff'::"text", 'arrived_at_dropoff'::"text"])) AND ("rp"."approval_status" = 'approved'::"text"))))));



CREATE POLICY "Approved riders can update own live locations" ON "public"."delivery_live_locations" FOR UPDATE TO "authenticated" USING ((("rider_id" = "auth"."uid"()) AND (EXISTS ( SELECT 1
   FROM ("public"."deliveries" "d"
     JOIN "public"."rider_profiles" "rp" ON (("rp"."id" = "auth"."uid"())))
  WHERE (("d"."id" = "delivery_live_locations"."delivery_id") AND ("d"."rider_id" = "auth"."uid"()) AND ("d"."status" = ANY (ARRAY['accepted'::"text", 'in_transit'::"text", 'arrived'::"text", 'collected'::"text", 'going_to_dropoff'::"text", 'arrived_at_dropoff'::"text"])) AND ("rp"."approval_status" = 'approved'::"text")))))) WITH CHECK ((("rider_id" = "auth"."uid"()) AND (EXISTS ( SELECT 1
   FROM ("public"."deliveries" "d"
     JOIN "public"."rider_profiles" "rp" ON (("rp"."id" = "auth"."uid"())))
  WHERE (("d"."id" = "delivery_live_locations"."delivery_id") AND ("d"."rider_id" = "auth"."uid"()) AND ("d"."status" = ANY (ARRAY['accepted'::"text", 'in_transit'::"text", 'arrived'::"text", 'collected'::"text", 'going_to_dropoff'::"text", 'arrived_at_dropoff'::"text"])) AND ("rp"."approval_status" = 'approved'::"text"))))));



CREATE POLICY "Assigned riders can send messages during eligible delivery stag" ON "public"."delivery_messages" FOR INSERT TO "authenticated" WITH CHECK ((("sender_type" = 'rider'::"text") AND ("sender_id" = ( SELECT "auth"."uid"() AS "uid")) AND (EXISTS ( SELECT 1
   FROM ("public"."deliveries" "d"
     JOIN "public"."rider_profiles" "rp" ON (("rp"."id" = ( SELECT "auth"."uid"() AS "uid"))))
  WHERE (("d"."id" = "delivery_messages"."delivery_id") AND ("d"."rider_id" = ( SELECT "auth"."uid"() AS "uid")) AND ("rp"."approval_status" = 'approved'::"text") AND ("d"."status" = ANY (ARRAY['arrived'::"text", 'collected'::"text", 'arrived_at_dropoff'::"text"])))))));



CREATE POLICY "Customers can create their own profile" ON "public"."customer_profiles" FOR INSERT TO "authenticated" WITH CHECK (("id" = "auth"."uid"()));



CREATE POLICY "Customers can read active delivery locations" ON "public"."delivery_live_locations" FOR SELECT TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."deliveries" "d"
  WHERE (("d"."id" = "delivery_live_locations"."delivery_id") AND ("d"."customer_id" = "auth"."uid"()) AND ("d"."status" = ANY (ARRAY['accepted'::"text", 'in_transit'::"text", 'arrived'::"text", 'collected'::"text", 'going_to_dropoff'::"text", 'arrived_at_dropoff'::"text"]))))));



CREATE POLICY "Customers can read their delivery messages" ON "public"."delivery_messages" FOR SELECT TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."deliveries"
  WHERE (("deliveries"."id" = "delivery_messages"."delivery_id") AND ("deliveries"."customer_id" = "auth"."uid"())))));



CREATE POLICY "Customers can read their own deliveries" ON "public"."deliveries" FOR SELECT TO "authenticated" USING (("customer_id" = "auth"."uid"()));



CREATE POLICY "Customers can read their own profile" ON "public"."customer_profiles" FOR SELECT TO "authenticated" USING (("id" = "auth"."uid"()));



CREATE POLICY "Customers can send messages during eligible delivery stages" ON "public"."delivery_messages" FOR INSERT TO "authenticated" WITH CHECK ((("sender_type" = 'customer'::"text") AND ("sender_id" = ( SELECT "auth"."uid"() AS "uid")) AND (EXISTS ( SELECT 1
   FROM "public"."deliveries" "d"
  WHERE (("d"."id" = "delivery_messages"."delivery_id") AND ("d"."customer_id" = ( SELECT "auth"."uid"() AS "uid")) AND ("d"."status" = ANY (ARRAY['arrived'::"text", 'collected'::"text", 'arrived_at_dropoff'::"text"])))))));



CREATE POLICY "Customers can update their own profile" ON "public"."customer_profiles" FOR UPDATE TO "authenticated" USING (("id" = "auth"."uid"())) WITH CHECK (("id" = "auth"."uid"()));



CREATE POLICY "Riders can read their delivery messages" ON "public"."delivery_messages" FOR SELECT TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."deliveries"
  WHERE (("deliveries"."id" = "delivery_messages"."delivery_id") AND ("deliveries"."rider_id" = "auth"."uid"())))));



CREATE POLICY "Riders can read their own profile" ON "public"."rider_profiles" FOR SELECT TO "authenticated" USING (("id" = "auth"."uid"()));



CREATE POLICY "Riders can view their own declined requests" ON "public"."rider_declined_deliveries" FOR SELECT TO "authenticated" USING (("rider_id" = "auth"."uid"()));



ALTER TABLE "public"."customer_profiles" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."deliveries" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."delivery_live_locations" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."delivery_messages" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."rider_declined_deliveries" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."rider_profiles" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "riders_read_own_profile" ON "public"."rider_profiles" FOR SELECT TO "authenticated" USING (("auth"."uid"() = "id"));



GRANT USAGE ON SCHEMA "public" TO "postgres";
GRANT USAGE ON SCHEMA "public" TO "anon";
GRANT USAGE ON SCHEMA "public" TO "authenticated";
GRANT USAGE ON SCHEMA "public" TO "service_role";



REVOKE ALL ON FUNCTION "public"."accept_delivery"("p_delivery_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."accept_delivery"("p_delivery_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."accept_delivery"("p_delivery_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."complete_paid_delivery"() TO "anon";
GRANT ALL ON FUNCTION "public"."complete_paid_delivery"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."complete_paid_delivery"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."enforce_delivery_status_transitions"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."enforce_delivery_status_transitions"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."get_available_deliveries"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."get_available_deliveries"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_available_deliveries"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."get_delivery_rider_profile"("p_delivery_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."get_delivery_rider_profile"("p_delivery_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_delivery_rider_profile"("p_delivery_id" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."guard_delivery_completion_and_earnings"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."guard_delivery_completion_and_earnings"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."handle_new_customer"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."handle_new_customer"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."prevent_rider_self_approval"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."prevent_rider_self_approval"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."remove_ended_delivery_live_location"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."remove_ended_delivery_live_location"() TO "service_role";



GRANT SELECT,INSERT,MAINTAIN,UPDATE ON TABLE "public"."customer_profiles" TO "authenticated";
GRANT ALL ON TABLE "public"."customer_profiles" TO "service_role";



GRANT REFERENCES,MAINTAIN ON TABLE "public"."deliveries" TO "authenticated";
GRANT ALL ON TABLE "public"."deliveries" TO "service_role";



GRANT SELECT("id") ON TABLE "public"."deliveries" TO "authenticated";



GRANT SELECT("customer_name") ON TABLE "public"."deliveries" TO "authenticated";



GRANT SELECT("rider_name") ON TABLE "public"."deliveries" TO "authenticated";



GRANT SELECT("pickup_address") ON TABLE "public"."deliveries" TO "authenticated";



GRANT SELECT("dropoff_address") ON TABLE "public"."deliveries" TO "authenticated";



GRANT SELECT("pickup_lat") ON TABLE "public"."deliveries" TO "authenticated";



GRANT SELECT("pickup_lng") ON TABLE "public"."deliveries" TO "authenticated";



GRANT SELECT("dropoff_lat") ON TABLE "public"."deliveries" TO "authenticated";



GRANT SELECT("dropoff_lng") ON TABLE "public"."deliveries" TO "authenticated";



GRANT SELECT("status") ON TABLE "public"."deliveries" TO "authenticated";



GRANT SELECT("created_at") ON TABLE "public"."deliveries" TO "authenticated";



GRANT SELECT("updated_at") ON TABLE "public"."deliveries" TO "authenticated";



GRANT SELECT("rider_earnings") ON TABLE "public"."deliveries" TO "authenticated";



GRANT SELECT("recipient_name") ON TABLE "public"."deliveries" TO "authenticated";



GRANT SELECT("recipient_phone") ON TABLE "public"."deliveries" TO "authenticated";



GRANT SELECT("package_type") ON TABLE "public"."deliveries" TO "authenticated";



GRANT SELECT("package_description") ON TABLE "public"."deliveries" TO "authenticated";



GRANT SELECT("delivery_type") ON TABLE "public"."deliveries" TO "authenticated";



GRANT SELECT("notes") ON TABLE "public"."deliveries" TO "authenticated";



GRANT SELECT("delivery_fee") ON TABLE "public"."deliveries" TO "authenticated";



GRANT SELECT("rider_id") ON TABLE "public"."deliveries" TO "authenticated";



GRANT SELECT("customer_id") ON TABLE "public"."deliveries" TO "authenticated";



GRANT SELECT("payment_status") ON TABLE "public"."deliveries" TO "authenticated";



GRANT SELECT("payment_provider") ON TABLE "public"."deliveries" TO "authenticated";



GRANT SELECT("payment_reference") ON TABLE "public"."deliveries" TO "authenticated";



GRANT SELECT("paid_at") ON TABLE "public"."deliveries" TO "authenticated";



GRANT SELECT("payment_amount_kobo") ON TABLE "public"."deliveries" TO "authenticated";



GRANT SELECT,INSERT,MAINTAIN,UPDATE ON TABLE "public"."delivery_live_locations" TO "authenticated";
GRANT ALL ON TABLE "public"."delivery_live_locations" TO "service_role";



GRANT SELECT,INSERT,MAINTAIN ON TABLE "public"."delivery_messages" TO "authenticated";
GRANT ALL ON TABLE "public"."delivery_messages" TO "service_role";



GRANT SELECT,INSERT,MAINTAIN ON TABLE "public"."rider_declined_deliveries" TO "authenticated";
GRANT ALL ON TABLE "public"."rider_declined_deliveries" TO "service_role";



GRANT SELECT,REFERENCES,MAINTAIN ON TABLE "public"."rider_profiles" TO "authenticated";
GRANT ALL ON TABLE "public"."rider_profiles" TO "service_role";



ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "service_role";






ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "service_role";






ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "service_role";







