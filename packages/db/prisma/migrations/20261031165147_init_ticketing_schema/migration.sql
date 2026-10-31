-- CreateEnum
CREATE TYPE "membership_role" AS ENUM ('STAFF', 'ADMIN');

-- CreateEnum
CREATE TYPE "event_status" AS ENUM ('DRAFT', 'PUBLISHED', 'ON_SALE', 'SOLD_OUT', 'CANCELLED', 'COMPLETED');

-- CreateEnum
CREATE TYPE "event_seat_status" AS ENUM ('AVAILABLE', 'HELD', 'SOLD');

-- CreateEnum
CREATE TYPE "hold_kind" AS ENUM ('SEATED', 'GA');

-- CreateEnum
CREATE TYPE "hold_status" AS ENUM ('ACTIVE', 'CONVERTED', 'EXPIRED', 'RELEASED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "order_status" AS ENUM ('PENDING_PAYMENT', 'PAID', 'DECLINED', 'PARTIALLY_REFUNDED', 'REFUNDED');

-- CreateEnum
CREATE TYPE "payment_provider" AS ENUM ('FAKE');

-- CreateEnum
CREATE TYPE "payment_status" AS ENUM ('PENDING', 'SUCCEEDED', 'DECLINED', 'TIMED_OUT');

-- CreateEnum
CREATE TYPE "ticket_status" AS ENUM ('VALID', 'REFUNDED');

-- CreateEnum
CREATE TYPE "idempotency_status" AS ENUM ('PROCESSING', 'COMPLETED');

-- CreateTable
CREATE TABLE "users" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "password_hash" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "organisers" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'INR',
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "organisers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "organiser_memberships" (
    "id" TEXT NOT NULL,
    "organiser_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "role" "membership_role" NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "organiser_memberships_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "venues" (
    "id" TEXT NOT NULL,
    "organiser_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "address" TEXT NOT NULL,
    "city" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "venues_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sections" (
    "id" TEXT NOT NULL,
    "venue_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sections_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "rows" (
    "id" TEXT NOT NULL,
    "section_id" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "rows_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "seats" (
    "id" TEXT NOT NULL,
    "row_id" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "seats_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "events" (
    "id" TEXT NOT NULL,
    "organiser_id" TEXT NOT NULL,
    "venue_id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "status" "event_status" NOT NULL DEFAULT 'DRAFT',
    "starts_at" TIMESTAMPTZ(3) NOT NULL,
    "ends_at" TIMESTAMPTZ(3),
    "refund_window_hours" INTEGER NOT NULL DEFAULT 24,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ticket_tiers" (
    "id" TEXT NOT NULL,
    "event_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "price_minor" INTEGER NOT NULL,
    "total_quantity" INTEGER NOT NULL,
    "remaining_quantity" INTEGER NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "ticket_tiers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "event_seats" (
    "id" TEXT NOT NULL,
    "event_id" TEXT NOT NULL,
    "seat_id" TEXT NOT NULL,
    "status" "event_seat_status" NOT NULL DEFAULT 'AVAILABLE',
    "price_minor" INTEGER NOT NULL,
    "hold_id" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "event_seats_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "holds" (
    "id" TEXT NOT NULL,
    "event_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "kind" "hold_kind" NOT NULL,
    "status" "hold_status" NOT NULL DEFAULT 'ACTIVE',
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    "ga_ticket_tier_id" TEXT,
    "ga_quantity" INTEGER,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "holds_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "orders" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "event_id" TEXT NOT NULL,
    "hold_id" TEXT NOT NULL,
    "status" "order_status" NOT NULL DEFAULT 'PENDING_PAYMENT',
    "total_amount_minor" INTEGER NOT NULL,
    "paid_by_payment_id" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "orders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payments" (
    "id" TEXT NOT NULL,
    "order_id" TEXT NOT NULL,
    "provider" "payment_provider" NOT NULL DEFAULT 'FAKE',
    "status" "payment_status" NOT NULL DEFAULT 'PENDING',
    "amount_minor" INTEGER NOT NULL,
    "external_ref" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolved_at" TIMESTAMPTZ(3),

    CONSTRAINT "payments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tickets" (
    "id" TEXT NOT NULL,
    "order_id" TEXT NOT NULL,
    "event_id" TEXT NOT NULL,
    "event_seat_id" TEXT,
    "ticket_tier_id" TEXT,
    "code" TEXT NOT NULL,
    "price_minor" INTEGER NOT NULL,
    "status" "ticket_status" NOT NULL DEFAULT 'VALID',
    "checked_in_at" TIMESTAMPTZ(3),
    "checked_in_by_user_id" TEXT,
    "refund_id" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "tickets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "refunds" (
    "id" TEXT NOT NULL,
    "order_id" TEXT NOT NULL,
    "amount_minor" INTEGER NOT NULL,
    "reason" TEXT NOT NULL,
    "requested_by_user_id" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "refunds_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "reviews" (
    "id" TEXT NOT NULL,
    "event_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "rating" INTEGER NOT NULL,
    "text" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "reviews_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_logs" (
    "id" TEXT NOT NULL,
    "actor_user_id" TEXT,
    "organiser_id" TEXT,
    "action" TEXT NOT NULL,
    "entity_type" TEXT NOT NULL,
    "entity_id" TEXT NOT NULL,
    "before_data" JSONB,
    "after_data" JSONB,
    "request_id" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "idempotency_records" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "endpoint" TEXT NOT NULL,
    "request_hash" TEXT NOT NULL,
    "status" "idempotency_status" NOT NULL DEFAULT 'PROCESSING',
    "lock_token" TEXT NOT NULL,
    "response_status" INTEGER,
    "response_body" JSONB,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "idempotency_records_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE INDEX "organiser_memberships_user_id_idx" ON "organiser_memberships"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "organiser_memberships_organiser_id_user_id_key" ON "organiser_memberships"("organiser_id", "user_id");

-- CreateIndex
CREATE INDEX "venues_organiser_id_idx" ON "venues"("organiser_id");

-- CreateIndex
CREATE INDEX "venues_city_idx" ON "venues"("city");

-- CreateIndex
CREATE UNIQUE INDEX "venues_id_organiser_id_key" ON "venues"("id", "organiser_id");

-- CreateIndex
CREATE UNIQUE INDEX "sections_venue_id_name_key" ON "sections"("venue_id", "name");

-- CreateIndex
CREATE UNIQUE INDEX "rows_section_id_label_key" ON "rows"("section_id", "label");

-- CreateIndex
CREATE UNIQUE INDEX "seats_row_id_label_key" ON "seats"("row_id", "label");

-- CreateIndex
CREATE INDEX "events_organiser_id_idx" ON "events"("organiser_id");

-- CreateIndex
CREATE INDEX "events_status_created_at_id_idx" ON "events"("status", "created_at", "id");

-- CreateIndex
CREATE INDEX "events_category_idx" ON "events"("category");

-- CreateIndex
CREATE INDEX "ticket_tiers_event_id_idx" ON "ticket_tiers"("event_id");

-- CreateIndex
CREATE UNIQUE INDEX "ticket_tiers_event_id_name_key" ON "ticket_tiers"("event_id", "name");

-- CreateIndex
CREATE INDEX "event_seats_hold_id_idx" ON "event_seats"("hold_id");

-- CreateIndex
CREATE INDEX "event_seats_event_id_status_idx" ON "event_seats"("event_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "event_seats_event_id_seat_id_key" ON "event_seats"("event_id", "seat_id");

-- CreateIndex
CREATE INDEX "holds_event_id_user_id_status_idx" ON "holds"("event_id", "user_id", "status");

-- CreateIndex
CREATE INDEX "holds_status_expires_at_idx" ON "holds"("status", "expires_at");

-- CreateIndex
CREATE UNIQUE INDEX "orders_hold_id_key" ON "orders"("hold_id");

-- CreateIndex
CREATE UNIQUE INDEX "orders_paid_by_payment_id_key" ON "orders"("paid_by_payment_id");

-- CreateIndex
CREATE INDEX "orders_user_id_created_at_id_idx" ON "orders"("user_id", "created_at", "id");

-- CreateIndex
CREATE INDEX "orders_event_id_idx" ON "orders"("event_id");

-- CreateIndex
CREATE INDEX "payments_order_id_idx" ON "payments"("order_id");

-- CreateIndex
CREATE INDEX "payments_external_ref_idx" ON "payments"("external_ref");

-- CreateIndex
CREATE UNIQUE INDEX "tickets_event_seat_id_key" ON "tickets"("event_seat_id");

-- CreateIndex
CREATE UNIQUE INDEX "tickets_code_key" ON "tickets"("code");

-- CreateIndex
CREATE INDEX "tickets_order_id_idx" ON "tickets"("order_id");

-- CreateIndex
CREATE INDEX "tickets_event_id_idx" ON "tickets"("event_id");

-- CreateIndex
CREATE INDEX "refunds_order_id_idx" ON "refunds"("order_id");

-- CreateIndex
CREATE INDEX "reviews_event_id_created_at_id_idx" ON "reviews"("event_id", "created_at", "id");

-- CreateIndex
CREATE UNIQUE INDEX "reviews_event_id_user_id_key" ON "reviews"("event_id", "user_id");

-- CreateIndex
CREATE INDEX "audit_logs_organiser_id_created_at_id_idx" ON "audit_logs"("organiser_id", "created_at", "id");

-- CreateIndex
CREATE INDEX "audit_logs_entity_type_entity_id_created_at_id_idx" ON "audit_logs"("entity_type", "entity_id", "created_at", "id");

-- CreateIndex
CREATE INDEX "audit_logs_actor_user_id_idx" ON "audit_logs"("actor_user_id");

-- CreateIndex
CREATE UNIQUE INDEX "idempotency_records_user_id_key_endpoint_key" ON "idempotency_records"("user_id", "key", "endpoint");

-- AddForeignKey
ALTER TABLE "organiser_memberships" ADD CONSTRAINT "organiser_memberships_organiser_id_fkey" FOREIGN KEY ("organiser_id") REFERENCES "organisers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "organiser_memberships" ADD CONSTRAINT "organiser_memberships_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "venues" ADD CONSTRAINT "venues_organiser_id_fkey" FOREIGN KEY ("organiser_id") REFERENCES "organisers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sections" ADD CONSTRAINT "sections_venue_id_fkey" FOREIGN KEY ("venue_id") REFERENCES "venues"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rows" ADD CONSTRAINT "rows_section_id_fkey" FOREIGN KEY ("section_id") REFERENCES "sections"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "seats" ADD CONSTRAINT "seats_row_id_fkey" FOREIGN KEY ("row_id") REFERENCES "rows"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "events" ADD CONSTRAINT "events_organiser_id_fkey" FOREIGN KEY ("organiser_id") REFERENCES "organisers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "events" ADD CONSTRAINT "events_venue_id_organiser_id_fkey" FOREIGN KEY ("venue_id", "organiser_id") REFERENCES "venues"("id", "organiser_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ticket_tiers" ADD CONSTRAINT "ticket_tiers_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "events"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "event_seats" ADD CONSTRAINT "event_seats_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "events"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "event_seats" ADD CONSTRAINT "event_seats_seat_id_fkey" FOREIGN KEY ("seat_id") REFERENCES "seats"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "event_seats" ADD CONSTRAINT "event_seats_hold_id_fkey" FOREIGN KEY ("hold_id") REFERENCES "holds"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "holds" ADD CONSTRAINT "holds_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "events"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "holds" ADD CONSTRAINT "holds_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "holds" ADD CONSTRAINT "holds_ga_ticket_tier_id_fkey" FOREIGN KEY ("ga_ticket_tier_id") REFERENCES "ticket_tiers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "orders" ADD CONSTRAINT "orders_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "orders" ADD CONSTRAINT "orders_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "events"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "orders" ADD CONSTRAINT "orders_hold_id_fkey" FOREIGN KEY ("hold_id") REFERENCES "holds"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "orders" ADD CONSTRAINT "orders_paid_by_payment_id_fkey" FOREIGN KEY ("paid_by_payment_id") REFERENCES "payments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tickets" ADD CONSTRAINT "tickets_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tickets" ADD CONSTRAINT "tickets_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "events"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tickets" ADD CONSTRAINT "tickets_event_seat_id_fkey" FOREIGN KEY ("event_seat_id") REFERENCES "event_seats"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tickets" ADD CONSTRAINT "tickets_ticket_tier_id_fkey" FOREIGN KEY ("ticket_tier_id") REFERENCES "ticket_tiers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tickets" ADD CONSTRAINT "tickets_checked_in_by_user_id_fkey" FOREIGN KEY ("checked_in_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tickets" ADD CONSTRAINT "tickets_refund_id_fkey" FOREIGN KEY ("refund_id") REFERENCES "refunds"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "refunds" ADD CONSTRAINT "refunds_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "refunds" ADD CONSTRAINT "refunds_requested_by_user_id_fkey" FOREIGN KEY ("requested_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reviews" ADD CONSTRAINT "reviews_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "events"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reviews" ADD CONSTRAINT "reviews_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_actor_user_id_fkey" FOREIGN KEY ("actor_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_organiser_id_fkey" FOREIGN KEY ("organiser_id") REFERENCES "organisers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "idempotency_records" ADD CONSTRAINT "idempotency_records_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
