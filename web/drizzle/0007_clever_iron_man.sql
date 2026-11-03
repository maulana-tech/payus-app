CREATE TABLE "refunds" (
	"id" text PRIMARY KEY NOT NULL,
	"owner" text NOT NULL,
	"payment_id" text NOT NULL,
	"invoice_id" text NOT NULL,
	"capture_id" text NOT NULL,
	"refund_id" text NOT NULL,
	"amount_minor" numeric(20, 0) NOT NULL,
	"fee_returned_minor" numeric(20, 0) NOT NULL,
	"currency" text NOT NULL,
	"source" text NOT NULL,
	"intent_key" text,
	"reason" text,
	"status" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "refunds_refund_id_unique" UNIQUE("refund_id")
);
--> statement-breakpoint
CREATE INDEX "refunds_by_owner" ON "refunds" USING btree ("owner","created_at");--> statement-breakpoint
CREATE INDEX "refunds_by_capture" ON "refunds" USING btree ("capture_id");--> statement-breakpoint
CREATE INDEX "refunds_by_invoice" ON "refunds" USING btree ("invoice_id");--> statement-breakpoint
CREATE UNIQUE INDEX "refunds_one_per_attempt" ON "refunds" USING btree ("payment_id","intent_key");