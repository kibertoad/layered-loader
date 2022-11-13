export type User = {
  companyId: string
  userId: string
}

export type GroupValues = Record<string, Record<string, User | null>>
