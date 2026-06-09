# Terminal Log

This log records the key verification steps from the TaskBoard changes. Secrets are intentionally omitted.

## 1. Setup Output

```powershell
npm run db:generate
```

```text
> taskboard@0.1.0 db:generate
> prisma generate

Environment variables loaded from .env
Prisma schema loaded from prisma\schema.prisma
Generated Prisma Client (v6.1.0) to .\node_modules\@prisma\client
```

```powershell
npm run db:migrate
```

```text
> taskboard@0.1.0 db:migrate
> prisma migrate deploy

Environment variables loaded from .env
Prisma schema loaded from prisma\schema.prisma
Datasource "db": PostgreSQL database "taskboard", schema "public" at "localhost:5432"

No pending migrations to apply.
```

## 2. Initial Test Run

```powershell
npm test
```

```text
Test Files  4 passed (4)
Tests       15 passed (15)
```

## 3. Bug Curl Proof: Viewer Could Update Task

```powershell
$login = Invoke-RestMethod -Uri 'http://localhost:3000/api/auth/login' `
  -Method Post `
  -ContentType 'application/json' `
  -Body '{"email":"dev@example.com","password":"password123"}'

$headers = @{ Authorization = "Bearer $($login.token)" }
$projects = Invoke-RestMethod -Uri 'http://localhost:3000/api/projects' -Headers $headers
$project = $projects.projects | Where-Object { $_.name -eq 'Q3 Launch' } | Select-Object -First 1
$tasks = Invoke-RestMethod -Uri "http://localhost:3000/api/projects/$($project.id)/tasks" -Headers $headers
$task = $tasks.tasks | Select-Object -First 1

Invoke-RestMethod -Uri "http://localhost:3000/api/tasks/$($task.id)" `
  -Method Patch `
  -ContentType 'application/json' `
  -Headers $headers `
  -Body '{"title":"viewer changed this task","status":"done"}'
```

```text
viewer=dev@example.com role=viewer project=cmq68j0hk0006dxns61nrmfhi
before_task=cmq68j0if000vdxns28t7s5ki title=Prepare customer email blast status=todo
PATCH_STATUS=200
```

```json
{
  "task": {
    "id": "cmq68j0if000vdxns28t7s5ki",
    "projectId": "cmq68j0hk0006dxns61nrmfhi",
    "title": "viewer changed this task",
    "status": "done"
  }
}
```

## 4. Fix Curl Proof: Viewer Blocked

```powershell
try {
  Invoke-RestMethod -Uri "http://localhost:3000/api/tasks/$($task.id)" `
    -Method Patch `
    -ContentType 'application/json' `
    -Headers $headers `
    -Body '{"title":"viewer changed this task after fix","status":"done"}'
} catch {
  $status = $_.Exception.Response.StatusCode.value__
  $reader = New-Object System.IO.StreamReader($_.Exception.Response.GetResponseStream())
  "STATUS=$status"
  $reader.ReadToEnd()
}
```

```text
viewer=dev@example.com role=viewer task=cmq68j0ig000xdxnsrffxz8cd before_title=Update pricing page copy before_status=todo
STATUS=403
{"error":"viewers cannot update tasks"}
```

## 5. Part 3c Demo: Airtable Export

Airtable base opened for verification:

```text
https://airtable.com/app6G92KFQTBIPeKc
```

First export through the server endpoint:

```powershell
$result = Invoke-RestMethod -Uri "http://localhost:3000/api/projects/$($project.id)/export/airtable" `
  -Method Post `
  -Headers $adminHeaders `
  -ContentType 'application/json'

$result.export | ConvertTo-Json -Depth 6
```

```text
project=cmq68j0hk0006dxns61nrmfhi tasks=8
```

```json
{
  "total": 8,
  "created": 0,
  "updated": 8,
  "failed": 0
}
```

Second export to prove graceful rerun/idempotency:

```powershell
$second = Invoke-RestMethod -Uri "http://localhost:3000/api/projects/$($project.id)/export/airtable" `
  -Method Post `
  -Headers $adminHeaders `
  -ContentType 'application/json'
```

```text
second_run total=8 created=0 updated=8 failed=0
```

Viewer authorization check:

```text
viewer_status=403
{"error":"viewers cannot export tasks"}
```

## 6. Part 3a Demo: Append-Only Comments

```powershell
$admin = Invoke-RestMethod -Uri 'http://localhost:3000/api/auth/login' `
  -Method Post `
  -ContentType 'application/json' `
  -Body '{"email":"meera@taskboard.dev","password":"password123"}'

$adminHeaders = @{ Authorization = "Bearer $($admin.token)" }
$projects = Invoke-RestMethod -Uri 'http://localhost:3000/api/projects' -Headers $adminHeaders
$project = $projects.projects | Where-Object { $_.name -eq 'Q3 Launch' } | Select-Object -First 1
$tasks = Invoke-RestMethod -Uri "http://localhost:3000/api/projects/$($project.id)/tasks" -Headers $adminHeaders
$task = $tasks.tasks | Select-Object -First 1

$created = Invoke-RestMethod -Uri "http://localhost:3000/api/tasks/$($task.id)/comments" `
  -Method Post `
  -ContentType 'application/json' `
  -Headers $adminHeaders `
  -Body '{"body":"API verification comment"}'
```

```text
task=cmq68j0ig000xdxnsrffxz8cd project=cmq68j0hk0006dxns61nrmfhi
admin_post_status=201 body=API verification comment author=meera@taskboard.dev
viewer_read_count=1
viewer_post_status=403
{"error":"viewers cannot post comments"}
```

## 7. Part 3b Demo: Activity Feed

```powershell
$created = Invoke-RestMethod -Uri "http://localhost:3000/api/projects/$($project.id)/tasks" `
  -Method Post `
  -ContentType 'application/json' `
  -Headers $adminHeaders `
  -Body '{"title":"Activity verification task","status":"todo"}'

$patched = Invoke-RestMethod -Uri "http://localhost:3000/api/tasks/$($created.task.id)" `
  -Method Patch `
  -ContentType 'application/json' `
  -Headers $adminHeaders `
  -Body '{"status":"review"}'

$comment = Invoke-RestMethod -Uri "http://localhost:3000/api/tasks/$($created.task.id)/comments" `
  -Method Post `
  -ContentType 'application/json' `
  -Headers $adminHeaders `
  -Body '{"body":"Activity verification comment"}'

$feed = Invoke-RestMethod -Uri "http://localhost:3000/api/projects/$($project.id)/activity" `
  -Headers $adminHeaders
```

```text
created_task=cmq78en6d0001dxw4eb083v8k status_after=review comment=cmq78erdl0006dxw4esfolzmt
activity type=comment_added actor=meera@taskboard.dev task=Activity verification task
activity type=task_status_changed actor=meera@taskboard.dev task=Activity verification task
activity type=task_created actor=meera@taskboard.dev task=Activity verification task
```

## 8. Final Test Run

```powershell
npm test
```

```text
Test Files  8 passed (8)
Tests       29 passed (29)
```

```powershell
npm run typecheck
```

```text
> taskboard@0.1.0 typecheck
> tsc --noEmit

passed
```
