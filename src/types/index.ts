export type Role = "admin" | "member" | "viewer";
export type TaskStatus = "todo" | "in_progress" | "review" | "done";

export type ApiUser = {
  id: string;
  email: string;
  name: string;
};

export type ApiTask = {
  id: string;
  projectId: string;
  title: string;
  description: string | null;
  status: TaskStatus;
  assigneeId: string | null;
  createdById: string;
  position: number;
  createdAt: string;
  updatedAt: string;
  assignee?: ApiUser | null;
};

export type ApiComment = {
  id: string;
  taskId: string;
  authorId: string;
  body: string;
  createdAt: string;
  author: ApiUser;
};

export type ActivityType =
  | "task_created"
  | "task_status_changed"
  | "task_assignee_changed"
  | "comment_added";

export type ApiActivity = {
  id: string;
  projectId: string;
  actorId: string;
  type: ActivityType;
  taskId: string | null;
  commentId: string | null;
  metadata: Record<string, unknown> | null;
  createdAt: string;
  actor: ApiUser;
  task?: Pick<ApiTask, "id" | "title"> | null;
};

export type ApiProjectMember = {
  id: string;
  role: Role;
  user: ApiUser & { passwordHash?: string };
};

export type ApiProjectDetail = {
  id: string;
  name: string;
  description: string | null;
  ownerId: string;
  owner: ApiUser & { passwordHash?: string };
  memberships: ApiProjectMember[];
  tasks: ApiTask[];
  createdAt: string;
  updatedAt: string;
};

export type AirtableTaskExport = {
  total: number;
  created: number;
  updated: number;
  failed: number;
  results: Array<{
    taskId: string;
    action: "created" | "updated" | "failed";
    recordId?: string;
    error?: string;
  }>;
};

export const STATUS_LABELS: Record<TaskStatus, string> = {
  todo: "To do",
  in_progress: "In progress",
  review: "In review",
  done: "Done",
};

export const STATUS_ORDER: TaskStatus[] = ["todo", "in_progress", "review", "done"];
