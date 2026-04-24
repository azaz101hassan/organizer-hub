"use server";

import { redirect } from "next/navigation";
import { ApiError, apiFetch, UnauthorizedError } from "@/lib/api/client";
import type { OrganizationView } from "@/lib/api/types";

export interface CreateOrgFormState {
  error?: string;
  fieldErrors?: { name?: string; description?: string };
  values?: { name?: string; description?: string };
}

export async function createOrganization(
  _prev: CreateOrgFormState,
  formData: FormData,
): Promise<CreateOrgFormState> {
  const name = String(formData.get("name") ?? "").trim();
  const description = String(formData.get("description") ?? "").trim();

  const fieldErrors: NonNullable<CreateOrgFormState["fieldErrors"]> = {};
  if (name.length < 2) fieldErrors.name = "Name must be at least 2 characters.";
  if (name.length > 80) fieldErrors.name = "Name must be 80 characters or fewer.";
  if (description.length > 500) {
    fieldErrors.description = "Description must be 500 characters or fewer.";
  }
  if (Object.keys(fieldErrors).length > 0) {
    return { fieldErrors, values: { name, description } };
  }

  let org: OrganizationView;
  try {
    org = await apiFetch<OrganizationView>("/organizations", {
      method: "POST",
      body: { name, ...(description ? { description } : {}) },
    });
  } catch (err) {
    if (err instanceof UnauthorizedError) redirect("/auth/login");
    if (err instanceof ApiError) {
      return {
        error: `Could not create organization (${err.status}).`,
        values: { name, description },
      };
    }
    throw err;
  }

  redirect(`/dashboard/organizations/${org.id}`);
}
