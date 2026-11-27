-- A Paystack-confirmed payment is the final condition for completing delivery.
-- This also reconciles legacy rows paid by the former payment handler.

CREATE OR REPLACE FUNCTION public.complete_paid_delivery()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $function$
BEGIN
  IF NEW.payment_status = 'paid' AND NEW.status = 'arrived_at_dropoff' THEN
    NEW.status := 'delivered';
    NEW.updated_at := now();
  END IF;

  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS complete_paid_delivery ON public.deliveries;

CREATE TRIGGER complete_paid_delivery
BEFORE INSERT OR UPDATE OF payment_status, status
ON public.deliveries
FOR EACH ROW
EXECUTE FUNCTION public.complete_paid_delivery();

UPDATE public.deliveries
SET status = 'delivered', updated_at = now()
WHERE payment_status = 'paid'
  AND status = 'arrived_at_dropoff';
