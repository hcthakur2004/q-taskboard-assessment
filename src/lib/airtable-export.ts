import Airtable from "airtable";
import type { FieldSet } from "airtable/lib/field_set";
import type { TaskStatus } from "@/types";

export type ExportTask = {
  id: string;
  title: string;
  status: TaskStatus;
  description: string | null;
  assignee?: { name: string; email: string } | null;
  position: number;
  updatedAt: Date | string;
};

export type ExportProject = {
  id: string;
  name: string;
};

export type AirtableExportRecord = {
  id: string;
  fields: FieldSet;
};

export type AirtableExportClient = {
  findByTaskId(taskId: string): Promise<AirtableExportRecord | null>;
  create(fields: FieldSet): Promise<AirtableExportRecord>;
  update(recordId: string, fields: FieldSet): Promise<AirtableExportRecord>;
};

export type TaskExportResult = {
  taskId: string;
  action: "created" | "updated" | "failed";
  recordId?: string;
  error?: string;
};

export type ProjectExportResult = {
  total: number;
  created: number;
  updated: number;
  failed: number;
  results: TaskExportResult[];
};

const MAX_ATTEMPTS = 3;

export function createAirtableClientFromEnv(): AirtableExportClient {
  const apiKey = process.env.AIRTABLE_API_KEY;
  const baseId = process.env.AIRTABLE_BASE_ID;
  const tableName = process.env.AIRTABLE_TABLE_NAME || "Tasks";

  if (!apiKey || !baseId) {
    throw new Error("AIRTABLE_API_KEY and AIRTABLE_BASE_ID are required");
  }

  const table = new Airtable({ apiKey }).base(baseId)(tableName);

  return {
    async findByTaskId(taskId) {
      const records = await table
        .select({
          filterByFormula: `{Task ID} = '${escapeFormulaString(taskId)}'`,
          maxRecords: 1,
        })
        .firstPage();
      const record = records[0];
      return record ? { id: record.id, fields: record.fields } : null;
    },
    async create(fields) {
      const record = await table.create(fields);
      return { id: record.id, fields: record.fields };
    },
    async update(recordId, fields) {
      const record = await table.update(recordId, fields);
      return { id: record.id, fields: record.fields };
    },
  };
}

export async function exportProjectTasksToAirtable(
  project: ExportProject,
  tasks: ExportTask[],
  client: AirtableExportClient = createAirtableClientFromEnv(),
): Promise<ProjectExportResult> {
  const results: TaskExportResult[] = [];

  for (const task of tasks) {
    const fields = toAirtableFields(project, task);

    try {
      const existing = await withRetry(() => client.findByTaskId(task.id));
      if (existing) {
        const updated = await withRetry(() => client.update(existing.id, fields));
        results.push({ taskId: task.id, action: "updated", recordId: updated.id });
      } else {
        const created = await withRetry(() => client.create(fields));
        results.push({ taskId: task.id, action: "created", recordId: created.id });
      }
    } catch (error) {
      results.push({
        taskId: task.id,
        action: "failed",
        error: error instanceof Error ? error.message : "unknown Airtable error",
      });
    }
  }

  return {
    total: tasks.length,
    created: results.filter((r) => r.action === "created").length,
    updated: results.filter((r) => r.action === "updated").length,
    failed: results.filter((r) => r.action === "failed").length,
    results,
  };
}

function toAirtableFields(project: ExportProject, task: ExportTask) {
  void project;
  return {
    "Task ID": task.id,
    Title: task.title,
  };
}

async function withRetry<T>(operation: () => Promise<T>): Promise<T> {
  let lastError: unknown;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;
      if (!isTransientAirtableError(error) || attempt === MAX_ATTEMPTS) {
        throw error;
      }
      await sleep(150 * attempt);
    }
  }

  throw lastError;
}

function isTransientAirtableError(error: unknown) {
  const statusCode =
    typeof error === "object" && error !== null && "statusCode" in error
      ? Number((error as { statusCode?: number }).statusCode)
      : undefined;

  if (!statusCode) return true;
  return statusCode === 408 || statusCode === 409 || statusCode === 429 || statusCode >= 500;
}

function escapeFormulaString(value: string) {
  return value.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
