import { DomainError } from '../domain/tree.js';
export const DEMO_BUSY = 'Демо временно занято. Повторите позже.';
export const DEMO_EXHAUSTED =
  'Лимит изменений демо исчерпан. Просмотр доступен; изменения снова станут доступны после перезапуска сервиса.';
export class DemoLimits {
  private sessionWindow = { count: 0, until: 0 };
  private mutationWindow = { count: 0, until: 0 };
  private mutations = 0;
  private bytes = 0;
  constructor(private readonly now: () => number = Date.now) {}
  private window(value: { count: number; until: number }): void {
    const now = this.now();
    if (now >= value.until) {
      value.count = 0;
      value.until = now + 60000;
    }
  }
  admitSession(): void {
    this.window(this.sessionWindow);
    if (this.sessionWindow.count >= 60)
      throw new DomainError('DEMO_LIMIT', DEMO_BUSY, 429);
    this.sessionWindow.count++;
  }
  admitMutation(body: unknown): void {
    this.window(this.mutationWindow);
    const bytes = Buffer.byteLength(JSON.stringify(body), 'utf8');
    if (this.mutations >= 200 || this.bytes + bytes > 256 * 1024)
      throw new DomainError('DEMO_LIMIT', DEMO_EXHAUSTED, 429);
    if (this.mutationWindow.count >= 120)
      throw new DomainError('DEMO_LIMIT', DEMO_BUSY, 429);
    this.mutationWindow.count++;
    this.mutations++;
    this.bytes += bytes;
  }
}
