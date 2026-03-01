import {
	integer,
	pgSchema,
	text,
	timestamp,
	uniqueIndex,
} from "drizzle-orm/pg-core";

const appSchema = pgSchema("app");

export const projectTrackerTaskStatusEnum = appSchema.enum(
	"project_tracker_task_status",
	["todo", "in_progress", "done"],
);

export const projectTrackerProjects = appSchema.table(
	"project_tracker_projects",
	{
		id: integer().primaryKey().generatedAlwaysAsIdentity(),
		name: text().notNull(),
		createdAt: timestamp({ withTimezone: true }).defaultNow().notNull(),
		updatedAt: timestamp({ withTimezone: true }).defaultNow().notNull(),
	},
	(table) => [
		uniqueIndex("project_tracker_projects_name_unique").on(table.name),
	],
);

export const projectTrackerTasks = appSchema.table("project_tracker_tasks", {
	id: integer().primaryKey().generatedAlwaysAsIdentity(),
	projectId: integer()
		.notNull()
		.references(() => projectTrackerProjects.id, { onDelete: "cascade" }),
	title: text().notNull(),
	details: text(),
	status: projectTrackerTaskStatusEnum().default("todo").notNull(),
	createdAt: timestamp({ withTimezone: true }).defaultNow().notNull(),
	updatedAt: timestamp({ withTimezone: true }).defaultNow().notNull(),
});

export const healthChecks = appSchema.table("health_checks", {
	id: integer().primaryKey().generatedAlwaysAsIdentity(),
	status: text().notNull(),
	createdAt: timestamp({ withTimezone: true }).defaultNow().notNull(),
});
