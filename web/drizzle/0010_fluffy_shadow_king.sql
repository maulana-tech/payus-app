CREATE TABLE "advisor_turns" (
	"id" text PRIMARY KEY NOT NULL,
	"owner" text NOT NULL,
	"question" text NOT NULL,
	"query" text NOT NULL,
	"why" text NOT NULL,
	"caption" text NOT NULL,
	"rows" jsonb NOT NULL,
	"answer" text NOT NULL,
	"model" text NOT NULL,
	"picked_by" text NOT NULL,
	"took_ms" integer NOT NULL,
	"asked_via" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "advisor_turns_by_owner" ON "advisor_turns" USING btree ("owner","created_at");