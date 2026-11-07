CREATE TABLE "advisor_chats" (
	"id" text PRIMARY KEY NOT NULL,
	"owner" text NOT NULL,
	"title" text NOT NULL,
	"pinned" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "advisor_chats_by_owner" ON "advisor_chats" USING btree ("owner","updated_at");--> statement-breakpoint
ALTER TABLE "advisor_turns" ADD COLUMN "chat_id" text;--> statement-breakpoint
INSERT INTO "advisor_chats" ("id", "owner", "title", "created_at", "updated_at")
SELECT DISTINCT ON (t."owner")
	'chat' || md5(t."owner"),
	t."owner",
	left(t."question", 80),
	min(t."created_at") OVER (PARTITION BY t."owner"),
	max(t."created_at") OVER (PARTITION BY t."owner")
FROM "advisor_turns" t
ORDER BY t."owner", t."created_at" ASC;--> statement-breakpoint
UPDATE "advisor_turns" SET "chat_id" = 'chat' || md5("owner") WHERE "chat_id" IS NULL;--> statement-breakpoint
ALTER TABLE "advisor_turns" ALTER COLUMN "chat_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "advisor_turns" ADD CONSTRAINT "advisor_turns_chat_id_advisor_chats_id_fk" FOREIGN KEY ("chat_id") REFERENCES "public"."advisor_chats"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "advisor_turns_by_chat" ON "advisor_turns" USING btree ("chat_id","created_at");
