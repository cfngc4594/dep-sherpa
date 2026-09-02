import { ZodError } from 'zod';

export function formatValidationError(error: ZodError): string[] {
  return error.errors.map((issue) => issue.message);
}
