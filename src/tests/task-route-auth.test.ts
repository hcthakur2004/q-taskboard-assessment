import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextResponse, type NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  currentUser: { id: "user_1", email: "user@example.com", name: "User One" },
  membership: null as null | { role: "admin" | "member" | "viewer" },
  findUnique: vi.fn(),
  update: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    task: {
      findUnique: mocks.findUnique,
      update: mocks.update,
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

import { PATCH } from "@/app/api/tasks/[id]/route";

function patchRequest(body: unknown) {
  return new Request("http://localhost/api/tasks/task_1", {
    method: "PATCH",
    body: JSON.stringify(body),
    headers: { "Content-Type": "application/json" },
  }) as NextRequest;
}

const params = { params: Promise.resolve({ id: "task_1" }) };

describe("PATCH /api/tasks/:id authorization", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.membership = null;
    mocks.findUnique.mockResolvedValue({ id: "task_1", projectId: "project_1" });
    mocks.update.mockResolvedValue({
      id: "task_1",
      projectId: "project_1",
      title: "Updated task",
      status: "done",
      assignee: null,
    });
  });

  it("rejects non-members before updating the task", async () => {
    mocks.membership = null;

    const res = await PATCH(patchRequest({ title: "Updated task" }), params);
    const body = await res.json();

    expect(res.status).toBe(403);
    expect(body.error).toBe("you are not a member of this project");
    expect(mocks.update).not.toHaveBeenCalled();
  });

  it("rejects viewers before updating the task", async () => {
    mocks.membership = { role: "viewer" };

    const res = await PATCH(patchRequest({ title: "Updated task" }), params);
    const body = await res.json();

    expect(res.status).toBe(403);
    expect(body.error).toBe("viewers cannot update tasks");
    expect(mocks.update).not.toHaveBeenCalled();
  });

  it("allows project members to update tasks", async () => {
    mocks.membership = { role: "member" };

    const res = await PATCH(patchRequest({ title: "Updated task", status: "done" }), params);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.task.title).toBe("Updated task");
    expect(mocks.update).toHaveBeenCalledWith({
      where: { id: "task_1" },
      data: { title: "Updated task", status: "done" },
      include: {
        assignee: { select: { id: true, name: true, email: true } },
      },
    });
  });
});
