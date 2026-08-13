/**
 * Reduces Zod's issue list to one message per top-level field, keyed by
 * field name -- the shape every action-state form error object under
 * features/<name>/actions uses.
 */
export function firstIssuePerField<TField extends string>(
  issues: { path: PropertyKey[]; message: string }[]
): Partial<Record<TField, string>> {
  const fieldErrors: Partial<Record<TField, string>> = {};
  for (const issue of issues) {
    const key = issue.path[0] as TField;
    if (key && !fieldErrors[key]) {
      fieldErrors[key] = issue.message;
    }
  }
  return fieldErrors;
}
