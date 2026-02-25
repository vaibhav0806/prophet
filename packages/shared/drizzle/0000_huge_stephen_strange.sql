CREATE TABLE "deposits" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"tx_hash" text NOT NULL,
	"token" text NOT NULL,
	"amount" bigint NOT NULL,
	"confirmed_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "deposits_tx_hash_unique" UNIQUE("tx_hash")
);
--> statement-breakpoint
CREATE TABLE "markets" (
	"id" text PRIMARY KEY NOT NULL,
	"condition_id" text NOT NULL,
	"title" text NOT NULL,
	"category" text,
	"probable_market_id" text,
	"predict_market_id" text,
	"resolves_at" timestamp,
	"last_updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "trades" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"market_id" text NOT NULL,
	"status" text NOT NULL,
	"leg_a" jsonb NOT NULL,
	"leg_b" jsonb NOT NULL,
	"total_cost" bigint NOT NULL,
	"expected_payout" bigint NOT NULL,
	"spread_bps" integer NOT NULL,
	"pnl" bigint,
	"opened_at" timestamp DEFAULT now() NOT NULL,
	"closed_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "trading_wallets" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"address" text NOT NULL,
	"privy_wallet_id" text NOT NULL,
	"safe_proxy_address" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "trading_wallets_address_unique" UNIQUE("address")
);
--> statement-breakpoint
CREATE TABLE "user_configs" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"min_trade_size" bigint DEFAULT 1000000 NOT NULL,
	"max_trade_size" bigint DEFAULT 500000000 NOT NULL,
	"min_spread_bps" integer DEFAULT 100 NOT NULL,
	"max_total_trades" integer,
	"trading_duration_ms" bigint,
	"trading_started_at" timestamp,
	"daily_loss_limit" bigint DEFAULT 50000000 NOT NULL,
	"max_resolution_days" integer,
	"agent_status" text DEFAULT 'stopped' NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "user_configs_user_id_unique" UNIQUE("user_id")
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" text PRIMARY KEY NOT NULL,
	"wallet_address" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"last_login_at" timestamp,
	CONSTRAINT "users_wallet_address_unique" UNIQUE("wallet_address")
);
--> statement-breakpoint
CREATE TABLE "withdrawals" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"to_address" text NOT NULL,
	"token" text NOT NULL,
	"amount" bigint NOT NULL,
	"tx_hash" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"processed_at" timestamp
);
--> statement-breakpoint
ALTER TABLE "deposits" ADD CONSTRAINT "deposits_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trades" ADD CONSTRAINT "trades_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trading_wallets" ADD CONSTRAINT "trading_wallets_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_configs" ADD CONSTRAINT "user_configs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "withdrawals" ADD CONSTRAINT "withdrawals_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "markets_condition_id_idx" ON "markets" USING btree ("condition_id");--> statement-breakpoint
CREATE INDEX "trades_user_id_idx" ON "trades" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "trades_market_id_idx" ON "trades" USING btree ("market_id");