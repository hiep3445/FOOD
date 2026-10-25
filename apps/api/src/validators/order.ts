import { z } from 'zod'

export const orderSchema = z.object({
  customerName: z.string().trim().min(2).max(100),
  customerPhone: z.string().trim().regex(/^(\+?84|0)(3|5|7|8|9)\d{8}$/),
  deliveryAddress: z.string().trim().min(8).max(300),
  customerNote: z.string().trim().max(500).default(''),
  items: z.array(z.object({
    productId: z.string().min(1).max(64),
    quantity: z.number().int().min(1).max(20),
  }).strict()).min(1).max(20),
}).strict().superRefine((order, context) => {
  const ids = order.items.map((item) => item.productId)
  if (new Set(ids).size !== ids.length) {
    context.addIssue({ code: 'custom', path: ['items'], message: 'Mỗi món chỉ được xuất hiện một lần.' })
  }
})

export type OrderInput = z.infer<typeof orderSchema>