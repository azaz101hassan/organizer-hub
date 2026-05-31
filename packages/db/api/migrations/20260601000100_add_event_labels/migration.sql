-- Per-org event categorization. EventLabel is admin-managed; Event.label_id
-- is a nullable SET NULL FK so deleting a label clears its references without
-- cascading event deletes. Existing event rows backfill as NULL.
--
-- Hand-written + applied via migrate deploy to match the project's prod-style
-- migration flow.

CREATE TABLE "event_labels" (
    "id"              TEXT         NOT NULL,
    "organization_id" TEXT         NOT NULL,
    "name"            TEXT         NOT NULL,
    "slug"            TEXT         NOT NULL,
    "sort_order"      INTEGER      NOT NULL DEFAULT 0,
    "created_at"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at"      TIMESTAMP(3) NOT NULL,

    CONSTRAINT "event_labels_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "event_labels_organization_id_slug_key"
    ON "event_labels"("organization_id", "slug");

CREATE INDEX "event_labels_organization_id_sort_order_idx"
    ON "event_labels"("organization_id", "sort_order");

ALTER TABLE "event_labels"
    ADD CONSTRAINT "event_labels_organization_id_fkey"
    FOREIGN KEY ("organization_id") REFERENCES "organizations"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

-- Add events.label_id nullable FK.
ALTER TABLE "events" ADD COLUMN "label_id" TEXT;

ALTER TABLE "events"
    ADD CONSTRAINT "events_label_id_fkey"
    FOREIGN KEY ("label_id") REFERENCES "event_labels"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "events_label_id_idx" ON "events"("label_id");
