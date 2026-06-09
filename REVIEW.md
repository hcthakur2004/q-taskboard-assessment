# Senior Code Review - TaskBoard

## Finding 1: Any authenticated user can update any task

**File and line reference:** `src/app/api/tasks/[id]/route.ts:16-37`, especially `26-35`  
**Category:** Broken authorization / cross-project data access  
**Severity:** Critical

The `PATCH /api/tasks/:id` handler authenticates the caller, validates the body, loads the task, and immediately updates it. Unlike the `DELETE` handler in the same file, it never checks whether the caller is a member of the task's project or whether their role is `admin`/`member`. Business impact: a viewer, or even a user from another project, can change task title, description, status, assignee, and position if they know or obtain a task id.

### How to reproduce

After running the seed data, `dev@example.com` is a `viewer` on Q3 Launch. A viewer should not be able to edit tasks, but this route returns `200` and persists the change.

```bash
VIEWER_TOKEN=$(curl -s -X POST http://localhost:3000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"dev@example.com","password":"password123"}' | jq -r '.token')

PROJECT_ID=$(curl -s http://localhost:3000/api/projects \
  -H "Authorization: Bearer $VIEWER_TOKEN" | jq -r '.projects[] | select(.name=="Q3 Launch").id')

TASK_ID=$(curl -s "http://localhost:3000/api/projects/$PROJECT_ID/tasks" \
  -H "Authorization: Bearer $VIEWER_TOKEN" | jq -r '.tasks[0].id')

curl -s -X PATCH "http://localhost:3000/api/tasks/$TASK_ID" \
  -H "Authorization: Bearer $VIEWER_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"title":"viewer changed this task","status":"done"}'
```

Buggy response:

```json
{
  "task": {
    "id": "TASK_ID",
    "projectId": "PROJECT_ID",
    "title": "viewer changed this task",
    "status": "done",
    "assignee": null
  }
}
```

Expected response should be `403`:

```json
{ "error": "viewers cannot update tasks" }
```

### Recommended fix

Mirror the authorization logic already used by `DELETE`: after loading `existing`, call `getProjectMembership(user.id, existing.projectId)`, reject non-members, and require `canEditTasks(membership.role)` before `prisma.task.update`. Add API tests for viewer, non-member, member, and admin behavior on both `PATCH` and `DELETE`.

## Finding 2: Task search uses interpolated unsafe SQL

**File and line reference:** `src/app/api/projects/[id]/tasks/route.ts:23-35`, especially `27-34`  
**Category:** SQL injection / cross-project data access  
**Severity:** Critical

The `q` search parameter is interpolated directly into a SQL string and executed with `prisma.$queryRawUnsafe`. The route checks membership for the requested project first, but the injected query can alter the `WHERE` clause and expose tasks outside that project, or worse depending on database permissions. Business impact: a project member can potentially read task data from other projects they do not belong to.

### How to reproduce

Use any valid member token and pass a crafted `q` value that changes the boolean logic of the SQL predicate.

```bash
curl -G "http://localhost:3000/api/projects/$PROJECT_ID/tasks" \
  -H "Authorization: Bearer $TOKEN" \
  --data-urlencode "q=%' OR '1'='1"
```

Because the query is assembled as:

```sql
WHERE project_id = '${projectId}'
  AND (title ILIKE '%${q}%' OR description ILIKE '%${q}%')
```

the caller controls part of the SQL syntax instead of only controlling a value.

### Recommended fix

Use Prisma's structured query API:

```ts
where: {
  projectId,
  OR: [
    { title: { contains: q, mode: "insensitive" } },
    { description: { contains: q, mode: "insensitive" } },
  ],
}
```

If raw SQL is truly required, use parameterized `$queryRaw` with bound values, never `$queryRawUnsafe` with interpolated request input. Add a regression test proving a malicious `q` cannot return tasks from another project.

## Finding 3: Task position and status updates can corrupt board ordering

**File and line reference:** `src/app/api/projects/[id]/tasks/route.ts:65-82`, `src/app/api/tasks/[id]/route.ts:29-35`, `src/schemas/task.ts:13-20`, `prisma/schema.prisma:58-74`  
**Category:** Data integrity / workflow correctness  
**Severity:** High

New task position is calculated by reading the current last task and writing `last.position + 1` outside a transaction or uniqueness constraint. Updates also accept arbitrary `status` and `position` values and write them directly, without rebalancing the source/destination columns or preventing duplicate positions. Business impact: concurrent task creation or manual task updates can produce duplicate positions, unstable ordering, and tasks appearing in the wrong workflow sequence.

### How to reproduce

Send two create-task requests to the same project/status at nearly the same time. Both requests can read the same `last.position`, then both insert with the same next `position`. Separately, any authorized update can set `{ "status": "done", "position": 0 }` even if another task already occupies that slot.

### Recommended fix

Move position assignment and task moves into a transaction. Add a database uniqueness constraint such as `@@unique([projectId, status, position])` if the product requires one task per column position, and implement a reorder operation that shifts affected rows when a task changes status or position. Restrict generic `PATCH` so clients cannot write raw board positions without using that reorder logic.

## Finding 4: Security boundary tests are missing

**File and line reference:** `src/tests/auth.test.ts:1-14`, `src/tests/schemas.test.ts:1-39`, `src/tests/TaskCard.test.tsx:1-34`, `vitest.config.ts:4-8`  
**Category:** Missing security and authorization tests  
**Severity:** High

The existing test suite covers JWT round-tripping, Zod schema validation, and one presentational component. It does not exercise API routes, project membership boundaries, viewer/member/admin permissions, cross-project access, task assignment constraints, unsafe search input, or task ordering integrity. Business impact: the critical authorization bug in `PATCH /api/tasks/:id` and the unsafe search query can ship without any failing test.

### How to reproduce

Run `npm test`; the suite passes while the viewer task-update bug remains present. There is no test that logs in as `dev@example.com`, attempts task mutation, and asserts `403`, and no test that proves a user cannot query or mutate another project's tasks.

### Recommended fix

Add integration tests around the API boundary, backed by an isolated test database or mocked Prisma layer. Minimum coverage should include: unauthenticated requests return `401`; non-members return `403`; viewers can read but cannot create/update/delete tasks; members can create/update/delete tasks but cannot edit/delete projects; admins can edit/delete projects; search input cannot escape the project scope; task moves preserve unique positions per status.
