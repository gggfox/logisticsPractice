import type { StepSchemaInput } from 'motia'
import type { ZodTypeAny } from 'zod'

// Motia's public `StepSchemaInput` resolves `ZodInput` against its own zod v4
// dependency, while `@carrier-sales/shared` schemas come from zod v3. The
// runtime is fully compatible (motia calls `.safeParse`, identical in v3/v4);
// this helper centralizes the v3 -> v4 type bridge so the cast is named and
// auditable instead of spread as `as any` across every step.
export const asStepSchema = (schema: ZodTypeAny): StepSchemaInput =>
  schema as unknown as StepSchemaInput
