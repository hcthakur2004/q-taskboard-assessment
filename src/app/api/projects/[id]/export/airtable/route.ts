import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import {
  badRequest,
  canEditTasks,
  forbidden,
  getCurrentUser,
  getProjectMembership,
  notFound,
  unauthorized,
} from "@/lib/auth";
import { exportProjectTasksToAirtable } from "@/lib/airtable-export";

type Params = { params: Promise<{ id: string }> };

export async function POST(req: NextRequest, { params }: Params) {
  const user = await getCurrentUser(req);
  if (!user) return unauthorized();

  const { id: projectId } = await params;
  const membership = await getProjectMembership(user.id, projectId);
  if (!membership) return forbidden("you are not a member of this project");
  if (!canEditTasks(membership.role)) {
    return forbidden("viewers cannot export tasks");
  }

  const project = await prisma.project.findUnique({
    where: { id: projectId },
    select: {
      id: true,
      name: true,
      tasks: {
        include: {
          assignee: { select: { name: true, email: true } },
        },
        orderBy: [{ status: "asc" }, { position: "asc" }],
      },
    },
  });

  if (!project) return notFound("project not found");

  try {
    const result = await exportProjectTasksToAirtable(
      { id: project.id, name: project.name },
      project.tasks,
    );

    return NextResponse.json({ export: result });
  } catch (error) {
    return badRequest(error instanceof Error ? error.message : "Airtable export failed");
  }
}
