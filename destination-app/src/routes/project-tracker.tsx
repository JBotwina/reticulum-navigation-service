import { useRouter } from '@tanstack/react-router'
import { createFileRoute } from '@tanstack/react-router'
import { createServerFn } from '@tanstack/react-start'

type ProjectTrackerTaskStatus = 'todo' | 'in_progress' | 'done'

type CreateProjectPayload = {
  name: string
}

type CreateTaskPayload = {
  projectId?: number
  title: string
  details?: string
}

type UpdateTaskPayload = {
  id: number
  projectId: number
  title: string
  details?: string
  status: ProjectTrackerTaskStatus
}

type DeleteTaskPayload = {
  id: number
}

const statusOptions: Array<{ label: string; value: ProjectTrackerTaskStatus }> = [
  { label: 'Todo', value: 'todo' },
  { label: 'In Progress', value: 'in_progress' },
  { label: 'Done', value: 'done' },
]

const listProjectTrackerState = createServerFn({ method: 'GET' }).handler(
  async () => {
    const projectTrackerRepository = await import(
      '#/server/projectTracker/repository'
    )
    await projectTrackerRepository.seedDefaultProject()
    return projectTrackerRepository.listProjectTrackerState()
  },
)

const createProject = createServerFn({ method: 'POST' })
  .inputValidator((data: CreateProjectPayload) => data)
  .handler(async ({ data }) => {
    const projectTrackerRepository = await import(
      '#/server/projectTracker/repository'
    )
    await projectTrackerRepository.createProject(data)
  })

const createTask = createServerFn({ method: 'POST' })
  .inputValidator((data: CreateTaskPayload) => data)
  .handler(async ({ data }) => {
    const projectTrackerRepository = await import(
      '#/server/projectTracker/repository'
    )
    const projectId = await projectTrackerRepository.getProjectIdOrDefault(
      data.projectId,
    )
    await projectTrackerRepository.createTask({
      projectId,
      title: data.title,
      details: data.details,
    })
  })

const updateTask = createServerFn({ method: 'POST' })
  .inputValidator((data: UpdateTaskPayload) => data)
  .handler(async ({ data }) => {
    const projectTrackerRepository = await import(
      '#/server/projectTracker/repository'
    )
    await projectTrackerRepository.updateTask(data)
  })

const deleteTask = createServerFn({ method: 'POST' })
  .inputValidator((data: DeleteTaskPayload) => data)
  .handler(async ({ data }) => {
    const projectTrackerRepository = await import(
      '#/server/projectTracker/repository'
    )
    await projectTrackerRepository.deleteTask(data.id)
  })

export const Route = createFileRoute('/project-tracker')({
  component: ProjectTrackerPage,
  loader: async () => listProjectTrackerState(),
})

function ProjectTrackerPage() {
  const router = useRouter()
  const data = Route.useLoaderData()

  return (
    <main className="page-wrap px-4 pb-8 pt-14">
      <section className="island-shell rounded-2xl p-6 sm:p-8">
        <p className="island-kicker mb-2">Database Integration Test</p>
        <h1 className="display-title m-0 text-4xl font-bold text-[var(--sea-ink)] sm:text-5xl">
          Project Tracker CRUD
        </h1>
        <p className="mt-3 text-sm text-[var(--sea-ink-soft)]">
          Create projects and tasks, then update or delete tasks to verify Drizzle
          + Postgres is fully connected.
        </p>
      </section>

      <section className="mt-6 grid gap-4 lg:grid-cols-2">
        <article className="island-shell rounded-2xl p-5">
          <h2 className="m-0 text-lg font-semibold text-[var(--sea-ink)]">
            Create Project
          </h2>
          <form
            className="mt-4 flex gap-2"
            onSubmit={async (event) => {
              event.preventDefault()
              const formData = new FormData(event.currentTarget)
              const name = String(formData.get('name') ?? '')

              await createProject({ data: { name } })
              event.currentTarget.reset()
              await router.invalidate()
            }}
          >
            <input
              name="name"
              placeholder="Project name"
              className="w-full rounded-xl border border-[var(--line)] bg-[var(--surface-strong)] px-3 py-2 text-sm"
              required
            />
            <button
              type="submit"
              className="rounded-xl border border-[var(--chip-line)] bg-[var(--chip-bg)] px-4 py-2 text-sm font-semibold"
            >
              Add
            </button>
          </form>
        </article>

        <article className="island-shell rounded-2xl p-5">
          <h2 className="m-0 text-lg font-semibold text-[var(--sea-ink)]">
            Create Task
          </h2>
          <form
            className="mt-4 grid gap-2"
            onSubmit={async (event) => {
              event.preventDefault()
              const formData = new FormData(event.currentTarget)
              const projectIdRaw = String(formData.get('projectId') ?? '')
              const projectId = Number(projectIdRaw)
              const title = String(formData.get('title') ?? '')
              const details = String(formData.get('details') ?? '')

              await createTask({
                data: {
                  projectId: Number.isFinite(projectId) ? projectId : undefined,
                  title,
                  details,
                },
              })
              event.currentTarget.reset()
              await router.invalidate()
            }}
          >
            <select
              name="projectId"
              className="rounded-xl border border-[var(--line)] bg-[var(--surface-strong)] px-3 py-2 text-sm"
              required
              defaultValue={String(data.projects[0]?.id ?? '')}
            >
              {data.projects.map((project) => (
                <option key={project.id} value={project.id}>
                  {project.name}
                </option>
              ))}
            </select>
            <input
              name="title"
              placeholder="Task title"
              className="rounded-xl border border-[var(--line)] bg-[var(--surface-strong)] px-3 py-2 text-sm"
              required
            />
            <textarea
              name="details"
              placeholder="Task details"
              className="min-h-24 rounded-xl border border-[var(--line)] bg-[var(--surface-strong)] px-3 py-2 text-sm"
            />
            <button
              type="submit"
              className="rounded-xl border border-[var(--chip-line)] bg-[var(--chip-bg)] px-4 py-2 text-sm font-semibold"
            >
              Save Task
            </button>
          </form>
        </article>
      </section>

      <section className="mt-6 space-y-3">
        {data.tasks.map((task) => (
          <article key={task.id} className="island-shell rounded-2xl p-5">
            <form
              className="grid gap-2 lg:grid-cols-[1fr_180px_150px_auto]"
              onSubmit={async (event) => {
                event.preventDefault()
                const formData = new FormData(event.currentTarget)
                const projectId = Number(String(formData.get('projectId') ?? ''))
                const title = String(formData.get('title') ?? '')
                const details = String(formData.get('details') ?? '')
                const status = String(formData.get('status') ?? 'todo')

                await updateTask({
                  data: {
                    id: task.id,
                    projectId,
                    title,
                    details,
                    status: isTaskStatus(status) ? status : 'todo',
                  },
                })

                await router.invalidate()
              }}
            >
              <div className="grid gap-2">
                <input
                  name="title"
                  defaultValue={task.title}
                  className="rounded-xl border border-[var(--line)] bg-[var(--surface-strong)] px-3 py-2 text-sm"
                  required
                />
                <textarea
                  name="details"
                  defaultValue={task.details ?? ''}
                  className="min-h-20 rounded-xl border border-[var(--line)] bg-[var(--surface-strong)] px-3 py-2 text-sm"
                />
              </div>
              <select
                name="projectId"
                defaultValue={String(task.projectId)}
                className="rounded-xl border border-[var(--line)] bg-[var(--surface-strong)] px-3 py-2 text-sm"
              >
                {data.projects.map((project) => (
                  <option key={project.id} value={project.id}>
                    {project.name}
                  </option>
                ))}
              </select>
              <select
                name="status"
                defaultValue={task.status}
                className="rounded-xl border border-[var(--line)] bg-[var(--surface-strong)] px-3 py-2 text-sm"
              >
                {statusOptions.map((statusOption) => (
                  <option key={statusOption.value} value={statusOption.value}>
                    {statusOption.label}
                  </option>
                ))}
              </select>
              <div className="flex gap-2">
                <button
                  type="submit"
                  className="rounded-xl border border-[var(--chip-line)] bg-[var(--chip-bg)] px-4 py-2 text-sm font-semibold"
                >
                  Update
                </button>
                <button
                  type="button"
                  className="rounded-xl border border-[rgba(130,45,60,0.28)] bg-[rgba(170,64,85,0.12)] px-4 py-2 text-sm font-semibold text-[rgb(132,45,66)]"
                  onClick={async () => {
                    await deleteTask({ data: { id: task.id } })
                    await router.invalidate()
                  }}
                >
                  Delete
                </button>
              </div>
            </form>
          </article>
        ))}
      </section>
    </main>
  )
}

function isTaskStatus(value: string): value is ProjectTrackerTaskStatus {
  return value === 'todo' || value === 'in_progress' || value === 'done'
}
