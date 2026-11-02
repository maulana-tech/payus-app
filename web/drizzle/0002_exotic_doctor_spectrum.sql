CREATE TABLE "payouts" (
	"id" text PRIMARY KEY NOT NULL,
	"owner" text NOT NULL,
	"sender_batch_id" text NOT NULL,
	"destination" text NOT NULL,
	"amount_minor" numeric(20, 0) NOT NULL,
	"currency" text NOT NULL,
	"status" text NOT NULL,
	"batch_id" text,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "payouts_sender_batch_id_unique" UNIQUE("sender_batch_id")
);
--> statement-breakpoint
CREATE TABLE "split_rules" (
	"id" text PRIMARY KEY NOT NULL,
	"owner" text NOT NULL,
	"name" text NOT NULL,
	"target" text NOT NULL,
	"kind" text NOT NULL,
	"value" numeric(20, 0) NOT NULL,
	"priority" integer NOT NULL,
	"state" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "payouts_by_owner" ON "payouts" USING btree ("owner","created_at");--> statement-breakpoint
CREATE INDEX "split_rules_by_owner" ON "split_rules" USING btree ("owner","priority");