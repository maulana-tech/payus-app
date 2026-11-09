CREATE TABLE "builder_turns" (
	"id" text PRIMARY KEY NOT NULL,
	"owner" text NOT NULL,
	"shop_id" text NOT NULL,
	"asked" text NOT NULL,
	"failed" text,
	"summary" text,
	"proposal" jsonb,
	"model" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "builder_turns" ADD CONSTRAINT "builder_turns_shop_id_storefronts_id_fk" FOREIGN KEY ("shop_id") REFERENCES "public"."storefronts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "builder_turns_by_shop" ON "builder_turns" USING btree ("shop_id","created_at");