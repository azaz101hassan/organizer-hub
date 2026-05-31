-- CreateEnum
CREATE TYPE "PaymentEventKind" AS ENUM ('TICKET', 'MEMBERSHIP', 'DONATION', 'REFUND', 'DISPUTE');

-- CreateEnum
CREATE TYPE "PaymentEventStatus" AS ENUM ('PENDING', 'SUCCEEDED', 'FAILED', 'CANCELED');

-- CreateTable
CREATE TABLE "payment_events" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "kind" "PaymentEventKind" NOT NULL,
    "status" "PaymentEventStatus" NOT NULL,
    "amount_cents" INTEGER NOT NULL,
    "currency" TEXT NOT NULL,
    "description" TEXT,
    "stripe_customer_id" TEXT,
    "stripe_payment_intent_id" TEXT,
    "stripe_checkout_session_id" TEXT,
    "stripe_invoice_id" TEXT,
    "stripe_refund_id" TEXT,
    "stripe_charge_id" TEXT,
    "ticket_id" TEXT,
    "ticket_request_id" TEXT,
    "membership_id" TEXT,
    "refunds_payment_intent_id" TEXT,
    "failure_reason" TEXT,
    "succeeded_at" TIMESTAMP(3),
    "canceled_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "payment_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "payment_events_stripe_refund_id_key" ON "payment_events"("stripe_refund_id");

-- CreateIndex
CREATE INDEX "payment_events_organization_id_created_at_idx" ON "payment_events"("organization_id", "created_at");

-- CreateIndex
CREATE INDEX "payment_events_user_id_created_at_idx" ON "payment_events"("user_id", "created_at");

-- CreateIndex
CREATE INDEX "payment_events_stripe_payment_intent_id_idx" ON "payment_events"("stripe_payment_intent_id");

-- CreateIndex
CREATE INDEX "payment_events_stripe_checkout_session_id_idx" ON "payment_events"("stripe_checkout_session_id");

-- CreateIndex
CREATE UNIQUE INDEX "payment_events_pi_kind_key" ON "payment_events"("stripe_payment_intent_id", "kind");
