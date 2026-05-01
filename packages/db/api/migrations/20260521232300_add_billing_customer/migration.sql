-- BillingCustomer: maps an OrganizerHub user (OIDC `sub`) to a Stripe
-- Customer id. Lazy-created on first checkout. Stripe remains the source of
-- truth for the Customer object; this table is the lookup index.

CREATE TABLE "billing_customers" (
    "id"                 TEXT        NOT NULL,
    "user_id"            TEXT        NOT NULL,
    "stripe_customer_id" TEXT        NOT NULL,
    "created_at"         TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "billing_customers_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "billing_customers_user_id_key"            ON "billing_customers"("user_id");
CREATE UNIQUE INDEX "billing_customers_stripe_customer_id_key" ON "billing_customers"("stripe_customer_id");
