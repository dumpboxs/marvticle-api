import { boolean, pgTable, serial, text, timestamp } from "drizzle-orm/pg-core";

export const todoTable = pgTable("todos", {
  id: serial("id").primaryKey(),
  title: text("title").notNull(),
  description: text("description"),
  completed: boolean("completed").default(false).notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export type InsertTodo = typeof todoTable.$inferInsert;
export type SelectTodo = typeof todoTable.$inferSelect;
