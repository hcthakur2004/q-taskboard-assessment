import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextResponse, type NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  currentUser: { id: "user_1", email: "user@example.com", name: "User One" },
  membership: null as null | { role: "admin" | "member" | "viewer" },
  projectFindUnique: vi.fn(),
  exportProjectTasksToAirtable: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    project: {
      findUnique: mocks.projectFindUnique,
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

vi.mock("@/lib/airtable-export", () => ({
  exportProjectTasksToAirtable: mocks.exportProjectTasksToAirtable,
}));

import { POST } from "@/app/api/projects/[id]/export/airtable/route";

const request = new Request("http://localhost/api/projects/project_1/export/airtable", {
  method: "POST",
}) as NextRequest;
const params = { params: Promise.resolve({ id: "project_1" }) };

describe("POST /api/projects/:id/export/airtable", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.membership = { role: "member" };
    mocks.projectFindUnique.mockResolvedValue({
      id: "project_1",
      name: "Project One",
      tasks: [
        {
          id: "task_1",
          title: "First task",
          status: "todo",
          description: null,
          assignee: null,
          position: 0,
          updatedAt: new Date("2026-01-01T00:00:00.000Z"),
        },
      ],
    });
    mocks.exportProjectTasksToAirtable.mockResolvedValue({
      total: 1,
      created: 1,
      updated: 0,
      failed: 0,
      results: [{ taskId: "task_1", action: "created", recordId: "rec_1" }],
    });
  });

  it("allows project members to trigger an export", async () => {
    const res = await POST(request, params);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.export.created).toBe(1);
    expect(mocks.exportProjectTasksToAirtable).toHaveBeenCalledWith(
      { id: "project_1", name: "Project One" },
      expect.arrayContaining([expect.objectContaining({ id: "task_1" })]),
    );
  });

  it("allows project admins to trigger an export", async () => {
    mocks.membership = { role: "admin" };

    const res = await POST(request, params);

    expect(res.status).toBe(200);
    expect(mocks.exportProjectTasksToAirtable).toHaveBeenCalled();
  });

  it("forbids viewers from triggering an export", async () => {
    mocks.membership = { role: "viewer" };

    const res = await POST(request, params);
    const body = await res.json();

    expect(res.status).toBe(403);
    expect(body.error).toBe("viewers cannot export tasks");
    expect(mocks.exportProjectTasksToAirtable).not.toHaveBeenCalled();
  });
});
