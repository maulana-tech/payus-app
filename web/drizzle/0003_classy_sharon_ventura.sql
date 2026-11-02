CREATE TABLE "approvals" (
	"id" text PRIMARY KEY NOT NULL,
	"proposal_id" text NOT NULL,
	"hash" text NOT NULL,
	"approved_by" text NOT NULL,
	"via" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "audit_log" (
	"id" text PRIMARY KEY NOT NULL,
	"owner" text NOT NULL,
	"proposal_id" text,
	"action" text NOT NULL,
	"actor" text NOT NULL,
	"detail" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "guardian_policies" (
	"owner" text PRIMARY KEY NOT NULL,
	"per_transaction_minor" numeric(20, 0) NOT NULL,
	"per_day_minor" numeric(20, 0) NOT NULL,
	"approve_above_minor" numeric(20, 0) NOT NULL,
	"new_recipient_needs_approval" boolean NOT NULL,
	"expiry_minutes" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "proposals" (
	"id" text PRIMARY KEY NOT NULL,
	"owner" text NOT NULL,
	"kind" text NOT NULL,
	"payload" jsonb NOT NULL,
	"hash" text NOT NULL,
	"status" text NOT NULL,
	"verdict" text NOT NULL,
	"reason" text NOT NULL,
	"findings" jsonb NOT NULL,
	"proposed_by" text NOT NULL,
	"model" text,
	"expires_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "approvals_by_proposal" ON "approvals" USING btree ("proposal_id","created_at");--> statement-breakpoint
CREATE INDEX "audit_log_by_owner" ON "audit_log" USING btree ("owner","created_at");--> statement-breakpoint
CREATE INDEX "proposals_by_owner" ON "proposals" USING btree ("owner","created_at");--> statement-breakpoint
CREATE INDEX "proposals_waiting" ON "proposals" USING btree ("status","expires_at");