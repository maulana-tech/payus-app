CREATE TABLE "ledger_accounts" (
	"id" text PRIMARY KEY NOT NULL,
	"kind" text NOT NULL,
	"owner" text,
	"label" text NOT NULL,
	"currency" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ledger_entries" (
	"id" text PRIMARY KEY NOT NULL,
	"txn_id" text NOT NULL,
	"account" text NOT NULL,
	"debit_minor" numeric(20, 0) DEFAULT '0' NOT NULL,
	"credit_minor" numeric(20, 0) DEFAULT '0' NOT NULL,
	"currency" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ledger_txns" (
	"id" text PRIMARY KEY NOT NULL,
	"kind" text NOT NULL,
	"owner" text,
	"ref" text,
	"memo" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "outbox" (
	"id" text PRIMARY KEY NOT NULL,
	"topic" text NOT NULL,
	"payload" jsonb NOT NULL,
	"status" text NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"available_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"processed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "payments" (
	"id" text PRIMARY KEY NOT NULL,
	"invoice_id" text NOT NULL,
	"owner" text NOT NULL,
	"provider" text NOT NULL,
	"order_id" text NOT NULL,
	"capture_id" text,
	"status" text NOT NULL,
	"amount_minor" numeric(20, 0) NOT NULL,
	"captured_minor" numeric(20, 0),
	"fee_minor" numeric(20, 0),
	"currency" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "payments_order_id_unique" UNIQUE("order_id"),
	CONSTRAINT "payments_capture_id_unique" UNIQUE("capture_id")
);
--> statement-breakpoint
CREATE TABLE "webhook_events" (
	"event_id" text PRIMARY KEY NOT NULL,
	"provider" text NOT NULL,
	"event_type" text NOT NULL,
	"payload" jsonb NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_txn_id_ledger_txns_id_fk" FOREIGN KEY ("txn_id") REFERENCES "public"."ledger_txns"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_account_ledger_accounts_id_fk" FOREIGN KEY ("account") REFERENCES "public"."ledger_accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ledger_accounts_by_owner" ON "ledger_accounts" USING btree ("owner","kind");--> statement-breakpoint
CREATE INDEX "ledger_entries_by_txn" ON "ledger_entries" USING btree ("txn_id");--> statement-breakpoint
CREATE INDEX "ledger_entries_by_account" ON "ledger_entries" USING btree ("account","created_at");--> statement-breakpoint
CREATE INDEX "ledger_txns_recent" ON "ledger_txns" USING btree ("owner","created_at");--> statement-breakpoint
CREATE INDEX "outbox_ready" ON "outbox" USING btree ("status","available_at");--> statement-breakpoint
CREATE INDEX "payments_by_invoice" ON "payments" USING btree ("invoice_id");--> statement-breakpoint
CREATE INDEX "payments_by_owner" ON "payments" USING btree ("owner","created_at");