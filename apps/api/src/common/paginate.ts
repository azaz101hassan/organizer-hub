export interface CursorPaginated<T> {
  items: T[];
  nextCursor: string | null;
}

// Generic cursor paginator over any Prisma model with an `id: string` field.
// `findMany` is the model delegate's findMany — pass it bound or as a lambda.
// Default limit is 20; callers enforce the max-100 cap via DTO validation.
export async function paginateById<TItem extends { id: string }>(
  findMany: (args: {
    where: unknown;
    take: number;
    skip?: number;
    cursor?: { id: string };
    orderBy: unknown;
    include?: unknown;
  }) => Promise<TItem[]>,
  opts: {
    where: unknown;
    orderBy: unknown;
    include?: unknown;
    cursor?: string;
    limit?: number;
  },
): Promise<CursorPaginated<TItem>> {
  const take = opts.limit ?? 20;
  const rows = await findMany({
    where: opts.where,
    take: take + 1,
    ...(opts.cursor ? { skip: 1, cursor: { id: opts.cursor } } : {}),
    orderBy: opts.orderBy,
    ...(opts.include !== undefined ? { include: opts.include } : {}),
  });
  const hasMore = rows.length > take;
  const items = hasMore ? rows.slice(0, -1) : rows;
  return {
    items,
    nextCursor: hasMore ? items[items.length - 1].id : null,
  };
}
