CREATE TABLE "api_keys" (
	"id" text PRIMARY KEY NOT NULL,
	"owner" text NOT NULL,
	"name" text NOT NULL,
	"secret_hash" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_used_at" timestamp with time zone,
	"revoked_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "invoices" (
	"id" text PRIMARY KEY NOT NULL,
	"owner" text NOT NULL,
	"number" text NOT NULL,
	"token" text NOT NULL,
	"client_name" text NOT NULL,
	"client_email" text,
	"items" jsonb NOT NULL,
	"total_minor" numeric(20, 0) NOT NULL,
	"currency" text NOT NULL,
	"notes" text NOT NULL,
	"due_date" text NOT NULL,
	"status" text NOT NULL,
	"source" text,
	"reference" text,
	"recurrence" text,
	"next_issue_at" timestamp with time zone,
	"series_number" text,
	"series_index" integer,
	"reminder_sent_at" timestamp with time zone,
	"paid_minor" numeric(20, 0) NOT NULL,
	"paid_reported_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "invoices_token_unique" UNIQUE("token")
);
--> statement-breakpoint
CREATE TABLE "notification_logs" (
	"id" text PRIMARY KEY NOT NULL,
	"recipient_email" text NOT NULL,
	"event_type" text NOT NULL,
	"sent_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "notification_settings" (
	"user_id" text PRIMARY KEY NOT NULL,
	"email" text NOT NULL,
	"enabled" boolean NOT NULL,
	"events" jsonb NOT NULL,
	"unsubscribe_token" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "notification_settings_unsubscribe_token_unique" UNIQUE("unsubscribe_token")
);
--> statement-breakpoint
CREATE TABLE "payment_links" (
	"id" text PRIMARY KEY NOT NULL,
	"owner" text NOT NULL,
	"slug" text NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"amount_minor" numeric(20, 0),
	"currency" text NOT NULL,
	"state" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "payment_requests" (
	"id" text PRIMARY KEY NOT NULL,
	"from_username" text NOT NULL,
	"to_username" text NOT NULL,
	"for_payer" jsonb NOT NULL,
	"for_requester" jsonb NOT NULL,
	"status" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "profiles" (
	"username" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"sign_pubkey_hex" text NOT NULL,
	"msg_pubkey_hex" text NOT NULL,
	"claim_json" text NOT NULL,
	"claim_sig_hex" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "profiles_user_id_unique" UNIQUE("user_id")
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" text PRIMARY KEY NOT NULL,
	"email" text,
	"escrow" jsonb,
	"passkey" jsonb,
	"account_type" text,
	"business_name" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "webhook_deliveries" (
	"id" text PRIMARY KEY NOT NULL,
	"owner" text NOT NULL,
	"event" text NOT NULL,
	"status" text NOT NULL,
	"attempts" integer NOT NULL,
	"response_status" integer,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "webhooks" (
	"owner" text PRIMARY KEY NOT NULL,
	"url" text NOT NULL,
	"secret" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "api_keys_by_owner" ON "api_keys" USING btree ("owner","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "invoices_owner_number" ON "invoices" USING btree ("owner","number");--> statement-breakpoint
CREATE INDEX "invoices_owner_recent" ON "invoices" USING btree ("owner","created_at");--> statement-breakpoint
CREATE INDEX "invoices_recurring_due" ON "invoices" USING btree ("recurrence","next_issue_at");--> statement-breakpoint
CREATE INDEX "invoices_reminders_due" ON "invoices" USING btree ("status","due_date","reminder_sent_at");--> statement-breakpoint
CREATE UNIQUE INDEX "payment_links_owner_slug" ON "payment_links" USING btree ("owner","slug");--> statement-breakpoint
CREATE INDEX "payment_links_owner_recent" ON "payment_links" USING btree ("owner","created_at");--> statement-breakpoint
CREATE INDEX "payment_requests_incoming" ON "payment_requests" USING btree ("to_username","created_at");--> statement-breakpoint
CREATE INDEX "payment_requests_outgoing" ON "payment_requests" USING btree ("from_username","created_at");--> statement-breakpoint
CREATE INDEX "payment_requests_pending_incoming" ON "payment_requests" USING btree ("to_username","status");--> statement-breakpoint
CREATE INDEX "webhook_deliveries_by_owner" ON "webhook_deliveries" USING btree ("owner","created_at");