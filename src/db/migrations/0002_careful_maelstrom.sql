ALTER TABLE "views" RENAME COLUMN "viewer_ip" TO "viewer_ip_hash";--> statement-breakpoint
ALTER TABLE "views" DROP CONSTRAINT "view_actor_required_check";--> statement-breakpoint
DELETE FROM "views" WHERE "user_id" IS NULL AND "viewer_ip_hash" IS NOT NULL;--> statement-breakpoint
UPDATE "views" SET "viewer_ip_hash" = NULL WHERE "user_id" IS NOT NULL AND "viewer_ip_hash" IS NOT NULL;--> statement-breakpoint
ALTER TABLE "views" ADD CONSTRAINT "view_actor_required_check" CHECK ("views"."user_id" is not null or "views"."viewer_ip_hash" is not null);
