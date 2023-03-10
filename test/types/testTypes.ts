export type User = {
  companyId: string
  userId: string
  parametrized?: string
}

export type GroupValues = Record<string, Record<string, User | null>>
