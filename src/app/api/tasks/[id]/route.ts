import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import {
  getCurrentUser,
  unauthorized,
  forbidden,
  notFound,
  badRequest,
  getProjectMembership,
  canEditTasks,
} from "@/lib/auth";
import { updateTaskSchema } from "@/schemas/task";

type Params = { params: Promise<{ id: string }> };

export async function PATCH(req: NextRequest, { params }: Params) {
  const user = await getCurrentUser(req);
  if (!user) return unauthorized();

  const { id } = await params;

  const body = await req.json().catch(() => null);
  const parsed = updateTaskSchema.safeParse(body);
  if (!parsed.success) return badRequest("invalid input", parsed.error.flatten());

  const existing = await prisma.task.findUnique({ where: { id } });
  if (!existing) return notFound("task not found");

  const membership = await getProjectMembership(user.id, existing.projectId);
  if (!membership) return forbidden("you are not a member of this project");
  if (!canEditTasks(membership.role)) {
    return forbidden("viewers cannot update tasks");
  }

  const task = await prisma.$transaction(async (tx) => {
    const updated = await tx.task.update({
      where: { id },
      data: parsed.data,
      include: {
        assignee: { select: { id: true, name: true, email: true } },
      },
    });

    const activity = [];
    if (parsed.data.status && parsed.data.status !== existing.status) {
      activity.push({
        projectId: existing.projectId,
        actorId: user.id,
        type: "task_status_changed" as const,
        taskId: existing.id,
        metadata: {
          title: existing.title,
          from: existing.status,
          to: parsed.data.status,
        },
      });
    }
    if (
      Object.prototype.hasOwnProperty.call(parsed.data, "assigneeId") &&
      parsed.data.assigneeId !== existing.assigneeId
    ) {
      activity.push({
        projectId: existing.projectId,
        actorId: user.id,
        type: "task_assignee_changed" as const,
        taskId: existing.id,
        metadata: {
          title: existing.title,
          from: existing.assigneeId,
          to: parsed.data.assigneeId ?? null,
        },
      });
    }

    if (activity.length > 0) {
      await tx.activity.createMany({ data: activity });
    }

    return updated;
  });

  return NextResponse.json({ task });
}

export async function DELETE(req: NextRequest, { params }: Params) {
  const user = await getCurrentUser(req);
  if (!user) return unauthorized();

  const { id } = await params;

  const existing = await prisma.task.findUnique({ where: { id } });
  if (!existing) return notFound("task not found");

  const membership = await getProjectMembership(user.id, existing.projectId);
  if (!membership) return forbidden("you are not a member of this project");
  if (!canEditTasks(membership.role)) {
    return forbidden("viewers cannot delete tasks");
  }

  await prisma.task.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
