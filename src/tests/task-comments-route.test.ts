import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextResponse, type NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  currentUser: { id: "user_1", email: "user@example.com", name: "User One" },
  membership: null as null | { role: "admin" | "member" | "viewer" },
  taskFindUnique: vi.fn(),
  commentFindMany: vi.fn(),
  commentCreate: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    task: {
      findUnique: mocks.taskFindUnique,
    },
    comment: {
      findMany: mocks.commentFindMany,
      create: mocks.commentCreate,
    },
  },
}));

vi.mock("@/lib/auth", () => ({
  getCurrentUser: vi.fn(() => Promise.resolve(mocks.currentUser)),
  getProjectMembership: vi.fn(() => Promise.resolve(mocks.membership)),
  canEditTasks: (role: string | null | undefined) => role === "admin" || role === "member",
  unauthorized: (message = "unauthorized") =>
    NextResponse.json({ error: message }, { status: 401 }),
  forbidden: (message = "forbidden") =>
    NextResponse.json({ error: message }, { status: 403 }),
  notFound: (message = "not found") =>
    NextResponse.json({ error: message }, { status: 404 }),
  badRequest: (message = "bad request", details?: unknown) =>
    NextResponse.json({ error: message, details }, { status: 400 }),
}));

import { GET, POST } from "@/app/api/tasks/[id]/comments/route";

const params = { params: Promise.resolve({ id: "task_1" }) };

function request(body?: unknown) {
  return new Request("http://localhost/api/tasks/task_1/comments", {
    method: body ? "POST" : "GET",
    body: body ? JSON.stringify(body) : undefined,
    headers: { "Content-Type": "application/json" },
  }) as NextRequest;
}

describe("/api/tasks/:id/comments", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.membership = { role: "member" };
    mocks.taskFindUnique.mockResolvedValue({ projectId: "project_1" });
    mocks.commentFindMany.mockResolvedValue([
      {
        id: "comment_1",
        taskId: "task_1",
        authorId: "user_1",
        body: "First comment",
        createdAt: new Date("2026-01-01T00:00:00.000Z"),
        author: mocks.currentUser,
      },
    ]);
    mocks.commentCreate.mockResolvedValue({
      id: "comment_2",
      taskId: "task_1",
      authorId: "user_1",
      body: "New comment",
      createdAt: new Date("2026-01-01T00:01:00.000Z"),
      author: mocks.currentUser,
    });
  });

  it("lists comments chronologically for project viewers", async () => {
    mocks.membership = { role: "viewer" };

    const res = await GET(request(), params);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.comments).toHaveLength(1);
    expect(mocks.commentFindMany).toHaveBeenCalledWith({
      where: { taskId: "task_1" },
      include: {
        author: { select: { id: true, name: true, email: true } },
      },
      orderBy: { createdAt: "asc" },
    });
  });

  it("allows project members to post comments", async () => {
    mocks.membership = { role: "member" };

    const res = await POST(request({ body: "New comment" }), params);
    const body = await res.json();

    expect(res.status).toBe(201);
    expect(body.comment.body).toBe("New comment");
    expect(mocks.commentCreate).toHaveBeenCalledWith({
      data: {
        taskId: "task_1",
        authorId: "user_1",
        body: "New comment",
      },
      include: {
        author: { select: { id: true, name: true, email: true } },
      },
    });
  });

  it("allows project admins to post comments", async () => {
    mocks.membership = { role: "admin" };

    const res = await POST(request({ body: "New comment" }), params);

    expect(res.status).toBe(201);
    expect(mocks.commentCreate).toHaveBeenCalled();
  });

  it("forbids viewers from posting comments", async () => {
    mocks.membership = { role: "viewer" };

    const res = await POST(request({ body: "New comment" }), params);
    const body = await res.json();

    expect(res.status).toBe(403);
    expect(body.error).toBe("viewers cannot post comments");
    expect(mocks.commentCreate).not.toHaveBeenCalled();
  });
});
