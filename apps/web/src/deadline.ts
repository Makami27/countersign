export class TookTooLong extends Error {
  readonly label: string;
  readonly ms: number;

  constructor(label: string, ms: number) {
    super(`${label} didn't answer within ${ms / 1000} s.`);
    this.label = label;
    this.ms = ms;
  }
}

export async function within<T>(ms: number, label: string, work: Promise<T>): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const late = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => reject(new TookTooLong(label, ms)), ms);
  });
  work.catch(() => undefined);
  try {
    return await Promise.race([work, late]);
  } catch (error) {
    if (error instanceof TookTooLong) console.error(`slow: ${error.message}`);
    throw error;
  } finally {
    clearTimeout(timer);
  }
}
