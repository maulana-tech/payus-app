CREATE TABLE "telegram_links" (
	"owner" text PRIMARY KEY NOT NULL,
	"code" text,
	"chat_id" text,
	"linked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "telegram_links_code_unique" UNIQUE("code"),
	CONSTRAINT "telegram_links_chat_id_unique" UNIQUE("chat_id")
);
