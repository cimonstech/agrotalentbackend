import type { ZodType } from 'zod'
import type { Request, Response, NextFunction } from 'express'

export function validate(schema: ZodType) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const result = schema.safeParse(req.body)
    if (!result.success) {
      console.error(
        '[Validate] Failed for:',
        req.method,
        req.path,
        'Body:',
        JSON.stringify(req.body)
      )
      console.error('[Validate] Issues:', JSON.stringify(result.error.issues))
      res.status(400).json({
        success: false,
        error: 'Validation failed',
        details: result.error.issues.map((e) => ({
          field: e.path.join('.'),
          message: e.message,
        })),
      })
      return
    }
    req.body = result.data
    next()
  }
}

export function validateQuery(schema: ZodType) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const result = schema.safeParse(req.query)
    if (!result.success) {
      res.status(400).json({
        success: false,
        error: 'Invalid query parameters',
        details: result.error.issues.map((e) => ({
          field: e.path.join('.'),
          message: e.message,
        })),
      })
      return
    }
    Object.assign(req.query as Record<string, unknown>, result.data)
    next()
  }
}
