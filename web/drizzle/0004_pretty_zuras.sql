CREATE TABLE "storefronts" (
	"id" text PRIMARY KEY NOT NULL,
	"owner" text NOT NULL,
	"slug" text NOT NULL,
	"title" text NOT NULL,
	"blurb" text NOT NULL,
	"template" text NOT NULL,
	"products" jsonb NOT NULL,
	"state" text NOT NULL,
	"written_by" text NOT NULL,
	"currency" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "storefronts_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE INDEX "storefronts_by_owner" ON "storefronts" USING btree ("owner","created_at");