import { describe, expect, it, vi } from "vitest";
import {
  exportProjectTasksToAirtable,
  type AirtableExportClient,
  type AirtableExportRecord,
  type ExportTask,
} from "@/lib/airtable-export";
import type { FieldSet } from "airtable/lib/field_set";

const project = { id: "project_1", name: "Project One" };

const tasks: ExportTask[] = [
  {
    id: "task_1",
    title: "First task",
    status: "todo",
    description: null,
    assignee: null,
    position: 0,
    updatedAt: "2026-01-01T00:00:00.000Z",
  },
  {
    id: "task_2",
    title: "Second task",
    status: "done",
    description: null,
    assignee: null,
    position: 1,
    updatedAt: "2026-01-01T00:00:00.000Z",
  },
];

describe("exportProjectTasksToAirtable", () => {
  it("creates records on first run and updates them on repeated runs", async () => {
    const client = new FakeAirtableClient();

    const first = await exportProjectTasksToAirtable(project, tasks, client);
    const second = await exportProjectTasksToAirtable(project, tasks, client);

    expect(first.created).toBe(2);
    expect(first.updated).toBe(0);
    expect(second.created).toBe(0);
    expect(second.updated).toBe(2);
    expect(client.records.size).toBe(2);
  });

  it("retries transient Airtable failures", async () => {
    const client = new FakeAirtableClient();
    client.failNextCreate = transientError();

    const result = await exportProjectTasksToAirtable(project, [tasks[0]], client);

    expect(result.created).toBe(1);
    expect(result.failed).toBe(0);
    expect(client.createCalls).toBe(2);
  });

  it("does not retry permanent failures and continues with remaining tasks", async () => {
    const client = new FakeAirtableClient();
    client.failTaskIds.add("task_1");

    const result = await exportProjectTasksToAirtable(project, tasks, client);

    expect(result.total).toBe(2);
    expect(result.created).toBe(1);
    expect(result.failed).toBe(1);
    expect(result.results[0]).toMatchObject({ taskId: "task_1", action: "failed" });
    expect(result.results[1]).toMatchObject({ taskId: "task_2", action: "created" });
    expect(client.createCalls).toBe(2);
  });
});

class FakeAirtableClient implements AirtableExportClient {
  records = new Map<string, AirtableExportRecord>();
  createCalls = 0;
  failTaskIds = new Set<string>();
  failNextCreate: Error | null = null;

  async findByTaskId(taskId: string) {
    return this.records.get(taskId) ?? null;
  }

  async create(fields: FieldSet) {
    this.createCalls++;
    const taskId = String(fields["Task ID"]);
    if (this.failNextCreate) {
      const error = this.failNextCreate;
      this.failNextCreate = null;
      throw error;
    }
    if (this.failTaskIds.has(taskId)) {
      throw permanentError();
    }

    const record = {
      id: `rec_${taskId}`,
      fields,
    };
    this.records.set(taskId, record);
    return record;
  }

  async update(recordId: string, fields: FieldSet) {
    const taskId = String(fields["Task ID"]);
    const record = {
      id: recordId,
      fields,
    };
    this.records.set(taskId, record);
    return record;
  }
}

function transientError() {
  return Object.assign(new Error("rate limited"), { statusCode: 429 });
}

function permanentError() {
  return Object.assign(new Error("invalid field"), { statusCode: 422 });
}
