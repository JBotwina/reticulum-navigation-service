import { asc, desc, eq } from 'drizzle-orm'
import { db } from '#/server/db/connection'
import { projectTrackerProjects, projectTrackerTasks } from '#/server/db/schema'

export type ProjectTrackerTaskStatus = 'todo' | 'in_progress' | 'done'

type CreateProjectInput = {
  name: string
}

type CreateTaskInput = {
  projectId: number
  title: string
  details?: string | null
}

type UpdateTaskInput = {
  id: number
  projectId: number
  title: string
  details?: string | null
  status: ProjectTrackerTaskStatus
}

function normalizeText(value: string) {
  return value.trim()
}

export async function listProjectTrackerState() {
  const [projects, tasks] = await Promise.all([
    db.select().from(projectTrackerProjects).orderBy(asc(projectTrackerProjects.name)),
    db.select().from(projectTrackerTasks).orderBy(desc(projectTrackerTasks.createdAt)),
  ])

  return {
    projects,
    tasks,
  }
}

export async function createProject(input: CreateProjectInput) {
  const name = normalizeText(input.name)

  if (name.length < 2) {
    throw new Error('Project name must be at least 2 characters.')
  }

  await db.insert(projectTrackerProjects).values({
    name,
    updatedAt: new Date(),
  })
}

export async function createTask(input: CreateTaskInput) {
  const title = normalizeText(input.title)
  const details = normalizeText(input.details ?? '')

  if (title.length < 2) {
    throw new Error('Task title must be at least 2 characters.')
  }

  const selectedProject = await db
    .select({ id: projectTrackerProjects.id })
    .from(projectTrackerProjects)
    .where(eq(projectTrackerProjects.id, input.projectId))
    .limit(1)

  if (selectedProject.length === 0) {
    throw new Error('Project not found.')
  }

  await db.insert(projectTrackerTasks).values({
    projectId: input.projectId,
    title,
    details: details.length > 0 ? details : null,
    status: 'todo',
    updatedAt: new Date(),
  })
}

export async function updateTask(input: UpdateTaskInput) {
  const title = normalizeText(input.title)
  const details = normalizeText(input.details ?? '')

  if (title.length < 2) {
    throw new Error('Task title must be at least 2 characters.')
  }

  await db
    .update(projectTrackerTasks)
    .set({
      projectId: input.projectId,
      title,
      details: details.length > 0 ? details : null,
      status: input.status,
      updatedAt: new Date(),
    })
    .where(eq(projectTrackerTasks.id, input.id))
}

export async function deleteTask(taskId: number) {
  await db.delete(projectTrackerTasks).where(eq(projectTrackerTasks.id, taskId))
}

export async function seedDefaultProject() {
  const existing = await db.select().from(projectTrackerProjects).limit(1)

  if (existing.length > 0) {
    return existing[0]
  }

  const created = await db
    .insert(projectTrackerProjects)
    .values({
      name: 'General',
      updatedAt: new Date(),
    })
    .returning()

  return created[0]
}

export async function getProjectIdOrDefault(projectId?: number) {
  if (projectId !== undefined) {
    const selected = await db
      .select({ id: projectTrackerProjects.id })
      .from(projectTrackerProjects)
      .where(eq(projectTrackerProjects.id, projectId))
      .limit(1)

    if (selected.length > 0) {
      return selected[0].id
    }
  }

  const fallback = await seedDefaultProject()
  return fallback.id
}
