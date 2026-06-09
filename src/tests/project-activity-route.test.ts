import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextResponse, type NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  currentUser: { id: "user_1", email: "user@example.com", name: "User One" },
  membership: null as null | { role: "admin" | "member" | "viewer" },
  activityFindMany: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    activity: {
      findMany: mocks.activityFindMany,
    },
  },
}));

vi.mock("@/lib/auth", () => ({
  getCurrentUser: vi.fn(() => Promise.resolve(mocks.currentUser)),
  getProjectMembership: vi.fn(() => Promise.resolve(mocks.membership)),
  unauthorized: (message = "unauthorized") =>
    NextResponse.json({ error: message }, { status: 401 }),
  forbidden: (message = "forbidden") =>
    NextResponse.json({ error: message }, { status: 403 }),
}));

import { GET } from "@/app/api/projects/[id]/activity/route";

const params = { params: Promise.resolve({ id: "project_1" }) };
const request = new Request("http://localhost/api/projects/project_1/activity") as NextRequest;

describe("GET /api/projects/:id/activity", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.membership = { role: "viewer" };
    mocks.activityFindMany.mockResolvedValue([
      {
        id: "activity_1",
        projectId: "project_1",
        type: "comment_added",
        createdAt: new Date("2026-01-01T00:00:00.000Z"),
        actor: mocks.currentUser,
        task: { id: "task_1", title: "Task one" },
      },
    ]);
  });

  it("lists recent activity newest first for project members", async () => {
    const res = await GET(request, params);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.activity).toHaveLength(1);
    expect(mocks.activityFindMany).toHaveBeenCalledWith({
      where: { projectId: "project_1" },
      include: {
        actor: { select: { id: true, name: true, email: true } },
        task: { select: { id: true, title: true } },
      },
      orderBy: { createdAt: "desc" },
      take: 30,
    });
  });

  it("rejects non-members", async () => {
    mocks.membership = null;

    const res = await GET(request, params);
    const body = await res.json();

    expect(res.status).toBe(403);
    expect(body.error).toBe("you are not a member of this project");
    expect(mocks.activityFindMany).not.toHaveBeenCalled();
  });
});
